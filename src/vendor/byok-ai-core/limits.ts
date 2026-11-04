/**
 * The single source for AI comment storage caps: workers' PATCH schema and
 * executor write paths, and every client that saves a comment, import these.
 * The caps must move together (a client allowed more than the server makes
 * every later full-array PATCH fail, and the note stops syncing).
 *
 * Chars are UTF-16 code units (`string.length`), as the server's schema counts them.
 */

export const AI_COMMENT_DEFAULT_MAX_CHARS = 20_000;
export const AI_COMMENT_MAX_CHARS = { chat: 40_000, research: 40_000 } as const;
export const AI_COMMENTS_MAX_COUNT = 20;
/**
 * UTF-8 bytes of `JSON.stringify(aiComments)`. A `user_archives` row dies above
 * D1's 2,000,000-byte limit, and Korean text is 3 bytes a char.
 */
export const AI_COMMENTS_MAX_TOTAL_BYTES = 600_000;
export const AI_COMMENT_TRUNCATED_NOTE = '\n\n*(Truncated to fit the storage limit.)*';

/** Below this many bytes left, a new comment counts as not fitting at all. */
const MIN_COMMENT_JSON_BYTES = 1_024;

export function aiCommentMaxChars(type: string | undefined): number {
  return type === 'chat' || type === 'research' ? AI_COMMENT_MAX_CHARS[type] : AI_COMMENT_DEFAULT_MAX_CHARS;
}

/** UTF-8 byte length without TextEncoder (not on every host). A lone surrogate counts as U+FFFD. */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && (value.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

export function aiCommentsTotalBytes(comments: readonly unknown[]): number {
  return utf8ByteLength(JSON.stringify(comments));
}

export interface AICommentBudget {
  /** Max `content.length`. */
  maxChars: number;
  /** Max UTF-8 bytes of `JSON.stringify(content)`. */
  maxJsonBytes: number;
}

/**
 * Room for one more comment of `type` next to `existing`, or null when there
 * is none (20 comments, or the byte total is spent): the client then asks the
 * user to delete some AI comments, never drops anything silently.
 * `metaJsonBytes` covers the new entry's JSON other than its content.
 */
export function aiCommentBudget(
  existing: readonly unknown[],
  type: string,
  metaJsonBytes = 512,
): AICommentBudget | null {
  if (existing.length >= AI_COMMENTS_MAX_COUNT) return null;
  const separator = existing.length > 0 ? 1 : 0;
  const maxJsonBytes = AI_COMMENTS_MAX_TOTAL_BYTES - aiCommentsTotalBytes(existing) - separator - metaJsonBytes;
  return maxJsonBytes < MIN_COMMENT_JSON_BYTES ? null : { maxChars: aiCommentMaxChars(type), maxJsonBytes };
}

/**
 * `text` as is when it fits, else its longest prefix that fits together with
 * the truncation note. Empty content when not even the note fits.
 */
export function fitTextToBudget(text: string, budget: AICommentBudget): { content: string; truncated: boolean } {
  if (fitsBudget(text, budget)) return { content: text, truncated: false };
  // Longest prefix length n whose clipped form fits; the clipped length only grows with n.
  let low = 0;
  let high = Math.min(text.length, budget.maxChars);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fitsBudget(clipped(text, mid), budget)) low = mid;
    else high = mid - 1;
  }
  const content = clipped(text, low);
  return { content: fitsBudget(content, budget) ? content : '', truncated: true };
}

/** Server write paths: the per-type char cap, truncated with the note. */
export function clipAICommentContent(type: string | undefined, content: string): string {
  return fitTextToBudget(content, { maxChars: aiCommentMaxChars(type), maxJsonBytes: Number.POSITIVE_INFINITY }).content;
}

/** Whether `text` fits as is (no truncation). */
export function fitsBudget(text: string, budget: AICommentBudget): boolean {
  if (text.length > budget.maxChars) return false;
  return budget.maxJsonBytes === Number.POSITIVE_INFINITY || utf8ByteLength(JSON.stringify(text)) <= budget.maxJsonBytes;
}

/** The first `length` code units, never splitting a surrogate pair, plus the note. */
function clipped(text: string, length: number): string {
  const code = text.charCodeAt(length - 1);
  const end = code >= 0xd800 && code <= 0xdbff ? length - 1 : length;
  return `${text.slice(0, end).trimEnd()}${AI_COMMENT_TRUNCATED_NOTE}`;
}
