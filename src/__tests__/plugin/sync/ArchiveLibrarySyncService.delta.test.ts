import { describe, expect, it, vi } from 'vitest';
import { ArchiveLibrarySyncService } from '../../../plugin/sync/ArchiveLibrarySyncService';
import type { SocialArchiverSettings } from '../../../types/settings';
import type { UserArchive } from '../../../services/WorkersAPIClient';

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
    platform: 'x',
    postId: 'post-1',
    originalUrl: 'https://example.com/post/1',
    title: 'Example post',
    authorName: 'Author',
    authorUrl: null,
    authorAvatarUrl: null,
    previewText: 'Preview',
    fullContent: 'Content',
    thumbnailUrl: null,
    thumbnailUrls: null,
    media: null,
    postedAt: null,
    archivedAt: '2026-05-02T00:00:00.000Z',
    likesCount: null,
    commentCount: null,
    sharesCount: null,
    viewsCount: null,
    metadata: null,
    isLiked: false,
    isBookmarked: true,
    isArchived: true,
    isShared: false,
    ...overrides,
  };
}

describe('ArchiveLibrarySyncService delta catch-up', () => {
  it('fetches updates since lastServerTime and advances the server high-water mark', async () => {
    const settings = makeSettings();
    const archive = makeArchive();
    const apiClient = {
      getUserArchives: vi.fn().mockResolvedValue({
        archives: [archive],
        total: 1,
        hasMore: false,
        serverTime: '2026-05-09T00:00:00.000Z',
        deletedIds: ['deleted-archive'],
      }),
    };
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const saveSubscriptionPostDetailed = vi.fn().mockResolvedValue({
      status: 'created',
      file: { path: 'Social Archives/example.md' },
    });
    const applyInboundDeletedIds = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn();

    const service = new ArchiveLibrarySyncService({
      apiClient: () => apiClient as any,
      settings: () => settings,
      saveSettings,
      findBySourceArchiveId: vi.fn().mockReturnValue(null),
      findByOriginalUrl: vi.fn().mockReturnValue([]),
      findByClientPostId: vi.fn().mockReturnValue(null),
      indexSavedFile: vi.fn(),
      backfillFileIdentity: vi.fn().mockResolvedValue(undefined),
      saveSubscriptionPostDetailed,
      convertUserArchiveToPostData: vi.fn().mockReturnValue({
        platform: 'x',
        url: archive.originalUrl,
        author: { name: 'Author' },
        content: { text: 'Content' },
      }),
      notify,
      applyInboundDeletedIds,
    });

    await service.startDeltaSync();

    expect(apiClient.getUserArchives).toHaveBeenCalledWith({
      limit: 50,
      offset: 0,
      updatedAfter: '2026-05-01T00:00:00.000Z',
      includeDeleted: true,
    });
    expect(saveSubscriptionPostDetailed).toHaveBeenCalledOnce();
    expect(applyInboundDeletedIds).toHaveBeenCalledWith(['deleted-archive'], 'delta');
    // Advances to the sweep's first-page serverTime (2026-05-09T00:00:00Z),
    // held back one LIBRARY_SYNC_CURSOR_OVERLAP_MS so a row stamped just under
    // that instant — but not yet visible when the page was read — is still
    // above the cursor next run.
    expect(settings.archiveLibrarySync.lastServerTime).toBe('2026-05-08T23:50:00.000Z');
    expect(settings.archiveLibrarySync.lastStatus).toBe('completed');
    expect(settings.archiveLibrarySync.lastError).toBe('');
    expect(service.getState()).toMatchObject({
      mode: 'delta-catch-up',
      phase: 'completed',
      savedCount: 1,
      currentOffset: 1,
    });
    expect(notify).toHaveBeenCalledWith('Library sync complete: 1 new archive saved.', 5000);
  });

  it('skips locally-deleted (tombstoned) archives at Tier 0.5 without saving', async () => {
    const settings = makeSettings();
    const archive = makeArchive();
    const apiClient = {
      getUserArchives: vi.fn().mockResolvedValue({
        archives: [archive],
        total: 1,
        hasMore: false,
        serverTime: '2026-05-09T00:00:00.000Z',
        deletedIds: [],
      }),
    };
    const saveSubscriptionPostDetailed = vi.fn();
    const isArchiveTombstoned = vi.fn().mockReturnValue(true);

    const service = new ArchiveLibrarySyncService({
      apiClient: () => apiClient as any,
      settings: () => settings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      findBySourceArchiveId: vi.fn().mockReturnValue(null),
      findByOriginalUrl: vi.fn().mockReturnValue([]),
      findByClientPostId: vi.fn().mockReturnValue(null),
      indexSavedFile: vi.fn(),
      backfillFileIdentity: vi.fn().mockResolvedValue(undefined),
      saveSubscriptionPostDetailed,
      convertUserArchiveToPostData: vi.fn(),
      notify: vi.fn(),
      isArchiveTombstoned,
      applyInboundDeletedIds: vi.fn().mockResolvedValue(undefined),
    });

    await service.startDeltaSync();

    expect(isArchiveTombstoned).toHaveBeenCalledWith(archive);
    expect(saveSubscriptionPostDetailed).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject({
      phase: 'completed',
      savedCount: 0,
      skippedCount: 1,
    });
  });

  it('falls back to bootstrap sync when no delta high-water mark exists', async () => {
    const settings = makeSettings();
    settings.archiveLibrarySync.completedAt = '';
    settings.archiveLibrarySync.lastServerTime = '';

    const apiClient = {
      getUserArchives: vi
        .fn()
        .mockResolvedValueOnce({
          archives: [],
          total: 0,
          hasMore: false,
          serverTime: '2026-05-09T00:00:00.000Z',
        })
        .mockResolvedValueOnce({
          archives: [],
          total: 0,
          hasMore: false,
          serverTime: '2026-05-09T00:00:01.000Z',
          deletedIds: [],
        }),
    };

    const service = new ArchiveLibrarySyncService({
      apiClient: () => apiClient as any,
      settings: () => settings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      findBySourceArchiveId: vi.fn().mockReturnValue(null),
      findByOriginalUrl: vi.fn().mockReturnValue([]),
      findByClientPostId: vi.fn().mockReturnValue(null),
      indexSavedFile: vi.fn(),
      backfillFileIdentity: vi.fn().mockResolvedValue(undefined),
      saveSubscriptionPostDetailed: vi.fn().mockResolvedValue({ status: 'skipped' }),
      convertUserArchiveToPostData: vi.fn(),
      notify: vi.fn(),
      applyInboundDeletedIds: vi.fn().mockResolvedValue(undefined),
    });

    await service.startDeltaSync();

    expect(apiClient.getUserArchives.mock.calls[0]?.[0]).toEqual({
      limit: 50,
      offset: 0,
    });
    expect(service.getState()).toMatchObject({
      mode: 'bootstrap',
      phase: 'completed',
    });
  });

  it('reconciles existing action state even when limited archive replacement throws', async () => {
    const settings = makeSettings();
    const archive = makeArchive({ isBookmarked: true, isLiked: false });
    const file = { path: 'Social Archives/example.md', extension: 'md' } as any;
    const apiClient = {
      getUserArchives: vi.fn().mockResolvedValue({
        archives: [archive],
        total: 1,
        hasMore: false,
        serverTime: '2026-05-09T00:00:00.000Z',
      }),
    };
    const reconcileArchiveState = vi.fn().mockResolvedValue(undefined);
    const reconcileLikeState = vi.fn().mockResolvedValue(undefined);
    const replaceExistingLimitedArchive = vi.fn().mockRejectedValue(new Error('replacement failed'));

    const service = new ArchiveLibrarySyncService({
      apiClient: () => apiClient as any,
      settings: () => settings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      findBySourceArchiveId: vi.fn().mockReturnValue(file),
      findByOriginalUrl: vi.fn().mockReturnValue([]),
      findByClientPostId: vi.fn().mockReturnValue(null),
      indexSavedFile: vi.fn(),
      backfillFileIdentity: vi.fn().mockResolvedValue(undefined),
      saveSubscriptionPostDetailed: vi.fn().mockResolvedValue({ status: 'skipped' }),
      replaceExistingLimitedArchive,
      convertUserArchiveToPostData: vi.fn().mockReturnValue({
        platform: 'x',
        url: archive.originalUrl,
        author: { name: 'Author' },
        content: { text: 'Content' },
      }),
      notify: vi.fn(),
      reconcileArchiveState,
      reconcileLikeState,
    });

    await service.startDeltaSync();

    expect(reconcileArchiveState).toHaveBeenCalledTimes(2);
    expect(reconcileArchiveState).toHaveBeenCalledWith(file, archive.id, true);
    expect(reconcileLikeState).toHaveBeenCalledTimes(2);
    expect(reconcileLikeState).toHaveBeenCalledWith(file, archive.id, false);
    expect(replaceExistingLimitedArchive).toHaveBeenCalledOnce();
    expect(service.getState()).toMatchObject({
      phase: 'completed',
      failedCount: 0,
      skippedCount: 1,
    });
  });
});

// A count on its own tells the user something is wrong but not which notes to
// look at, and the paths only ever reached the developer console. This is the
// `patrickng` / `Patrick Ng` pair: one post, two files, sync declining to guess.
describe('ArchiveLibrarySyncService ambiguous matches', () => {
  const duplicates = [
    { path: 'Social Archives/Instagram/2026-07-24 - patrickng - Southwark (cZoIRW).md' },
    { path: 'Social Archives/Instagram/2026-07-24 - Patrick Ng - Southwark (cZoIRW).md' },
  ];

  function makeService(findByOriginalUrl: unknown, saveSubscriptionPostDetailed = vi.fn()) {
    const archive = makeArchive();
    return new ArchiveLibrarySyncService({
      apiClient: () => ({
        getUserArchives: vi.fn().mockResolvedValue({
          archives: [archive],
          total: 1,
          hasMore: false,
          serverTime: '2026-05-09T00:00:00.000Z',
          deletedIds: [],
        }),
      }) as any,
      settings: () => makeSettings(),
      saveSettings: vi.fn().mockResolvedValue(undefined),
      findBySourceArchiveId: vi.fn().mockReturnValue(null),
      findByOriginalUrl,
      findByClientPostId: vi.fn().mockReturnValue(null),
      indexSavedFile: vi.fn(),
      backfillFileIdentity: vi.fn().mockResolvedValue(undefined),
      saveSubscriptionPostDetailed,
      convertUserArchiveToPostData: vi.fn().mockReturnValue({
        platform: 'x',
        url: archive.originalUrl,
        author: { name: 'Author' },
        content: { text: 'Content' },
      }),
      notify: vi.fn(),
      applyInboundDeletedIds: vi.fn().mockResolvedValue(undefined),
    } as any);
  }

  it('reports which notes collided instead of only counting them', async () => {
    const saveSubscriptionPostDetailed = vi.fn();
    const service = makeService(vi.fn().mockReturnValue(duplicates), saveSubscriptionPostDetailed);

    await service.startDeltaSync();

    // Still refuses to guess — only the user knows which note holds their work.
    expect(saveSubscriptionPostDetailed).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject({
      ambiguousCount: 1,
      ambiguousMatches: [{
        url: 'https://example.com/post/1',
        paths: duplicates.map((f) => f.path),
      }],
    });
  });

  it('leaves no stale report when nothing collided', async () => {
    const service = makeService(vi.fn().mockReturnValue([]));

    await service.startDeltaSync();

    expect(service.getState()).toMatchObject({ ambiguousCount: 0, ambiguousMatches: [] });
  });
});
