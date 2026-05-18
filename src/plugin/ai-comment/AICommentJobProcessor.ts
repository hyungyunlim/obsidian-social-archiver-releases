import { TFile, type App } from 'obsidian';
import type {
  AIActionClaimResponse,
  AIActionExecutorJob,
  AIActionJobSummary,
  AIActionLeaseResponse,
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
  createContentHash,
} from '../../types/ai-comment';
import type { AICli } from '../../utils/ai-cli';
import type { SocialArchiverSettings } from '../../types/settings';
import type { LocalAICommentPendingUpload, AICommentPublicJobErrorCode } from '../../types/ai-comment-job';
import { appendAIComment, parseAIComments, updateFrontmatterAIComments } from '../../services/ai-comment/markdown-handler';
import { stripContentVariantMetadataFooter } from '../../utils/contentVariantMarkdown';
import { buildAICommentInputContent } from './AICommentInputContext';
import type { LocalLockRegistry } from '../locks/LocalLockRegistry';

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
  localLockRegistry?: LocalLockRegistry;
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

interface AIActionProcessingContext {
  job: AIActionExecutorJob;
  claim: AIActionClaimResponse;
  lease: ActiveLease;
}

export interface AICommentJobBannerState {
  jobId: string;
  archiveId: string;
  title?: string;
  previewText?: string;
  provider: string;
  actionType?: string;
  resultKind?: string;
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
  private readonly actionQueue: string[] = [];
  private readonly queuedActions = new Set<string>();
  private backlogTimer: number | null = null;
  private processing = false;
  private currentJobId: string | null = null;
  private currentService: AICommentService | null = null;
  private actionProgressChain: Promise<void> = Promise.resolve();
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

  trackAIActionSummary(summary: AIActionJobSummary, provider = 'AI'): void {
    const previous = this.bannerState?.jobId === summary.jobId ? this.bannerState : null;
    this.setBannerState({
      jobId: summary.jobId,
      archiveId: summary.archiveId,
      title: previous?.title,
      previewText: previous?.previewText,
      provider: previous?.provider ?? provider,
      actionType: summary.actionType,
      resultKind: summary.resultKind ?? undefined,
      status: normalizeBannerStatus(summary.status) ?? previous?.status ?? 'queued',
      progressPercentage: summary.progress ?? previous?.progressPercentage,
      progressMessage: summary.progressMessage ?? previous?.progressMessage,
      queueDepth: this.totalQueueDepth(),
      errorCode: summary.errorCode ?? previous?.errorCode,
      errorMessagePublic: summary.errorMessage ?? previous?.errorMessagePublic,
      updatedAt: summary.updatedAt,
    });
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
    try {
      const actionResponse = await apiClient.getAvailableAIActionJobs(clientId);
      for (const job of actionResponse.jobs) {
        this.enqueueAction(job.jobId);
      }
    } catch (error) {
      console.warn('[AICommentJobProcessor] Failed to fetch AI action backlog:', safeError(error));
    }
    this.updateQueueDepth();
    await this.processQueue();
  }

  async handleRequestedJob(jobId: string, targetClientId: string): Promise<void> {
    if (targetClientId !== this.deps.settings().syncClientId) return;
    this.enqueue(jobId);
    await this.processQueue();
  }

  async handleRequestedAIActionJob(jobId: string, targetClientId?: string | null): Promise<void> {
    if (targetClientId && targetClientId !== this.deps.settings().syncClientId) return;
    this.enqueueAction(jobId);
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
    if (!event.jobId) return;
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

  private enqueueAction(jobId: string): void {
    if (this.queuedActions.has(jobId)) return;
    this.queuedActions.add(jobId);
    this.actionQueue.push(jobId);
    this.updateQueueDepth();
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0 || this.actionQueue.length > 0) {
        const jobId = this.queue.shift();
        if (jobId) {
          this.queued.delete(jobId);
          await this.processJobById(jobId);
          continue;
        }
        const actionJobId = this.actionQueue.shift();
        if (!actionJobId) continue;
        this.queuedActions.delete(actionJobId);
        await this.processAIActionJobById(actionJobId);
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
      await this.runClaimedJob(context);
    } finally {
      this.currentJobId = null;
      this.currentService = null;
    }
  }

  private async processAIActionJobById(jobId: string): Promise<void> {
    const apiClient = this.deps.apiClient();
    const clientId = this.deps.settings().syncClientId;
    if (!apiClient || !clientId) return;

    let claim: AIActionClaimResponse;
    try {
      claim = await apiClient.claimAIActionJob(jobId, { clientId });
    } catch (error) {
      console.warn('[AICommentJobProcessor] AI action claim rejected:', safeError(error));
      return;
    }

    const lease: ActiveLease = {
      lockToken: claim.lockToken,
      lockTokenVersion: claim.lockTokenVersion,
      leaseExpiresAt: claim.leaseExpiresAt,
    };
    const context: AIActionProcessingContext = { job: claim.job, claim, lease };

    this.applyAIActionJobToBanner(claim.job);
    this.currentJobId = jobId;
    try {
      await this.runClaimedAIActionJob(context);
    } finally {
      this.currentJobId = null;
      this.currentService = null;
    }
  }

  private async runClaimedAIActionJob(context: AIActionProcessingContext): Promise<void> {
    const apiClient = this.deps.apiClient();
    const clientId = this.deps.settings().syncClientId;
    if (!apiClient || !clientId) return;

    try {
      await this.enqueueActionProgress(context, 'preparing', 10, 'Preparing in Obsidian...');
      const file = await this.ensureArchiveMaterialized(context.job.archiveId);
      if (!file) {
        await this.failAction(context, 'VAULT_FILE_MISSING', true);
        return;
      }

      await this.enqueueActionProgress(context, 'running', 25, 'Running in Obsidian...');
      const content = await this.deps.app.vault.read(file);
      const inputContent = buildAICommentInputContent(content, context.job.archiveSnapshot);
      if (!inputContent.trim()) {
        await this.failAction(context, 'CONTENT_EMPTY', false);
        return;
      }

      if (context.job.actionType === 'tags.suggest_apply') {
        const payload = await this.generateTagsPatch(context, inputContent);
        await this.enqueueActionProgress(context, 'uploading', 90, 'Generated locally. Uploading result...');
        const response = await apiClient.uploadAIActionJobResult(context.job.jobId, {
          clientId,
          lockToken: context.lease.lockToken,
          lockTokenVersion: context.lease.lockTokenVersion,
          result: payload,
        });
        this.applySummaryToBanner(response.job);
        this.deps.refreshTimelineView();
        return;
      }

      if (context.job.actionType === 'content.translate_variant') {
        const payload = await this.generateTranslationVariant(context, inputContent);
        await this.appendContentVariantToMarkdown(file, context.job, payload.variant);
        await this.enqueueActionProgress(context, 'uploading', 90, 'Generated locally. Uploading result...');
        const response = await apiClient.uploadAIActionJobResult(context.job.jobId, {
          clientId,
          lockToken: context.lease.lockToken,
          lockTokenVersion: context.lease.lockTokenVersion,
          result: payload,
        });
        this.applySummaryToBanner(response.job);
        this.deps.refreshTimelineView();
        return;
      }

      await this.failAction(context, 'UNKNOWN', false);
    } catch (error) {
      if (error instanceof AICommentError) {
        if (error.code === 'CANCELLED') {
          await this.failAction(context, 'PROCESS_CANCELLED', false);
          return;
        }
        await this.failAction(context, this.mapAICommentError(error), this.isRetryableAIError(error));
        return;
      }
      console.warn('[AICommentJobProcessor] AI action failed:', safeError(error));
      await this.failAction(context, 'UNKNOWN', false);
    }
  }

  private async generateTagsPatch(
    context: AIActionProcessingContext,
    inputContent: string,
  ): Promise<{ kind: 'tag_patch'; addTags: string[]; removeTags: string[] }> {
    const outputLanguage = describeAIActionOutputLanguage(
      context.job.outputLanguage ?? readActionParamString(context.job.actionParams, 'targetLanguage'),
    );
    const json = await this.generateStructuredJSON(context, inputContent, [
      'Suggest up to 5 concise archive tags for this content.',
      ...(outputLanguage ? [`Write all tag names in ${outputLanguage}.`] : []),
      'Return JSON only, with this exact shape: {"addTags":["tag"],"removeTags":[]}.',
      'Tags should be short noun phrases. Do not include hashtags or commentary.',
    ].join('\n'));
    const rawTags = Array.isArray(json.addTags) ? json.addTags : [];
    const addTags = [...new Set(rawTags
      .filter((tag): tag is string => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter(Boolean))]
      .slice(0, 8);
    return { kind: 'tag_patch', addTags, removeTags: [] };
  }

  private async generateTranslationVariant(
    context: AIActionProcessingContext,
    inputContent: string,
  ): Promise<{
    kind: 'content_variant';
    variant: {
      type: 'translation';
      language: string;
      title?: string;
      contentMarkdown: string;
      contentText?: string;
      sourceContentHash: string;
      provider: string;
      model?: string;
    };
  }> {
    const language = context.job.outputLanguage ?? readActionParamString(context.job.actionParams, 'targetLanguage') ?? 'en';
    const output = await this.generateAIActionText(context, inputContent, [
      `Translate the archive body into ${language}.`,
      'Return the translated article body as Markdown only.',
      'Preserve links, quoted text, lists, and markdown structure when possible.',
      'Do not include YAML frontmatter, metadata footers, commentary, or code fences.',
      'Do not replace the original note.',
    ].join('\n'));
    const json = parseJSONFromAIOutput(output);
    const contentMarkdownFromJson = typeof json?.contentMarkdown === 'string' ? json.contentMarkdown.trim() : '';
    const fallbackMarkdown = stripWrappingCodeFence(output);
    const contentMarkdown = stripContentVariantMetadataFooter(contentMarkdownFromJson || fallbackMarkdown);
    const contentText = typeof json?.contentText === 'string'
      ? stripContentVariantMetadataFooter(json.contentText)
      : stripMarkdown(contentMarkdown);
    if (!contentMarkdown && !contentText) {
      throw new Error('AI action returned an empty translation variant');
    }
    return {
      kind: 'content_variant',
      variant: {
        type: 'translation',
        language,
        ...(typeof json?.title === 'string' && json.title.trim() ? { title: json.title.trim() } : {}),
        contentMarkdown: contentMarkdown || contentText,
        ...(contentText ? { contentText } : {}),
        sourceContentHash: context.job.sourceContentHash ?? context.job.archiveContentHash ?? createContentHash(inputContent),
        provider: context.job.provider,
        ...(context.job.model ? { model: context.job.model } : {}),
      },
    };
  }

  private async generateStructuredJSON(
    context: AIActionProcessingContext,
    inputContent: string,
    instruction: string,
  ): Promise<Record<string, unknown>> {
    const output = await this.generateAIActionText(context, inputContent, instruction);
    const parsed = parseJSONFromAIOutput(output);
    if (!parsed) throw new Error('AI action returned invalid JSON');
    return parsed;
  }

  private async generateAIActionText(
    context: AIActionProcessingContext,
    inputContent: string,
    instruction: string,
  ): Promise<string> {
    const service = new AICommentService();
    this.currentService = service;
    const result = await service.generateComment(inputContent, {
      cli: context.job.provider as AICli,
      model: context.job.model ?? undefined,
      type: 'custom',
      outputLanguage: (context.job.outputLanguage ?? 'auto') as AIOutputLanguage,
      customPrompt: instruction,
      timeoutMs: context.job.actionType === 'content.translate_variant' ? 10 * 60 * 1000 : undefined,
      onProgress: (progress) => {
        void this.handleLocalActionProgress(context, progress);
      },
    });
    return result.content.trim();
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
        const pendingUpload = this.deps.settings().aiCommentPendingUploads[context.job.jobId];
        if (!pendingUpload) throw new Error('AI comment pending upload was not persisted');
        await this.uploadPending(context, pendingUpload);
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
      const pendingUpload = this.deps.settings().aiCommentPendingUploads[context.job.jobId];
      if (!pendingUpload) throw new Error('AI comment pending upload was not persisted');
      await this.uploadPending(context, pendingUpload);
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

    file = await this.findArchiveFileByFrontmatter(archiveId);
    if (file) return file;

    const result = await this.deps.ingestRemoteArchive(archiveId, 'ai_comment_job');
    if (result === 'skipped') return null;

    await wait(600);
    file = this.deps.archiveLookupService()?.findBySourceArchiveId(archiveId) ?? null;
    if (file) return file;

    return this.findArchiveFileByFrontmatter(archiveId);
  }

  private async waitForArchiveLibrarySync(): Promise<void> {
    const started = Date.now();
    while (this.deps.isArchiveLibrarySyncRunning() && Date.now() - started < 120_000) {
      await wait(1000);
    }
  }

  private async findArchiveFileByFrontmatter(archiveId: string): Promise<TFile | null> {
    const files = this.deps.app.vault.getMarkdownFiles();
    for (const file of files) {
      const frontmatter = this.deps.app.metadataCache.getFileCache(file)?.frontmatter;
      if (frontmatterMatchesArchiveId(frontmatter, archiveId)) return file;
    }

    for (const file of files) {
      try {
        const content = await this.deps.app.vault.read(file);
        const frontmatter = readFrontmatterFields(content, ['sourceArchiveId', 'archiveId']);
        if (frontmatterMatchesArchiveId(frontmatter, archiveId)) return file;
      } catch {
        // Keep scanning. A single unreadable file should not block job recovery.
      }
    }
    return null;
  }

  private async appendResultToMarkdown(file: TFile, meta: AICommentMeta, content: string): Promise<void> {
    await this.withMarkdownWriteLock(file, async () => {
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
    });
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

  private async progressAction(
    context: AIActionProcessingContext,
    status: AICommentJobStatus,
    progressPercentage: number,
    progressMessage: string,
  ): Promise<void> {
    const apiClient = this.deps.apiClient();
    const clientId = this.deps.settings().syncClientId;
    if (!apiClient || !clientId) return;

    const response: AIActionLeaseResponse = await apiClient.updateAIActionJobProgress(context.job.jobId, {
      clientId,
      lockToken: context.lease.lockToken,
      lockTokenVersion: context.lease.lockTokenVersion,
      status,
      progress: progressPercentage,
      progressPercentage,
      progressMessage,
    });
    context.lease.lockToken = response.lockToken;
    context.lease.lockTokenVersion = response.lockTokenVersion;
    context.lease.leaseExpiresAt = response.leaseExpiresAt;
    context.job.status = status;
    context.job.progress = progressPercentage;
    context.job.progressPercentage = progressPercentage;
    context.job.progressMessage = progressMessage;
    this.applySummaryToBanner({
      jobId: context.job.jobId,
      archiveId: context.job.archiveId,
      status,
      progressPercentage,
      progressMessage,
      updatedAt: response.job.updatedAt,
    });
  }

  private enqueueActionProgress(
    context: AIActionProcessingContext,
    status: AICommentJobStatus,
    progressPercentage: number,
    progressMessage: string,
  ): Promise<void> {
    const task = this.actionProgressChain.then(() =>
      this.progressAction(context, status, progressPercentage, progressMessage),
    );
    this.actionProgressChain = task.catch(() => undefined);
    return task;
  }

  private async drainActionProgressQueue(): Promise<void> {
    await this.actionProgressChain.catch(() => undefined);
  }

  private async handleLocalActionProgress(context: AIActionProcessingContext, progress: AICommentProgress): Promise<void> {
    const percentage = Math.max(25, Math.min(85, progress.percentage));
    await this.enqueueActionProgress(context, 'running', percentage, 'Running in Obsidian...').catch((error) => {
      console.warn('[AICommentJobProcessor] AI action progress update failed:', safeError(error));
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

  private async failAction(context: AIActionProcessingContext, errorCode: string, retryable: boolean): Promise<void> {
    const apiClient = this.deps.apiClient();
    const clientId = this.deps.settings().syncClientId;
    if (!apiClient || !clientId) return;
    await this.drainActionProgressQueue();
    await apiClient
      .failAIActionJob(context.job.jobId, {
        clientId,
        lockToken: context.lease.lockToken,
        lockTokenVersion: context.lease.lockTokenVersion,
        errorCode,
        retryable,
      })
      .catch((error) => {
        console.warn('[AICommentJobProcessor] Failed to report AI action failure:', safeError(error));
      });
  }

  private async appendContentVariantToMarkdown(
    file: TFile,
    job: AIActionExecutorJob,
    variant: {
      language: string;
      title?: string;
      contentMarkdown: string;
      sourceContentHash: string;
      provider: string;
      model?: string;
    },
  ): Promise<void> {
    const marker = `social-archiver-ai-content-variant:${job.jobId}`;
    const generatedAt = new Date().toISOString();
    const header = '## AI Content Variants';
    const block = [
      `<!-- ${marker} -->`,
      `### Translation (${variant.language})`,
      '',
      `- Provider: ${providerLabelForMarkdown(variant.provider)}`,
      ...(variant.model ? [`- Model: ${variant.model}`] : []),
      `- Generated: ${generatedAt}`,
      `- Source content hash: ${variant.sourceContentHash}`,
      '',
      ...(variant.title ? [`#### ${variant.title}`, ''] : []),
      variant.contentMarkdown.trim(),
      `<!-- /${marker} -->`,
    ].join('\n');

    await this.withMarkdownWriteLock(file, async () => {
      await this.deps.app.vault.process(file, (existingContent) => {
        if (existingContent.includes(`<!-- ${marker} -->`)) return existingContent;
        if (existingContent.includes(header)) {
          return `${existingContent.trimEnd()}\n\n${block}\n`;
        }
        return `${existingContent.trimEnd()}\n\n${header}\n\n${block}\n`;
      });
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

  private async withMarkdownWriteLock<T>(file: TFile, fn: () => Promise<T>): Promise<T> {
    const registry = this.deps.localLockRegistry;
    if (!registry) return fn();
    return registry.withLock({ kind: 'markdownWrite', archiveId: this.resolveArchiveIdForFile(file) }, fn);
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
      queueDepth: this.totalQueueDepth(),
      updatedAt: job.updatedAt,
    });
  }

  private applyAIActionJobToBanner(job: AIActionExecutorJob): void {
    const snapshot = readArchiveSnapshot(job.archiveSnapshot);
    this.setBannerState({
      jobId: job.jobId,
      archiveId: job.archiveId,
      title: snapshot?.title ?? undefined,
      previewText: snapshot?.previewText ?? undefined,
      provider: job.provider,
      actionType: job.actionType,
      resultKind: job.resultKind ?? undefined,
      status: normalizeBannerStatus(job.status) ?? 'queued',
      progressPercentage: job.progressPercentage ?? job.progress,
      progressMessage: job.progressMessage ?? undefined,
      queueDepth: this.totalQueueDepth(),
      updatedAt: job.updatedAt,
    });
  }

  private applySummaryToBanner(summary: {
    jobId?: string;
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
      actionType: summary.actionType ?? previous?.actionType,
      resultKind: summary.resultKind ?? previous?.resultKind,
      status,
      progressPercentage: summary.progressPercentage ?? summary.progress ?? previous?.progressPercentage,
      progressMessage: summary.progressMessage ?? previous?.progressMessage,
      queueDepth: this.totalQueueDepth(),
      errorCode: summary.errorCode ?? previous?.errorCode,
      errorMessagePublic: summary.errorMessagePublic ?? previous?.errorMessagePublic,
      updatedAt: summary.updatedAt ?? new Date().toISOString(),
    });
  }

  private updateQueueDepth(): void {
    if (!this.bannerState) return;
    this.setBannerState({
      ...this.bannerState,
      queueDepth: this.totalQueueDepth(),
    });
  }

  private totalQueueDepth(): number {
    return this.queue.length + this.actionQueue.length;
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

function readActionParamString(params: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = params?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function describeAIActionOutputLanguage(language: string | null | undefined): string | null {
  const primary = language?.trim().toLowerCase().split(/[-_]/)[0];
  if (primary === 'ko') return 'Korean';
  if (primary === 'ja') return 'Japanese';
  if (primary === 'en') return 'English';
  if (primary === 'zh') return 'Chinese';
  if (primary === 'es') return 'Spanish';
  if (primary === 'fr') return 'French';
  if (primary === 'de') return 'German';
  if (primary === 'pt') return 'Portuguese';
  if (primary === 'it') return 'Italian';
  if (primary === 'vi') return 'Vietnamese';
  if (primary === 'th') return 'Thai';
  if (primary === 'id') return 'Indonesian';
  return null;
}

function frontmatterMatchesArchiveId(frontmatter: unknown, archiveId: string): boolean {
  if (!frontmatter || typeof frontmatter !== 'object') return false;
  const record = frontmatter as Record<string, unknown>;
  return record.sourceArchiveId === archiveId || record.archiveId === archiveId;
}

function readFrontmatterFields(markdown: string, keys: string[]): Record<string, string> | null {
  if (!markdown.startsWith('---')) return null;
  const end = markdown.indexOf('\n---', 3);
  if (end === -1) return null;
  const frontmatter = markdown.slice(3, end).split(/\r?\n/);
  const result: Record<string, string> = {};
  const keyPattern = keys.map(escapeRegExp).join('|');
  const linePattern = new RegExp(`^(${keyPattern})\\s*:\\s*(.+?)\\s*$`);
  for (const line of frontmatter) {
    const match = line.match(linePattern);
    const key = match?.[1];
    const value = match?.[2];
    if (!key || value === undefined) continue;
    result[key] = unquoteYamlScalar(value);
  }
  return result;
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseJSONFromAIOutput(output: string): Record<string, unknown> | null {
  const trimmed = output.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [
    fenced?.[1],
    trimmed,
    trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1),
  ].filter((candidate): candidate is string => Boolean(candidate && candidate.trim()));
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function stripWrappingCodeFence(output: string): string {
  const trimmed = output.trim();
  const fenced = trimmed.match(/^```(?:markdown|md|text)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[`*_>#-]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function providerLabelForMarkdown(provider: string): string {
  if (provider === 'claude') return 'Claude';
  if (provider === 'codex') return 'Codex';
  if (provider === 'gemini') return 'Gemini';
  return provider;
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
