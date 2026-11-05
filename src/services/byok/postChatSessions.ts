/**
 * "Chat about this post": one conversation per post while the plugin runs.
 * Closing the chat UI puts a chat down: its session (turns, draft, an answer
 * on its way) stays here, and opening chat on the post again picks it up.
 * Memory only: quitting Obsidian or unloading the plugin ends unsaved chats.
 *
 * Keyed by the note path: every chat saves to a note, while only synced posts
 * have an archive id. A note renamed mid-chat starts over from what it saved.
 */
import type { AICommentTarget, StoredAIComment } from '../ai-comment/AICommentSaver';
import type { PostData } from '../../types/post';
import { PostChatSession, type PostChatSessionDeps } from './PostChatSession';

// ponytail: one entry per post chatted about this run, never pruned; drop sessions with nothing unsaved if that ever adds up.
const sessions = new Map<string, PostChatSession>();

const keyOf = (post: Pick<PostData, 'filePath' | 'id'>): string => post.filePath || post.id;
/** Saved chats picked with "Continue chat" before chat opened on their post: the session starts from one. */
const picked = new Map<string, StoredAIComment>();

/** The post's session: created (and seeded from the note's saved chat) the first time; later opens bring current deps. */
export function openPostChatSession(target: Pick<AICommentTarget, 'post' | 'savedChat'>, deps: PostChatSessionDeps): PostChatSession {
  const key = keyOf(target.post);
  const open = sessions.get(key);
  if (open) {
    open.updateDeps(deps);
    return open;
  }
  const session = new PostChatSession(deps);
  const chosen = picked.get(key);
  picked.delete(key);
  if (chosen) session.seed(Promise.resolve(chosen));
  else if (target.savedChat) session.seed(target.savedChat());
  sessions.set(key, session);
  return session;
}

/** Whether continuing the saved chat `commentId` would drop turns the note does not have, or an answer on its way. */
export function continuingSavedPostChatDropsTurns(post: Pick<PostData, 'filePath' | 'id'>, commentId: string): boolean {
  const session = sessions.get(keyOf(post));
  if (!session || session.savedCommentId === commentId) return false;
  return session.pending !== null || session.hasUnsaved;
}

/**
 * "Continue chat" on a saved chat: the post's conversation becomes that chat
 * (any other ends, as with New chat). Already continuing it: kept as it is.
 * Before chat has opened on the post, the session starts from it.
 */
export function continueSavedPostChat(post: Pick<PostData, 'filePath' | 'id'>, saved: StoredAIComment): void {
  const key = keyOf(post);
  const session = sessions.get(key);
  if (!session) {
    picked.set(key, saved);
    return;
  }
  if (session.savedCommentId === saved.id) return;
  session.reset();
  session.seed(Promise.resolve(saved));
}

/** The post's session, when chat was opened on it this run. */
export function findPostChatSession(post: Pick<PostData, 'filePath' | 'id'>): PostChatSession | undefined {
  return sessions.get(keyOf(post));
}

/** Plugin unload: answers on their way stop (and stop costing tokens), and every chat is gone. */
export function clearPostChatSessions(): void {
  for (const session of sessions.values()) session.stop();
  sessions.clear();
  picked.clear();
}
