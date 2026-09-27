/**
 * Transport adapters binding the UnifiedExecutorScheduler to WorkersAPIClient.
 *
 * The poll lists the same per-kind backlogs the processors drain. Not the
 * unified GET /api/executor/jobs: that one skips job rows whose capability
 * encoding is `legacy_unresolved`, which is every row until the P2 backfill,
 * so it answered `empty` with a job waiting and nothing picked up a missed push.
 */

import type { WorkersAPIClient } from '../../services/WorkersAPIClient';
import type { ClaimOutcome, ExecutorKind, PollOutcome, UnifiedJob } from './UnifiedExecutorScheduler';

/**
 * The poll is only a fallback behind WS push, so it keeps the cadence the
 * Workers request budget was sized for: one request per 3 minutes when idle.
 */
export const BACKLOG_POLL_MS = 3 * 60 * 1000;
export const BACKLOG_ERROR_BACKOFF_MAX_MS = 15 * 60 * 1000;

/**
 * One listing per tick. The AI-action listing covers every AI job (comment.*
 * included), jobs adoptable from an offline executor and due retries, and it is
 * the presence heartbeat. Transcription and the legacy `ai_comment_jobs` table
 * (only retrying an old failed job still creates rows there) each get one tick
 * per 30-minute cycle.
 */
export const BACKLOG_LANES: readonly ExecutorKind[] = [
  'ai_action', 'ai_action', 'ai_action', 'ai_action', 'transcription',
  'ai_action', 'ai_action', 'ai_action', 'ai_action', 'ai_comment',
];

async function listLane(client: WorkersAPIClient, clientId: string, lane: ExecutorKind): Promise<UnifiedJob[]> {
  switch (lane) {
    case 'ai_action':
      return (await client.getAvailableAIActionJobs(clientId)).jobs
        .map((job) => ({ kind: 'ai_action', id: job.jobId, version: job.updatedAt }));
    case 'transcription':
      return (await client.getAvailableTranscriptionJobs()).jobs
        .map((job) => ({ kind: 'transcription', id: job.jobId, version: job.updatedAt }));
    case 'ai_comment':
      // This listing repeats the comment.* action jobs; route by id prefix like the WS bridge.
      return (await client.getAvailableAICommentJobs(clientId)).jobs
        .map((job) => ({ kind: job.jobId.startsWith('aiaj_') ? 'ai_action' : 'ai_comment', id: job.jobId, version: job.updatedAt }));
  }
}

/**
 * Every failure is transient (scheduler backoff). A 404/426 here is not a
 * reason to fall back to the processors' own timers: they list these same routes.
 */
export function createBacklogPoll(
  getClient: () => WorkersAPIClient | null | undefined,
  getClientId: () => string | undefined,
): () => Promise<PollOutcome> {
  let tick = 0;
  return async () => {
    const client = getClient();
    const clientId = getClientId();
    if (!client || !clientId) return { type: 'transient' };
    const lane = BACKLOG_LANES[tick % BACKLOG_LANES.length] ?? 'ai_action';
    tick += 1;
    try {
      const jobs = await listLane(client, clientId, lane);
      return jobs.length > 0
        ? { type: 'jobs', jobs, nextPollAfterMs: BACKLOG_POLL_MS }
        : { type: 'empty', nextPollAfterMs: BACKLOG_POLL_MS };
    } catch {
      return { type: 'transient' };
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
