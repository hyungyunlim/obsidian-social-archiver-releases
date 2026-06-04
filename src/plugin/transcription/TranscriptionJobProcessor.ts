import { normalizePath, parseYaml, TFile, type App } from 'obsidian';
import type {
  TranscriptionActiveJobSummary,
  TranscriptionClaimResponse,
  TranscriptionExecutorJob,
  TranscriptionJobStatus,
  TranscriptionLeaseResponse,
  TranscriptionMediaKind,
  TranscriptionPublicErrorCode,
  UserArchive,
  WorkersAPIClient,
} from '../../services/WorkersAPIClient';
import type { ArchiveLookupService } from '../../services/ArchiveLookupService';
import { TranscriptionService } from '../../services/TranscriptionService';
import { TranscriptFormatter } from '../../services/markdown/formatters/TranscriptFormatter';
import type { TranscriptionProgress, TranscriptionResult } from '../../types/transcription';
import { isTranscriptionError, TranscriptionError } from '../../types/transcription';
import type { SocialArchiverSettings } from '../../types/settings';
import type { Media, Platform } from '../../types/post';
import type { MediaResult } from '../../services/MediaHandler';
import type { MediaPathResolver } from '../media/MediaPathResolver';
import type { IngestResult } from '../sync/RemoteArchiveIngestService';
import type { LocalLockRegistry } from '../locks/LocalLockRegistry';

export interface TranscriptionJobProcessorDeps {
  app: App;
  apiClient: () => WorkersAPIClient | undefined;
  settings: () => SocialArchiverSettings;
  archiveLookupService: () => ArchiveLookupService | undefined;
  ingestRemoteArchive: (archiveId: string, source: 'transcription_job') => Promise<IngestResult>;
  isArchiveLibrarySyncRunning: () => boolean;
  mediaPathResolver: () => MediaPathResolver;
  toAbsoluteVaultPath: (vaultPath: string) => string;
  downloadMedia?: (media: Media[], platform: string, postId: string, authorUsername: string) => Promise<MediaResult[]>;
  downloadWithYtDlp?: (url: string, platform: string, postId: string, signal?: AbortSignal) => Promise<string | null>;
  refreshCapability: () => Promise<void>;
  capabilityHash: () => string | undefined;
  refreshTimelineView: () => void;
  loadPendingUploads?: () => Promise<PendingTranscriptUploadRecord[]>;
  savePendingUploads?: (records: PendingTranscriptUploadRecord[]) => Promise<void>;
  schedule: (callback: () => void, delay: number) => number;
  clearSchedule: (id: number) => void;
  notify: (message: string, timeout?: number) => void;
  localLockRegistry?: LocalLockRegistry;
}

interface ActiveLease {
  lockToken: string;
  lockTokenVersion: number;
  leaseExpiresAt: string;
}

interface ProcessingContext {
  job: TranscriptionExecutorJob;
  claim: TranscriptionClaimResponse;
  lease: ActiveLease;
  abortController: AbortController;
  startedAt: string;
}

interface AudioMaterializationSource {
  media: Media;
  sourceUrl: string | null;
}

export interface PendingTranscriptUploadRecord {
  jobId: string;
  archiveId: string;
  transcriptResultId: string;
  mediaRefHash: string;
  language: string;
  createdAt: string;
  resultMarkerId: string;
  resultMarkerHash: string;
  transcript: {
    segments: Array<{ start: number; end?: number; text: string }>;
    rawText: string;
    language: string;
    duration?: number;
    model: string;
    hasWordTimestamps?: boolean;
  };
  localWrite: {
    markdownUpdated: boolean;
    frontmatterUpdated: boolean;
    resultMarkerId: string;
  };
  processing?: {
    startedAt: string;
    completedAt: string;
    processingTimeMs: number;
  };
}

export interface TranscriptionJobBannerState {
  jobId: string;
  archiveId: string;
  mediaRefHash?: string;
  title?: string;
  targetClientId?: string;
  status: TranscriptionJobStatus;
  uiStatus?: TranscriptionActiveJobSummary['uiStatus'];
  progressPercentage?: number;
  progressCode?: string;
  queueDepth: number;
  errorCode?: string;
  errorMessagePublic?: string;
  terminalReason?: string;
  transcriptResultId?: string;
  localMediaPath?: string;
  updatedAt: string;
}

const BACKLOG_POLL_MS = 3 * 60 * 1000;
const LEASE_RENEW_RATIO = 0.5;
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'ogg', 'wav', 'flac', 'aac', 'wma']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v']);

export function upsertDownloadedVideoEmbed(content: string, localVideoPath: string): string {
  const normalizedPath = normalizePath(localVideoPath).replace(/^\/+/, '');
  if (!normalizedPath) return content;

  const embed = `![[${normalizedPath}]]`;
  const frontmatterMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const bodyStart = frontmatterMatch ? frontmatterMatch[0].length : 0;
  const body = content.slice(bodyStart);
  if (body.includes(normalizedPath) || body.includes(encodeURI(normalizedPath))) return content;

  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const headingMatch = body.match(/^\s*#\s+[^\n]+\n+/);
  const insertAt = bodyStart + (headingMatch ? headingMatch[0].length : 0);
  const before = content.slice(0, insertAt).replace(/\s*$/, `${newline}${newline}`);
  const after = content.slice(insertAt).replace(/^\s*/, '');
  return after ? `${before}${embed}${newline}${newline}${after}` : `${before}${embed}${newline}`;
}

export function upsertDownloadedAudioEmbed(content: string, localAudioPath: string): string {
  const normalizedPath = normalizePath(localAudioPath).replace(/^\/+/, '');
  if (!normalizedPath) return content;

  const embed = `![[${normalizedPath}]]`;
  const frontmatterMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const bodyStart = frontmatterMatch ? frontmatterMatch[0].length : 0;
  const body = content.slice(bodyStart);
  if (body.includes(normalizedPath) || body.includes(encodeURI(normalizedPath))) return content;

  const audioTagRegex = /<audio\b[^>]*\bsrc=(["'])[^"']+\1[^>]*>\s*<\/audio>/i;
  if (audioTagRegex.test(body)) {
    return content.slice(0, bodyStart) + body.replace(audioTagRegex, embed);
  }

  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const headingMatch = body.match(/^\s*#\s+[^\n]+\n+/);
  const insertAt = bodyStart + (headingMatch ? headingMatch[0].length : 0);
  const before = content.slice(0, insertAt).replace(/\s*$/, `${newline}${newline}`);
  const after = content.slice(insertAt).replace(/^\s*/, '');
  return after ? `${before}${embed}${newline}${newline}${after}` : `${before}${embed}${newline}`;
}

function applyDownloadedVideoFrontmatter(
  frontmatter: Record<string, unknown>,
  sourceUrl: string | null,
  localVideoPath: string,
): void {
  const normalizedPath = normalizePath(localVideoPath).replace(/^\/+/, '');
  const downloadedUrls = Array.isArray(frontmatter.downloadedUrls) ? [...frontmatter.downloadedUrls] : [];
  if (sourceUrl) {
    for (const marker of [sourceUrl, `downloaded:${sourceUrl}`]) {
      if (!downloadedUrls.includes(marker)) downloadedUrls.push(marker);
    }
  }
  frontmatter.downloadedUrls = downloadedUrls;
  frontmatter.videoDownloaded = true;
  frontmatter.videoLocalPath = normalizedPath;
  frontmatter.localVideoPath = normalizedPath;

  const media = Array.isArray(frontmatter.media) ? [...frontmatter.media] : [];
  const mediaMarker = `video:${normalizedPath}`;
  const hasLocalVideoMarker = media.some((item) => {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      return trimmed === mediaMarker || trimmed === normalizedPath || trimmed.endsWith(`:${normalizedPath}`);
    }
    if (!item || typeof item !== 'object') return false;
    const record = item as Record<string, unknown>;
    return ['localPath', 'path', 'src', 'url'].some((key) => record[key] === normalizedPath);
  });
  if (!hasLocalVideoMarker) {
    frontmatter.media = [...media, mediaMarker];
  }

  delete frontmatter.videoDownloadFailed;
  delete frontmatter.videoDownloadFailedCount;
  delete frontmatter.videoDownloadFailedUrls;
}

function applyDownloadedAudioFrontmatter(
  frontmatter: Record<string, unknown>,
  sourceUrl: string | null,
  localAudioPath: string,
): void {
  const normalizedPath = normalizePath(localAudioPath).replace(/^\/+/, '');
  const downloadedUrls = Array.isArray(frontmatter.downloadedUrls) ? [...frontmatter.downloadedUrls] : [];
  if (sourceUrl) {
    for (const marker of [sourceUrl, `downloaded:${sourceUrl}`]) {
      if (!downloadedUrls.includes(marker)) downloadedUrls.push(marker);
    }
  }
  frontmatter.downloadedUrls = downloadedUrls;
  frontmatter.audioDownloaded = true;
  frontmatter.audioLocalPath = normalizedPath;
  frontmatter.localAudioPath = normalizedPath;

  const media = Array.isArray(frontmatter.media) ? [...frontmatter.media] : [];
  const mediaMarker = `audio:${normalizedPath}`;
  const hasLocalAudioMarker = media.some((item) => {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      return trimmed === mediaMarker || trimmed === normalizedPath || trimmed.endsWith(`:${normalizedPath}`);
    }
    if (!item || typeof item !== 'object') return false;
    const record = item as Record<string, unknown>;
    return ['localPath', 'path', 'src', 'url'].some((key) => record[key] === normalizedPath);
  });
  if (!hasLocalAudioMarker) {
    frontmatter.media = [...media, mediaMarker];
  }

  delete frontmatter.audioDownloadFailed;
  delete frontmatter.audioDownloadFailedUrls;
}

export class TranscriptionJobProcessor {
  private readonly queue: string[] = [];
  private readonly queued = new Set<string>();
  private backlogTimer: number | null = null;
  private processing = false;
  private currentJobId: string | null = null;
  private currentAbortController: AbortController | null = null;
  private readonly formatter = new TranscriptFormatter();
  private bannerState: TranscriptionJobBannerState | null = null;
  private readonly listeners = new Set<(state: TranscriptionJobBannerState | null) => void>();
  private readonly reconciledDownloadResults = new Set<string>();

  constructor(private readonly deps: TranscriptionJobProcessorDeps) {}

  start(): void {
    if (this.backlogTimer !== null) return;
    void this.drainBacklog();
    this.scheduleBacklogPoll();
  }

  stop(): void {
    if (this.backlogTimer !== null) {
      this.deps.clearSchedule(this.backlogTimer);
      this.backlogTimer = null;
    }
    this.currentAbortController?.abort();
    this.currentAbortController = null;
    this.queue.length = 0;
    this.queued.clear();
    this.setBannerState(null);
  }

  onUpdate(listener: (state: TranscriptionJobBannerState | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.bannerState);
    return () => this.listeners.delete(listener);
  }

  getBannerState(): TranscriptionJobBannerState | null {
    return this.bannerState;
  }

  dismissJob(jobId: string): void {
    if (this.bannerState?.jobId === jobId) this.setBannerState(null);
  }

  async cancelJob(jobId: string): Promise<void> {
    const apiClient = this.deps.apiClient();
    const clientId = this.deps.settings().syncClientId;
    if (!apiClient || !clientId) return;
    try {
      const response = await apiClient.cancelTranscriptionJob(jobId, { clientId });
      this.applySummaryToBanner(response.job);
      if (jobId === this.currentJobId) this.currentAbortController?.abort();
    } catch (error) {
      console.warn('[TranscriptionJobProcessor] Cancel request failed:', safeError(error));
    }
  }

  async drainBacklog(): Promise<void> {
    const apiClient = this.deps.apiClient();
    const clientId = this.deps.settings().syncClientId;
    if (!apiClient || !clientId || !this.deps.settings().authToken) return;

    const response = await apiClient.getAvailableTranscriptionJobs();
    if (response.jobs.length > 0) {
      console.debug('[TranscriptionJobProcessor] Draining available transcription jobs:', {
        count: response.jobs.length,
        clientId,
      });
    }
    for (const job of response.jobs) {
      this.enqueue(job.jobId);
    }
    this.updateQueueDepth();
    await this.processQueue();
  }

  async handleRequestedJob(jobId: string, targetClientId: string): Promise<void> {
    const clientId = this.deps.settings().syncClientId;
    if (targetClientId !== clientId) return;
    console.debug('[TranscriptionJobProcessor] Handling requested transcription job:', {
      jobId,
      clientId,
    });
    this.enqueue(jobId);
    await this.processQueue();
  }

  trackJobSummary(summary: TranscriptionActiveJobSummary): void {
    this.applySummaryToBanner(summary);
  }

  async handleStatusEvent(event: {
    jobId?: string;
    targetClientId?: string;
    archiveId?: string;
    mediaRefHash?: string;
    status?: string;
    uiStatus?: TranscriptionActiveJobSummary['uiStatus'];
    progressPercentage?: number;
    progressCode?: string;
    nextAttemptAt?: string;
    errorCode?: string;
    errorMessagePublic?: string;
    terminalReason?: string;
    transcriptResultId?: string;
    localMediaPath?: string;
    updatedAt?: string;
  }): Promise<void> {
    if (!event.jobId) return;
    if ((event.status === 'cancel_requested' || event.status === 'cancelled') && event.jobId === this.currentJobId) {
      this.currentAbortController?.abort();
    }
    this.applySummaryToBanner(event);
    await this.reconcileDownloadedVideoStatus(event);
  }

  async handleCancelledEvent(event: { jobId?: string; targetClientId?: string }): Promise<void> {
    if (!event.jobId) return;
    if (event.jobId === this.currentJobId) {
      this.currentAbortController?.abort();
    }
    this.applySummaryToBanner({
      jobId: event.jobId,
      targetClientId: event.targetClientId,
      status: 'cancel_requested',
    });
  }

  async handleUpdatedEvent(event: { archiveId?: string; jobId?: string; transcriptResultId?: string; updatedAt?: string }): Promise<void> {
    if (!event.archiveId) return;
    if (event.jobId) {
      this.applySummaryToBanner({
        jobId: event.jobId,
        archiveId: event.archiveId,
        status: 'completed',
        uiStatus: 'done',
        progressPercentage: 100,
        transcriptResultId: event.transcriptResultId,
        updatedAt: event.updatedAt,
      });
    }
    const file = this.deps.archiveLookupService()?.findBySourceArchiveId(event.archiveId) ?? null;
    const apiClient = this.deps.apiClient();
    if (file && apiClient) {
      const archive = await apiClient.getUserArchive(event.archiveId).then((response) => response.archive).catch(() => null);
      if (archive) {
        await this.reconcileServerTranscript(file, archive);
        this.deps.refreshTimelineView();
        return;
      }
    }

    await this.deps.ingestRemoteArchive(event.archiveId, 'transcription_job').catch((error) => {
      console.warn('[TranscriptionJobProcessor] Failed to materialize updated transcript archive:', safeError(error));
    });
    this.deps.refreshTimelineView();
  }

  private scheduleBacklogPoll(): void {
    this.backlogTimer = this.deps.schedule(() => {
      this.backlogTimer = null;
      void this.drainBacklog().finally(() => {
        if (this.backlogTimer === null) this.scheduleBacklogPoll();
      });
    }, BACKLOG_POLL_MS);
  }

  private enqueue(jobId: string): void {
    if (this.queued.has(jobId)) return;
    this.queued.add(jobId);
    this.queue.push(jobId);
    this.updateQueueDepth();
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const jobId = this.queue.shift();
        if (!jobId) continue;
        this.queued.delete(jobId);
        await this.processJobById(jobId);
      }
    } finally {
      this.processing = false;
      this.updateQueueDepth();
    }
  }

  private async processJobById(jobId: string): Promise<void> {
    const apiClient = this.deps.apiClient();
    const clientId = this.deps.settings().syncClientId;
    if (!apiClient || !clientId) return;

    let detail: TranscriptionExecutorJob;
    try {
      const response = await apiClient.getTranscriptionJob(jobId);
      if (!isExecutorJob(response.job)) return;
      detail = response.job;
    } catch (error) {
      console.warn('[TranscriptionJobProcessor] Failed to fetch job detail:', safeError(error));
      return;
    }

    if (detail.targetClientId !== clientId) return;
    this.applyExecutorJobToBanner(detail);

    let claim: TranscriptionClaimResponse;
    try {
      claim = await this.claimJob(apiClient, detail, clientId);
    } catch (error) {
      console.warn('[TranscriptionJobProcessor] Claim rejected:', safeError(error));
      return;
    }

    const abortController = new AbortController();
    const context: ProcessingContext = {
      job: {
        ...detail,
        ...claim.job,
      },
      claim,
      lease: {
        lockToken: claim.lockToken,
        lockTokenVersion: claim.lockTokenVersion,
        leaseExpiresAt: claim.leaseExpiresAt,
      },
      abortController,
      startedAt: new Date().toISOString(),
    };

    this.currentJobId = jobId;
    this.currentAbortController = abortController;
    try {
      await this.runClaimedJob(context);
    } finally {
      this.currentJobId = null;
      this.currentAbortController = null;
    }
  }

  private async claimJob(
    apiClient: WorkersAPIClient,
    job: TranscriptionExecutorJob,
    clientId: string,
  ): Promise<TranscriptionClaimResponse> {
    let capabilityHash = this.deps.capabilityHash();
    if (!capabilityHash) {
      await this.deps.refreshCapability();
      capabilityHash = this.deps.capabilityHash();
    }

    try {
      return await apiClient.claimTranscriptionJob(job.jobId, { clientId, capabilityHash });
    } catch (error) {
      if (getErrorCode(error) !== 'CAPABILITY_DRIFT') throw error;
      await this.deps.refreshCapability();
      return apiClient.claimTranscriptionJob(job.jobId, {
        clientId,
        capabilityHash: this.deps.capabilityHash(),
      });
    }
  }

  private async runClaimedJob(context: ProcessingContext): Promise<void> {
    try {
      await this.progress(context, 'preparing_archive', 10, 'preparing_archive');
      const file = await this.ensureArchiveMaterialized(context.job.archiveId);
      if (!file) {
        await this.fail(context, 'ARCHIVE_MATERIALIZATION_FAILED', true);
        return;
      }
      await this.normalizeDuplicateSourceArchiveId(file);

      const resumed = await this.resumePendingUpload(file, context);
      if (resumed) return;

      throwIfAborted(context.abortController.signal);
      await this.progress(
        context,
        'preparing_media',
        20,
        this.isDownloadMode(context.job.mode) ? 'downloading_video' : 'preparing_media',
      );
      const localMediaPath = await this.withMediaMaterializationLock(context, () =>
        this.resolveOrMaterializeMedia(file, context),
      );
      if (!localMediaPath) {
        await this.fail(context, 'MEDIA_FILE_MISSING', this.isDownloadMode(context.job.mode));
        return;
      }

      if (context.job.mode === 'download-only') {
        await this.completeDownloadOnlyJob(file, context, localMediaPath);
        return;
      }

      throwIfAborted(context.abortController.signal);
      const absoluteMediaPath = this.deps.toAbsoluteVaultPath(localMediaPath);
      const service = new TranscriptionService();
      await this.progress(context, 'running', 25, 'running');
      const result = await service.transcribe(absoluteMediaPath, {
        model: normalizeWhisperModel(context.job.requestedModel ?? this.deps.settings().transcription.preferredModel),
        language: context.job.language ?? this.deps.settings().transcription.language ?? 'auto',
        preferredVariant: this.deps.settings().transcription.preferredVariant ?? 'auto',
        customWhisperPath: this.deps.settings().transcription.customWhisperPath,
        forceEnableCustomPath: this.deps.settings().transcription.forceEnableCustomPath,
        audioDuration: await this.readFrontmatterDuration(file),
        onProgress: (progress) => {
          void this.handleLocalProgress(context, progress);
        },
        signal: context.abortController.signal,
      });

      throwIfAborted(context.abortController.signal);
      await this.progress(context, 'uploading', 90, 'uploading');
      const localWrite = await this.writeTranscriptResult(file, context, result, localMediaPath);
      const apiClient = this.deps.apiClient();
      const clientId = this.deps.settings().syncClientId;
      if (!apiClient || !clientId) return;

      const completedAt = new Date().toISOString();
      const transcriptPayload = {
        segments: result.segments.map((segment) => ({
          start: segment.start,
          end: segment.end,
          text: segment.text,
        })),
        rawText: result.segments.map((segment) => segment.text.trim()).filter(Boolean).join('\n'),
        language: result.language,
        duration: result.duration,
        model: result.model,
        hasWordTimestamps: result.hasWordTimestamps,
      };
      await this.persistPendingUpload(context, localWrite, transcriptPayload, {
        startedAt: context.startedAt,
        completedAt,
        processingTimeMs: result.processingTime,
      });
      const response = await apiClient.uploadTranscriptionJobResult(context.job.jobId, {
        clientId,
        lockToken: context.lease.lockToken,
        lockTokenVersion: context.lease.lockTokenVersion,
        transcript: transcriptPayload,
        localWrite,
        processing: {
          startedAt: context.startedAt,
          completedAt,
          processingTimeMs: result.processingTime,
        },
      });
      await this.clearPendingUpload(file, context.job.jobId, localWrite.resultMarkerId);
      this.deps.notify('Transcription finished in Obsidian.', 5000);
      this.deps.refreshTimelineView();
      if (response.job.status !== 'completed') {
        console.debug('[TranscriptionJobProcessor] Result uploaded; server job not completed yet', response.job);
      }
    } catch (error) {
      if (isAbortLike(error)) {
        const cancelled = await this.confirmCancel(context);
        if (!cancelled) await this.fail(context, 'PROCESS_CANCELLED', false);
        return;
      }
      if (isTranscriptionError(error)) {
        if (error.code === 'CANCELLED') {
          const cancelled = await this.confirmCancel(context);
          if (cancelled) return;
        }
        await this.fail(context, this.mapTranscriptionError(error), this.isRetryableTranscriptionError(error));
        return;
      }
      await this.fail(context, 'UNKNOWN', false);
    }
  }

  private async ensureArchiveMaterialized(archiveId: string): Promise<TFile | null> {
    let file = this.deps.archiveLookupService()?.findBySourceArchiveId(archiveId) ?? null;
    if (file) return file;

    await this.waitForArchiveLibrarySync();
    file = this.deps.archiveLookupService()?.findBySourceArchiveId(archiveId) ?? null;
    if (file) return file;

    const result = await this.deps.ingestRemoteArchive(archiveId, 'transcription_job');
    if (result === 'skipped') return null;
    await wait(600);
    return this.deps.archiveLookupService()?.findBySourceArchiveId(archiveId) ?? null;
  }

  private async waitForArchiveLibrarySync(): Promise<void> {
    const started = Date.now();
    while (this.deps.isArchiveLibrarySyncRunning() && Date.now() - started < 120_000) {
      await wait(1000);
    }
  }

  private async resolveOrMaterializeMedia(
    file: TFile,
    context: ProcessingContext,
  ): Promise<string | null> {
    const local = await this.resolveLocalMediaPath(file, context.job.mediaRef.kind);
    if (local) return local;
    if (context.job.mediaRef.kind === 'audio') {
      return this.downloadAudioForJob(file, context);
    }
    if (!this.isDownloadMode(context.job.mode)) return null;
    return this.downloadMediaForJob(file, context);
  }

  private async completeDownloadOnlyJob(file: TFile, context: ProcessingContext, localMediaPath: string): Promise<void> {
    throwIfAborted(context.abortController.signal);
    await this.progress(context, 'uploading', 95, 'download_completed');
      await this.ensureDownloadedVideoReference(file, context, localMediaPath);

    const apiClient = this.deps.apiClient();
    const clientId = this.deps.settings().syncClientId;
    if (!apiClient || !clientId) return;

    const completedAt = new Date().toISOString();
    const response = await apiClient.uploadTranscriptionDownloadResult(context.job.jobId, {
      clientId,
      lockToken: context.lease.lockToken,
      lockTokenVersion: context.lease.lockTokenVersion,
      localWrite: {
        markdownUpdated: true,
        frontmatterUpdated: true,
        localMediaPath,
      },
      processing: {
        startedAt: context.startedAt,
        completedAt,
        processingTimeMs: Date.parse(completedAt) - Date.parse(context.startedAt),
      },
    });
    this.applySummaryToBanner(response.job);
    this.deps.notify('Video downloaded in Obsidian.', 5000);
    this.deps.refreshTimelineView();
    if (response.job.status !== 'completed') {
      console.debug('[TranscriptionJobProcessor] Download-only job not completed yet', response.job);
    }
  }

  private async ensureDownloadedVideoReference(
    file: TFile,
    context: ProcessingContext,
    localMediaPath: string,
    sourceUrlOverride?: string,
  ): Promise<void> {
    if (context.job.mediaRef.kind !== 'video') return;
    await this.assertLocalMediaFileExists(localMediaPath);
    const frontmatter = await this.readFrontmatter(file);
    const sourceUrl = sourceUrlOverride ?? this.extractOriginalDownloadUrl(frontmatter);
    await this.withMarkdownWriteLock(context.job.archiveId, async () => {
      await this.deps.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        applyDownloadedVideoFrontmatter(fm, sourceUrl, localMediaPath);
      });
      await this.processFile(file, (content) => upsertDownloadedVideoEmbed(content, localMediaPath));
    }, context.abortController.signal);

    const updated = await this.deps.app.vault.read(file);
    if (!this.contentBodyContainsLocalMedia(updated, localMediaPath)) {
      throw new Error(`Downloaded video embed was not written to note: ${localMediaPath}`);
    }
  }

  private async reconcileDownloadedVideoStatus(event: {
    jobId?: string;
    archiveId?: string;
    status?: string;
    progressCode?: string;
    localMediaPath?: string;
  }): Promise<void> {
    if (
      event.status !== 'completed' ||
      event.progressCode !== 'download_completed' ||
      !event.jobId ||
      !event.archiveId ||
      !event.localMediaPath
    ) {
      return;
    }

    const localMediaPath = normalizePath(event.localMediaPath).replace(/^\/+/, '');
    if (!localMediaPath) return;

    const dedupeKey = `${event.jobId}:${localMediaPath}`;
    if (this.reconciledDownloadResults.has(dedupeKey)) return;

    const file = this.deps.archiveLookupService()?.findBySourceArchiveId(event.archiveId) ?? null;
    if (!file) return;

    try {
      await this.withMarkdownWriteLock(event.archiveId, async () => {
        await this.normalizeDuplicateSourceArchiveId(file);
        await this.deps.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
          applyDownloadedVideoFrontmatter(fm, null, localMediaPath);
        });
        await this.processFile(file, (content) => upsertDownloadedVideoEmbed(content, localMediaPath));
      });
      this.reconciledDownloadResults.add(dedupeKey);
      this.deps.refreshTimelineView();
    } catch (error) {
      console.warn('[TranscriptionJobProcessor] Failed to reconcile downloaded video status:', safeError(error));
    }
  }

  private async resolveLocalMediaPath(file: TFile, kind: TranscriptionMediaKind): Promise<string | null> {
    if (kind === 'video') {
      const paths = await this.deps.mediaPathResolver().resolveLocalVideoPathsInNote(file.path);
      const path = paths.find((candidate) => this.isLocalMediaVaultPath(candidate, kind));
      if (path) return path;
    }

    const content = await this.deps.app.vault.read(file);
    const frontmatter = this.readFrontmatterFromContent(file, content);
    const candidates = [
      ...this.extractFrontmatterMediaCandidates(frontmatter, kind),
      ...this.deps.mediaPathResolver().extractVideoPathCandidatesFromContent(content),
    ];

    for (const candidate of candidates) {
      const resolved = this.resolveCandidateToVaultPath(candidate, file, kind);
      if (resolved) return resolved;
    }
    return null;
  }

  private async downloadMediaForJob(file: TFile, context: ProcessingContext): Promise<string | null> {
    const download = this.deps.downloadWithYtDlp;
    if (!download || context.job.mediaRef.kind !== 'video') return null;
    const frontmatter = await this.readFrontmatter(file);
    const urls = this.deps.mediaPathResolver().extractDownloadableVideoUrls(frontmatter);
    if (urls.length === 0) {
      const fallbackUrl = this.extractOriginalDownloadUrl(frontmatter);
      if (fallbackUrl) urls.push(fallbackUrl);
    }
    const url = urls[0];
    if (!url) return null;

    const platform = typeof frontmatter.platform === 'string' ? frontmatter.platform : 'video';
    const postId = typeof frontmatter.postId === 'string'
      ? frontmatter.postId
      : typeof frontmatter.sourceArchiveId === 'string'
        ? frontmatter.sourceArchiveId
        : context.job.archiveId;
    try {
      const downloaded = await download(url, platform, postId, context.abortController.signal);
      if (!downloaded) return null;
      await this.ensureDownloadedVideoReference(file, context, downloaded, url);
      return downloaded;
    } catch (error) {
      console.warn('[TranscriptionJobProcessor] Media download failed:', safeError(error));
      return null;
    }
  }

  private async downloadAudioForJob(file: TFile, context: ProcessingContext): Promise<string | null> {
    const apiClient = this.deps.apiClient();
    if (!apiClient) return null;

    let archive: UserArchive | null = null;
    try {
      archive = await apiClient.getUserArchive(context.job.archiveId)
        .then((response) => response.archive ?? null);
    } catch (error) {
      console.warn('[TranscriptionJobProcessor] Failed to fetch archive for audio materialization:', safeError(error));
      return null;
    }

    if (!archive) return null;
    const source = this.resolveAudioMaterializationSource(archive, context.job.mediaRef);
    if (!source) return null;

    try {
      await this.progress(context, 'preparing_media', 22, 'downloading_audio');
      const results = await this.downloadMediaForTranscription(
        [source.media],
        archive.platform || 'podcast',
        archive.postId || archive.id,
        archive.authorHandle || archive.authorName || 'unknown',
      );
      const result = results[0];
      if (!result?.localPath) return null;
      await this.ensureDownloadedAudioReference(file, context, result.localPath, source.sourceUrl);
      return result.localPath;
    } catch (error) {
      console.warn('[TranscriptionJobProcessor] Audio materialization failed:', safeError(error));
      return null;
    }
  }

  private resolveAudioMaterializationSource(
    archive: UserArchive,
    mediaRef: TranscriptionExecutorJob['mediaRef'],
  ): AudioMaterializationSource | null {
    const media = archive.media ?? [];
    const preserved = archive.mediaPreserved ?? [];
    const mediaIndex = typeof mediaRef.mediaIndex === 'number' ? mediaRef.mediaIndex : undefined;
    const indexedMedia = mediaIndex !== undefined ? media[mediaIndex] : undefined;
    const sourceMedia = mediaIndex !== undefined
      ? (indexedMedia?.type === 'audio' ? indexedMedia : undefined)
      : media.find((item) => item.type === 'audio');

    const preservedAudio = preserved.find((item) => {
      if (item.type !== 'audio') return false;
      if (mediaIndex !== undefined && item.sourceIndex === mediaIndex) return true;
      if (sourceMedia?.url && item.originalUrl === sourceMedia.url) return true;
      if (mediaIndex !== undefined && item.r2Key.includes(`/podcast-audio-${mediaIndex}-`)) return true;
      return false;
    }) ?? preserved.find((item) => item.type === 'audio');

    const url = preservedAudio?.r2Url ?? sourceMedia?.url;
    if (!url) return null;

    return {
      media: {
        type: 'audio',
        url,
        ...(preservedAudio?.r2Url ? { r2Url: preservedAudio.r2Url } : {}),
        ...(sourceMedia?.thumbnail || sourceMedia?.thumbnailUrl ? { thumbnail: sourceMedia.thumbnail ?? sourceMedia.thumbnailUrl } : {}),
        ...(preservedAudio?.size != null ? { size: preservedAudio.size } : {}),
        ...(preservedAudio?.contentType ? { mimeType: preservedAudio.contentType } : {}),
      },
      sourceUrl: sourceMedia?.url ?? preservedAudio?.originalUrl ?? url,
    };
  }

  private async downloadMediaForTranscription(
    media: Media[],
    platform: string,
    postId: string,
    authorUsername: string,
  ): Promise<MediaResult[]> {
    if (this.deps.downloadMedia) {
      return this.deps.downloadMedia(media, platform, postId, authorUsername);
    }
    const apiClient = this.deps.apiClient();
    const { MediaHandler } = await import('../../services/MediaHandler');
    const handler = new MediaHandler({
      vault: this.deps.app.vault,
      app: this.deps.app,
      workersClient: apiClient,
      basePath: this.deps.settings().mediaPath || 'attachments/social-archives',
      optimizeImages: true,
      imageQuality: 0.8,
    });
    return handler.downloadMedia(media, platform as Platform, postId, authorUsername);
  }

  private async ensureDownloadedAudioReference(
    file: TFile,
    context: ProcessingContext,
    localMediaPath: string,
    sourceUrlOverride?: string | null,
  ): Promise<void> {
    if (context.job.mediaRef.kind !== 'audio') return;
    await this.assertLocalMediaFileExists(localMediaPath);
    await this.withMarkdownWriteLock(context.job.archiveId, async () => {
      await this.deps.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        applyDownloadedAudioFrontmatter(fm, sourceUrlOverride ?? null, localMediaPath);
      });
      await this.processFile(file, (content) => upsertDownloadedAudioEmbed(content, localMediaPath));
    }, context.abortController.signal);

    const updated = await this.deps.app.vault.read(file);
    if (!this.contentBodyContainsLocalMedia(updated, localMediaPath)) {
      throw new Error(`Downloaded audio embed was not written to note: ${localMediaPath}`);
    }
  }

  private async assertLocalMediaFileExists(localMediaPath: string): Promise<void> {
    const normalized = normalizePath(localMediaPath).replace(/^\/+/, '');
    if (!normalized) throw new Error('Downloaded media path is empty');
    const exists = await this.deps.app.vault.adapter.exists(normalized);
    if (!exists) throw new Error(`Downloaded media file is missing from vault: ${normalized}`);
  }

  private contentBodyContainsLocalMedia(content: string, localMediaPath: string): boolean {
    const normalizedPath = normalizePath(localMediaPath).replace(/^\/+/, '');
    if (!normalizedPath) return false;
    const frontmatterMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    const body = content.slice(frontmatterMatch ? frontmatterMatch[0].length : 0);
    return body.includes(normalizedPath) || body.includes(encodeURI(normalizedPath));
  }

  private extractOriginalDownloadUrl(frontmatter: Record<string, unknown>): string | null {
    const originalUrl = typeof frontmatter.originalUrl === 'string' ? frontmatter.originalUrl.trim() : '';
    if (!originalUrl) return null;
    if (!/youtube\.com|youtu\.be|tiktok\.com/i.test(originalUrl)) return null;
    return originalUrl;
  }

  private isDownloadMode(mode: TranscriptionExecutorJob['mode']): boolean {
    return mode === 'download-and-transcribe' || mode === 'download-only';
  }

  private async writeTranscriptResult(
    file: TFile,
    context: ProcessingContext,
    result: TranscriptionResult,
    localMediaPath: string,
  ): Promise<{ markdownUpdated: boolean; frontmatterUpdated: boolean; resultMarkerId: string }> {
    const resultMarkerId = `${context.job.jobId}:${context.job.mediaRefHash}:${result.language}`;
    const completedAt = new Date().toISOString();
    const body = this.formatter.formatWhisperTranscript(result.segments);
    const resultMarkerHash = await sha256Hex(body);
    let markdownUpdated = false;
    let frontmatterUpdated = false;

    await this.withMarkdownWriteLock(context.job.archiveId, async () => {
      await this.deps.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        if (context.job.mediaRef.kind === 'video') {
          fm.videoTranscribed = true;
          fm.videoTranscribedAt = completedAt;
          delete fm.videoTranscriptionError;
        } else {
          const transcribedUrls = Array.isArray(fm.transcribedUrls) ? [...fm.transcribedUrls] : [];
          const marker = `transcribed:${localMediaPath}`;
          if (!transcribedUrls.includes(marker)) transcribedUrls.push(marker);
          fm.transcribedUrls = transcribedUrls;
        }
        fm.transcriptionModel = result.model;
        fm.transcriptionLanguage = result.language;
        fm.transcriptionDuration = result.duration;
        fm.transcriptionTime = completedAt;
        fm.transcriptionProcessingTime = result.processingTime;
        const transcriptResultIds = Array.isArray(fm.transcriptResultIds) ? [...fm.transcriptResultIds] : [];
        if (!transcriptResultIds.includes(resultMarkerId)) transcriptResultIds.push(resultMarkerId);
        fm.transcriptResultIds = transcriptResultIds;
        const pendingUploads = normalizePendingFrontmatter(fm.pendingTranscriptUploads);
        const pendingEntry = {
          jobId: context.job.jobId,
          transcriptResultId: resultMarkerId,
          mediaRefHash: context.job.mediaRefHash,
          language: result.language,
          createdAt: completedAt,
          resultMarkerHash,
        };
        fm.pendingTranscriptUploads = [
          ...pendingUploads.filter((entry) => entry.jobId !== context.job.jobId),
          pendingEntry,
        ];
        frontmatterUpdated = true;
      });

      await this.processFile(file, (content) => {
        if (!body) return content;
        const updated = upsertMarkedTranscript(content, resultMarkerId, body);
        if (updated !== content) markdownUpdated = true;
        return updated;
      });
    }, context.abortController.signal);

    return {
      markdownUpdated,
      frontmatterUpdated,
      resultMarkerId,
    };
  }

  private async resumePendingUpload(file: TFile, context: ProcessingContext): Promise<boolean> {
    const pending = await this.findPendingUpload(context);
    if (!pending) return false;
    const apiClient = this.deps.apiClient();
    const clientId = this.deps.settings().syncClientId;
    if (!apiClient || !clientId) return false;

    await this.ensurePendingMarker(file, pending, context.abortController.signal);
    throwIfAborted(context.abortController.signal);
    await this.progress(context, 'uploading', 90, 'uploading');
    const response = await apiClient.uploadTranscriptionJobResult(context.job.jobId, {
      clientId,
      lockToken: context.lease.lockToken,
      lockTokenVersion: context.lease.lockTokenVersion,
      transcript: pending.transcript,
      localWrite: pending.localWrite,
      processing: pending.processing ?? {
        startedAt: context.startedAt,
        completedAt: new Date().toISOString(),
        processingTimeMs: 0,
      },
    });
    await this.clearPendingUpload(file, context.job.jobId, pending.resultMarkerId);
    this.deps.notify('Recovered and uploaded pending transcription result.', 5000);
    this.deps.refreshTimelineView();
    if (response.job.status !== 'completed') {
      console.debug('[TranscriptionJobProcessor] Pending result uploaded; server job not completed yet', response.job);
    }
    return true;
  }

  private async findPendingUpload(context: ProcessingContext): Promise<PendingTranscriptUploadRecord | null> {
    const records = await this.loadPendingUploads();
    return records.find((record) =>
      record.jobId === context.job.jobId
      && record.mediaRefHash === context.job.mediaRefHash
      && (!context.job.language || record.language === context.job.language)
    ) ?? null;
  }

  private async persistPendingUpload(
    context: ProcessingContext,
    localWrite: PendingTranscriptUploadRecord['localWrite'],
    transcript: PendingTranscriptUploadRecord['transcript'],
    processing: PendingTranscriptUploadRecord['processing'],
  ): Promise<void> {
    const records = await this.loadPendingUploads();
    const body = this.formatter.formatWhisperTranscript(toFormatterSegments(transcript.segments));
    const record: PendingTranscriptUploadRecord = {
      jobId: context.job.jobId,
      archiveId: context.job.archiveId,
      transcriptResultId: localWrite.resultMarkerId,
      mediaRefHash: context.job.mediaRefHash,
      language: transcript.language,
      createdAt: new Date().toISOString(),
      resultMarkerId: localWrite.resultMarkerId,
      resultMarkerHash: await sha256Hex(body),
      transcript,
      localWrite,
      processing,
    };
    await this.savePendingUploads([
      ...records.filter((item) => item.jobId !== context.job.jobId),
      record,
    ]);
  }

  private async ensurePendingMarker(
    file: TFile,
    pending: PendingTranscriptUploadRecord,
    signal: AbortSignal,
  ): Promise<void> {
    const body = this.formatter.formatWhisperTranscript(toFormatterSegments(pending.transcript.segments));
    const expectedHash = await sha256Hex(body);
    const content = await this.deps.app.vault.read(file);
    const section = await extractMarkedTranscript(content, pending.resultMarkerId);
    if (section && section.hash === pending.resultMarkerHash) return;
    let rendered = false;

    await this.withMarkdownWriteLock(pending.archiveId, async () => {
      await this.processFile(file, (content) => {
        const updated = upsertMarkedTranscript(content, pending.resultMarkerId, body);
        rendered = updated !== content;
        return updated;
      });

      if (rendered || pending.resultMarkerHash !== expectedHash) {
        await this.deps.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
          const pendingUploads = normalizePendingFrontmatter(fm.pendingTranscriptUploads);
          fm.pendingTranscriptUploads = pendingUploads.map((entry) =>
            entry.jobId === pending.jobId ? { ...entry, resultMarkerHash: expectedHash } : entry,
          );
        });
      }
    }, signal);

    if (rendered || pending.resultMarkerHash !== expectedHash) {
      await this.savePendingUploads((await this.loadPendingUploads()).map((record) =>
        record.jobId === pending.jobId ? { ...record, resultMarkerHash: expectedHash } : record,
      ));
    }
  }

  private async clearPendingUpload(file: TFile, jobId: string, resultMarkerId: string): Promise<void> {
    const records = await this.loadPendingUploads();
    const record = records.find((item) => item.jobId === jobId);
    await this.savePendingUploads(records.filter((item) => item.jobId !== jobId));
    await this.withMarkdownWriteLock(record?.archiveId ?? jobId, async () => {
      await this.deps.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        const pendingUploads = normalizePendingFrontmatter(fm.pendingTranscriptUploads)
          .filter((entry) => entry.jobId !== jobId && entry.transcriptResultId !== resultMarkerId);
        if (pendingUploads.length > 0) {
          fm.pendingTranscriptUploads = pendingUploads;
        } else {
          delete fm.pendingTranscriptUploads;
        }
      });
    });
  }

  private async loadPendingUploads(): Promise<PendingTranscriptUploadRecord[]> {
    const load = this.deps.loadPendingUploads;
    if (!load) return [];
    return (await load()).filter(isPendingTranscriptUploadRecord);
  }

  private async savePendingUploads(records: PendingTranscriptUploadRecord[]): Promise<void> {
    await this.deps.savePendingUploads?.(records.slice(-20));
  }

  private async reconcileServerTranscript(file: TFile, archive: UserArchive): Promise<void> {
    const transcript = archive.whisperTranscript;
    if (!transcript?.segments?.length) return;
    const resultId = archive.transcriptResultId || transcript.transcriptResultId || `${archive.id}:whisper:${transcript.language}`;
    const updatedAt = archive.transcriptionUpdatedAt || transcript.updatedAt || new Date().toISOString();
    const result: TranscriptionResult = {
      segments: transcript.segments.map((segment, index) => ({
        id: typeof segment.id === 'number' ? segment.id : index,
        start: segment.start,
        end: typeof segment.end === 'number' ? segment.end : segment.start + 1,
        text: segment.text,
      })),
      language: archive.transcriptionLanguage || transcript.language || 'auto',
      duration: archive.transcriptionDuration ?? transcript.duration ?? 0,
      processingTime: archive.transcriptionProcessingTime ?? 0,
      model: normalizeWhisperModel(archive.transcriptionModel || transcript.model || undefined),
      hasWordTimestamps: transcript.hasWordTimestamps === true,
    };

    await this.withMarkdownWriteLock(archive.id, async () => {
      await this.deps.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        fm.videoTranscribed = true;
        fm.videoTranscribedAt = updatedAt;
        delete fm.videoTranscriptionError;
        fm.transcriptionModel = archive.transcriptionModel || transcript.model || fm.transcriptionModel;
        fm.transcriptionLanguage = archive.transcriptionLanguage || transcript.language;
        if (archive.transcriptionDuration != null || transcript.duration != null) {
          fm.transcriptionDuration = archive.transcriptionDuration ?? transcript.duration;
        }
        fm.transcriptionTime = updatedAt;
        if (archive.transcriptionProcessingTime != null) {
          fm.transcriptionProcessingTime = archive.transcriptionProcessingTime;
        }
        fm.transcriptResultId = resultId;
        const ids = Array.isArray(fm.transcriptResultIds) ? [...fm.transcriptResultIds] : [];
        if (!ids.includes(resultId)) ids.push(resultId);
        fm.transcriptResultIds = ids;
      });

      await this.processFile(file, (content) => {
        const body = this.formatter.formatWhisperTranscript(result.segments);
        if (!body) return content;
        return upsertMarkedTranscript(content, resultId, body);
      });
    });
  }

  private applyExecutorJobToBanner(job: TranscriptionExecutorJob): void {
    this.setBannerState({
      jobId: job.jobId,
      archiveId: job.archiveId,
      mediaRefHash: job.mediaRefHash,
      title: this.resolveArchiveTitle(job.archiveId),
      targetClientId: job.targetClientId,
      status: job.status,
      uiStatus: job.uiStatus,
      progressPercentage: job.progressPercentage,
      progressCode: job.progressCode,
      queueDepth: this.queue.length,
      errorCode: job.errorCode,
      errorMessagePublic: job.errorMessagePublic,
      terminalReason: job.terminalReason,
      transcriptResultId: job.transcriptResultId,
      updatedAt: job.updatedAt,
    });
  }

  private applySummaryToBanner(summary: {
    jobId?: string;
    archiveId?: string;
    mediaRefHash?: string;
    targetClientId?: string;
    status?: string;
    uiStatus?: TranscriptionActiveJobSummary['uiStatus'];
    progressPercentage?: number;
    progressCode?: string;
    errorCode?: string;
    errorMessagePublic?: string;
    terminalReason?: string;
    transcriptResultId?: string;
    localMediaPath?: string;
    updatedAt?: string;
  }): void {
    if (!summary.jobId) return;
    const previous = this.bannerState?.jobId === summary.jobId ? this.bannerState : null;
    const archiveId = summary.archiveId ?? previous?.archiveId ?? '';
    const status = normalizeTranscriptionBannerStatus(summary.status) ?? previous?.status ?? 'queued';
    this.setBannerState({
      jobId: summary.jobId,
      archiveId,
      mediaRefHash: summary.mediaRefHash ?? previous?.mediaRefHash,
      title: previous?.title ?? this.resolveArchiveTitle(archiveId),
      targetClientId: summary.targetClientId ?? previous?.targetClientId,
      status,
      uiStatus: summary.uiStatus ?? previous?.uiStatus,
      progressPercentage: summary.progressPercentage ?? previous?.progressPercentage,
      progressCode: summary.progressCode ?? previous?.progressCode,
      queueDepth: this.queue.length,
      errorCode: summary.errorCode ?? previous?.errorCode,
      errorMessagePublic: summary.errorMessagePublic ?? previous?.errorMessagePublic,
      terminalReason: summary.terminalReason ?? previous?.terminalReason,
      transcriptResultId: summary.transcriptResultId ?? previous?.transcriptResultId,
      localMediaPath: summary.localMediaPath ?? previous?.localMediaPath,
      updatedAt: summary.updatedAt ?? new Date().toISOString(),
    });
  }

  private updateQueueDepth(): void {
    if (!this.bannerState) return;
    this.setBannerState({
      ...this.bannerState,
      queueDepth: this.queue.length,
    });
  }

  private setBannerState(state: TranscriptionJobBannerState | null): void {
    this.bannerState = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  private resolveArchiveTitle(archiveId: string): string | undefined {
    if (!archiveId) return undefined;
    return this.deps.archiveLookupService()?.findBySourceArchiveId(archiveId)?.basename;
  }

  private async processFile(file: TFile, updater: (content: string) => string): Promise<void> {
    const vault = this.deps.app.vault as typeof this.deps.app.vault & {
      process?: (file: TFile, fn: (content: string) => string) => Promise<void>;
      modify?: (file: TFile, content: string) => Promise<void>;
      read: (file: TFile) => Promise<string>;
    };
    if (typeof vault.process === 'function') {
      await vault.process(file, updater);
      return;
    }
    const existing = await vault.read(file);
    const updated = updater(existing);
    if (updated !== existing && typeof vault.modify === 'function') {
      await vault.modify(file, updated);
    }
  }

  private async normalizeDuplicateSourceArchiveId(file: TFile): Promise<void> {
    const vault = this.deps.app.vault;
    const content = await vault.read(file);
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const frontmatter = match?.[1];
    if (!match || match.index !== 0 || frontmatter === undefined) return;

    const lines = frontmatter.split(/\r?\n/);
    const identityLines = lines.filter((line) => /^sourceArchiveId:\s*/.test(line));
    if (identityLines.length <= 1) return;

    const value = identityLines[identityLines.length - 1]?.replace(/^sourceArchiveId:\s*/, '').trim();
    if (!value) return;

    const nextFrontmatter = [
      ...lines.filter((line) => !/^sourceArchiveId:\s*/.test(line)),
      `sourceArchiveId: ${value}`,
    ].join('\n').replace(/\s+$/, '');
    const updated = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${nextFrontmatter}\n---`);
    if (updated !== content) {
      await vault.modify(file, updated);
    }
  }

  private async readFrontmatter(file: TFile): Promise<Record<string, unknown>> {
    return this.readFrontmatterFromContent(file, await this.deps.app.vault.read(file));
  }

  private readFrontmatterFromContent(file: TFile, content: string): Record<string, unknown> {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const raw = match?.[1];
    if (raw !== undefined) {
      try {
        const parsed = parseYaml(raw);
        if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
      } catch {
        // The metadata cache may still have a usable value if raw parsing fails.
      }
    }

    const cached = this.deps.app.metadataCache.getFileCache(file)?.frontmatter;
    return cached && typeof cached === 'object' ? cached as Record<string, unknown> : {};
  }

  private async progress(
    context: ProcessingContext,
    status: TranscriptionJobStatus,
    progressPercentage: number,
    progressCode: string,
  ): Promise<void> {
    const apiClient = this.deps.apiClient();
    const clientId = this.deps.settings().syncClientId;
    if (!apiClient || !clientId) return;

    if (!this.shouldRenewLease(context) && status === context.job.status) return;
    const response: TranscriptionLeaseResponse = await apiClient.updateTranscriptionJobProgress(context.job.jobId, {
      clientId,
      lockToken: context.lease.lockToken,
      lockTokenVersion: context.lease.lockTokenVersion,
      status,
      progressPercentage,
      progressCode,
    });
    this.applySummaryToBanner(response.job);
    context.lease.lockToken = response.lockToken;
    context.lease.lockTokenVersion = response.lockTokenVersion;
    context.lease.leaseExpiresAt = response.leaseExpiresAt;
    context.job.status = status;
  }

  private async handleLocalProgress(context: ProcessingContext, progress: TranscriptionProgress): Promise<void> {
    const percentage = Math.max(25, Math.min(85, progress.percentage));
    await this.progress(context, 'running', percentage, 'running').catch((error) => {
      console.warn('[TranscriptionJobProcessor] Progress update failed:', safeError(error));
    });
  }

  private async fail(
    context: ProcessingContext,
    errorCode: TranscriptionPublicErrorCode,
    retryable: boolean,
  ): Promise<void> {
    const apiClient = this.deps.apiClient();
    const clientId = this.deps.settings().syncClientId;
    if (!apiClient || !clientId) return;
    const response = await apiClient.failTranscriptionJob(context.job.jobId, {
      clientId,
      lockToken: context.lease.lockToken,
      lockTokenVersion: context.lease.lockTokenVersion,
      errorCode,
      retryable,
    }).catch((error) => {
      console.warn('[TranscriptionJobProcessor] Failed to report job failure:', safeError(error));
      return null;
    });
    if (response) this.applySummaryToBanner(response.job);
  }

  private async confirmCancel(context: ProcessingContext): Promise<boolean> {
    const apiClient = this.deps.apiClient();
    const clientId = this.deps.settings().syncClientId;
    if (!apiClient || !clientId) return false;
    try {
      await apiClient.confirmTranscriptionJobCancel(context.job.jobId, {
        clientId,
        lockToken: context.lease.lockToken,
        lockTokenVersion: context.lease.lockTokenVersion,
      });
      return true;
    } catch (error) {
      console.warn('[TranscriptionJobProcessor] Failed to confirm cancellation:', safeError(error));
      return false;
    }
  }

  private shouldRenewLease(context: ProcessingContext): boolean {
    const expires = Date.parse(context.lease.leaseExpiresAt);
    if (!Number.isFinite(expires)) return true;
    const remaining = expires - Date.now();
    return remaining <= 10 * 60 * 1000 * LEASE_RENEW_RATIO;
  }

  private async withMediaMaterializationLock<T>(
    context: ProcessingContext,
    fn: () => Promise<T>,
  ): Promise<T> {
    const registry = this.deps.localLockRegistry;
    if (!registry) return fn();
    return registry.withLock(
      {
        kind: 'mediaMaterialization',
        archiveId: context.job.archiveId,
        mediaRefHash: context.job.mediaRefHash,
      },
      fn,
      { signal: context.abortController.signal },
    );
  }

  private async withMarkdownWriteLock<T>(
    archiveId: string,
    fn: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const registry = this.deps.localLockRegistry;
    if (!registry) return fn();
    return registry.withLock({ kind: 'markdownWrite', archiveId }, fn, { signal });
  }

  private extractFrontmatterMediaCandidates(frontmatter: Record<string, unknown>, kind: TranscriptionMediaKind): string[] {
    const candidates: string[] = [];
    const directKeys = kind === 'audio'
      ? ['audioLocalPath', 'audioPath', 'localAudioPath']
      : ['videoLocalPath', 'videoPath', 'localVideoPath'];
    for (const key of directKeys) {
      const value = frontmatter[key];
      if (typeof value === 'string' && value.trim()) candidates.push(value.trim());
    }

    const media = frontmatter.media;
    if (Array.isArray(media)) {
      for (const item of media) {
        if (typeof item === 'string') {
          const trimmed = item.trim();
          const typed = trimmed.match(/^(audio|video)\s*:(.+)$/i);
          if (typed?.[1]?.toLowerCase() === kind && typed[2]) candidates.push(typed[2].trim());
          else candidates.push(trimmed);
          continue;
        }
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        const mediaType = typeof record.type === 'string' ? record.type.toLowerCase() : '';
        if (mediaType && mediaType !== kind) continue;
        for (const key of ['localPath', 'path', 'src', 'url']) {
          const value = record[key];
          if (typeof value === 'string' && value.trim()) {
            candidates.push(value.trim());
            break;
          }
        }
      }
    }
    return unique(candidates);
  }

  private resolveCandidateToVaultPath(candidate: string, note: TFile, kind: TranscriptionMediaKind): string | null {
    const trimmed = candidate.trim();
    if (!trimmed || this.deps.mediaPathResolver().isExternalMediaPath(trimmed)) return null;
    const resolved = this.deps.mediaPathResolver().resolveMediaPathForNote(trimmed, note.path);
    const normalized = normalizePath(resolved).replace(/^\/+/, '');
    if (!this.isLocalMediaVaultPath(normalized, kind)) return null;
    return normalized;
  }

  private isLocalMediaVaultPath(path: string, kind: TranscriptionMediaKind): boolean {
    const cleanPath = path.split('?')[0]?.split('#')[0] ?? path;
    const fileName = cleanPath.split('/').pop() ?? '';
    const ext = fileName.includes('.') ? (fileName.split('.').pop()?.toLowerCase() ?? '') : '';
    const expected = kind === 'audio' ? AUDIO_EXTENSIONS : VIDEO_EXTENSIONS;
    if (!expected.has(ext) && !(kind === 'audio' && ext === '')) return false;
    return this.deps.app.vault.getAbstractFileByPath(path) instanceof TFile;
  }

  private async readFrontmatterDuration(file: TFile): Promise<number | undefined> {
    const frontmatter = await this.readFrontmatter(file);
    const duration = frontmatter.duration;
    if (typeof duration === 'number' && Number.isFinite(duration)) return duration;
    if (typeof duration === 'string') {
      const parsed = Number(duration);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  }

  private mapTranscriptionError(error: TranscriptionError): TranscriptionPublicErrorCode {
    switch (error.code) {
      case 'NOT_INSTALLED':
        return 'WHISPER_NOT_INSTALLED';
      case 'MODEL_NOT_FOUND':
        return 'WHISPER_AUTH_OR_MODEL_ERROR';
      case 'AUDIO_NOT_FOUND':
        return 'MEDIA_FILE_MISSING';
      case 'INVALID_AUDIO':
        if (/ffmpeg/i.test(error.message)) {
          return /not found/i.test(error.message) ? 'FFMPEG_MISSING' : 'FFMPEG_FAILED';
        }
        return 'UNSUPPORTED_MEDIA_TYPE';
      case 'CANCELLED':
        return 'PROCESS_CANCELLED';
      case 'TIMEOUT':
        return 'TIMEOUT';
      case 'OUT_OF_MEMORY':
        return 'OUT_OF_MEMORY';
      default:
        return 'UNKNOWN';
    }
  }

  private isRetryableTranscriptionError(error: TranscriptionError): boolean {
    return error.code === 'TIMEOUT' || error.code === 'UNKNOWN';
  }
}

function isExecutorJob(job: TranscriptionExecutorJob | TranscriptionActiveJobSummary): job is TranscriptionExecutorJob {
  return typeof (job as TranscriptionExecutorJob).targetClientId === 'string';
}

function normalizeTranscriptionBannerStatus(status: string | undefined): TranscriptionJobStatus | null {
  if (!status) return null;
  switch (status) {
    case 'queued':
    case 'dispatched':
    case 'claiming':
    case 'claimed':
    case 'preparing_archive':
    case 'preparing_media':
    case 'running':
    case 'uploading':
    case 'merging':
    case 'retry_scheduled':
    case 'completed':
    case 'failed':
    case 'cancel_requested':
    case 'cancelled':
    case 'expired':
      return status;
    default:
      return null;
  }
}

function normalizeWhisperModel(value: string | undefined): 'tiny' | 'base' | 'small' | 'medium' | 'large' {
  return value === 'tiny' || value === 'base' || value === 'small' || value === 'medium' || value === 'large'
    ? value
    : 'small';
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function getErrorCode(error: unknown): string | undefined {
  return (error as { code?: unknown } | null)?.code as string | undefined;
}

function isAbortLike(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && /abort|cancel/i.test(error.message)) return true;
  return false;
}

interface PendingTranscriptFrontmatterEntry {
  jobId: string;
  transcriptResultId: string;
  mediaRefHash: string;
  language: string;
  createdAt: string;
  resultMarkerHash: string;
}

function normalizePendingFrontmatter(value: unknown): PendingTranscriptFrontmatterEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const source = entry as Record<string, unknown>;
    const jobId = stringValue(source.jobId);
    const transcriptResultId = stringValue(source.transcriptResultId);
    const mediaRefHash = stringValue(source.mediaRefHash);
    const language = stringValue(source.language);
    const createdAt = stringValue(source.createdAt);
    const resultMarkerHash = stringValue(source.resultMarkerHash);
    return jobId && transcriptResultId && mediaRefHash && language && createdAt && resultMarkerHash
      ? [{ jobId, transcriptResultId, mediaRefHash, language, createdAt, resultMarkerHash }]
      : [];
  });
}

function isPendingTranscriptUploadRecord(value: unknown): value is PendingTranscriptUploadRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as PendingTranscriptUploadRecord;
  return Boolean(
    record.jobId
      && record.archiveId
      && record.transcriptResultId
      && record.mediaRefHash
      && record.language
      && record.resultMarkerId
      && record.resultMarkerHash
      && record.transcript
      && Array.isArray(record.transcript.segments)
      && typeof record.transcript.rawText === 'string'
      && typeof record.transcript.language === 'string'
      && typeof record.transcript.model === 'string'
      && record.localWrite
      && record.localWrite.resultMarkerId
  );
}

function toFormatterSegments(
  segments: Array<{ start: number; end?: number; text: string }>,
): Array<{ id: number; start: number; end: number; text: string }> {
  return segments.map((segment, index) => ({
    id: index,
    start: segment.start,
    end: segment.end ?? segment.start + 1,
    text: segment.text,
  }));
}

async function extractMarkedTranscript(
  content: string,
  resultMarkerId: string,
): Promise<{ body: string; hash: string } | null> {
  const pattern = buildMarkedTranscriptPattern(resultMarkerId);
  let match: RegExpExecArray | null;
  let body: string | null = null;
  while ((match = pattern.exec(content)) !== null) {
    body = match[1]?.trim() ?? '';
  }
  return body === null ? null : { body, hash: await sha256Hex(body) };
}

function upsertMarkedTranscript(content: string, resultMarkerId: string, body: string): string {
  if (!body.trim()) return content;
  const rendered = renderMarkedTranscript(resultMarkerId, body);
  if (buildMarkedTranscriptPattern(resultMarkerId).test(content)) {
    return content.replace(buildMarkedTranscriptPattern(resultMarkerId), rendered);
  }
  const normalizedContent = content.replace(/\s+$/, '');
  return `${normalizedContent}\n\n---\n\n${rendered}\n`;
}

function renderMarkedTranscript(resultMarkerId: string, body: string): string {
  return `<!-- social-archiver-transcript:start resultMarkerId=${resultMarkerId} -->\n## Transcript\n\n${body}\n<!-- social-archiver-transcript:end resultMarkerId=${resultMarkerId} -->`;
}

function buildMarkedTranscriptPattern(resultMarkerId: string): RegExp {
  const escaped = escapeRegExp(resultMarkerId);
  return new RegExp(
    `<!--\\s*social-archiver-transcript:start\\s+resultMarkerId=${escaped}\\s*-->\\s*##\\s+Transcript\\s*\\n+([\\s\\S]*?)\\n?<!--\\s*social-archiver-transcript:end\\s+resultMarkerId=${escaped}\\s*-->`,
    'g',
  );
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('Transcription job cancelled', 'AbortError');
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
