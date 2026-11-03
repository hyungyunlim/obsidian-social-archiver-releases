/**
 * ArchiveLibrarySyncService — inline body image reconcile wiring
 * (inline image preservation PRD §6.3): Tier 1, Tier 2 and freshly saved notes.
 */

import { describe, expect, it, vi } from 'vitest';
import type { TFile } from 'obsidian';
import { ArchiveLibrarySyncService } from '../../../plugin/sync/ArchiveLibrarySyncService';
import type { ArchiveLibrarySyncDeps } from '../../../plugin/sync/ArchiveLibrarySyncService';
import type { SocialArchiverSettings } from '../../../types/settings';
import type { UserArchive, WorkersAPIClient } from '../../../services/WorkersAPIClient';
import type { PostData } from '../../../types/post';

const RECORD = {
  originalUrl: 'https://cdn.example.com/chart.png',
  r2Url: 'https://social-archiver-api.social-archive.org/media/archives/u/a/inline/i-0123456789abcdef.png',
  r2Key: 'archives/u/a/inline/i-0123456789abcdef.png',
  type: 'image' as const,
  size: 10,
  contentType: 'image/png',
  preservedAt: '2026-11-03T00:00:00.000Z',
};

function makeSettings(): SocialArchiverSettings {
  return {
    authToken: 'token',
    syncClientId: 'client-1',
    archivePath: 'Social Archives',
    archiveLibrarySync: {
      completedAt: '2026-05-01T00:00:00.000Z',
      resumeOffset: 0,
      runAnchorTime: '',
      lastServerTime: '2026-05-01T00:00:00.000Z',
      lastStatus: 'completed',
      lastError: '',
    },
  } as SocialArchiverSettings;
}

function makeArchive(overrides: Partial<UserArchive> = {}): UserArchive {
  return {
    id: 'archive-1',
    userId: 'user-1',
    platform: 'web',
    postId: 'post-1',
    originalUrl: 'https://example.com/story',
    title: 'Story',
    authorName: 'Writer',
    authorUrl: null,
    authorAvatarUrl: null,
    previewText: null,
    fullContent: `![Chart](${RECORD.originalUrl})`,
    thumbnailUrl: null,
    thumbnailUrls: null,
    media: null,
    postedAt: null,
    archivedAt: '2026-05-02T00:00:00.000Z',
    likesCount: null,
    commentCount: null,
    sharesCount: null,
    viewsCount: null,
    isLiked: false,
    isBookmarked: false,
    inlineMediaPreserved: [RECORD],
    ...overrides,
  } as UserArchive;
}

function makeFile(path: string): TFile {
  return {
    path,
    vault: { cachedRead: vi.fn().mockResolvedValue('---\nplatform: web\n---\nbody') },
  } as unknown as TFile;
}

function makeService(archive: UserArchive, overrides: Partial<ArchiveLibrarySyncDeps>) {
  const apiClient = {
    getUserArchives: vi.fn().mockResolvedValue({
      archives: [archive],
      total: 1,
      hasMore: false,
      serverTime: '2026-05-09T00:00:00.000Z',
      deletedIds: [],
    }),
  } as unknown as WorkersAPIClient;
  const reconcileInlineImageState = vi.fn().mockResolvedValue(undefined);
  const settings = makeSettings();
  const service = new ArchiveLibrarySyncService({
    apiClient: () => apiClient,
    settings: () => settings,
    saveSettings: vi.fn().mockResolvedValue(undefined),
    findBySourceArchiveId: vi.fn().mockReturnValue(null),
    findByOriginalUrl: vi.fn().mockReturnValue([]),
    findByClientPostId: vi.fn().mockReturnValue(null),
    indexSavedFile: vi.fn(),
    backfillFileIdentity: vi.fn().mockResolvedValue(undefined),
    saveSubscriptionPostDetailed: vi.fn().mockResolvedValue({ status: 'existing' }),
    convertUserArchiveToPostData: vi.fn().mockReturnValue({
      platform: 'web',
      url: archive.originalUrl,
      author: { name: 'Writer' },
      content: { text: 'body' },
    } as unknown as PostData),
    notify: vi.fn(),
    reconcileInlineImageState,
    ...overrides,
  });
  return { service, reconcileInlineImageState };
}

describe('ArchiveLibrarySyncService — inline image reconcile', () => {
  it('Tier 1: reconciles after a server-gate replacement, against the replaced note', async () => {
    const archive = makeArchive();
    const file = makeFile('Social Archives/story.md');
    const order: string[] = [];
    const replaceExistingLimitedArchive = vi.fn(async () => {
      order.push('replace');
      return { status: 'updated' as const, file };
    });
    const { service, reconcileInlineImageState } = makeService(archive, {
      findBySourceArchiveId: vi.fn().mockReturnValue(file),
      replaceExistingLimitedArchive,
    });
    reconcileInlineImageState.mockImplementation(async () => {
      order.push('inline');
    });

    await service.startDeltaSync();

    expect(reconcileInlineImageState).toHaveBeenCalledOnce();
    expect(reconcileInlineImageState).toHaveBeenCalledWith(file, archive);
    expect(order).toEqual(['replace', 'inline']);
  });

  it('Tier 2: reconciles the single URL match', async () => {
    const archive = makeArchive();
    const file = makeFile('Social Archives/story.md');
    const { service, reconcileInlineImageState } = makeService(archive, {
      findByOriginalUrl: vi.fn().mockReturnValue([file]),
    });

    await service.startDeltaSync();

    expect(reconcileInlineImageState).toHaveBeenCalledWith(file, archive);
  });

  it('saveArchive: reconciles a freshly written note', async () => {
    const archive = makeArchive();
    const file = makeFile('Social Archives/story.md');
    const { service, reconcileInlineImageState } = makeService(archive, {
      saveSubscriptionPostDetailed: vi.fn().mockResolvedValue({ status: 'created', file }),
    });

    await service.startDeltaSync();

    expect(reconcileInlineImageState).toHaveBeenCalledWith(file, archive);
  });

  it('skips archives without inline records, and survives a throwing reconciler', async () => {
    const file = makeFile('Social Archives/story.md');
    const withoutRecords = makeService(makeArchive({ inlineMediaPreserved: undefined }), {
      findBySourceArchiveId: vi.fn().mockReturnValue(file),
    });
    await withoutRecords.service.startDeltaSync();
    expect(withoutRecords.reconcileInlineImageState).not.toHaveBeenCalled();

    const throwing = makeService(makeArchive(), {
      findBySourceArchiveId: vi.fn().mockReturnValue(file),
    });
    throwing.reconcileInlineImageState.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await throwing.service.startDeltaSync();
    expect(throwing.service.getState()).toMatchObject({ phase: 'completed', failedCount: 0 });
    vi.restoreAllMocks();
  });
});
