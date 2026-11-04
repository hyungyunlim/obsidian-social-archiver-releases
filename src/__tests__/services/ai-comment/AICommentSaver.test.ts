import { describe, expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import { AICommentSaver } from '@/services/ai-comment/AICommentSaver';
import { parseAIComments } from '@/services/ai-comment/markdown-handler';
import { ShareAPIClient } from '@/services/ShareAPIClient';
import { AI_COMMENTS_MAX_COUNT } from '@/vendor/byok-ai-core';
import type { AICommentMeta } from '@/types/ai-comment';
import type { PostData } from '@/types/post';

const PATH = 'Social Archives/X/2026/11/post.md';

function noteFixture(initial: string, frontmatter: Record<string, unknown> = {}) {
  const file = new TFile(PATH);
  const note = { content: initial };
  const app = {
    vault: {
      read: vi.fn(async () => note.content),
      process: vi.fn(async (_file: TFile, fn: (content: string) => string) => {
        note.content = fn(note.content);
        return note.content;
      }),
    },
    metadataCache: { getFileCache: () => ({ frontmatter }) },
    fileManager: {
      processFrontMatter: vi.fn(async (_file: TFile, fn: (fm: Record<string, unknown>) => void) => fn(frontmatter)),
    },
  } as unknown as App;
  const api = {
    updateArchiveActions: vi.fn(async () => ({ success: true })),
    getUserArchives: vi.fn(async () => ({ archives: [{ id: 'archive-by-url' }] })),
  };
  const saver = new AICommentSaver({
    app,
    api: () => api as never,
    settings: () => ({ workerUrl: 'https://api.test.com', authToken: 'token', username: 'me' }),
  });
  return { file, note, app, api, saver, frontmatter };
}

const post = (overrides: Partial<PostData> = {}): PostData => ({
  platform: 'x',
  id: 'post-1',
  url: 'https://x.com/a/status/1',
  filePath: PATH,
  author: { name: 'A', url: '' },
  content: { text: 'Body' },
  media: [],
  metadata: { timestamp: '2026-11-04T00:00:00.000Z' },
  ...overrides,
}) as PostData;

const chatMeta = (id = 'openai-api-chat-20261104T000000000'): AICommentMeta => ({
  id,
  cli: 'openai-api',
  model: 'gpt-6-luna',
  executedModel: 'gpt-6-luna-2026-10-01',
  type: 'chat',
  generatedAt: '2026-11-04T00:00:00.000Z',
});

describe('AICommentSaver', () => {
  it('appends to the note, mirrors frontmatter and PATCHes the whole list to the archive', async () => {
    const fixture = noteFixture('# Post\n\nBody', { sourceArchiveId: 'archive-1' });
    const content = '> [!question] Why?\n\nBecause.';
    await fixture.saver.append(post(), fixture.file, chatMeta(), content);

    const parsed = parseAIComments(fixture.note.content);
    expect(parsed.comments.map((c) => [c.id, c.cli, c.type])).toEqual([['openai-api-chat-20261104T000000000', 'openai-api', 'chat']]);
    expect(parsed.commentTexts.get('openai-api-chat-20261104T000000000')).toBe(content);
    expect(fixture.frontmatter.aiComments).toEqual(['openai-api-chat-20261104T000000000']);
    // The note keeps day-level dates, so the round-tripped generatedAt is the parsed one.
    expect(fixture.api.updateArchiveActions).toHaveBeenCalledWith('archive-1', {
      aiComments: [{
        meta: expect.objectContaining({
          id: 'openai-api-chat-20261104T000000000',
          cli: 'openai-api',
          model: 'gpt-6-luna',
          executedModel: 'gpt-6-luna-2026-10-01',
          type: 'chat',
        }),
        content,
      }],
    });
  });

  it('finds the archive by URL when the note has no id, and remembers it', async () => {
    const fixture = noteFixture('Body');
    await fixture.saver.append(post(), fixture.file, chatMeta(), 'Saved.');
    expect(fixture.api.getUserArchives).toHaveBeenCalledWith({ originalUrl: 'https://x.com/a/status/1', limit: 2 });
    expect(fixture.frontmatter.sourceArchiveId).toBe('archive-by-url');
    expect(fixture.api.updateArchiveActions).toHaveBeenCalledWith('archive-by-url', expect.anything());
  });

  it('keeps the note when the server is unreachable', async () => {
    const fixture = noteFixture('Body', { sourceArchiveId: 'archive-1' });
    fixture.api.updateArchiveActions.mockRejectedValueOnce(new Error('offline'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(fixture.saver.append(post(), fixture.file, chatMeta(), 'Saved.')).resolves.toBeUndefined();
    expect(parseAIComments(fixture.note.content).comments).toHaveLength(1);
    errors.mockRestore();
  });

  it('updates a live share with the new list', async () => {
    const update = vi.spyOn(ShareAPIClient.prototype, 'updateShare').mockResolvedValue({} as never);
    const fixture = noteFixture('Body', { sourceArchiveId: 'archive-1', shareUrl: 'https://social-archive.org/me/share-9' });
    await fixture.saver.append(post(), fixture.file, chatMeta(), 'Saved.');
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const [shareId, request] = update.mock.calls[0] ?? [];
    expect(shareId).toBe('share-9');
    expect(request?.options).toEqual({ shareId: 'share-9', username: 'me' });
    expect(request?.postData?.aiComments?.[0]?.meta.type).toBe('chat');
    expect(request?.postData?.media).toEqual([]);
    update.mockRestore();
  });

  it('has no room once the note holds the maximum number of comments', async () => {
    let note = 'Body';
    const fixture = noteFixture(note);
    for (let i = 0; i < AI_COMMENTS_MAX_COUNT; i++) {
      await fixture.saver.append(post({ url: '' }), fixture.file, chatMeta(`openai-api-chat-${i}`), `Answer ${i}`);
    }
    note = fixture.note.content;
    expect(parseAIComments(note).comments).toHaveLength(AI_COMMENTS_MAX_COUNT);
    await expect(fixture.saver.budget(fixture.file, 'chat')).resolves.toBeNull();
    await expect(noteFixture('Body').saver.budget(fixture.file, 'research')).resolves.toMatchObject({ maxChars: 40_000 });
  });

  it('replaces the saved chat a continued chat supersedes, in one write, its room counted for the budget', async () => {
    const fixture = noteFixture('Body', { sourceArchiveId: 'archive-1' });
    // A note at the comment limit, the saved chat last.
    for (let i = 0; i < AI_COMMENTS_MAX_COUNT - 1; i++) {
      await fixture.saver.append(post(), fixture.file, { ...chatMeta(`openai-api-summary-${i}`), type: 'summary' }, `Summary ${i}`);
    }
    const old = '> [!question] Old?\n\nOld answer.';
    await fixture.saver.append(post(), fixture.file, chatMeta('openai-api-chat-old'), old);
    await expect(fixture.saver.budget(fixture.file, 'chat')).resolves.toBeNull();
    await expect(fixture.saver.budget(fixture.file, 'chat', 'openai-api-chat-old')).resolves.toMatchObject({ maxChars: 40_000 });
    await expect(fixture.saver.savedChat(fixture.file)).resolves.toEqual({ id: 'openai-api-chat-old', content: old });

    const writes = vi.mocked(fixture.app.vault.process).mock.calls.length;
    fixture.api.updateArchiveActions.mockClear();
    const content = `${old}\n\n> [!question] New?\n\nNew answer.`;
    await fixture.saver.append(post(), fixture.file, chatMeta('openai-api-chat-new'), content, 'openai-api-chat-old');

    expect(vi.mocked(fixture.app.vault.process).mock.calls.length).toBe(writes + 1);
    const parsed = parseAIComments(fixture.note.content);
    const ids = parsed.comments.map((comment) => comment.id);
    expect(ids).toHaveLength(AI_COMMENTS_MAX_COUNT);
    expect(ids).not.toContain('openai-api-chat-old');
    expect(ids.at(-1)).toBe('openai-api-chat-new');
    expect(parsed.comments.filter((comment) => comment.type === 'chat')).toHaveLength(1);
    expect(parsed.commentTexts.get('openai-api-summary-0')).toBe('Summary 0');
    expect(fixture.frontmatter.aiComments).not.toContain('openai-api-chat-old');
    const [, patch] = fixture.api.updateArchiveActions.mock.calls[0] as unknown as [string, { aiComments: { meta: { id: string } }[] }];
    expect(patch.aiComments.map((comment) => comment.meta.id)).not.toContain('openai-api-chat-old');
    await expect(fixture.saver.savedChat(fixture.file)).resolves.toEqual({ id: 'openai-api-chat-new', content });
  });

  it('reads the latest saved chat, and appends when the chat it continued is gone', async () => {
    const fixture = noteFixture('Body', { sourceArchiveId: 'archive-1' });
    await expect(fixture.saver.savedChat(fixture.file)).resolves.toBeNull();
    await fixture.saver.append(post(), fixture.file, chatMeta('openai-api-chat-1'), 'First chat.');
    await fixture.saver.append(post(), fixture.file, { ...chatMeta('openai-api-summary-1'), type: 'summary' }, 'Summary.');
    await fixture.saver.append(post(), fixture.file, chatMeta('openai-api-chat-2'), 'Second chat.');
    await expect(fixture.saver.savedChat(fixture.file)).resolves.toEqual({ id: 'openai-api-chat-2', content: 'Second chat.' });

    await fixture.saver.append(post(), fixture.file, chatMeta('openai-api-chat-3'), 'Third chat.', 'deleted-by-hand');
    expect(parseAIComments(fixture.note.content).comments.map((comment) => comment.id)).toEqual([
      'openai-api-chat-1',
      'openai-api-summary-1',
      'openai-api-chat-2',
      'openai-api-chat-3',
    ]);
  });

  it('gives modals a target that brackets its write with the opener hooks', async () => {
    const fixture = noteFixture('Body', { sourceArchiveId: 'archive-1' });
    const order: string[] = [];
    const target = fixture.saver.target(post(), fixture.file, {
      beforeWrite: () => order.push('before'),
      afterSave: () => order.push('after'),
    });
    fixture.app.vault.process = vi.fn(async (_file: TFile, fn: (content: string) => string) => {
      order.push('write');
      fixture.note.content = fn(fixture.note.content);
      return fixture.note.content;
    }) as never;
    await target.save(chatMeta(), 'Saved.');
    expect(order).toEqual(['before', 'write', 'after']);

    // The chat the target reads back is the one a continued chat replaces.
    await expect(target.savedChat?.()).resolves.toEqual({ id: chatMeta().id, content: 'Saved.' });
    await target.save(chatMeta('openai-api-chat-20261104T010000000'), 'Saved again.', chatMeta().id);
    expect(parseAIComments(fixture.note.content).comments.map((comment) => comment.id)).toEqual(['openai-api-chat-20261104T010000000']);
  });
});
