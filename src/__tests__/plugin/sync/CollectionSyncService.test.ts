import { describe, expect, it, vi } from 'vitest';
import { CollectionStore, type KeyValueStorage } from '../../../services/collections/CollectionStore';
import {
  CollectionSyncService,
  CURSOR_OVERLAP_MS,
  SYNC_RETRY_DELAYS_MS,
  type CollectionsApi,
} from '../../../plugin/sync/CollectionSyncService';
import type { UserCollectionDTO } from '../../../types/collections';

class MemoryStorage implements KeyValueStorage {
  private readonly data = new Map<string, unknown>();
  load(key: string): unknown {
    return this.data.get(key) ?? null;
  }
  save(key: string, value: unknown): void {
    this.data.set(key, JSON.parse(JSON.stringify(value)));
  }
}

function dto(overrides: Partial<UserCollectionDTO> & { id: string }): UserCollectionDTO {
  return {
    name: overrides.id,
    description: null,
    visibility: 'private',
    shareToken: null,
    displayMode: 'timeline',
    includeAnnotations: true,
    sortOrder: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    role: 'owner',
    ...overrides,
  };
}

const SERVER_TIME = '2026-10-04T10:00:00.000Z';

function fakeApi(overrides: Partial<Record<keyof CollectionsApi, unknown>> = {}): CollectionsApi & { calls: string[] } {
  const calls: string[] = [];
  const api = {
    calls,
    deleteCollection: vi.fn(async (id: string) => {
      calls.push(`deleteCollection:${id}`);
      return { collectionId: id, deletedItemCount: 0, serverTime: SERVER_TIME };
    }),
    upsertCollections: vi.fn(async (collections: Array<{ id: string }>) => {
      calls.push(`upsertCollections:${collections.map((c) => c.id).join(',')}`);
      return { upserted: collections.length, serverTime: SERVER_TIME, resolvedCollections: [], rejected: [] };
    }),
    deleteCollectionItems: vi.fn(async (pairs: unknown[]) => {
      calls.push(`deleteCollectionItems:${pairs.length}`);
      return { deleted: pairs.length, serverTime: SERVER_TIME };
    }),
    upsertCollectionItems: vi.fn(async (items: Array<{ collectionId: string; archiveId: string }>) => {
      calls.push(`upsertCollectionItems:${items.map((i) => `${i.collectionId}/${i.archiveId}`).join(',')}`);
      return { upserted: items.length, serverTime: SERVER_TIME, skippedPairs: [] };
    }),
    getUserCollections: vi.fn(async (options: unknown) => {
      calls.push(`getUserCollections:${JSON.stringify(options)}`);
      return { collections: [], deletedIds: [], serverTime: SERVER_TIME, memberCollectionIds: [] };
    }),
    getUserCollectionItems: vi.fn(async (options: unknown) => {
      calls.push(`getUserCollectionItems:${JSON.stringify(options)}`);
      return { items: [], deletedPairs: [], serverTime: SERVER_TIME };
    }),
    ...overrides,
  };
  return api as unknown as CollectionsApi & { calls: string[] };
}

interface Harness {
  store: CollectionStore;
  api: CollectionsApi & { calls: string[] };
  sync: CollectionSyncService;
  timers: Array<{ callback: () => void; delay: number; cancelled: boolean }>;
}

function harness(api = fakeApi()): Harness {
  const store = new CollectionStore(new MemoryStorage());
  store.switchUser('alice');
  const timers: Harness['timers'] = [];
  const sync = new CollectionSyncService({
    store,
    api: () => api,
    isAuthenticated: () => true,
    schedule: (callback, delay) => {
      timers.push({ callback, delay, cancelled: false });
      return timers.length - 1;
    },
    cancel: (handle) => {
      const timer = timers[handle];
      if (timer) timer.cancelled = true;
    },
  });
  return { store, api, sync, timers };
}

describe('CollectionSyncService', () => {
  it('pushes deletes, collections, item deletes and items before pulling', async () => {
    const { store, api, sync } = harness();
    store.applyRemoteCollections({ collections: [dto({ id: 'col-gone0001' }), dto({ id: 'col-kept0001' })], deletedIds: [], serverTime: 't0' });
    store.deleteCollection('col-gone0001');
    store.removeItems('col-kept0001', ['arch-9']);
    store.createCollection({ id: 'col-new00001', name: 'New', description: null, sortOrder: 2 });
    store.addItems('col-kept0001', ['arch-1']);

    await sync.performSync();

    expect(api.calls.map((call) => call.split(':')[0])).toEqual([
      'deleteCollection',
      'upsertCollections',
      'deleteCollectionItems',
      'upsertCollectionItems',
      'getUserCollections',
      'getUserCollectionItems',
    ]);
    expect(store.getPendingCollectionDeletes()).toEqual([]);
    expect(store.getPendingItemDeletes()).toEqual([]);
  });

  it('pushes items of a new collection in the same pass, after the collection', async () => {
    const { store, api, sync } = harness();
    store.createCollection({ id: 'col-new00001', name: 'New', description: null, sortOrder: 0 });
    store.addItems('col-new00001', ['arch-1']);
    await sync.pushNow();
    expect(api.calls).toEqual(['upsertCollections:col-new00001', 'upsertCollectionItems:col-new00001/arch-1']);
    expect(store.getCollection('col-new00001')).toMatchObject({ synced: true, isDirty: false });
  });

  it('remaps a resolved collection before pushing its items under the canonical id', async () => {
    const api = fakeApi({
      upsertCollections: vi.fn(async () => ({
        upserted: 0,
        serverTime: SERVER_TIME,
        resolvedCollections: [{ requestedId: 'col-local01', canonicalCollection: dto({ id: 'col-server1', name: 'Trips' }) }],
        rejected: [],
      })),
    });
    const { store, sync } = harness(api);
    store.createCollection({ id: 'col-local01', name: 'Trips', description: null, sortOrder: 0 });
    store.addItems('col-local01', ['arch-1']);
    await sync.pushNow();
    expect(api.upsertCollectionItems).toHaveBeenCalledWith([{ collectionId: 'col-server1', archiveId: 'arch-1' }]);
    expect(store.resolveId('col-local01')).toBe('col-server1');
  });

  it('forgets a rejected collection and never pushes its items', async () => {
    const api = fakeApi({
      upsertCollections: vi.fn(async () => ({
        upserted: 0,
        serverTime: SERVER_TIME,
        resolvedCollections: [],
        rejected: [{ id: 'col-over001', code: 'COLLECTION_LIMIT_REACHED' }],
      })),
    });
    const { store, sync } = harness(api);
    store.createCollection({ id: 'col-over001', name: 'One too many', description: null, sortOrder: 0 });
    store.addItems('col-over001', ['arch-1']);
    await sync.pushNow();
    expect(store.getCollection('col-over001')).toBeUndefined();
    expect(api.upsertCollectionItems).not.toHaveBeenCalled();
  });

  it('drops pairs the server skipped and marks the rest clean', async () => {
    const api = fakeApi({
      upsertCollectionItems: vi.fn(async () => ({
        upserted: 1,
        serverTime: SERVER_TIME,
        skippedPairs: [{ collectionId: 'col-aaaaaaaa', archiveId: 'arch-2', reason: 'COLLECTION_FORBIDDEN' }],
      })),
    });
    const { store, sync } = harness(api);
    store.applyRemoteCollections({ collections: [dto({ id: 'col-aaaaaaaa' })], deletedIds: [], serverTime: 't0' });
    store.addItems('col-aaaaaaaa', ['arch-1', 'arch-2']);
    await sync.pushNow();
    expect(store.getArchiveIds('col-aaaaaaaa')).toEqual(['arch-1']);
    expect(store.getPushableItems()).toEqual([]);
  });

  it('treats a 404 on a queued collection delete as done', async () => {
    const notFound = Object.assign(new Error('gone'), { status: 404 });
    const api = fakeApi({ deleteCollection: vi.fn(async () => { throw notFound; }) });
    const { store, sync } = harness(api);
    store.applyRemoteCollections({ collections: [dto({ id: 'col-aaaaaaaa' })], deletedIds: [], serverTime: 't0' });
    store.deleteCollection('col-aaaaaaaa');
    const result = await sync.performSync();
    expect(result.error).toBeUndefined();
    expect(store.getPendingCollectionDeletes()).toEqual([]);
  });

  it('pulls everything on a fresh device, then from the cursor minus the overlap', async () => {
    const api = fakeApi({
      getUserCollections: vi.fn(async () => ({ collections: [dto({ id: 'col-aaaaaaaa' })], deletedIds: [], serverTime: SERVER_TIME, memberCollectionIds: [] })),
    });
    const { sync } = harness(api);
    await sync.performSync();
    expect(api.getUserCollections).toHaveBeenLastCalledWith({});

    await sync.performSync();
    const expected = new Date(Date.parse(SERVER_TIME) - CURSOR_OVERLAP_MS).toISOString();
    expect(api.getUserCollections).toHaveBeenLastCalledWith({ updatedAfter: expected, includeDeleted: true });
  });

  it('shares one queued pass between callers that arrive mid-pass, then runs fresh passes again', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const api = fakeApi({
      getUserCollections: vi.fn(async () => {
        await gate;
        return { collections: [], deletedIds: [], serverTime: SERVER_TIME, memberCollectionIds: [] };
      }),
    });
    const { sync } = harness(api);
    const first = sync.performSync();
    const second = sync.performSync();
    const third = sync.performSync();
    expect(second).toBe(third);
    release();
    await Promise.all([first, second, third]);
    expect(api.getUserCollections).toHaveBeenCalledTimes(2);

    // After both settled, a new call must run a new pass (regression: the queue used to wedge).
    await sync.performSync();
    expect(api.getUserCollections).toHaveBeenCalledTimes(3);
  });

  it('retries a failed pass with backoff and stops after the last delay', async () => {
    const api = fakeApi({ getUserCollections: vi.fn(async () => { throw new Error('offline'); }) });
    const { sync, timers } = harness(api);
    const result = await sync.performSync();
    expect(result.error).toBe('offline');

    for (const expectedDelay of SYNC_RETRY_DELAYS_MS) {
      const pending = timers.filter((timer) => !timer.cancelled);
      expect(pending.at(-1)?.delay).toBe(expectedDelay);
      const timer = pending.at(-1)!;
      timer.cancelled = true;
      timer.callback();
      await vi.waitFor(() => expect(timers.filter((t) => !t.cancelled).length).toBeGreaterThanOrEqual(0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    // Regression: the retry used to restart at 5 s forever.
    expect(timers.filter((timer) => !timer.cancelled)).toEqual([]);
    expect(api.getUserCollections).toHaveBeenCalledTimes(1 + SYNC_RETRY_DELAYS_MS.length);
  });

  it('does not write into another account when the user switches mid-pass', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const api = fakeApi({
      getUserCollections: vi.fn(async () => {
        await gate;
        return { collections: [dto({ id: 'col-alice01' })], deletedIds: [], serverTime: SERVER_TIME, memberCollectionIds: [] };
      }),
    });
    const { store, sync } = harness(api);
    const pass = sync.performSync();
    store.switchUser('bob');
    release();
    await pass;
    expect(store.getCollections()).toEqual([]);
  });

  it('skips the pass while signed out', async () => {
    const api = fakeApi();
    const { store, sync } = harness(api);
    store.switchUser(null);
    await sync.performSync();
    expect(api.calls).toEqual([]);
  });
});
