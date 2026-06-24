/**
 * ArchiveCliService — Single-Responsibility headless archive orchestrator
 * for the Obsidian CLI surface.
 *
 * Responsibilities:
 *   - Build PendingJob payloads from CLI options and submit via
 *     PendingJobsManager (mirrors the ArchiveModal queue construction path).
 *   - Drive synchronous archives through ArchiveOrchestrator with
 *     `isForeground=false` so the large-media guard never prompts.
 *   - Provide fetch-only PostData (sanitized) for agent inspection flows.
 *   - Surface local + server pending job status to CLI consumers.
 *   - Run pending-job catch-up and explicit sync targets.
 *
 * This module deliberately avoids any `Notice` calls or modal interaction —
 * those are presentation-layer concerns that belong to the modal/UI.
 */

import type SocialArchiverPlugin from '../../main';
import { sanitizeTagNames } from '../../utils/tags';
import { validateAndDetectPlatform } from '../../schemas/platforms';
import type { PendingJob } from '../../services/PendingJobsManager';
import type { Platform, PostData } from '../../types/post';
import type { ArchiveResult } from '../../types/archive';
import type { MediaDownloadMode } from '../../types/settings';

// =============================================================================
// Public DTOs
// =============================================================================

export type CliArchiveMode = 'queue' | 'sync' | 'fetch';
export type CliMediaMode = 'all' | 'images' | 'none';

/**
 * Options shared by every CLI archive entry point. The fields mirror the
 * subset of `ArchiveModal` UI state that affects how an archive is processed.
 *
 * `mediaMode` collapses to a single `MediaDownloadMode` value when stored in
 * a pending job (`all`/`images`/`text-only`) so PendingJobOrchestrator can
 * pass the right options to Workers.
 */
export interface ArchiveCliOptions {
  /** Optional override platform — if omitted we autodetect from URL. */
  platform?: Platform;
  /** Media handling. Default 'all' to match modal behaviour. */
  mediaMode?: CliMediaMode;
  /** Include platform comments (when supported). */
  includeComments?: boolean;
  /** YouTube: include full transcript. */
  includeTranscript?: boolean;
  /** YouTube: include formatted transcript with timestamps. */
  includeFormattedTranscript?: boolean;
  /** User-supplied inline comment. */
  comment?: string;
  /** Tags to attach (will be sanitized). */
  tags?: string[];
  /** Pinterest: archive entire board when URL is a board. */
  pinterestBoard?: boolean;
  /** Optional pre-resolved URL (e.g. after Pinterest expansion). */
  resolvedUrl?: string;
}

/** Shape returned by `enqueueArchive`. */
export interface EnqueueArchiveResult {
  jobId: string;
  status: 'pending';
  platform: Platform;
  url: string;
}

/** Source of truth selector for job status lookup. */
export type JobStatusSource = 'local' | 'server' | 'auto';

/** DTO returned by `getJobStatus`. */
export interface JobStatusDTO {
  jobId: string;
  status: string;
  source: 'local' | 'server';
  url?: string;
  platform?: string;
  workerJobId?: string;
  createdAt?: number;
  updatedAt?: number;
  startedAt?: number;
  completedAt?: number;
  failedAt?: number;
  lastError?: string;
  retryCount?: number;
}

/** Job summary used by list endpoints. */
export interface JobSummaryDTO {
  jobId: string;
  status: string;
  url: string;
  platform: string;
  timestamp: number;
  workerJobId?: string;
  retryCount: number;
  lastError?: string;
}

export interface JobsCheckResult {
  processedLocal: number;
  processedServer: number;
  /** Reason why server sync was skipped (when applicable). */
  skipped?: 'setting_disabled' | 'no_api_client' | 'not_authenticated';
}

export type SyncTarget = 'subscriptions' | 'library' | 'pending' | 'all';

export interface SyncResultDTO {
  target: SyncTarget;
  ran: SyncSubtarget[];
  skipped: Array<{ target: SyncSubtarget; reason: string }>;
}

export type SyncSubtarget = 'subscriptions' | 'library' | 'pending';

// =============================================================================
// Sanitized PostData for fetch-only mode
// =============================================================================

/**
 * `PostData` minus client-private fields. We strip absolute vault paths,
 * raw API blobs, and any flag that exists only for plugin internals.
 *
 * The redaction layer in `CliResponse.format` still runs over this object as
 * a safety net so credential-like strings cannot leak.
 */
export interface SanitizedPostData {
  platform: PostData['platform'];
  id: PostData['id'];
  url: PostData['url'];
  author: PostData['author'];
  content: PostData['content'];
  media: PostData['media'];
  metadata: PostData['metadata'];
  comments?: PostData['comments'];
  transcript?: PostData['transcript'];
  videoId?: PostData['videoId'];
  title?: PostData['title'];
  thumbnail?: PostData['thumbnail'];
  tags?: PostData['tags'];
  comment?: PostData['comment'];
  publishedDate?: PostData['publishedDate'];
  archivedDate?: PostData['archivedDate'];
  linkPreviews?: PostData['linkPreviews'];
  ai?: PostData['ai'];
  type?: PostData['type'];
}

// =============================================================================
// Service
// =============================================================================

export class ArchiveCliService {
  constructor(private readonly plugin: SocialArchiverPlugin) {}

  // ---------------------------------------------------------------------------
  // Queue mode
  // ---------------------------------------------------------------------------

  /**
   * Build a PendingJob from CLI options and submit it through the same
   * `PendingJobsManager.addJob` + `archiveJobTracker.startJob` pipeline used
   * by the foreground archive modal.
   *
   * Reuses `plugin.tryAcquireArchiveQueueLock` so the CLI cannot race the
   * modal for the same URL.
   *
   * The returned promise resolves once the job is persisted; the background
   * orchestrator is kicked off via a fire-and-forget `checkPendingJobs()`
   * call so the CLI does not have to wait for completion.
   */
  async enqueueArchive(url: string, opts: ArchiveCliOptions): Promise<EnqueueArchiveResult> {
    const archiveUrl = (opts.resolvedUrl ?? url).trim();
    if (!archiveUrl) {
      throw new Error('Archive URL is empty after normalization.');
    }

    const platform = this.resolvePlatform(archiveUrl, opts.platform);

    const lockKey = this.plugin.tryAcquireArchiveQueueLock(archiveUrl, platform);
    if (!lockKey) {
      throw new Error('This URL is already being queued. Please wait.');
    }

    try {
      const pendingJob = this.buildPendingJob(archiveUrl, platform, url, opts);
      await this.plugin.pendingJobsManager.addJob(pendingJob);

      this.plugin.archiveJobTracker.startJob({
        jobId: pendingJob.id,
        url: archiveUrl,
        platform,
      });

      // Fire-and-forget background processing. We deliberately don't await
      // here — the modal does the same. The periodic checker is the
      // ultimate safety net.
      void this.plugin
        .checkPendingJobs?.()
        ?.catch((error: unknown) => {
          console.warn(
            '[Social Archiver][CLI] Initial job check failed, will retry via periodic checker:',
            error,
          );
        });

      return {
        jobId: pendingJob.id,
        status: 'pending',
        platform,
        url: archiveUrl,
      };
    } finally {
      this.plugin.releaseArchiveQueueLock(lockKey);
    }
  }

  /**
   * Build the canonical PendingJob payload used by both the modal and the
   * CLI. Single source of truth for queue-mode job construction.
   */
  buildPendingJob(
    archiveUrl: string,
    platform: Platform,
    originalUrl: string,
    opts: ArchiveCliOptions,
  ): PendingJob {
    const mediaMode = opts.mediaMode ?? 'all';
    const downloadMedia = this.mediaModeToDownloadMode(mediaMode);
    const trimmedComment = opts.comment && opts.comment.trim() ? opts.comment.trim() : undefined;
    const sanitizedTags =
      opts.tags && opts.tags.length > 0 ? sanitizeTagNames(opts.tags) : undefined;

    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const job: PendingJob = {
      id: jobId,
      url: archiveUrl,
      platform,
      status: 'pending',
      timestamp: Date.now(),
      retryCount: 0,
      metadata: {
        notes: trimmedComment,
        downloadMedia,
        includeComments: opts.includeComments,
        includeTranscript: platform === 'youtube' ? opts.includeTranscript : undefined,
        includeFormattedTranscript:
          platform === 'youtube' ? opts.includeFormattedTranscript : undefined,
        isPinterestBoard: platform === 'pinterest' ? opts.pinterestBoard : undefined,
        originalUrl,
        selectedTags: sanitizedTags && sanitizedTags.length > 0 ? sanitizedTags : undefined,
      },
    };

    return job;
  }

  // ---------------------------------------------------------------------------
  // Sync mode
  // ---------------------------------------------------------------------------

  /**
   * Run an archive synchronously through ArchiveOrchestrator. The CLI is
   * inherently a background flow — we force `isForeground=false` so the
   * Large Media Guard prompt cannot block the caller.
   */
  async runSyncArchive(url: string, opts: ArchiveCliOptions): Promise<ArchiveResult> {
    const orchestrator = this.plugin.archiveOrchestrator;
    const mediaMode = opts.mediaMode ?? 'all';

    return orchestrator.orchestrate(url, {
      enableAI: false,
      downloadMedia: mediaMode !== 'none',
      removeTracking: true,
      generateShareLink: false,
      deepResearch: false,
      includeComments: opts.includeComments,
      includeTranscript: opts.includeTranscript,
      includeFormattedTranscript: opts.includeFormattedTranscript,
      comment: opts.comment,
      pinterestBoard: opts.pinterestBoard,
      isForeground: false,
    });
  }

  // ---------------------------------------------------------------------------
  // Fetch mode
  // ---------------------------------------------------------------------------

  /**
   * Fetch post data without writing a note. Used by agents to inspect a URL
   * before deciding to archive. The returned data is sanitized:
   *   - Absolute vault paths (filePath, etc.) stripped.
   *   - Raw API response (`raw`) stripped.
   *   - Internal flags (`aiCommentDeclined`, `mediaPromptSuppressed`, …) stripped.
   * The standard envelope redaction still runs over the result.
   */
  async fetchOnly(url: string, opts: ArchiveCliOptions): Promise<SanitizedPostData> {
    const orchestrator = this.plugin.archiveOrchestrator;
    const postData = await orchestrator.fetchPostData(url, {
      enableAI: false,
      deepResearch: false,
    });
    void opts; // reserved for future filtering (e.g. comments)
    return this.sanitizePostData(postData);
  }

  /**
   * Strip plugin-internal fields and absolute paths from PostData.
   * Kept as a pure function — easy to unit test.
   */
  sanitizePostData(post: PostData): SanitizedPostData {
    const out: SanitizedPostData = {
      platform: post.platform,
      id: post.id,
      url: post.url,
      author: post.author,
      content: post.content,
      media: post.media,
      metadata: post.metadata,
    };
    if (post.comments) out.comments = post.comments;
    if (post.transcript) out.transcript = post.transcript;
    if (post.videoId) out.videoId = post.videoId;
    if (post.title) out.title = post.title;
    if (post.thumbnail) out.thumbnail = post.thumbnail;
    if (post.tags) out.tags = post.tags;
    if (post.comment) out.comment = post.comment;
    if (post.publishedDate) out.publishedDate = post.publishedDate;
    if (post.archivedDate) out.archivedDate = post.archivedDate;
    if (post.linkPreviews) out.linkPreviews = post.linkPreviews;
    if (post.ai) out.ai = post.ai;
    if (post.type) out.type = post.type;
    return out;
  }

  // ---------------------------------------------------------------------------
  // Job inspection
  // ---------------------------------------------------------------------------

  /**
   * Look up a job by ID. `source='auto'` first checks the local store, then
   * falls back to the Workers API (when authenticated). 'local' and 'server'
   * force a single source.
   */
  async getJobStatus(id: string, source: JobStatusSource): Promise<JobStatusDTO> {
    const wantsLocal = source === 'local' || source === 'auto';
    const wantsServer = source === 'server' || source === 'auto';

    if (wantsLocal) {
      const local = await this.plugin.pendingJobsManager.getJob(id);
      if (local) {
        return this.toJobStatusDTO(local, 'local');
      }
      // Also try worker-job-id lookup so users can pass either form.
      const byWorker = await this.plugin.pendingJobsManager.getJobByWorkerJobId(id);
      if (byWorker) {
        return this.toJobStatusDTO(byWorker, 'local');
      }
      if (source === 'local') {
        throw new JobNotFoundError(id);
      }
    }

    if (wantsServer) {
      const apiClient = this.getApiClientOrThrow();
      try {
        const remote = await apiClient.getJobStatus(id);
        return {
          jobId: remote.jobId,
          status: remote.status,
          source: 'server',
          createdAt: remote.createdAt,
          updatedAt: remote.updatedAt,
          lastError: remote.error,
        };
      } catch (error) {
        throw new JobNotFoundError(id, error);
      }
    }

    throw new JobNotFoundError(id);
  }

  /**
   * List local pending jobs. Filtered by status and capped by `limit`.
   * Server-side listing is intentionally out of scope here — use `sync` or
   * `jobs:check` to pull server state into the local store first.
   */
  async listJobs(filter: { status?: string; limit?: number }): Promise<JobSummaryDTO[]> {
    const statusFilter = filter.status && filter.status !== 'all' ? filter.status : undefined;
    const limit = Math.max(1, Math.min(filter.limit ?? 20, 200));

    const jobs = await this.plugin.pendingJobsManager.getJobs(
      statusFilter ? { status: statusFilter as PendingJob['status'] } : undefined,
    );

    return jobs
      .slice()
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
      .map((j) => ({
        jobId: j.id,
        status: j.status,
        url: j.url,
        platform: j.platform,
        timestamp: j.timestamp,
        workerJobId: j.metadata?.workerJobId,
        retryCount: j.retryCount,
        lastError: j.metadata?.lastError,
      }));
  }

  // ---------------------------------------------------------------------------
  // jobs:check + sync orchestration
  // ---------------------------------------------------------------------------

  /**
   * Fire-and-forget variant of {@link runJobsCheck}. Synchronous return.
   *
   * Obsidian 1.12.7 CLI loses handler output when the returned Promise yields
   * to the macrotask queue (real I/O). Agents call this to kick the pending
   * queue processor and immediately poll `jobs` for results. Errors during
   * the background run are swallowed; agents should treat the response as a
   * scheduling acknowledgement, not a completion notice.
   */
  scheduleJobsCheck(opts: { syncServer: boolean }): {
    scheduled: true;
    targets: Array<'local' | 'server'>;
    skipped?: string;
  } {
    const targets: Array<'local' | 'server'> = ['local'];
    void this.plugin.checkPendingJobs?.();

    let skipped: string | undefined;
    if (opts.syncServer) {
      if (!this.plugin.settings?.enableServerPendingJobs) {
        skipped = 'setting_disabled';
      } else {
        const orchestrator = this.getPendingJobOrchestrator();
        if (!orchestrator) {
          skipped = 'no_api_client';
        } else {
          targets.push('server');
          void orchestrator.syncPendingJobsFromServer().catch(() => {
            /* swallowed — surfaced via subsequent `jobs` polling */
          });
        }
      }
    }
    return skipped ? { scheduled: true, targets, skipped } : { scheduled: true, targets };
  }

  /**
   * Fire-and-forget variant of {@link runSync}. Synchronous return.
   * See {@link scheduleJobsCheck} for rationale.
   */
  scheduleSync(
    target: SyncTarget,
    opts: { syncServer: boolean },
  ): { scheduled: true; targets: SyncSubtarget[]; skipped: Array<{ target: SyncSubtarget; reason: string }> } {
    const targets: SyncSubtarget[] = [];
    const skipped: Array<{ target: SyncSubtarget; reason: string }> = [];

    const shouldRun = (sub: SyncSubtarget): boolean => target === 'all' || target === sub;

    if (shouldRun('subscriptions')) {
      if (typeof this.plugin.syncSubscriptionPosts === 'function') {
        targets.push('subscriptions');
        void this.plugin.syncSubscriptionPosts('cli-sync').catch(() => {});
      } else {
        skipped.push({ target: 'subscriptions', reason: 'service_unavailable' });
      }
    }

    if (shouldRun('library')) {
      const libSync = this.plugin.archiveLibrarySyncService;
      if (!libSync) {
        skipped.push({ target: 'library', reason: 'service_unavailable' });
      } else {
        targets.push('library');
        void (async (): Promise<void> => {
          await libSync.startDeltaSync('delta-catch-up');
          await this.plugin.reconcileArchiveStatesFromServer('cli-sync');
          await this.plugin.reconcileDeletedArchivesFromServer('cli-sync');
        })().catch(() => {});
      }
    }

    if (shouldRun('pending')) {
      const checkResult = this.scheduleJobsCheck({ syncServer: opts.syncServer });
      targets.push('pending');
      if (checkResult.skipped) {
        skipped.push({ target: 'pending', reason: checkResult.skipped });
      }
    }

    return { scheduled: true, targets, skipped };
  }

  async runJobsCheck(opts: { syncServer: boolean }): Promise<JobsCheckResult> {
    const result: JobsCheckResult = { processedLocal: 0, processedServer: 0 };

    const beforeLocal = (await this.plugin.pendingJobsManager.getJobs()).length;

    await this.plugin.checkPendingJobs?.();

    const afterLocal = (await this.plugin.pendingJobsManager.getJobs()).length;
    result.processedLocal = Math.max(0, beforeLocal - afterLocal);

    if (opts.syncServer) {
      if (!this.plugin.settings?.enableServerPendingJobs) {
        result.skipped = 'setting_disabled';
      } else {
        const orchestrator = this.getPendingJobOrchestrator();
        if (!orchestrator) {
          result.skipped = 'no_api_client';
        } else {
          await orchestrator.syncPendingJobsFromServer();
          // We don't have a direct count of processed-from-server jobs from
          // PendingJobOrchestrator; we surface 0 unless the API exposes one.
          // Future: thread a counter through PendingJobOrchestrator.
          result.processedServer = 0;
        }
      }
    }

    return result;
  }

  async runSync(target: SyncTarget, opts: { syncServer: boolean }): Promise<SyncResultDTO> {
    const out: SyncResultDTO = {
      target,
      ran: [],
      skipped: [],
    };

    const shouldRun = (sub: SyncSubtarget): boolean =>
      target === 'all' || target === sub;

    // Subscriptions
    if (shouldRun('subscriptions')) {
      try {
        await this.plugin.syncSubscriptionPosts?.('cli-sync');
        out.ran.push('subscriptions');
      } catch (error) {
        out.skipped.push({ target: 'subscriptions', reason: errorReason(error) });
      }
    }

    // Library (delta sync)
    if (shouldRun('library')) {
      const libSync = this.plugin.archiveLibrarySyncService;
      if (!libSync) {
        out.skipped.push({ target: 'library', reason: 'service_unavailable' });
      } else {
        try {
          await libSync.startDeltaSync('delta-catch-up');
          await this.plugin.reconcileArchiveStatesFromServer('cli-sync');
          await this.plugin.reconcileDeletedArchivesFromServer('cli-sync');
          out.ran.push('library');
        } catch (error) {
          out.skipped.push({ target: 'library', reason: errorReason(error) });
        }
      }
    }

    // Pending jobs
    if (shouldRun('pending')) {
      try {
        const r = await this.runJobsCheck({ syncServer: opts.syncServer });
        out.ran.push('pending');
        if (r.skipped) {
          out.skipped.push({ target: 'pending', reason: r.skipped });
        }
      } catch (error) {
        out.skipped.push({ target: 'pending', reason: errorReason(error) });
      }
    }

    return out;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private resolvePlatform(url: string, override?: Platform): Platform {
    if (override) return override;
    const detection = validateAndDetectPlatform(url);
    if (detection.valid && detection.platform) {
      return detection.platform;
    }
    throw new Error(`Unable to detect platform from URL: ${url}`);
  }

  private mediaModeToDownloadMode(mode: CliMediaMode): MediaDownloadMode {
    switch (mode) {
      case 'none':
        return 'text-only';
      case 'images':
        return 'images-only';
      case 'all':
      default:
        return 'images-and-videos';
    }
  }

  private toJobStatusDTO(job: PendingJob, source: 'local' | 'server'): JobStatusDTO {
    return {
      jobId: job.id,
      status: job.status,
      source,
      url: job.url,
      platform: job.platform,
      workerJobId: job.metadata?.workerJobId,
      createdAt: job.timestamp,
      startedAt: job.metadata?.startedAt,
      completedAt: job.metadata?.completedAt,
      failedAt: job.metadata?.failedAt,
      lastError: job.metadata?.lastError,
      retryCount: job.retryCount,
    };
  }

  private getApiClientOrThrow(): SocialArchiverPlugin['workersApiClient'] {
    // `workersApiClient` is a getter that throws when uninitialized — we
    // let it throw naturally so the caller can map to SERVICE_NOT_READY.
    return this.plugin.workersApiClient;
  }

  private getPendingJobOrchestrator():
    | { syncPendingJobsFromServer: () => Promise<void> }
    | undefined {
    // Plugin exposes `checkPendingJobs()` publicly but not the orchestrator
    // itself. We deliberately reach into the private field via a typed cast
    // because PendingJobOrchestrator is the only seam that exposes
    // server-side sync.
    const internal = this.plugin as unknown as {
      pendingJobOrchestrator?: { syncPendingJobsFromServer: () => Promise<void> };
    };
    return internal.pendingJobOrchestrator;
  }
}

// =============================================================================
// Errors
// =============================================================================

export class JobNotFoundError extends Error {
  readonly code = 'JOB_NOT_FOUND';
  constructor(jobId: string, cause?: unknown) {
    super(`Job '${jobId}' not found.`);
    this.name = 'JobNotFoundError';
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

function errorReason(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'unknown_error';
}
