import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile, type App, type Vault } from 'obsidian';
import type SocialArchiverPlugin from '@/main';
import type { PostData } from '@/types/post';
import type { ThreadsConnectionStatus } from '@/types/crosspost';

/**
 * Deleting a cross-posted card also deletes its Threads copy — but only while
 * the server still has the Threads API. With `apiAvailable: false` (Meta
 * revoked access) the delete call could only fail, so it is skipped and the
 * user is told the copy is still on Threads.
 */

const notices = vi.hoisted(() => [] as string[]);
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
  class Notice {
    constructor(message: string) {
      notices.push(message);
    }
  }
  return { ...actual, Component, Scope, Notice, setIcon: () => undefined };
});

const client = vi.hoisted(() => ({
  getConnectionStatus: vi.fn<() => Promise<ThreadsConnectionStatus>>(),
  deletePlatformPost: vi.fn(async () => ({ deletedAt: '2026-11-23T00:00:00Z' })),
}));
vi.mock('@/services/CrossPostAPIClient', () => ({
  CrossPostAPIClient: class {
    initialize(): void {}
    getConnectionStatus = client.getConnectionStatus;
    deletePlatformPost = client.deletePlatformPost;
  },
}));

import { PostCardRenderer } from '@/components/timeline/renderers/PostCardRenderer';
import { CommentRenderer } from '@/components/timeline/renderers/CommentRenderer';
import { LinkPreviewRenderer } from '@/components/timeline/renderers/LinkPreviewRenderer';
import { MediaGalleryRenderer } from '@/components/timeline/renderers/MediaGalleryRenderer';
import { YouTubeEmbedRenderer } from '@/components/timeline/renderers/YouTubeEmbedRenderer';
import { __setLanguageForTests } from '@/i18n';
import { crossPostStrings } from '@/i18n/strings/crossPost';

const PATH = 'Social Archives/Post/2026/11/2026-11-20-090000.md';
const fileAt = (path: string): TFile => new (TFile as unknown as new (p: string) => TFile)(path);

async function deleteCrossPostedCard(): Promise<boolean> {
  const vault = {
    getAbstractFileByPath: (path: string) => (path === PATH ? fileAt(PATH) : null),
  } as unknown as Vault;
  const app = {
    vault,
    metadataCache: {
      getFileCache: () => ({ frontmatter: { crossPostId: 'xp_1', threadsPostId: 'th_1' } }),
    },
    fileManager: { trashFile: vi.fn(async () => undefined) },
    workspace: {},
  } as unknown as App;
  const plugin = {
    app,
    events: { on: () => ({}) },
    manifest: { version: '0.0.0-test' },
    settings: { authToken: 'token', workerUrl: 'https://api.example.com' },
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
    id: '2026-11-20-090000',
    url: PATH,
    filePath: PATH,
    author: { name: 'Owner', url: '' },
    content: { text: 'Hello' },
    media: [],
    metadata: { timestamp: new Date('2026-11-20T09:00:00Z') },
  } as unknown as PostData;
  return renderer.deletePostForBulk(post);
}

describe('PostCardRenderer — delete on Threads gate', () => {
  beforeEach(() => {
    __setLanguageForTests('en');
    notices.length = 0;
    client.getConnectionStatus.mockReset();
    client.deletePlatformPost.mockClear();
  });

  it('skips the Threads delete and says so when the server reports apiAvailable: false', async () => {
    client.getConnectionStatus.mockResolvedValue({ connected: false, apiAvailable: false });

    expect(await deleteCrossPostedCard()).toBe(true);

    await vi.waitFor(() => {
      expect(notices).toContain(crossPostStrings['xpost.deleteOnThreadsUnavailable'].en);
    });
    expect(client.deletePlatformPost).not.toHaveBeenCalled();
    expect(notices).not.toContain('Threads post also deleted');
  });

  it('still deletes the Threads copy when the server predates apiAvailable', async () => {
    client.getConnectionStatus.mockResolvedValue({ connected: true, username: 'owner' });

    expect(await deleteCrossPostedCard()).toBe(true);

    await vi.waitFor(() => {
      expect(notices).toContain('Threads post also deleted');
    });
    expect(client.deletePlatformPost).toHaveBeenCalledWith('xp_1', 'threads');
  });
});
