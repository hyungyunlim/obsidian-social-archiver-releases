import { z } from 'zod';

/**
 * Tumblr URL schema
 *
 * Supported formats:
 * - https://www.tumblr.com/{username}/{postId}
 * - https://www.tumblr.com/{username}/{postId}/{slug?}
 * - https://{username}.tumblr.com/post/{postId}/{slug?}
 */
export const TumblrURLSchema = z.string()
  .trim()
  .url({ message: 'Invalid URL format' })
  .refine(value => {
    try {
      const url = new URL(value);
      const hostname = url.hostname.toLowerCase();
      const pathname = url.pathname;

      const isTumblrDomain = hostname === 'tumblr.com' || hostname.endsWith('.tumblr.com');
      if (!isTumblrDomain) return false;

      // /username/123456789[/slug] or /post/123456789[/slug] on subdomains
      const modernPattern = /^\/[^/]+\/\d+(?:\/[A-Za-z0-9_-]+)?/;
      const legacyPattern = /^\/post\/\d+(?:\/[A-Za-z0-9_-]+)?/;

      return modernPattern.test(pathname) || legacyPattern.test(pathname);
    } catch {
      return false;
    }
  }, { message: 'URL must be a Tumblr post' });

/**
 * Tumblr post ID (numeric)
 */
export const TumblrPostIdSchema = z.string()
  .trim()
  .regex(/^\d+$/, { message: 'Tumblr post ID must be numeric' });
