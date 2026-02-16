import { z } from 'zod';
import { canonicalizeUrl } from '../../utils/url';

/**
 * Velog URL patterns:
 * - RSS: https://v2.velog.io/rss/@username (only supported format)
 *
 * Note: Velog is RSS-only platform. Individual post archiving is not supported.
 * Posts (velog.io/@username/post-slug) should be handled via subscription.
 */

// Only RSS feed URLs are valid for archiving
const velogRSSPattern = /^v2\.velog\.io$/i;
const velogRSSPathPattern = /^\/rss\/@?[A-Za-z0-9_-]+$/i;

export const VelogURLSchema = z
  .string()
  .trim()
  .min(1, { message: 'URL cannot be empty' })
  .url({ message: 'Invalid URL format' })
  .transform((url) => canonicalizeUrl(url))
  .refine((url) => {
    try {
      const hostname = new URL(url).hostname;
      return velogRSSPattern.test(hostname);
    } catch {
      return false;
    }
  }, { message: 'Velog only supports RSS feed URLs (v2.velog.io/rss/@username). Individual post archiving is not available.' })
  .refine((url) => {
    try {
      const pathname = new URL(url).pathname;
      return velogRSSPathPattern.test(pathname);
    } catch {
      return false;
    }
  }, { message: 'URL must be a Velog RSS feed (v2.velog.io/rss/@username)' });

/**
 * Extract username from Velog URL
 */
export function extractVelogUsername(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname;

    // Match @username in path
    const match = pathname.match(/\/@([A-Za-z0-9_-]+)/);
    if (match) {
      return match[1] ?? null;
    }

    // RSS format: /rss/@username or /rss/username
    const rssMatch = pathname.match(/\/rss\/@?([A-Za-z0-9_-]+)/);
    if (rssMatch) {
      return rssMatch[1] ?? null;
    }

    return null;
  } catch {
    return null;
  }
}
