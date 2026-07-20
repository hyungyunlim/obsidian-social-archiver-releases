import { describe, it, expect } from 'vitest';
import {
  SyncQueueMutationIdStore,
  type MutationIdStorage,
} from '../../../plugin/sync/SyncQueueMutationIdStore';

/** In-memory localStorage-shaped backend that survives across store instances. */
class MemoryStorage implements MutationIdStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** Deterministic ID sequence so identity assertions are exact. */
function sequentialIds(): () => string {
  let n = 0;
  return () => `id-${(n += 1)}`;
}

describe('SyncQueueMutationIdStore', () => {
  it('mints a fresh id for a new (queue, operation) and persists it', () => {
    const storage = new MemoryStorage();
    const store = new SyncQueueMutationIdStore(storage, sequentialIds());

    const id = store.getOrCreate('q1', 'ack');

    expect(id).toBe('id-1');
    expect(store.has('q1', 'ack')).toBe(true);
    // Persisted, not left only in memory.
    expect(storage.map.size).toBe(1);
  });

  it('returns the SAME id for the same (queue, operation) across a simulated restart', () => {
    const storage = new MemoryStorage();
    const first = new SyncQueueMutationIdStore(storage, sequentialIds()).getOrCreate('q1', 'ack');

    // Restart: brand-new store instance + brand-new id generator over the same storage.
    const afterRestart = new SyncQueueMutationIdStore(storage, sequentialIds());
    const reused = afterRestart.getOrCreate('q1', 'ack');

    expect(reused).toBe(first);
  });

  it('reuses the persisted id after a lost response (retry mints nothing new)', () => {
    const storage = new MemoryStorage();
    const generate = sequentialIds();
    const store = new SyncQueueMutationIdStore(storage, generate);

    const attempt1 = store.getOrCreate('q1', 'ack'); // response lost — never settled
    const attempt2 = store.getOrCreate('q1', 'ack'); // retry

    expect(attempt2).toBe(attempt1);
    expect(attempt2).toBe('id-1');
  });

  it('keys distinct operations and queues independently', () => {
    const storage = new MemoryStorage();
    const store = new SyncQueueMutationIdStore(storage, sequentialIds());

    const ack = store.getOrCreate('q1', 'ack');
    const fail = store.getOrCreate('q1', 'fail');
    const otherQueue = store.getOrCreate('q2', 'ack');

    expect(new Set([ack, fail, otherQueue]).size).toBe(3);
  });

  it('settles a successful mutation so the next action mints a NEW id', () => {
    const storage = new MemoryStorage();
    const store = new SyncQueueMutationIdStore(storage, sequentialIds());

    const first = store.getOrCreate('q1', 'ack');
    store.settle('q1', 'ack');
    expect(store.has('q1', 'ack')).toBe(false);

    const afterNewAction = store.getOrCreate('q1', 'ack');
    expect(afterNewAction).not.toBe(first);
    expect(afterNewAction).toBe('id-2');
  });

  it('rejects an empty queueId and an empty generated id', () => {
    const storage = new MemoryStorage();
    expect(() => new SyncQueueMutationIdStore(storage).getOrCreate('', 'ack')).toThrow(/queueId/);
    expect(() => new SyncQueueMutationIdStore(storage, () => '').getOrCreate('q1', 'ack')).toThrow(/empty/);
  });
});
