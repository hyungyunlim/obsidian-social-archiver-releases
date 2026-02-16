import type { StringNormalizer } from './array';
import type { Platform } from '@/types/post';
import { PlatformDetector } from '@/services/PlatformDetector';

const YOUTUBE_HOSTS = ['youtube.com', 'youtu.be'];
const YOUTUBE_QUERY_PARAMS = ['t', 'time_continue', 'start', 'si', 'feature'];

const detector = new PlatformDetector();

export const normalizeUrlForDedup: StringNormalizer = (value: string): string => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();

    if (YOUTUBE_HOSTS.some(pattern => host.includes(pattern))) {
      YOUTUBE_QUERY_PARAMS.forEach(param => url.searchParams.delete(param));

      if (url.hash && /^#(t|start)=/i.test(url.hash)) {
        url.hash = '';
      }
    }

    // Remove trailing slash for normalized comparison
    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch {
    // Not a valid URL - return trimmed original
    return value;
  }
};

export function canonicalizeUrl(url: string, platform?: Platform): string {
  return detector.canonicalizeUrl(url, platform);
}

/**
 * Check if a URL string is valid for link preview fetching
 * Filters out:
 * - Truncated URLs (ending with ... or …)
 * - Invalid URL formats
 * - URLs without proper protocol
 *
 * @param url - URL string to validate
 * @returns true if URL is valid for preview fetching
 */
/**
 * Encode a local vault path for use in standard markdown links `![alt](path)`.
 * Encodes spaces as %20 and closing parentheses as %29 to prevent
 * markdown parsers from misinterpreting the path boundaries.
 *
 * HTTP/HTTPS URLs are returned as-is (assumed already encoded).
 * Wikilink paths `![[path]]` do NOT need this — Obsidian handles spaces natively.
 */
export function encodePathForMarkdownLink(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  return path.replace(/%/g, '%25').replace(/ /g, '%20').replace(/\)/g, '%29');
}

export function isValidPreviewUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;

  const trimmed = url.trim();

  // Filter truncated URLs (common in social media APIs)
  if (trimmed.endsWith('...') || trimmed.endsWith('…')) {
    return false;
  }

  // Filter URLs with truncation marker in the middle (e.g., "example.com/path...")
  if (trimmed.includes('...') || trimmed.includes('…')) {
    return false;
  }

  // Try to parse as URL
  try {
    // Add protocol if missing for validation
    const urlToParse = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
    const parsed = new URL(urlToParse);

    // Must have a valid hostname
    if (!parsed.hostname || parsed.hostname.length < 3) {
      return false;
    }

    // Hostname must have at least one dot (e.g., example.com)
    if (!parsed.hostname.includes('.')) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
