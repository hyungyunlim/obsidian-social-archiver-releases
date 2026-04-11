import { Notice, TFile, requestUrl } from 'obsidian';
import type { App } from 'obsidian';
import { VaultManager } from '../../services/VaultManager';
import { MarkdownConverter } from '../../services/MarkdownConverter';
import type { PostData, Platform, Media } from '../../types/post';
import type { PendingJob } from '../../services/PendingJobsManager';
import type { PendingJobsManager } from '../../services/PendingJobsManager';
import type { ArchiveJobTracker } from '../../services/ArchiveJobTracker';
import type { WorkersAPIClient } from '../../services/WorkersAPIClient';
import type { AuthorAvatarService } from '../../services/AuthorAvatarService';
import type { TagStore } from '../../services/TagStore';
import type { SocialArchiverSettings } from '../../types/settings';
import { getVaultOrganizationStrategy } from '../../types/settings';
import { uniqueStrings } from '../../utils/array';
import { normalizeUrlForDedup } from '../../utils/url';
import { sanitizeTagNames, mergeTagsCaseInsensitive } from '../../utils/tags';
import { ProfileDataMapper } from '../../services/mappers/ProfileDataMapper';
import { getAuthorCatalogStore, type AuthorMetadataUpdate } from '../../services/AuthorCatalogStore';
import type { AuthorNoteService } from '../../services/AuthorNoteService';
import { normalizeAuthorName, normalizeAuthorUrl } from '../../services/AuthorDeduplicator';
import { MediaPathResolver, type VideoDownloadFailure } from '../media/MediaPathResolver';
import { ensureFolderExists } from '../utils/ensureFolderExists';
import type { CompletedJobResponse } from '../realtime/RealtimeEventBridge';

// Re-export for convenience
export type { CompletedJobResponse };

// ─── Deps ────────────────────────────────────────────────────────────

export interface ArchiveCompletionServiceDeps {
  app: App;
  settings: () => SocialArchiverSettings;
  pendingJobsManager: PendingJobsManager;
  archiveJobTracker: ArchiveJobTracker;
  apiClient: () => WorkersAPIClient | undefined;
  authorAvatarService: () => AuthorAvatarService | undefined;
  authorNoteService: () => AuthorNoteService | undefined;
  tagStore: TagStore;
  refreshTimelineView: () => void;
  refreshCredits: () => Promise<void>;
}

// ─── ArchiveCompletionService ────────────────────────────────────────

export class ArchiveCompletionService {
  private readonly deps: ArchiveCompletionServiceDeps;
  private readonly mediaPathResolver: MediaPathResolver;

  constructor(deps: ArchiveCompletionServiceDeps) {
    this.deps = deps;
    this.mediaPathResolver = new MediaPathResolver({ app: deps.app });
  }

  // ─── Accessors ──────────────────────────────────────────────────

  private get app(): App {
    return this.deps.app;
  }

  private get settings(): SocialArchiverSettings {
    return this.deps.settings();
  }

  private get pendingJobsManager(): PendingJobsManager {
    return this.deps.pendingJobsManager;
  }

  private get archiveJobTracker(): ArchiveJobTracker {
    return this.deps.archiveJobTracker;
  }

  private get apiClient(): WorkersAPIClient | undefined {
    return this.deps.apiClient();
  }

  private get authorAvatarService(): AuthorAvatarService | undefined {
    return this.deps.authorAvatarService();
  }

  private get authorNoteService(): AuthorNoteService | undefined {
    return this.deps.authorNoteService();
  }

  private get tagStore(): TagStore {
    return this.deps.tagStore;
  }

  // ─── processCompletedJob ──────────────────────────────────────────

  /**
   * Process completed archive job
   * Converts PostData to markdown and saves to vault
   */
  async processCompletedJob(
    pendingJob: PendingJob,
    jobStatusResponse: CompletedJobResponse
  ): Promise<void> {
    try {
      const result = jobStatusResponse.result;
      const metadata = jobStatusResponse.metadata;

      // ========== Profile Crawl Branch ==========
      // Profile crawl jobs are processed via WebSocket in real-time.
      // Polling only serves as cleanup - remove the pending job without re-processing.
      if (result?.type === 'profile-crawl' || metadata?.type === 'profile-crawl') {
        // Remove the pending job - WebSocket already processed the posts
        await this.pendingJobsManager.removeJob(pendingJob.id);
        return;
      }

      // ========== Standard Post Archive Branch ==========
      if (!result || !result.postData) {
        throw new Error('No postData in completed job result');
      }

      const postData = result.postData as PostData;

      // ========== Embedded Archive Mode ==========
      if (pendingJob.metadata?.embeddedArchive === true) {
        await this.processEmbeddedArchive(pendingJob, postData);
        return; // Early return for embedded archive
      }

      // ========== Normal Archive Mode (existing logic) ==========
      await this.processNormalArchive(pendingJob, postData);

    } catch (error) {
      console.error(`[Social Archiver] Error processing completed job ${pendingJob.id}:`, error);
      // Mark as failed so it can be retried or removed
      await this.processFailedJob(pendingJob, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  // ─── processFailedJob ────────────────────────────────────────────

  /**
   * Process failed archive job
   * Implements retry logic with exponential backoff
   */
  async processFailedJob(
    pendingJob: PendingJob,
    errorMessage: string
  ): Promise<void> {
    try {
      // Check if job still exists (might have been processed by WebSocket)
      const currentJob = await this.pendingJobsManager.getJob(pendingJob.id);
      if (!currentJob) {
        console.debug(`[Social Archiver] Job ${pendingJob.id} already processed, skipping failure handling`);
        return;
      }

      const MAX_RETRIES = 3;
      const currentRetryCount = currentJob.retryCount || 0;

      if (currentRetryCount < MAX_RETRIES) {
        // Retry the job
        const metadata = {
          ...currentJob.metadata,
          lastError: errorMessage
        };

        if (Object.prototype.hasOwnProperty.call(metadata, 'statusUnavailableSince')) {
          delete (metadata as { statusUnavailableSince?: number }).statusUnavailableSince;
        }
        if (Object.prototype.hasOwnProperty.call(metadata, 'missingStatusCount')) {
          delete (metadata as { missingStatusCount?: number }).missingStatusCount;
        }

        await this.pendingJobsManager.updateJob(currentJob.id, {
          status: 'pending',
          retryCount: currentRetryCount + 1,
          metadata
        });

        // Update archive banner
        this.archiveJobTracker.markRetrying(currentJob.id, currentRetryCount + 1);

        // Show notice for retry
        new Notice(`\u26A0\uFE0F Archive failed, retrying... (${currentRetryCount + 1}/${MAX_RETRIES})`, 4000);

      } else {
        // Max retries exceeded - update archive banner
        this.archiveJobTracker.failJob(currentJob.id, errorMessage);

        // Remove job
        await this.pendingJobsManager.removeJob(currentJob.id);

        console.error(`[Social Archiver] Job ${currentJob.id} failed after ${MAX_RETRIES} retries: ${errorMessage}`);

        // Show failure notice
        new Notice(`\u274C Archive failed after ${MAX_RETRIES} retries: ${errorMessage.substring(0, 50)}...`, 8000);
      }

    } catch (error) {
      console.error(`[Social Archiver] Error processing failed job ${pendingJob.id}:`, error);
    }
  }

  // ─── enrichAuthorMetadata ────────────────────────────────────────

  /**
   * Enrich post data with author metadata (avatar, followers, bio, etc.)
   * Uses ProfileDataMapper for platform-specific field extraction
   * and AuthorAvatarService for local avatar storage
   *
   * @param postData - The post data to enrich (will be mutated)
   * @param platform - The platform the post is from
   */
  async enrichAuthorMetadata(postData: PostData, platform: Platform): Promise<void> {
    // Skip if settings disable metadata updates
    if (!this.settings.downloadAuthorAvatars && !this.settings.updateAuthorMetadata) {
      return;
    }

    try {
      // Extract profile data from raw API response using ProfileDataMapper
      const rawResponse = postData.raw;

      // If no raw response, still try avatar download and subreddit registration
      // (Direct API posts like Instagram Direct have no raw data but have parsed author info)
      if (!rawResponse) {
        // For Reddit subscription posts, register subreddit even without raw data
        if (platform === 'reddit' && postData.content.community?.url && this.settings.updateAuthorMetadata) {
          try {
            const catalogStore = getAuthorCatalogStore();
            const subredditUpdate: AuthorMetadataUpdate = {
              authorName: `r/${postData.content.community.name}`,
              avatarUrl: null,
              handle: `r/${postData.content.community.name}`,
              followers: null,
              postsCount: null,
              bio: null,
              verified: false,
            };
            catalogStore.updateAuthorMetadata(
              postData.content.community.url,
              platform,
              subredditUpdate,
              null
            );
          } catch (e) {
            console.warn('[Social Archiver] Failed to register subreddit:', e);
          }
        }

        // Still attempt avatar download from existing author.avatar URL
        // (Direct API posts have avatar URLs but no raw response for ProfileDataMapper)
        if (this.settings.downloadAuthorAvatars && this.authorAvatarService && postData.author.avatar) {
          try {
            const username = this.extractUsernameForAvatar(postData.author, platform);
            const localAvatarPath = await this.authorAvatarService.downloadAndSaveAvatar(
              postData.author.avatar,
              platform,
              username,
              this.settings.overwriteAuthorAvatar
            );
            if (localAvatarPath) {
              postData.author.localAvatar = localAvatarPath;
            }
          } catch (e) {
            console.warn('[Social Archiver] Failed to download avatar without raw data:', e);
          }
        }
        return;
      }

      const profileData = ProfileDataMapper.mapPlatformData(platform, rawResponse);

      // Update author metadata if enabled
      if (this.settings.updateAuthorMetadata) {
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

      // Download and save avatar locally if enabled
      let localAvatarPath: string | null = null;
      if (this.settings.downloadAuthorAvatars && this.authorAvatarService) {
        const avatarUrl = profileData.avatarUrl || postData.author.avatar;
        if (avatarUrl) {
          // Extract username for avatar filename
          const username = this.extractUsernameForAvatar(postData.author, platform);

          localAvatarPath = await this.authorAvatarService.downloadAndSaveAvatar(
            avatarUrl,
            platform,
            username,
            this.settings.overwriteAuthorAvatar
          );

          if (localAvatarPath) {
            postData.author.localAvatar = localAvatarPath;
          }
        }
      }

      if (postData.author.bio && this.apiClient) {
        const normalizedKey = (() => {
          if (postData.author.url) {
            const normalized = normalizeAuthorUrl(postData.author.url, platform);
            if (normalized.url) {
              return `${platform}:url:${normalized.url}`;
            }
          }
          return `${platform}:name:${normalizeAuthorName(postData.author.name || 'unknown')}`;
        })();

        void this.apiClient.upsertUserAuthorProfilesSystem(
          [{
            authorKey: normalizedKey,
            platform,
            authorName: postData.author.name || 'Unknown',
            authorUrl: postData.author.url || null,
            authorHandle: postData.author.handle || null,
            fetchedBio: postData.author.bio,
            fetchedBioSource: 'plugin_local',
            fetchedBioUpdatedAt: new Date().toISOString(),
          }],
          this.settings.syncClientId || '',
        ).catch((error) => {
          console.warn('[Social Archiver] Failed to sync fetched author bio:', error);
        });
      }

      // Update AuthorCatalogStore if metadata updates are enabled
      if (this.settings.updateAuthorMetadata && postData.author.url) {
        try {
          const catalogStore = getAuthorCatalogStore();
          const metadataUpdate: AuthorMetadataUpdate = {
            authorName: postData.author.name,
            avatarUrl: profileData.avatarUrl || postData.author.avatar,
            handle: postData.author.handle || null,
            followers: profileData.followers,
            postsCount: profileData.postsCount,
            bio: profileData.bio,
            verified: profileData.verified,
          };
          catalogStore.updateAuthorMetadata(
            postData.author.url,
            platform,
            metadataUpdate,
            localAvatarPath
          );

          // For Reddit posts, also register the subreddit as a separate author entry
          // This allows users to subscribe to subreddits from the Author Catalog
          if (platform === 'reddit' && postData.content.community?.url) {
            const subredditUpdate: AuthorMetadataUpdate = {
              authorName: `r/${postData.content.community.name}`,
              avatarUrl: null, // Subreddits don't have avatars
              handle: `r/${postData.content.community.name}`,
              followers: null,
              postsCount: null,
              bio: null,
              verified: false,
            };
            catalogStore.updateAuthorMetadata(
              postData.content.community.url,
              platform,
              subredditUpdate,
              null
            );
          }
        } catch (catalogError) {
          // AuthorCatalog update is non-critical, log and continue
          console.warn('[Social Archiver] Failed to update AuthorCatalogStore:', catalogError);
        }
      }
    } catch (error) {
      // Non-critical error - log and continue
      console.warn('[Social Archiver] Failed to enrich author metadata:', error);
    }
  }

  // ─── Private: Embedded Archive Mode ──────────────────────────────

  private async processEmbeddedArchive(
    pendingJob: PendingJob,
    postData: PostData
  ): Promise<void> {
    const parentFilePath = pendingJob.metadata?.parentFilePath;

    if (!parentFilePath) {
      throw new Error('Parent file path not found');
    }

    // Read parent file
    const parentFile = this.app.vault.getAbstractFileByPath(parentFilePath);
    if (!parentFile || !(parentFile instanceof TFile)) {
      throw new Error(`Parent file not found: ${parentFilePath}`);
    }

    // ========== STEP 2: Parse Current Post ==========
    const { PostDataParser } = await import('../../components/timeline/parsers/PostDataParser');
    const parser = new PostDataParser(this.app.vault, this.app);
    const currentPost = await parser.parseFile(parentFile);

    if (!currentPost) {
      throw new Error('Failed to parse parent post');
    }

    // archivedData = postData (from Workers API - already includes media)
    const archivedData = postData;

    // ========== STEP 3: Download Media Files ==========
    const { MediaHandler } = await import('../../services/MediaHandler');
    const workersClient = this.apiClient;

    if (!workersClient) {
      throw new Error('WorkersAPIClient not available');
    }

    const mediaHandler = new MediaHandler({
      vault: this.app.vault,
      app: this.app,
      workersClient: workersClient,
      basePath: this.settings.mediaPath || 'attachments/social-archives',
      optimizeImages: true,
      imageQuality: 0.8,
      maxImageDimension: 2048
    });

    const totalMedia = archivedData.media?.length || 0;
    let mediaResults: import('../../services/MediaHandler').MediaResult[] = [];

    try {
      if (totalMedia > 0) {
        mediaResults = await mediaHandler.downloadMedia(
          archivedData.media || [],
          archivedData.platform,
          archivedData.id,
          archivedData.author.name,
          () => {} // No progress callback for background download
        );
      }
    } catch (error) {
      if (archivedData.platform === 'tiktok') {
        mediaResults = [];
      } else {
        throw error;
      }
    }

    // ========== STEP 4: Update Media URLs ==========
    if (mediaResults.length > 0) {
      const mediaResultMap = new Map<string, typeof mediaResults[number]>();
      mediaResults.forEach(result => {
        mediaResultMap.set(result.originalUrl, result);
      });

      archivedData.media = archivedData.media.map((media: Media, index: number) => {
        const result = mediaResults[index];
        const matchedResult = (result && result.originalUrl === media.url)
          ? result
          : mediaResultMap.get(media.url);

        if (matchedResult) {
          return {
            ...media,
            url: matchedResult.localPath
          };
        }
        return media;
      });
    } else if (archivedData.platform === 'tiktok') {
      archivedData.media = [{
        type: 'video' as const,
        url: archivedData.id
      }];
    }

    // ========== STEP 4.5: Enrich Author Metadata ==========
    await this.enrichAuthorMetadata(archivedData, archivedData.platform);

    // ========== STEP 4.6: Upsert Author Note ==========
    if (this.settings.enableAuthorNotes && this.authorNoteService) {
      try {
        await this.authorNoteService.upsertFromArchive(archivedData);
      } catch (e) {
        console.warn('[Social Archiver] Failed to upsert author note (embedded):', e);
      }
    }

    // ========== STEP 5: Check YouTube Local Video ==========
    // If the parent post already downloaded a video for this URL via yt-dlp,
    // replace the archived media with ONLY the matching local video entry
    // (not the entire parent media array, which would cause duplicate rendering).
    const downloadedUrls = Array.isArray(currentPost.downloadedUrls)
      ? currentPost.downloadedUrls
      : [];
    const hasLocalVideo = downloadedUrls.some((u: string) =>
      u.startsWith('downloaded:') && u.includes(pendingJob.url)
    );

    let embeddedMedia = archivedData.media;
    if (hasLocalVideo && Array.isArray(currentPost.media)) {
      const localVideoEntry = currentPost.media.find((m: { type: string; url?: string }) =>
        m.type === 'video' && m.url && !m.url.startsWith('http')
      );
      if (localVideoEntry) {
        embeddedMedia = [{ type: 'video' as const, url: localVideoEntry.url ?? '' }];
      }
    }

    const archivedDataWithComment = {
      ...archivedData,
      media: embeddedMedia,
      comment: currentPost.comment
    };

    // Normalize URL variants (original + resolved) for status updates
    const urlVariants = uniqueStrings(
      [
        pendingJob.url,
        pendingJob.metadata?.originalUrl,
        archivedData.url,
      ].filter(Boolean) as string[],
      normalizeUrlForDedup
    );

    // ========== STEP 6: Add to embeddedArchives ==========
    const updatedPost = {
      ...currentPost,
      embeddedArchives: [
        ...(currentPost.embeddedArchives || []),
        archivedDataWithComment
      ]
    };

    // Remove "archiving:" prefixes for all variants and add completed URLs
    const currentUrls = (currentPost.processedUrls || []).filter((u: string) => {
      return !urlVariants.some(variant => u === `archiving:${variant}`);
    });
    updatedPost.processedUrls = uniqueStrings(
      [
        ...currentUrls,
        ...urlVariants,
      ],
      normalizeUrlForDedup
    );

    // ========== STEP 7: Save to Vault ==========
    const { VaultStorageService } = await import('../../services/VaultStorageService');
    const storageService = new VaultStorageService({
      app: this.app,
      vault: this.app.vault,
      settings: this.settings
    });

    await storageService.updatePost({
      filePath: parentFilePath,
      postData: updatedPost,
      mediaFiles: [],
      existingMedia: currentPost.media || []
    });

    // Remove job
    await this.pendingJobsManager.removeJob(pendingJob.id);

    // Show success notice
    new Notice(`\u2705 Embedded archive added: ${postData.author?.name || 'Post'}`, 5000);

    // ========== STEP 8: Refresh Timeline ==========
    this.deps.refreshTimelineView();
    try {
      await this.deps.refreshCredits();
    } catch (refreshError) {
      console.error('[Social Archiver] Failed to refresh user credits after embedded archive', refreshError);
    }
  }

  // ─── Private: Normal Archive Mode ────────────────────────────────

  private async processNormalArchive(
    pendingJob: PendingJob,
    postData: PostData
  ): Promise<void> {
    const startTime = Date.now();

    // Determine download mode from pending job metadata
    const downloadMode = pendingJob.metadata?.downloadMedia || this.settings.downloadMedia;

    // Check if we have a preliminary document to update
    const preliminaryFilePath = pendingJob.metadata?.filePath;

    // Initialize services
    const vaultManager = new VaultManager({
      vault: this.app.vault,
      app: this.app,
      basePath: this.settings.archivePath || 'Social Archives',
      organizationStrategy: getVaultOrganizationStrategy(this.settings.archiveOrganization),
      fileNameFormat: this.settings.fileNameFormat,
    });
    const markdownConverter = new MarkdownConverter({
      frontmatterSettings: this.settings.frontmatter,
      includeHashtagsAsObsidianTags: this.settings.includeHashtagsAsObsidianTags,
    });

    vaultManager.initialize();
    markdownConverter.initialize();

    // Track downloaded media for markdown conversion
    const downloadedMedia: Array<import('../../services/MediaHandler').MediaResult> = [];
    const shouldAttemptVideoDownloads = downloadMode === 'images-and-videos';
    const totalVideoMediaCount = shouldAttemptVideoDownloads && Array.isArray(postData.media)
      ? postData.media.filter((item: { type: string }) => item.type === 'video').length
      : 0;
    const failedVideoDownloads: VideoDownloadFailure[] = [];

    // Download media files to local vault via Workers proxy
    if (downloadMode !== 'text-only' && postData.media && postData.media.length > 0) {
      const totalMediaCount = postData.media.length;

      // Show initial progress in archive banner
      if (totalMediaCount > 5) {
        this.archiveJobTracker.updateProgress(pendingJob.id, `Downloading images (0/${totalMediaCount})...`);
      }

      // Generate media folder structure: {platform}/{postId}/
      // Format: attachments/social-archives/instagram/DRPFtcOEvbl/
      const sanitizedPostId = postData.id.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '_').trim();
      const sanitizedPlatform = postData.platform.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '_').trim();
      const mediaFolderPath = `${this.settings.mediaPath}/${sanitizedPlatform}/${sanitizedPostId}`;

      // Get author username for filename
      const authorUsername = postData.author.username
        || (postData.author.handle ? postData.author.handle.replace('@', '') : '')
        || postData.author.name;
      const sanitizedAuthor = authorUsername.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '_').trim();

      // Get current date for filename (archive date, not publish date)
      const dateStr = window.moment().format('YYYYMMDD');

      for (let i = 0; i < postData.media.length; i++) {
        const media = postData.media[i];
        // noUncheckedIndexedAccess: guard against undefined (should not happen with valid media arrays)
        if (!media) continue;

        // Update progress for large downloads (webtoon episodes, etc.)
        if (totalMediaCount > 5 && i > 0 && i % 5 === 0) {
          this.archiveJobTracker.updateProgress(pendingJob.id, `Downloading images (${i}/${totalMediaCount})...`);
        }

        // Filter by download mode
        if (downloadMode === 'images-only' && media.type !== 'image') {
          continue;
        }

        let mediaUrl: string = '';

        try {
          // Select the best downloadable media URL.
          // For videos, prefer actual video URL (r2Url/url/cdnUrl) and only use thumbnail as a fallback.
          const selectedSource = this.mediaPathResolver.resolveMediaDownloadSource(media, postData.platform);
          mediaUrl = selectedSource.mediaUrl;
          const isVideoThumbnail = selectedSource.isVideoThumbnail;
          if (media.type === 'video') {
            console.debug('[Social Archiver] Video media source selected', {
              platform: postData.platform,
              mediaUrl,
              isThumbnailFallback: isVideoThumbnail,
            });
            if (shouldAttemptVideoDownloads && isVideoThumbnail) {
              this.mediaPathResolver.addVideoDownloadFailure(failedVideoDownloads, {
                index: i,
                originalUrl: this.mediaPathResolver.extractMediaUrlCandidate(media.url),
                attemptedUrl: mediaUrl,
                reason: 'Video URL unavailable; thumbnail fallback used',
                thumbnailFallback: true,
              });
            }
          }

          // Generate filename: YYYYMMDD-username-postId-index.ext
          // Format: 20251121-hallasansnow-DRPFtcOEvbl-2.jpg
          let extension = this.mediaPathResolver.getFileExtension(
            mediaUrl,
            isVideoThumbnail
          ) || (isVideoThumbnail ? 'jpg' : media.type === 'video' ? 'mp4' : 'jpg');
          let filename = `${dateStr}-${sanitizedAuthor}-${sanitizedPostId}-${i + 1}.${extension}`;
          const basePath = mediaFolderPath;
          let fullPath = `${basePath}/${filename}`;

          // Check if file already exists
          const existingFile = this.app.vault.getAbstractFileByPath(fullPath);

          if (existingFile instanceof TFile) {
            // File already exists, reuse it
            const stat = await this.app.vault.adapter.stat(fullPath);
            downloadedMedia.push({
              originalUrl: mediaUrl,
              localPath: fullPath,
              type: media.type,
              size: stat?.size || 0,
              file: existingFile,
              sourceIndex: i,
              fallbackKind: 'none',
            });
          } else {
            let arrayBuffer: ArrayBuffer;

            // Check if it's a blob URL (TikTok videos)
            if (mediaUrl.startsWith('blob:')) {
              // blob: URLs are not network requests; requestUrl() does not support the blob: protocol
              const response = await globalThis.fetch(mediaUrl);
              if (!response.ok) {
                throw new Error(`Blob fetch failed: ${response.status} ${response.statusText}`);
              }
              const blob = await response.blob();
              arrayBuffer = await blob.arrayBuffer();
            } else if (postData.platform === 'mastodon') {
              // Mastodon: Use Obsidian's requestUrl to bypass CORS (various instances, can't whitelist all domains)
              const response = await requestUrl({
                url: mediaUrl,
                method: 'GET',
                throw: false,
              });
              if (response.status !== 200) {
                throw new Error(`Direct fetch failed: ${response.status}`);
              }
              arrayBuffer = response.arrayBuffer;
            } else if (postData.platform === 'naver' && media.type === 'video' && mediaUrl.includes('apis.naver.com/rmcnmv')) {
              // Naver videos: Use MediaHandler which fetches video stream from API
              const { MediaHandler } = await import('../../services/MediaHandler');
              if (!this.apiClient) throw new Error('WorkersAPIClient not initialized');
              const mediaHandler = new MediaHandler({
                vault: this.app.vault,
                app: this.app,
                workersClient: this.apiClient,
                basePath: this.settings.mediaPath || 'attachments/social-archives',
                optimizeImages: true,
                imageQuality: 0.8,
                maxImageDimension: 2048
              });

              const mediaResults = await mediaHandler.downloadMedia(
                [{ ...media, url: mediaUrl }],
                postData.platform,
                postData.id,
                postData.author?.handle || postData.author?.name || 'unknown',
                undefined, // onProgress
                i // startIndex - use the original media array index for correct filename
              );

              const firstResult = mediaResults[0];
              if (mediaResults.length > 0 && firstResult && firstResult.localPath) {
                downloadedMedia.push({
                  originalUrl: mediaUrl,
                  localPath: firstResult.localPath,
                  type: media.type,
                  size: firstResult.size || 0,
                  file: firstResult.file,
                  sourceIndex: i,
                  fallbackKind: 'none',
                });
              } else {
                throw new Error('Naver video download failed');
              }
              continue; // Skip the rest of the loop for this media item
            } else if (postData.platform === 'googlemaps' || mediaUrl.includes('maps.google') || mediaUrl.includes('staticmap')) {
              // Google Maps: Skip static map images (require API key, can't proxy)
              // The map is rendered dynamically in the timeline using Leaflet/OSM
              console.debug(`[Social Archiver] Skipping Google Maps static image: ${mediaUrl.substring(0, 100)}...`);
              continue;
            } else {
              // Download via Workers proxy to bypass CORS
              if (!this.apiClient) throw new Error('WorkersAPIClient not initialized');
              arrayBuffer = await this.apiClient.proxyMedia(mediaUrl);
            }

            // Detect actual format from binary data and convert HEIC if needed
            if (media.type === 'image') {
              const { detectAndConvertHEIC } = await import('../../utils/heic');
              const result = await detectAndConvertHEIC(arrayBuffer, extension, 0.95);

              // Update data and extension if conversion occurred
              arrayBuffer = result.data;
              extension = result.extension;
              filename = `${dateStr}-${sanitizedAuthor}-${sanitizedPostId}-${i + 1}.${extension}`;
              fullPath = `${basePath}/${filename}`;
            }

            // Ensure folder exists
            await ensureFolderExists(this.app, basePath);

            // Save to vault
            const file = await this.app.vault.createBinary(fullPath, arrayBuffer);

            downloadedMedia.push({
              originalUrl: mediaUrl,
              localPath: file.path,
              type: media.type,
              size: arrayBuffer.byteLength,
              file: file,
              sourceIndex: i,
              fallbackKind: 'none',
            });
          }

        } catch (error) {
          // TikTok videos often fail due to DRM protection - skip for now
          // (fallback would require MediaResult.file which we don't have)
          // Continue with next media item
          console.warn(`[Social Archiver] Failed to download media ${i + 1}:`, error);
          if (shouldAttemptVideoDownloads && media.type === 'video') {
            this.mediaPathResolver.addVideoDownloadFailure(failedVideoDownloads, {
              index: i,
              originalUrl: this.mediaPathResolver.extractMediaUrlCandidate(media.url),
              attemptedUrl: mediaUrl,
              reason: error instanceof Error ? error.message : 'Unknown error',
              thumbnailFallback: false,
            });
          }
        }
      }

      if (downloadedMedia.length < postData.media.length) {
        new Notice(`\u26A0\uFE0F Downloaded ${downloadedMedia.length}/${postData.media.length} media files`, 5000);
      }
    }

    // Enrich author metadata (avatar download, followers, bio, etc.)
    await this.enrichAuthorMetadata(postData, postData.platform);

    // Upsert author note (if feature enabled)
    if (this.settings.enableAuthorNotes && this.authorNoteService) {
      try {
        await this.authorNoteService.upsertFromArchive(postData);
      } catch (e) {
        console.warn('[Social Archiver] Failed to upsert author note:', e);
      }
    }

    // Filter comments based on user option
    const shouldIncludeComments = pendingJob.metadata?.includeComments ?? this.settings.includeComments;
    if (!shouldIncludeComments) {
      delete postData.comments;
    }

    // Convert to markdown (with downloaded media paths)
    const outputFilePath = vaultManager.generateFilePath(postData);
    let markdown = markdownConverter.convert(postData, undefined, downloadedMedia.length > 0 ? downloadedMedia : undefined, { outputFilePath });

    // Add metadata to frontmatter
    markdown.frontmatter.download_time = Math.round((Date.now() - startTime) / 100) / 10;

    // Add user notes if provided
    if (pendingJob.metadata?.notes) {
      markdown.frontmatter.comment = pendingJob.metadata.notes;
    }

    // Merge user-selected tags into frontmatter (archive-time tagging)
    if (pendingJob.metadata?.selectedTags && pendingJob.metadata.selectedTags.length > 0) {
      const cleanedTags = sanitizeTagNames(pendingJob.metadata.selectedTags);
      if (cleanedTags.length > 0) {
        const existingTags = Array.isArray(markdown.frontmatter.tags)
          ? markdown.frontmatter.tags
          : [];
        markdown.frontmatter.tags = mergeTagsCaseInsensitive(existingTags, cleanedTags);
      }
    }

    // Add URL to processedUrls
    const processedUrls = uniqueStrings(
      [pendingJob.url, pendingJob.metadata?.originalUrl].filter(Boolean) as string[],
      normalizeUrlForDedup
    );
    markdown.frontmatter.processedUrls = processedUrls;

    // Mark archive as completed
    markdown.frontmatter.archiveStatus = 'completed';
    this.mediaPathResolver.applyVideoDownloadStatusFrontmatter(
      markdown.frontmatter as Record<string, unknown>,
      totalVideoMediaCount,
      failedVideoDownloads
    );
    if (failedVideoDownloads.length > 0) {
      markdown.content = this.mediaPathResolver.appendVideoDownloadFailureSection(markdown.content, failedVideoDownloads);
    }

    // Regenerate fullDocument with updated frontmatter
    markdown = markdownConverter.updateFullDocument(markdown);

    // If we have a preliminary document, update it; otherwise create new file
    if (preliminaryFilePath) {
      const abstractFile = this.app.vault.getAbstractFileByPath(preliminaryFilePath);
      if (abstractFile instanceof TFile) {
        const file = abstractFile;
        // Generate the correct final filename
        const correctFilePath = vaultManager.generateFilePath(postData);

        // If filename is different, rename the file
        if (preliminaryFilePath !== correctFilePath) {

          // Ensure target directory exists
          const targetDir = correctFilePath.substring(0, correctFilePath.lastIndexOf('/'));
          const targetFolder = this.app.vault.getAbstractFileByPath(targetDir);
          if (!targetFolder) {
            await this.app.vault.createFolder(targetDir);
          }

          // Check if destination file already exists
          const existingFile = this.app.vault.getAbstractFileByPath(correctFilePath);
          if (existingFile instanceof TFile) {
            // Update existing file content
            await this.app.vault.process(existingFile, () => markdown.fullDocument);
            // Delete preliminary file
            await this.app.fileManager.trashFile(file);
          } else {
            // Rename file and update content
            await this.app.fileManager.renameFile(file, correctFilePath);
            const renamedFile = this.app.vault.getAbstractFileByPath(correctFilePath);
            if (renamedFile instanceof TFile) {
              await this.app.vault.process(renamedFile, () => markdown.fullDocument);
            }
          }
        } else {
          // Same path, just update content
          await this.app.vault.process(file, () => markdown.fullDocument);
        }

      } else {
        // Preliminary file was deleted, create new one
        await vaultManager.savePost(postData, markdown);
      }
    } else {
      // No preliminary document (shouldn't happen with new flow, but fallback)
      await vaultManager.savePost(postData, markdown);
    }

    // Ensure archive-time tags become full tag definitions with assigned colors.
    // Without this, tags created in ArchiveModal exist only in YAML and appear gray
    // in Timeline until manually created later from TagModal.
    await this.ensureTagDefinitionsForSelectedTags(pendingJob.metadata?.selectedTags);

    // Remove job from pending queue
    await this.pendingJobsManager.removeJob(pendingJob.id);

    // Update archive banner (completeJob auto-hides after 5s)
    this.archiveJobTracker.completeJob(pendingJob.id);

    // Show success notice
    new Notice(`\u2705 Archive completed: ${postData.author?.name || 'Post'}`, 5000);
    this.mediaPathResolver.notifyVideoDownloadFailures(failedVideoDownloads);

    // Refresh Timeline View
    this.deps.refreshTimelineView();
    try {
      await this.deps.refreshCredits();
    } catch (refreshError) {
      console.error('[Social Archiver] Failed to refresh user credits after archive', refreshError);
    }
  }

  // ─── Private: Tag Definitions ────────────────────────────────────

  /**
   * Promote archive-time selected tags to TagDefinitions (with colors) if missing.
   * Non-critical: failures here must not fail the archive job itself.
   */
  private async ensureTagDefinitionsForSelectedTags(rawTags?: string[]): Promise<void> {
    if (!rawTags || rawTags.length === 0) return;

    const seen = new Set<string>();
    const cleaned = sanitizeTagNames(rawTags);

    for (const tagName of cleaned) {
      const lower = tagName.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);

      if (this.tagStore.getTagByName(tagName)) continue;

      try {
        await this.tagStore.createTag(tagName);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Duplicate creation can happen in race conditions (e.g., another modal/tab).
        if (!/already exists/i.test(message)) {
          console.warn('[Social Archiver] Failed to create tag definition for archive-time tag:', tagName, error);
        }
      }
    }
  }

  // ─── Private: Username Extraction ────────────────────────────────

  /**
   * Extract username for avatar filename
   * Tries handle, username, then falls back to author name
   */
  private extractUsernameForAvatar(
    author: PostData['author'],
    _platform: Platform
  ): string {
    // Try handle first (remove @ prefix)
    if (author.handle) {
      return author.handle.replace(/^@/, '');
    }

    // Try username
    if (author.username) {
      return author.username;
    }

    // Extract from URL if possible
    if (author.url) {
      try {
        const url = new URL(author.url);
        const pathParts = url.pathname.split('/').filter(Boolean);
        const lastPart = pathParts[pathParts.length - 1];
        if (lastPart) {
          return lastPart;
        }
      } catch {
        // Invalid URL, continue
      }
    }

    // Fall back to sanitized author name
    return author.name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
  }
}
