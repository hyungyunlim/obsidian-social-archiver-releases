export type LocalLockKind =
  | 'archiveMaterialization'
  | 'mediaMaterialization'
  | 'markdownWrite';

export interface LocalLockKey {
  kind: LocalLockKind;
  archiveId: string;
  mediaRefHash?: string;
}

export interface LocalLockOptions {
  signal?: AbortSignal;
  waitLogThresholdMs?: number;
}

type ReleaseLock = () => void;

interface LockWaiter {
  resolve: (release: ReleaseLock) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  abortHandler?: () => void;
}

interface LockState {
  locked: boolean;
  queue: LockWaiter[];
}

const DEFAULT_WAIT_LOG_THRESHOLD_MS = 500;
const LOCK_KIND_ORDER: Record<LocalLockKind, number> = {
  archiveMaterialization: 0,
  mediaMaterialization: 1,
  markdownWrite: 2,
};

export class LocalLockRegistry {
  private readonly locks = new Map<string, LockState>();

  async withLock<T>(key: LocalLockKey, fn: () => Promise<T>, options: LocalLockOptions = {}): Promise<T> {
    const startedAt = Date.now();
    const release = await this.acquire(key, options.signal);
    const waitedMs = Date.now() - startedAt;
    const threshold = options.waitLogThresholdMs ?? DEFAULT_WAIT_LOG_THRESHOLD_MS;
    if (waitedMs >= threshold) {
      this.logWait(key, waitedMs);
    }

    try {
      return await fn();
    } finally {
      release();
    }
  }

  async withLocks<T>(keys: LocalLockKey[], fn: () => Promise<T>, options: LocalLockOptions = {}): Promise<T> {
    this.assertOrdered(keys);
    const releases: ReleaseLock[] = [];
    try {
      for (const key of keys) {
        const startedAt = Date.now();
        const release = await this.acquire(key, options.signal);
        releases.push(release);
        const waitedMs = Date.now() - startedAt;
        const threshold = options.waitLogThresholdMs ?? DEFAULT_WAIT_LOG_THRESHOLD_MS;
        if (waitedMs >= threshold) {
          this.logWait(key, waitedMs);
        }
      }
      return await fn();
    } finally {
      for (let index = releases.length - 1; index >= 0; index--) {
        releases[index]?.();
      }
    }
  }

  private acquire(key: LocalLockKey, signal?: AbortSignal): Promise<ReleaseLock> {
    if (signal?.aborted) {
      return Promise.reject(new DOMException('Local lock wait cancelled', 'AbortError'));
    }

    const lockId = serializeLockKey(key);
    const state = this.locks.get(lockId) ?? { locked: false, queue: [] };
    this.locks.set(lockId, state);

    if (!state.locked) {
      state.locked = true;
      return Promise.resolve(() => this.release(lockId));
    }

    return new Promise<ReleaseLock>((resolve, reject) => {
      const waiter: LockWaiter = { resolve, reject, signal };
      if (signal) {
        waiter.abortHandler = () => {
          const index = state.queue.indexOf(waiter);
          if (index >= 0) {
            state.queue.splice(index, 1);
            reject(new DOMException('Local lock wait cancelled', 'AbortError'));
          }
        };
        signal.addEventListener('abort', waiter.abortHandler, { once: true });
      }
      state.queue.push(waiter);
    });
  }

  private release(lockId: string): void {
    const state = this.locks.get(lockId);
    if (!state) return;

    const next = state.queue.shift();
    if (!next) {
      state.locked = false;
      this.locks.delete(lockId);
      return;
    }

    if (next.signal && next.abortHandler) {
      next.signal.removeEventListener('abort', next.abortHandler);
    }

    state.locked = true;
    next.resolve(() => this.release(lockId));
  }

  private assertOrdered(keys: LocalLockKey[]): void {
    let previous = -1;
    for (const key of keys) {
      const current = LOCK_KIND_ORDER[key.kind];
      if (current < previous) {
        throw new Error(`Local locks acquired out of order: ${key.kind}`);
      }
      previous = current;
    }
  }

  private logWait(key: LocalLockKey, waitedMs: number): void {
    console.debug('[LocalLockRegistry] waited for local lock', {
      kind: key.kind,
      archiveKeyHash: hashLocalLockComponent(key.archiveId),
      mediaRefHash: key.mediaRefHash ? hashLocalLockComponent(key.mediaRefHash) : undefined,
      waitedMs,
    });
  }
}

export function hashLocalLockComponent(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function serializeLockKey(key: LocalLockKey): string {
  return `${key.kind}:${key.archiveId}:${key.mediaRefHash ?? ''}`;
}
