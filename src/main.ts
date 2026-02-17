/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/await-thenable */
import { Plugin, Notice, Platform as ObsidianPlatform, Events, TFile, TFolder, EventRef, requestUrl, normalizePath, Modal, Setting, ButtonComponent } from 'obsidian';
import { SocialArchiverSettingTab } from './settings/SettingTab';
import { SocialArchiverSettings, DEFAULT_SETTINGS, API_ENDPOINT, MediaDownloadMode, migrateSettings, getVaultOrganizationStrategy } from './types/settings';
import { WorkersAPIClient } from './services/WorkersAPIClient';
import { ArchiveOrchestrator } from './services/ArchiveOrchestrator';
import { VaultManager } from './services/VaultManager';
import { MarkdownConverter } from './services/MarkdownConverter';
import { LinkPreviewExtractor } from './services/LinkPreviewExtractor';
import { PendingJobsManager, type PendingJob } from './services/PendingJobsManager';
import { CrawlJobTracker } from './services/CrawlJobTracker';
import { ArchiveJobTracker } from './services/ArchiveJobTracker';
import { RealtimeClient } from './services/RealtimeClient';
import { SubscriptionManager, type PendingPost } from './services/SubscriptionManager';
import { NaverSubscriptionPoller } from './services/NaverSubscriptionPoller';
import { BrunchSubscriptionPoller } from './services/BrunchSubscriptionPoller';
import { WebtoonSyncService } from './services/WebtoonSyncService';
import { BrunchLocalService } from './services/BrunchLocalService';
import { AuthorAvatarService } from './services/AuthorAvatarService';
import { TagStore } from './services/TagStore';
import { ProfileDataMapper } from './services/mappers/ProfileDataMapper';
import { getAuthorCatalogStore, type AuthorMetadataUpdate } from './services/AuthorCatalogStore';
import type { PostData, Platform, Media } from './types/post';
import type { BrunchComment } from './types/brunch';
import type { PendingJobArchiveOptions, ServerPendingJob } from './types/pending-job';
import type { ClientSyncEventData } from './types/websocket';
import type { UserArchive } from './services/WorkersAPIClient';
import { TimelineView, VIEW_TYPE_TIMELINE } from './views/TimelineView';
import { MediaGalleryView, VIEW_TYPE_MEDIA_GALLERY } from './views/MediaGalleryView';
import { MediaGalleryView2, VIEW_TYPE_MEDIA_GALLERY_2 } from './views/MediaGalleryView2';
import { ArchiveModal } from './modals/ArchiveModal';
import { WebtoonArchiveModal } from './modals/WebtoonArchiveModal';
import { ReleaseNotesModal } from './modals/ReleaseNotesModal';
import { NaverWebtoonLocalService } from './services/NaverWebtoonLocalService';
import { RELEASE_NOTES } from './release-notes';
import { completeAuthentication, showAuthError, showAuthSuccess, refreshUserCredits } from './utils/auth';
import { uniqueStrings } from './utils/array';
import { normalizeUrlForDedup, encodePathForMarkdownLink } from './utils/url';

import { ProcessManager } from './services/ProcessManager';
import { PostService } from './services/PostService';
import { YtDlpDetector } from './utils/yt-dlp';
import { getPlatformName } from '@/shared/platforms';
import type { TranscriptionResult } from './types/transcription';
import { TranscriptFormatter } from './services/markdown/formatters/TranscriptFormatter';
import { BatchTranscriptionManager, type BatchTranscriptionManagerDeps } from './services/BatchTranscriptionManager';
import { BatchTranscriptionNotice } from './ui/BatchTranscriptionNotice';
import type { BatchMode } from './types/batch-transcription';

// Import styles for Vite to process
import './styles/index.css';

const MISSING_STATUS_RETRY_DELAY = 30000; // 30 seconds before rechecking missing jobs
const MISSING_STATUS_TIMEOUT = 120000; // Give Workers API up to 2 minutes before marking as failed
const JOB_SUBMISSION_GRACE_PERIOD = 15000; // Wait 15 seconds after submission before checking status
const MOBILE_SYNC_ARCHIVE_FETCH_MAX_ATTEMPTS = 5; // Retry transient archive lookup misses
const MOBILE_SYNC_ARCHIVE_FETCH_RETRY_DELAY = 2000; // Base delay for archive lookup retries
const MOBILE_SYNC_PENDING_RETRY_DELAY = 30000; // Re-run pending queue sync after not-found

interface VideoDownloadFailure {
  index: number;
  originalUrl: string;
  attemptedUrl: string;
  reason: string;
  thumbnailFallback: boolean;
}

export default class SocialArchiverPlugin extends Plugin {
  settings: SocialArchiverSettings = DEFAULT_SETTINGS;
  private apiClient?: WorkersAPIClient;
  private orchestrator?: ArchiveOrchestrator;
  public linkPreviewExtractor!: LinkPreviewExtractor; // Link preview URL extractor
  private settingTab?: SocialArchiverSettingTab; // Settings tab reference for refresh
  public events: Events = new Events();
  public pendingJobsManager!: PendingJobsManager; // Pending jobs manager for async archiving
  private jobCheckInterval?: number; // Background job checker interval ID
  private realtimeClient?: RealtimeClient; // WebSocket client for real-time job updates
  private eventRefs: EventRef[] = []; // Store event references for cleanup
  private processingJobs: Set<string> = new Set(); // Track jobs being processed to prevent concurrent processing
  public subscriptionManager?: SubscriptionManager; // Subscription management service
  public naverPoller?: NaverSubscriptionPoller; // Naver Blog/Cafe local subscription poller
  public brunchPoller?: BrunchSubscriptionPoller; // Brunch local subscription poller
  public webtoonSyncService?: WebtoonSyncService; // Webtoon offline sync service
  private syncDebounceTimer?: number; // Debounce timer for subscription sync
  private isSyncingSubscriptions = false; // Track if sync is in progress
  private isSyncingMobileQueue = false; // Track if mobile sync queue catch-up is in progress
  private scheduledMobileSyncRetries = new Set<string>(); // queueId set for delayed mobile sync retries
  private authorAvatarService?: AuthorAvatarService; // Author avatar download service
  private wsPostBatchTimer?: number; // Timer for batching WebSocket posts
  private recentlyArchivedUrls = new Set<string>(); // Dedup guard for ws:client_sync (tracks URLs archived locally)
  private pendingTimeouts = new Set<number>(); // Track setTimeout IDs for cleanup on unload
  private archiveQueueLocks = new Set<string>(); // Dedup guard for archive submission race conditions
  private pendingJobsCheckPromise: Promise<void> | null = null; // Prevent overlapping pending job checks
  private pendingJobSubmissionLocks = new Set<string>(); // Prevent duplicate submission for same URL/platform
  private wsPostBatchCount = 0; // Count of posts in current batch
  private currentCrawlWorkerJobId?: string; // Track workerJobId for current profile crawl batch
  public crawlJobTracker!: CrawlJobTracker; // Profile crawl progress tracker
  public archiveJobTracker!: ArchiveJobTracker; // Archive progress tracker for banner UI
  public tagStore!: TagStore; // User-defined tag management
  public batchTranscriptionManager: BatchTranscriptionManager | null = null;
  private batchTranscriptionNotice: BatchTranscriptionNotice | null = null;
  private readonly transcriptFormatter = new TranscriptFormatter();

  /**
   * Schedule a tracked setTimeout that will be auto-cleared on plugin unload.
   * Prevents memory leaks from orphaned timeout callbacks.
   */
  private scheduleTrackedTimeout(callback: () => void, delay: number): number {
    const id = window.setTimeout(() => {
      this.pendingTimeouts.delete(id);
      callback();
    }, delay);
    this.pendingTimeouts.add(id);
    return id;
  }

  private buildArchiveQueueLockKey(url: string, platform?: Platform): string {
    const normalizedUrl = normalizeUrlForDedup(url || '');
    if (normalizedUrl) {
      // Use URL-only key to dedupe submissions even when platform detection differs by entry path.
      return normalizedUrl;
    }
    const platformKey = platform || 'unknown';
    return `${platformKey}:${url.trim()}`;
  }

  public tryAcquireArchiveQueueLock(url: string, platform?: Platform): string | null {
    const lockKey = this.buildArchiveQueueLockKey(url, platform);
    if (this.archiveQueueLocks.has(lockKey)) {
      return null;
    }
    this.archiveQueueLocks.add(lockKey);
    return lockKey;
  }

  public releaseArchiveQueueLock(lockKey: string | null | undefined): void {
    if (!lockKey) return;
    this.archiveQueueLocks.delete(lockKey);
  }

  private getNormalizedArchiveUrlKey(url: string | null | undefined): string {
    if (!url) return '';
    const trimmed = url.trim();
    if (!trimmed) return '';
    return normalizeUrlForDedup(trimmed) || trimmed;
  }

  private markRecentlyArchivedUrl(url: string | null | undefined): void {
    const normalizedKey = this.getNormalizedArchiveUrlKey(url);
    if (!normalizedKey) return;
    this.recentlyArchivedUrls.add(normalizedKey);
    this.scheduleTrackedTimeout(() => this.recentlyArchivedUrls.delete(normalizedKey), 5 * 60 * 1000);
  }

  private hasRecentlyArchivedUrl(url: string | null | undefined): boolean {
    const normalizedKey = this.getNormalizedArchiveUrlKey(url);
    if (!normalizedKey) return false;
    return this.recentlyArchivedUrls.has(normalizedKey);
  }

  private buildPendingJobDedupKey(job: Pick<PendingJob, 'url' | 'platform'>): string {
    const normalizedUrl = normalizeUrlForDedup(job.url || '') || job.url.trim();
    return `${job.platform}:${normalizedUrl}`;
  }

  private async removeDuplicatePendingJob(job: PendingJob, reason: string): Promise<void> {
    console.warn('[Social Archiver] Removing duplicate pending job before submission', {
      jobId: job.id,
      url: job.url,
      platform: job.platform,
      reason,
    });

    await this.pendingJobsManager.removeJob(job.id);
  }

  /**
   * Public getter for ArchiveOrchestrator
   * Used by PostComposer for inline archiving
   */
  get archiveOrchestrator(): ArchiveOrchestrator {
    if (!this.orchestrator) {
      throw new Error('ArchiveOrchestrator not initialized. Please configure API settings.');
    }
    return this.orchestrator;
  }

  /**
   * Optional getter for ArchiveOrchestrator (returns undefined if not initialized)
   * Used when orchestrator is optional (e.g., edit mode without inline archiving)
   */
  get archiveOrchestratorOptional(): ArchiveOrchestrator | undefined {
    return this.orchestrator;
  }

  /**
   * Public getter for WorkersAPIClient
   * Used by ArchiveModal for profile crawl requests
   */
  get workersApiClient(): WorkersAPIClient {
    if (!this.apiClient) {
      throw new Error('WorkersAPIClient not initialized. Please configure API settings.');
    }
    return this.apiClient;
  }

  async onload(): Promise<void> {
    await this.loadSettings();

    // Initialize services if API endpoint is configured
    await this.initializeServices();

    // Sync user credits and tier from server (if authenticated)
    // This ensures local settings are updated when tier changes server-side
    await this.syncUserCreditsOnLoad();

    // Check for version update and show release notes if applicable
    await this.checkAndShowReleaseNotes();

    // Register Timeline View
    this.registerView(
      VIEW_TYPE_TIMELINE,
      (leaf) => new TimelineView(leaf, this)
    );

    // Register Media Gallery View 2 (Simple ItemView)
    this.registerView(
      VIEW_TYPE_MEDIA_GALLERY_2,
      (leaf) => new MediaGalleryView2(leaf, this)
    );

    // Register Media Gallery Bases View
    this.registerBasesView(VIEW_TYPE_MEDIA_GALLERY, {
      name: 'Media Gallery',
      icon: 'lucide-images',
      factory: (controller, containerEl) => {
        return new MediaGalleryView(controller, containerEl);
      },
      options: () => ([
        {
          type: 'dropdown' as const,
          displayName: 'Media Type',
          key: 'mediaType',
          default: 'all',
          options: {
            'all': 'All Media',
            'images': 'Images Only',
            'videos': 'Videos Only'
          } as Record<string, string>
        },
        {
          type: 'dropdown' as const,
          displayName: 'Layout',
          key: 'layout',
          default: 'grid',
          options: {
            'grid': 'Grid',
            'masonry': 'Masonry'
          } as Record<string, string>
        },
        {
          type: 'slider' as const,
          displayName: 'Columns',
          key: 'columns',
          min: 2,
          max: 10,
          default: 3,
          step: 1
        }
      ])
    });

    // Add ribbon icon for archive (using Lucide bookmark-plus)
    this.addRibbonIcon('bookmark-plus', 'Archive social media post', () => {
      this.openArchiveModal();
    });

    // Add ribbon icon for timeline
    // On mobile: opens in main area (full screen)
    // On desktop: opens in sidebar (side-by-side with notes)
    this.addRibbonIcon('calendar-clock', 'Open timeline view', () => {
      const location = ObsidianPlatform.isMobile ? 'main' : 'sidebar';
      void this.activateTimelineView(location);
    });

    // Add command for archive modal
    this.addCommand({
      id: 'open-archive-modal',
      name: 'Archive social media post',
      callback: () => {
        this.openArchiveModal();
      }
    });

    // Add command for timeline view (sidebar)
    this.addCommand({
      id: 'open-timeline-view',
      name: 'Open timeline view (sidebar)',
      callback: () => {
        void this.activateTimelineView('sidebar');
      }
    });

    // Add command for timeline view (main area)
    this.addCommand({
      id: 'open-timeline-view-main',
      name: 'Open timeline view (main area)',
      callback: () => {
        void this.activateTimelineView('main');
      }
    });

    // Add command for refreshing timeline view
    this.addCommand({
      id: 'refresh-timeline-view',
      name: 'Refresh timeline view',
      callback: async () => {
        const timelineLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
        if (timelineLeaves.length === 0) {
          new Notice('No timeline view is open');
          return;
        }
        for (const leaf of timelineLeaves) {
          const view = leaf.view;
          if (view instanceof TimelineView) {
            await view.refresh();
          }
        }
        new Notice('Timeline refreshed');
      }
    });

    // Add command for batch archiving Google Maps links in current note
    this.addCommand({
      id: 'batch-archive-googlemaps',
      name: 'Archive all Google Maps links in current note',
      editorCallback: async (editor) => {
        const activeFile = this.app.workspace.getActiveFile();
        const sourceNotePath = activeFile?.path;
        await this.batchArchiveGoogleMapsLinks(editor.getValue(), sourceNotePath);
      }
    });

    // Batch transcription commands (with pause/resume/cancel)
    this.addCommand({
      id: 'batch-transcribe-videos',
      name: 'Batch transcribe videos in archive notes',
      callback: async () => {
        await this.startBatchTranscription('transcribe-only');
      }
    });

    this.addCommand({
      id: 'batch-download-transcribe',
      name: 'Batch download & transcribe videos in archive notes',
      callback: async () => {
        await this.startBatchTranscription('download-and-transcribe');
      }
    });

    this.addCommand({
      id: 'batch-pause-transcription',
      name: 'Pause batch transcription',
      checkCallback: (checking: boolean) => {
        const status = this.batchTranscriptionManager?.getStatus();
        if (status === 'running' || status === 'scanning') {
          if (!checking) this.batchTranscriptionManager?.pause();
          return true;
        }
        return false;
      }
    });

    this.addCommand({
      id: 'batch-resume-transcription',
      name: 'Resume batch transcription',
      checkCallback: (checking: boolean) => {
        if (this.batchTranscriptionManager?.getStatus() === 'paused') {
          if (!checking) void this.batchTranscriptionManager?.resume();
          return true;
        }
        return false;
      }
    });

    this.addCommand({
      id: 'batch-cancel-transcription',
      name: 'Cancel batch transcription',
      checkCallback: (checking: boolean) => {
        const status = this.batchTranscriptionManager?.getStatus();
        if (status === 'running' || status === 'scanning' || status === 'paused') {
          if (!checking) this.batchTranscriptionManager?.cancel();
          return true;
        }
        return false;
      }
    });

    // Add command for posting current note to timeline
    this.addCommand({
      id: 'post-to-timeline',
      name: 'Post',
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
          if (!checking) {
            void this.postCurrentNote();
          }
          return true;
        }
        return false;
      }
    });

    // Add command for posting and sharing current note
    this.addCommand({
      id: 'post-and-share',
      name: 'Post and Share',
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
          if (!checking) {
            void this.postAndShareCurrentNote();
          }
          return true;
        }
        return false;
      }
    });

    // Add settings tab
    this.settingTab = new SocialArchiverSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    // Initialize BatchTranscriptionManager (Desktop only)
    if (!ObsidianPlatform.isMobile) {
      this.initBatchTranscriptionManager();
    }

    // Register protocol handler for mobile share
    this.registerProtocolHandler();

    // Startup job recovery - check for incomplete jobs from previous session
    this.checkPendingJobs().catch(error => {
      console.error('[Social Archiver] Startup job recovery failed:', error);
    });

    // Sync completed pending jobs from server (for cross-device recovery)
    if (this.settings.enableServerPendingJobs) {
      this.syncPendingJobsFromServer().catch(error => {
        console.error('[Social Archiver] Server pending jobs sync failed:', error);
      });
    }

    // Start periodic job checker (interval from settings)
    this.jobCheckInterval = window.setInterval(() => {
      this.checkPendingJobs().catch(error => {
        console.error('[Social Archiver] Periodic job check failed:', error);
      });
    }, this.settings.jobCheckInterval);
  }

  /**
   * Clear all real-time event listeners to prevent duplicates
   */
  private clearRealtimeListeners(): void {
    this.eventRefs.forEach(ref => this.events.offref(ref));
    this.eventRefs = [];
  }

  /**
   * Set up event listeners for real-time WebSocket updates
   */
  private setupRealtimeListeners(): void {
    // Clear existing listeners first to prevent duplicates
    this.clearRealtimeListeners();

    // Listen for job_completed events
    this.eventRefs.push(
      this.events.on('ws:job_completed', async (message: any) => {

        const { jobId, result, metadata } = message;
        if (!jobId) {
          console.warn('[Social Archiver] job_completed event missing jobId');
          return;
        }

        // Check if already processing this job (prevent concurrent processing across devices)
        // Use workerJobId (jobId from WebSocket) for deduplication
        if (this.processingJobs.has(jobId)) {
          return;
        }

        // Try 1: Find job by worker job ID (fast path, same device)
        let job = await this.pendingJobsManager.getJobByWorkerJobId(jobId);

        // Try 2: Use metadata from WebSocket (different device, both online)
        if (!job && metadata) {
          // Create synthetic job for cross-device processing (single-write: no preliminary doc needed)
          job = {
            id: jobId, // Use workerJobId as local id
            url: metadata.url || '',
            platform: metadata.platform || 'unknown',
            status: 'processing',
            timestamp: Date.now(),
            retryCount: 0,
            metadata: {
              filePath: metadata.filePath, // May be undefined in single-write mode
              workerJobId: jobId,
              downloadMedia: metadata.archiveOptions?.downloadMedia,
              includeTranscript: metadata.archiveOptions?.includeTranscript,
              includeFormattedTranscript: metadata.archiveOptions?.includeFormattedTranscript,
            }
          };
          console.debug(`[Social Archiver] Processing job ${jobId} from WebSocket metadata (cross-device)`);
        }

        if (!job) {
          // No local job and no valid metadata - will be recovered on next app start via server sync
          console.debug(`[Social Archiver] Job ${jobId} not found locally, will sync on restart`);
          return;
        }

        // Mark as processing using workerJobId
        this.processingJobs.add(jobId);

        try {
          // Update local job status if it exists in PendingJobsManager
          const localJob = await this.pendingJobsManager.getJobByWorkerJobId(jobId);
          if (localJob) {
            await this.pendingJobsManager.updateJob(localJob.id, {
              status: 'completed',
              metadata: {
                ...localJob.metadata,
                completedAt: Date.now()
              }
            });
          }

          // Process the completed job immediately
          await this.processCompletedJob(job, { result });

          // Update archive banner
          const completedLocalJob = await this.pendingJobsManager.getJobByWorkerJobId(jobId);
          this.archiveJobTracker.completeJob(completedLocalJob?.id || jobId);

          // Clean up server pending job after successful processing (if enabled)
          if (this.settings.enableServerPendingJobs) {
            this.apiClient?.deletePendingJob(jobId).catch(err => {
              console.debug(`[Social Archiver] Failed to clean up server pending job ${jobId}:`, err);
            });
          }
        } catch (error) {
          console.error('[Social Archiver] Failed to process completed job:', error);
          const localJob = await this.pendingJobsManager.getJobByWorkerJobId(jobId);
          if (localJob) {
            await this.pendingJobsManager.updateJob(localJob.id, {
              status: 'failed',
              metadata: {
                ...localJob.metadata,
                lastError: error instanceof Error ? error.message : 'Failed to process job'
              }
            });
            this.archiveJobTracker.failJob(localJob.id, error instanceof Error ? error.message : 'Failed to process job');
          }
        } finally {
          // Remove from processing set
          this.processingJobs.delete(jobId);
        }
      })
    );

    // Listen for job_failed events (from profile crawl webhook when BrightData returns errors)
    this.eventRefs.push(
      this.events.on('ws:job_failed', async (message: any) => {
        const { jobId, error, handle } = message;

        // Update CrawlJobTracker for failed jobs (jobId is workerJobId)
        if (jobId) {
          const crawlJob = this.crawlJobTracker.getJobByWorkerJobId(jobId);
          if (crawlJob) {
            this.crawlJobTracker.failJob(crawlJob.jobId, error?.message || 'Unknown error');
          }
        }

        // Find job by worker job ID and update status in PendingJobsManager
        if (jobId) {
          const job = await this.pendingJobsManager.getJobByWorkerJobId(jobId);
          if (job) {
            await this.pendingJobsManager.updateJob(job.id, {
              status: 'failed',
              metadata: {
                ...job.metadata,
                lastError: error?.message || 'Unknown error',
                failedAt: Date.now(),
              },
            });
            // Update archive banner
            this.archiveJobTracker.failJob(job.id, error?.message || 'Unknown error');
          }
        }

        // Show user-friendly error notification
        const handleDisplay = handle ? `@${handle}` : 'the profile';
        const errorMessage = this.getReadableErrorMessage(error?.code, error?.message);
        new Notice(`Profile crawl failed for ${handleDisplay}: ${errorMessage}`, 8000);
      })
    );

    // Listen for truncation_warning events (when posts exceed max limit)
    this.eventRefs.push(
      this.events.on('ws:truncation_warning', (message: any) => {
        const { handle, totalFound, maxAllowed, truncatedCount, isProfileCrawl } = message;
        const handleDisplay = handle ? `@${handle}` : 'profile';
        const source = isProfileCrawl ? 'Profile crawl' : 'Subscription';

        new Notice(
          `⚠️ ${source} for ${handleDisplay}: Found ${totalFound} posts, but only ${maxAllowed} were archived. ${truncatedCount} posts exceeded the limit.`,
          10000
        );
      })
    );

    // Listen for connection status changes - catch up on missed sync items
    this.eventRefs.push(
      this.events.on('ws:connected', () => {
        // Process any pending sync queue items missed while offline
        if (this.settings.syncClientId) {
          this.scheduleTrackedTimeout(() => { void this.processPendingSyncQueue(); }, 2000);
        }
      })
    );

    this.eventRefs.push(
      this.events.on('ws:closed', () => {
        // no-op: handled by reconnect logic
      })
    );

    this.eventRefs.push(
      this.events.on('ws:error', (error: any) => {
        console.error('[Social Archiver] WebSocket error:', error);
      })
    );

    // Listen for subscription_post events (from SubscriptionRunner webhook)
    // WebSocket message contains full post data, so save directly without KV fetch
    // Uses batch processing to prevent timeline flicker when multiple posts arrive
    this.eventRefs.push(
      this.events.on('ws:subscription_post', async (message: any) => {
        // If message contains post data, save it directly (bypasses KV eventual consistency)
        if (message.post && message.destinationFolder) {
          try {
            // Suppress timeline refresh on first post of a batch
            if (this.wsPostBatchCount === 0) {
              // Track workerJobId when first post of profile crawl batch arrives
              if (message.isProfileCrawl && message.subscriptionId) {
                this.currentCrawlWorkerJobId = message.subscriptionId;
              }

              const timelineLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
              for (const leaf of timelineLeaves) {
                const view = leaf.view;
                if (view instanceof TimelineView) {
                  view.suppressAutoRefresh();
                }
              }
            }
            this.wsPostBatchCount++;

            // Track profile crawl progress via workerJobId
            if (message.isProfileCrawl && message.subscriptionId) {
              this.crawlJobTracker.incrementProgressByWorkerJobId(message.subscriptionId);
            }

            const pendingPost = {
              id: message.pendingPostId || crypto.randomUUID(), // Use server-side ID if available
              subscriptionId: message.subscriptionId,
              subscriptionName: message.subscriptionName,
              post: message.post,
              destinationFolder: message.destinationFolder,
              archivedAt: new Date().toISOString(),
              isProfileCrawl: message.isProfileCrawl || false,
            };

            const saved = await this.saveSubscriptionPost(pendingPost);
            if (saved) {
              // Acknowledge the pending post to remove it from KV (prevents duplicate processing on app restart)
              if (message.pendingPostId && this.subscriptionManager) {
                try {
                  await this.subscriptionManager.acknowledgePendingPosts([message.pendingPostId]);
                } catch {
                  // Non-critical: post is saved, KV cleanup will happen eventually
                }
              }
            }

            // Reset batch timer - resume timeline after 3s of no new posts
            if (this.wsPostBatchTimer) {
              window.clearTimeout(this.wsPostBatchTimer);
            }
            this.wsPostBatchTimer = window.setTimeout(() => {
              const batchSize = this.wsPostBatchCount;
              this.wsPostBatchCount = 0;
              this.wsPostBatchTimer = undefined;

              // Complete any active crawl jobs based on the batch that just finished
              if (this.currentCrawlWorkerJobId) {
                const crawlJob = this.crawlJobTracker.getJobByWorkerJobId(this.currentCrawlWorkerJobId);
                if (crawlJob) {
                  this.crawlJobTracker.completeJob(crawlJob.jobId, crawlJob.receivedPosts);
                  // Also remove from PendingJobsManager to prevent restoration on reload
                  // Note: Job may already be removed by profile_crawl_complete handler
                  this.pendingJobsManager.removeJob(crawlJob.jobId).catch(() => {
                    // Ignore - job was likely already removed by profile_crawl_complete handler
                  });
                }
                this.currentCrawlWorkerJobId = undefined;
              }

              // Resume timeline refresh
              const timelineLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
              for (const leaf of timelineLeaves) {
                const view = leaf.view;
                if (view instanceof TimelineView) {
                  view.resumeAutoRefresh(); // This will trigger refresh
                }
              }

              if (batchSize > 1) {
                new Notice(`Archived ${batchSize} new posts`);
              }
            }, 3000);
          } catch (error) {
            console.error('[Social Archiver] Failed to save WebSocket post:', error);
            // Fall back to KV sync after delay
            await new Promise(resolve => setTimeout(resolve, 2000));
            await this.syncSubscriptionPosts();
          }
        } else {
          // Fallback: fetch from KV (for older message format)
          await new Promise(resolve => setTimeout(resolve, 1000));
          await this.syncSubscriptionPosts();
        }
      })
    );

    // Listen for profile_metadata events (when posts fail to load but profile data is available)
    this.eventRefs.push(
      this.events.on('ws:profile_metadata', async (message: any) => {
        // Create profile-only note when posts fail to load
        if (message.metadata && message.profileUrl) {
          try {
            await this.createProfileNote(message);
          } catch (error) {
            console.error('[Social Archiver] Failed to create profile note:', error);
          }
        }
      })
    );

    // Listen for profile_crawl_complete events (from Fediverse direct API crawls)
    // Fediverse crawls complete synchronously and send posts via WebSocket
    this.eventRefs.push(
      this.events.on('ws:profile_crawl_complete', async (message: any) => {
        const { jobId, handle, platform, posts, stats, isFediverse, isYouTube, isBlog, isXcancel } = message;
        // Free API platforms: Fediverse (Bluesky, Mastodon), YouTube (RSS), Blog (Generic RSS), X (xcancel RSS)
        const isFreeApiPlatform = isFediverse || isYouTube || isBlog || isXcancel;

        // Update CrawlJobTracker status
        // For Fediverse/YouTube, WebSocket event may arrive BEFORE API response (sync crawl)
        // So the job might not be registered yet in CrawlJobTracker
        if (jobId) {
          const postCount = stats?.processedCount || posts?.length || 0;

          if (postCount > 0 || stats?.allDuplicates) {
            // Try to find and complete existing job
            const directJob = this.crawlJobTracker.getJob(jobId);
            if (directJob) {
              this.crawlJobTracker.completeJob(jobId, postCount);
            } else {
              const internalJobId = this.crawlJobTracker.getInternalJobIdByWorkerJobId(jobId);
              if (internalJobId) {
                this.crawlJobTracker.completeJob(internalJobId, postCount);
              } else {
                // Fallback: complete any crawling job for same handle
                const allJobs = this.crawlJobTracker.getAllJobs();
                const matchingJob = allJobs.find(j => j.handle === handle && j.status === 'crawling');
                if (matchingJob) {
                  this.crawlJobTracker.completeJob(matchingJob.jobId, postCount);
                } else {
                  // For Fediverse/YouTube: WebSocket arrives before startJob() is called
                  // Register a completed job immediately so no stale banner appears
                  if (isFreeApiPlatform && handle) {
                    this.crawlJobTracker.startJob({
                      jobId,
                      handle,
                      platform: platform || 'bluesky',
                      estimatedPosts: postCount,
                    }, jobId);
                    this.crawlJobTracker.completeJob(jobId, postCount);
                  }
                }
              }
            }
          }
        }

        // Process posts from Fediverse/YouTube crawl (free API platforms)
        if (isFreeApiPlatform && posts && posts.length > 0) {
          // Get destination folder from pending job or use default
          const pendingJob = await this.pendingJobsManager?.getJob(jobId);
          const destinationFolder = (pendingJob?.metadata as any)?.destinationFolder
            || this.settings.archivePath
            || 'Social Archives';

          // Suppress timeline refresh during batch processing
          const timelineLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
          for (const leaf of timelineLeaves) {
            const view = leaf.view;
            if (view instanceof TimelineView) {
              view.suppressAutoRefresh();
            }
          }

          // Save each post
          let savedCount = 0;
          for (const post of posts) {
            try {
              const pendingPost = {
                id: crypto.randomUUID(),
                subscriptionId: jobId,
                subscriptionName: `Profile Crawl: @${handle}`,
                post,
                destinationFolder,
                archivedAt: new Date().toISOString(),
                isProfileCrawl: true,
              };

              const saved = await this.saveSubscriptionPost(pendingPost);
              if (saved) {
                savedCount++;
              }
            } catch {
              // Continue with next post if one fails
            }
          }

          // Resume timeline refresh after batch
          for (const leaf of timelineLeaves) {
            const view = leaf.view;
            if (view instanceof TimelineView) {
              view.resumeAutoRefresh();
            }
          }

          // Show completion notice
          new Notice(`✅ Archived ${savedCount} posts from @${handle}`, 5000);
        }

        // Remove pending job from PendingJobsManager
        // Skip for Fediverse (no job was added), but include YouTube/Blog for legacy job cleanup
        // This ensures cleanup even if the batch timer from subscription_post doesn't fire
        // (e.g., user closes Obsidian quickly after crawl completes)
        const isFediverseOnly = isFediverse && !isYouTube && !isBlog;
        if (jobId && this.pendingJobsManager && !isFediverseOnly) {
          try {
            await this.pendingJobsManager.removeJob(jobId);
          } catch {
            // Job might not exist if already removed by batch timer
          }
        }
      })
    );

    // Listen for client_sync events (from mobile app sync)
    // Receives archives saved on mobile and syncs them to the vault
    this.eventRefs.push(
      this.events.on('ws:client_sync', async (message: unknown) => {
        // Type guard for the message structure
        const msg = message as { type: string; data: ClientSyncEventData } | undefined;
        if (!msg?.data) {
          console.warn('[Social Archiver] Invalid client_sync message format');
          return;
        }

        const { queueId, archiveId, clientId } = msg.data;

        // Verify this event is for us
        if (clientId !== this.settings.syncClientId) {
          console.debug('[Social Archiver] Ignoring sync event for different client:', clientId);
          return;
        }

        const displayTitle = msg.data.archive?.title || msg.data.archive?.authorName || msg.data.archive?.platform || 'Archive';
        new Notice(`📱 Mobile sync: ${displayTitle}`, 3000);

        await this.processSyncQueueItem(queueId, archiveId, clientId);
      })
    );
  }

  /**
   * Process a single sync queue item: fetch archive, save to vault, acknowledge
   * Shared by real-time WebSocket handler and catch-up polling
   */
  private isArchiveNotFoundError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const enriched = error as Error & { code?: string; status?: number };
    return enriched.status === 404 || enriched.code === 'ARCHIVE_NOT_FOUND' || /archive not found/i.test(enriched.message);
  }

  private async fetchUserArchiveWithRetry(archiveId: string): Promise<UserArchive> {
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }

    let lastError: unknown;

    for (let attempt = 1; attempt <= MOBILE_SYNC_ARCHIVE_FETCH_MAX_ATTEMPTS; attempt++) {
      try {
        const response = await this.apiClient.getUserArchive(archiveId);
        if (!response.archive) {
          throw new Error('Failed to fetch archive data');
        }
        return response.archive;
      } catch (error) {
        lastError = error;
        const shouldRetry = this.isArchiveNotFoundError(error) && attempt < MOBILE_SYNC_ARCHIVE_FETCH_MAX_ATTEMPTS;

        if (!shouldRetry) {
          throw error;
        }

        const delay = MOBILE_SYNC_ARCHIVE_FETCH_RETRY_DELAY * attempt;
        console.warn(
          `[Social Archiver] Archive ${archiveId} not available yet (attempt ${attempt}/${MOBILE_SYNC_ARCHIVE_FETCH_MAX_ATTEMPTS}), retrying in ${delay}ms`
        );
        await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to fetch archive data');
  }

  private schedulePendingSyncRetry(queueId: string, archiveId: string): void {
    if (this.scheduledMobileSyncRetries.has(queueId)) {
      return;
    }

    this.scheduledMobileSyncRetries.add(queueId);
    this.scheduleTrackedTimeout(() => {
      this.scheduledMobileSyncRetries.delete(queueId);
      this.processPendingSyncQueue().catch((error) => {
        console.error('[Social Archiver] Deferred mobile sync retry failed:', {
          queueId,
          archiveId,
          error,
        });
      });
    }, MOBILE_SYNC_PENDING_RETRY_DELAY);
  }

  private async processSyncQueueItem(queueId: string, archiveId: string, clientId: string): Promise<boolean> {
    try {
      this.scheduledMobileSyncRetries.delete(queueId);

      // 1. Fetch full archive data from server (with retries for transient 404 replication lag)
      const archive = await this.fetchUserArchiveWithRetry(archiveId);

      // 2. Dedup guard: skip if we recently archived this URL locally
      const syncUrl = archive.originalUrl;
      if (this.hasRecentlyArchivedUrl(syncUrl)) {
        console.debug('[Social Archiver] Skipping duplicate sync for recently archived URL:', syncUrl);
        if (!this.apiClient) {
          throw new Error('API client not initialized');
        }
        await this.apiClient.ackSyncItem(queueId, clientId);
        return true;
      }

      // 3. Convert UserArchive to PostData format
      const postData = this.convertUserArchiveToPostData(archive);

      // 4. Save to vault using saveSubscriptionPost (handles media download, file path generation, etc.)
      const pendingPost: PendingPost = {
        id: queueId,
        subscriptionId: `mobile-sync-${archiveId}`,
        subscriptionName: 'Mobile Sync',
        post: postData,
        destinationFolder: this.settings.archivePath,
        archivedAt: new Date().toISOString(),
      };

      const saved = await this.saveSubscriptionPost(pendingPost);

      if (saved) {
        // 5. Acknowledge sync completion
        if (!this.apiClient) {
          throw new Error('API client not initialized');
        }
        await this.apiClient.ackSyncItem(queueId, clientId);
        const displayTitle = archive.title || archive.authorName || archive.platform || 'Archive';
        new Notice(`✅ Saved to vault: ${displayTitle}`, 3000);
        return true;
      } else {
        throw new Error('Failed to save to vault');
      }

    } catch (error) {
      if (this.isArchiveNotFoundError(error)) {
        console.warn('[Social Archiver] Archive not found during client sync; leaving queue item pending for retry', {
          queueId,
          archiveId,
          clientId,
        });
        this.schedulePendingSyncRetry(queueId, archiveId);
        return false;
      }

      console.error('[Social Archiver] Client sync failed:', error);
      new Notice(`❌ Failed to sync: ${error instanceof Error ? error.message : 'Unknown error'}`, 5000);

      // Report failure to server
      if (this.apiClient) {
        try {
          await this.apiClient.failSyncItem(queueId, clientId, error instanceof Error ? error.message : 'Unknown error');
        } catch {
          // Non-fatal
        }
      }
      return false;
    }
  }

  /**
   * Catch-up: poll pending sync queue items missed while Obsidian was offline
   * Called on WebSocket reconnection and plugin startup
   */
  private async processPendingSyncQueue(): Promise<void> {
    const clientId = this.settings.syncClientId;
    if (!clientId || !this.apiClient || this.isSyncingMobileQueue) {
      return;
    }

    this.isSyncingMobileQueue = true;

    try {
      const { items } = await this.apiClient.getSyncQueue(clientId);
      const pendingItems = items.filter(item => item.status === 'pending');

      if (pendingItems.length === 0) {
        return;
      }

      console.debug(`[Social Archiver] Catch-up: ${pendingItems.length} pending sync item(s) found`);
      new Notice(`📱 Syncing ${pendingItems.length} missed archive(s) from mobile...`, 4000);

      let successCount = 0;
      for (const item of pendingItems) {
        const success = await this.processSyncQueueItem(item.queueId, item.archiveId, clientId);
        if (success) {
          successCount++;
        }
      }

      if (successCount > 0) {
        console.debug(`[Social Archiver] Catch-up complete: ${successCount}/${pendingItems.length} synced`);
      }
    } catch (error) {
      console.error('[Social Archiver] Failed to process pending sync queue:', error);
    } finally {
      this.isSyncingMobileQueue = false;
    }
  }

  /**
   * Convert UserArchive from server to PostData format for vault processing
   */
  private normalizeHandle(handle?: string | null): string | undefined {
    if (!handle) return undefined;
    const normalized = handle.trim().replace(/^@/, '');
    return normalized.length > 0 ? normalized : undefined;
  }

  /**
   * Build profile URL from platform + handle as fallback when API doesn't return author URL.
   */
  private buildProfileUrl(platform: Platform, handle?: string): string {
    if (!handle) return '';

    switch (platform) {
      case 'x':
        return `https://x.com/${handle}`;
      case 'instagram':
        return `https://www.instagram.com/${handle}`;
      case 'facebook':
        return `https://www.facebook.com/${handle}`;
      case 'threads':
        return `https://www.threads.net/@${handle}`;
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

  private convertUserArchiveToPostData(archive: UserArchive): PostData {
    const platform = archive.platform as Platform;
    const authorUsername = this.normalizeHandle(archive.authorHandle);
    const authorHandle = authorUsername ? `@${authorUsername}` : undefined;
    const authorUrl =
      archive.authorUrl ||
      this.buildProfileUrl(platform, authorUsername) ||
      archive.originalUrl ||
      '';

    const quoted = archive.quotedPost;
    const quotedPlatform = quoted?.platform as Platform | undefined;
    const quotedUsername = this.normalizeHandle(quoted?.author?.handle);
    const quotedHandle = quotedUsername ? `@${quotedUsername}` : undefined;
    const quotedUrl = quoted?.url || '';
    const quotedAuthorUrl =
      (quotedPlatform ? this.buildProfileUrl(quotedPlatform, quotedUsername) : '') ||
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
        html: undefined,
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
            url: c.author.url || (c.author.handle ? this.buildProfileUrl(platform, c.author.handle) : '') || '',
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
                url: r.author.url || (r.author.handle ? this.buildProfileUrl(platform, r.author.handle) : '') || '',
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

  async onunload(): Promise<void> {
    // Kill all spawned child processes (yt-dlp, whisper, etc.)
    const killedCount = ProcessManager.killAll();
    if (killedCount > 0) {
      console.debug(`[SocialArchiver] Killed ${killedCount} active processes on unload`);
    }

    // Clear WebSocket listeners
    this.clearRealtimeListeners();

    // Disconnect WebSocket
    this.realtimeClient?.disconnect();

    // Stop periodic job checker
    if (this.jobCheckInterval) {
      window.clearInterval(this.jobCheckInterval);
      this.jobCheckInterval = undefined;
    }

    // Clear sync debounce timer
    if (this.syncDebounceTimer) {
      window.clearTimeout(this.syncDebounceTimer);
      this.syncDebounceTimer = undefined;
    }

    // Clear WebSocket post batch timer
    if (this.wsPostBatchTimer) {
      window.clearTimeout(this.wsPostBatchTimer);
      this.wsPostBatchTimer = undefined;
    }

    // Dispose CrawlJobTracker (clears completion timers and listeners)
    this.crawlJobTracker?.dispose();

    // Dispose ArchiveJobTracker
    this.archiveJobTracker?.destroy();

    // Stop Naver local subscription poller (blog + cafe)
    void this.naverPoller?.stop();

    // Stop Brunch local subscription poller
    void this.brunchPoller?.stop();

    // Stop Webtoon sync service
    void this.webtoonSyncService?.stop();

    // Clear all tracked pending timeouts
    for (const id of this.pendingTimeouts) {
      window.clearTimeout(id);
    }
    this.pendingTimeouts.clear();

    // Dispose batch transcription
    this.batchTranscriptionNotice?.dismiss();
    this.batchTranscriptionNotice = null;
    this.batchTranscriptionManager?.dispose();
    this.batchTranscriptionManager = null;

    // Clear dedup URL set
    this.recentlyArchivedUrls.clear();
    this.scheduledMobileSyncRetries.clear();

    // Cleanup services
    await this.subscriptionManager?.dispose();
    this.pendingJobsManager?.dispose();
    await this.orchestrator?.dispose();
    await this.apiClient?.dispose();
  }

  async loadSettings(): Promise<void> {
    const savedData = await this.loadData() || {};
    this.settings = migrateSettings(savedData as Partial<SocialArchiverSettings>);

    // Rebuild naverCookie from individual fields (in case migration populated them)
    this.rebuildNaverCookie();
  }

  /**
   * Rebuild the naverCookie string from nidAut and nidSes fields
   */
  private rebuildNaverCookie(): void {
    const parts: string[] = [];
    if (this.settings.nidAut) {
      parts.push(`NID_AUT=${this.settings.nidAut}`);
    }
    if (this.settings.nidSes) {
      parts.push(`NID_SES=${this.settings.nidSes}`);
    }
    this.settings.naverCookie = parts.join('; ');
  }

  async saveSettings(): Promise<void> {
    await this.saveSettingsPartial({}, { reinitialize: true, notify: true });
  }

  async saveSettingsPartial(
    partial: Partial<SocialArchiverSettings>,
    options: { reinitialize?: boolean; notify?: boolean } = {}
  ): Promise<void> {
    this.settings = { ...this.settings, ...partial };
    await this.saveData(this.settings);

    if (options.reinitialize) {
      await this.initializeServices();
    }

    if (options.notify) {
      this.events.trigger('settings-changed', this.settings);
    }
  }

  /**
   * Check for version updates and show release notes modal if applicable
   *
   * Logic:
   * 1. If debugAlwaysShowReleaseNotes is true, always show (dev mode)
   * 2. Compare manifest.version with settings.lastSeenVersion
   * 3. If same version, skip (no update)
   * 4. If showReleaseNotes setting is false, just update lastSeenVersion
   * 5. If RELEASE_NOTES has entry for current version, show modal
   * 6. If no entry exists (minor patch), update lastSeenVersion silently
   */
  private async checkAndShowReleaseNotes(): Promise<void> {
    const currentVersion = this.manifest.version;
    const lastSeenVersion = this.settings.lastSeenVersion;
    const isDebugMode = this.settings.debugAlwaysShowReleaseNotes;

    // Check if release notes exist for this version
    const releaseNote = RELEASE_NOTES[currentVersion];

    // DEV: Always show if debug mode is enabled and release notes exist
    if (isDebugMode && releaseNote) {
      const modal = new ReleaseNotesModal(this.app, currentVersion, releaseNote);
      modal.open();
      return;
    }

    // Same version - no update needed
    if (currentVersion === lastSeenVersion) {
      return;
    }

    // User disabled release notes - just update the version silently
    if (!this.settings.showReleaseNotes) {
      await this.saveSettingsPartial({ lastSeenVersion: currentVersion });
      return;
    }

    if (!releaseNote) {
      // No release notes for this version (minor patch) - update silently
      await this.saveSettingsPartial({ lastSeenVersion: currentVersion });
      return;
    }

    // Show release notes modal
    const modal = new ReleaseNotesModal(
      this.app,
      currentVersion,
      releaseNote,
      () => {
        // Update lastSeenVersion after modal closes
        void this.saveSettingsPartial({ lastSeenVersion: currentVersion });
      }
    );
    modal.open();
  }

  /**
   * Sync user credits and tier from server on plugin load
   * This ensures local settings stay in sync when tier changes server-side
   */
  private async syncUserCreditsOnLoad(): Promise<void> {
    // Only sync if user is authenticated
    if (!this.settings.authToken || !this.settings.isVerified) {
      return;
    }

    try {
      await refreshUserCredits(this);
    } catch (error) {
      // Silently fail - don't block plugin initialization
      console.warn('[Social Archiver] Failed to sync user credits:', error);
    }
  }

  /**
   * Initialize API client and orchestrator
   */
  private async initializeServices(): Promise<void> {
    // Clean up existing services
    await this.apiClient?.dispose();
    await this.orchestrator?.dispose();
    this.pendingJobsManager?.dispose();

    try {
      // Initialize API client with hardcoded production endpoint
      this.apiClient = new WorkersAPIClient({
        endpoint: API_ENDPOINT,
        licenseKey: this.settings.licenseKey,
        authToken: this.settings.authToken,
        pluginVersion: this.manifest.version,
      });
      await this.apiClient.initialize();

      // Initialize PendingJobsManager (for async archiving)
      this.pendingJobsManager = new PendingJobsManager(this.app);
      await this.pendingJobsManager.initialize();

      // Initialize CrawlJobTracker for profile crawl progress tracking
      this.crawlJobTracker = new CrawlJobTracker();

      // Initialize ArchiveJobTracker for archive progress banner
      this.archiveJobTracker = new ArchiveJobTracker();

      // Initialize TagStore for user-defined tag management
      this.tagStore = new TagStore(this.app, this);

      // Restore active jobs from previous session
      const allPendingJobs = await this.pendingJobsManager.getJobs();
      const activeProfileCrawls = allPendingJobs.filter(
        job => job.metadata?.type === 'profile-crawl' && job.status === 'processing'
      );
      if (activeProfileCrawls.length > 0) {
        this.crawlJobTracker.restoreFromPendingJobs(activeProfileCrawls);
      }
      this.archiveJobTracker.restoreFromPendingJobs(allPendingJobs);

      // Initialize LinkPreviewExtractor (always available, no API dependency)
      this.linkPreviewExtractor = new LinkPreviewExtractor({
        maxLinks: 2, // Extract up to 2 URLs per post
        excludeImages: true,
        excludePlatformUrls: false // Include platform URLs for link previews
      });
      await this.linkPreviewExtractor.initialize();

      // Initialize ArchiveOrchestrator with all required services
      // Import services dynamically to avoid circular dependencies
      const { ArchiveService } = await import('./services/ArchiveService');
      const { MediaHandler } = await import('./services/MediaHandler');

      const archiveService = new ArchiveService({
        apiClient: this.apiClient as any, // WorkersAPIClient implements compatible interface
      });

      const markdownConverter = new MarkdownConverter({
        frontmatterSettings: this.settings.frontmatter,
      });

      const vaultManager = new VaultManager({
        vault: this.app.vault,
        app: this.app,
        basePath: this.settings.archivePath || 'Social Archives',
        organizationStrategy: getVaultOrganizationStrategy(this.settings.archiveOrganization),
      });

      const mediaHandler = new MediaHandler({
        vault: this.app.vault,
        app: this.app,
        workersClient: this.apiClient,
        basePath: this.settings.mediaPath || 'attachments/social-archives',
        optimizeImages: true,
        imageQuality: 0.8,
        maxImageDimension: 2048
      });

      // Create AuthorAvatarService for author profile image management
      this.authorAvatarService = new AuthorAvatarService({
        vault: this.app.vault,
        app: this.app,
        settings: this.settings,
        workerApiUrl: API_ENDPOINT, // Use Worker proxy for CORS-blocked domains (Instagram, etc.)
      });

      this.orchestrator = new ArchiveOrchestrator({
        archiveService,
        markdownConverter,
        vaultManager,
        mediaHandler,
        linkPreviewExtractor: this.linkPreviewExtractor,
        authorAvatarService: this.authorAvatarService,
        settings: this.settings,
      });

      await this.orchestrator.initialize();

      // Initialize RealtimeClient for real-time job updates (only if username is configured)
      if (this.settings.username) {
        this.realtimeClient = new RealtimeClient(
          API_ENDPOINT,
          this.settings.username,
          this.events
        );

        // Set up event listeners for real-time updates
        this.setupRealtimeListeners();

        // Connect to WebSocket
        this.realtimeClient.connect();
      }

      // Initialize SubscriptionManager for pending posts sync
      if (this.settings.authToken && this.settings.username) {
        this.subscriptionManager = new SubscriptionManager({
          apiBaseUrl: API_ENDPOINT,
          authToken: this.settings.authToken,
          enablePolling: false // Disable polling, sync manually
        });
        await this.subscriptionManager.initialize();

        // Sync pending subscription posts on startup (delayed to not block UI)
        this.scheduleTrackedTimeout(() => { void this.syncSubscriptionPosts(); }, 3000);

        // Catch up on pending mobile sync queue items missed while offline
        if (this.settings.syncClientId) {
          this.scheduleTrackedTimeout(() => { void this.processPendingSyncQueue(); }, 5000);
        }

        // Start Naver local subscription poller (blog + cafe)
        // Only polls subscriptions with localFetchRequired=true using local cookies
        if (this.settings.naverCookie) {
          // Stop existing poller if any (prevent duplicates)
          if (this.naverPoller) {
            console.debug('[Social Archiver] Stopping existing NaverPoller before restart');
            void this.naverPoller.stop();
          }
          this.naverPoller = new NaverSubscriptionPoller(this);
          void this.naverPoller.start();
        }

        // Start Brunch local subscription poller
        // Brunch is public - no cookie required
        {
          // Stop existing poller if any (prevent duplicates)
          if (this.brunchPoller) {
            console.debug('[Social Archiver] Stopping existing BrunchPoller before restart');
            void this.brunchPoller.stop();
          }
          this.brunchPoller = new BrunchSubscriptionPoller(this);
          void this.brunchPoller.start();
        }

        // Start Webtoon sync service
        // Polls Workers API for pending webtoon posts and syncs to vault
        {
          // Stop existing service if any (prevent duplicates)
          if (this.webtoonSyncService) {
            console.debug('[Social Archiver] Stopping existing WebtoonSyncService before restart');
            void this.webtoonSyncService.stop();
          }
          this.webtoonSyncService = new WebtoonSyncService(this);
          void this.webtoonSyncService.start();
        }
      }

    } catch (error) {
      new Notice('Failed to initialize Social Archiver. Check console for details.');
    }
  }

  /**
   * Sync pending subscription posts from server to vault
   */
  async syncSubscriptionPosts(): Promise<void> {
    if (!this.subscriptionManager || !this.subscriptionManager.isInitialized) {
      return;
    }

    // If already syncing, debounce: schedule a new sync after current one finishes
    if (this.isSyncingSubscriptions) {
      // Clear any existing debounce timer
      if (this.syncDebounceTimer) {
        window.clearTimeout(this.syncDebounceTimer);
      }
      // Schedule a sync after a short delay (to coalesce multiple rapid calls)
      this.syncDebounceTimer = window.setTimeout(() => {
        this.syncDebounceTimer = undefined;
        void this.syncSubscriptionPosts();
      }, 500);
      return;
    }

    this.isSyncingSubscriptions = true;

    // Suppress timeline auto-refresh during batch operations to prevent flicker
    const timelineLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
    for (const leaf of timelineLeaves) {
      const view = leaf.view;
      if (view instanceof TimelineView) {
        view.suppressAutoRefresh();
      }
    }

    try {
      const result = await this.subscriptionManager.syncPendingPosts(
        async (pendingPost: PendingPost) => {
          return this.saveSubscriptionPost(pendingPost);
        }
      );

      if (result.total > 0) {
        // Show a summary notice when multiple posts were processed in a batch
        if (result.total > 1) {
          new Notice(
            `Subscription sync complete: saved ${result.saved}/${result.total}` +
            (result.failed ? `, failed ${result.failed}` : '')
          );
        }
        // Only refresh timeline views if we actually saved new posts
        for (const leaf of timelineLeaves) {
          const view = leaf.view;
          if (view instanceof TimelineView) {
            view.resumeAutoRefresh();
          }
        }
      } else {
        // No posts synced, just resume auto-refresh without triggering a refresh
        for (const leaf of timelineLeaves) {
          const view = leaf.view;
          if (view instanceof TimelineView) {
            view.resumeAutoRefresh(false); // Pass false to not trigger refresh
          }
        }
      }
    } catch (error) {
      console.error('[Social Archiver] Failed to sync subscription posts:', error);
      new Notice('Subscription sync failed. Check console for details.');
      // On error, resume without refresh
      for (const leaf of timelineLeaves) {
        const view = leaf.view;
        if (view instanceof TimelineView) {
          view.resumeAutoRefresh(false);
        }
      }
    } finally {
      this.isSyncingSubscriptions = false;
    }
  }

  /**
   * Create a profile-only note when posts fail to load
   * Contains author metadata (bio, avatar, followers) without timeline posts
   */
  private async createProfileNote(message: any): Promise<void> {
    const { metadata, handle, platform, profileUrl } = message;

    // Download avatar if available
    let localAvatarPath: string | null = null;
    if (this.settings.downloadAuthorAvatars && this.authorAvatarService && metadata.avatarUrl) {
      try {
        localAvatarPath = await this.authorAvatarService.downloadAndSaveAvatar(
          metadata.avatarUrl,
          platform,
          handle,
          this.settings.overwriteAuthorAvatar
        );
      } catch {
        // Continue without avatar
      }
    }

    // Generate profile note content
    const now = new Date();
    const displayName = metadata.displayName || handle;

    // Build frontmatter
    const frontmatter = [
      '---',
      'type: profile',
      `platform: ${platform}`,
      `handle: "${handle}"`,
      `displayName: "${displayName}"`,
      `profileUrl: "${profileUrl}"`,
      metadata.bio ? `bio: "${metadata.bio.replace(/"/g, '\\"').replace(/\n/g, ' ')}"` : null,
      metadata.followers !== undefined ? `followers: ${metadata.followers}` : null,
      metadata.following !== undefined ? `following: ${metadata.following}` : null,
      metadata.postsCount !== undefined ? `postsCount: ${metadata.postsCount}` : null,
      metadata.verified !== undefined ? `verified: ${metadata.verified}` : null,
      metadata.location ? `location: "${metadata.location}"` : null,
      localAvatarPath ? `avatar: "${localAvatarPath}"` : null,
      metadata.avatarUrl ? `avatarUrl: "${metadata.avatarUrl}"` : null,
      `crawledAt: "${now.toISOString()}"`,
      'tags:',
      `  - social/${platform}`,
      '  - profile',
      '---',
    ].filter(Boolean).join('\n');

    // Build minimal content (all data is in frontmatter, body is just for human readability)
    const content = `${frontmatter}

[Open Profile](${profileUrl})
`;

    // Save to vault
    const archivePath = this.settings.archivePath || 'Social Archives';
    const fileName = `Profile - @${handle}.md`;
    const filePath = `${archivePath}/Profiles/${fileName}`;

    // Ensure folder exists
    const folderPath = `${archivePath}/Profiles`;
    if (!this.app.vault.getAbstractFileByPath(folderPath)) {
      await this.app.vault.createFolder(folderPath);
    }

    // Check if file exists
    const existingFile = this.app.vault.getAbstractFileByPath(filePath);
    if (existingFile && existingFile instanceof TFile) {
      // Update existing file
      await this.app.vault.modify(existingFile, content);
    } else {
      // Create new file
      await this.app.vault.create(filePath, content);
    }

    // Show notice
    new Notice(`📋 Profile @${handle} saved to ${filePath}`, 5000);
  }

  /**
   * Save a single subscription post to vault
   */
  private async saveSubscriptionPost(pendingPost: PendingPost): Promise<boolean> {
    try {
      const { VaultStorageService } = await import('./services/VaultStorageService');
      const { MediaHandler } = await import('./services/MediaHandler');

      // Generate proper file path for subscription post
      // Uses archive organization setting for most platforms
      // (webtoon keeps series/episode structure)
      const post = pendingPost.post;

      // Skip invalid posts (profile metadata without proper author info)
      const rawAuthorName = post.author?.name || post.author?.handle || '';
      if (!rawAuthorName || rawAuthorName.toLowerCase() === 'unknown') {
        return true; // Return true so acknowledge proceeds and removes from KV
      }

      // Extract title from post (similar to VaultManager logic)
      let title = '';
      if (post.title && post.title.trim().length > 0) {
        title = post.title.trim().substring(0, 50).replace(/[\\/:*?"<>|]/g, '-');
      } else if (post.content?.text && post.content.text.trim().length > 0) {
        // Get first meaningful line from content
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
      });

      // Use displayName from platform definitions (e.g., 'naver-webtoon' -> 'Naver Webtoon')
      const platformName = post.platform
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        ? getPlatformName(post.platform as Platform)
        : 'Unknown';

      // Determine file path based on platform type
      let targetFilePath: string;

      if ((post.platform === 'naver-webtoon' || post.platform === 'webtoons') && post.series) {
        // Webtoon: Use series/episode structure for better organization
        // Format: {basePath}/{Platform Name}/{seriesTitle}/{episodeNo} - {subtitle}.md
        const seriesTitle = (post.series.title || 'Unknown Series')
          .replace(/[\\/:*?"<>|]/g, '-')
          .trim();
        const episodeNo = String(post.series.episode || 0).padStart(3, '0');
        const subtitle = ((post.raw as any)?.subtitle || titlePart || 'Episode')
          .replace(/[\\/:*?"<>|]/g, '-')
          .substring(0, 50)
          .trim();
        const webtoonFileName = `${episodeNo} - ${subtitle}.md`;
        targetFilePath = normalizePath(`${basePath}/${platformName}/${seriesTitle}/${webtoonFileName}`);
      } else {
        // Default: Use configured archive organization strategy
        targetFilePath = pathVaultManager.generateFilePath(post);
      }

      // Skip if file already exists (prevents race condition between WebSocket and KV sync)
      const existingFile = this.app.vault.getAbstractFileByPath(targetFilePath);
      if (existingFile) {
        return true; // Return true so acknowledge proceeds and removes from KV
      }

      // Download media through Workers proxy if post has media
      // Declare mediaResults outside of try block so it's accessible for savePost
      let mediaResults: import('./services/MediaHandler').MediaResult[] | undefined;
      let mediaHandledLocally = false; // Flag to skip Worker proxy for local downloads

      // For podcasts, skip audio download - show "Download Audio" banner in timeline instead
      // Filter out audio media for podcasts, keep images/thumbnails
      const mainMediaToDownload = post.platform === 'podcast'
        ? post.media?.filter((m: typeof post.media[number]) => m.type !== 'audio')
        : post.media;

      // Collect quoted post media for download (Facebook shared posts, X quoted tweets, etc.)
      const quotedMediaToDownload = (post.quotedPost?.media && post.quotedPost.media.length > 0
        && post.quotedPost.platform !== 'youtube' && post.quotedPost.platform !== 'tiktok')
        ? post.quotedPost.media
        : [];

      // Combined list for total count checks (main + quoted)
      const mediaToDownload = mainMediaToDownload;

      // Check for external link preview images that need downloading
      const hasQuotedExternalLinkImage = !!post.quotedPost?.metadata?.externalLinkImage;
      const hasMainExternalLinkImage = !!post.metadata?.externalLinkImage;

      // ========================================
      // Naver Webtoon: Use local service for faster image downloads
      // Bypasses Worker proxy for direct CDN access
      // ========================================
      if (post.platform === 'naver-webtoon' && mediaToDownload && mediaToDownload.length > 0) {
        try {
          const { NaverWebtoonLocalService } = await import('./services/NaverWebtoonLocalService');
          const webtoonService = new NaverWebtoonLocalService();
          const mediaBasePath = this.settings.mediaPath || 'attachments/social-archives';

          // Extract series info for folder structure
          const seriesId = (post as any).series?.id || post.id.split('-')[1] || 'unknown';
          const episodeNo = (post as any).series?.episode || 1;
          const postMediaFolder = `${mediaBasePath}/naver-webtoon/${seriesId}/${episodeNo}`;

          // Ensure folder exists
          await this.ensureFolderExists(postMediaFolder);

          // Track downloaded images (simplified - don't need full MediaResult)
          const downloadedImages: Array<{ originalUrl: string; localPath: string }> = [];
          const totalImages = mediaToDownload.length;

          console.debug(`[Social Archiver] Downloading ${totalImages} webtoon images locally (subscription)`);

          for (let i = 0; i < totalImages; i++) {
            const media = mediaToDownload[i];
            if (!media?.url) continue;

            try {
              // Download image directly using local service
              const arrayBuffer = await webtoonService.downloadImage(media.url);

              // Determine extension from URL
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

              // Save to vault
              await this.app.vault.adapter.writeBinary(localPath, arrayBuffer);
              downloadedImages.push({ originalUrl: media.url, localPath });

            } catch (error) {
              console.warn(`[Social Archiver] Failed to download webtoon image ${i + 1}:`, error);
            }
          }

          console.debug(`[Social Archiver] Downloaded ${downloadedImages.length}/${totalImages} webtoon images`);

          // Create a map of successful downloads by original URL
          const resultsByUrl = new Map(
            downloadedImages.map(result => [result.originalUrl, result])
          );

          // Update post.media with local paths where available
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

          // Mark as handled locally (don't need mediaResults for savePost - post.media is already updated)
          mediaHandledLocally = true;

        } catch (error) {
          console.error('[Social Archiver] Naver Webtoon local download failed:', error);
          // Fall through to Worker proxy as fallback
        }
      }

      // Other platforms: Use Worker proxy for media downloads
      const hasMainMedia = !mediaHandledLocally && !mediaResults && mediaToDownload && mediaToDownload.length > 0;
      const hasQuotedMedia = quotedMediaToDownload.length > 0;
      const hasExternalLinkImages = hasQuotedExternalLinkImage || hasMainExternalLinkImage;
      if ((hasMainMedia || hasQuotedMedia || hasExternalLinkImages) && this.apiClient) {
        try {
          const mediaHandler = new MediaHandler({
            vault: this.app.vault,
            app: this.app,
            workersClient: this.apiClient,
            basePath: this.settings.mediaPath || 'attachments/social-archives',
            optimizeImages: true,
            imageQuality: 0.8,
            maxImageDimension: 2048
          });

          // Build combined media list with source tracking (like ArchiveOrchestrator)
          const allMediaToDownload: Array<{ media: typeof post.media[0]; mediaIndex: number; isQuotedPost?: boolean; isExternalLinkImage?: boolean }> = [];

          if (hasMainMedia && mediaToDownload) {
            mediaToDownload.forEach((media: typeof post.media[0], index: number) => {
              allMediaToDownload.push({ media, mediaIndex: index });
            });
          }

          if (hasQuotedMedia) {
            quotedMediaToDownload.forEach((media: typeof post.media[0], index: number) => {
              allMediaToDownload.push({ media, mediaIndex: index, isQuotedPost: true });
            });
          }

          // Download quoted post external link preview image (Facebook shared posts with link attachments)
          if (hasQuotedExternalLinkImage && post.quotedPost?.metadata?.externalLinkImage) {
            allMediaToDownload.push({
              media: { type: 'image', url: post.quotedPost.metadata.externalLinkImage } as typeof post.media[0],
              mediaIndex: -1,
              isQuotedPost: true,
              isExternalLinkImage: true,
            });
          }

          // Download main post external link preview image
          if (hasMainExternalLinkImage && post.metadata?.externalLinkImage) {
            allMediaToDownload.push({
              media: { type: 'image', url: post.metadata.externalLinkImage } as typeof post.media[0],
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

          // Update media URLs in PostData (main post + quoted post + external link images)
          mediaResults.forEach((result, index) => {
            const sourceItem = allMediaToDownload[index];
            if (!sourceItem) return;

            if (sourceItem.isExternalLinkImage) {
              // Update external link preview image URL with local path
              if (sourceItem.isQuotedPost && post.quotedPost?.metadata) {
                post.quotedPost.metadata.externalLinkImage = result.localPath;
              } else if (post.metadata) {
                post.metadata.externalLinkImage = result.localPath;
              }
            } else if (sourceItem.isQuotedPost) {
              // Update quoted post media URL
              if (post.quotedPost && post.quotedPost.media[sourceItem.mediaIndex]) {
                post.quotedPost.media[sourceItem.mediaIndex] = {
                  ...post.quotedPost.media[sourceItem.mediaIndex],
                  url: result.localPath,
                  originalUrl: result.originalUrl
                } as typeof post.quotedPost.media[number];
              }
            } else {
              // Update main post media URL
              if (post.media[sourceItem.mediaIndex]) {
                post.media[sourceItem.mediaIndex] = {
                  ...post.media[sourceItem.mediaIndex],
                  url: result.localPath,
                  originalUrl: result.originalUrl
                } as typeof post.media[number];
              }
            }
          });
        } catch {
          // Continue without media - the post will still be saved with external URLs
          mediaResults = undefined;
        }
      }

      // Detect expired media (CDN URLs that failed to download)
      if (!mediaHandledLocally) {
        const { CdnExpiryDetector } = await import('./services/CdnExpiryDetector');
        type MER = import('./services/MediaPlaceholderGenerator').MediaExpiredResult;

        const allOriginalMedia = [
          ...(mainMediaToDownload || []),
          ...quotedMediaToDownload,
        ];

        // Collect URLs that were successfully downloaded
        const downloadedUrls = new Set<string>();
        if (mediaResults) {
          for (const result of mediaResults) {
            if (result.originalUrl) downloadedUrls.add(result.originalUrl);
          }
        }

        const expiredMedia: MER[] = [];
        for (const item of allOriginalMedia) {
          const originalUrl = (item as any).originalUrl ?? item.url;
          if (!downloadedUrls.has(originalUrl)) {
            const reason = CdnExpiryDetector.isEphemeralCdn(originalUrl) ? 'cdn_expired' : 'download_failed';
            expiredMedia.push({
              originalUrl,
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
              type: item.type as 'image' | 'video' | 'audio' | 'document',
              reason,
              detectedAt: new Date().toISOString(),
            });
          }
        }

        if (expiredMedia.length > 0) {
          (post as any)._expiredMedia = expiredMedia;
          new Notice(
            `\u26A0\uFE0F ${expiredMedia.length} media item(s) could not be downloaded (CDN expired).`,
            8000
          );
        }
      }

      // Enrich author metadata (avatar download, followers, bio, etc.)
      await this.enrichAuthorMetadata(post, post.platform);

      // Filter comments based on global setting (subscription posts use the global default)
      if (!this.settings.includeComments) {
        delete post.comments;
      }

      // Create storage service with subscription destination folder
      const storageService = new VaultStorageService({
        app: this.app,
        vault: this.app.vault,
        settings: {
          ...this.settings,
          archivePath: basePath
        }
      });

      // Save post to vault with explicit file path (keeps original URL in post.url)
      // Pass mediaResults for blog posts with inline image placeholders ({{IMAGE_N}})
      const saveResult = await storageService.savePost(post, undefined, targetFilePath, mediaResults);

      if (saveResult.path) {
        // Refresh timeline to show new post
        this.refreshTimelineView();
        return true;
      }

      return false;
    } catch (error) {
      console.error('[Social Archiver] saveSubscriptionPost error:', error);
      return false;
    }
  }



  /**
   * Fetch Naver cafe post locally using Obsidian's requestUrl
   * This bypasses the Worker to properly support cookie authentication
   */
  private async fetchNaverCafeLocally(
    url: string,
    filePath: string | undefined,
    downloadMode: MediaDownloadMode,
    options?: {
      comment?: string;
      originalUrl?: string;
    }
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const { NaverCafeLocalService } = await import('./services/NaverCafeLocalService');
      const service = new NaverCafeLocalService(this.settings.naverCookie);
      const postData = await service.fetchPost(url);

      // postData.text already contains properly formatted markdown from convertHtmlToMarkdown()
      // Build the document directly without going through markdownConverter

      // Format timestamp (use local timezone)
      const timestamp = postData.timestamp;
      const now = new Date();
      const archivedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      // Download media if enabled
      const downloadedMedia: Array<{ originalUrl: string; localPath: string }> = [];
      const mediaBasePath = this.settings.mediaPath || 'attachments/social-archives';

      if (downloadMode !== 'text-only' && postData.media && postData.media.length > 0) {
        for (let i = 0; i < postData.media.length; i++) {
          const media = postData.media[i];
          if (!media) continue;

          if (downloadMode === 'images-only' && media.type !== 'photo') {
            continue;
          }

          const mediaUrl = media.url;
          if (!mediaUrl) continue;

          try {
            // Determine file extension
            let extension = 'png';
            const urlMatch = mediaUrl.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
            if (urlMatch && urlMatch[1]) {
              const ext = urlMatch[1].toLowerCase();
              if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4'].includes(ext)) {
                extension = ext;
              }
            }

            // Use subfolder structure: attachments/social-archives/naver/articleId/
            const postMediaFolder = `${mediaBasePath}/naver/${postData.id}`;
            const filename = `${i + 1}.${extension}`;
            const localPath = `${postMediaFolder}/${filename}`;

            // Download using Obsidian's requestUrl
            const response = await requestUrl({
              url: mediaUrl,
              method: 'GET',
            });

            if (response.arrayBuffer) {
              // Ensure media folder exists using the safe method
              await this.ensureFolderExists(postMediaFolder);

              // Save the file
              await this.app.vault.adapter.writeBinary(localPath, response.arrayBuffer);
              downloadedMedia.push({ originalUrl: mediaUrl, localPath });
            }
          } catch (error) {
            console.warn(`[Social Archiver] Failed to download media: ${mediaUrl}`, error);
          }
        }
      }

      // Replace image URLs in content with local paths
      let content = postData.text;
      for (const media of downloadedMedia) {
        // Replace the remote URL with local path
        content = content.replace(
          new RegExp(`!\\[([^\\]]*)\\]\\(${media.originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g'),
          `![$1](${encodePathForMarkdownLink(media.localPath)})`
        );
      }

      // Process video placeholders: download videos and replace placeholders
      if (downloadMode !== 'text-only') {
        const videos = service.extractVideoMetadata(content);
        if (videos.length > 0) {
          console.debug(`[Social Archiver] Found ${videos.length} video(s) to download`);
          let videoCount = 0;

          for (const video of videos) {
            try {
              const videoQuality = await service.fetchVideoUrl(video.vid, video.inkey);

              if (videoQuality && videoQuality.source) {
                // Download video
                const videoResponse = await requestUrl({
                  url: videoQuality.source,
                  method: 'GET',
                });

                if (videoResponse.arrayBuffer) {
                  const postMediaFolder = `${mediaBasePath}/naver/${postData.id}`;
                  const videoFilename = `video-${videoCount + 1}.mp4`;
                  const videoPath = `${postMediaFolder}/${videoFilename}`;

                  await this.ensureFolderExists(postMediaFolder);
                  await this.app.vault.adapter.writeBinary(videoPath, videoResponse.arrayBuffer);

                  // Replace placeholder with video embed
                  const placeholder = `<!--VIDEO:${video.vid}:${video.inkey}-->`;
                  content = content.replace(placeholder, `![[${videoPath}]]`);

                  videoCount++;
                  console.debug(`[Social Archiver] Downloaded video: ${videoQuality.name}`);
                }
              } else {
                // If video fetch failed, replace placeholder with fallback text
                const placeholder = `<!--VIDEO:${video.vid}:${video.inkey}-->`;
                content = content.replace(placeholder, '[비디오]');
              }
            } catch (error) {
              console.warn(`[Social Archiver] Failed to download video:`, error);
              const placeholder = `<!--VIDEO:${video.vid}:${video.inkey}-->`;
              content = content.replace(placeholder, '[비디오]');
            }
          }

          if (videoCount > 0) {
            console.debug(`[Social Archiver] Downloaded ${videoCount} video(s)`);
          }
        }
      }

      // Extract link previews from content
      const { LinkPreviewExtractor } = await import('./services/LinkPreviewExtractor');
      const linkExtractor = new LinkPreviewExtractor({
        maxLinks: 5,
        excludeImages: true,
        excludePlatformUrls: false,
      });
      const extractedLinks = linkExtractor.extractUrls(content, 'naver');
      const linkPreviews = extractedLinks.map(link => link.url);

      // Download author avatar if enabled
      let localAvatarPath: string | null = null;
      if (this.settings.downloadAuthorAvatars && this.authorAvatarService && postData.author.avatar) {
        try {
          localAvatarPath = await this.authorAvatarService.downloadAndSaveAvatar(
            postData.author.avatar,
            'naver',
            postData.author.name,
            this.settings.overwriteAuthorAvatar
          );
          console.debug(`[Social Archiver] Downloaded author avatar: ${localAvatarPath}`);
        } catch (error) {
          console.warn('[Social Archiver] Failed to download author avatar:', error);
          // Continue without avatar
        }
      }

      // Build YAML frontmatter (timeline-compatible format)
      // Format published date with time
      const cafePublishedDate = timestamp.toLocaleString('sv-SE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).replace('T', ' ');

      const frontmatter = [
        '---',
        `share: false`,
        `platform: naver`,
        `title: "${postData.title.replace(/"/g, '\\"')}"`,
        `author: "${postData.author.name}"`,
        `authorUrl: "${postData.author.url}"`,
        localAvatarPath ? `authorAvatar: "[[${localAvatarPath}]]"` : null,
        postData.author.avatar ? `avatarUrl: "${postData.author.avatar}"` : null,
        postData.author.grade ? `authorBio: "${postData.author.grade}"` : null,
        `published: "${cafePublishedDate}"`,
        `archived: "${archivedDate}"`,
        `lastModified: "${archivedDate}"`,
        `archive: false`,
        // Author stats (flat format for Obsidian compatibility)
        postData.author.stats?.visitCount ? `authorProfileVisits: ${postData.author.stats.visitCount}` : null,
        postData.author.stats?.articleCount ? `authorProfilePosts: ${postData.author.stats.articleCount}` : null,
        postData.author.stats?.commentCount ? `authorProfileComments: ${postData.author.stats.commentCount}` : null,
        postData.author.stats?.subscriberCount ? `authorFollowers: ${postData.author.stats.subscriberCount}` : null,
        // Author trade review (for marketplace cafes, flat format)
        postData.author.tradeReview?.bestCount ? `authorTradeReviewBest: ${postData.author.tradeReview.bestCount}` : null,
        postData.author.tradeReview?.goodCount ? `authorTradeReviewGood: ${postData.author.tradeReview.goodCount}` : null,
        postData.author.tradeReview?.sorryCount ? `authorTradeReviewSorry: ${postData.author.tradeReview.sorryCount}` : null,
        `articleId: "${postData.id}"`,
        `cafeId: "${postData.cafeId}"`,
        `cafeName: "${postData.cafeName.replace(/"/g, '\\"')}"`,
        `cafeUrl: "${postData.cafeUrl}"`,
        postData.menuName ? `menuName: "${postData.menuName}"` : null,
        `originalUrl: "${postData.url}"`,
        `source: naver-cafe`,
        postData.viewCount > 0 ? `views: ${postData.viewCount}` : null,
        postData.likes > 0 ? `likes: ${postData.likes}` : null,
        postData.commentCount > 0 ? `comments: ${postData.commentCount}` : null,
        linkPreviews.length > 0 ? `linkPreviews:\n${linkPreviews.map(url => `  - "${url}"`).join('\n')}` : null,
        options?.comment ? `comment: "${options.comment.replace(/"/g, '\\"')}"` : null,
        '---',
      ].filter(Boolean).join('\n');

      // Build comments section if there are comments (matching other platforms format)
      let commentsSection = '';
      if (postData.comments && postData.comments.length > 0) {
        const formattedComments: string[] = [];

        for (const comment of postData.comments) {
          if (comment.isReply) continue; // Process replies with their parent

          const likes = comment.likeCount ? ` · ${comment.likeCount} likes` : '';
          let commentBlock = `**${comment.writerNickname}** · ${comment.writeDate}${likes}\n${comment.content}`;

          // Find replies to this comment
          const replies = postData.comments.filter(c =>
            c.isReply && c.parentCommentId === comment.commentId
          );

          if (replies.length > 0) {
            for (const reply of replies) {
              const replyLikes = reply.likeCount ? ` · ${reply.likeCount} likes` : '';
              commentBlock += `\n\n  ↳ **${reply.writerNickname}** · ${reply.writeDate}${replyLikes}\n  ${reply.content}`;
            }
          }

          formattedComments.push(commentBlock);
        }

        if (formattedComments.length > 0) {
          commentsSection = '\n\n## 💬 Comments\n\n' + formattedComments.join('\n\n---\n\n');
        }
      }

      // Build full document
      const fullDocument = [
        frontmatter,
        content,
        commentsSection,
      ].join('\n');

      // Generate correct file path using actual post data
      const vaultManager = new VaultManager({
        vault: this.app.vault,
        app: this.app,
        basePath: this.settings.archivePath || 'Social Archives',
        organizationStrategy: getVaultOrganizationStrategy(this.settings.archiveOrganization),
      });
      await vaultManager.initialize();

      // Create proper PostData for file path generation
      const properPostData: PostData = {
        platform: 'naver' as Platform,
        id: postData.id,
        url: postData.url,
        author: {
          name: postData.author.name,
          url: postData.author.url,
        },
        content: {
          text: postData.text,
        },
        media: postData.media.map(m => ({
          type: m.type === 'photo' ? 'image' as const : 'video' as const,
          url: m.url,
        })),
        metadata: {
          timestamp: postData.timestamp,
          likes: postData.likes,
        },
        title: postData.title,
      };

      // Delete the preliminary file if it exists (backward compat with older jobs)
      if (filePath) {
        const preliminaryFile = this.app.vault.getAbstractFileByPath(filePath);
        if (preliminaryFile && preliminaryFile instanceof TFile) {
          await this.app.fileManager.trashFile(preliminaryFile);
        } else if (preliminaryFile) {
          console.warn(`[Social Archiver] Unexpected: preliminary file path points to a folder, skipping delete: ${filePath}`);
        }
      }

      // Generate new file path with actual author name and title
      const newFilePath = vaultManager.generateFilePath(properPostData);

      // Ensure folder exists
      const folderPath = newFilePath.substring(0, newFilePath.lastIndexOf('/'));
      await this.ensureFolderExists(folderPath);

      // Create or update the file with correct filename
      const existingFile = this.app.vault.getAbstractFileByPath(newFilePath);
      if (existingFile && existingFile instanceof TFile) {
        // File already exists (re-archiving same post), update it instead
        await this.app.vault.modify(existingFile, fullDocument);
        console.debug(`[Social Archiver] Updated existing Naver cafe archive: ${newFilePath}`);
      } else {
        // Create new file
        await this.app.vault.create(newFilePath, fullDocument);
      }

      const processingTime = Date.now() - startTime;
      console.debug(`[Social Archiver] Naver cafe archived locally in ${processingTime}ms`);

      // Refresh timeline view
      this.refreshTimelineView();

    } catch (error) {
      console.error('[Social Archiver] Naver cafe local fetch failed:', error);

      // Update preliminary document with error state if it exists (backward compat)
      if (filePath) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const content = await this.app.vault.read(file);
          const updatedContent = content.replace(
            /archiveStatus: pending/,
            'archiveStatus: failed'
          ).replace(
            /^(---[\s\S]*?---)$/m,
            `$1\n\n> [!error] Archive Failed\n> ${errorMessage}`
          );
          await this.app.vault.modify(file, updatedContent);
        }
      }

      throw error;
    }
  }

  /**
   * Fetch Naver blog post locally using Obsidian's requestUrl
   * This bypasses the Worker to reduce latency and BrightData credit usage
   */
  private async fetchNaverBlogLocally(
    url: string,
    filePath: string | undefined,
    downloadMode: MediaDownloadMode,
    options?: {
      comment?: string;
      originalUrl?: string;
    }
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const { NaverBlogLocalService } = await import('./services/NaverBlogLocalService');
      const service = new NaverBlogLocalService(this.settings.naverCookie);
      const postData = await service.fetchPost(url);

      // Format timestamp
      const timestamp = postData.timestamp;
      const now = new Date();
      const archivedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      // Download media if enabled
      const downloadedMedia: Array<{ originalUrl: string; localPath: string }> = [];
      const mediaBasePath = this.settings.mediaPath || 'attachments/social-archives';

      if (downloadMode !== 'text-only' && postData.media && postData.media.length > 0) {
        for (let i = 0; i < postData.media.length; i++) {
          const media = postData.media[i];
          if (!media) continue;

          if (downloadMode === 'images-only' && media.type !== 'photo') {
            continue;
          }

          const mediaUrl = media.url;
          if (!mediaUrl) continue;

          try {
            // Determine file extension
            let extension = 'png';
            const urlMatch = mediaUrl.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
            if (urlMatch && urlMatch[1]) {
              const ext = urlMatch[1].toLowerCase();
              if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4'].includes(ext)) {
                extension = ext;
              }
            }

            // Use subfolder structure: attachments/social-archives/naver/logNo/
            const postMediaFolder = `${mediaBasePath}/naver/${postData.id}`;
            const filename = `${i + 1}.${extension}`;
            const localPath = `${postMediaFolder}/${filename}`;

            // Download using Obsidian's requestUrl
            const response = await requestUrl({
              url: mediaUrl,
              method: 'GET',
            });

            if (response.arrayBuffer) {
              await this.ensureFolderExists(postMediaFolder);
              await this.app.vault.adapter.writeBinary(localPath, response.arrayBuffer);
              downloadedMedia.push({ originalUrl: mediaUrl, localPath });
            }
          } catch (error) {
            console.warn(`[Social Archiver] Failed to download media: ${mediaUrl}`, error);
          }
        }
      }

      // Replace image URLs in content with local paths
      let content = postData.text;
      for (const media of downloadedMedia) {
        content = content.replace(
          new RegExp(`!\\[([^\\]]*)\\]\\(${media.originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g'),
          `![$1](${encodePathForMarkdownLink(media.localPath)})`
        );
      }

      // Process video placeholders: download videos and replace placeholders
      if (downloadMode !== 'text-only') {
        const videos = service.extractVideoMetadata(content);
        if (videos.length > 0) {
          console.debug(`[Social Archiver] Found ${videos.length} blog video(s) to download`);
          let videoCount = 0;

          for (const video of videos) {
            try {
              const videoQuality = await service.fetchVideoUrl(video.vid, video.inkey);

              if (videoQuality && videoQuality.source) {
                // Download video
                const videoResponse = await requestUrl({
                  url: videoQuality.source,
                  method: 'GET',
                });

                if (videoResponse.arrayBuffer) {
                  const postMediaFolder = `${mediaBasePath}/naver/${postData.id}`;
                  const videoFilename = `video-${videoCount + 1}.mp4`;
                  const videoPath = `${postMediaFolder}/${videoFilename}`;

                  await this.ensureFolderExists(postMediaFolder);
                  await this.app.vault.adapter.writeBinary(videoPath, videoResponse.arrayBuffer);

                  // Replace both placeholder patterns
                  const placeholder1 = `<!--VIDEO:${video.vid}-->`;
                  const placeholder2 = video.inkey ? `<!--VIDEO:${video.vid}:${video.inkey}-->` : null;
                  content = content.replace(placeholder1, `![[${videoPath}]]`);
                  if (placeholder2) {
                    content = content.replace(placeholder2, `![[${videoPath}]]`);
                  }

                  videoCount++;
                  console.debug(`[Social Archiver] Downloaded blog video: ${videoQuality.name}`);
                }
              } else {
                // If video fetch failed, replace placeholder with fallback text
                const placeholder1 = `<!--VIDEO:${video.vid}-->`;
                const placeholder2 = video.inkey ? `<!--VIDEO:${video.vid}:${video.inkey}-->` : null;
                content = content.replace(placeholder1, '[비디오]');
                if (placeholder2) {
                  content = content.replace(placeholder2, '[비디오]');
                }
              }
            } catch (error) {
              console.warn(`[Social Archiver] Failed to download blog video:`, error);
              const placeholder1 = `<!--VIDEO:${video.vid}-->`;
              content = content.replace(placeholder1, '[비디오]');
            }
          }

          if (videoCount > 0) {
            console.debug(`[Social Archiver] Downloaded ${videoCount} blog video(s)`);
          }
        }
      }

      // Extract link previews from content
      const { LinkPreviewExtractor } = await import('./services/LinkPreviewExtractor');
      const linkExtractor = new LinkPreviewExtractor({
        maxLinks: 5,
        excludeImages: true,
        excludePlatformUrls: false,
      });
      const extractedLinks = linkExtractor.extractUrls(content, 'naver');
      const linkPreviews = extractedLinks.map(link => link.url);

      // Build YAML frontmatter (timeline-compatible format)
      // Format published date with time
      const blogPublishedDate = timestamp.toLocaleString('sv-SE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).replace('T', ' ');

      const frontmatter = [
        '---',
        `share: false`,
        `platform: naver`,
        `title: "${postData.title.replace(/"/g, '\\"')}"`,
        `author: "${postData.author.name}"`,
        `authorUrl: "${postData.author.url}"`,
        `published: "${blogPublishedDate}"`,
        `archived: "${archivedDate}"`,
        `lastModified: "${archivedDate}"`,
        `archive: false`,
        `logNo: "${postData.id}"`,
        `blogId: "${postData.blogId}"`,
        postData.blogName ? `blogName: "${postData.blogName.replace(/"/g, '\\"')}"` : null,
        postData.categoryName ? `categoryName: "${postData.categoryName}"` : null,
        `originalUrl: "${postData.url}"`,
        `source: naver-blog`,
        postData.viewCount > 0 ? `views: ${postData.viewCount}` : null,
        postData.likes > 0 ? `likes: ${postData.likes}` : null,
        postData.commentCount > 0 ? `comments: ${postData.commentCount}` : null,
        postData.tags && postData.tags.length > 0 ? `tags:\n${postData.tags.map(t => `  - "${t}"`).join('\n')}` : null,
        linkPreviews.length > 0 ? `linkPreviews:\n${linkPreviews.map(url => `  - "${url}"`).join('\n')}` : null,
        options?.comment ? `comment: "${options.comment.replace(/"/g, '\\"')}"` : null,
        '---',
      ].filter(Boolean).join('\n');

      // Build full document
      const fullDocument = [
        frontmatter,
        content,
      ].join('\n');

      // Generate correct file path using actual post data
      const vaultManager = new VaultManager({
        vault: this.app.vault,
        app: this.app,
        basePath: this.settings.archivePath || 'Social Archives',
        organizationStrategy: getVaultOrganizationStrategy(this.settings.archiveOrganization),
      });
      await vaultManager.initialize();

      // Create proper PostData for file path generation
      const properPostData: PostData = {
        platform: 'naver' as Platform,
        id: postData.id,
        url: postData.url,
        author: {
          name: postData.author.name,
          url: postData.author.url,
        },
        content: {
          text: postData.text,
        },
        media: postData.media.map(m => ({
          type: m.type === 'photo' ? 'image' as const : 'video' as const,
          url: m.url,
        })),
        metadata: {
          timestamp: postData.timestamp,
          likes: postData.likes,
        },
        title: postData.title,
      };

      // Delete the preliminary file if it exists (backward compat with older jobs)
      if (filePath) {
        const preliminaryFile = this.app.vault.getAbstractFileByPath(filePath);
        if (preliminaryFile && preliminaryFile instanceof TFile) {
          await this.app.fileManager.trashFile(preliminaryFile);
        } else if (preliminaryFile) {
          console.warn(`[Social Archiver] Unexpected: preliminary file path points to a folder, skipping delete: ${filePath}`);
        }
      }

      // Generate new file path with actual author name and title
      const newFilePath = vaultManager.generateFilePath(properPostData);

      // Ensure folder exists
      const folderPath = newFilePath.substring(0, newFilePath.lastIndexOf('/'));
      await this.ensureFolderExists(folderPath);

      // Create or update the file with correct filename
      const existingFile = this.app.vault.getAbstractFileByPath(newFilePath);
      if (existingFile && existingFile instanceof TFile) {
        await this.app.vault.modify(existingFile, fullDocument);
        console.debug(`[Social Archiver] Updated existing Naver blog archive: ${newFilePath}`);
      } else {
        await this.app.vault.create(newFilePath, fullDocument);
      }

      const processingTime = Date.now() - startTime;
      console.debug(`[Social Archiver] Naver blog archived locally in ${processingTime}ms`);

      // Refresh timeline view
      this.refreshTimelineView();

    } catch (error) {
      console.error('[Social Archiver] Naver blog local fetch failed:', error);

      // Update preliminary document with error state if it exists (backward compat)
      if (filePath) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const content = await this.app.vault.read(file);
          const updatedContent = content.replace(
            /archiveStatus: pending/,
            'archiveStatus: failed'
          ).replace(
            /^(---[\s\S]*?---)$/m,
            `$1\n\n> [!error] Archive Failed\n> ${errorMessage}`
          );
          await this.app.vault.modify(file, updatedContent);
        }
      }

      throw error;
    }
  }

  /**
   * Fetch and save a Brunch post using local service
   * This bypasses the Worker to reduce latency and BrightData credit usage
   */
  private async fetchBrunchLocally(
    url: string,
    filePath: string | undefined,
    downloadMode: MediaDownloadMode,
    options?: {
      comment?: string;
      originalUrl?: string;
    }
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const { BrunchLocalService } = await import('./services/BrunchLocalService');
      const service = new BrunchLocalService();
      const postData = await service.fetchPost(url);

      // Format timestamp
      const timestamp = postData.timestamp;
      const now = new Date();
      const archivedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      // Download media if enabled
      const downloadedMedia: Array<{ originalUrl: string; localPath: string }> = [];
      const mediaBasePath = this.settings.mediaPath || 'attachments/social-archives';

      if (downloadMode !== 'text-only' && postData.media && postData.media.length > 0) {
        for (let i = 0; i < postData.media.length; i++) {
          const media = postData.media[i];
          if (!media) continue;

          if (downloadMode === 'images-only' && media.type !== 'photo') {
            continue;
          }

          const mediaUrl = media.url;
          if (!mediaUrl) continue;

          try {
            // Determine file extension
            let extension = 'png';
            const urlMatch = mediaUrl.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
            if (urlMatch && urlMatch[1]) {
              const ext = urlMatch[1].toLowerCase();
              if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4'].includes(ext)) {
                extension = ext;
              }
            }

            // Use subfolder structure: attachments/social-archives/brunch/postId/
            const postMediaFolder = `${mediaBasePath}/brunch/${postData.id}`;
            const filename = `${i + 1}.${extension}`;
            const localPath = `${postMediaFolder}/${filename}`;

            // Download using Obsidian's requestUrl
            const response = await requestUrl({
              url: mediaUrl,
              method: 'GET',
            });

            if (response.arrayBuffer) {
              await this.ensureFolderExists(postMediaFolder);
              await this.app.vault.adapter.writeBinary(localPath, response.arrayBuffer);
              downloadedMedia.push({ originalUrl: mediaUrl, localPath });
            }
          } catch (error) {
            console.warn(`[Social Archiver] Failed to download Brunch media: ${mediaUrl}`, error);
          }
        }
      }

      // Replace image URLs in content with local paths
      let content = postData.text;
      for (const media of downloadedMedia) {
        content = content.replace(
          new RegExp(`!\\[([^\\]]*)\\]\\(${media.originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g'),
          `![$1](${encodePathForMarkdownLink(media.localPath)})`
        );
      }

      // Process KakaoTV video placeholders if enabled
      if (downloadMode !== 'text-only' && postData.videos && postData.videos.length > 0) {
        console.debug(`[Social Archiver] Found ${postData.videos.length} Brunch video(s) to process`);
        let videoCount = 0;

        for (const video of postData.videos) {
          if (!video.videoId) continue;

          try {
            // Attempt to fetch KakaoTV video URL
            const videoInfo = await service.getKakaoVideoInfo(video.videoId, url);

            if (videoInfo && videoInfo.mp4Url) {
              // Download video
              const videoResponse = await requestUrl({
                url: videoInfo.mp4Url,
                method: 'GET',
              });

              if (videoResponse.arrayBuffer) {
                const postMediaFolder = `${mediaBasePath}/brunch/${postData.id}`;
                const videoFilename = `video-${videoCount + 1}.mp4`;
                const videoPath = `${postMediaFolder}/${videoFilename}`;

                await this.ensureFolderExists(postMediaFolder);
                await this.app.vault.adapter.writeBinary(videoPath, videoResponse.arrayBuffer);

                // Replace video placeholder with local embed
                const placeholder = `<!--KAKAOTV:${video.videoId}-->`;
                content = content.replace(placeholder, `![[${videoPath}]]`);

                videoCount++;
                console.debug(`[Social Archiver] Downloaded Brunch video: ${video.videoId}`);
              }
            } else {
              // If video fetch failed, keep the placeholder or replace with fallback
              const placeholder = `<!--KAKAOTV:${video.videoId}-->`;
              content = content.replace(placeholder, video.thumbnail
                ? `![Video thumbnail](${encodePathForMarkdownLink(video.thumbnail)})\n[Watch on KakaoTV](https://tv.kakao.com/v/${video.videoId})`
                : `[Watch on KakaoTV](https://tv.kakao.com/v/${video.videoId})`
              );
            }
          } catch (error) {
            console.warn(`[Social Archiver] Failed to download Brunch video: ${video.videoId}`, error);
            const placeholder = `<!--KAKAOTV:${video.videoId}-->`;
            content = content.replace(placeholder, `[비디오: KakaoTV ${video.videoId}]`);
          }
        }

        if (videoCount > 0) {
          console.debug(`[Social Archiver] Downloaded ${videoCount} Brunch video(s)`);
        }
      }

      // Extract link previews from content
      const { LinkPreviewExtractor } = await import('./services/LinkPreviewExtractor');
      const linkExtractor = new LinkPreviewExtractor({
        maxLinks: 5,
        excludeImages: true,
        excludePlatformUrls: false,
      });
      const extractedLinks = linkExtractor.extractUrls(content, 'brunch');
      const linkPreviews = extractedLinks.map(link => link.url);

      // Fetch and append comments if userId is available and commentCount > 0
      console.debug(`[Social Archiver] Comment fetch check - userId: ${postData.author.userId}, commentCount: ${postData.commentCount}`);
      if (postData.author.userId && postData.commentCount && postData.commentCount > 0) {
        try {
          console.debug(`[Social Archiver] Fetching ${postData.commentCount} Brunch comments for userId=${postData.author.userId}, postId=${postData.id}...`);
          const comments = await service.fetchComments(postData.author.userId, postData.id);
          if (comments.length > 0) {
            // Extract all internal IDs from comments (both content mentions and author URLs)
            const allInternalIds: string[] = [];
            const collectInternalIds = (commentList: BrunchComment[]) => {
              for (const c of commentList) {
                // Extract from content mentions
                allInternalIds.push(...BrunchLocalService.extractInternalIds(c.content));
                // Extract from author URL (e.g., https://brunch.co.kr/@bfbK)
                if (c.authorUrl) {
                  const authorMatch = c.authorUrl.match(/brunch\.co\.kr\/@([^/]+)/);
                  if (authorMatch && authorMatch[1] && BrunchLocalService.isInternalId(authorMatch[1])) {
                    allInternalIds.push(authorMatch[1]);
                  }
                }
                if (c.replies) {
                  collectInternalIds(c.replies);
                }
              }
            };
            collectInternalIds(comments);

            // Resolve internal IDs to real author usernames
            let authorMap = new Map<string, string>();
            if (allInternalIds.length > 0) {
              console.debug(`[Social Archiver] Resolving ${allInternalIds.length} internal author IDs...`);
              authorMap = await service.resolveInternalIds(allInternalIds);
              console.debug(`[Social Archiver] Resolved ${authorMap.size} author IDs`);
            }

            const commentsMarkdown = this.formatBrunchCommentsToMarkdown(comments, authorMap);
            content += commentsMarkdown;
            console.debug(`[Social Archiver] Appended ${comments.length} comments to content`);
          }
        } catch (error) {
          console.warn('[Social Archiver] Failed to fetch Brunch comments:', error);
          // Continue without comments
        }
      }

      // Download author avatar if enabled
      let localAvatarPath: string | null = null;
      if (this.settings.downloadAuthorAvatars && this.authorAvatarService && postData.author.avatar) {
        try {
          localAvatarPath = await this.authorAvatarService.downloadAndSaveAvatar(
            postData.author.avatar,
            'brunch',
            postData.author.name,
            this.settings.overwriteAuthorAvatar
          );
          console.debug(`[Social Archiver] Downloaded author avatar: ${localAvatarPath}`);
        } catch (error) {
          console.warn('[Social Archiver] Failed to download author avatar:', error);
        }
      }

      // Build YAML frontmatter (timeline-compatible format matching Instagram/other platforms)
      // Format published date with time
      const publishedDate = timestamp.toLocaleString('sv-SE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).replace('T', ' ');

      const frontmatter = [
        '---',
        `share: false`,
        `platform: brunch`,
        `title: "${postData.title.replace(/"/g, '\\"')}"`,
        postData.subtitle ? `subtitle: "${postData.subtitle.replace(/"/g, '\\"')}"` : null,
        `author: "${postData.author.name}"`,
        `authorId: "${postData.author.id}"`,
        `authorUrl: "${postData.author.url}"`,
        localAvatarPath ? `authorAvatar: "${localAvatarPath}"` : (postData.author.avatar ? `authorAvatar: "${postData.author.avatar}"` : null),
        postData.author.bio ? `authorBio: "${postData.author.bio.replace(/"/g, '\\"').replace(/\n/g, ' ')}"` : null,
        postData.author.job ? `authorJob: "${postData.author.job.replace(/"/g, '\\"')}"` : null,
        postData.author.subscriberCount ? `subscriberCount: ${postData.author.subscriberCount}` : null,
        `published: "${publishedDate}"`,
        `archived: "${archivedDate}"`,
        `lastModified: "${archivedDate}"`,
        `archive: false`,
        `postId: "${postData.id}"`,
        postData.series ? `seriesId: "${postData.series.id}"` : null,
        postData.series ? `seriesTitle: "${postData.series.title.replace(/"/g, '\\"')}"` : null,
        postData.series?.episode ? `seriesEpisode: ${postData.series.episode}` : null,
        `originalUrl: "${postData.url}"`,
        postData.viewCount !== undefined ? `views: ${postData.viewCount}` : null,
        postData.likes !== undefined ? `likes: ${postData.likes}` : null,
        postData.commentCount !== undefined ? `comments: ${postData.commentCount}` : null,
        postData.tags && postData.tags.length > 0 ? `tags:\n${postData.tags.map(t => `  - "${t}"`).join('\n')}` : null,
        linkPreviews.length > 0 ? `linkPreviews:\n${linkPreviews.map(u => `  - "${u}"`).join('\n')}` : null,
        options?.comment ? `comment: "${options.comment.replace(/"/g, '\\"')}"` : null,
        '---',
      ].filter(Boolean).join('\n');

      // Build full document
      const fullDocument = [
        frontmatter,
        content,
      ].join('\n');

      // Generate correct file path using actual post data
      const vaultManager = new VaultManager({
        vault: this.app.vault,
        app: this.app,
        basePath: this.settings.archivePath || 'Social Archives',
        organizationStrategy: getVaultOrganizationStrategy(this.settings.archiveOrganization),
      });
      await vaultManager.initialize();

      // Create proper PostData for file path generation
      const properPostData: PostData = {
        platform: 'brunch' as Platform,
        id: postData.id,
        url: postData.url,
        author: {
          name: postData.author.name,
          url: postData.author.url,
        },
        content: {
          text: postData.text,
        },
        media: postData.media.map(m => ({
          type: m.type === 'photo' ? 'image' as const : 'video' as const,
          url: m.url,
        })),
        metadata: {
          timestamp: postData.timestamp,
          likes: postData.likes,
        },
        title: postData.title,
      };

      // Delete the preliminary file if it exists (backward compat with older jobs)
      if (filePath) {
        const preliminaryFile = this.app.vault.getAbstractFileByPath(filePath);
        if (preliminaryFile && preliminaryFile instanceof TFile) {
          await this.app.fileManager.trashFile(preliminaryFile);
        } else if (preliminaryFile) {
          console.warn(`[Social Archiver] Unexpected: preliminary file path points to a folder, skipping delete: ${filePath}`);
        }
      }

      // Generate new file path with actual author name and title
      const newFilePath = vaultManager.generateFilePath(properPostData);

      // Ensure folder exists
      const folderPath = newFilePath.substring(0, newFilePath.lastIndexOf('/'));
      await this.ensureFolderExists(folderPath);

      // Create or update the file with correct filename
      const existingFile = this.app.vault.getAbstractFileByPath(newFilePath);
      if (existingFile && existingFile instanceof TFile) {
        await this.app.vault.modify(existingFile, fullDocument);
        console.debug(`[Social Archiver] Updated existing Brunch archive: ${newFilePath}`);
      } else {
        await this.app.vault.create(newFilePath, fullDocument);
      }

      const processingTime = Date.now() - startTime;
      console.debug(`[Social Archiver] Brunch post archived locally in ${processingTime}ms`);

      // Refresh timeline view
      this.refreshTimelineView();

    } catch (error) {
      console.error('[Social Archiver] Brunch local fetch failed:', error);

      // Update preliminary document with error state if it exists (backward compat)
      if (filePath) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const content = await this.app.vault.read(file);
          const updatedContent = content.replace(
            /archiveStatus: pending/,
            'archiveStatus: failed'
          ).replace(
            /^(---[\s\S]*?---)$/m,
            `$1\n\n> [!error] Archive Failed\n> ${errorMessage}`
          );
          await this.app.vault.modify(file, updatedContent);
        }
      }

      throw error;
    }
  }

  /**
   * Fetch and save a Naver Webtoon episode using local service
   * This bypasses the Worker for faster image downloads
   */
  private async fetchNaverWebtoonLocally(
    url: string,
    filePath: string | undefined,
    downloadMode: MediaDownloadMode,
    options?: {
      comment?: string;
      originalUrl?: string;
      jobId?: string;
    }
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Show initial progress in banner
      if (options?.jobId) {
        this.archiveJobTracker.updateProgress(options.jobId, 'Fetching episode data...');
      }

      const { NaverWebtoonLocalService } = await import('./services/NaverWebtoonLocalService');
      const service = new NaverWebtoonLocalService();
      const postData = await service.fetchEpisode(url);

      console.debug(`[Social Archiver] Fetched webtoon episode: ${postData.title} (${postData.media.length} images)`);

      // Format timestamps
      const timestamp = postData.timestamp;
      const publishedDate = `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, '0')}-${String(timestamp.getDate()).padStart(2, '0')} ${String(timestamp.getHours()).padStart(2, '0')}:${String(timestamp.getMinutes()).padStart(2, '0')}`;
      const now = new Date();
      const archivedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      // Download images if enabled
      const downloadedMedia: Array<{ originalUrl: string; localPath: string }> = [];
      const mediaBasePath = this.settings.mediaPath || 'attachments/social-archives';
      const totalMediaCount = postData.media.length;

      if (downloadMode !== 'text-only' && totalMediaCount > 0) {
        // Webtoons usually have many images (30-80+), show progress for any download
        if (options?.jobId) {
          this.archiveJobTracker.updateProgress(options.jobId, `Downloading images (0/${totalMediaCount})...`);
        }

        const postMediaFolder = `${mediaBasePath}/naver-webtoon/${postData.series.id}/${postData.series.episode}`;
        await this.ensureFolderExists(postMediaFolder);

        for (let i = 0; i < totalMediaCount; i++) {
          const media = postData.media[i];
          if (!media) continue;

          // Update progress every 5 items (webtoons often have many images)
          if (i > 0 && i % 5 === 0) {
            if (options?.jobId) {
              this.archiveJobTracker.updateProgress(options.jobId, `Downloading images (${i}/${totalMediaCount})...`);
            }
          }

          try {
            // Download image directly using local service
            const arrayBuffer = await service.downloadImage(media.url);

            // Determine extension from URL
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

            // Save to vault
            await this.app.vault.adapter.writeBinary(localPath, arrayBuffer);
            downloadedMedia.push({ originalUrl: media.url, localPath });

          } catch (error) {
            console.warn(`[Social Archiver] Failed to download webtoon image ${i + 1}:`, error);
          }
        }

        if (downloadedMedia.length < totalMediaCount) {
          console.warn(`[Social Archiver] Downloaded ${downloadedMedia.length}/${totalMediaCount} webtoon images`);
        }

        // Show final progress
        if (options?.jobId) {
          this.archiveJobTracker.updateProgress(options.jobId, 'Saving to vault...');
        }
      }

      // Build image gallery markdown
      const imageGallery = downloadedMedia.length > 0
        ? downloadedMedia.map((m) => `![[${m.localPath}]]`).join('\n\n')
        : postData.media.map((m, i) => `![Image ${i + 1}](${m.url})`).join('\n\n');

      // Build frontmatter
      const frontmatterData: Record<string, unknown> = {
        platform: 'naver-webtoon',
        url: postData.url,
        title: postData.title,
        author: postData.author.name,
        authorUrl: postData.author.url,
        published: publishedDate,
        archived: archivedDate,
        archiveStatus: 'completed',
        // Series metadata for SeriesGroupingService
        seriesId: postData.series.id,
        series: postData.series.title,
        seriesUrl: postData.series.url,
        episode: postData.series.episode,
        ...(postData.series.starScore !== undefined && { starScore: postData.series.starScore }),
        tags: [`naver-webtoon`, postData.series.title.replace(/\s+/g, '-')],
        ...(options?.comment && { comment: options.comment }),
        processedUrls: [url, options?.originalUrl].filter(Boolean),
      };

      const frontmatterYaml = Object.entries(frontmatterData)
        .filter(([_, v]) => v !== undefined)
        .map(([key, value]) => {
          if (Array.isArray(value)) {
            return `${key}:\n${value.map(v => `  - "${v}"`).join('\n')}`;
          } else if (typeof value === 'string') {
            return `${key}: "${value}"`;
          } else {
            return `${key}: ${String(value)}`;
          }
        })
        .join('\n');

      // Build content
      const contentParts: string[] = [];

      if (postData.authorComment) {
        contentParts.push(`> ${postData.authorComment}\n`);
      }

      contentParts.push(`**${postData.series.title}** - ${postData.subtitle}`);
      contentParts.push(`\n*${postData.series.publishDay}*${postData.series.finished ? ' | **완결**' : ''}`);
      contentParts.push(`\n\n---\n\n`);
      contentParts.push(imageGallery);

      const fullDocument = `---
${frontmatterYaml}
---

${contentParts.join('')}
`;

      // Generate correct file path using VaultManager
      const vaultManager = new VaultManager({
        vault: this.app.vault,
        app: this.app,
        basePath: this.settings.archivePath || 'Social Archives',
        organizationStrategy: getVaultOrganizationStrategy(this.settings.archiveOrganization),
      });
      await vaultManager.initialize();

      // Create proper PostData for file path generation
      const properPostData: PostData = {
        platform: 'naver-webtoon' as Platform,
        id: postData.id,
        url: postData.url,
        author: {
          name: postData.author.name,
          url: postData.author.url,
        },
        content: {
          text: '',
        },
        media: postData.media.map(m => ({
          type: 'image' as const,
          url: m.url,
        })),
        metadata: {
          timestamp: postData.timestamp,
        },
        title: postData.title,
      };

      // Delete the preliminary file if it exists (backward compat with older jobs)
      if (filePath) {
        const preliminaryFile = this.app.vault.getAbstractFileByPath(filePath);
        if (preliminaryFile && preliminaryFile instanceof TFile) {
          await this.app.fileManager.trashFile(preliminaryFile);
        }
      }

      // Generate new file path with actual author name and title
      const newFilePath = vaultManager.generateFilePath(properPostData);

      // Ensure folder exists
      const folderPath = newFilePath.substring(0, newFilePath.lastIndexOf('/'));
      await this.ensureFolderExists(folderPath);

      // Create the file
      const existingFile = this.app.vault.getAbstractFileByPath(newFilePath);
      if (existingFile && existingFile instanceof TFile) {
        await this.app.vault.modify(existingFile, fullDocument);
      } else {
        await this.app.vault.create(newFilePath, fullDocument);
      }

      const processingTime = Date.now() - startTime;
      console.debug(`[Social Archiver] Naver Webtoon archived locally in ${processingTime}ms`);

      // Refresh timeline view
      this.refreshTimelineView();

    } catch (error) {
      console.error('[Social Archiver] Naver Webtoon local fetch failed:', error);

      // Update preliminary document with error state if it exists (backward compat)
      if (filePath) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const content = await this.app.vault.read(file);
          const updatedContent = content.replace(
            /archiveStatus: pending/,
            'archiveStatus: failed'
          ).replace(
            /^(---[\s\S]*?---)$/m,
            `$1\n\n> [!error] Archive Failed\n> ${errorMessage}`
          );
          await this.app.vault.modify(file, updatedContent);
        }
      }

      throw error;
    }
  }




  /**
   * Refresh Timeline View if it exists
   * Uses activateTimelineView to ensure proper refresh
   */
  public refreshTimelineView(): void {
    const leaves = this.app.workspace.getLeavesOfType('social-archiver-timeline');
    if (leaves.length > 0) {
      // On mobile: don't auto-reveal sidebar after archive
      // Timeline will refresh automatically via file watcher
      if (ObsidianPlatform.isMobile) {
        // Just refresh the view without revealing it
        leaves.forEach(leaf => {
          const view = leaf.view;
          if (view && 'refresh' in view && typeof view.refresh === 'function') {
            view.refresh();
          }
        });
      } else {
        // Desktop: refresh by re-activating (opens sidebar if needed)
        void this.activateTimelineView();
      }
    }
  }

  /**
   * Open the archive modal
   * Public method for use by TimelineContainer and other components
   * Routes Naver Webtoon URLs to the specialized WebtoonArchiveModal
   */
  public openArchiveModal(initialUrl?: string): void {
    // Check if URL is a Naver Webtoon URL - route to specialized modal
    if (initialUrl) {
      const webtoonService = new NaverWebtoonLocalService();
      const urlInfo = webtoonService.parseUrl(initialUrl);
      if (urlInfo) {
        const modal = new WebtoonArchiveModal(this.app, this, initialUrl);
        modal.open();
        return;
      }
    }

    // Default to regular archive modal
    const modal = new ArchiveModal(this.app, this, initialUrl);
    modal.open();
  }

  /**
   * Open the Webtoon Archive Modal directly
   * Public method for explicit webtoon archiving
   */
  public openWebtoonArchiveModal(initialUrl?: string): void {
    const modal = new WebtoonArchiveModal(this.app, this, initialUrl);
    modal.open();
  }

  /**
   * Refresh all open timeline views
   * Public method for use by settings and other components
   */
  public async refreshAllTimelines(): Promise<void> {
    const timelineLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
    for (const leaf of timelineLeaves) {
      const view = leaf.view;
      if (view instanceof TimelineView) {
        await view.refresh();
      }
    }
  }

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

  // ─── Batch Transcription (Manager-backed) ──────────────────────────

  private initBatchTranscriptionManager(): void {
    const deps: BatchTranscriptionManagerDeps = {
      app: this.app,
      settings: this.settings,
      resolveLocalVideoPathsInNote: (filePath) => this.resolveLocalVideoPathsInNote(filePath),
      collectMarkdownFiles: (folder) => this.collectMarkdownFiles(folder),
      toAbsoluteVaultPath: (path) => this.toAbsoluteVaultPath(path),
      appendTranscriptSection: (content, result) => this.appendTranscriptSection(content, result),
      extractDownloadableVideoUrls: (fm) => this.extractDownloadableVideoUrls(fm),
      downloadMedia: async (media, platform, postId, authorUsername) => {
        const { MediaHandler } = await import('./services/MediaHandler');
        const handler = new MediaHandler({
          vault: this.app.vault,
          app: this.app,
          workersClient: this.apiClient,
          basePath: this.settings.mediaPath,
        });
        return handler.downloadMedia(media, platform as Platform, postId, authorUsername);
      },
      isYtDlpUrl: (url) => {
        return YtDlpDetector.isSupportedUrl(url);
      },
      downloadWithYtDlp: async (url, platform, postId, signal) => {
        if (!await YtDlpDetector.isAvailable()) return null;

        // @ts-expect-error — adapter.basePath is available but not in types
        const vaultBasePath: string = this.app.vault.adapter.basePath;
        const basePath = this.settings.mediaPath || 'attachments/social-archives';
        const platformFolder = `${basePath}/${platform}`;
        const outputPath = `${vaultBasePath}/${platformFolder}`;

        const folderExists = await this.app.vault.adapter.exists(platformFolder);
        if (!folderExists) {
          await this.app.vault.createFolder(platformFolder);
        }

        const sanitizedPostId = postId.replace(/[^a-z0-9_-]/gi, '_');
        const filename = `${platform}_${sanitizedPostId}_${Date.now()}`;
        const absolutePath = await YtDlpDetector.downloadVideo(url, outputPath, filename, undefined, signal);

        // Convert absolute path to vault-relative
        const videoFilename = absolutePath.split(/[/\\]/).pop() || '';
        return `${platformFolder}/${videoFilename}`;
      },
      refreshTimelineView: () => this.refreshTimelineView(),
    };
    this.batchTranscriptionManager = new BatchTranscriptionManager(deps);
    this.batchTranscriptionManager.tryRestore();

    // If restored to paused state, show a notice
    if (this.batchTranscriptionManager.getStatus() === 'paused') {
      new Notice('Interrupted batch transcription restored. Use command palette to resume.', 8000);
    }
  }

  public async startBatchTranscription(mode: BatchMode): Promise<void> {
    if (ObsidianPlatform.isMobile) {
      new Notice('Video transcription batch is only available on desktop.');
      return;
    }

    if (!this.settings.transcription?.enabled) {
      new Notice('Enable Whisper transcription in settings first.');
      return;
    }

    if (!this.batchTranscriptionManager) {
      this.initBatchTranscriptionManager();
    }

    // Dismiss previous notice if any
    this.batchTranscriptionNotice?.dismiss();

    // Show new notice
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.batchTranscriptionNotice = new BatchTranscriptionNotice(this.batchTranscriptionManager!);
    this.batchTranscriptionNotice.show();

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this.batchTranscriptionManager!.start(mode);
  }

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

    return [...new Set(urls)];
  }

  /**
   * Legacy batch transcribe (delegates to new manager)
   */
  public async batchTranscribeVideosInNotes(): Promise<void> {
    await this.startBatchTranscription('transcribe-only');
  }

  private collectMarkdownFiles(folder: TFolder): TFile[] {
    const files: TFile[] = [];
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === 'md') {
        files.push(child);
      } else if (child instanceof TFolder) {
        files.push(...this.collectMarkdownFiles(child));
      }
    }
    return files;
  }

  private toAbsoluteVaultPath(vaultPath: string): string {
    const adapter = this.app.vault.adapter as unknown as { basePath?: string };
    const basePath = adapter.basePath || '';
    return basePath ? `${basePath}/${vaultPath}` : vaultPath;
  }

  private appendTranscriptSection(content: string, result: TranscriptionResult): string {
    // Avoid duplicate transcript blocks when rerunning manually.
    if (/\n## Transcript\n/i.test(content)) {
      return content;
    }

    const body = this.transcriptFormatter.formatWhisperTranscript(result.segments);
    if (!body) {
      return content;
    }

    const normalizedContent = content.replace(/\s+$/, '');
    return `${normalizedContent}\n\n---\n\n## Transcript\n\n${body}\n`;
  }

  private isExternalMediaPath(path: string): boolean {
    return /^(?:https?:|data:|obsidian:|vault:)/i.test(String(path || '').trim());
  }

  private isTranscribableVideoPath(path: string): boolean {
    const ext = this.getFileExtension(path, false);
    return !!ext && SocialArchiverPlugin.TRANSCRIBABLE_VIDEO_EXTENSIONS.has(ext);
  }

  private resolveMediaPathForNote(mediaPath: string, notePath: string): string {
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

  private extractVideoPathCandidatesFromContent(content: string): string[] {
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

  private extractVideoPathCandidatesFromFrontmatterMedia(mediaField: unknown): string[] {
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

  /**
   * Extract Google Maps links from text content
   */
  private extractGoogleMapsLinks(content: string): string[] {
    // Match various Google Maps URL formats
    const patterns = [
      // maps.app.goo.gl shortlinks (new format)
      /https?:\/\/maps\.app\.goo\.gl\/[A-Za-z0-9_-]+(\?[^\s)"\]<>]*)?/gi,
      // goo.gl/maps shortlinks
      /https?:\/\/goo\.gl\/maps\/[A-Za-z0-9]+/gi,
      // Full Google Maps URLs
      /https?:\/\/(www\.)?google\.[a-z.]+\/maps\/place\/[^\s)"\]<>]+/gi,
      /https?:\/\/maps\.google\.[a-z.]+\/[^\s)"\]<>]+/gi,
    ];

    const links: string[] = [];
    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches) {
        links.push(...matches);
      }
    }

    // Remove duplicates and clean up URLs
    const uniqueLinks = [...new Set(links)].map(url => {
      // Clean up any trailing characters that might have been captured
      return url.replace(/[)"\]<>]+$/, '');
    });

    return uniqueLinks;
  }

  /**
   * Batch archive Google Maps links from current note
   * @param content - The note content to extract links from
   * @param sourceNotePath - Optional path to the source note for wiki link reference
   */
  public async batchArchiveGoogleMapsLinks(content: string, sourceNotePath?: string): Promise<void> {
    if (!this.apiClient) {
      new Notice('⚠️ Please configure API endpoint in settings first');
      return;
    }

    // Extract Google Maps links
    const links = this.extractGoogleMapsLinks(content);

    if (links.length === 0) {
      new Notice('No Google Maps links found in current note');
      return;
    }

    if (links.length > 20) {
      new Notice(`⚠️ Too many links (${links.length}). Maximum is 20 per batch.`);
      return;
    }

    // Show confirmation modal
    const confirmed = await this.showBatchArchiveConfirmation(links);
    if (!confirmed) {
      return;
    }

    // Start batch archive
    new Notice(`🚀 Starting batch archive of ${links.length} Google Maps locations...`);

    // Generate unique job ID for pending job tracking
    const pendingJobId = `batch-googlemaps-${Date.now()}`;

    try {
      // Trigger batch archive
      const response = await this.apiClient.triggerBatchArchive({
        urls: links,
        platform: 'googlemaps',
        options: {
          downloadMedia: this.settings.downloadMedia !== 'text-only',
        },
      });

      // Save pending job for recovery
      if (this.pendingJobsManager) {
        await this.pendingJobsManager.addJob({
          id: pendingJobId,
          url: links[0] ?? '', // Use first URL as representative (guaranteed non-empty by earlier check)
          platform: 'googlemaps',
          status: 'processing',
          timestamp: Date.now(),
          retryCount: 0,
          metadata: {
            type: 'batch-archive',
            batchUrls: links,
            batchJobId: response.batchJobId,
            workerJobId: response.batchJobId, // For compatibility with batch status check
            startedAt: Date.now(),
            downloadMedia: this.settings.downloadMedia,
            sourceNotePath, // Source note path for wiki link reference
          },
        });
      }

      new Notice(`⏳ Batch job started (${response.urlCount} locations). Please wait...`);

      // Poll for completion
      const result = await this.apiClient.waitForBatchJob(
        response.batchJobId,
        (_completed, _total) => {
          // Progress updates (optional)
        }
      );

      // Process results - create documents for each successful result
      await this.processBatchArchiveResult(result, pendingJobId, sourceNotePath);

    } catch (error) {
      // Update pending job with error (but don't remove - allows retry)
      if (this.pendingJobsManager) {
        try {
          const job = await this.pendingJobsManager.getJob(pendingJobId);
          if (job) {
            await this.pendingJobsManager.updateJob(pendingJobId, {
              status: 'failed',
              metadata: {
                ...job.metadata,
                lastError: error instanceof Error ? error.message : 'Unknown error',
                failedAt: Date.now(),
              },
            });
          }
        } catch (updateError) {
          console.error('[Social Archiver] Failed to update pending job:', updateError);
        }
      }

      new Notice(
        `❌ Batch archive failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        8000
      );
    }
  }

  /**
   * Process batch archive result and create documents
   * @param result - The batch archive job result
   * @param pendingJobId - Optional pending job ID for tracking
   * @param sourceNotePath - Optional source note path for wiki link reference
   */
  private async processBatchArchiveResult(
    result: import('./services/WorkersAPIClient').BatchArchiveJobStatusResponse,
    pendingJobId?: string,
    sourceNotePath?: string
  ): Promise<void> {
    const failCount = result.batchMetadata?.failedCount || 0;

    if (result.results && result.results.length > 0) {
      let created = 0;
      for (const item of result.results) {
        if (item.status === 'completed' && item.postData) {
          try {
            // Create document for this location with source note reference
            await this.createDocumentFromPostData(item.postData as PostData, item.url, sourceNotePath);
            created++;
          } catch (err) {
            console.error(`Failed to create document for ${item.url}:`, err);
          }
        }
      }

      // Refresh timeline to show new documents
      this.refreshTimelineView();

      // Mark pending job as completed
      if (pendingJobId && this.pendingJobsManager) {
        try {
          await this.pendingJobsManager.updateJob(pendingJobId, {
            status: 'completed',
            metadata: {
              batchCompletedCount: created,
              batchFailedCount: failCount,
              completedAt: Date.now(),
            },
          });
        } catch (updateError) {
          console.error('[Social Archiver] Failed to update pending job:', updateError);
        }
      }

      new Notice(
        `✅ Batch archive complete!\n` +
        `📍 Created: ${created} documents\n` +
        `❌ Failed: ${failCount} locations`,
        8000
      );
    } else {
      new Notice(`⚠️ Batch completed but no results received`);
    }
  }

  /**
   * Show confirmation modal for batch archive
   */
  private async showBatchArchiveConfirmation(links: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const plugin = this;

      class BatchConfirmModal extends Modal {
        result: boolean = false;
        private modalLinks: string[];

        constructor(private modalLinks_: string[]) {
          super(plugin.app);
          this.modalLinks = modalLinks_;
        }

        onOpen() {
          const { contentEl } = this;
          contentEl.empty();

          contentEl.createEl('h2', { text: 'Batch Archive Google Maps' });

          contentEl.createEl('p', {
            text: `Found ${this.modalLinks.length} Google Maps location${this.modalLinks.length > 1 ? 's' : ''} in this note.`
          });

          // Show link preview
          const previewContainer = contentEl.createDiv({ cls: 'batch-archive-preview sa-preview-container' });

          const list = previewContainer.createEl('ol');
          for (const link of this.modalLinks.slice(0, 10)) {
            const li = list.createEl('li');
            li.createEl('a', {
              text: link.length > 50 ? link.substring(0, 50) + '...' : link,
              href: link,
            });
          }
          if (this.modalLinks.length > 10) {
            list.createEl('li', {
              text: `... and ${this.modalLinks.length - 10} more`,
              cls: 'mod-muted',
            });
          }

          // TODO: Re-enable when credits are implemented
          // contentEl.createEl('p', {
          //   text: `This will use ${this.modalLinks.length} credit${this.modalLinks.length > 1 ? 's' : ''}.`,
          //   cls: 'mod-warning',
          // });

          // Buttons
          new Setting(contentEl)
            .addButton((btn: ButtonComponent) => btn
              .setButtonText('Cancel')
              .onClick(() => {
                this.result = false;
                this.close();
              }))
            .addButton((btn: ButtonComponent) => btn
              .setButtonText(`Archive ${this.modalLinks.length} locations`)
              .setCta()
              .onClick(() => {
                this.result = true;
                this.close();
              }));

          // Handle Enter key to confirm
          this.scope.register([], 'Enter', (evt: KeyboardEvent) => {
            evt.preventDefault();
            this.result = true;
            this.close();
            return false;
          });
        }

        onClose() {
          resolve(this.result);
        }
      }

      const modal = new BatchConfirmModal(links);
      modal.open();
    });
  }

  /**
   * Create a document from PostData (used by batch archive)
   * @param postData - The post data to convert
   * @param originalUrl - The original URL of the post
   * @param sourceNotePath - Optional source note path for wiki link reference in comment
   */
  private async createDocumentFromPostData(postData: PostData, originalUrl: string, sourceNotePath?: string): Promise<void> {
    const { MediaHandler } = await import('./services/MediaHandler');

    const vaultManager = new VaultManager({
      vault: this.app.vault,
      app: this.app,
      basePath: this.settings.archivePath || 'Social Archives',
      organizationStrategy: getVaultOrganizationStrategy(this.settings.archiveOrganization),
    });
    await vaultManager.initialize();

    const markdownConverter = new MarkdownConverter({
      frontmatterSettings: this.settings.frontmatter,
    });

    // Set source note wiki link as comment if sourceNotePath is provided
    if (sourceNotePath) {
      // Remove .md extension and create wiki link
      const noteName = sourceNotePath.replace(/\.md$/, '');
      postData.comment = `[[${noteName}]]`;
    }

    // Enrich author metadata (avatar download, followers, bio, etc.)
    await this.enrichAuthorMetadata(postData, postData.platform);

    // Download media if enabled
    let mediaResults: import('./services/MediaHandler').MediaResult[] | undefined;
    if (this.settings.downloadMedia !== 'text-only' && this.apiClient && postData.media && postData.media.length > 0) {
      const mediaHandler = new MediaHandler({
        vault: this.app.vault,
        app: this.app,
        workersClient: this.apiClient,
        basePath: this.settings.mediaPath || 'attachments/social-archives',
        optimizeImages: true,
        imageQuality: 0.8,
        maxImageDimension: 2048
      });

      try {
        mediaResults = await mediaHandler.downloadMedia(
          postData.media,
          postData.platform,
          postData.id || 'unknown',
          postData.author?.username || postData.author?.name || 'unknown'
        );
      } catch (err) {
        console.error('[Social Archiver] Media download failed:', err);
        // Continue without media - will use original URLs
      }
    }

    // Generate file path
    const timestamp = postData.metadata?.timestamp
      ? new Date(postData.metadata.timestamp)
      : new Date();
    const filePath = vaultManager.generateFilePath(postData, timestamp);

    // Convert to markdown with media results
    const result = await markdownConverter.convert(
      postData,
      undefined,  // customTemplate
      mediaResults  // mediaResults from MediaHandler
    );

    // Ensure folder exists
    const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));
    await this.ensureFolderExists(folderPath);

    // Create the file
    await this.app.vault.create(filePath, result.fullDocument);
  }

  private isValidUrl(text: string): boolean {
    try {
      const url = new URL(text);
      const supportedDomains = [
        'facebook.com',
        'fb.com',
        'linkedin.com',
        'instagram.com',
        'tiktok.com',
        'x.com',
        'twitter.com',
        'threads.net',
        'threads.com',
        'youtube.com',
        'youtu.be',
        'reddit.com',
        'redd.it',
        'pinterest.com',
        'pin.it',
        'substack.com',
        'tumblr.com'
      ];

      return supportedDomains.some(domain => url.hostname.includes(domain));
    } catch {
      return false;
    }
  }

  /**
   * Convert BrightData error codes to user-friendly messages
   */
  private getReadableErrorMessage(errorCode: string | undefined, errorMessage: string | undefined): string {
    // Fallback messages for error codes (used when no specific message is provided)
    const fallbackMessages: Record<string, string> = {
      'dead_page': 'This page is unavailable or has been removed',
      'private_account': 'This account is private',
      'blocked': 'Access to this profile is blocked',
      'rate_limited': 'Too many requests. Please try again later',
      'timeout': 'The request timed out. Please try again',
      'not_found': 'Profile not found',
      'login_required': 'This content requires login to view',
      'geo_blocked': 'This content is not available in your region',
      'CRAWL_ERROR': 'Failed to crawl the profile',
    };

    // Prefer original error message (more specific, e.g., "Posts for the specified period were not found")
    if (errorMessage) {
      return errorMessage;
    }

    // Fall back to code-based message if no specific message provided
    if (errorCode && fallbackMessages[errorCode]) {
      return fallbackMessages[errorCode];
    }

    return 'Unknown error occurred';
  }

  private registerProtocolHandler(): void {
    // Register obsidian://social-archive protocol
    // Handles two actions:
    // 1. Archive: obsidian://social-archive?url=https://...
    // 2. Auth: obsidian://social-archive?token=eyJhbGc...
    this.registerObsidianProtocolHandler('social-archive', async (params) => {
      // Handle authentication completion (token parameter present)
      if (params.token) {
        await this.handleAuthCompletion(params);
        return;
      }

      // Handle archive URL (existing behavior)
      const url = params.url;

      if (!url) {
        new Notice('No URL provided');
        return;
      }

      if (!this.isValidUrl(url)) {
        new Notice('Invalid or unsupported URL');
        return;
      }

      this.openArchiveModal(url);
    });
  }

  /**
   * Handle authentication completion from magic link
   *
   * Called when user clicks magic link and browser redirects to:
   * obsidian://social-archive?token=eyJhbGc...
   *
   * @param params - Protocol handler parameters
   */
  private async handleAuthCompletion(params: Record<string, string>): Promise<void> {
    const token = params.token;

    if (!token) {
      showAuthError('No authentication token provided');
      return;
    }

    // Show loading notice
    const loadingNotice = new Notice('🔐 Completing authentication...', 0);

    try {
      // Complete authentication using utility function
      const result = await completeAuthentication(this, token);

      // Dismiss loading notice
      loadingNotice.hide();

      if (!result.success) {
        showAuthError(result.error || 'Authentication failed');
        return;
      }

      // Show success message with instructions
      showAuthSuccess(result.username || 'User');

      // Refresh settings tab if it's currently open
      if (this.settingTab) {
        this.settingTab.display();
      }

      // Refresh all open timeline views to update auth state
      await this.refreshAllTimelines();

      // Show additional notice to guide user to settings (if not already open)
      // Note: Obsidian doesn't provide official API to programmatically open settings
      // Users need to manually open Settings > Social Archiver to see their account
      // On mobile, show longer duration and clearer instructions
      const settingsMessage = ObsidianPlatform.isMobile
        ? '💡 Tap ☰ menu → Settings (⚙️) → Social Archiver to view your account'
        : '💡 Settings updated! Check Social Archiver settings to view your account';

      const noticeDuration = ObsidianPlatform.isMobile ? 10000 : 8000;

      setTimeout(() => {
        new Notice(settingsMessage, noticeDuration);
      }, 2000);

    } catch (error) {
      // Dismiss loading notice
      loadingNotice.hide();

      showAuthError(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Known image extensions
   */
  private static readonly IMAGE_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'heic', 'heif', 'avif'
  ]);

  /**
   * Known video extensions
   */
  private static readonly VIDEO_EXTENSIONS = new Set([
    'mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'wmv', 'm4v'
  ]);

  /**
   * Video extensions supported by local Whisper transcription flow.
   */
  private static readonly TRANSCRIBABLE_VIDEO_EXTENSIONS = new Set([
    'mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'
  ]);

  private addVideoDownloadFailure(
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

  private appendVideoDownloadFailureSection(
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

  private applyVideoDownloadStatusFrontmatter(
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

  private notifyVideoDownloadFailures(failures: VideoDownloadFailure[]): void {
    if (failures.length === 0) return;
    const suffix = failures.length === 1 ? '' : 's';
    new Notice(
      `⚠️ ${failures.length} video${suffix} failed to download. Added failure status to the note.`,
      8000
    );
  }

  /**
   * Extract URL candidate from mixed media URL field (string/object).
   */
  private extractMediaUrlCandidate(value: unknown): string {
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
  private isLikelyVideoUrl(url: string): boolean {
    const ext = this.getFileExtension(url, false);
    if (ext && (SocialArchiverPlugin.VIDEO_EXTENSIONS.has(ext) || ext === 'm3u8' || ext === 'ts')) {
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
  private resolveMediaDownloadSource(
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
   * Get file extension from URL
   * @param url - The URL to extract extension from
   * @param isVideoThumbnail - If true, returns 'jpg' for unknown/invalid extensions
   */
  private getFileExtension(url: string, isVideoThumbnail: boolean = false): string | null {
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
            if (SocialArchiverPlugin.IMAGE_EXTENSIONS.has(cleanExt) ||
                SocialArchiverPlugin.VIDEO_EXTENSIONS.has(cleanExt)) {
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

  /**
   * Ensure folder exists in vault
   */
  private async ensureFolderExists(path: string): Promise<void> {
    const normalizedPath = normalizePath(path).replace(/^\/+|\/+$/g, '');
    if (!normalizedPath) {
      return;
    }

    const parts = normalizedPath.split('/').filter(Boolean);
    let currentPath = '';

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      const existing = this.app.vault.getFolderByPath(currentPath);
      if (!existing) {
        try {
          await this.app.vault.createFolder(currentPath);
        } catch (error) {
          const errorMessage = String(error).toLowerCase();
          if (errorMessage.includes('already exists') || errorMessage.includes('eexist')) {
            continue;
          }
          // Folder might have been created by another operation
          const folder = this.app.vault.getFolderByPath(currentPath);
          if (!folder) {
            throw error;
          }
        }
      }
    }
  }

  /**
   * Activate the Timeline View
   * Opens the view in the specified location (sidebar or main area)
   * Automatically refreshes the timeline when activated
   *
   * @param location - Where to open the timeline ('sidebar' or 'main')
   */
  async activateTimelineView(location: 'sidebar' | 'main' = 'sidebar'): Promise<void> {
    const { workspace } = this.app;
    let leaf;

    // If opening in main area, always create a new leaf (allow multiple instances)
    if (location === 'main') {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({
        type: VIEW_TYPE_TIMELINE,
        active: true,
      });
    } else {
      // Sidebar mode: check if view is already open in sidebar
      const existingLeaves = workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
      const sidebarLeaf = existingLeaves.find(l => {
        // Check if leaf is in right sidebar
        const parent = l.getRoot();
        return parent === workspace.rightSplit;
      });

      if (sidebarLeaf) {
        // Reuse existing sidebar leaf
        leaf = sidebarLeaf;
      } else {
        // Create new leaf in right sidebar
        const rightLeaf = workspace.getRightLeaf(false);
        if (rightLeaf) {
          leaf = rightLeaf;
          await leaf.setViewState({
            type: VIEW_TYPE_TIMELINE,
            active: true,
          });
        }
      }
    }

    // Reveal the leaf
    if (leaf) {
      void workspace.revealLeaf(leaf);

      // Refresh the timeline view to load new posts
      const view = leaf.view;
      if (view && 'refresh' in view && typeof view.refresh === 'function') {
        await view.refresh();
      }
    }
  }

  /**
   * Check pending jobs and process completions
   * Runs periodically and on startup to handle background archiving
   */
  async checkPendingJobs(): Promise<void> {
    if (this.pendingJobsCheckPromise) {
      return this.pendingJobsCheckPromise;
    }

    this.pendingJobsCheckPromise = this.runPendingJobsCheck().finally(() => {
      this.pendingJobsCheckPromise = null;
    });

    return this.pendingJobsCheckPromise;
  }

  private async runPendingJobsCheck(): Promise<void> {
    if (!this.pendingJobsManager) {
      console.warn('[Social Archiver] PendingJobsManager not initialized');
      return;
    }

    if (!this.apiClient) {
      console.warn('[Social Archiver] WorkersAPIClient not initialized');
      return;
    }

    let scheduledMissingStatusRecheck = false;

    try {
      // Get all pending and processing jobs
      const pendingJobs = await this.pendingJobsManager.getJobs({
        status: 'pending'
      });
      const processingJobs = await this.pendingJobsManager.getJobs({
        status: 'processing'
      });

      const processingDedupKeys = new Set(
        processingJobs.map((job) => this.buildPendingJobDedupKey(job))
      );
      const cyclePendingDedupKeys = new Set<string>();
      const sortedPendingJobs = [...pendingJobs].sort((a, b) => a.timestamp - b.timestamp);

      // Submit pending jobs to Workers API
      for (const job of sortedPendingJobs) {
        const dedupKey = this.buildPendingJobDedupKey(job);

        if (processingDedupKeys.has(dedupKey)) {
          await this.removeDuplicatePendingJob(job, 'matching processing job already exists');
          continue;
        }

        if (cyclePendingDedupKeys.has(dedupKey)) {
          await this.removeDuplicatePendingJob(job, 'duplicate pending job in current cycle');
          continue;
        }

        if (this.pendingJobSubmissionLocks.has(dedupKey)) {
          await this.removeDuplicatePendingJob(job, 'submission already in progress for same URL');
          continue;
        }

        cyclePendingDedupKeys.add(dedupKey);
        this.pendingJobSubmissionLocks.add(dedupKey);
        try {
          // Skip jobs that already have workerJobId (e.g., profile crawl jobs)
          // These jobs were already submitted via a different endpoint
          if (job.metadata?.workerJobId) {
            // Move to processing status if not already
            await this.pendingJobsManager.updateJob(job.id, {
              status: 'processing',
              metadata: {
                ...job.metadata,
                startedAt: job.metadata.startedAt ?? Date.now()
              }
            });
            continue;
          }

          // ========================================
          // Naver Cafe: Use local fetcher with cookie authentication
          // Bypasses Worker to properly support cookie auth via Obsidian's requestUrl
          // ========================================
          const { NaverCafeLocalService } = await import('./services/NaverCafeLocalService');
          if (NaverCafeLocalService.isCafeUrl(job.url) && this.settings.naverCookie) {
            try {
              this.archiveJobTracker.markProcessing(job.id);
              const downloadMode = (job.metadata?.downloadMedia ?? this.settings.downloadMedia) as MediaDownloadMode;
              await this.fetchNaverCafeLocally(job.url, job.metadata?.filePath, downloadMode, {
                comment: job.metadata?.notes,
              });

              // Mark job as completed
              await this.pendingJobsManager.updateJob(job.id, {
                status: 'completed',
                metadata: {
                  ...job.metadata,
                  completedAt: Date.now()
                }
              });
              this.archiveJobTracker.completeJob(job.id);

              console.debug(`[Social Archiver] Naver cafe archived locally: ${job.url}`);
              continue; // Skip Worker submission
            } catch (error) {
              console.error(`[Social Archiver] Naver cafe local fetch failed: ${job.url}`, error);
              await this.processFailedJob(job, error instanceof Error ? error.message : 'Unknown error');
              continue;
            }
          }

          // ========================================
          // Naver Blog: Use local fetcher for faster archiving
          // Bypasses Worker to reduce latency and BrightData credit usage
          // ========================================
          const { NaverBlogLocalService } = await import('./services/NaverBlogLocalService');
          if (NaverBlogLocalService.isBlogUrl(job.url)) {
            try {
              this.archiveJobTracker.markProcessing(job.id);
              const downloadMode = (job.metadata?.downloadMedia ?? this.settings.downloadMedia) as MediaDownloadMode;
              await this.fetchNaverBlogLocally(job.url, job.metadata?.filePath, downloadMode, {
                comment: job.metadata?.notes,
              });

              // Mark job as completed
              await this.pendingJobsManager.updateJob(job.id, {
                status: 'completed',
                metadata: {
                  ...job.metadata,
                  completedAt: Date.now()
                }
              });
              this.archiveJobTracker.completeJob(job.id);

              console.debug(`[Social Archiver] Naver blog archived locally: ${job.url}`);
              continue; // Skip Worker submission
            } catch (error) {
              console.error(`[Social Archiver] Naver blog local fetch failed: ${job.url}`, error);
              await this.processFailedJob(job, error instanceof Error ? error.message : 'Unknown error');
              continue;
            }
          }

          // ========================================
          // Brunch: Use local fetcher for faster archiving
          // Bypasses Worker to reduce latency and BrightData credit usage
          // ========================================
          const { BrunchLocalService } = await import('./services/BrunchLocalService');
          if (BrunchLocalService.isBrunchUrl(job.url)) {
            try {
              this.archiveJobTracker.markProcessing(job.id);
              const downloadMode = (job.metadata?.downloadMedia ?? this.settings.downloadMedia) as MediaDownloadMode;
              await this.fetchBrunchLocally(job.url, job.metadata?.filePath, downloadMode, {
                comment: job.metadata?.notes,
              });

              // Mark job as completed
              await this.pendingJobsManager.updateJob(job.id, {
                status: 'completed',
                metadata: {
                  ...job.metadata,
                  completedAt: Date.now()
                }
              });
              this.archiveJobTracker.completeJob(job.id);

              console.debug(`[Social Archiver] Brunch post archived locally: ${job.url}`);
              continue; // Skip Worker submission
            } catch (error) {
              console.error(`[Social Archiver] Brunch local fetch failed: ${job.url}`, error);
              await this.processFailedJob(job, error instanceof Error ? error.message : 'Unknown error');
              continue;
            }
          }

          // ========================================
          // Naver Webtoon: Use local fetcher for faster image downloads
          // Bypasses Worker proxy for direct image downloads
          // ========================================
          const { NaverWebtoonLocalService } = await import('./services/NaverWebtoonLocalService');
          if (NaverWebtoonLocalService.isWebtoonUrl(job.url)) {
            try {
              this.archiveJobTracker.markProcessing(job.id);
              const downloadMode = (job.metadata?.downloadMedia ?? this.settings.downloadMedia) as MediaDownloadMode;
              await this.fetchNaverWebtoonLocally(job.url, job.metadata?.filePath, downloadMode, {
                comment: job.metadata?.notes,
                jobId: job.id,
              });

              // Mark job as completed
              await this.pendingJobsManager.updateJob(job.id, {
                status: 'completed',
                metadata: {
                  ...job.metadata,
                  completedAt: Date.now()
                }
              });
              this.archiveJobTracker.completeJob(job.id);

              console.debug(`[Social Archiver] Naver Webtoon archived locally: ${job.url}`);
              continue; // Skip Worker submission
            } catch (error) {
              console.error(`[Social Archiver] Naver Webtoon local fetch failed: ${job.url}`, error);
              await this.processFailedJob(job, error instanceof Error ? error.message : 'Unknown error');
              continue;
            }
          }

          // Submit archive request
          this.archiveJobTracker.markProcessing(job.id);
          console.debug(`[Social Archiver] 🔄 Submitting archive request for: ${job.url} (platform: ${job.platform})`);
          const response = await this.apiClient.submitArchive({
            url: job.url,
            options: {
              enableAI: false,
              deepResearch: false,
              downloadMedia: job.metadata?.downloadMedia !== 'text-only',
              includeComments: job.metadata?.includeComments ?? this.settings.includeComments,
              includeTranscript: job.metadata?.includeTranscript,
              includeFormattedTranscript: job.metadata?.includeFormattedTranscript,
              pinterestBoard: job.metadata?.isPinterestBoard,
            },
            licenseKey: this.settings.licenseKey,
            // Naver: pass cookie for private cafe access
            naverCookie: this.settings.naverCookie || undefined,
            // Tell server to skip dispatching sync back to this Obsidian client
            sourceClientId: this.settings.syncClientId || undefined,
          });

          // Track URL for client-side dedup guard
          this.markRecentlyArchivedUrl(job.url);

          // DEBUG: Log full response for troubleshooting
          console.debug(`[Social Archiver] 📥 Archive response:`, JSON.stringify(response, null, 2));

          // Handle synchronous completion (Fediverse, Podcast, Naver, Naver Webtoon, cached YouTube)
          // These platforms return completed status immediately without polling
          if (response.status === 'completed' && response.result?.postData) {
            console.debug(`[Social Archiver] ✅ Synchronous completion detected for ${job.platform}`);

            // Use the same cross-path lock key as polling/WebSocket.
            // Without this, fast synchronous responses can race with ws:job_completed
            // and process the same job twice.
            const processingKey = response.jobId || job.metadata?.workerJobId || job.id;
            if (this.processingJobs.has(processingKey)) {
              console.debug(`[Social Archiver] ⏭️ Skipping synchronous completion for already-processing job: ${processingKey}`);
              continue;
            }
            this.processingJobs.add(processingKey);

            // Process immediately without going through polling
            try {
              await this.pendingJobsManager.updateJob(job.id, {
                status: 'completed',
                metadata: {
                  ...job.metadata,
                  workerJobId: response.jobId,
                  completedAt: Date.now()
                }
              });

              // Process the completed result
              const jobStatusData = {
                jobId: response.jobId,
                status: 'completed' as const,
                result: response.result,
              };

              console.debug(`[Social Archiver] 🔄 Processing completed job... (media count: ${(response.result?.postData as { media?: unknown[] } | undefined)?.media?.length || 0})`);
              await this.processCompletedJob(job, jobStatusData);
              this.archiveJobTracker.completeJob(job.id);
              console.debug(`[Social Archiver] 🎉 Job ${job.id} completed synchronously`);
            } catch (processError) {
              console.error(`[Social Archiver] ❌ processCompletedJob failed:`, processError);
              console.error(`[Social Archiver] ❌ Error details:`, {
                message: processError instanceof Error ? processError.message : String(processError),
                stack: processError instanceof Error ? processError.stack : undefined,
                jobId: job.id,
                platform: job.platform,
              });
              throw processError; // Re-throw to be caught by outer catch
            } finally {
              this.processingJobs.delete(processingKey);
            }
            continue; // Skip to next job
          }

          // Handle series selection required (Naver Webtoon series URL)
          if (response.type === 'series_selection_required' || response.status === 'series_selection_required') {
            console.debug(`[Social Archiver] 📚 Series selection required for Naver Webtoon`);

            // Mark job as failed with special message - user needs to use episode URL
            await this.pendingJobsManager.updateJob(job.id, {
              status: 'failed',
              metadata: {
                ...job.metadata,
                lastError: 'Please use a specific episode URL instead of series URL. Open the webtoon and select an episode to archive.',
                failedAt: Date.now()
              }
            });

            // Update archive banner with failure
            this.archiveJobTracker.failJob(job.id, 'Please use a specific episode URL instead of series URL.');

            new Notice('📚 Naver Webtoon: Please use episode URL instead of series URL', 8000);
            continue;
          }

          // Update job with worker job ID and mark as processing (for async platforms)
          console.debug(`[Social Archiver] ⏳ Async processing - marking as processing, jobId: ${response.jobId}`);
          await this.pendingJobsManager.updateJob(job.id, {
            status: 'processing',
            metadata: {
              ...job.metadata,
              workerJobId: response.jobId,  // ✅ metadata 안에 저장
              startedAt: Date.now()
            }
          });
          this.archiveJobTracker.markProcessing(job.id, response.jobId);

          // Register pending job on server for cross-device sync (if enabled)
          if (this.settings.enableServerPendingJobs) {
            try {
              const archiveOptions: PendingJobArchiveOptions = {
                downloadMedia: job.metadata?.downloadMedia,
                includeTranscript: job.metadata?.includeTranscript,
                includeFormattedTranscript: job.metadata?.includeFormattedTranscript,
                comment: job.metadata?.notes,
              };

              await this.apiClient.createPendingJob({
                jobId: response.jobId,
                url: job.url,
                platform: job.platform,
                filePath: job.metadata?.filePath, // Vault-relative path (optional in single-write mode)
                archiveOptions,
              });

              console.debug(`[Social Archiver] Registered pending job on server: ${response.jobId}`);
            } catch (serverError) {
              // Non-critical: log warning but continue
              // Job can still complete via local PendingJobsManager and WebSocket
              console.warn('[Social Archiver] Failed to register pending job on server:', serverError);
            }
          }

        } catch (error) {
          console.error(`[Social Archiver] Failed to submit job ${job.id}:`, error);
          await this.processFailedJob(job, error instanceof Error ? error.message : 'Unknown error');
        } finally {
          this.pendingJobSubmissionLocks.delete(dedupKey);
        }
      }

      // Re-fetch processing jobs (includes newly submitted jobs)
      const allProcessingJobs = await this.pendingJobsManager.getJobs({
        status: 'processing'
      });

      if (allProcessingJobs.length === 0) {
        // No jobs to check
        return;
      }

      // Filter out jobs that were submitted too recently (within grace period)
      const now = Date.now();
      const jobsReadyForCheck = allProcessingJobs.filter(job => {
        const startedAt = job.metadata?.startedAt;
        if (!startedAt) return true; // No startedAt means it's been running for a while
        const elapsed = now - startedAt;
        if (elapsed < JOB_SUBMISSION_GRACE_PERIOD) {
          return false;
        }
        return true;
      });

      // Separate batch-archive jobs from regular jobs
      const batchArchiveJobs = jobsReadyForCheck.filter(job => job.metadata?.type === 'batch-archive');
      const regularJobs = jobsReadyForCheck.filter(job => job.metadata?.type !== 'batch-archive');

      // Process batch-archive jobs separately
      for (const batchJob of batchArchiveJobs) {
        if (this.processingJobs.has(batchJob.id)) {
          continue;
        }

        const batchJobId = batchJob.metadata?.batchJobId;
        if (!batchJobId) {
          console.warn(`[Social Archiver] Batch job ${batchJob.id} missing batchJobId`);
          continue;
        }

        try {
          const batchStatus = await this.apiClient.getBatchJobStatus(batchJobId);

          if (batchStatus.status === 'completed') {
            this.processingJobs.add(batchJob.id);
            try {
              await this.processBatchArchiveResult(batchStatus, batchJob.id);
            } catch (processError) {
              console.error(`[Social Archiver] Failed to process batch job ${batchJob.id}:`, processError);
              await this.pendingJobsManager.updateJob(batchJob.id, {
                status: 'failed',
                metadata: {
                  ...batchJob.metadata,
                  lastError: processError instanceof Error ? processError.message : 'Failed to process batch result',
                  failedAt: Date.now(),
                },
              });
            } finally {
              this.processingJobs.delete(batchJob.id);
            }
          } else if (batchStatus.status === 'failed') {
            await this.pendingJobsManager.updateJob(batchJob.id, {
              status: 'failed',
              metadata: {
                ...batchJob.metadata,
                lastError: batchStatus.error || 'Batch job failed',
                failedAt: Date.now(),
              },
            });
            new Notice(`❌ Batch archive failed: ${batchStatus.error || 'Unknown error'}`);
          }
          // If still processing, do nothing - will be checked again on next cycle
        } catch (error) {
          console.error(`[Social Archiver] Failed to check batch job ${batchJob.id}:`, error);
        }
      }

      // Extract worker job IDs for batch checking (regular jobs only)
      const jobIds = [...new Set(
        regularJobs
          .map(job => job.metadata?.workerJobId)
          .filter((id): id is string => !!id)
      )];

      if (jobIds.length === 0) {
        // No regular jobs ready for checking yet - schedule a recheck if there are pending jobs
        if (allProcessingJobs.length > batchArchiveJobs.length) {
          this.scheduleMissingStatusCheck(JOB_SUBMISSION_GRACE_PERIOD);
        }
        return;
      }

      // Batch check job statuses using WorkersAPIClient
      const batchResponse = await this.apiClient.batchGetJobStatus(jobIds);

      // Validate response
      if (!batchResponse || !batchResponse.results) {
        console.error('[Social Archiver] Invalid batch response:', batchResponse);
        return;
      }

      // Process results
      for (const result of batchResponse.results) {
        // Find corresponding pending job by worker job ID
        const pendingJob = jobsReadyForCheck.find(j => j.metadata?.workerJobId === result.jobId);
        if (!pendingJob) {
          continue;
        }

        // Skip if already being processed by WebSocket handler.
        // Use worker job ID as the shared lock key between WebSocket and polling paths.
        const processingKey = result.jobId || pendingJob.metadata?.workerJobId || pendingJob.id;
        if (this.processingJobs.has(processingKey)) {
          continue;
        }

        if (result.status === 'completed' && result.data?.result) {
          // Process completed job
          this.processingJobs.add(processingKey);

          try {
            // Update job status to completed BEFORE processing (same as WebSocket handler)
            // This prevents the job from being re-processed on next polling cycle
            await this.pendingJobsManager.updateJob(pendingJob.id, {
              status: 'completed',
              metadata: {
                ...pendingJob.metadata,
                completedAt: Date.now()
              }
            });

            await this.processCompletedJob(pendingJob, result.data);
          } catch (processError) {
            // If processing fails, mark as failed so it can be retried
            console.error(`[Social Archiver] Failed to process completed job ${pendingJob.id}:`, processError);
            await this.processFailedJob(
              pendingJob,
              processError instanceof Error ? processError.message : 'Failed to process completed job'
            );
          } finally {
            this.processingJobs.delete(processingKey);
          }
        } else if (result.status === 'failed') {
          // Process failed job reported by Workers API
          const errorMessage = result.error || result.data?.error || 'Unknown error';

          // Check if this is a transient "not ready yet" error from BrightData
          const isTransientError = errorMessage.includes('Snapshot does not exist') ||
                                   errorMessage.includes('404');

          if (isTransientError) {
            // Check if job still exists (might have been processed by WebSocket)
            const currentJob = await this.pendingJobsManager.getJob(pendingJob.id);
            if (!currentJob) {
              continue;
            }

            const now = Date.now();
            const statusUnavailableSince = currentJob.metadata?.statusUnavailableSince ?? now;
            const elapsed = now - statusUnavailableSince;

            const updatedMetadata = {
              ...currentJob.metadata,
              statusUnavailableSince,
              lastError: errorMessage
            };

            await this.pendingJobsManager.updateJob(pendingJob.id, {
              status: 'processing',
              metadata: updatedMetadata
            });

            // Only mark as truly failed after timeout (2 minutes)
            if (elapsed >= MISSING_STATUS_TIMEOUT) {
              await this.processFailedJob({ ...currentJob, metadata: updatedMetadata }, errorMessage);
            } else {
              if (!scheduledMissingStatusRecheck) {
                this.scheduleMissingStatusCheck();
                scheduledMissingStatusRecheck = true;
              }
            }
          } else {
            // Real failure - process as failed
            await this.processFailedJob(pendingJob, errorMessage);
          }
        } else if (result.status === null) {
          // Job status temporarily unavailable (e.g., KV not replicated yet).
          // Check if job still exists (might have been processed by WebSocket)
          const currentJob = await this.pendingJobsManager.getJob(pendingJob.id);
          if (!currentJob) {
            continue;
          }

          const now = Date.now();
          const statusUnavailableSince = currentJob.metadata?.statusUnavailableSince ?? now;
          const errorMessage = result.error || result.data?.error || 'Job status unavailable';
          const updatedMetadata = {
            ...currentJob.metadata,
            statusUnavailableSince,
            lastError: errorMessage
          };

          await this.pendingJobsManager.updateJob(pendingJob.id, {
            status: 'processing',
            metadata: updatedMetadata
          });

          if (now - statusUnavailableSince >= MISSING_STATUS_TIMEOUT) {
            await this.processFailedJob({ ...currentJob, metadata: updatedMetadata }, errorMessage);
          } else {
            if (!scheduledMissingStatusRecheck) {
              this.scheduleMissingStatusCheck();
              scheduledMissingStatusRecheck = true;
            }
          }
        } else {
          // Still processing - update status
          // Check if job still exists (might have been processed by WebSocket)
          const currentJob = await this.pendingJobsManager.getJob(pendingJob.id);
          if (!currentJob) {
            continue;
          }

          const updatedMetadata = {
            ...currentJob.metadata,
            workerJobId: result.jobId
          };

          if (Object.prototype.hasOwnProperty.call(updatedMetadata, 'statusUnavailableSince')) {
            delete (updatedMetadata as { statusUnavailableSince?: number }).statusUnavailableSince;
          }
          if (Object.prototype.hasOwnProperty.call(updatedMetadata, 'missingStatusCount')) {
            delete (updatedMetadata as { missingStatusCount?: number }).missingStatusCount;
          }

          await this.pendingJobsManager.updateJob(pendingJob.id, {
            status: 'processing',
            metadata: updatedMetadata
          });
        }
      }

    } catch (error) {
      console.error('[Social Archiver] Error checking pending jobs:', error);
      throw error; // Re-throw for caller's catch block to handle
    }
  }

  private scheduleMissingStatusCheck(delay: number = MISSING_STATUS_RETRY_DELAY): void {
    this.scheduleTrackedTimeout(() => {
      this.checkPendingJobs().catch(error => {
        console.error('[Social Archiver] Missing status recheck failed:', error);
      });
    }, delay);
  }

  /**
   * Sync pending jobs from server on startup
   * Processes completed jobs that were finished while this device was offline
   */
  private async syncPendingJobsFromServer(): Promise<void> {
    try {
      // Only sync if we have apiClient and auth configured
      if (!this.apiClient || !this.settings.username) {
        return;
      }

      const response = await this.apiClient.getPendingJobs({ status: 'completed' });

      if (!response.success || !response.jobs?.length) {
        return;
      }

      console.debug(`[Social Archiver] Found ${response.jobs.length} completed jobs from server to process`);

      for (const serverJob of response.jobs) {
        try {
          if (!serverJob.result) {
            // No result data - clean up
            await this.apiClient.deletePendingJob(serverJob.jobId).catch(() => {});
            continue;
          }

          // Prevent duplicate processing
          if (this.processingJobs.has(serverJob.jobId)) {
            continue;
          }
          this.processingJobs.add(serverJob.jobId);

          try {
            // Process using existing logic (single-write: creates final file directly)
            await this.processCompletedJobFromServer(serverJob);

            console.debug(`[Social Archiver] Processed synced job from server: ${serverJob.jobId}`);
          } finally {
            this.processingJobs.delete(serverJob.jobId);
          }

          // Clean up server state
          await this.apiClient.deletePendingJob(serverJob.jobId).catch(() => {
            // Non-critical: TTL will eventually clean up
          });
        } catch (error) {
          console.error(`[Social Archiver] Failed to process synced job ${serverJob.jobId}:`, error);
        }
      }
    } catch (error) {
      console.error('[Social Archiver] Failed to sync pending jobs from server:', error);
    }
  }

  /**
   * Process a completed job from server sync
   * Converts ServerPendingJob to local job format and processes
   */
  private async processCompletedJobFromServer(serverJob: ServerPendingJob): Promise<void> {
    if (!serverJob.result?.postData) {
      console.warn(`[Social Archiver] Server job ${serverJob.jobId} has no result data`);
      return;
    }

    // Convert to local job format for existing processCompletedJob
    const localJob = {
      id: serverJob.jobId,
      url: serverJob.url,
      platform: serverJob.platform,
      status: 'completed' as const,
      timestamp: serverJob.createdAt,
      retryCount: 0,
      metadata: {
        filePath: serverJob.filePath,
        workerJobId: serverJob.jobId,
        downloadMedia: serverJob.archiveOptions?.downloadMedia,
        includeTranscript: serverJob.archiveOptions?.includeTranscript,
        includeFormattedTranscript: serverJob.archiveOptions?.includeFormattedTranscript,
        notes: serverJob.archiveOptions?.comment,
      }
    };

    // Reuse existing processing logic
    await this.processCompletedJob(localJob, {
      result: serverJob.result,
    });
  }

  /**
   * Process completed archive job
   * Converts PostData to markdown and saves to vault
   */
  private async processCompletedJob(
    pendingJob: any,
    jobStatusResponse: any
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

      const postData = result.postData;

      // ========== Embedded Archive Mode ==========
      if (pendingJob.metadata?.embeddedArchive === true) {
        const parentFilePath = pendingJob.metadata.parentFilePath;

        if (!parentFilePath) {
          throw new Error('Parent file path not found');
        }

        // Read parent file
        const parentFile = this.app.vault.getAbstractFileByPath(parentFilePath);
        if (!parentFile || !(parentFile instanceof TFile)) {
          throw new Error(`Parent file not found: ${parentFilePath}`);
        }

        // ========== STEP 2: Parse Current Post ==========
        const { PostDataParser } = await import('./components/timeline/parsers/PostDataParser');
        const parser = new PostDataParser(this.app.vault, this.app);
        const currentPost = await parser.parseFile(parentFile);

        if (!currentPost) {
          throw new Error('Failed to parse parent post');
        }

        // archivedData = postData (from Workers API - already includes media)
        const archivedData = postData;

        // ========== STEP 3: Download Media Files ==========
        const { MediaHandler } = await import('./services/MediaHandler');
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
        let mediaResults: any[] = [];

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

          archivedData.media = archivedData.media.map((media: any, index: number) => {
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
        const { VaultStorageService } = await import('./services/VaultStorageService');
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
        new Notice(`✅ Embedded archive added: ${postData.author?.name || 'Post'}`, 5000);

        // ========== STEP 8: Refresh Timeline ==========
        this.refreshTimelineView();
        try {
          await refreshUserCredits(this);
        } catch (refreshError) {
          console.error('[Social Archiver] Failed to refresh user credits after embedded archive', refreshError);
        }
        return; // Early return for embedded archive
      }

      // ========== Normal Archive Mode (기존 로직) ==========
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
      });
      const markdownConverter = new MarkdownConverter({
        frontmatterSettings: this.settings.frontmatter,
      });

      await vaultManager.initialize();
      await markdownConverter.initialize();

      // Track downloaded media for markdown conversion
      const downloadedMedia: Array<import('./services/MediaHandler').MediaResult> = [];
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
        const now = new Date();
        const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

        for (let i = 0; i < postData.media.length; i++) {
          const media = postData.media[i];

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
            const selectedSource = this.resolveMediaDownloadSource(media, postData.platform);
            mediaUrl = selectedSource.mediaUrl;
            const isVideoThumbnail = selectedSource.isVideoThumbnail;
            if (media.type === 'video') {
              console.debug('[Social Archiver] Video media source selected', {
                platform: postData.platform,
                mediaUrl,
                isThumbnailFallback: isVideoThumbnail,
              });
              if (shouldAttemptVideoDownloads && isVideoThumbnail) {
                this.addVideoDownloadFailure(failedVideoDownloads, {
                  index: i,
                  originalUrl: this.extractMediaUrlCandidate(media.url),
                  attemptedUrl: mediaUrl,
                  reason: 'Video URL unavailable; thumbnail fallback used',
                  thumbnailFallback: true,
                });
              }
            }

            // Generate filename: YYYYMMDD-username-postId-index.ext
            // Format: 20251121-hallasansnow-DRPFtcOEvbl-2.jpg
            let extension = this.getFileExtension(
              mediaUrl,
              isVideoThumbnail
            ) || (isVideoThumbnail ? 'jpg' : media.type === 'video' ? 'mp4' : 'jpg');
            let filename = `${dateStr}-${sanitizedAuthor}-${sanitizedPostId}-${i + 1}.${extension}`;
            const basePath = mediaFolderPath;
            let fullPath = `${basePath}/${filename}`;

            // Check if file already exists
            const existingFile = this.app.vault.getAbstractFileByPath(fullPath);

            if (existingFile) {
              // File already exists, reuse it
              const stat = await this.app.vault.adapter.stat(fullPath);
              downloadedMedia.push({
                originalUrl: mediaUrl,
                localPath: fullPath,
                type: media.type,
                size: stat?.size || 0,
                file: existingFile as any,
              });
            } else {
              let arrayBuffer: ArrayBuffer;

              // Check if it's a blob URL (TikTok videos)
              if (mediaUrl.startsWith('blob:')) {
                // NOTE: Using fetch() for blob: URLs - requestUrl() doesn't support blob: protocol
                const response = await fetch(mediaUrl);
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
                const { MediaHandler } = await import('./services/MediaHandler');
                const mediaHandler = new MediaHandler({
                  vault: this.app.vault,
                  app: this.app,
                  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                  workersClient: this.apiClient!,
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
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                arrayBuffer = await this.apiClient!.proxyMedia(mediaUrl);
              }

              // Detect actual format from binary data and convert HEIC if needed
              if (media.type === 'image') {
                const { detectAndConvertHEIC } = await import('./utils/heic');
                const result = await detectAndConvertHEIC(arrayBuffer, extension, 0.95);

                // Update data and extension if conversion occurred
                arrayBuffer = result.data;
                extension = result.extension;
                filename = `${dateStr}-${sanitizedAuthor}-${sanitizedPostId}-${i + 1}.${extension}`;
                fullPath = `${basePath}/${filename}`;
              }

              // Ensure folder exists
              await this.ensureFolderExists(basePath);

              // Save to vault
              const file = await this.app.vault.createBinary(fullPath, arrayBuffer);

              downloadedMedia.push({
                originalUrl: mediaUrl,
                localPath: file.path,
                type: media.type,
                size: arrayBuffer.byteLength,
                file: file,
              });
            }

          } catch (error) {
            // TikTok videos often fail due to DRM protection - skip for now
            // (fallback would require MediaResult.file which we don't have)
            // Continue with next media item
            console.warn(`[Social Archiver] Failed to download media ${i + 1}:`, error);
            if (shouldAttemptVideoDownloads && media.type === 'video') {
              this.addVideoDownloadFailure(failedVideoDownloads, {
                index: i,
                originalUrl: this.extractMediaUrlCandidate(media.url),
                attemptedUrl: mediaUrl,
                reason: error instanceof Error ? error.message : 'Unknown error',
                thumbnailFallback: false,
              });
            }
          }
        }

        if (downloadedMedia.length < postData.media.length) {
          new Notice(`⚠️ Downloaded ${downloadedMedia.length}/${postData.media.length} media files`, 5000);
        }
      }

      // Enrich author metadata (avatar download, followers, bio, etc.)
      await this.enrichAuthorMetadata(postData, postData.platform);

      // Filter comments based on user option
      const shouldIncludeComments = pendingJob.metadata?.includeComments ?? this.settings.includeComments;
      if (!shouldIncludeComments) {
        delete postData.comments;
      }

      // Convert to markdown (with downloaded media paths)
      let markdown = await markdownConverter.convert(postData, undefined, downloadedMedia.length > 0 ? downloadedMedia : undefined);

      // Add metadata to frontmatter
      markdown.frontmatter.download_time = Math.round((Date.now() - startTime) / 100) / 10;

      // Add user notes if provided
      if (pendingJob.metadata?.notes) {
        markdown.frontmatter.comment = pendingJob.metadata.notes;
      }

      // Add URL to processedUrls
      const processedUrls = uniqueStrings(
        [pendingJob.url, pendingJob.metadata?.originalUrl].filter(Boolean) as string[],
        normalizeUrlForDedup
      );
      markdown.frontmatter.processedUrls = processedUrls;

      // Mark archive as completed
      markdown.frontmatter.archiveStatus = 'completed';
      this.applyVideoDownloadStatusFrontmatter(
        markdown.frontmatter as Record<string, unknown>,
        totalVideoMediaCount,
        failedVideoDownloads
      );
      if (failedVideoDownloads.length > 0) {
        markdown.content = this.appendVideoDownloadFailureSection(markdown.content, failedVideoDownloads);
      }

      // Regenerate fullDocument with updated frontmatter
      markdown = markdownConverter.updateFullDocument(markdown);

      // If we have a preliminary document, update it; otherwise create new file
      if (preliminaryFilePath) {
        const file = this.app.vault.getAbstractFileByPath(preliminaryFilePath);
        if (file) {
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
            if (existingFile) {
              // Update existing file content
              await this.app.vault.modify(existingFile as any, markdown.fullDocument);
              // Delete preliminary file
              await this.app.fileManager.trashFile(file as any);
            } else {
              // Rename file and update content
              await this.app.vault.rename(file as any, correctFilePath);
              const renamedFile = this.app.vault.getAbstractFileByPath(correctFilePath);
              if (renamedFile) {
                await this.app.vault.modify(renamedFile as any, markdown.fullDocument);
              }
            }
          } else {
            // Same path, just update content
            await this.app.vault.modify(file as any, markdown.fullDocument);
          }

        } else {
          // Preliminary file was deleted, create new one
          await vaultManager.savePost(postData, markdown);
        }
      } else {
        // No preliminary document (shouldn't happen with new flow, but fallback)
        await vaultManager.savePost(postData, markdown);
      }

      // Remove job from pending queue
      await this.pendingJobsManager.removeJob(pendingJob.id);

      // Update archive banner (completeJob auto-hides after 5s)
      this.archiveJobTracker.completeJob(pendingJob.id);

      // Show success notice
      new Notice(`✅ Archive completed: ${postData.author?.name || 'Post'}`, 5000);
      this.notifyVideoDownloadFailures(failedVideoDownloads);

      // Refresh Timeline View
      this.refreshTimelineView();
      try {
        await refreshUserCredits(this);
      } catch (refreshError) {
        console.error('[Social Archiver] Failed to refresh user credits after archive', refreshError);
      }

    } catch (error) {
      console.error(`[Social Archiver] Error processing completed job ${pendingJob.id}:`, error);
      // Mark as failed so it can be retried or removed
      await this.processFailedJob(pendingJob, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Process failed archive job
   * Implements retry logic with exponential backoff
   */
  private async processFailedJob(
    pendingJob: any,
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
        new Notice(`⚠️ Archive failed, retrying... (${currentRetryCount + 1}/${MAX_RETRIES})`, 4000);

      } else {
        // Max retries exceeded - update archive banner
        this.archiveJobTracker.failJob(currentJob.id, errorMessage);

        // Remove job
        await this.pendingJobsManager.removeJob(currentJob.id);

        console.error(`[Social Archiver] Job ${currentJob.id} failed after ${MAX_RETRIES} retries: ${errorMessage}`);

        // Show failure notice
        new Notice(`❌ Archive failed after ${MAX_RETRIES} retries: ${errorMessage.substring(0, 50)}...`, 8000);
      }

    } catch (error) {
      console.error(`[Social Archiver] Error processing failed job ${pendingJob.id}:`, error);
    }
  }

  /**
   * Enrich post data with author metadata (avatar, followers, bio, etc.)
   * Uses ProfileDataMapper for platform-specific field extraction
   * and AuthorAvatarService for local avatar storage
   *
   * @param postData - The post data to enrich (will be mutated)
   * @param platform - The platform the post is from
   */
  private async enrichAuthorMetadata(postData: PostData, platform: Platform): Promise<void> {
    // Skip if settings disable metadata updates
    if (!this.settings.downloadAuthorAvatars && !this.settings.updateAuthorMetadata) {
      return;
    }

    try {
      // Extract profile data from raw API response using ProfileDataMapper
      const rawResponse = postData.raw;

      // If no raw response, still try to register subreddit for Reddit posts
      // (Subscription posts may not have raw data but have parsed community info)
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

  /**
   * Post current note to the timeline (local only)
   * Copies the note to Social Archives/Post/ folder with proper frontmatter
   */
  private async postCurrentNote(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice('No active note to post');
      return;
    }

    try {
      const postService = new PostService(this.app, this.app.vault, this.settings);
      const result = await postService.postNote(activeFile);

      if (result.success) {
        new Notice('Posted to timeline');
        // Refresh timeline if open
        await this.refreshOpenTimelines();
      } else {
        new Notice(`Failed to post: ${result.error}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      new Notice(`Failed to post: ${errorMessage}`);
      console.error('[Social Archiver] Post failed:', error);
    }
  }

  /**
   * Post and share current note
   * Posts to timeline and uploads to server for public sharing
   */
  private async postAndShareCurrentNote(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice('No active note to post');
      return;
    }

    try {
      // Step 1: Post locally first
      const postService = new PostService(this.app, this.app.vault, this.settings);
      const postResult = await postService.postNote(activeFile);

      if (!postResult.success) {
        new Notice(`Failed to post: ${postResult.error}`);
        return;
      }

      // Step 2: Get the posted file
      const postedFile = this.app.vault.getFileByPath(postResult.copiedFilePath);
      if (!postedFile) {
        new Notice('Failed to find posted file');
        return;
      }

      // Step 3: Read content and frontmatter
      const content = await this.app.vault.read(postedFile);
      const cache = this.app.metadataCache.getFileCache(postedFile);
      const frontmatter = cache?.frontmatter || {};

      // Step 4: Build media array from copied media paths
      const media = this.buildMediaFromPaths(postResult.copiedMediaPaths);

      // Step 5: Create PostData from the posted note
      const postData: PostData = {
        platform: 'post' as Platform,
        id: frontmatter.originalPath || postedFile.path,
        url: '', // User posts don't have an original URL
        title: postedFile.basename,
        author: {
          name: this.settings.username || 'anonymous',
          url: '',
        },
        content: {
          text: this.extractBodyContent(content),
          hashtags: frontmatter.tags || [],
        },
        media,
        metadata: {
          timestamp: new Date(frontmatter.postedAt || Date.now()),
          likes: 0,
          comments: 0,
          shares: 0,
        },
      };

      // Step 6: Use ShareAPIClient to share the note
      const { ShareAPIClient } = await import('./services/ShareAPIClient');
      const shareClient = new ShareAPIClient({
        baseURL: this.settings.workerUrl,
        apiKey: this.settings.authToken,
        vault: this.app.vault,
        pluginVersion: this.manifest.version,
      });

      // First create share without media (to get shareId)
      const postDataWithoutMedia = { ...postData, media: [] };
      const createResponse = await shareClient.createShare({
        postData: postDataWithoutMedia,
        options: {
          username: this.settings.username,
          tier: this.settings.tier,
        },
      });

      // Then upload media using updateShareWithMedia (handles R2 upload)
      let shareResponse = createResponse;
      if (media.length > 0) {
        shareResponse = await shareClient.updateShareWithMedia(
          createResponse.shareId,
          postData,
          {
            username: this.settings.username,
            tier: this.settings.tier,
          }
        );
      }

      // Step 7: Update frontmatter with share info
      await this.updatePostFrontmatter(postedFile, content, {
        share: true,
        shareUrl: shareResponse.shareUrl,
        shareMode: this.settings.shareMode,
      });

      // Copy URL to clipboard
      await navigator.clipboard.writeText(shareResponse.shareUrl);
      new Notice('Shared! URL copied to clipboard');

      // Refresh timeline
      await this.refreshOpenTimelines();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      new Notice(`Failed to share: ${errorMessage}`);
      console.error('[Social Archiver] Post and share failed:', error);
    }
  }

  /**
   * Extract body content from markdown (remove frontmatter)
   */
  private extractBodyContent(content: string): string {
    const frontmatterRegex = /^---\n[\s\S]*?\n---\n?/;
    return content.replace(frontmatterRegex, '').trim();
  }

  /**
   * Build Media array from copied media paths
   */
  private buildMediaFromPaths(mediaPaths: string[]): Media[] {
    const IMAGE_EXTENSIONS = new Set([
      'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'heic', 'heif', 'avif'
    ]);
    const VIDEO_EXTENSIONS = new Set([
      'mp4', 'mov', 'webm', 'avi', 'mkv'
    ]);

    return mediaPaths.map(path => {
      const ext = path.split('.').pop()?.toLowerCase() || '';
      let type: 'image' | 'video' | 'audio' | 'document' = 'document';

      if (IMAGE_EXTENSIONS.has(ext)) {
        type = 'image';
      } else if (VIDEO_EXTENSIONS.has(ext)) {
        type = 'video';
      }

      return {
        type,
        url: path, // Local vault path - ShareAPIClient will handle upload
      };
    });
  }

  /**
   * Update frontmatter of a posted file
   */
  private async updatePostFrontmatter(
    file: TFile,
    content: string,
    updates: Record<string, unknown>
  ): Promise<void> {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n?/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      // No frontmatter, add it
      const frontmatterLines = Object.entries(updates)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join('\n');
      const newContent = `---\n${frontmatterLines}\n---\n\n${content}`;
      await this.app.vault.modify(file, newContent);
      return;
    }

    // Parse existing frontmatter and add updates
    const existingFm = match[1] ?? '';
    const bodyContent = content.slice(match[0].length);

    // Simple update: append new fields to existing frontmatter
    const updateLines = Object.entries(updates)
      .map(([key, value]) => {
        if (typeof value === 'string') {
          return `${key}: ${value}`;
        }
        return `${key}: ${JSON.stringify(value)}`;
      })
      .join('\n');

    // Remove existing keys that are being updated
    const updatedFm = existingFm
      .split('\n')
      .filter(line => {
        const key = line.split(':')[0]?.trim() ?? '';
        return !Object.keys(updates).includes(key);
      })
      .join('\n');

    const newFrontmatter = updatedFm.trim() + '\n' + updateLines;
    const newContent = `---\n${newFrontmatter}\n---\n\n${bodyContent}`;

    await this.app.vault.modify(file, newContent);
  }

  /**
   * Refresh all open timeline views
   */
  private async refreshOpenTimelines(): Promise<void> {
    const timelineLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
    for (const leaf of timelineLeaves) {
      const view = leaf.view;
      if (view instanceof TimelineView) {
        await view.refresh();
      }
    }
  }

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

  /**
   * Format Brunch comments to markdown string
   *
   * Timeline-compatible format:
   * ## 💬 Comments
   *
   * **[@author](url)** · timestamp · N likes
   * comment content
   *
   * ---
   *
   * **[@author2](url)** · timestamp
   * content
   */
  private formatBrunchCommentsToMarkdown(
    comments: BrunchComment[],
    authorMap: Map<string, string> = new Map()
  ): string {
    if (!comments || comments.length === 0) {
      return '';
    }

    const lines: string[] = [];
    lines.push('');
    lines.push('## 💬 Comments');
    lines.push('');

    for (let i = 0; i < comments.length; i++) {
      const comment = comments[i];
      if (!comment) continue;
      const formattedComment = this.formatSingleBrunchComment(comment, false, authorMap);
      lines.push(formattedComment);

      // Add separator between top-level comments (not after the last one)
      if (i < comments.length - 1) {
        lines.push('---');
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Format a single Brunch comment with nested replies
   * Timeline-compatible format: **[@author](url)** · timestamp · N likes
   *
   * For replies, content must be indented with 2 spaces for parser compatibility
   */
  private formatSingleBrunchComment(
    comment: BrunchComment,
    isReply: boolean,
    authorMap: Map<string, string> = new Map()
  ): string {
    const lines: string[] = [];

    // Format timestamp (short format for timeline compatibility)
    const date = new Date(comment.timestamp);
    const formattedDate = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    // Build author link: **[@author](url)**
    // Resolve internal ID in authorUrl if present
    let authorUrl = comment.authorUrl || `https://brunch.co.kr/@${comment.author}`;
    const authorIdMatch = authorUrl.match(/brunch\.co\.kr\/@([^/]+)/);
    if (authorIdMatch && authorIdMatch[1] && BrunchLocalService.isInternalId(authorIdMatch[1])) {
      const resolvedAuthor = authorMap.get(authorIdMatch[1]);
      if (resolvedAuthor) {
        authorUrl = `https://brunch.co.kr/@${resolvedAuthor}`;
      }
    }
    let header = isReply ? '↳ ' : '';
    header += `**[@${comment.author}](${authorUrl})**`;

    // Add timestamp
    header += ` · ${formattedDate}`;

    // Add likes count if available
    if (comment.likes && comment.likes > 0) {
      header += ` · ${comment.likes} likes`;
    }

    // Add badge for TopCreator
    if (comment.isTopCreator) {
      header += ' 🌟';
    }

    lines.push(header);

    // Clean up content: convert Brunch mention format @[userId:name] -> [@name](url)
    // Uses resolved authorMap to convert internal IDs to real usernames
    const cleanContent = BrunchLocalService.convertMentions(comment.content, authorMap);

    // Comment content - replies need 2-space indent for each line
    if (isReply) {
      const contentLines = cleanContent.split('\n');
      for (const line of contentLines) {
        lines.push(`  ${line}`);
      }
    } else {
      lines.push(cleanContent);
    }

    lines.push('');

    // Nested replies
    if (comment.replies && comment.replies.length > 0) {
      for (const reply of comment.replies) {
        lines.push(this.formatSingleBrunchComment(reply, true, authorMap));
      }
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Sync Client Registration Methods (Public API for Settings UI)
  // ============================================================================

  /**
   * Register this Obsidian vault as a sync client
   * Called from settings UI to enable mobile sync
   */
  async registerSyncClient(): Promise<{ success: boolean; clientId?: string; error?: string }> {
    if (!this.apiClient) {
      return { success: false, error: 'API client not initialized' };
    }

    if (!this.settings.authToken) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      // Generate client name from vault name
      const vaultName = this.app.vault.getName();
      const clientName = `Obsidian - ${vaultName}`;

      const response = await this.apiClient.registerSyncClient({
        clientType: 'obsidian',
        clientName,
        settings: {
          vaultName,
          platform: ObsidianPlatform.isMobile ? 'mobile' : 'desktop',
          deviceId: this.settings.deviceId,
        },
      });

      if (response.clientId) {
        this.settings.syncClientId = response.clientId;
        await this.saveSettings();
        console.debug('[Social Archiver] Registered sync client:', response.clientId);
        return { success: true, clientId: response.clientId };
      }

      return { success: false, error: 'Registration failed' };
    } catch (error) {
      console.error('[Social Archiver] Sync client registration failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Registration failed',
      };
    }
  }

  /**
   * Unregister this vault as a sync client
   * Called from settings UI to disable mobile sync
   */
  async unregisterSyncClient(): Promise<{ success: boolean; error?: string }> {
    if (!this.apiClient) {
      return { success: false, error: 'API client not initialized' };
    }

    const clientId = this.settings.syncClientId;
    if (!clientId) {
      return { success: true }; // Already unregistered
    }

    try {
      await this.apiClient.deleteSyncClient(clientId);
      this.settings.syncClientId = '';
      await this.saveSettings();
      console.debug('[Social Archiver] Unregistered sync client:', clientId);
      return { success: true };
    } catch (error) {
      console.error('[Social Archiver] Sync client unregistration failed:', error);
      // Still clear local setting even if server call fails
      this.settings.syncClientId = '';
      await this.saveSettings();
      return { success: true };
    }
  }
}
