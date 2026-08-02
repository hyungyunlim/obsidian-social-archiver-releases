import { z } from 'zod';
import { canonicalizeUrl } from '../../utils/url';

/**
 * Xiaohongshu (小红书 / RedNote) URL patterns:
 *
 * Note:
 * - https://www.xiaohongshu.com/explore/{24-hex noteId}?xsec_token=...
 * - https://www.xiaohongshu.com/discovery/item/{24-hex noteId}   (legacy)
 * - https://www.xiaohongshu.com/user/profile/{uid}/{noteId}      (profile-scoped)
 * - https://www.rednote.com/explore/{24-hex noteId}              (new domain)
 *
 * Share link (resolves server-side to a tokenized note URL):
 * - http://xhslink.com/o/{code} · xhslink.cn · xhs.cn
 *
 * Profile:
 * - https://www.xiaohongshu.com/user/profile/{uid}
 *
 * The `xsec_token` query parameter is the only access gate and must survive
 * canonicalization — it is not a tracking parameter.
 */

const NOTE_DOMAIN_PATTERN = /^(?:www\.)?(?:xiaohongshu\.com|rednote\.com)$/i;
const SHARE_DOMAIN_PATTERN = /^(?:www\.)?(?:xhslink\.(?:com|cn)|xhs\.cn)$/i;

const XHS_URL_PATTERNS = {
  note: /^\/(?:explore|discovery\/item)\/[0-9a-f]{24}\/?$/i,
  scopedNote: /^\/user\/profile\/[0-9a-f]{24}\/[0-9a-f]{24}\/?$/i,
  profile: /^\/user\/profile\/[0-9a-f]{24}\/?$/i,
  share: /^\/(?:a|m|o)\/[A-Za-z0-9]+\/?$/,
};

function isXiaohongshuDomain(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return NOTE_DOMAIN_PATTERN.test(hostname) || SHARE_DOMAIN_PATTERN.test(hostname);
  } catch {
    return false;
  }
}

function isValidXiaohongshuPath(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    if (SHARE_DOMAIN_PATTERN.test(hostname)) {
      // Share-link path shapes have drifted (/a/ → /m/ → /o/); accept any
      // single non-empty segment so a new shape resolves server-side instead
      // of being rejected here.
      return XHS_URL_PATTERNS.share.test(pathname) || /^\/[^/]+\/?$/.test(pathname);
    }
    return (
      XHS_URL_PATTERNS.note.test(pathname) ||
      XHS_URL_PATTERNS.scopedNote.test(pathname) ||
      XHS_URL_PATTERNS.profile.test(pathname)
    );
  } catch {
    return false;
  }
}

export const XiaohongshuURLSchema = z
  .string()
  .trim()
  .min(1, { message: 'URL cannot be empty' })
  .url({ message: 'Invalid URL format' })
  .transform((url) => canonicalizeUrl(url))
  .refine((url) => isXiaohongshuDomain(url), {
    message: 'URL must be from Xiaohongshu (xiaohongshu.com, rednote.com, xhslink.com/.cn, xhs.cn)',
  })
  .refine((url) => isValidXiaohongshuPath(url), {
    message: 'URL must be a valid Xiaohongshu note, profile, or share link',
  });

/**
 * Check if URL is a Xiaohongshu profile URL (no note segment)
 */
export function isXiaohongshuProfileUrl(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    return NOTE_DOMAIN_PATTERN.test(hostname) && XHS_URL_PATTERNS.profile.test(pathname);
  } catch {
    return false;
  }
}
