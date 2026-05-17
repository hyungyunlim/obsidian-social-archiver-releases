import { describe, expect, it, vi } from 'vitest';
import { ProfileCliService } from '@/plugin/cli/ProfileCliService';
import { ProfileCrawlService } from '@/plugin/services/ProfileCrawlService';
import type { CliParams } from '@/plugin/cli/CliParams';

function makeAdapter() {
  const client = {
    crawlProfile: vi.fn().mockResolvedValue({
      jobId: 'job-123',
      estimatedPosts: 5,
      status: 'pending',
    }),
  };
  const service = new ProfileCrawlService({
    workersApiClient: () => client as never,
    defaultFolder: () => 'Social Archives',
  });
  const adapter = new ProfileCliService(service);
  return { adapter, service, client };
}

describe('ProfileCliService', () => {
  it('maps redditSort=hot to internal Title-case', () => {
    const { adapter } = makeAdapter();
    const input = adapter.buildCrawlInput({
      url: 'https://www.reddit.com/r/obsidianmd/',
      redditSort: 'hot',
      redditTime: 'today',
      keyword: 'sync',
    } as CliParams);
    expect(input.reddit?.sortBy).toBe('Hot');
    expect(input.reddit?.sortByTime).toBe('Today');
    expect(input.reddit?.keyword).toBe('sync');
  });

  it('rejects invalid redditSort', () => {
    const { adapter } = makeAdapter();
    expect(() =>
      adapter.buildCrawlInput({
        url: 'https://www.reddit.com/r/obsidianmd/',
        redditSort: 'banana',
      } as CliParams),
    ).toThrow(/redditSort/);
  });

  it('decodes naverCookie from base64 and never echoes the raw value', async () => {
    const { adapter, client } = makeAdapter();
    const cookie = 'NID_AUT=abc123; NID_SES=def456';
    const b64 = (typeof btoa === 'function' ? btoa(cookie) : Buffer.from(cookie).toString('base64'));
    const result = await adapter.crawl({
      url: 'https://blog.naver.com/exampleblog',
      naverCookie: b64,
    } as CliParams);
    // The adapter's response carries naverCookieApplied=true but NEVER the raw cookie.
    expect(result.naverCookieApplied).toBe(true);
    expect(JSON.stringify(result)).not.toContain(cookie);
    expect(JSON.stringify(result)).not.toContain(b64);

    // The Worker still received the decoded cookie inside naverOptions.
    const request = client.crawlProfile.mock.calls[0][0];
    expect(request.naverOptions?.cookie).toBe(cookie);
  });

  it('rss=true forces the RSS code path', async () => {
    const { adapter, client } = makeAdapter();
    await adapter.crawl({
      url: 'https://example.substack.com/feed',
      rss: 'true',
    } as CliParams);
    const request = client.crawlProfile.mock.calls[0][0];
    expect(request.rssMetadata).toBeDefined();
  });

  it("range='custom' surfaces INVALID_ARGUMENT when start/end missing", () => {
    const { adapter } = makeAdapter();
    expect(() =>
      adapter.buildCrawlInput({
        url: 'https://www.instagram.com/exampleuser/',
        range: 'custom',
      } as CliParams),
    ).toThrow(/range/);
  });

  it('subscribe input mirrors common fields', () => {
    const { adapter } = makeAdapter();
    const input = adapter.buildSubscribeInput({
      url: 'https://blog.naver.com/exampleblog',
      hour: '7',
      folder: 'Notes/Sub',
    } as CliParams);
    expect(input.url).toBe('https://blog.naver.com/exampleblog');
    expect(input.hour).toBe(7);
    expect(input.folder).toBe('Notes/Sub');
  });
});
