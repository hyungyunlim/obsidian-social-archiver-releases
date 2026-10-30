/**
 * Weibo post identifiers.
 *
 * A Weibo post carries two interchangeable ids: the numeric `mid`
 * (`5352537693622943`) and the base62 `mblogid` (`Rm2Kdfcuz`) that weibo.com
 * URLs show. The mblogid is the mid split into 7-digit groups from the right,
 * each written in base62 — 4 characters, zero-padded except the leading group.
 *
 * Every URL form is canonicalised to the mid, so `weibo.com/{uid}/{mblogid}`
 * and `m.weibo.cn/detail/{mid}` land on one archive identity.
 */

const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

const MID_PATTERN = /^\d{12,20}$/;
// At least one letter: an all-digit segment is a uid or a mid, never an mblogid.
const MBLOGID_PATTERN = /^(?=[0-9A-Za-z]*[A-Za-z])[0-9A-Za-z]{5,12}$/;

/**
 * First path segments of a two-segment `/{x}/{y}` path that are NOT a user,
 * so `{y}` is not a post id (`/u/{uid}` is a profile, `/n/{name}` a nickname
 * redirect, `/tv/show/…` a video page).
 */
const NON_USER_SEGMENTS = new Set([
  'u', 'n', 'p', 'l', 'tv', 'ttarticle', 'video', 'show', 'search', 'hot',
  'ajax', 'login', 'newlogin', 'signup', 'set', 'profile', 'messages', 'at',
  'comment', 'fav', 'like', 'topic', 'k', 'a',
]);

function decodeBase62(chunk: string): number | null {
  let value = 0;
  for (const char of chunk) {
    const digit = BASE62.indexOf(char);
    if (digit < 0) return null;
    value = value * 62 + digit;
  }
  return value;
}

function encodeBase62(value: number): string {
  if (value === 0) return '0';
  let out = '';
  let rest = value;
  while (rest > 0) {
    out = BASE62[rest % 62] + out;
    rest = Math.floor(rest / 62);
  }
  return out;
}

/** `Rm2Kdfcuz` → `5352537693622943`. Null when the input is not an mblogid. */
export function weiboMblogidToMid(mblogid: string): string | null {
  if (!MBLOGID_PATTERN.test(mblogid)) return null;
  const groups: string[] = [];
  for (let end = mblogid.length; end > 0; end -= 4) {
    groups.unshift(mblogid.slice(Math.max(0, end - 4), end));
  }
  let mid = '';
  for (const [index, group] of groups.entries()) {
    const value = decodeBase62(group);
    // A 4-char group above 9,999,999 cannot come from a 7-digit decimal group.
    if (value === null || value > 9_999_999) return null;
    mid += index === 0 ? String(value) : String(value).padStart(7, '0');
  }
  return MID_PATTERN.test(mid) ? mid : null;
}

/** `5352537693622943` → `Rm2Kdfcuz`. Null when the input is not a mid. */
export function weiboMidToMblogid(mid: string): string | null {
  if (!MID_PATTERN.test(mid)) return null;
  const groups: string[] = [];
  for (let end = mid.length; end > 0; end -= 7) {
    groups.unshift(mid.slice(Math.max(0, end - 7), end));
  }
  return groups
    .map((group, index) => {
      const encoded = encodeBase62(Number(group));
      return index === 0 ? encoded : encoded.padStart(4, '0');
    })
    .join('');
}

/** A path segment that is a post id in either form, as a mid. */
function toMid(segment: string | undefined): string | null {
  if (!segment) return null;
  if (MID_PATTERN.test(segment)) return segment;
  return weiboMblogidToMid(segment);
}

/**
 * Post id (as a mid) from a Weibo post URL, or null for anything that is not a
 * single post — profiles, video pages, articles, and share links whose id only
 * appears after a redirect.
 *
 * - `weibo.com/{uid}/{mid|mblogid}` and the same on `m.weibo.cn`
 * - `weibo.com/detail/{mid}`, `m.weibo.cn/detail/{mid}`, `m.weibo.cn/status/{id}`
 * - share pages carrying `?weibo_id={mid}`
 */
export function extractWeiboPostId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/(?:^|\.)weibo\.(?:com|cn)$/i.test(parsed.hostname)) return null;

  const shared = toMid(parsed.searchParams.get('weibo_id') ?? undefined);
  if (shared) return shared;

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length !== 2) return null;
  const [first, second] = segments as [string, string];

  if (first === 'detail' || first === 'status') return toMid(second);
  if (NON_USER_SEGMENTS.has(first.toLowerCase())) return null;
  return toMid(second);
}
