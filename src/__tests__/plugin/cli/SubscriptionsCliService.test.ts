import { describe, expect, it, vi } from 'vitest';

import { CliValidationError } from '@/plugin/cli/CliParams';
import {
  SubscriptionsCliService,
  type SubscriptionsCliManager,
} from '@/plugin/cli/SubscriptionsCliService';

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    name: 'Alice',
    platform: 'threads',
    enabled: true,
    target: { handle: 'alice', profileUrl: 'https://www.threads.net/@alice' },
    state: { lastRunAt: '2026-08-06T00:00:00.000Z' },
    updatedAt: '2026-08-06T00:00:00.000Z',
    ...overrides,
  };
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    status: 'completed',
    trigger: 'scheduled',
    startedAt: '2026-08-06T09:00:00.000Z',
    completedAt: '2026-08-06T09:00:12.000Z',
    postsArchived: 2,
    creditsUsed: 0,
    ...overrides,
  };
}

function manager(overrides: Partial<SubscriptionsCliManager> = {}): SubscriptionsCliManager {
  return {
    getSubscriptions: vi.fn(() => [
      subscription(),
      subscription({ id: 'sub-2', name: 'Bob', enabled: false }),
    ]),
    updateSubscription: vi.fn(async (id: string, updates: { enabled?: boolean }) => ({
      id,
      name: 'Alice',
      platform: 'threads',
      enabled: updates.enabled ?? true,
    })),
    deleteSubscription: vi.fn(async () => undefined),
    triggerManualRun: vi.fn(async () => ({ id: 'run-9', status: 'running', trigger: 'manual' })),
    getRunHistory: vi.fn(async () => [run()]),
    ...overrides,
  } as SubscriptionsCliManager;
}

describe('list (default action)', () => {
  it('lists without an action flag, and reports how many are enabled', async () => {
    const result = await new SubscriptionsCliService(manager()).run({});

    expect(result).toMatchObject({ total: 2, enabledCount: 1 });
  });

  it('flattens the nested target so an agent need not walk target.handle', async () => {
    const result = (await new SubscriptionsCliService(manager()).run({ action: 'list' })) as {
      subscriptions: Array<Record<string, unknown>>;
    };

    expect(result.subscriptions[0]).toMatchObject({
      subscriptionId: 'sub-1',
      handle: 'alice',
      profileUrl: 'https://www.threads.net/@alice',
    });
    // Named subscriptionId, not id, so it feeds straight back into id=.
    expect(result.subscriptions[0]).not.toHaveProperty('id');
    expect(result.subscriptions[0]).not.toHaveProperty('target');
  });
});

describe('pause and resume', () => {
  it('patches only enabled', async () => {
    const api = manager();
    await new SubscriptionsCliService(api).run({ action: 'pause', id: 'sub-1' });

    expect(api.updateSubscription).toHaveBeenCalledWith('sub-1', { enabled: false });
  });

  it('returns the state the manager confirmed, not the one requested', async () => {
    const api = manager({
      updateSubscription: vi.fn(async () => ({
        id: 'sub-1',
        name: 'Alice',
        platform: 'threads',
        enabled: true,
      })),
    });

    await expect(
      new SubscriptionsCliService(api).run({ action: 'pause', id: 'sub-1' }),
    ).resolves.toMatchObject({ enabled: true });
  });
});

describe('run and runs', () => {
  it('returns the runId so the caller can poll', async () => {
    await expect(
      new SubscriptionsCliService(manager()).run({ action: 'run', id: 'sub-1' }),
    ).resolves.toMatchObject({ subscriptionId: 'sub-1', runId: 'run-9', trigger: 'manual' });
  });

  it('surfaces the failure reason, which is the point of exposing history', async () => {
    const api = manager({
      getRunHistory: vi.fn(async () => [
        run({ status: 'failed', error: 'account_not_found', postsArchived: 0 }),
      ]),
    });

    const result = (await new SubscriptionsCliService(api).run({
      action: 'runs',
      id: 'sub-1',
    })) as { runs: Array<Record<string, unknown>> };

    expect(result.runs[0]).toMatchObject({ status: 'failed', error: 'account_not_found' });
  });

  it('omits error on a successful run rather than emitting undefined', async () => {
    const result = (await new SubscriptionsCliService(manager()).run({
      action: 'runs',
      id: 'sub-1',
    })) as { runs: Array<Record<string, unknown>> };

    expect(result.runs[0]).not.toHaveProperty('error');
  });
});

describe('delete', () => {
  it('refuses without confirm=true, before calling the manager', async () => {
    const api = manager();

    await expect(
      new SubscriptionsCliService(api).run({ action: 'delete', id: 'sub-1' }),
    ).rejects.toBeInstanceOf(CliValidationError);
    expect(api.deleteSubscription).not.toHaveBeenCalled();
  });

  it('deletes once confirmed', async () => {
    const api = manager();

    await expect(
      new SubscriptionsCliService(api).run({ action: 'delete', id: 'sub-1', confirm: 'true' }),
    ).resolves.toEqual({ subscriptionId: 'sub-1', deleted: true });
    expect(api.deleteSubscription).toHaveBeenCalledWith('sub-1');
  });
});

describe('argument guards', () => {
  it('requires id for every action except list, and says where to get one', async () => {
    const api = manager();

    for (const action of ['pause', 'resume', 'run', 'runs', 'delete']) {
      const error = await new SubscriptionsCliService(api).run({ action }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(CliValidationError);
      expect((error as Error).message).toContain('social-archiver:subscriptions');
    }

    expect(api.updateSubscription).not.toHaveBeenCalled();
    expect(api.triggerManualRun).not.toHaveBeenCalled();
    expect(api.deleteSubscription).not.toHaveBeenCalled();
  });

  it('rejects an unknown action instead of silently listing', async () => {
    await expect(
      new SubscriptionsCliService(manager()).run({ action: 'destroy' }),
    ).rejects.toBeInstanceOf(CliValidationError);
  });
});
