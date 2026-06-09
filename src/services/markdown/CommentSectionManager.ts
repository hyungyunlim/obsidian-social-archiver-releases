/**
 * CommentSectionManager
 *
 * Single Responsibility: locate, replace, and remove the managed
 * `## 💬 Comments` section in an Obsidian archive note's markdown body.
 *
 * Modeled on {@link TranscriptSectionManager}. The comments section is mid-file
 * and UNMARKED — materially harder than the AI/transcript precedents — so the
 * boundary detection is the load-bearing part of this module.
 *
 * Boundary rules (PRD R10 — hardened 2026-06 after a vault-corruption bug):
 *   - The section STARTS at the `## 💬 Comments` heading (emoji form only — the
 *     plain `## Comments` heading is never produced by `MarkdownConverter`).
 *   - The section ENDS at the FIRST of:
 *       1. the next KNOWN MANAGED H2 heading (an allowlist derived from every
 *          H2 the converter / section-appending services can emit AFTER the
 *          comments section — see {@link MANAGED_HEADING_BOUNDARY_REGEX}), or
 *       2. the metadata footer (a `---` rule followed by the first
 *          `**Platform:** / **Original URL:** / **Author:** / **Published:**`
 *          field of the note footer), or
 *       3. end-of-file.
 *   - It NEVER splits on a bare `## …` heading that is NOT in the allowlist.
 *     A *real* multi-line comment whose text contains a line such as `## foo`
 *     previously matched the old generic `\n## ` boundary FIRST, truncating the
 *     section at the fake heading; on replace/remove the stale tail (including
 *     supposedly-deleted comments and inner `---` rules) was re-appended below
 *     the freshly written section — deleted content survived AND was
 *     duplicated. Bounding on the allowlist instead of bare `## ` makes a
 *     user-authored `## foo` line harmless.
 *   - It NEVER splits on bare `---`: the comment body itself contains
 *     `\n\n---\n\n` separators between top-level comments
 *     (`CommentFormatter.ts`), so `---`-splitting would corrupt the section.
 *
 * The plugin is read-only for comment mutations (PRD Non-Goal #4). This module
 * only rewrites the body to mirror server-authoritative comment state; it never
 * parses the markdown back into an upload.
 */

// ─── Constants ──────────────────────────────────────────

/** The managed comments heading — only the emoji form is ever produced. */
const COMMENTS_HEADING = '## 💬 Comments';

/**
 * Metadata footer regex (mirrors `TranscriptSectionManager`): a `---` rule
 * followed by the first `**Platform:**` / `**Original URL:**` / `**Author:**` /
 * `**Published:**` field of the note footer. This is matched against the slice
 * AFTER the comments heading.
 */
const METADATA_FOOTER_REGEX =
  /\n---\s*\n+\*\*(?:Platform|Original URL|Author|Published):\*\*/m;

/**
 * Allowlist of the EXACT managed H2 headings that can legitimately appear AFTER
 * the `## 💬 Comments` section, used to bound the section END. Only a `\n## …`
 * line matching one of these (the rest of the line ignored — e.g. transcript
 * language suffixes like `## Transcript (Korean)`) is treated as a boundary.
 *
 * Derived by enumerating every H2 the generator / appenders can emit downstream
 * of the comments section:
 *   - `## 🤖 AI Analysis` / `## AI Analysis` — inline AI section, emitted
 *     directly after `{{comments}}` in every `DEFAULT_TEMPLATES` entry
 *     (`MarkdownConverter.ts` lines 68-85 etc., plus the emoji-less form in the
 *     blog/article/podcast templates ~lines 773/834/…).
 *   - `## 🤖 AI Comments` / `## AI Comments` — appended at EOF by the AI-comment
 *     pipeline (`services/ai-comment/markdown-handler.ts` AI_COMMENT_SECTION_TITLE).
 *   - `## 📄 Transcript` / `## Transcript` (incl. language suffixes) — YouTube
 *     template + the standalone transcript append (`MarkdownConverter.ts:1537`,
 *     `main.ts`/`TranscriptionJobProcessor.ts` sentinel-wrapped) +
 *     `constants/languages.ts` `## Transcript (Language)` variants.
 *   - `## Mobile Annotations` — `AnnotationRenderer.ts:186` (marker-wrapped).
 *   - `## Linked archives` — `LinkedArchivesRenderer.ts:26` (marker-wrapped).
 * The footer regex already bounds the section before any EOF-appended block, so
 * those entries are belt-and-suspenders for footer-less / legacy notes.
 *
 * NOTE: this list is the source of truth referenced by the regression tests. If
 * `MarkdownConverter` (or a section-appending service) introduces a new H2 that
 * can follow the comments section, add it here.
 */
const KNOWN_MANAGED_HEADINGS: readonly string[] = [
  '🤖 AI Analysis',
  'AI Analysis',
  '🤖 AI Comments',
  'AI Comments',
  '📄 Transcript',
  'Transcript',
  'Mobile Annotations',
  'Linked archives',
];

/**
 * Boundary regex matching a newline + `## ` + one of {@link KNOWN_MANAGED_HEADINGS}
 * at a line start. The heading text must be followed by end-of-line, whitespace,
 * or `(` (transcript language suffix) so `## AI Analysis` does not also match a
 * hypothetical `## AI Analysis Extended` user line.
 *
 * Built once at module load. A `## foo` user comment line is NOT in the list, so
 * it can never be mistaken for a section boundary.
 */
const MANAGED_HEADING_BOUNDARY_REGEX = (() => {
  const escaped = KNOWN_MANAGED_HEADINGS.map((h) =>
    h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  return new RegExp(`\\n##\\s+(?:${escaped.join('|')})(?=\\s|\\(|$)`, 'm');
})();

// ─── Types ──────────────────────────────────────────────

export interface CommentSection {
  /** Start index in the markdown (first char of `## 💬 Comments`). */
  start: number;
  /**
   * Index of the leading separator the heading was attached to, if any. The
   * comments section is emitted with a preceding `\n\n---\n\n` separator
   * (`MarkdownConverter` template). When removing the whole section we trim that
   * separator too so we don't leave a dangling `---`.
   */
  separatorStart: number;
  /** End index (exclusive — first char of the next section / footer / EOF). */
  end: number;
  /**
   * How the END boundary was determined:
   *   - `'managed-heading'`: matched an allowlisted managed H2 heading.
   *   - `'footer'`: matched the metadata footer.
   *   - `'eof'`: no managed heading or footer found — the section runs to EOF.
   *
   * Callers that must AVOID rewriting an ambiguously-bounded note (PRD R10
   * abort guard, {@link CommentStateSyncService}) inspect this: an `'eof'`
   * boundary with non-trivial trailing content is the only case that could be a
   * mis-detection, so an extra `endIsConfident` flag distills the abort signal.
   */
  endBoundary: 'managed-heading' | 'footer' | 'eof';
  /**
   * `true` when the END boundary can be trusted to isolate the section:
   *   - any `'managed-heading'` / `'footer'` boundary, OR
   *   - an `'eof'` boundary where the comments heading is genuinely the last
   *     block (no later `## ` heading lurks past the detected end that we failed
   *     to recognise — which would mean an unknown/foreign managed heading or a
   *     malformed note we must not blindly rewrite).
   */
  endIsConfident: boolean;
}

// ─── Public API ─────────────────────────────────────────

/**
 * Locate the managed comments section, or `null` when there is no
 * `## 💬 Comments` heading in the markdown.
 *
 * Returns indices only; callers slice/splice the markdown themselves.
 */
export function findCommentsSection(markdown: string): CommentSection | null {
  const headingIdx = markdown.indexOf(COMMENTS_HEADING);
  if (headingIdx === -1) return null;

  const afterStart = headingIdx + COMMENTS_HEADING.length;
  const afterHeading = markdown.substring(afterStart);

  // Bound the END on the FIRST of: allowlisted managed heading, metadata footer,
  // EOF. We DELIBERATELY do not match a bare `\n## ` — a user comment line such
  // as `## foo` must not be treated as a boundary (the bug this module hardens
  // against). See MANAGED_HEADING_BOUNDARY_REGEX.
  const managedMatch = afterHeading.match(MANAGED_HEADING_BOUNDARY_REGEX);
  const footerMatch = afterHeading.match(METADATA_FOOTER_REGEX);

  const managedEnd =
    managedMatch && managedMatch.index !== undefined
      ? afterStart + managedMatch.index
      : Number.POSITIVE_INFINITY;
  const footerEnd =
    footerMatch && footerMatch.index !== undefined
      ? afterStart + footerMatch.index
      : Number.POSITIVE_INFINITY;

  let end: number;
  let endBoundary: CommentSection['endBoundary'];
  if (managedEnd === Number.POSITIVE_INFINITY && footerEnd === Number.POSITIVE_INFINITY) {
    end = markdown.length;
    endBoundary = 'eof';
  } else if (managedEnd <= footerEnd) {
    end = managedEnd;
    endBoundary = 'managed-heading';
  } else {
    end = footerEnd;
    endBoundary = 'footer';
  }

  // Confidence: a heading/footer boundary is always trustworthy. An EOF boundary
  // is only trustworthy when the comments heading is genuinely the last block —
  // i.e. there is no UNRECOGNISED `## ` heading after the detected end. If one
  // exists, the note either carries a foreign/unknown managed section or is
  // malformed, and the abort guard must NOT rewrite the body.
  const endIsConfident =
    endBoundary !== 'eof' || !containsUnrecognisedH2(markdown, afterStart);

  // Detect a leading `---` separator block directly above the heading so a full
  // removal can strip it too. We only walk back over whitespace + a single `---`
  // rule — never further (to avoid eating real body content).
  const separatorStart = findLeadingSeparatorStart(markdown, headingIdx);

  return { start: headingIdx, separatorStart, end, endBoundary, endIsConfident };
}

/**
 * Returns `true` when the markdown contains any `\n## ` heading at/after
 * `fromIdx` that is NOT in the managed allowlist AND is NOT the comments heading
 * itself — a signal that an EOF-bounded section may be mis-detected and the body
 * should not be blindly rewritten. Bare `---` rules and allowlisted headings are
 * ignored.
 */
function containsUnrecognisedH2(markdown: string, fromIdx: number): boolean {
  const tail = markdown.substring(fromIdx);
  const h2Re = /\n##\s+([^\n]*)/g;
  let m: RegExpExecArray | null;
  while ((m = h2Re.exec(tail)) !== null) {
    const headingText = (m[1] ?? '').trim();
    if (headingText.startsWith('💬 Comments')) continue;
    const isManaged = KNOWN_MANAGED_HEADINGS.some(
      (h) => headingText === h || headingText.startsWith(`${h} (`),
    );
    if (!isManaged) return true;
  }
  return false;
}

/**
 * Replace the body of the managed comments section with `formattedBody`
 * (already built via `CommentFormatter.formatComments`).
 *
 * - If the section exists, its body is swapped in place; the heading, the
 *   preceding separator, and everything after the section boundary are
 *   preserved verbatim.
 * - If the section does NOT exist and `formattedBody` is non-empty, the section
 *   is INSERTED before the metadata footer (or before the next trailing H2, or
 *   appended) so a note that lost its comments can regain them. When neither a
 *   footer nor anchor exists it is appended at EOF.
 * - If `formattedBody` is empty/whitespace, this delegates to
 *   {@link removeCommentsSection} (an empty tree removes the section, PRD R10
 *   step 5 / R12 empty-state).
 *
 * Returns the updated markdown. Returns the input UNCHANGED when there is no
 * managed section to replace AND nothing to insert.
 */
export function replaceCommentsSection(markdown: string, formattedBody: string): string {
  const body = formattedBody.trim();

  if (body.length === 0) {
    return removeCommentsSection(markdown);
  }

  const section = findCommentsSection(markdown);

  if (section) {
    // Rebuild: keep the heading, swap the body, keep the boundary suffix.
    const before = markdown.slice(0, section.start);
    const after = markdown.slice(section.end);
    const rebuiltSection = `${COMMENTS_HEADING}\n\n${body}\n`;
    return before + rebuiltSection + after;
  }

  // No existing section — insert one. Anchor before the metadata footer if
  // present, else before the first trailing H2, else append.
  const insertionBlock = `\n\n---\n\n${COMMENTS_HEADING}\n\n${body}\n`;

  const footerMatch = markdown.match(METADATA_FOOTER_REGEX);
  if (footerMatch && footerMatch.index !== undefined) {
    const insertPos = footerMatch.index;
    return markdown.slice(0, insertPos).trimEnd() + insertionBlock + markdown.slice(insertPos);
  }

  return markdown.trimEnd() + insertionBlock;
}

/**
 * Remove the managed comments section entirely (heading + body + the leading
 * `---` separator it was attached to). Everything after the section boundary
 * (footer, AI sections, etc.) is preserved.
 *
 * Returns the input UNCHANGED when there is no `## 💬 Comments` heading.
 */
export function removeCommentsSection(markdown: string): string {
  const section = findCommentsSection(markdown);
  if (!section) return markdown;

  const before = markdown.slice(0, section.separatorStart).replace(/\n+$/, '');
  const after = markdown.slice(section.end);

  // Re-join with a single blank line so we don't collapse the boundary into the
  // following content. `after` already begins with its own leading newlines
  // (the footer `\n---` or `\n##`), so just concatenate after trimming `before`.
  return before + after;
}

// ─── Internal helpers ───────────────────────────────────

/**
 * Walk backwards from the comments heading over (a) trailing whitespace and
 * (b) at most one `---` horizontal-rule line, returning the index where that
 * separator block begins. If there is no `---` directly above the heading, the
 * heading index itself is returned (nothing extra to strip).
 */
function findLeadingSeparatorStart(markdown: string, headingIdx: number): number {
  // Look at the text immediately before the heading.
  const prefix = markdown.slice(0, headingIdx);

  // Match an optional trailing `\n\n---\n\n` (with flexible whitespace) anchored
  // to the end of the prefix. Only a single `---` rule is consumed.
  const sepMatch = prefix.match(/\n+\s*---[ \t]*\n+\s*$/);
  if (sepMatch && sepMatch.index !== undefined) {
    return sepMatch.index;
  }

  return headingIdx;
}
