/**
 * Persisted per-(queue, operation) sync-queue mutation IDs (Todo 34, Release-A).
 *
 * A queue mutation (ack / fail / retry) carries a stable `X-Sync-Mutation-Id` so
 * the D1-authoritative server can replay a lost-response retry to the SAME
 * version token instead of double-applying it. The ID must survive a plugin
 * restart and a dropped HTTP response, so it is persisted the moment it is
 * minted and only removed once the mutation has settled:
 *
 *   - new (queue, operation)      -> a fresh ID, persisted immediately
 *   - same (queue, operation)     -> the SAME persisted ID (restart / retry)
 *   - settle() after a 2xx        -> the persisted ID is dropped; a later
 *                                    action for that pair mints a NEW ID
 *
 * Storage is the localStorage shape (Todo 17 precedent) so the plugin backs it
 * with `window.localStorage` and tests / the PTY harness back it with an
 * in-memory or file-backed adapter. This module holds NO transport, NO Obsidian
 * imports, and NO drain logic — only durable ID identity.
 */

/** localStorage-compatible synchronous key/value backend. */
export interface MutationIdStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SyncQueueOperation = 'ack' | 'fail' | 'retry';

const KEY_PREFIX = 'sa:sync-queue-mut';

/** Durable identity for sync-queue mutations. One instance per plugin session. */
export class SyncQueueMutationIdStore {
  constructor(
    private readonly storage: MutationIdStorage,
    private readonly generateId: () => string = defaultGenerateId,
  ) {}

  /**
   * The stable mutation ID for one (queue, operation). Returns the persisted ID
   * when one exists (restart / response-loss retry reuses it); otherwise mints,
   * persists, and returns a new one.
   */
  getOrCreate(queueId: string, operation: SyncQueueOperation): string {
    const key = this.key(queueId, operation);
    const existing = this.storage.getItem(key);
    if (existing !== null && existing !== '') return existing;
    const id = this.generateId();
    if (id === '') throw new Error('mutation id generator returned an empty id');
    this.storage.setItem(key, id);
    return id;
  }

  /** Settle a successfully applied mutation so the next action mints a new ID. */
  settle(queueId: string, operation: SyncQueueOperation): void {
    this.storage.removeItem(this.key(queueId, operation));
  }

  /** True while an unsettled mutation ID is persisted for this pair. */
  has(queueId: string, operation: SyncQueueOperation): boolean {
    const value = this.storage.getItem(this.key(queueId, operation));
    return value !== null && value !== '';
  }

  private key(queueId: string, operation: SyncQueueOperation): string {
    if (queueId === '') throw new Error('queueId is required for a mutation id');
    return `${KEY_PREFIX}:${operation}:${queueId}`;
  }
}

function defaultGenerateId(): string {
  const globalCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (globalCrypto?.randomUUID) return globalCrypto.randomUUID();
  // ponytail: only reached where WebCrypto is absent (old runtimes); timestamp+rand is unique enough for an idempotency key.
  return `mut-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
