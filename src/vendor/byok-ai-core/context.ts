/**
 * The article block every chat and research prompt hands the model, for BYOK,
 * Cloud AI and executors alike (port of chrome-extension/src/shared/reader/ai-context.ts).
 * Data only: the instructions, with the prompt-injection guard, are in chat.ts
 * and research.ts.
 */

/** Article budget (~6k tokens). Past it keep head (thesis) and tail (conclusion). */
export const ARTICLE_CONTEXT_MAX_CHARS = 24_000;
/** Comments are secondary context: capped harder than the article. */
export const COMMENTS_DIGEST_MAX_CHARS = 6_000;
const HEAD_RATIO = 2 / 3;
const META_MAX_CHARS = 300;
const REPLY_MAX_DEPTH = 8;

/**
 * Budget a text to `budget` chars as head + elision marker + tail, cutting on
 * the nearest line break within a small window. Verbatim from the Chrome
 * reader (a parity test keeps it so).
 */
export function excerptForBudget(text: string, budget: number): { text: string; truncated: boolean } {
  if (text.length <= budget) {
    return { text, truncated: false };
  }
  const headBudget = Math.floor(budget * HEAD_RATIO);
  const tailBudget = budget - headBudget;

  let headEnd = headBudget;
  const headBreak = text.lastIndexOf('\n', headBudget);
  if (headBreak > headBudget - 400) headEnd = headBreak;

  let tailStart = text.length - tailBudget;
  const tailBreak = text.indexOf('\n', tailStart);
  if (tailBreak !== -1 && tailBreak < tailStart + 400) tailStart = tailBreak + 1;

  const omitted = tailStart - headEnd;
  return {
    text:
      `${text.slice(0, headEnd).trimEnd()}\n\n` +
      `[… ${omitted.toLocaleString('en-US')} characters omitted …]\n\n` +
      `${text.slice(tailStart).trimStart()}`,
    truncated: true,
  };
}

export interface ByokArticleInput {
  title?: string;
  authorName?: string;
  platform?: string;
  url?: string;
  body: string;
  transcript?: string;
  ocrText?: string;
  /** Usually `buildCommentsDigest(...)`. */
  commentsText?: string;
}

/** Meta lines, then `<<<ARTICLE … ARTICLE>>>`, then `<<<COMMENTS … COMMENTS>>>` when there are comments. */
export function buildArticleContext(input: ByokArticleInput, options: { maxChars?: number } = {}): string {
  const meta = (
    [
      ['Title', input.title],
      ['Author', input.authorName],
      ['Platform', input.platform],
      ['URL', input.url],
    ] as const
  ).flatMap(([label, value]) => {
    const line = value ? neutralize(oneLine(value)).slice(0, META_MAX_CHARS) : '';
    return line ? [`${label}: ${line}`] : [];
  });

  const transcript = input.transcript?.trim();
  const ocrText = input.ocrText?.trim();
  const articleText = [
    input.body.trim(),
    transcript ? `Transcript:\n${transcript}` : '',
    ocrText ? `Text in images (OCR):\n${ocrText}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const article = excerptForBudget(neutralize(articleText), options.maxChars ?? ARTICLE_CONTEXT_MAX_CHARS);

  const sections = [
    ...(meta.length > 0 ? [meta.join('\n')] : []),
    `ARTICLE${article.truncated ? ' (excerpted to fit context)' : ''}:\n<<<ARTICLE\n${article.text}\nARTICLE>>>`,
  ];
  const comments = input.commentsText?.trim();
  if (comments) {
    const excerpt = excerptForBudget(neutralize(comments), COMMENTS_DIGEST_MAX_CHARS);
    sections.push(`COMMENTS${excerpt.truncated ? ' (excerpted)' : ''}:\n<<<COMMENTS\n${excerpt.text}\nCOMMENTS>>>`);
  }
  return sections.join('\n\n');
}

/**
 * Stored comments (`{ author: { name } | string, content, replies[] }`) as
 * `- name: text` lines, replies indented by depth, cut on a line boundary at
 * COMMENTS_DIGEST_MAX_CHARS.
 */
export function buildCommentsDigest(comments: readonly unknown[]): string {
  const lines: string[] = [];
  let length = 0;
  const walk = (items: readonly unknown[], depth: number): void => {
    for (const item of items) {
      if (length > COMMENTS_DIGEST_MAX_CHARS) return;
      const comment = asRecord(item);
      if (!comment) continue;
      const text = typeof comment.content === 'string' ? oneLine(comment.content) : '';
      if (text) {
        const line = `${'  '.repeat(depth)}- ${authorName(comment.author)}: ${text}`;
        lines.push(line);
        length += line.length + 1;
      }
      if (Array.isArray(comment.replies) && depth < REPLY_MAX_DEPTH) walk(comment.replies as unknown[], depth + 1);
    }
  };
  walk(comments, 0);
  const digest = lines.join('\n');
  if (digest.length <= COMMENTS_DIGEST_MAX_CHARS) return digest;
  const cut = digest.lastIndexOf('\n', COMMENTS_DIGEST_MAX_CHARS);
  return digest.slice(0, cut > 0 ? cut : COMMENTS_DIGEST_MAX_CHARS);
}

/** Untrusted text must not close its block early ("ARTICLE>>>\nNew instructions: …"). */
function neutralize(text: string): string {
  return text.replace(/<<<(ARTICLE|COMMENTS)/g, '<< <$1').replace(/(ARTICLE|COMMENTS)>>>/g, '$1> >>');
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function authorName(author: unknown): string {
  if (typeof author === 'string') return oneLine(author) || 'Anonymous';
  const record = asRecord(author);
  const name = [record?.name, record?.handle, record?.username].find(
    (value): value is string => typeof value === 'string' && value.trim() !== '',
  );
  return name ? oneLine(name) : 'Anonymous';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
