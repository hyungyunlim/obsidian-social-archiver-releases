import { z } from 'zod';
import { canonicalizeUrl } from '../../utils/url';

/**
 * Blog URL Schema
 *
 * Validates URLs from known blog hosting platforms:
 * - GitHub Pages: *.github.io
 * - RSS feed URLs: /feed.xml, /rss, /atom.xml, etc.
 * - Custom domains with blog post patterns (date-based URLs)
 *
 * Note: This is a permissive schema for RSS-based blog platforms.
 */

// GitHub Pages domain pattern
const githubPagesDomainPattern = /^[a-z0-9-]+\.github\.io$/i;

// RSS/Atom feed URL patterns
const rssFeedPatterns = [
  /\/feed\.xml$/i,
  /\/feed$/i,
  /\/rss\.xml$/i,
  /\/rss$/i,
  /\/atom\.xml$/i,
  /\/atom$/i,
  /\/index\.xml$/i,  // Hugo default
  /\/feed\.json$/i,  // JSON Feed
  /\/rss2$/i,
  /\/feeds?\//i,     // Feedburner style path
];

// Feedburner domain pattern
const feedburnerDomainPattern = /feedburner\.com$/i;

// Jekyll/Hugo/Static site date-based URL patterns
// e.g., /2024/07/15/post-title or /posts/2024/07/post-title
const blogPostPathPatterns = [
  /^\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+/i,  // /2024/07/15/post-title
  /^\/\d{4}\/\d{2}\/[a-z0-9-]+/i,          // /2024/07/post-title
  /^\/posts?\/\d{4}/i,                      // /posts/2024/...
  /^\/blog\/\d{4}/i,                        // /blog/2024/...
  /^\/articles?\/\d{4}/i,                   // /articles/2024/...
];

/**
 * Check if URL is from GitHub Pages
 */
function isGitHubPagesUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return githubPagesDomainPattern.test(hostname);
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
 * Check if URL has a date-based blog post path pattern
 */
function hasDateBasedBlogPath(url: string): boolean {
  try {
    const pathname = new URL(url).pathname;
    return blogPostPathPatterns.some(pattern => pattern.test(pathname));
  } catch {
    return false;
  }
}

/**
 * Check if URL is from Feedburner
 */
function isFeedburnerUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return feedburnerDomainPattern.test(hostname);
  } catch {
    return false;
  }
}

/**
 * Check if URL is a valid blog URL
 * Matches: GitHub Pages, Feedburner, RSS feed URLs, or date-based blog post patterns
 */
function isBlogUrl(url: string): boolean {
  return isGitHubPagesUrl(url) || isFeedburnerUrl(url) || isRSSFeedUrl(url) || hasDateBasedBlogPath(url);
}

/**
 * Blog URL Schema
 *
 * Validates:
 * - GitHub Pages URLs (*.github.io)
 * - RSS feed URLs (/feed.xml, /rss, etc.)
 * - Date-based blog post URLs (/2024/07/15/post-title)
 */
export const BlogURLSchema = z
  .string()
  .trim()
  .min(1, { message: 'URL cannot be empty' })
  .url({ message: 'Invalid URL format' })
  .transform((url) => canonicalizeUrl(url))
  .refine(
    (url) => isBlogUrl(url),
    { message: 'URL must be from a blog (GitHub Pages, RSS feed, or date-based blog post)' }
  );

/**
 * Check if URL looks like a blog URL
 */
export function isBlogLikeUrl(url: string): boolean {
  return isBlogUrl(url);
}

/**
 * Check if URL looks like a GitHub Pages blog URL
 */
export function isGitHubPagesBlogUrl(url: string): boolean {
  return isGitHubPagesUrl(url);
}
