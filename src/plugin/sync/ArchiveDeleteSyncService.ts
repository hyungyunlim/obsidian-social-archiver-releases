/**
 * ArchiveDeleteSyncService
 *
 * Handles bidirectional archive delete sync between the local Obsidian vault
 * and the Social Archiver server.
 *
 * Responsibilities:
 *
 * A. Outbound delete (vault → server):
 *    - Triggered when ArchiveLookupService emits a deleted ArchiveFileIdentity.
 *    - Enqueues a PendingArchiveDeleteEntry into settings.
 *    - Optionally shows a DeleteConfirmModal before enqueuing.
 *    - flushPendingDeletes() drains the queue via the server API.
 *
 * B. Inbound delete (server → vault):
 *    - Called by RealtimeEventBridge and ArchiveLibrarySyncService.
 *    - Finds the corresponding vault file and sends it to trash.
 *    - Adds the archiveId to a suppression map so the resulting vault delete
 *      event does NOT trigger an outbound delete back to the server (loop guard).
 *
 * Single Responsibility: archive delete sync orchestration
 */

import type { App, TFile } from 'obsidian';
import type { WorkersAPIClient } from '../../services/WorkersAPIClient';
import type {
  SocialArchiverSettings,
  DeleteSyncSettings,
  PendingArchiveDeleteEntry,
} from '../../types/settings';
import { showDeleteConfirmModal } from './DeleteConfirmModal';

// ============================================================================
// Interfaces (provided by other agents / parallel modules)
// ============================================================================

/**
 * Identifies a vault file that was deleted and its corresponding server record.
 * Emitted by ArchiveLookupService.onArchivedFileDeleted().
 */
export interface ArchiveFileIdentity {
  path: string;
  archiveId?: string;
  originalUrl?: string;
}

// Re-export for consumers that imported from this module
export type { DeleteSyncSettings, PendingArchiveDeleteEntry };

// ============================================================================
// Constants
// ============================================================================

/** Suppression TTL: ignore outbound delete events triggered by inbound deletes. */
const SUPPRESSION_TTL_MS = 30_000;

/** Retry interval for deferred flush attempts while library sync is active. */
const DEFERRED_FLUSH_RETRY_MS = 5_000;

/** Maximum deletes per flush call — prevents mass deletion when queue grows large. */
const MAX_FLUSH_BATCH_SIZE = 10;

/** Maximum pending queue size — stops enqueuing beyond this to prevent unbounded growth. */
const MAX_QUEUE_SIZE = 20;

/** Log prefix for all messages from this service. */
const LOG_PREFIX = '[Social Archiver] [DeleteSync]';

// ============================================================================
// Dependency injection
// ============================================================================

export interface ArchiveDeleteSyncDeps {
  /** Returns the current WorkersAPIClient instance, or undefined if not initialised. */
  apiClient: () => WorkersAPIClient | undefined;

  /** Returns current plugin settings (live reference). */
  settings: () => SocialArchiverSettings;

  /** Persist settings to disk. Caller wires this to saveSettingsPartial({}, { reinitialize: false }). */
  saveSettings: () => Promise<void>;

  /** Obsidian App instance (for fileManager.trashFile and modal). */
  app: App;

  /** Tier-1 lookup: find vault file by stable server-assigned archive ID. */
  findBySourceArchiveId: (id: string) => TFile | null;

  /** Tier-2 lookup: find vault files by original URL (may return multiple). */
  findByOriginalUrl: (url: string) => TFile[];

  /**
   * Returns true if a library sync run is currently in progress.
   * Server deletes are deferred until the sync is idle to avoid race conditions.
   */
  isLibrarySyncRunning: () => boolean;

  /** Show a user-visible notification. */
  notify: (message: string, timeout?: number) => void;
}

// ============================================================================
// Service
// ============================================================================

export class ArchiveDeleteSyncService {
  // -- Single-flight guard ---------------------------------------------------
  private isFlushing = false;

  // -- Deferred flush retry --------------------------------------------------
  private deferredFlushTimer: ReturnType<typeof setTimeout> | null = null;

  // -- Inbound-delete loop prevention ---------------------------------------
  /**
   * Maps archiveId → expiry timestamp (ms since epoch).
   *
   * When the service moves a file to trash in response to a server delete
   * event (inbound), the archiveId is suppressed here so the resulting vault
   * `delete` event does NOT trigger an outbound delete back to the server.
   */
  private suppressedInboundDeleteIds = new Map<string, number>();

  // -- Subscription cleanup -------------------------------------------------
  private unsubscribeFileDeleted: (() => void) | null = null;

  constructor(private readonly deps: ArchiveDeleteSyncDeps) {}

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Subscribe to ArchiveLookupService file-deleted events.
   * Must be called after ArchiveLookupService is initialised.
   *
   * @param onArchivedFileDeleted - The subscription method from ArchiveLookupService.
   *   Pass `archiveLookupService.onArchivedFileDeleted.bind(archiveLookupService)`.
   */
  initialize(
    onArchivedFileDeleted: (handler: (identity: ArchiveFileIdentity) => void) => () => void
  ): void {
    this.unsubscribeFileDeleted = onArchivedFileDeleted(
      (identity) => { void this.handleOutboundDelete(identity); }
    );
  }

  /**
   * Unsubscribe from file-deleted events and cancel any pending flush.
   * Call from plugin onunload() or on sign-out.
   */
  dispose(): void {
    if (this.unsubscribeFileDeleted) {
      this.unsubscribeFileDeleted();
      this.unsubscribeFileDeleted = null;
    }
    if (this.deferredFlushTimer !== null) {
      clearTimeout(this.deferredFlushTimer);
      this.deferredFlushTimer = null;
    }
    this.suppressedInboundDeleteIds.clear();
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Returns true if the given archiveId has a pending outbound delete queued.
   *
   * Used by ArchiveLibrarySyncService (Tier 0) to skip re-saving an archive
   * that the user has already queued for deletion.
   */
  isArchiveQueuedForDeletion(archiveId: string): boolean {
    const settings = this.deps.settings();
    const queue = this.getQueue(settings);
    return queue.some((entry) => entry.archiveId === archiveId);
  }

  /**
   * Returns the number of pending outbound delete requests in the queue.
   */
  getPendingCount(): number {
    const settings = this.deps.settings();
    return this.getQueue(settings).length;
  }

  /**
   * Clear the pending delete queue and drop all suppression state.
   * Called on sign-out to avoid processing stale queue entries for a different user.
   */
  cancelAndClear(): void {
    const settings = this.deps.settings();
    this.setQueue(settings, []);
    if (this.deferredFlushTimer !== null) {
      clearTimeout(this.deferredFlushTimer);
      this.deferredFlushTimer = null;
    }
    this.suppressedInboundDeleteIds.clear();
    // Save asynchronously — best effort on sign-out
    this.deps.saveSettings().catch((err: unknown) => {
      console.warn(`${LOG_PREFIX} cancelAndClear: saveSettings failed`, err);
    });
  }

  // --------------------------------------------------------------------------
  // Outbound delete (vault → server)
  // --------------------------------------------------------------------------

  /**
   * Called by ArchiveLookupService when a tracked archive file is deleted.
   *
   * Does nothing if:
   * - The archiveId is suppressed (was deleted by an inbound delete event)
   * - outboundEnabled is false
   * - Auth credentials are missing
   */
  private async handleOutboundDelete(identity: ArchiveFileIdentity): Promise<void> {
    // Clean up any expired suppression entries first
    this.purgeExpiredSuppressions();

    // Loop guard: was this delete triggered by our own inbound delete?
    if (identity.archiveId && this.consumeSuppression(identity.archiveId)) {
      console.debug(`${LOG_PREFIX} Outbound delete suppressed (inbound loop guard)`, {
        archiveId: identity.archiveId,
      });
      return;
    }

    const settings = this.deps.settings();

    // Feature flag
    if (!settings.deleteSync?.outboundEnabled) {
      console.debug(`${LOG_PREFIX} Outbound delete disabled — skipping`, {
        archiveId: identity.archiveId,
      });
      return;
    }

    // Auth guard
    if (!this.isAuthenticated(settings)) {
      console.debug(`${LOG_PREFIX} Not authenticated — skipping outbound delete`, {
        archiveId: identity.archiveId,
        originalUrl: identity.originalUrl,
      });
      return;
    }

    const resolvedArchiveIds = await this.resolveArchiveIds(identity);
    if (resolvedArchiveIds.length === 0) {
      console.warn(`${LOG_PREFIX} Unable to resolve archiveId for deleted file — skipping`, {
        path: identity.path,
        originalUrl: identity.originalUrl,
      });
      return;
    }

    // Safety guard: refuse to grow the queue beyond MAX_QUEUE_SIZE to prevent
    // unbounded accumulation that could cause mass server deletion on flush.
    const currentQueue = this.getQueue(settings);
    if (currentQueue.length >= MAX_QUEUE_SIZE) {
      console.warn(
        `${LOG_PREFIX} Delete queue at safety limit (${currentQueue.length}/${MAX_QUEUE_SIZE}) — additional deletes will not be synced to server`,
        { archiveIds: resolvedArchiveIds.map((id) => id) }
      );
      this.deps.notify(
        `Delete sync queue full (${MAX_QUEUE_SIZE} items) — this vault deletion will not be synced to server. ` +
        `Go to Settings → Sync to manage pending deletes.`,
        8000,
      );
      return;
    }

    // Always enqueue first so an in-flight library sync can see the tombstones
    // and avoid re-importing the same archive in the current run.
    for (const archiveId of resolvedArchiveIds) {
      const resolvedIdentity: ArchiveFileIdentity = {
        ...identity,
        archiveId,
      };
      await this.enqueue(resolvedIdentity, settings);
    }

    // Defer the server DELETE until library sync is idle. This preserves the
    // stable paging window while still honoring the local delete intent.
    if (this.deps.isLibrarySyncRunning()) {
      console.debug(`${LOG_PREFIX} Library sync running — deferred server delete`, {
        archiveIds: resolvedArchiveIds,
      });
      this.scheduleDeferredFlush();
      return;
    }

    await this.flushPendingDeletes();
  }

  /**
   * Add an entry to the pending delete queue and persist settings.
   */
  private async enqueue(
    identity: ArchiveFileIdentity,
    settings: SocialArchiverSettings
  ): Promise<void> {
    if (!identity.archiveId) {
      throw new Error('enqueue requires a resolved archiveId');
    }

    const queue = this.getQueue(settings);

    // Avoid duplicate entries for the same archiveId
    if (queue.some((entry) => entry.archiveId === identity.archiveId)) {
      console.debug(`${LOG_PREFIX} Already queued — skipping duplicate enqueue`, {
        archiveId: identity.archiveId,
      });
      return;
    }

    const entry: PendingArchiveDeleteEntry = {
      archiveId: identity.archiveId,
      username: settings.username,
      queuedAt: new Date().toISOString(),
      retryCount: 0,
      originalPath: identity.path,
    };

    queue.push(entry);
    this.setQueue(settings, queue);

    await this.deps.saveSettings();

    console.debug(`${LOG_PREFIX} Enqueued outbound delete`, {
      archiveId: identity.archiveId,
      path: identity.path,
      queueDepth: queue.length,
    });
  }

  // --------------------------------------------------------------------------
  // Queue flush
  // --------------------------------------------------------------------------

  /**
   * Process the pending delete queue sequentially.
   *
   * - Single-flight: concurrent calls are no-ops.
   * - Processes items in queuedAt ascending order (FIFO).
   * - Only processes items matching the current settings.username.
   * - Stops on 401 (auth error) or transient errors (429/5xx/network).
   * - Removes items on success (2xx) or permanent failure (403, 404).
   */
  async flushPendingDeletes(): Promise<void> {
    if (this.isFlushing) {
      console.debug(`${LOG_PREFIX} flushPendingDeletes called while already flushing — ignored`);
      return;
    }

    if (this.deps.isLibrarySyncRunning()) {
      console.debug(`${LOG_PREFIX} Library sync running — deferring flushPendingDeletes`);
      this.scheduleDeferredFlush();
      return;
    }

    const apiClient = this.deps.apiClient();
    if (!apiClient) {
      console.debug(`${LOG_PREFIX} No API client — cannot flush`);
      return;
    }

    const settings = this.deps.settings();
    if (!this.isAuthenticated(settings)) {
      console.debug(`${LOG_PREFIX} Not authenticated — cannot flush`);
      return;
    }

    const currentUsername = settings.username;
    const queue = this.getQueue(settings);

    // Filter to entries for the current user and sort by queuedAt ascending (FIFO)
    const eligible = queue
      .filter((entry) => entry.username === currentUsername)
      .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));

    if (eligible.length === 0) {
      return;
    }

    // -----------------------------------------------------------------------
    // Confirmation gate: ask the user before sending server deletes
    // -----------------------------------------------------------------------
    const deleteSettings = settings.deleteSync;
    // Safety cap: only process up to MAX_FLUSH_BATCH_SIZE per flush to prevent
    // mass deletion when queue has grown large (e.g., from offline accumulation).
    const batchSize = Math.min(eligible.length, MAX_FLUSH_BATCH_SIZE);
    const remaining = eligible.length - batchSize;

    if (deleteSettings?.confirmBeforeServerDelete) {
      const result = await showDeleteConfirmModal(this.deps.app, batchSize);

      // Persist "don't ask again" preference
      if (result.dontAskAgain && deleteSettings) {
        deleteSettings.confirmBeforeServerDelete = false;
        await this.deps.saveSettings();
      }

      if (result.action === 'keep-on-server') {
        // User chose to keep server copies — clear ALL eligible entries for
        // the current user (not just the batch), since the intent is to keep
        // everything. Entries for other users (if any) are preserved.
        const eligibleIds = new Set(eligible.map((e) => e.archiveId));
        const remaining = queue.filter((e) => !eligibleIds.has(e.archiveId));
        this.setQueue(settings, remaining);
        await this.deps.saveSettings();
        console.debug(
          `${LOG_PREFIX} User chose "Keep on Server" — cleared ${eligible.length} pending deletes`,
        );
        return;
      }
    }

    const batch = eligible.slice(0, batchSize);
    if (remaining > 0) {
      console.warn(
        `${LOG_PREFIX} Flush capped at ${MAX_FLUSH_BATCH_SIZE} — ${remaining} remaining in queue`,
      );
    }

    this.isFlushing = true;

    try {
      for (const entry of batch) {
        const shouldStop = await this.processQueueEntry(entry, apiClient);
        if (shouldStop) {
          console.debug(`${LOG_PREFIX} Flush stopped early`, {
            archiveId: entry.archiveId,
          });
          break;
        }
      }
    } finally {
      this.isFlushing = false;

      // If items remain in the queue after this batch, schedule a deferred
      // follow-up flush so the queue eventually drains in increments.
      if (remaining > 0) {
        this.scheduleDeferredFlush();
      }
    }
  }

  /**
   * Attempt to delete a single queued archive on the server.
   *
   * @returns true if the flush loop should stop, false to continue.
   */
  private async processQueueEntry(
    entry: PendingArchiveDeleteEntry,
    apiClient: WorkersAPIClient
  ): Promise<boolean> {
    try {
      await apiClient.deleteArchive(entry.archiveId);

      // Success — remove from queue
      await this.removeFromQueue(entry.archiveId);

      console.debug(`${LOG_PREFIX} Outbound delete succeeded`, {
        archiveId: entry.archiveId,
      });

      return false; // continue
    } catch (error: unknown) {
      const status = this.extractStatus(error);

      if (status === 404) {
        // Archive doesn't exist on server — treat as success (remove from queue)
        console.debug(`${LOG_PREFIX} Archive not found on server (404) — removing from queue`, {
          archiveId: entry.archiveId,
        });
        await this.removeFromQueue(entry.archiveId);
        return false; // continue
      }

      if (status === 401) {
        // Auth failure — stop flush, keep entry in queue
        console.warn(`${LOG_PREFIX} Auth failure (401) — stopping flush`, {
          archiveId: entry.archiveId,
        });
        await this.updateQueueEntry(entry, error);
        return true; // stop
      }

      if (status === 403) {
        // Forbidden — terminal, remove from queue
        console.warn(`${LOG_PREFIX} Forbidden (403) — removing from queue (terminal)`, {
          archiveId: entry.archiveId,
        });
        await this.removeFromQueue(entry.archiveId);
        return false; // continue with next item
      }

      // Transient error (429, 5xx, network) — increment retry and stop flush
      console.warn(`${LOG_PREFIX} Transient error during flush`, {
        archiveId: entry.archiveId,
        status,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.updateQueueEntry(entry, error);
      return true; // stop
    }
  }

  // --------------------------------------------------------------------------
  // Inbound delete (server → vault)
  // --------------------------------------------------------------------------

  /**
   * Called by RealtimeEventBridge (WebSocket) or ArchiveLibrarySyncService
   * when the server reports that an archive has been deleted.
   *
   * @param archiveId - Stable server archive ID.
   * @param originalUrl - Optional original URL for fallback lookup.
   * @param source - 'ws' (WebSocket realtime) or 'delta' (library sync delta sweep).
   */
  async handleInboundDelete(
    archiveId: string,
    originalUrl?: string,
    source?: 'ws' | 'delta'
  ): Promise<void> {
    const settings = this.deps.settings();

    if (!settings.deleteSync?.inboundEnabled) {
      console.debug(`${LOG_PREFIX} Inbound delete disabled — skipping`, {
        archiveId,
        source,
      });
      return;
    }

    // Find the vault file
    const file = this.findVaultFile(archiveId, originalUrl);
    if (!file) {
      console.debug(`${LOG_PREFIX} Inbound delete: file not found in vault — already deleted or not archived`, {
        archiveId,
        originalUrl,
        source,
      });
      return;
    }

    // Suppress the resulting vault delete event so it does NOT trigger an
    // outbound delete back to the server (loop guard).
    this.suppressInboundDelete(archiveId);

    try {
      await this.deps.app.fileManager.trashFile(file);
      console.debug(`${LOG_PREFIX} Inbound delete: moved to trash`, {
        archiveId,
        path: file.path,
        source,
      });

      this.deps.notify(
        `Deleted from vault: "${file.basename}" (deleted on server)`,
        4000
      );
    } catch (error: unknown) {
      // If trash fails, clear the suppression so the user can retry manually
      this.suppressedInboundDeleteIds.delete(archiveId);
      console.error(`${LOG_PREFIX} Inbound delete: trashFile failed`, {
        archiveId,
        path: file.path,
        error,
      });
    }
  }

  // --------------------------------------------------------------------------
  // Suppression helpers
  // --------------------------------------------------------------------------

  /**
   * Register an archiveId as "inbound-deleted" so the next vault delete event
   * for it is ignored and does NOT trigger an outbound delete.
   *
   * TTL: 30 seconds (SUPPRESSION_TTL_MS).
   */
  private suppressInboundDelete(archiveId: string): void {
    this.suppressedInboundDeleteIds.set(archiveId, Date.now() + SUPPRESSION_TTL_MS);
  }

  /**
   * Check whether the archiveId is currently suppressed and consume the entry.
   *
   * @returns true if the archiveId was suppressed (and is now consumed), false otherwise.
   */
  private consumeSuppression(archiveId: string): boolean {
    const expiresAt = this.suppressedInboundDeleteIds.get(archiveId);
    if (expiresAt === undefined) return false;

    if (Date.now() >= expiresAt) {
      // Expired — clean up and treat as NOT suppressed
      this.suppressedInboundDeleteIds.delete(archiveId);
      return false;
    }

    // Valid suppression — consume and return true
    this.suppressedInboundDeleteIds.delete(archiveId);
    return true;
  }

  /**
   * Remove expired entries from the suppression map.
   * Called on each outbound delete attempt.
   */
  private purgeExpiredSuppressions(): void {
    const now = Date.now();
    for (const [archiveId, expiresAt] of this.suppressedInboundDeleteIds) {
      if (now >= expiresAt) {
        this.suppressedInboundDeleteIds.delete(archiveId);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Queue helpers (settings-based persistence)
  // --------------------------------------------------------------------------

  /**
   * Read the pending delete queue from settings.
   * Returns an empty array if the field is absent or malformed.
   */
  private getQueue(settings: SocialArchiverSettings): PendingArchiveDeleteEntry[] {
    const raw = (settings as unknown as Record<string, unknown>)['pendingArchiveDeletes'];
    if (!Array.isArray(raw)) return [];
    return raw as PendingArchiveDeleteEntry[];
  }

  /**
   * Write the pending delete queue back into settings (in-memory only).
   * Caller must call saveSettings() to persist.
   */
  private setQueue(settings: SocialArchiverSettings, queue: PendingArchiveDeleteEntry[]): void {
    (settings as unknown as Record<string, unknown>)['pendingArchiveDeletes'] = queue;
  }

  /** Remove a queued entry by archiveId and persist settings. */
  private async removeFromQueue(archiveId: string): Promise<void> {
    const settings = this.deps.settings();
    const queue = this.getQueue(settings);
    const filtered = queue.filter((entry) => entry.archiveId !== archiveId);
    this.setQueue(settings, filtered);
    await this.deps.saveSettings();
  }

  /**
   * Increment retryCount and set lastError/lastAttemptAt on a queued entry,
   * then persist settings.
   */
  private async updateQueueEntry(
    entry: PendingArchiveDeleteEntry,
    error: unknown
  ): Promise<void> {
    const settings = this.deps.settings();
    const queue = this.getQueue(settings);
    const idx = queue.findIndex((e) => e.archiveId === entry.archiveId);
    if (idx === -1) return;

    const updated: PendingArchiveDeleteEntry = {
      // Non-null assertion safe: idx !== -1 guarantees element exists
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      ...queue[idx]!,
      retryCount: entry.retryCount + 1,
      lastAttemptAt: new Date().toISOString(),
      lastError: error instanceof Error ? error.message : String(error),
    };
    queue[idx] = updated;
    this.setQueue(settings, queue);
    await this.deps.saveSettings();
  }

  /**
   * Resolve the stable server archive IDs for a deleted vault file.
   *
   * Prefer the ID captured in the vault index. If the note predates
   * `sourceArchiveId`, fall back to a server lookup by `originalUrl`.
   *
   * For legacy notes without a stable ID, multiple server matches indicate
   * duplicate archives for the same original URL. In that case we queue all
   * matching archive IDs so the post does not reappear via library sync.
   */
  private async resolveArchiveIds(identity: ArchiveFileIdentity): Promise<string[]> {
    if (identity.archiveId && identity.archiveId.length > 0) {
      return [identity.archiveId];
    }

    if (!identity.originalUrl) {
      return [];
    }

    const apiClient = this.deps.apiClient();
    if (!apiClient) {
      return [];
    }

    try {
      const matchedArchives = await this.fetchArchivesByOriginalUrl(apiClient, identity.originalUrl);
      const matchedIds = [...new Set(
        matchedArchives
          .map((archive) => archive.id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      )];

      if (matchedIds.length > 1) {
        // Safety: refuse to delete when URL matches multiple server archives.
        // Deleting all would risk removing re-archived or updated content.
        console.warn(`${LOG_PREFIX} originalUrl matched multiple server archives — skipping to avoid unintended data loss`, {
          path: identity.path,
          originalUrl: identity.originalUrl,
          matchCount: matchedIds.length,
          archiveIds: matchedIds,
        });
        return [];
      }

      return matchedIds;
    } catch (error) {
      console.warn(`${LOG_PREFIX} Failed to resolve archiveId for deleted file`, {
        path: identity.path,
        originalUrl: identity.originalUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return [];
  }

  private async fetchArchivesByOriginalUrl(
    apiClient: WorkersAPIClient,
    originalUrl: string,
  ): Promise<Array<{ id: string }>> {
    const MAX_PAGES = 5; // Safety cap: max 250 archives per URL lookup
    const archives: Array<{ id: string }> = [];
    let offset = 0;
    let pagesFetched = 0;

    while (pagesFetched < MAX_PAGES) {
      const response = await apiClient.getUserArchives({
        originalUrl,
        limit: 50,
        offset,
      });

      archives.push(...response.archives);
      pagesFetched += 1;

      if (!response.hasMore || response.archives.length === 0) {
        break;
      }

      offset += response.archives.length;
    }

    return archives;
  }

  private scheduleDeferredFlush(): void {
    if (this.deferredFlushTimer !== null) {
      return;
    }

    this.deferredFlushTimer = setTimeout(() => {
      this.deferredFlushTimer = null;
      void this.flushPendingDeletes();
    }, DEFERRED_FLUSH_RETRY_MS);
  }

  // --------------------------------------------------------------------------
  // Lookup helpers
  // --------------------------------------------------------------------------

  /**
   * Find the vault file for an inbound delete event.
   * Tier-1: by archiveId. Tier-2: by originalUrl (single match only).
   * Returns null if not found or if the URL lookup is ambiguous.
   */
  private findVaultFile(archiveId: string, originalUrl?: string): TFile | null {
    // Tier-1: stable ID lookup
    const byId = this.deps.findBySourceArchiveId(archiveId);
    if (byId) return byId;

    // Tier-2: URL fallback (single match only — ambiguous = skip)
    if (originalUrl) {
      const byUrl = this.deps.findByOriginalUrl(originalUrl);
      if (byUrl.length === 1) {
        // byUrl[0] is defined when length === 1
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return byUrl[0]!;
      }
      if (byUrl.length > 1) {
        console.warn(`${LOG_PREFIX} Inbound delete: ambiguous URL match — skipping`, {
          archiveId,
          originalUrl,
          matchCount: byUrl.length,
        });
      }
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Auth helpers
  // --------------------------------------------------------------------------

  private isAuthenticated(settings: SocialArchiverSettings): boolean {
    return (
      !!this.deps.apiClient() &&
      typeof settings.authToken === 'string' && settings.authToken.length > 0 &&
      typeof settings.username === 'string' && settings.username.length > 0
    );
  }

  // --------------------------------------------------------------------------
  // Error helpers
  // --------------------------------------------------------------------------

  /**
   * Extract an HTTP status code from an unknown thrown value, if present.
   * Returns undefined for non-HTTP errors (e.g. network failures).
   */
  private extractStatus(error: unknown): number | undefined {
    if (error instanceof Error) {
      const enriched = error as Error & { status?: number };
      return enriched.status;
    }
    return undefined;
  }
}
