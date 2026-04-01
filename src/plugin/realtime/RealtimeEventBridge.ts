/**
 * RealtimeEventBridge - WebSocket event listener setup extracted from main.ts
 *
 * Registers all `ws:*` event handlers that bridge real-time WebSocket messages
 * (job completion, subscription posts, profile crawls, client sync, etc.)
 * into plugin-side actions (vault writes, tracker updates, notifications).
 *
 * Single Responsibility: translate incoming WS events into plugin side-effects.
 */

import { Events, EventRef, Notice } from 'obsidian';
import type { App } from 'obsidian';
import type { PendingJob } from '../../services/PendingJobsManager';
import type { PendingPost } from '../../services/SubscriptionManager';
import type { CrawlJobTracker } from '../../services/CrawlJobTracker';
import type { ArchiveJobTracker } from '../../services/ArchiveJobTracker';
import type { ArchiveLookupService } from '../../services/ArchiveLookupService';
import type { AnnotationSyncService } from '../../services/AnnotationSyncService';
import type { ArchiveDeleteSyncService } from '../sync/ArchiveDeleteSyncService';
import type { ArchiveTagOutboundService } from '../sync/ArchiveTagOutboundService';
import type { ArchiveStateSyncService } from '../sync/ArchiveStateSyncService';
import type { SocialArchiverSettings } from '../../types/settings';
import type { PostData, Platform } from '../../types/post';
import type {
  ClientSyncEventData,
  ShareDeletedEventData,
  ActionUpdatedEventData,
  ArchiveDeletedEventData,
  ArchiveTagsUpdatedEventData,
} from '../../types/websocket';
import { TimelineView, VIEW_TYPE_TIMELINE } from '../../views/TimelineView';

// ============================================================================
// Inline WS Payload Types (moved from main.ts)
// ============================================================================

/** Shape of the ws:job_completed WebSocket event payload. */
export interface WsJobCompletedMessage {
  jobId: string;
  result: unknown;
  metadata?: {
    url?: string;
    platform?: string;
    filePath?: string;
    archiveOptions?: {
      downloadMedia?: boolean;
      includeTranscript?: boolean;
      includeFormattedTranscript?: boolean;
      tags?: string[];
    };
  };
}

/** Shape of the ws:job_failed WebSocket event payload. */
export interface WsJobFailedMessage {
  jobId?: string;
  error?: { message: string; code?: string };
  handle?: string;
}

/** Shape of the ws:truncation_warning WebSocket event payload. */
export interface WsTruncationWarningMessage {
  handle?: string;
  totalFound: number;
  maxAllowed: number;
  truncatedCount: number;
  isProfileCrawl: boolean;
}

/** Shape of the ws:subscription_post WebSocket event payload. */
export interface WsSubscriptionPostMessage {
  post?: PostData;
  destinationFolder?: string;
  pendingPostId?: string;
  subscriptionId?: string;
  subscriptionName?: string;
  isProfileCrawl?: boolean;
  archiveId?: string;
}

/** Profile metadata sent with ws:profile_metadata events. */
export interface WsProfileMetadata {
  avatarUrl?: string;
  displayName?: string;
  bio?: string;
  followers?: number;
  following?: number;
  postsCount?: number;
  verified?: boolean;
  location?: string;
}

/** Shape of the ws:profile_metadata WebSocket event payload. */
export interface WsProfileMetadataMessage {
  metadata: WsProfileMetadata;
  handle: string;
  platform: string;
  profileUrl: string;
}

/** Minimal shape of a job status response passed to processCompletedJob. */
export interface CompletedJobResponse {
  result?: {
    type?: string;
    postData?: unknown;
    creditsUsed?: number;
    processingTime?: number;
    cached?: boolean;
  };
  metadata?: { type?: string };
}

/** Shape of the ws:profile_crawl_complete WebSocket event payload. */
export interface WsProfileCrawlCompleteMessage {
  jobId?: string;
  handle: string;
  platform: string;
  posts?: PostData[];
  stats?: {
    processedCount?: number;
    allDuplicates?: boolean;
  };
  isFediverse?: boolean;
  isYouTube?: boolean;
  isBlog?: boolean;
  isXcancel?: boolean;
  isInstagramDirect?: boolean;
  isFacebookDirect?: boolean;
}

// ============================================================================
// Minimal API Client interface (only the method used in event handlers)
// ============================================================================

interface RealtimeApiClient {
  deletePendingJob(jobId: string): Promise<unknown>;
}

// ============================================================================
// Minimal PendingJobsManager interface (only the methods used)
// ============================================================================

interface RealtimePendingJobsManager {
  getJobByWorkerJobId(workerJobId: string): Promise<PendingJob | null>;
  getJob(id: string): Promise<PendingJob | null>;
  updateJob(id: string, updates: Partial<PendingJob>): Promise<void>;
  removeJob(id: string): Promise<void>;
}

// ============================================================================
// Dependency Interface
// ============================================================================

export interface RealtimeEventBridgeDeps {
  events: Events;
  pendingJobsManager: RealtimePendingJobsManager;
  archiveJobTracker: ArchiveJobTracker;
  crawlJobTracker: CrawlJobTracker;
  subscriptionManager: { acknowledgePendingPosts: (ids: string[]) => Promise<void> } | undefined;
  archiveLookupService: ArchiveLookupService | undefined;
  annotationSyncService: AnnotationSyncService | undefined;
  archiveStateSyncService?: ArchiveStateSyncService | undefined;
  archiveDeleteSyncService?: ArchiveDeleteSyncService | undefined;
  archiveTagOutboundService?: ArchiveTagOutboundService | undefined;
  app: App;
  settings: () => SocialArchiverSettings;
  apiClient: () => RealtimeApiClient | undefined;
  processCompletedJob: (job: PendingJob, payload: CompletedJobResponse) => Promise<void>;
  processFailedJob: (job: PendingJob, message: string) => Promise<void>;
  saveSubscriptionPost: (pendingPost: PendingPost) => Promise<boolean>;
  syncSubscriptionPosts: () => Promise<void>;
  createProfileNote: (message: WsProfileMetadataMessage) => Promise<void>;
  refreshTimelineView: () => void;
  processPendingSyncQueue: () => Promise<void>;
  processSyncQueueItem: (queueId: string, archiveId: string, clientId: string) => Promise<boolean>;
  getReadableErrorMessage: (code: string | undefined, msg: string | undefined) => string;
  processingJobs: Set<string>;
  notify: (message: string, timeout?: number) => void;
  schedule: (callback: () => void, delay: number) => number;
  currentCrawlWorkerJobId: { value: string | undefined };
  wsPostBatchCount: { value: number };
  wsPostBatchTimer: { value: number | undefined };
}

// ============================================================================
// RealtimeEventBridge
// ============================================================================

export class RealtimeEventBridge {
  private eventRefs: EventRef[] = [];
  private readonly deps: RealtimeEventBridgeDeps;

  constructor(deps: RealtimeEventBridgeDeps) {
    this.deps = deps;
  }

  /**
   * Remove all registered event listeners.
   */
  clear(): void {
    this.eventRefs.forEach(ref => this.deps.events.offref(ref));
    this.eventRefs = [];
  }

  /**
   * Register all WS event listeners. Clears existing ones first to prevent duplicates.
   */
  setup(): void {
    this.clear();

    this.setupJobCompletedListener();
    this.setupJobFailedListener();
    this.setupTruncationWarningListener();
    this.setupConnectionStatusListeners();
    this.setupSubscriptionPostListener();
    this.setupProfileMetadataListener();
    this.setupProfileCrawlCompleteListener();
    this.setupClientSyncListener();
    this.setupShareDeletedListener();
    this.setupActionUpdatedListener();
    this.setupArchiveTagsUpdatedListener();
    this.setupArchiveDeletedListener();
  }

  // --------------------------------------------------------------------------
  // ws:job_completed
  // --------------------------------------------------------------------------

  private setupJobCompletedListener(): void {
    this.eventRefs.push(
      this.deps.events.on('ws:job_completed', async (data: unknown) => {
        const message = data as WsJobCompletedMessage;
        const { jobId, result, metadata } = message;
        if (!jobId) {
          console.warn('[Social Archiver] job_completed event missing jobId');
          return;
        }

        // Check if already processing this job (prevent concurrent processing across devices)
        if (this.deps.processingJobs.has(jobId)) {
          return;
        }

        // Try 1: Find job by worker job ID (fast path, same device)
        let job = await this.deps.pendingJobsManager.getJobByWorkerJobId(jobId);

        // Try 2: Use metadata from WebSocket (different device, both online)
        if (!job && metadata) {
          // Create synthetic job for cross-device processing (single-write: no preliminary doc needed)
          job = {
            id: jobId,
            url: metadata.url || '',
            platform: (metadata.platform || 'unknown') as Platform,
            status: 'processing',
            timestamp: Date.now(),
            retryCount: 0,
            metadata: {
              filePath: metadata.filePath,
              workerJobId: jobId,
              downloadMedia: metadata.archiveOptions?.downloadMedia !== undefined
                ? String(metadata.archiveOptions.downloadMedia)
                : undefined,
              includeTranscript: metadata.archiveOptions?.includeTranscript,
              includeFormattedTranscript: metadata.archiveOptions?.includeFormattedTranscript,
              selectedTags: metadata.archiveOptions?.tags,
            },
          };
          console.debug(`[Social Archiver] Processing job ${jobId} from WebSocket metadata (cross-device)`);
        }

        if (!job) {
          // No local job and no valid metadata - will be recovered on next app start via server sync
          console.debug(`[Social Archiver] Job ${jobId} not found locally, will sync on restart`);
          return;
        }

        // Mark as processing using workerJobId
        this.deps.processingJobs.add(jobId);

        try {
          // Update local job status if it exists in PendingJobsManager
          const localJob = await this.deps.pendingJobsManager.getJobByWorkerJobId(jobId);
          if (localJob) {
            await this.deps.pendingJobsManager.updateJob(localJob.id, {
              status: 'completed',
              metadata: {
                ...localJob.metadata,
                completedAt: Date.now(),
              },
            });
          }

          // Process the completed job immediately
          await this.deps.processCompletedJob(job, { result: result as CompletedJobResponse['result'] });

          // Update archive banner
          const completedLocalJob = await this.deps.pendingJobsManager.getJobByWorkerJobId(jobId);
          this.deps.archiveJobTracker.completeJob(completedLocalJob?.id || jobId);

          // Clean up server pending job after successful processing (if enabled)
          const settings = this.deps.settings();
          if (settings.enableServerPendingJobs) {
            this.deps.apiClient()?.deletePendingJob(jobId).catch(err => {
              console.debug(`[Social Archiver] Failed to clean up server pending job ${jobId}:`, err);
            });
          }
        } catch (error) {
          console.error('[Social Archiver] Failed to process completed job:', error);
          const localJob = await this.deps.pendingJobsManager.getJobByWorkerJobId(jobId);
          if (localJob) {
            await this.deps.pendingJobsManager.updateJob(localJob.id, {
              status: 'failed',
              metadata: {
                ...localJob.metadata,
                lastError: error instanceof Error ? error.message : 'Failed to process job',
              },
            });
            this.deps.archiveJobTracker.failJob(
              localJob.id,
              error instanceof Error ? error.message : 'Failed to process job',
            );
          }
        } finally {
          this.deps.processingJobs.delete(jobId);
        }
      }),
    );
  }

  // --------------------------------------------------------------------------
  // ws:job_failed
  // --------------------------------------------------------------------------

  private setupJobFailedListener(): void {
    this.eventRefs.push(
      this.deps.events.on('ws:job_failed', async (data: unknown) => {
        const message = data as WsJobFailedMessage;
        const { jobId, error, handle } = message;

        // Update CrawlJobTracker for failed jobs (jobId is workerJobId)
        if (jobId) {
          const crawlJob = this.deps.crawlJobTracker.getJobByWorkerJobId(jobId);
          if (crawlJob) {
            this.deps.crawlJobTracker.failJob(crawlJob.jobId, error?.message || 'Unknown error');
          }
        }

        // Find job by worker job ID and update status in PendingJobsManager
        if (jobId) {
          const job = await this.deps.pendingJobsManager.getJobByWorkerJobId(jobId);
          if (job) {
            await this.deps.pendingJobsManager.updateJob(job.id, {
              status: 'failed',
              metadata: {
                ...job.metadata,
                lastError: error?.message || 'Unknown error',
                failedAt: Date.now(),
              },
            });
            // Update archive banner
            this.deps.archiveJobTracker.failJob(job.id, error?.message || 'Unknown error');
          }
        }

        // Show user-friendly error notification
        const handleDisplay = handle ? `@${handle}` : 'the profile';
        const errorMessage = this.deps.getReadableErrorMessage(error?.code, error?.message);
        new Notice(`Profile crawl failed for ${handleDisplay}: ${errorMessage}`, 8000);
      }),
    );
  }

  // --------------------------------------------------------------------------
  // ws:truncation_warning
  // --------------------------------------------------------------------------

  private setupTruncationWarningListener(): void {
    this.eventRefs.push(
      this.deps.events.on('ws:truncation_warning', (data: unknown) => {
        const message = data as WsTruncationWarningMessage;
        const { handle, totalFound, maxAllowed, truncatedCount, isProfileCrawl } = message;
        const handleDisplay = handle ? `@${handle}` : 'profile';
        const source = isProfileCrawl ? 'Profile crawl' : 'Subscription';

        new Notice(
          `\u26A0\uFE0F ${source} for ${handleDisplay}: Found ${totalFound} posts, but only ${maxAllowed} were archived. ${truncatedCount} posts exceeded the limit.`,
          10000,
        );
      }),
    );
  }

  // --------------------------------------------------------------------------
  // ws:connected / ws:closed / ws:error
  // --------------------------------------------------------------------------

  private setupConnectionStatusListeners(): void {
    this.eventRefs.push(
      this.deps.events.on('ws:connected', () => {
        // Flush any pending outbound deletes queued while offline
        void this.deps.archiveDeleteSyncService?.flushPendingDeletes();

        // Process any pending sync queue items missed while offline
        const settings = this.deps.settings();
        if (settings.syncClientId) {
          this.deps.schedule(() => {
            void this.deps.processPendingSyncQueue();
          }, 2000);
        }
      }),
    );

    this.eventRefs.push(
      this.deps.events.on('ws:closed', () => {
        // no-op: handled by reconnect logic
      }),
    );

    this.eventRefs.push(
      this.deps.events.on('ws:error', (error: unknown) => {
        console.error('[Social Archiver] WebSocket error:', error);
      }),
    );
  }

  // --------------------------------------------------------------------------
  // ws:subscription_post
  // --------------------------------------------------------------------------

  private setupSubscriptionPostListener(): void {
    this.eventRefs.push(
      this.deps.events.on('ws:subscription_post', async (data: unknown) => {
        const message = data as WsSubscriptionPostMessage;
        // If message contains post data, save it directly (bypasses KV eventual consistency)
        if (message.post && message.destinationFolder) {
          try {
            // Suppress timeline refresh on first post of a batch
            if (this.deps.wsPostBatchCount.value === 0) {
              // Track workerJobId when first post of profile crawl batch arrives
              if (message.isProfileCrawl && message.subscriptionId) {
                this.deps.currentCrawlWorkerJobId.value = message.subscriptionId;
              }

              const timelineLeaves = this.deps.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
              for (const leaf of timelineLeaves) {
                const view = leaf.view;
                if (view instanceof TimelineView) {
                  view.suppressAutoRefresh();
                }
              }
            }
            this.deps.wsPostBatchCount.value++;

            // Track profile crawl progress via workerJobId
            if (message.isProfileCrawl && message.subscriptionId) {
              this.deps.crawlJobTracker.incrementProgressByWorkerJobId(message.subscriptionId);
            }

            // Inject archiveId into post so plugin can set sourceArchiveId in frontmatter
            // This mirrors what ArchiveLibrarySyncService.saveArchive() does
            if (message.archiveId) {
              message.post.sourceArchiveId = message.archiveId;
            }

            const pendingPost: PendingPost = {
              id: message.pendingPostId || crypto.randomUUID(),
              subscriptionId: message.subscriptionId ?? '',
              subscriptionName: message.subscriptionName ?? '',
              post: message.post,
              destinationFolder: message.destinationFolder,
              archivedAt: new Date().toISOString(),
            };

            const saved = await this.deps.saveSubscriptionPost(pendingPost);
            if (saved) {
              // Acknowledge the pending post to remove it from KV
              if (message.pendingPostId && this.deps.subscriptionManager) {
                try {
                  await this.deps.subscriptionManager.acknowledgePendingPosts([message.pendingPostId]);
                } catch {
                  // Non-critical: post is saved, KV cleanup will happen eventually
                }
              }
            }

            // Reset batch timer - resume timeline after 3s of no new posts
            if (this.deps.wsPostBatchTimer.value) {
              window.clearTimeout(this.deps.wsPostBatchTimer.value);
            }
            this.deps.wsPostBatchTimer.value = window.setTimeout(() => {
              const batchSize = this.deps.wsPostBatchCount.value;
              this.deps.wsPostBatchCount.value = 0;
              this.deps.wsPostBatchTimer.value = undefined;

              // Complete any active crawl jobs based on the batch that just finished
              if (this.deps.currentCrawlWorkerJobId.value) {
                const crawlJob = this.deps.crawlJobTracker.getJobByWorkerJobId(
                  this.deps.currentCrawlWorkerJobId.value,
                );
                if (crawlJob) {
                  this.deps.crawlJobTracker.completeJob(crawlJob.jobId, crawlJob.receivedPosts);
                  // Also remove from PendingJobsManager to prevent restoration on reload
                  this.deps.pendingJobsManager.removeJob(crawlJob.jobId).catch(() => {
                    // Ignore - job was likely already removed by profile_crawl_complete handler
                  });
                }
                this.deps.currentCrawlWorkerJobId.value = undefined;
              }

              // Resume timeline refresh
              const timelineLeaves = this.deps.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
              for (const leaf of timelineLeaves) {
                const view = leaf.view;
                if (view instanceof TimelineView) {
                  view.resumeAutoRefresh();
                }
              }

              if (batchSize > 1) {
                new Notice(`Archived ${batchSize} new posts`);
              }
            }, 3000);
          } catch (error) {
            console.error('[Social Archiver] Failed to save WebSocket post:', error);
            // Fall back to KV sync after delay
            await new Promise(resolve => window.setTimeout(resolve, 2000));
            await this.deps.syncSubscriptionPosts();
          }
        } else {
          // Fallback: fetch from KV (for older message format)
          await new Promise(resolve => window.setTimeout(resolve, 1000));
          await this.deps.syncSubscriptionPosts();
        }
      }),
    );
  }

  // --------------------------------------------------------------------------
  // ws:profile_metadata
  // --------------------------------------------------------------------------

  private setupProfileMetadataListener(): void {
    this.eventRefs.push(
      this.deps.events.on('ws:profile_metadata', async (data: unknown) => {
        const message = data as WsProfileMetadataMessage;
        // Create profile-only note when posts fail to load
        if (message.metadata && message.profileUrl) {
          try {
            await this.deps.createProfileNote(message);
          } catch (error) {
            console.error('[Social Archiver] Failed to create profile note:', error);
          }
        }
      }),
    );
  }

  // --------------------------------------------------------------------------
  // ws:profile_crawl_complete
  // --------------------------------------------------------------------------

  private setupProfileCrawlCompleteListener(): void {
    this.eventRefs.push(
      this.deps.events.on('ws:profile_crawl_complete', async (data: unknown) => {
        const message = data as WsProfileCrawlCompleteMessage;
        const { jobId, handle, platform, posts, stats, isFediverse, isYouTube, isBlog, isXcancel, isInstagramDirect, isFacebookDirect } =
          message;
        // Direct API platforms: posts delivered via WebSocket (no BrightData webhook)
        const isDirectApiPlatform = isFediverse || isYouTube || isBlog || isXcancel || isInstagramDirect || isFacebookDirect;

        // Update CrawlJobTracker status
        if (jobId) {
          const postCount = stats?.processedCount || posts?.length || 0;

          // Always try to complete the job (including 0 posts from empty date range)
          const directJob = this.deps.crawlJobTracker.getJob(jobId);
          if (directJob) {
            this.deps.crawlJobTracker.completeJob(jobId, postCount);
          } else {
            const internalJobId = this.deps.crawlJobTracker.getInternalJobIdByWorkerJobId(jobId);
            if (internalJobId) {
              this.deps.crawlJobTracker.completeJob(internalJobId, postCount);
            } else {
              // Fallback: complete any crawling job for same handle
              const allJobs = this.deps.crawlJobTracker.getAllJobs();
              const matchingJob = allJobs.find(j => j.handle === handle && j.status === 'crawling');
              if (matchingJob) {
                this.deps.crawlJobTracker.completeJob(matchingJob.jobId, postCount);
              } else {
                // For direct API platforms: WebSocket arrives before startJob() is called
                // Register a completed job immediately so no stale banner appears
                if (isDirectApiPlatform && handle) {
                  this.deps.crawlJobTracker.startJob(
                    {
                      jobId,
                      handle,
                      platform: (platform || 'bluesky') as Platform,
                      estimatedPosts: postCount,
                    },
                    jobId,
                  );
                  this.deps.crawlJobTracker.completeJob(jobId, postCount);
                }
              }
            }
          }

          // Show "no posts found" notice for direct API platforms with 0 results
          if (isDirectApiPlatform && postCount === 0 && !stats?.allDuplicates) {
            new Notice(`\u2139\uFE0F No posts found for @${handle} in the specified range`, 5000);
          }
        }

        // Process posts from direct API crawl (free API platforms)
        if (isDirectApiPlatform && posts && posts.length > 0) {
          // Get destination folder from pending job or use default
          const pendingJob = jobId ? await this.deps.pendingJobsManager?.getJob(jobId) : null;
          const settings = this.deps.settings();
          const destinationFolder =
            pendingJob?.metadata?.destinationFolder || settings.archivePath || 'Social Archives';

          // Suppress timeline refresh during batch processing
          const timelineLeaves = this.deps.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
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
              const pendingPost: PendingPost = {
                id: crypto.randomUUID(),
                subscriptionId: jobId ?? '',
                subscriptionName: `Profile Crawl: @${handle}`,
                post,
                destinationFolder,
                archivedAt: new Date().toISOString(),
              };

              const saved = await this.deps.saveSubscriptionPost(pendingPost);
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
          new Notice(`\u2705 Archived ${savedCount} posts from @${handle}`, 5000);
        }

        // Remove pending job from PendingJobsManager
        const isFediverseOnly = isFediverse && !isYouTube && !isBlog;
        if (jobId && this.deps.pendingJobsManager && !isFediverseOnly) {
          try {
            await this.deps.pendingJobsManager.removeJob(jobId);
          } catch {
            // Job might not exist if already removed by batch timer
          }
        }
      }),
    );
  }

  // --------------------------------------------------------------------------
  // ws:client_sync
  // --------------------------------------------------------------------------

  private setupClientSyncListener(): void {
    this.eventRefs.push(
      this.deps.events.on('ws:client_sync', async (message: unknown) => {
        const msg = message as { type: string; data: ClientSyncEventData } | undefined;
        if (!msg?.data) {
          console.warn('[Social Archiver] Invalid client_sync message format');
          return;
        }

        const { queueId, archiveId, clientId } = msg.data;

        // Verify this event is for us
        const settings = this.deps.settings();
        if (clientId !== settings.syncClientId) {
          console.debug('[Social Archiver] Ignoring sync event for different client:', clientId);
          return;
        }

        const displayTitle =
          msg.data.archive?.title || msg.data.archive?.authorName || msg.data.archive?.platform || 'Archive';
        new Notice(`\uD83D\uDCF1 Mobile sync: ${displayTitle}`, 3000);

        await this.deps.processSyncQueueItem(queueId, archiveId, clientId);
      }),
    );
  }

  // --------------------------------------------------------------------------
  // ws:share_deleted
  // --------------------------------------------------------------------------

  private setupShareDeletedListener(): void {
    this.eventRefs.push(
      this.deps.events.on('ws:share_deleted', async (message: unknown) => {
        const msg = message as { type: string; data: ShareDeletedEventData } | undefined;
        if (!msg?.data?.shareUrl) return;

        const { shareUrl } = msg.data;
        console.debug(`[Social Archiver] Share deleted via WS: ${shareUrl}`);

        // Find the vault file with matching shareUrl in frontmatter
        const files = this.deps.app.vault.getMarkdownFiles();
        for (const file of files) {
          const cache = this.deps.app.metadataCache.getFileCache(file);
          if (cache?.frontmatter?.shareUrl === shareUrl) {
            try {
              await this.deps.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
                fm.share = false;
                delete fm.shareUrl;
                delete fm.shareExpiry;
              });
              new Notice('Share link removed from note', 3000);
            } catch (err) {
              console.error('[Social Archiver] Failed to update frontmatter for share_deleted:', err);
            }
            break;
          }
        }
      }),
    );
  }

  // --------------------------------------------------------------------------
  // ws:action_updated
  // --------------------------------------------------------------------------

  private setupActionUpdatedListener(): void {
    this.eventRefs.push(
      this.deps.events.on('ws:action_updated', (_message: unknown) => {
        const msg = _message as { type: string; data: ActionUpdatedEventData } | undefined;
        if (!msg?.data) return;

        console.debug('[Social Archiver] Action updated via WS:', msg.data.archiveId, msg.data.changes);

        // Annotation sync: patch managed block and frontmatter in the local vault note
        const settings = this.deps.settings();
        if (msg.data.changes.hasAnnotationUpdate) {
          if (!settings.enableMobileAnnotationSync) {
            console.debug('[Social Archiver] Annotation update received but Mobile Annotation Sync is disabled. Enable it in Settings → Mobile sync.');
          } else {
            void this.deps.annotationSyncService?.handleActionUpdated(msg.data);
          }
        }

        // Archive state sync: update fm.archive when isBookmarked changes from mobile
        if (msg.data.changes.isBookmarked !== undefined) {
          void this.deps.archiveStateSyncService?.handleRemoteArchiveState(msg.data);
        }
      }),
    );
  }

  // --------------------------------------------------------------------------
  // ws:archive_tags_updated
  // --------------------------------------------------------------------------

  private setupArchiveTagsUpdatedListener(): void {
    this.eventRefs.push(
      this.deps.events.on('ws:archive_tags_updated', async (_message: unknown) => {
        const msg = _message as { type: string; data: ArchiveTagsUpdatedEventData } | undefined;
        if (!msg?.data) return;

        const settings = this.deps.settings();
        if (!settings.enableMobileAnnotationSync) return;

        const { archiveId, tags: serverTags, sourceClientId } = msg.data;

        // Echo suppression: skip if this event was triggered by our own outbound sync
        if (sourceClientId && sourceClientId === settings.syncClientId) {
          console.debug('[Social Archiver] Skipping own archive_tags_updated echo for:', archiveId);
          return;
        }

        // Also skip if ArchiveTagOutboundService has a live suppression for this archive
        if (this.deps.archiveTagOutboundService?.isSuppressed(archiveId)) {
          console.debug('[Social Archiver] Skipping suppressed archive_tags_updated for:', archiveId);
          return;
        }

        console.debug('[Social Archiver] Archive tags updated via WS:', archiveId, serverTags);

        // Find vault file by sourceArchiveId (only stable lookup)
        const file = this.deps.archiveLookupService?.findBySourceArchiveId(archiveId) ?? null;
        if (!file) {
          console.debug('[Social Archiver] No matching vault file for archive_tags_updated:', archiveId);
          return;
        }

        // Suppress outbound re-sync for this inbound write (prevents loop)
        this.deps.archiveTagOutboundService?.addSuppression(archiveId);

        // REPLACEMENT semantics: set archiveTags to the server's canonical tag list.
        // Do NOT modify fm.tags — that field is local-only (Obsidian tag index).
        try {
          await this.deps.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            fm.archiveTags = serverTags;

            // Backfill sourceArchiveId if missing
            if (!fm.sourceArchiveId) {
              fm.sourceArchiveId = archiveId;
            }
          });

          console.debug('[Social Archiver] archiveTags replaced for:', file.path, { serverTags });
        } catch (err) {
          console.error(
            '[Social Archiver] Failed to update archiveTags frontmatter:',
            file.path,
            err instanceof Error ? err.message : String(err),
          );
        }
      }),
    );
  }

  // --------------------------------------------------------------------------
  // ws:archive_deleted
  // --------------------------------------------------------------------------

  private setupArchiveDeletedListener(): void {
    this.eventRefs.push(
      this.deps.events.on('ws:archive_deleted', async (_message: unknown) => {
        const msg = _message as { type: string; data: ArchiveDeletedEventData } | undefined;
        if (!msg?.data) return;

        const { archiveId, originalUrl } = msg.data;
        console.debug('[Social Archiver] Archive deleted via WS:', archiveId);

        // Delegate to ArchiveDeleteSyncService for proper loop-guard and feature-flag handling
        if (this.deps.archiveDeleteSyncService) {
          void this.deps.archiveDeleteSyncService.handleInboundDelete(archiveId, originalUrl, 'ws');
        }
      }),
    );
  }
}
