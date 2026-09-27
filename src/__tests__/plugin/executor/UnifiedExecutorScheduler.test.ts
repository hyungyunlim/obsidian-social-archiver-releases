import { describe, it, expect } from 'vitest';
import {
  CLAIMED_MEMORY_MS,
  UnifiedExecutorScheduler,
  createProcessorDispatch,
  percentile,
  type ClaimOutcome,
  type PollOutcome,
  type SchedulerClock,
  type UnifiedJob,
} from '../../../plugin/executor/UnifiedExecutorScheduler';

class FakeClock implements SchedulerClock {
  nowMs = 0;
  private seq = 0;
  timers: { id: number; fn: () => void; at: number }[] = [];
  now(): number {
    return this.nowMs;
  }
  setTimer(fn: () => void, ms: number): number {
    const id = ++this.seq;
    this.timers.push({ id, fn, at: this.nowMs + ms });
    return id;
  }
  clearTimer(handle: unknown): void {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }
  pending(): number {
    return this.timers.length;
  }
  async fire(): Promise<boolean> {
    const next = [...this.timers].sort((a, b) => a.at - b.at)[0];
    if (next === undefined) return false;
    this.timers = this.timers.filter((t) => t.id !== next.id);
    this.nowMs = next.at;
    next.fn();
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
    return true;
  }
}

const CONFIG = { idlePollMs: 15_000, errorBackoffMaxMs: 60_000 };

function job(kind: UnifiedJob['kind'], id: string, version?: string): UnifiedJob {
  return { kind, id, version };
}

function jobs(list: UnifiedJob[], nextPollAfterMs = CONFIG.idlePollMs): PollOutcome {
  return { type: 'jobs', jobs: list, nextPollAfterMs };
}

function harness(script: PollOutcome[]) {
  const clock = new FakeClock();
  const claims: string[] = [];
  const dispatched: string[] = [];
  const scheduler = new UnifiedExecutorScheduler(
    {
      clock,
      poll: async () => script.shift() ?? { type: 'empty', nextPollAfterMs: CONFIG.idlePollMs },
      claim: async (j: UnifiedJob): Promise<ClaimOutcome> => {
        claims.push(`${j.kind}:${j.id}`);
        return { ok: true, kind: j.kind, id: j.id, lockToken: `tok-${j.id}`, lockTokenVersion: 1 };
      },
      dispatch: (c) => {
        dispatched.push(`${c.kind}:${c.id}@${c.rank}`);
      },
    },
    CONFIG,
  );
  return { clock, scheduler, claims, dispatched };
}

describe('Obsidian UnifiedExecutorScheduler', () => {
  it('runs exactly one timer regardless of repeated start()', async () => {
    const h = harness([{ type: 'empty', nextPollAfterMs: CONFIG.idlePollMs }]);
    h.scheduler.start();
    h.scheduler.start();
    expect(h.clock.pending()).toBe(1);
    await h.clock.fire();
    expect(h.clock.pending()).toBe(1);
  });

  it('dispatches server rows by exact kind in rank order', async () => {
    const h = harness([jobs([job('transcription', 't1'), job('ai_comment', 'c1'), job('ai_action', 'a1')])]);
    h.scheduler.start();
    await h.clock.fire();
    expect(h.claims).toEqual(['transcription:t1', 'ai_comment:c1', 'ai_action:a1']);
    expect(h.dispatched).toEqual(['transcription:t1@0', 'ai_comment:c1@1', 'ai_action:a1@2']);
  });

  it('does not re-dispatch an unchanged row it already dispatched', async () => {
    const h = harness([jobs([job('ai_action', 'a1', 'v1')]), jobs([job('ai_action', 'a1', 'v1')])]);
    h.scheduler.start();
    await h.clock.fire();
    await h.clock.fire();
    expect(h.claims).toEqual(['ai_action:a1']);
  });

  it('re-dispatches at once when the row version changes (a due retry)', async () => {
    const h = harness([jobs([job('ai_action', 'a1', 'v1')]), jobs([job('ai_action', 'a1', 'v2')])]);
    h.scheduler.start();
    await h.clock.fire();
    await h.clock.fire();
    expect(h.claims).toEqual(['ai_action:a1', 'ai_action:a1']);
  });

  it('retries an unchanged row once the claimed memory expires', async () => {
    const h = harness([
      jobs([job('ai_action', 'a1', 'v1')], CLAIMED_MEMORY_MS - 1_000),
      jobs([job('ai_action', 'a1', 'v1')], 1_000),
      jobs([job('ai_action', 'a1', 'v1')]),
    ]);
    h.scheduler.start();
    await h.clock.fire();
    await h.clock.fire();
    expect(h.claims).toEqual(['ai_action:a1']);
    await h.clock.fire();
    expect(h.claims).toEqual(['ai_action:a1', 'ai_action:a1']);
  });

  it('backs off transient errors then resumes; restart is safe', async () => {
    const h = harness([{ type: 'transient' }, { type: 'empty', nextPollAfterMs: CONFIG.idlePollMs }]);
    h.scheduler.start();
    await h.clock.fire();
    expect(h.clock.timers[0]?.at).toBe(15_000);
    await h.clock.fire();
    h.scheduler.stop();
    expect(h.clock.pending()).toBe(0);
    h.scheduler.start();
    expect(h.clock.pending()).toBe(1);
  });

  it('createProcessorDispatch pushes each kind to its processor seam', async () => {
    const calls: string[] = [];
    const dispatch = createProcessorDispatch(
      {
        aiComment: {
          handleRequestedJob: async (id, cid) => {
            calls.push(`comment:${id}:${cid}`);
          },
          handleRequestedAIActionJob: async (id, cid) => {
            calls.push(`action:${id}:${cid ?? ''}`);
          },
        },
        transcription: {
          handleRequestedJob: async (id, cid) => {
            calls.push(`transcribe:${id}:${cid}`);
          },
        },
      },
      'client-9',
    );
    await dispatch({ kind: 'ai_comment', id: 'c1', lockToken: 't', lockTokenVersion: 1, rank: 0 });
    await dispatch({ kind: 'ai_action', id: 'a1', lockToken: 't', lockTokenVersion: 1, rank: 1 });
    await dispatch({ kind: 'transcription', id: 't1', lockToken: 't', lockTokenVersion: 1, rank: 2 });
    expect(calls).toEqual(['comment:c1:client-9', 'action:a1:client-9', 'transcribe:t1:client-9']);
  });

  it('pickup p95 delta stays within 5s (fixture)', () => {
    const deltas = [100, 250, 800, 1000, 1000, 1300, 1600, 2100, 2800, 3600, 4400, 4900];
    expect(percentile(deltas, 95)).toBeLessThanOrEqual(5000);
  });
});
