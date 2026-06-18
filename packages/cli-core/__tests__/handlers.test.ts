import { describe, it, expect } from 'vitest';
import { dispatch } from '../src/core/registry';
import { COMMANDS } from '../src/core/flags';
import { BILLING_FALLBACK_MESSAGE, ErrorCode, type CliResponse } from '../src/core/response';
import { MockArchiverCliHost } from '../src/mock-host';

function ctx(host = new MockArchiverCliHost()) {
  return { host, version: '0.0.1' };
}

function expectErr(r: CliResponse<unknown>): asserts r is Extract<CliResponse<unknown>, { ok: false }> {
  expect(r.ok).toBe(false);
}
function expectOk(r: CliResponse<unknown>): asserts r is Extract<CliResponse<unknown>, { ok: true }> {
  expect(r.ok).toBe(true);
}

describe('status', () => {
  it('returns host status', async () => {
    const r = await dispatch(COMMANDS.DEFAULT, {}, ctx());
    expectOk(r);
    expect((r.data as { client: string }).client).toBe('mock');
  });
});

describe('archive', () => {
  it('queues and returns a jobId', async () => {
    const r = await dispatch(COMMANDS.ARCHIVE, { url: 'https://x.com/a/status/1' }, ctx());
    expectOk(r);
    const data = r.data as { jobId?: string; status: string; platform?: string };
    expect(data.jobId).toMatch(/^mock-job-/);
    expect(data.status).toBe('queued');
    expect(data.platform).toBe('x');
  });

  it('maps a missing required url to INVALID_ARGUMENT with the field', async () => {
    const r = await dispatch(COMMANDS.ARCHIVE, {}, ctx());
    expectErr(r);
    expect(r.error.code).toBe(ErrorCode.INVALID_ARGUMENT);
    expect(r.error.details?.field).toBe('url');
  });

  it('maps paywall + insufficient-credit to billing errors with the shared message', async () => {
    const paywall = await dispatch(COMMANDS.ARCHIVE, { url: 'https://x.com/paywall' }, ctx());
    expectErr(paywall);
    expect(paywall.error.code).toBe(ErrorCode.PAYWALL_REQUIRED);
    expect(paywall.error.message).toBe(BILLING_FALLBACK_MESSAGE);
    expect(paywall.error.retryable).toBe(false);

    const credits = await dispatch(COMMANDS.ARCHIVE, { url: 'https://x.com/nocredits' }, ctx());
    expectErr(credits);
    expect(credits.error.code).toBe(ErrorCode.INSUFFICIENT_CREDITS);
    expect(credits.error.message).toBe(BILLING_FALLBACK_MESSAGE);
  });
});

describe('jobs', () => {
  it('reports JOB_NOT_FOUND for an unknown id', async () => {
    const r = await dispatch(COMMANDS.JOB, { id: 'nope' }, ctx());
    expectErr(r);
    expect(r.error.code).toBe(ErrorCode.JOB_NOT_FOUND);
    expect(r.error.retryable).toBe(false);
  });

  it('round-trips a queued job through job + jobs', async () => {
    const host = new MockArchiverCliHost();
    const submitted = await dispatch(COMMANDS.ARCHIVE, { url: 'https://x.com/a' }, ctx(host));
    expectOk(submitted);
    const id = (submitted.data as { jobId: string }).jobId;

    const job = await dispatch(COMMANDS.JOB, { id }, ctx(host));
    expectOk(job);
    expect((job.data as { jobId: string }).jobId).toBe(id);

    const list = await dispatch(COMMANDS.JOBS, {}, ctx(host));
    expectOk(list);
    expect((list.data as { count: number }).count).toBe(1);
  });
});

describe('sync + tags', () => {
  it('expands target=all', async () => {
    const r = await dispatch(COMMANDS.SYNC, {}, ctx());
    expectOk(r);
    expect((r.data as { ran: string[] }).ran).toEqual(['subscriptions', 'library', 'pending']);
  });

  it('lists, creates, and applies tags idempotently', async () => {
    const host = new MockArchiverCliHost();
    const list = await dispatch(COMMANDS.TAGS, {}, ctx(host));
    expectOk(list);
    expect((list.data as { count: number }).count).toBeGreaterThanOrEqual(2);

    const created = await dispatch(COMMANDS.TAG_CREATE, { name: 'topic', color: '#f00' }, ctx(host));
    expectOk(created);

    const add = await dispatch(COMMANDS.TAG_APPLY, { path: 'Notes/x.md', tag: 'topic', action: 'add' }, ctx(host));
    expectOk(add);
    expect((add.data as { applied: boolean }).applied).toBe(true);

    const addAgain = await dispatch(COMMANDS.TAG_APPLY, { path: 'Notes/x.md', tag: 'topic', action: 'add' }, ctx(host));
    expectOk(addAgain);
    expect((addAgain.data as { noop: boolean }).noop).toBe(true);
  });
});

describe('dispatch guards', () => {
  it('OPERATION_FAILED for an unknown command', async () => {
    const r = await dispatch('social-archiver:nope', {}, ctx());
    expectErr(r);
    expect(r.error.code).toBe(ErrorCode.OPERATION_FAILED);
  });

  it('SERVICE_NOT_READY for a known-but-unimplemented command', async () => {
    const r = await dispatch(COMMANDS.PROFILE_CRAWL, { url: 'https://x.com/u' }, ctx());
    expectErr(r);
    expect(r.error.code).toBe(ErrorCode.SERVICE_NOT_READY);
    expect(r.error.retryable).toBe(false);
  });
});

describe('search', () => {
  it('returns snippet matches for a query', async () => {
    const r = await dispatch(COMMANDS.SEARCH, { q: 'react' }, ctx());
    expectOk(r);
    const data = r.data as { query: string; results: { archiveId: string; matchedField: string; snippet: string }[]; hasMore: boolean };
    expect(data.query).toBe('react');
    expect(data.results.length).toBeGreaterThanOrEqual(1);
    expect(data.results[0]!.archiveId).toBe('mock-1');
    expect(data.results[0]!.snippet).toContain('**');
    expect(data.hasMore).toBe(false);
  });

  it('maps a missing required q to INVALID_ARGUMENT with the field', async () => {
    const r = await dispatch(COMMANDS.SEARCH, {}, ctx());
    expectErr(r);
    expect(r.error.code).toBe(ErrorCode.INVALID_ARGUMENT);
    expect(r.error.details?.field).toBe('q');
  });

  it('returns an empty result set when nothing matches', async () => {
    const r = await dispatch(COMMANDS.SEARCH, { q: 'zzzznomatch' }, ctx());
    expectOk(r);
    const data = r.data as { results: unknown[]; hasMore: boolean; nextCursor: string | null };
    expect(data.results).toHaveLength(0);
    expect(data.hasMore).toBe(false);
    expect(data.nextCursor).toBeNull();
  });
});

describe('bookmark', () => {
  it('bookmarks the given archive IDs (Inbox → Archived)', async () => {
    const r = await dispatch(COMMANDS.BOOKMARK, { ids: 'a,b' }, ctx());
    expectOk(r);
    const data = r.data as { bookmarked: boolean; requested: number; updatedIds: string[] };
    expect(data.bookmarked).toBe(true);
    expect(data.requested).toBe(2);
    expect(data.updatedIds).toEqual(['a', 'b']);
  });

  it('un-bookmarks with --off (back to Inbox)', async () => {
    const r = await dispatch(COMMANDS.BOOKMARK, { ids: 'a', off: 'true' }, ctx());
    expectOk(r);
    expect((r.data as { bookmarked: boolean }).bookmarked).toBe(false);
  });

  it('maps missing --ids to INVALID_ARGUMENT with the field', async () => {
    const r = await dispatch(COMMANDS.BOOKMARK, {}, ctx());
    expectErr(r);
    expect(r.error.code).toBe(ErrorCode.INVALID_ARGUMENT);
    expect(r.error.details?.field).toBe('ids');
  });

  it('reports per-archive failures without failing the whole call', async () => {
    const r = await dispatch(COMMANDS.BOOKMARK, { ids: 'a,missing-1' }, ctx());
    expectOk(r);
    const data = r.data as { updatedIds: string[]; failed: Array<{ archiveId: string; code: string }> };
    expect(data.updatedIds).toEqual(['a']);
    expect(data.failed).toEqual([{ archiveId: 'missing-1', code: 'NOT_FOUND', message: expect.any(String) }]);
  });
});
