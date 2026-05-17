import { Notice, TFile, type App } from 'obsidian';
import type {
  AICommentClaimResponse,
  AICommentExecutorJob,
  AICommentJobStatus,
  AICommentLeaseResponse,
  WorkersAPIClient,
} from '../../services/WorkersAPIClient';
import type { ArchiveLookupService } from '../../services/ArchiveLookupService';
import { AICommentService } from '../../services/AICommentService';
import {
  AICommentError,
  type AICommentMeta,
  type AICommentProgress,
  type AICommentType,
  type AIOutputLanguage,
} from '../../types/ai-comment';
import type { AICli } from '../../utils/ai-cli';
import type { SocialArchiverSettings } from '../../types/settings';
import type { LocalAICommentPendingUpload, AICommentPublicJobErrorCode } from '../../types/ai-comment-job';
import { appendAIComment, parseAIComments, updateFrontmatterAIComments } from '../../services/ai-comment/markdown-handler';
import { buildAICommentInputContent } from './AICommentInputContext';

type IngestResult = 'created' | 'existing' | 'skipped';

export interface AICommentJobProcessorDeps {
  app: App;
  apiClient: () => WorkersAPIClient | undefined;
  settings: () => SocialArchiverSettings;
  saveSettings: () => Promise<void>;
  archiveLookupService: () => ArchiveLookupService | undefined;
  ingestRemoteArchive: (archiveId: string, source: 'ai_comment_job') => Promise<IngestResult>;
  isArchiveLibrarySyncRunning: () => boolean;
  refreshTimelineView: () => void;
  schedule: (callback: () => void, delay: number) => number;
  clearSchedule: (id: number) => void;
  notify: (message: string, timeout?: number) => void;
}

interface ActiveLease {
  lockToken: string;
  lockTokenVersion: number;
  leaseExpiresAt: string;
}

interface ProcessingContext {
  job: AICommentExecutorJob;
  claim: AICommentClaimResponse;
  lease: ActiveLease;
}

export interface AICommentJobBannerState {
  jobId: string;
  archiveId: string;
  title?: string;
  previewText?: string;
  provider: string;
  status: AICommentJobStatus | 'cancel_requested';
  progressPercentage?: number;
  progressMessage?: string;
  queueDepth: number;
  errorCode?: string;
  errorMessagePublic?: string;
  updatedAt: string;
}

const BACKLOG_POLL_MS = 3 * 60 * 1000;
const LEASE_RENEW_RATIO = 0.5;

export class AICommentJobProcessor {
  private readonly queue: string[] = [];
  private readonly queued = new Set<string>();
  private readonly archiveLocks = new Map<string, Promise<void>>();
  private backlogTimer: number | null = null;
  private processing = false;
  private currentJobId: string | null = null;
  private currentService: AICommentService | null = null;
  private bannerState: AICommentJobBannerState | null = null;
  private readonly listeners = new Set<(state: AICommentJobBannerState | null) => void>();

  constructor(private readonly deps: AICommentJobProcessorDeps) {}

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
    this.currentService?.cancel();
    this.currentService = null;
    this.setBannerState(null);
  }

  private scheduleBacklogPoll(): void {
    this.backlogTimer = this.deps.schedule(() => {
      this.backlogTimer = null;
      void this.drainBacklog().finally(() => {
        if (this.backlogTimer === null) this.scheduleBacklogPoll();
      });
    }, BACKLOG_POLL_MS);
  }

  onUpdate(listener: (state: AICommentJobBannerState | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.bannerState);
    return () => this.listeners.delete(listener);
  }

  getBannerState(): AICommentJobBannerState | null {
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
      const response = await apiClient.cancelAICommentJob(jobId, { clientId });
      this.applySummaryToBanner(response.job);
      if (jobId === this.currentJobId) this.currentService?.cancel();
    } catch (error) {
      console.warn('[AICommentJobProcessor] Cancel request failed:', safeError(error));
    }
  }

  async drainBacklog(): Promise<void> {
    const apiClient = this.deps.apiClient();
    const clientId = this.deps.settings().syncClientId;
    if (!apiClient || !clientId || !this.deps.settings().authToken) return;

    const response = await apiClient.getAvailableAICommentJobs(clientId);
    for (const job of response.jobs) {
      this.enqueue(job.jobId);
    }
    this.updateQueueDepth();
    await this.processQueue();
  }

  async handleRequestedJob(jobId: string, targetClientId: string): Promise<void> {
    if (targetClientId !== this.deps.settings().syncClientId) return;
    this.enqueue(jobId);
    await this.processQueue();
  }

  async handleStatusEvent(event: {
    jobId?: string;
    targetClientId?: string;
    status?: string;
    archiveId?: string;
    progressPercentage?: number;
    progressMessage?: string;
    errorCode?: string;
    errorMessagePublic?: string;
    updatedAt?: string;
  }): Promise<void> {
    if (!event.jobId || event.targetClientId !== this.deps.settings().syncClientId) return;
    if ((event.status === 'cancel_requested' || event.status === 'cancelled') && event.jobId === this.currentJobId) {
      this.currentService?.cancel();
    }
    this.applySummaryToBanner(event);
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

    let detail: AICommentExecutorJob;
    try {
      detail = (await apiClient.getAICommentJob(jobId)).job;
    } catch (error) {
      console.warn('[AICommentJobProcessor] Failed to fetch job detail:', safeError(error));
      return;
    }

    if (detail.targetClientId !== clientId) return;
    this.applyExecutorJobToBanner(detail);

    let claim: AICommentClaimResponse;
    try {
      claim = await apiClient.claimAICommentJob(jobId, {
        clientId,
        capabilityStatus: 'ready',
        provider: detail.provider,
      });
    } catch (error) {
      console.warn('[AICommentJobProcessor] Claim rejected:', safeError(error));
      return;
    }

    const lease: ActiveLease = {
      lockToken: claim.lockToken,
      lockTokenVersion: claim.lockTokenVersion,
      leaseExpiresAt: claim.leaseExpiresAt,
    };
    const context: ProcessingContext = { job: detail, claim, lease };

    this.currentJobId = jobId;
    try {
      await this.withArchiveLock(detail.archiveId, () => this.runClaimedJob(context));
    } finally {
      this.currentJobId = null;
      this.currentService = null;
    }
  }

  private async runClaimedJob(context: ProcessingContext): Promise<void> {
    const apiClient = this.deps.apiClient();
    const clientId = this.deps.settings().syncClientId;
    if (!apiClient || !clientId) return;

    try {
      await this.progress(context, 'preparing', 10, 'Preparing in Obsidian...');
      const file = await this.ensureArchiveMaterialized(context.job.archiveId);
      if (!file) {
        await this.fail(context, 'VAULT_FILE_MISSING', true);
        return;
      }

      const pending = this.deps.settings().aiCommentPendingUploads?.[context.job.jobId];
      if (pending) {
        await this.uploadPending(context, pending);
        return;
      }

      const existing = await this.findExistingGeneratedComment(file, context);
      if (existing) {
        await this.persistPendingUpload(context, existing.meta, existing.content);
        await this.uploadPending(context, this.deps.settings().aiCommentPendingUploads[context.job.jobId]!);
        return;
      }

      await this.progress(context, 'running', 25, 'Running in Obsidian...');
      const content = await this.deps.app.vault.read(file);
      const inputContent = buildAICommentInputContent(content, context.job.archiveSnapshot);
      if (!inputContent.trim()) {
        await this.fail(context, 'CONTENT_EMPTY', false);
        return;
      }

      const service = new AICommentService();
      this.currentService = service;
      const result = await service.generateComment(inputContent, {
        cli: context.job.provider as AICli,
        model: context.job.model ?? undefined,
        type: context.job.type as AICommentType,
        outputLanguage: context.job.outputLanguage as AIOutputLanguage,
        customPrompt: typeof context.job.customPrompt === 'string' ? context.job.customPrompt : undefined,
        vaultPath: context.job.type === 'connections' ? this.getVaultBasePath() : undefined,
        currentNotePath: context.job.type === 'connections' ? file.path : undefined,
        onProgress: (progress) => {
          void this.handleLocalProgress(context, progress);
        },
      });

      const canonicalMeta: AICommentMeta = {
        ...result.meta,
        id: this.resultCommentId(context.job),
      };

      await this.appendResultToMarkdown(file, canonicalMeta, result.content);
      await this.persistPendingUpload(context, canonicalMeta, result.content);
      await this.uploadPending(context, this.deps.settings().aiCommentPendingUploads[context.job.jobId]!);
    } catch (error) {
      if (error instanceof AICommentError) {
        if (error.code === 'CANCELLED') {
          const cancelled = await this.confirmCancel(context);
          if (cancelled) return;
        }
        await this.fail(context, this.mapAICommentError(error), this.isRetryableAIError(error));
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

    const result = await this.deps.ingestRemoteArchive(archiveId, 'ai_comment_job');
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

  private async appendResultToMarkdown(file: TFile, meta: AICommentMeta, content: string): Promise<void> {
    let finalContent = '';
    await this.deps.app.vault.process(file, (existingContent) => {
      const parsed = parseAIComments(existingContent);
      if (parsed.commentTexts.has(meta.id)) {
        finalContent = existingContent;
        return existingContent;
      }
      finalContent = appendAIComment(existingContent, meta, content);
      return finalContent;
    });
    const parsed = parseAIComments(finalContent || (await this.deps.app.vault.read(file)));
    await updateFrontmatterAIComments(this.deps.app, file, parsed.comments);
    this.deps.refreshTimelineView();
  }

  private async findExistingGeneratedComment(
    file: TFile,
    context: ProcessingContext,
  ): Promise<{ meta: AICommentMeta; content: string } | null> {
    const content = await this.deps.app.vault.read(file);
    const parsed = parseAIComments(content);
    const id = this.resultCommentId(context.job);
    const existing = parsed.comments.find((comment) => comment.id === id);
    if (!existing) return null;
    return {
      meta: existing,
      content: parsed.commentTexts.get(id) ?? '',
    };
  }

  private async uploadPending(context: ProcessingContext, pending: LocalAICommentPendingUpload): Promise<void> {
    await this.progress(context, 'uploading', 90, 'Generated locally. Uploading result...');
    const apiClient = this.deps.apiClient();
    const clientId = this.deps.settings().syncClientId;
    if (!apiClient || !clientId) return;

    try {
      const response = await apiClient.uploadAICommentJobResult(context.job.jobId, {
        clientId,
        lockToken: context.lease.lockToken,
        lockTokenVersion: context.lease.lockTokenVersion,
        comment: {
          meta: pending.meta as unknown as Record<string, unknown>,
          content: pending.content,
        },
      });
      this.applySummaryToBanner(response.job);
      const pendingUploads = {
        ...this.deps.settings().aiCommentPendingUploads,
      };
      delete pendingUploads[context.job.jobId];
      this.deps.settings().aiCommentPendingUploads = pendingUploads;
      await this.deps.saveSettings();
      this.deps.refreshTimelineView();
    } catch (error) {
      console.warn('[AICommentJobProcessor] Upload failed:', safeError(error));
      await this.fail(context, 'UPLOAD_FAILED', true);
    }
  }

  private async persistPendingUpload(context: ProcessingContext, meta: AICommentMeta, content: string): Promise<void> {
    const now = new Date().toISOString();
    this.deps.settings().aiCommentPendingUploads = {
      ...this.deps.settings().aiCommentPendingUploads,
      [context.job.jobId]: {
        jobId: context.job.jobId,
        archiveId: context.job.archiveId,
        resultCommentId: meta.id,
        meta,
        content,
        provider: context.job.provider as AICli,
        model: context.job.model ?? null,
        type: context.job.type as AICommentType,
        outputLanguage: context.job.outputLanguage as AIOutputLanguage,
        createdAt: this.deps.settings().aiCommentPendingUploads?.[context.job.jobId]?.createdAt ?? now,
        updatedAt: now,
      },
    };
    await this.deps.saveSettings();
  }

  private async progress(
    context: ProcessingContext,
    status: AICommentJobStatus,
    progressPercentage: number,
    progressMessage: string,
  ): Promise<void> {
    const apiClient = this.deps.apiClient();
    const clientId = this.deps.settings().syncClientId;
    if (!apiClient || !clientId) return;

    if (!this.shouldRenewLease(context) && status === context.job.status) return;

    const response: AICommentLeaseResponse = await apiClient.updateAICommentJobProgress(context.job.jobId, {
      clientId,
      lockToken: context.lease.lockToken,
      lockTokenVersion: context.lease.lockTokenVersion,
      status,
      progressPercentage,
      progressMessage,
    });
    context.lease.lockToken = response.lockToken;
    context.lease.lockTokenVersion = response.lockTokenVersion;
    context.lease.leaseExpiresAt = response.leaseExpiresAt;
    context.job.status = status;
  }

  private async handleLocalProgress(context: ProcessingContext, progress: AICommentProgress): Promise<void> {
    const percentage = Math.max(25, Math.min(85, progress.percentage));
    await this.progress(context, 'running', percentage, 'Running in Obsidian...').catch((error) => {
      console.warn('[AICommentJobProcessor] Progress update failed:', safeError(error));
    });
  }

  private async fail(context: ProcessingContext, errorCode: AICommentPublicJobErrorCode, retryable: boolean): Promise<void> {
    const apiClient = this.deps.apiClient();
    const clientId = this.deps.settings().syncClientId;
    if (!apiClient || !clientId) return;
    await apiClient
      .failAICommentJob(context.job.jobId, {
        clientId,
        lockToken: context.lease.lockToken,
        lockTokenVersion: context.lease.lockTokenVersion,
        errorCode,
        retryable,
      })
      .catch((error) => {
        console.warn('[AICommentJobProcessor] Failed to report job failure:', safeError(error));
      });
  }

  private async confirmCancel(context: ProcessingContext): Promise<boolean> {
    const apiClient = this.deps.apiClient();
    const clientId = this.deps.settings().syncClientId;
    if (!apiClient || !clientId) return false;
    try {
      const response = await apiClient.cancelAICommentJob(context.job.jobId, {
        clientId,
        confirm: true,
        lockToken: context.lease.lockToken,
        lockTokenVersion: context.lease.lockTokenVersion,
      });
      this.applySummaryToBanner(response.job);
      return true;
    } catch (error) {
      console.warn('[AICommentJobProcessor] Failed to confirm cancellation:', safeError(error));
      return false;
    }
  }

  private shouldRenewLease(context: ProcessingContext): boolean {
    const expires = Date.parse(context.lease.leaseExpiresAt);
    if (!Number.isFinite(expires)) return true;
    const remaining = expires - Date.now();
    return remaining <= 10 * 60 * 1000 * LEASE_RENEW_RATIO;
  }

  private async withArchiveLock<T>(archiveId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.archiveLocks.get(archiveId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.then(() => next);
    this.archiveLocks.set(archiveId, chain);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.archiveLocks.get(archiveId) === chain) {
        this.archiveLocks.delete(archiveId);
      }
    }
  }

  private applyExecutorJobToBanner(job: AICommentExecutorJob): void {
    const snapshot = readArchiveSnapshot(job.archiveSnapshot);
    this.setBannerState({
      jobId: job.jobId,
      archiveId: job.archiveId,
      title: snapshot?.title ?? undefined,
      previewText: snapshot?.previewText ?? undefined,
      provider: job.provider,
      status: job.status,
      progressPercentage: job.progressPercentage,
      progressMessage: job.progressMessage,
      queueDepth: this.queue.length,
      updatedAt: job.updatedAt,
    });
  }

  private applySummaryToBanner(summary: {
    jobId?: string;
    archiveId?: string;
    status?: string;
    progressPercentage?: number;
    progressMessage?: string;
    errorCode?: string;
    errorMessagePublic?: string;
    updatedAt?: string;
  }): void {
    if (!summary.jobId) return;
    const previous = this.bannerState?.jobId === summary.jobId ? this.bannerState : null;
    const status = normalizeBannerStatus(summary.status) ?? previous?.status ?? 'queued';
    this.setBannerState({
      jobId: summary.jobId,
      archiveId: summary.archiveId ?? previous?.archiveId ?? '',
      title: previous?.title,
      previewText: previous?.previewText,
      provider: previous?.provider ?? 'AI',
      status,
      progressPercentage: summary.progressPercentage ?? previous?.progressPercentage,
      progressMessage: summary.progressMessage ?? previous?.progressMessage,
      queueDepth: this.queue.length,
      errorCode: summary.errorCode ?? previous?.errorCode,
      errorMessagePublic: summary.errorMessagePublic ?? previous?.errorMessagePublic,
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

  private setBannerState(state: AICommentJobBannerState | null): void {
    this.bannerState = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  private resultCommentId(job: AICommentExecutorJob): string {
    return `${job.jobId}:${job.provider}:${job.type}`;
  }

  private mapAICommentError(error: AICommentError): AICommentPublicJobErrorCode {
    switch (error.code) {
      case 'CLI_NOT_INSTALLED':
        return 'PROVIDER_MISSING';
      case 'CLI_NOT_AUTHENTICATED':
        return 'PROVIDER_AUTH_REQUIRED';
      case 'CONTENT_EMPTY':
        return 'CONTENT_EMPTY';
      case 'CONTENT_TOO_LONG':
        return 'CONTENT_TOO_LONG';
      case 'TIMEOUT':
        return 'PROCESS_TIMEOUT';
      case 'CANCELLED':
        return 'PROCESS_CANCELLED';
      default:
        return 'UNKNOWN';
    }
  }

  private isRetryableAIError(error: AICommentError): boolean {
    return error.code === 'TIMEOUT';
  }

  private getVaultBasePath(): string | undefined {
    const adapter = this.deps.app.vault.adapter as { basePath?: string };
    return adapter.basePath;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function readArchiveSnapshot(snapshot: unknown): { title?: string | null; previewText?: string | null } | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const archive = (snapshot as { archive?: unknown }).archive;
  if (!archive || typeof archive !== 'object') return null;
  return archive as { title?: string | null; previewText?: string | null };
}

function normalizeBannerStatus(status: string | undefined): AICommentJobBannerState['status'] | null {
  if (
    status === 'queued' ||
    status === 'dispatched' ||
    status === 'claimed' ||
    status === 'preparing' ||
    status === 'running' ||
    status === 'uploading' ||
    status === 'retry_scheduled' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'expired' ||
    status === 'cancel_requested'
  ) {
    return status;
  }
  return null;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
