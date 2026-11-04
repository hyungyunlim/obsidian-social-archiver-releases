/**
 * "Chat about this post": one conversation per post while the plugin runs.
 * Closing the chat UI puts a chat down: its session (turns, draft, an answer
 * on its way) stays here, and opening chat on the post again picks it up.
 * Memory only: quitting Obsidian or unloading the plugin ends unsaved chats.
 *
 * Keyed by the note path: every chat saves to a note, while only synced posts
 * have an archive id. A note renamed mid-chat starts over from what it saved.
 */
import type { AICommentTarget } from '../ai-comment/AICommentSaver';
import type { PostData } from '../../types/post';
import { PostChatSession, type PostChatSessionDeps } from './PostChatSession';

// ponytail: one entry per post chatted about this run, never pruned; drop sessions with nothing unsaved if that ever adds up.
const sessions = new Map<string, PostChatSession>();

const keyOf = (post: Pick<PostData, 'filePath' | 'id'>): string => post.filePath || post.id;

/** The post's session: created (and seeded from the note's saved chat) the first time; later opens bring current deps. */
export function openPostChatSession(target: Pick<AICommentTarget, 'post' | 'savedChat'>, deps: PostChatSessionDeps): PostChatSession {
  const key = keyOf(target.post);
  const open = sessions.get(key);
  if (open) {
    open.updateDeps(deps);
    return open;
  }
  const session = new PostChatSession(deps);
  if (target.savedChat) session.seed(target.savedChat());
  sessions.set(key, session);
  return session;
}

/** The post's session, when chat was opened on it this run. */
export function findPostChatSession(post: Pick<PostData, 'filePath' | 'id'>): PostChatSession | undefined {
  return sessions.get(keyOf(post));
}

/** Plugin unload: answers on their way stop (and stop costing tokens), and every chat is gone. */
export function clearPostChatSessions(): void {
  for (const session of sessions.values()) session.stop();
  sessions.clear();
}
