import { z } from 'zod';
import { canonicalizeUrl } from '../../utils/url';

/**
 * Brunch URL patterns:
 *
 * Post:
 * - https://brunch.co.kr/@username/postId
 *
 * Author/Profile:
 * - https://brunch.co.kr/@username
 *
 * RSS (userId-based):
 * - https://brunch.co.kr/rss/@@userId
 *
 * Brunchbook (Series):
 * - https://brunch.co.kr/brunchbook/{bookId}
 *
 * Keyword/Tag:
 * - https://brunch.co.kr/keyword/{keyword}
 */

// Brunch domain pattern
const brunchDomainPattern = /^brunch\.co\.kr$/i;

// URL path patterns
const BRUNCH_URL_PATTERNS = {
  // @username/postId - Post URL
  post: /^\/@([A-Za-z0-9_-]+)\/(\d+)$/,
  // @username - Author profile URL
  author: /^\/@([A-Za-z0-9_-]+)\/?$/,
  // /rss/@@userId - RSS feed URL (internal userId)
  rss: /^\/rss\/@@(\w+)$/,
  // /brunchbook/{bookId} - Series/Book URL
  book: /^\/brunchbook\/([A-Za-z0-9_-]+)\/?$/,
  // /keyword/{keyword} - Keyword/Tag URL
  keyword: /^\/keyword\/([^/?]+)\/?$/,
};

/**
 * Check if URL is from Brunch domain
 */
function isBrunchDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return brunchDomainPattern.test(hostname);
  } catch {
    return false;
  }
}

/**
 * Validate Brunch URL path
 */
function isValidBrunchPath(url: string): boolean {
  try {
    const pathname = new URL(url).pathname;
    return Object.values(BRUNCH_URL_PATTERNS).some(pattern => pattern.test(pathname));
  } catch {
    return false;
  }
}

export const BrunchURLSchema = z
  .string()
  .trim()
  .min(1, { message: 'URL cannot be empty' })
  .url({ message: 'Invalid URL format' })
  .transform((url) => canonicalizeUrl(url))
  .refine((url) => isBrunchDomain(url), {
    message: 'URL must be from Brunch (brunch.co.kr)'
  })
  .refine((url) => isValidBrunchPath(url), {
    message: 'URL must be a valid Brunch post, profile, RSS, book, or keyword URL'
  });

/**
 * Brunch content type
 */
export type BrunchContentType = 'post' | 'profile' | 'rss' | 'book' | 'keyword';

/**
 * Detect Brunch content type from URL
 */
export function getBrunchContentType(url: string): BrunchContentType | null {
  try {
    const pathname = new URL(url).pathname;

    if (BRUNCH_URL_PATTERNS.post.test(pathname)) {
      return 'post';
    }
    if (BRUNCH_URL_PATTERNS.author.test(pathname)) {
      return 'profile';
    }
    if (BRUNCH_URL_PATTERNS.rss.test(pathname)) {
      return 'rss';
    }
    if (BRUNCH_URL_PATTERNS.book.test(pathname)) {
      return 'book';
    }
    if (BRUNCH_URL_PATTERNS.keyword.test(pathname)) {
      return 'keyword';
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract post info from Brunch post URL
 */
export function extractBrunchPostInfo(url: string): { username: string; postId: string } | null {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(BRUNCH_URL_PATTERNS.post);
    if (match && match[1] && match[2]) {
      return { username: match[1], postId: match[2] };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract profile info from Brunch profile URL
 */
export function extractBrunchProfileInfo(url: string): { username: string } | null {
  try {
    const pathname = new URL(url).pathname;

    // Try post URL first (to get username from post)
    const postMatch = pathname.match(BRUNCH_URL_PATTERNS.post);
    if (postMatch && postMatch[1]) {
      return { username: postMatch[1] };
    }

    // Try profile URL
    const profileMatch = pathname.match(BRUNCH_URL_PATTERNS.author);
    if (profileMatch && profileMatch[1]) {
      return { username: profileMatch[1] };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract RSS userId from Brunch RSS URL
 */
export function extractBrunchRssUserId(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(BRUNCH_URL_PATTERNS.rss);
    if (match && match[1]) {
      return match[1];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Generate Brunch RSS URL from userId
 * Note: userId is internal ID (e.g., 'eHom'), not public username
 */
export function getBrunchRssUrl(userId: string): string {
  return `https://brunch.co.kr/rss/@@${userId}`;
}

/**
 * Generate Brunch author profile URL from username
 */
export function getBrunchProfileUrl(username: string): string {
  // Remove @ if present
  const cleanUsername = username.startsWith('@') ? username.slice(1) : username;
  return `https://brunch.co.kr/@${cleanUsername}`;
}

/**
 * Check if URL is a Brunch profile URL (for subscription)
 */
export function isBrunchProfileUrl(url: string): boolean {
  try {
    if (!isBrunchDomain(url)) {
      return false;
    }
    const pathname = new URL(url).pathname;
    return BRUNCH_URL_PATTERNS.author.test(pathname);
  } catch {
    return false;
  }
}

/**
 * Check if URL is a Brunch post URL
 */
export function isBrunchPostUrl(url: string): boolean {
  try {
    if (!isBrunchDomain(url)) {
      return false;
    }
    const pathname = new URL(url).pathname;
    return BRUNCH_URL_PATTERNS.post.test(pathname);
  } catch {
    return false;
  }
}

/**
 * Check if URL is a Brunch RSS URL
 */
export function isBrunchRssUrl(url: string): boolean {
  try {
    if (!isBrunchDomain(url)) {
      return false;
    }
    const pathname = new URL(url).pathname;
    return BRUNCH_URL_PATTERNS.rss.test(pathname);
  } catch {
    return false;
  }
}

/**
 * Canonicalize Brunch URL (normalize format)
 */
export function canonicalizeBrunchUrl(url: string): string {
  try {
    const parsedUrl = new URL(url);
    // Remove trailing slash except for root
    let pathname = parsedUrl.pathname;
    if (pathname !== '/' && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    return `https://brunch.co.kr${pathname}`;
  } catch {
    return url;
  }
}

/**
 * Extract book ID from Brunch book URL
 */
export function extractBrunchBookId(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(BRUNCH_URL_PATTERNS.book);
    if (match && match[1]) {
      return match[1];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract keyword from Brunch keyword URL
 */
export function extractBrunchKeyword(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(BRUNCH_URL_PATTERNS.keyword);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
    return null;
  } catch {
    return null;
  }
}
