import { describe, it, expect, vi } from 'vitest';
import {
  SyncQueueDrainService,
  type SyncQueueDrainDeps,
  type SyncQueueDrainItem,
  type SyncQueueListOutcome,
  type ProcessOutcome,
} from '../../../plugin/sync/SyncQueueDrainService';

function item(queueId: string): SyncQueueDrainItem {
  return { queueId, archiveId: `a-${queueId}`, clientId: 'c1', versionToken: `v-${queueId}` };
}

/**
 * A scripted v2 server. Pagination is KEYSET (cursor = the last returned
 * queueId) over an immutable ordered list, exactly like the signed-cursor D1
 * window — so ACKing (deleting) items never renumbers the survivors. `ack` (via
 * processItem) marks the item gone, so a cursorless restart naturally re-lists
 * only the survivors, the property the drain relies on.
 */
class FakeQueue {
  private readonly all: SyncQueueDrainItem[];
  private readonly ackedSet = new Set<string>();
  readonly acked: string[] = [];
  readonly processedTimes = new Map<string, number>();
  readonly listCursors: (string | null)[] = [];
  cursorInvalidNext = false;
  rateLimitOnItem: string | null = null;

  constructor(ids: string[]) {
    this.all = ids.map(item);
  }

  listPage = async ({ cursor, limit }: { cursor: string | null; limit: number }): Promise<SyncQueueListOutcome> => {
    this.listCursors.push(cursor);
    if (this.cursorInvalidNext && cursor !== null) {
      this.cursorInvalidNext = false;
      return { kind: 'cursor-invalid' };
    }
    const startAfter = cursor === null ? -1 : this.all.findIndex((candidate) => candidate.queueId === cursor);
    const live = this.all.filter((candidate, index) => index > startAfter && !this.ackedSet.has(candidate.queueId));
    const window = live.slice(0, limit);
    const last = window[window.length - 1];
    const consumedUpto = last === undefined ? startAfter : this.all.findIndex((candidate) => candidate.queueId === last.queueId);
    const hasMore = this.all.some((candidate, index) => index > consumedUpto && !this.ackedSet.has(candidate.queueId));
    return { kind: 'page', items: window, nextCursor: last === undefined ? null : last.queueId, hasMore };
  };

  processItem = async (target: SyncQueueDrainItem): Promise<ProcessOutcome> => {
    this.processedTimes.set(target.queueId, (this.processedTimes.get(target.queueId) ?? 0) + 1);
    if (this.rateLimitOnItem === target.queueId) {
      this.rateLimitOnItem = null;
      return 'rate-limited';
    }
    // ACK marks the item gone so it never re-appears in a later list window.
    this.ackedSet.add(target.queueId);
    this.acked.push(target.queueId);
    return 'saved';
  };
}

function makeDeps(queue: FakeQueue, overrides: Partial<SyncQueueDrainDeps> = {}): SyncQueueDrainDeps {
  return {
    listPage: queue.listPage,
    processItem: queue.processItem,
    scheduleContinuation: vi.fn(),
    limits: { pageLimit: 2, maxPagesPerRun: 5, maxItemsPerRun: 200, continuationDelayMs: 1000 },
    ...overrides,
  };
}

describe('SyncQueueDrainService', () => {
  it('drains every page and ACKs each item exactly once', async () => {
    const queue = new FakeQueue(['q1', 'q2', 'q3', 'q4', 'q5']);
    const result = await new SyncQueueDrainService(makeDeps(queue)).drainOnce();

    expect(result.status).toBe('completed');
    expect(queue.acked).toEqual(['q1', 'q2', 'q3', 'q4', 'q5']);
    // Exactly one terminal ACK per item.
    for (const [, count] of queue.processedTimes) expect(count).toBe(1);
  });

  it('processes + ACKs a whole page before advancing the cursor', async () => {
    const advanceOrder: string[] = [];
    const queue = new FakeQueue(['q1', 'q2', 'q3', 'q4']);
    const wrapped = makeDeps(queue, {
      listPage: async (params) => {
        advanceOrder.push(`list:${params.cursor ?? 'first'}`);
        return queue.listPage(params);
      },
      processItem: async (target) => {
        advanceOrder.push(`ack:${target.queueId}`);
        return queue.processItem(target);
      },
    });

    await new SyncQueueDrainService(wrapped).drainOnce();

    // First page (q1,q2) is fully ACKed before the second list call is made.
    expect(advanceOrder.slice(0, 4)).toEqual(['list:first', 'ack:q1', 'ack:q2', 'list:q2']);
  });

  it('discards the cursor and restarts the first page after a cursor-expiry interruption', async () => {
    const queue = new FakeQueue(['q1', 'q2', 'q3', 'q4']);
    queue.cursorInvalidNext = true; // second list (with a cursor) expires
    const scheduleContinuation = vi.fn();
    const deps = makeDeps(queue, { scheduleContinuation });

    const first = await new SyncQueueDrainService(deps).drainOnce();
    expect(first).toMatchObject({ status: 'interrupted', reason: 'cursor-invalid' });
    expect(scheduleContinuation).toHaveBeenCalledTimes(1);
    expect(queue.acked).toEqual(['q1', 'q2']); // page one ACKed before the expiry

    // The scheduled continuation is a fresh drain: it MUST restart from page one.
    queue.listCursors.length = 0;
    const second = await new SyncQueueDrainService(deps).drainOnce();
    expect(second.status).toBe('completed');
    expect(queue.acked).toEqual(['q1', 'q2', 'q3', 'q4']);
    expect(queue.listCursors[0]).toBeNull(); // restarted at the first page
  });

  it('stops and schedules a continuation when an item is rate-limited', async () => {
    const queue = new FakeQueue(['q1', 'q2', 'q3']);
    queue.rateLimitOnItem = 'q2';
    const scheduleContinuation = vi.fn();

    const result = await new SyncQueueDrainService(makeDeps(queue, { scheduleContinuation })).drainOnce();

    expect(result).toMatchObject({ status: 'interrupted', reason: 'rate-limited' });
    expect(scheduleContinuation).toHaveBeenCalledTimes(1);
    // q1 ACKed; q2 hit the limit and was NOT acked.
    expect(queue.acked).toEqual(['q1']);
  });

  it('bounds pages per run and schedules a continuation', async () => {
    const queue = new FakeQueue(['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8']);
    const scheduleContinuation = vi.fn();
    const deps = makeDeps(queue, { scheduleContinuation, limits: { pageLimit: 2, maxPagesPerRun: 2, continuationDelayMs: 500 } });

    const result = await new SyncQueueDrainService(deps).drainOnce();

    expect(result).toMatchObject({ status: 'continued', reason: 'max-pages' });
    expect(scheduleContinuation).toHaveBeenCalledWith(500);
    expect(queue.acked).toEqual(['q1', 'q2', 'q3', 'q4']); // 2 pages x 2 items
  });

  it('bounds items per run and schedules a continuation', async () => {
    const queue = new FakeQueue(['q1', 'q2', 'q3', 'q4']);
    const scheduleContinuation = vi.fn();
    const deps = makeDeps(queue, { scheduleContinuation, limits: { pageLimit: 10, maxItemsPerRun: 3, continuationDelayMs: 500 } });

    const result = await new SyncQueueDrainService(deps).drainOnce();

    expect(result).toMatchObject({ status: 'continued', reason: 'max-items' });
    expect(queue.acked).toEqual(['q1', 'q2', 'q3']);
  });

  it('performs exactly ONE cursorless final sweep after the paged phase', async () => {
    const queue = new FakeQueue(['q1', 'q2']);
    const sweepListCursors: (string | null)[] = [];
    let listCalls = 0;
    const deps = makeDeps(queue, {
      limits: { pageLimit: 5 },
      listPage: async (params) => {
        listCalls += 1;
        const out = await queue.listPage(params);
        if (listCalls > 1) sweepListCursors.push(params.cursor); // list after the first page = the sweep
        return out;
      },
    });

    const result = await new SyncQueueDrainService(deps).drainOnce();

    expect(result.status).toBe('completed');
    // One page drains q1,q2 (hasMore=false), then exactly one cursorless sweep.
    expect(sweepListCursors).toEqual([null]);
  });

  it('is single-flight: a concurrent WS + poll drain collapses to one processor run', async () => {
    const queue = new FakeQueue(['q1', 'q2', 'q3']);
    let active = 0;
    let maxActive = 0;
    const deps = makeDeps(queue, {
      processItem: async (target) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        const out = await queue.processItem(target);
        active -= 1;
        return out;
      },
    });
    const service = new SyncQueueDrainService(deps);

    const [wsRun, pollRun] = await Promise.all([service.drainOnce(), service.drainOnce()]);

    // One run does the work; the other is a no-op — never two concurrent processors.
    expect(maxActive).toBe(1);
    const statuses = [wsRun.status, pollRun.status].sort();
    expect(statuses).toEqual(['completed', 'skipped']);
    expect(queue.acked).toEqual(['q1', 'q2', 'q3']);
  });
});
