/**
 * CDN Proxy Utility
 *
 * Wraps CDN URLs that block direct requests from Obsidian (Electron)
 * with the /api/proxy-media endpoint to avoid 403 errors.
 *
 * Instagram, Facebook, and TikTok CDNs block requests that don't
 * originate from their own web pages (missing referrer / signed tokens).
 */

import { API_ENDPOINT } from '../types/settings';

/**
 * CDN domains that return 403 when loaded directly from Obsidian/Electron.
 * These require proxying through Cloudflare Workers.
 */
const PROXY_REQUIRED_DOMAINS = [
  'cdninstagram.com',
  'fbcdn.net',
  'tiktokcdn.com',
] as const;

/**
 * Wrap a URL with /api/proxy-media if it's from a CDN that blocks direct Electron requests.
 * Returns the original URL if no proxy is needed.
 */
export function maybeProxyCdnUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    const needsProxy = PROXY_REQUIRED_DOMAINS.some(
      (domain) => hostname.includes(domain)
    );
    if (needsProxy) {
      return `${API_ENDPOINT}/api/proxy-media?url=${encodeURIComponent(url)}`;
    }
  } catch {
    // Invalid URL, return as-is
  }
  return url;
}
