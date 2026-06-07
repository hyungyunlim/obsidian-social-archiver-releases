/**
 * LinkRelationSyncService
 *
 * Single Responsibility: keep the managed `## Linked archives` section of vault
 * notes in sync with the server's archive_link_relations model.
 *
 * Flow (per affected archive):
 *   getArchiveLinkRelations(archiveId)        — fetch active relations + summaries
 *     → resolve the local vault file (findBySourceArchiveId; skip if none)
 *     → LinkedArchivesRenderer.render()       — relations → marker-wrapped block
 *     → LinkedArchivesSectionManager.upsert()  — idempotent block replace
 *     → vault.modify ONLY when the content actually changed
 *
 * Triggers:
 *   - WS `archive_relation_updated` (re-render source + target sides)
 *   - pull-sync delta (after library delta sync + on WS reconnect)
 *   - new-note hooks (library save / remote ingest) — late-resolution upgrade
 *
 * INBOUND-ONLY: this service never parses the section back, and never
 * POSTs/DELETEs a relation. It is fully fail-soft — every public entry point
 * swallows its own errors so it can never block plugin load or other sync.
 *
 * Blueprint: {@link import('../../services/AnnotationSyncService').AnnotationSyncService}.
 */

import type { App, TFile } from 'obsidian';
import type { SocialArchiverSettings } from '@/types/settings';
import type { WorkersAPIClient } from '../../services/WorkersAPIClient';
import type { ArchiveLookupService } from '../../services/ArchiveLookupService';
import type { LinkedArchivesRenderer } from '../../services/LinkedArchivesRenderer';
import type { LinkedArchivesSectionManager } from '../../services/LinkedArchivesSectionManager';
import type { BodyWikilinkTarget } from '../../services/BodyLinkWikilinkMarker';
import { BodyLinkWikilinkMarker } from '../../services/BodyLinkWikilinkMarker';
import type { RelationWithSummary, ArchiveLinkRelation } from '@/types/link-relations';

// ============================================================================
// Coalescing state per archiveId (cloned from AnnotationSyncService)
// ============================================================================

interface CoalesceEntry {
  /** A sync operation is currently running for this archiveId. */
  inFlight: boolean;
  /** A new trigger arrived while in-flight; needs a single follow-up sync. */
  pending: boolean;
}

const PULL_PAGE_LIMIT = 200;
/** Small delay between per-archive applies during a pull sweep to spread load. */
const PULL_APPLY_DELAY_MS = 50;
/** Hard cap on pull pages per sweep — safety against an unexpected cursor loop. */
const PULL_MAX_PAGES = 50;

export interface LinkRelationSyncDeps {
  app: App;
  apiClient: () => WorkersAPIClient | undefined;
  archiveLookup: () => ArchiveLookupService | undefined;
  renderer: LinkedArchivesRenderer;
  sectionManager: LinkedArchivesSectionManager;
  settings: () => SocialArchiverSettings;
  saveSettings: () => Promise<void>;
}

// ============================================================================
// LinkRelationSyncService
// ============================================================================

export class LinkRelationSyncService {
  private readonly deps: LinkRelationSyncDeps;

  /** Body-link → wikilink reconcile pass (pure; constructed internally). */
  private readonly bodyLinkMarker = new BodyLinkWikilinkMarker();

  /** Per-archiveId coalescing state. */
  private readonly coalesceMap = new Map<string, CoalesceEntry>();

  /** Guards against overlapping pull sweeps. */
  private pullInFlight = false;

  /**
   * Callback invoked right before this service writes to a vault file, so
   * outbound watchers can suppress the resulting MetadataCache echo. Set by
   * wiring in main.ts (mirrors AnnotationSyncService.onBeforeInboundWrite).
   */
  onBeforeInboundWrite?: (archiveId: string) => void;

  constructor(deps: LinkRelationSyncDeps) {
    this.deps = deps;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Re-render the `## Linked archives` section for a single archive, coalescing
   * concurrent triggers. No-op when the feature is disabled. Never throws.
   */
  async applyForArchive(archiveId: string): Promise<void> {
    if (!this.deps.settings().enableLinkedArchivesSection) return;
    if (!archiveId) return;
    await this.coalesce(archiveId);
  }

  /**
   * Handle a WS `archive_relation_updated` event: re-render both ends of the
   * relation that resolve to a local file. Gated on the feature toggle.
   */
  async handleRelationUpdated(relation: ArchiveLinkRelation | undefined): Promise<void> {
    if (!this.deps.settings().enableLinkedArchivesSection) return;
    if (!relation) return;

    await this.applyForArchive(relation.sourceArchiveId);
    if (relation.targetArchiveId) {
      await this.applyForArchive(relation.targetArchiveId);
    }
  }

  /**
   * Pull-sync delta of relation changes since the persisted cursor, then
   * re-render every LOCAL archive touched by a returned relation (source OR
   * target — soft-deleted rows included so their stale rows are dropped).
   *
   * Loops pages while a full page is returned. Persists `serverTime` as the new
   * cursor. Fail-soft everywhere — a null response or any error ends the sweep
   * without advancing the cursor (so the next run retries the same delta).
   */
  async pullSync(): Promise<void> {
    if (!this.deps.settings().enableLinkedArchivesSection) return;
    if (this.pullInFlight) return;

    const apiClient = this.deps.apiClient();
    if (!apiClient) return;

    this.pullInFlight = true;
    try {
      let cursor = this.deps.settings().linkRelationsSync?.lastServerTime ?? '';

      for (let page = 0; page < PULL_MAX_PAGES; page++) {
        const result = await apiClient.getLinkRelationsUpdatedAfter(cursor || null, PULL_PAGE_LIMIT);
        if (!result) {
          // Fail-soft: stop without advancing the cursor.
          return;
        }

        const { relations, serverTime } = result;

        // Collect affected LOCAL archive ids (union of both sides), de-duped.
        const affected = new Set<string>();
        for (const relation of relations) {
          if (relation.sourceArchiveId) affected.add(relation.sourceArchiveId);
          if (relation.targetArchiveId) affected.add(relation.targetArchiveId);
        }

        const lookup = this.deps.archiveLookup();
        for (const archiveId of affected) {
          // Only spend a server round-trip on archives that resolve to a local
          // file — there is nothing to render otherwise.
          if (!lookup?.findBySourceArchiveId(archiveId)) continue;
          await this.applyForArchive(archiveId);
          await this.delay(PULL_APPLY_DELAY_MS);
        }

        // Last page when fewer than a full page came back — `serverTime` is
        // the durable high-water mark for the whole sweep.
        if (relations.length < PULL_PAGE_LIMIT) {
          if (serverTime) {
            await this.persistCursor(serverTime);
          }
          break;
        }

        // Full page: advance by the LAST row's updatedAt, NOT serverTime.
        // The server pages on `updated_at > cursor` (ASC), so jumping the
        // cursor to "now" would silently skip every remaining row until its
        // next mutation.
        const lastUpdatedAt = relations[relations.length - 1]?.updatedAt;
        if (!lastUpdatedAt || lastUpdatedAt === cursor) {
          // Defensive: a page that cannot advance the cursor (identical
          // timestamps) would loop forever — stop and let the next run retry.
          break;
        }
        await this.persistCursor(lastUpdatedAt);
        cursor = lastUpdatedAt;
      }
    } catch (err) {
      console.warn(
        '[LinkRelationSyncService] pullSync failed:',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      this.pullInFlight = false;
    }
  }

  // --------------------------------------------------------------------------
  // Coalescing (cloned from AnnotationSyncService)
  // --------------------------------------------------------------------------

  private async coalesce(archiveId: string): Promise<void> {
    const entry = this.coalesceMap.get(archiveId);

    if (entry?.inFlight) {
      entry.pending = true;
      return;
    }

    this.coalesceMap.set(archiveId, { inFlight: true, pending: false });

    try {
      await this.runApply(archiveId);
    } finally {
      const current = this.coalesceMap.get(archiveId);
      if (current?.pending) {
        current.inFlight = true;
        current.pending = false;
        try {
          await this.runApply(archiveId);
        } finally {
          this.coalesceMap.delete(archiveId);
        }
      } else {
        this.coalesceMap.delete(archiveId);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Core apply pipeline
  // --------------------------------------------------------------------------

  /**
   * Fetch relations for an archive, resolve its vault file, render the managed
   * block, and write only when changed. Never throws.
   */
  private async runApply(archiveId: string): Promise<void> {
    // Resolve the local file FIRST — if the archive has no vault note there is
    // nothing to render and we avoid a wasted server round-trip.
    const file = this.resolveFile(archiveId);
    if (!file) {
      return;
    }

    let relations: RelationWithSummary[];
    try {
      const apiClient = this.deps.apiClient();
      if (!apiClient) return;
      relations = await apiClient.getArchiveLinkRelations(archiveId);
    } catch (err) {
      console.warn(
        '[LinkRelationSyncService] Failed to fetch link relations for:',
        archiveId,
        err instanceof Error ? err.message : String(err),
      );
      return;
    }

    const block = this.deps.renderer.render({ relations, selfArchiveId: archiveId }, file.path);

    // Suppress the outbound echo before we write.
    this.onBeforeInboundWrite?.(archiveId);

    try {
      const content = await this.deps.app.vault.read(file);
      // Body pass: archived outgoing links become [[wikilinks]] in place
      // (visible text unchanged — highlight re-anchoring degrades at worst
      // from EXACT to WEAK; see BodyLinkWikilinkMarker header).
      const bodyTargets = this.buildBodyWikilinkTargets(archiveId, relations);
      const withBodyLinks = this.bodyLinkMarker.reconcile(content, bodyTargets);
      const updatedContent = this.deps.sectionManager.upsert(withBodyLinks, block);
      if (updatedContent !== content) {
        await this.deps.app.vault.modify(file, updatedContent);
      }
    } catch (err) {
      console.error(
        '[LinkRelationSyncService] Failed to update linked-archives section:',
        file.path,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * Build the body-conversion target list: OUTGOING connected relations whose
   * target archive resolves to a local vault note. Matching is URL-driven, so
   * note-mention rows are harmless to include (their tokens live in the
   * managed annotations block, which the marker never touches).
   */
  private buildBodyWikilinkTargets(
    archiveId: string,
    relations: RelationWithSummary[],
  ): BodyWikilinkTarget[] {
    const lookup = this.deps.archiveLookup();
    if (!lookup) return [];

    const targets: BodyWikilinkTarget[] = [];
    for (const { relation } of relations) {
      if (relation.sourceArchiveId !== archiveId) continue;
      if (relation.status !== 'connected') continue;
      if (relation.deletedAt) continue;
      if (!relation.targetArchiveId) continue;

      const targetFile = lookup.findBySourceArchiveId(relation.targetArchiveId);
      if (!targetFile) continue;

      const urls = [relation.targetUrl, relation.normalizedTargetUrl].filter(
        (url): url is string => !!url,
      );
      if (urls.length === 0) continue;

      targets.push({ urls, linktext: targetFile.basename });
    }
    return targets;
  }

  // --------------------------------------------------------------------------
  // File resolution (same policy as AnnotationSyncService — findBySourceArchiveId
  // only; NO originalUrl-ambiguity writes, skip silently when no file)
  // --------------------------------------------------------------------------

  private resolveFile(archiveId: string): TFile | null {
    return this.deps.archiveLookup()?.findBySourceArchiveId(archiveId) ?? null;
  }

  // --------------------------------------------------------------------------
  // Cursor persistence
  // --------------------------------------------------------------------------

  private async persistCursor(serverTime: string): Promise<void> {
    const settings = this.deps.settings();
    if (!settings.linkRelationsSync) {
      settings.linkRelationsSync = { lastServerTime: serverTime };
    } else {
      settings.linkRelationsSync.lastServerTime = serverTime;
    }
    try {
      await this.deps.saveSettings();
    } catch (err) {
      console.warn(
        '[LinkRelationSyncService] Failed to persist pull-sync cursor:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
}
