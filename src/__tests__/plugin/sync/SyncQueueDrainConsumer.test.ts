import { describe, it, expect, vi } from 'vitest';
import { SyncQueueConsumer, type SyncQueueConsumerDeps } from '../../../plugin/sync/SyncQueueConsumer';
import type { UserArchive, WorkersAPIClient } from '../../../services/WorkersAPIClient';
import type { PostData } from '../../../types/post';

/**
 * Wiring tests for the runtime bootstrap of the v2 drain stack.
 *
 *  - v2 available  -> consume() routes through SyncQueueDrainService: fetch + save
 *    + idempotent v2 ACK (version token + persisted mutation id); v1 fallback untouched.
 *  - v2 absent (KV-legacy shape, no `hasMore`) -> byte-identical delegation to the
 *    unchanged v1 catch-up.
 *  - clearState() (unload / sign-out) is idempotent and re-arms detection.
 */

interface V2Item {
  queueId: string;
  archiveId: string;
  versionToken: string;
}

/** localStorage double that records the durable mutation-id lifecycle. */
class MemoryLocalStorage {
  readonly store = new Map<string, string>();
  loadLocalStorage(key: string): unknown {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  saveLocalStorage(key: string, data: unknown): void {
    if (data === null) this.store.delete(key);
    else this.store.set(key, String(data));
  }
}

/** A stateful v2 server whose ACK deletes the item (the drain's self-heal invariant). */
class FakeV2Server {
  private live: V2Item[];
  readonly acked: Array<{ queueId: string; versionToken: string; mutationId: string }> = [];
  listCalls: Array<{ cursor: string | null; limit: number }> = [];
  fetched: string[] = [];

  constructor(items: V2Item[]) {
    this.live = [...items];
  }

  getSyncQueueV2 = vi.fn(
    async (_clientId: string, options: { cursor?: string | null; limit?: number } = {}) => {
      this.listCalls.push({ cursor: options.cursor ?? null, limit: options.limit ?? 100 });
      return { items: this.live.map((i) => ({ ...i })), nextCursor: null, hasMore: false };
    },
  );

  getUserArchive = vi.fn(async (archiveId: string) => {
    this.fetched.push(archiveId);
    return { archive: { originalUrl: `https://example.com/${archiveId}` } as UserArchive };
  });

  ackSyncItemV2 = vi.fn(
    async (queueId: string, _clientId: string, versionToken: string, mutationId: string) => {
      this.acked.push({ queueId, versionToken, mutationId });
      this.live = this.live.filter((i) => i.queueId !== queueId);
      return { versionToken: `${versionToken}-next` };
    },
  );

  asApiClient(): WorkersAPIClient {
    return this as unknown as WorkersAPIClient;
  }
}

/** A KV-legacy server: it IGNORES protocolVersion and omits `hasMore` entirely. */
function legacyApiClient(): WorkersAPIClient {
  return {
    // No `hasMore` field — this is the graceful-degradation signal.
    getSyncQueueV2: vi.fn(async () => ({ items: [{ queueId: 'q1', archiveId: 'a1', versionToken: '' }] })),
    getUserArchive: vi.fn(),
    ackSyncItemV2: vi.fn(),
  } as unknown as WorkersAPIClient;
}

function makeConsumer(
  api: WorkersAPIClient | undefined,
  overrides: Partial<SyncQueueConsumerDeps> = {},
): { consumer: SyncQueueConsumer; runV1Fallback: ReturnType<typeof vi.fn>; saveSubscriptionPost: ReturnType<typeof vi.fn>; storage: MemoryLocalStorage } {
  const runV1Fallback = vi.fn(async () => undefined);
  const saveSubscriptionPost = vi.fn(async () => true);
  const storage = new MemoryLocalStorage();
  const consumer = new SyncQueueConsumer({
    apiClient: () => api,
    clientId: () => 'client-1',
    archivePath: () => 'Archives',
    localStorage: storage,
    saveSubscriptionPost,
    convertUserArchiveToPostData: () => ({}) as PostData,
    hasRecentlyArchivedUrl: () => false,
    refreshTimelineView: () => undefined,
    schedule: (cb, delay) => Number(setTimeout(cb, delay)),
    runV1Fallback,
    limits: { pageLimit: 10 },
    ...overrides,
  });
  return { consumer, runV1Fallback, saveSubscriptionPost, storage };
}

describe('SyncQueueConsumer (v2 drain bootstrap wiring)', () => {
  it('routes the entry point through the drain and ACKs v2 items with a settled mutation id', async () => {
    const server = new FakeV2Server([{ queueId: 'q1', archiveId: 'a1', versionToken: 'v1' }]);
    const { consumer, runV1Fallback, saveSubscriptionPost, storage } = makeConsumer(server.asApiClient());

    await consumer.consume();

    // Fetched + saved + ACKed through the drain, NOT the v1 catch-up.
    expect(server.fetched).toEqual(['a1']);
    expect(saveSubscriptionPost).toHaveBeenCalledTimes(1);
    expect(server.acked).toHaveLength(1);
    expect(server.acked[0]).toMatchObject({ queueId: 'q1', versionToken: 'v1' });
    expect(server.acked[0].mutationId).toBeTruthy();
    expect(runV1Fallback).not.toHaveBeenCalled();
    // The mutation id was persisted while in flight and settled (removed) after 2xx.
    expect(storage.store.size).toBe(0);
  });

  it('skips + ACKs a locally-deduplicated item without re-saving', async () => {
    const server = new FakeV2Server([{ queueId: 'q1', archiveId: 'a1', versionToken: 'v1' }]);
    const { consumer, saveSubscriptionPost } = makeConsumer(server.asApiClient(), {
      hasRecentlyArchivedUrl: () => true,
    });

    await consumer.consume();

    expect(saveSubscriptionPost).not.toHaveBeenCalled();
    expect(server.acked).toHaveLength(1); // duplicate still gets ACKed (deleted server-side)
  });

  it('falls back byte-identically to the v1 catch-up on a KV-legacy response', async () => {
    const api = legacyApiClient();
    const { consumer, runV1Fallback } = makeConsumer(api);

    await consumer.consume();

    expect(runV1Fallback).toHaveBeenCalledTimes(1);
    // Legacy items never reach the drain's fetch/ACK path.
    expect(api.getUserArchive).not.toHaveBeenCalled();
    expect(api.ackSyncItemV2).not.toHaveBeenCalled();
  });

  it('caches legacy detection: a second consume does not re-probe', async () => {
    const api = legacyApiClient();
    const { consumer, runV1Fallback } = makeConsumer(api);

    await consumer.consume();
    await consumer.consume();

    // Probe happened once; the second consume short-circuited to v1.
    expect(api.getSyncQueueV2).toHaveBeenCalledTimes(1);
    expect(runV1Fallback).toHaveBeenCalledTimes(2);
  });

  it('runs the v1 fallback (a no-op path) when no client id / api client is available', async () => {
    const { consumer, runV1Fallback } = makeConsumer(undefined);
    await consumer.consume();
    expect(runV1Fallback).toHaveBeenCalledTimes(1);
  });

  it('collapses a concurrent WS + poll drain into one single-flight processor', async () => {
    const server = new FakeV2Server([
      { queueId: 'q1', archiveId: 'a1', versionToken: 'v1' },
      { queueId: 'q2', archiveId: 'a2', versionToken: 'v2' },
    ]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let active = 0;
    let maxActive = 0;
    const { consumer } = makeConsumer(server.asApiClient(), {
      saveSubscriptionPost: vi.fn(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await gate;
        active -= 1;
        return true;
      }),
    });

    // WS-triggered + poll-triggered consume race through the SAME drain instance.
    const first = consumer.consume();
    const second = consumer.consume();
    await new Promise<void>((resolve) => setTimeout(resolve, 0)); // let both reach the gated save
    release();
    await Promise.all([first, second]);

    // The second drain saw inFlight and became a no-op — never a 2nd processor.
    expect(maxActive).toBe(1);
    // Each item processed + ACKed exactly once by the single shared drain.
    expect(server.acked.map((a) => a.queueId).sort()).toEqual(['q1', 'q2']);
  });

  it('clearState() is idempotent and re-arms detection after unload/sign-out', async () => {
    const api = legacyApiClient();
    const { consumer } = makeConsumer(api);

    await consumer.consume();            // probe #1 -> legacy, cached
    consumer.clearState();
    consumer.clearState();               // idempotent
    await consumer.consume();            // cache cleared -> probe #2

    expect(api.getSyncQueueV2).toHaveBeenCalledTimes(2);
  });
});
