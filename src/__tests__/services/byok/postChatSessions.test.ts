import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearPostChatSessions,
  continueSavedPostChat,
  continuingSavedPostChatDropsTurns,
  findPostChatSession,
  openPostChatSession,
} from '../../../services/byok/postChatSessions';
import type { PostChatSessionDeps } from '../../../services/byok/PostChatSession';
import type { PostData } from '../../../types/post';
import type { ByokArticleInput } from '../../../vendor/byok-ai-core';

const ARTICLE: ByokArticleInput = { title: 'T', authorName: 'Ada', platform: 'x', body: 'Body.' };
const post = (filePath: string): PostData => ({ id: `id-${filePath}`, filePath }) as PostData;
type AskChatAI = NonNullable<ReturnType<PostChatSessionDeps['cloud']>>['askChatAI'];

function deps(archiveId: string | null, askChatAI: AskChatAI = vi.fn()): PostChatSessionDeps {
  return { byok: () => null, cloud: () => ({ askChatAI }), article: () => ARTICLE, archiveId };
}

describe('postChatSessions', () => {
  afterEach(() => clearPostChatSessions());

  it('keeps one session per note, seeded from its saved chat once, reopened with what the opener knows now', async () => {
    const savedChat = vi.fn(async () => ({ id: 'workers-ai-chat-1', content: '> [!question] Q?\n\nA.' }));
    const first = openPostChatSession({ post: post('a.md'), savedChat }, deps(null));
    await vi.waitFor(() => expect(first.messages).toHaveLength(2));

    const askChatAI = vi.fn(async () => ({ text: 'Ok.', provider: 'workers-ai' as const, model: 'm' }));
    const again = openPostChatSession({ post: post('a.md'), savedChat }, deps('archive-1', askChatAI));
    expect(again).toBe(first);
    expect(savedChat).toHaveBeenCalledTimes(1);
    expect(findPostChatSession(post('a.md'))).toBe(first);
    expect(findPostChatSession(post('b.md'))).toBeUndefined();

    // The archive id the post got after the first open reaches Cloud AI.
    again.setEngine({ kind: 'cloud' });
    await again.send('Q2?');
    expect(askChatAI).toHaveBeenCalledWith(expect.objectContaining({ archiveId: 'archive-1', question: 'Q2?' }));
  });

  it('stops answers on their way and forgets every chat on unload', () => {
    const session = openPostChatSession({ post: post('a.md') }, deps('archive-1', vi.fn(() => new Promise<never>(() => undefined))));
    session.setEngine({ kind: 'cloud' });
    void session.send('Why?');
    const turn = session.pending as unknown as { abort: AbortController };

    clearPostChatSessions();
    expect(turn.abort.signal.aborted).toBe(true);
    expect(session.pending).toBeNull();
    expect(findPostChatSession(post('a.md'))).toBeUndefined();
  });
  describe('Continue chat on a saved chat', () => {
    const OLD = { id: 'chat-old', content: '> [!question] Old?\n\nOld answer.' };
    const NEW = { id: 'chat-new', content: '> [!question] New?\n\nNew answer.' };

    it('starts the chat from the picked one when chat has not opened on the post yet', async () => {
      continueSavedPostChat(post('a.md'), OLD);
      const session = openPostChatSession({ post: post('a.md'), savedChat: async () => NEW }, deps(null));
      await vi.waitFor(() => expect(session.savedCommentId).toBe('chat-old'));
      expect(session.messages).toEqual([
        { role: 'user', content: 'Old?' },
        { role: 'assistant', content: 'Old answer.' },
      ]);
    });

    it('turns an open chat into the picked one, and keeps the one it already continues', async () => {
      const session = openPostChatSession({ post: post('a.md'), savedChat: async () => NEW }, deps(null));
      await vi.waitFor(() => expect(session.savedCommentId).toBe('chat-new'));

      continueSavedPostChat(post('a.md'), NEW);
      expect(session.savedCommentId).toBe('chat-new');

      continueSavedPostChat(post('a.md'), OLD);
      await vi.waitFor(() => expect(session.savedCommentId).toBe('chat-old'));
      expect(session.messages[0]).toEqual({ role: 'user', content: 'Old?' });
      expect(session.hasUnsaved).toBe(false);
    });

    it('reports turns that would be dropped: unsaved ones, or an answer on its way', async () => {
      expect(continuingSavedPostChatDropsTurns(post('a.md'), 'chat-old')).toBe(false);
      const askChatAI = vi.fn(() => new Promise<never>(() => undefined));
      const session = openPostChatSession({ post: post('a.md'), savedChat: async () => NEW }, deps('archive-1', askChatAI));
      await vi.waitFor(() => expect(session.savedCommentId).toBe('chat-new'));
      expect(continuingSavedPostChatDropsTurns(post('a.md'), 'chat-old')).toBe(false);

      session.setEngine({ kind: 'cloud' });
      void session.send('Why?');
      expect(continuingSavedPostChatDropsTurns(post('a.md'), 'chat-old')).toBe(true);
      // The chat being continued keeps its turn.
      expect(continuingSavedPostChatDropsTurns(post('a.md'), 'chat-new')).toBe(false);
    });

    it('forgets a picked chat on unload', async () => {
      continueSavedPostChat(post('a.md'), OLD);
      clearPostChatSessions();
      const session = openPostChatSession({ post: post('a.md'), savedChat: async () => NEW }, deps(null));
      await vi.waitFor(() => expect(session.savedCommentId).toBe('chat-new'));
    });
  });
});
