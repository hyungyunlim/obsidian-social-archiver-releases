/**
 * ArchiveTagOutboundService
 *
 * Watches `archiveTags` frontmatter changes on archive notes and syncs
 * them to the server tag system (tag entity + archive-tag mapping).
 *
 * Flow:
 *   MetadataCache.changed → detect archiveTags change →
 *   debounce → diff added/removed vs previous →
 *   upsert new tag entities → upsert/delete archive-tag mappings →
 *   add suppression to prevent self-echo from inbound WS event
 *
 * Single Responsibility: outbound archive tag sync (plugin → server)
 */

import type { App, EventRef, TFile } from 'obsidian';
import type { WorkersAPIClient, TagUpsertInput, ArchiveTagMappingInput } from '../../services/WorkersAPIClient';
import type { ArchiveLookupService } from '../../services/ArchiveLookupService';
import type { TagStore } from '../../services/TagStore';
import type { SocialArchiverSettings } from '../../types/settings';
import { normalizeTagName } from '../../utils/tags';

// ============================================================================
// Constants
// ============================================================================

/** Debounce delay before pushing a changed tag set to the server. */
const DEBOUNCE_MS = 2000;

/** Echo suppression TTL: ignore inbound WS events caused by our own API calls. */
const SUPPRESSION_TTL_MS = 10_000;

/** Log prefix */
const LOG_PREFIX = '[Social Archiver] [TagOutbound]';

// ============================================================================
// ArchiveTagOutboundService
// ============================================================================

export class ArchiveTagOutboundService {
  /** filePath → last known archiveTags snapshot */
  private readonly lastKnownArchiveTags = new Map<string, string[]>();

  /** filePath → active debounce timer ID */
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** archiveId → timestamp of last outbound sync (for echo suppression) */
  private readonly suppressionMap = new Map<string, number>();

  /**
   * Cache: tag name → server-assigned tag ID.
   * Populated lazily from upsertTags responses so repeated syncs reuse existing IDs.
   */
  private readonly tagNameToId = new Map<string, string>();

  /** EventRef for MetadataCache.changed listener (for cleanup) */
  private metadataCacheRef: EventRef | null = null;

  constructor(
    private readonly app: App,
    private readonly apiClient: WorkersAPIClient,
    private readonly archiveLookup: ArchiveLookupService,
    private readonly getSettings: () => SocialArchiverSettings,
    private readonly tagStore?: TagStore,
  ) {}

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Register the MetadataCache changed listener.
   * Call this after the plugin (and all dependencies) are fully initialized.
   */
  start(): void {
    if (this.metadataCacheRef) {
      // Already started — no-op
      return;
    }

    this.metadataCacheRef = this.app.metadataCache.on('changed', (file: TFile) => {
      this.onMetadataChanged(file);
    });

    console.debug(`${LOG_PREFIX} Started`);
  }

  /**
   * Remove the MetadataCache listener and clear all pending debounce timers.
   * Safe to call multiple times.
   */
  stop(): void {
    if (this.metadataCacheRef) {
      this.app.metadataCache.offref(this.metadataCacheRef);
      this.metadataCacheRef = null;
    }

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    console.debug(`${LOG_PREFIX} Stopped`);
  }

  // --------------------------------------------------------------------------
  // Suppression API (called by RealtimeEventBridge before inbound tag writes)
  // --------------------------------------------------------------------------

  /**
   * Mark an archiveId as "just synced outbound" so that the resulting inbound
   * WS echo event (`archive_tags_updated`) is ignored.
   *
   * Also called by RealtimeEventBridge before writing inbound tag changes so
   * that the subsequent MetadataCache.changed event does not re-trigger an
   * outbound sync.
   */
  addSuppression(archiveId: string): void {
    this.suppressionMap.set(archiveId, Date.now());
  }

  /**
   * Check whether the archiveId is currently within the suppression window.
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
    const settings = this.getSettings();

    // Feature guard: reuse enableMobileAnnotationSync toggle
    if (!settings.enableMobileAnnotationSync) return;

    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache?.frontmatter) return;

    const fm = cache.frontmatter;

    // Only process archive notes (must have sourceArchiveId)
    const archiveId = fm.sourceArchiveId;
    if (typeof archiveId !== 'string' || !archiveId) return;

    // Skip if this archiveId is currently suppressed (inbound write or just sent)
    if (this.isSuppressed(archiveId)) return;

    // Read current archiveTags from frontmatter (null/undefined → empty array)
    const currentTags: string[] = Array.isArray(fm.archiveTags)
      ? (fm.archiveTags as unknown[]).filter((t): t is string => typeof t === 'string')
      : [];

    // Read previous snapshot
    const previousTags = this.lastKnownArchiveTags.get(file.path) ?? [];

    // No change — nothing to do
    if (arraysEqual(currentTags, previousTags)) return;

    // Debounce: cancel existing timer, start a new one
    const existing = this.debounceTimers.get(file.path);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(file.path);

      const snapshot = this.lastKnownArchiveTags.get(file.path) ?? [];

      // Re-read current state at fire time (may have changed during debounce)
      const latestCache = this.app.metadataCache.getFileCache(file);
      const latestFm = latestCache?.frontmatter;
      const latestTags: string[] = Array.isArray(latestFm?.archiveTags)
        ? (latestFm!.archiveTags as unknown[]).filter((t): t is string => typeof t === 'string')
        : [];

      if (arraysEqual(latestTags, snapshot)) return;

      // Commit the snapshot now (optimistic, before the async call)
      this.lastKnownArchiveTags.set(file.path, latestTags);

      void this.syncArchiveTags(archiveId, latestTags, snapshot).catch((err: unknown) => {
        console.error(`${LOG_PREFIX} Sync failed for ${archiveId}:`, err instanceof Error ? err.message : String(err));
        // Revert snapshot so the next change triggers a retry
        this.lastKnownArchiveTags.set(file.path, snapshot);
      });
    }, DEBOUNCE_MS);

    this.debounceTimers.set(file.path, timer);
  }

  // --------------------------------------------------------------------------
  // Internal — Server sync
  // --------------------------------------------------------------------------

  /**
   * Diff current vs previous tag sets, then push adds/removes to the server.
   */
  private async syncArchiveTags(
    archiveId: string,
    currentTags: string[],
    previousTags: string[],
  ): Promise<void> {
    const normCurrent = currentTags.map(normalizeTagName).filter(Boolean);
    const normPrevious = previousTags.map(normalizeTagName).filter(Boolean);
    const added = normCurrent.filter(t => !normPrevious.includes(t));
    const removed = normPrevious.filter(t => !normCurrent.includes(t));

    if (added.length === 0 && removed.length === 0) return;

    const settings = this.getSettings();
    const clientId = settings.syncClientId || '';

    console.debug(`${LOG_PREFIX} Syncing tags for ${archiveId}`, { added, removed });

    // 1. Upsert tag entities for newly added tag names
    if (added.length > 0) {
      const tagsToUpsert: TagUpsertInput[] = added.map(name => {
        const def = this.tagStore?.getTagByName(name);
        return {
          id: this.tagNameToId.get(name) ?? def?.id ?? crypto.randomUUID(),
          name,
          color: def?.color ?? null,
          sortOrder: def?.sortOrder ?? 0,
        };
      });

      // Seed the ID cache so we can map name → ID for the mapping step
      for (const tag of tagsToUpsert) {
        if (!this.tagNameToId.has(tag.name)) {
          this.tagNameToId.set(tag.name, tag.id);
        }
      }

      try {
        const result = await this.apiClient.upsertTags(tagsToUpsert, clientId);
        // Update cache with canonical IDs from server response
        if (result.resolvedTags) {
          for (const resolved of result.resolvedTags) {
            const tag = resolved.canonicalTag;
            this.tagNameToId.set(tag.name, tag.id);
          }
        }
      } catch (err) {
        console.error(`${LOG_PREFIX} upsertTags failed for ${archiveId}:`, err instanceof Error ? err.message : String(err));
        throw err;
      }
    }

    // 2. Upsert archive-tag mappings for added tags
    if (added.length > 0) {
      const mappingsToAdd: ArchiveTagMappingInput[] = added.map(name => ({
        archiveId,
        tagId: this.tagNameToId.get(name)!,
      }));

      try {
        await this.apiClient.upsertArchiveTags(mappingsToAdd, clientId);
      } catch (err) {
        console.error(`${LOG_PREFIX} upsertArchiveTags failed for ${archiveId}:`, err instanceof Error ? err.message : String(err));
        throw err;
      }
    }

    // 3. Delete archive-tag mappings for removed tags (cache + tagStore fallback)
    if (removed.length > 0) {
      const pairsToRemove: ArchiveTagMappingInput[] = removed
        .map(name => {
          const id = this.tagNameToId.get(name) ?? this.tagStore?.getTagByName(name)?.id;
          return id ? { archiveId, tagId: id } : null;
        })
        .filter((pair): pair is ArchiveTagMappingInput => pair !== null);

      if (pairsToRemove.length > 0) {
        try {
          await this.apiClient.deleteArchiveTags(pairsToRemove, clientId);
        } catch (err) {
          console.error(`${LOG_PREFIX} deleteArchiveTags failed for ${archiveId}:`, err instanceof Error ? err.message : String(err));
          throw err;
        }
      }

      const skipped = removed.length - pairsToRemove.length;
      if (skipped > 0) {
        console.warn(
          `${LOG_PREFIX} Skipped ${skipped} removal(s) for ${archiveId} — tag ID unknown. ` +
          'These will be removed on next full sync.',
        );
      }
    }

    // 4. Suppress the resulting inbound WS echo
    this.addSuppression(archiveId);

    console.debug(`${LOG_PREFIX} Sync complete for ${archiveId}`, {
      added: added.length,
      removed: removed.length,
    });
  }

  /**
   * Rebuild the tag name → ID cache from a complete set of tag definitions.
   * Uses replace semantics (clears first) to remove stale entries from renames.
   */
  rebuildTagCache(tags: Array<{ id: string; name: string }>): void {
    this.tagNameToId.clear();
    for (const tag of tags) {
      this.tagNameToId.set(tag.name, tag.id);
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Returns true if two string arrays have the same elements in the same order. */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
