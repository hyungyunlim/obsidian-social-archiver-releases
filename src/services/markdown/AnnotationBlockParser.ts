/**
 * AnnotationBlockParser
 *
 * Single Responsibility: Parse the managed "Mobile Annotations" block back into
 * structured note/highlight data. This is the exact reverse of
 * `AnnotationRenderer.render` — it reads what the renderer writes, so the
 * timeline can display mobile notes that the content-text extractor drops
 * (the block is appended AFTER the `**Platform:**` footer).
 *
 * Pure utility — no Obsidian API, no network. Operates on the RAW file markdown
 * (the footer-stripping content extractors must NOT run first; the block lives
 * past the footer they cut at).
 *
 * Round-trip contract (mirrors AnnotationRenderer):
 *   - Block delimited by start/end HTML comment markers.
 *   - `### Notes (N)` / `### Highlights (N)` section headers.
 *   - Each note is a `> [!note]+ <timestamp>` callout; body lines are `> `-
 *     prefixed continuations.
 *   - `escapeCalloutContent` may prefix a body line that starts with `>` with a
 *     zero-width space (U+200B) and prefix a bare `---` rule with a backslash —
 *     both are reversed here.
 *   - Timestamps are LOCAL-formatted display strings (formatLocalTimestamp),
 *     not ISO — kept verbatim as display strings.
 */

const ANNOTATIONS_START_MARKER = '<!-- social-archiver:annotations:start -->';
const ANNOTATIONS_END_MARKER = '<!-- social-archiver:annotations:end -->';

/** A single parsed note from the annotation block. */
export interface ParsedAnnotationNote {
  /** Note body with callout prefixing/escaping reversed. */
  content: string;
  /** Local-formatted timestamp display string, or null when absent/blank. */
  createdAt: string | null;
}

/** Result of {@link parseAnnotationBlock}. */
export interface ParsedAnnotationBlock {
  notes: ParsedAnnotationNote[];
  highlightCount: number;
}

/**
 * Parse the managed annotation block out of a note's RAW markdown.
 *
 * Returns `null` when no annotation block is present (so callers can cheaply
 * skip the field). Returns an empty `notes` array with `highlightCount: 0`
 * only if the block exists but holds neither.
 */
export function parseAnnotationBlock(markdown: string): ParsedAnnotationBlock | null {
  if (!markdown) return null;

  const startIdx = markdown.indexOf(ANNOTATIONS_START_MARKER);
  if (startIdx === -1) return null;
  const endIdx = markdown.indexOf(ANNOTATIONS_END_MARKER, startIdx);
  // Tolerate a missing end marker (truncated file) by reading to EOF.
  const inner = endIdx === -1
    ? markdown.slice(startIdx + ANNOTATIONS_START_MARKER.length)
    : markdown.slice(startIdx + ANNOTATIONS_START_MARKER.length, endIdx);

  const highlightCount = parseSectionCount(inner, 'Highlights');
  const notes = parseNotesSection(inner);

  return { notes, highlightCount };
}

/**
 * Read the `(N)` count from a `### <label> (N)` section header. Returns 0 when
 * the section is absent or the count is unparsable.
 */
function parseSectionCount(inner: string, label: string): number {
  const re = new RegExp(String.raw`^###\s+${label}\s+\((\d+)\)\s*$`, 'm');
  const match = inner.match(re);
  if (!match || !match[1]) return 0;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Extract and parse the `### Notes (N)` section into note objects.
 *
 * The Notes section runs from its header until the next `### ` section header
 * (e.g. a later Highlights section) or the end of the block. Within it, each
 * `> [!note]+ <timestamp>` line opens a callout that owns every following
 * `> `-prefixed line until the next callout header / blank-gap boundary.
 */
function parseNotesSection(inner: string): ParsedAnnotationNote[] {
  const headerIdx = inner.search(/^###\s+Notes\s+\(\d+\)\s*$/m);
  if (headerIdx === -1) return [];

  // Slice from just after the Notes header line.
  const afterHeader = inner.slice(headerIdx);
  const newlineAfterHeader = afterHeader.indexOf('\n');
  let body = newlineAfterHeader === -1 ? '' : afterHeader.slice(newlineAfterHeader + 1);

  // Stop at the next `### ` section header (another section like Highlights).
  const nextSection = body.search(/^###\s+/m);
  if (nextSection !== -1) {
    body = body.slice(0, nextSection);
  }

  const lines = body.split('\n');
  const notes: ParsedAnnotationNote[] = [];

  let currentTimestamp: string | null = null;
  let currentBody: string[] = [];
  let inCallout = false;

  const flush = (): void => {
    if (!inCallout) return;
    notes.push({
      content: currentBody.join('\n').replace(/\s+$/u, ''),
      createdAt: currentTimestamp,
    });
    currentTimestamp = null;
    currentBody = [];
    inCallout = false;
  };

  for (const line of lines) {
    const calloutHeader = line.match(/^>\s*\[!note\]\+?\s*(.*)$/);
    if (calloutHeader) {
      // A new note callout — close the previous one first.
      flush();
      inCallout = true;
      const ts = (calloutHeader[1] ?? '').trim();
      currentTimestamp = ts.length > 0 ? ts : null;
      continue;
    }

    if (!inCallout) {
      // Blank lines / section padding between header and first callout.
      continue;
    }

    if (/^>\s?/.test(line)) {
      // Continuation line inside the current callout.
      currentBody.push(unescapeCalloutLine(line));
      continue;
    }

    if (line.trim().length === 0) {
      // A blank, non-quoted line terminates the callout (renderer separates
      // notes with an empty line outside the blockquote).
      flush();
      continue;
    }

    // Any other non-quoted content ends the callout defensively.
    flush();
  }

  flush();

  return notes;
}

/**
 * Reverse one callout body line written by `escapeCalloutContent`:
 *   - strip the leading `> ` (or `>`) blockquote prefix,
 *   - drop a single leading U+200B that escaped a user line starting with `>`,
 *   - unescape a backslash-escaped horizontal rule (`\---` → `---`).
 */
function unescapeCalloutLine(line: string): string {
  // Remove the blockquote prefix: `> ` or a bare `>`.
  let text = line.replace(/^>\s?/, '');

  // Reverse the leading zero-width space inserted before a user `>` line.
  if (text.startsWith('\u200B')) {
    text = text.slice(1);
  }

  // Reverse the escaped horizontal rule (renderer prefixes a bare `---` with
  // a backslash). Only a leading `\` immediately before a dash run.
  text = text.replace(/^\\(-{3,})$/, '$1');

  return text;
}
