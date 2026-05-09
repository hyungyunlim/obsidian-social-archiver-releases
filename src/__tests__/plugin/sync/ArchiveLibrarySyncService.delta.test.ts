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
    expect(settings.archiveLibrarySync.lastServerTime).toBe('2026-05-09T00:00:00.000Z');
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
});
