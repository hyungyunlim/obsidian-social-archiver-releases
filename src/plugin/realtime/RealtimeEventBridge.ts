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
import type { App, TFile } from 'obsidian';
import type { PendingJob } from '../../services/PendingJobsManager';
import type { PendingPost } from '../../services/SubscriptionManager';
import type { SyncSubscriptionResult } from '../subscriptions/SubscriptionSyncService';
import type { CrawlJobTracker } from '../../services/CrawlJobTracker';
import type { ArchiveJobTracker } from '../../services/ArchiveJobTracker';
import type { ArchiveLookupService } from '../../services/ArchiveLookupService';
import type { AnnotationSyncService } from '../../services/AnnotationSyncService';
import type { LinkRelationSyncService } from '../sync/LinkRelationSyncService';
import type { ArchiveDeleteSyncService } from '../sync/ArchiveDeleteSyncService';
import type { ArchiveTagOutboundService } from '../sync/ArchiveTagOutboundService';
import type { ArchiveStateSyncService } from '../sync/ArchiveStateSyncService';
import type { LikeStateSyncService } from '../sync/LikeStateSyncService';
import type { ShareStateSyncService } from '../sync/ShareStateSyncService';
import type { CommentStateSyncService } from '../sync/CommentStateSyncService';
import type { SocialArchiverSettings } from '../../types/settings';
import type { PostData, Platform } from '../../types/post';
import { mirrorArchiveTagsIntoObsidianTags } from '../../utils/tags';
import type {
  ArchiveCompleteEventData,
  ClientSyncEventData,
  ShareDeletedEventData,
  ActionUpdatedEventData,
  ArchiveDeletedEventData,
  ArchiveTagsUpdatedEventData,
  ContentVariantUpdatedEventData,
  MediaPreservedEventData,
  AuthorProfileUpdatedEventData,
  BillingStatusUpdatedEventData,
  ArchiveRelationUpdatedEventData,
} from '../../types/websocket';
import type { BillingEventApiPayload } from '../../types/billing-events';
import type { IngestResult } from '../sync/RemoteArchiveIngestService';
import type { LocalLockRegistry } from '../locks/LocalLockRegistry';
import { SentinelMediaRegionManager } from './SentinelMediaRegionManager';
import { UnavailableMediaBlockGenerator } from '../../services/markdown/UnavailableMediaBlockGenerator';
import { isLocalSentinel, stripLocalpathPrefix } from '../../services/markdown/formatters/LocalpathGuard';
import { TimelineView, VIEW_TYPE_TIMELINE } from '../../views/TimelineView';
import type { UserAuthorProfile } from '@/types/author-profile';

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

/** Shape of the ws:archive_added WebSocket event payload. */
export interface WsArchiveAddedMessage {
  type: 'archive_added';
  data?: {
    archiveId?: string;
    platform?: string;
    url?: string;
    title?: string | null;
    source?: 'subscription';
    subscriptionId?: string;
    updatedAt?: string;
    timestamp?: number;
  };
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
  acknowledgePendingPosts?: (ids: string[]) => Promise<void>;
  archiveLookupService: ArchiveLookupService | undefined;
  annotationSyncService: AnnotationSyncService | undefined;
  linkRelationSyncService?: LinkRelationSyncService | undefined;
  archiveStateSyncService?: ArchiveStateSyncService | undefined;
  likeStateSyncService?: LikeStateSyncService | undefined;
  shareStateSyncService?: ShareStateSyncService | undefined;
  commentStateSyncService?: CommentStateSyncService | undefined;
  archiveDeleteSyncService?: ArchiveDeleteSyncService | undefined;
  archiveTagOutboundService?: ArchiveTagOutboundService | undefined;
  authorProfileOutboundService?: { addSuppression: (authorKey: string) => void; isSuppressed: (authorKey: string) => boolean } | undefined;
  app: App;
  settings: () => SocialArchiverSettings;
  apiClient: () => RealtimeApiClient | undefined;
  processCompletedJob: (job: PendingJob, payload: CompletedJobResponse) => Promise<void>;
  processFailedJob: (job: PendingJob, message: string) => Promise<void>;
  saveSubscriptionPost: (pendingPost: PendingPost) => Promise<boolean>;
  syncSubscriptionPosts: (trigger?: string) => Promise<SyncSubscriptionResult>;
  refreshSubscriptions?: () => Promise<void>;
  createProfileNote: (message: WsProfileMetadataMessage) => Promise<void>;
  applyAuthorProfileUpdate?: (profile: UserAuthorProfile) => Promise<void>;
  syncAuthorProfiles?: () => Promise<void>;
  refreshBillingUsage?: () => Promise<boolean>;
  /**
   * Fetch the latest active billing-events list from the server.
   *
   * Wired to `WorkersAPIClient.getActiveBillingEvents()` in `main.ts`. The
   * bridge calls this after `refreshBillingUsage()` whenever a
   * `billing_status_updated` WS event arrives. PRD
   * `.taskmaster/docs/prd-billing-lifecycle-notifications-plugin.md` §6.4,
   * §8.2.
   */
  refreshBillingEvents?: () => Promise<BillingEventApiPayload[]>;
  /** Commit a freshly fetched billing-events list into the plugin store. */
  commitBillingEvents?: (events: BillingEventApiPayload[]) => void;
  /**
   * Decide whether the given event should fire a one-shot Obsidian Notice
   * this plugin session. Backed by `BillingEventNoticer.shouldShow`.
   */
  shouldShowBillingEventNotice?: (event: BillingEventApiPayload) => boolean;
  /** Record that we've already shown a Notice for `eventId` this session. */
  markBillingEventNoticed?: (eventId: string) => void;
  refreshTimelineView: () => void;
  canExecuteAICommentJobs?: () => boolean;
  aiCommentJobProcessor?: {
    drainBacklog?: () => Promise<void>;
    handleRequestedJob: (jobId: string, targetClientId: string) => Promise<void>;
    handleRequestedAIActionJob?: (jobId: string, targetClientId?: string | null) => Promise<void>;
    handleStatusEvent: (event: {
      jobId?: string;
      targetClientId?: string;
      archiveId?: string;
      actionType?: string;
      resultKind?: string | null;
      status?: string;
      progress?: number;
      progressPercentage?: number;
      progressMessage?: string;
      errorCode?: string;
      errorMessagePublic?: string;
      updatedAt?: string;
    }) => Promise<void>;
  };
  transcriptionJobProcessor?: {
    drainBacklog: () => Promise<void>;
    handleRequestedJob: (jobId: string, targetClientId: string) => Promise<void>;
    handleStatusEvent: (event: {
      jobId?: string;
      targetClientId?: string;
      archiveId?: string;
      mediaRefHash?: string;
      status?: string;
      uiStatus?: 'queued' | 'preparing' | 'running' | 'done';
      progressPercentage?: number;
      progressCode?: string;
      nextAttemptAt?: string;
      errorCode?: string;
      errorMessagePublic?: string;
      terminalReason?: string;
      transcriptResultId?: string;
      localMediaPath?: string;
      updatedAt?: string;
    }) => Promise<void>;
    handleCancelledEvent: (event: { jobId?: string; targetClientId?: string }) => Promise<void>;
    handleUpdatedEvent: (event: { archiveId?: string; jobId?: string; transcriptResultId?: string; updatedAt?: string }) => Promise<void>;
  };
  canExecuteTranscriptionJobs?: () => boolean;
  processPendingSyncQueue: () => Promise<void>;
  processSyncQueueItem: (queueId: string, archiveId: string, clientId: string) => Promise<boolean>;
  getReadableErrorMessage: (code: string | undefined, msg: string | undefined) => string;
  processingJobs: Set<string>;
  hasRecentlyArchivedUrl: (url: string) => boolean;
  ingestRemoteArchive: (archiveId: string, source: 'client_sync' | 'archive_complete') => Promise<IngestResult>;
  notify: (message: string, timeout?: number) => void;
  schedule: (callback: () => void, delay: number) => number;
  localLockRegistry?: LocalLockRegistry;
  currentCrawlWorkerJobId: { value: string | undefined };
  wsPostBatchCount: { value: number };
  wsPostBatchTimer: { value: number | undefined };
}

// ============================================================================
// RealtimeEventBridge
// ============================================================================

/**
 * Hidden HTML-comment marker embedded in the "media updated — review needed"
 * callout so the media-repair pass can detect (and avoid duplicating) it.
 */
const REVIEW_NEEDED_MARKER = '<!-- sa:media:review-needed -->';

export class RealtimeEventBridge {
  private eventRefs: EventRef[] = [];
  private readonly deps: RealtimeEventBridgeDeps;
  private subscriptionArchiveAddedSyncTimer?: number;

  constructor(deps: RealtimeEventBridgeDeps) {
    this.deps = deps;
  }

  /**
   * Remove all registered event listeners.
   */
  clear(): void {
    this.eventRefs.forEach(ref => this.deps.events.offref(ref));
    this.eventRefs = [];

    if (this.subscriptionArchiveAddedSyncTimer !== undefined) {
      window.clearTimeout(this.subscriptionArchiveAddedSyncTimer);
      this.subscriptionArchiveAddedSyncTimer = undefined;
    }
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
    this.setupSubscriptionChangedListener();
    this.setupArchiveAddedListener();
    this.setupProfileMetadataListener();
    this.setupProfileCrawlCompleteListener();
    this.setupClientSyncListener();
    this.setupArchiveCompleteListener();
    this.setupShareDeletedListener();
    this.setupActionUpdatedListener();
    this.setupArchiveTagsUpdatedListener();
    this.setupContentVariantUpdatedListener();
    this.setupAuthorProfileUpdatedListener();
    this.setupArchiveRelationUpdatedListener();
    this.setupArchiveDeletedListener();
    this.setupMediaPreservedListener();
    this.setupBillingStatusUpdatedListener();
    this.setupAICommentJobListeners();
    this.setupTranscriptionJobListeners();
  }

  private setupAICommentJobListeners(): void {
    this.eventRefs.push(
      this.deps.events.on('ws:ai_comment_requested', (payload: unknown) => {
        const message = payload as { data?: { jobId?: string; targetClientId?: string | null }; jobId?: string; targetClientId?: string | null };
        const data = message.data ?? message;
        if (!data.jobId) return;
        if (!this.canExecuteAICommentJobs()) return;
        if (this.isAIActionJobId(data.jobId)) {
          void this.deps.aiCommentJobProcessor?.handleRequestedAIActionJob?.(data.jobId, data.targetClientId ?? null);
          return;
        }
        if (!data.targetClientId) return;
        void this.deps.aiCommentJobProcessor?.handleRequestedJob(data.jobId, data.targetClientId);
      }),
      this.deps.events.on('ws:ai_comment_status_updated', (payload: unknown) => {
        const message = payload as {
          data?: {
            jobId?: string;
            targetClientId?: string;
            archiveId?: string;
            actionType?: string;
            resultKind?: string | null;
            status?: string;
            progress?: number;
            progressPercentage?: number;
            progressMessage?: string;
            errorCode?: string;
            errorMessagePublic?: string;
            updatedAt?: string;
          };
          jobId?: string;
          targetClientId?: string;
          archiveId?: string;
          actionType?: string;
          resultKind?: string | null;
          status?: string;
          progress?: number;
          progressPercentage?: number;
          progressMessage?: string;
          errorCode?: string;
          errorMessagePublic?: string;
          updatedAt?: string;
        };
        const data = message.data ?? message;
        void this.deps.aiCommentJobProcessor?.handleStatusEvent(data);
      }),
      this.deps.events.on('ws:ai_comment_updated', (payload: unknown) => {
        const message = payload as {
          data?: {
            jobId?: string;
            archiveId?: string;
            targetClientId?: string;
            updatedAt?: string;
          };
          jobId?: string;
          archiveId?: string;
          targetClientId?: string;
          updatedAt?: string;
        };
        const data = message.data ?? message;
        if (!data.archiveId) return;

        console.debug('[Social Archiver] AI comment updated via WS:', data.archiveId, {
          jobId: data.jobId,
          targetClientId: data.targetClientId,
        });

        this.deps.refreshTimelineView();
      }),
      this.deps.events.on('ws:ai_action_requested', (payload: unknown) => {
        const message = payload as { data?: { jobId?: string; targetClientId?: string | null }; jobId?: string; targetClientId?: string | null };
        const data = message.data ?? message;
        if (!data.jobId) return;
        if (!this.canExecuteAICommentJobs()) return;
        if (this.isAICommentJobId(data.jobId)) {
          if (!data.targetClientId) return;
          void this.deps.aiCommentJobProcessor?.handleRequestedJob(data.jobId, data.targetClientId);
          return;
        }
        void this.deps.aiCommentJobProcessor?.handleRequestedAIActionJob?.(data.jobId, data.targetClientId ?? null);
      }),
    );
  }

  private setupTranscriptionJobListeners(): void {
    this.eventRefs.push(
      this.deps.events.on('ws:transcription_requested', (payload: unknown) => {
        const message = payload as { data?: { jobId?: string; targetClientId?: string }; jobId?: string; targetClientId?: string };
        const data = message.data ?? message;
        if (!data.jobId || !data.targetClientId) return;
        if (!this.canExecuteTranscriptionJobs()) return;
        console.debug('[Social Archiver] Transcription job requested via WebSocket:', {
          jobId: data.jobId,
          targetClientId: data.targetClientId,
        });
        void this.deps.transcriptionJobProcessor?.handleRequestedJob(data.jobId, data.targetClientId);
      }),
      this.deps.events.on('ws:transcription_status_updated', (payload: unknown) => {
        const message = payload as {
          data?: {
            jobId?: string;
            targetClientId?: string;
            archiveId?: string;
            mediaRefHash?: string;
            status?: string;
            uiStatus?: 'queued' | 'preparing' | 'running' | 'done';
            progressPercentage?: number;
            progressCode?: string;
            nextAttemptAt?: string;
            errorCode?: string;
            errorMessagePublic?: string;
            terminalReason?: string;
            transcriptResultId?: string;
            localMediaPath?: string;
            updatedAt?: string;
          };
          jobId?: string;
          targetClientId?: string;
          archiveId?: string;
          mediaRefHash?: string;
          status?: string;
          uiStatus?: 'queued' | 'preparing' | 'running' | 'done';
          progressPercentage?: number;
          progressCode?: string;
          nextAttemptAt?: string;
          errorCode?: string;
          errorMessagePublic?: string;
          terminalReason?: string;
          transcriptResultId?: string;
          localMediaPath?: string;
          updatedAt?: string;
        };
        const data = message.data ?? message;
        void this.deps.transcriptionJobProcessor?.handleStatusEvent(data);
      }),
      this.deps.events.on('ws:transcription_cancelled', (payload: unknown) => {
        const message = payload as { data?: { jobId?: string; targetClientId?: string }; jobId?: string; targetClientId?: string };
        const data = message.data ?? message;
        void this.deps.transcriptionJobProcessor?.handleCancelledEvent(data);
      }),
      this.deps.events.on('ws:transcription_updated', (payload: unknown) => {
        const message = payload as { data?: { jobId?: string; archiveId?: string; transcriptResultId?: string }; jobId?: string; archiveId?: string; transcriptResultId?: string };
        const data = message.data ?? message;
        void this.deps.transcriptionJobProcessor?.handleUpdatedEvent(data);
      }),
    );
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
        // REMOVED: Auto-flushing pending deletes on reconnect caused mass deletion
        // when accumulated vault file removals were all sent at once.
        // void this.deps.archiveDeleteSyncService?.flushPendingDeletes();
        void this.deps.syncAuthorProfiles?.();

        // Catch up on link-relation changes missed while offline (re-renders the
        // `## Linked archives` sections). Fail-soft + feature-gated internally.
        this.deps.schedule(() => {
          void this.deps.linkRelationSyncService?.pullSync().catch((error) => {
            console.debug('[Social Archiver] Link relation pull-sync on WS reconnect failed:', error);
          });
        }, 3500);

        // Sync subscription pending posts missed while offline
        this.deps.schedule(() => {
          void this.deps.syncSubscriptionPosts('ws-connected').catch((error) => {
            console.debug('[Social Archiver] Subscription sync on WS reconnect failed:', error);
          });
        }, 1000);

        // Process any pending sync queue items missed while offline
        const settings = this.deps.settings();
        if (settings.syncClientId) {
          this.deps.schedule(() => {
            void this.deps.processPendingSyncQueue();
          }, 2000);

          if (this.canExecuteTranscriptionJobs()) {
            this.deps.schedule(() => {
              void this.deps.transcriptionJobProcessor?.drainBacklog();
            }, 2500);
          }

          if (this.canExecuteAICommentJobs()) {
            this.deps.schedule(() => {
              void this.deps.aiCommentJobProcessor?.drainBacklog?.();
            }, 3000);
          }
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
              ...(message.archiveId ? { archiveId: message.archiveId } : {}),
              subscriptionId: message.subscriptionId ?? '',
              subscriptionName: message.subscriptionName ?? '',
              post: message.post,
              destinationFolder: message.destinationFolder,
              archivedAt: new Date().toISOString(),
            };

            const saved = message.archiveId
              ? await this.withArchiveWriteLocks(message.archiveId, () => this.deps.saveSubscriptionPost(pendingPost))
              : await this.deps.saveSubscriptionPost(pendingPost);
            if (saved) {
              // Acknowledge the pending post to remove it from KV
              if (message.pendingPostId && this.deps.acknowledgePendingPosts) {
                try {
                  await this.deps.acknowledgePendingPosts([message.pendingPostId]);
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
            await this.deps.syncSubscriptionPosts('subscription-post-fallback');
          }
        } else {
          // Fallback: fetch from KV (for older message format)
          await new Promise(resolve => window.setTimeout(resolve, 1000));
          await this.deps.syncSubscriptionPosts('subscription-post-fallback');
        }
      }),
    );
  }

  // --------------------------------------------------------------------------
  // ws:subscription_changed
  // --------------------------------------------------------------------------

  private setupSubscriptionChangedListener(): void {
    this.eventRefs.push(
      this.deps.events.on('ws:subscription_changed', async () => {
        try {
          await this.deps.refreshSubscriptions?.();
          this.deps.refreshTimelineView();
        } catch (error) {
          console.warn('[Social Archiver] Failed to refresh subscriptions after WS event:', error);
        }
      }),
    );
  }

  // --------------------------------------------------------------------------
  // ws:archive_added (subscription pending-post sync trigger)
  // --------------------------------------------------------------------------

  private setupArchiveAddedListener(): void {
    this.eventRefs.push(
      this.deps.events.on('ws:archive_added', (data: unknown) => {
        const message = data as WsArchiveAddedMessage;
        if (message.data?.source !== 'subscription') return;

        // Debounce: subscription runs produce multiple posts rapidly.
        // Batch into a single syncSubscriptionPosts() call after 2s of quiet.
        if (this.subscriptionArchiveAddedSyncTimer !== undefined) {
          window.clearTimeout(this.subscriptionArchiveAddedSyncTimer);
        }

        this.subscriptionArchiveAddedSyncTimer = this.deps.schedule(() => {
          this.subscriptionArchiveAddedSyncTimer = undefined;
          void this.syncSubscriptionArchiveAdded(message).catch((error) => {
            console.debug('[Social Archiver] Subscription sync from archive_added failed:', error);
          });
        }, 2000);
      }),
    );
  }

  private async syncSubscriptionArchiveAdded(message: WsArchiveAddedMessage): Promise<void> {
    const result = await this.deps.syncSubscriptionPosts('archive-added');
    const archiveId = message.data?.archiveId;

    if (!archiveId || (result?.total ?? 0) > 0) {
      return;
    }

    await this.deps.ingestRemoteArchive(archiveId, 'archive_complete');
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
  // ws:archive_complete (direct archives from external clients)
  // --------------------------------------------------------------------------

  private setupArchiveCompleteListener(): void {
    this.eventRefs.push(
      this.deps.events.on('ws:archive_complete', async (message: unknown) => {
        const msg = message as { type: 'archive_complete'; data?: ArchiveCompleteEventData } | undefined;
        const data = msg?.data;
        if (!data?.archiveId) return;

        // Only process success events
        if (data.status !== 'completed') {
          console.debug('[Social Archiver] archive_complete: ignoring non-success status', data.status);
          return;
        }

        // Guard 1: Currently being processed locally (job_completed race)
        if (data.jobId && this.deps.processingJobs.has(data.jobId)) return;

        // Guard 2: Self-echo — we just archived this URL locally
        if (data.url && this.deps.hasRecentlyArchivedUrl(data.url)) return;

        // Guard 3: Already in vault by sourceArchiveId
        if (this.deps.archiveLookupService?.findBySourceArchiveId(data.archiveId)) {
          this.deps.refreshTimelineView();
          return;
        }

        // Short delay to let client_sync or in-flight save finish first
        await new Promise<void>(resolve => window.setTimeout(resolve, 1500));

        // Re-check after delay
        if (data.url && this.deps.hasRecentlyArchivedUrl(data.url)) return;
        if (this.deps.archiveLookupService?.findBySourceArchiveId(data.archiveId)) {
          this.deps.refreshTimelineView();
          return;
        }

        // Fallback: fetch and save via shared ingest service
        try {
          const result = await this.deps.ingestRemoteArchive(data.archiveId, 'archive_complete');
          if (result === 'created') {
            const displayTitle = data.title || data.authorName || data.platform || 'Archive';
            new Notice(`Synced: ${displayTitle}`, 3000);
          }
        } catch (error) {
          console.warn('[Social Archiver] archive_complete: fallback ingest failed', error);
        }
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
              const archiveId = this.resolveArchiveIdForFile(file);
              await this.withArchiveWriteLocks(archiveId, async () => {
                await this.deps.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
                  fm.share = false;
                  delete fm.shareUrl;
                  delete fm.shareExpiry;
                });
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
        if (msg.data.changes.hasAnnotationUpdate || msg.data.changes.clearAIComments || msg.data.changes.clearTranscription) {
          if (!settings.enableMobileAnnotationSync) {
            console.debug('[Social Archiver] Annotation update received but Mobile Annotation Sync is disabled. Enable it in Settings → Mobile sync.');
          } else {
            void this.withArchiveWriteLocks(msg.data.archiveId, async () => {
              await this.deps.annotationSyncService?.handleActionUpdated(msg.data);
            });
          }
        }

        // Comment state sync: re-project the managed `## 💬 Comments` section when
        // the platform comment tree was mutated remotely (pin/unpin/delete).
        // STANDALONE marker — not bundled into hasAnnotationUpdate. Gated behind
        // the same enableMobileAnnotationSync toggle as annotation body sync.
        if (msg.data.changes.hasCommentUpdate) {
          if (!settings.enableMobileAnnotationSync) {
            console.debug('[Social Archiver] Comment update received but Mobile Annotation Sync is disabled. Enable it in Settings → Mobile sync.');
          } else {
            void this.withArchiveWriteLocks(msg.data.archiveId, async () => {
              await this.deps.commentStateSyncService?.handleRemoteCommentState(msg.data);
            });
          }
        }

        // Archive state sync: update fm.archive when isBookmarked changes from mobile
        if (msg.data.changes.isBookmarked !== undefined) {
          void this.withArchiveWriteLocks(msg.data.archiveId, async () => {
            await this.deps.archiveStateSyncService?.handleRemoteArchiveState(msg.data);
          });
        }

        // Like state sync: update fm.like when isLiked changes from mobile/web
        if (msg.data.changes.isLiked !== undefined) {
          void this.withArchiveWriteLocks(msg.data.archiveId, async () => {
            await this.deps.likeStateSyncService?.handleRemoteLikeState(msg.data);
          });
        }

        // Share state sync: update fm.share/fm.shareUrl when shareUrl changes from mobile/web
        if (msg.data.changes.shareUrl !== undefined) {
          void this.withArchiveWriteLocks(msg.data.archiveId, async () => {
            await this.deps.shareStateSyncService?.handleRemoteShareState(msg.data);
          });
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
        // Native Obsidian tags are only touched when the user enables mirroring.
        try {
          await this.withArchiveWriteLocks(archiveId, async () => {
            await this.deps.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
              const previousArchiveTags = Array.isArray(fm.archiveTags)
                ? (fm.archiveTags as unknown[]).filter((t): t is string => typeof t === 'string')
                : [];
              const currentObsidianTags = Array.isArray(fm.tags)
                ? (fm.tags as unknown[]).filter((t): t is string => typeof t === 'string')
                : [];

              fm.archiveTags = serverTags;

              if (settings.mirrorArchiveTagsToObsidianTags) {
                fm.tags = mirrorArchiveTagsIntoObsidianTags(
                  currentObsidianTags,
                  previousArchiveTags,
                  serverTags
                );
              }

              // Backfill sourceArchiveId if missing
              if (!fm.sourceArchiveId) {
                fm.sourceArchiveId = archiveId;
              }
            });
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
  // ws:content_variant_updated
  // --------------------------------------------------------------------------

  private setupContentVariantUpdatedListener(): void {
    this.eventRefs.push(
      this.deps.events.on('ws:content_variant_updated', (_message: unknown) => {
        const msg = _message as { type: string; data?: ContentVariantUpdatedEventData } | undefined;
        const data = msg?.data;
        if (!data?.archiveId) return;

        console.debug('[Social Archiver] Content variant updated via WS:', data.archiveId, {
          variantId: data.variantId,
          action: data.action,
        });

        this.deps.refreshTimelineView();
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

        // Echo suppression: skip if this event was triggered by our own client
        const settings = this.deps.settings();
        if (msg.data.sourceClientId && msg.data.sourceClientId === settings.syncClientId) {
          console.debug('[Social Archiver] Skipping own archive_deleted echo for:', msg.data.archiveId);
          return;
        }

        const { archiveId, originalUrl } = msg.data;
        console.debug('[Social Archiver] Archive deleted via WS:', archiveId);

        // Delegate to ArchiveDeleteSyncService for proper loop-guard and feature-flag handling
        if (this.deps.archiveDeleteSyncService) {
          void this.deps.archiveDeleteSyncService.handleInboundDelete(archiveId, originalUrl, 'ws');
        }
      }),
    );
  }

  // --------------------------------------------------------------------------
  // ws:author_profile_updated
  // --------------------------------------------------------------------------

  private setupAuthorProfileUpdatedListener(): void {
    this.eventRefs.push(
      this.deps.events.on('ws:author_profile_updated', async (_message: unknown) => {
        const msg = _message as { type: string; data: AuthorProfileUpdatedEventData } | undefined;
        if (!msg?.data?.profile) return;

        const { profile, sourceClientId } = msg.data;
        const settings = this.deps.settings();

        if (sourceClientId && sourceClientId === settings.syncClientId) {
          return;
        }

        if (this.deps.authorProfileOutboundService?.isSuppressed(profile.authorKey)) {
          return;
        }

        this.deps.authorProfileOutboundService?.addSuppression(profile.authorKey);
        await this.deps.applyAuthorProfileUpdate?.(profile);
        this.deps.refreshTimelineView();
      }),
    );
  }

  // --------------------------------------------------------------------------
  // ws:archive_relation_updated
  // --------------------------------------------------------------------------

  private setupArchiveRelationUpdatedListener(): void {
    this.eventRefs.push(
      this.deps.events.on('ws:archive_relation_updated', async (_message: unknown) => {
        const msg = _message as { type: string; data: ArchiveRelationUpdatedEventData } | undefined;
        const relation = msg?.data?.relation;
        if (!relation) return;

        // Re-render the affected `## Linked archives` sections (both ends of the
        // relation). Feature-gating + fail-soft handled inside the service.
        await this.deps.linkRelationSyncService?.handleRelationUpdated(relation);
      }),
    );
  }

  // --------------------------------------------------------------------------
  // ws:media_preserved
  // --------------------------------------------------------------------------

  private setupMediaPreservedListener(): void {
    this.eventRefs.push(
      this.deps.events.on('ws:media_preserved', async (_message: unknown) => {
        const msg = _message as { type: string; data: MediaPreservedEventData } | undefined;
        if (!msg?.data) return;

        const { archiveId, status } = msg.data;

        // Only process when the server preserved media items or signalled a
        // repairable outcome. `repairable`/`partial` also drive the sentinel
        // media-region repair pass below (Ship 3).
        if (status !== 'completed' && status !== 'partial' && status !== 'repairable') {
          console.debug('[Social Archiver] media_preserved: skipping status', status, archiveId);
          return;
        }

        console.debug('[Social Archiver] media_preserved received:', archiveId, status);

        // Small delay to let any in-flight sync or vault writes complete
        await new Promise(resolve => window.setTimeout(resolve, 3000));

        try {
          await this.withArchiveMaterializationLock(archiveId, async () => {
          // Find the vault file by sourceArchiveId
          const file = this.deps.archiveLookupService?.findBySourceArchiveId(archiveId) ?? null;
          if (!file) {
            // Note was deleted locally. Recreation is opt-in (default OFF): only
            // re-materialize the note from the server when the user has enabled
            // the "Recreate locally-deleted notes on repair" setting.
            if (this.deps.settings().recreateLocallyDeletedNotesOnRepair) {
              console.debug('[Social Archiver] media_preserved: recreating deleted note for', archiveId);
              try {
                await this.deps.ingestRemoteArchive(archiveId, 'client_sync');
              } catch (recreateError) {
                console.error(
                  '[Social Archiver] media_preserved: recreation failed for',
                  archiveId,
                  recreateError instanceof Error ? recreateError.message : String(recreateError),
                );
              }
            } else {
              console.debug('[Social Archiver] media_preserved: no vault file for', archiveId, '(recreation disabled)');
            }
            return;
          }

          // Read note content.
          let content = await this.deps.app.vault.read(file);

          // --- Ship 3: sentinel media-region repair ---------------------------
          // Patch unresolved `localpath:` sentinels inside the plugin-owned
          // media region ONLY, never the surrounding note. Runs before the
          // legacy expired-media placeholder pass.
          const repairedContent = await this.repairSentinelMediaRegion(file, content, archiveId);
          if (repairedContent !== null && repairedContent !== content) {
            content = repairedContent;
            await this.withMarkdownWriteLock(archiveId, () => this.deps.app.vault.modify(file, content));
          }

          const { MediaPlaceholderGenerator } = await import('../../services/MediaPlaceholderGenerator');
          const placeholders = MediaPlaceholderGenerator.findAllPlaceholders(content);
          if (placeholders.length === 0) {
            console.debug('[Social Archiver] media_preserved: no expired-media placeholders in', file.path);
            return;
          }

          // Extract metadata from frontmatter
          const cache = this.deps.app.metadataCache.getFileCache(file);
          const frontmatter = cache?.frontmatter;
          const platform = (frontmatter?.platform as Platform) || 'unknown';
          const authorHandle = (frontmatter?.authorHandle as string)?.replace(/^@/, '') || 'unknown';

          // Derive postId from the note's basename (same pattern as main.ts redownloadExpiredMedia)
          const postId = file.basename.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 60) || 'unknown';

          // Create MediaHandler with same config as the manual redownload command
          const settings = this.deps.settings();
          const { MediaHandler } = await import('../../services/MediaHandler');
          const mediaHandler = new MediaHandler({
            vault: this.deps.app.vault,
            app: this.deps.app,
            workersClient: this.deps.apiClient() as import('../../services/WorkersAPIClient').WorkersAPIClient | undefined,
            basePath: settings.mediaPath || 'attachments/social-archives',
            optimizeImages: true,
            imageQuality: 0.8,
            maxImageDimension: 2048,
          });

          try {
            let recovered = 0;
            let failed = 0;

            // Process each placeholder sequentially to avoid race conditions on content
            for (let i = 0; i < placeholders.length; i++) {
              const placeholder = placeholders[i];
              if (!placeholder) continue;

              const localPath = await mediaHandler.redownloadExpiredMedia(
                placeholder.result,
                platform,
                postId,
                authorHandle,
                i,
              );

              if (localPath) {
                content = MediaPlaceholderGenerator.replacePlaceholderWithEmbed(
                  content,
                  placeholder.blockText,
                  localPath,
                );
                recovered++;
              } else {
                failed++;
              }
            }

            // Write updated content back to note if any placeholders were replaced
            if (recovered > 0) {
              await this.withMarkdownWriteLock(archiveId, () => this.deps.app.vault.modify(file, content));

              if (failed === 0) {
                this.deps.notify(`Recovered ${recovered} media for archived note`, 5000);
              } else {
                this.deps.notify(`Recovered ${recovered} media, ${failed} failed`, 5000);
              }

              console.debug(
                '[Social Archiver] media_preserved: recovered',
                recovered,
                'failed',
                failed,
                'for',
                file.path,
              );
            }
          } finally {
            mediaHandler.dispose();
          }
          });
        } catch (error) {
          console.error(
            '[Social Archiver] media_preserved handler failed for',
            archiveId,
            error instanceof Error ? error.message : String(error),
          );
        }
      }),
    );
  }

  /**
   * Repair the plugin-owned sentinel media region for `archiveId` (Ship 3).
   *
   * Scans the note for `<!-- sa:media:start id=ARCHIVEID -->` … `<!-- sa:media:end -->`
   * (re-scanned each call; notes may be hand-edited) and:
   *
   * - If the region exists: replace any unresolved `localpath:` sentinels inside
   *   the region body with an Unavailable callout, touching ONLY the region body
   *   (never the surrounding note). When no sentinels remain, the content is
   *   returned unchanged.
   * - If no region (or no matching token) exists: append a non-destructive
   *   "media updated — review needed" callout rather than performing a
   *   structural rewrite.
   *
   * Returns the updated content, or `null` when no change is warranted (so the
   * caller can skip a vault write). Fail-soft: any error returns `null`.
   */
  private async repairSentinelMediaRegion(
    file: TFile,
    content: string,
    archiveId: string,
  ): Promise<string | null> {
    try {
      const region = SentinelMediaRegionManager.findRegion(content, archiveId);

      if (!region) {
        // No plugin-owned region: never rewrite structurally. Append a single
        // review-needed callout (idempotent — skip if one already exists).
        if (content.includes(REVIEW_NEEDED_MARKER)) return null;
        const callout = this.buildReviewNeededCallout();
        const trimmed = content.replace(/\n+$/, '');
        return `${trimmed}\n\n${callout}\n`;
      }

      // A region exists: replace unresolved localpath sentinels in the body.
      const repairedBody = this.replaceSentinelsInRegionBody(region.body);
      if (repairedBody === region.body) return null;

      const updated = SentinelMediaRegionManager.replaceRegion(content, archiveId, repairedBody);
      if (updated === null || updated === content) return null;
      return updated;
    } catch (error) {
      console.error(
        '[Social Archiver] repairSentinelMediaRegion failed for',
        file.path,
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  /**
   * Replace `localpath:` sentinel image/video embeds inside a media region body
   * with an Unavailable callout. Lines that are not sentinel embeds are left
   * untouched. The plugin cannot resolve a client-only sentinel locally, so an
   * unresolved sentinel deterministically becomes an Unavailable block.
   */
  private replaceSentinelsInRegionBody(body: string): string {
    // Markdown image/embed link: ![alt](url) — capture the URL.
    const embedRe = /!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;
    return body.replace(embedRe, (match, rawUrl: string) => {
      const url = decodeURIComponent(rawUrl);
      if (!isLocalSentinel(url)) return match;
      return UnavailableMediaBlockGenerator.generate({
        reason: 'This media is stored only on the original device.',
        filename: stripLocalpathPrefix(url),
      });
    });
  }

  /** Build the non-destructive "media updated — review needed" callout. */
  private buildReviewNeededCallout(): string {
    return [
      `> [!note] Media updated — review needed ${REVIEW_NEEDED_MARKER}`,
      '> The server repaired media for this archive, but no managed media region',
      '> was found in this note. Re-archive or check the media section manually.',
    ].join('\n');
  }

  // --------------------------------------------------------------------------
  // ws:billing_status_updated
  // --------------------------------------------------------------------------

  private setupBillingStatusUpdatedListener(): void {
    this.eventRefs.push(
      this.deps.events.on('ws:billing_status_updated', async (_message: unknown) => {
        const msg = _message as { type: string; data: BillingStatusUpdatedEventData } | undefined;
        if (!msg?.data) return;

        console.debug('[Social Archiver] billing_status_updated received:', {
          reason: msg.data.reason,
          eventType: msg.data.eventType,
          updatedAt: msg.data.updatedAt,
        });

        // Step 1 — refresh billing usage (existing fail-soft behavior).
        try {
          const refreshed = await this.deps.refreshBillingUsage?.();
          if (!refreshed) {
            console.warn('[Social Archiver] Failed to refresh billing usage after billing_status_updated');
          }
        } catch (error) {
          console.warn(
            '[Social Archiver] Billing usage refresh after billing_status_updated failed:',
            error instanceof Error ? error.message : String(error),
          );
        }

        // Step 2 — refresh active billing events + show high-severity Notice.
        // PRD `.taskmaster/docs/prd-billing-lifecycle-notifications-plugin.md`
        // §6.4, §8.2. Failure here must NOT propagate out of the WS listener.
        try {
          const events = (await this.deps.refreshBillingEvents?.()) ?? [];
          this.deps.commitBillingEvents?.(events);

          for (const event of events) {
            if (this.deps.shouldShowBillingEventNotice?.(event)) {
              new Notice(
                'Billing update: open Social Archiver settings for details',
              );
              this.deps.markBillingEventNoticed?.(event.id);
            }
          }
        } catch (error) {
          console.warn(
            '[Social Archiver] Billing events refresh after billing_status_updated failed:',
            error instanceof Error ? error.message : String(error),
          );
        }
      }),
    );
  }

  private async withArchiveWriteLocks<T>(archiveId: string, fn: () => Promise<T>): Promise<T> {
    const registry = this.deps.localLockRegistry;
    if (!registry) return fn();
    return registry.withLocks(
      [
        { kind: 'archiveMaterialization', archiveId },
        { kind: 'markdownWrite', archiveId },
      ],
      fn,
    );
  }

  private canExecuteAICommentJobs(): boolean {
    return this.deps.canExecuteAICommentJobs?.() ?? true;
  }

  private isAIActionJobId(jobId: string): boolean {
    return jobId.startsWith('aiaj_');
  }

  private isAICommentJobId(jobId: string): boolean {
    return jobId.startsWith('aicj_');
  }

  private canExecuteTranscriptionJobs(): boolean {
    return this.deps.canExecuteTranscriptionJobs?.() ?? true;
  }

  private async withArchiveMaterializationLock<T>(archiveId: string, fn: () => Promise<T>): Promise<T> {
    const registry = this.deps.localLockRegistry;
    if (!registry) return fn();
    return registry.withLock({ kind: 'archiveMaterialization', archiveId }, fn);
  }

  private async withMarkdownWriteLock<T>(archiveId: string, fn: () => Promise<T>): Promise<T> {
    const registry = this.deps.localLockRegistry;
    if (!registry) return fn();
    return registry.withLock({ kind: 'markdownWrite', archiveId }, fn);
  }

  private resolveArchiveIdForFile(file: TFile): string {
    const cache = this.deps.app.metadataCache.getFileCache(file);
    const frontmatter = (cache?.frontmatter as Record<string, unknown> | undefined) || {};
    const sourceArchiveId = frontmatter.sourceArchiveId;
    if (typeof sourceArchiveId === 'string' && sourceArchiveId.trim()) return sourceArchiveId;
    const archiveId = frontmatter.archiveId;
    if (typeof archiveId === 'string' && archiveId.trim()) return archiveId;
    return file.path;
  }
}
