/**
 * ArchiveStateSyncService
 *
 * Single Responsibility: Handle inbound `action_updated` WebSocket events
 * that carry `isBookmarked` changes and apply them to the local vault note's
 * `archive` frontmatter field.
 *
 * Flow:
 *   ws:action_updated (isBookmarked defined)
 *     → echo prevention: skip if sourceClientId === our syncClientId
 *     → lookup file by sourceArchiveId (O(1), stable)
 *     → if not found: fetch archive from server to get originalUrl, then try URL lookup
 *     → if still not found: log debug, return
 *     → read current fm.archive; skip if already matches (no-op guard)
 *     → register outbound suppression (prevents ArchiveStateOutboundService echo)
 *     → processFrontMatter: set fm.archive = isBookmarked, backfill sourceArchiveId if missing
 *
 * Suppression pattern (mirrors AnnotationOutboundService / ArchiveTagOutboundService):
 *   - `addSuppression(archiveId)` is called by this service before writing fm,
 *     preventing any outbound watcher from re-sending the change.
 *   - External callers (e.g., ArchiveStateOutboundService) call `addSuppression`
 *     after their own outbound writes so that the resulting WS echo is ignored here.
 */

import type { App, TFile } from 'obsidian';
import type { ActionUpdatedEventData } from '@/types/websocket';
import type { SocialArchiverSettings } from '@/types/settings';
import type { WorkersAPIClient } from '../../services/WorkersAPIClient';
import type { ArchiveLookupService } from '../../services/ArchiveLookupService';

// ============================================================================
// Constants
// ============================================================================

/** Echo suppression TTL: ignore outbound-triggered inbound events within this window. */
const SUPPRESSION_TTL_MS = 10_000;

/** Log prefix for consistent filtering in DevTools. */
const LOG_PREFIX = '[Social Archiver] [ArchiveStateSyncService]';

// ============================================================================
// ArchiveStateSyncService
// ============================================================================

export class ArchiveStateSyncService {
  private readonly app: App;
  private readonly apiClient: WorkersAPIClient;
  private readonly archiveLookup: ArchiveLookupService;
  private readonly getSettings: () => SocialArchiverSettings;

  /**
   * Optional callback invoked just before this service writes `archive`
   * frontmatter (both handleRemoteArchiveState and reconcileFromLibrarySync).
   *
   * Wire this to `archiveStateOutboundService.addSuppression` so the
   * MetadataCache.changed echo produced by our write does not trigger an
   * unneeded outbound PATCH.
   *
   * Mirrors the `onBeforeInboundWrite` pattern in AnnotationSyncService.
   */
  onBeforeInboundWrite?: (archiveId: string) => void;

  /**
   * Optional callback invoked after this service successfully writes `archive`
   * frontmatter from a remote change. Wire this to `refreshTimelineView()` so
   * the timeline UI reflects the updated archive state.
   */
  onAfterInboundWrite?: () => void;

  /**
   * Suppression map: archiveId → timestamp of last write.
   * Both inbound writes (set by this service before processFrontMatter) and
   * outbound writes (set by an ArchiveStateOutboundService when one exists)
   * register here so neither direction creates an infinite loop.
   */
  private readonly suppressionMap = new Map<string, number>();

  constructor(
    app: App,
    apiClient: WorkersAPIClient,
    archiveLookup: ArchiveLookupService,
    getSettings: () => SocialArchiverSettings,
  ) {
    this.app = app;
    this.apiClient = apiClient;
    this.archiveLookup = archiveLookup;
    this.getSettings = getSettings;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Handle an `action_updated` WebSocket event.
   *
   * Early-exits when:
   * - `changes.isBookmarked` is `undefined` (not an archive-state change)
   * - `sourceClientId` matches our own `syncClientId` (echo prevention)
   * - the vault file's `archive` frontmatter already equals the incoming value
   *
   * On success:
   * - Registers suppression for this archiveId
   * - Writes `fm.archive` via `processFrontMatter`
   * - Backfills `fm.sourceArchiveId` if it was missing
   */
  async handleRemoteArchiveState(eventData: ActionUpdatedEventData): Promise<void> {
    const { archiveId, sourceClientId, changes } = eventData;

    // Guard 1: only handle isBookmarked events
    if (changes.isBookmarked === undefined) return;

    const newArchiveState = changes.isBookmarked;

    // Guard 2: echo prevention — ignore events we ourselves triggered
    const settings = this.getSettings();
    if (sourceClientId && sourceClientId === settings.syncClientId) {
      console.debug(LOG_PREFIX, 'Skipping own echo for:', archiveId);
      return;
    }

    // Guard 3: suppression window — skip if we just wrote to this archive
    if (this.isSuppressed(archiveId)) {
      console.debug(LOG_PREFIX, 'Skipping suppressed archiveId:', archiveId);
      return;
    }

    // File lookup — primary path: sourceArchiveId index (O(1))
    let file = this.archiveLookup.findBySourceArchiveId(archiveId);
    let sourceArchiveIdMissing = false;

    if (!file) {
      // Fallback: fetch archive from server to get originalUrl, then URL-lookup
      let originalUrl: string | undefined;
      try {
        const response = await this.apiClient.getUserArchive(archiveId);
        originalUrl = response.archive.originalUrl;
      } catch (err) {
        console.debug(
          LOG_PREFIX,
          'Could not fetch archive for URL fallback lookup:',
          archiveId,
          err instanceof Error ? err.message : String(err),
        );
        return;
      }

      if (originalUrl) {
        const candidates = this.archiveLookup.findByOriginalUrl(originalUrl);
        if (candidates.length === 1) {
          file = candidates[0] ?? null;
          sourceArchiveIdMissing = true; // will backfill below
        } else if (candidates.length > 1) {
          console.warn(
            LOG_PREFIX,
            'Ambiguous originalUrl match — skipping archive state update.',
            { archiveId, originalUrl, matchCount: candidates.length },
          );
          return;
        }
      }
    }

    if (!file) {
      console.debug(
        LOG_PREFIX,
        'No matching vault file found — archive may exist only on mobile:',
        archiveId,
      );
      return;
    }

    // Guard 4: no-op if frontmatter already matches the incoming value
    const cache = this.app.metadataCache.getFileCache(file);
    const currentArchive = cache?.frontmatter?.['archive'];
    if (currentArchive === newArchiveState) {
      console.debug(
        LOG_PREFIX,
        'fm.archive already matches incoming value — no-op:',
        { archiveId, file: file.path, archive: newArchiveState },
      );
      return;
    }

    // Notify the outbound watcher (ArchiveStateOutboundService) so it can
    // suppress the MetadataCache.changed echo triggered by our write below.
    this.onBeforeInboundWrite?.(archiveId);

    // Suppress outbound re-sync before writing (prevents echo loop)
    this.addSuppression(archiveId);

    // Apply frontmatter update
    try {
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        fm.archive = newArchiveState;

        // Backfill sourceArchiveId so subsequent lookups are O(1)
        if (sourceArchiveIdMissing && !fm.sourceArchiveId) {
          fm.sourceArchiveId = archiveId;
        }
      });

      console.debug(
        LOG_PREFIX,
        'Applied archive state from remote:',
        { archiveId, file: file.path, archive: newArchiveState },
      );

      // Refresh timeline UI so the card reflects the updated archive state
      this.onAfterInboundWrite?.();
    } catch (err) {
      console.error(
        LOG_PREFIX,
        'Failed to update fm.archive:',
        file.path,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * Reconcile the `archive` frontmatter field on a vault file that was matched
   * during ArchiveLibrarySyncService's full/delta sync (Tier 1 or Tier 2).
   *
   * Called when the sync encounters an existing file and wants to ensure the
   * local `archive` frontmatter reflects the server's `isBookmarked` value —
   * the fallback for cases where a WebSocket `action_updated` event was missed
   * (device offline, WS disconnect, etc.).
   *
   * Short-circuits when:
   * - This archiveId is currently suppressed (user just changed it locally via
   *   ArchiveStateOutboundService — don't overwrite with server value).
   * - `fm.archive` already equals `isBookmarked` (no-op guard, no disk write).
   *
   * On change:
   * - Registers suppression (so the resulting MetadataCache.changed event is
   *   ignored by ArchiveStateOutboundService).
   * - Writes `fm.archive = isBookmarked` via processFrontMatter.
   * - Backfills `fm.sourceArchiveId` if missing.
   */
  async reconcileFromLibrarySync(
    file: TFile,
    archiveId: string,
    isBookmarked: boolean,
  ): Promise<void> {
    // Guard 1: skip if outbound suppression is active (user just changed it locally)
    if (this.isSuppressed(archiveId)) {
      console.debug(
        LOG_PREFIX,
        'reconcileFromLibrarySync: skipping suppressed archiveId:',
        archiveId,
        file.path,
      );
      return;
    }

    // Guard 2: no-op if frontmatter already matches
    const cache = this.app.metadataCache.getFileCache(file);
    const currentArchive = cache?.frontmatter?.['archive'];
    const currentBool: boolean = currentArchive === true;

    if (currentBool === isBookmarked) {
      // Already in sync — skip disk write entirely
      return;
    }

    const previousValue = currentBool;

    // Notify the outbound watcher (ArchiveStateOutboundService) so it can
    // suppress the MetadataCache.changed echo triggered by our write below.
    this.onBeforeInboundWrite?.(archiveId);

    // Register suppression before writing so the MetadataCache.changed echo
    // from processFrontMatter does not re-trigger an outbound sync.
    this.addSuppression(archiveId);

    try {
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        fm.archive = isBookmarked;

        // Backfill sourceArchiveId if somehow missing after Tier 1/Tier 2 match
        if (!fm.sourceArchiveId) {
          fm.sourceArchiveId = archiveId;
        }
      });

      console.debug(
        LOG_PREFIX,
        `Reconciled archive state for ${file.name}: ${previousValue} → ${isBookmarked}`,
        { archiveId, path: file.path },
      );

      // Refresh timeline UI so the card reflects the reconciled archive state
      this.onAfterInboundWrite?.();
    } catch (err) {
      // Remove the suppression we just added so a future write is not blocked
      this.suppressionMap.delete(archiveId);

      console.error(
        LOG_PREFIX,
        'reconcileFromLibrarySync: failed to update fm.archive:',
        file.path,
        err instanceof Error ? err.message : String(err),
      );

      throw err; // propagate so the caller can log and absorb
    }
  }

  // --------------------------------------------------------------------------
  // Suppression API
  // --------------------------------------------------------------------------

  /**
   * Mark `archiveId` as recently written so that the resulting inbound or
   * outbound echo event is ignored within `SUPPRESSION_TTL_MS`.
   *
   * Called by:
   * - This service before each `processFrontMatter` write (inbound suppression).
   * - External outbound services after their own outbound API call (outbound suppression).
   */
  addSuppression(archiveId: string): void {
    this.suppressionMap.set(archiveId, Date.now());
  }

  /**
   * Check whether `archiveId` is within the active suppression window.
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
}
