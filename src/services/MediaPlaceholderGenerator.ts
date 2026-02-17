/**
 * Media Placeholder Generator
 *
 * Generates parseable Obsidian callout placeholders for media that couldn't
 * be downloaded (e.g., expired CDN URLs). Includes original URL in an HTML
 * comment for future re-download capability.
 */

export interface MediaExpiredResult {
  originalUrl: string;
  type: 'image' | 'video' | 'audio' | 'document';
  reason: 'cdn_expired' | 'download_failed';
  detectedAt: string; // ISO 8601
}

const TYPE_LABELS: Record<string, string> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  document: 'document',
};

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class MediaPlaceholderGenerator {
  /**
   * Generate a parseable Obsidian callout placeholder for an expired/failed media item.
   *
   * Format:
   * ```markdown
   * > [!warning] Media Unavailable (1)
   * > This image could not be downloaded (CDN URL expired).
   * > Original URL: `https://scontent.fbcdn.net/...`
   * > <!-- social-archiver:expired-media:image:https://scontent.fbcdn.net/... -->
   * ```
   */
  static generatePlaceholder(expired: MediaExpiredResult, index: number): string {
    const typeLabel = TYPE_LABELS[expired.type] ?? 'media';
    const reasonText = expired.reason === 'cdn_expired'
      ? 'CDN URL expired'
      : 'download failed';

    const lines = [
      `> [!warning] Media Unavailable (${index + 1})`,
      `> This ${typeLabel} could not be downloaded (${reasonText}).`,
      `> Original URL: \`${expired.originalUrl}\``,
      `> <!-- social-archiver:expired-media:${expired.type}:${expired.originalUrl} -->`,
    ];

    return lines.join('\n');
  }

  /**
   * Parse a placeholder back into a MediaExpiredResult.
   * Returns null if the markdown doesn't contain a valid placeholder comment.
   */
  static parsePlaceholder(markdown: string): MediaExpiredResult | null {
    const match = markdown.match(
      /<!-- social-archiver:expired-media:(image|video|audio|document):(.+?) -->/
    );
    if (!match) return null;

    const type = match[1] as MediaExpiredResult['type'];
    const originalUrl = match[2] ?? '';

    // Detect reason from the callout text
    const reason: MediaExpiredResult['reason'] = markdown.includes('CDN URL expired')
      ? 'cdn_expired'
      : 'download_failed';

    return {
      originalUrl,
      type,
      reason,
      detectedAt: new Date().toISOString(),
    };
  }
}
