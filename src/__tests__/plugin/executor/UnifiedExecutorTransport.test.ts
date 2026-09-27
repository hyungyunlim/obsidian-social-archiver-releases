import { describe, expect, it } from 'vitest';
import {
  BACKLOG_LANES,
  BACKLOG_POLL_MS,
  createBacklogPoll,
  passthroughClaim,
} from '../../../plugin/executor/UnifiedExecutorTransport';
import type { WorkersAPIClient } from '../../../services/WorkersAPIClient';

type Row = { jobId: string; updatedAt: string };

function fakeClient(rows: { action?: Row[]; comment?: Row[]; transcription?: Row[]; fail?: boolean } = {}) {
  const calls: string[] = [];
  const list = async (lane: string, jobs: Row[] | undefined) => {
    calls.push(lane);
    if (rows.fail) throw Object.assign(new Error('gone'), { status: 404 });
    return { jobs: jobs ?? [] };
  };
  const client = {
    getAvailableAIActionJobs: (clientId: string) => list(`ai_action:${clientId}`, rows.action),
    getAvailableAICommentJobs: (clientId: string) => list(`ai_comment:${clientId}`, rows.comment),
    getAvailableTranscriptionJobs: () => list('transcription', rows.transcription),
  } as unknown as WorkersAPIClient;
  return { client, calls };
}

describe('createBacklogPoll', () => {
  it('sends one listing per tick: the AI-action lane, plus transcription and legacy comments once per cycle', async () => {
    const { client, calls } = fakeClient();
    const poll = createBacklogPoll(() => client, () => 'c1');
    for (let i = 0; i < BACKLOG_LANES.length + 1; i += 1) await poll();
    expect(calls).toEqual([
      'ai_action:c1', 'ai_action:c1', 'ai_action:c1', 'ai_action:c1', 'transcription',
      'ai_action:c1', 'ai_action:c1', 'ai_action:c1', 'ai_action:c1', 'ai_comment:c1',
      'ai_action:c1',
    ]);
  });

  it('maps listed rows to jobs carrying the row version, and an empty listing to empty', async () => {
    const { client } = fakeClient({ action: [{ jobId: 'aiaj_1', updatedAt: 'v1' }] });
    expect(await createBacklogPoll(() => client, () => 'c1')()).toEqual({
      type: 'jobs',
      jobs: [{ kind: 'ai_action', id: 'aiaj_1', version: 'v1' }],
      nextPollAfterMs: BACKLOG_POLL_MS,
    });
    expect(await createBacklogPoll(() => fakeClient().client, () => 'c1')())
      .toEqual({ type: 'empty', nextPollAfterMs: BACKLOG_POLL_MS });
  });

  it('routes the legacy comment listing by id prefix', async () => {
    const { client } = fakeClient({
      comment: [{ jobId: 'aicj_1', updatedAt: 'v1' }, { jobId: 'aiaj_2', updatedAt: 'v2' }],
      transcription: [{ jobId: 'tj_1', updatedAt: 'v3' }],
    });
    const poll = createBacklogPoll(() => client, () => 'c1');
    const outcomes = [];
    for (let i = 0; i < BACKLOG_LANES.length; i += 1) outcomes.push(await poll());
    expect(outcomes[4]).toMatchObject({ type: 'jobs', jobs: [{ kind: 'transcription', id: 'tj_1', version: 'v3' }] });
    expect(outcomes[9]).toMatchObject({
      type: 'jobs',
      jobs: [{ kind: 'ai_comment', id: 'aicj_1' }, { kind: 'ai_action', id: 'aiaj_2' }],
    });
  });

  it('treats any failure as transient and still moves to the next lane', async () => {
    const failing = fakeClient({ fail: true });
    const poll = createBacklogPoll(() => failing.client, () => 'c1');
    for (let i = 0; i < 5; i += 1) expect(await poll()).toEqual({ type: 'transient' });
    expect(failing.calls[4]).toBe('transcription');
  });

  it('is transient without a request when the client or clientId is missing', async () => {
    const { client, calls } = fakeClient();
    expect(await createBacklogPoll(() => null, () => 'c1')()).toEqual({ type: 'transient' });
    expect(await createBacklogPoll(() => client, () => undefined)()).toEqual({ type: 'transient' });
    expect(calls).toEqual([]);
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
