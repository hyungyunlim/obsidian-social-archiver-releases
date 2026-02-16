import { z } from 'zod';
import { canonicalizeUrl } from '../../utils/url';

/**
 * Naver URL patterns:
 *
 * Blog:
 * - https://blog.naver.com/{username}/{postId}
 * - https://m.blog.naver.com/{username}/{postId}
 * - RSS: https://rss.blog.naver.com/{username}
 *
 * Cafe:
 * - https://cafe.naver.com/{cafename}/articles/{articleId}
 * - https://m.cafe.naver.com/{cafename}/{articleId}
 *
 * News:
 * - https://n.news.naver.com/article/{pressId}/{articleId}
 * - https://m.news.naver.com/article/{pressId}/{articleId}
 */

// Naver domain patterns
const naverDomainPattern = /^(blog\.naver\.com|m\.blog\.naver\.com|cafe\.naver\.com|m\.cafe\.naver\.com|n\.news\.naver\.com|m\.news\.naver\.com|rss\.blog\.naver\.com)$/i;

// Blog patterns
const blogPostPattern = /^\/[A-Za-z0-9_-]+\/\d+$/i;  // /username/postId
const blogProfilePattern = /^\/[A-Za-z0-9_-]+\/?$/i;  // /username (profile for subscription)
const blogRSSPattern = /^\/[A-Za-z0-9_-]+\.xml$/i;   // /username.xml

// Cafe patterns
const cafeArticlePattern = /^\/[A-Za-z0-9_-]+\/(articles\/\d+|\d+)$/i;  // /cafename/articles/id or /cafename/id

// News patterns
const newsArticlePattern = /^\/article\/\d+\/\d+$/i;  // /article/pressId/articleId

/**
 * Validate Naver URL path based on subdomain
 */
function isValidNaverPath(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    const pathname = parsedUrl.pathname;

    // Blog RSS
    if (hostname === 'rss.blog.naver.com') {
      return blogRSSPattern.test(pathname);
    }

    // Blog post or profile
    if (hostname === 'blog.naver.com' || hostname === 'm.blog.naver.com') {
      return blogPostPattern.test(pathname) || blogProfilePattern.test(pathname);
    }

    // Cafe article
    if (hostname === 'cafe.naver.com' || hostname === 'm.cafe.naver.com') {
      return cafeArticlePattern.test(pathname);
    }

    // News article
    if (hostname === 'n.news.naver.com' || hostname === 'm.news.naver.com') {
      return newsArticlePattern.test(pathname);
    }

    return false;
  } catch {
    return false;
  }
}

export const NaverURLSchema = z
  .string()
  .trim()
  .min(1, { message: 'URL cannot be empty' })
  .url({ message: 'Invalid URL format' })
  .transform((url) => canonicalizeUrl(url))
  .refine((url) => {
    try {
      const hostname = new URL(url).hostname;
      return naverDomainPattern.test(hostname);
    } catch {
      return false;
    }
  }, { message: 'URL must be from Naver (blog.naver.com, cafe.naver.com, or n.news.naver.com)' })
  .refine((url) => isValidNaverPath(url), {
    message: 'URL must be a valid Naver blog post, cafe article, or news article'
  });

/**
 * Naver content type
 */
export type NaverContentType = 'blog' | 'cafe' | 'news' | 'rss';

/**
 * Detect Naver content type from URL
 */
export function getNaverContentType(url: string): NaverContentType | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase();

    if (hostname === 'rss.blog.naver.com') {
      return 'rss';
    }
    if (hostname === 'blog.naver.com' || hostname === 'm.blog.naver.com') {
      return 'blog';
    }
    if (hostname === 'cafe.naver.com' || hostname === 'm.cafe.naver.com') {
      return 'cafe';
    }
    if (hostname === 'n.news.naver.com' || hostname === 'm.news.naver.com') {
      return 'news';
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract username or identifier from Naver URL
 */
export function extractNaverIdentifier(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    const pathname = parsedUrl.pathname;

    // Blog: /username/postId -> username
    if (hostname === 'blog.naver.com' || hostname === 'm.blog.naver.com') {
      const match = pathname.match(/^\/([A-Za-z0-9_-]+)\//);
      return match?.[1] ?? null;
    }

    // Blog RSS: /username.xml -> username
    if (hostname === 'rss.blog.naver.com') {
      const match = pathname.match(/^\/([A-Za-z0-9_-]+)\.xml$/);
      return match?.[1] ?? null;
    }

    // Cafe: /cafename/... -> cafename
    if (hostname === 'cafe.naver.com' || hostname === 'm.cafe.naver.com') {
      const match = pathname.match(/^\/([A-Za-z0-9_-]+)\//);
      return match?.[1] ?? null;
    }

    // News: /article/pressId/articleId -> pressId
    if (hostname === 'n.news.naver.com' || hostname === 'm.news.naver.com') {
      const match = pathname.match(/^\/article\/(\d+)\//);
      return match?.[1] ?? null;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Check if URL is a Naver blog RSS URL
 */
export function isNaverBlogRSSUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'rss.blog.naver.com';
  } catch {
    return false;
  }
}

/**
 * Extract blog info from Naver blog URL
 */
export function extractNaverBlogInfo(url: string): { blogId: string; logNo?: string } | null {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    const pathname = parsedUrl.pathname;

    // Only blog URLs
    if (hostname !== 'blog.naver.com' && hostname !== 'm.blog.naver.com' && hostname !== 'rss.blog.naver.com') {
      return null;
    }

    // RSS: /blogId.xml
    if (hostname === 'rss.blog.naver.com') {
      const match = pathname.match(/^\/([A-Za-z0-9_-]+)(?:\.xml)?$/);
      if (match && match[1]) {
        return { blogId: match[1] };
      }
      return null;
    }

    // Post: /blogId/logNo
    const postMatch = pathname.match(/^\/([A-Za-z0-9_-]+)\/(\d+)$/);
    if (postMatch && postMatch[1] && postMatch[2]) {
      return { blogId: postMatch[1], logNo: postMatch[2] };
    }

    // Profile: /blogId (no post ID)
    const profileMatch = pathname.match(/^\/([A-Za-z0-9_-]+)\/?$/);
    if (profileMatch && profileMatch[1]) {
      return { blogId: profileMatch[1] };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract cafe info from Naver cafe URL
 */
export function extractNaverCafeInfo(url: string): { cafeUrl: string; articleId?: string } | null {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    const pathname = parsedUrl.pathname;

    // Only cafe URLs
    if (hostname !== 'cafe.naver.com' && hostname !== 'm.cafe.naver.com') {
      return null;
    }

    // Article: /cafename/articles/id or /cafename/id
    const articleMatch = pathname.match(/^\/([A-Za-z0-9_-]+)\/(?:articles\/)?(\d+)$/);
    if (articleMatch && articleMatch[1] && articleMatch[2]) {
      return { cafeUrl: articleMatch[1], articleId: articleMatch[2] };
    }

    // Cafe profile: /cafename
    const profileMatch = pathname.match(/^\/([A-Za-z0-9_-]+)\/?$/);
    if (profileMatch && profileMatch[1]) {
      return { cafeUrl: profileMatch[1] };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract news info from Naver news URL
 */
export function extractNaverNewsInfo(url: string): { oid: string; aid: string } | null {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    const pathname = parsedUrl.pathname;

    // Only news URLs
    if (hostname !== 'n.news.naver.com' && hostname !== 'm.news.naver.com') {
      return null;
    }

    // News article: /article/oid/aid or /mnews/article/oid/aid
    const match = pathname.match(/^\/(?:mnews\/)?article\/(\d+)\/(\d+)/);
    if (match && match[1] && match[2]) {
      return { oid: match[1], aid: match[2] };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Generate blog RSS URL from blog ID or URL
 */
export function getBlogRssUrl(blogIdOrUrl: string): string {
  // If it's already a URL, extract the blog ID
  if (blogIdOrUrl.startsWith('http')) {
    const info = extractNaverBlogInfo(blogIdOrUrl);
    if (info) {
      return `https://rss.blog.naver.com/${info.blogId}.xml`;
    }
    throw new Error('Invalid Naver blog URL');
  }

  // It's a blog ID directly
  return `https://rss.blog.naver.com/${blogIdOrUrl}.xml`;
}

/**
 * Check if URL is a Naver blog profile (for subscription)
 */
export function isNaverBlogProfileUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    const pathname = parsedUrl.pathname;

    if (hostname !== 'blog.naver.com' && hostname !== 'm.blog.naver.com') {
      return false;
    }

    // Profile URL: /blogId (no post ID)
    return /^\/[A-Za-z0-9_-]+\/?$/.test(pathname);
  } catch {
    return false;
  }
}
