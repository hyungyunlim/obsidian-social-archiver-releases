import { z } from 'zod';
import { canonicalizeUrl } from '../../utils/url';
import { isPodcastFeedUrl } from '@/shared/platforms';

/**
 * Podcast URL Schema
 *
 * Validates URLs from known podcast hosting platforms:
 * - RSS feed hosting domains (via shared PLATFORM_DEFINITIONS.podcast.domains)
 * - Podcast app/directory URLs (Apple Podcasts, Spotify, etc.)
 *
 * Note: This is a permissive schema for podcast RSS feeds.
 * Actual podcast detection happens via iTunes namespace markers in RSS content.
 */

/**
 * Podcast app/directory URL patterns
 * These are NOT RSS feeds, but web URLs for podcast players/directories
 * RSS feed hosting domains are handled by isPodcastFeedUrl from shared definitions
 */
const podcastAppPatterns = [
  /podcasts\.apple\.com$/i,
  /open\.spotify\.com.*\/(show|episode)/i,
  /overcast\.fm$/i,
  /pocketcasts\.com$/i,
  /castbox\.fm$/i,
  /podcastaddict\.com$/i,
  /stitcher\.com$/i,
  /podbay\.fm$/i,
  /player\.fm$/i,
];

// RSS feed URL patterns (same as blog but can be podcast feeds)
const rssFeedPatterns = [
  /\/feed\.xml$/i,
  /\/feed$/i,
  /\/rss\.xml$/i,
  /\/rss$/i,
  /\/atom\.xml$/i,
  /\/atom$/i,
  /\/index\.xml$/i,
  /\/feed\.json$/i,
  /\/rss2$/i,
  /\/feeds?\//i,
];

/**
 * Check if URL is from a known podcast platform
 * Uses shared PLATFORM_DEFINITIONS for RSS feed domains (Single Source of Truth)
 */
function isPodcastPlatformUrl(url: string): boolean {
  // Check RSS feed hosting domains (from shared PLATFORM_DEFINITIONS.podcast.domains)
  if (isPodcastFeedUrl(url)) {
    return true;
  }

  // Check podcast app/directory URLs
  try {
    const urlObj = new URL(url);
    const fullUrl = urlObj.hostname + urlObj.pathname;
    return podcastAppPatterns.some(pattern => pattern.test(fullUrl));
  } catch {
    return false;
  }
}

/**
 * Check if URL looks like an RSS feed URL
 */
function isRSSFeedUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return rssFeedPatterns.some(pattern => pattern.test(pathname));
  } catch {
    return false;
  }
}

/**
 * Check if URL could be a podcast URL
 * Matches: Known podcast platforms or RSS feed URLs
 */
function isPodcastUrl(url: string): boolean {
  return isPodcastPlatformUrl(url) || isRSSFeedUrl(url);
}

/**
 * Podcast URL Schema
 *
 * Validates:
 * - Known podcast platform URLs
 * - RSS feed URLs (may or may not be podcasts - content detection needed)
 */
export const PodcastURLSchema = z
  .string()
  .trim()
  .min(1, { message: 'URL cannot be empty' })
  .url({ message: 'Invalid URL format' })
  .transform((url) => canonicalizeUrl(url))
  .refine(
    (url) => isPodcastUrl(url),
    { message: 'URL must be from a podcast platform or RSS feed' }
  );

/**
 * Check if URL looks like a podcast URL
 */
export function isPodcastLikeUrl(url: string): boolean {
  return isPodcastUrl(url);
}

/**
 * Check if URL is from a known podcast hosting platform
 */
export function isKnownPodcastPlatformUrl(url: string): boolean {
  return isPodcastPlatformUrl(url);
}
