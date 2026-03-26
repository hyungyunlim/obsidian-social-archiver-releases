/**
 * UserArchive → PostData conversion utilities
 *
 * Pure functions extracted from main.ts for converting server-side
 * UserArchive responses into the local PostData format used by the plugin.
 *
 * Single Responsibility: UserArchive-to-PostData data mapping
 */

import type { PostData, Media, Platform } from '../../types/post';
import type { UserArchive } from '../../services/WorkersAPIClient';

/**
 * Normalize a handle string by trimming whitespace and removing leading '@'.
 * Returns undefined if the input is falsy or empty after normalization.
 */
export function normalizeHandle(handle?: string | null): string | undefined {
  if (!handle) return undefined;
  const normalized = handle.trim().replace(/^@/, '');
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Build a profile URL from a platform and handle.
 * Returns an empty string if the handle is not provided or the platform
 * is not recognized.
 */
export function buildProfileUrl(platform: Platform, handle?: string): string {
  if (!handle) return '';

  switch (platform) {
    case 'x':
      return `https://x.com/${handle}`;
    case 'instagram':
      return `https://www.instagram.com/${handle}`;
    case 'facebook':
      return `https://www.facebook.com/${handle}`;
    case 'threads':
      return `https://www.threads.com/@${handle}`;
    case 'tiktok':
      return `https://www.tiktok.com/@${handle}`;
    case 'reddit':
      return `https://www.reddit.com/user/${handle}`;
    case 'youtube':
      return `https://www.youtube.com/@${handle}`;
    case 'pinterest':
      return `https://www.pinterest.com/${handle}/`;
    case 'bluesky':
      return `https://bsky.app/profile/${handle}`;
    default:
      return '';
  }
}

/**
 * Convert a UserArchive server response into the local PostData format.
 *
 * Handles:
 * - R2 preserved media URL mapping (main + thumbnail, by original URL and by index)
 * - Quoted post construction
 * - Comment normalization (including nested replies)
 * - Article markdown handling (X long-form articles)
 * - Reblog detection
 */
export function convertUserArchiveToPostData(archive: UserArchive): PostData {
  const platform = archive.platform as Platform;
  const authorUsername = normalizeHandle(archive.authorHandle);
  const authorHandle = authorUsername ? `@${authorUsername}` : undefined;
  const authorUrl =
    archive.authorUrl ||
    buildProfileUrl(platform, authorUsername) ||
    archive.originalUrl ||
    '';

  const quoted = archive.quotedPost;
  const quotedPlatform = quoted?.platform as Platform | undefined;
  const quotedUsername = normalizeHandle(quoted?.author?.handle);
  const quotedHandle = quotedUsername ? `@${quotedUsername}` : undefined;
  const quotedUrl = quoted?.url || '';
  const quotedAuthorUrl =
    (quotedPlatform ? buildProfileUrl(quotedPlatform, quotedUsername) : '') ||
    quotedUrl;

  // Prefer preserved R2 URLs from mobile sync payload to avoid expired CDN links.
  const preserved = archive.mediaPreserved || [];
  const preservedMainByOriginal = new Map<string, { r2Url: string; r2Key: string }>();
  const preservedMainByIndex = new Map<number, { r2Url: string; r2Key: string }>();
  const preservedThumbByOriginal = new Map<string, { r2Url: string; r2Key: string }>();
  const preservedThumbByIndex = new Map<number, { r2Url: string; r2Key: string }>();

  for (const item of preserved) {
    if (!item?.r2Url || !item?.r2Key) continue;
    const mainIndexMatch = item.r2Key.match(/\/media\/(\d+)\.[^/]+$/i);
    const thumbIndexMatch = item.r2Key.match(/\/media\/thumb-(\d+)\.[^/]+$/i);

    if (thumbIndexMatch) {
      const index = Number(thumbIndexMatch[1]);
      if (!Number.isNaN(index)) {
        preservedThumbByIndex.set(index, { r2Url: item.r2Url, r2Key: item.r2Key });
      }
      if (item.originalUrl) {
        preservedThumbByOriginal.set(item.originalUrl, { r2Url: item.r2Url, r2Key: item.r2Key });
      }
      continue;
    }

    if (mainIndexMatch) {
      const index = Number(mainIndexMatch[1]);
      if (!Number.isNaN(index)) {
        preservedMainByIndex.set(index, { r2Url: item.r2Url, r2Key: item.r2Key });
      }
    }
    if (item.originalUrl) {
      preservedMainByOriginal.set(item.originalUrl, { r2Url: item.r2Url, r2Key: item.r2Key });
    }
  }

  const normalizedMedia = (archive.media || []).map((m, index) => {
    const originalThumb = m.thumbnail || m.thumbnailUrl;
    const preservedMain = preservedMainByOriginal.get(m.url) || preservedMainByIndex.get(index);
    const preservedThumb = (originalThumb ? preservedThumbByOriginal.get(originalThumb) : undefined) || preservedThumbByIndex.get(index);

    const mediaType = m.type === 'gif' ? 'image' : m.type;

    return {
      type: mediaType,
      url: m.url,
      ...(preservedMain ? { r2Url: preservedMain.r2Url } : {}),
      thumbnail: preservedThumb?.r2Url || m.thumbnail || m.thumbnailUrl,
      ...(mediaType === 'video' && preservedThumb ? { r2ThumbnailUrl: preservedThumb.r2Url } : {}),
      thumbnailUrl: preservedThumb?.r2Url || m.thumbnailUrl || m.thumbnail,
      alt: m.alt,
      altText: m.alt,
    };
  }) as Media[];

  return {
    platform,
    id: archive.postId,
    url: archive.originalUrl,
    sourceArchiveId: archive.id,
    ...(archive.title ? { title: archive.title } : {}),
    author: {
      name: archive.authorName || 'Unknown',
      url: authorUrl,
      avatar: archive.authorAvatarUrl || undefined,
      handle: authorHandle,
      username: authorUsername,
      bio: archive.authorBio || undefined,
    },
    content: {
      text: archive.fullContent || archive.previewText || '',
      html: (archive.isArticle || archive.articleMarkdown) ? (archive.articleMarkdown ?? undefined) : undefined,
    },
    media: normalizedMedia,
    metadata: {
      likes: archive.likesCount ?? undefined,
      comments: archive.commentCount ?? undefined,
      shares: archive.sharesCount ?? undefined,
      views: archive.viewsCount ?? undefined,
      timestamp: archive.postedAt || new Date().toISOString(),
      externalLink: archive.externalLink ?? undefined,
      externalLinkTitle: archive.externalLinkTitle ?? undefined,
      externalLinkImage: archive.externalLinkImage ?? undefined,
    },
    ...(quoted ? {
      quotedPost: {
        platform: quotedPlatform || platform,
        id: quoted.id || '',
        url: quotedUrl,
        author: {
          name: quoted.author?.name || 'Unknown',
          url: quotedAuthorUrl,
          avatar: quoted.author?.avatarUrl,
          handle: quotedHandle,
          username: quotedUsername,
        },
        content: {
          text: quoted.content || '',
        },
        media: (quoted.media || []).map(m => ({
          type: m.type === 'video' ? 'video' : 'image',
          url: m.url,
          thumbnail: m.thumbnail,
          thumbnailUrl: m.thumbnail,
        })),
        metadata: {
          likes: quoted.metadata?.likes,
          comments: quoted.metadata?.comments,
          shares: quoted.metadata?.shares,
          timestamp: quoted.metadata?.timestamp || archive.postedAt || new Date().toISOString(),
          externalLink: quoted.metadata?.externalLink,
          externalLinkTitle: quoted.metadata?.externalLinkTitle,
          externalLinkImage: quoted.metadata?.externalLinkImage,
        },
      } as Omit<PostData, 'quotedPost' | 'embeddedArchives'>,
    } : {}),
    ...(archive.isReblog != null ? { isReblog: archive.isReblog } : {}),
    ...(archive.comments && archive.comments.length > 0 ? {
      comments: archive.comments.map(c => ({
        id: c.id,
        author: {
          name: c.author.name,
          url: c.author.url || (c.author.handle ? buildProfileUrl(platform, c.author.handle) : '') || '',
          handle: c.author.handle ? `@${c.author.handle}` : undefined,
          avatar: c.author.avatarUrl,
        },
        content: c.content,
        timestamp: c.timestamp,
        likes: c.likes,
        ...(c.replies && c.replies.length > 0 ? {
          replies: c.replies.map(r => ({
            id: r.id,
            author: {
              name: r.author.name,
              url: r.author.url || (r.author.handle ? buildProfileUrl(platform, r.author.handle) : '') || '',
              handle: r.author.handle ? `@${r.author.handle}` : undefined,
              avatar: r.author.avatarUrl,
            },
            content: r.content,
            timestamp: r.timestamp,
            likes: r.likes,
          })),
        } : {}),
      })),
    } : {}),
  };
}
