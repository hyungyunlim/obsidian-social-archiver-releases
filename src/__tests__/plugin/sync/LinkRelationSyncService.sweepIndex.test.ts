import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import {
  LinkRelationSyncService,
  type LinkRelationSyncDeps,
} from '@/plugin/sync/LinkRelationSyncService';
import type { WorkersAPIClient } from '@/services/WorkersAPIClient';
import type { ArchiveLookupService } from '@/services/ArchiveLookupService';
import type { LinkedArchivesRenderer } from '@/services/LinkedArchivesRenderer';
import type { LinkedArchivesSectionManager } from '@/services/LinkedArchivesSectionManager';
import type { SocialArchiverSettings } from '@/types/settings';
import type { ArchiveLinkRelation } from '@/types/link-relations';
import type { SyncRateLimitGate } from '@/plugin/sync/SyncRateLimitCoordinator';

type ApiClientMock = Pick<
  WorkersAPIClient,
  'getArchiveLinkRelations' | 'getLinkRelationsUpdatedAfter'
>;

function makeRelation(overrides: Partial<ArchiveLinkRelation> = {}): ArchiveLinkRelation {
  return {
    id: 'rel-1',
    sourceArchiveId: 'a1',
    targetArchiveId: 'a2',
    targetUrl: 'https://x.com/example/status/1',
    normalizedTargetUrl: 'https://x.com/example/status/1',
    relationType: 'plain_url',
    status: 'connected',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRateLimitError(retryAfterSeconds = 2): Error {
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

// The runtime obsidian mock's TFile constructor takes a path, while the real
// typings declare a 0-arg constructor — construct through a cast so both the
// compiler and the vitest runtime are satisfied.
const TFileCtor = TFile as unknown as new (path: string) => TFile;

function makeFile(path: string): TFile {
  return new TFileCtor(path);
}

interface Harness {
  service: LinkRelationSyncService;
  apiClient: ApiClientMock;
  deps: LinkRelationSyncDeps;
}

function makeHarness(overrides: {
  apiClient?: Partial<ApiClientMock>;
  rateLimiter?: SyncRateLimitGate;
  localArchiveIds?: string[];
} = {}): Harness {
  const localArchiveIds = overrides.localArchiveIds ?? ['a1', 'a2', 'a3'];

  const apiClient: ApiClientMock = {
    getArchiveLinkRelations: vi.fn().mockResolvedValue([]),
    getLinkRelationsUpdatedAfter: vi
      .fn()
      .mockResolvedValue({ relations: [], serverTime: '2026-07-01T00:00:00.000Z' }),
    ...overrides.apiClient,
  };

  const archiveLookup = {
    findBySourceArchiveId: vi.fn((id: string) =>
      localArchiveIds.includes(id) ? makeFile(`${id}.md`) : null,
    ),
  } as unknown as ArchiveLookupService;

  const app = {
    vault: {
      read: vi.fn().mockResolvedValue('# Note body\n'),
      modify: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as App;

  const renderer = {
    render: vi.fn().mockReturnValue('<!-- linked-archives -->'),
  } as unknown as LinkedArchivesRenderer;

  const sectionManager = {
    upsert: vi.fn((content: string) => content),
  } as unknown as LinkedArchivesSectionManager;

  const deps: LinkRelationSyncDeps = {
    app,
    apiClient: () => apiClient as WorkersAPIClient,
    archiveLookup: () => archiveLookup,
    renderer,
    sectionManager,
    settings: () =>
      ({ enableLinkedArchivesSection: true }) as unknown as SocialArchiverSettings,
    saveSettings: vi.fn().mockResolvedValue(undefined),
    rateLimiter: overrides.rateLimiter,
  };

  return { service: new LinkRelationSyncService(deps), apiClient, deps };
}

describe('LinkRelationSyncService — library-sweep relation index', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('skips every per-archive GET when the user has no relations (one bulk request total)', async () => {
    const { service, apiClient } = makeHarness();

    await service.applyForArchiveFromLibrarySweep('a1');
    await service.applyForArchiveFromLibrarySweep('a2');
    await service.applyForArchiveFromLibrarySweep('a3');

    expect(apiClient.getLinkRelationsUpdatedAfter).toHaveBeenCalledTimes(1);
    expect(apiClient.getArchiveLinkRelations).not.toHaveBeenCalled();
  });

  it('fetches per-archive relations only for archives present in the index', async () => {
    const { service, apiClient } = makeHarness({
      apiClient: {
        getLinkRelationsUpdatedAfter: vi.fn().mockResolvedValue({
          relations: [makeRelation({ sourceArchiveId: 'a1', targetArchiveId: 'a2' })],
          serverTime: '2026-07-01T00:00:00.000Z',
        }),
      },
    });

    await service.applyForArchiveFromLibrarySweep('a1');
    await service.applyForArchiveFromLibrarySweep('a2');
    await service.applyForArchiveFromLibrarySweep('a3');

    expect(apiClient.getArchiveLinkRelations).toHaveBeenCalledTimes(2);
    expect(apiClient.getArchiveLinkRelations).toHaveBeenCalledWith('a1');
    expect(apiClient.getArchiveLinkRelations).toHaveBeenCalledWith('a2');
    expect(apiClient.getArchiveLinkRelations).not.toHaveBeenCalledWith('a3');
  });

  it('skips per-archive fetches entirely (no flood fallback) when priming fails', async () => {
    const { service, apiClient } = makeHarness({
      apiClient: {
        getLinkRelationsUpdatedAfter: vi.fn().mockResolvedValue(null),
      },
    });

    await service.applyForArchiveFromLibrarySweep('a1');
    await service.applyForArchiveFromLibrarySweep('a2');

    expect(apiClient.getArchiveLinkRelations).not.toHaveBeenCalled();
    // Failed prime is cached — not re-attempted once per archive.
    expect(apiClient.getLinkRelationsUpdatedAfter).toHaveBeenCalledTimes(1);
  });

  it('acquires a token from the shared rate limiter for bulk and per-archive requests', async () => {
    const rateLimiter: SyncRateLimitGate = {
      acquire: vi.fn().mockResolvedValue(undefined),
      reportRateLimited: vi.fn(),
    };
    const { service } = makeHarness({
      rateLimiter,
      apiClient: {
        getLinkRelationsUpdatedAfter: vi.fn().mockResolvedValue({
          relations: [makeRelation({ sourceArchiveId: 'a1', targetArchiveId: null })],
          serverTime: '2026-07-01T00:00:00.000Z',
        }),
      },
    });

    await service.applyForArchiveFromLibrarySweep('a1');

    // 1 bulk prime page + 1 per-archive fetch.
    expect(rateLimiter.acquire).toHaveBeenCalledTimes(2);
  });

  it('admits archives touched by WS relation events into a primed index', async () => {
    const { service, apiClient } = makeHarness();

    // Prime with zero relations.
    await service.applyForArchiveFromLibrarySweep('a1');
    expect(apiClient.getArchiveLinkRelations).not.toHaveBeenCalled();

    // WS event lands mid-sweep for a3 → a1.
    await service.handleRelationUpdated(
      makeRelation({ sourceArchiveId: 'a3', targetArchiveId: 'a1' }),
    );
    (apiClient.getArchiveLinkRelations as ReturnType<typeof vi.fn>).mockClear();

    await service.applyForArchiveFromLibrarySweep('a3');
    expect(apiClient.getArchiveLinkRelations).toHaveBeenCalledWith('a3');
  });
});

describe('LinkRelationSyncService — 429 backoff on per-archive fetch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reports 429s to the shared limiter and retries through it', async () => {
    const rateLimiter: SyncRateLimitGate = {
      acquire: vi.fn().mockResolvedValue(undefined),
      reportRateLimited: vi.fn(),
    };
    const rateLimitError = makeRateLimitError(1);
    const { service, apiClient } = makeHarness({
      rateLimiter,
      apiClient: {
        getArchiveLinkRelations: vi
          .fn()
          .mockRejectedValueOnce(rateLimitError)
          .mockResolvedValue([]),
      },
    });

    await service.applyForArchive('a1');

    expect(apiClient.getArchiveLinkRelations).toHaveBeenCalledTimes(2);
    expect(rateLimiter.reportRateLimited).toHaveBeenCalledWith(rateLimitError);
  });

  it('waits out Retry-After between attempts when no limiter is wired', async () => {
    const { service, apiClient } = makeHarness({
      apiClient: {
        getArchiveLinkRelations: vi
          .fn()
          .mockRejectedValueOnce(makeRateLimitError(2))
          .mockResolvedValue([]),
      },
    });

    const pending = service.applyForArchive('a1');
    await vi.advanceTimersByTimeAsync(2_100);
    await pending;

    expect(apiClient.getArchiveLinkRelations).toHaveBeenCalledTimes(2);
  });

  it('gives up after max attempts on persistent 429s without throwing', async () => {
    const rateLimiter: SyncRateLimitGate = {
      acquire: vi.fn().mockResolvedValue(undefined),
      reportRateLimited: vi.fn(),
    };
    const { service, apiClient, deps } = makeHarness({
      rateLimiter,
      apiClient: {
        getArchiveLinkRelations: vi.fn().mockRejectedValue(makeRateLimitError(1)),
      },
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(service.applyForArchive('a1')).resolves.toBeUndefined();

    expect(apiClient.getArchiveLinkRelations).toHaveBeenCalledTimes(3);
    expect(warnSpy).toHaveBeenCalled();
    expect((deps.app as unknown as { vault: { modify: unknown } }).vault.modify).not.toHaveBeenCalled();
  });

  it('does not retry non-rate-limit errors', async () => {
    const { service, apiClient } = makeHarness({
      apiClient: {
        getArchiveLinkRelations: vi.fn().mockRejectedValue(new Error('server exploded')),
      },
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await service.applyForArchive('a1');

    expect(apiClient.getArchiveLinkRelations).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
  });
});
