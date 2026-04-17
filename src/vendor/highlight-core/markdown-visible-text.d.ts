/**
 * markdown-visible-text.ts — Build bidirectional visible↔full text mapping
 *
 * Pure TypeScript implementation. No DOM / RN / side effects.
 *
 * PRD reference: `.taskmaster/docs/prd-highlight-sync-unification.md` §4.4.
 *
 * Architecture (Phase 2 Stage 1.1 refactor)
 * -----------------------------------------
 * The canonical entry point is {@link alignVisibleTextToFullText}: it aligns
 * an externally-rendered `visibleText` (produced by the client's own markdown
 * renderer — marked, markdown-it, RN marked, etc.) against a canonical
 * `fullText` using a forward-only monotonic matching algorithm.  This is the
 * production path used by share-web, plugin, desktop, and mobile clients.
 *
 * The legacy helper {@link buildVisibleToFullTextMap} is kept for *reference*
 * and for the existing unit test suite — it composes:
 *   1. {@link computeFullText}            (title prefix + normalized body)
 *   2. {@link referenceRenderToVisible}   (strip syntax, apply profile knobs)
 *   3. {@link alignVisibleTextToFullText} (align the reference render to full)
 *
 * All three clients ultimately drive `alignVisibleTextToFullText`, so a single
 * alignment implementation covers both "we rendered this ourselves" and "the
 * DOM/RN renderer handed us this visible text".  No more "by construction"
 * drift: if the client renderer emits a character the aligner can't match,
 * that character is clamped to the nearest mapped fullText position and the
 * returned map records a `driftChars` count for telemetry.
 *
 * Supported inline constructs (reference renderer)
 * ------------------------------------------------
 *   - `` `code` `` — content emitted verbatim, backticks stripped.
 *   - `**strong**` / `*em*` / `__strong__` / `_em_` — delimiters stripped.
 *   - `[text](url)` — rendered as `text`.
 *   - `![alt](url)` — rendered as a single U+FFFC placeholder.
 *   - `<https://...>` autolinks — rendered as inner URL.
 *   - `\\x` escapes — emit the escaped char only.
 *   - Typographer (profile-gated): `---` → `—`, `--` → `–`, `...` → `…`,
 *                                   paired `"..."` / `'...'` → curly quotes.
 *   - GFM (profile-gated, Option A): strikethrough `~~x~~`, task-list
 *                                     `- [ ] item`, pipe tables.
 *
 * Block rendering contract
 * ------------------------
 * The reference renderer emits **`\n\n`** between consecutive blocks,
 * matching CommonMark / markdown-it's `<p></p>` boundary convention. HR
 * itself does not emit its own separator (the next block's separator
 * covers it) to avoid `\n\n\n\n` runs.
 *
 * When a source lacks the second `\n` (e.g. `# Title\nBody`), the aligner
 * absorbs the synthetic newline into `driftChars` and clamps its full-text
 * position to the last mapped offset — callers with `driftChars > 0`
 * should treat the mapping as degraded (telemetry + fallback UX), not as
 * a warning to ignore.  See `alignVisibleTextToFullText` + the unit tests
 * in `__tests__/markdown-visible-text.test.ts` for the contract.
 *
 * Invariants (asserted by tests):
 *   - visibleText.length === map.visibleToFull.length
 *   - fullText.length    === map.fullToVisible.length
 *   - visibleToFull[i]   ∈ [0, fullText.length)
 *   - fullToVisible[j]   ∈ [0, visibleText.length) ∪ {-1}
 *   - The forward map is monotonically non-decreasing.
 */
import type { VisibleFullTextMap } from './types';
import { RenderProfile } from './render-profile';
/** Object replacement character used to stand in for images/video blocks. */
export declare const MEDIA_PLACEHOLDER = "\uFFFC";
/** Separator inserted between title and body when title prefix is enabled. */
export declare const ARTICLE_TITLE_BODY_SEPARATOR = "\n\n";
/**
 * Compute canonical fullText = optional title prefix + normalized body.
 *
 * Separator semantics match the mobile implementation: exactly one
 * `ARTICLE_TITLE_BODY_SEPARATOR` between a non-empty title and a non-empty
 * body, nothing if either side is empty.
 */
export declare function computeFullText(params: {
    title?: string | null | undefined;
    body: string;
    includeTitlePrefix: boolean;
}): string;
/**
 * Extended map result returned by {@link alignVisibleTextToFullText}.  Adds a
 * telemetry counter for visible chars that could not be anchored onto a real
 * fullText position (renderer drift — e.g. the client inserted a char that
 * has no equivalent in the source markdown).  Those chars are clamped onto
 * the nearest previously-mapped fullText offset so the map stays dense, but
 * callers can surface a warning when `driftChars > 0`.
 */
export interface VisibleFullTextAlignment extends VisibleFullTextMap {
    /**
     * Count of visible chars clamped (non-zero ⇒ the client renderer inserted
     * content not present in `fullText`).  Useful for logging + write-back
     * gating.  Always `0` for the reference renderer driven internally.
     */
    driftChars: number;
}
/**
 * Align an externally-rendered `visibleText` to `fullText` using a forward-only
 * monotonic character-matching algorithm.
 *
 * This is the **canonical** API used in production.  Each client's markdown
 * renderer (share-web `marked`, plugin / desktop `markdown-it`, mobile RN
 * `marked`) is free to emit any visibleText it likes — the aligner reconciles
 * that text against the canonical `fullText` (title prefix + raw markdown)
 * without requiring the two to agree byte-for-byte.
 *
 * Algorithm:
 *   1. Walk `visibleText` left-to-right with cursor `vi`.
 *   2. For each visible char, advance the `fi` cursor in `fullText` forward
 *      until `fullText[fi]` matches the visible char (or an equivalent from
 *      {@link ALIGNMENT_EQUIVALENTS}).
 *   3. Record `visibleToFull[vi] = fi`; all skipped `fullText` positions stay
 *      at their `-1` sentinel in `fullToVisible`.
 *   4. If no match is found within `fullText`, **clamp** the visible char to
 *      the last mapped full position and increment `driftChars` (renderer
 *      inserted a char not present in source — e.g. synthetic `\u2028`).
 *
 * Complexity: O(|fullText| + |visibleText|) amortized.
 *
 * @param params.visibleText  Actual renderer output (markdown syntax stripped).
 * @param params.fullText     Canonical source (`computeFullText(...)` output).
 * @param params.profile      Render profile in effect (currently informational;
 *                            reserved for profile-specific tuning).
 */
export declare function alignVisibleTextToFullText(params: {
    visibleText: string;
    fullText: string;
    profile: RenderProfile;
}): VisibleFullTextAlignment;
/**
 * Reference markdown → visible-text renderer.  **Not canonical** — production
 * code paths hand {@link alignVisibleTextToFullText} their own renderer's
 * output.  Exists so {@link buildVisibleToFullTextMap} can offer a single-arg
 * convenience helper, and so tests can probe the renderer in isolation.
 *
 * Output shape:
 *   - Strips markdown syntax (delimiters, fences, bullets).
 *   - Replaces images with a single U+FFFC placeholder.
 *   - Emits exactly one `\n` between consecutive blocks (paragraphs, headings,
 *     list items, blockquotes).  This matches the "text content" shape that
 *     `markdown-it` produces when each block's visible output is joined with
 *     a single newline — and more importantly, each emitted `\n` has a real
 *     counterpart in the source fullText, so alignment never has to invent
 *     offsets.
 *   - Applies profile-driven typographer substitutions when enabled.
 *   - Honours GFM features for profiles that declare `gfm: true`: tables
 *     preserve pipes as spaces, strikethrough `~~x~~` strips delimiters,
 *     task-list `- [ ]` strips the checkbox syntax.
 *
 * @param fullText Canonical fullText (title prefix + body, already normalized).
 *                 Passing the unprefixed body is also safe — the renderer
 *                 treats `fullText` as a single markdown document.
 * @param profile  Render profile controlling typographer / gfm / breaks.
 */
export declare function referenceRenderToVisible(fullText: string, profile: RenderProfile): string;
/**
 * Build the bidirectional visible↔full text map for a markdown document.
 *
 * **Reference / fallback use only.**  Production code should render via the
 * client's own markdown engine and call {@link alignVisibleTextToFullText}
 * directly — that is the only way to detect real renderer drift.  This helper
 * is retained for:
 *   1. Existing unit tests that rely on the reference renderer output.
 *   2. Callers that need a quick visible-text extraction without plumbing a
 *      DOM renderer (e.g. CLI tools, non-interactive tests).
 *
 * Internally this function:
 *   1. Composes `fullText` via {@link computeFullText}.
 *   2. Renders a reference `visibleText` via {@link referenceRenderToVisible}.
 *   3. Aligns the two via {@link alignVisibleTextToFullText}.
 *
 * @param markdown Raw markdown body.  The function internally normalizes
 *                 (NFC / CRLF→LF / BOM strip) defensively.
 * @param title    Optional title prefix — honoured only when the selected
 *                 profile enables `includeTitlePrefix`.
 * @param profile  Render profile that controls typographer / title / breaks.
 */
export declare function buildVisibleToFullTextMap(markdown: string, title: string | null, profile: RenderProfile): VisibleFullTextMap;
/**
 * Convenience: visibleText only.  Avoids allocating the reverse map when the
 * caller does not need offset conversion.
 */
export declare function extractVisibleText(markdown: string, title: string | null, profile: RenderProfile): string;
//# sourceMappingURL=markdown-visible-text.d.ts.map