import { afterEach, describe, expect, it, vi } from 'vitest';
import { AICommentService } from '../../../services/AICommentService';
import { setByokService } from '../../../services/byok/ByokService';
import {
  ByokResearchRunner,
  DEEP_RESEARCH_POLL_MS,
  DEEP_RESEARCH_STORE_KEY,
  DEEP_RESEARCH_TIMEOUT_MS,
  ResearchError,
  type DeepResearchRecord,
  type ResearchNoticeAction,
} from '../../../services/byok/ByokResearchRunner';
import { createObsidianByokStore } from '../../../services/byok/ObsidianByokStore';
import type { AICommentTarget } from '../../../services/ai-comment/AICommentSaver';
import type { AICommentMeta } from '../../../types/ai-comment';
import type { PostData } from '../../../types/post';
import type { AICommentBudget, ByokHttpRequest } from '../../../vendor/byok-ai-core';
import { byokFixture, openaiAnswer, openaiModels, readyOpenAI, type ScriptedAnswer } from './byokTestKit';

const PATH = 'Social Archives/X/2026/11/Kubernetes at ten.md';
const POST = {
  platform: 'x',
  id: 'post-1',
  url: 'https://x.com/a/status/1',
  filePath: PATH,
  sourceArchiveId: 'archive-1',
  title: 'Kubernetes at ten',
  author: { name: 'Ada', url: '' },
  content: { text: 'Kubernetes was released by Google in 2014 and now runs most clusters.' },
  media: [],
  metadata: { timestamp: '2026-11-04T00:00:00.000Z' },
} as unknown as PostData;
const LIVE = openaiModels('gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.1-sol');
const REPORT = '## Summary\n\nIt was released in 2014.\n\n### Claim check\n\nSupported.';

function fakeTarget(budget: AICommentBudget | null = { maxChars: 40_000, maxJsonBytes: 600_000 }) {
  const saved: { meta: AICommentMeta; content: string }[] = [];
  const target: AICommentTarget = {
    post: POST,
    budget: async () => budget,
    save: async (meta, content) => {
      saved.push({ meta, content });
    },
  };
  return { saved, target };
}

function fakeScheduler() {
  let next = 1;
  const pending = new Map<number, { callback: () => void; ms: number }>();
  return {
    schedule: (callback: () => void, ms: number): number => {
      pending.set(next, { callback, ms });
      return next++;
    },
    clearSchedule: (id: number): void => {
      pending.delete(id);
    },
    delays: (): number[] => [...pending.values()].map((entry) => entry.ms),
    /** Fires everything due and waits for the async polls to settle. */
    async tick(): Promise<void> {
      const due = [...pending.values()];
      pending.clear();
      for (const entry of due) entry.callback();
      for (let i = 0; i < 20; i++) await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    },
  };
}

/** OpenAI routes: models, quick answer, background start, poll answers in order, cancel. */
function deepRoutes(polls: ScriptedAnswer[]) {
  return (req: ByokHttpRequest): ScriptedAnswer => {
    if (req.method === 'GET' && req.url.endsWith('/v1/models')) return LIVE;
    if (req.method === 'POST' && req.url.endsWith('/v1/responses')) {
      const body = JSON.parse(req.body ?? '{}') as { background?: boolean };
      return body.background
        ? { status: 200, json: { id: 'resp_deep_1', model: 'gpt-6.1-sol-2026-10-20', status: 'queued' } }
        : openaiAnswer(REPORT, 'gpt-6.1-terra-2026-10-01');
    }
    if (req.method === 'GET' && req.url.endsWith('/v1/responses/resp_deep_1')) {
      return polls.shift() ?? { status: 200, json: { status: 'in_progress' } };
    }
    if (req.method === 'POST' && req.url.endsWith('/cancel')) return { status: 200, json: { status: 'cancelled' } };
    return { status: 404, json: { error: { message: `unexpected ${req.method} ${req.url}` } } };
  };
}

const completed: ScriptedAnswer = {
  status: 200,
  json: {
    status: 'completed',
    model: 'gpt-6.1-sol-2026-10-20',
    output: [{
      type: 'message',
      content: [{
        type: 'output_text',
        text: REPORT,
        annotations: [{ type: 'url_citation', url: 'https://kubernetes.io/blog/', title: 'Kubernetes blog' }],
      }],
    }],
  },
};

async function setup(polls: ScriptedAnswer[] = [], options: { now?: () => number; target?: AICommentTarget | null } = {}) {
  const fixture = byokFixture({ answer: deepRoutes(polls) });
  await readyOpenAI(fixture);
  setByokService(fixture.service);
  const scheduler = fakeScheduler();
  const notices: { message: string; action?: ResearchNoticeAction }[] = [];
  const store = createObsidianByokStore(fixture.app);
  const { saved, target } = fakeTarget();
  const resolveTarget = vi.fn(async (_record: DeepResearchRecord) => (options.target === undefined ? target : options.target));
  const make = () =>
    new ByokResearchRunner({
      byok: () => fixture.service,
      store,
      generateComment: (content, opts) => new AICommentService().generateComment(content, opts),
      resolveTarget,
      notify: (message, action) => notices.push({ message, ...(action ? { action } : {}) }),
      schedule: scheduler.schedule,
      clearSchedule: scheduler.clearSchedule,
      ...(options.now ? { now: options.now } : {}),
      newId: () => 'local-1',
    });
  return { fixture, scheduler, notices, store, saved, target, resolveTarget, make, runner: make() };
}

const stored = async (store: ReturnType<typeof createObsidianByokStore>): Promise<DeepResearchRecord[]> =>
  JSON.parse((await store.get(DEEP_RESEARCH_STORE_KEY)) ?? '[]') as DeepResearchRecord[];

describe('ByokResearchRunner quick research', () => {
  afterEach(() => {
    setByokService(null);
    vi.restoreAllMocks();
  });

  it('researches with web search and saves a research comment without ###-level headings', async () => {
    const { runner, fixture } = await setup();
    const { saved: mine, target } = fakeTarget();
    await runner.runQuick({ target, engine: 'openai-api', focus: '  the 2014   date ' });
    expect(mine).toHaveLength(1);
    expect(mine[0]?.meta).toMatchObject({ cli: 'openai-api', type: 'research', model: 'gpt-6.1-terra', executedModel: 'gpt-6.1-terra-2026-10-01' });
    expect(mine[0]?.content).not.toMatch(/^#{1,3} /m);
    expect(mine[0]?.content).toContain('#### Summary');

    const body = JSON.parse(fixture.transport.calls.filter((req) => req.method === 'POST').at(-1)?.body ?? '{}') as {
      tools?: unknown;
      input: { content: string }[];
      instructions: string;
    };
    expect(body.tools).toEqual([{ type: 'web_search' }]);
    expect(body.instructions).toContain('Title: Kubernetes at ten');
    expect(body.input[0]?.content).toContain('The user asks you to focus on: the 2014 date');
  });

  it('asks for room instead of dropping the report', async () => {
    const { runner } = await setup();
    const { saved, target } = fakeTarget(null);
    await expect(runner.runQuick({ target, engine: 'openai-api' })).rejects.toBeInstanceOf(ResearchError);
    expect(saved).toHaveLength(0);
  });
});

describe('ByokResearchRunner deep research', () => {
  afterEach(() => {
    setByokService(null);
    vi.restoreAllMocks();
  });

  it('starts a background job, keeps its handle on the device, polls and saves the report', async () => {
    const { runner, scheduler, store, saved, notices, fixture } = await setup([{ status: 200, json: { status: 'in_progress' } }, completed]);
    await runner.startDeep({ target: fakeTarget().target, provider: 'openai', focus: 'dates' });

    const start = fixture.transport.calls.find((req) => req.method === 'POST');
    expect(JSON.parse(start?.body ?? '{}')).toMatchObject({ model: 'gpt-6.1-sol', background: true, store: true, tools: [{ type: 'web_search' }] });
    const [record] = await stored(store);
    expect(record).toMatchObject({ localId: 'local-1', filePath: PATH, archiveId: 'archive-1', focus: 'dates', handle: { provider: 'openai', id: 'resp_deep_1' } });
    expect(runner.isDeepRunning(PATH)).toBe(true);
    expect(scheduler.delays()).toEqual([DEEP_RESEARCH_POLL_MS]);

    await scheduler.tick(); // in_progress
    expect(saved).toHaveLength(0);
    expect(scheduler.delays()).toEqual([DEEP_RESEARCH_POLL_MS]);

    await scheduler.tick(); // completed
    expect(saved).toHaveLength(1);
    expect(saved[0]?.meta).toMatchObject({ cli: 'openai-api', type: 'research', model: 'gpt-6.1-sol', executedModel: 'gpt-6.1-sol-2026-10-20' });
    expect(saved[0]?.content).toContain('#### Claim check');
    expect(saved[0]?.content).toContain('[Kubernetes blog](https://kubernetes.io/blog/)');
    expect(await stored(store)).toEqual([]);
    expect(runner.isDeepRunning(PATH)).toBe(false);
    expect(notices.at(-1)?.message).toBe('Deep research saved to “Kubernetes at ten”.');
  });

  it('refuses a second deep research for the same note', async () => {
    const { runner } = await setup();
    await runner.startDeep({ target: fakeTarget().target, provider: 'openai' });
    await expect(runner.startDeep({ target: fakeTarget().target, provider: 'openai' })).rejects.toMatchObject({ code: 'deep_running' });
  });

  it('resumes a job started before a restart', async () => {
    const first = await setup([completed]);
    await first.runner.startDeep({ target: first.target, provider: 'openai' });
    first.runner.dispose();
    expect(await stored(first.store)).toHaveLength(1);

    const next = first.make();
    await next.resume();
    expect(first.scheduler.delays()).toEqual([0]);
    await first.scheduler.tick();
    expect(first.saved).toHaveLength(1);
    expect(first.resolveTarget).toHaveBeenCalledWith(expect.objectContaining({ filePath: PATH }));
    expect(await stored(first.store)).toEqual([]);
  });

  it('keeps polling through a failed poll request', async () => {
    const { runner, scheduler, saved } = await setup([{ status: 503, json: { error: { message: 'overloaded' } } }, completed]);
    await runner.startDeep({ target: fakeTarget().target, provider: 'openai' });
    await scheduler.tick();
    expect(saved).toHaveLength(0);
    expect(scheduler.delays()).toEqual([DEEP_RESEARCH_POLL_MS]);
    await scheduler.tick();
    expect(saved).toHaveLength(1);
  });

  it('reports a failed job with Run again, which starts a new one', async () => {
    const failed: ScriptedAnswer = { status: 200, json: { status: 'failed', error: { code: 'server_error', message: 'boom' } } };
    const { runner, scheduler, store, notices, fixture } = await setup([failed]);
    await runner.startDeep({ target: fakeTarget().target, provider: 'openai', focus: 'dates' });
    await scheduler.tick();

    const notice = notices.at(-1);
    expect(notice?.message).toMatch(/^Deep research on “Kubernetes at ten” failed: /);
    expect(notice?.action?.label).toBe('Run again');
    expect(await stored(store)).toEqual([]);

    const starts = () => fixture.transport.calls.filter((req) => req.method === 'POST' && req.url.endsWith('/v1/responses')).length;
    expect(starts()).toBe(1);
    notice?.action?.run();
    await vi.waitFor(() => expect(starts()).toBe(2));
    await vi.waitFor(async () => expect(await stored(store)).toHaveLength(1));
    expect((await stored(store))[0]?.focus).toBe('dates');
  });

  it('still collects a report that finished while the plugin was away past the hour', async () => {
    let now = 1_000_000;
    const { runner, scheduler, saved } = await setup([{ status: 503, json: { error: { message: 'offline' } } }, completed], { now: () => now });
    await runner.startDeep({ target: fakeTarget().target, provider: 'openai' });
    now += 2 * DEEP_RESEARCH_TIMEOUT_MS;
    await scheduler.tick(); // the poll request fails: not a reason to give up
    expect(scheduler.delays()).toEqual([DEEP_RESEARCH_POLL_MS]);
    await scheduler.tick();
    expect(saved).toHaveLength(1);
  });

  it('cancels a job that runs past an hour', async () => {
    let now = 1_000_000;
    const { runner, scheduler, store, notices, fixture } = await setup([], { now: () => now });
    await runner.startDeep({ target: fakeTarget().target, provider: 'openai' });
    now += DEEP_RESEARCH_TIMEOUT_MS;
    await scheduler.tick();

    expect(fixture.transport.calls.some((req) => req.method === 'POST' && req.url.endsWith('/v1/responses/resp_deep_1/cancel'))).toBe(true);
    expect(await stored(store)).toEqual([]);
    expect(notices.at(-1)?.message).toBe('Deep research on “Kubernetes at ten” ran for over an hour and was stopped.');
    expect(notices.at(-1)?.action?.label).toBe('Run again');
    expect(scheduler.delays()).toEqual([]);
  });

  it('keeps a finished report it has no room for, and saves it on Try again', async () => {
    const full = fakeTarget(null);
    const { runner, scheduler, store, notices, saved, resolveTarget } = await setup([completed, completed], { target: full.target });
    await runner.startDeep({ target: full.target, provider: 'openai' });
    await scheduler.tick();
    expect(notices.at(-1)?.message).toBe(
      'Deep research on “Kubernetes at ten” is ready, but the note has too much AI comment text. Delete some AI comments, then try again.',
    );
    expect(await stored(store)).toHaveLength(1);
    expect(full.saved).toHaveLength(0);
    expect(scheduler.delays()).toEqual([]);

    // The user deleted some comments: the note has room now.
    const roomy = fakeTarget();
    resolveTarget.mockReset().mockResolvedValue(roomy.target);
    notices.at(-1)?.action?.run();
    await scheduler.tick();
    expect(roomy.saved).toHaveLength(1);
    expect(saved).toHaveLength(0);
    expect(await stored(store)).toEqual([]);
  });

  it('forgets a job whose note is gone', async () => {
    const { runner, scheduler, store, notices } = await setup([completed], { target: null });
    await runner.startDeep({ target: fakeTarget().target, provider: 'openai' });
    await scheduler.tick();
    expect(await stored(store)).toEqual([]);
    expect(notices.at(-1)?.message).toBe('Deep research finished, but its note is gone.');
  });
});
