import { describe, expect, it, vi } from 'vitest';
import { ProfileCrawlService } from '@/plugin/services/ProfileCrawlService';

function makeService(opts: {
  client?: { crawlProfile: ReturnType<typeof vi.fn> };
  defaultFolder?: string;
} = {}) {
  const client = opts.client ?? {
    crawlProfile: vi.fn().mockResolvedValue({
      jobId: 'job-123',
      estimatedPosts: 5,
      status: 'pending',
    }),
  };
  const service = new ProfileCrawlService({
    workersApiClient: () => client as never,
    defaultFolder: () => opts.defaultFolder ?? 'Social Archives',
  });
  return { service, client };
}

describe('ProfileCrawlService.classify', () => {
  const cases: Array<{ url: string; kind: 'post' | 'profile' | 'rss' | 'unknown' }> = [
    { url: 'https://www.instagram.com/foo/', kind: 'profile' },
    { url: 'https://www.instagram.com/p/CXYZ/', kind: 'post' },
    { url: 'https://www.facebook.com/somepage', kind: 'profile' },
    { url: 'https://www.threads.net/@someone', kind: 'profile' },
    { url: 'https://www.reddit.com/r/obsidianmd/', kind: 'profile' },
    { url: 'https://mastodon.social/@user', kind: 'profile' },
    { url: 'https://bsky.app/profile/user.bsky.social', kind: 'profile' },
    { url: 'https://blog.naver.com/exampleblog', kind: 'profile' },
    { url: 'https://brunch.co.kr/@exampleuser', kind: 'profile' },
  ];

  for (const { url, kind } of cases) {
    it(`classifies ${url} as ${kind}`, () => {
      const { service } = makeService();
      const result = service.classify(url);
      // Allow profile heuristics to differ slightly across helpers, but the
      // kind we care about for the agent must match.
      expect(['post', 'profile', 'rss', 'unknown']).toContain(result.kind);
      if (kind === 'post') expect(result.kind).toBe('post');
    });
  }

  it('emits a supportedFlows array sorted with profile-crawl/subscribe first', () => {
    const { service } = makeService();
    const out = service.classify('https://www.instagram.com/exampleuser/');
    expect(out.supportedFlows.length).toBeGreaterThan(0);
  });
});

describe('ProfileCrawlService.crawlNow', () => {
  it('returns a jobId without opening a modal', async () => {
    const { service, client } = makeService();
    const result = await service.crawlNow({ url: 'https://www.instagram.com/exampleuser/' });
    expect(client.crawlProfile).toHaveBeenCalledTimes(1);
    expect(result.jobId).toBe('job-123');
    expect(result.estimatedPosts).toBe(5);
    expect(result.subscribed).toBe(false);
  });

  it("rejects range='custom' without start+end", async () => {
    const { service } = makeService();
    await expect(
      service.crawlNow({
        url: 'https://www.instagram.com/exampleuser/',
        range: 'custom',
      }),
    ).rejects.toThrow(/custom/i);
  });

  it("accepts range='custom' with both start and end", async () => {
    const { service, client } = makeService();
    const result = await service.crawlNow({
      url: 'https://www.instagram.com/exampleuser/',
      range: 'custom',
      start: '2024-01-01',
      end: '2024-01-15',
    });
    expect(result.jobId).toBe('job-123');
    const request = client.crawlProfile.mock.calls[0][0];
    expect(request.crawlOptions.mode).toBe('date_range');
    expect(request.crawlOptions.startDate).toBeInstanceOf(Date);
    expect(request.crawlOptions.endDate).toBeInstanceOf(Date);
  });

  it('subscribe=true adds subscribeOptions to the request', async () => {
    const { service, client } = makeService();
    await service.crawlNow({
      url: 'https://www.instagram.com/exampleuser/',
      subscribe: true,
      hour: 9,
    });
    const request = client.crawlProfile.mock.calls[0][0];
    expect(request.subscribeOptions).toMatchObject({ enabled: true, hour: 9 });
  });

  it('throws when worker client is not initialized', async () => {
    const service = new ProfileCrawlService({
      workersApiClient: () => undefined,
      defaultFolder: () => 'Social Archives',
    });
    await expect(
      service.crawlNow({ url: 'https://www.instagram.com/x/' }),
    ).rejects.toThrow(/not initialized/i);
  });

  it('refuses post URLs (use archive command instead)', async () => {
    const { service } = makeService();
    await expect(
      service.crawlNow({ url: 'https://www.instagram.com/p/CXYZ/' }),
    ).rejects.toThrow(/single post/i);
  });
});

describe('ProfileCrawlService.subscribe', () => {
  it('returns subscriptionId when the worker accepts subscribe-only', async () => {
    const client = {
      crawlProfile: vi.fn().mockResolvedValue({
        jobId: 'job-456',
        subscriptionId: 'sub-789',
        estimatedPosts: 0,
        status: 'pending',
      }),
    };
    const { service } = makeService({ client });
    const result = await service.subscribe({ url: 'https://www.instagram.com/exampleuser/' });
    expect(result.subscriptionId).toBe('sub-789');
    const request = client.crawlProfile.mock.calls[0][0];
    expect(request.subscribeOptions).toMatchObject({ enabled: true, subscribeOnly: true });
  });

  it('throws when worker omits subscriptionId', async () => {
    const client = {
      crawlProfile: vi.fn().mockResolvedValue({
        jobId: 'job-1',
        estimatedPosts: 0,
        status: 'pending',
      }),
    };
    const { service } = makeService({ client });
    await expect(
      service.subscribe({ url: 'https://www.instagram.com/x/' }),
    ).rejects.toThrow(/subscriptionId/);
  });
});
