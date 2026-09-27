/**
 * Worker-bound request builders from profile-crawl.ts.
 * (profile-crawl.test.ts is CI-quarantined, so these live on their own.)
 */

import { describe, expect, it } from 'vitest';
import {
  buildRssFetchRequest,
  CRAWL_LIMITS,
  getRssMaxPostCount,
  toServerPostCount,
} from '@/types/profile-crawl';

describe('getRssMaxPostCount', () => {
  it('caps the RSS input at the Worker limit for server-crawled feeds', () => {
    // Mirrors CRAWL_LIMITS.MAX_POST_COUNT in workers/src/handlers/profile-crawl.ts.
    expect(CRAWL_LIMITS.MAX_POST_COUNT).toBe(20);
    for (const platform of ['blog', 'substack', 'x', '']) {
      expect(getRssMaxPostCount(platform)).toBe(CRAWL_LIMITS.MAX_POST_COUNT);
    }
  });

  it('keeps the higher limit for Naver and Brunch, which fetch locally', () => {
    expect(getRssMaxPostCount('naver')).toBe(CRAWL_LIMITS.MAX_POST_COUNT_LOCAL);
    expect(getRssMaxPostCount('brunch')).toBe(CRAWL_LIMITS.MAX_POST_COUNT_LOCAL);
  });
});

describe('toServerPostCount', () => {
  it('keeps counts the Worker accepts', () => {
    expect(toServerPostCount(5)).toBe(5);
    expect(toServerPostCount(CRAWL_LIMITS.MAX_POST_COUNT)).toBe(CRAWL_LIMITS.MAX_POST_COUNT);
  });

  it('clamps local-fetch counts (Naver/Brunch UI allows 100) to the Worker cap', () => {
    expect(toServerPostCount(CRAWL_LIMITS.MAX_POST_COUNT_LOCAL)).toBe(CRAWL_LIMITS.MAX_POST_COUNT);
  });
});

describe('buildRssFetchRequest', () => {
  const base = {
    feedUrl: 'https://example.substack.com/feed',
    platform: 'substack' as const,
    handle: 'example',
    postCount: 5,
    timezone: 'Asia/Seoul',
    destinationFolder: 'Social Archives',
  };

  it('plain fetch sends no subscribeOptions', () => {
    const request = buildRssFetchRequest(base);

    expect(request.subscribeOptions).toBeUndefined();
    expect(request).toMatchObject({
      profileUrl: base.feedUrl,
      platform: 'substack',
      handle: 'example',
      crawlOptions: { mode: 'post_count', postCount: 5, timezone: 'Asia/Seoul' },
      destination: { folder: 'Social Archives' },
      rssMetadata: { feedUrl: base.feedUrl, feedType: 'rss', siteTitle: 'example' },
    });
  });

  it('"Fetch & Subscribe" asks the Worker for a daily subscription and still fetches now', () => {
    const request = buildRssFetchRequest({ ...base, subscribeHour: 9 });

    expect(request.subscribeOptions).toEqual({
      enabled: true,
      hour: 9,
      timezone: 'Asia/Seoul',
      destinationFolder: 'Social Archives',
    });
  });

  it('treats midnight as a real subscription hour', () => {
    expect(buildRssFetchRequest({ ...base, subscribeHour: 0 }).subscribeOptions?.hour).toBe(0);
  });

  it('never sends a postCount the Worker rejects', () => {
    const request = buildRssFetchRequest({ ...base, postCount: 50 });

    expect(request.crawlOptions.postCount).toBe(CRAWL_LIMITS.MAX_POST_COUNT);
  });
});
