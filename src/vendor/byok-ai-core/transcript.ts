/**
 * The stored form of a chat (`chat` AI comment content), and the heading rule
 * for every stored chat or research text: AI comment content sits under a
 * `### ` comment heading that the plugin's note parser splits on, so h1–h3
 * must never appear outside code fences. They become h4. Inside fences a line
 * shaped like a comment header gets one leading space: older plugins parse
 * without fences and would split there too.
 */
import type { ByokMessage } from './chat';
import { fitTextToBudget, fitsBudget, type AICommentBudget } from './limits';

const FENCE = /^\s*(`{3,}|~{3,})/;
const HEADING = /^( {0,3})#{1,3}(?=\s|$)/;
/**
 * The plugin note parser's comment header (every version's regex is a subset
 * of this one), with its `m` flag: a lone \r or U+2028/9 also starts a line.
 */
const COMMENT_HEADER = /^### (?:🤖|✨|💡|🦙|☁️?|⚡|🍎)\s*[^·\n]+?\s*·\s*.+?\s*·\s*.+$/gm;

/**
 * ATX h1–h3 → h4 outside ``` / ~~~ fences (ported from chrome-extension
 * chat-transcript.ts); inside them only comment-header-shaped lines change.
 */
export function demoteHeadings(markdown: string): string {
  // Only a fence of the opening character closes the block: ``` inside ~~~ is content.
  let openFence: string | null = null;
  return markdown
    .split('\n')
    .map((line) => {
      const fence = FENCE.exec(line)?.[1]?.charAt(0);
      if (fence) {
        if (openFence === null) openFence = fence;
        else if (openFence === fence) openFence = null;
      }
      const demoted = fence || openFence !== null ? line : line.replace(HEADING, '$1####');
      // Fenced, and after a lone \r anywhere: a parser that ignores fences still sees a header.
      return demoted.replace(COMMENT_HEADER, ' $&');
    })
    .join('\n');
}

/** A user turn as an Obsidian `> [!question]` callout. */
function formatQuestion(content: string): string {
  const [first = '', ...rest] = demoteHeadings(content.trim()).split('\n');
  const body = rest.map((line) => `> ${line}`).join('\n');
  return `> [!question] ${first}${body ? `\n${body}` : ''}`;
}

/** Questions as callouts, answers as markdown with demoted headings; no heading line of its own. */
export function formatChatTranscript(input: { messages: readonly ByokMessage[] }): string {
  return input.messages
    .filter((message) => message.content.trim())
    .map((message) => (message.role === 'user' ? formatQuestion(message.content) : demoteHeadings(message.content.trim())))
    .join('\n\n');
}

const QUESTION_START = /^> \[!question\][ \t]?(.*)$/;
const QUOTED = /^>[ \t]?(.*)$/;

/**
 * A stored chat back into messages (the inverse of formatChatTranscript), so
 * a saved chat can be continued with what was said before. A `> [!question]`
 * callout opens a user turn and its `>` lines continue it; everything up to
 * the next callout is the answer, its own quotes included. Headings stay
 * demoted. Repeated roles merge, because providers want turns that alternate.
 */
export function parseChatTranscript(content: string): ByokMessage[] {
  const messages: ByokMessage[] = [];
  const push = (role: ByokMessage['role'], lines: readonly string[]) => {
    const text = lines.join('\n').trim();
    if (!text) return;
    const last = messages[messages.length - 1];
    if (last?.role === role) last.content = `${last.content}\n\n${text}`;
    else messages.push({ role, content: text });
  };
  let question: string[] | null = null;
  let answer: string[] = [];
  for (const line of content.replace(/\r\n?/g, '\n').split('\n')) {
    const start = QUESTION_START.exec(line);
    if (start) {
      if (question) push('user', question);
      push('assistant', answer);
      answer = [];
      question = [start[1] ?? ''];
      continue;
    }
    if (question) {
      const quoted = QUOTED.exec(line);
      if (quoted) {
        question.push(quoted[1] ?? '');
        continue;
      }
      push('user', question);
      question = null;
    }
    answer.push(line);
  }
  if (question) push('user', question);
  push('assistant', answer);
  // Text before the first question is not a turn of this chat.
  while (messages[0]?.role === 'assistant') messages.shift();
  return messages;
}

/**
 * The transcript that fits `budget`: the oldest question/answer pairs are
 * dropped first, and when even the last pair is too long it is truncated with
 * the note. Null when there is nothing to save or nothing fits.
 */
export function fitChatTranscript(
  messages: readonly ByokMessage[],
  budget: AICommentBudget,
): { content: string; droppedTurns: number } | null {
  const turns = toTurns(messages);
  // ponytail: re-formats per attempt, O(turns²) chars; turns ≤ 20 (CHAT_MAX_USER_TURNS).
  for (let dropped = 0; dropped < turns.length; dropped++) {
    const content = formatChatTranscript({ messages: turns.slice(dropped).flat() });
    if (fitsBudget(content, budget)) return { content, droppedTurns: dropped };
  }
  const last = turns[turns.length - 1];
  if (!last) return null;
  const { content } = fitTextToBudget(formatChatTranscript({ messages: last }), budget);
  return content ? { content, droppedTurns: turns.length - 1 } : null;
}

/** A turn opens at each question; answers join the turn before them. */
function toTurns(messages: readonly ByokMessage[]): ByokMessage[][] {
  const turns: ByokMessage[][] = [];
  for (const message of messages) {
    if (!message.content.trim()) continue;
    const current = turns[turns.length - 1];
    if (message.role === 'user' || !current) turns.push([message]);
    else current.push(message);
  }
  return turns;
}
