/**
 * HighlightBodyMarker
 *
 * Single Responsibility: Reconcile `==text==` inline highlight marks in a
 * vault note's body so the set of marks matches a TextHighlight[] source of
 * truth (e.g. the latest server state synced via AnnotationSyncService).
 *
 * Idempotent and pure — no Obsidian API, no network calls. Works on raw
 * markdown strings so it is trivially unit-testable.
 *
 * Scope:
 * - Frontmatter (between leading `---` fences) is preserved verbatim.
 * - The managed "Mobile Annotations" block (HTML comment markers) is
 *   preserved verbatim — callout text there must stay in `> [!quote]+`
 *   syntax and must not be confused with body marks.
 * - Foreign `==marks==` that don't correspond to any target highlight are
 *   left untouched (may be user-authored markdown).
 *
 * Phase 2 upgrade (PRD §4.11):
 * - Re-anchoring logic delegated to `@social-archiver/highlight-core`'s
 *   `resolveHighlightRange`. Server highlights carry `startOffset`/`endOffset`
 *   relative to fullText, plus `contextBefore`/`contextAfter` windows of up
 *   to {@link CONTEXT_WINDOW} chars. We treat the vault note body as a
 *   fullText surrogate (title is kept in frontmatter, not prefixed here).
 *
 * Phase 3 upgrade (PRD §5.4, §5.5) — READ-ONLY DUAL-READ:
 * - Re-anchor now flows through `loadHighlightsForRender` so `==text==` marks
 *   are painted using the dual-read 4-state runtime model
 *   (`canonical-trusted` / `soft-canonical-missing-version` /
 *   `wrong-canonical-v2` / `legacy-visible-v0`).
 * - Per PRD §5.5 matrix, the plugin is the canonical WRITE-path and MUST NOT
 *   perform read-path write-back — doing so would duplicate-echo back through
 *   the outbound annotation sync pipeline. We consume only the `rendered`
 *   stream from `loadHighlightsForRender` and discard `writeBackCandidates`.
 * - `coordinateState === 'wrong-canonical-v2'` rows (fulltext-v1 tag but slice
 *   mismatch) are logged to `console.debug` for field diagnostics (no
 *   telemetry backend wired yet).
 *
 * Write-back gating (Codex caveat, still applies to the render path):
 * - Skip wrapping when the resolver returns `renderState === 'unresolved-migration'`.
 * - Skip wrapping when `candidateCount > 1` — multiple anchor hits mean the
 *   resolver cannot pick a unique occurrence and write-back would risk
 *   marking the wrong span.
 * - `shift > 0` (drift) is logged but not blocking — it's a degraded mapping
 *   signal, not an error.
 */

import type { TextHighlight } from '@/types/annotations';
import {
  loadHighlightsForRender,
  type DualReadArchiveInput,
  type RenderedHighlight,
  type TextHighlight as CoreTextHighlight,
} from '../vendor/highlight-core';

// ─── Constants ───────────────────────────────────────────

const ANNOTATIONS_START_MARKER = '<!-- social-archiver:annotations:start -->';

/**
 * Matches `==text==` highlight marks.
 *
 * - Negative lookahead `(?![-=])` avoids matching `===` (heading rule) and
 *   `==-` style patterns.
 * - `[\s\S]+?` allows multi-line highlights with a lazy match.
 */
const HIGHLIGHT_MARK_REGEX = /==(?![-=])([\s\S]+?)==/g;

/** Synthetic archive id used when the caller didn't supply one. */
const DEFAULT_ARCHIVE_ID = 'plugin:local';

/**
 * Bridge adapter: the local `TextHighlight` uses a stricter `color:
 * HighlightColor` union, the highlight-core interface uses `color?: string`.
 * Structurally compatible — we cast at the boundary so we don't leak the
 * core's optional extensions (`schemaVersion`, `coordinateVersion`, ...)
 * into the plugin's surface.
 */
function toCoreHighlight(h: TextHighlight): CoreTextHighlight {
  return h as unknown as CoreTextHighlight;
}

/**
 * Subset of {@link import('./WorkersAPIClient').UserArchive} that the
 * reconcile pipeline reads. Declaring a structural shape here keeps
 * this service decoupled from the API client types (and from Obsidian).
 */
export interface HighlightReconcileArchive {
  id: string;
  userHighlights?: TextHighlight[];
}

// ─── Marker ──────────────────────────────────────────────

export class HighlightBodyMarker {
  /**
   * Reconcile the body of a markdown document so that `==text==` inline
   * highlight marks match the caller-supplied highlights.
   *
   * Accepts EITHER:
   *   - `TextHighlight[]` (legacy shape; used by callers that don't have
   *     an archive envelope, e.g. unit tests)
   *   - `HighlightReconcileArchive` (Phase 3 shape; enables dual-read to
   *     see `coordinateVersion` / `schemaVersion` on the envelope)
   *
   * Algorithm:
   *   1. Split document into [frontmatter, body, annotations-block].
   *   2. Run `loadHighlightsForRender` against the body (fullText surrogate)
   *      so each highlight is classified via the 4-state runtime model.
   *   3. Strip body marks whose inner text does not appear in the rendered
   *      highlight set.
   *   4. For each RESOLVED rendered highlight, ensure its text is wrapped
   *      exactly once. `unresolved-migration` rows are skipped (record
   *      preserved for later retry).
   *   5. Re-assemble.
   *
   * Returns the same string (reference identity preserved) when no changes
   * were needed, to make caller-side change detection cheap.
   *
   * PRD §5.5: plugin MUST NOT write back. `writeBackCandidates` is discarded.
   */
  reconcile(
    content: string,
    highlightsOrArchive: TextHighlight[] | HighlightReconcileArchive
  ): string {
    const archive = this.normalizeInput(highlightsOrArchive);
    const targetHighlights = archive.userHighlights ?? [];

    const fmEnd = this.findFrontmatterEnd(content);
    const frontmatter = content.slice(0, fmEnd);
    const afterFm = content.slice(fmEnd);

    const annotationsStart = afterFm.indexOf(ANNOTATIONS_START_MARKER);
    const bodyPortion = annotationsStart >= 0 ? afterFm.slice(0, annotationsStart) : afterFm;
    const annotationsPortion = annotationsStart >= 0 ? afterFm.slice(annotationsStart) : '';

    // Build the target-text set so that `==mark==` wrappings whose inner
    // text still matches a user-authored highlight text are preserved.
    const targetTextSet = new Set(targetHighlights.map((h) => h.text));

    // Strip foreign marks first so that dual-read runs against the
    // reconciled body. `rangeStart`/`rangeEnd` returned by dual-read must
    // therefore be valid indices into `strippedBody` (not the raw body).
    const strippedBody = this.stripUnmatchedMarks(bodyPortion, targetTextSet);

    // Phase 3 (PRD §5.4): run dual-read against the stripped body (fullText
    // surrogate) so we can classify each stored highlight (canonical-trusted /
    // soft-canonical / wrong-canonical-v2 / legacy-visible-v0) and only paint
    // rows whose coordinates we've recovered to a renderable state.
    const dualReadInput: DualReadArchiveInput = {
      id: archive.id,
      highlights: targetHighlights.map(toCoreHighlight),
    };
    const { rendered } = loadHighlightsForRender({
      archive: dualReadInput,
      fullText: strippedBody,
    });

    // Log wrong-canonical-v2 cases for field diagnostics (PRD §5.12 — highest-
    // priority bucket for the migration cost analysis). No telemetry backend is
    // wired yet; this is `console.debug` so it stays out of production logs.
    for (const h of rendered) {
      if (h.coordinateState === 'wrong-canonical-v2') {
        // eslint-disable-next-line no-console
        console.debug(
          '[HighlightBodyMarker] wrong-canonical-v2 detected',
          JSON.stringify({
            archiveId: archive.id,
            highlightId: h.id,
            renderState: h.renderState,
            resolveStatus: h.resolve?.status,
            resolveTier: h.resolve?.tier,
            resolveShift: h.resolve?.shift,
            resolveConfidence: h.resolve?.confidence,
            resolveCandidates: h.resolve?.candidateCount,
          })
        );
      }
    }

    // Apply marks using the RESOLVED coordinates from dual-read. We iterate
    // rendered entries; each `applyResolvedMark` re-translates offsets to
    // the mutating workingBody by shifting past earlier-inserted `==` pairs.
    let workingBody = strippedBody;
    for (const h of rendered) {
      if (h.renderState !== 'resolved') continue;
      workingBody = this.applyResolvedMark(workingBody, h, strippedBody);
    }

    if (workingBody === bodyPortion) {
      return content;
    }
    return frontmatter + workingBody + annotationsPortion;
  }

  // ─── Internals ─────────────────────────────────────────

  /**
   * Coerce either a highlights array or an archive envelope into the archive
   * envelope the dual-read loop expects. When the caller passes only an
   * array, we synthesize an `id` so the `DualReadArchiveInput` contract is
   * satisfied for write-back telemetry (which this plugin doesn't use).
   */
  private normalizeInput(
    input: TextHighlight[] | HighlightReconcileArchive
  ): HighlightReconcileArchive {
    if (Array.isArray(input)) {
      return { id: DEFAULT_ARCHIVE_ID, userHighlights: input };
    }
    return input;
  }

  /**
   * Remove `==inner==` wrappings whose inner text is not present in the
   * target set. Unwraps in-place (keeps the inner text, drops the `==`).
   */
  private stripUnmatchedMarks(body: string, targetTexts: Set<string>): string {
    return body.replace(HIGHLIGHT_MARK_REGEX, (match, inner: string) => {
      return targetTexts.has(inner) ? match : inner;
    });
  }

  /**
   * Ensure `highlight.text` is wrapped with `==...==` in the mutating
   * `workingBody`, using the resolved offsets (computed against
   * `strippedBody`) from the dual-read pipeline.
   *
   * Because each prior insertion adds `====` (4 chars) to the body to the
   * LEFT of any later mark, we can't use `rangeStart` directly against
   * `workingBody` once earlier marks have been applied. Instead we:
   *   1. Short-circuit if the exact `==text==` already exists.
   *   2. Verify the resolved slice in `strippedBody` equals `text` (sanity).
   *   3. Locate the same occurrence in `workingBody` by counting `text`
   *      occurrences up to `rangeStart` in `strippedBody` and picking the
   *      same occurrence in `workingBody` (skipping any that are already
   *      `==wrapped==`).
   *
   * Gating (carried forward from Phase 2):
   *   - `resolve.candidateCount > 1` → skip (ambiguous, risk of wrong span)
   *   - Resolved slice must equal `highlight.text` (sanity)
   *   - `resolve.shift > 0` → log as degraded mapping, still wrap
   */
  private applyResolvedMark(
    workingBody: string,
    rendered: RenderedHighlight,
    strippedBody: string
  ): string {
    if (rendered.text.length === 0) return workingBody;

    // Push edge whitespace outside the `==` delimiters so Obsidian still
    // parses the span as a highlight (its mark rule rejects `== text ==`).
    const leftPadMatch = rendered.text.match(/^\s+/);
    const rightPadMatch = rendered.text.match(/\s+$/);
    const trimmedText = rendered.text.slice(
      leftPadMatch?.[0].length ?? 0,
      rendered.text.length - (rightPadMatch?.[0].length ?? 0)
    );
    if (trimmedText.length === 0) return workingBody;
    const leftPad = leftPadMatch?.[0] ?? '';
    const rightPad = rightPadMatch?.[0] ?? '';

    const wrapped = `${leftPad}==${trimmedText}==${rightPad}`;
    if (workingBody.includes(wrapped)) return workingBody;

    const rangeStart = rendered.rangeStart;
    const rangeEnd = rendered.rangeEnd;
    if (rangeStart === undefined || rangeEnd === undefined) return workingBody;

    // `canonical-trusted` hits don't carry a `resolve` payload (dual-read
    // skips the resolver for already-self-consistent rows), so we only apply
    // the candidate-count / shift guards when a resolver result is present.
    const resolve = rendered.resolve;
    if (resolve) {
      if (resolve.candidateCount > 1) return workingBody;
    }

    // Sanity: the resolved slice must equal highlight.text in the stripped
    // body. If it doesn't, the anchor walked into an overlapping match —
    // refuse to wrap.
    const sliced = strippedBody.slice(rangeStart, rangeEnd);
    if (sliced !== rendered.text) return workingBody;

    // Translate the rangeStart (strippedBody coords) into a position inside
    // `workingBody` by picking the Nth occurrence of `rendered.text` where
    // N = count of prior occurrences in strippedBody up to `rangeStart`.
    const occurrenceIdx = this.countOccurrencesBefore(strippedBody, rendered.text, rangeStart);
    const targetStart = this.findNthOccurrenceSkippingWrapped(
      workingBody,
      rendered.text,
      occurrenceIdx
    );
    if (targetStart < 0) return workingBody;
    const targetEnd = targetStart + rendered.text.length;

    if (resolve && resolve.shift > 0) {
      // Degraded mapping — surface in console for field diagnostics; keep
      // mark in place since the resolver believes the span is correct.
      // eslint-disable-next-line no-console
      console.debug(
        '[HighlightBodyMarker] drift detected',
        JSON.stringify({
          id: rendered.id,
          status: resolve.status,
          tier: resolve.tier,
          shift: resolve.shift,
          confidence: resolve.confidence,
          coordinateState: rendered.coordinateState,
        })
      );
    }

    return workingBody.slice(0, targetStart) + wrapped + workingBody.slice(targetEnd);
  }

  /**
   * Count non-overlapping occurrences of `needle` in `haystack` that start
   * strictly before `beforeIdx`. Used to pick the correct occurrence in a
   * mutating working body.
   */
  private countOccurrencesBefore(haystack: string, needle: string, beforeIdx: number): number {
    if (!needle) return 0;
    let count = 0;
    let from = 0;
    while (from <= haystack.length) {
      const at = haystack.indexOf(needle, from);
      if (at < 0 || at >= beforeIdx) break;
      count += 1;
      from = at + needle.length;
    }
    return count;
  }

  /**
   * Find the Nth (0-indexed) occurrence of `needle` in `haystack`, treating
   * `==needle==` wrappings as having already consumed that occurrence (we
   * skip them, because they represent a previously-applied mark for a
   * different, already-wrapped highlight).
   */
  private findNthOccurrenceSkippingWrapped(
    haystack: string,
    needle: string,
    n: number
  ): number {
    if (!needle) return -1;
    let from = 0;
    let remaining = n;
    while (from <= haystack.length) {
      const at = haystack.indexOf(needle, from);
      if (at < 0) return -1;
      const isWrapped =
        at >= 2 &&
        haystack.charCodeAt(at - 1) === 61 /* = */ &&
        haystack.charCodeAt(at - 2) === 61 /* = */ &&
        haystack.charCodeAt(at + needle.length) === 61 &&
        haystack.charCodeAt(at + needle.length + 1) === 61;
      if (isWrapped) {
        from = at + needle.length + 2;
        continue;
      }
      if (remaining === 0) return at;
      remaining -= 1;
      from = at + needle.length;
    }
    return -1;
  }

  /**
   * Find the byte offset right after the closing `---` fence of YAML
   * frontmatter. Returns 0 if no frontmatter is present.
   */
  private findFrontmatterEnd(content: string): number {
    if (!content.startsWith('---')) return 0;
    const secondDash = content.indexOf('\n---', 3);
    if (secondDash < 0) return 0;
    const afterDash = secondDash + 4;
    return afterDash < content.length ? afterDash : content.length;
  }
}
