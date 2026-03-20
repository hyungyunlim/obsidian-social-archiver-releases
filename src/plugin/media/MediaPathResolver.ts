import { normalizePath, TFile, Notice } from 'obsidian';
import type { App } from 'obsidian';
import type { Media } from '../../types/post';
import { uniqueStrings } from '../../utils/array';
import { normalizeUrlForDedup, encodePathForMarkdownLink } from '../../utils/url';
import { YtDlpDetector } from '../../utils/yt-dlp';

// ─── Constants ───────────────────────────────────────────────────────

/** Known image extensions */
export const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'heic', 'heif', 'avif',
]);

/** Known video extensions */
export const VIDEO_EXTENSIONS = new Set([
  'mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'wmv', 'm4v',
]);

/** Video extensions supported by local Whisper transcription flow. */
export const TRANSCRIBABLE_VIDEO_EXTENSIONS = new Set([
  'mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v',
]);

// ─── VideoDownloadFailure ────────────────────────────────────────────

export interface VideoDownloadFailure {
  index: number;
  originalUrl: string;
  attemptedUrl: string;
  reason: string;
  thumbnailFallback: boolean;
}

// ─── Deps ────────────────────────────────────────────────────────────

export interface MediaPathResolverDeps {
  app: App;
}

// ─── MediaPathResolver ──────────────────────────────────────────────

export class MediaPathResolver {
  private readonly app: App;

  constructor(deps: MediaPathResolverDeps) {
    this.app = deps.app;
  }

  // ─── Resolve local video paths ──────────────────────────────────

  /**
   * Resolve local video file paths referenced by a note.
   * Supports wiki embeds, markdown links, and frontmatter media arrays.
   */
  public async resolveLocalVideoPathsInNote(filePath: string): Promise<string[]> {
    const note = this.app.vault.getAbstractFileByPath(filePath);
    if (!(note instanceof TFile)) {
      return [];
    }

    const content = await this.app.vault.read(note);
    const cache = this.app.metadataCache.getFileCache(note);
    const frontmatterMedia = (cache?.frontmatter as Record<string, unknown> | undefined)?.media;

    const candidates = uniqueStrings([
      ...this.extractVideoPathCandidatesFromContent(content),
      ...this.extractVideoPathCandidatesFromFrontmatterMedia(frontmatterMedia),
    ]);

    const resolvedPaths: string[] = [];
    const seen = new Set<string>();

    for (const candidate of candidates) {
      const normalizedPath = this.resolveMediaPathForNote(candidate, note.path);
      if (!normalizedPath || this.isExternalMediaPath(normalizedPath)) continue;
      if (!this.isTranscribableVideoPath(normalizedPath)) continue;

      const resolvedCandidates = [normalizedPath];
      try {
        const decoded = decodeURIComponent(normalizedPath);
        if (decoded && decoded !== normalizedPath) {
          resolvedCandidates.push(decoded);
        }
      } catch {
        // Ignore decode errors and keep the original candidate.
      }

      for (const resolvedCandidate of resolvedCandidates) {
        const normalizedCandidate = normalizePath(resolvedCandidate).replace(/^\/+/, '');
        if (!normalizedCandidate || seen.has(normalizedCandidate.toLowerCase())) continue;

        const mediaFile = this.app.vault.getAbstractFileByPath(normalizedCandidate);
        if (mediaFile instanceof TFile) {
          seen.add(normalizedCandidate.toLowerCase());
          resolvedPaths.push(mediaFile.path);
          break;
        }
      }
    }

    return resolvedPaths;
  }

  // ─── Content extraction helpers ─────────────────────────────────

  /**
   * Extract video path candidates from markdown content (wiki embeds + markdown links).
   */
  public extractVideoPathCandidatesFromContent(content: string): string[] {
    const candidates: string[] = [];

    // Obsidian wikilink embeds: ![[path/to/video.mp4|alias]]
    const wikiEmbedRegex = /!\[\[([^\]]+)\]\]/g;
    let wikiMatch;
    while ((wikiMatch = wikiEmbedRegex.exec(content)) !== null) {
      const rawValue = wikiMatch[1];
      if (!rawValue) continue;
      const clean = rawValue.split('|')[0]?.trim() || '';
      if (clean) candidates.push(clean);
    }

    // Markdown links/images: [video](path/to/video.mp4) or ![video](path/to/video.mp4)
    const markdownLinkRegex = /!?\[[^\]]*?\]\(([^)]+)\)/g;
    let linkMatch;
    while ((linkMatch = markdownLinkRegex.exec(content)) !== null) {
      const rawTarget = linkMatch[1];
      if (!rawTarget) continue;

      const strippedTarget = rawTarget.trim();
      const angleMatch = strippedTarget.match(/^<([^>]+)>$/);
      const targetWithoutTitle = angleMatch?.[1]
        || strippedTarget.replace(/\s+["'][^"']*["']\s*$/, '');
      const clean = targetWithoutTitle.trim();
      if (clean) candidates.push(clean);
    }

    return uniqueStrings(candidates);
  }

  /**
   * Extract video path candidates from frontmatter media field.
   */
  public extractVideoPathCandidatesFromFrontmatterMedia(mediaField: unknown): string[] {
    if (!Array.isArray(mediaField)) {
      return [];
    }

    const candidates: string[] = [];

    for (const item of mediaField) {
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (!trimmed) continue;

        const typedMatch = trimmed.match(/^(video|audio|image|document)\s*:(.+)$/i);
        if (typedMatch) {
          const mediaType = typedMatch[1]?.toLowerCase();
          const mediaPath = typedMatch[2]?.trim() || '';
          if (mediaType === 'video' && mediaPath) {
            candidates.push(mediaPath);
          } else if (mediaPath && this.isTranscribableVideoPath(mediaPath)) {
            candidates.push(mediaPath);
          }
          continue;
        }

        if (this.isTranscribableVideoPath(trimmed)) {
          candidates.push(trimmed);
        }
        continue;
      }

      if (!item || typeof item !== 'object') {
        continue;
      }

      const record = item as Record<string, unknown>;
      const type = typeof record.type === 'string' ? record.type.toLowerCase() : '';
      const possiblePaths = [
        record.url,
        record.path,
        record.localPath,
        record.src,
      ];

      for (const possiblePath of possiblePaths) {
        if (typeof possiblePath !== 'string') continue;
        const trimmedPath = possiblePath.trim();
        if (!trimmedPath) continue;
        if (type === 'video' || this.isTranscribableVideoPath(trimmedPath)) {
          candidates.push(trimmedPath);
          break;
        }
      }
    }

    return uniqueStrings(candidates);
  }

  // ─── Path resolution helpers ────────────────────────────────────

  /**
   * Check whether a path points to an external resource (http, data URI, etc.).
   */
  public isExternalMediaPath(path: string): boolean {
    return /^(?:https?:|data:|obsidian:|vault:)/i.test(String(path || '').trim());
  }

  /**
   * Check whether a path has a transcribable video extension.
   */
  public isTranscribableVideoPath(path: string): boolean {
    const ext = this.getFileExtension(path, false);
    return !!ext && TRANSCRIBABLE_VIDEO_EXTENSIONS.has(ext);
  }

  /**
   * Resolve a (possibly relative) media path against a note's path.
   */
  public resolveMediaPathForNote(mediaPath: string, notePath: string): string {
    const trimmed = String(mediaPath || '').trim();
    if (!trimmed) return '';
    if (this.isExternalMediaPath(trimmed)) return trimmed;

    let normalized = trimmed
      .replace(/\\/g, '/')
      .replace(/^<|>$/g, '')
      .replace(/^["']|["']$/g, '');

    if (!normalized) return '';
    if (normalized.startsWith('./')) {
      normalized = normalized.substring(2);
    }

    if (!normalized.startsWith('../')) {
      return normalizePath(normalized).replace(/^\/+/, '');
    }

    const baseSegments = notePath.replace(/\\/g, '/').split('/').slice(0, -1);
    const relativeSegments = normalized.split('/');
    const stack = [...baseSegments];

    for (const segment of relativeSegments) {
      if (!segment || segment === '.') continue;
      if (segment === '..') {
        if (stack.length > 0) stack.pop();
      } else {
        stack.push(segment);
      }
    }

    return normalizePath(stack.join('/')).replace(/^\/+/, '');
  }

  // ─── URL / extension helpers ────────────────────────────────────

  /**
   * Extract URL candidate from mixed media URL field (string/object).
   */
  public extractMediaUrlCandidate(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    if (typeof value !== 'object' || value === null) {
      return '';
    }

    const urlObj = value as Record<string, unknown>;
    const candidates = [
      urlObj.r2_url,
      urlObj.r2Url,
      urlObj.video_url,
      urlObj.videoUrl,
      urlObj.cdn_url,
      urlObj.cdnUrl,
      urlObj.url,
      urlObj.image_url,
      urlObj.imageUrl,
      urlObj.thumbnail_url,
      urlObj.thumbnailUrl,
      urlObj.thumbnail,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }

    return '';
  }

  /**
   * Heuristic check for video URLs (extension/query/path based).
   */
  public isLikelyVideoUrl(url: string): boolean {
    const ext = this.getFileExtension(url, false);
    if (ext && (VIDEO_EXTENSIONS.has(ext) || ext === 'm3u8' || ext === 'ts')) {
      return true;
    }

    try {
      const parsed = new URL(url);
      const mimeHints = [
        parsed.searchParams.get('mime'),
        parsed.searchParams.get('content_type'),
        parsed.searchParams.get('type'),
      ]
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLowerCase();
      if (mimeHints.includes('video')) {
        return true;
      }
      if (/\/videos?\//i.test(parsed.pathname)) {
        return true;
      }
    } catch {
      // Ignore parsing errors, URL may be relative/invalid.
    }

    return false;
  }

  /**
   * Resolve the best media URL to download.
   * Videos prioritize real video URLs; thumbnail is only a fallback.
   */
  public resolveMediaDownloadSource(
    media: Partial<Media> & { url?: unknown; cdnUrl?: unknown; r2Url?: unknown; thumbnail?: unknown; thumbnailUrl?: unknown },
    platform: string
  ): { mediaUrl: string; isVideoThumbnail: boolean } {
    const rawUrl = this.extractMediaUrlCandidate(media.url);
    const rawCdnUrl = this.extractMediaUrlCandidate(media.cdnUrl);
    const rawR2Url = this.extractMediaUrlCandidate(media.r2Url);
    const rawThumbnail = this.extractMediaUrlCandidate(media.thumbnail);
    const rawThumbnailUrl = this.extractMediaUrlCandidate(media.thumbnailUrl);

    const dedupe = (values: string[]): string[] => {
      const seen = new Set<string>();
      const result: string[] = [];
      for (const value of values) {
        const trimmed = value.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        result.push(trimmed);
      }
      return result;
    };

    const type = media.type ?? 'image';
    const isNaverVideo = platform === 'naver' && type === 'video' && rawUrl.includes('apis.naver.com/rmcnmv');
    if (isNaverVideo) {
      return { mediaUrl: rawUrl, isVideoThumbnail: false };
    }

    if (type === 'video') {
      // Prefer permanent or explicit video URLs first.
      const mainCandidates = dedupe([rawR2Url, rawUrl, rawCdnUrl]);
      const likelyVideo = mainCandidates.find((candidate) => this.isLikelyVideoUrl(candidate));
      if (likelyVideo) {
        return { mediaUrl: likelyVideo, isVideoThumbnail: false };
      }

      // TikTok sometimes returns anti-hotlink HTML URLs instead of real media.
      const firstMain = mainCandidates[0];
      if (firstMain) {
        const isTikTokPageUrl = platform === 'tiktok' && /^https?:\/\/(?:www\.)?tiktok\.com\//i.test(firstMain);
        if (!isTikTokPageUrl) {
          return { mediaUrl: firstMain, isVideoThumbnail: false };
        }
      }

      const thumbnailFallback = rawThumbnail || rawThumbnailUrl;
      if (thumbnailFallback) {
        return { mediaUrl: thumbnailFallback, isVideoThumbnail: true };
      }

      if (firstMain) {
        return { mediaUrl: firstMain, isVideoThumbnail: false };
      }

      throw new Error('No valid URL found for video media');
    }

    const imageCandidates = dedupe([rawR2Url, rawCdnUrl, rawUrl, rawThumbnail, rawThumbnailUrl]);
    const mediaUrl = imageCandidates[0];
    if (!mediaUrl) {
      throw new Error('No valid URL found in media object');
    }

    return { mediaUrl, isVideoThumbnail: false };
  }

  /**
   * Get file extension from URL.
   * @param url - The URL to extract extension from
   * @param isVideoThumbnail - If true, returns 'jpg' for unknown/invalid extensions
   */
  public getFileExtension(url: string, isVideoThumbnail: boolean = false): string | null {
    try {
      const pathname = new URL(url).pathname;
      const parts = pathname.split('.');
      if (parts.length > 1) {
        const ext = parts[parts.length - 1];
        if (ext) {
          // Remove query parameters
          const cleanExt = ext.toLowerCase().split('?')[0];
          if (cleanExt) {
            // If extension contains '/', it's not a valid extension (e.g., LinkedIn URL paths)
            if (cleanExt.includes('/')) {
              return isVideoThumbnail ? 'jpg' : null;
            }
            // Check if it's a valid image/video extension
            if (IMAGE_EXTENSIONS.has(cleanExt) || VIDEO_EXTENSIONS.has(cleanExt)) {
              return cleanExt;
            }
            // For video thumbnails, unknown extensions (like .image) should default to jpg
            if (isVideoThumbnail) {
              return 'jpg';
            }
            // Return the extension as-is for other cases
            return cleanExt;
          }
        }
      }
    } catch {
      // Invalid URL
    }
    // Default to jpg for video thumbnails, null otherwise
    return isVideoThumbnail ? 'jpg' : null;
  }

  // ─── Downloadable video URL extraction ──────────────────────────

  /**
   * Extract downloadable video URLs from frontmatter media and videoDownloadFailedUrls.
   */
  public extractDownloadableVideoUrls(fm: Record<string, unknown>): string[] {
    const urls: string[] = [];

    // Skip if video is already downloaded (check both new flag and legacy download_time)
    if (fm.videoDownloaded === true) return urls;
    if (typeof fm.download_time === 'number' && fm.download_time > 0) return urls;

    // Check originalUrl for video-only platforms (YouTube, TikTok)
    // NOT Instagram/X/Twitter — those can be photo posts
    const originalUrl = fm.originalUrl;
    if (typeof originalUrl === 'string') {
      const isVideoOnlyPlatform = /youtube\.com|youtu\.be|tiktok\.com/i.test(originalUrl);
      if (isVideoOnlyPlatform && YtDlpDetector.isSupportedUrl(originalUrl)) {
        // Also skip if this URL was already downloaded
        const downloadedUrls = Array.isArray(fm.downloadedUrls) ? fm.downloadedUrls : [];
        if (!downloadedUrls.includes(originalUrl)) {
          urls.push(originalUrl);
        }
      }
    }

    // Check media array in frontmatter
    const mediaField = fm.media;
    if (Array.isArray(mediaField)) {
      for (const item of mediaField) {
        const url = this.extractMediaUrlCandidate(item);
        if (url && this.isLikelyVideoUrl(url)) {
          urls.push(url);
        }
      }
    }

    // Check videoDownloadFailedUrls
    const failedUrls = fm.videoDownloadFailedUrls;
    if (Array.isArray(failedUrls)) {
      for (const url of failedUrls) {
        if (typeof url === 'string' && url.trim()) {
          urls.push(url.trim());
        }
      }
    }

    return Array.from(new Set(urls));
  }

  // ─── Video download failure helpers ─────────────────────────────

  /**
   * Add or merge a video download failure into the failure list.
   */
  public addVideoDownloadFailure(
    failures: VideoDownloadFailure[],
    failure: VideoDownloadFailure
  ): void {
    const existing = failures.find((item) => item.index === failure.index);
    if (existing) {
      if (!existing.reason && failure.reason) {
        existing.reason = failure.reason;
      }
      if (!existing.attemptedUrl && failure.attemptedUrl) {
        existing.attemptedUrl = failure.attemptedUrl;
      }
      if (!existing.originalUrl && failure.originalUrl) {
        existing.originalUrl = failure.originalUrl;
      }
      existing.thumbnailFallback = existing.thumbnailFallback || failure.thumbnailFallback;
      return;
    }

    failures.push(failure);
  }

  /**
   * Append a "Video Download Status" section to note content with failure details.
   */
  public appendVideoDownloadFailureSection(
    content: string,
    failures: VideoDownloadFailure[]
  ): string {
    if (failures.length === 0) return content;

    const lines = failures.map((failure) => {
      const rawUrl = failure.originalUrl || failure.attemptedUrl;
      const link = rawUrl
        ? `[Video ${failure.index + 1}](${encodePathForMarkdownLink(rawUrl)})`
        : `Video ${failure.index + 1}`;
      const suffix = failure.thumbnailFallback ? ' (thumbnail fallback used)' : '';
      return `- <span style="color: var(--text-error);"><strong>Video download failed</strong></span>: ${link}${suffix}`;
    });

    const normalizedContent = content.replace(/\s+$/, '');
    return `${normalizedContent}\n\n## Video Download Status\n\n${lines.join('\n')}\n`;
  }

  /**
   * Apply video download status fields to note frontmatter.
   */
  public applyVideoDownloadStatusFrontmatter(
    frontmatter: Record<string, unknown>,
    totalVideoCount: number,
    failures: VideoDownloadFailure[]
  ): void {
    if (totalVideoCount <= 0) return;

    const failedUrls = uniqueStrings(
      failures
        .map((failure) => failure.originalUrl || failure.attemptedUrl)
        .filter((url): url is string => !!url),
      normalizeUrlForDedup
    );

    frontmatter.videoDownloaded = failures.length === 0;
    frontmatter.videoDownloadFailed = failures.length > 0;
    frontmatter.videoDownloadFailedCount = failures.length;
    if (failedUrls.length > 0) {
      frontmatter.videoDownloadFailedUrls = failedUrls;
    } else {
      delete frontmatter.videoDownloadFailedUrls;
    }
  }

  /**
   * Show an Obsidian notice summarizing video download failures.
   */
  public notifyVideoDownloadFailures(failures: VideoDownloadFailure[]): void {
    if (failures.length === 0) return;
    const suffix = failures.length === 1 ? '' : 's';
    new Notice(
      `\u26A0\uFE0F ${failures.length} video${suffix} failed to download. Added failure status to the note.`,
      8000
    );
  }
}
