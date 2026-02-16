import type { PostData, Platform } from '@/types/post';
import { DateNumberFormatter } from './DateNumberFormatter';
import type { MediaResult } from '../../MediaHandler';
import { MediaPlaceholderGenerator, type MediaExpiredResult } from '../../MediaPlaceholderGenerator';
import { encodePathForMarkdownLink } from '@/utils/url';

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
   * @param originalUrl - Original post URL
   * @param mediaResults - Downloaded media results (optional, if downloadMedia is enabled)
   */
  formatMedia(
    media: PostData['media'],
    platform: Platform,
    _originalUrl: string,
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
          // Try to find downloaded media by index first (more reliable), fallback to URL matching
          const downloadedMedia = mediaResults?.[index] || mediaResults?.find(r => r.originalUrl === item.url);

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

        // For other media types, require mediaResults
        // Try to find downloaded media by index first (more reliable), fallback to URL matching
        const downloadedMedia = mediaResults?.[index] || mediaResults?.find(r => r.originalUrl === item.url);
        const mediaUrl = downloadedMedia?.localPath || null;

        // If no local path and media is expired, generate placeholder
        if (!mediaUrl) {
          const expired = expiredMedia?.find(e => e.originalUrl === item.url);
          if (expired) {
            return MediaPlaceholderGenerator.generatePlaceholder(expired, index);
          }
          // Non-ephemeral CDN: still use original URL as fallback
        }

        const resolvedUrl = mediaUrl || item.url;

        if (item.type === 'image') {
          // Display image inline
          return `![${this.escapeMarkdown(alt)}](${encodePathForMarkdownLink(resolvedUrl)})`;
        } else if (item.type === 'video') {
          // Store video as markdown link (PostCardRenderer will handle iframe rendering in timeline)
          const duration = item.duration ? ` (${this.dateNumberFormatter.formatDuration(item.duration)})` : '';
          return `![🎥 Video${duration}](${encodePathForMarkdownLink(resolvedUrl)})`;
        } else if (item.type === 'audio') {
          // For podcast audio, use Obsidian's native audio embed format
          // This renders as an audio player in both Reading and Live Preview modes
          const duration = item.duration ? ` (${this.dateNumberFormatter.formatDuration(item.duration)})` : '';
          // Use ![[file]] format for local files, or embed link for external URLs
          if (!resolvedUrl.startsWith('http://') && !resolvedUrl.startsWith('https://')) {
            return `![[${resolvedUrl}]]`;
          }
          // External audio URL - use HTML audio tag (renders in both modes)
          return `<audio controls src="${resolvedUrl}"></audio>${duration ? `\n*Duration: ${duration.trim().replace(/[()]/g, '')}*` : ''}`;
        } else {
          return `[📄 Document](${encodePathForMarkdownLink(resolvedUrl)})`;
        }
      })
      .filter(Boolean) // Remove empty strings
      .join('\n\n');

    return formattedMedia;
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
