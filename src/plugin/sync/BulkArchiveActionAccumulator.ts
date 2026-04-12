/**
 * BulkArchiveActionAccumulator
 *
 * Single Responsibility: Collect individual archive action changes (isLiked,
 * isBookmarked) and flush them to the server, choosing the single-item
 * endpoint when only one action is pending and the bulk endpoint when
 * multiple items accumulate within the debounce window.
 *
 * This accumulator merges actions per archiveId so that rapid-fire
 * frontmatter edits (e.g. bulk star/unstar) produce at most one API call
 * per flush instead of N individual PATCHes.
 *
 * Lifecycle:
 *   - Instantiate once during plugin init, shared by LikeStateOutboundService
 *     and ArchiveStateOutboundService.
 *   - Call destroy() in plugin onunload to flush remaining and clear timers.
 */

import type { WorkersAPIClient } from '@/services/WorkersAPIClient';

// ============================================================================
// Types
// ============================================================================

export interface PendingAction {
  archiveId: string;
  isLiked?: boolean;
  isBookmarked?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/** Debounce delay before flushing accumulated actions to the server. */
const FLUSH_DELAY_MS = 3_000;

const LOG_PREFIX = '[Social Archiver] [BulkAccumulator]';

// ============================================================================
// BulkArchiveActionAccumulator
// ============================================================================

export class BulkArchiveActionAccumulator {
  private pending = new Map<string, PendingAction>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly apiClient: WorkersAPIClient) {}

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Enqueue an archive action change. If an action for the same archiveId is
   * already pending, the new fields are merged (last-write-wins per field).
   */
  enqueue(action: PendingAction): void {
    const existing = this.pending.get(action.archiveId);
    if (existing) {
      if (action.isLiked !== undefined) existing.isLiked = action.isLiked;
      if (action.isBookmarked !== undefined) existing.isBookmarked = action.isBookmarked;
    } else {
      this.pending.set(action.archiveId, { ...action });
    }
    this.scheduleFlush();
  }

  /**
   * Destroy the accumulator: flush any remaining actions and clear timers.
   * Call this during plugin onunload.
   */
  destroy(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // Fire-and-forget flush of remaining items
    if (this.pending.size > 0) {
      this.flush().catch((err) => {
        console.error(
          `${LOG_PREFIX} Failed to flush on destroy:`,
          err instanceof Error ? err.message : String(err),
        );
      });
    }
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      void this.flush();
    }, FLUSH_DELAY_MS);
  }

  private async flush(): Promise<void> {
    const batch = [...this.pending.values()];
    this.pending.clear();
    this.flushTimer = null;

    if (batch.length === 0) return;

    try {
      if (batch.length === 1) {
        // Single item: use existing per-archive endpoint
        const item = batch[0]!;
        await this.apiClient.updateArchiveActions(item.archiveId, {
          ...(item.isLiked !== undefined && { isLiked: item.isLiked }),
          ...(item.isBookmarked !== undefined && { isBookmarked: item.isBookmarked }),
        });
        console.debug(`${LOG_PREFIX} Flushed 1 action (single endpoint):`, item.archiveId);
      } else {
        // Multiple items: use bulk endpoint
        const result = await this.apiClient.bulkUpdateArchiveActions(batch);
        console.debug(
          `${LOG_PREFIX} Flushed ${batch.length} actions (bulk endpoint):`,
          `${result.updatedIds.length} updated, ${result.failed.length} failed`,
        );
        if (result.failed.length > 0) {
          console.warn(`${LOG_PREFIX} Bulk flush partial failures:`, result.failed);
        }
      }
    } catch (err) {
      console.error(
        `${LOG_PREFIX} Flush failed:`,
        err instanceof Error ? err.message : String(err),
      );
      // Do not re-enqueue — the outbound services will detect the next
      // frontmatter change and re-enqueue if needed.
    }
  }
}
