import { describe, expect, it } from 'vitest';
import {
  isGenericSubscriptionSupported,
  isImmediateProfileCrawlPlatform,
  isSubscriptionSupported,
  NEW_SUBSCRIPTION_PLATFORMS,
  SUBSCRIPTION_SUPPORTED_PLATFORMS,
} from '@/constants/rssPlatforms';

describe('rss platform subscription constants', () => {
  it('supports receiving Kidsnote subscription archives in the plugin', () => {
    expect(SUBSCRIPTION_SUPPORTED_PLATFORMS).toContain('kidsnote');
    expect(isSubscriptionSupported('kidsnote')).toBe(true);
  });

  it('keeps Kidsnote out of the generic new-subscription UI list', () => {
    expect(NEW_SUBSCRIPTION_PLATFORMS).not.toContain('kidsnote');
    expect(isGenericSubscriptionSupported('kidsnote')).toBe(false);
  });

  it('enables Threads in the generic new-subscription UI list', () => {
    expect(SUBSCRIPTION_SUPPORTED_PLATFORMS).toContain('threads');
    expect(NEW_SUBSCRIPTION_PLATFORMS).toContain('threads');
    expect(isGenericSubscriptionSupported('threads')).toBe(true);
  });
});

describe('rssPlatforms profile crawl helpers', () => {
  it('treats Threads Profile Discovery crawls as immediate completions', () => {
    expect(isImmediateProfileCrawlPlatform('threads')).toBe(true);
  });

  it('keeps BrightData-backed profile crawls on pending job tracking', () => {
    expect(isImmediateProfileCrawlPlatform('facebook')).toBe(false);
  });
});
