import { afterEach, describe, expect, it, vi } from 'vitest';
import { Menu, TFile, type App, type Vault } from 'obsidian';
import type SocialArchiverPlugin from '@/main';
import type { PostData } from '@/types/post';

/**
 * Edit post (prd-plugin-my-posts §6): shown only for composed post notes
 * (`isComposedPostNote` on the live frontmatter), never for meeting/audio
 * notes or other `post` notes, and it hands the note path to the timeline,
 * which opens it in Obsidian's editor.
 */

vi.mock('obsidian', async (importOriginal) => {
  const actual = await importOriginal<typeof import('obsidian')>();
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

const PATH = 'Social Archives/Post/2026/11/my-post.md';
const EDIT = 'Edit post';

function makeRenderer(frontmatter: Record<string, unknown>): PostCardRenderer {
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

const post: PostData = {
  platform: 'post',
  id: 'my-post',
  url: PATH,
  filePath: PATH,
  author: { name: 'Me', url: '' },
  content: { text: 'Hello' },
  media: [],
  metadata: { timestamp: '2026-11-08T00:00:00.000Z' },
} as PostData;

async function openMoreMenu(renderer: PostCardRenderer): Promise<Menu> {
  const bar = document.createElement('div');
  (renderer as unknown as {
    renderOverflowMenuButton(parent: HTMLElement, post: PostData, root: HTMLElement, isEmbedded: boolean): void;
  }).renderOverflowMenuButton(bar, post, document.createElement('div'), false);
  Menu.last = null;
  (bar.lastElementChild as HTMLElement).click();
  await vi.waitFor(() => expect(Menu.last?.items.at(-1)?.title).toBe('Delete'));
  return Menu.last!;
}

const titles = (menu: Menu) => menu.items.map((item) => item.title);

describe('PostCardRenderer — Edit post for composed notes', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is shown for a composed post note and opens it through the edit callback', async () => {
    const renderer = makeRenderer({ platform: 'post', postOrigin: 'composer' });
    const onEdit = vi.fn();
    renderer.onEditPost(onEdit);

    const menu = await openMoreMenu(renderer);
    expect(titles(menu)).toContain(EDIT);

    menu.select(EDIT);
    expect(onEdit).toHaveBeenCalledWith(post, PATH);
  });

  it('is hidden for meeting and audio notes, even when stamped postOrigin composer', async () => {
    for (const contentType of ['meeting-note', 'audio-note']) {
      const renderer = makeRenderer({ platform: 'post', postOrigin: 'composer', contentType });
      expect(titles(await openMoreMenu(renderer))).not.toContain(EDIT);
    }
  });

  it('is hidden for other platform post notes', async () => {
    expect(titles(await openMoreMenu(makeRenderer({ platform: 'post' })))).not.toContain(EDIT);
    expect(titles(await openMoreMenu(makeRenderer({ platform: 'post', postOrigin: 'shared' })))).not.toContain(EDIT);
  });

  it('gates the action-bar pencil the same way', () => {
    const hasEdit = (fm: Record<string, unknown>): boolean =>
      (makeRenderer(fm) as unknown as { isComposedPostFile(p: PostData): boolean }).isComposedPostFile(post);
    expect(hasEdit({ postOrigin: 'composer' })).toBe(true);
    expect(hasEdit({ postOrigin: 'composer', contentType: 'audio-note' })).toBe(false);
    expect(hasEdit({})).toBe(false);
  });
});
