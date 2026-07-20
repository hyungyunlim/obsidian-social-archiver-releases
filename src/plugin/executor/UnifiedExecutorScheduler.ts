/**
 * UnifiedExecutorScheduler (Obsidian, Todo 28, PRD AD-5 / P2 rollout).
 *
 * ONE timer polls the unified executor endpoint and dispatches server rows by
 * exact kind to the existing AI-comment / AI-action / transcription processors
 * through their public push seams (`handleRequestedJob` /
 * `handleRequestedAIActionJob`) — processors are push/dispatch-only in unified
 * mode. A process chooses unified or legacy ONCE: only an explicit 404/426
 * switches to legacy; 503 / partial / indeterminate / transient STAY unified.
 *
 * The scheduler core is intentionally a small, dependency-injected duplicate of
 * the desktop CLI's module: the two clients live in separate build roots with no
 * shared package, so a ~200-line pure copy is cheaper than a new workspace dep.
 * ponytail: duplicated core — extract a shared package only if a third client needs it.
 */

export type ExecutorKind = 'ai_comment' | 'ai_action' | 'transcription';

export interface UnifiedJob {
  readonly kind: ExecutorKind;
  readonly id: string;
  readonly claimUrl?: string;
}

export type PollOutcome =
  | {
      readonly type: 'jobs';
      readonly jobs: readonly UnifiedJob[];
      readonly partial: boolean;
      readonly indeterminateKinds: readonly ExecutorKind[];
      readonly nextPollAfterMs: number;
    }
  | { readonly type: 'empty'; readonly nextPollAfterMs: number }
  | { readonly type: 'indeterminate'; readonly nextPollAfterMs: number }
  | { readonly type: 'transient' }
  | { readonly type: 'upgrade' }
  | { readonly type: 'not_found' };

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
  | { readonly type: 'dispatch'; readonly kind: ExecutorKind; readonly id: string; readonly rank: number }
  | { readonly type: 'legacy'; readonly reason: 'upgrade' | 'not_found' };

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
  onLegacyFallback(reason: 'upgrade' | 'not_found'): void;
  onEvent?(event: SchedulerEvent): void;
}

export interface SchedulerConfig {
  readonly idlePollMs: number;
  readonly partialPollMs: number;
  readonly errorBackoffMaxMs: number;
}

export type SchedulerMode = 'unified' | 'legacy' | 'stopped';

export class UnifiedExecutorScheduler {
  private state: SchedulerMode = 'unified';
  private timer: unknown = null;
  private ticking = false;
  private errors = 0;
  private readonly inflight = new Set<string>();
  private readonly claimed = new Set<string>();

  constructor(private readonly deps: SchedulerDeps, private readonly config: SchedulerConfig) {}

  get mode(): SchedulerMode {
    return this.state;
  }

  start(): void {
    if (this.state === 'stopped') this.state = 'unified';
    if (this.state !== 'unified' || this.timer !== null) return;
    this.scheduleNext(0);
  }

  stop(): void {
    this.state = 'stopped';
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.deps.clock.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(ms: number): void {
    if (this.state !== 'unified' || this.timer !== null) return;
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
    if (this.ticking || this.state !== 'unified') return;
    this.ticking = true;
    try {
      const outcome = await this.deps.poll();
      this.deps.onEvent?.({ type: 'poll', outcome: outcome.type });
      switch (outcome.type) {
        case 'not_found':
        case 'upgrade':
          this.state = 'legacy';
          this.clearTimer();
          this.deps.onEvent?.({ type: 'legacy', reason: outcome.type });
          this.deps.onLegacyFallback(outcome.type);
          return;
        case 'transient':
          this.errors += 1;
          this.scheduleNext(this.backoffMs());
          return;
        case 'indeterminate':
        case 'empty':
          this.errors = 0;
          this.scheduleNext(outcome.nextPollAfterMs);
          return;
        case 'jobs':
          this.errors = 0;
          await this.dispatchAll(outcome.jobs);
          this.scheduleNext(outcome.partial ? this.config.partialPollMs : outcome.nextPollAfterMs);
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
    let rank = 0;
    for (const job of jobs) {
      const position = rank;
      rank += 1;
      if (this.claimed.has(job.id) || this.inflight.has(job.id)) continue;
      this.inflight.add(job.id);
      try {
        const result = await this.deps.claim(job);
        this.claimed.add(job.id);
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
