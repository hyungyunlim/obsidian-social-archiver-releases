import type { IService } from './base/IService';
import { App, TFile, type Vault } from 'obsidian';
import type { Media, Platform } from '@/types/post';
import { normalizePath, requestUrl } from 'obsidian';
import type { WorkersAPIClient } from './WorkersAPIClient';
import { ImageOptimizer } from './ImageOptimizer';

/**
 * MediaHandler configuration
 */
export interface MediaHandlerConfig {
  vault: Vault;
  app?: App;
  workersClient?: WorkersAPIClient; // Optional for proxy download
  basePath?: string;
  maxConcurrent?: number;
  maxImageDimension?: number;
  timeout?: number;
  optimizeImages?: boolean; // Enable image optimization (default: true)
  imageQuality?: number; // Image quality for optimization (0.0-1.0, default: 0.8)
}

/**
 * Media download result
 */
export interface MediaResult {
  originalUrl: string;
  localPath: string;
  type: Media['type'];
  size: number;
  file: TFile;
}

/**
 * Download progress callback
 */
export type DownloadProgressCallback = (downloaded: number, total: number) => void;

/**
 * Media type detector
 */
 
class MediaTypeDetector {
  private static imageExtensions = new Set([
    'jpg', 'jpeg', 'png', 'pnj', 'gif', 'webp', 'svg', 'bmp', 'ico', 'heic', 'heif', 'avif'
  ]);

  private static videoExtensions = new Set([
    'mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'wmv'
  ]);

  private static audioExtensions = new Set([
    'mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'
  ]);

  /**
   * Detect media type from URL or MIME type
   */
  static detect(url: string, mimeType?: string): Media['type'] {
    // Check MIME type first
    if (mimeType) {
      if (mimeType.startsWith('image/')) return 'image';
      if (mimeType.startsWith('video/')) return 'video';
      if (mimeType.startsWith('audio/')) return 'audio';
    }

    // Check file extension
    const extension = this.getExtension(url);
    if (this.imageExtensions.has(extension)) return 'image';
    if (this.videoExtensions.has(extension)) return 'video';
    if (this.audioExtensions.has(extension)) return 'audio';

    return 'document';
  }

  /**
   * Validate media type - ensures downloaded data is actual media, not HTML error page
   */
  static validate(_type: Media['type'], data: ArrayBuffer): boolean {
    // Basic validation - check that data exists
    if (data.byteLength === 0) {
      return false;
    }

    // Check if data is HTML (error page) instead of actual media
    // This happens when CDNs return HTML error/redirect pages instead of media
    if (this.isHtmlContent(data)) {
      return false;
    }

    return true;
  }

  /**
   * Check if data is HTML content (error page or redirect)
   */
  private static isHtmlContent(data: ArrayBuffer): boolean {
    // Check first 100 bytes for HTML signatures
    const bytes = new Uint8Array(data.slice(0, 100));
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).toLowerCase().trim();

    return (
      text.startsWith('<!doctype html') ||
      text.startsWith('<html') ||
      text.startsWith('<?xml') ||
      text.includes('<head>') ||
      text.includes('<body')
    );
  }

  /**
   * Get file extension from URL
   */
  private static getExtension(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const parts = pathname.split('.');
      return parts.length > 1 ? (parts[parts.length - 1] ?? '').toLowerCase() : '';
    } catch {
      return '';
    }
  }
}

/**
 * Media path generator
 */
class MediaPathGenerator {
  private basePath: string;

  constructor(basePath: string = 'attachments/social-archives') {
    this.basePath = basePath;
  }

  /**
   * Generate path for media file
   * Format: {basePath}/{platform}/{postId}/{filename}
   *
   * @param platform - Platform name (e.g., 'facebook', 'reddit')
   * @param postId - Post identifier (used as folder name)
   * @param filename - Media filename
   */
  generatePath(platform: Platform, postId: string, filename: string): string {
    const sanitized = this.sanitizeFilename(filename);
    const sanitizedPostId = this.sanitizeFilename(postId || 'unknown');
    const platformFolder = this.sanitizeFilename(platform || 'unknown');
    return normalizePath(`${this.basePath}/${platformFolder}/${sanitizedPostId}/${sanitized}`);
  }

  /**
   * Generate filename from URL
   * Format: {date}-{authorUsername}-{postId}-{index}.{extension}
   *
   * @param url - Media URL
   * @param index - Media index in post
   * @param postId - Post identifier
   * @param authorUsername - Author username
   * @param outputExtension - Override extension (e.g., 'webp' for optimized images)
   */
  generateFilename(url: string, index: number, postId: string, authorUsername: string, outputExtension?: string | null): string {
    try {
      // Get current date for archiving timestamp
      const now = new Date();
      const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

      // Get extension (use outputExtension if provided, otherwise extract from URL)
      let extension = outputExtension || this.getExtensionFromUrl(url) || 'bin';

      // Sanitize extension to prevent path traversal (e.g., LinkedIn URLs with slashes)
      extension = this.sanitizeExtension(extension);

      // Sanitize author username and postId
      const sanitizedAuthor = this.sanitizeFilename(authorUsername || 'unknown');
      const sanitizedPostId = this.sanitizeFilename(postId);

      // Format: YYYYMMDD-username-postId-index.ext
      return `${date}-${sanitizedAuthor}-${sanitizedPostId}-${index + 1}.${extension}`;
    } catch {
      return `media-${index + 1}.bin`;
    }
  }

  /**
   * Get extension from URL
   */
  public getExtensionFromUrl(url: string): string | null {
    try {
      const pathname = new URL(url).pathname;
      const parts = pathname.split('.');
      if (parts.length > 1) {
        let ext = (parts[parts.length - 1] ?? '').toLowerCase();
        // Remove query parameters
        ext = ext.split('?')[0] || ext;
        // If extension contains '/', it's not a valid extension (e.g., LinkedIn URL paths)
        if (ext.includes('/')) {
          return null;
        }
        // Tumblr sometimes serves .pnj (PNG) - map to png for compatibility
        if (ext === 'pnj') {
          ext = 'png';
        }
        return ext || null;
      }
    } catch {
      // Invalid URL
    }
    return null;
  }

  /**
   * Sanitize filename
   * Also handles Windows-specific issues like consecutive dots and invisible Unicode characters
   */
  private sanitizeFilename(filename: string): string {
    return filename
      // Remove invisible Unicode characters (Zero-Width Space, Non-Breaking Space, etc.)
      .replace(/[\u200B-\u200D\u2060\u00A0\uFEFF\u200E\u200F\u202A-\u202E]/g, '')
      .replace(/[\\/:*?"<>|]/g, '-')
      // Replace consecutive dots (e.g., "...") with a single dash - Windows doesn't like multiple dots
      .replace(/\.{2,}/g, '-')
      // Replace multiple consecutive dashes with single dash
      .replace(/-{2,}/g, '-')
      .replace(/\s+/g, '_')
      .trim();
  }

  /**
   * Sanitize extension to prevent path traversal
   * Returns 'bin' if extension is invalid (contains slashes, too long, etc.)
   */
  private sanitizeExtension(ext: string): string {
    if (!ext) return 'bin';

    // Remove any path separators
    let sanitized = ext.replace(/[\\/]/g, '');

    // Remove other invalid characters
    sanitized = sanitized.replace(/[*?"<>|:]/g, '');

    // Limit length (max 10 chars for extension)
    if (sanitized.length > 10) {
      sanitized = sanitized.substring(0, 10);
    }

    // If empty after sanitization, use bin
    return sanitized || 'bin';
  }
}

/**
 * Download queue manager using p-limit pattern
 */
class DownloadQueue {
  private maxConcurrent: number;
  private activeCount = 0;
  private queue: Array<() => Promise<void>> = [];

  constructor(maxConcurrent: number = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Add task to queue
   */
  async add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const wrappedTask = async () => {
        try {
          const result = await task();
          resolve(result);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        } finally {
          this.activeCount--;
          this.processQueue();
        }
      };

      this.queue.push(wrappedTask);
      this.processQueue();
    });
  }

  /**
   * Process queue
   */
  private processQueue(): void {
    while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        this.activeCount++;
        void task();
      }
    }
  }

  /**
   * Get queue status
   */
  getStatus(): { active: number; queued: number } {
    return {
      active: this.activeCount,
      queued: this.queue.length,
    };
  }
}

/**
 * MediaHandler - Handles media file downloading and processing
 *
 * Single Responsibility: Media file management
 */
export class MediaHandler implements IService {
  private vault: Vault;
  private app: App | undefined;
  private workersClient?: WorkersAPIClient;
  private pathGenerator: MediaPathGenerator;
  private downloadQueue: DownloadQueue;
  private imageOptimizer: ImageOptimizer;
  private maxImageDimension: number;
  private timeout: number;
  private optimizeImages: boolean;
  private imageQuality: number;

  constructor(config: MediaHandlerConfig) {
    this.vault = config.vault;
    this.app = config.app;
    this.workersClient = config.workersClient;
    this.pathGenerator = new MediaPathGenerator(config.basePath);
    this.downloadQueue = new DownloadQueue(config.maxConcurrent || 3);
    this.imageOptimizer = new ImageOptimizer();
    this.maxImageDimension = config.maxImageDimension || 2048;
    this.timeout = config.timeout || 30000;
    this.optimizeImages = config.optimizeImages !== false; // Default: true
    this.imageQuality = config.imageQuality || 0.8;
  }

  initialize(): void {
    // No async initialization needed
  }

  dispose(): void {
    // Clean up image optimizer resources
    this.imageOptimizer.dispose();
  }

  /**
   * Check if service is healthy
   */
  isHealthy(): boolean {
    try {
      this.vault.getRoot();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Download media files for a post
   * @param startIndex - Optional starting index for filename numbering (useful when downloading single items)
   */
  async downloadMedia(
    media: Media[],
    platform: Platform,
    postId: string,
    authorUsername: string,
    onProgress?: DownloadProgressCallback,
    startIndex: number = 0
  ): Promise<MediaResult[]> {
    let completed = 0;
    const total = media.length;

    // Download all media files with individual error handling
    // Use Promise.all to preserve order (results match input media order)
    const downloadPromises = media.map((item, arrayIndex) => {
      const actualIndex = startIndex + arrayIndex; // Use startIndex offset for correct filename numbering
      return this.downloadQueue.add(async () => {
        try {
          const result = await this.downloadSingleMedia(item, platform, postId, authorUsername, actualIndex);
          return result;
        } catch (error) {
          // Don't fail the entire batch - continue with other media
          console.error(`[MediaHandler] Failed to download media ${actualIndex}:`, error);
          return null;
        } finally {
          completed++;
          onProgress?.(completed, total);
        }
      });
    });

    const results = await Promise.all(downloadPromises);

    // Filter out failed downloads (nulls) while preserving order of successful ones
    return results.filter((r): r is MediaResult => r !== null);
  }

  /**
   * Download a single media file
   */
  private async downloadSingleMedia(
    media: Media,
    platform: Platform,
    postId: string,
    authorUsername: string,
    index: number
  ): Promise<MediaResult> {
    let resolvedPath: string | null = null;

    try {
      // Check if this is a Naver video that needs special handling
      if (platform === 'naver' && media.type === 'video' && this.isNaverVideoApiUrl(media.url)) {
        return await this.downloadNaverVideo(media, postId, authorUsername, index);
      }

      // Prefer original/preserved media URL.
      // For videos, only use thumbnail as a fallback if video URL download fails.
      const primaryUrl = media.r2Url || media.cdnUrl || media.url;
      const thumbnailUrl = media.r2ThumbnailUrl || media.thumbnail;
      const downloadCandidates = media.type === 'video'
        ? [primaryUrl, ...(thumbnailUrl && thumbnailUrl !== primaryUrl ? [thumbnailUrl] : [])]
        : [primaryUrl];

      let selectedUrl: string | null = null;
      let selectedData: ArrayBuffer | null = null;
      let selectedType: Media['type'] | null = null;
      let selectedVideoExtension: string | null = null;
      let firstSuccessfulCandidate: {
        url: string;
        data: ArrayBuffer;
        type: Media['type'];
        videoExtension: string | null;
      } | null = null;
      let lastCandidateError: Error | null = null;

      for (const candidateUrl of downloadCandidates) {
        try {
          const candidateData = await this.downloadFromUrl(candidateUrl, platform, media.url);

          // URL-only detection is not enough for video URLs without extension.
          // Infer video format from binary to preserve video type and extension.
          const binaryVideoExtension = this.detectVideoExtension(candidateData);
          const urlDetectedType = MediaTypeDetector.detect(candidateUrl, media.mimeType);
          const candidateType: Media['type'] = binaryVideoExtension ? 'video' : urlDetectedType;

          if (!MediaTypeDetector.validate(candidateType, candidateData)) {
            throw new Error('Invalid media data');
          }

          if (!firstSuccessfulCandidate) {
            firstSuccessfulCandidate = {
              url: candidateUrl,
              data: candidateData,
              type: candidateType,
              videoExtension: binaryVideoExtension,
            };
          }

          // For video media, keep trying until we get an actual video payload.
          if (media.type === 'video' && candidateType !== 'video') {
            continue;
          }

          selectedUrl = candidateUrl;
          selectedData = candidateData;
          selectedType = candidateType;
          selectedVideoExtension = binaryVideoExtension;
          break;
        } catch (error) {
          lastCandidateError = error instanceof Error ? error : new Error(String(error));
        }
      }

      // If no true video payload was found, fallback to the first successful candidate
      // to avoid losing media entirely.
      if (!selectedData && firstSuccessfulCandidate) {
        selectedUrl = firstSuccessfulCandidate.url;
        selectedData = firstSuccessfulCandidate.data;
        selectedType = firstSuccessfulCandidate.type;
        selectedVideoExtension = firstSuccessfulCandidate.videoExtension;
      }

      if (!selectedUrl || !selectedData || !selectedType) {
        throw lastCandidateError || new Error('All media download attempts failed');
      }

      // Process based on type
      let processedData = selectedData;
      let outputExtension: string | null = null; // Track output extension for optimized images

      // Skip optimization for vector formats (SVG) and tiny icons (ICO)
      const urlExtension = this.pathGenerator.getExtensionFromUrl(selectedUrl) || this.pathGenerator.getExtensionFromUrl(media.url);
      const skipOptimization = urlExtension === 'svg' || urlExtension === 'ico';

      // First, detect the ACTUAL format from binary data (not URL extension)
      // This handles cases where Cloudflare already converted HEIC to JPEG
      const actualFormat = this.detectImageExtension(selectedData);

      if (selectedType === 'image' && this.optimizeImages && !skipOptimization) {
        try {
          const optimizationResult = await this.imageOptimizer.optimize(selectedData, {
            maxWidth: this.maxImageDimension,
            maxHeight: this.maxImageDimension,
            quality: this.imageQuality,
            format: 'webp',
            maintainAspectRatio: true,
          });

          processedData = optimizationResult.data;
          // Use the actual optimized format (likely webp, but may fall back to jpeg if unsupported)
          outputExtension = this.normalizeImageExtension(optimizationResult.format || 'webp');
        } catch {
          // Fallback to original data if optimization fails
          processedData = selectedData;
          // Use actual detected format, not URL extension
          outputExtension = actualFormat;
        }
      } else if (selectedType === 'video') {
        outputExtension = this.normalizeVideoExtension(
          selectedVideoExtension ||
          this.pathGenerator.getExtensionFromUrl(selectedUrl) ||
          this.pathGenerator.getExtensionFromUrl(media.url) ||
          this.extensionFromMimeType(media.mimeType) ||
          'mp4'
        );
      } else if (selectedType === 'audio') {
        outputExtension = this.normalizeAudioExtension(
          this.pathGenerator.getExtensionFromUrl(selectedUrl) ||
          this.pathGenerator.getExtensionFromUrl(media.url) ||
          this.extensionFromMimeType(media.mimeType) ||
          'mp3'
        );
      } else {
        // Optimization skipped - use actual detected format
        outputExtension = actualFormat;
      }

      // Generate path and save (platform folder is sanitized/fallback-safe)
      const filename = this.pathGenerator.generateFilename(selectedUrl, index, postId, authorUsername, outputExtension);
      const path = this.pathGenerator.generatePath(platform, postId, filename);
      resolvedPath = path;

      // Check if file already exists
      const existingFile = this.vault.getAbstractFileByPath(path);
      if (existingFile && existingFile instanceof TFile) {
        // File already exists, reuse it
        return {
          originalUrl: media.url,
          localPath: path,
          type: selectedType,
          size: processedData.byteLength,
          file: existingFile,
        };
      }

      // Ensure parent folder exists
      await this.ensureFolderExists(this.getParentPath(path));

      // Save to vault
      const file = await this.vault.createBinary(path, processedData);

      return {
        originalUrl: media.url,
        localPath: file.path,
        type: selectedType,
        size: processedData.byteLength,
        file,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Handle race condition: file was created by another concurrent process
      if (errorMessage.includes('File already exists') || errorMessage.includes('already exists')) {
        if (resolvedPath) {
          const existingResolvedFile = this.vault.getAbstractFileByPath(resolvedPath);
          if (existingResolvedFile && existingResolvedFile instanceof TFile) {
            const inferredType = MediaTypeDetector.detect(resolvedPath, media.mimeType);
            return {
              originalUrl: media.url,
              localPath: resolvedPath,
              type: inferredType,
              size: 0,
              file: existingResolvedFile,
            };
          }
        }

        // Re-derive the path using the same logic (without access to try block variables)
        const urlExtension = this.pathGenerator.getExtensionFromUrl(media.url);
        const filename = this.pathGenerator.generateFilename(media.url, index, postId, authorUsername, urlExtension);
        const path = this.pathGenerator.generatePath(platform, postId, filename);
        const existingFile = this.vault.getAbstractFileByPath(path);

        if (existingFile && existingFile instanceof TFile) {
          // File exists now, return it as success
          const inferredType = MediaTypeDetector.detect(media.url, media.mimeType);
          return {
            originalUrl: media.url,
            localPath: path,
            type: inferredType,
            size: 0, // Unknown size since we didn't download
            file: existingFile,
          };
        }
      }

      // TikTok videos often fail due to CORS/DRM - gracefully handle by skipping download
      // The embed will still work using the original post URL
      if (platform === 'tiktok') {
        // Return a placeholder result that won't be used for local file path
        // The TikTok embed will use the original post URL instead
        throw new Error('TikTok video download failed - will use embed fallback');
      }

      throw new Error(
        `Failed to download media from ${media.url}: ${errorMessage}`
      );
    }
  }

  /**
   * CDN domains that require proxy due to CORS restrictions
   */
  private static readonly CORS_BLOCKED_DOMAINS = [
    'cdninstagram.com',
    'fbcdn.net',
    'twimg.com',
    'tiktok.com',
    'tiktokcdn.com',
    'tiktokcdn-us.com',  // TikTok US CDN
    'tiktokv.com',       // TikTok video API CDN
    'tiktokv.us',        // TikTok US video CDN
    'tiktokw.us',        // TikTok US web CDN
    'ttwstatic.com',     // TikTok static assets CDN
    'muscdn.com',        // Musical.ly CDN
    'musical.ly',        // Musical.ly domain
    'licdn.com',
    'threads.com',
    'medium.com',        // Medium CDN (cdn-images-1.medium.com)
  ];

  /**
   * Check if URL requires proxy due to CORS restrictions
   */
  private requiresProxy(url: string): boolean {
    try {
      const hostname = new URL(url).hostname;
      return MediaHandler.CORS_BLOCKED_DOMAINS.some(domain => hostname.includes(domain));
    } catch {
      return false;
    }
  }

  /**
   * Download from URL with timeout
   * Uses Workers proxy if available (required for Instagram, TikTok, Threads due to CORS)
   */
  private async downloadFromUrl(url: string, platform?: Platform, _originalUrl?: string): Promise<ArrayBuffer> {
    // Check if it's a blob URL (TikTok videos from BrightData)
    if (url.startsWith('blob:')) {
      // Download blob URL directly in browser context (Electron/browser environment)
      // requestUrl() does not support the blob: protocol; use window.fetch for blob: URLs
      const response = await window.fetch(url);
      if (!response.ok) {
        throw new Error(`Blob fetch failed: ${response.status} ${response.statusText}`);
      }
      const blob = await response.blob();
      return blob.arrayBuffer();
    }

    // Check if this URL requires proxy (CORS-blocked domains)
    const needsProxy = this.requiresProxy(url);
    const bypassProxy = platform === 'mastodon';

    // Use Workers proxy if available and needed (bypasses CORS)
    if (this.workersClient && !bypassProxy) {
      try {
        return await this.workersClient.proxyMedia(url);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        // Fall through to direct fetch only if not a CORS-blocked domain
        if (needsProxy) {
          // For CORS-blocked domains, don't try direct fetch as it will definitely fail
          throw new Error(`Proxy failed for CORS-blocked URL: ${errorMsg}`);
        }
      }
    }

    // Use Obsidian's requestUrl API to bypass CORS restrictions
    // requestUrl uses Electron's main process which is not subject to browser CORS
    try {
      const response = await requestUrl({
        url,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Obsidian)',
        },
      });

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response.arrayBuffer;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(String(error));
    }
  }

  /**
   * Ensure folder exists
   */
  private async ensureFolderExists(path: string): Promise<void> {
    const normalizedPath = normalizePath(path);

    // Check if folder already exists
    const existing = this.vault.getFolderByPath(normalizedPath);
    if (existing) {
      return;
    }

    // Create parent folders recursively
    const parentPath = this.getParentPath(normalizedPath);
    if (parentPath && parentPath !== '.') {
      await this.ensureFolderExists(parentPath);
    }

    // Create this folder
    try {
      await this.vault.createFolder(normalizedPath);
    } catch (error) {
      // Folder might have been created by another operation
      const folder = this.vault.getFolderByPath(normalizedPath);
      if (!folder) {
        throw error;
      }
    }
  }

  /**
   * Get parent path
   */
  private getParentPath(path: string): string {
    const parts = path.split('/');
    if (parts.length <= 1) {
      return '.';
    }
    return parts.slice(0, -1).join('/');
  }

  /**
   * Delete media file (respects user's trash preference via fileManager)
   */
  async deleteMedia(file: TFile): Promise<void> {
    try {
      if (this.app) {
        await this.app.fileManager.trashFile(file);
      }
    } catch (error) {
      throw new Error(
        `Failed to delete media ${file.path}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Get queue status
   */
  getQueueStatus(): { active: number; queued: number } {
    return this.downloadQueue.getStatus();
  }

  /**
   * Cleanup orphaned media files
   * (Media files that don't have corresponding notes)
   */
  cleanupOrphanedMedia(_dryRun: boolean = true): TFile[] {
    const mediaFolder = this.vault.getFolderByPath(this.pathGenerator['basePath']);
    if (!mediaFolder) {
      return [];
    }

    const orphaned: TFile[] = [];

    // This would require checking which media files are referenced in notes
    // For now, just return empty array
    // A full implementation would:
    // 1. Scan all media files
    // 2. Search all notes for references to those files
    // 3. Identify unreferenced files
    // 4. Delete them (if not dry run)

    return orphaned;
  }

  /**
   * Normalize common image extensions
   */
  private normalizeImageExtension(ext: string): string {
    if (!ext) return 'webp';
    const lower = ext.toLowerCase();
    if (lower === 'jpeg') return 'jpg';
    if (lower === 'pnj') return 'png'; // Tumblr sometimes serves .pnj
    return lower;
  }

  /**
   * Normalize common video extensions
   */
  private normalizeVideoExtension(ext: string): string {
    if (!ext) return 'mp4';
    const lower = ext.toLowerCase();
    if (lower === 'm4v') return 'mp4';
    if (lower === 'mpeg4') return 'mp4';
    const supported = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'wmv']);
    return supported.has(lower) ? lower : 'mp4';
  }

  /**
   * Normalize common audio extensions
   */
  private normalizeAudioExtension(ext: string): string {
    if (!ext) return 'mp3';
    const lower = ext.toLowerCase();
    if (lower === 'oga') return 'ogg';
    const supported = new Set(['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac']);
    return supported.has(lower) ? lower : 'mp3';
  }

  /**
   * Infer extension from MIME type when URL has no extension
   */
  private extensionFromMimeType(mimeType?: string): string | null {
    if (!mimeType) return null;

    const normalized = mimeType.toLowerCase().split(';')[0]?.trim();
    if (!normalized) return null;

    const map: Record<string, string> = {
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/quicktime': 'mov',
      'video/x-msvideo': 'avi',
      'video/x-matroska': 'mkv',
      'video/x-flv': 'flv',
      'video/x-ms-wmv': 'wmv',
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
      'audio/ogg': 'ogg',
      'audio/aac': 'aac',
      'audio/mp4': 'm4a',
      'audio/flac': 'flac',
    };

    return map[normalized] || null;
  }

  /**
   * Detect image format from binary data (magic numbers)
   */
  private detectImageExtension(data: ArrayBuffer): string | null {
    const bytes = new Uint8Array(data);
    if (bytes.length < 12) {
      return null;
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'png';
    }

    // JPEG: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'jpg';
    }

    // WebP: "RIFF" .... "WEBP" at bytes 8-11
    if (
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) {
      return 'webp';
    }

    // HEIC/HEIF/AVIF: "ftyp" + brand
    if (bytes.length >= 12) {
      const brand = String.fromCharCode(bytes[4] ?? 0, bytes[5] ?? 0, bytes[6] ?? 0, bytes[7] ?? 0).toLowerCase();
      if (brand === 'ftyp') {
        const brandName = String.fromCharCode(bytes[8] ?? 0, bytes[9] ?? 0, bytes[10] ?? 0, bytes[11] ?? 0).toLowerCase();
        if (brandName.startsWith('heic') || brandName.startsWith('heif')) {
          return 'heic';
        }
        if (brandName.startsWith('avif')) {
          return 'avif';
        }
      }
    }

    return null;
  }

  /**
   * Detect common video formats from binary data (magic numbers)
   */
  private detectVideoExtension(data: ArrayBuffer): string | null {
    const bytes = new Uint8Array(data);
    if (bytes.length < 12) {
      return null;
    }

    // MP4/MOV: 4 bytes size + "ftyp" + brand
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
      const brand = String.fromCharCode(bytes[8] ?? 0, bytes[9] ?? 0, bytes[10] ?? 0, bytes[11] ?? 0).toLowerCase();
      if (brand.startsWith('qt')) return 'mov';
      return 'mp4';
    }

    // AVI: "RIFF" .... "AVI "
    if (
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x41 && bytes[9] === 0x56 && bytes[10] === 0x49 && bytes[11] === 0x20
    ) {
      return 'avi';
    }

    // FLV: "FLV"
    if (bytes[0] === 0x46 && bytes[1] === 0x4c && bytes[2] === 0x56) {
      return 'flv';
    }

    // ASF/WMV GUID
    const asfGuid = [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c];
    if (bytes.length >= 16 && asfGuid.every((value, idx) => bytes[idx] === value)) {
      return 'wmv';
    }

    // WebM/Matroska: EBML header
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
      const inspectLength = Math.min(bytes.length, 4096);
      const probe = new TextDecoder('latin1').decode(bytes.slice(0, inspectLength)).toLowerCase();
      return probe.includes('webm') ? 'webm' : 'mkv';
    }

    return null;
  }

  // ==========================================================================
  // Naver Video Download Support
  // ==========================================================================

  /**
   * Check if URL is a Naver video API URL
   * Format: https://apis.naver.com/rmcnmv/rmcnmv/vod/play/v2.0/{vid}?key={inkey}
   */
  private isNaverVideoApiUrl(url: string): boolean {
    return url.includes('apis.naver.com/rmcnmv/rmcnmv/vod/play');
  }

  /**
   * Download Naver video by fetching stream URL from API
   */
  private async downloadNaverVideo(
    media: Media,
    postId: string,
    authorUsername: string,
    index: number
  ): Promise<MediaResult> {
    // Fetch video metadata from Naver API
    const videoUrl = await this.fetchNaverVideoStreamUrl(media.url);

    // Download the actual video
    const response = await requestUrl({
      url: videoUrl,
      method: 'GET',
      headers: {
        'Referer': 'https://blog.naver.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (response.status !== 200) {
      throw new Error(`Naver video download failed: HTTP ${response.status}`);
    }

    const data = response.arrayBuffer;

    // Generate path for video file
    const filename = this.pathGenerator.generateFilename(media.url, index, postId, authorUsername, 'mp4');
    const path = this.pathGenerator.generatePath('naver', postId, filename);

    // Check if file already exists
    const existingFile = this.vault.getAbstractFileByPath(path);
    if (existingFile && existingFile instanceof TFile) {
      return {
        originalUrl: media.url,
        localPath: path,
        type: 'video',
        size: data.byteLength,
        file: existingFile,
      };
    }

    // Ensure parent folder exists
    await this.ensureFolderExists(this.getParentPath(path));

    // Save to vault
    const file = await this.vault.createBinary(path, data);

    return {
      originalUrl: media.url,
      localPath: file.path,
      type: 'video',
      size: data.byteLength,
      file,
    };
  }

  /**
   * Fetch actual video stream URL from Naver Video API
   * API returns JSON with multiple quality options
   */
  private async fetchNaverVideoStreamUrl(apiUrl: string): Promise<string> {
    const response = await requestUrl({
      url: apiUrl,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Referer': 'https://blog.naver.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (response.status !== 200) {
      throw new Error(`Naver video API error: HTTP ${response.status}`);
    }

    // Naver Video API response structure:
    // videos.list is an array of quality options, each with:
    // - encodingOption: { name: "1080p", width, height }
    // - source: direct MP4 URL
    const data = response.json as {
      videos?: {
        list?: Array<{
          id?: string;
          encodingOption?: {
            name?: string;
            width?: number;
            height?: number;
          };
          source?: string;
          bitrate?: {
            video?: number;
            audio?: number;
          };
          duration?: number;
        }>;
      };
    };

    // videos.list itself is the quality options array
    const qualityOptions = data?.videos?.list || [];

    if (qualityOptions.length === 0) {
      throw new Error('No video qualities available from Naver API');
    }

    // Sort by height (quality) descending and pick best available
    // Prefer 1080p for best quality
    const qualityPriority = ['1080p', '720p', '480p', '360p', '270p'];

    // First try to find preferred quality by name
    for (const preferredName of qualityPriority) {
      const option = qualityOptions.find(opt => opt.encodingOption?.name === preferredName && opt.source);
      if (option?.source) {
        return option.source;
      }
    }

    // Fall back to highest quality available by height
    const sorted = [...qualityOptions]
      .filter(opt => opt.source)
      .sort((a, b) => (b.encodingOption?.height || 0) - (a.encodingOption?.height || 0));

    const best = sorted[0];
    if (!best?.source) {
      throw new Error('No valid video source found in Naver API response');
    }

    return best.source;
  }
}
