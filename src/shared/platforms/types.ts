/**
 * AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
 *
 * Source: shared/platforms/types.ts
 * Generated: 2026-02-17T22:37:43.580Z
 *
 * To modify, edit the source file in shared/platforms/ and run:
 *   npm run sync:shared
 */

/**
 * Platform Types - Single Source of Truth
 *
 * This file is copied to src/, workers/src/, and mobile-app/src/ at build time.
 * To modify, edit this source file and run: npm run sync:shared
 */

/**
 * Supported social media platforms
 */
export type Platform =
  | 'facebook'
  | 'linkedin'
  | 'instagram'
  | 'tiktok'
  | 'x'
  | 'threads'
  | 'youtube'
  | 'reddit'
  | 'pinterest'
  | 'substack'
  | 'tumblr'
  | 'mastodon'
  | 'bluesky'
  | 'googlemaps'
  | 'velog'
  | 'podcast'
  | 'blog'
  | 'medium'
  | 'naver'
  | 'naver-webtoon'
  | 'webtoons'
  | 'brunch'
  | 'post';

/**
 * Array of all platform identifiers
 * Useful for iteration and validation
 */
export const PLATFORMS = [
  'facebook',
  'linkedin',
  'instagram',
  'tiktok',
  'x',
  'threads',
  'youtube',
  'reddit',
  'pinterest',
  'substack',
  'tumblr',
  'mastodon',
  'bluesky',
  'googlemaps',
  'velog',
  'podcast',
  'blog',
  'medium',
  'naver',
  'naver-webtoon',
  'webtoons',
  'brunch',
  'post',
] as const;

/**
 * Platform detection order for URL validation
 * Order matters: more specific platforms first, generic patterns (mastodon, blog) last
 * - webtoons must come before naver-webtoon (different domains but similar patterns)
 * - naver-webtoon must come before naver (comic.naver.com is a subset of naver domains)
 * - podcast must come before blog (RSS feed URLs shouldn't match as blog)
 * - mastodon must be last (its pattern /@user/123 matches many platforms)
 * - Excludes 'post' as it's for user-created content without URL schemas
 */
export const PLATFORM_DETECTION_ORDER = [
  'facebook',
  'linkedin',
  'instagram',
  'tiktok',
  'x',
  'threads',
  'youtube',
  'reddit',
  'pinterest',
  'substack',
  'tumblr',
  'bluesky',
  'googlemaps',
  'velog',
  'medium',
  'webtoons',
  'naver-webtoon',
  'naver',
  'brunch',
  'podcast',
  'blog',
  'mastodon',
] as const;

export type DetectablePlatform = typeof PLATFORM_DETECTION_ORDER[number];

/**
 * Type guard for Platform
 */
export function isPlatform(value: string): value is Platform {
  return PLATFORMS.includes(value as Platform);
}

// ============================================================================
// Subscription Platform Constants (Single Source of Truth)
// ============================================================================

/**
 * RSS-based platforms for subscriptions
 * These platforms use RSS feeds instead of BrightData scraping
 */
export const RSS_BASED_PLATFORMS = [
  'blog',
  'substack',
  'tumblr',
  'velog',
  'medium',
  'podcast',
  'naver',
  'brunch',
] as const;

export type RSSBasedPlatform = typeof RSS_BASED_PLATFORMS[number];

/**
 * Platforms that support profile crawling
 * Excludes: 'post' (user-created), 'threads' (not supported yet), 'googlemaps' (location-based)
 */
export const CRAWL_SUPPORTED_PLATFORMS = [
  'instagram',
  'facebook',
  'x', // Re-enabled via xcancel RSS (free, no BrightData)
  'linkedin',
  'reddit',
  'tiktok',
  'pinterest',
  'bluesky',
  'mastodon',
  'youtube',
  'blog',
  'velog',
  'medium',
  'substack',
  'tumblr',
  'podcast',
  'naver',
  'naver-webtoon',
  'webtoons',
  'brunch',
] as const;

export type CrawlSupportedPlatform = typeof CRAWL_SUPPORTED_PLATFORMS[number];

/**
 * Platforms that support new subscriptions in UI
 * Note: 'linkedin' excluded from new subscriptions due to cost concerns
 */
export const NEW_SUBSCRIPTION_PLATFORMS = [
  'instagram',
  'facebook',
  'x', // Re-enabled via xcancel RSS (free, no BrightData)
  'reddit',
  'tiktok',
  'pinterest',
  'bluesky',
  'mastodon',
  'youtube',
  'naver-webtoon', // Direct API, not RSS
  'webtoons', // Direct API (RSS available but not required)
  ...RSS_BASED_PLATFORMS, // Includes 'naver'
] as const;

export type NewSubscriptionPlatform = typeof NEW_SUBSCRIPTION_PLATFORMS[number];

/**
 * All platforms that can have subscriptions (including legacy/disabled ones)
 */
export const SUBSCRIPTION_PLATFORMS = [
  'instagram',
  'x', // Disabled but may have existing subscriptions
  'facebook',
  'linkedin', // Disabled for new but may have existing
  'reddit',
  'tiktok',
  'pinterest',
  'bluesky',
  'mastodon',
  'youtube',
  'naver-webtoon', // Direct API
  'webtoons', // Direct API (RSS available)
  ...RSS_BASED_PLATFORMS,
] as const;

export type SubscriptionPlatform = typeof SUBSCRIPTION_PLATFORMS[number];

/**
 * Platforms for profile preview
 */
export const PREVIEW_SUPPORTED_PLATFORMS = [
  'instagram',
  'x',
  'tiktok',
  'facebook',
  'linkedin',
  'youtube',
  'threads',
  'reddit',
  'bluesky',
  'pinterest',
  'substack',
  'tumblr',
  'mastodon',
  'blog',
  'velog',
  'medium',
  'podcast',
  'naver',
  'naver-webtoon',
  'webtoons',
  'brunch',
] as const;

export type PreviewSupportedPlatform = typeof PREVIEW_SUPPORTED_PLATFORMS[number];

// ============================================================================
// Mobile App Platform Constants
// ============================================================================

/**
 * Platforms supported by mobile app
 * Used for sync filtering, URL validation, and archive creation
 * Excludes platforms that need special UI (webtoons, podcasts, maps)
 */
export const MOBILE_PLATFORMS = [
  'instagram',
  'x',
  'facebook',
  'reddit',
  'threads',
  'linkedin',
  'youtube',
] as const;

export type MobilePlatform = typeof MOBILE_PLATFORMS[number];

/**
 * Display info for mobile platforms
 */
export const MOBILE_PLATFORM_INFO: Record<MobilePlatform, { name: string; placeholder: string }> = {
  instagram: { name: 'Instagram', placeholder: 'Instagram post, reel, or story' },
  x: { name: 'X', placeholder: 'X/Twitter post' },
  facebook: { name: 'Facebook', placeholder: 'Facebook post, video, or photo' },
  reddit: { name: 'Reddit', placeholder: 'Reddit post' },
  threads: { name: 'Threads', placeholder: 'Threads post' },
  linkedin: { name: 'LinkedIn', placeholder: 'LinkedIn post or article' },
  youtube: { name: 'YouTube', placeholder: 'YouTube video, short, or live stream' },
};

// ============================================================================
// AI Comment Platform Categories
// ============================================================================

/**
 * Social media platforms for AI comment visibility settings
 */
export const SOCIAL_MEDIA_PLATFORMS = [
  'facebook',
  'instagram',
  'x',
  'threads',
  'linkedin',
  'tiktok',
  'bluesky',
  'mastodon',
  'reddit',
  'pinterest',
  'tumblr',
] as const;

export type SocialMediaPlatform = typeof SOCIAL_MEDIA_PLATFORMS[number];

/**
 * Blog/news platforms for AI comment visibility settings
 */
export const BLOG_NEWS_PLATFORMS = [
  'blog',
  'substack',
  'medium',
  'velog',
  'naver',
  'brunch',
] as const;

export type BlogNewsPlatform = typeof BLOG_NEWS_PLATFORMS[number];

/**
 * Video/audio platforms for AI comment visibility settings
 */
export const VIDEO_AUDIO_PLATFORMS = [
  'youtube',
  'podcast',
] as const;

export type VideoAudioPlatform = typeof VIDEO_AUDIO_PLATFORMS[number];

/**
 * Platform category type for AI comments
 */
export type PlatformCategory = 'socialMedia' | 'blogNews' | 'videoAudio';

/**
 * Get the category of a platform for AI comment visibility
 * @returns The category or null if platform doesn't belong to any category
 */
export function getPlatformCategory(platform: Platform): PlatformCategory | null {
  if ((SOCIAL_MEDIA_PLATFORMS as readonly string[]).includes(platform)) {
    return 'socialMedia';
  }
  if ((BLOG_NEWS_PLATFORMS as readonly string[]).includes(platform)) {
    return 'blogNews';
  }
  if ((VIDEO_AUDIO_PLATFORMS as readonly string[]).includes(platform)) {
    return 'videoAudio';
  }
  return null;
}
