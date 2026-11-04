import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPostChatSessions, findPostChatSession, openPostChatSession } from '../../../services/byok/postChatSessions';
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
});
