import { Notice } from 'obsidian';
import type { WorkersAPIClient, UserArchive } from '../../services/WorkersAPIClient';
import type { PendingPost } from '../../services/SubscriptionManager';
import type { PostData } from '../../types/post';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Retry transient archive lookup misses (replication lag). */
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

  /** Schedule a callback after `delay` ms. Returns the timer id. */
  schedule: (callback: () => void, delay: number) => number;

  /** Show a user-visible notification. */
  notify: (message: string, timeout?: number) => void;
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
    try {
      this.scheduledMobileSyncRetries.delete(queueId);

      // 1. Fetch full archive data from server (with retries for transient 404 replication lag)
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
        return true;
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
        return true;
      } else {
        throw new Error('Failed to save to vault');
      }

    } catch (error) {
      if (this.isArchiveNotFoundError(error)) {
        const retryCount = (this.mobileSyncRetryCount.get(queueId) ?? 0) + 1;
        this.mobileSyncRetryCount.set(queueId, retryCount);

        if (retryCount >= MOBILE_SYNC_QUEUE_MAX_RETRIES) {
          console.warn('[Social Archiver] Archive not found after max retries; giving up', {
            queueId, archiveId, clientId, retryCount,
          });
          this.mobileSyncRetryCount.delete(queueId);
          this.failedSyncQueueIds.add(queueId); // Permanently skip this item for the rest of the session
          const apiClient = this.deps.apiClient();
          if (apiClient) {
            try {
              await apiClient.failSyncItem(queueId, clientId, `Archive ${archiveId} not found after ${retryCount} retries`);
            } catch { /* non-fatal */ }
          }
          return false;
        }

        console.warn('[Social Archiver] Archive not found during client sync; scheduling retry', {
          queueId, archiveId, clientId, retryCount, maxRetries: MOBILE_SYNC_QUEUE_MAX_RETRIES,
        });
        this.schedulePendingSyncRetry(queueId, archiveId);
        return false;
      }

      console.error('[Social Archiver] Client sync failed:', error);
      new Notice(`\u274C Failed to sync: ${error instanceof Error ? error.message : 'Unknown error'}`, 5000);

      // Report failure to server
      const apiClient = this.deps.apiClient();
      if (apiClient) {
        try {
          await apiClient.failSyncItem(queueId, clientId, error instanceof Error ? error.message : 'Unknown error');
        } catch {
          // Non-fatal
        }
      }
      return false;
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

      let successCount = 0;
      for (const item of pendingItems) {
        const success = await this.processSyncQueueItem(item.queueId, item.archiveId, clientId);
        if (success) {
          successCount++;
        }
      }

      if (successCount > 0) {
        console.debug(`[Social Archiver] Catch-up complete: ${successCount}/${pendingItems.length} synced`);
      }
    } catch (error) {
      console.error('[Social Archiver] Failed to process pending sync queue:', error);
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

  private async fetchUserArchiveWithRetry(archiveId: string): Promise<UserArchive> {
    const apiClient = this.deps.apiClient();
    if (!apiClient) {
      throw new Error('API client not initialized');
    }

    let lastError: unknown;

    for (let attempt = 1; attempt <= MOBILE_SYNC_ARCHIVE_FETCH_MAX_ATTEMPTS; attempt++) {
      try {
        const response = await apiClient.getUserArchive(archiveId);
        if (!response.archive) {
          throw new Error('Failed to fetch archive data');
        }
        return response.archive;
      } catch (error) {
        lastError = error;
        const shouldRetry = this.isArchiveNotFoundError(error) && attempt < MOBILE_SYNC_ARCHIVE_FETCH_MAX_ATTEMPTS;

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

  private schedulePendingSyncRetry(queueId: string, archiveId: string): void {
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
    }, MOBILE_SYNC_PENDING_RETRY_DELAY);
  }
}
