/**
 * RSS-based platform constants
 * Centralized definitions to avoid duplication across the codebase
 */

/**
 * All RSS-based platforms that support inline images and RSS feed subscriptions
 * These platforms render images inline with content (not in a separate media gallery)
 */
export const RSS_BASED_PLATFORMS = ['blog', 'substack', 'tumblr', 'velog', 'medium', 'podcast', 'naver', 'brunch'] as const;

/**
 * RSS platforms that have their own platform ID (not generic 'blog')
 * Used when determining API platform type for RSS feeds
 */
export const RSS_PLATFORMS_WITH_OWN_ID = ['velog', 'substack', 'tumblr', 'medium', 'podcast', 'x', 'naver', 'brunch'] as const;

/**
 * RSS platforms that need feed URL derivation from author URL
 * (excludes 'medium' which uses a different RSS URL pattern)
 */
export const RSS_PLATFORMS_WITH_FEED_DERIVATION = ['substack', 'tumblr', 'blog', 'velog', 'naver'] as const;

/**
 * RSS platforms for subscription matching (profileUrl based)
 */
export const RSS_PLATFORMS_FOR_SUBSCRIPTION_MATCH = ['medium', 'velog', 'substack', 'tumblr'] as const;

/**
 * All platforms that support subscriptions (social platforms + RSS-based platforms)
 * Note: X uses xcancel RSS feed (free, no BrightData needed)
 */
export const SUBSCRIPTION_SUPPORTED_PLATFORMS = [
  'instagram', 'facebook', 'linkedin', 'reddit', 'tiktok', 'pinterest',
  'bluesky', 'mastodon', 'youtube', 'x', 'naver-webtoon', 'webtoons',
  ...RSS_BASED_PLATFORMS
] as const;

/**
 * Platforms where new subscriptions are currently disabled
 * Used by UI to hide subscribe option
 * Note: X re-enabled via xcancel RSS (free, no BrightData)
 */
export const SUBSCRIPTION_DISABLED_PLATFORMS = [] as const;

/**
 * Platforms that support profile crawling
 * Excludes LinkedIn (post-only support)
 * Bluesky/Mastodon use free direct API, YouTube uses free RSS feed, X uses xcancel RSS
 */
export const PROFILE_CRAWL_SUPPORTED_PLATFORMS = [
  'instagram', 'facebook', 'x', 'reddit', 'tiktok', 'pinterest',
  'bluesky', 'mastodon', 'youtube', 'naver', 'brunch'
] as const;

/**
 * Platforms that support full profile crawling with archive
 * Includes LinkedIn (profile crawling with posts)
 */
export const PROFILE_ARCHIVE_SUPPORTED_PLATFORMS = [
  'instagram', 'facebook', 'x', 'linkedin', 'reddit', 'tiktok', 'pinterest',
  'bluesky', 'mastodon', 'youtube', 'naver', 'brunch'
] as const;

/**
 * Platforms that support new subscriptions in UI
 * Note: X re-enabled via xcancel RSS (free, no BrightData)
 */
export const NEW_SUBSCRIPTION_PLATFORMS = [
  'instagram', 'facebook', 'x', 'linkedin', 'reddit', 'tiktok', 'pinterest',
  'bluesky', 'mastodon', 'youtube',
  ...RSS_BASED_PLATFORMS
] as const;

// Type definitions
export type RssBasedPlatform = typeof RSS_BASED_PLATFORMS[number];
export type RssPlatformWithOwnId = typeof RSS_PLATFORMS_WITH_OWN_ID[number];
export type SubscriptionSupportedPlatform = typeof SUBSCRIPTION_SUPPORTED_PLATFORMS[number];

// Helper functions
export function isRssBasedPlatform(platform: string): platform is RssBasedPlatform {
  return RSS_BASED_PLATFORMS.includes(platform as RssBasedPlatform);
}

export function isRssPlatformWithOwnId(platform: string): platform is RssPlatformWithOwnId {
  return RSS_PLATFORMS_WITH_OWN_ID.includes(platform as RssPlatformWithOwnId);
}

export function needsFeedUrlDerivation(platform: string): boolean {
  return RSS_PLATFORMS_WITH_FEED_DERIVATION.includes(platform as typeof RSS_PLATFORMS_WITH_FEED_DERIVATION[number]);
}

export function isSubscriptionSupported(platform: string): platform is SubscriptionSupportedPlatform {
  return SUBSCRIPTION_SUPPORTED_PLATFORMS.includes(platform as SubscriptionSupportedPlatform);
}
