import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileSyncService, type MobileSyncServiceDeps } from '@/plugin/mobile/MobileSyncService';
import type { UserArchive, WorkersAPIClient } from '@/services/WorkersAPIClient';
import type { SyncRateLimitGate } from '@/plugin/sync/SyncRateLimitCoordinator';

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

function makeRateLimitError(retryAfterSeconds = 60): Error {
  const error = new Error('Too many requests') as Error & {
    status: number;
    code: string;
    details: unknown;
  };
  error.status = 429;
  error.code = 'RATE_LIMIT_EXCEEDED';
  error.details = { retryAfter: retryAfterSeconds };
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

function makeDeps(
  apiClient: ApiClientMock,
  overrides: Partial<MobileSyncServiceDeps> = {},
): MobileSyncServiceDeps {
  return {
    apiClient: () => apiClient as WorkersAPIClient,
    settings: () => ({ syncClientId: 'client-1', archivePath: 'Social Archives' }),
    saveSubscriptionPost: vi.fn().mockResolvedValue(true),
    convertUserArchiveToPostData: vi.fn(() => ({
      id: 'post-1',
      platform: 'x' as const,
      url: 'https://x.com/example/status/post-1',
      title: 'Example archive',
      content: { text: 'Example content' },
      author: { name: 'Example Author', url: 'https://x.com/example', handle: 'example' },
      media: [],
      metadata: { timestamp: '2026-07-01T00:00:00.000Z' },
    })),
    hasRecentlyArchivedUrl: vi.fn().mockReturnValue(false),
    refreshTimelineView: vi.fn(),
    suppressTimelineRefresh: vi.fn(),
    resumeTimelineRefresh: vi.fn(),
    schedule: vi.fn(() => 1),
    notify: vi.fn(),
    ...overrides,
  };
}

describe('MobileSyncService — 429 handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('leaves the queue item pending on 429 — never failSyncItem — and schedules a retry', async () => {
    const apiClient = makeApiClient({
      getUserArchive: vi.fn().mockRejectedValue(makeRateLimitError(60)),
    });
    const deps = makeDeps(apiClient);
    const service = new MobileSyncService(deps);

    const result = await service.processSyncQueueItem('queue-1', 'archive-1', 'client-1');

    expect(result).toBe(false);
    // failSyncItem would strand the item: GET /api/sync/queue only returns
    // 'pending' and the plugin never calls the retry endpoint.
    expect(apiClient.failSyncItem).not.toHaveBeenCalled();
    expect(apiClient.ackSyncItem).not.toHaveBeenCalled();
    // Retry honors the server Retry-After (60s > 30s floor).
    expect(deps.schedule).toHaveBeenCalledWith(expect.any(Function), 60_000);
  });

  it('applies the 30s floor when Retry-After is shorter', async () => {
    const apiClient = makeApiClient({
      getUserArchive: vi.fn().mockRejectedValue(makeRateLimitError(5)),
    });
    const deps = makeDeps(apiClient);
    const service = new MobileSyncService(deps);

    await service.processSyncQueueItem('queue-1', 'archive-1', 'client-1');

    expect(deps.schedule).toHaveBeenCalledWith(expect.any(Function), 30_000);
  });

  it('reports the 429 to the shared rate limiter', async () => {
    const rateLimiter: SyncRateLimitGate = {
      acquire: vi.fn().mockResolvedValue(undefined),
      reportRateLimited: vi.fn(),
    };
    const rateLimitError = makeRateLimitError(60);
    const apiClient = makeApiClient({
      getUserArchive: vi.fn().mockRejectedValue(rateLimitError),
    });
    const service = new MobileSyncService(makeDeps(apiClient, { rateLimiter }));

    await service.processSyncQueueItem('queue-1', 'archive-1', 'client-1');

    expect(rateLimiter.reportRateLimited).toHaveBeenCalledWith(rateLimitError);
  });

  it('treats a rate-limited ack as pending too (no failSyncItem after a saved vault file)', async () => {
    const apiClient = makeApiClient({
      ackSyncItem: vi.fn().mockRejectedValue(makeRateLimitError(60)),
    });
    const deps = makeDeps(apiClient);
    const service = new MobileSyncService(deps);

    const result = await service.processSyncQueueItem('queue-1', 'archive-1', 'client-1');

    expect(result).toBe(false);
    expect(apiClient.failSyncItem).not.toHaveBeenCalled();
    expect(deps.schedule).toHaveBeenCalled();
  });

  it('stops the catch-up batch at the first 429 and emits ONE summary notice', async () => {
    const apiClient = makeApiClient({
      getSyncQueue: vi.fn().mockResolvedValue({
        items: [
          { queueId: 'q1', archiveId: 'a1', status: 'pending' },
          { queueId: 'q2', archiveId: 'a2', status: 'pending' },
          { queueId: 'q3', archiveId: 'a3', status: 'pending' },
        ],
      }),
      getUserArchive: vi.fn().mockRejectedValue(makeRateLimitError(60)),
    });
    const deps = makeDeps(apiClient);
    const service = new MobileSyncService(deps);

    await service.processPendingSyncQueue();

    // Batch stopped after the first rate-limited item — the exhausted bucket
    // is not hammered with q2/q3.
    expect(apiClient.getUserArchive).toHaveBeenCalledTimes(1);
    expect(apiClient.failSyncItem).not.toHaveBeenCalled();

    // Exactly one summary notice for the whole deferred batch.
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith(
      expect.stringContaining('3 archive(s) will retry automatically'),
      expect.any(Number),
    );
  });

  it('collapses generic per-item failures into one summary notice in batch mode', async () => {
    const apiClient = makeApiClient({
      getSyncQueue: vi.fn().mockResolvedValue({
        items: [
          { queueId: 'q1', archiveId: 'a1', status: 'pending' },
          { queueId: 'q2', archiveId: 'a2', status: 'pending' },
        ],
      }),
    });
    const deps = makeDeps(apiClient, {
      saveSubscriptionPost: vi.fn().mockResolvedValue(false),
    });
    const service = new MobileSyncService(deps);

    await service.processPendingSyncQueue();

    // Generic failures still fail the item server-side (unchanged behavior)…
    expect(apiClient.failSyncItem).toHaveBeenCalledTimes(2);
    // …but the user sees one summary instead of a notice per item.
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith(
      expect.stringContaining('Failed to sync 2 archive(s)'),
      expect.any(Number),
    );
  });

  it('acquires a token before each archive fetch when a limiter is wired', async () => {
    const rateLimiter: SyncRateLimitGate = {
      acquire: vi.fn().mockResolvedValue(undefined),
      reportRateLimited: vi.fn(),
    };
    const apiClient = makeApiClient();
    const service = new MobileSyncService(makeDeps(apiClient, { rateLimiter }));

    await service.processSyncQueueItem('queue-1', 'archive-1', 'client-1');

    expect(rateLimiter.acquire).toHaveBeenCalledTimes(1);
  });
});
