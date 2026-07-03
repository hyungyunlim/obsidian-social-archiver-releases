/**
 * SyncRateLimitCoordinator
 *
 * Single Responsibility: coordinate background sync request volume against the
 * server's shared per-user API rate-limit bucket.
 *
 * The Workers API applies one global bucket (100 req/60s, workers
 * rateLimiter DEFAULT_CONFIG) to every /api/* request. During a full library
 * sync three plugin services compete for that bucket blindly —
 * ArchiveLibrarySyncService page fetches, LinkRelationSyncService per-archive
 * GETs, and MobileSyncService queue drains — so large vaults (2,500+ archives)
 * flood into HTTP 429 RATE_LIMIT_EXCEEDED. This coordinator is the shared
 * client-side token bucket those services acquire from BEFORE issuing a
 * background sync request, keeping combined background traffic comfortably
 * under the server ceiling so interactive requests (archive, share, media)
 * keep headroom.
 *
 * Behaviour:
 * - `acquire(signal)` resolves when a token is available AND no server-imposed
 *   cooldown is active. FIFO — earlier callers unblock first.
 * - `reportRateLimited(error)` enters a shared cooldown parsed from the
 *   server's Retry-After (`error.details.retryAfter`, seconds — the Workers
 *   `RateLimitError` always serializes it) so every waiter backs off together.
 *
 * Never throws except AbortError when the caller's signal aborts.
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Background sync budget per sliding window. Deliberately well under the
 * server's 100 req/60s so interactive traffic is never starved by sync.
 */
const DEFAULT_MAX_REQUESTS_PER_WINDOW = 30;

/** Sliding window size — mirrors the server bucket window. */
const DEFAULT_WINDOW_MS = 60_000;

/** Cooldown applied when a 429 carries no parseable Retry-After. */
export const DEFAULT_RATE_LIMIT_RETRY_MS = 30_000;

/** Upper bound on any server-provided Retry-After (defensive). */
const MAX_RETRY_AFTER_MS = 5 * 60_000;

/** Floor for internal waits so a zero/negative computed wait cannot spin. */
const MIN_WAIT_MS = 50;

// ============================================================================
// Rate-limit error helpers (pure, shared by all sync services)
// ============================================================================

/** Error fields enriched by WorkersAPIClient.request() on API failures. */
interface EnrichedApiError {
  status?: number;
  code?: string;
  details?: unknown;
}

/**
 * True when an error represents a server rate limit — HTTP 429 or the Workers
 * `RATE_LIMIT_EXCEEDED` error code.
 */
export function isRateLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const enriched = error as Error & EnrichedApiError;
  return enriched.status === 429 || enriched.code === 'RATE_LIMIT_EXCEEDED';
}

/**
 * Extract the server's Retry-After from a rate-limit error, in milliseconds.
 *
 * The Workers `RateLimitError` serializes `retryAfter` (seconds) into
 * `error.details`, which WorkersAPIClient copies onto the thrown error. Falls
 * back to `fallbackMs` when absent (e.g. an edge-level 429 with no JSON body).
 * The result is clamped to `MAX_RETRY_AFTER_MS`.
 */
export function getRetryAfterMs(
  error: unknown,
  fallbackMs: number = DEFAULT_RATE_LIMIT_RETRY_MS,
): number {
  if (error instanceof Error) {
    const details = (error as Error & EnrichedApiError).details;
    if (details && typeof details === 'object') {
      const retryAfter = (details as { retryAfter?: unknown }).retryAfter;
      if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0) {
        return Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS);
      }
    }
  }
  return Math.min(Math.max(fallbackMs, MIN_WAIT_MS), MAX_RETRY_AFTER_MS);
}

// ============================================================================
// Coordinator
// ============================================================================

/**
 * Minimal surface the sync services depend on — keeps their deps mockable
 * without constructing a real coordinator.
 */
export interface SyncRateLimitGate {
  acquire(signal?: AbortSignal): Promise<void>;
  reportRateLimited(error?: unknown): void;
}

export interface SyncRateLimitCoordinatorOptions {
  /** Tokens granted per sliding window (default 30). */
  maxRequestsPerWindow?: number;
  /** Sliding window size in ms (default 60,000). */
  windowMs?: number;
}

export class SyncRateLimitCoordinator implements SyncRateLimitGate {
  private readonly maxRequestsPerWindow: number;
  private readonly windowMs: number;

  /** Grant timestamps within the current sliding window (oldest first). */
  private grantTimes: number[] = [];

  /** Epoch ms until which every acquire must wait (server-imposed cooldown). */
  private cooldownUntil = 0;

  /** FIFO serialization of waiters — later acquires queue behind earlier ones. */
  private tail: Promise<void> = Promise.resolve();

  constructor(options: SyncRateLimitCoordinatorOptions = {}) {
    this.maxRequestsPerWindow = Math.max(1, options.maxRequestsPerWindow ?? DEFAULT_MAX_REQUESTS_PER_WINDOW);
    this.windowMs = Math.max(1_000, options.windowMs ?? DEFAULT_WINDOW_MS);
  }

  /**
   * Wait for a background-request token. Resolves once a slot in the sliding
   * window is free and any active cooldown has elapsed. Rejects only with
   * AbortError when `signal` aborts.
   */
  acquire(signal?: AbortSignal): Promise<void> {
    const grant = this.tail.then(() => this.waitForSlot(signal));
    // Keep the FIFO chain alive when a waiter aborts — later acquires must
    // still be served.
    this.tail = grant.catch(() => undefined);
    return grant;
  }

  /**
   * Record a server 429 so all subsequent acquires (and current waiters) back
   * off together for the server-provided Retry-After.
   */
  reportRateLimited(error?: unknown): void {
    const retryAfterMs = getRetryAfterMs(error);
    const until = Date.now() + retryAfterMs;
    if (until > this.cooldownUntil) {
      this.cooldownUntil = until;
    }
  }

  /** Remaining server-imposed cooldown in ms (0 when none). */
  get cooldownRemainingMs(): number {
    return Math.max(0, this.cooldownUntil - Date.now());
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private async waitForSlot(signal?: AbortSignal): Promise<void> {
    for (;;) {
      this.throwIfAborted(signal);

      const now = Date.now();
      this.evictExpiredGrants(now);

      const cooldownWait = this.cooldownUntil - now;
      if (cooldownWait <= 0 && this.grantTimes.length < this.maxRequestsPerWindow) {
        this.grantTimes.push(now);
        return;
      }

      const oldestGrant = this.grantTimes[0];
      const windowWait =
        this.grantTimes.length >= this.maxRequestsPerWindow && oldestGrant !== undefined
          ? oldestGrant + this.windowMs - now
          : 0;

      await this.sleep(Math.max(cooldownWait, windowWait, MIN_WAIT_MS), signal);
    }
  }

  private evictExpiredGrants(now: number): void {
    const cutoff = now - this.windowMs;
    let firstLive = 0;
    while (firstLive < this.grantTimes.length && (this.grantTimes[firstLive] ?? 0) <= cutoff) {
      firstLive++;
    }
    if (firstLive > 0) {
      this.grantTimes = this.grantTimes.slice(firstLive);
    }
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new DOMException('Sync rate-limit acquire cancelled', 'AbortError');
    }
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = (): void => {
        window.clearTimeout(timeout);
        reject(new DOMException('Sync rate-limit acquire cancelled', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
