/**
 * AnnotationOutboundService
 *
 * Single Responsibility: Watch for `comment` frontmatter changes in archive
 * notes and sync them to the server as a synthetic primary note.
 *
 * Flow:
 *   MetadataCache.changed → filter archive notes with sourceArchiveId →
 *   detect comment change → debounce per file → fetch server archive →
 *   upsert / remove obsidian:{clientId}:primary note → PATCH archive →
 *   add suppression so inbound sync ignores the echo
 *
 * Echo suppression:
 *   After an outbound PATCH succeeds the server broadcasts an action_updated
 *   WebSocket event.  AnnotationSyncService calls addSuppression() just
 *   before writing inbound changes; AnnotationOutboundService also calls
 *   addSuppression() after an outbound write so neither direction creates an
 *   infinite loop.
 */

import type { App, EventRef, TFile } from 'obsidian';
import type { WorkersAPIClient } from '@/services/WorkersAPIClient';
import type { SocialArchiverSettings } from '@/types/settings';
import type { ArchiveLookupService } from '@/services/ArchiveLookupService';
import type { UserNote } from '@/types/annotations';

// ============================================================================
// AnnotationOutboundService
// ============================================================================

export class AnnotationOutboundService {
  private readonly app: App;
  private readonly apiClient: WorkersAPIClient;
  private readonly archiveLookup: ArchiveLookupService;
  private readonly getSettings: () => SocialArchiverSettings;

  /** Debounce timers per file path */
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Suppression map: archiveId → timestamp of last outbound write.
   * Inbound sync checks this to skip echo events.
   */
  private readonly suppressionMap = new Map<string, number>();

  /** Previous comment value per file path, used to detect changes */
  private readonly lastKnownComments = new Map<string, string | undefined>();

  /** EventRef for the metadataCache.changed listener */
  private changedEventRef: EventRef | null = null;

  /**
   * Timestamp when start() was called. During the startup window (first 5 seconds),
   * first observations are treated as baseline-only (no sync). After the window,
   * first observations with a comment change are treated as user edits.
   */
  private startedAt = 0;
  private static readonly STARTUP_WINDOW_MS = 5000;

  private static readonly DEBOUNCE_MS = 2000;
  private static readonly SUPPRESSION_TTL_MS = 10_000;

  constructor(
    app: App,
    apiClient: WorkersAPIClient,
    archiveLookup: ArchiveLookupService,
    getSettings: () => SocialArchiverSettings
  ) {
    this.app = app;
    this.apiClient = apiClient;
    this.archiveLookup = archiveLookup;
    this.getSettings = getSettings;
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  start(): void {
    if (this.changedEventRef !== null) return; // Already started

    this.startedAt = Date.now();
    this.changedEventRef = this.app.metadataCache.on(
      'changed',
      (file: TFile, _data: string) => {
        this.onMetadataChanged(file);
      }
    );
  }

  stop(): void {
    if (this.changedEventRef !== null) {
      this.app.metadataCache.offref(this.changedEventRef);
      this.changedEventRef = null;
    }

    this.debounceTimers.forEach((t) => clearTimeout(t));
    this.debounceTimers.clear();
  }

  // --------------------------------------------------------------------------
  // Echo Suppression (public API — called by AnnotationSyncService)
  // --------------------------------------------------------------------------

  /**
   * Record that this archiveId was just written by inbound sync so that
   * the metadata change triggered by that write is ignored.
   */
  addSuppression(archiveId: string): void {
    this.suppressionMap.set(archiveId, Date.now());
  }

  /**
   * Pre-register a file's current comment in the observation map so that
   * a subsequent frontmatter deletion is detected as a real diff (not a
   * first-observation no-op).
   */
  recordCommentBaseline(filePath: string, comment: string | undefined): void {
    this.lastKnownComments.set(filePath, comment);
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private isSuppressed(archiveId: string): boolean {
    const ts = this.suppressionMap.get(archiveId);
    if (ts === undefined) return false;
    if (Date.now() - ts > AnnotationOutboundService.SUPPRESSION_TTL_MS) {
      this.suppressionMap.delete(archiveId);
      return false;
    }
    return true;
  }

  private onMetadataChanged(file: TFile): void {
    // Only process markdown files
    if (file.extension !== 'md') return;

    // Check feature toggle
    if (!this.getSettings().enableMobileAnnotationSync) return;

    // Get frontmatter from cache
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (!fm) return;

    // Must be an archive note (has sourceArchiveId or originalUrl)
    let archiveId = fm['sourceArchiveId'] as string | undefined;
    if (!archiveId) {
      // Fallback 1: look up archiveId from the ArchiveLookupService path index.
      const identity = this.archiveLookup.getIdentityByPath(file.path);
      if (identity?.archiveId) {
        archiveId = identity.archiveId;
      }
    }
    // Fallback 2: if still no archiveId but has originalUrl, defer to syncComment
    // which will resolve archiveId via server API and backfill frontmatter.
    const originalUrl = fm['originalUrl'] as string | undefined;
    if (!archiveId && !originalUrl) return;

    // Check suppression — skip echo from our own inbound sync writes
    if (archiveId && this.isSuppressed(archiveId)) return;

    // Detect comment change
    const currentComment = fm['comment'] as string | undefined;
    const isFirstObservation = !this.lastKnownComments.has(file.path);

    if (isFirstObservation) {
      // During the startup window (first 5 seconds after start()), record
      // baseline and skip sync. This prevents plugin load / initial cache
      // population from triggering outbound syncs for every archive file.
      const inStartupWindow = (Date.now() - this.startedAt) < AnnotationOutboundService.STARTUP_WINDOW_MS;
      if (inStartupWindow) {
        this.lastKnownComments.set(file.path, currentComment);
        return;
      }

      // Outside startup window: this file was never observed before.
      // If currentComment is non-empty, treat it as a user edit and sync.
      // If empty/undefined, just record baseline — nothing to sync.
      this.lastKnownComments.set(file.path, currentComment);
      if (!currentComment) return;
      // Fall through to debounce + sync (skip the diff check below since
      // there's no meaningful previous baseline)
    }

    if (!isFirstObservation) {
      const lastComment = this.lastKnownComments.get(file.path);

      // Skip if value has not changed
      if (currentComment === lastComment) return;

      // Update known state
      this.lastKnownComments.set(file.path, currentComment);
    }

    // Debounce per file
    const existing = this.debounceTimers.get(file.path);
    if (existing !== undefined) clearTimeout(existing);

    this.debounceTimers.set(
      file.path,
      setTimeout(() => {
        this.debounceTimers.delete(file.path);
        void this.syncComment(archiveId, originalUrl, currentComment, file);
      }, AnnotationOutboundService.DEBOUNCE_MS)
    );
  }

  private async syncComment(
    archiveId: string | undefined,
    originalUrl: string | undefined,
    comment: string | undefined,
    file: TFile
  ): Promise<void> {
    try {
      // 1. Resolve archiveId if missing — look up by originalUrl via server
      if (!archiveId && originalUrl) {
        const result = await this.apiClient.getUserArchives({ originalUrl, limit: 1 });
        const found = result?.archives?.[0];
        if (found?.id) {
          archiveId = found.id;
          // Backfill sourceArchiveId to frontmatter so future syncs are instant
          await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            fm['sourceArchiveId'] = archiveId;
          });
          console.debug('[AnnotationOutboundService] Backfilled sourceArchiveId:', archiveId, file.path);
        }
      }

      if (!archiveId) {
        console.debug('[AnnotationOutboundService] Cannot resolve archiveId — skipping:', file.path);
        return;
      }

      // 2. Fetch current server archive to get existing notes
      const response = await this.apiClient.getUserArchive(archiveId);
      const archive = response.archive;

      // 2. Clone existing notes array
      const notes: UserNote[] = [...(archive.userNotes ?? [])];

      // 3. Build synthetic note ID for this Obsidian client
      const clientId = this.getSettings().syncClientId || '';
      const syntheticNoteId = `obsidian:${clientId}:primary`;

      // 4. Find existing primary note index
      const existingIdx = notes.findIndex((n) => n.id === syntheticNoteId);

      if (comment && comment.trim().length > 0) {
        // Upsert primary note
        const now = new Date().toISOString();
        const syntheticNote: UserNote = {
          id: syntheticNoteId,
          content: comment.trim(),
          createdAt: existingIdx >= 0 ? notes[existingIdx]!.createdAt : now,
          updatedAt: now,
        };

        if (existingIdx >= 0) {
          notes[existingIdx] = syntheticNote;
        } else {
          notes.push(syntheticNote);
        }
      } else {
        // Comment cleared — remove primary note
        if (existingIdx < 0) {
          // Nothing to remove — no-op
          return;
        }
        notes.splice(existingIdx, 1);
      }

      // 5. PATCH to server
      await this.apiClient.updateArchiveActions(archiveId, {
        userNotes: notes,
      });

      // 6. Add suppression so the resulting inbound WS echo is ignored
      this.addSuppression(archiveId);

      console.debug(
        '[AnnotationOutboundService] Synced comment to server:',
        archiveId,
        comment ? 'upserted' : 'removed'
      );
    } catch (err) {
      console.error(
        '[AnnotationOutboundService] Failed to sync comment:',
        archiveId,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}
