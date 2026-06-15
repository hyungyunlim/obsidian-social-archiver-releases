import type { TFile } from 'obsidian';
import type { ArchiveOrchestrator } from '@/services/ArchiveOrchestrator';
import type { ArchiveLookupService } from '@/services/ArchiveLookupService';
import type { ClipPayload } from '@/types/clip';
import type { PostData } from '@/types/post';
import {
  CLIP_BATCH_MAX_POST_COUNT,
  ClipBatchError,
  type ClipBatchFailure,
  type ClipBatchManifestV1,
  type ClipBatchProgress,
  type ClipBatchReceiptV1,
} from '@/types/clip-batch';
import type { ClipBatchInbox } from './ClipBatchInbox';
import type { ClipPayloadCodec } from './ClipPayloadCodec';

export interface ClipBatchServiceConfig {
  inbox: ClipBatchInbox;
  codec: ClipPayloadCodec;
  /**
   * Lazy orchestrator accessor — the orchestrator is constructed during
   * `initializeServices()` and may briefly be unavailable right after a
   * deep link wakes the app (same contract as LocalClipService).
   */
  getOrchestrator: () => ArchiveOrchestrator | undefined;
  /** Lazy lookup accessor for dedup; absent lookup disables dedup (fail-open). */
  getArchiveLookup: () => ArchiveLookupService | undefined;
  /**
   * Resolve a vault-relative path to its TFile. Used to register each
   * freshly saved note in the lookup index (`indexSavedFile`) so later posts
   * in the SAME run can dedup against it without waiting for the async
   * MetadataCache `changed` event to index the just-written file.
   */
  getVaultFileByPath: (path: string) => TFile | null;
}

export interface ClipBatchRunOptions {
  /** Invoked after every post file so the caller can drive a single Notice. */
  onProgress?: (progress: ClipBatchProgress) => void;
}

export interface ClipBatchSweepResult {
  /** Receipts of the batches processed by this sweep, in batch-id order. */
  receipts: ClipBatchReceiptV1[];
  /** Batch dir paths removed by garbage collection. */
  garbageCollected: string[];
}

type PostFileOutcome =
  | { status: 'imported' }
  | { status: 'duplicate' }
  | { status: 'failed'; error: string };

/**
 * Per-`processBatch` dedup memo. `findByClientPostId` is an O(vault)
 * MetadataCache scan per call — for a bulk batch the vault's clientPostId
 * set is snapshotted ONCE, lazily on the first post that survives the URL
 * lookup, then reused for the rest of the run. Nothing is invalidated:
 * notes created mid-batch are registered via `indexSavedFile(originalUrl)`,
 * which the primary URL lookup covers.
 */
interface BatchRunDedupCache {
  clientPostIds?: Set<string>;
}

/**
 * How long a batch-level refusal (unreadable manifest, oversized batch) must
 * persist before the sweep writes a refusal receipt. The FSA sender creates
 * `batch.json` empty before content lands at close(), so a fresh unreadable
 * manifest may be a commit in flight — never write it off immediately.
 */
const BATCH_REFUSAL_GRACE_MS = 10 * 60 * 1000;

/**
 * ClipBatchService — drain committed clip-batch inbox batches into vault
 * notes.
 *
 * Single Responsibility: per-post validate → dedup → provenance → archive
 * orchestration, plus receipt/cleanup bookkeeping. Filesystem access lives
 * in ClipBatchInbox, envelope validation in ClipPayloadCodec, batch UX
 * (Notices, timeline refresh, concurrency guard) in main.ts.
 *
 * Mirrors LocalClipService semantics with `importSource = batch.source`
 * instead of `browser-clip:<source>`. Works fully logged-out — zero server
 * calls. See prd-bulk-import-local-vault-mode.md (§5.3).
 */
export class ClipBatchService {
  constructor(private readonly config: ClipBatchServiceConfig) {}

  /**
   * Process one committed batch. Per-post failures are isolated into the
   * receipt (files kept for retry); successes and duplicates delete their
   * post files, which is what makes re-running a batch idempotent.
   *
   * @throws ClipBatchError on batch-level problems (missing/invalid
   *   manifest, oversized batch) — post files are left untouched.
   */
  async processBatch(
    batchId: string,
    options: ClipBatchRunOptions = {}
  ): Promise<ClipBatchReceiptV1> {
    const manifest = await this.config.inbox.readManifest(batchId);

    if (manifest.postCount > CLIP_BATCH_MAX_POST_COUNT) {
      throw new ClipBatchError(
        'too_many_posts',
        `Batch declares ${manifest.postCount} posts (max ${CLIP_BATCH_MAX_POST_COUNT})`
      );
    }

    const orchestrator = this.config.getOrchestrator();
    if (!orchestrator) {
      throw new Error('Social Archiver is still initializing. Please try again in a moment.');
    }

    const postFiles = await this.config.inbox.listPostFiles(batchId);

    // The manifest is untrusted — re-check the cap against what is on disk.
    if (postFiles.length > CLIP_BATCH_MAX_POST_COUNT) {
      throw new ClipBatchError(
        'too_many_posts',
        `Batch contains ${postFiles.length} post files (max ${CLIP_BATCH_MAX_POST_COUNT})`
      );
    }

    // Re-triggering a fully drained batch (double deep-link click, sweep
    // race) must not overwrite the meaningful receipt with zeros.
    if (postFiles.length === 0) {
      const existing = await this.config.inbox.readReceipt(batchId);
      if (existing) return existing;
    }

    let imported = 0;
    let duplicates = 0;
    const failed: ClipBatchFailure[] = [];
    const dedupCache: BatchRunDedupCache = {};

    // Initial emit BEFORE the first post: per-post progress only fires after
    // a post completes, so without this a slow first post (or a stall inside
    // it) is indistinguishable from the run never starting.
    options.onProgress?.({
      batchId,
      processed: 0,
      total: postFiles.length,
      imported: 0,
      duplicates: 0,
      failed: 0,
    });

    for (let i = 0; i < postFiles.length; i++) {
      const file = postFiles[i] as string;
      console.debug(
        `[Social Archiver] Clip batch ${batchId}: processing ${i + 1}/${postFiles.length}`,
        file
      );
      const outcome = await this.processPostFile(file, manifest, orchestrator, dedupCache);
      if (outcome.status === 'imported') {
        imported++;
      } else if (outcome.status === 'duplicate') {
        duplicates++;
      } else {
        failed.push({ file, error: outcome.error });
      }

      options.onProgress?.({
        batchId,
        processed: i + 1,
        total: postFiles.length,
        imported,
        duplicates,
        failed: failed.length,
      });

      // Bulk UX: keep the UI thread responsive during long batches.
      await this.yieldToEventLoop();
    }

    const receipt: ClipBatchReceiptV1 = {
      v: 1,
      batchId,
      imported,
      duplicates,
      failed,
      finishedAt: new Date().toISOString(),
    };

    // Receipt is always written (locked Q2) — it is the completion marker
    // the sweep and the extension read back.
    await this.config.inbox.writeReceipt(batchId, receipt);

    if (failed.length === 0) {
      // The receipt above is the source of truth — a cleanup hiccup must not
      // turn a successful batch into a reported failure.
      try {
        await this.config.inbox.cleanupDrainedPosts(batchId);
      } catch (error) {
        console.warn(`[Social Archiver] Could not clean up batch ${batchId} posts dir:`, error);
      }
    }

    return receipt;
  }

  /**
   * Recovery sweep (PRD §5.2): process every committed batch that has no
   * receipt yet — covers Obsidian closed during export, lost deep links,
   * and plugin updates mid-batch — then garbage-collect stale dirs.
   * Batch-level failures are logged and skipped so one bad batch cannot
   * block the rest; its files stay for a later sweep.
   */
  async sweepInbox(options: ClipBatchRunOptions = {}): Promise<ClipBatchSweepResult> {
    const receipts: ClipBatchReceiptV1[] = [];

    for (const batchId of await this.config.inbox.listPendingBatchIds()) {
      try {
        receipts.push(await this.processBatch(batchId, options));
      } catch (error) {
        console.error(`[Social Archiver] Clip batch sweep failed for ${batchId}:`, error);
        await this.maybeWriteRefusalReceipt(batchId, error);
      }
    }

    let garbageCollected: string[] = [];
    try {
      garbageCollected = await this.config.inbox.collectGarbage();
    } catch (error) {
      console.warn('[Social Archiver] Clip inbox GC failed:', error);
    }

    return { receipts, garbageCollected };
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Terminal batch-level refusals (`invalid_manifest` from a crashed sender
   * commit, `too_many_posts`) would otherwise stay committed-without-receipt
   * forever: re-refused on every sweep and never garbage-collected. Once the
   * refusal has persisted past the grace window, persist it as a refusal
   * receipt — the batch becomes "completed" (extension-readable failure,
   * reclaimed by the 7-day GC). Transient errors (orchestrator not ready,
   * IO hiccups) are NOT receipted; the next sweep retries them.
   */
  private async maybeWriteRefusalReceipt(batchId: string, error: unknown): Promise<void> {
    if (
      !(error instanceof ClipBatchError) ||
      (error.reason !== 'invalid_manifest' && error.reason !== 'too_many_posts')
    ) {
      return;
    }
    try {
      const mtime = await this.config.inbox.manifestMtime(batchId);
      if (mtime === null || Date.now() - mtime < BATCH_REFUSAL_GRACE_MS) return;

      await this.config.inbox.writeReceipt(batchId, {
        v: 1,
        batchId,
        imported: 0,
        duplicates: 0,
        failed: [{ file: 'batch.json', error: `${error.reason}: ${error.message}` }],
        finishedAt: new Date().toISOString(),
        // Terminal marker — keeps the sweep's failed-post retry pass from
        // ever re-attempting a batch that can never be processed.
        refused: true,
      });
      console.warn(
        `[Social Archiver] Clip batch ${batchId} written off with a refusal receipt (${error.reason})`
      );
    } catch (receiptError) {
      console.warn(
        `[Social Archiver] Could not write refusal receipt for batch ${batchId}:`,
        receiptError
      );
    }
  }

  private async processPostFile(
    filePath: string,
    manifest: ClipBatchManifestV1,
    orchestrator: ArchiveOrchestrator,
    dedupCache: BatchRunDedupCache
  ): Promise<PostFileOutcome> {
    // 1. Parse + validate envelope (typed ClipPayloadError on bad input).
    //    Failures keep the file so the sender can inspect/retry it.
    let payload: ClipPayload;
    try {
      const raw = await this.config.inbox.readPostFile(filePath);
      payload = this.config.codec.decodeUncompressedJson(raw);
    } catch (error) {
      return { status: 'failed', error: this.describeError(error) };
    }

    // 2. Dedup — re-running a batch is idempotent. Duplicates drop their
    //    post file so a re-run doesn't re-report them.
    if (this.isDuplicate(payload.postData, dedupCache)) {
      await this.deletePostFileQuietly(filePath);
      return { status: 'duplicate' };
    }

    // 3. Provenance + 4. Orchestrate (no per-post UX — bulk UX lives upstream).
    this.markBatchProvenance(payload.postData, payload, manifest);
    try {
      const result = await orchestrator.orchestrateFromPostData(payload.postData, {
        enableAI: false,
        deepResearch: false,
        generateShareLink: false,
        removeTracking: true,
        // Channel B+ folder handoff: 'local' means media[].url are already
        // vault-relative paths written by the sender — never download those.
        downloadMedia: payload.mediaDelivery !== 'local',
        // Locked decision Q5: quotedPost media stays REMOTE in local mode —
        // graduated notes flow through the obsidian-local-import server
        // validation, which rejects local media inside quotedPost.
        skipQuotedMediaDownload: true,
        // Batch imports must never pop modals (Large Media Guard etc.).
        isForeground: false,
      });
      if (!result.success || !result.filePath) {
        return { status: 'failed', error: result.error || 'Archive failed' };
      }
      // Register the saved note in the lookup index NOW: dedup for the rest
      // of the batch (and any queued follow-up sweep) must not depend on the
      // MetadataCache having re-parsed the just-written file.
      this.registerImportedNote(result.filePath, payload.postData.url);
    } catch (error) {
      return { status: 'failed', error: this.describeError(error) };
    }

    // 5. Success: drop the post file. If the delete itself fails, the note
    //    exists — a re-run will classify the file as a duplicate.
    await this.deletePostFileQuietly(filePath);
    return { status: 'imported' };
  }

  /**
   * Local dedup (PRD §5.3 step 2): `findByOriginalUrl` is the primary key;
   * the `clientPostId` check is a defensive fallback for notes that carry
   * the post id as `clientPostId` frontmatter. The clientPostId set is
   * snapshotted once per batch run ({@link BatchRunDedupCache}) — calling
   * `findByClientPostId` per post would rescan the whole vault for every
   * non-duplicate. Fail-open — a missing lookup service must not block
   * imports.
   */
  private isDuplicate(postData: PostData, dedupCache: BatchRunDedupCache): boolean {
    const lookup = this.config.getArchiveLookup();
    if (!lookup) return false;
    if (lookup.findByOriginalUrl(postData.url).length > 0) return true;
    dedupCache.clientPostIds ??= lookup.getClientPostIdSet();
    return dedupCache.clientPostIds.has(postData.id);
  }

  /**
   * Same fields as `LocalClipService.markLocalClipProvenance`, but stamped
   * with the batch source (e.g. 'reddit-saved-import') — mirroring how the
   * ZIP import stamps 'instagram-saved-import'. The graduation scanner keys
   * on import_mode only; the source is informational/analytic.
   */
  private markBatchProvenance(
    postData: PostData,
    payload: ClipPayload,
    manifest: ClipBatchManifestV1
  ): void {
    postData.metadata.socialArchiverImportMode = 'local-only';
    postData.metadata.socialArchiverImportSource = manifest.source;
    postData.metadata.socialArchiverServerArchiveId = 'none';
    delete postData.sourceArchiveId;

    if (!postData.archivedDate) {
      const clippedAt = payload.clippedAt ? new Date(payload.clippedAt) : null;
      postData.archivedDate =
        clippedAt && !Number.isNaN(clippedAt.getTime()) ? clippedAt : new Date();
    }
  }

  /**
   * Best-effort immediate index registration of a freshly saved note
   * (`ArchiveLookupService.indexSavedFile`). Failures are swallowed — the
   * MetadataCache `changed` event indexes the file moments later anyway;
   * this only closes the same-run dedup window.
   */
  private registerImportedNote(filePath: string, originalUrl: string): void {
    const lookup = this.config.getArchiveLookup();
    if (!lookup) return;
    try {
      const file = this.config.getVaultFileByPath(filePath);
      if (file) {
        lookup.indexSavedFile(file, { originalUrl });
      }
    } catch (error) {
      console.warn(
        `[Social Archiver] Could not index freshly imported note ${filePath}:`,
        error
      );
    }
  }

  private async deletePostFileQuietly(filePath: string): Promise<void> {
    try {
      await this.config.inbox.deletePostFile(filePath);
    } catch (error) {
      console.warn(`[Social Archiver] Could not delete clip post file ${filePath}:`, error);
    }
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /** Yield between posts so a long batch never freezes the UI thread. */
  private async yieldToEventLoop(): Promise<void> {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
}
