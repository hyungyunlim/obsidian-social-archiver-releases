import { Notice } from 'obsidian';
import type { WorkersAPIClient, UserArchive } from '../../services/WorkersAPIClient';
import type { PendingPost } from '../../services/SubscriptionManager';
import type { PostData } from '../../types/post';
import {
  isRateLimitError,
  getRetryAfterMs,
  type SyncRateLimitGate,
} from '../sync/SyncRateLimitCoordinator';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MOBILE_SYNC_ARCHIVE_FETCH_MAX_ATTEMPTS = 5;

/** Base delay (ms) for archive lookup retries. */
const MOBILE_SYNC_ARCHIVE_FETCH_RETRY_DELAY = 2000;

/** Re-run pending queue sync after not-found (ms). */
const MOBILE_SYNC_PENDING_RETRY_DELAY = 30000;

/**
 * Max queue-level retries per item before giving up.
 * Inner 5-attempt retry already covers replication lag.
 */
const MOBILE_SYNC_QUEUE_MAX_RETRIES = 1;

/**
 * Outcome of a single queue-item sync attempt. Rate-limited items are
 * deliberately NOT reported via failSyncItem: the server marks failed items
 * 'failed', GET /api/sync/queue only returns 'pending' items, and the plugin
 * never calls POST /api/sync/queue/retry — so a failed mark would orphan the
 * item until its 7-day TTL. Leaving it pending lets the scheduled catch-up
 * pick it up again.
 */
type SyncQueueItemOutcome =
  | 'saved'
  | 'acked-duplicate'
  | 'rate-limited'
  | 'retry-scheduled'
  | 'failed';

// ---------------------------------------------------------------------------
// Dependency interface
// ---------------------------------------------------------------------------

export interface MobileSyncServiceDeps {
  /** Returns the current WorkersAPIClient instance, or undefined if not initialised. */
  apiClient: () => WorkersAPIClient | undefined;

  /** Returns the subset of plugin settings needed by this service. */
  settings: () => { syncClientId: string; archivePath: string };

  /** Persist a PendingPost to the vault (handles media download, path generation, etc.). */
  saveSubscriptionPost: (post: PendingPost) => Promise<boolean>;

  /** Convert a server UserArchive into the local PostData format. */
  convertUserArchiveToPostData: (archive: UserArchive) => PostData;

  /** Returns true if the given URL was archived locally within the dedup window. */
  hasRecentlyArchivedUrl: (url: string | null | undefined) => boolean;

  /** Refresh the timeline view after a successful sync. */
  refreshTimelineView: () => void;

  /** Suppress timeline auto-refresh during batch operations. */
  suppressTimelineRefresh: () => void;

  /** Resume timeline auto-refresh after batch operations. */
  resumeTimelineRefresh: (triggerRefresh?: boolean) => void;

  /** Schedule a callback after `delay` ms. Returns the timer id. */
  schedule: (callback: () => void, delay: number) => number;

  /** Show a user-visible notification. */
  notify: (message: string, timeout?: number) => void;

  /**
   * Shared background-sync token bucket (SyncRateLimitCoordinator) so queue
   * drains don't blindly compete with the library/link-relation sync for the
   * server's per-user rate-limit bucket. Optional — absent in tests/legacy
   * wiring.
   */
  rateLimiter?: SyncRateLimitGate;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Handles syncing archives created on mobile (or other clients) into the
 * Obsidian vault.  Covers both real-time WebSocket events and catch-up polling
 * of the server sync queue.
 */
export class MobileSyncService {
  // -- internal state -------------------------------------------------------
  private isSyncingMobileQueue = false;
  private scheduledMobileSyncRetries = new Set<string>();
  private mobileSyncRetryCount = new Map<string, number>();
  private failedSyncQueueIds = new Set<string>();

  constructor(private readonly deps: MobileSyncServiceDeps) {}

  // -- public API -----------------------------------------------------------

  /**
   * Process a single sync queue item: fetch archive, save to vault, acknowledge.
   * Shared by real-time WebSocket handler and catch-up polling.
   */
  async processSyncQueueItem(queueId: string, archiveId: string, clientId: string): Promise<boolean> {
    const outcome = await this.processQueueItemInternal(queueId, archiveId, clientId, {
      suppressFailureNotice: false,
    });
    return outcome === 'saved' || outcome === 'acked-duplicate';
  }

  private async processQueueItemInternal(
    queueId: string,
    archiveId: string,
    clientId: string,
    options: { suppressFailureNotice: boolean },
  ): Promise<SyncQueueItemOutcome> {
    try {
      this.scheduledMobileSyncRetries.delete(queueId);

      const archive = await this.fetchUserArchiveWithRetry(archiveId);

      // 2. Dedup guard: skip if we recently archived this URL locally
      const syncUrl = archive.originalUrl;
      if (this.deps.hasRecentlyArchivedUrl(syncUrl)) {
        console.debug('[Social Archiver] Skipping duplicate sync for recently archived URL:', syncUrl);
        const apiClient = this.deps.apiClient();
        if (!apiClient) {
          throw new Error('API client not initialized');
        }
        await apiClient.ackSyncItem(queueId, clientId);
        return 'acked-duplicate';
      }

      // 3. Convert UserArchive to PostData format
      const postData = this.deps.convertUserArchiveToPostData(archive);

      // 4. Save to vault using saveSubscriptionPost (handles media download, file path generation, etc.)
      const pendingPost: PendingPost = {
        id: queueId,
        subscriptionId: `mobile-sync-${archiveId}`,
        subscriptionName: 'Mobile Sync',
        post: postData,
        destinationFolder: this.deps.settings().archivePath,
        archivedAt: new Date().toISOString(),
      };
      const saved = await this.deps.saveSubscriptionPost(pendingPost);

      if (saved) {
        // 5. Acknowledge sync completion
        const apiClient = this.deps.apiClient();
        if (!apiClient) {
          throw new Error('API client not initialized');
        }
        await apiClient.ackSyncItem(queueId, clientId);
        this.mobileSyncRetryCount.delete(queueId);
        const displayTitle = archive.title || archive.authorName || archive.platform || 'Archive';
        new Notice(`\u2705 Saved to vault: ${displayTitle}`, 3000);
        // Explicitly refresh timeline after single-item sync
        this.deps.refreshTimelineView();
        return 'saved';
      } else {
        throw new Error('Failed to save to vault');
      }

    } catch (error) {
      // Rate limit: leave the item PENDING on the server. failSyncItem would
      // mark it 'failed' \u2014 a state GET /api/sync/queue never returns and the
      // plugin never retries \u2014 so the item would silently expire after 7 days.
      // A scheduled catch-up (honoring Retry-After) re-drains the queue instead.
      if (isRateLimitError(error)) {
        this.deps.rateLimiter?.reportRateLimited(error);
        console.warn('[Social Archiver] Client sync rate-limited; leaving queue item pending', {
          queueId, archiveId, clientId,
        });
        this.schedulePendingSyncRetry(
          queueId,
          archiveId,
          Math.max(getRetryAfterMs(error), MOBILE_SYNC_PENDING_RETRY_DELAY),
        );
        return 'rate-limited';
      }

      if (this.isArchiveNotFoundError(error)) {
        const retryCount = (this.mobileSyncRetryCount.get(queueId) ?? 0) + 1;
        this.mobileSyncRetryCount.set(queueId, retryCount);

        if (retryCount >= MOBILE_SYNC_QUEUE_MAX_RETRIES) {
          console.warn('[Social Archiver] Archive not found during client sync; marking queue item failed', {
            queueId, archiveId, clientId, retryCount,
          });
          this.mobileSyncRetryCount.delete(queueId);
          this.failedSyncQueueIds.add(queueId); // Permanently skip this item for the rest of the session
          const apiClient = this.deps.apiClient();
          if (apiClient) {
            try {
              await apiClient.failSyncItem(queueId, clientId, `Archive ${archiveId} not found on server; it may have been deleted before sync`);
            } catch { /* non-fatal */ }
          }
          return 'failed';
        }

        console.warn('[Social Archiver] Archive not found during client sync; scheduling retry', {
          queueId, archiveId, clientId, retryCount, maxRetries: MOBILE_SYNC_QUEUE_MAX_RETRIES,
        });
        this.schedulePendingSyncRetry(queueId, archiveId);
        return 'retry-scheduled';
      }

      console.error('[Social Archiver] Client sync failed:', error);
      if (!options.suppressFailureNotice) {
        new Notice(`\u274C Failed to sync: ${error instanceof Error ? error.message : 'Unknown error'}`, 5000);
      }

      // Report failure to server
      const apiClient = this.deps.apiClient();
      if (apiClient) {
        try {
          await apiClient.failSyncItem(queueId, clientId, error instanceof Error ? error.message : 'Unknown error');
        } catch {
          // Non-fatal
        }
      }
      return 'failed';
    }
  }

  /**
   * Catch-up: poll pending sync queue items missed while Obsidian was offline.
   * Called on WebSocket reconnection and plugin startup.
   */
  async processPendingSyncQueue(): Promise<void> {
    const clientId = this.deps.settings().syncClientId;
    const apiClient = this.deps.apiClient();
    if (!clientId || !apiClient || this.isSyncingMobileQueue) {
      return;
    }

    this.isSyncingMobileQueue = true;

    try {
      const { items } = await apiClient.getSyncQueue(clientId);
      const pendingItems = items.filter(item => item.status === 'pending' && !this.failedSyncQueueIds.has(item.queueId));

      if (pendingItems.length === 0) {
        return;
      }

      console.debug(`[Social Archiver] Catch-up: ${pendingItems.length} pending sync item(s) found`);
      new Notice(`\uD83D\uDCF1 Syncing ${pendingItems.length} missed archive(s) from mobile...`, 4000);

      // Suppress timeline refresh during batch processing
      this.deps.suppressTimelineRefresh();

      let successCount = 0;
      let failedCount = 0;
      let rateLimited = false;
      for (const item of pendingItems) {
        const outcome = await this.processQueueItemInternal(item.queueId, item.archiveId, clientId, {
          // Per-item failure notices flood during large catch-ups — one
          // summary notice is emitted after the loop instead.
          suppressFailureNotice: true,
        });
        if (outcome === 'saved' || outcome === 'acked-duplicate') {
          successCount++;
        } else if (outcome === 'rate-limited') {
          // The remaining items would hit the same exhausted server bucket —
          // stop the batch. They stay 'pending' on the server and the retry
          // scheduled for the rate-limited item re-drains the whole queue.
          rateLimited = true;
          break;
        } else if (outcome === 'failed') {
          failedCount++;
        }
      }

      // Resume timeline refresh — trigger reload only if something was saved
      this.deps.resumeTimelineRefresh(successCount > 0);

      if (successCount > 0) {
        console.debug(`[Social Archiver] Catch-up complete: ${successCount}/${pendingItems.length} synced`);
      }

      if (rateLimited) {
        const deferredCount = pendingItems.length - successCount - failedCount;
        this.deps.notify(
          `⏳ Mobile sync paused by server rate limit — ${deferredCount} archive(s) will retry automatically.`,
          5000,
        );
      }
      if (failedCount > 0) {
        this.deps.notify(
          `❌ Failed to sync ${failedCount} archive(s) from mobile. See console for details.`,
          5000,
        );
      }
    } catch (error) {
      console.error('[Social Archiver] Failed to process pending sync queue:', error);
      // Ensure timeline refresh is resumed even on error
      this.deps.resumeTimelineRefresh(false);
    } finally {
      this.isSyncingMobileQueue = false;
    }
  }

  /** Reset all internal state (e.g. on sign-out). */
  clearState(): void {
    this.isSyncingMobileQueue = false;
    this.scheduledMobileSyncRetries.clear();
    this.mobileSyncRetryCount.clear();
    this.failedSyncQueueIds.clear();
  }

  // -- private helpers ------------------------------------------------------

  private isArchiveNotFoundError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const enriched = error as Error & { code?: string; status?: number };
    return enriched.status === 404 || enriched.code === 'ARCHIVE_NOT_FOUND' || /archive not found/i.test(enriched.message);
  }

  private isTerminalArchiveNotFoundError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const enriched = error as Error & { code?: string };
    return enriched.code === 'ARCHIVE_NOT_FOUND';
  }

  private async fetchUserArchiveWithRetry(archiveId: string): Promise<UserArchive> {
    const apiClient = this.deps.apiClient();
    if (!apiClient) {
      throw new Error('API client not initialized');
    }

    let lastError: unknown;

    for (let attempt = 1; attempt <= MOBILE_SYNC_ARCHIVE_FETCH_MAX_ATTEMPTS; attempt++) {
      try {
        await this.deps.rateLimiter?.acquire();
        const response = await apiClient.getUserArchive(archiveId);
        if (!response.archive) {
          throw new Error('Failed to fetch archive data');
        }
        return response.archive;
      } catch (error) {
        lastError = error;
        const shouldRetry =
          this.isArchiveNotFoundError(error) &&
          !this.isTerminalArchiveNotFoundError(error) &&
          attempt < MOBILE_SYNC_ARCHIVE_FETCH_MAX_ATTEMPTS;

        if (!shouldRetry) {
          throw error;
        }

        const delay = MOBILE_SYNC_ARCHIVE_FETCH_RETRY_DELAY * attempt;
        console.warn(
          `[Social Archiver] Archive ${archiveId} not available yet (attempt ${attempt}/${MOBILE_SYNC_ARCHIVE_FETCH_MAX_ATTEMPTS}), retrying in ${delay}ms`
        );
        await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to fetch archive data');
  }

  private schedulePendingSyncRetry(
    queueId: string,
    archiveId: string,
    delayMs: number = MOBILE_SYNC_PENDING_RETRY_DELAY,
  ): void {
    if (this.scheduledMobileSyncRetries.has(queueId)) {
      return;
    }

    this.scheduledMobileSyncRetries.add(queueId);
    this.deps.schedule(() => {
      this.scheduledMobileSyncRetries.delete(queueId);
      this.processPendingSyncQueue().catch((error: unknown) => {
        console.error('[Social Archiver] Deferred mobile sync retry failed:', {
          queueId,
          archiveId,
          error,
        });
      });
    }, delayMs);
  }
}
