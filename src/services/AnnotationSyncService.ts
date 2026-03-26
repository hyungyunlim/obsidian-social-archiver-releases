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
 *     → extract synthetic primary note (obsidian:{clientId}:primary) → comment frontmatter
 *     → render full annotation block (all notes + highlights)
 *     → update frontmatter (sourceArchiveId, counts, hasAnnotations)
 *     → apply managed annotation block to note body
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
import type { AnnotationRenderer } from './AnnotationRenderer';
import type { AnnotationSectionManager } from './AnnotationSectionManager';

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
  private readonly annotationRenderer: AnnotationRenderer;
  private readonly annotationSectionManager: AnnotationSectionManager;
  private readonly getSettings: () => SocialArchiverSettings;

  /** Per-archiveId coalescing state */
  private readonly coalesceMap = new Map<string, CoalesceEntry>();

  /**
   * Callback invoked right before this service writes outbound-triggering
   * frontmatter changes. The outbound service uses this to suppress the echo.
   * Set by wiring in main.ts.
   */
  onBeforeInboundWrite?: (archiveId: string) => void;

  constructor(
    app: App,
    workersApiClient: WorkersAPIClient,
    archiveLookup: ArchiveLookupService,
    annotationRenderer: AnnotationRenderer,
    annotationSectionManager: AnnotationSectionManager,
    getSettings: () => SocialArchiverSettings
  ) {
    this.app = app;
    this.workersApiClient = workersApiClient;
    this.archiveLookup = archiveLookup;
    this.annotationRenderer = annotationRenderer;
    this.annotationSectionManager = annotationSectionManager;
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

    // 3. Extract notes and highlights from server response
    const notes = archive.userNotes ?? [];
    const highlights = archive.userHighlights ?? [];
    const noteCount = notes.length;
    const highlightCount = highlights.length;
    const hasAnnotations = noteCount > 0 || highlightCount > 0;

    // 4. Determine comment from synthetic primary note only
    //    The synthetic primary note has id = "obsidian:{clientId}:primary"
    //    Only update the `comment` field if a synthetic primary note exists.
    //    If no primary note exists but other (mobile) notes do, leave comment as-is.
    //    If all notes are cleared, remove the comment field.
    const clientId = this.getSettings().syncClientId || '';
    const syntheticNoteId = `obsidian:${clientId}:primary`;
    const primaryNote = notes.find((n) => n.id === syntheticNoteId);

    // 5. Notify outbound service to suppress echo before we write
    this.onBeforeInboundWrite?.(archiveId);

    // 6. Update frontmatter (comment + counts + flags)
    try {
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        // Backfill sourceArchiveId if not already set
        if (!fm.sourceArchiveId) {
          fm.sourceArchiveId = archiveId;
        }

        // Sync comment from synthetic primary note only
        if (primaryNote) {
          // Primary note present — reflect its content in comment
          fm.comment = primaryNote.content;
        } else if (noteCount === 0) {
          // All notes cleared on mobile — remove comment
          delete fm.comment;
        }
        // If no primary note but other (mobile) notes exist, leave comment as-is

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
      // Non-fatal: continue to update body
    }

    // 7. Render the managed annotation block with ALL notes and highlights
    const annotationBlock = this.annotationRenderer.render({ notes, highlights });

    // 8. Apply annotation block to note body
    try {
      const content = await this.app.vault.read(file);
      const updatedContent = this.annotationSectionManager.upsert(content, annotationBlock);
      if (updatedContent !== content) {
        await this.app.vault.modify(file, updatedContent);
      }
    } catch (err) {
      console.error(
        '[AnnotationSyncService] Failed to update note body:',
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
