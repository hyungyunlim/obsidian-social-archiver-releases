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
 * "Previous" is the tag set the server is believed to hold. Notes that existed
 * when the session started are baselined with what they already carry (seeded
 * once the metadata cache resolves, or on first sight if older than the
 * session), so a startup re-index or an unrelated plugin write pushes nothing.
 * Only a note written during the session diffs against an empty set.
 *
 * A push that fails retryably is parked in `pendingArchiveTagSyncs` with the
 * tags the server last confirmed, and replayed by `flushPendingSyncs()` before
 * the startup backfill — otherwise the backfill would undo the offline edit.
 *
 * Single Responsibility: outbound archive tag sync (plugin → server)
 */

import type { App, EventRef, MetadataCache, TFile } from 'obsidian';
import type { WorkersAPIClient, TagUpsertInput, ArchiveTagMappingInput } from '../../services/WorkersAPIClient';
import type { ArchiveLookupService } from '../../services/ArchiveLookupService';
import type { TagStore } from '../../services/TagStore';
import type { SocialArchiverSettings } from '../../types/settings';
import { mirrorArchiveTagsIntoObsidianTags, normalizeTagName, readFrontmatterTags } from '../../utils/tags';

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

  /** filePath → active debounce timer ID + the archive it will push */
  private readonly debounceTimers = new Map<string, { timer: number; archiveId: string }>();

  /** archiveId → timestamp of last outbound sync (for echo suppression) */
  private readonly suppressionMap = new Map<string, number>();

  /**
   * Cache: tag name → server-assigned tag ID.
   * Populated lazily from upsertTags responses so repeated syncs reuse existing IDs.
   */
  private readonly tagNameToId = new Map<string, string>();

  /** EventRef for MetadataCache.changed listener (for cleanup) */
  private metadataCacheRef: EventRef | null = null;

  /** One-shot MetadataCache.resolved listener that seeds the snapshots. */
  private resolvedRef: EventRef | null = null;

  /** When start() ran — files last modified before it predate the session. */
  private startedAt = 0;

  constructor(
    private readonly app: App,
    private readonly apiClient: WorkersAPIClient,
    private readonly archiveLookup: ArchiveLookupService,
    private readonly getSettings: () => SocialArchiverSettings,
    private readonly tagStore?: TagStore,
    private readonly saveSettings?: (partial: Partial<SocialArchiverSettings>) => Promise<void>,
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

    this.startedAt = Date.now();
    this.metadataCacheRef = this.app.metadataCache.on('changed', (file: TFile) => {
      this.onMetadataChanged(file);
    });

    // At plugin load getFileCache() can still return null, so seed once the
    // cache has resolved (same wait as ArchiveLookupService).
    if ((this.app.metadataCache as MetadataCache & { resolved?: boolean }).resolved) {
      this.seedSnapshots();
    } else {
      this.resolvedRef = this.app.metadataCache.on('resolved', () => {
        this.offResolved();
        this.seedSnapshots();
      });
    }

    console.debug(`${LOG_PREFIX} Started`);
  }

  /**
   * Remove the MetadataCache listener and clear all pending debounce timers.
   * Edits still waiting out the debounce (settings reload, quit) are parked,
   * or the next session would baseline them as already pushed.
   * Safe to call multiple times.
   */
  stop(): void {
    if (this.metadataCacheRef) {
      this.app.metadataCache.offref(this.metadataCacheRef);
      this.metadataCacheRef = null;
    }
    this.offResolved();

    if (this.debounceTimers.size > 0) {
      const pending = { ...this.getPendingSyncs() };
      for (const [path, { timer, archiveId }] of this.debounceTimers) {
        window.clearTimeout(timer);
        pending[archiveId] ??= this.lastKnownArchiveTags.get(path) ?? [];
      }
      void this.savePendingSyncs(pending);
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
   * Seed the last-known tag snapshot for a file written by an inbound sync.
   *
   * Snapshots start empty, so without this the first metadata change after an
   * inbound write diffs `[...serverTags]` against `[]` and re-pushes every tag.
   */
  primeSnapshot(filePath: string, tags: string[]): void {
    this.lastKnownArchiveTags.set(filePath, [...tags]);
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
  // Offline edits (pushes parked in pendingArchiveTagSyncs)
  // --------------------------------------------------------------------------

  /**
   * Replay pushes that failed earlier (offline edits) against each note's
   * current tags. Call before reconciling from the server: until the edit
   * lands, the server's mappings for that archive are stale.
   */
  async flushPendingSyncs(): Promise<void> {
    for (const [archiveId, confirmedTags] of Object.entries(this.getPendingSyncs())) {
      // ponytail: a note deleted since stays parked (a few bytes); the backfill
      // skips missing notes anyway. Prune here if the map ever grows.
      const file = this.archiveLookup.findBySourceArchiveId(archiveId);
      if (!file) continue;

      const currentTags = readFrontmatterTags(this.app.metadataCache.getFileCache(file)?.frontmatter?.archiveTags);
      try {
        await this.syncArchiveTags(archiveId, currentTags, confirmedTags);
        this.lastKnownArchiveTags.set(file.path, currentTags);
      } catch {
        // Still failing (each step logs its own error) — stays parked.
      }
    }
  }

  /** True while a local edit to this archive's tags has not reached the server. */
  hasPendingSync(archiveId: string): boolean {
    return archiveId in this.getPendingSyncs();
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

    const fm = cache.frontmatter as Record<string, unknown>;

    // Only process archive notes (must have sourceArchiveId)
    const archiveId: unknown = fm.sourceArchiveId;
    if (typeof archiveId !== 'string' || !archiveId) return;

    // Skip if this archiveId is currently suppressed (inbound write or just sent)
    if (this.isSuppressed(archiveId)) return;

    // A YAML scalar (`archiveTags: work`) is an inline list, not "no tags".
    const currentTags = readFrontmatterTags(fm.archiveTags);

    if (!this.lastKnownArchiveTags.has(file.path)) {
      // First sight this session. Content already on disk when the session
      // started (Obsidian indexing it at load) is what the server holds; a
      // note written since — a new archive — has never been pushed.
      const predatesSession = file.stat.mtime < this.startedAt;
      this.lastKnownArchiveTags.set(
        file.path,
        this.getPendingSyncs()[archiveId] ?? (predatesSession ? currentTags : []),
      );
    }
    const previousTags = this.lastKnownArchiveTags.get(file.path) ?? [];

    // No change — nothing to do
    if (arraysEqual(currentTags, previousTags)) return;

    // Debounce: cancel existing timer, start a new one
    const existing = this.debounceTimers.get(file.path);
    if (existing !== undefined) {
      window.clearTimeout(existing.timer);
    }

    const timer = window.setTimeout(() => {
      this.debounceTimers.delete(file.path);

      const snapshot = this.lastKnownArchiveTags.get(file.path) ?? [];

      // Re-read current state at fire time (may have changed during debounce)
      const latestTags = readFrontmatterTags(this.app.metadataCache.getFileCache(file)?.frontmatter?.archiveTags);

      if (arraysEqual(latestTags, snapshot)) return;

      // Commit the snapshot now (optimistic, before the async call)
      this.lastKnownArchiveTags.set(file.path, latestTags);

      void this.syncArchiveTags(archiveId, latestTags, snapshot).catch((err: unknown) => {
        console.error(`${LOG_PREFIX} Sync failed for ${archiveId}:`, err instanceof Error ? err.message : String(err));
        // Revert snapshot so the next change triggers a retry
        this.lastKnownArchiveTags.set(file.path, snapshot);
      });
    }, DEBOUNCE_MS);

    this.debounceTimers.set(file.path, { timer, archiveId });
  }

  // --------------------------------------------------------------------------
  // Internal — Server sync
  // --------------------------------------------------------------------------

  /**
   * Push one note's tag diff. A failure a retry can fix (offline, 5xx) parks
   * the edit with the tags the server last confirmed, so it survives a
   * restart; a push that lands clears the entry it started from.
   */
  private async syncArchiveTags(
    archiveId: string,
    currentTags: string[],
    previousTags: string[],
  ): Promise<void> {
    try {
      await this.pushArchiveTags(archiveId, currentTags, previousTags);
    } catch (err) {
      if (!isPermanentRejection(err)) await this.markPendingSync(archiveId, previousTags);
      throw err;
    }
    await this.clearPendingSync(archiveId, previousTags);
  }

  /**
   * Diff current vs previous tag sets, then push adds/removes to the server.
   */
  private async pushArchiveTags(
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
      // A rename (old → new) or a case edit resolves both names to the SAME
      // tag ID — the name→ID cache keeps the old name until the next rebuild —
      // so deleting it would undo the mapping step 2 just upserted.
      const keptIds = new Set(normCurrent.map(name => this.resolveTagId(name)));
      const removedIds = removed.map(name => this.resolveTagId(name));
      const pairsToRemove: ArchiveTagMappingInput[] = removedIds
        .filter((id): id is string => id !== undefined && !keptIds.has(id))
        .map(tagId => ({ archiveId, tagId }));

      if (pairsToRemove.length > 0) {
        try {
          await this.apiClient.deleteArchiveTags(pairsToRemove, clientId);
        } catch (err) {
          console.error(`${LOG_PREFIX} deleteArchiveTags failed for ${archiveId}:`, err instanceof Error ? err.message : String(err));
          throw err;
        }
      }

      const skipped = removedIds.filter(id => id === undefined).length;
      if (skipped > 0) {
        console.warn(
          `${LOG_PREFIX} Skipped ${skipped} removal(s) for ${archiveId} — tag ID unknown. ` +
          'These will be removed on next full sync.',
        );
      }
    }

    // 4. Suppress the resulting inbound WS echo
    this.addSuppression(archiveId);

    if (settings.mirrorArchiveTagsToObsidianTags) {
      await this.mirrorArchiveTagsToObsidianTags(archiveId, previousTags, currentTags);
    }

    console.debug(`${LOG_PREFIX} Sync complete for ${archiveId}`, {
      added: added.length,
      removed: removed.length,
    });
  }

  private async mirrorArchiveTagsToObsidianTags(
    archiveId: string,
    previousArchiveTags: string[],
    nextArchiveTags: string[],
  ): Promise<void> {
    const file = this.archiveLookup.findBySourceArchiveId(archiveId);
    if (!file) return;

    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      const currentTags = readFrontmatterTags(fm.tags);

      fm.tags = mirrorArchiveTagsIntoObsidianTags(
        currentTags,
        previousArchiveTags,
        nextArchiveTags,
      );
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

  /** Name → server tag ID: outbound cache first, then the local definition. */
  private resolveTagId(name: string): string | undefined {
    return this.tagNameToId.get(name) ?? this.tagStore?.getTagByName(name)?.id;
  }

  // --------------------------------------------------------------------------
  // Internal — Snapshot seeding + pending-sync persistence
  // --------------------------------------------------------------------------

  /**
   * Baseline every archive note not yet seen this session with the tags it
   * already carries — the server's state — so a later unrelated write diffs
   * to nothing. A parked edit seeds from the server-confirmed tags instead,
   * so the note's next change replays it.
   */
  private seedSnapshots(): void {
    const pending = this.getPendingSyncs();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (this.lastKnownArchiveTags.has(file.path)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const archiveId: unknown = fm?.sourceArchiveId;
      if (typeof archiveId !== 'string' || !archiveId) continue;
      this.lastKnownArchiveTags.set(file.path, pending[archiveId] ?? readFrontmatterTags(fm?.archiveTags));
    }
  }

  private offResolved(): void {
    if (this.resolvedRef) {
      this.app.metadataCache.offref(this.resolvedRef);
      this.resolvedRef = null;
    }
  }

  private getPendingSyncs(): Record<string, string[]> {
    return this.getSettings().pendingArchiveTagSyncs ?? {};
  }

  /** Park a failed push. An existing entry wins: it is what the server last confirmed. */
  private async markPendingSync(archiveId: string, confirmedTags: string[]): Promise<void> {
    const pending = this.getPendingSyncs();
    if (pending[archiveId]) return;
    await this.savePendingSyncs({ ...pending, [archiveId]: confirmedTags });
  }

  /** Clear the entry a landed push started from (another entry = an earlier push still failed). */
  private async clearPendingSync(archiveId: string, confirmedTags: string[]): Promise<void> {
    const pending = this.getPendingSyncs();
    const entry = pending[archiveId];
    if (!entry || !arraysEqual(entry, confirmedTags)) return;
    const rest = { ...pending };
    delete rest[archiveId];
    await this.savePendingSyncs(rest);
  }

  private async savePendingSyncs(pending: Record<string, string[]>): Promise<void> {
    try {
      await this.saveSettings?.({ pendingArchiveTagSyncs: pending });
    } catch (err) {
      console.warn(`${LOG_PREFIX} Failed to persist pending tag syncs:`, err instanceof Error ? err.message : String(err));
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * A 4xx the server would return again on replay (invalid name, too many tags).
 * Parking it would block the backfill for that archive forever.
 */
function isPermanentRejection(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500
    && status !== 401 && status !== 403 && status !== 408 && status !== 429;
}

/** Returns true if two string arrays have the same elements in the same order. */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
