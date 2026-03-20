/**
 * PendingJobOrchestrator - Manages the lifecycle of pending archive jobs
 *
 * Responsibilities:
 * - Submitting pending jobs to the Workers API
 * - Polling for job status and processing completions/failures
 * - Handling local archive short-circuits (Naver Cafe, Blog, Brunch, Webtoon)
 * - Syncing pending jobs from server on startup (cross-device)
 * - Deduplication of pending job submissions
 *
 * Extracted from main.ts to follow SRP.
 */

import { Notice } from 'obsidian';
import type { PendingJob } from '../../services/PendingJobsManager';
import type { PendingJobsManager } from '../../services/PendingJobsManager';
import type { ArchiveJobTracker } from '../../services/ArchiveJobTracker';
import type { WorkersAPIClient } from '../../services/WorkersAPIClient';
import type { Platform } from '../../types/post';
import type { PendingJobArchiveOptions, ServerPendingJob } from '../../types/pending-job';
import type { MediaDownloadMode, SocialArchiverSettings } from '../../types/settings';

// ============================================================================
// Constants
// ============================================================================

/** Delay before rechecking jobs with missing/unavailable status */
export const MISSING_STATUS_RETRY_DELAY = 30000; // 30 seconds

/** Maximum time to wait for a job status before marking as failed */
export const MISSING_STATUS_TIMEOUT = 120000; // 2 minutes

/** Grace period after submission before checking job status */
export const JOB_SUBMISSION_GRACE_PERIOD = 15000; // 15 seconds

// ============================================================================
// Types
// ============================================================================

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

/**
 * Dependencies injected into PendingJobOrchestrator.
 * Each dependency represents a capability the orchestrator needs from main.ts.
 */
export interface PendingJobOrchestratorDeps {
  pendingJobsManager: PendingJobsManager;
  apiClient: () => WorkersAPIClient | undefined;
  settings: () => SocialArchiverSettings;
  archiveJobTracker: ArchiveJobTracker;
  processingJobs: Set<string>;
  processCompletedJob: (job: PendingJob, payload: CompletedJobResponse) => Promise<void>;
  processFailedJob: (job: PendingJob, message: string) => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- batch result shape is loosely typed from WorkersAPIClient
  processBatchArchiveResult: (result: any, pendingJobId?: string, sourceNotePath?: string) => Promise<void>;
  fetchNaverCafeLocally: (url: string, filePath: string | undefined, downloadMode: MediaDownloadMode, options?: { comment?: string }) => Promise<void>;
  fetchNaverBlogLocally: (url: string, filePath: string | undefined, downloadMode: MediaDownloadMode, options?: { comment?: string }) => Promise<void>;
  fetchBrunchLocally: (url: string, filePath: string | undefined, downloadMode: MediaDownloadMode, options?: { comment?: string }) => Promise<void>;
  fetchNaverWebtoonLocally: (url: string, filePath: string | undefined, downloadMode: MediaDownloadMode, options?: { comment?: string; jobId?: string }) => Promise<void>;
  markRecentlyArchivedUrl: (url: string) => void;
  buildPendingJobDedupKey: (job: Pick<PendingJob, 'url' | 'platform'>) => string;
  removeDuplicatePendingJob: (job: PendingJob, reason: string) => Promise<void>;
  schedule: (callback: () => void, delay: number) => number;
  notify: (message: string, timeout?: number) => void;
}

// ============================================================================
// PendingJobOrchestrator
// ============================================================================

export class PendingJobOrchestrator {
  private pendingJobsCheckPromise: Promise<void> | null = null;
  private pendingJobSubmissionLocks = new Set<string>();

  constructor(private readonly deps: PendingJobOrchestratorDeps) {}

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Check pending jobs and process completions.
   * Runs periodically and on startup to handle background archiving.
   * Guards against overlapping runs via an in-flight promise.
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

  /**
   * Sync pending jobs from server on startup.
   * Processes completed jobs that were finished while this device was offline.
   */
  async syncPendingJobsFromServer(): Promise<void> {
    try {
      const apiClient = this.deps.apiClient();
      const settings = this.deps.settings();

      // Only sync if we have apiClient and auth configured
      if (!apiClient || !settings.username) {
        return;
      }

      const response = await apiClient.getPendingJobs({ status: 'completed' });

      if (!response.success || !response.jobs?.length) {
        return;
      }

      console.debug(`[Social Archiver] Found ${response.jobs.length} completed jobs from server to process`);

      for (const serverJob of response.jobs) {
        try {
          if (!serverJob.result) {
            // No result data - clean up
            await apiClient.deletePendingJob(serverJob.jobId).catch(() => {});
            continue;
          }

          // Prevent duplicate processing
          if (this.deps.processingJobs.has(serverJob.jobId)) {
            continue;
          }
          this.deps.processingJobs.add(serverJob.jobId);

          try {
            // Process using existing logic (single-write: creates final file directly)
            await this.processCompletedJobFromServer(serverJob);

            console.debug(`[Social Archiver] Processed synced job from server: ${serverJob.jobId}`);
          } finally {
            this.deps.processingJobs.delete(serverJob.jobId);
          }

          // Clean up server state
          await apiClient.deletePendingJob(serverJob.jobId).catch(() => {
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

  // --------------------------------------------------------------------------
  // Private methods
  // --------------------------------------------------------------------------

  /**
   * Process a completed job from server sync.
   * Converts ServerPendingJob to local job format and processes.
   */
  private async processCompletedJobFromServer(serverJob: ServerPendingJob): Promise<void> {
    if (!serverJob.result?.postData) {
      console.warn(`[Social Archiver] Server job ${serverJob.jobId} has no result data`);
      return;
    }

    // Convert to local job format for existing processCompletedJob
    const localJob: PendingJob = {
      id: serverJob.jobId,
      url: serverJob.url,
      platform: serverJob.platform as unknown as Platform,
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
        selectedTags: serverJob.archiveOptions?.tags,
      }
    };

    // Reuse existing processing logic
    await this.deps.processCompletedJob(localJob, {
      result: serverJob.result,
    });
  }

  private scheduleMissingStatusCheck(delay: number = MISSING_STATUS_RETRY_DELAY): void {
    this.deps.schedule(() => {
      this.checkPendingJobs().catch(error => {
        console.error('[Social Archiver] Missing status recheck failed:', error);
      });
    }, delay);
  }

  private async runPendingJobsCheck(): Promise<void> {
    const { pendingJobsManager } = this.deps;
    const apiClient = this.deps.apiClient();
    const settings = this.deps.settings();

    if (!pendingJobsManager) {
      console.warn('[Social Archiver] PendingJobsManager not initialized');
      return;
    }

    if (!apiClient) {
      console.warn('[Social Archiver] WorkersAPIClient not initialized');
      return;
    }

    let scheduledMissingStatusRecheck = false;

    try {
      // Get all pending and processing jobs
      const pendingJobs = await pendingJobsManager.getJobs({
        status: 'pending'
      });
      const processingJobs = await pendingJobsManager.getJobs({
        status: 'processing'
      });

      const processingDedupKeys = new Set(
        processingJobs.map((job) => this.deps.buildPendingJobDedupKey(job))
      );
      const cyclePendingDedupKeys = new Set<string>();
      const sortedPendingJobs = [...pendingJobs].sort((a, b) => a.timestamp - b.timestamp);

      // Submit pending jobs to Workers API
      for (const job of sortedPendingJobs) {
        const dedupKey = this.deps.buildPendingJobDedupKey(job);

        if (processingDedupKeys.has(dedupKey)) {
          await this.deps.removeDuplicatePendingJob(job, 'matching processing job already exists');
          continue;
        }

        if (cyclePendingDedupKeys.has(dedupKey)) {
          await this.deps.removeDuplicatePendingJob(job, 'duplicate pending job in current cycle');
          continue;
        }

        if (this.pendingJobSubmissionLocks.has(dedupKey)) {
          await this.deps.removeDuplicatePendingJob(job, 'submission already in progress for same URL');
          continue;
        }

        cyclePendingDedupKeys.add(dedupKey);
        this.pendingJobSubmissionLocks.add(dedupKey);
        try {
          // Skip jobs that already have workerJobId (e.g., profile crawl jobs)
          // These jobs were already submitted via a different endpoint
          if (job.metadata?.workerJobId) {
            // Move to processing status if not already
            await pendingJobsManager.updateJob(job.id, {
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
          const { NaverCafeLocalService } = await import('../../services/NaverCafeLocalService');
          if (NaverCafeLocalService.isCafeUrl(job.url) && settings.naverCookie) {
            try {
              this.deps.archiveJobTracker.markProcessing(job.id);
              const downloadMode = (job.metadata?.downloadMedia ?? settings.downloadMedia) as MediaDownloadMode;
              await this.deps.fetchNaverCafeLocally(job.url, job.metadata?.filePath, downloadMode, {
                comment: job.metadata?.notes,
              });

              // Mark job as completed
              await pendingJobsManager.updateJob(job.id, {
                status: 'completed',
                metadata: {
                  ...job.metadata,
                  completedAt: Date.now()
                }
              });
              this.deps.archiveJobTracker.completeJob(job.id);

              console.debug(`[Social Archiver] Naver cafe archived locally: ${job.url}`);
              continue; // Skip Worker submission
            } catch (error) {
              console.error(`[Social Archiver] Naver cafe local fetch failed: ${job.url}`, error);
              await this.deps.processFailedJob(job, error instanceof Error ? error.message : 'Unknown error');
              continue;
            }
          }

          // ========================================
          // Naver Blog: Use local fetcher for faster archiving
          // Bypasses Worker to reduce latency and BrightData credit usage
          // ========================================
          const { NaverBlogLocalService } = await import('../../services/NaverBlogLocalService');
          if (NaverBlogLocalService.isBlogUrl(job.url)) {
            try {
              this.deps.archiveJobTracker.markProcessing(job.id);
              const downloadMode = (job.metadata?.downloadMedia ?? settings.downloadMedia) as MediaDownloadMode;
              await this.deps.fetchNaverBlogLocally(job.url, job.metadata?.filePath, downloadMode, {
                comment: job.metadata?.notes,
              });

              // Mark job as completed
              await pendingJobsManager.updateJob(job.id, {
                status: 'completed',
                metadata: {
                  ...job.metadata,
                  completedAt: Date.now()
                }
              });
              this.deps.archiveJobTracker.completeJob(job.id);

              console.debug(`[Social Archiver] Naver blog archived locally: ${job.url}`);
              continue; // Skip Worker submission
            } catch (error) {
              console.error(`[Social Archiver] Naver blog local fetch failed: ${job.url}`, error);
              await this.deps.processFailedJob(job, error instanceof Error ? error.message : 'Unknown error');
              continue;
            }
          }

          // ========================================
          // Brunch: Use local fetcher for faster archiving
          // Bypasses Worker to reduce latency and BrightData credit usage
          // ========================================
          const { BrunchLocalService } = await import('../../services/BrunchLocalService');
          if (BrunchLocalService.isBrunchUrl(job.url)) {
            try {
              this.deps.archiveJobTracker.markProcessing(job.id);
              const downloadMode = (job.metadata?.downloadMedia ?? settings.downloadMedia) as MediaDownloadMode;
              await this.deps.fetchBrunchLocally(job.url, job.metadata?.filePath, downloadMode, {
                comment: job.metadata?.notes,
              });

              // Mark job as completed
              await pendingJobsManager.updateJob(job.id, {
                status: 'completed',
                metadata: {
                  ...job.metadata,
                  completedAt: Date.now()
                }
              });
              this.deps.archiveJobTracker.completeJob(job.id);

              console.debug(`[Social Archiver] Brunch post archived locally: ${job.url}`);
              continue; // Skip Worker submission
            } catch (error) {
              console.error(`[Social Archiver] Brunch local fetch failed: ${job.url}`, error);
              await this.deps.processFailedJob(job, error instanceof Error ? error.message : 'Unknown error');
              continue;
            }
          }

          // ========================================
          // Naver Webtoon: Use local fetcher for faster image downloads
          // Bypasses Worker proxy for direct image downloads
          // ========================================
          const { NaverWebtoonLocalService } = await import('../../services/NaverWebtoonLocalService');
          if (NaverWebtoonLocalService.isWebtoonUrl(job.url)) {
            try {
              this.deps.archiveJobTracker.markProcessing(job.id);
              const downloadMode = (job.metadata?.downloadMedia ?? settings.downloadMedia) as MediaDownloadMode;
              await this.deps.fetchNaverWebtoonLocally(job.url, job.metadata?.filePath, downloadMode, {
                comment: job.metadata?.notes,
                jobId: job.id,
              });

              // Mark job as completed
              await pendingJobsManager.updateJob(job.id, {
                status: 'completed',
                metadata: {
                  ...job.metadata,
                  completedAt: Date.now()
                }
              });
              this.deps.archiveJobTracker.completeJob(job.id);

              console.debug(`[Social Archiver] Naver Webtoon archived locally: ${job.url}`);
              continue; // Skip Worker submission
            } catch (error) {
              console.error(`[Social Archiver] Naver Webtoon local fetch failed: ${job.url}`, error);
              await this.deps.processFailedJob(job, error instanceof Error ? error.message : 'Unknown error');
              continue;
            }
          }

          // Submit archive request
          this.deps.archiveJobTracker.markProcessing(job.id);
          console.debug(`[Social Archiver] 🔄 Submitting archive request for: ${job.url} (platform: ${job.platform})`);
          const response = await apiClient.submitArchive({
            url: job.url,
            options: {
              enableAI: false,
              deepResearch: false,
              downloadMedia: job.metadata?.downloadMedia !== 'text-only',
              includeComments: job.metadata?.includeComments ?? settings.includeComments,
              includeTranscript: job.metadata?.includeTranscript,
              includeFormattedTranscript: job.metadata?.includeFormattedTranscript,
              pinterestBoard: job.metadata?.isPinterestBoard,
            },
            // Naver: pass cookie for private cafe access
            naverCookie: settings.naverCookie || undefined,
            // Tell server to skip dispatching sync back to this Obsidian client
            sourceClientId: settings.syncClientId || undefined,
          });

          // Track URL for client-side dedup guard
          this.deps.markRecentlyArchivedUrl(job.url);

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
            if (this.deps.processingJobs.has(processingKey)) {
              console.debug(`[Social Archiver] ⏭️ Skipping synchronous completion for already-processing job: ${processingKey}`);
              continue;
            }
            this.deps.processingJobs.add(processingKey);

            // Process immediately without going through polling
            try {
              await pendingJobsManager.updateJob(job.id, {
                status: 'completed',
                metadata: {
                  ...job.metadata,
                  workerJobId: response.jobId,
                  completedAt: Date.now()
                }
              });

              // Process the completed result
              const jobStatusData: CompletedJobResponse = {
                result: response.result,
              };

              console.debug(`[Social Archiver] 🔄 Processing completed job... (media count: ${(response.result?.postData as { media?: unknown[] } | undefined)?.media?.length || 0})`);
              await this.deps.processCompletedJob(job, jobStatusData);
              this.deps.archiveJobTracker.completeJob(job.id);
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
              this.deps.processingJobs.delete(processingKey);
            }
            continue; // Skip to next job
          }

          // Handle series selection required (Naver Webtoon series URL)
          if (response.type === 'series_selection_required' || response.status === 'series_selection_required') {
            console.debug(`[Social Archiver] 📚 Series selection required for Naver Webtoon`);

            // Mark job as failed with special message - user needs to use episode URL
            await pendingJobsManager.updateJob(job.id, {
              status: 'failed',
              metadata: {
                ...job.metadata,
                lastError: 'Please use a specific episode URL instead of series URL. Open the webtoon and select an episode to archive.',
                failedAt: Date.now()
              }
            });

            // Update archive banner with failure
            this.deps.archiveJobTracker.failJob(job.id, 'Please use a specific episode URL instead of series URL.');

            new Notice('📚 Naver Webtoon: please use episode URL instead of series URL', 8000);
            continue;
          }

          // Update job with worker job ID and mark as processing (for async platforms)
          console.debug(`[Social Archiver] ⏳ Async processing - marking as processing, jobId: ${response.jobId}`);
          await pendingJobsManager.updateJob(job.id, {
            status: 'processing',
            metadata: {
              ...job.metadata,
              workerJobId: response.jobId,  // ✅ metadata 안에 저장
              startedAt: Date.now()
            }
          });
          this.deps.archiveJobTracker.markProcessing(job.id, response.jobId);

          // Register pending job on server for cross-device sync (if enabled)
          if (settings.enableServerPendingJobs) {
            try {
              const archiveOptions: PendingJobArchiveOptions = {
                downloadMedia: job.metadata?.downloadMedia,
                includeTranscript: job.metadata?.includeTranscript,
                includeFormattedTranscript: job.metadata?.includeFormattedTranscript,
                comment: job.metadata?.notes,
                tags: job.metadata?.selectedTags,
              };

              await apiClient.createPendingJob({
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
          await this.deps.processFailedJob(job, error instanceof Error ? error.message : 'Unknown error');
        } finally {
          this.pendingJobSubmissionLocks.delete(dedupKey);
        }
      }

      // Re-fetch processing jobs (includes newly submitted jobs)
      const allProcessingJobs = await pendingJobsManager.getJobs({
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
        if (this.deps.processingJobs.has(batchJob.id)) {
          continue;
        }

        const batchJobId = batchJob.metadata?.batchJobId;
        if (!batchJobId) {
          console.warn(`[Social Archiver] Batch job ${batchJob.id} missing batchJobId`);
          continue;
        }

        try {
          const batchStatus = await apiClient.getBatchJobStatus(batchJobId);

          if (batchStatus.status === 'completed') {
            this.deps.processingJobs.add(batchJob.id);
            try {
              await this.deps.processBatchArchiveResult(batchStatus, batchJob.id);
            } catch (processError) {
              console.error(`[Social Archiver] Failed to process batch job ${batchJob.id}:`, processError);
              await pendingJobsManager.updateJob(batchJob.id, {
                status: 'failed',
                metadata: {
                  ...batchJob.metadata,
                  lastError: processError instanceof Error ? processError.message : 'Failed to process batch result',
                  failedAt: Date.now(),
                },
              });
            } finally {
              this.deps.processingJobs.delete(batchJob.id);
            }
          } else if (batchStatus.status === 'failed') {
            await pendingJobsManager.updateJob(batchJob.id, {
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
      const batchResponse = await apiClient.batchGetJobStatus(jobIds);

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
        if (this.deps.processingJobs.has(processingKey)) {
          continue;
        }

        if (result.status === 'completed' && result.data?.result) {
          // Process completed job
          this.deps.processingJobs.add(processingKey);

          try {
            // Update job status to completed BEFORE processing (same as WebSocket handler)
            // This prevents the job from being re-processed on next polling cycle
            await pendingJobsManager.updateJob(pendingJob.id, {
              status: 'completed',
              metadata: {
                ...pendingJob.metadata,
                completedAt: Date.now()
              }
            });

            await this.deps.processCompletedJob(pendingJob, result.data);
          } catch (processError) {
            // If processing fails, mark as failed so it can be retried
            console.error(`[Social Archiver] Failed to process completed job ${pendingJob.id}:`, processError);
            await this.deps.processFailedJob(
              pendingJob,
              processError instanceof Error ? processError.message : 'Failed to process completed job'
            );
          } finally {
            this.deps.processingJobs.delete(processingKey);
          }
        } else if (result.status === 'failed') {
          // Process failed job reported by Workers API
          const errorMessage = result.error || result.data?.error || 'Unknown error';

          // Check if this is a transient "not ready yet" error from BrightData
          const isTransientError = errorMessage.includes('Snapshot does not exist') ||
                                   errorMessage.includes('404');

          if (isTransientError) {
            // Check if job still exists (might have been processed by WebSocket)
            const currentJob = await pendingJobsManager.getJob(pendingJob.id);
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

            await pendingJobsManager.updateJob(pendingJob.id, {
              status: 'processing',
              metadata: updatedMetadata
            });

            // Only mark as truly failed after timeout (2 minutes)
            if (elapsed >= MISSING_STATUS_TIMEOUT) {
              await this.deps.processFailedJob({ ...currentJob, metadata: updatedMetadata }, errorMessage);
            } else {
              if (!scheduledMissingStatusRecheck) {
                this.scheduleMissingStatusCheck();
                scheduledMissingStatusRecheck = true;
              }
            }
          } else {
            // Real failure - process as failed
            await this.deps.processFailedJob(pendingJob, errorMessage);
          }
        } else if (result.status === null) {
          // Job status temporarily unavailable (e.g., KV not replicated yet).
          // Check if job still exists (might have been processed by WebSocket)
          const currentJob = await pendingJobsManager.getJob(pendingJob.id);
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

          await pendingJobsManager.updateJob(pendingJob.id, {
            status: 'processing',
            metadata: updatedMetadata
          });

          if (now - statusUnavailableSince >= MISSING_STATUS_TIMEOUT) {
            await this.deps.processFailedJob({ ...currentJob, metadata: updatedMetadata }, errorMessage);
          } else {
            if (!scheduledMissingStatusRecheck) {
              this.scheduleMissingStatusCheck();
              scheduledMissingStatusRecheck = true;
            }
          }
        } else {
          // Still processing - update status
          // Check if job still exists (might have been processed by WebSocket)
          const currentJob = await pendingJobsManager.getJob(pendingJob.id);
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

          await pendingJobsManager.updateJob(pendingJob.id, {
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
}
