/**
 * UnifiedExecutorScheduler (Obsidian, Todo 28).
 *
 * ONE timer polls the job backlog and dispatches rows by exact kind to the
 * existing AI-comment / AI-action / transcription processors through their
 * public push seams (`handleRequestedJob` / `handleRequestedAIActionJob`), so a
 * polled job is processed exactly like a WS push. What it polls is the
 * transport's business (UnifiedExecutorTransport).
 *
 * Started as a copy of the desktop CLI's unified-v1 module; it no longer speaks
 * that protocol, so the two are free to diverge.
 */

export type ExecutorKind = 'ai_comment' | 'ai_action' | 'transcription';

export interface UnifiedJob {
  readonly kind: ExecutorKind;
  readonly id: string;
  /** The row's updatedAt as listed; a changed version re-dispatches (see CLAIMED_MEMORY_MS). */
  readonly version?: string;
}

export type PollOutcome =
  | { readonly type: 'jobs'; readonly jobs: readonly UnifiedJob[]; readonly nextPollAfterMs: number }
  | { readonly type: 'empty'; readonly nextPollAfterMs: number }
  | { readonly type: 'transient' };

export type ClaimOutcome =
  | { readonly ok: true; readonly kind: ExecutorKind; readonly id: string; readonly lockToken: string; readonly lockTokenVersion: number }
  | { readonly ok: false; readonly reason: 'conflict' | 'gone' | 'denied' };

export interface ClaimedDispatch {
  readonly kind: ExecutorKind;
  readonly id: string;
  readonly lockToken: string;
  readonly lockTokenVersion: number;
  readonly rank: number;
}

export type SchedulerEvent =
  | { readonly type: 'poll'; readonly outcome: PollOutcome['type'] }
  | { readonly type: 'dispatch'; readonly kind: ExecutorKind; readonly id: string; readonly rank: number };

export interface SchedulerClock {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface SchedulerDeps {
  readonly clock: SchedulerClock;
  poll(): Promise<PollOutcome>;
  claim(job: UnifiedJob): Promise<ClaimOutcome>;
  dispatch(claimed: ClaimedDispatch): Promise<void> | void;
  onEvent?(event: SchedulerEvent): void;
}

export interface SchedulerConfig {
  readonly idlePollMs: number;
  readonly errorBackoffMaxMs: number;
}

/**
 * How long a dispatched job stays deduped while its row is unchanged. The key
 * is id + version, so anything that touches the row (a due retry, an expired
 * lease) re-dispatches on the next poll. What this window bounds is a listed
 * row the processor could not claim and nobody touches, such as an adoptable
 * job for a provider this machine lacks: one claim attempt per 30 minutes
 * instead of one per poll.
 */
export const CLAIMED_MEMORY_MS = 30 * 60 * 1000;

export class UnifiedExecutorScheduler {
  private stopped = false;
  private timer: unknown = null;
  private ticking = false;
  private errors = 0;
  private readonly inflight = new Set<string>();
  private readonly claimed = new Map<string, number>();

  constructor(private readonly deps: SchedulerDeps, private readonly config: SchedulerConfig) {}

  start(): void {
    this.stopped = false;
    this.scheduleNext(0);
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.deps.clock.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(ms: number): void {
    if (this.stopped || this.timer !== null) return;
    this.timer = this.deps.clock.setTimer(() => {
      this.timer = null;
      void this.tick();
    }, ms);
  }

  private backoffMs(): number {
    const raw = this.config.idlePollMs * 2 ** Math.max(this.errors - 1, 0);
    return Math.min(this.config.errorBackoffMaxMs, Math.max(this.config.idlePollMs, raw));
  }

  private async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      const outcome = await this.deps.poll();
      this.deps.onEvent?.({ type: 'poll', outcome: outcome.type });
      switch (outcome.type) {
        case 'transient':
          this.errors += 1;
          this.scheduleNext(this.backoffMs());
          return;
        case 'empty':
          this.errors = 0;
          this.scheduleNext(outcome.nextPollAfterMs);
          return;
        case 'jobs':
          this.errors = 0;
          await this.dispatchAll(outcome.jobs);
          this.scheduleNext(outcome.nextPollAfterMs);
          return;
        default:
          return assertNever(outcome);
      }
    } catch {
      this.errors += 1;
      this.scheduleNext(this.backoffMs());
    } finally {
      this.ticking = false;
    }
  }

  private async dispatchAll(jobs: readonly UnifiedJob[]): Promise<void> {
    const now = this.deps.clock.now();
    for (const [key, at] of this.claimed) {
      if (now - at >= CLAIMED_MEMORY_MS) this.claimed.delete(key);
    }
    let rank = 0;
    for (const job of jobs) {
      const position = rank;
      rank += 1;
      const key = `${job.id}@${job.version ?? ''}`;
      if (this.claimed.has(key) || this.inflight.has(job.id)) continue;
      this.inflight.add(job.id);
      try {
        const result = await this.deps.claim(job);
        this.claimed.set(key, now);
        if (result.ok) {
          this.deps.onEvent?.({ type: 'dispatch', kind: job.kind, id: job.id, rank: position });
          await this.deps.dispatch({ kind: result.kind, id: result.id, lockToken: result.lockToken, lockTokenVersion: result.lockTokenVersion, rank: position });
        }
      } finally {
        this.inflight.delete(job.id);
      }
    }
  }
}

/** The existing Obsidian processors' public push seams (Todo 28 dispatch-only). */
export interface UnifiedExecutorProcessors {
  readonly aiComment: {
    handleRequestedJob(jobId: string, targetClientId: string): Promise<void>;
    handleRequestedAIActionJob(jobId: string, targetClientId?: string | null): Promise<void>;
  };
  readonly transcription: { handleRequestedJob(jobId: string, targetClientId: string): Promise<void> };
}

/**
 * Build the scheduler `dispatch` that pushes a claimed row to the matching
 * processor by exact kind — no processor self-claim, no reordering.
 */
export function createProcessorDispatch(
  processors: UnifiedExecutorProcessors,
  clientId: string,
): (claimed: ClaimedDispatch) => Promise<void> {
  return async (claimed: ClaimedDispatch): Promise<void> => {
    switch (claimed.kind) {
      case 'ai_comment':
        await processors.aiComment.handleRequestedJob(claimed.id, clientId);
        return;
      case 'ai_action':
        await processors.aiComment.handleRequestedAIActionJob(claimed.id, clientId);
        return;
      case 'transcription':
        await processors.transcription.handleRequestedJob(claimed.id, clientId);
        return;
      default:
        return assertNever(claimed.kind);
    }
  };
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected value: ${JSON.stringify(value)}`);
}
