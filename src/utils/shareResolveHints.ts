/**
 * Shared hint-builder for the `/api/share/resolve-media` endpoint.
 *
 * Used by both `PostShareService.resolveArchiveMedia` (eager, pre-share)
 * and `ShareAPIClient.updateShareWithMedia`'s auto-resolve path (lazy,
 * triggered from any caller that forwards `options.sourceArchiveId`).
 *
 * Keeping the hint construction in one place prevents drift between the
 * two entry points — the server's matching rules (PRD §7) assume all
 * clients emit the same hint shape.
 */

import type { Media } from '@/types/post';
import type { ResolveShareMediaHint } from '@/types/share';

/**
 * Build one hint per top-level media item. Per PRD §7:
 *   - primary matcher: `originalUrl`
 *   - secondary matcher: `sourceIndex + variant`
 *
 * `originalUrl` is filled from (in order):
 *   1. `sourceUrls[index]` (frontmatter `mediaSourceUrls[i]`)
 *   2. `media[i].url` if it is already an http(s) URL (i.e. non-local)
 *
 * `sourceIndex` is always set to the position within `media[]`, so each
 * hint always carries at least a secondary matcher.
 */
export function buildShareResolveHints(
  media: Media[],
  sourceUrls: string[] | undefined
): ResolveShareMediaHint[] {
  const urls = Array.isArray(sourceUrls) ? sourceUrls : [];

  return media.map((m, index) => {
    const hint: ResolveShareMediaHint = {
      sourceIndex: index,
      variant: 'primary',
      mediaType: m.type,
    };

    const fromFrontmatter = urls[index];
    if (typeof fromFrontmatter === 'string' && fromFrontmatter.length > 0) {
      hint.originalUrl = fromFrontmatter;
    } else if (isHttpUrl(m.url)) {
      hint.originalUrl = m.url;
    }

    return hint;
  });
}

function isHttpUrl(value: string | undefined): boolean {
  return typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'));
}
