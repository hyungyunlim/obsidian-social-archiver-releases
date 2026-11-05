/**
 * @-mentions of an AI in a note on a post: "@Claude what is this claim based
 * on?". Saving the note asks each AI it newly mentions, and the answer is kept
 * as a saved chat that replies to the note (the note is its first question):
 * it shows under the note and can be continued as a chat.
 *
 * Mentions are plain text, so every client, the note markdown and old apps
 * read them as written; a picker only helps type one.
 */
import type { ByokProviderId } from './providers';
import { CHAT_MAX_QUESTION_CHARS } from './chat';
import { formatChatTranscript, parseChatTranscript } from './transcript';

/** Who answers: the user's own key for a provider, or Cloud AI. */
export type AIMentionTarget =
  | { readonly kind: 'byok'; readonly provider: ByokProviderId }
  | { readonly kind: 'cloud' };

export interface AIMentionHandle {
  /** What follows "@", as the picker writes it. */
  readonly handle: string;
  /** Also read as this AI when typed by hand (any case). */
  readonly aliases: readonly string[];
  readonly target: AIMentionTarget;
}

/** In picker order. */
export const AI_MENTION_HANDLES: readonly AIMentionHandle[] = [
  { handle: 'Claude', aliases: ['Anthropic'], target: { kind: 'byok', provider: 'anthropic' } },
  { handle: 'GPT', aliases: ['ChatGPT', 'OpenAI'], target: { kind: 'byok', provider: 'openai' } },
  { handle: 'Gemini', aliases: [], target: { kind: 'byok', provider: 'gemini' } },
  { handle: 'OpenRouter', aliases: [], target: { kind: 'byok', provider: 'openrouter' } },
  { handle: 'CloudAI', aliases: [], target: { kind: 'cloud' } },
];

/** One note save asks at most this many AIs (each answer costs a request). */
export const AI_MENTIONS_PER_NOTE = 3;

export interface AIMention {
  readonly handle: AIMentionHandle;
  /** Index of the "@". */
  readonly start: number;
  /** Index just past the handle. */
  readonly end: number;
}

const BY_NAME = new Map(
  AI_MENTION_HANDLES.flatMap((handle) => [handle.handle, ...handle.aliases].map((name) => [name.toLowerCase(), handle] as const)),
);
// Longest first, so a name is never cut short by another that starts it.
const NAMES = [...BY_NAME.keys()].sort((a, b) => b.length - a.length);
/**
 * What may come right before the "@": the start, a space, or opening
 * punctuation. Never a letter, ".", "/", "[" or "=": not inside an e-mail
 * address, a URL, or a note's author link (`[@Claude](socialarchiver://…)`).
 */
const BEFORE = `(^|[\\s("'“‘「『（,，、])`;
/** The name ends before an ASCII word character, so a particle may follow it ("@Claude야"). */
const MENTION = new RegExp(`${BEFORE}@(${NAMES.join('|')})(?![\\w])`, 'gi');

/** Every AI mention in `text`, in order (the same AI may come more than once). */
export function findAIMentions(text: string): AIMention[] {
  const mentions: AIMention[] = [];
  for (const match of text.matchAll(MENTION)) {
    const handle = BY_NAME.get((match[2] ?? '').toLowerCase());
    if (!handle || match.index === undefined) continue;
    const start = match.index + (match[1]?.length ?? 0);
    mentions.push({ handle, start, end: start + 1 + (match[2]?.length ?? 0) });
  }
  return mentions;
}

const targetKey = (target: AIMentionTarget): string => (target.kind === 'byok' ? `byok:${target.provider}` : 'cloud');

/**
 * The AIs `after` mentions that `before` did not, first mention first, at
 * most AI_MENTIONS_PER_NOTE: what saving that note asks. A new note's
 * `before` is ''. A note that is only mentions asks nobody.
 */
export function newAIMentions(before: string, after: string): AIMentionHandle[] {
  if (!hasMentionQuestion(after)) return [];
  const had = new Set(findAIMentions(before).map((mention) => targetKey(mention.handle.target)));
  const asked: AIMentionHandle[] = [];
  for (const { handle } of findAIMentions(after)) {
    const key = targetKey(handle.target);
    if (had.has(key)) continue;
    had.add(key);
    asked.push(handle);
    if (asked.length === AI_MENTIONS_PER_NOTE) break;
  }
  return asked;
}

/** Whether anything but mentions is written: "@Claude" alone is no question. */
export function hasMentionQuestion(text: string): boolean {
  return text.replace(MENTION, '$1').trim().length > 0;
}

/** The "@…" being typed just before `cursor` (what the picker filters by), or null. */
export function aiMentionQueryAt(text: string, cursor: number): { readonly start: number; readonly query: string } | null {
  const before = text.slice(0, cursor);
  const match = new RegExp(`${BEFORE}@([A-Za-z]*)$`).exec(before);
  if (!match || match.index === undefined) return null;
  return { start: match.index + (match[1]?.length ?? 0), query: match[2] ?? '' };
}

/** Picker rows for `query`: handles (or aliases) that start with it, in picker order. */
export function aiMentionSuggestions(query: string, handles: readonly AIMentionHandle[] = AI_MENTION_HANDLES): AIMentionHandle[] {
  const lower = query.toLowerCase();
  return handles.filter((handle) => [handle.handle, ...handle.aliases].some((name) => name.toLowerCase().startsWith(lower)));
}

/** `text` with the "@…" typed from `start` to `cursor` replaced by "@Handle ", and where the cursor goes. */
export function insertAIMention(
  text: string,
  start: number,
  cursor: number,
  handle: AIMentionHandle,
): { readonly text: string; readonly cursor: number } {
  const rest = text.slice(cursor);
  const token = `@${handle.handle}${/^\s/.test(rest) ? '' : ' '}`;
  return { text: `${text.slice(0, start)}${token}${rest}`, cursor: start + token.length };
}

/*
 * The reply's link to its note lives in the comment id: `<chat id>-re-<note>`.
 * Ids are free strings everywhere (the server keeps up to 200 characters and
 * strips meta fields it does not know; the plugin keeps any id without
 * spaces), so the link survives every client, sync and old apps, which see
 * an ordinary saved chat. No chat id contains "-re-" otherwise.
 */
const REPLY_MARK = '-re-';

/** A note id as it can sit in a comment id: word characters and "-", at most 120. */
function noteRef(noteId: string): string {
  return noteId.replace(/[^\w-]/g, '_').slice(0, 120);
}

/** The id of a saved chat that replies to `noteId`: the chat's own id plus the note mark. */
export function noteReplyCommentId(chatId: string, noteId: string): string {
  return `${chatId}${REPLY_MARK}${noteRef(noteId)}`;
}

/** The note mark of a reply's id ('' for any other comment): a continued reply saved again keeps it. */
export function noteReplySuffix(commentId: string | null | undefined): string {
  const index = commentId ? commentId.indexOf(REPLY_MARK) : -1;
  return commentId && index >= 0 ? commentId.slice(index) : '';
}

/**
 * Whether `commentId` is a reply to some note. "Chat about this post" starts
 * from the newest saved chat that is not one: a reply continues from its note.
 */
export function isAnyNoteReply(commentId: string): boolean {
  return noteReplySuffix(commentId) !== '';
}

/** Whether the saved chat `commentId` replies to the note `noteId`. */
export function isNoteReply(commentId: string, noteId: string): boolean {
  return noteReplySuffix(commentId) === `${REPLY_MARK}${noteRef(noteId)}`;
}

/**
 * Saved chats replying to one of `notes`, by note id (oldest first, as
 * stored), and every other comment. A reply whose note is gone stays with
 * the others, where an ordinary saved chat would show.
 */
export function splitNoteReplies<C extends { readonly meta: { readonly id: string; readonly type: string } }>(
  comments: readonly C[],
  notes: readonly { readonly id: string }[],
): { readonly replies: ReadonlyMap<string, C[]>; readonly others: C[] } {
  const replies = new Map<string, C[]>();
  const others: C[] = [];
  for (const comment of comments) {
    const note = comment.meta.type === 'chat' ? notes.find((candidate) => isNoteReply(comment.meta.id, candidate.id)) : undefined;
    if (!note) {
      others.push(comment);
      continue;
    }
    replies.set(note.id, [...(replies.get(note.id) ?? []), comment]);
  }
  return { replies, others };
}

/** What a reply shows under its note: its transcript after the first question, which is the note itself. */
export function noteReplyTranscript(content: string): string {
  const messages = parseChatTranscript(content);
  return formatChatTranscript({ messages: messages[0]?.role === 'user' ? messages.slice(1) : messages });
}

/**
 * A note as the question an AI reads: its author and post mention links
 * (`[@Name](socialarchiver://…)`, `[Title](socialarchiver://archive/…)`) as
 * their visible text, cut to a chat question's limit (a note may be 10,000
 * characters, a question 2,000).
 */
export function noteQuestionText(noteContent: string): string {
  return noteContent
    .replace(/\[([^\]\n]+)\]\(socialarchiver:\/\/[^)\s]*\)/g, '$1')
    .trim()
    .slice(0, CHAT_MAX_QUESTION_CHARS)
    .trim();
}
