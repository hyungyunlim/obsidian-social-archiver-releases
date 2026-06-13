import { normalizePath } from 'obsidian';
import {
  ClipBatchError,
  isValidClipBatchId,
  type ClipBatchManifestV1,
  type ClipBatchReceiptV1,
} from '@/types/clip-batch';

/**
 * Narrow view of Obsidian's `DataAdapter` used by the inbox. Inbox files are
 * written externally by the browser extension (FSA folder handoff), so the
 * vault index may lag behind disk — adapter-level list/read/remove are
 * authoritative for these paths.
 */
export interface ClipInboxAdapter {
  exists(normalizedPath: string): Promise<boolean>;
  stat(normalizedPath: string): Promise<{
    type: 'file' | 'folder';
    ctime: number;
    mtime: number;
    size: number;
  } | null>;
  list(normalizedPath: string): Promise<{ files: string[]; folders: string[] }>;
  read(normalizedPath: string): Promise<string>;
  write(normalizedPath: string, data: string): Promise<void>;
  remove(normalizedPath: string): Promise<void>;
  rmdir(normalizedPath: string, recursive: boolean): Promise<void>;
}

export interface ClipBatchInboxConfig {
  adapter: ClipInboxAdapter;
  /** Media base path from plugin settings (`settings.mediaPath`). */
  getMediaPath: () => string;
}

const DEFAULT_MEDIA_PATH = 'attachments/social-archives';
const MANIFEST_FILENAME = 'batch.json';
const RECEIPT_FILENAME = 'result.json';
const POSTS_DIRNAME = 'posts';

/** Completed batch dirs (receipt present) are GC'd after 7 days (locked Q2). */
const COMPLETED_BATCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Uncommitted batch dirs (no manifest) are GC'd after 24 hours (PRD §5.2). */
const UNCOMMITTED_BATCH_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * ClipBatchInbox — filesystem-level access to the clip-batch inbox
 * (`<mediaPath>/clips/.inbox/<batch-id>/`).
 *
 * Single Responsibility: path resolution, manifest/receipt/post-file IO, and
 * garbage collection of stale batch dirs. No envelope validation, no archive
 * orchestration — that lives in ClipBatchService.
 *
 * See prd-bulk-import-local-vault-mode.md (§5.1–§5.2).
 */
export class ClipBatchInbox {
  constructor(private readonly config: ClipBatchInboxConfig) {}

  /** Vault-relative inbox root, e.g. `attachments/social-archives/clips/.inbox`. */
  getInboxRoot(): string {
    return normalizePath(`${this.resolveMediaPath()}/clips/.inbox`);
  }

  /**
   * Mirror of the extension's `sanitizeVaultRelativeParts` guard
   * (`chrome-extension/src/shared/obsidian-clip/vault-media-writer.ts`): the
   * sender reads the same `mediaPath` setting from `data.json` and falls
   * back to the default when it is degenerate ('.'/'..' or whitespace-only
   * segments). The plugin must apply the SAME reject-and-fallback semantics,
   * or a degenerate setting makes the two sides resolve DIFFERENT inbox
   * roots and the plugin never sees the extension's batches.
   */
  private resolveMediaPath(): string {
    const raw = this.config.getMediaPath() || DEFAULT_MEDIA_PATH;
    const parts = raw
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) {
      return DEFAULT_MEDIA_PATH;
    }
    return parts.join('/');
  }

  /**
   * List batch ids whose dirs contain `batch.json` (commit marker present).
   * Half-written batches — the sender writes the manifest LAST — never show
   * up here. Sorted for deterministic processing order.
   */
  async listCommittedBatchIds(): Promise<string[]> {
    const ids = await this.listBatchDirIds();
    const committed: string[] = [];
    for (const id of ids) {
      if (await this.hasManifest(id)) {
        committed.push(id);
      }
    }
    return committed;
  }

  /**
   * Committed batches the sweep still has work on:
   * - no receipt yet (never processed), or
   * - receipted but post files remain — failed posts are kept on disk for
   *   retry (PRD §5.1/§9), and the sweep is their retry trigger. Re-entering
   *   `processBatch` on such a batch is safe: drained files are gone, so
   *   only the kept failures are reprocessed.
   *
   * Batch-level REFUSAL receipts (`refused: true`) are terminal — retrying
   * an unreadable manifest or an over-cap batch can never succeed, so those
   * dirs just wait for the 7-day GC.
   */
  async listPendingBatchIds(): Promise<string[]> {
    const committed = await this.listCommittedBatchIds();
    const pending: string[] = [];
    for (const id of committed) {
      if (!(await this.hasReceipt(id))) {
        pending.push(id);
        continue;
      }
      const receipt = await this.readReceipt(id);
      if (receipt?.refused === true) continue;
      if ((await this.listPostFiles(id)).length > 0) {
        pending.push(id);
      }
    }
    return pending;
  }

  /**
   * Read and validate a batch manifest.
   *
   * @throws ClipBatchError `invalid_batch_id` | `batch_not_found` |
   *   `invalid_manifest`
   */
  async readManifest(batchId: string): Promise<ClipBatchManifestV1> {
    const manifestPath = this.manifestPath(batchId);
    if (!(await this.config.adapter.exists(manifestPath))) {
      throw new ClipBatchError(
        'batch_not_found',
        `No committed batch at ${manifestPath}`
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(await this.config.adapter.read(manifestPath));
    } catch {
      throw new ClipBatchError('invalid_manifest', 'batch.json is not valid JSON');
    }

    return this.validateManifest(raw);
  }

  /**
   * List post file paths for a batch, sorted by filename. Sender files are
   * named `<seq4>-<postKey>.json`, so lexicographic order == write order.
   */
  async listPostFiles(batchId: string): Promise<string[]> {
    const postsDir = this.postsDir(batchId);
    if (!(await this.config.adapter.exists(postsDir))) {
      return [];
    }
    const listing = await this.config.adapter.list(postsDir);
    return listing.files
      .filter((path) => path.toLowerCase().endsWith('.json'))
      .sort();
  }

  async readPostFile(path: string): Promise<string> {
    return this.config.adapter.read(path);
  }

  async deletePostFile(path: string): Promise<void> {
    await this.config.adapter.remove(path);
  }

  async hasReceipt(batchId: string): Promise<boolean> {
    return this.config.adapter.exists(this.receiptPath(batchId));
  }

  /**
   * Manifest mtime, or `null` when absent/unstattable. Lets the sweep
   * age-gate refusal receipts: an unreadable `batch.json` may be a sender
   * mid-commit (FSA creates the file empty before content lands), so only
   * manifests that have been broken for a while are written off.
   */
  async manifestMtime(batchId: string): Promise<number | null> {
    const stat = await this.config.adapter.stat(this.manifestPath(batchId));
    return stat?.mtime ?? null;
  }

  /** Best-effort receipt read — `null` when missing or unparseable. */
  async readReceipt(batchId: string): Promise<ClipBatchReceiptV1 | null> {
    const receiptPath = this.receiptPath(batchId);
    try {
      if (!(await this.config.adapter.exists(receiptPath))) return null;
      const raw: unknown = JSON.parse(await this.config.adapter.read(receiptPath));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const receipt = raw as Partial<ClipBatchReceiptV1>;
      if (receipt.v !== 1 || typeof receipt.batchId !== 'string') return null;
      return receipt as ClipBatchReceiptV1;
    } catch {
      return null;
    }
  }

  async writeReceipt(batchId: string, receipt: ClipBatchReceiptV1): Promise<void> {
    await this.config.adapter.write(
      this.receiptPath(batchId),
      JSON.stringify(receipt, null, 2)
    );
  }

  /**
   * Remove the `posts/` dir once fully drained, KEEPING `batch.json` +
   * `result.json` in place (locked decision Q2 — the receipt is the
   * extension-readable completion marker; GC reclaims the dir after 7 days).
   * No-op when post files remain (failed posts stay for retry) or when a
   * stray non-JSON file is present (conservative).
   */
  async cleanupDrainedPosts(batchId: string): Promise<void> {
    const postsDir = this.postsDir(batchId);
    if (!(await this.config.adapter.exists(postsDir))) return;
    const listing = await this.config.adapter.list(postsDir);
    if (listing.files.length > 0) return;
    await this.config.adapter.rmdir(postsDir, true);
  }

  /**
   * Garbage-collect stale batch dirs (PRD §5.2 + locked Q2):
   * - completed (receipt present, posts drained or refused) older than
   *   7 days → removed
   * - uncommitted (no manifest) older than 24 hours → removed
   * - committed-but-pending dirs — including receipted dirs whose failed
   *   post files are kept for retry — are never touched (work to do)
   *
   * Ages come from adapter `stat` mtimes — receipt mtime for completed
   * batches (precise completion time), newest of batch/posts dir mtimes for
   * uncommitted ones (the sender may still be writing). Per-dir errors are
   * swallowed so one bad dir cannot block the sweep.
   *
   * @returns Vault-relative paths of the removed batch dirs.
   */
  async collectGarbage(now: number = Date.now()): Promise<string[]> {
    const removed: string[] = [];
    for (const batchId of await this.listBatchDirIds()) {
      try {
        if (await this.shouldGarbageCollect(batchId, now)) {
          await this.config.adapter.rmdir(this.batchDir(batchId), true);
          removed.push(this.batchDir(batchId));
        }
      } catch (error) {
        console.warn(
          `[Social Archiver] Clip inbox GC skipped batch ${batchId}:`,
          error
        );
      }
    }
    return removed;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Strict manifest shape check. Inbox files come from outside Obsidian, so
   * they are untrusted input — same posture as ClipPayloadCodec.
   */
  private validateManifest(raw: unknown): ClipBatchManifestV1 {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new ClipBatchError('invalid_manifest', 'Manifest must be an object');
    }
    const manifest = raw as Partial<ClipBatchManifestV1>;

    if (manifest.v !== 1) {
      throw new ClipBatchError(
        'invalid_manifest',
        `Unsupported manifest version: ${String(manifest.v)}`
      );
    }
    if (typeof manifest.batchId !== 'string' || !isValidClipBatchId(manifest.batchId)) {
      throw new ClipBatchError('invalid_manifest', 'Manifest is missing a valid batchId');
    }
    if (typeof manifest.source !== 'string' || !manifest.source.trim()) {
      throw new ClipBatchError('invalid_manifest', 'Manifest is missing source');
    }
    if (typeof manifest.createdAt !== 'string' || !manifest.createdAt.trim()) {
      throw new ClipBatchError('invalid_manifest', 'Manifest is missing createdAt');
    }
    if (
      typeof manifest.postCount !== 'number' ||
      !Number.isInteger(manifest.postCount) ||
      manifest.postCount < 0
    ) {
      throw new ClipBatchError('invalid_manifest', 'Manifest postCount must be a non-negative integer');
    }

    return {
      v: 1,
      batchId: manifest.batchId,
      source: manifest.source,
      senderVersion:
        typeof manifest.senderVersion === 'string' ? manifest.senderVersion : undefined,
      createdAt: manifest.createdAt,
      postCount: manifest.postCount,
    };
  }

  /**
   * Batch dir path with id validation as defense in depth — the protocol
   * handler validates deep-link ids, but every adapter access re-checks so a
   * hostile id can never escape the inbox root.
   */
  private batchDir(batchId: string): string {
    if (!isValidClipBatchId(batchId)) {
      throw new ClipBatchError('invalid_batch_id', `Invalid batch id: ${batchId}`);
    }
    return normalizePath(`${this.getInboxRoot()}/${batchId}`);
  }

  private manifestPath(batchId: string): string {
    return `${this.batchDir(batchId)}/${MANIFEST_FILENAME}`;
  }

  private receiptPath(batchId: string): string {
    return `${this.batchDir(batchId)}/${RECEIPT_FILENAME}`;
  }

  private postsDir(batchId: string): string {
    return `${this.batchDir(batchId)}/${POSTS_DIRNAME}`;
  }

  private async hasManifest(batchId: string): Promise<boolean> {
    return this.config.adapter.exists(this.manifestPath(batchId));
  }

  /**
   * Folder names under the inbox root that look like batch ids. Foreign or
   * hidden dirs are ignored entirely — the inbox never deletes what it did
   * not recognize.
   */
  private async listBatchDirIds(): Promise<string[]> {
    const root = this.getInboxRoot();
    if (!(await this.config.adapter.exists(root))) {
      return [];
    }
    const listing = await this.config.adapter.list(root);
    return listing.folders
      .map((path) => path.split('/').pop() ?? '')
      .filter((name) => isValidClipBatchId(name))
      .sort();
  }

  private async shouldGarbageCollect(batchId: string, now: number): Promise<boolean> {
    const committed = await this.hasManifest(batchId);

    if (committed) {
      if (!(await this.hasReceipt(batchId))) return false; // pending work
      // Receipted but post files remain → failed posts kept for retry
      // (PRD §5.1); the sweep retries them, so GC must never reclaim the
      // dir under them. Refusal receipts are terminal: their post files
      // were never processable, so the 7-day clock applies regardless.
      const receipt = await this.readReceipt(batchId);
      if (receipt?.refused !== true && (await this.listPostFiles(batchId)).length > 0) {
        return false;
      }
      const receiptStat = await this.config.adapter.stat(this.receiptPath(batchId));
      if (!receiptStat) return false;
      return now - receiptStat.mtime > COMPLETED_BATCH_TTL_MS;
    }

    const dirStat = await this.config.adapter.stat(this.batchDir(batchId));
    if (!dirStat) return false;
    let newestMtime = dirStat.mtime;
    const postsDir = this.postsDir(batchId);
    if (await this.config.adapter.exists(postsDir)) {
      const postsStat = await this.config.adapter.stat(postsDir);
      if (postsStat) {
        newestMtime = Math.max(newestMtime, postsStat.mtime);
      }
    }
    return now - newestMtime > UNCOMMITTED_BATCH_TTL_MS;
  }
}
