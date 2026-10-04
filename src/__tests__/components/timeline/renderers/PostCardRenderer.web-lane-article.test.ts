import { describe, expect, it, vi } from 'vitest';
import type { App, Vault } from 'obsidian';
import { CommentRenderer } from '@/components/timeline/renderers/CommentRenderer';
import { LinkPreviewRenderer } from '@/components/timeline/renderers/LinkPreviewRenderer';
import { MediaGalleryRenderer } from '@/components/timeline/renderers/MediaGalleryRenderer';
import { PostCardRenderer } from '@/components/timeline/renderers/PostCardRenderer';
import { YouTubeEmbedRenderer } from '@/components/timeline/renderers/YouTubeEmbedRenderer';
import type SocialArchiverPlugin from '@/main';
import type { PostData } from '@/types/post';

/**
 * AI chat shares (feedback #139) come off the web lane: Defuddle markdown with
 * inline external images. The media-gallery gate already hides their gallery
 * (`isWebArticleWithInlineImages`), so `renderContent` must render them like a
 * `web` article too — title strip, leading `# Title` dropped from the body, and
 * the rawMarkdown body via `renderBlogContent`. Otherwise the card falls to the
 * social path: escaped, 300-char text and no images at all.
 */

vi.mock('obsidian', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('obsidian');

  class Component {
    register(): void {}
    registerEvent(): void {}
    addChild(): void {}
    load(): void {}
    unload(): void {}
  }

  return {
    ...actual,
    Component,
    // Echo the source so the test reads exactly the markdown that was rendered.
    MarkdownRenderer: {
      render: async (_app: unknown, source: string, element: HTMLElement): Promise<void> => {
        element.textContent = source;
      },
    },
  };
});

// Obsidian's `el.setText()`, which the title strip calls; test/setup.ts has no polyfill for it.
if (!('setText' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'setText', {
    configurable: true,
    writable: true,
    value(this: HTMLElement, text: string) {
      this.textContent = text;
    },
  });
}

interface ContentRenderer {
  renderContent(contentArea: HTMLElement, post: PostData): Promise<void>;
}

function createRenderer(): ContentRenderer {
  const vault = {
    adapter: { exists: vi.fn(async () => false) },
    getFileByPath: vi.fn(() => null),
    getAbstractFileByPath: vi.fn(() => null),
  } as unknown as Vault;
  const app = { vault, metadataCache: { getFileCache: vi.fn(() => null) }, workspace: {} } as unknown as App;
  const plugin = {
    app,
    settings: { username: 'tester' },
    events: { on: vi.fn(() => ({})), off: vi.fn() },
  } as unknown as SocialArchiverPlugin;

  const renderer = new PostCardRenderer(
    vault,
    app,
    plugin,
    new MediaGalleryRenderer((path) => path),
    new CommentRenderer(),
    new YouTubeEmbedRenderer(),
    new LinkPreviewRenderer(),
    new Map(),
  );
  // private by design; renderContent is the unit under test
  return renderer as unknown as ContentRenderer;
}

const TITLE = 'How attention works';
const BODY = '![Attention diagram](https://cdn.example.com/attention.png)\n\n1. Tokens become vectors.\n2. Attention mixes them.';

function makePost(platform: PostData['platform']): PostData {
  return {
    platform,
    id: 'p1',
    url: 'https://chatgpt.com/share/abc',
    title: TITLE,
    author: { name: 'ChatGPT', url: 'https://chatgpt.com' },
    content: { text: BODY, rawMarkdown: `# ${TITLE}\n\n${BODY}` },
    media: [],
    metadata: { timestamp: new Date('2026-09-15T00:00:00.000Z') },
  } as PostData;
}

describe('PostCardRenderer.renderContent — web-lane articles', () => {
  it.each(['web', 'chatgpt'] as const)('renders a %s archive with rawMarkdown as a blog article', async (platform) => {
    const container = document.createElement('div');
    await createRenderer().renderContent(container, makePost(platform));

    expect(container.querySelector('.blog-article-title')?.textContent).toBe(TITLE);
    // The rawMarkdown verbatim minus the heading the strip already shows,
    // not the social path's escaped (`1\.`) text.
    expect(container.querySelector('.sa-blog-content-inline')?.textContent).toBe(BODY);
  });
});
