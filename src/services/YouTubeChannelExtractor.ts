/**
 * YouTube Channel Extractor Service
 *
 * Extracts YouTube Channel ID from any profile URL format using Obsidian's
 * requestUrl API for CORS-free HTTP requests.
 *
 * Supported URL formats:
 * - youtube.com/@handle (modern handle format)
 * - youtube.com/channel/UC... (channel ID format)
 * - youtube.com/c/customname (legacy custom URL)
 * - youtube.com/user/username (legacy user format)
 *
 * The service fetches the YouTube page and extracts the Channel ID from HTML,
 * as YouTube embeds the channel ID in the page regardless of URL format.
 */

import { requestUrl } from 'obsidian';

/**
 * YouTube Channel information extracted from a profile URL
 */
export interface YouTubeChannelInfo {
  /** Channel ID in format UC... (24 characters) */
  channelId: string;
  /** Display name of the channel (extracted from page title) */
  channelName?: string;
  /** RSS feed URL for the channel */
  rssFeedUrl: string;
}

/**
 * User-Agent header to use for requests
 * Using a common browser user agent to avoid bot detection
 */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Regex pattern to extract Channel ID from HTML
 * Matches: youtube.com/channel/UC followed by 22 alphanumeric/underscore/hyphen characters
 * Note: No lookbehind for iOS Safari compatibility
 */
const CHANNEL_ID_PATTERN = /youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})/;

/**
 * Regex pattern to extract channel name from page title
 * Matches: <title>Channel Name - YouTube</title>
 */
const TITLE_PATTERN = /<title>([^<]+)<\/title>/;

/**
 * Extract YouTube Channel information from a profile URL
 *
 * This function fetches the YouTube page and parses the HTML to extract
 * the Channel ID, which is embedded in the page regardless of URL format.
 *
 * @param profileUrl - Any valid YouTube profile URL
 * @returns YouTubeChannelInfo if successful, null otherwise
 *
 * @example
 * ```typescript
 * const info = await extractYouTubeChannelInfo('https://www.youtube.com/@MrBeast');
 * // Returns: { channelId: 'UCX6OQ3DkcsbYNE6H8uQQuVA', channelName: 'MrBeast', rssFeedUrl: '...' }
 * ```
 */
export async function extractYouTubeChannelInfo(
  profileUrl: string
): Promise<YouTubeChannelInfo | null> {
  try {
    // Ensure URL has protocol
    const normalizedUrl = profileUrl.startsWith('http')
      ? profileUrl
      : `https://${profileUrl}`;

    // Fetch the YouTube page using Obsidian's requestUrl
    // This bypasses CORS restrictions on both desktop and mobile
    const response = await requestUrl({
      url: normalizedUrl,
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    const html = response.text;

    // Extract Channel ID from HTML
    const channelIdMatch = html.match(CHANNEL_ID_PATTERN);
    if (!channelIdMatch || !channelIdMatch[1]) {
      console.warn(
        '[YouTubeChannelExtractor] Channel ID not found in HTML for URL:',
        profileUrl
      );
      return null;
    }

    const channelId = channelIdMatch[1];

    // Extract channel name from <title> tag (optional)
    let channelName: string | undefined;
    const titleMatch = html.match(TITLE_PATTERN);
    if (titleMatch && titleMatch[1]) {
      // Remove " - YouTube" suffix and clean up
      channelName = titleMatch[1]
        .replace(/\s*-\s*YouTube\s*$/i, '')
        .trim();
    }

    // Build RSS feed URL
    const rssFeedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

    return {
      channelId,
      channelName,
      rssFeedUrl,
    };
  } catch (error) {
    // Log error but don't throw - return null for any failure
    console.error(
      '[YouTubeChannelExtractor] Failed to extract channel info:',
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

/**
 * Validate if a URL looks like a YouTube profile URL
 *
 * Quick check before attempting extraction. This is a simple heuristic
 * and the actual extraction may still fail for edge cases.
 *
 * @param url - URL to check
 * @returns true if the URL appears to be a YouTube profile URL
 */
export function isLikelyYouTubeProfileUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase();

  // Must contain youtube.com
  if (!lowerUrl.includes('youtube.com')) {
    return false;
  }

  // Exclude known non-profile URLs
  const excludePatterns = [
    '/watch?',
    '/shorts/',
    '/live/',
    '/playlist?',
    '/embed/',
    '/results?',
    '/feed/',
  ];

  return !excludePatterns.some((pattern) => lowerUrl.includes(pattern));
}
