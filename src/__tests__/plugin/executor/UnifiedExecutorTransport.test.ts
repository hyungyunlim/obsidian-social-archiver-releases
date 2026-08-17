import { describe, expect, it } from 'vitest';
import {
  UNIFIED_IDLE_FLOOR_MS,
  UNIFIED_PARTIAL_POLL_MS,
  createUnifiedPoll,
  mapUnifiedPollFailure,
  mapUnifiedPollSuccess,
  passthroughClaim,
} from '../../../plugin/executor/UnifiedExecutorTransport';
import type { WorkersAPIClient } from '../../../services/WorkersAPIClient';

describe('mapUnifiedPollSuccess', () => {
  it('clamps the server idle cadence up to the plugin floor', () => {
    const outcome = mapUnifiedPollSuccess({ jobs: [], partial: false, nextPollAfterMs: 15_000 });
    expect(outcome).toEqual({ type: 'empty', nextPollAfterMs: UNIFIED_IDLE_FLOOR_MS });
  });

  it('keeps a server cadence slower than the floor', () => {
    const outcome = mapUnifiedPollSuccess({ jobs: [], partial: false, nextPollAfterMs: UNIFIED_IDLE_FLOOR_MS * 2 });
    expect(outcome).toEqual({ type: 'empty', nextPollAfterMs: UNIFIED_IDLE_FLOOR_MS * 2 });
  });

  it('maps job rows and drops unknown kinds or missing ids', () => {
    const outcome = mapUnifiedPollSuccess({
      jobs: [
        { kind: 'ai_comment', id: 'c1' },
        { kind: 'transcription', id: 't1', claimUrl: '/claim' },
        { kind: 'mystery', id: 'x1' },
        { kind: 'ai_action' },
      ],
      partial: false,
      indeterminateKinds: ['transcription', 'mystery'],
      nextPollAfterMs: 15_000,
    });
    expect(outcome).toEqual({
      type: 'jobs',
      jobs: [
        { kind: 'ai_comment', id: 'c1', claimUrl: undefined },
        { kind: 'transcription', id: 't1', claimUrl: '/claim' },
      ],
      partial: false,
      indeterminateKinds: ['transcription'],
      nextPollAfterMs: UNIFIED_IDLE_FLOOR_MS,
    });
  });

  it('treats a partial response with zero jobs as a jobs outcome, not empty', () => {
    const outcome = mapUnifiedPollSuccess({ jobs: [], partial: true, nextPollAfterMs: 15_000 });
    expect(outcome.type).toBe('jobs');
    if (outcome.type === 'jobs') expect(outcome.partial).toBe(true);
  });

  it('survives a malformed payload', () => {
    expect(mapUnifiedPollSuccess(null)).toEqual({ type: 'empty', nextPollAfterMs: UNIFIED_IDLE_FLOOR_MS });
  });
});

describe('mapUnifiedPollFailure', () => {
  it('maps the explicit protocol statuses', () => {
    expect(mapUnifiedPollFailure({ status: 404 })).toEqual({ type: 'not_found' });
    expect(mapUnifiedPollFailure({ status: 426 })).toEqual({ type: 'upgrade' });
    expect(mapUnifiedPollFailure({ status: 503 }))
      .toEqual({ type: 'indeterminate', nextPollAfterMs: UNIFIED_PARTIAL_POLL_MS });
  });

  it('treats everything else as transient', () => {
    expect(mapUnifiedPollFailure({ status: 500 })).toEqual({ type: 'transient' });
    expect(mapUnifiedPollFailure({ status: 429 })).toEqual({ type: 'transient' });
    expect(mapUnifiedPollFailure(new Error('network'))).toEqual({ type: 'transient' });
    expect(mapUnifiedPollFailure(null)).toEqual({ type: 'transient' });
  });
});

describe('createUnifiedPoll', () => {
  it('polls through the api client and maps the payload', async () => {
    const seen: string[] = [];
    const client = {
      pollUnifiedExecutorJobs: async (clientId: string) => {
        seen.push(clientId);
        return { jobs: [{ kind: 'ai_comment', id: 'c1' }], partial: false, indeterminateKinds: [], nextPollAfterMs: 15_000, presenceAcceptedAt: null };
      },
    } as unknown as WorkersAPIClient;
    const poll = createUnifiedPoll(() => client, () => 'client-1');
    const outcome = await poll();
    expect(seen).toEqual(['client-1']);
    expect(outcome.type).toBe('jobs');
  });

  it('maps thrown statuses and missing client/clientId to outcomes', async () => {
    const throwing = {
      pollUnifiedExecutorJobs: async () => {
        throw Object.assign(new Error('gone'), { status: 404 });
      },
    } as unknown as WorkersAPIClient;
    expect(await createUnifiedPoll(() => throwing, () => 'client-1')()).toEqual({ type: 'not_found' });
    expect(await createUnifiedPoll(() => null, () => 'client-1')()).toEqual({ type: 'transient' });
    expect(await createUnifiedPoll(() => throwing, () => undefined)()).toEqual({ type: 'transient' });
  });
});

describe('passthroughClaim', () => {
  it('always succeeds without a lock token', async () => {
    await expect(passthroughClaim({ kind: 'transcription', id: 't1' })).resolves.toEqual({
      ok: true,
      kind: 'transcription',
      id: 't1',
      lockToken: '',
      lockTokenVersion: 0,
    });
  });
});
