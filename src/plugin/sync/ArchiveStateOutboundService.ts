/**
 * ArchiveStateOutboundService
 *
 * Single Responsibility: Watch for `archive` frontmatter changes in archive
 * notes and sync them to the server as `isBookmarked` via updateArchiveActions.
 *
 * Flow:
 *   MetadataCache.changed → filter markdown files → filter archive notes
 *   (has sourceArchiveId or identity in ArchiveLookupService) →
 *   normalize archive field (undefined → false) →
 *   diff against last known value → startup baseline window →
 *   debounce per file → check suppression → resolve archiveId →
 *   call apiClient.updateArchiveActions(archiveId, { isBookmarked }) →
 *   record suppression after success
 *
 * Echo suppression:
 *   After an outbound PATCH succeeds, the server broadcasts an action_updated
 *   WebSocket event. Any inbound handler that writes `archive` frontmatter
 *   must call addSuppression() just before writing so this service ignores
 *   the resulting MetadataCache.changed echo.
 *
 * Startup window:
 *   During the first STARTUP_WINDOW_MS after start(), first observations are
 *   treated as baseline-only (no sync). This prevents the initial MetadataCache
 *   population from triggering outbound syncs for every archive file on plugin load.
 */

import type { App, EventRef, TFile } from 'obsidian';
import type { WorkersAPIClient } from '@/services/WorkersAPIClient';
import type { SocialArchiverSettings } from '@/types/settings';
import type { ArchiveLookupService } from '@/services/ArchiveLookupService';
import type { BulkArchiveActionAccumulator } from './BulkArchiveActionAccumulator';

// ============================================================================
// Constants
// ============================================================================

/** Debounce delay before pushing a changed archive state to the server. */
const DEBOUNCE_MS = 2000;

/** Echo suppression TTL: ignore inbound WS events caused by our own API calls. */
const SUPPRESSION_TTL_MS = 10_000;

/**
 * Duration of the startup window. During this period first observations are
 * recorded as baseline without triggering any outbound sync.
 */
const STARTUP_WINDOW_MS = 5000;

/** Log prefix */
const LOG_PREFIX = '[Social Archiver] [ArchiveStateOutbound]';

// ============================================================================
// ArchiveStateOutboundService
// ============================================================================

export class ArchiveStateOutboundService {
  /** filePath → last known `archive` field value (boolean) */
  private readonly lastKnownArchiveState = new Map<string, boolean>();

  /** filePath → active debounce timer ID */
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Suppression map: archiveId → timestamp of last outbound write.
   * Inbound handlers check this to skip echo events.
   */
  private readonly suppressionMap = new Map<string, number>();

  /** EventRef for the MetadataCache.changed listener (for cleanup). */
  private changedEventRef: EventRef | null = null;

  /**
   * Timestamp when start() was called. During the startup window (first
   * STARTUP_WINDOW_MS), first observations are treated as baseline-only
   * (no sync) to avoid syncing every archive file on plugin load.
   */
  private startedAt = 0;

  /** Optional shared accumulator for debounced bulk API calls. */
  private accumulator: BulkArchiveActionAccumulator | null = null;

  constructor(
    private readonly app: App,
    private readonly apiClient: WorkersAPIClient,
    private readonly archiveLookup: ArchiveLookupService,
    private readonly getSettings: () => SocialArchiverSettings,
  ) {}

  /**
   * Set the shared accumulator instance. When set, outbound syncs delegate
   * the actual API call to the accumulator (which batches multiple changes
   * into a single bulk request). When null, falls back to direct API calls.
   */
  setAccumulator(accumulator: BulkArchiveActionAccumulator | null): void {
    this.accumulator = accumulator;
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Register the MetadataCache changed listener.
   * Call this after the plugin (and all dependencies) are fully initialized.
   */
  start(): void {
    if (this.changedEventRef !== null) {
      // Already started — no-op
      return;
    }

    this.startedAt = Date.now();
    this.changedEventRef = this.app.metadataCache.on(
      'changed',
      (file: TFile, _data: string) => {
        this.onMetadataChanged(file);
      },
    );

    console.debug(`${LOG_PREFIX} Started`);
  }

  /**
   * Remove the MetadataCache listener and clear all pending debounce timers.
   * Safe to call multiple times.
   */
  stop(): void {
    if (this.changedEventRef !== null) {
      this.app.metadataCache.offref(this.changedEventRef);
      this.changedEventRef = null;
    }

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    console.debug(`${LOG_PREFIX} Stopped`);
  }

  // --------------------------------------------------------------------------
  // Suppression API (called by inbound handlers before writing archive frontmatter)
  // --------------------------------------------------------------------------

  /**
   * Record that this archiveId was just written by an inbound handler so that
   * the MetadataCache.changed echo triggered by that write is ignored.
   *
   * Also call this after a successful outbound sync to prevent re-entrancy.
   */
  addSuppression(archiveId: string): void {
    this.suppressionMap.set(archiveId, Date.now());
  }

  /**
   * Check whether the archiveId is currently within the suppression window.
   * Exposed as public so inbound event handlers (e.g. RealtimeEventBridge)
   * can check before writing frontmatter.
   */
  isSuppressed(archiveId: string): boolean {
    const ts = this.suppressionMap.get(archiveId);
    if (ts === undefined) return false;
    if (Date.now() - ts > SUPPRESSION_TTL_MS) {
      this.suppressionMap.delete(archiveId);
      return false;
    }
    return true;
  }

  // --------------------------------------------------------------------------
  // Internal — MetadataCache handler
  // --------------------------------------------------------------------------

  private onMetadataChanged(file: TFile): void {
    // Only process markdown files
    if (file.extension !== 'md') return;

    // Feature guard: archive state sync is active when a sync client is registered
    const settings = this.getSettings();
    if (!settings.syncClientId) return;

    // Read frontmatter from cache
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (!fm) return;

    // Resolve archiveId: prefer sourceArchiveId in frontmatter, then path index
    let archiveId = typeof fm['sourceArchiveId'] === 'string' && fm['sourceArchiveId']
      ? fm['sourceArchiveId'] as string
      : undefined;

    if (!archiveId) {
      const identity = this.archiveLookup.getIdentityByPath(file.path);
      if (identity?.archiveId) {
        archiveId = identity.archiveId;
      }
    }

    // Also require originalUrl as a fallback marker that this is an archive note
    const originalUrl = typeof fm['originalUrl'] === 'string' ? fm['originalUrl'] : undefined;

    // Not an archive note — skip
    if (!archiveId && !originalUrl) return;

    // Check suppression — skip echo from our own outbound or inbound writes
    if (archiveId && this.isSuppressed(archiveId)) return;

    // Normalize the `archive` field: treat undefined/null as false
    const rawArchive: unknown = fm['archive'];
    const currentArchiveState: boolean = rawArchive === true;

    const isFirstObservation = !this.lastKnownArchiveState.has(file.path);

    if (isFirstObservation) {
      // During the startup window, record baseline and skip sync to avoid
      // flooding the server on plugin load for every archive file.
      const inStartupWindow = (Date.now() - this.startedAt) < STARTUP_WINDOW_MS;
      if (inStartupWindow) {
        this.lastKnownArchiveState.set(file.path, currentArchiveState);
        return;
      }

      // Outside startup window: this file was never observed before.
      // Record baseline. If the value is `false` (the default) there is
      // nothing to sync. If it is `true`, treat it as a user edit.
      this.lastKnownArchiveState.set(file.path, currentArchiveState);
      if (!currentArchiveState) return;
      // Fall through to debounce + sync
    }

    if (!isFirstObservation) {
      const lastState = this.lastKnownArchiveState.get(file.path);

      // No change — nothing to do
      if (currentArchiveState === lastState) return;

      // Update known state optimistically
      this.lastKnownArchiveState.set(file.path, currentArchiveState);
    }

    // Debounce per file
    const existing = this.debounceTimers.get(file.path);
    if (existing !== undefined) clearTimeout(existing);

    this.debounceTimers.set(
      file.path,
      setTimeout(() => {
        this.debounceTimers.delete(file.path);
        void this.syncArchiveState(archiveId, originalUrl, currentArchiveState, file);
      }, DEBOUNCE_MS),
    );
  }

  // --------------------------------------------------------------------------
  // Internal — Server sync
  // --------------------------------------------------------------------------

  private async syncArchiveState(
    archiveId: string | undefined,
    originalUrl: string | undefined,
    isBookmarked: boolean,
    file: TFile,
  ): Promise<void> {
    try {
      // Resolve archiveId if missing — look up by originalUrl via server
      if (!archiveId && originalUrl) {
        const result = await this.apiClient.getUserArchives({ originalUrl, limit: 1 });
        const found = result?.archives?.[0];
        if (found?.id) {
          archiveId = found.id;
          // Backfill sourceArchiveId to frontmatter so future syncs are instant
          await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            fm['sourceArchiveId'] = archiveId;
          });
          console.debug(`${LOG_PREFIX} Backfilled sourceArchiveId:`, archiveId, file.path);
        }
      }

      if (!archiveId) {
        console.debug(`${LOG_PREFIX} Cannot resolve archiveId — skipping:`, file.path);
        return;
      }

      if (this.accumulator) {
        // Delegate to shared accumulator for debounced batch flush
        this.accumulator.enqueue({ archiveId, isBookmarked });
      } else {
        // Fallback: direct single-item PATCH to server
        await this.apiClient.updateArchiveActions(archiveId, { isBookmarked });
      }

      // Suppress the resulting inbound WS echo
      this.addSuppression(archiveId);

      console.debug(
        `${LOG_PREFIX} Synced archive state to server:`,
        archiveId,
        { isBookmarked },
      );
    } catch (err) {
      console.error(
        `${LOG_PREFIX} Failed to sync archive state:`,
        archiveId,
        err instanceof Error ? err.message : String(err),
      );
      // Do not rollback frontmatter — the value stays as the user left it.
      // The next MetadataCache.changed event for this file will retry.
    }
  }
}
