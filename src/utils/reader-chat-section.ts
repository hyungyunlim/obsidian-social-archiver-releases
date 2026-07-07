/**
 * Reader AI Chat section extraction (Chrome extension "Clip/Archive with Chat").
 *
 * The extension END-APPENDS a chat transcript to `content.markdown` as a
 * `## AI Chat — <provider> (<date>)` section (its content.text stays untouched
 * so search/highlight coordinates are stable). Most platform note templates,
 * however, render `content.text` — only web/Threads/RSS bodies come from
 * `content.markdown` — so without re-attachment the transcript would silently
 * vanish from X/YouTube/Reddit/Instagram/... notes. MarkdownConverter uses
 * this extractor to pull the trailing section out and append it to the
 * rendered note instead.
 */

/**
 * Exact shape the extension writes (chat-transcript.ts):
 * `## AI Chat — Claude Code (2026-07-04)` or with a pinned model
 * `## AI Chat — Claude Code · sonnet (2026-07-04)`. The strict date suffix
 * keeps look-alike headings that merely start with "## AI Chat" from matching.
 */
const AI_CHAT_HEADING_PATTERN = /^## AI Chat — .+ \(\d{4}-\d{2}-\d{2}\)\s*$/;

const AI_CHAT_HEADING_PREFIX = '## AI Chat — ';

export interface ReaderChatSection {
  /** The heading line itself — callers use it to detect an already-rendered section. */
  headingLine: string;
  /** The full section markdown (heading + turns), trailing whitespace trimmed. */
  section: string;
}

export interface ReaderChatTimelineTurn {
  readonly question: string;
  readonly answerMarkdown: string;
}

const READER_CHAT_HEADING_META_PATTERN = /^## AI Chat — (.+) \((\d{4}-\d{2}-\d{2})\)$/;
const READER_CHAT_QUESTION_PATTERN = /^>\s*\[!question\]\s*(.*)$/i;
const READER_CHAT_QUOTE_LINE_PATTERN = /^>\s?(.*)$/;

/**
 * Locate the start index of the trailing `## AI Chat` section, or -1 when the
 * markdown carries none. Matches the LAST heading occurrence (the extension
 * appends at the end; an article that itself discusses "## AI Chat" sits
 * earlier), and validates the heading shape so arbitrary look-alike lines
 * don't trigger it.
 */
function findTrailingReaderChatSectionStart(markdown: string): number {
  if (!markdown.includes(AI_CHAT_HEADING_PREFIX)) return -1;

  const lastInline = markdown.lastIndexOf(`\n${AI_CHAT_HEADING_PREFIX}`);
  const start =
    lastInline >= 0
      ? lastInline + 1
      : markdown.startsWith(AI_CHAT_HEADING_PREFIX)
        ? 0
        : -1;
  if (start < 0) return -1;

  const headingLine = markdown.slice(start).split('\n', 1)[0] ?? '';
  return AI_CHAT_HEADING_PATTERN.test(headingLine) ? start : -1;
}

/**
 * Extract the TRAILING `## AI Chat` section from a markdown body, or null when
 * none exists. See {@link findTrailingReaderChatSectionStart} for matching rules.
 */
export function extractTrailingReaderChatSection(markdown: unknown): ReaderChatSection | null {
  if (typeof markdown !== 'string') return null;

  const start = findTrailingReaderChatSectionStart(markdown);
  if (start < 0) return null;

  const section = markdown.slice(start).replace(/\s+$/, '');
  const headingLine = section.split('\n', 1)[0] ?? '';
  return { headingLine, section };
}

/**
 * Remove the trailing `## AI Chat` section from a markdown body (trailing
 * whitespace trimmed), or return the input unchanged when none exists.
 *
 * Used when a browser-clip markdown body is rendered inline as the note body:
 * the section is pulled out BEFORE the platform linkify/formatting passes run
 * (so transcript text is never rewritten), and `convert()` re-appends it at
 * the END of the rendered note — after media/comments — matching where the
 * section lands on platforms that render `content.text`.
 */
export function stripTrailingReaderChatSection(markdown: string): string {
  const start = findTrailingReaderChatSectionStart(markdown);
  if (start < 0) return markdown;
  return markdown.slice(0, start).replace(/\s+$/, '');
}

export function formatReaderChatTimelineMeta(headingLine: string): string {
  const match = READER_CHAT_HEADING_META_PATTERN.exec(headingLine.trim());
  if (!match) return '';

  const [, provider, date] = match;
  return `${provider} · ${date}`;
}

export function stripReaderChatTimelineHeading(section: string): string {
  const normalized = section.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  return lines.slice(1).join('\n').trim();
}

export function parseReaderChatTimelineTurns(markdown: string): readonly ReaderChatTimelineTurn[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const turns: ReaderChatTimelineTurn[] = [];
  let current:
    | {
        readonly questionLines: string[];
        readonly answerLines: string[];
        collectingQuestion: boolean;
      }
    | undefined;

  const pushCurrent = (): void => {
    if (!current) return;

    const question = current.questionLines.join('\n').trim();
    const answerMarkdown = current.answerLines.join('\n').trim();
    if (question || answerMarkdown) {
      turns.push({ question, answerMarkdown });
    }
  };

  for (const line of lines) {
    const questionMatch = READER_CHAT_QUESTION_PATTERN.exec(line);
    if (questionMatch) {
      pushCurrent();
      current = {
        questionLines: [(questionMatch[1] ?? '').trim()],
        answerLines: [],
        collectingQuestion: true,
      };
      continue;
    }

    if (!current) continue;

    if (current.collectingQuestion) {
      const quoteLineMatch = READER_CHAT_QUOTE_LINE_PATTERN.exec(line);
      if (quoteLineMatch) {
        current.questionLines.push(quoteLineMatch[1] ?? '');
        continue;
      }

      if (line.trim() === '') {
        current.collectingQuestion = false;
        continue;
      }

      current.collectingQuestion = false;
    }

    current.answerLines.push(line);
  }

  pushCurrent();
  return turns;
}
