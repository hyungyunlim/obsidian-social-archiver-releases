import { z } from 'zod';
import { canonicalizeUrl } from '../../utils/url';

/**
 * Medium URL Schema
 *
 * Validates URLs from Medium.com:
 * - Main domain: medium.com/@username/post-title-postid
 * - Custom domains: Custom domain Medium publications
 *
 * Medium URLs typically look like:
 * - https://medium.com/@username/title-abc123def456
 * - https://medium.com/publication-name/title-abc123def456
 */

// Medium domain pattern
const mediumDomainPattern = /^(www\.)?medium\.com$/i;

// Medium post URL pattern (with alphanumeric ID at the end)
const mediumPostPattern = /^\/@?[a-z0-9_-]+\/[a-z0-9-]+-[a-f0-9]{10,}$/i;

// Medium publication post pattern
const mediumPublicationPattern = /^\/[a-z0-9-]+\/[a-z0-9-]+-[a-f0-9]{10,}$/i;

/**
 * Check if URL is from Medium
 */
function isMediumUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    const pathname = parsedUrl.pathname;

    // Check if it's medium.com domain
    if (mediumDomainPattern.test(hostname)) {
      // Check if it's a post URL (not just a profile or homepage)
      return mediumPostPattern.test(pathname) || mediumPublicationPattern.test(pathname);
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Medium URL Schema
 *
 * Validates:
 * - Medium post URLs (medium.com/@user/title-id)
 * - Medium publication URLs (medium.com/publication/title-id)
 */
export const MediumURLSchema = z
  .string()
  .trim()
  .min(1, { message: 'URL cannot be empty' })
  .url({ message: 'Invalid URL format' })
  .transform((url) => canonicalizeUrl(url))
  .refine(
    (url) => isMediumUrl(url),
    { message: 'URL must be a valid Medium post URL' }
  );

/**
 * Check if URL looks like a Medium URL
 */
export function isMediumLikeUrl(url: string): boolean {
  return isMediumUrl(url);
}
