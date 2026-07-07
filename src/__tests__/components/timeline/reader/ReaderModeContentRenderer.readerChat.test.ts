import { describe, expect, it, vi } from 'vitest';
import { Modal, type App } from 'obsidian';
import { LinkPreviewRenderer } from '@/components/timeline/renderers/LinkPreviewRenderer';
import { MediaGalleryRenderer } from '@/components/timeline/renderers/MediaGalleryRenderer';
import { ReaderModeContentRenderer } from '@/components/timeline/reader/ReaderModeContentRenderer';
import type { ReaderContentCallbacks } from '@/components/timeline/reader/ReaderModeContentRenderer';
import type SocialArchiverPlugin from '@/main';
import type { PostData } from '@/types/post';

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
