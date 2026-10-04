import type { WorkersAPIClient } from '../../services/WorkersAPIClient';
import type { CollectionStore } from '../../services/collections/CollectionStore';
import { COLLECTION_LIMITS, type CollectionItemPair } from '../../types/collections';

/**
 * Collection sync (prd-collections-obsidian-plugin O3) — the desktop
 * algorithm, one pass at a time:
 *
 *   1. pending collection deletes
 *   2. dirty collections (remap `resolvedCollections`, apply `rejected`) —
 *      before any item, so items never point at an id the server rejected
 *   3. pending item deletes
 *   4. dirty items whose collection the server knows (drop `skippedPairs`)
 *   5. pull collections (cursor − 10 s, deletions, membership list)
 *   6. pull items (cursor kept when an item names an unknown collection)
 *
 * A pass requested while one runs queues exactly one more, so an event that
 * arrives mid-pass is never lost and bursts don't stack passes.
 */

export type CollectionsApi = Pick<
  WorkersAPIClient,
  | 'getUserCollections'
  | 'upsertCollections'
  | 'deleteCollection'
  | 'getUserCollectionItems'
  | 'upsertCollectionItems'
  | 'deleteCollectionItems'
>;

export interface CollectionSyncResult {
  pushedCollections: number;
  pushedItems: number;
  /** Set when a step failed; the pass stops there and the next one resumes. */
  error?: string;
}

export interface CollectionSyncDeps {
  store: CollectionStore;
  api: () => CollectionsApi | null | undefined;
  isAuthenticated: () => boolean;
  /** window.setTimeout-compatible scheduler (tracked by the plugin so unload clears it). */
  schedule: (callback: () => void, delayMs: number) => number;
  cancel: (handle: number) => void;
}

/** Re-read slightly before the cursor: rows written while the last pull ran must not slip past. */
export const CURSOR_OVERLAP_MS = 10_000;
/** Backoff for a failed pass; realtime events and the foreground catch-up take over after. */
export const SYNC_RETRY_DELAYS_MS = [5_000, 20_000, 60_000] as const;
/** Coalesce a burst of local edits into one push. */
export const PUSH_DEBOUNCE_MS = 1_500;

const isNotFound = (error: unknown): boolean => readStatus(error) === 404;
const readStatus = (error: unknown): number | undefined =>
  error && typeof error === 'object' ? (error as { status?: number }).status : undefined;
const readCode = (error: unknown): string | undefined =>
  error && typeof error === 'object' ? (error as { code?: string }).code : undefined;
const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function overlapCursor(cursor: string | null): string | undefined {
  if (!cursor) return undefined;
  const time = Date.parse(cursor);
  if (!Number.isFinite(time)) return undefined;
  return new Date(Math.max(0, time - CURSOR_OVERLAP_MS)).toISOString();
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

export class CollectionSyncService {
  private running: Promise<CollectionSyncResult> | null = null;
  private queued: Promise<CollectionSyncResult> | null = null;
  private pushTimer: number | null = null;
  private retryTimer: number | null = null;
  /** Index into SYNC_RETRY_DELAYS_MS for the next retry; past the end = stop retrying. */
  private retryAttempt = 0;
  private stopped = false;

  constructor(private readonly deps: CollectionSyncDeps) {}

  /** Full pass (push, then pull). Concurrent callers share the queued pass. A fresh trigger restarts the backoff. */
  performSync(): Promise<CollectionSyncResult> {
    this.retryAttempt = 0;
    return this.enqueue(() => this.run({ pull: true }));
  }

  /** Push local edits only — the quick path after a user action. */
  pushNow(): Promise<CollectionSyncResult> {
    return this.enqueue(() => this.run({ pull: false }));
  }

  /** Debounced {@link pushNow}, for a burst of edits. */
  schedulePush(delayMs = PUSH_DEBOUNCE_MS): void {
    if (this.stopped) return;
    if (this.pushTimer !== null) this.deps.cancel(this.pushTimer);
    this.pushTimer = this.deps.schedule(() => {
      this.pushTimer = null;
      void this.pushNow();
    }, delayMs);
  }

  /** Stop timers (plugin unload / sign-out). A pass already running finishes on its own. */
  stop(): void {
    this.stopped = true;
    if (this.pushTimer !== null) this.deps.cancel(this.pushTimer);
    if (this.retryTimer !== null) this.deps.cancel(this.retryTimer);
    this.pushTimer = null;
    this.retryTimer = null;
  }

  start(): void {
    this.stopped = false;
  }

  private enqueue(task: () => Promise<CollectionSyncResult>): Promise<CollectionSyncResult> {
    if (this.queued) return this.queued;
    if (!this.running) return this.begin(task);
    const queued = this.running
      .catch(() => undefined)
      .then(() => {
        this.queued = null;
        return this.begin(task);
      });
    this.queued = queued;
    return queued;
  }

  private begin(task: () => Promise<CollectionSyncResult>): Promise<CollectionSyncResult> {
    const run = task().finally(() => {
      if (this.running === run) this.running = null;
    });
    this.running = run;
    return run;
  }

  private async run(options: { pull: boolean }): Promise<CollectionSyncResult> {
    const result: CollectionSyncResult = { pushedCollections: 0, pushedItems: 0 };
    const api = this.deps.api();
    if (this.stopped || !api || !this.deps.isAuthenticated() || !this.deps.store.getUsername()) return result;
    // Pin the user: a sign-out or account switch mid-pass must not write into the new scope.
    const username = this.deps.store.getUsername();
    const sameUser = (): boolean => this.deps.store.getUsername() === username;

    try {
      await this.pushCollectionDeletes(api, sameUser);
      result.pushedCollections = await this.pushCollections(api, sameUser);
      await this.pushItemDeletes(api, sameUser);
      result.pushedItems = await this.pushItems(api, sameUser);
      if (options.pull) {
        await this.pullCollections(api, sameUser);
        await this.pullItems(api, sameUser);
      }
      this.clearRetry();
    } catch (error) {
      result.error = describe(error);
      console.warn('[Social Archiver] Collection sync failed:', result.error);
      this.scheduleRetry();
    }
    return result;
  }

  private async pushCollectionDeletes(api: CollectionsApi, sameUser: () => boolean): Promise<void> {
    for (const id of this.deps.store.getPendingCollectionDeletes()) {
      try {
        await api.deleteCollection(id);
      } catch (error) {
        // Gone already, or I'm not its owner any more: nothing left to delete.
        if (!isNotFound(error) && readCode(error) !== 'COLLECTION_FORBIDDEN') throw error;
      }
      if (!sameUser()) return;
      this.deps.store.completeCollectionDeletes([id]);
    }
  }

  private async pushCollections(api: CollectionsApi, sameUser: () => boolean): Promise<number> {
    const dirty = this.deps.store.getDirtyCollections();
    let pushed = 0;
    for (const batch of chunk(dirty, COLLECTION_LIMITS.maxCollectionsPerUpsert)) {
      const response = await api.upsertCollections(
        batch.map(({ collection }) => ({
          id: collection.id,
          name: collection.name,
          description: collection.description,
          sortOrder: collection.sortOrder,
        })),
      );
      if (!sameUser()) return pushed;
      const handled = new Set<string>();
      for (const resolved of response.resolvedCollections ?? []) {
        this.deps.store.remapCollection(resolved.requestedId, resolved.canonicalCollection);
        handled.add(resolved.requestedId);
      }
      for (const rejected of response.rejected ?? []) {
        // LIMIT / DELETED / ID_CONFLICT come without a server row → forget the
        // local one. NAME_TAKEN / FORBIDDEN carry it → overwrite (the rename is undone).
        this.deps.store.applyRejected(rejected.id, rejected.serverCollection);
        handled.add(rejected.id);
      }
      const accepted = batch
        .filter(({ collection }) => !handled.has(collection.id))
        .map(({ collection, revision }) => ({ id: collection.id, revision }));
      this.deps.store.markCollectionsSynced(accepted);
      pushed += accepted.length + (response.resolvedCollections?.length ?? 0);
    }
    return pushed;
  }

  private async pushItemDeletes(api: CollectionsApi, sameUser: () => boolean): Promise<void> {
    const pending = this.deps.store.getPendingItemDeletes();
    for (const batch of chunk(pending, COLLECTION_LIMITS.maxPairsPerRequest)) {
      await api.deleteCollectionItems(batch);
      if (!sameUser()) return;
      this.deps.store.completeItemDeletes(batch);
    }
  }

  private async pushItems(api: CollectionsApi, sameUser: () => boolean): Promise<number> {
    const items = this.deps.store.getPushableItems();
    let pushed = 0;
    for (const batch of chunk(items, COLLECTION_LIMITS.maxPairsPerRequest)) {
      const pairs: CollectionItemPair[] = batch.map(({ collectionId, archiveId }) => ({ collectionId, archiveId }));
      const response = await api.upsertCollectionItems(pairs);
      if (!sameUser()) return pushed;
      const skipped = response.skippedPairs ?? [];
      const skippedKeys = new Set(skipped.map((pair) => `${pair.collectionId}\u0000${pair.archiveId}`));
      if (skipped.length > 0) this.deps.store.dropItems(skipped);
      const accepted = pairs.filter((pair) => !skippedKeys.has(`${pair.collectionId}\u0000${pair.archiveId}`));
      this.deps.store.markItemsSynced(accepted);
      pushed += accepted.length;
    }
    return pushed;
  }

  private async pullCollections(api: CollectionsApi, sameUser: () => boolean): Promise<void> {
    const store = this.deps.store;
    // No local rows = a fresh device (or wiped storage): take the whole list.
    const updatedAfter = store.hasLocalCollections() ? overlapCursor(store.getCursors().collections) : undefined;
    const response = await api.getUserCollections(
      updatedAfter ? { updatedAfter, includeDeleted: true } : {},
    );
    if (!sameUser()) return;
    store.applyRemoteCollections({
      collections: response.collections ?? [],
      deletedIds: response.deletedIds ?? [],
      memberCollectionIds: response.memberCollectionIds,
      serverTime: response.serverTime,
    });
  }

  private async pullItems(api: CollectionsApi, sameUser: () => boolean): Promise<void> {
    const store = this.deps.store;
    const updatedAfter = store.hasLocalItems() ? overlapCursor(store.getCursors().items) : undefined;
    const response = await api.getUserCollectionItems(
      updatedAfter ? { updatedAfter, includeDeleted: true } : {},
    );
    if (!sameUser()) return;
    store.applyRemoteItems({
      items: response.items ?? [],
      deletedPairs: response.deletedPairs ?? [],
      serverTime: response.serverTime,
    });
  }

  private scheduleRetry(): void {
    const delay = SYNC_RETRY_DELAYS_MS[this.retryAttempt];
    if (delay === undefined || this.stopped) return;
    this.retryAttempt++;
    if (this.retryTimer !== null) this.deps.cancel(this.retryTimer);
    this.retryTimer = this.deps.schedule(() => {
      this.retryTimer = null;
      // Not performSync(): that would restart the backoff it is part of.
      void this.enqueue(() => this.run({ pull: true }));
    }, delay);
  }

  private clearRetry(): void {
    this.retryAttempt = 0;
    if (this.retryTimer !== null) this.deps.cancel(this.retryTimer);
    this.retryTimer = null;
  }
}
