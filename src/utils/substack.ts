import type { PostData } from '@/types/post';

/**
 * Substack note/article URL helpers (PRD §22.1).
 *
 * Substack `PostData.platform` is `'substack'` for both Notes and articles/blogs.
 * The canonical discriminator is `PostData.postType` (set server-side by the
 * worker). For older archives where `postType` is absent we derive it from the
 * URL:
 *
 *  - Note    = `substack.com/@{handle}/note/c-{id}` or `.../note/{id}`
 *              (also `{sub}.substack.com/note/{id}`)
 *  - Article = `substack.com/@{handle}/p-{id}` (app, `p-` prefix) **or**
 *              `{sub}.substack.com/p/{slug}` (subdomain) — anything else.
 */

/** Matches a Substack Note URL (path contains a `/note/` segment). */
export function isSubstackNoteUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  // Match `/note/` as a path segment to avoid false positives from query/text.
  // Covers: substack.com/@handle/note/c-123, substack.com/@handle/note/123,
  // sub.substack.com/note/123
  return /\/note\/[^/?#]+/i.test(url);
}

/**
 * Resolve whether a Substack post is a Note or an article/blog post.
 *
 * Prefers the explicit `postType` field when present (server source of truth),
 * otherwise falls back to URL-derivation. Notes are identified by a `/note/`
 * path segment; everything else (including `/p-` app posts and `/p/` subdomain
 * posts) is treated as an article.
 */
export function resolveSubstackPostType(
  postType: PostData['postType'] | undefined,
  url: string | undefined | null,
): 'note' | 'article' {
  if (postType === 'note' || postType === 'article') {
    return postType;
  }
  return isSubstackNoteUrl(url) ? 'note' : 'article';
}

/**
 * Convenience predicate: is this Substack post a Note?
 *
 * Uses the explicit `postType` when available and falls back to URL-derivation
 * for older archives that predate the `postType` field.
 */
export function isSubstackNote(
  postType: PostData['postType'] | undefined,
  url: string | undefined | null,
): boolean {
  return resolveSubstackPostType(postType, url) === 'note';
}

/**
 * Detect Substack note video resolver / HLS playlist URLs (PRD §22.4).
 *
 * The note video media URL is the HLS resolver
 * `https://substack.com/api/v1/video/upload/{id}/src?type=hls` which 302s to a
 * signed `stream.mux.com/{id}.m3u8?token=...` master playlist. Neither is a
 * seekable binary file, so clients must NOT attempt a binary download or local
 * frame-extraction thumbnail. The server R2-preserved MP4 (PRD §21) is the
 * canonical preservation and arrives via sync.
 */
export function isHlsVideoUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  // Substack resolver: `.../src?type=hls` (query carries the hls hint)
  if (lower.includes('/src?type=hls') || /[?&]type=hls\b/.test(lower)) {
    return true;
  }
  // Generic HLS playlist extension (ignore query/hash)
  const withoutQuery = lower.split(/[?#]/)[0] ?? lower;
  return withoutQuery.endsWith('.m3u8');
}
