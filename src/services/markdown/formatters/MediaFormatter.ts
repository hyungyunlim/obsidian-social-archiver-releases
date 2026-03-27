import type { PostData, Platform } from '@/types/post';
import { DateNumberFormatter } from './DateNumberFormatter';
import type { MediaResult } from '../../MediaHandler';
import { MediaPlaceholderGenerator, type MediaExpiredResult } from '../../MediaPlaceholderGenerator';
import { encodePathForMarkdownLink } from '@/utils/url';

/**
 * Find a MediaResult by its sourceIndex (position in the original input array).
 *
 * This is the correct lookup when results may be a compressed subset of the
 * original media array (partial failures remove some entries). Falling back to
 * URL-matching is kept as a secondary safety net.
 */
export function findMediaResultBySourceIndex(
  results: MediaResult[],
  sourceIndex: number,
  originalUrl?: string
): MediaResult | undefined {
  const byIndex = results.find(r => r.sourceIndex === sourceIndex);
  if (byIndex) return byIndex;
  // Secondary fallback: URL match (for callers that don't have a reliable sourceIndex)
  if (originalUrl) return results.find(r => r.originalUrl === originalUrl);
  return undefined;
}

/**
 * MediaFormatter - Format media items for markdown
 * Single Responsibility: Media (images, videos, audio) formatting
 */
export class MediaFormatter {
  private dateNumberFormatter: DateNumberFormatter;

  constructor(dateNumberFormatter: DateNumberFormatter) {
    this.dateNumberFormatter = dateNumberFormatter;
  }

  /**
   * Format media items for markdown
   * @param media - Original media items from PostData
   * @param platform - Platform name
   * @param originalUrl - Original post URL (used as fallback link target for failed video downloads)
   * @param mediaResults - Downloaded media results (optional, if downloadMedia is enabled)
   */
  formatMedia(
    media: PostData['media'],
    platform: Platform,
    originalUrl: string,
    mediaResults?: MediaResult[],
    expiredMedia?: MediaExpiredResult[]
  ): string {
    if (!media || media.length === 0) {
      return '';
    }

    // For TikTok/YouTube, always include video URL (for iframe rendering)
    // even if media was not downloaded
    const isTikTokOrYouTube = platform === 'tiktok' || platform === 'youtube';

    // For user-created posts (platform: 'post'), media.url is already a vault path
    // No need to check mediaResults
    const isUserPost = platform === 'post';

    const formattedMedia = media
      .map((item, index) => {
        // Support both altText and alt for backward compatibility
        const alt = item.altText || item.alt || `${item.type} ${index + 1}`;

        // For videos on TikTok/YouTube platforms
        if (item.type === 'video' && isTikTokOrYouTube) {
          // Use sourceIndex-based lookup first, fallback to URL matching
          const downloadedMedia = mediaResults
            ? findMediaResultBySourceIndex(mediaResults, index, item.url)
            : undefined;

          // Use local path if downloaded, otherwise use original URL
          const mediaUrl = downloadedMedia?.localPath || item.url;

          const duration = item.duration ? ` (${this.dateNumberFormatter.formatDuration(item.duration)})` : '';
          return `![🎥 Video${duration}](${encodePathForMarkdownLink(mediaUrl)})`;
        }

        // For user-created posts, media.url is already a vault path
        if (isUserPost) {
          const mediaUrl = item.url;

          if (item.type === 'image') {
            return `![${this.escapeMarkdown(alt)}](${encodePathForMarkdownLink(mediaUrl)})`;
          } else if (item.type === 'video') {
            const duration = item.duration ? ` (${this.dateNumberFormatter.formatDuration(item.duration)})` : '';
            return `![🎥 Video${duration}](${encodePathForMarkdownLink(mediaUrl)})`;
          } else if (item.type === 'audio') {
            // For podcast audio, use Obsidian's native audio embed format
            const duration = item.duration ? ` (${this.dateNumberFormatter.formatDuration(item.duration)})` : '';
            if (!mediaUrl.startsWith('http://') && !mediaUrl.startsWith('https://')) {
              return `![[${mediaUrl}]]`;
            }
            return `<audio controls src="${mediaUrl}"></audio>${duration ? `\n*Duration: ${duration.trim().replace(/[()]/g, '')}*` : ''}`;
          } else {
            return `[📄 Document](${encodePathForMarkdownLink(mediaUrl)})`;
          }
        }

        // For other media types, use sourceIndex-based lookup (R2.2 / R3.2)
        const downloadedMedia = mediaResults
          ? findMediaResultBySourceIndex(mediaResults, index, item.url)
          : undefined;

        // If no local path and media is expired, generate placeholder
        if (!downloadedMedia) {
          const expired = expiredMedia?.find(e => e.originalUrl === item.url);
          if (expired) {
            return MediaPlaceholderGenerator.generatePlaceholder(expired, index);
          }
          // No download result and not expired — fall through to remote URL rendering
        }

        if (item.type === 'image') {
          const resolvedUrl = downloadedMedia?.localPath || item.url;
          return `![${this.escapeMarkdown(alt)}](${encodePathForMarkdownLink(resolvedUrl)})`;
        } else if (item.type === 'video') {
          const duration = item.duration ? ` (${this.dateNumberFormatter.formatDuration(item.duration)})` : '';
          return this.renderVideo(item, downloadedMedia, duration, originalUrl);
        } else if (item.type === 'audio') {
          // For podcast audio, use Obsidian's native audio embed format
          // This renders as an audio player in both Reading and Live Preview modes
          const duration = item.duration ? ` (${this.dateNumberFormatter.formatDuration(item.duration)})` : '';
          const resolvedUrl = downloadedMedia?.localPath || item.url;
          // Use ![[file]] format for local files, or embed link for external URLs
          if (!resolvedUrl.startsWith('http://') && !resolvedUrl.startsWith('https://')) {
            return `![[${resolvedUrl}]]`;
          }
          // External audio URL - use HTML audio tag (renders in both modes)
          return `<audio controls src="${resolvedUrl}"></audio>${duration ? `\n*Duration: ${duration.trim().replace(/[()]/g, '')}*` : ''}`;
        } else {
          const resolvedUrl = downloadedMedia?.localPath || item.url;
          return `[📄 Document](${encodePathForMarkdownLink(resolvedUrl)})`;
        }
      })
      .filter(Boolean) // Remove empty strings
      .join('\n\n');

    return formattedMedia;
  }

  /**
   * Render a video media item following R3.2 fallback rules:
   * 1. Local video file → embed syntax
   * 2. No local video, but local thumbnail → clickable thumbnail image linking to post URL
   * 3. Neither → plain link to post URL
   *
   * @param item - Original media item (may carry a local thumbnail path in item.thumbnail)
   * @param downloadedMedia - Download result (may be thumbnail-only fallback)
   * @param durationSuffix - Pre-formatted duration string like " (1:23)"
   * @param postUrl - Original post URL used as click target when no local video
   */
  renderVideo(
    item: PostData['media'][number],
    downloadedMedia: MediaResult | undefined,
    durationSuffix: string,
    postUrl: string
  ): string {
    if (downloadedMedia && downloadedMedia.fallbackKind !== 'thumbnail') {
      // Case 1: local video file available
      const localVideoPath = downloadedMedia.localPath;
      return `![🎥 Video${durationSuffix}](${encodePathForMarkdownLink(localVideoPath)})`;
    }

    // Determine local thumbnail path:
    // - from downloadedMedia when fallbackKind='thumbnail'
    // - or from item.thumbnail if it was set by ArchiveOrchestrator/SubscriptionSyncService
    const localThumbnailPath =
      (downloadedMedia?.fallbackKind === 'thumbnail' ? downloadedMedia.localPath : undefined) ||
      (item.thumbnail && !item.thumbnail.startsWith('http') ? item.thumbnail : undefined);

    if (localThumbnailPath) {
      // Case 2: clickable thumbnail linking to original post
      const linkTarget = postUrl;
      return `[![🎥 Video${durationSuffix}](${encodePathForMarkdownLink(localThumbnailPath)})](${linkTarget})`;
    }

    // Case 3: fallback link only
    const fallbackUrl = item.url && (item.url.startsWith('http://') || item.url.startsWith('https://'))
      ? item.url
      : postUrl;
    const isRemoteUrl = fallbackUrl.startsWith('http://') || fallbackUrl.startsWith('https://');
    if (isRemoteUrl) {
      return `[🎥 Video${durationSuffix}](${fallbackUrl})`;
    }
    // Local vault path (shouldn't happen for a failed video, but handle gracefully)
    return `![🎥 Video${durationSuffix}](${encodePathForMarkdownLink(fallbackUrl)})`;
  }

  /**
   * Extract YouTube video ID from URL
   */
  private _extractYouTubeVideoId(url: string): string | null {
    try {
      const urlObj = new URL(url);

      // Standard youtube.com/watch?v=VIDEO_ID
      if (urlObj.hostname.includes('youtube.com')) {
        const videoId = urlObj.searchParams.get('v');
        if (videoId) return videoId;

        // youtube.com/embed/VIDEO_ID or youtube.com/shorts/VIDEO_ID
        const pathMatch = urlObj.pathname.match(/\/(embed|shorts|live)\/([A-Za-z0-9_-]+)/);
        if (pathMatch) return pathMatch[2] || null;
      }

      // Shortened youtu.be/VIDEO_ID
      if (urlObj.hostname === 'youtu.be') {
        const match = urlObj.pathname.match(/\/([A-Za-z0-9_-]+)/);
        return match ? (match[1] || null) : null;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Escape markdown special characters
   */
  private escapeMarkdown(text: string): string {
    return text.replace(/([\\`*_{}[\]()#+\-.!])/g, '\\$1');
  }
}
