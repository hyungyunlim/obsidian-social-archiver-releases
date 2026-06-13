/**
 * Clip-batch inbox types (bulk import local vault mode).
 *
 * The Chrome extension writes per-post `ClipEnvelopeV1` JSON files (plus
 * media) into `<mediaPath>/clips/.inbox/<batch-id>/` via its FSA vault
 * handle, commits the batch by writing `batch.json` LAST, then fires one
 * `obsidian://social-archive?op=clip-batch&v=1&id=<batch-id>` deep link.
 * The plugin drains the batch into local-only vault notes and writes a
 * `result.json` receipt.
 *
 * See prd-bulk-import-local-vault-mode.md (§5.1–§5.3).
 */

/** Clip-batch protocol version understood by this plugin build. */
export const CLIP_BATCH_VERSION = 1;

/**
 * Hard cap on posts per batch (PRD §8 Q4, locked): larger runs must be
 * split into multiple batches sender-side.
 */
export const CLIP_BATCH_MAX_POST_COUNT = 1000;

/**
 * Batch ids travel through `obsidian://` query params AND become vault
 * folder names, so they are restricted to a filesystem-safe charset.
 * This doubles as the path traversal guard — anything else is rejected
 * before touching the adapter.
 */
export const CLIP_BATCH_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Validate an untrusted batch id (deep-link param or folder name). */
export function isValidClipBatchId(id: string): boolean {
  return CLIP_BATCH_ID_PATTERN.test(id);
}

type ExtensibleString = string & Record<never, never>;

/**
 * Known batch senders (bulk import surfaces). Extensible so future import
 * sources don't need a type bump — the value is stamped verbatim into
 * `socialArchiverImportSource` (informational/analytic; the graduation
 * scanner keys on import_mode only).
 */
export type ClipBatchSource =
  | 'reddit-saved-import'
  | 'x-bookmarks-import'
  | 'instagram-own-posts-import'
  | 'instagram-saved-import'
  | ExtensibleString;

/**
 * `batch.json` manifest — the commit marker. Written by the sender AFTER
 * all post files and media, so the plugin never processes a half-written
 * batch.
 */
export interface ClipBatchManifestV1 {
  v: 1;
  batchId: string;
  source: ClipBatchSource;
  /** Sender (extension) version, for diagnostics. */
  senderVersion?: string;
  /** ISO 8601 timestamp of when the sender created the batch. */
  createdAt: string;
  postCount: number;
}

/** Per-post failure entry recorded in the receipt. */
export interface ClipBatchFailure {
  /** Vault-relative path of the post file that failed (kept for retry). */
  file: string;
  error: string;
}

/**
 * `result.json` receipt — written by the plugin after draining a batch
 * (always, per locked decision Q2; extension read-back is best-effort).
 */
export interface ClipBatchReceiptV1 {
  v: 1;
  batchId: string;
  imported: number;
  duplicates: number;
  failed: ClipBatchFailure[];
  /** ISO 8601 timestamp of when processing finished. */
  finishedAt: string;
  /**
   * Set on batch-level refusal receipts (unreadable manifest, oversized
   * batch). Refused batches are terminal — the sweep must NOT retry them —
   * whereas a normal receipt with remaining post files means "failed posts
   * kept for retry" (PRD §5.1) and stays sweep-eligible. Optional so older
   * receipts (and the extension mirror) stay shape-compatible.
   */
  refused?: true;
}

/** Progress snapshot emitted between post files (drives the single Notice). */
export interface ClipBatchProgress {
  batchId: string;
  /** Post files handled so far (imported + duplicates + failed). */
  processed: number;
  /** Total post files in this batch. */
  total: number;
  imported: number;
  duplicates: number;
  failed: number;
}

export type ClipBatchErrorReason =
  | 'invalid_batch_id'
  | 'batch_not_found'
  | 'invalid_manifest'
  | 'too_many_posts';

/**
 * Typed batch-level failure. Per-post failures never throw — they are
 * recorded in the receipt so one bad post cannot abort the batch.
 */
export class ClipBatchError extends Error {
  constructor(
    public readonly reason: ClipBatchErrorReason,
    message?: string
  ) {
    super(message ?? `Clip batch error: ${reason}`);
    this.name = 'ClipBatchError';
  }
}
