import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ArchiveLibrarySyncService,
  type ArchiveLibrarySyncDeps,
} from '@/plugin/sync/ArchiveLibrarySyncService';
import type { SocialArchiverSettings } from '@/types/settings';
import type { SyncRateLimitGate } from '@/plugin/sync/SyncRateLimitCoordinator';

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

function makeRateLimitError(retryAfterSeconds?: number): Error {
  const error = new Error('Too many requests') as Error & {
    status: number;
    code: string;
    details?: unknown;
  };
  error.status = 429;
  error.code = 'RATE_LIMIT_EXCEEDED';
  if (retryAfterSeconds !== undefined) {
    error.details = { retryAfter: retryAfterSeconds };
  }
  return error;
}

interface ArchivePage {
  archives: never[];
  total: number;
  hasMore: boolean;
  serverTime: string;
  deletedIds: never[];
}

function makeEmptyPage(): ArchivePage {
  return {
    archives: [],
    total: 0,
    hasMore: false,
    serverTime: '2026-05-09T00:00:00.000Z',
    deletedIds: [],
  };
}

function makeService(
  apiClient: { getUserArchives: ReturnType<typeof vi.fn> },
  rateLimiter?: SyncRateLimitGate,
): ArchiveLibrarySyncService {
  const settings = makeSettings();
  const deps: ArchiveLibrarySyncDeps = {
    apiClient: () => apiClient as never,
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
    rateLimiter,
  };
  return new ArchiveLibrarySyncService(deps);
}

describe('ArchiveLibrarySyncService — 429 Retry-After handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('waits out the server Retry-After instead of the 1s exponential ladder', async () => {
    const apiClient = {
      getUserArchives: vi
        .fn()
        .mockRejectedValueOnce(makeRateLimitError(30))
        .mockResolvedValue(makeEmptyPage()),
    };
    const service = makeService(apiClient);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const run = service.startDeltaSync();

    // The old exponential ladder would have retried after 1s.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(apiClient.getUserArchives).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(26_000);
    await run;

    expect(apiClient.getUserArchives).toHaveBeenCalledTimes(2);
    expect(service.getState().phase).toBe('completed');
  });

  it('reports 429s to the shared rate limiter and acquires before each attempt', async () => {
    const rateLimiter: SyncRateLimitGate = {
      acquire: vi.fn().mockResolvedValue(undefined),
      reportRateLimited: vi.fn(),
    };
    const rateLimitError = makeRateLimitError(1);
    const apiClient = {
      getUserArchives: vi
        .fn()
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValue(makeEmptyPage()),
    };
    const service = makeService(apiClient, rateLimiter);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const run = service.startDeltaSync();
    await vi.advanceTimersByTimeAsync(1_100);
    await run;

    expect(rateLimiter.reportRateLimited).toHaveBeenCalledWith(rateLimitError);
    expect(rateLimiter.acquire).toHaveBeenCalledTimes(2);
  });

  it('keeps the exponential ladder for non-rate-limit errors', async () => {
    const apiClient = {
      getUserArchives: vi
        .fn()
        .mockRejectedValueOnce(new Error('transient network error'))
        .mockResolvedValue(makeEmptyPage()),
    };
    const service = makeService(apiClient);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const run = service.startDeltaSync();
    await vi.advanceTimersByTimeAsync(1_100);
    await run;

    expect(apiClient.getUserArchives).toHaveBeenCalledTimes(2);
    expect(service.getState().phase).toBe('completed');
  });

  it('uses the 15s rate-limit fallback when the 429 carries no Retry-After', async () => {
    const apiClient = {
      getUserArchives: vi
        .fn()
        .mockRejectedValueOnce(makeRateLimitError())
        .mockResolvedValue(makeEmptyPage()),
    };
    const service = makeService(apiClient);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const run = service.startDeltaSync();

    await vi.advanceTimersByTimeAsync(14_000);
    expect(apiClient.getUserArchives).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(31_000);
    await run;
    expect(apiClient.getUserArchives).toHaveBeenCalledTimes(2);
  });
});
