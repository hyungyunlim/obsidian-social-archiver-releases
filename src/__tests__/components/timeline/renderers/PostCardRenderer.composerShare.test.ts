import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile, type App, type Vault } from 'obsidian';
import type SocialArchiverPlugin from '@/main';
import type { PostData } from '@/types/post';

/**
 * Sharing a composer note from its card (or reader mode) names the composed
 * row — its clientPostId — even before the note's create syncs. Unnamed, the
 * server had no row to link the share to: the row came up without share_url,
 * edits never reached the public page, and library sync then cleared the
 * note's share fields.
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
  class Scope {
    register(): void {}
  }
  return { ...actual, Component, Scope, setIcon: () => undefined };
});

const createShare = vi.hoisted(() => vi.fn());
vi.mock('@/services/ShareAPIClient', () => ({
  ShareAPIClient: class {
    createShare = createShare;
  },
}));

import { PostCardRenderer } from '@/components/timeline/renderers/PostCardRenderer';
import { CommentRenderer } from '@/components/timeline/renderers/CommentRenderer';
import { LinkPreviewRenderer } from '@/components/timeline/renderers/LinkPreviewRenderer';
import { MediaGalleryRenderer } from '@/components/timeline/renderers/MediaGalleryRenderer';
import { YouTubeEmbedRenderer } from '@/components/timeline/renderers/YouTubeEmbedRenderer';

const PATH = 'Social Archives/Post/2026/10/2026-10-06-183000.md';
const POST_ID = 'post_4f1c2a9e-7b3d-4c55-9a10-2e8f6d7c1b00';
/** The test mock's TFile takes a path; obsidian's typings don't. */
const fileAt = (path: string): TFile => new (TFile as unknown as new (p: string) => TFile)(path);

/** Shares the note from its card and returns the options the share request carried. */
async function shareFromCard(frontmatter: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
  const vault = {
    getAbstractFileByPath: () => fileAt(PATH),
    read: async () => '---\nplatform: post\n---\n\nHello from the composer',
  } as unknown as Vault;
  const app = {
    vault,
    metadataCache: { getFileCache: () => ({ frontmatter }) },
    fileManager: { processFrontMatter: async (_file: TFile, mutate: (fm: Record<string, unknown>) => void) => mutate({}) },
    workspace: {},
  } as unknown as App;
  const plugin = {
    app,
    events: { on: () => ({}) },
    manifest: { version: '0.0.0-test' },
    settings: {
      isVerified: true,
      authToken: 'token',
      username: 'owner',
      workerUrl: 'https://api.example.com',
      shareMode: 'full',
      tier: 'free',
      copyShareLinkAsReaderMode: false,
    },
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
  const post = {
    platform: 'post',
    id: '2026-10-06-183000',
    url: PATH,
    filePath: PATH,
    author: { name: 'owner', url: '' },
    content: { text: 'Hello from the composer' },
    media: [],
    metadata: { timestamp: '2026-10-06T09:30:00.000Z' },
  } as unknown as PostData;

  await renderer.toggleShareForReader(post);

  expect(createShare).toHaveBeenCalledTimes(1);
  return (createShare.mock.calls[0]?.[0] as { options?: Record<string, unknown> }).options;
}

describe('PostCardRenderer share — composer notes', () => {
  beforeEach(() => {
    createShare.mockReset().mockResolvedValue({
      shareId: 'share-1',
      shareUrl: 'https://social-archive.org/owner/share-1',
      passwordProtected: false,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => undefined },
    });
  });

  it('names the composed row before the create syncs', async () => {
    const options = await shareFromCard({ postOrigin: 'composer', clientPostId: POST_ID, syncState: 'pending' });

    expect(options?.['sourceArchiveId']).toBe(POST_ID);
  });

  it('names the same row once it has synced', async () => {
    const options = await shareFromCard({
      postOrigin: 'composer', clientPostId: POST_ID, sourceArchiveId: POST_ID, syncState: 'synced',
    });

    expect(options?.['sourceArchiveId']).toBe(POST_ID);
  });

  it('names no row for a post with no server identity', async () => {
    const options = await shareFromCard({ platform: 'post' });

    expect(options?.['sourceArchiveId']).toBeUndefined();
  });
});
