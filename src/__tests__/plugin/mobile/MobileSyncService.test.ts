import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileSyncService, type MobileSyncServiceDeps } from '@/plugin/mobile/MobileSyncService';
import type { UserArchive, WorkersAPIClient } from '@/services/WorkersAPIClient';

type ApiClientMock = Pick<
  WorkersAPIClient,
  'getUserArchive' | 'ackSyncItem' | 'failSyncItem' | 'getSyncQueue'
>;

function makeArchive(overrides: Partial<UserArchive> = {}): UserArchive {
  return {
    id: 'archive-1',
    userId: 'user-1',
    platform: 'x',
    postId: 'post-1',
    originalUrl: 'https://x.com/example/status/post-1',
    title: 'Example archive',
    authorName: 'Example Author',
    authorHandle: 'example',
    authorUrl: 'https://x.com/example',
    authorAvatarUrl: null,
    previewText: null,
    fullContent: 'Example content',
    thumbnailUrl: null,
    thumbnailUrls: null,
    media: null,
    postedAt: '2026-07-01T00:00:00.000Z',
    archivedAt: '2026-07-01T00:01:00.000Z',
    likesCount: null,
    sharesCount: null,
    viewsCount: null,
    commentCount: null,
    metadata: null,
    isLiked: false,
    isBookmarked: false,
    isArchived: false,
    isShared: false,
    ...overrides,
  };
}

function makeArchiveNotFoundError(): Error & { code: string; status: number } {
  const error = new Error('Archive not found') as Error & { code: string; status: number };
  error.code = 'ARCHIVE_NOT_FOUND';
  error.status = 404;
  return error;
}

function makeApiClient(overrides: Partial<ApiClientMock> = {}): ApiClientMock {
  return {
    getUserArchive: vi.fn().mockResolvedValue({ archive: makeArchive() }),
    ackSyncItem: vi.fn().mockResolvedValue(undefined),
    failSyncItem: vi.fn().mockResolvedValue(undefined),
    getSyncQueue: vi.fn().mockResolvedValue({ items: [] }),
    ...overrides,
  };
}

function makeDeps(apiClient: ApiClientMock): MobileSyncServiceDeps {
  return {
    apiClient: () => apiClient as WorkersAPIClient,
    settings: () => ({ syncClientId: 'client-1', archivePath: 'Social Archives' }),
    saveSubscriptionPost: vi.fn().mockResolvedValue(true),
    convertUserArchiveToPostData: vi.fn(() => ({
      id: 'post-1',
      platform: 'x',
      url: 'https://x.com/example/status/post-1',
      title: 'Example archive',
      content: { text: 'Example content' },
      author: { name: 'Example Author', handle: 'example' },
      metadata: {},
    })),
    hasRecentlyArchivedUrl: vi.fn().mockReturnValue(false),
    refreshTimelineView: vi.fn(),
    suppressTimelineRefresh: vi.fn(),
    resumeTimelineRefresh: vi.fn(),
    schedule: vi.fn(() => 1),
    notify: vi.fn(),
  };
}

describe('MobileSyncService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('marks deleted sync queue archives failed without retrying the missing archive lookup', async () => {
    const apiClient = makeApiClient({
      getUserArchive: vi.fn().mockRejectedValue(makeArchiveNotFoundError()),
    });
    const deps = makeDeps(apiClient);
    const service = new MobileSyncService(deps);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const resultPromise = service.processSyncQueueItem('queue-1', 'deleted-archive', 'client-1');
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe(false);
    expect(apiClient.getUserArchive).toHaveBeenCalledTimes(1);
    expect(apiClient.failSyncItem).toHaveBeenCalledWith(
      'queue-1',
      'client-1',
      expect.stringContaining('deleted-archive'),
    );
    expect(apiClient.ackSyncItem).not.toHaveBeenCalled();
    expect(deps.saveSubscriptionPost).not.toHaveBeenCalled();
    expect(deps.schedule).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('not available yet'));
  });

  // v1.5 must stay unchanged for two stable releases while v2 draining ships
  // additively (Todo 34). This characterizes the legacy drain: an unpaged full
  // getSyncQueue list and a token-less ackSyncItem — no v2 pagination, no
  // per-item version token, no mutation id on the legacy path.
  it('maintains the v1.5 legacy drain: unpaged full list + token-less ack', async () => {
    const apiClient = makeApiClient({
      getSyncQueue: vi.fn().mockResolvedValue({
        items: [
          { queueId: 'queue-1', archiveId: 'archive-1', status: 'pending', clientId: 'client-1' },
        ],
      }),
    });
    const deps = makeDeps(apiClient);
    const service = new MobileSyncService(deps);

    const drain = service.processPendingSyncQueue();
    await vi.runAllTimersAsync();
    await drain;

    // Legacy read is the full unpaged list — no protocolVersion / cursor / limit.
    expect(apiClient.getSyncQueue).toHaveBeenCalledWith('client-1');
    expect((apiClient.getSyncQueue as ReturnType<typeof vi.fn>).mock.calls[0]).toHaveLength(1);
    // Legacy ack is queueId + clientId only — no version token, no mutation id.
    expect(apiClient.ackSyncItem).toHaveBeenCalledWith('queue-1', 'client-1');
  });
});
