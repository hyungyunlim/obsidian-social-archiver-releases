import { z } from 'zod';
import { canonicalizeUrl } from '../../utils/url';
import { extractWeiboPostId } from '../../shared/platforms/weibo-ids';

/**
 * Weibo (微博) post URL patterns — one post, any of:
 * - https://weibo.com/{uid}/{mblogid}      e.g. /7740247568/Rm2Kdfcuz
 * - https://weibo.com/{uid}/{mid}          e.g. /7740247568/5352537693622943
 * - https://m.weibo.cn/detail/{mid} · https://m.weibo.cn/status/{mid|mblogid}
 *
 * Profiles (/u/{uid}), video pages (/tv/show/…) and articles are not posts.
 */

const WEIBO_DOMAIN_PATTERN = /^(?:[\w-]+\.)*weibo\.(?:com|cn)$/i;

function isWeiboDomain(url: string): boolean {
  try {
    return WEIBO_DOMAIN_PATTERN.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export const WeiboURLSchema = z
  .string()
  .trim()
  .min(1, { error: 'URL cannot be empty' })
  .check(z.url({ error: 'Invalid URL format' }))
  .transform((url) => canonicalizeUrl(url))
  .refine((url) => isWeiboDomain(url), {
    error: 'URL must be from Weibo (weibo.com, m.weibo.cn)',
  })
  .refine((url) => extractWeiboPostId(url) !== null, {
    error: 'URL must be a single Weibo post (not a profile or video page)',
  });
