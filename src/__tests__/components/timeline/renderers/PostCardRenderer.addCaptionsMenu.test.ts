import { afterEach, describe, expect, it, vi } from 'vitest';
import { Menu, TFile, type App, type Vault } from 'obsidian';
import type SocialArchiverPlugin from '@/main';
import type { PostData } from '@/types/post';

/**
 * Cards carry no inline "Add captions…" (thousands of caption-less archives
 * would clutter the feed); the card's "…" menu offers the reader's picker for a
 * linked YouTube note instead.
 */

vi.mock('obsidian', async (importOriginal) => {
  const actual = await importOriginal<typeof import('obsidian')>();
  // The shared mock's MenuItem has no setWarning; the menu's Delete item uses it.
  Object.assign(actual.MenuItem.prototype, { setWarning(this: unknown) { return this; } });
  class Component {
    register(): void {}
    registerEvent(): void {}
    addChild(): void {}
    load(): void {}
    unload(): void {}
  }
  class Notice {
    hide(): void {}
  }
  return { ...actual, Component, Notice, setIcon: () => undefined };
});

import { PostCardRenderer } from '@/components/timeline/renderers/PostCardRenderer';
import { CommentRenderer } from '@/components/timeline/renderers/CommentRenderer';
import { LinkPreviewRenderer } from '@/components/timeline/renderers/LinkPreviewRenderer';
import { MediaGalleryRenderer } from '@/components/timeline/renderers/MediaGalleryRenderer';
import { YouTubeEmbedRenderer } from '@/components/timeline/renderers/YouTubeEmbedRenderer';
import { CaptionLanguageSuggestModal } from '@/components/timeline/modals/CaptionLanguageSuggestModal';

const PATH = 'Social Archives/YouTube/2026/10/video.md';
const ADD_CAPTIONS = 'Add captions…';

const listAvailable = vi.fn();

function makeRenderer(frontmatter: Record<string, unknown> = {}): PostCardRenderer {
  const file = new (TFile as unknown as new (p: string) => TFile)(PATH);
  const vault = {
    getAbstractFileByPath: (path: string) => (path === PATH ? file : null),
    getFileByPath: (path: string) => (path === PATH ? file : null),
  } as unknown as Vault;
  const app = { vault, metadataCache: { getFileCache: () => ({ frontmatter }) }, workspace: {} } as unknown as App;
  const plugin = {
    app,
    events: { on: () => ({}) },
    manifest: { version: '0.0.0-test' },
    settings: { aiComment: {} },
    workersApiClient: { getArchiveContentVariants: async () => ({ variants: [] }) },
    captionVariantSyncService: { listAvailable },
  } as unknown as SocialArchiverPlugin;
  return new PostCardRenderer(
    vault, app, plugin,
    new MediaGalleryRenderer((path) => path),
    new CommentRenderer(),
    new YouTubeEmbedRenderer(),
    new LinkPreviewRenderer(),
    new Map(),
  );
}

const post = (overrides: Partial<PostData> = {}): PostData => ({
  platform: 'youtube',
  id: 'video',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  filePath: PATH,
  sourceArchiveId: 'archive-1',
  author: { name: 'Creator', url: '' },
  content: { text: '' },
  media: [],
  metadata: { timestamp: '2026-10-09T00:00:00.000Z' },
  ...overrides,
}) as PostData;

/** Opens the card's "…" menu and returns it once every item is in. */
async function openMoreMenu(renderer: PostCardRenderer, target: PostData, isEmbedded = false): Promise<Menu> {
  const bar = document.createElement('div');
  (renderer as unknown as {
    renderOverflowMenuButton(parent: HTMLElement, post: PostData, root: HTMLElement, isEmbedded: boolean): void;
  }).renderOverflowMenuButton(bar, target, document.createElement('div'), isEmbedded);
  Menu.last = null;
  (bar.lastElementChild as HTMLElement).click();
  await vi.waitFor(() => expect(Menu.last?.items.at(-1)?.title).toBe('Delete'));
  return Menu.last!;
}

const titles = (menu: Menu) => menu.items.map((item) => item.title);

describe('PostCardRenderer "…" menu — Add captions…', () => {
  afterEach(() => {
    listAvailable.mockReset();
    vi.restoreAllMocks();
  });

  it('opens the caption picker for a linked YouTube note', async () => {
    const open = vi.spyOn(CaptionLanguageSuggestModal.prototype, 'open').mockImplementation(() => undefined);
    listAvailable.mockResolvedValue({
      primary: null,
      tracks: [{ language: 'en', kind: 'manual', name: null, state: 'available' }],
    });

    const menu = await openMoreMenu(makeRenderer(), post());
    expect(menu.items.find((item) => item.title === ADD_CAPTIONS)?.icon).toBe('captions');

    menu.select(ADD_CAPTIONS);
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(listAvailable).toHaveBeenCalledWith(expect.objectContaining({ path: PATH }), 'archive-1');
  });

  it('shows for a note that already has a transcript, and one linked only through its frontmatter', async () => {
    const withTranscript = post({ transcript: { formatted: [{ start_time: 0, end_time: 1, duration: 1, text: 'Hi' }] } });
    expect(titles(await openMoreMenu(makeRenderer(), withTranscript))).toContain(ADD_CAPTIONS);

    const linkedByFrontmatter = makeRenderer({ sourceArchiveId: 'archive-2' });
    expect(titles(await openMoreMenu(linkedByFrontmatter, post({ sourceArchiveId: undefined })))).toContain(ADD_CAPTIONS);
  });

  it('is absent for an unlinked note, another platform, and an embedded card', async () => {
    expect(titles(await openMoreMenu(makeRenderer(), post({ sourceArchiveId: undefined })))).not.toContain(ADD_CAPTIONS);
    expect(titles(await openMoreMenu(makeRenderer(), post({ platform: 'tiktok' })))).not.toContain(ADD_CAPTIONS);
    expect(titles(await openMoreMenu(makeRenderer(), post(), true))).not.toContain(ADD_CAPTIONS);
  });
});
