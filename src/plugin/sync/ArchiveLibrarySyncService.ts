/**
 * ArchiveLibrarySyncService
 *
 * Syncs the user's full server-side archive library into the local Obsidian vault.
 *
 * Responsibilities:
 * - Paginated fetch of server archives with stable window (archivedBefore anchor)
 * - Three-tier duplicate detection:
 *   1. findBySourceArchiveId → exact match, skip
 *   2. findByOriginalUrl → 1 match, backfill identity, skip  (or conflict → skip)
 *              → 2+ matches → ambiguous, skip
 *   3. No match → save, then indexSavedFile
 * - Checkpoint persistence (resumeOffset) after each page
 * - Final delta sweep with updatedAfter for archives added during the run
 * - Single-flight guard, AbortController-based cancellation
 * - Exponential backoff retry (3 attempts) per page fetch
 *
 * Single Responsibility: archive library sync orchestration
 */

import type { TFile } from 'obsidian';
import type { WorkersAPIClient, UserArchive } from '../../services/WorkersAPIClient';
import type { PendingPost } from '../../services/SubscriptionManager';
import type { PostData } from '../../types/post';
import type { SocialArchiverSettings } from '../../types/settings';

// ============================================================================
// Constants
// ============================================================================

/** Archives fetched per API page. */
const LIBRARY_SYNC_PAGE_SIZE = 50;

/** Inter-page delay (ms) to be polite to the server. */
const LIBRARY_SYNC_INTER_PAGE_DELAY_MS = 500;

/** Max retry attempts per page fetch. */
const LIBRARY_SYNC_MAX_PAGE_RETRIES = 3;

/** Base delay for exponential backoff (ms). */
const LIBRARY_SYNC_RETRY_BASE_DELAY_MS = 1000;

// ============================================================================
// Interface contracts (implemented by other agents / parallel modules)
// ============================================================================

/** Result returned by saveSubscriptionPostDetailed (Pipeline agent). */
export interface SavePendingPostResult {
  status: 'created' | 'existing' | 'skipped' | 'failed';
  file?: TFile;
  path?: string;
  reason?: string;
}

// ============================================================================
// Public types
// ============================================================================

/** What triggered this sync run. */
export type ArchiveLibrarySyncMode = 'bootstrap' | 'resume' | 'manual-reconcile';

/** Phase within a sync run. */
export type ArchiveLibrarySyncPhase = 'idle' | 'scanning' | 'delta-sweep' | 'completed' | 'error';

/** Snapshot of the runtime state — emitted on each progress event. */
export interface ArchiveLibrarySyncRuntimeState {
  mode: ArchiveLibrarySyncMode;
  phase: ArchiveLibrarySyncPhase;
  totalServerArchives: number | null;
  scannedCount: number;
  savedCount: number;
  skippedCount: number;
  ambiguousCount: number;
  failedCount: number;
  currentOffset: number;
  startedAt: string | null;
  lastError: string | null;
}

/** Callback type for progress updates. */
export type ArchiveLibrarySyncProgressCallback = (state: ArchiveLibrarySyncRuntimeState) => void;

// ============================================================================
// Dependency injection interface
// ============================================================================

export interface ArchiveLibrarySyncDeps {
  /** Returns the current WorkersAPIClient instance, or undefined if not initialised. */
  apiClient: () => WorkersAPIClient | undefined;

  /** Returns current plugin settings. */
  settings: () => SocialArchiverSettings;

  /** Persist settings to disk. */
  saveSettings: () => Promise<void>;

  /** Tier-1 lookup: find vault file by stable server-assigned archive ID. */
  findBySourceArchiveId: (id: string) => TFile | null;

  /** Tier-2 lookup: find vault files by original URL (may return multiple). */
  findByOriginalUrl: (url: string) => TFile[];

  /**
   * Write sourceArchiveId + originalUrl into a file's frontmatter index
   * (optimistic in-memory update only — no disk write needed for dedup).
   */
  indexSavedFile: (
    file: TFile,
    data: { sourceArchiveId?: string; originalUrl?: string }
  ) => void;

  /**
   * Backfill the `sourceArchiveId` frontmatter field on an existing file
   * that was matched by URL and has no stable ID yet.
   */
  backfillFileIdentity: (file: TFile, archiveId: string) => Promise<void>;

  /** Save a pending post to vault (handles media download, markdown conversion, etc.). */
  saveSubscriptionPostDetailed: (post: PendingPost) => Promise<SavePendingPostResult>;

  /** Convert a server UserArchive into the local PostData format. */
  convertUserArchiveToPostData: (archive: UserArchive) => PostData;

  /** Show a user-visible notification. */
  notify: (message: string, timeout?: number) => void;

  /**
   * Tier 0: check if an archive is queued for outbound deletion.
   * Wired to ArchiveDeleteSyncService.isArchiveQueuedForDeletion().
   */
  isArchiveQueuedForDeletion?: (archiveId: string) => boolean;

  /**
   * Apply inbound deletes for archive IDs reported as deleted in the delta sweep.
   * Wired to a function that calls ArchiveDeleteSyncService.handleInboundDelete()
   * for each ID.
   */
  applyInboundDeletedIds?: (deletedIds: string[], source: 'delta') => Promise<void>;

  /**
   * Tier 1.5 lookup: find vault file by clientPostId frontmatter field.
   * Used to prevent duplicate import of composed posts during the race window
   * between server create and sourceArchiveId frontmatter write.
   */
  findByClientPostId?: (clientPostId: string) => TFile | null;
}

// ============================================================================
// Service
// ============================================================================

export class ArchiveLibrarySyncService {
  // -- Runtime state (not persisted) ----------------------------------------
  private isSyncing = false;
  private abortController: AbortController | null = null;
  private runtimeState: ArchiveLibrarySyncRuntimeState = this.makeInitialState();
  private progressCallbacks: Set<ArchiveLibrarySyncProgressCallback> = new Set();

  constructor(private readonly deps: ArchiveLibrarySyncDeps) {}

  // -- Public API ------------------------------------------------------------

  /**
   * Subscribe to runtime state updates.
   * Returns an unsubscribe function.
   */
  onProgress(callback: ArchiveLibrarySyncProgressCallback): () => void {
    this.progressCallbacks.add(callback);
    return () => { this.progressCallbacks.delete(callback); };
  }

  /** Snapshot of the current runtime state. */
  getState(): Readonly<ArchiveLibrarySyncRuntimeState> {
    return { ...this.runtimeState };
  }

  /** Whether a sync is currently running. */
  get isRunning(): boolean {
    return this.isSyncing;
  }

  /**
   * Start (or resume) a library sync run.
   *
   * @param mode  Explicit mode override. If omitted, the mode is derived from
   *              persisted settings (bootstrap / resume / manual-reconcile).
   */
  async startSync(mode?: ArchiveLibrarySyncMode): Promise<void> {
    // Single-flight guard
    if (this.isSyncing) {
      console.debug('[Social Archiver] [LibrarySync] startSync called while already running — ignored');
      return;
    }

    const apiClient = this.deps.apiClient();
    const settings = this.deps.settings();

    if (!apiClient) {
      console.warn('[Social Archiver] [LibrarySync] Cannot start: API client not initialised');
      return;
    }

    if (!settings.authToken) {
      console.warn('[Social Archiver] [LibrarySync] Cannot start: not authenticated');
      return;
    }

    if (!settings.syncClientId) {
      console.warn('[Social Archiver] [LibrarySync] Cannot start: no syncClientId — register sync client first');
      return;
    }

    this.isSyncing = true;
    this.abortController = new AbortController();

    const resolvedMode = mode ?? this.resolveMode(settings);
    const resumeOffset = settings.archiveLibrarySync?.resumeOffset ?? 0;

    this.updateState({
      mode: resolvedMode,
      phase: 'scanning',
      totalServerArchives: null,
      scannedCount: resumeOffset,
      savedCount: 0,
      skippedCount: 0,
      ambiguousCount: 0,
      failedCount: 0,
      currentOffset: resumeOffset,
      startedAt: new Date().toISOString(),
      lastError: null,
    });

    await this.persistStatus('running');

    console.debug('[Social Archiver] [LibrarySync] Starting sync', {
      mode: resolvedMode,
      resumeOffset,
    });

    try {
      await this.runSync(resumeOffset);
    } catch (error) {
      if (this.isAbortError(error)) {
        console.debug('[Social Archiver] [LibrarySync] Sync cancelled');
        // Preserve checkpoint — don't wipe resumeOffset on cancel
        this.updateState({ phase: 'idle', lastError: 'Cancelled' });
        await this.persistStatus('idle');
      } else {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Social Archiver] [LibrarySync] Sync failed:', error);
        this.updateState({ phase: 'error', lastError: message });
        await this.persistStatus('error', message);
      }
    } finally {
      this.isSyncing = false;
      this.abortController = null;
    }
  }

  /**
   * Cancel the current sync run, if running.
   * The checkpoint (resumeOffset) is preserved so the run can be resumed later.
   */
  cancel(): void {
    if (this.abortController) {
      console.debug('[Social Archiver] [LibrarySync] Cancelling sync');
      this.abortController.abort();
    }
  }

  /**
   * Cancel and clear all persisted checkpoint state.
   * Called on sign-out or sync client unregister.
   */
  async cancelAndClear(): Promise<void> {
    this.cancel();
    const settings = this.deps.settings();
    if (settings.archiveLibrarySync) {
      settings.archiveLibrarySync = this.makeDefaultPersistedState();
      await this.deps.saveSettings();
    }
    this.updateState(this.makeInitialState());
  }

  // -- Core sync algorithm ---------------------------------------------------

  private async runSync(initialOffset: number): Promise<void> {
    const signal = this.abortController!.signal;
    let offset = initialOffset;
    let runAnchorTime: string | null = this.deps.settings().archiveLibrarySync?.runAnchorTime || null;
    let isFirstPage = !runAnchorTime;

    // ── Paginated main sweep ───────────────────────────────────────────────
    while (true) {
      this.throwIfAborted(signal);

      const params: Record<string, string | number | boolean> = {
        limit: LIBRARY_SYNC_PAGE_SIZE,
        offset,
      };

      if (!isFirstPage && runAnchorTime) {
        params.archivedBefore = runAnchorTime;
      }

      const response = await this.fetchPageWithRetry(params, signal);

      // Capture anchor time from the first page response
      if (isFirstPage) {
        runAnchorTime = response.serverTime;
        isFirstPage = false;

        // Persist the anchor so a resumed run uses the same window
        const syncSettings = this.deps.settings().archiveLibrarySync;
        if (syncSettings) {
          syncSettings.runAnchorTime = runAnchorTime;
          await this.deps.saveSettings();
        }
      }

      // Update total count display
      this.updateState({ totalServerArchives: response.total });

      // Process each archive in this page
      for (const archive of response.archives) {
        this.throwIfAborted(signal);
        await this.processArchive(archive);
      }

      // Advance offset and persist checkpoint
      offset += response.archives.length;
      this.updateState({ currentOffset: offset });

      const syncSettings = this.deps.settings().archiveLibrarySync;
      if (syncSettings) {
        syncSettings.resumeOffset = offset;
        await this.deps.saveSettings();
      }

      console.debug('[Social Archiver] [LibrarySync] Page processed', {
        offset,
        total: response.total,
        pageSize: response.archives.length,
        saved: this.runtimeState.savedCount,
        skipped: this.runtimeState.skippedCount,
      });

      if (!response.hasMore || response.archives.length === 0) {
        break;
      }

      // Inter-page delay
      await this.sleep(LIBRARY_SYNC_INTER_PAGE_DELAY_MS, signal);
    }

    // ── Delta sweep ─────────────────────────────────────────────────────────
    if (runAnchorTime) {
      this.updateState({ phase: 'delta-sweep' });
      await this.runDeltaSweep(runAnchorTime, signal);
    }

    // ── Mark completed ───────────────────────────────────────────────────────
    const completedAt = new Date().toISOString();
    const settings = this.deps.settings();
    if (settings.archiveLibrarySync) {
      settings.archiveLibrarySync.completedAt = completedAt;
      settings.archiveLibrarySync.lastServerTime = runAnchorTime ?? completedAt;
      settings.archiveLibrarySync.runAnchorTime = '';
      settings.archiveLibrarySync.resumeOffset = 0;
    }
    await this.deps.saveSettings();
    await this.persistStatus('completed');

    this.updateState({ phase: 'completed', currentOffset: offset });

    const { savedCount, skippedCount, ambiguousCount, failedCount, scannedCount } = this.runtimeState;
    console.debug('[Social Archiver] [LibrarySync] Run completed', {
      scannedCount,
      savedCount,
      skippedCount,
      ambiguousCount,
      failedCount,
      completedAt,
    });

    if (savedCount > 0) {
      this.deps.notify(
        `Library sync complete: ${savedCount} new archive${savedCount === 1 ? '' : 's'} saved.`,
        5000
      );
    }
  }

  /**
   * Delta sweep: fetch archives created/updated during the main sweep window.
   * Uses updatedAfter to catch archives that arrived after the run started.
   *
   * When includeDeleted is supported, also collects deletedIds from the server
   * and applies inbound deletes for any archives deleted during the sweep window.
   */
  private async runDeltaSweep(updatedAfter: string, signal: AbortSignal): Promise<void> {
    let offset = 0;
    let hasMore = true;
    const allDeletedIds: string[] = [];

    while (hasMore) {
      this.throwIfAborted(signal);

      const params: Record<string, string | number | boolean> = {
        limit: LIBRARY_SYNC_PAGE_SIZE,
        offset,
        updatedAfter,
        includeDeleted: true,
      };

      const response = await this.fetchPageWithRetry(params, signal);

      // Collect deletedIds from each page
      if (response.deletedIds && response.deletedIds.length > 0) {
        allDeletedIds.push(...response.deletedIds);
      }

      // Build a set for O(1) lookup during this page — delete wins over re-save
      const deletedIdSet = new Set(allDeletedIds);

      for (const archive of response.archives) {
        this.throwIfAborted(signal);

        // Skip archives that are in the deletedIds set (delete wins)
        if (deletedIdSet.has(archive.id)) {
          console.debug('[Social Archiver] [LibrarySync] Delta sweep: skipping deleted archive', archive.id);
          this.updateState({ skippedCount: this.runtimeState.skippedCount + 1 });
          continue;
        }

        await this.processArchive(archive);
      }

      offset += response.archives.length;
      hasMore = response.hasMore && response.archives.length > 0;

      if (hasMore) {
        await this.sleep(LIBRARY_SYNC_INTER_PAGE_DELAY_MS, signal);
      }
    }

    // Apply inbound deletes for all collected deletedIds
    if (allDeletedIds.length > 0 && this.deps.applyInboundDeletedIds) {
      console.debug('[Social Archiver] [LibrarySync] Delta sweep: applying inbound deletes', {
        count: allDeletedIds.length,
      });
      try {
        await this.deps.applyInboundDeletedIds(allDeletedIds, 'delta');
      } catch (error) {
        // Non-fatal: log and continue — the main sweep is already complete
        console.error('[Social Archiver] [LibrarySync] Delta sweep: applyInboundDeletedIds failed', error);
      }
    }
  }

  // -- Per-archive processing ------------------------------------------------

  private async processArchive(archive: UserArchive): Promise<void> {
    this.updateState({ scannedCount: this.runtimeState.scannedCount + 1 });

    try {
      // Tier 0: skip if queued for outbound deletion
      if (this.deps.isArchiveQueuedForDeletion?.(archive.id)) {
        console.debug('[Social Archiver] [LibrarySync] Tier 0: skipping archive queued for deletion', archive.id);
        this.updateState({ skippedCount: this.runtimeState.skippedCount + 1 });
        return;
      }

      // Tier 1: exact match by stable server ID
      const existingById = this.deps.findBySourceArchiveId(archive.id);
      if (existingById) {
        this.updateState({ skippedCount: this.runtimeState.skippedCount + 1 });
        return;
      }

      // Tier 1.5: composed post race guard — check by clientPostId.
      // When a composed post is created locally and uploaded to the server, there
      // is a brief window where sourceArchiveId hasn't been written to frontmatter
      // yet.  Without this guard, Tier 3 would create a duplicate note.
      if (archive.archiveSource === 'composed' && archive.postId && this.deps.findByClientPostId) {
        const existingByClientPostId = this.deps.findByClientPostId(archive.postId);
        if (existingByClientPostId) {
          // Found local file with matching clientPostId — backfill sourceArchiveId
          try {
            await this.deps.backfillFileIdentity(existingByClientPostId, archive.id);
            this.deps.indexSavedFile(existingByClientPostId, {
              sourceArchiveId: archive.id,
              originalUrl: archive.originalUrl,
            });
          } catch (error) {
            console.warn('[Social Archiver] [LibrarySync] Tier 1.5: backfill by clientPostId failed', {
              archiveId: archive.id,
              clientPostId: archive.postId,
              error,
            });
          }
          this.updateState({ skippedCount: this.runtimeState.skippedCount + 1 });
          return;
        }
      }

      // Tier 2: URL-based fallback
      const existingByUrl = this.deps.findByOriginalUrl(archive.originalUrl);

      if (existingByUrl.length === 1) {
        // existingByUrl[0] is always defined when length === 1
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const matched = existingByUrl[0]!;
        // Tier-1 already confirmed this file does NOT have archive.id as its sourceArchiveId.
        // Backfill the stable server ID so future lookups use the fast O(1) path.
        // backfillFileIdentity is idempotent when the field already has a value —
        // it will overwrite only if the field is absent or different, which is acceptable
        // since we are associating this file with its canonical server record.
        try {
          await this.deps.backfillFileIdentity(matched, archive.id);
        } catch (error) {
          console.warn('[Social Archiver] [LibrarySync] backfillFileIdentity failed', {
            archiveId: archive.id,
            path: matched.path,
            error,
          });
        }
        this.updateState({ skippedCount: this.runtimeState.skippedCount + 1 });
        return;
      }

      if (existingByUrl.length > 1) {
        // Ambiguous: multiple files matched by URL — do not act
        console.warn('[Social Archiver] [LibrarySync] Ambiguous URL match — skipping', {
          archiveId: archive.id,
          url: archive.originalUrl,
          matchCount: existingByUrl.length,
          paths: existingByUrl.map(f => f.path),
        });
        this.updateState({ ambiguousCount: this.runtimeState.ambiguousCount + 1 });
        return;
      }

      // Tier 3 (fallthrough): no match — save to vault
      await this.saveArchive(archive);
    } catch (error) {
      // Per-item failures don't abort the run
      console.error('[Social Archiver] [LibrarySync] Failed to process archive', {
        archiveId: archive.id,
        url: archive.originalUrl,
        error,
      });
      this.updateState({ failedCount: this.runtimeState.failedCount + 1 });
    }
  }

  private async saveArchive(archive: UserArchive): Promise<void> {
    const postData = this.deps.convertUserArchiveToPostData(archive);
    // Inject sourceArchiveId so the saved file will have it in frontmatter
    postData.sourceArchiveId = archive.id;

    const settings = this.deps.settings();
    const pendingPost: PendingPost = {
      id: `library-sync-${archive.id}`,
      subscriptionId: `library-sync`,
      subscriptionName: 'Library Sync',
      post: postData,
      destinationFolder: settings.archivePath || 'Social Archives',
      archivedAt: archive.archivedAt,
    };

    const result = await this.deps.saveSubscriptionPostDetailed(pendingPost);

    if (result.status === 'created' && result.file) {
      // Optimistically update in-memory index
      this.deps.indexSavedFile(result.file, {
        sourceArchiveId: archive.id,
        originalUrl: archive.originalUrl,
      });
      this.updateState({ savedCount: this.runtimeState.savedCount + 1 });
    } else if (result.status === 'existing') {
      this.updateState({ skippedCount: this.runtimeState.skippedCount + 1 });
    } else if (result.status === 'failed') {
      console.warn('[Social Archiver] [LibrarySync] saveSubscriptionPostDetailed failed', {
        archiveId: archive.id,
        reason: result.reason,
      });
      this.updateState({ failedCount: this.runtimeState.failedCount + 1 });
    } else {
      // 'skipped'
      this.updateState({ skippedCount: this.runtimeState.skippedCount + 1 });
    }
  }

  // -- Page fetch with retry -------------------------------------------------

  private async fetchPageWithRetry(
    params: Record<string, string | number | boolean>,
    signal: AbortSignal
  ): Promise<{
    archives: UserArchive[];
    total: number;
    hasMore: boolean;
    serverTime: string;
    deletedIds?: string[];
  }> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= LIBRARY_SYNC_MAX_PAGE_RETRIES; attempt++) {
      this.throwIfAborted(signal);

      try {
        const apiClient = this.deps.apiClient();
        if (!apiClient) {
          throw new Error('API client not initialised');
        }

        const response = await apiClient.getUserArchives(params);
        return {
          archives: response.archives,
          total: response.total,
          hasMore: response.hasMore,
          serverTime: response.serverTime,
          deletedIds: response.deletedIds,
        };
      } catch (error) {
        lastError = error;

        if (this.isAbortError(error)) {
          throw error;
        }

        // Fail immediately on auth errors
        if (this.isAuthError(error)) {
          throw error;
        }

        if (attempt < LIBRARY_SYNC_MAX_PAGE_RETRIES) {
          const delay = LIBRARY_SYNC_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          console.warn(
            `[Social Archiver] [LibrarySync] Page fetch failed (attempt ${attempt}/${LIBRARY_SYNC_MAX_PAGE_RETRIES}), retrying in ${delay}ms`,
            error
          );
          await this.sleep(delay, signal);
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Failed to fetch archives page after max retries');
  }

  // -- Helpers ---------------------------------------------------------------

  private resolveMode(settings: SocialArchiverSettings): ArchiveLibrarySyncMode {
    const sync = settings.archiveLibrarySync;
    if (!sync) return 'bootstrap';
    if (!sync.completedAt) {
      return sync.resumeOffset > 0 ? 'resume' : 'bootstrap';
    }
    return 'manual-reconcile';
  }

  private async persistStatus(
    status: 'idle' | 'running' | 'error' | 'completed',
    errorMessage?: string
  ): Promise<void> {
    const settings = this.deps.settings();
    if (!settings.archiveLibrarySync) return;

    settings.archiveLibrarySync.lastStatus = status;
    if (errorMessage !== undefined) {
      settings.archiveLibrarySync.lastError = errorMessage;
    }
    await this.deps.saveSettings();
  }

  private makeDefaultPersistedState() {
    return {
      completedAt: '',
      resumeOffset: 0,
      runAnchorTime: '',
      lastServerTime: '',
      lastStatus: 'idle' as const,
      lastError: '',
    };
  }

  private makeInitialState(): ArchiveLibrarySyncRuntimeState {
    return {
      mode: 'bootstrap',
      phase: 'idle',
      totalServerArchives: null,
      scannedCount: 0,
      savedCount: 0,
      skippedCount: 0,
      ambiguousCount: 0,
      failedCount: 0,
      currentOffset: 0,
      startedAt: null,
      lastError: null,
    };
  }

  private updateState(partial: Partial<ArchiveLibrarySyncRuntimeState>): void {
    this.runtimeState = { ...this.runtimeState, ...partial };
    for (const cb of this.progressCallbacks) {
      try {
        cb({ ...this.runtimeState });
      } catch {
        // Don't let a subscriber error crash the sync
      }
    }
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new DOMException('LibrarySync cancelled', 'AbortError');
    }
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
  }

  private isAuthError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const enriched = error as Error & { status?: number };
    return enriched.status === 401 || enriched.status === 403;
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(resolve, ms);
      signal.addEventListener('abort', () => {
        window.clearTimeout(timeout);
        reject(new DOMException('LibrarySync cancelled', 'AbortError'));
      }, { once: true });
    });
  }
}
