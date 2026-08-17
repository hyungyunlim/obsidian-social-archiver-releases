/**
 * Transport adapters binding the UnifiedExecutorScheduler to WorkersAPIClient
 * (GET /api/executor/jobs). Pure mapping lives in exported functions so the
 * status semantics are unit-tested without HTTP.
 */

import type { WorkersAPIClient } from '../../services/WorkersAPIClient';
import type { ClaimOutcome, ExecutorKind, PollOutcome, UnifiedJob } from './UnifiedExecutorScheduler';

/**
 * The server's nextPollAfterMs is tuned for dedicated CLI executors (15s
 * idle). The plugin's poll is only a fallback behind WS push, and its legacy
 * cadence was one backlog pass per 3 minutes — following the server's pacing
 * would RAISE total request volume 4x. The floor keeps the 3→1 merge a strict
 * reduction; polling later than the server asks is always safe.
 */
export const UNIFIED_IDLE_FLOOR_MS = 3 * 60 * 1000;
export const UNIFIED_PARTIAL_POLL_MS = 30 * 1000;
export const UNIFIED_ERROR_BACKOFF_MAX_MS = 15 * 60 * 1000;

const KINDS: readonly ExecutorKind[] = ['ai_comment', 'ai_action', 'transcription'];

function clampNextPoll(raw: unknown): number {
  const ms = typeof raw === 'number' && Number.isFinite(raw) ? raw : UNIFIED_IDLE_FLOOR_MS;
  return Math.max(ms, UNIFIED_IDLE_FLOOR_MS);
}

/** Map the unwrapped `{ jobs, partial, ... }` poll payload onto a PollOutcome. */
export function mapUnifiedPollSuccess(data: unknown): PollOutcome {
  const record = (data ?? {}) as Record<string, unknown>;
  const rawJobs = Array.isArray(record['jobs']) ? (record['jobs'] as Record<string, unknown>[]) : [];
  const jobs: UnifiedJob[] = rawJobs
    .filter((job) => KINDS.includes(job['kind'] as ExecutorKind) && typeof job['id'] === 'string')
    .map((job) => ({
      kind: job['kind'] as ExecutorKind,
      id: job['id'] as string,
      claimUrl: typeof job['claimUrl'] === 'string' ? job['claimUrl'] : undefined,
    }));
  const partial = record['partial'] === true;
  const nextPollAfterMs = clampNextPoll(record['nextPollAfterMs']);
  if (jobs.length === 0 && !partial) return { type: 'empty', nextPollAfterMs };
  const indeterminateKinds = Array.isArray(record['indeterminateKinds'])
    ? (record['indeterminateKinds'] as ExecutorKind[]).filter((kind) => KINDS.includes(kind))
    : [];
  return { type: 'jobs', jobs, partial, indeterminateKinds, nextPollAfterMs };
}

/** WorkersAPIClient.request throws on non-success envelopes with `.status` attached. */
export function mapUnifiedPollFailure(error: unknown): PollOutcome {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 404) return { type: 'not_found' };
  if (status === 426) return { type: 'upgrade' };
  if (status === 503) return { type: 'indeterminate', nextPollAfterMs: UNIFIED_PARTIAL_POLL_MS };
  return { type: 'transient' };
}

export function createUnifiedPoll(
  getClient: () => WorkersAPIClient | null | undefined,
  getClientId: () => string | undefined,
): () => Promise<PollOutcome> {
  return async () => {
    const client = getClient();
    const clientId = getClientId();
    if (!client || !clientId) return { type: 'transient' };
    try {
      return mapUnifiedPollSuccess(await client.pollUnifiedExecutorJobs(clientId));
    } catch (error) {
      return mapUnifiedPollFailure(error);
    }
  };
}

/**
 * Claim is a deliberate pass-through: the processors legacy-claim inside their
 * push seams (handleRequestedJob → detail fetch → ownership check → claim),
 * and the legacy claim is NOT holder-reentrant — a job in 'claimed' status is
 * JOB_NOT_AVAILABLE even to its own holder, so a real CAS claim here would
 * strand every dispatched job until lease expiry. Wire the unified claim only
 * when the processors accept a handed-down lockToken.
 */
export function passthroughClaim(job: UnifiedJob): Promise<ClaimOutcome> {
  return Promise.resolve({ ok: true, kind: job.kind, id: job.id, lockToken: '', lockTokenVersion: 0 });
}
