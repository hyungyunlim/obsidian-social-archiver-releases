/**
 * BatchTranscriptionStatusDto — stable, frozen snapshot of the
 * {@link BatchTranscriptionManager} state surface for CLI consumers.
 *
 * Why a separate DTO instead of returning {@link BatchProgress} directly?
 *   - We never want the CLI to mutate or hold a live reference into the
 *     manager. The DTO is a deep clone of the relevant fields and is
 *     `Object.freeze`d so accidental writes throw in strict mode.
 *   - The DTO shape is intentionally minimal and version-stable. New manager
 *     internals can be added without changing the CLI contract.
 *   - This module deliberately depends only on the manager's PUBLIC surface
 *     (`getStatus()`, `getProgress()`). It does NOT reach into private
 *     fields so changes to the manager's internals stay contained.
 *
 * Single Responsibility: produce a serializable, immutable snapshot of
 * batch transcription state for external (CLI / agent) callers.
 */
import type { BatchTranscriptionManager } from '../../services/BatchTranscriptionManager';
import type { BatchOperationStatus, BatchMode } from '../../types/batch-transcription';

/**
 * Stable snapshot of batch transcription state. All fields are required
 * primitives (or `null` for explicit absence) so consumers can rely on
 * shape stability across plugin versions. New fields must be added as
 * optional to remain backward-compatible.
 */
export interface BatchTranscriptionStatusDto {
  /** Overall lifecycle state. */
  state: BatchOperationStatus | 'failed';
  /** Mode the batch was started in (null when never started / fully reset). */
  mode: BatchMode | null;
  /** Total items planned for the batch. */
  totalItems: number;
  /** Number of items that reached a successful terminal state. */
  processedItems: number;
  /** Number of items that failed. */
  failedItems: number;
  /** Number of items that have not yet been processed. */
  remainingItems: number;
  /** ISO 8601 timestamp the current batch was started; null if idle. */
  startedAt: string | null;
  /** ISO 8601 timestamp the snapshot was taken. */
  updatedAt: string;
  /** Vault-relative path of the file the manager is currently processing. */
  currentFilePath?: string;
  /** Most recent error string, when known. Optional — not always populated. */
  lastError?: string;
}

/**
 * Build a frozen, deep-cloned snapshot of the current
 * {@link BatchTranscriptionManager} state. The returned DTO is safe to
 * serialize through the CLI envelope and cannot be mutated to corrupt
 * the manager.
 *
 * Implementation notes:
 *   - Reads only the manager's PUBLIC accessors (`getStatus()`,
 *     `getProgress()`). Any future fields the DTO surfaces must come from
 *     additional public accessors — never from `(manager as any).private`.
 *   - `BatchOperationStatus` already covers the lifecycle terms we surface
 *     ('idle' | 'scanning' | 'running' | 'paused' | 'completed' | 'cancelled').
 *     The DTO's `state` union additionally allows `'failed'` for forward
 *     compatibility, but `snapshotTranscriptionStatus` only ever emits
 *     values produced by the manager itself.
 *   - `lastError` is intentionally omitted in the current implementation
 *     because the manager does not expose a public "last error" accessor.
 *     Adding it later is non-breaking because the field is optional.
 */
export function snapshotTranscriptionStatus(
  manager: BatchTranscriptionManager,
): BatchTranscriptionStatusDto {
  const progress = manager.getProgress();
  const updatedAt = new Date().toISOString();

  const total = progress.totalItems;
  const processed = progress.completedItems;
  const failed = progress.failedItems;
  // `remainingItems` counts items not yet processed (excluding skipped).
  // We compute it from totals so the field is always >= 0 even if the
  // manager publishes inconsistent transient counts during state changes.
  const remaining = Math.max(0, total - processed - failed - progress.skippedItems);

  const startedAtIso =
    progress.elapsedMs > 0 && total > 0
      ? new Date(Date.now() - progress.elapsedMs).toISOString()
      : null;

  // `currentFile` is only meaningful while running/scanning; suppress it
  // for idle/terminal states so the DTO doesn't leak stale paths.
  const includeCurrentFile =
    progress.status === 'running' || progress.status === 'scanning';
  const currentFilePath =
    includeCurrentFile && typeof progress.currentFile === 'string' && progress.currentFile.length > 0
      ? progress.currentFile
      : undefined;

  const dto: BatchTranscriptionStatusDto = {
    state: progress.status,
    mode: total > 0 ? progress.mode : null,
    totalItems: total,
    processedItems: processed,
    failedItems: failed,
    remainingItems: remaining,
    startedAt: startedAtIso,
    updatedAt,
  };

  if (currentFilePath !== undefined) {
    dto.currentFilePath = currentFilePath;
  }

  // Deep freeze for tamper resistance. The DTO is a flat primitive record
  // so a shallow freeze is sufficient; we still call Object.freeze defensively
  // in case future fields become objects/arrays.
  return Object.freeze({ ...dto });
}
