/**
 * UserArchive → PostData conversion utilities
 *
 * Pure functions extracted from main.ts for converting server-side
 * UserArchive responses into the local PostData format used by the plugin.
 *
 * Single Responsibility: UserArchive-to-PostData data mapping
 */

import type { PostData, Media, Platform, Comment } from '../../types/post';
import type { UserArchive, UserArchiveComment } from '../../services/WorkersAPIClient';

const LEGACY_WEB_CLIP_SEPARATOR = '\n\n---\n\n';
const LEADING_WEB_CLIP_SEPARATOR = '---\n\n';
const EMPTY_MARKDOWN_LINK_LINE_PATTERN = /^(?:\s*\[\]\([^)]+\)\s*)+$/;
const WEB_METADATA_FOOTER_PATTERN = /^\*\*Platform:\*\*/i;

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
 * Recursively map a server-side `UserArchiveComment` into the plugin `Comment`
 * shape, preserving pin metadata and the FULL reply subtree at every depth.
 *
 * Mirrors `CommentFormatter.renderCommentRecursive` in that it recurses over
 * `replies` rather than handling only two nesting levels. This is load-bearing
 * for pin sync: a depth-≥2 pinned reply must survive conversion or the pin
 * cannot be detected/rendered (PRD R10).
 *
 * Note: comment-level `media` is NOT carried — the server drops it on read, an
 * accepted documented MVP round-trip loss (PRD R1).
 */
export function mapUserArchiveComment(
  comment: UserArchiveComment,
  platform: Platform,
): Comment {
  const mapped: Comment = {
    id: comment.id,
    author: {
      name: comment.author.name,
      url:
        comment.author.url ||
        (comment.author.handle ? buildProfileUrl(platform, comment.author.handle) : '') ||
        '',
      handle: comment.author.handle ? `@${comment.author.handle}` : undefined,
      avatar: comment.author.avatarUrl,
    },
    content: comment.content,
    timestamp: comment.timestamp,
    likes: comment.likes,
    // Pin/delete sync metadata (PRD R1) — preserved at every depth.
    ...(comment.pinnedAt ? { pinnedAt: comment.pinnedAt } : {}),
    ...(comment.pinnedByClientId ? { pinnedByClientId: comment.pinnedByClientId } : {}),
    ...(comment.updatedAt ? { updatedAt: comment.updatedAt } : {}),
  };

  if (comment.replies && comment.replies.length > 0) {
    mapped.replies = comment.replies.map((reply) => mapUserArchiveComment(reply, platform));
  }

  return mapped;
}

function normalizeTitle(value?: string | null): string {
  return (value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function stripLeadingMatchingTitle(markdown: string, title?: string | null): string {
  if (!title) return markdown.trim();

  const headingMatch = markdown.match(/^#\s+([^\n]+)\n+/);
  if (headingMatch?.[1] && normalizeTitle(headingMatch[1]) === normalizeTitle(title)) {
    return markdown.slice(headingMatch[0].length).trimStart();
  }

  const lines = markdown.split('\n');
  const firstMeaningfulIndex = lines.findIndex(line => line.trim().length > 0);
  if (firstMeaningfulIndex >= 0 && normalizeTitle(lines[firstMeaningfulIndex]) === normalizeTitle(title)) {
    return lines.slice(firstMeaningfulIndex + 1).join('\n').trimStart();
  }

  return markdown.trim();
}

function stripLeadingEmptyLinkLines(markdown: string): string {
  const lines = markdown.split('\n');
  let idx = 0;

  while (idx < lines.length) {
    const line = lines[idx] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      idx++;
      continue;
    }

    if (EMPTY_MARKDOWN_LINK_LINE_PATTERN.test(line)) {
      idx++;
      continue;
    }

    break;
  }

  return (idx > 0 ? lines.slice(idx).join('\n') : markdown).trimStart();
}

function stripLegacyWebMetadataFooter(markdown: string): string {
  const separatorIndex = markdown.lastIndexOf(LEGACY_WEB_CLIP_SEPARATOR);
  if (separatorIndex < 0) return markdown;

  const before = markdown.slice(0, separatorIndex).trimEnd();
  const after = markdown.slice(separatorIndex + LEGACY_WEB_CLIP_SEPARATOR.length).trim();

  return WEB_METADATA_FOOTER_PATTERN.test(after) ? before : markdown;
}

function extractWebArticleBody(archive: Pick<UserArchive, 'fullContent' | 'previewText' | 'title'>): string {
  const source = (archive.fullContent || archive.previewText || '').trim();
  if (!source) return '';

  const body = source.startsWith(LEADING_WEB_CLIP_SEPARATOR)
    ? source.slice(LEADING_WEB_CLIP_SEPARATOR.length).trim()
    : source;
  const withoutGeneratedFooter = stripLegacyWebMetadataFooter(body);

  return stripLeadingEmptyLinkLines(stripLeadingMatchingTitle(withoutGeneratedFooter, archive.title)).trim();
}

function normalizeComparableArticleText(value: string): string {
  return value
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[([^\]]*)]\(([^)]*)\)/g, '$1 $2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractXArticleIntro(
  archive: Pick<UserArchive, 'fullContent' | 'previewText' | 'title' | 'articleMarkdown'>
): string {
  const source = (archive.fullContent || archive.previewText || '').trim();
  if (!source) return '';

  const separatorIndex = source.indexOf(LEGACY_WEB_CLIP_SEPARATOR);
  const introSource = separatorIndex >= 0
    ? source.slice(0, separatorIndex).trim()
    : source;

  const intro = stripLeadingEmptyLinkLines(stripLeadingMatchingTitle(introSource, archive.title)).trim();
  if (!intro) return '';

  const articleBody = (archive.articleMarkdown || (
    separatorIndex >= 0
      ? source.slice(separatorIndex + LEGACY_WEB_CLIP_SEPARATOR.length).trim()
      : ''
  )).trim();

  if (!articleBody) return intro;

  const comparableIntro = normalizeComparableArticleText(intro);
  const comparableArticle = normalizeComparableArticleText(articleBody);

  if (comparableIntro && comparableArticle.includes(comparableIntro)) {
    return '';
  }

  return intro;
}

function normalizeWhisperTranscript(archive: UserArchive): PostData['whisperTranscript'] | undefined {
  const transcript = archive.whisperTranscript;
  if (!transcript || !Array.isArray(transcript.segments)) return undefined;

  type NormalizedSegment = NonNullable<PostData['whisperTranscript']>['segments'][number];
  const segments = transcript.segments
    .map((segment, index) => {
      if (!segment || typeof segment.start !== 'number' || typeof segment.text !== 'string') return null;
      return {
        id: typeof segment.id === 'number' ? segment.id : index,
        start: segment.start,
        end: typeof segment.end === 'number' ? segment.end : segment.start + 1,
        text: segment.text,
      };
    })
    .filter((segment): segment is NormalizedSegment => segment !== null);

  if (segments.length === 0) return undefined;
  return {
    segments,
    language: archive.transcriptionLanguage || transcript.language || 'auto',
  };
}

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
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
  const isKidsnote = platform === 'kidsnote';
  const isXArticle = platform === 'x' && (archive.isArticle === true || !!archive.articleMarkdown);
  const normalizedWebBody = platform === 'web'
    ? extractWebArticleBody(archive)
    : isXArticle
      ? extractXArticleIntro(archive)
    : archive.fullContent || archive.previewText || '';
  const kidsnoteCenterName = isKidsnote ? normalizeHandle(archive.authorHandle) : undefined;
  const authorUsername = isKidsnote ? undefined : normalizeHandle(archive.authorHandle);
  const authorHandle = isKidsnote ? kidsnoteCenterName : (authorUsername ? `@${authorUsername}` : undefined);
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
  const whisperTranscript = normalizeWhisperTranscript(archive);

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
      text: normalizedWebBody,
      html: (archive.isArticle || archive.articleMarkdown) ? (archive.articleMarkdown ?? undefined) : undefined,
      ...(platform === 'web' && normalizedWebBody ? {
        markdown: normalizedWebBody,
        rawMarkdown: normalizedWebBody,
      } : {}),
      ...(kidsnoteCenterName ? {
        community: {
          name: kidsnoteCenterName,
          url: 'https://www.kidsnote.com/',
        },
      } : {}),
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
      location: metadataString(archive.metadata, 'location'),
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
    ...(archive.mediaPreservationStatus ? { mediaPreservationStatus: archive.mediaPreservationStatus } : {}),
    ...(whisperTranscript ? { whisperTranscript } : {}),
    ...(archive.transcriptionLanguage ? { transcriptionLanguage: archive.transcriptionLanguage } : {}),
    ...(archive.transcriptionModel ? { transcriptionModel: archive.transcriptionModel } : {}),
    ...(archive.transcriptionUpdatedAt ? { transcriptionUpdatedAt: archive.transcriptionUpdatedAt } : {}),
    ...(archive.transcriptResultId ? { transcriptResultId: archive.transcriptResultId } : {}),
    ...(archive.transcriptionDuration != null ? { transcriptionDuration: archive.transcriptionDuration } : {}),
    ...(archive.transcriptionProcessingTime != null ? { transcriptionProcessingTime: archive.transcriptionProcessingTime } : {}),
    ...(archive.isBookmarked != null ? { archive: archive.isBookmarked } : {}),
    ...(archive.isReblog != null ? { isReblog: archive.isReblog } : {}),
    ...(archive.comments && archive.comments.length > 0 ? {
      comments: archive.comments.map((c) => mapUserArchiveComment(c, platform)),
    } : {}),
  };
}
