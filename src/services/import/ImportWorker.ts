/**
 * ImportWorker — the upload orchestrator for an import job.
 *
 * State machine per item (PRD §6.3, §9.5):
 *
 *   pending → uploading → uploaded
 *                       → imported_with_warnings
 *                       → skipped_duplicate
 *                       → failed
 *
 * Loop behavior:
 *   - Token-bucket rate limiter (items/sec, user-adjustable).
 *   - For each pending item:
 *       1. Read the `clientPostData` (already parsed at pre-flight).
 *       2. POST /api/archive with clientPostData + importContext.
 *       3. Stream media files from the source ZIP, batched by count + byte cap.
 *       4. POST /api/archive/:archiveId/media for each batch.
 *       5. If `onArchiveCreated` is wired, invoke it (vault note creation).
 *          A vault failure downgrades the outcome to `imported_with_warnings`
 *          but NEVER fails the upload job (PRD §5.3.1).
 *       6. Flip the item's outcome, persist job state, emit events.
 *   - Pause: stop launching new uploads; in-flight item completes.
 *   - Resume: continue from the first pending-or-failed-with-retries-left item.
 *   - Cancel: hard-stop; the active item may still complete but no new ones start.
 *   - On job complete: POST /api/import/jobs/:jobId/finalize with archiveIds.
 *
 * Retry policy (PRD §6.2):
 *   - Per-item: up to MAX_ITEM_RETRIES with exponential backoff
 *     (250ms * 2^n, capped at 5s + jitter). After that the item is failed;
 *     the job keeps running (partial-failure policy, PRD §6.3).
 *
 * The worker is intentionally standalone — it accepts dependencies via
 * {@link ImportWorkerDeps} so it can be tested against fakes.
 */

import type { Vault } from 'obsidian';
import type { PostData } from '@/types/post';
import type {
  ImportAPIClient,
  ImportItem,
  ImportItemOutcome,
  ImportJobState,
  ImportLogger,
} from '@/types/import';
import {
  MAX_ITEM_RETRIES,
  MEDIA_UPLOAD_BATCH_BYTE_CAP,
  MEDIA_UPLOAD_BATCH_SIZE,
} from '@/types/import';
import type { ImportJobStore } from './ImportJobStore';
import type { ImportZipReader } from './ImportZipReader';
import type { ImportProgressBus } from './ImportProgressBus';

/**
 * Hook signature the plugin uses to materialize an imported archive as a
 * vault note. Agent F wires the real implementation from `main.ts`.
 *
 * A throw flips the item's outcome to `imported_with_warnings`. The upload
 * itself is already committed server-side, so we never undo it.
 */
export type OnArchiveCreatedHook = (
  archiveId: string,
  postData: PostData,
) => Promise<void> | void;

/**
 * Resolver that maps a ZIP filename (as recorded in ImportJobSourceFile /
 * ImportItem.partFilename) to an already-constructed ImportZipReader.
 *
 * The worker does NOT keep Blobs around forever — the caller (the
 * orchestrator) holds them for the lifetime of the job and provides this
 * resolver so the worker can read on demand.
 */
export type ImportZipReaderResolver = (partFilename: string) => ImportZipReader | undefined;

/**
 * Resolver that maps a post ID to its parsed PostData.
 *
 * Parsing happens once at pre-flight and is kept in memory; if the job
 * outlasts the session (Obsidian restart), the caller may re-parse from
 * the ZIP and rebuild this resolver. If a post's data is unavailable,
 * return `undefined` and the item will be marked failed.
 */
export type PostDataResolver = (postId: string) => PostData | undefined;

export interface ImportWorkerDeps {
  apiClient: ImportAPIClient;
  jobStore: ImportJobStore;
  progressBus: ImportProgressBus;
  logger: ImportLogger;
  /** Gives the worker access to the ZIP for media streaming. */
  zipReaderFor: ImportZipReaderResolver;
  /** Resolves PostData from posts.jsonl. */
  postDataFor: PostDataResolver;
  /** Vault-side integration hook (optional). */
  onArchiveCreated?: OnArchiveCreatedHook;
  /**
   * Vault handle for writing imported media bytes into the user's
   * attachments folder. When omitted, the worker skips vault writes (the
   * server R2 upload still happens). This is optional so unit tests can
   * run without an Obsidian runtime.
   */
  vault?: Vault;
  /**
   * Base folder for vault media writes. Defaults to
   * `attachments/social-archives`, matching the plugin's `mediaPath`
   * setting default and MediaPathGenerator.
   */
  mediaBasePath?: string;
}

type ControlFlag = { paused: boolean; cancelled: boolean };

/**
 * Sleep helper. Uses globalThis.setTimeout so it works under Node/Vitest
 * and inside Obsidian's renderer.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Strip characters Obsidian's file system layer can't handle and cap
 * segment length. Keeps the original casing so author folder names look
 * right in the file explorer.
 */
function sanitizePathSegment(segment: string): string {
  const cleaned = segment
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 128) : 'unknown';
}

/**
 * Rewrite every local-path reference in a PostData to its vault-relative
 * path after import media has been written to the vault attachments folder.
 *
 * Replaces (in order):
 *   1. `postData.media[].url`       — primary image/video
 *   2. `postData.media[].thumbnail` — video poster frames
 *   3. `postData.author.avatar` + sets `postData.author.localAvatar`
 *      (FrontmatterGenerator prefers `localAvatar` and wraps it in a
 *      wikilink, which is how the non-import flow stores avatars.)
 *
 * `vaultPathByRel` keys match both the ZIP-relative path
 * (`media/{shortcode}/xxx.jpg`) and its leading-`./` variant.
 */
function rewritePostDataUrlsToVaultPaths(
  postData: PostData,
  vaultPathByRel: Map<string, string>,
): void {
  const resolve = (raw: string | undefined): string | null => {
    if (typeof raw !== 'string' || !raw) return null;
    if (/^https?:\/\//i.test(raw)) return null;
    const normalized = raw.replace(/^\.\//, '');
    return vaultPathByRel.get(normalized) ?? vaultPathByRel.get(raw) ?? null;
  };

  if (Array.isArray(postData.media)) {
    for (const m of postData.media) {
      const url = resolve(m.url);
      if (url) m.url = url;
      if (typeof m.thumbnail === 'string') {
        const thumb = resolve(m.thumbnail);
        if (thumb) m.thumbnail = thumb;
      }
    }
  }

  if (postData.author) {
    const avatar = resolve(postData.author.avatar);
    if (avatar) {
      postData.author.avatar = avatar;
      // FrontmatterGenerator wraps `localAvatar` in `[[...]]`; set it so
      // imported notes match the non-import archive convention.
      postData.author.localAvatar = avatar;
    }
  }
}

/**
 * Apply the job-wide import destination + extra tags to a single PostData
 * before it is shipped to the server and the vault note hook.
 *
 * Idempotent — safe to call multiple times (tags are de-duplicated case-
 * insensitively while preserving the first-seen casing).
 */
function applyImportOverridesToPostData(
  postData: PostData,
  job: ImportJobState | null,
): void {
  if (!job) return;

  // Destination → frontmatter `archive` flag.
  postData.archive = job.destination === 'archive';

  // Extra tags: merge with any already-present tags from the export payload.
  if (Array.isArray(job.tags) && job.tags.length > 0) {
    const existing = Array.isArray(postData.tags) ? postData.tags : [];
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const token of [...existing, ...job.tags]) {
      if (typeof token !== 'string') continue;
      const trimmed = token.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(trimmed);
    }
    postData.tags = merged;
  }
}

/** Exponential backoff with jitter, capped at 5s. */
function backoffMs(attempt: number): number {
  const base = Math.min(5000, 250 * Math.pow(2, attempt));
  const jitter = Math.floor(Math.random() * 125);
  return base + jitter;
}

/**
 * Pick a content type for media files we upload. Instagram export uses
 * these canonical extensions (see chrome-extension zip-packager).
 */
function contentTypeFor(relativePath: string): string {
  const ext = relativePath.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'webm':
      return 'video/webm';
    case 'm4a':
      return 'audio/mp4';
    case 'mp3':
      return 'audio/mpeg';
    default:
      return 'application/octet-stream';
  }
}

/**
 * ImportWorker is bound to one job id. Create a fresh instance per job.
 */
export class ImportWorker {
  private readonly control: ControlFlag = { paused: false, cancelled: false };
  private inFlight = false;
  private finishedPromise: Promise<void> | null = null;

  constructor(
    public readonly jobId: string,
    private readonly deps: ImportWorkerDeps,
  ) {}

  // ---------------------------------------------------------------------------
  // Public control surface
  // ---------------------------------------------------------------------------

  /** Start (or restart after pause) the upload loop. Idempotent. */
  start(): Promise<void> {
    if (this.finishedPromise) return this.finishedPromise;
    this.control.paused = false;
    this.control.cancelled = false;
    this.finishedPromise = this.runLoop().finally(() => {
      this.finishedPromise = null;
    });
    return this.finishedPromise;
  }

  /**
   * Pause the loop. The currently in-flight item is allowed to complete;
   * no new items are dispatched.
   */
  async pause(): Promise<void> {
    this.control.paused = true;
    const job = this.deps.jobStore.getJob(this.jobId);
    if (job && (job.status === 'running' || job.status === 'queued')) {
      this.deps.jobStore.updateJob({ ...job, status: 'paused' });
      this.deps.progressBus.emit({ type: 'job.paused', jobId: this.jobId });
    }
  }

  /**
   * Resume the loop from the first pending/retriable item.
   *
   * Resolves when the resumed loop finishes (completed / cancelled / paused
   * again) so callers can deterministically await completion in tests.
   */
  async resume(): Promise<void> {
    const job = this.deps.jobStore.getJob(this.jobId);
    if (!job) return;
    this.control.paused = false;
    if (job.status === 'paused') {
      this.deps.jobStore.updateJob({ ...job, status: 'running' });
      this.deps.progressBus.emit({ type: 'job.resumed', jobId: this.jobId });
    }
    // If the loop has exited (e.g., after pause drained), re-enter.
    if (!this.finishedPromise) {
      this.finishedPromise = this.runLoop().finally(() => {
        this.finishedPromise = null;
      });
    }
    await this.finishedPromise;
  }

  /** Cancel the loop. In-flight item may still commit, but no new ones start. */
  async cancel(): Promise<void> {
    this.control.cancelled = true;
    const job = this.deps.jobStore.getJob(this.jobId);
    if (job && job.status !== 'cancelled' && job.status !== 'completed' && job.status !== 'failed') {
      this.deps.jobStore.updateJob({ ...job, status: 'cancelled', completedAt: Date.now() });
      this.deps.progressBus.emit({ type: 'job.cancelled', jobId: this.jobId });
    }
  }

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------

  private async runLoop(): Promise<void> {
    const { jobStore, progressBus, logger, apiClient } = this.deps;

    let job = jobStore.getJob(this.jobId);
    if (!job) {
      logger.warn(`[ImportWorker] no job record for ${this.jobId}`);
      return;
    }

    // Idempotent: already finished? nothing to do.
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return;
    }

    if (job.status === 'queued' || job.status === 'paused') {
      job = { ...job, status: 'running', startedAt: job.startedAt ?? Date.now() };
      jobStore.updateJob(job);
    }

    progressBus.emit({ type: 'job.started', jobId: this.jobId });

    try {
      while (!this.control.cancelled) {
        if (this.control.paused) break;
        const items = jobStore.getItems(this.jobId);
        const nextIndex = items.findIndex((it) =>
          it.status === 'pending' ||
          (it.status === 'failed' && it.retryCount < MAX_ITEM_RETRIES),
        );
        if (nextIndex < 0) break;

        // Rate limit: compute per-item budget from job's current rateLimitPerSec.
        const currentJob = jobStore.getJob(this.jobId);
        const rate = Math.max(0.1, Math.min(10, currentJob?.rateLimitPerSec ?? 1));
        const budgetMs = Math.max(50, Math.floor(1000 / rate));
        const startedAt = Date.now();

        await this.processItem(nextIndex);

        const elapsed = Date.now() - startedAt;
        if (elapsed < budgetMs) {
          await delay(budgetMs - elapsed);
        }
      }

      // Loop exited — figure out why.
      const finalItems = jobStore.getItems(this.jobId);
      const anyPending = finalItems.some(
        (it) =>
          it.status === 'pending' ||
          (it.status === 'failed' && it.retryCount < MAX_ITEM_RETRIES),
      );

      if (this.control.cancelled || this.control.paused) {
        // Either cancel or pause — state is already persisted by pause()/cancel().
        return;
      }

      if (anyPending) {
        // Should not happen unless the loop was externally interrupted; keep running state.
        return;
      }

      // All items are terminal → finalize the job.
      await this.finalizeJob();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[ImportWorker] fatal error for ${this.jobId}`, err);
      const current = jobStore.getJob(this.jobId);
      if (current && current.status !== 'cancelled') {
        jobStore.updateJob({
          ...current,
          status: 'failed',
          completedAt: Date.now(),
          lastError: message,
        });
      }
      progressBus.emit({ type: 'job.failed', jobId: this.jobId, error: message });
      try {
        // Best-effort finalize so the server isn't left waiting forever.
        await apiClient.finalizeImportJob({
          jobId: this.jobId,
          archiveIds: [],
          totalCount: current?.totalItems ?? 0,
          partialMediaCount: current?.partialMediaItems ?? 0,
          failedCount: current?.failedItems ?? 0,
          sourceClientId: current?.sourceClientId,
        });
      } catch {
        // swallow
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Per-item pipeline
  // ---------------------------------------------------------------------------

  private async processItem(index: number): Promise<void> {
    const { jobStore, progressBus, logger, apiClient, postDataFor, zipReaderFor, onArchiveCreated } =
      this.deps;
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const items = [...jobStore.getItems(this.jobId)];
      const item = items[index];
      if (!item) return;

      const postData = postDataFor(item.postId);
      if (!postData) {
        items[index] = {
          ...item,
          status: 'failed',
          retryCount: item.retryCount + 1,
          errorMessage: 'post data not available (ZIP missing or closed)',
        };
        jobStore.updateItems(this.jobId, items);
        this.emitItemProgress(items[index]);
        this.updateJobCounters();
        return;
      }

      items[index] = { ...item, status: 'uploading' };
      jobStore.updateItems(this.jobId, items);
      this.emitItemProgress(items[index]);

      const job = jobStore.getJob(this.jobId);
      const sourceFile = job?.sourceFiles.find((f) => f.partNumber && f.filename === item.partFilename);
      const exportId = sourceFile?.exportId ?? '';
      const partNumber = sourceFile?.partNumber ?? 0;

      // Apply the job-wide destination + extra tags onto the PostData once.
      // The same object is passed to the archive API (server persists the
      // `archive` flag + tags) and later to `onArchiveCreated` (vault note
      // frontmatter), so mutating in place gives both paths consistent values.
      applyImportOverridesToPostData(postData, job);

      let outcome: ImportItemOutcome = 'uploaded';
      let archiveId: string | undefined;
      let lastError: string | undefined;

      try {
        // --- Step 1: create the archive from clientPostData. ---
        const archiveResp = await this.withRetry(
          () =>
            apiClient.createArchiveFromImport({
              url: postData.url,
              clientPostData: postData,
              importContext: {
                source: 'instagram-saved-import',
                jobId: this.jobId,
                exportId,
                partNumber,
              },
              sourceClientId: job?.sourceClientId,
            }),
          item.retryCount,
          `archive ${item.postId}`,
        );
        archiveId = archiveResp.archiveId;

        if (archiveResp.skippedDuplicate) {
          outcome = 'skipped_duplicate';
        } else {
          // --- Step 2: stream media from the ZIP, upload to R2, and write
          //            the same bytes into the user's vault attachments. ---
          const mediaPaths = item.mediaPaths ?? [];
          const { failures: mediaFailures, vaultPathByRel } = await this.uploadMediaBatches(
            archiveId,
            mediaPaths,
            item.partFilename,
            postData,
          );
          if (mediaFailures.length > 0) {
            outcome = 'imported_with_warnings';
          }

          // Rewrite the in-memory PostData so the vault-note hook renders
          // vault-relative paths (working links) instead of the raw
          // ZIP-relative `./media/...` strings. Best-effort — an empty
          // map (vault writes skipped / all failed) leaves URLs untouched.
          if (vaultPathByRel.size > 0) {
            rewritePostDataUrlsToVaultPaths(postData, vaultPathByRel);
          }

          // --- Step 3: vault note hook. ---
          if (onArchiveCreated) {
            try {
              await onArchiveCreated(archiveId, postData);
            } catch (hookErr) {
              logger.warn(
                `[ImportWorker] vault note hook failed for ${archiveId}`,
                hookErr,
              );
              outcome = 'imported_with_warnings';
            }
          }
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        outcome = 'failed';
        logger.error(`[ImportWorker] item ${item.postId} failed`, err);
      }

      // Persist item outcome.
      const current = jobStore.getItems(this.jobId)[index]!;
      const finalItem: ImportItem = {
        ...current,
        status: outcome,
        retryCount:
          outcome === 'failed' ? current.retryCount + 1 : current.retryCount,
        archiveId: archiveId ?? current.archiveId,
        uploadedAt:
          outcome === 'uploaded' || outcome === 'imported_with_warnings' || outcome === 'skipped_duplicate'
            ? Date.now()
            : current.uploadedAt,
        errorMessage: outcome === 'failed' ? lastError : current.errorMessage,
      };
      const nextItems = [...jobStore.getItems(this.jobId)];
      nextItems[index] = finalItem;
      jobStore.updateItems(this.jobId, nextItems);
      this.emitItemProgress(finalItem);
      this.updateJobCounters();

      // Unused variable safeguard — logger available for future extension.
      void zipReaderFor;
    } finally {
      this.inFlight = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Media upload
  // ---------------------------------------------------------------------------

  private async uploadMediaBatches(
    archiveId: string,
    mediaPaths: string[],
    partFilename: string,
    postData: PostData,
  ): Promise<{
    failures: Array<{ relativePath: string; reason: string }>;
    vaultPathByRel: Map<string, string>;
  }> {
    const vaultPathByRel = new Map<string, string>();
    if (mediaPaths.length === 0) return { failures: [], vaultPathByRel };
    const reader = this.deps.zipReaderFor(partFilename);
    if (!reader) {
      return {
        failures: mediaPaths.map((p) => ({ relativePath: p, reason: 'zip not available' })),
        vaultPathByRel,
      };
    }

    const failures: Array<{ relativePath: string; reason: string }> = [];
    let batch: Array<{
      filename: string;
      relativePath: string;
      contentType: string;
      data: ArrayBuffer;
    }> = [];
    let batchBytes = 0;

    const flushBatch = async () => {
      if (batch.length === 0) return;
      try {
        const resp = await this.deps.apiClient.uploadArchiveMedia({
          archiveId,
          files: batch,
        });
        for (const f of resp.failed) failures.push(f);
      } catch (err) {
        for (const item of batch) {
          failures.push({
            relativePath: item.relativePath,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
      batch = [];
      batchBytes = 0;
    };

    // Resolve a shortcode-ish folder segment per post for vault writes.
    // Prefer the explicit shortcode (already extracted at scan time);
    // fall back to the numeric post id so the path is always populated.
    const folderSegment =
      typeof (postData.raw as { code?: string } | undefined)?.code === 'string'
        ? (postData.raw as { code?: string }).code!
        : postData.id;
    const platform = postData.platform ?? 'instagram';

    for (const rel of mediaPaths) {
      const data = await reader.extractMediaFile(rel);
      if (!data) {
        failures.push({ relativePath: rel, reason: 'missing from ZIP' });
        continue;
      }
      const filename = rel.split('/').pop() ?? rel;

      // Vault write FIRST (cheap, already in memory). Failures are non-fatal
      // — the server upload still runs and the item proceeds, but the
      // user's local vault note will fall back to the (broken) ZIP-relative
      // path. We surface the failure as a warning, not a hard failure.
      if (this.deps.vault) {
        try {
          const vaultPath = await this.writeMediaToVault(
            platform,
            folderSegment,
            filename,
            data,
          );
          vaultPathByRel.set(rel, vaultPath);
        } catch (err) {
          this.deps.logger.warn(
            `[ImportWorker] vault write failed for ${rel}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      const entry = {
        filename,
        relativePath: rel,
        contentType: contentTypeFor(rel),
        data,
      };
      if (
        batch.length >= MEDIA_UPLOAD_BATCH_SIZE ||
        batchBytes + data.byteLength > MEDIA_UPLOAD_BATCH_BYTE_CAP
      ) {
        await flushBatch();
      }
      batch.push(entry);
      batchBytes += data.byteLength;
    }
    await flushBatch();
    return { failures, vaultPathByRel };
  }

  /**
   * Write a single media file into the vault at
   *   `{mediaBasePath}/{platform}/{folderSegment}/{filename}`
   *
   * Ensures the parent folder exists (Obsidian's `adapter.writeBinary`
   * does not mkdir-p) and overwrites any existing file — matching the
   * MediaHandler convention used by the non-import flow.
   */
  private async writeMediaToVault(
    platform: string,
    folderSegment: string,
    filename: string,
    data: ArrayBuffer,
  ): Promise<string> {
    const vault = this.deps.vault!;
    const base = (this.deps.mediaBasePath ?? 'attachments/social-archives').replace(/\/+$/, '');
    const safeSegment = sanitizePathSegment(folderSegment);
    const safePlatform = sanitizePathSegment(platform);
    const safeFilename = sanitizePathSegment(filename);
    const path = `${base}/${safePlatform}/${safeSegment}/${safeFilename}`;

    const lastSlash = path.lastIndexOf('/');
    if (lastSlash > 0) {
      const folder = path.substring(0, lastSlash);
      const exists = await vault.adapter.exists(folder);
      if (!exists) {
        try {
          await vault.createFolder(folder);
        } catch {
          // Another import item may have just created it — ignore.
        }
      }
    }
    await vault.adapter.writeBinary(path, data);
    return path;
  }

  // ---------------------------------------------------------------------------
  // Retry wrapper
  // ---------------------------------------------------------------------------

  private async withRetry<T>(
    fn: () => Promise<T>,
    alreadyAttempted: number,
    label: string,
  ): Promise<T> {
    let attempt = alreadyAttempted;
    let lastErr: unknown;
    for (; attempt <= MAX_ITEM_RETRIES; attempt++) {
      if (this.control.cancelled) {
        throw new Error('cancelled');
      }
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (attempt >= MAX_ITEM_RETRIES) break;
        const wait = backoffMs(attempt);
        this.deps.logger.warn(
          `[ImportWorker] ${label} attempt ${attempt + 1} failed — retrying in ${wait}ms`,
          err,
        );
        await delay(wait);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  // ---------------------------------------------------------------------------
  // Finalize
  // ---------------------------------------------------------------------------

  private async finalizeJob(): Promise<void> {
    const { jobStore, progressBus, apiClient, logger } = this.deps;
    const job = jobStore.getJob(this.jobId);
    if (!job) return;
    const items = jobStore.getItems(this.jobId);
    const archiveIds = items
      .map((it) => it.archiveId)
      .filter((id): id is string => Boolean(id));

    const imported = items.filter((it) => it.status === 'uploaded').length;
    const importedWithWarnings = items.filter((it) => it.status === 'imported_with_warnings').length;
    const skippedDuplicates = items.filter((it) => it.status === 'skipped_duplicate').length;
    const failed = items.filter((it) => it.status === 'failed').length;

    const updated: ImportJobState = {
      ...job,
      status: 'completed',
      completedAt: Date.now(),
      completedItems: imported + importedWithWarnings,
      partialMediaItems: importedWithWarnings,
      skippedDuplicates,
      failedItems: failed,
    };
    jobStore.updateJob(updated);

    try {
      await apiClient.finalizeImportJob({
        jobId: this.jobId,
        archiveIds,
        totalCount: items.length,
        partialMediaCount: importedWithWarnings,
        failedCount: failed,
        sourceClientId: job.sourceClientId,
      });
    } catch (err) {
      logger.warn(`[ImportWorker] finalize call failed (archives were still created)`, err);
    }

    progressBus.emit({
      type: 'job.completed',
      jobId: this.jobId,
      summary: { imported, importedWithWarnings, skippedDuplicates, failed },
    });
  }

  // ---------------------------------------------------------------------------
  // Event helpers
  // ---------------------------------------------------------------------------

  private emitItemProgress(item: ImportItem): void {
    this.deps.progressBus.emit({
      type: 'item.progress',
      jobId: this.jobId,
      postId: item.postId,
      status: item.status,
      archiveId: item.archiveId,
      errorMessage: item.errorMessage,
    });
  }

  private updateJobCounters(): void {
    const { jobStore, progressBus } = this.deps;
    const job = jobStore.getJob(this.jobId);
    if (!job) return;
    const items = jobStore.getItems(this.jobId);
    const completed = items.filter(
      (it) =>
        it.status === 'uploaded' ||
        it.status === 'imported_with_warnings' ||
        it.status === 'skipped_duplicate',
    ).length;
    const partialMedia = items.filter((it) => it.status === 'imported_with_warnings').length;
    const skipped = items.filter((it) => it.status === 'skipped_duplicate').length;
    const failed = items.filter(
      (it) => it.status === 'failed' && it.retryCount >= MAX_ITEM_RETRIES,
    ).length;

    jobStore.updateJob({
      ...job,
      completedItems: completed,
      partialMediaItems: partialMedia,
      skippedDuplicates: skipped,
      failedItems: failed,
    });

    progressBus.emit({
      type: 'job.progress',
      jobId: this.jobId,
      completedItems: completed,
      totalItems: items.length,
      partialMediaItems: partialMedia,
      skippedDuplicates: skipped,
      failedItems: failed,
    });
  }
}
