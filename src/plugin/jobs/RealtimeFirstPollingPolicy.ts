// AD-12 realtime-first fallback polling policy (Obsidian plugin, Todo 40).
//
// Pure backoff state machine for the FUTURE AD-12 poll fallback. It is written
// adjacent to the archive-job callers (PendingJobOrchestrator,
// ArchiveCompletionService, RealtimeClient) but is deliberately NOT imported by
// them: while the live budget/parity decision is UNKNOWN the production manifest
// stays `ad12Selection:{state:'disabled'}`, so wiring is a later, separately
// authorized promotion task.
//
// ponytail: one copy per client (src/, mobile-app/src/, desktop-app/src/) because
// those are independent TypeScript build roots that cannot share a module.

export type RealtimeFirstPollPhase = 'foreground' | 'background';

/** Realtime-first fallback backoff schedule, in seconds. */
export const REALTIME_FIRST_BACKOFF_SECONDS: readonly number[] = [2, 4, 8, 15];

export class RealtimeFirstPollingPolicy {
  private attempt = 0;
  private phase: RealtimeFirstPollPhase = 'foreground';
  private terminal = false;

  /** Seconds until the next fallback poll; 0 means do not poll (background or done). */
  nextDelaySeconds(): number {
    if (this.terminal || this.phase === 'background') return 0;
    const index = Math.min(this.attempt, REALTIME_FIRST_BACKOFF_SECONDS.length - 1);
    return REALTIME_FIRST_BACKOFF_SECONDS[index] ?? 0;
  }

  /** Advance the backoff after a fallback poll fires; realtime stays preferred. */
  recordPollFired(): void {
    if (this.terminal || this.phase === 'background') return;
    this.attempt += 1;
  }

  /** Background pauses polling; foreground resumes at the current backoff stage. */
  setPhase(phase: RealtimeFirstPollPhase): void {
    this.phase = phase;
  }

  /** Cancel or reconnect: return to the shortest backoff, keep completion state. */
  reset(): void {
    this.attempt = 0;
  }

  /** New job cycle: clear backoff, foreground, and terminal completion. */
  restart(): void {
    this.attempt = 0;
    this.phase = 'foreground';
    this.terminal = false;
  }

  get isComplete(): boolean {
    return this.terminal;
  }

  /**
   * Idempotent terminal completion shared by the realtime and poll paths. The
   * side effect runs at most once even when a WebSocket event and a poll settle
   * in the same tick; only the first caller receives `true`.
   */
  complete(onTerminal: () => void): boolean {
    if (this.terminal) return false;
    this.terminal = true;
    onTerminal();
    return true;
  }
}
