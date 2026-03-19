/**
 * AnnotationSyncService
 *
 * Single Responsibility: Orchestrate the real-time sync of mobile
 * highlights and notes into Obsidian vault notes.
 *
 * Flow:
 *   ws:action_updated (hasAnnotationUpdate)
 *     → fetch latest archive from server
 *     → find local file via ArchiveLookupService
 *     → sync userNotes → comment frontmatter property
 *     → update frontmatter (sourceArchiveId, counts, hasAnnotations)
 *
 * This service owns the coalescing logic: if a sync is already in-flight
 * for a given archiveId, the new event is queued as "pending".  When the
 * in-flight sync completes, the pending flag is consumed and a single
 * follow-up fetch is made (no per-event payload is stored — we always
 * re-fetch the latest server state).
 */

import type { App, TFile } from 'obsidian';
import type { ActionUpdatedEventData } from '@/types/websocket';
import type { SocialArchiverSettings } from '@/types/settings';
import type { WorkersAPIClient } from './WorkersAPIClient';
import type { ArchiveLookupService } from './ArchiveLookupService';

// ============================================================================
// Coalescing state per archiveId
// ============================================================================

interface CoalesceEntry {
  /** A sync operation is currently running for this archiveId */
  inFlight: boolean;
  /** A new event arrived while in-flight; needs a follow-up sync */
  pending: boolean;
}

// ============================================================================
// AnnotationSyncService
// ============================================================================

export class AnnotationSyncService {
  private readonly app: App;
  private readonly workersApiClient: WorkersAPIClient;
  private readonly archiveLookup: ArchiveLookupService;
  private readonly getSettings: () => SocialArchiverSettings;

  /** Per-archiveId coalescing state */
  private readonly coalesceMap = new Map<string, CoalesceEntry>();

  constructor(
    app: App,
    workersApiClient: WorkersAPIClient,
    archiveLookup: ArchiveLookupService,
    getSettings: () => SocialArchiverSettings
  ) {
    this.app = app;
    this.workersApiClient = workersApiClient;
    this.archiveLookup = archiveLookup;
    this.getSettings = getSettings;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Handle an `action_updated` WebSocket event.
   *
   * Early-exits if:
   * - `hasAnnotationUpdate` is not true
   * - `enableMobileAnnotationSync` feature toggle is off
   *
   * Otherwise, delegates to the internal sync pipeline with coalescing.
   */
  async handleActionUpdated(data: ActionUpdatedEventData): Promise<void> {
    if (data.changes.hasAnnotationUpdate !== true) return;
    if (!this.getSettings().enableMobileAnnotationSync) return;

    const { archiveId } = data;
    await this.coalesce(archiveId);
  }

  // --------------------------------------------------------------------------
  // Coalescing
  // --------------------------------------------------------------------------

  /**
   * Run a sync for `archiveId` with coalescing.
   *
   * - If no entry is in-flight, start immediately.
   * - If one is in-flight, mark pending and return (caller returns).
   * - When in-flight completes, consume pending and run once more.
   */
  private async coalesce(archiveId: string): Promise<void> {
    const entry = this.coalesceMap.get(archiveId);

    if (entry?.inFlight) {
      // Already running — mark pending so we do exactly one follow-up
      entry.pending = true;
      return;
    }

    // Set in-flight
    this.coalesceMap.set(archiveId, { inFlight: true, pending: false });

    try {
      await this.runSync(archiveId);
    } finally {
      const current = this.coalesceMap.get(archiveId);
      if (current?.pending) {
        // Consume pending and run once more
        current.inFlight = true;
        current.pending = false;
        try {
          await this.runSync(archiveId);
        } finally {
          this.coalesceMap.delete(archiveId);
        }
      } else {
        this.coalesceMap.delete(archiveId);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Core Sync Pipeline
  // --------------------------------------------------------------------------

  /**
   * Execute the full annotation sync pipeline for a single archiveId.
   *
   * Does NOT throw — errors are logged and the pipeline stops silently.
   * The next event for this archiveId will retry from the beginning.
   */
  private async runSync(archiveId: string): Promise<void> {
    // 1. Fetch latest archive from server
    let archive;
    try {
      const response = await this.workersApiClient.getUserArchive(archiveId);
      archive = response.archive;
    } catch (err) {
      console.warn(
        '[AnnotationSyncService] Failed to fetch archive for annotation sync:',
        archiveId,
        err instanceof Error ? err.message : String(err)
      );
      return;
    }

    console.debug('[AnnotationSyncService] Fetched archive:', archiveId, { originalUrl: archive.originalUrl, noteCount: archive.userNotes?.length, highlightCount: archive.userHighlights?.length });

    // 2. Find the local vault file
    const file = this.resolveFile(archiveId, archive.originalUrl);
    if (!file) {
      console.debug('[AnnotationSyncService] No matching vault file found for:', archiveId, archive.originalUrl);
      return;
    }
    console.debug('[AnnotationSyncService] Found vault file:', file.path);

    // 3. Build comment from userNotes (join multiple notes with double newline)
    const notes = archive.userNotes ?? [];
    const highlights = archive.userHighlights ?? [];
    const noteCount = notes.length;
    const highlightCount = highlights.length;
    const hasAnnotations = noteCount > 0 || highlightCount > 0;

    // Sort notes by createdAt ASC and join contents
    const sortedNotes = [...notes].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const comment = sortedNotes.map((n) => n.content).join('\n\n') || undefined;

    // 4. Update frontmatter only (no body modification)
    try {
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        // Backfill sourceArchiveId if not already set
        if (!fm.sourceArchiveId) {
          fm.sourceArchiveId = archiveId;
        }

        // Sync notes → comment property
        if (comment) {
          fm.comment = comment;
        } else {
          // Notes cleared on mobile → remove comment
          delete fm.comment;
        }

        fm.userNoteCount = noteCount;
        fm.userHighlightCount = highlightCount;
        fm.hasAnnotations = hasAnnotations;
      });
    } catch (err) {
      console.error(
        '[AnnotationSyncService] Failed to update frontmatter:',
        file.path,
        err instanceof Error ? err.message : String(err)
      );
      return;
    }

    console.debug(
      '[AnnotationSyncService] Annotation sync complete:',
      file.path,
      { noteCount, highlightCount, hasAnnotations }
    );
  }

  // --------------------------------------------------------------------------
  // File Resolution
  // --------------------------------------------------------------------------

  /**
   * Resolve the vault file for a given archiveId and originalUrl.
   *
   * Priority:
   *   1. sourceArchiveId lookup (stable, O(1))
   *   2. originalUrl fallback (may be ambiguous)
   *
   * Per PRD ambiguous-match policy:
   *   - If multiple files match originalUrl → log warning, return null (no auto-update)
   *   - If no file found → return null (silently)
   */
  private resolveFile(archiveId: string, originalUrl: string): TFile | null {
    // Primary: sourceArchiveId
    const byId = this.archiveLookup.findBySourceArchiveId(archiveId);
    if (byId) return byId;

    // Fallback: originalUrl
    const byUrl = this.archiveLookup.findByOriginalUrl(originalUrl);

    if (byUrl.length === 0) {
      // No local file — archive may only exist on mobile
      return null;
    }

    if (byUrl.length > 1) {
      // Ambiguous match — do NOT auto-update to avoid corrupting wrong file
      console.warn(
        '[AnnotationSyncService] Ambiguous originalUrl match — skipping auto-update.',
        'Multiple vault files share the same originalUrl.',
        { archiveId, originalUrl, matchCount: byUrl.length, paths: byUrl.map((f) => f.path) }
      );
      return null;
    }

    return byUrl[0] ?? null;
  }
}
