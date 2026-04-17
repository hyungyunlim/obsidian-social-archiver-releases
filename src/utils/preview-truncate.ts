/**
 * Canonical preview truncation helper.
 *
 * Implements the policy defined in
 * `.taskmaster/docs/prd-preview-truncate-policy.md` (sections 4–6).
 *
 * Parity contract: mobile-app / share-web / obsidian-plugin share the same
 * input/output semantics. Any change here must be mirrored in the other two
 * surfaces along with the shared fixture file.
 *
 * Zero dependencies. Uses `Array.from()` based code-point slicing to avoid
 * cutting surrogate pairs.
 */

export type TruncateBoundary =
  | 'none'
  | 'block'
  | 'sentence'
  | 'word'
  | 'cjk-punct'
  | 'hard';

export interface TruncatePreviewInput {
  /** Canonical preview source string after caller-side preprocessing. */
  markdown: string;
  /** Final preview budget, including ellipsis if one is appended. */
  maxChars: number;
  /** Trailing ellipsis glyph. Default `'…'`. Pass `''` to disable. */
  ellipsis?: string;
}

export interface TruncatePreviewResult {
  /** Truncated body without ellipsis. */
  content: string;
  /** Final preview string, including ellipsis when applicable. */
  preview: string;
  /** Whether truncation occurred. */
  truncated: boolean;
  /** Boundary actually selected. */
  boundary: TruncateBoundary;
}

const SENTENCE_TERMINATOR_RE = /[.!?。！？…]$/u;
const TRAILING_WS_RE = /[\s\u3000]+$/u;
const CJK_PUNCT_CHARS = '、。！，？：；…';

function normalizeNewlines(input: string): string {
  return input.replace(/\r\n?/g, '\n');
}

function codePointLength(str: string): number {
  return Array.from(str).length;
}

/**
 * Return the highest safe string index (inclusive end) within `slice` that
 * does not end inside an unclosed markdown link or image token.
 *
 * Rules:
 *  - `[label](url` without closing `)` → retract to before `[` (or `![`).
 *  - `[label` without closing `]` → retract to before `[` (or `![`).
 */
function findSafeMarkdownLimit(slice: string): number {
  // Walk forward, tracking the most recent unclosed '[' token start.
  // Track state in link: inLink (after '['), inUrl (after '](').
  let i = 0;
  let unclosedTokenStart = -1; // index of '[' or '!' preceding '['
  let inLink = false;
  let inUrl = false;

  while (i < slice.length) {
    const ch = slice.charAt(i);
    const prev = i > 0 ? slice.charAt(i - 1) : '';

    if (!inLink && !inUrl) {
      if (ch === '[') {
        unclosedTokenStart = prev === '!' ? i - 1 : i;
        inLink = true;
      }
    } else if (inLink && !inUrl) {
      if (ch === ']') {
        // Peek next char for '(' → enter URL phase.
        if (i + 1 < slice.length && slice.charAt(i + 1) === '(') {
          inLink = false;
          inUrl = true;
          i += 1; // consume '('
        } else {
          // Closed link without URL part. Safe.
          inLink = false;
          unclosedTokenStart = -1;
        }
      } else if (ch === '\n') {
        // Links should not span paragraph breaks; treat as unclosed.
        // We continue but keep unclosedTokenStart set.
      }
    } else if (inUrl) {
      if (ch === ')') {
        inUrl = false;
        unclosedTokenStart = -1;
      }
    }
    i += 1;
  }

  if (unclosedTokenStart >= 0) {
    return unclosedTokenStart;
  }
  return slice.length;
}

function findLastBlockBoundary(slice: string, minIndex: number): number {
  const idx = slice.lastIndexOf('\n\n');
  if (idx < 0) return -1;
  if (idx < minIndex) return -1;
  return idx;
}

function findLastSentenceBoundary(slice: string, minIndex: number): number {
  // We want the position just after a terminator `[.!?。！？]` when followed by
  // whitespace or end of string. The cut index is that "just after" position.
  const terminators = new Set(['.', '!', '?', '。', '！', '？']);
  let best = -1;
  for (let i = 0; i < slice.length; i += 1) {
    const ch = slice.charAt(i);
    if (!terminators.has(ch)) continue;
    const next = i + 1 < slice.length ? slice.charAt(i + 1) : '';
    const atEnd = i + 1 >= slice.length;
    if (atEnd || /\s/.test(next)) {
      const cutIndex = i + 1; // include the terminator
      if (cutIndex >= minIndex && cutIndex > best) {
        best = cutIndex;
      }
    }
  }
  return best;
}

function findLastWordBoundary(slice: string, minIndex: number): number {
  // Last position of a unicode whitespace; the cut index is that position
  // (whitespace itself is excluded — trailing whitespace is trimmed anyway).
  let best = -1;
  for (let i = slice.length - 1; i >= 0; i -= 1) {
    const ch = slice.charAt(i);
    if (/\s/.test(ch)) {
      if (i >= minIndex && i > best) {
        best = i;
      }
      break;
    }
  }
  return best;
}

function findLastCjkPunctBoundary(slice: string, minIndex: number): number {
  let best = -1;
  for (let i = slice.length - 1; i >= 0; i -= 1) {
    const ch = slice.charAt(i);
    if (CJK_PUNCT_CHARS.includes(ch)) {
      const cutIndex = i + 1; // include the punctuation
      if (cutIndex >= minIndex && cutIndex > best) {
        best = cutIndex;
      }
      break;
    }
  }
  return best;
}

function finalize(
  content: string,
  boundary: TruncateBoundary,
  ellipsis: string,
  maxChars: number,
): TruncatePreviewResult {
  const trimmed = content.replace(TRAILING_WS_RE, '');
  const needsEllipsis =
    ellipsis.length > 0 && !SENTENCE_TERMINATOR_RE.test(trimmed);
  let preview = needsEllipsis ? trimmed + ellipsis : trimmed;

  // Invariant enforcement: if, for any reason, preview exceeds budget
  // (e.g. pathological ellipsis), trim from the content side until it fits.
  if (codePointLength(preview) > maxChars) {
    const ellipsisUnits = Array.from(ellipsis);
    const contentUnits = Array.from(trimmed);
    // Re-assemble within budget.
    const available = Math.max(0, maxChars - ellipsisUnits.length);
    const rebuilt = contentUnits.slice(0, available).join('');
    const retrimmed = rebuilt.replace(TRAILING_WS_RE, '');
    const needsEll = ellipsis.length > 0 && !SENTENCE_TERMINATOR_RE.test(retrimmed);
    preview = needsEll ? retrimmed + ellipsis : retrimmed;
    if (codePointLength(preview) > maxChars) {
      throw new Error(
        'truncatePreview invariant violated: preview exceeded maxChars',
      );
    }
    return { content: retrimmed, preview, truncated: true, boundary };
  }

  return { content: trimmed, preview, truncated: true, boundary };
}

/**
 * Produce a preview string bounded by `maxChars` (including any trailing
 * ellipsis). See the PRD referenced at the top of this file for the full
 * policy and boundary selection rules.
 */
export function truncatePreview(
  input: TruncatePreviewInput,
): TruncatePreviewResult {
  const { markdown, maxChars } = input;
  const ellipsis = input.ellipsis ?? '…';

  if (!Number.isFinite(maxChars) || maxChars <= 0) {
    return {
      content: '',
      preview: '',
      truncated: true,
      boundary: 'hard',
    };
  }

  const normalized = normalizeNewlines(markdown ?? '');
  const units = Array.from(normalized);

  if (units.length <= maxChars) {
    return {
      content: normalized,
      preview: normalized,
      truncated: false,
      boundary: 'none',
    };
  }

  const ellipsisUnits = ellipsis ? Array.from(ellipsis).length : 0;
  const contentBudget = Math.max(1, maxChars - ellipsisUnits);
  const slice = units.slice(0, contentBudget).join('');

  const safeLimit = findSafeMarkdownLimit(slice);
  const safeSlice = slice.slice(0, safeLimit);

  const blockCut = findLastBlockBoundary(
    safeSlice,
    Math.floor(contentBudget * 0.85),
  );
  if (blockCut !== -1) {
    return finalize(safeSlice.slice(0, blockCut), 'block', ellipsis, maxChars);
  }

  const sentenceCut = findLastSentenceBoundary(
    safeSlice,
    Math.floor(contentBudget * 0.7),
  );
  if (sentenceCut !== -1) {
    return finalize(
      safeSlice.slice(0, sentenceCut),
      'sentence',
      ellipsis,
      maxChars,
    );
  }

  const wordCut = findLastWordBoundary(
    safeSlice,
    Math.floor(contentBudget * 0.55),
  );
  if (wordCut !== -1) {
    return finalize(safeSlice.slice(0, wordCut), 'word', ellipsis, maxChars);
  }

  const cjkCut = findLastCjkPunctBoundary(
    safeSlice,
    Math.floor(contentBudget * 0.55),
  );
  if (cjkCut !== -1) {
    return finalize(
      safeSlice.slice(0, cjkCut),
      'cjk-punct',
      ellipsis,
      maxChars,
    );
  }

  return finalize(safeSlice, 'hard', ellipsis, maxChars);
}
