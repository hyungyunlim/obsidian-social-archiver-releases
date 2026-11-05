import { describe, expect, it, vi } from 'vitest';
import { Modal, TFile, type App } from 'obsidian';
import { LinkPreviewRenderer } from '@/components/timeline/renderers/LinkPreviewRenderer';
import { MediaGalleryRenderer } from '@/components/timeline/renderers/MediaGalleryRenderer';
import { ReaderModeContentRenderer } from '@/components/timeline/reader/ReaderModeContentRenderer';
import type { ReaderContentCallbacks } from '@/components/timeline/reader/ReaderModeContentRenderer';
import type SocialArchiverPlugin from '@/main';
import type { PostData } from '@/types/post';
import type { AICommentMeta } from '@/types/ai-comment';
import { appendAIComment } from '@/services/ai-comment/markdown-handler';
import { noteReplyCommentId } from '@/vendor/byok-ai-core';

const markdownRenderSpy = vi.hoisted(() =>
  vi.fn(async (
    _app: unknown,
    markdown: string,
    el: HTMLElement,
  ): Promise<void> => {
    const rendered = document.createElement('div');
    rendered.className = 'mocked-reader-mode-markdown';
    rendered.textContent = markdown;
    el.appendChild(rendered);
  }),
);

vi.mock('obsidian', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('obsidian');

  class Component {
    register(): void {}
    registerEvent(): void {}
    addChild(): void {}
    load(): void {}
    unload(): void {}
  }

  class Menu {
    addItem(): this {
      return this;
    }
    showAtMouseEvent(): void {}
  }

  return {
    ...actual,
    Component,
    Menu,
    MarkdownRenderer: { render: markdownRenderSpy },
    Notice: class Notice {
      constructor(_message: string) {}
    },
    Platform: {
      isDesktop: true,
      isMobile: false,
      isMacOS: true,
      isWin: false,
      isLinux: false,
      isIosApp: false,
      isAndroidApp: false,
    },
    setIcon(element: HTMLElement, icon: string): void {
      element.dataset.icon = icon;
    },
  };
});

if (!('addClass' in SVGElement.prototype)) {
  Object.defineProperty(SVGElement.prototype, 'addClass', {
    configurable: true,
    value(this: SVGElement, ...names: string[]) {
      for (const name of names) {
        this.classList.add(...name.split(/\s+/).filter(Boolean));
      }
    },
  });
}

function createPostWithReaderChat(): PostData {
  const readerChatSection =
    '## AI Chat — Claude Code · sonnet (2026-07-04)\n\n' +
    '> [!question] First question?\n\n' +
    'First answer.\n\n' +
    '> [!question] Second question?\n\n' +
    'Second answer.';

  return {
    platform: 'web',
    id: 'reader-chat',
    url: 'https://example.com/reader-chat',
    filePath: 'Social Archives/Web/2026/07/reader-chat.md',
    author: { name: 'Example Author', url: 'https://example.com/author' },
    content: {
      text: 'Article body.',
      markdown: `Article body.\n\n${readerChatSection}`,
    },
    comment: 'Saved reader note.',
    media: [],
    metadata: { timestamp: '2026-07-04T12:00:00.000Z' },
    readerChat: {
      headingLine: '## AI Chat — Claude Code · sonnet (2026-07-04)',
      section: readerChatSection,
    },
  };
}

function createCallbacks(): ReaderContentCallbacks {
  return {
    onClose: vi.fn(),
    onFontSizeChange: vi.fn(),
    onArchive: vi.fn(),
    onToggleLike: vi.fn(),
    onShare: vi.fn(),
    onTag: vi.fn(),
    onOpenNote: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    currentFontSize: 19,
    isArchived: false,
    isLiked: false,
    isShared: false,
    hasTags: false,
    showEdit: false,
    hasComment: false,
    onComment: vi.fn(),
    hasHighlights: false,
    highlightCount: 0,
  };
}

async function flushRenderQueue(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe('ReaderModeContentRenderer reader AI chat', () => {
  it('opens archived AI chat in the reader side panel without duplicating it in the body', async () => {
    markdownRenderSpy.mockClear();
    const app = {
      vault: { adapter: { getResourcePath: (path: string) => path } },
    } as App;
    const plugin = { app, settings: {} } as SocialArchiverPlugin;
    const modal = new Modal(app);
    document.body.appendChild(modal.contentEl);
    const renderer = new ReaderModeContentRenderer(
      app,
      plugin,
      new MediaGalleryRenderer((path) => path),
      new LinkPreviewRenderer(),
    );
    const post = createPostWithReaderChat();

    await renderer.render(modal.contentEl, post, 0, 1, createCallbacks());

    const body = modal.contentEl.querySelector<HTMLElement>('.sa-reader-mode-body');
    expect(body?.textContent).toContain('Article body.');
    expect(body?.textContent).not.toContain('## AI Chat');
    expect(body?.textContent).not.toContain('First answer.');

    const commentsButton = modal.contentEl.querySelector<HTMLElement>('.sa-reader-mode-comments-toggle');
    expect(commentsButton).toBeTruthy();
    expect(commentsButton?.getAttribute('title')).toBe('Show comments and AI chat');

    commentsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushRenderQueue();

    const panel = modal.contentEl.querySelector<HTMLElement>('.sa-reader-mode-comments-panel');
    expect(panel).toBeTruthy();

    const sections = Array.from(
      panel?.querySelectorAll<HTMLDetailsElement>('details.sa-reader-mode-comments-section') ?? [],
    );
    const sectionTitles = sections.map((section) => section.querySelector('summary')?.textContent ?? '');
    expect(sectionTitles).toEqual(expect.arrayContaining([
      expect.stringContaining('AI Chat'),
      expect.stringContaining('Note'),
    ]));

    const aiChatSection = sections.find((section) =>
      section.querySelector('summary')?.textContent?.includes('AI Chat'),
    );
    const noteSection = sections.find((section) =>
      section.querySelector('summary')?.textContent?.includes('Note'),
    );
    expect(aiChatSection?.open).toBe(true);
    expect(noteSection?.open).toBe(true);
    if (aiChatSection) aiChatSection.open = false;
    if (noteSection) noteSection.open = false;
    expect(aiChatSection?.open).toBe(false);
    expect(noteSection?.open).toBe(false);
    expect(panel?.querySelector('.sa-reader-mode-ai-chat-meta')?.textContent).toBe(
      'Claude Code · sonnet · 2026-07-04',
    );

    const userMessages = Array.from(
      panel?.querySelectorAll('.sa-reader-mode-ai-chat-message-user') ?? [],
    );
    const assistantMessages = Array.from(
      panel?.querySelectorAll('.sa-reader-mode-ai-chat-message-assistant') ?? [],
    );
    expect(userMessages).toHaveLength(2);
    expect(assistantMessages).toHaveLength(2);
    expect(userMessages[0]?.textContent).toContain('First question?');
    expect(userMessages[1]?.textContent).toContain('Second question?');
    expect(assistantMessages[0]?.textContent).toContain('First answer.');
    expect(assistantMessages[1]?.textContent).toContain('Second answer.');
  });
});

describe('ReaderModeContentRenderer social post body', () => {
  it('escapes a raw `<` but keeps a `\\<` the note already carries', async () => {
    markdownRenderSpy.mockClear();
    const app = {
      vault: { adapter: { getResourcePath: (path: string) => path } },
    } as App;
    const plugin = { app, settings: {} } as SocialArchiverPlugin;
    const modal = new Modal(app);
    document.body.appendChild(modal.contentEl);
    const renderer = new ReaderModeContentRenderer(
      app,
      plugin,
      new MediaGalleryRenderer((path) => path),
      new LinkPreviewRenderer(),
    );
    const post: PostData = {
      platform: 'x',
      id: 'escaped-post',
      url: 'https://x.com/someone/status/1',
      author: { name: 'Someone', url: 'https://x.com/someone' },
      content: { text: '\\<kept> and <raw>' },
      media: [],
      metadata: { timestamp: '2026-09-27T12:00:00.000Z' },
    };

    await renderer.render(modal.contentEl, post, 0, 1, createCallbacks());

    const bodyMarkdown = markdownRenderSpy.mock.calls
      .map((call) => call[1])
      .find((markdown) => markdown.includes('kept'));
    expect(bodyMarkdown).toBe('\\<kept&gt; and &lt;raw&gt;');
  });
});

describe('ReaderModeContentRenderer replies to the note', () => {
  it('shows a reply under the note with Continue chat, and leaves it out of the AI comments', async () => {
    const path = 'Social Archives/X/2026/11/replied.md';
    const chatMeta = (id: string, cli: AICommentMeta['cli']): AICommentMeta => ({
      id,
      cli,
      type: 'chat',
      generatedAt: '2026-11-05T00:00:00.000Z',
      processingTime: 1000,
      contentHash: 'abcd1234',
    });
    const reply = { meta: chatMeta(noteReplyCommentId('anthropic-api-chat-1', 'obsidian:client-1:primary'), 'anthropic-api'), content: '> [!question] Why? @Claude\n\nBecause of the survey.' };
    const chat = { meta: chatMeta('openai-api-chat-2', 'openai-api'), content: '> [!question] Ordinary?\n\nOrdinary answer.' };
    const note = appendAIComment(appendAIComment('Body', reply.meta, reply.content), chat.meta, chat.content);
    const file = new (TFile as unknown as new (p: string) => TFile)(path);
    const app = {
      vault: {
        adapter: { getResourcePath: (resource: string) => resource },
        getAbstractFileByPath: (candidate: string) => (candidate === path ? file : null),
        read: async () => note,
      },
    } as unknown as App;
    const plugin = { app, settings: { syncClientId: 'client-1' } } as unknown as SocialArchiverPlugin;
    const modal = new Modal(app);
    document.body.appendChild(modal.contentEl);
    const renderer = new ReaderModeContentRenderer(app, plugin, new MediaGalleryRenderer((resource) => resource), new LinkPreviewRenderer());
    const post: PostData = {
      platform: 'x',
      id: 'replied',
      url: 'https://x.com/a/status/2',
      filePath: path,
      author: { name: 'Ada', url: 'https://x.com/a' },
      content: { text: 'Article body.' },
      comment: 'Why? @Claude',
      aiComments: [reply, chat],
      media: [],
      metadata: { timestamp: '2026-11-05T00:00:00.000Z' },
    };
    const onContinueChat = vi.fn();

    await renderer.render(modal.contentEl, post, 0, 1, { ...createCallbacks(), onContinueChat });
    modal.contentEl.querySelector<HTMLElement>('.sa-reader-mode-comments-toggle')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushRenderQueue();

    const sections = [...modal.contentEl.querySelectorAll<HTMLElement>('details.sa-reader-mode-comments-section')];
    const section = (title: string) => sections.find((candidate) => candidate.querySelector('summary')?.textContent?.includes(title));
    const aiItems = [...(section('AI Comments')?.querySelectorAll('.sa-reader-mode-ai-comment') ?? [])];
    expect(aiItems.map((item) => item.textContent)).toEqual([expect.stringContaining('Ordinary answer.')]);

    const noteSection = section('Note');
    await vi.waitFor(() => expect(noteSection?.querySelector('.sa-note-reply-body')?.textContent).toBe('Because of the survey.'));
    noteSection?.querySelector<HTMLElement>('.ai-comment-continue-chat')?.click();
    expect(onContinueChat).toHaveBeenCalledWith({ id: reply.meta.id, content: reply.content });
  });
});
