import { describe, expect, it, vi } from 'vitest';
import { NoteMentionAsker, pluginNoteId, type NoteMentionChat } from '../../../services/byok/NoteMentionAsker';
import type { AICommentTarget } from '../../../services/ai-comment/AICommentSaver';
import type { ByokService } from '../../../services/byok/ByokService';
import type { AICommentMeta } from '../../../types/ai-comment';
import type { PostData } from '../../../types/post';
import { formatChatTranscript, isNoteReply, type ByokClient } from '../../../vendor/byok-ai-core';

const POST = {
  platform: 'x',
  id: 'post-1',
  url: 'https://x.com/a/status/1',
  filePath: 'Social Archives/X/post.md',
  author: { name: 'Ada', url: '' },
  content: { text: 'Kubernetes schedules containers.' },
  media: [],
  metadata: { timestamp: '2026-11-05T00:00:00.000Z' },
} as unknown as PostData;

const NOTE_ID = pluginNoteId('client-1');
const ANSWER = 'It cites the 2024 CNCF survey.';

type ModelRequest = { messages: { role: string; content: string }[]; webSearch?: boolean };

/** An Anthropic key (or `providers`) that answers every question; `gate` holds the answer back until resolved. */
function fakeByok(providers: string[] = ['anthropic'], gate?: Promise<void>) {
  const requests: ModelRequest[] = [];
  const byok = {
    readyProviders: () => providers,
    run: vi.fn(async (input: { run: (client: ByokClient, model: string) => Promise<unknown> }) => {
      await gate;
      const client = {
        generate: async (req: ModelRequest) => {
          requests.push(req);
          return { text: ANSWER, model: 'claude-sonnet-5-20261001', usage: {}, citations: [], finishReason: 'stop' };
        },
      } as unknown as ByokClient;
      return { value: await input.run(client, 'claude-sonnet-5'), model: 'claude-sonnet-5' };
    }),
  } as unknown as ByokService;
  return { byok, requests };
}

function setup(chat: Partial<NoteMentionChat> = {}, gate?: Promise<void>) {
  const saved: { meta: AICommentMeta; content: string }[] = [];
  const target: AICommentTarget = {
    post: POST,
    budget: vi.fn(async () => ({ maxChars: 40_000, maxJsonBytes: 600_000 })),
    save: vi.fn(async (meta: AICommentMeta, content: string) => {
      saved.push({ meta, content });
    }),
  };
  const notify = vi.fn();
  const { byok, requests } = fakeByok(['anthropic'], gate);
  const askChatAI = vi.fn(async () => ({ text: 'Cloud answer.', provider: 'workers-ai' as const, model: '@cf/zai-org/glm-4.7-flash' }));
  const asker = new NoteMentionAsker({
    chat: () => ({ byok, cloud: () => ({ askChatAI }), archiveId: 'archive-1', signedIn: true, ...chat }),
    noteId: () => NOTE_ID,
    notify,
  });
  return { asker, target, saved, notify, requests, askChatAI };
}

const transcript = (question: string, answer: string): string =>
  formatChatTranscript({ messages: [{ role: 'user', content: question }, { role: 'assistant', content: answer }] });

describe('NoteMentionAsker', () => {
  it('asks only the AIs the edit added, as one chat turn about the post, and saves the answer as a reply to the note', async () => {
    const { asker, target, saved, requests, askChatAI, notify } = setup();
    const after = 'Interesting. @CloudAI @Claude what is this based on?';
    await asker.askNoteMentions(target, 'Interesting. @CloudAI', after);

    expect(askChatAI).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.messages).toEqual([{ role: 'user', content: after }]);
    expect(requests[0]?.webSearch).toBe(false);

    expect(notify).not.toHaveBeenCalled();
    expect(saved).toHaveLength(1);
    const reply = saved[0];
    expect(reply?.meta).toMatchObject({ cli: 'anthropic-api', type: 'chat', model: 'claude-sonnet-5', executedModel: 'claude-sonnet-5-20261001' });
    expect(reply?.meta.id).toMatch(/^anthropic-api-chat-\w+-\w+-re-obsidian_client-1_primary$/);
    expect(isNoteReply(reply?.meta.id ?? '', NOTE_ID)).toBe(true);
    expect(reply?.content).toBe(transcript(after, ANSWER));
  });

  it('asks Cloud AI with no history and the note as written, its mention links as text', async () => {
    const { asker, target, saved, askChatAI } = setup({ outputLanguage: 'ko' });
    await asker.askNoteMentions(target, '', '@CloudAI does [@Ada](socialarchiver://author?name=Ada) agree?');

    expect(askChatAI).toHaveBeenCalledWith({ archiveId: 'archive-1', history: [], question: '@CloudAI does @Ada agree?', outputLanguage: 'ko' });
    expect(saved.map((reply) => reply.meta.id)).toEqual([expect.stringMatching(/^workers-ai-chat-.+-re-obsidian_client-1_primary$/)]);
    expect(saved[0]?.content).toBe(transcript('@CloudAI does @Ada agree?', 'Cloud answer.'));
  });

  it('says why an AI it cannot ask here is not asked, and asks nobody for it', async () => {
    const noKey = setup({ byok: fakeByok([]).byok, signedIn: false });
    await noKey.asker.askNoteMentions(noKey.target, '', '@Claude and @CloudAI, why?');
    expect(noKey.notify.mock.calls.map(([message]) => message)).toEqual([
      'Add your Anthropic key in Social Archiver settings to ask @Claude.',
      'Sign in to Social Archiver to ask @CloudAI.',
    ]);
    expect(noKey.saved).toEqual([]);

    const notSynced = setup({ archiveId: null });
    await notSynced.asker.askNoteMentions(notSynced.target, '', '@CloudAI why?');
    expect(notSynced.askChatAI).not.toHaveBeenCalled();
    expect(notSynced.notify).toHaveBeenCalledWith('This post is not on the server yet. Try again after it syncs, or use your own API key.');
  });

  it('asks nobody for a note that is only mentions, or an edit that adds none', async () => {
    const { asker, target, requests, askChatAI, notify } = setup();
    await asker.askNoteMentions(target, '', '@Claude');
    await asker.askNoteMentions(target, '@Claude why?', '@Claude why? Also this.');
    await asker.askNoteMentions(target, '', 'Write to me@claude.ai');
    expect(requests).toEqual([]);
    expect(askChatAI).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('reports a failed answer in chat words and leaves the note alone', async () => {
    const { asker, target, saved, askChatAI, notify } = setup();
    askChatAI.mockRejectedValueOnce(Object.assign(new Error('slow'), { code: 'CHAT_AI_RATE_LIMITED', status: 429 }));
    await asker.askNoteMentions(target, '', '@CloudAI why?');
    expect(notify).toHaveBeenCalledWith('Too many Cloud AI questions. Try again in a minute.');
    expect(saved).toEqual([]);
    expect(asker.pendingFor(POST)).toEqual([]);
  });

  it('says so when the note has no room left', async () => {
    const { asker, target, saved, notify } = setup();
    vi.mocked(target.budget).mockResolvedValueOnce(null);
    await asker.askNoteMentions(target, '', '@Claude why?');
    expect(notify).toHaveBeenCalledWith('This note has too much AI comment text. Delete some AI comments and try again.');
    expect(saved).toEqual([]);
  });

  it('shows who is replying until the answer is saved, and saves one answer at a time', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { asker, target } = setup({}, gate);
    const order: string[] = [];
    vi.mocked(target.save).mockImplementation(async (meta: AICommentMeta) => {
      order.push(`start ${meta.cli}`);
      await new Promise((resolve) => window.setTimeout(resolve, 5));
      order.push(`end ${meta.cli}`);
    });
    const changes = vi.fn();
    const unsubscribe = asker.subscribe(POST, changes);

    const asking = asker.askNoteMentions(target, '', '@CloudAI and @Claude, why?');
    // Pending as soon as the note is saved: the views drawn right after show it.
    expect(asker.pendingFor(POST).map((pending) => pending.handle)).toEqual(['CloudAI', 'Claude']);
    expect(changes).toHaveBeenCalledTimes(2);

    release();
    await asking;
    // Both answers arrive together; the second save waits for the first.
    expect([...order].sort()).toEqual(['end anthropic-api', 'end workers-ai', 'start anthropic-api', 'start workers-ai']);
    expect(order[1]).toBe(order[0]?.replace('start', 'end'));
    expect(order[3]).toBe(order[2]?.replace('start', 'end'));
    expect(asker.pendingFor(POST)).toEqual([]);
    expect(changes).toHaveBeenCalledTimes(4);
    unsubscribe();
  });

  it('asks once when the same save arrives twice while the answer is on its way', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { asker, target, saved, requests } = setup({}, gate);
    // A double-clicked Save: both saves read the note as it was.
    const first = asker.askNoteMentions(target, 'Hm.', 'Hm. @Claude why?');
    const second = asker.askNoteMentions(target, 'Hm.', 'Hm. @Claude why?');
    release();
    await Promise.all([first, second]);
    expect(requests).toHaveLength(1);
    expect(saved).toHaveLength(1);
  });

  it('stops quietly when the plugin unloads', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { asker, target, saved, notify } = setup({}, gate);
    const asking = asker.askNoteMentions(target, '', '@Claude why?');
    asker.dispose();
    release();
    await asking;
    expect(saved).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });
});
