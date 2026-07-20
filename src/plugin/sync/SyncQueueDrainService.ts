/**
 * Interruption-safe v2 sync-queue drain loop (Todo 34, Release-B).
 *
 * Draining the D1-authoritative queue over the signed-cursor v2 pagination is
 * only safe because a successful ACK DELETES the item server-side. That single
 * fact lets the loop treat an interruption as "throw the cursor away and start
 * over from the first page" — the already-ACKed items simply no longer appear,
 * so a restart always makes forward progress and never re-processes.
 *
 * Invariants:
 *   1. Process + ACK EVERY item of a page BEFORE advancing to `nextCursor`.
 *   2. On ANY interruption (cursor expiry, rate-limit, upgrade, transport error)
 *      discard the cursor and schedule a continuation that restarts page one.
 *   3. Bound pages and items per run; over the bound -> schedule continuation.
 *   4. After the paged phase, run exactly ONE cursorless final sweep.
 *   5. Single-flight: a concurrent WS-triggered and poll-triggered drain share
 *      one processor + idempotency store — the second caller is a no-op.
 *
 * The processor (`processItem`) and idempotency store live outside this loop;
 * this module is pure control flow so WS and poll paths inject the SAME deps.
 */

/** A pending item as projected by the v2 list endpoint. */
export interface SyncQueueDrainItem {
  readonly queueId: string;
  readonly archiveId: string;
  readonly clientId: string;
  readonly versionToken: string;
}

/** Result of one v2 list window. Only `page` advances; everything else interrupts. */
export type SyncQueueListOutcome =
  | {
      readonly kind: 'page';
      readonly items: readonly SyncQueueDrainItem[];
      readonly nextCursor: string | null;
      readonly hasMore: boolean;
    }
  | { readonly kind: 'cursor-invalid' }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs?: number }
  | { readonly kind: 'upgrade-required' }
  | { readonly kind: 'error' };

/** Outcome of processing (fetch + save + ACK/settle) a single item. */
export type ProcessOutcome = 'saved' | 'acked-duplicate' | 'rate-limited' | 'failed';

export interface SyncQueueDrainLimits {
  readonly maxPagesPerRun?: number;
  readonly maxItemsPerRun?: number;
  readonly pageLimit?: number;
  readonly continuationDelayMs?: number;
}

export interface SyncQueueDrainDeps {
  listPage(params: { cursor: string | null; limit: number }): Promise<SyncQueueListOutcome>;
  /** Fetch + save + idempotent ACK (settles the mutation id) for one item. */
  processItem(item: SyncQueueDrainItem): Promise<ProcessOutcome>;
  /** Schedule a fresh drain that will restart from the first page. */
  scheduleContinuation(delayMs: number): void;
  readonly limits?: SyncQueueDrainLimits;
}

export type DrainInterruptReason = 'cursor-invalid' | 'rate-limited' | 'upgrade-required' | 'error';

export type DrainResult =
  | { readonly status: 'skipped' }
  | { readonly status: 'interrupted'; readonly reason: DrainInterruptReason; readonly pages: number; readonly items: number }
  | { readonly status: 'continued'; readonly reason: 'max-pages' | 'max-items'; readonly pages: number; readonly items: number }
  | { readonly status: 'completed'; readonly pages: number; readonly items: number; readonly finalSweepItems: number };

const DEFAULT_MAX_PAGES = 5;
const DEFAULT_MAX_ITEMS = 200;
const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_CONTINUATION_DELAY_MS = 2000;

export class SyncQueueDrainService {
  private inFlight = false;

  constructor(private readonly deps: SyncQueueDrainDeps) {}

  /** Drain one bounded run. Concurrent callers (WS + poll) collapse to one. */
  async drainOnce(): Promise<DrainResult> {
    if (this.inFlight) return { status: 'skipped' };
    this.inFlight = true;
    try {
      return await this.run();
    } finally {
      this.inFlight = false;
    }
  }

  private async run(): Promise<DrainResult> {
    const { maxPages, maxItems, pageLimit, continuationDelayMs } = this.resolveLimits();
    let cursor: string | null = null; // always begin at the first page
    let pages = 0;
    let items = 0;

    while (true) {
      if (pages >= maxPages) {
        this.deps.scheduleContinuation(continuationDelayMs);
        return { status: 'continued', reason: 'max-pages', pages, items };
      }
      const outcome = await this.deps.listPage({ cursor, limit: pageLimit });
      if (outcome.kind !== 'page') {
        // Discard the cursor; the continuation restarts from page one.
        const delay = outcome.kind === 'rate-limited'
          ? Math.max(outcome.retryAfterMs ?? continuationDelayMs, continuationDelayMs)
          : continuationDelayMs;
        this.deps.scheduleContinuation(delay);
        return { status: 'interrupted', reason: outcome.kind, pages, items };
      }
      for (const item of outcome.items) {
        const result = await this.deps.processItem(item);
        items += 1;
        if (result === 'rate-limited') {
          this.deps.scheduleContinuation(continuationDelayMs);
          return { status: 'interrupted', reason: 'rate-limited', pages, items };
        }
        if (items >= maxItems) {
          this.deps.scheduleContinuation(continuationDelayMs);
          return { status: 'continued', reason: 'max-items', pages, items };
        }
      }
      // Whole page processed + ACKed: only now is it safe to advance the cursor.
      pages += 1;
      if (!outcome.hasMore || outcome.nextCursor === null) break;
      cursor = outcome.nextCursor;
    }

    const finalSweepItems = await this.finalSweep(pageLimit);
    return { status: 'completed', pages, items, finalSweepItems };
  }

  /** Exactly one cursorless list after the paged phase; process whatever remains. */
  private async finalSweep(pageLimit: number): Promise<number> {
    const sweep = await this.deps.listPage({ cursor: null, limit: pageLimit });
    if (sweep.kind !== 'page') return 0;
    let processed = 0;
    for (const item of sweep.items) {
      const result = await this.deps.processItem(item);
      processed += 1;
      if (result === 'rate-limited') break;
    }
    return processed;
  }

  private resolveLimits(): { maxPages: number; maxItems: number; pageLimit: number; continuationDelayMs: number } {
    const limits = this.deps.limits ?? {};
    return {
      maxPages: limits.maxPagesPerRun ?? DEFAULT_MAX_PAGES,
      maxItems: limits.maxItemsPerRun ?? DEFAULT_MAX_ITEMS,
      pageLimit: limits.pageLimit ?? DEFAULT_PAGE_LIMIT,
      continuationDelayMs: limits.continuationDelayMs ?? DEFAULT_CONTINUATION_DELAY_MS,
    };
  }
}
