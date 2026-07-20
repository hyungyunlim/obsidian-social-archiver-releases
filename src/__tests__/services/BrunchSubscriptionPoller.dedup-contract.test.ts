import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Task 37 dedup contract (characterization): the Brunch poller already records
 * ONLY successfully-archived posts as seen. This locks that behavior in so a
 * failed local archive can never be silently marked seen and lost to retry.
 */

vi.mock('../../services/BrunchLocalService', () => ({
  BrunchLocalService: class {
    async discoverUserId(): Promise<string> { return 'uid-1'; }
    async fetchMemberPosts(): Promise<unknown> {
      return {
        posts: [
          { id: 'post-1', text: 'first' },
          { id: 'post-2', text: 'second' },
        ],
        nextCursor: 'cursor-2',
      };
    }
  },
  BrunchError: class extends Error {},
}));

import { BrunchSubscriptionPoller } from '../../services/BrunchSubscriptionPoller';

interface UpdateStateCall { archivedPostIds?: string[]; archivedPostHashes?: string[] }

const brunchSub = {
  id: 'sub-brunch',
  target: { handle: 'writer:uid-1' },
  state: { cursor: undefined },
} as never;

function buildPoller(): { poller: BrunchSubscriptionPoller; updates: UpdateStateCall[] } {
  const plugin = { settings: { workerUrl: 'http://worker', authToken: 'token' } } as never;
  const poller = new BrunchSubscriptionPoller(plugin);
  const updates: UpdateStateCall[] = [];
  vi.spyOn(poller as never as { updateSubscriptionState: unknown }, 'updateSubscriptionState')
    .mockImplementation(((_id: string, update: UpdateStateCall) => { updates.push(update); return Promise.resolve(); }) as never);
  vi.spyOn(poller as never as { checkDuplicates: unknown }, 'checkDuplicates')
    .mockResolvedValue(new Set<string>() as never);
  return { poller, updates };
}

describe('BrunchSubscriptionPoller dedup contract (only successful archives mark seen)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('excludes a failed local archive from archivedPostIds', async () => {
    const { poller, updates } = buildPoller();
    vi.spyOn(poller as never as { archivePost: unknown }, 'archivePost')
      .mockImplementation(((post: { id: string }) => (post.id === 'post-2'
        ? Promise.reject(new Error('vault write failed'))
        : Promise.resolve())) as never);

    await poller.pollSubscription(brunchSub);

    const seen = updates.find((u) => u.archivedPostIds !== undefined);
    expect(seen?.archivedPostIds).toEqual(['post-1']);
    expect(seen?.archivedPostIds).not.toContain('post-2');
    expect(seen?.archivedPostHashes).toHaveLength(1);
  });

  it('marks every post seen when all archives succeed', async () => {
    const { poller, updates } = buildPoller();
    vi.spyOn(poller as never as { archivePost: unknown }, 'archivePost')
      .mockResolvedValue(undefined as never);

    await poller.pollSubscription(brunchSub);

    const seen = updates.find((u) => u.archivedPostIds !== undefined);
    expect(seen?.archivedPostIds).toEqual(['post-1', 'post-2']);
    expect(seen?.archivedPostHashes).toHaveLength(2);
  });
});
