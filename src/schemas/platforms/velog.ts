import { z } from 'zod';
import { canonicalizeUrl } from '../../utils/url';

/**
 * Velog URL patterns:
 * - RSS feed: https://v2.velog.io/rss/@username
 * - Single post: https://velog.io/@username/<slug>
 *
 * Both forms are accepted by ArchiveModal. RSS feeds drive subscriptions and
 * single-post URLs are routed through WebContentService (Defuddle) on the
 * worker side.
 */

const velogRssHostPattern = /^v2\.velog\.io$/i;
const velogRssPathPattern = /^\/rss\/@?[A-Za-z0-9_-]+$/i;

const velogPostHostPattern = /^(?:www\.)?velog\.io$/i;
// Exactly one slug segment after /@username; rejects /@user/slug/extra and /tags/foo.
const velogPostPathPattern = /^\/@[A-Za-z0-9_-]+\/[^/]+\/?$/i;

function isVelogRssUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return velogRssHostPattern.test(u.hostname) && velogRssPathPattern.test(u.pathname);
  } catch {
    return false;
  }
}

function isVelogPostUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return velogPostHostPattern.test(u.hostname) && velogPostPathPattern.test(u.pathname);
  } catch {
    return false;
  }
}

export const VelogURLSchema = z
  .string()
  .trim()
  .min(1, { message: 'URL cannot be empty' })
  .url({ message: 'Invalid URL format' })
  .transform((url) => canonicalizeUrl(url))
  .refine((url) => isVelogRssUrl(url) || isVelogPostUrl(url), {
    message:
      'URL must be a Velog single-post URL (velog.io/@username/post-slug) or RSS feed (v2.velog.io/rss/@username)',
  });

/**
 * Extract username from Velog URL (post or RSS).
 */
export function extractVelogUsername(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname;

    const match = pathname.match(/\/@([A-Za-z0-9_-]+)/);
    if (match) {
      return match[1] ?? null;
    }

    const rssMatch = pathname.match(/\/rss\/@?([A-Za-z0-9_-]+)/);
    if (rssMatch) {
      return rssMatch[1] ?? null;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract `{ username, slug }` from a Velog single-post URL.
 *
 * The slug is percent-decoded so encoded and decoded Korean slug URLs map to
 * the same dedup key. Malformed encoding falls back to the raw segment.
 */
export function extractVelogPostParts(url: string): { username: string; slug: string } | null {
  try {
    const u = new URL(url);
    if (!velogPostHostPattern.test(u.hostname)) {
      return null;
    }
    const m = u.pathname.match(/^\/@([A-Za-z0-9_-]+)\/([^/]+)\/?$/);
    if (!m?.[1] || !m?.[2]) return null;

    let slug = m[2];
    try {
      slug = decodeURIComponent(slug);
    } catch {
      // Preserve raw segment on malformed percent encoding.
    }

    return { username: m[1], slug };
  } catch {
    return null;
  }
}
