import { describe, expect, it, vi } from 'vitest';
import { TFile, type App, type Vault } from 'obsidian';
import { ComposedPostSyncService } from '@/plugin/sync/ComposedPostSyncService';
import type { WorkersAPIClient } from '@/services/WorkersAPIClient';
import type { SocialArchiverSettings } from '@/types/settings';

/**
 * A composer note can be shared before its create lands. The server links a
 * share that named the composed row; one from plugin 4.9.0 or earlier named
 * none, so the create links the note's share itself. Unlinked, library sync
 * reads the post as unshared and clears the note's share fields.
 */

const POST_ID = 'post_4f1c2a9e-7b3d-4c55-9a10-2e8f6d7c1b00';
const SHARE_URL = 'https://social-archive.org/owner/legacy-share';

/** A composer note as savePost writes it. */
const NOTE = [
  '---',
  'platform: post',
  'author: owner',
  'published: 2026-10-06 18:30',
  'postOrigin: composer',
  `clientPostId: ${POST_ID}`,
  '---',
  '',
  'Hello from the composer',
  '',
  '---',
  '',
  '**Author:** owner | **Published:** 2026-10-06 18:30',
  '',
].join('\n');

function harness(
  frontmatter: Record<string, unknown>,
  updateArchiveActions: () => Promise<unknown> = async () => ({ success: true }),
) {
  // The test mock's TFile takes a path; obsidian's typings don't.
  const file = new (TFile as unknown as new (p: string) => TFile)('Social Archives/Post/2026/10/2026-10-06-183000.md');
  const fm = { platform: 'post', author: 'owner', published: '2026-10-06 18:30', ...frontmatter };
  const app = {
    metadataCache: { getFileCache: () => ({ frontmatter: fm }) },
    fileManager: {
      processFrontMatter: async (_file: TFile, mutate: (current: Record<string, unknown>) => void) => mutate(fm),
    },
  } as unknown as App;
  const read = async (): Promise<string> => NOTE;
  const vault = {
    getFileByPath: () => file,
    read,
    cachedRead: read,
  } as unknown as Vault;
  const api = {
    createComposedPost: vi.fn(async () => ({ archiveId: POST_ID, createdAt: '2026-10-07T00:00:00.000Z' })),
    updateArchiveActions: vi.fn(updateArchiveActions),
  };
  const settings = {
    pendingComposedPostSyncs: [{
      op: 'create', filePath: file.path, clientPostId: POST_ID, queuedAt: '2026-10-06T09:30:00.000Z', retryCount: 0,
    }],
  } as unknown as SocialArchiverSettings;
  const sync = new ComposedPostSyncService(app, vault, settings, api as unknown as WorkersAPIClient, async () => undefined);
  return { sync, api, settings, fm };
}

describe('composed create — the note was shared first', () => {
  it('links the note’s share to the new row', async () => {
    const h = harness({ postOrigin: 'composer', clientPostId: POST_ID, share: true, shareUrl: SHARE_URL });

    await h.sync.flush();

    expect(h.api.updateArchiveActions).toHaveBeenCalledWith(POST_ID, { shareUrl: SHARE_URL });
    expect(h.settings.pendingComposedPostSyncs).toEqual([]);
  });

  it('sends nothing more for a note that isn’t shared', async () => {
    const h = harness({ postOrigin: 'composer', clientPostId: POST_ID });

    await h.sync.flush();

    expect(h.api.createComposedPost).toHaveBeenCalledTimes(1);
    expect(h.api.updateArchiveActions).not.toHaveBeenCalled();
  });

  it('keeps the create when linking fails', async () => {
    const h = harness(
      { postOrigin: 'composer', clientPostId: POST_ID, share: true, shareUrl: SHARE_URL },
      async () => { throw new Error('offline'); },
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await h.sync.flush();

    expect(h.fm).toMatchObject({ sourceArchiveId: POST_ID, syncState: 'synced' });
    expect(h.settings.pendingComposedPostSyncs).toEqual([]);
    warn.mockRestore();
  });
});
