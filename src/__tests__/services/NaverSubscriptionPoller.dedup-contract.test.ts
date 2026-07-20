import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Task 37 dedup contract: the Naver poller must mark a post seen (via
 * update-state `archivedPostIds`/`archivedPostHashes`) ONLY when its local
 * archive actually succeeded. A post whose archive throws must stay eligible for
 * retry next run — never silently recorded as seen.
 */

vi.mock('../../services/NaverBlogLocalService', () => ({
  NaverBlogLocalService: class {
    async fetchMemberPosts(): Promise<unknown> {
      return {
        posts: [
          { id: 'post-1', text: 'first', title: 'First', timestamp: '2026-07-16T00:00:00.000Z' },
          { id: 'post-2', text: 'second', title: 'Second', timestamp: '2026-07-16T01:00:00.000Z' },
        ],
        nextCursor: 'cursor-2',
      };
    }
    async fetchRSS(): Promise<unknown> { return {}; }
  },
}));
vi.mock('../../services/NaverCafeLocalService', () => ({
  NaverCafeLocalService: class {},
  NaverCafeAuthError: class extends Error {},
}));

import { NaverSubscriptionPoller } from '../../services/NaverSubscriptionPoller';

interface UpdateStateCall { archivedPostIds?: string[]; archivedPostHashes?: string[] }

function buildPoller(): { poller: NaverSubscriptionPoller; updates: UpdateStateCall[] } {
  const plugin = { settings: { workerUrl: 'http://worker', authToken: 'token' } } as never;
  const poller = new NaverSubscriptionPoller(plugin);
  const updates: UpdateStateCall[] = [];
  vi.spyOn(poller as never as { updateWorkerState: unknown }, 'updateWorkerState')
    .mockImplementation(((_id: string, update: UpdateStateCall) => { updates.push(update); return Promise.resolve({ success: true }); }) as never);
  vi.spyOn(poller as never as { checkDedup: unknown }, 'checkDedup')
    .mockResolvedValue({ success: true, data: { new: ['post-1', 'post-2'], duplicates: [] } } as never);
  vi.spyOn(poller as never as { computeTextHash: unknown }, 'computeTextHash')
    .mockImplementation(((text: string) => Promise.resolve(`hash-${text}`)) as never);
  return { poller, updates };
}

const blogSub = {
  id: 'sub-blog', name: 'Blog', platform: 'naver',
  naverOptions: { blogId: 'blog-1' },
  options: { maxPostsPerRun: 10, backfillDays: 7 },
  state: { cursor: undefined, lastRunAt: undefined },
} as never;

describe('NaverSubscriptionPoller dedup contract (only successful archives mark seen)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('excludes a failed local archive from archivedPostIds/Hashes', async () => {
    const { poller, updates } = buildPoller();
    vi.spyOn(poller as never as { archiveBlogPost: unknown }, 'archiveBlogPost')
      .mockImplementation(((post: { id: string }) => (post.id === 'post-2'
        ? Promise.reject(new Error('vault write failed'))
        : Promise.resolve())) as never);

    await (poller as never as { pollBlogSubscription: (s: unknown) => Promise<unknown> }).pollBlogSubscription(blogSub);

    const seen = updates.find((u) => u.archivedPostIds !== undefined);
    expect(seen?.archivedPostIds).toEqual(['post-1']);
    expect(seen?.archivedPostIds).not.toContain('post-2');
    expect(seen?.archivedPostHashes).toEqual(['hash-first']);
  });

  it('marks every post seen when all archives succeed', async () => {
    const { poller, updates } = buildPoller();
    vi.spyOn(poller as never as { archiveBlogPost: unknown }, 'archiveBlogPost')
      .mockResolvedValue(undefined as never);

    await (poller as never as { pollBlogSubscription: (s: unknown) => Promise<unknown> }).pollBlogSubscription(blogSub);

    const seen = updates.find((u) => u.archivedPostIds !== undefined);
    expect(seen?.archivedPostIds).toEqual(['post-1', 'post-2']);
    expect(seen?.archivedPostHashes).toEqual(['hash-first', 'hash-second']);
  });
});
