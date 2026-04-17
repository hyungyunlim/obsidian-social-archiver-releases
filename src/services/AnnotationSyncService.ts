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
import type { WorkersAPIClient, UserArchive } from './WorkersAPIClient';
import type { ArchiveLookupService } from './ArchiveLookupService';
import type { AnnotationRenderer } from './AnnotationRenderer';
import type { AnnotationSectionManager } from './AnnotationSectionManager';
import { HighlightBodyMarker } from './HighlightBodyMarker';

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
  private readonly highlightBodyMarker: HighlightBodyMarker;
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
    getSettings: () => SocialArchiverSettings,
    highlightBodyMarker: HighlightBodyMarker = new HighlightBodyMarker()
  ) {
    this.app = app;
    this.workersApiClient = workersApiClient;
    this.archiveLookup = archiveLookup;
    this.annotationRenderer = annotationRenderer;
    this.annotationSectionManager = annotationSectionManager;
    this.highlightBodyMarker = highlightBodyMarker;
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

    await this.applyAnnotationState(file, archive);
  }

  /**
   * Apply an archive's notes + highlights to a specific vault file.
   *
   * Shared pipeline used by:
   *   - `runSync()` (triggered by WebSocket action_updated events)
   *   - `reconcileFromLibrarySync()` (triggered per-archive during library sync)
   *
   * Never throws — failures at any stage are logged and swallowed so the
   * caller's outer loop (e.g. library sync) keeps progressing.
   */
  async applyAnnotationState(file: TFile, archive: UserArchive): Promise<void> {
    const archiveId = archive.id;
    const notes = archive.userNotes ?? [];
    const highlights = archive.userHighlights ?? [];
    const noteCount = notes.length;
    const highlightCount = highlights.length;
    const hasAnnotations = noteCount > 0 || highlightCount > 0;

    // Determine comment from synthetic primary note only. See runSync for
    // the full semantics of this rule.
    const clientId = this.getSettings().syncClientId || '';
    const syntheticNoteId = `obsidian:${clientId}:primary`;
    const primaryNote = notes.find((n) => n.id === syntheticNoteId);

    // Notify outbound service to suppress echo before we write
    this.onBeforeInboundWrite?.(archiveId);

    // Update frontmatter (comment + counts + flags)
    try {
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        if (!fm.sourceArchiveId) {
          fm.sourceArchiveId = archiveId;
        }

        if (primaryNote) {
          fm.comment = primaryNote.content;
        } else if (noteCount === 0) {
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
      // Non-fatal: continue to update body
    }

    // Render the managed annotation block with ALL notes and highlights
    const annotationBlock = this.annotationRenderer.render({ notes, highlights });

    // Apply annotation block to note body, and reconcile inline ==text== marks
    // so reader mode / timeline cards visualise the highlights.
    //
    // Phase 3 (PRD §5.4, §5.5) — we pass the archive envelope so dual-read
    // can see `coordinateVersion` / `schemaVersion` on the envelope and run
    // the 4-state runtime classification. Plugin is read-only here: no
    // write-back is scheduled (plugin is the canonical WRITE-path per §5.5).
    try {
      const content = await this.app.vault.read(file);
      const reconciledBody = this.highlightBodyMarker.reconcile(content, {
        id: archiveId,
        userHighlights: highlights,
      });
      const updatedContent = this.annotationSectionManager.upsert(reconciledBody, annotationBlock);
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

  /**
   * Reconcile a file's annotation state against an archive payload already
   * fetched by the library sync. Avoids the extra server round-trip that
   * `runSync()` performs.
   */
  async reconcileFromLibrarySync(file: TFile, archive: UserArchive): Promise<void> {
    await this.applyAnnotationState(file, archive);
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
