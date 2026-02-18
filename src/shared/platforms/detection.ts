/**
 * AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
 *
 * Source: shared/platforms/detection.ts
 * Generated: 2026-02-18T08:50:31.021Z
 *
 * To modify, edit the source file in shared/platforms/ and run:
 *   npm run sync:shared
 */

/**
 * Platform Detection Utilities - Single Source of Truth
 *
 * These functions are used by both Plugin and Workers.
 * Any changes here will be synced to both codebases.
 */

import type { Platform } from './types';
import { PLATFORM_DEFINITIONS, type PlatformDefinition } from './definitions';

/**
 * Detection order for platforms
 *
 * Order matters! More specific patterns should be checked first.
 * Mastodon is last because its pattern is very generic.
 */
const DETECTION_ORDER: Platform[] = [
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
  'medium', // Must be before mastodon (medium.com/@user looks like mastodon pattern)
  'velog', // Korean developer blog platform
  'webtoons', // Global webtoons.com - must be before naver-webtoon (different domain)
  'naver-webtoon', // Must be before 'naver' - more specific pattern (comic.naver.com)
  'naver', // Korean portal - blog, cafe, news (must be before blog/mastodon)
  'brunch', // Korean publishing platform by Kakao
  'bluesky',
  'googlemaps',
  'podcast', // Podcast RSS feeds (feeds.simplecast.com, etc.) - must be before blog
  'blog', // GitHub Pages / Jekyll blogs (*.github.io)
  'mastodon', // Must be last - generic pattern
];

/**
 * Detect platform from URL
 *
 * This is the single source of truth for platform detection.
 * All other detectPlatform implementations should call this function.
 *
 * @param url - URL to detect platform from
 * @returns Platform identifier or 'post' if unknown
 *
 * @example
 * detectPlatform('https://twitter.com/user/status/123') // 'x'
 * detectPlatform('https://www.facebook.com/post/456') // 'facebook'
 * detectPlatform('https://unknown.com') // 'post'
 */
export function detectPlatform(url: string): Platform {
  for (const platformId of DETECTION_ORDER) {
    const def = PLATFORM_DEFINITIONS[platformId];
    if (def?.urlPattern.test(url)) {
      return platformId;
    }
  }

  return 'post'; // Default fallback for unknown URLs
}

/**
 * Get human-readable platform name
 *
 * @param platform - Platform identifier
 * @returns Display name (e.g., 'Facebook', 'X (Twitter)')
 */
export function getPlatformName(platform: Platform): string {
  return PLATFORM_DEFINITIONS[platform]?.displayName ?? platform;
}

/**
 * Get platform emoji icon
 *
 * @param platform - Platform identifier
 * @returns Emoji character
 */
export function getPlatformEmoji(platform: Platform): string {
  return PLATFORM_DEFINITIONS[platform]?.emoji ?? '📄';
}

/**
 * Get BrightData dataset ID for platform
 *
 * @param platform - Platform identifier
 * @returns Dataset ID or null if not available
 */
export function getBrightDataDataset(platform: Platform): string | null {
  return PLATFORM_DEFINITIONS[platform]?.brightDataDatasetId ?? null;
}

/**
 * Check if platform is supported for archiving
 *
 * 'post' is the fallback for user-created posts and unknown URLs,
 * so it's not considered a "supported" platform for external archiving.
 *
 * @param platform - Platform identifier
 * @returns true if platform supports external archiving
 */
export function isSupportedPlatform(platform: Platform): boolean {
  return platform !== 'post';
}

/**
 * Get platform by domain
 *
 * Useful for detecting platform from domain alone.
 *
 * @param domain - Domain name (e.g., 'facebook.com', 'www.twitter.com')
 * @returns Platform identifier or null if not found
 */
export function getPlatformByDomain(domain: string): Platform | null {
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, '');

  for (const [id, def] of Object.entries(PLATFORM_DEFINITIONS)) {
    if (
      def.domains.some(
        (d) => normalizedDomain === d || normalizedDomain.endsWith(`.${d}`)
      )
    ) {
      return id as Platform;
    }
  }

  return null;
}

/**
 * Get platform definition
 *
 * @param platform - Platform identifier
 * @returns Full platform definition
 */
export function getPlatformConfig(platform: Platform): PlatformDefinition {
  return PLATFORM_DEFINITIONS[platform];
}

/**
 * Check if platform supports a specific feature
 *
 * @param platform - Platform identifier
 * @param feature - Feature to check
 * @returns true if platform supports the feature
 */
export function platformSupportsFeature(
  platform: Platform,
  feature: keyof PlatformDefinition['features']
): boolean {
  return PLATFORM_DEFINITIONS[platform]?.features[feature] ?? false;
}

/**
 * Check if platform allows custom domains
 *
 * Currently only Mastodon allows custom domains (federated instances).
 *
 * @param platform - Platform identifier
 * @returns true if platform allows custom domains
 */
export function platformAllowsCustomDomains(platform: Platform): boolean {
  return PLATFORM_DEFINITIONS[platform]?.allowCustomDomains ?? false;
}

/**
 * Get platform's maximum media size
 *
 * @param platform - Platform identifier
 * @returns Maximum size in bytes or undefined
 */
export function getPlatformMaxMediaSize(platform: Platform): number | undefined {
  return PLATFORM_DEFINITIONS[platform]?.maxMediaSize;
}

/**
 * Get platform's rate limit configuration
 *
 * @param platform - Platform identifier
 * @returns Rate limit config or undefined
 */
export function getPlatformRateLimit(
  platform: Platform
): PlatformDefinition['rateLimit'] | undefined {
  return PLATFORM_DEFINITIONS[platform]?.rateLimit;
}

/**
 * Extract post ID from a URL for a given platform.
 *
 * Used for server-side dedup: if a post is already archived in D1,
 * we can skip the expensive external API call and return the cached result.
 *
 * Returns null if the post ID cannot be extracted (fail-open: proceed without dedup).
 *
 * @param platform - Already-detected platform identifier
 * @param url - The original URL to extract from
 * @returns Extracted post ID string, or null
 */
export function extractPostIdFromUrl(platform: Platform, url: string): string | null {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;

    switch (platform) {
      case 'instagram': {
        // /p/{code}/ or /reel/{code}/
        const m = pathname.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
        return m?.[1] ?? null;
      }

      case 'x': {
        // /user/status/{id} or /i/web/status/{id}
        const m = pathname.match(/\/status\/(\d+)/);
        return m?.[1] ?? null;
      }

      case 'facebook': {
        // Multiple formats:
        // /posts/{id}, /permalink/{id}, /photo?fbid={id}
        // pfbid in URL path, /videos/{id}/, /{pageId}/posts/{id}
        // story_fbid in query params
        const pfbidMatch = pathname.match(/(pfbid[A-Za-z0-9]+)/);
        if (pfbidMatch) return pfbidMatch[1] ?? null;

        const storyFbid = parsed.searchParams.get('story_fbid');
        if (storyFbid) return storyFbid;

        const fbid = parsed.searchParams.get('fbid');
        if (fbid) return fbid;

        // /posts/{id} or /permalink/{id} or /videos/{id}
        const postMatch = pathname.match(/\/(?:posts|permalink|videos)\/(\d+)/);
        if (postMatch) return postMatch[1] ?? null;

        // /{user}/posts/{id}
        const userPostMatch = pathname.match(/\/[^/]+\/posts\/(\d+)/);
        if (userPostMatch) return userPostMatch[1] ?? null;

        return null;
      }

      case 'tiktok': {
        // /@user/video/{id} or /video/{id}
        const m = pathname.match(/\/video\/(\d+)/);
        return m?.[1] ?? null;
      }

      case 'youtube': {
        // ?v={id} or /shorts/{id} or youtu.be/{id} or /live/{id}
        const v = parsed.searchParams.get('v');
        if (v) return v;

        const shortMatch = pathname.match(/\/(?:shorts|live|embed)\/([A-Za-z0-9_-]+)/);
        if (shortMatch) return shortMatch[1] ?? null;

        // youtu.be/{id}
        if (parsed.hostname === 'youtu.be') {
          const id = pathname.slice(1).split('/')[0];
          return id || null;
        }

        return null;
      }

      case 'reddit': {
        // /r/{sub}/comments/{id}/
        const m = pathname.match(/\/comments\/([A-Za-z0-9_]+)/);
        return m?.[1] ?? null;
      }

      case 'threads': {
        // /@user/post/{code}
        const m = pathname.match(/\/post\/([A-Za-z0-9_-]+)/);
        return m?.[1] ?? null;
      }

      case 'pinterest': {
        // /pin/{id}/
        const m = pathname.match(/\/pin\/(\d+)/);
        return m?.[1] ?? null;
      }

      case 'bluesky': {
        // /profile/{did}/post/{rkey}
        const m = pathname.match(/\/post\/([A-Za-z0-9]+)/);
        return m?.[1] ?? null;
      }

      case 'mastodon': {
        // /@user/{id} or /users/{user}/statuses/{id}
        const statusMatch = pathname.match(/\/statuses\/(\d+)/);
        if (statusMatch) return statusMatch[1] ?? null;

        const atMatch = pathname.match(/\/@[^/]+\/(\d+)/);
        return atMatch?.[1] ?? null;
      }

      case 'linkedin': {
        // /posts/{slug} or activity-{id} in URL
        const activityMatch = url.match(/activity-(\d+)/);
        if (activityMatch) return activityMatch[1] ?? null;

        // /feed/update/urn:li:activity:{id}
        const urnMatch = pathname.match(/urn:li:(?:activity|ugcPost):(\d+)/);
        if (urnMatch) return urnMatch[1] ?? null;

        // /posts/{slug}
        const postMatch = pathname.match(/\/posts\/([A-Za-z0-9_-]+)/);
        if (postMatch) return postMatch[1] ?? null;

        return null;
      }

      default:
        return null;
    }
  } catch {
    return null;
  }
}
