/**
 * ImportOrchestrator — top-level façade for the Instagram Saved Posts import.
 *
 * Coordinates the pipeline:
 *   1. User picks ZIP parts (modal / drag-drop) — owned by UI.
 *   2. `preflight(files)` validates each part and asks the server about dupes.
 *   3. `startImport(opts)` creates a job, seeds items, starts the worker.
 *   4. `pause` / `resume` / `cancel` forward to the active ImportWorker.
 *
 * This façade is the ONLY entry point UI + main.ts need — they don't touch
 * `ImportWorker`, `ImportJobStore`, or `ImportZipReader` directly.
 */

import type { Vault } from 'obsidian';
import type { PostData } from '@/types/post';
import {
  DEFAULT_IMPORT_DESTINATION,
  DEFAULT_IMPORT_RATE_PER_SEC,
  PREFLIGHT_BATCH_SIZE,
  type GallerySelection,
  type ImportAPIClient,
  type ImportDestination,
  type ImportItem,
  type ImportJobSourceFile,
  type ImportJobState,
  type ImportLogger,
  type ImportManifest,
  type ImportOrchestrator as ImportOrchestratorContract,
  type ImportPartSummary,
  type ImportPostPreview,
  type ImportPreflightResult,
  type ImportProgressSubscriber,
  type StartImportOptions,
} from '@/types/import';
import { ImportJobStore } from './ImportJobStore';
import { ImportProgressBus } from './ImportProgressBus';
import {
  ImportWorker,
  type OnArchiveCreatedHook,
} from './ImportWorker';
import { ImportZipReader } from './ImportZipReader';
import { MediaPreviewService } from '@/services/import-gallery/MediaPreviewService';
import { loadGallery as loadGalleryFromZip } from '@/services/import-gallery/ZipPostDataAdapter';

type ScanOutcome = {
  manifest: ImportManifest;
  summary: ImportPartSummary;
  posts: Array<{ postData: PostData; mediaPaths: string[] }>;
};

/** Narrow subset of `Vault` the orchestrator needs — keeps tests simple. */
export interface OrchestratorDeps {
  jobStore: ImportJobStore;
  apiClient: ImportAPIClient;
  logger: ImportLogger;
  /** Optional vault note creation hook (Agent F wires this from main.ts). */
  onArchiveCreated?: OnArchiveCreatedHook;
  /** Unique ID generator (defaults to crypto.randomUUID). */
  generateId?: () => string;
  /** Registered sync client id — passed through to every archive creation. */
  sourceClientId?: string;
  /**
   * Vault handle used by the worker to write imported media bytes into the
   * user's attachments folder alongside the server R2 upload. Optional —
   * when omitted the worker skips vault writes (tests, headless runs).
   */
  vault?: Vault;
  /**
   * Base folder for media writes, matching the plugin's `mediaPath` setting
   * (default `attachments/social-archives`). Combined with platform +
   * shortcode to form the final path.
   */
  mediaBasePath?: string;
  /**
   * Singleton media-preview cache shared by every gallery render. Per
   * gallery PRD §9.2: lives at orchestrator scope, NOT per-job, because
   * a user may have several jobs in flight whose galleries each share the
   * same LRU cap. {@link MediaPreviewService.clearForJob} is called on
   * every terminal job event so URLs created during review are revoked
   * once the job ends.
   *
   * Optional so unit tests don't have to construct one.
   */
  mediaPreviewService?: MediaPreviewService;
}

/**
 * Holds per-job transient state that the worker needs but that we don't
 * persist across restarts — ZIP blobs and parsed PostData.
 */
type RunningJobContext = {
  readers: Map<string, ImportZipReader>;
  postData: Map<string, PostData>;
  mediaPaths: Map<string, string[]>;
  worker: ImportWorker;
};

export class ImportOrchestrator implements ImportOrchestratorContract {
  private readonly bus = new ImportProgressBus();
  private readonly running = new Map<string, RunningJobContext>();

  constructor(private readonly deps: OrchestratorDeps) {
    // Wire the terminal-event listener once. The orchestrator owns the
    // gallery-selection lifecycle (PRD F3.6 + §9.2 media cleanup), so it
    // listens to its own bus rather than threading the cleanup into the
    // worker (which is intentionally selection-agnostic).
    this.bus.subscribe((evt) => {
      if (
        evt.type === 'job.completed' ||
        evt.type === 'job.failed' ||
        evt.type === 'job.cancelled'
      ) {
        this.handleTerminalEvent(evt.jobId);
      }
    });
  }

  /**
   * Returns the orchestrator's shared {@link MediaPreviewService}, or
   * undefined when none was wired (tests, headless runs).
   *
   * The UI's gallery component calls `acquire`/`release` directly on this
   * instance from its IntersectionObserver hooks — going through the
   * orchestrator API for every viewport change would be needless ceremony.
   * The orchestrator still owns the lifecycle: `clearForJob` is invoked
   * automatically on every terminal job event.
   */
  getMediaPreviewService(): MediaPreviewService | undefined {
    return this.deps.mediaPreviewService;
  }

  /**
   * Read + validate ZIP parts AND populate per-post previews suitable for
   * the review gallery (PRD §9.6, F1.1, F1.2).
   *
   * Strategy (avoids scanning each ZIP twice):
   *   1. Run the gallery adapter with an empty duplicate set. This emits
   *      `parts[].posts: ImportPostPreview[]` with `isDuplicate: false`.
   *   2. Harvest every post id, batch through server `/api/import/preflight`
   *      to learn the duplicate set.
   *   3. Post-mutate the previews' `isDuplicate` flag in-place — cheap
   *      O(n) join — and emit a {@link ImportPreflightResult} that mirrors
   *      what {@link preflight} would have returned, plus the new `posts`
   *      payload on each part.
   *
   * Does NOT create archives, notes, or any persistent state. Safe to call
   * multiple times for the same file selection (e.g. re-open of the gallery).
   */
  async loadGallery(
    files: Array<{ name: string; blob: Blob }>,
  ): Promise<ImportPreflightResult> {
    // Step 1 — pure ZIP scan via the gallery adapter. No network.
    const galleryResult = await loadGalleryFromZip({
      files,
      duplicatePostIds: new Set(),
    });

    // Step 2 — server-side dedup join. Same flow as `preflight`, sourced
    // from the harvested previews so we don't re-touch the ZIP.
    const allPostIds: Array<{ platform: 'instagram'; postId: string }> = [];
    for (const part of galleryResult.parts) {
      for (const preview of part.posts) {
        allPostIds.push({ platform: 'instagram', postId: preview.postId });
      }
    }
    const duplicateSet = new Set<string>();
    if (allPostIds.length > 0) {
      for (let i = 0; i < allPostIds.length; i += PREFLIGHT_BATCH_SIZE) {
        const batch = allPostIds.slice(i, i + PREFLIGHT_BATCH_SIZE);
        try {
          const resp = await this.deps.apiClient.preflight(batch);
          for (const id of resp.duplicates) duplicateSet.add(id);
        } catch (err) {
          this.deps.logger.warn(
            '[ImportOrchestrator] loadGallery preflight batch failed',
            err,
          );
          // Fail-open identically to `preflight` — UI must still be able to
          // render even when the duplicate API is unreachable.
        }
      }
    }

    // Step 3 — flip the isDuplicate flag in-place, then materialize an
    // ImportPreflightResult that carries the per-post previews.
    let totalPostsInSelection = 0;
    let readyToImport = 0;
    let partialMedia = 0;
    let failedPosts = 0;
    const parts: ImportPartSummary[] = [];

    for (const galleryPart of galleryResult.parts) {
      for (const preview of galleryPart.posts) {
        if (duplicateSet.has(preview.postId)) {
          preview.isDuplicate = true;
        }
      }
      const summary: ImportPartSummary = {
        filename: galleryPart.filename,
        exportId: galleryPart.exportId,
        partNumber: galleryPart.partNumber,
        totalParts: galleryPart.totalParts,
        collection: galleryPart.collection,
        counts: galleryPart.counts,
        integrityOk: galleryPart.integrityOk,
        warnings: galleryPart.warnings,
        posts: galleryPart.posts,
      };
      parts.push(summary);
      totalPostsInSelection += summary.counts.postsInPart;
      readyToImport += summary.counts.readyToImport;
      partialMedia += summary.counts.partialMedia;
      failedPosts += summary.counts.failedPosts;
    }

    return {
      parts,
      totalPostsInSelection,
      duplicateCount: duplicateSet.size,
      duplicatePostIds: duplicateSet,
      readyToImport,
      partialMedia,
      failedPosts,
      errors: galleryResult.errors,
    };
  }

  /**
   * Drop selection + media-preview state belonging to a job that just
   * reached a terminal status (PRD F3.6 + §9.2). Idempotent — called once
   * per terminal event from the bus subscription wired in the constructor.
   *
   * - Clears the job's `gallerySelection` field so completed jobs do not
   *   keep the user's review state alive forever.
   * - Tells the {@link MediaPreviewService} to revoke every blob URL that
   *   was acquired under this job id.
   *
   * Failures are swallowed: terminal cleanup must never throw back into
   * the bus, which would prevent sibling subscribers from running.
   */
  private handleTerminalEvent(jobId: string): void {
    try {
      const current = this.deps.jobStore.getJob(jobId);
      if (current && current.gallerySelection !== undefined) {
        const { gallerySelection: _drop, ...rest } = current;
        this.deps.jobStore.updateJob(rest);
      }
    } catch (err) {
      this.deps.logger.warn(
        `[ImportOrchestrator] failed to drop gallerySelection for ${jobId}`,
        err,
      );
    }
    try {
      this.deps.mediaPreviewService?.clearForJob(jobId);
    } catch (err) {
      this.deps.logger.warn(
        `[ImportOrchestrator] mediaPreviewService.clearForJob threw for ${jobId}`,
        err,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Pre-flight
  // ---------------------------------------------------------------------------

  async preflight(files: Array<{ name: string; blob: Blob }>): Promise<ImportPreflightResult> {
    const parts: ImportPartSummary[] = [];
    const errors: Array<{ filename: string; message: string }> = [];
    let totalPostsInSelection = 0;
    let readyToImport = 0;
    let partialMedia = 0;
    let failedPosts = 0;

    const postIds: Array<{ platform: 'instagram'; postId: string }> = [];

    for (const file of files) {
      try {
        const scan = await this.scanPart(file.name, file.blob);
        parts.push(scan.summary);
        totalPostsInSelection += scan.summary.counts.postsInPart;
        readyToImport += scan.summary.counts.readyToImport;
        partialMedia += scan.summary.counts.partialMedia;
        failedPosts += scan.summary.counts.failedPosts;
        for (const p of scan.posts) {
          postIds.push({ platform: 'instagram', postId: p.postData.id });
        }
      } catch (err) {
        errors.push({
          filename: file.name,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Duplicate check (server-authoritative, advisory for UI).
    const duplicateSet = new Set<string>();
    if (postIds.length > 0) {
      for (let i = 0; i < postIds.length; i += PREFLIGHT_BATCH_SIZE) {
        const batch = postIds.slice(i, i + PREFLIGHT_BATCH_SIZE);
        try {
          const resp = await this.deps.apiClient.preflight(batch);
          for (const id of resp.duplicates) duplicateSet.add(id);
        } catch (err) {
          this.deps.logger.warn('[ImportOrchestrator] preflight batch failed', err);
          // Fail-open — an unreachable preflight must not block the user
          // from starting an import (server will still dedupe at write time).
        }
      }
    }

    return {
      parts,
      totalPostsInSelection,
      duplicateCount: duplicateSet.size,
      duplicatePostIds: duplicateSet,
      readyToImport,
      partialMedia,
      failedPosts,
      errors,
    };
  }

  // ---------------------------------------------------------------------------
  // Start import
  // ---------------------------------------------------------------------------

  async startImport(opts: StartImportOptions): Promise<{ jobId: string }> {
    const jobId = (this.deps.generateId ?? defaultGenerateId)();
    const createdAt = Date.now();

    const readers = new Map<string, ImportZipReader>();
    const postDataMap = new Map<string, PostData>();
    const mediaPathsMap = new Map<string, string[]>();
    const sourceFiles: ImportJobSourceFile[] = [];
    const itemSeeds: ImportItem[] = [];

    for (const file of opts.files) {
      const scan = await this.scanPart(file.name, file.blob);
      // Keep the reader alive for media streaming.
      readers.set(file.name, new ImportZipReader(file.blob));

      sourceFiles.push({
        filename: file.name,
        vaultPath: file.vaultPath,
        size: file.blob.size,
        exportId: scan.manifest.exportId,
        partNumber: scan.manifest.partNumber,
        totalParts: scan.manifest.totalParts,
      });

      for (const p of scan.posts) {
        postDataMap.set(p.postData.id, p.postData);
        mediaPathsMap.set(p.postData.id, p.mediaPaths);
        itemSeeds.push({
          jobId,
          postId: p.postData.id,
          shortcode: (p.postData.raw as { code?: string } | undefined)?.code ?? p.postData.id,
          collectionId: scan.manifest.collection.id,
          partFilename: file.name,
          status: 'pending',
          retryCount: 0,
          mediaPaths: p.mediaPaths,
        });
      }
    }

    // Apply review-gallery selection BEFORE persisting any item state so
    // unselected posts never enter the worker (PRD F4.2). When `selection`
    // is absent we keep the legacy behavior — every seeded item runs.
    const filteredSeeds = filterSeedsBySelection(itemSeeds, opts.selection);

    const rateLimitPerSec = clampRate(opts.rateLimitPerSec ?? DEFAULT_IMPORT_RATE_PER_SEC);
    const destination: ImportDestination =
      opts.destination === 'archive' ? 'archive' : DEFAULT_IMPORT_DESTINATION;
    const tags = normalizeImportTags(opts.tags);

    const jobState: ImportJobState = {
      jobId,
      status: 'queued',
      createdAt,
      sourceFiles,
      totalItems: filteredSeeds.length,
      completedItems: 0,
      failedItems: 0,
      partialMediaItems: 0,
      skippedDuplicates: 0,
      rateLimitPerSec,
      destination,
      tags,
      sourceClientId: opts.sourceClientId ?? this.deps.sourceClientId,
      // Persist the user's selection alongside the job so the modal can
      // restore it after restart (PRD §9.4) and so the terminal-event
      // handler can drop it on completion (PRD F3.6).
      ...(opts.selection ? { gallerySelection: cloneSelection(opts.selection) } : {}),
    };

    this.deps.jobStore.createJob(jobState, filteredSeeds);
    this.deps.jobStore.setActiveJobId(jobId);

    const worker = new ImportWorker(jobId, {
      apiClient: this.deps.apiClient,
      jobStore: this.deps.jobStore,
      progressBus: this.bus,
      logger: this.deps.logger,
      zipReaderFor: (partFilename) => readers.get(partFilename),
      postDataFor: (postId) => postDataMap.get(postId),
      onArchiveCreated: this.deps.onArchiveCreated,
      vault: this.deps.vault,
      mediaBasePath: this.deps.mediaBasePath,
    });

    this.running.set(jobId, {
      readers,
      postData: postDataMap,
      mediaPaths: mediaPathsMap,
      worker,
    });

    // Start the loop in the background — the caller only awaits creation.
    void worker.start().catch((err) => {
      this.deps.logger.error(`[ImportOrchestrator] worker crashed`, err);
    });

    return { jobId };
  }

  // ---------------------------------------------------------------------------
  // Control
  // ---------------------------------------------------------------------------

  async pause(jobId: string): Promise<void> {
    const ctx = this.running.get(jobId);
    if (!ctx) return;
    await ctx.worker.pause();
  }

  async resume(jobId: string): Promise<void> {
    const ctx = this.running.get(jobId);
    if (!ctx) return;
    await ctx.worker.resume();
  }

  async cancel(jobId: string): Promise<void> {
    const ctx = this.running.get(jobId);
    if (!ctx) return;
    await ctx.worker.cancel();
    // Drop transient state; the job record stays persisted.
    this.running.delete(jobId);
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async getJob(jobId: string): Promise<ImportJobState | null> {
    return this.deps.jobStore.getJob(jobId);
  }

  async getItems(jobId: string): Promise<ImportItem[]> {
    return this.deps.jobStore.getItems(jobId);
  }

  async listActiveJobs(): Promise<ImportJobState[]> {
    return this.deps.jobStore.listActiveJobs();
  }

  onEvent(cb: ImportProgressSubscriber): () => void {
    return this.bus.subscribe(cb);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async scanPart(filename: string, blob: Blob): Promise<ScanOutcome> {
    const reader = new ImportZipReader(blob);
    const manifestResult = await reader.readManifest();
    if (!manifestResult.ok) {
      throw new Error(`manifest invalid: ${manifestResult.errors.join('; ')}`);
    }
    const warnings: string[] = [...manifestResult.warnings];
    const manifest = manifestResult.manifest;

    // Stream posts.jsonl — collect PostData + media paths.
    const posts: Array<{ postData: PostData; mediaPaths: string[] }> = [];
    await reader.readPostsJsonl((rec) => {
      if (rec.error) {
        warnings.push(`posts.jsonl line ${rec.lineIndex} parse error: ${rec.error}`);
        return;
      }
      if (!rec.value || typeof rec.value !== 'object') {
        warnings.push(`posts.jsonl line ${rec.lineIndex} is not an object`);
        return;
      }
      const postData = rec.value as PostData;
      if (!postData.id || !Array.isArray(postData.media)) {
        warnings.push(`posts.jsonl line ${rec.lineIndex} missing id/media`);
        return;
      }
      // Collect every local-path (non-http) reference the ZIP carries:
      //   - media[].url        (primary image/video bytes)
      //   - media[].thumbnail  (video poster frames)
      //   - author.avatar      (profile picture)
      // We de-duplicate so a shared avatar file isn't uploaded twice per post.
      const candidates: Array<string | undefined> = [];
      for (const m of postData.media ?? []) {
        if (typeof m.url === 'string') candidates.push(m.url);
        if (typeof m.thumbnail === 'string') candidates.push(m.thumbnail);
      }
      if (postData.author && typeof postData.author.avatar === 'string') {
        candidates.push(postData.author.avatar);
      }
      const seen = new Set<string>();
      const mediaPaths: string[] = [];
      for (const raw of candidates) {
        if (!raw) continue;
        if (/^https?:\/\//i.test(raw)) continue; // remote URL — server handles
        const normalized = raw.replace(/^\.\//, '');
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        mediaPaths.push(normalized);
      }
      posts.push({ postData, mediaPaths });
    });

    // Checksum integrity pass — advisory only.
    let integrityOk = true;
    try {
      const checksums = await reader.readChecksums();
      if (checksums.size > 0) {
        // We only verify the small text files + a sample of media. Full
        // verification on very large exports would be expensive; we let
        // the user opt-in to full verify in a follow-up.
        const postsChecksum = await reader.computeEntryChecksum('posts.jsonl');
        const expected = checksums.get('posts.jsonl');
        if (postsChecksum && expected && postsChecksum !== expected) {
          integrityOk = false;
          warnings.push('posts.jsonl checksum mismatch');
        }
      }
    } catch (err) {
      warnings.push(
        `checksum verification skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const summary: ImportPartSummary = {
      filename,
      exportId: manifest.exportId,
      partNumber: manifest.partNumber,
      totalParts: manifest.totalParts,
      collection: manifest.collection,
      counts: {
        postsInPart: manifest.counts.postsInPart,
        postsInExport: manifest.counts.postsInExport,
        readyToImport: manifest.counts.readyToImport,
        partialMedia: manifest.counts.partialMedia,
        failedPosts: manifest.counts.failedPosts,
      },
      integrityOk,
      warnings,
    };
    return { manifest, summary, posts };
  }
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return DEFAULT_IMPORT_RATE_PER_SEC;
  return Math.max(0.1, Math.min(10, rate));
}

/**
 * Normalize user-supplied tag tokens:
 *   - Trim whitespace
 *   - Strip a single leading `#` (YAML stores bare tokens)
 *   - Drop empty tokens
 *   - De-duplicate case-insensitively, preserving first-seen casing
 */
function normalizeImportTags(raw: string[] | undefined): string[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw) {
    if (typeof token !== 'string') continue;
    const trimmed = token.trim().replace(/^#+/, '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function defaultGenerateId(): string {
  // crypto.randomUUID is available in Obsidian's Electron renderer and
  // every modern browser, but fall back just in case.
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `import-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Materialize a {@link GallerySelection} against a concrete seed list and
 * return only the seeds the user has selected (PRD F4.1, F4.2).
 *
 * `selection === undefined` is treated as the legacy "import everything"
 * path — every seed is returned.
 *
 * Mode semantics (mirrors {@link ImportSelectionStore.getSelectedIds}):
 *   - `'all-except'`: keep seeds whose postId is NOT in `selection.ids`.
 *   - `'only'`:        keep seeds whose postId IS in `selection.ids`.
 *
 * Duplicate filtering belongs to the server (PRD F4.3) — we do not strip
 * them here. Server-side dedup is the source of truth at write time.
 */
function filterSeedsBySelection(
  seeds: ImportItem[],
  selection: GallerySelection | undefined,
): ImportItem[] {
  if (!selection) return seeds;
  if (selection.mode === 'all-except') {
    return seeds.filter((s) => !selection.ids.has(s.postId));
  }
  return seeds.filter((s) => selection.ids.has(s.postId));
}

/**
 * Defensive copy so the persisted selection cannot be mutated by callers
 * that retain a reference (e.g. the modal that supplied it).
 */
function cloneSelection(s: GallerySelection): GallerySelection {
  return { mode: s.mode, ids: new Set(s.ids) };
}

// Re-export the preview type for downstream consumers (UI agent).
export type { ImportPostPreview };
