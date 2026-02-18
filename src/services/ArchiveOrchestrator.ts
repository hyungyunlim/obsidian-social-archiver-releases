import type { IService } from './base/IService';
import type { ArchiveService } from './ArchiveService';
import type { MarkdownConverter } from './MarkdownConverter';
import type { VaultManager } from './VaultManager';
import type { MediaHandler, MediaResult } from './MediaHandler';
import type { LinkPreviewExtractor } from './LinkPreviewExtractor';
import type { AuthorAvatarService } from './AuthorAvatarService';
import type { PostData, Platform } from '@/types/post';
import type { ArchiveOptions, ArchiveResult, ArchiveProgress } from '@/types/archive';
import type { SocialArchiverSettings } from '@/types/settings';
import type { TFile } from 'obsidian';
import { uniqueStrings } from '@/utils/array';
import { normalizeUrlForDedup } from '@/utils/url';
import { ProfileDataMapper } from './mappers/ProfileDataMapper';

/**
 * Orchestrator configuration
 */
export interface OrchestratorConfig {
  archiveService: ArchiveService;
  markdownConverter: MarkdownConverter;
  vaultManager: VaultManager;
  mediaHandler: MediaHandler;
  linkPreviewExtractor: LinkPreviewExtractor;
  authorAvatarService?: AuthorAvatarService;
  settings?: SocialArchiverSettings;
  enableCache?: boolean;
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * Extended orchestrator options
 */
export interface OrchestratorOptions extends ArchiveOptions {
  customTemplate?: string;
  organizationStrategy?: 'platform' | 'platform-only' | 'date' | 'flat';
  abortSignal?: AbortSignal;
}

/**
 * Orchestrator events
 */
export type OrchestratorEvent =
  | { type: 'progress'; data: ArchiveProgress }
  | { type: 'stage-complete'; data: { stage: ArchiveProgress['stage'] } }
  | { type: 'error'; data: Error }
  | { type: 'cancelled'; data: undefined };

/**
 * Event listener type
 */
export type EventListener = (event: OrchestratorEvent) => void;

/**
 * Simple EventEmitter implementation
 */
class EventEmitter {
  private listeners: Map<string, Set<EventListener>> = new Map();

  on(eventType: string, listener: EventListener): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    const set = this.listeners.get(eventType);
    if (set) set.add(listener);
  }

  off(eventType: string, listener: EventListener): void {
    const listeners = this.listeners.get(eventType);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  emit(event: OrchestratorEvent): void {
    const listeners = this.listeners.get(event.type);
    if (listeners) {
      listeners.forEach(listener => listener(event));
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}

/**
 * Cache entry
 */
interface CacheEntry {
  postData: PostData;
  timestamp: Date;
  filePath: string;
}

/**
 * Transaction state for rollback
 */
interface TransactionState {
  createdFiles: TFile[];
  createdMediaFiles: TFile[];
}

/**
 * Retry utility
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- utility class with only static methods; instantiation not needed
class RetryHelper {
  /**
   * Execute function with retry logic
   */
  static async withRetry<T>(
    fn: () => Promise<T>,
    options: {
      maxRetries: number;
      retryDelay: number;
      onRetry?: (attempt: number, error: Error) => void;
    }
  ): Promise<T> {
    let lastError: Error = new Error("No attempts made");

    for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on last attempt
        if (attempt === options.maxRetries) {
          break;
        }

        // Check if error is retryable
        if (!this.isRetryable(lastError)) {
          throw lastError;
        }

        // Notify retry attempt
        options.onRetry?.(attempt + 1, lastError);

        // Wait before retry with exponential backoff
        const delay = options.retryDelay * Math.pow(2, attempt);
        await this.sleep(delay);
      }
    }

    // lastError is always assigned because maxRetries >= 0, so at least one attempt runs
    throw lastError ?? new Error('No attempts made');
  }

  /**
   * Check if error is retryable
   */
  private static isRetryable(error: Error): boolean {
    const retryableErrors = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'Network',
      'timeout',
      'rate limit',
    ];

    const message = error.message.toLowerCase();
    return retryableErrors.some(pattern =>
      message.includes(pattern.toLowerCase())
    );
  }

  /**
   * Sleep utility
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * ArchiveOrchestrator - Main coordinator for archive workflow
 *
 * Single Responsibility: Workflow orchestration and coordination
 */
export class ArchiveOrchestrator implements IService {
  private archiveService: ArchiveService;
  private markdownConverter: MarkdownConverter;
  private vaultManager: VaultManager;
  private mediaHandler: MediaHandler;
  private linkPreviewExtractor: LinkPreviewExtractor;
  private authorAvatarService?: AuthorAvatarService;
  private settings?: SocialArchiverSettings;
  private eventEmitter: EventEmitter;
  private cache: Map<string, CacheEntry>;
  private enableCache: boolean;
  private maxRetries: number;
  private retryDelay: number;

  // Cache for author avatars to prevent duplicate downloads in batch operations
  private avatarCache: Map<string, string | null> = new Map();

  constructor(config: OrchestratorConfig) {
    this.archiveService = config.archiveService;
    this.markdownConverter = config.markdownConverter;
    this.vaultManager = config.vaultManager;
    this.mediaHandler = config.mediaHandler;
    this.linkPreviewExtractor = config.linkPreviewExtractor;
    this.authorAvatarService = config.authorAvatarService;
    this.settings = config.settings;
    this.eventEmitter = new EventEmitter();
    this.cache = new Map();
    this.enableCache = config.enableCache ?? true;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelay = config.retryDelay ?? 1000;

    if (this.settings?.frontmatter) {
      this.markdownConverter.setFrontmatterSettings(this.settings.frontmatter);
    }
  }

  async initialize(): Promise<void> {
    // Initialize all services
    await Promise.all([
      Promise.resolve(this.archiveService.initialize?.()),
      Promise.resolve(this.markdownConverter.initialize?.()),
      Promise.resolve(this.vaultManager.initialize?.()),
      Promise.resolve(this.mediaHandler.initialize?.()),
      Promise.resolve(this.linkPreviewExtractor.initialize?.()),
    ]);
  }

  async dispose(): Promise<void> {
    // Clean up all services
    await Promise.all([
      Promise.resolve(this.archiveService.dispose?.()),
      Promise.resolve(this.markdownConverter.dispose?.()),
      Promise.resolve(this.vaultManager.dispose?.()),
      Promise.resolve(this.mediaHandler.dispose?.()),
      Promise.resolve(this.linkPreviewExtractor.dispose?.()),
    ]);

    // Clear cache and listeners
    this.cache.clear();
    this.eventEmitter.removeAllListeners();
  }

  async isHealthy(): Promise<boolean> {
    // Check all services are healthy
    const healthChecks = await Promise.all([
      Promise.resolve(this.archiveService.isHealthy?.() ?? true),
      Promise.resolve(this.markdownConverter.isHealthy?.() ?? true),
      Promise.resolve(this.vaultManager.isHealthy?.() ?? true),
      Promise.resolve(this.mediaHandler.isHealthy?.() ?? true),
      Promise.resolve(this.linkPreviewExtractor.isHealthy?.() ?? true),
    ]);

    return healthChecks.every((healthy: boolean) => healthy);
  }

  /**
   * Register event listener
   */
  on(eventType: string, listener: EventListener): void {
    this.eventEmitter.on(eventType, listener);
  }

  /**
   * Unregister event listener
   */
  off(eventType: string, listener: EventListener): void {
    this.eventEmitter.off(eventType, listener);
  }

  /**
   * Main orchestration method
   */
  async orchestrate(
    url: string,
    options: OrchestratorOptions = {
      enableAI: false,
      downloadMedia: true,
      removeTracking: true,
      generateShareLink: false,
      deepResearch: false,
    }
  ): Promise<ArchiveResult> {
    // Track processing time
    const startTime = Date.now();

    const transaction: TransactionState = {
      createdFiles: [],
      createdMediaFiles: [],
    };

    try {
      // Check cancellation
      this.checkCancellation(options.abortSignal);

      // Check cache
      if (this.enableCache) {
        const cached = this.checkCache(url);
        if (cached) {
          return {
            success: true,
            filePath: cached.filePath,
            creditsUsed: 0, // Cached result
          };
        }
      }

      // Stage 1: Validate URL
      this.emitProgress('fetching', 0, 'Validating URL...');
      this.validateUrl(url);

      // Stage 2: Detect platform
      this.emitProgress('fetching', 5, 'Detecting platform...');
      const platform = this.archiveService.detectPlatform(url);

      // Stage 3: Fetch post data with retry
      this.emitProgress('fetching', 10, 'Fetching post data...');
      const postData = await RetryHelper.withRetry(
        () => this.archiveService.archivePost(url, options, (progress) => {
          // Map archive progress (0-100) to fetching stage (10-50)
          const mappedProgress = 10 + (progress * 0.4);
          this.emitProgress('fetching', Math.round(mappedProgress), 'Fetching post data...');
        }),
        {
          maxRetries: this.maxRetries,
          retryDelay: this.retryDelay,
          onRetry: (attempt, error) => {
            this.emitProgress(
              'fetching',
              10,
              `Retry attempt ${attempt}/${this.maxRetries}: ${error.message}`
            );
          },
        }
      );

      this.checkCancellation(options.abortSignal);
      this.emitStageComplete('fetching');

      // Stage 3.5: Extract and apply author profile metadata
      await this.enrichAuthorMetadata(postData, platform);

      // Stage 3.6: Extract link previews from content
      if (postData.content?.text) {
        try {
          const extractedLinks = this.linkPreviewExtractor.extractUrls(
            postData.content.text,
            platform
          );
          const linkPreviews = uniqueStrings(
            extractedLinks.map(link => link.url),
            normalizeUrlForDedup
          );
          if (linkPreviews.length > 0) {
            postData.linkPreviews = linkPreviews;
          }
        } catch (error) {
          // Link preview extraction is non-critical, log error but continue
          console.warn('[ArchiveOrchestrator] Failed to extract link previews:', error);
        }
      }

      // Stage 4: Download media (if enabled)
      // Note: YouTube videos use original URL embed, no download needed
      let mediaResults: MediaResult[] = [];

      // Collect all media to download (main post + quoted post + embedded archives)
      const allMediaToDownload: Array<{ media: typeof postData.media[0]; archiveIndex?: number; mediaIndex: number; isQuotedPost?: boolean; isExternalLinkImage?: boolean }> = [];

      // Main post media
      if (postData.media.length > 0 && platform !== 'youtube') {
        postData.media.forEach((media, index) => {
          allMediaToDownload.push({ media, mediaIndex: index });
        });
      }

      // Quoted/Shared post media (for Facebook shared posts, X quoted tweets, etc.)
      if (postData.quotedPost && postData.quotedPost.media) {
        postData.quotedPost.media.forEach((media, mediaIndex) => {
          // Skip YouTube embeds (they use iframe, no download needed)
          if (postData.quotedPost?.platform === 'youtube' || postData.quotedPost?.platform === 'tiktok') {
            return;
          }

          allMediaToDownload.push({ media, mediaIndex, isQuotedPost: true });
        });
      }

      // Quoted post external link preview image (for Facebook shared posts with link attachments)
      if (postData.quotedPost?.metadata.externalLinkImage) {
        allMediaToDownload.push({
          media: { type: 'image', url: postData.quotedPost.metadata.externalLinkImage },
          mediaIndex: -1, // Special index for external link image
          isQuotedPost: true,
          isExternalLinkImage: true,
        });
      }

      // Embedded archives media (for User Posts with embedded Instagram/etc posts)
      if (postData.embeddedArchives) {
        postData.embeddedArchives.forEach((archive, archiveIndex) => {
          // Skip YouTube embeds (they use iframe, no download needed)
          if (archive.platform === 'youtube' || archive.platform === 'tiktok') {
            return;
          }

          archive.media.forEach((media, mediaIndex) => {
            allMediaToDownload.push({ media, archiveIndex, mediaIndex });
          });
        });
      }

      if (options.downloadMedia && allMediaToDownload.length > 0) {
        this.emitProgress('downloading', 50, 'Downloading media files...');

        // Extract author username (prefer username, fallback to handle without @, or name)
        const authorUsername = postData.author.username
          || (postData.author.handle ? postData.author.handle.replace('@', '') : null)
          || postData.author.name;

        // Download all media
        const mediaItems = allMediaToDownload.map(item => item.media);
        mediaResults = await RetryHelper.withRetry(
          () => this.mediaHandler.downloadMedia(
            mediaItems,
            platform,
            postData.id,
            authorUsername,
            (downloaded, total) => {
              const progress = 50 + ((downloaded / total) * 20);
              this.emitProgress(
                'downloading',
                Math.round(progress),
                `Downloading media ${downloaded}/${total}...`
              );
            }
          ),
          {
            maxRetries: this.maxRetries,
            retryDelay: this.retryDelay,
            onRetry: (attempt, error) => {
              this.emitProgress(
                'downloading',
                50,
                `Retry media download ${attempt}/${this.maxRetries}: ${error.message}`
              );
            },
          }
        );

        // Update media URLs in PostData (main post + quoted post + embedded archives)
        mediaResults.forEach((result, index) => {
          const sourceItem = allMediaToDownload[index];
          if (!sourceItem) return;

          if (sourceItem.isQuotedPost) {
            if (sourceItem.isExternalLinkImage) {
              // Update quoted post external link image URL
              if (postData.quotedPost) {
                postData.quotedPost.metadata.externalLinkImage = result.localPath;
              }
            } else {
              // Update quoted post media URL
              if (postData.quotedPost && postData.quotedPost.media[sourceItem.mediaIndex]) {
                const quotedMedia = postData.quotedPost.media[sourceItem.mediaIndex];
                if (quotedMedia) quotedMedia.url = result.localPath;
              }
            }
          } else if (sourceItem.archiveIndex !== undefined) {
            // Update embedded archive media URL
            const archive = postData.embeddedArchives?.[sourceItem.archiveIndex];
            if (archive && archive.media[sourceItem.mediaIndex]) {
              const archiveMedia = archive.media[sourceItem.mediaIndex];
              if (archiveMedia) archiveMedia.url = result.localPath;
            }
          } else {
            // Update main post media URL
            const mainMedia = postData.media[sourceItem.mediaIndex];
            if (mainMedia) mainMedia.url = result.localPath;
          }
        });

        transaction.createdMediaFiles = mediaResults.map(r => r.file);
        this.checkCancellation(options.abortSignal);
        this.emitStageComplete('downloading');
      } else {
        this.emitProgress('downloading', 70, 'Skipping media download...');
      }

      // Stage 5: Convert to markdown
      this.emitProgress('processing', 70, 'Converting to markdown...');
      let markdown = this.markdownConverter.convert(
        postData,
        options.customTemplate,
        mediaResults.length > 0 ? mediaResults : undefined,
        undefined
      );

      // Update frontmatter with processing time
      // Convert to seconds and round to 1 decimal place
      markdown.frontmatter.download_time = Math.round((Date.now() - startTime) / 100) / 10;

      // Regenerate fullDocument with updated frontmatter
      markdown = this.markdownConverter.updateFullDocument(markdown);

      this.checkCancellation(options.abortSignal);
      this.emitStageComplete('processing');

      // Stage 6: Save to vault
      this.emitProgress('saving', 80, 'Saving to vault...');
      const filePath = await this.vaultManager.savePost(postData, markdown);
      const file = this.vaultManager.getFileByPath(filePath);

      if (!file) {
        throw new Error('Failed to retrieve saved file');
      }

      transaction.createdFiles.push(file);
      this.checkCancellation(options.abortSignal);
      this.emitStageComplete('saving');

      // Stage 7: Generate share link (if enabled)
      let shareUrl: string | undefined;
      if (options.generateShareLink) {
        this.emitProgress('saving', 90, 'Generating share link...');
        // TODO: Implement share link generation
        // This would call a share service to upload and get URL
      }

      // Stage 8: Cache result
      if (this.enableCache) {
        this.cacheResult(url, postData, filePath);
      }

      // Complete
      this.emitProgress('complete', 100, 'Archive complete!');
      this.emitStageComplete('complete');

      return {
        success: true,
        filePath,
        shareUrl,
        creditsUsed: this.calculateCreditsUsed(options),
      };

    } catch (error) {
      // Emit error event
      const err = error instanceof Error ? error : new Error(String(error));
      this.eventEmitter.emit({ type: 'error', data: err });

      // Check if cancelled
      if (this.isCancellationError(error)) {
        this.eventEmitter.emit({ type: 'cancelled', data: undefined });
        await this.rollback(transaction);

        return {
          success: false,
          error: 'Archive cancelled by user',
          creditsUsed: 0,
        };
      }

      // Rollback transaction
      await this.rollback(transaction);

      return {
        success: false,
        error: err.message,
        creditsUsed: 0,
      };
    }
  }

  /**
   * Validate URL
   */
  private validateUrl(url: string): void {
    if (!this.archiveService.validateUrl(url)) {
      throw new Error('Invalid URL format');
    }
  }

  /**
   * Check cache for existing result
   */
  private checkCache(url: string): CacheEntry | null {
    const cached = this.cache.get(url);
    if (!cached) {
      return null;
    }

    // Check if cache is still valid (e.g., within 1 hour)
    const cacheAge = Date.now() - cached.timestamp.getTime();
    const maxAge = 60 * 60 * 1000; // 1 hour

    if (cacheAge > maxAge) {
      this.cache.delete(url);
      return null;
    }

    return cached;
  }

  /**
   * Cache result
   */
  private cacheResult(url: string, postData: PostData, filePath: string): void {
    this.cache.set(url, {
      postData,
      filePath,
      timestamp: new Date(),
    });
  }

  /**
   * Calculate credits used based on options
   */
  private calculateCreditsUsed(options: OrchestratorOptions): number {
    if (options.deepResearch) {
      return 5;
    }
    if (options.enableAI) {
      return 3;
    }
    return 1;
  }

  /**
   * Emit progress event
   */
  private emitProgress(
    stage: ArchiveProgress['stage'],
    progress: number,
    message: string
  ): void {
    this.eventEmitter.emit({
      type: 'progress',
      data: { stage, progress, message },
    });
  }

  /**
   * Emit stage complete event
   */
  private emitStageComplete(stage: ArchiveProgress['stage']): void {
    this.eventEmitter.emit({
      type: 'stage-complete',
      data: { stage },
    });
  }

  /**
   * Check if operation is cancelled
   */
  private checkCancellation(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new Error('Operation cancelled');
    }
  }

  /**
   * Check if error is cancellation error
   */
  private isCancellationError(error: unknown): boolean {
    if (error instanceof Error) {
      return error.message.includes('cancelled') || error.message.includes('abort');
    }
    return false;
  }

  /**
   * Rollback transaction - delete created files
   */
  private async rollback(transaction: TransactionState): Promise<void> {
    try {
      // Delete created media files
      await Promise.all(
        transaction.createdMediaFiles.map(file =>
          this.mediaHandler.deleteMedia(file).catch(_err => {
          })
        )
      );

      // Delete created note files
      await Promise.all(
        transaction.createdFiles.map(file =>
          this.vaultManager.deleteFile(file).catch(_err => {
          })
        )
      );
    } catch (error) {
      // Don't throw - rollback should be best-effort
    }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    urls: string[];
    oldestEntry?: Date;
    newestEntry?: Date;
  } {
    const entries = Array.from(this.cache.entries());

    return {
      size: entries.length,
      urls: entries.map(([url]) => url),
      oldestEntry: entries.length > 0
        ? new Date(entries.reduce((oldest, [, entry]) =>
            entry.timestamp < oldest ? entry.timestamp : oldest,
            (entries[0]?.[1].timestamp) ?? 0
          ))
        : undefined,
      newestEntry: entries.length > 0
        ? new Date(entries.reduce((newest, [, entry]) =>
            entry.timestamp > newest ? entry.timestamp : newest,
            (entries[0]?.[1].timestamp) ?? 0
          ))
        : undefined,
    };
  }

  /**
   * Fetch post data without saving to vault
   *
   * Used for inline archiving in PostComposer - fetches post data from API
   * but does NOT download media or create vault files. Returns only PostData
   * object for embedding in user posts.
   *
   * Differences from orchestrate():
   * - NO media download
   * - NO vault file creation
   * - NO markdown conversion
   * - Returns PostData directly
   * - Still consumes credits
   * - Still validates URL and detects platform
   *
   * @param url - Social media post URL to fetch
   * @param options - Archive options (AI, research, etc.)
   * @returns Promise<PostData> - Archived post data
   * @throws Error if URL is invalid, rate limited, or fetch fails
   */
  async fetchPostData(
    url: string,
    options: Pick<ArchiveOptions, 'enableAI' | 'deepResearch'> = {
      enableAI: false,
      deepResearch: false,
    }
  ): Promise<PostData> {
    try {
      // Stage 1: Validate URL
      this.validateUrl(url);

      // Stage 2: Detect platform
      const platform = this.archiveService.detectPlatform(url);

      // Stage 3: Fetch post data with retry (no progress callback for inline archiving)
      const postData = await RetryHelper.withRetry(
        () => this.archiveService.archivePost(url, {
          enableAI: options.enableAI,
          deepResearch: options.deepResearch,
          downloadMedia: true, // Enable media download for embedded archives
          removeTracking: true,
          generateShareLink: false,
        }),
        {
          maxRetries: this.maxRetries,
          retryDelay: this.retryDelay,
        }
      );

      // Stage 4: Enrich author metadata
      await this.enrichAuthorMetadata(postData, platform);

      // Stage 5: Extract link previews from content
      if (postData.content?.text) {
        try {
          const extractedLinks = this.linkPreviewExtractor.extractUrls(
            postData.content.text,
            platform
          );
          const linkPreviews = uniqueStrings(
            extractedLinks.map(link => link.url),
            normalizeUrlForDedup
          );
          if (linkPreviews.length > 0) {
            postData.linkPreviews = linkPreviews;
          }
        } catch (error) {
          // Link preview extraction is non-critical, log error but continue
        }
      }

      return postData;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw err;
    }
  }

  /**
   * Enrich author metadata from raw API response
   *
   * Uses ProfileDataMapper to extract normalized profile data and
   * AuthorAvatarService to download and store avatars locally.
   *
   * @param postData - PostData to enrich with author metadata
   * @param platform - Platform for profile data mapping
   */
  private async enrichAuthorMetadata(
    postData: PostData,
    platform: Platform
  ): Promise<void> {
    // Skip if both features are disabled
    const downloadAvatars = this.settings?.downloadAuthorAvatars ?? true;
    const updateMetadata = this.settings?.updateAuthorMetadata ?? true;

    if (!downloadAvatars && !updateMetadata) {
      return;
    }

    try {
      // Extract profile data using ProfileDataMapper
      // Use postData.raw (original BrightData response) for accurate field mapping
      // Fall back to postData for platforms that don't include raw data
      const rawData = postData.raw ?? postData;
      const profileData = ProfileDataMapper.mapPlatformData(platform, rawData);

      // Update author metadata if enabled
      if (updateMetadata) {
        // Only update fields that have values from the mapper
        if (profileData.avatarUrl !== null) {
          postData.author.avatar = profileData.avatarUrl;
        }
        if (profileData.followers !== null) {
          postData.author.followers = profileData.followers;
        }
        if (profileData.postsCount !== null) {
          postData.author.postsCount = profileData.postsCount;
        }
        if (profileData.bio !== null) {
          postData.author.bio = profileData.bio;
        }
        if (profileData.verified) {
          postData.author.verified = profileData.verified;
        }
        postData.author.lastMetadataUpdate = new Date();
      }

      // Download avatar if enabled and avatar URL exists
      if (downloadAvatars && profileData.avatarUrl && this.authorAvatarService) {
        const avatarUrl = profileData.avatarUrl;
        const username = this.extractUsernameForAvatar(postData);
        const cacheKey = `${platform}-${username}`;

        // Check cache first (for batch operations)
        if (this.avatarCache.has(cacheKey)) {
          const cachedPath = this.avatarCache.get(cacheKey);
          if (cachedPath) {
            postData.author.localAvatar = cachedPath;
          }
        } else {
          // Download avatar
          const overwrite = this.settings?.overwriteAuthorAvatar ?? false;
          const localPath = await this.authorAvatarService.downloadAndSaveAvatar(
            avatarUrl,
            platform,
            username,
            overwrite
          );

          // Cache the result
          this.avatarCache.set(cacheKey, localPath);

          if (localPath) {
            postData.author.localAvatar = localPath;
          }
        }
      }
    } catch (error) {
      // Author metadata enrichment is non-critical, log error but continue
      console.warn('[ArchiveOrchestrator] Failed to enrich author metadata:', error);
    }
  }

  /**
   * Extract username for avatar filename
   *
   * Prefers username > handle (without @) > name
   */
  private extractUsernameForAvatar(postData: PostData): string {
    if (postData.author.username) {
      return postData.author.username;
    }
    if (postData.author.handle) {
      return postData.author.handle.replace(/^@/, '');
    }
    return postData.author.name;
  }

  /**
   * Clear avatar cache
   *
   * Should be called after batch operations complete
   */
  clearAvatarCache(): void {
    this.avatarCache.clear();
  }

  /**
   * Update settings reference
   *
   * Call this when settings change at runtime
   */
  updateSettings(settings: SocialArchiverSettings): void {
    this.settings = settings;
    this.markdownConverter.setFrontmatterSettings(settings.frontmatter);
  }
}
