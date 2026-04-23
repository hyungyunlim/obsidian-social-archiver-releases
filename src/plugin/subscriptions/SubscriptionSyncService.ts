/**
 * SubscriptionSyncService - Syncs pending subscription posts from server to vault
 *
 * Responsibilities:
 * - Pulling pending subscription posts via SubscriptionManager
 * - Saving each post to vault (media download, markdown conversion, file creation)
 * - Creating profile-only notes when posts fail to load
 * - Debouncing concurrent sync attempts
 *
 * Extracted from main.ts to follow SRP.
 */

import { Notice, TFile, normalizePath, stringifyYaml } from 'obsidian';
import type { App } from 'obsidian';
import { VaultManager } from '../../services/VaultManager';
import type { SubscriptionManager, PendingPost } from '../../services/SubscriptionManager';
import type { WorkersAPIClient } from '../../services/WorkersAPIClient';
import type { AuthorAvatarService } from '../../services/AuthorAvatarService';
import type { MediaDownloadMode, SocialArchiverSettings } from '../../types/settings';
import { getVaultOrganizationStrategy } from '../../types/settings';
import type { PostData, Platform, Media } from '../../types/post';
import type { MediaExpiredResult } from '../../services/MediaPlaceholderGenerator';
import { getPlatformName } from '../../shared/platforms';
import { TimelineView, VIEW_TYPE_TIMELINE } from '../../views/TimelineView';
import type { WsProfileMetadataMessage } from '../realtime/RealtimeEventBridge';

// ============================================================================
// Types
// ============================================================================

/**
 * Detailed result from saving a single subscription post to vault.
 * Allows callers to distinguish between newly created files, already-existing
 * files, skipped posts, and failures — enabling precise dedup and lookup index
 * updates within the same sync run.
 */
export interface SavePendingPostResult {
  status: 'created' | 'existing' | 'skipped' | 'failed';
  file?: TFile;
  path?: string;
  reason?: string;
}

/**
 * Aggregate result from a syncSubscriptionPosts() call.
 * Returned so callers (e.g. recovery polling) can inspect counts
 * for backoff / notification decisions.
 */
export interface SyncSubscriptionResult {
  total: number;
  saved: number;
  failed: number;
}

interface MediaDownloadCandidate {
  media: Media;
  mediaIndex: number;
}

/**
 * Dependencies injected into SubscriptionSyncService.
 * Each dependency represents a capability the service needs from the plugin.
 */
export interface SubscriptionSyncServiceDeps {
  app: App;
  settings: () => SocialArchiverSettings;
  subscriptionManager: () => SubscriptionManager | undefined;
  apiClient: () => WorkersAPIClient | undefined;
  authorAvatarService: () => AuthorAvatarService | undefined;
  archiveCompletionService: {
    enrichAuthorMetadata: (postData: PostData, platform: Platform) => Promise<void>;
  } | undefined;
  refreshTimelineView: () => void;
  ensureFolderExists: (path: string) => Promise<void>;
  notify: (message: string, timeout?: number) => void;
}

// ============================================================================
// SubscriptionSyncService
// ============================================================================

export class SubscriptionSyncService {
  private readonly deps: SubscriptionSyncServiceDeps;
  private isSyncingSubscriptions = false;
  private syncDebounceTimer?: number;

  /** Recovery polling state */
  private recoveryPollTimer?: number;
  private recoveryPollIntervalMs = 5 * 60 * 1000; // 5 minutes default

  private static readonly RECOVERY_POLL_MIN_MS = 5 * 60 * 1000;   // 5 min
  private static readonly RECOVERY_POLL_MAX_MS = 15 * 60 * 1000;   // 15 min
  private static readonly RECOVERY_POLL_STEP_MS = 5 * 60 * 1000;   // 5 min increment
  private static readonly RECOVERY_POLL_INITIAL_DELAY_MS = 10_000;  // 10 sec

  constructor(deps: SubscriptionSyncServiceDeps) {
    this.deps = deps;
  }

  // ─── Accessors ──────────────────────────────────────────────────

  private get app(): App {
    return this.deps.app;
  }

  private get settings(): SocialArchiverSettings {
    return this.deps.settings();
  }

  private resolveDownloadMode(): MediaDownloadMode {
    const mode = this.settings.downloadMedia;
    if (mode === 'text-only' || mode === 'images-only' || mode === 'images-and-videos') {
      return mode;
    }
    return 'images-and-videos';
  }

  private buildDownloadCandidates(
    media: Media[] | undefined,
    downloadMode: MediaDownloadMode,
    options: { excludeAudio?: boolean } = {}
  ): MediaDownloadCandidate[] {
    if (downloadMode === 'text-only' || !media || media.length === 0) {
      return [];
    }

    const candidates: MediaDownloadCandidate[] = [];
    media.forEach((item, index) => {
      if (!item) return;
      if (options.excludeAudio && item.type === 'audio') return;
      if (downloadMode === 'images-only' && item.type !== 'image') return;
      candidates.push({ media: item, mediaIndex: index });
    });

    return candidates;
  }

  // ─── Public API ─────────────────────────────────────────────────

  /**
   * Sync pending subscription posts from server to vault.
   * Debounces concurrent calls - if already syncing, schedules a retry.
   *
   * @param trigger - Identifies what triggered this sync for structured logging.
   *   Common values: 'manual', 'startup', 'ws-connected', 'archive-added',
   *   'recovery-poll', 'subscription-post-fallback'.
   */
  private static readonly EMPTY_SYNC_RESULT: SyncSubscriptionResult = { total: 0, saved: 0, failed: 0 };

  async syncSubscriptionPosts(trigger: string = 'manual'): Promise<SyncSubscriptionResult> {
    const subscriptionManager = this.deps.subscriptionManager();
    if (!subscriptionManager?.isInitialized) {
      console.debug(`[Social Archiver] syncSubscriptionPosts(${trigger}): skipped — manager not ready`);
      return SubscriptionSyncService.EMPTY_SYNC_RESULT;
    }

    if (this.isSyncingSubscriptions) {
      if (this.syncDebounceTimer) {
        window.clearTimeout(this.syncDebounceTimer);
      }
      this.syncDebounceTimer = window.setTimeout(() => {
        this.syncDebounceTimer = undefined;
        void this.syncSubscriptionPosts(trigger);
      }, 500);
      return SubscriptionSyncService.EMPTY_SYNC_RESULT;
    }

    this.isSyncingSubscriptions = true;
    const startTime = Date.now();

    const timelineLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
    for (const leaf of timelineLeaves) {
      const view = leaf.view;
      if (view instanceof TimelineView) {
        view.suppressAutoRefresh();
      }
    }

    try {
      const result = await subscriptionManager.syncPendingPosts(
        async (pendingPost: PendingPost) => {
          return this.saveSubscriptionPost(pendingPost);
        }
      );

      const durationMs = Date.now() - startTime;
      console.debug(
        `[Social Archiver] syncSubscriptionPosts(${trigger}): ` +
        `total=${result.total} saved=${result.saved} failed=${result.failed ?? 0} ` +
        `duration=${durationMs}ms`
      );

      if (result.total > 0) {
        if (result.total > 1) {
          new Notice(
            `Subscription sync complete: saved ${result.saved}/${result.total}` +
            (result.failed ? `, failed ${result.failed}` : '')
          );
        }
        for (const leaf of timelineLeaves) {
          const view = leaf.view;
          if (view instanceof TimelineView) {
            view.resumeAutoRefresh();
          }
        }
      } else {
        for (const leaf of timelineLeaves) {
          const view = leaf.view;
          if (view instanceof TimelineView) {
            view.resumeAutoRefresh(false);
          }
        }
      }

      return { total: result.total, saved: result.saved, failed: result.failed };
    } catch (error) {
      console.error('[Social Archiver] Failed to sync subscription posts:', error);
      new Notice('Subscription sync failed. Check console for details.');
      for (const leaf of timelineLeaves) {
        const view = leaf.view;
        if (view instanceof TimelineView) {
          view.resumeAutoRefresh(false);
        }
      }
      throw error;
    } finally {
      this.isSyncingSubscriptions = false;
    }
  }

  // ─── Recovery Polling ───────────────────────────────────────────

  /**
   * Start periodic recovery polling for missed pending posts.
   * No-op if already running. First poll fires after a short initial delay.
   */
  startRecoveryPolling(): void {
    if (this.recoveryPollTimer != null) return;
    console.debug('[Social Archiver] Recovery polling started');
    this.scheduleNextRecoveryPoll(SubscriptionSyncService.RECOVERY_POLL_INITIAL_DELAY_MS);
  }

  /**
   * Stop recovery polling and clear the pending timer.
   */
  stopRecoveryPolling(): void {
    if (this.recoveryPollTimer != null) {
      window.clearTimeout(this.recoveryPollTimer);
      this.recoveryPollTimer = undefined;
      console.debug('[Social Archiver] Recovery polling stopped');
    }
  }

  /**
   * Schedule the next recovery poll after `delayMs`.
   */
  private scheduleNextRecoveryPoll(delayMs: number = this.recoveryPollIntervalMs): void {
    this.recoveryPollTimer = window.setTimeout(() => {
      this.recoveryPollTimer = undefined;
      void this.runRecoveryPollOnce();
    }, delayMs);
  }

  /**
   * Execute one recovery poll cycle:
   * - Routes through syncSubscriptionPosts('recovery-poll') so the
   *   isSyncingSubscriptions guard prevents concurrent vault work
   * - Backs off interval when no posts are found (5m -> 10m -> 15m)
   * - Resets interval to 5m when posts are found or an error occurs
   * - Schedules the next poll automatically
   */
  private async runRecoveryPollOnce(): Promise<void> {
    try {
      const result = await this.syncSubscriptionPosts('recovery-poll');

      if (result.total > 0) {
        // Posts found — reset to minimum interval
        this.recoveryPollIntervalMs = SubscriptionSyncService.RECOVERY_POLL_MIN_MS;

        console.debug(
          `[Social Archiver] Recovery poll: found ${result.total} pending posts ` +
          `(saved=${result.saved}, failed=${result.failed}), ` +
          `next poll in ${this.recoveryPollIntervalMs / 1000}s`
        );
      } else {
        // No pending posts (or sync was skipped/debounced) — back off
        this.recoveryPollIntervalMs = Math.min(
          this.recoveryPollIntervalMs + SubscriptionSyncService.RECOVERY_POLL_STEP_MS,
          SubscriptionSyncService.RECOVERY_POLL_MAX_MS,
        );
        console.debug(
          `[Social Archiver] Recovery poll: no pending posts, ` +
          `next poll in ${this.recoveryPollIntervalMs / 1000}s`
        );
      }
    } catch (error) {
      // Error — reset to minimum interval for faster retry
      this.recoveryPollIntervalMs = SubscriptionSyncService.RECOVERY_POLL_MIN_MS;
      console.debug('[Social Archiver] Recovery poll failed, resetting interval:', error);
    }

    this.scheduleNextRecoveryPoll();
  }

  /**
   * Save a single subscription post to vault.
   *
   * Thin wrapper around `saveSubscriptionPostDetailed` that returns a boolean
   * for compatibility with the existing `syncPendingPosts` callback signature.
   *
   * @returns true if the post was saved or already exists, false on failure
   */
  async saveSubscriptionPost(pendingPost: PendingPost): Promise<boolean> {
    const result = await this.saveSubscriptionPostDetailed(pendingPost);
    return result.status !== 'failed';
  }

  /**
   * Save a single subscription post to vault with detailed result.
   *
   * Handles:
   * - VaultStorageService and MediaHandler dynamic imports
   * - Webtoon series path generation
   * - Naver webtoon local image download
   * - Worker proxy media download for other platforms
   * - CDN expiry detection
   * - External link preview image downloads
   * - Quoted post media downloads
   *
   * @returns SavePendingPostResult describing the outcome in detail
   */
  async saveSubscriptionPostDetailed(pendingPost: PendingPost): Promise<SavePendingPostResult> {
    try {
      const { VaultStorageService } = await import('../../services/VaultStorageService');
      const { MediaHandler } = await import('../../services/MediaHandler');

      const post = pendingPost.post;

      const rawAuthorName = post.author?.name || post.author?.handle || '';
      // Skip unknown author — but allow composed posts (platform: 'post') which are self-authored
      if ((!rawAuthorName || rawAuthorName.toLowerCase() === 'unknown') && post.platform !== 'post') {
        return { status: 'skipped', reason: 'unknown author' };
      }

      let title = '';
      if (post.title && post.title.trim().length > 0) {
        title = post.title.trim().substring(0, 50).replace(/[\\/:*?"<>|]/g, '-');
      } else if (post.content?.text && post.content.text.trim().length > 0) {
        const firstLine = post.content.text.trim().split('\n')[0] || '';
        title = firstLine.substring(0, 50).replace(/[\\/:*?"<>|]/g, '-');
      }

      const titlePart = title || 'Post';

      const basePath = pendingPost.destinationFolder || this.settings.archivePath;
      const pathVaultManager = new VaultManager({
        vault: this.app.vault,
        app: this.app,
        basePath,
        organizationStrategy: getVaultOrganizationStrategy(this.settings.archiveOrganization),
        fileNameFormat: this.settings.fileNameFormat,
      });

      const platformName = post.platform
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- post.platform may be a superset type
        ? getPlatformName(post.platform as Platform)
        : 'Unknown';

      let targetFilePath: string;

      if ((post.platform === 'naver-webtoon' || post.platform === 'webtoons') && post.series) {
        const seriesTitle = (post.series.title || 'Unknown Series')
          .replace(/[\\/:*?"<>|]/g, '-')
          .trim();
        const episodeNo = String(post.series.episode || 0).padStart(3, '0');
        const subtitle = ((post.raw as Record<string, unknown>)?.subtitle as string | undefined || titlePart || 'Episode')
          .replace(/[\\/:*?"<>|]/g, '-')
          .substring(0, 50)
          .trim();
        const webtoonFileName = `${episodeNo} - ${subtitle}.md`;
        targetFilePath = normalizePath(`${basePath}/${platformName}/${seriesTitle}/${webtoonFileName}`);
      } else {
        targetFilePath = pathVaultManager.generateFilePath(post);
      }

      const existingFile = this.app.vault.getAbstractFileByPath(targetFilePath);
      if (existingFile) {
        return { status: 'existing', path: targetFilePath };
      }

      let mediaResults: import('../../services/MediaHandler').MediaResult[] | undefined;
      let mediaHandledLocally = false;

      const downloadMode = this.resolveDownloadMode();
      const mainMediaCandidates = this.buildDownloadCandidates(post.media, downloadMode, {
        excludeAudio: post.platform === 'podcast',
      });

      const quotedMediaCandidates = (post.quotedPost?.media && post.quotedPost.media.length > 0
        && post.quotedPost.platform !== 'youtube' && post.quotedPost.platform !== 'tiktok')
        ? this.buildDownloadCandidates(post.quotedPost.media, downloadMode)
        : [];

      const mediaToDownload = mainMediaCandidates.map(candidate => candidate.media);

      const shouldDownloadExternalLinkImages = downloadMode !== 'text-only';
      const hasQuotedExternalLinkImage = shouldDownloadExternalLinkImages && !!post.quotedPost?.metadata?.externalLinkImage;
      const hasMainExternalLinkImage = shouldDownloadExternalLinkImages && !!post.metadata?.externalLinkImage;

      // Naver Webtoon: Use local service for faster image downloads
      if (post.platform === 'naver-webtoon' && mediaToDownload && mediaToDownload.length > 0) {
        try {
          const { NaverWebtoonLocalService } = await import('../../services/NaverWebtoonLocalService');
          const webtoonService = new NaverWebtoonLocalService();
          const mediaBasePath = this.settings.mediaPath || 'attachments/social-archives';

          const seriesId = post.series?.id || post.id.split('-')[1] || 'unknown';
          const episodeNo = post.series?.episode || 1;
          const postMediaFolder = `${mediaBasePath}/naver-webtoon/${seriesId}/${episodeNo}`;

          await this.deps.ensureFolderExists(postMediaFolder);

          const downloadedImages: Array<{ originalUrl: string; localPath: string }> = [];
          const totalImages = mediaToDownload.length;

          console.debug(`[Social Archiver] Downloading ${totalImages} webtoon images locally (subscription)`);

          for (let i = 0; i < totalImages; i++) {
            const media = mainMediaCandidates[i]?.media;
            if (!media?.url) continue;

            try {
              const arrayBuffer = await webtoonService.downloadImage(media.url);

              let extension = 'jpg';
              const urlMatch = media.url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
              if (urlMatch && urlMatch[1]) {
                const ext = urlMatch[1].toLowerCase();
                if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
                  extension = ext;
                }
              }

              const filename = `${i + 1}.${extension}`;
              const localPath = `${postMediaFolder}/${filename}`;

              await this.app.vault.adapter.writeBinary(localPath, arrayBuffer);
              downloadedImages.push({ originalUrl: media.url, localPath });

            } catch (error) {
              console.warn(`[Social Archiver] Failed to download webtoon image ${i + 1}:`, error);
            }
          }

          console.debug(`[Social Archiver] Downloaded ${downloadedImages.length}/${totalImages} webtoon images`);

          const resultsByUrl = new Map(
            downloadedImages.map(result => [result.originalUrl, result])
          );

          post.media = post.media.map((mediaItem: typeof post.media[number]) => {
            const result = resultsByUrl.get(mediaItem.url);
            if (result) {
              return {
                ...mediaItem,
                url: result.localPath,
                originalUrl: result.originalUrl
              };
            }
            return mediaItem;
          });

          mediaHandledLocally = true;

        } catch (error) {
          console.error('[Social Archiver] Naver Webtoon local download failed:', error);
        }
      }

      // Other platforms: Use Worker proxy for media downloads
      const apiClient = this.deps.apiClient();
      const hasMainMedia = !mediaHandledLocally && !mediaResults && mainMediaCandidates.length > 0;
      const hasQuotedMedia = quotedMediaCandidates.length > 0;
      const hasExternalLinkImages = hasQuotedExternalLinkImage || hasMainExternalLinkImage;
      if ((hasMainMedia || hasQuotedMedia || hasExternalLinkImages) && apiClient) {
        try {
          const mediaHandler = new MediaHandler({
            vault: this.app.vault,
            app: this.app,
            workersClient: apiClient,
            basePath: this.settings.mediaPath || 'attachments/social-archives',
            optimizeImages: true,
            imageQuality: 0.8,
            maxImageDimension: 2048
          });

          const allMediaToDownload: Array<{ media: Media; mediaIndex: number; isQuotedPost?: boolean; isExternalLinkImage?: boolean }> = [];

          if (hasMainMedia) {
            mainMediaCandidates.forEach(({ media, mediaIndex }) => {
              allMediaToDownload.push({ media, mediaIndex });
            });
          }

          if (hasQuotedMedia) {
            quotedMediaCandidates.forEach(({ media, mediaIndex }) => {
              allMediaToDownload.push({ media, mediaIndex, isQuotedPost: true });
            });
          }

          if (hasQuotedExternalLinkImage && post.quotedPost?.metadata?.externalLinkImage) {
            allMediaToDownload.push({
              media: { type: 'image', url: post.quotedPost.metadata.externalLinkImage },
              mediaIndex: -1,
              isQuotedPost: true,
              isExternalLinkImage: true,
            });
          }

          if (hasMainExternalLinkImage && post.metadata?.externalLinkImage) {
            allMediaToDownload.push({
              media: { type: 'image', url: post.metadata.externalLinkImage },
              mediaIndex: -2,
              isExternalLinkImage: true,
            });
          }

          const allMediaItems = allMediaToDownload.map(item => item.media);
          mediaResults = await mediaHandler.downloadMedia(
            allMediaItems,
            post.platform,
            post.id,
            post.author?.handle || post.author?.name || 'unknown'
          );

          // Use result.sourceIndex (position in original input array) instead of forEach index
          // to stay correct even when some downloads fail and the results array is shorter.
          mediaResults.forEach((result) => {
            const sourceItem = allMediaToDownload[result.sourceIndex];
            if (!sourceItem) return;

            if (sourceItem.isExternalLinkImage) {
              if (sourceItem.isQuotedPost && post.quotedPost?.metadata) {
                post.quotedPost.metadata.externalLinkImage = result.localPath;
              } else if (post.metadata) {
                post.metadata.externalLinkImage = result.localPath;
              }
            } else if (sourceItem.isQuotedPost) {
              if (post.quotedPost && post.quotedPost.media[sourceItem.mediaIndex]) {
                if (result.fallbackKind === 'thumbnail') {
                  // Thumbnail fallback: keep original URL, store thumbnail path separately
                  post.quotedPost.media[sourceItem.mediaIndex] = {
                    ...post.quotedPost.media[sourceItem.mediaIndex],
                    thumbnail: result.localPath,
                    // url intentionally NOT overwritten — keep original remote/post URL
                  } as typeof post.quotedPost.media[number];
                } else {
                  post.quotedPost.media[sourceItem.mediaIndex] = {
                    ...post.quotedPost.media[sourceItem.mediaIndex],
                    url: result.localPath,
                    originalUrl: result.originalUrl
                  } as typeof post.quotedPost.media[number];
                }
              }
            } else {
              if (post.media[sourceItem.mediaIndex]) {
                if (result.fallbackKind === 'thumbnail') {
                  // Thumbnail fallback: keep original URL, store thumbnail path separately
                  post.media[sourceItem.mediaIndex] = {
                    ...post.media[sourceItem.mediaIndex],
                    thumbnail: result.localPath,
                    // url intentionally NOT overwritten
                  } as typeof post.media[number];
                } else {
                  post.media[sourceItem.mediaIndex] = {
                    ...post.media[sourceItem.mediaIndex],
                    url: result.localPath,
                    originalUrl: result.originalUrl
                  } as typeof post.media[number];
                }
              }
            }
          });
        } catch {
          mediaResults = undefined;
        }
      }

      // Detect expired media (CDN URLs that failed to download)
      if (!mediaHandledLocally) {
        const { CdnExpiryDetector } = await import('../../services/CdnExpiryDetector');

        const allOriginalMedia = [
          ...mainMediaCandidates.map(candidate => candidate.media),
          ...quotedMediaCandidates.map(candidate => candidate.media),
        ];

        const downloadedUrls = new Set<string>();
        if (mediaResults) {
          for (const result of mediaResults) {
            if (result.originalUrl) downloadedUrls.add(result.originalUrl);
          }
        }

        const expiredMedia: MediaExpiredResult[] = [];
        for (const item of allOriginalMedia) {
          const originalUrl = (item as Media & { originalUrl?: string }).originalUrl ?? item.url;
          if (!downloadedUrls.has(originalUrl)) {
            const reason = CdnExpiryDetector.isEphemeralCdn(originalUrl) ? 'cdn_expired' : 'download_failed';
            expiredMedia.push({
              originalUrl,
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- MediaExpiredResult.type is a narrower literal union
              type: item.type as 'image' | 'video' | 'audio' | 'document',
              reason,
              detectedAt: new Date().toISOString(),
            });
          }
        }

        if (expiredMedia.length > 0) {
          const preservationInProgress = post.mediaPreservationStatus === 'pending' || post.mediaPreservationStatus === 'processing';
          if (!preservationInProgress) {
            post._expiredMedia = expiredMedia;
            new Notice(
              `\u26A0\uFE0F ${expiredMedia.length} media item(s) could not be downloaded (CDN expired).`,
              8000
            );
          }
        }
      }

      // Enrich author metadata (avatar download, followers, bio, etc.)
      await this.deps.archiveCompletionService?.enrichAuthorMetadata(post, post.platform);

      // Filter comments based on global setting
      if (!this.settings.includeComments) {
        delete post.comments;
      }

      const storageService = new VaultStorageService({
        app: this.app,
        vault: this.app.vault,
        settings: {
          ...this.settings,
          archivePath: basePath
        }
      });

      const saveResult = await storageService.savePost(post, undefined, targetFilePath, mediaResults);

      if (saveResult.path) {
        this.deps.refreshTimelineView();
        return { status: 'created', file: saveResult.file, path: saveResult.path };
      }

      return { status: 'failed', reason: 'save returned no path' };
    } catch (error) {
      console.error('[Social Archiver] saveSubscriptionPostDetailed error:', error);
      return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Create a profile-only note when posts fail to load.
   * Saves author profile metadata (avatar, bio, followers) as a standalone note.
   */
  async createProfileNote(message: WsProfileMetadataMessage): Promise<void> {
    const { metadata, handle, platform, profileUrl } = message;

    let localAvatarPath: string | null = null;
    const authorAvatarService = this.deps.authorAvatarService();
    if (this.settings.downloadAuthorAvatars && authorAvatarService && metadata.avatarUrl) {
      try {
        localAvatarPath = await authorAvatarService.downloadAndSaveAvatar(
          metadata.avatarUrl,
          platform as Platform,
          handle,
          this.settings.overwriteAuthorAvatar
        );
      } catch {
        // Continue without avatar
      }
    }

    const now = new Date();
    const displayName = metadata.displayName || handle;

    const frontmatterObj: Record<string, unknown> = {
      type: 'profile',
      platform,
      handle,
      displayName,
      profileUrl,
      crawledAt: now.toISOString(),
      tags: [`social/${platform}`, 'profile'],
    };
    if (metadata.bio) frontmatterObj.bio = metadata.bio.replace(/\n/g, ' ');
    if (metadata.followers !== undefined) frontmatterObj.followers = metadata.followers;
    if (metadata.following !== undefined) frontmatterObj.following = metadata.following;
    if (metadata.postsCount !== undefined) frontmatterObj.postsCount = metadata.postsCount;
    if (metadata.verified !== undefined) frontmatterObj.verified = metadata.verified;
    if (metadata.location) frontmatterObj.location = metadata.location;
    if (localAvatarPath) frontmatterObj.avatar = localAvatarPath;
    if (metadata.avatarUrl) frontmatterObj.avatarUrl = metadata.avatarUrl;

    const content = `---\n${stringifyYaml(frontmatterObj)}---\n\n[Open Profile](${profileUrl})\n`;

    const archivePath = this.settings.archivePath || 'Social Archives';
    const fileName = `Profile - @${handle}.md`;
    const filePath = `${archivePath}/Profiles/${fileName}`;

    const folderPath = `${archivePath}/Profiles`;
    if (!this.app.vault.getAbstractFileByPath(folderPath)) {
      await this.app.vault.createFolder(folderPath);
    }

    const existingFile = this.app.vault.getAbstractFileByPath(filePath);
    if (existingFile && existingFile instanceof TFile) {
      await this.app.vault.process(existingFile, () => content);
    } else {
      await this.app.vault.create(filePath, content);
    }

    new Notice(`\uD83D\uDCCB Profile @${handle} saved to ${filePath}`, 5000);
  }
}
