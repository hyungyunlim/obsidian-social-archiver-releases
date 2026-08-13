/**
 * ArchiveTagBackfillService
 *
 * Startup catch-up pass for archive→tag mappings created on other clients.
 *
 * Without it the plugin only ever learns about a tag through the live
 * `ws:archive_tags_updated` event, so every tag added on mobile while Obsidian
 * was closed never reached the vault (tag definitions synced, mappings did not).
 *
 * Semantics: **additive only**. Server tags missing locally are added; local
 * tags are never removed. Removals keep flowing through the WS event, which has
 * replacement semantics.
 *
 * ponytail: additive-only so an outbound push that failed while offline can't be
 * wiped by the next startup. Full replacement needs local dirty-tracking first
 * (mobile's TagSyncService push-then-pull) — add that if remote tag *removals*
 * made while Obsidian was closed turn out to matter.
 *
 * Single Responsibility: inbound archive-tag reconciliation (server → vault).
 */

import type { App, TFile } from 'obsidian';
import type { WorkersAPIClient } from '../../services/WorkersAPIClient';
import type { ArchiveLookupService } from '../../services/ArchiveLookupService';
import type { TagStore } from '../../services/TagStore';
import type { SocialArchiverSettings } from '../../types/settings';
import type { ArchiveTagOutboundService } from './ArchiveTagOutboundService';
import { mergeTagListsCaseInsensitive, normalizeTagName, readFrontmatterTags } from '../../utils/tags';

const LOG_PREFIX = '[Social Archiver] [TagBackfill]';

export interface ArchiveTagBackfillResult {
  /** Active mappings returned by the server. */
  serverMappings: number;
  /** Distinct archives carrying at least one resolvable tag. */
  taggedArchives: number;
  /** Mappings whose tag ID has no local definition (definition pull lagging). */
  unknownTagIds: number;
  /** Tagged archives with no matching vault note. */
  missingFiles: number;
  /** Notes that already carried every server tag. */
  alreadySyncedCount: number;
  /** Notes whose `archiveTags` gained at least one tag. */
  updatedCount: number;
  /** Notes that threw while being written. */
  failedCount: number;
}

export interface ArchiveTagBackfillDeps {
  app: App;
  apiClient: () => WorkersAPIClient | undefined;
  archiveLookup: ArchiveLookupService;
  tagStore: TagStore;
  getSettings: () => SocialArchiverSettings;
  /** Resolved lazily — the outbound service is re-created on settings changes. */
  archiveTagOutbound?: () => ArchiveTagOutboundService | undefined;
  /** Same archive write locks the WS tag path takes; identity when omitted. */
  withArchiveWriteLocks?: <T>(archiveId: string, fn: () => Promise<T>) => Promise<T>;
}

function emptyResult(): ArchiveTagBackfillResult {
  return {
    serverMappings: 0,
    taggedArchives: 0,
    unknownTagIds: 0,
    missingFiles: 0,
    alreadySyncedCount: 0,
    updatedCount: 0,
    failedCount: 0,
  };
}

const readStringArray = readFrontmatterTags;

/** Server tag names not already present locally (case-insensitive, `#` tolerant). */
function findMissingTags(localTags: string[], serverTags: string[]): string[] {
  const localLower = new Set(
    localTags.map(normalizeTagName).filter(Boolean).map(tag => tag.toLowerCase()),
  );
  return serverTags.filter(tag => !localLower.has(tag.toLowerCase()));
}

export class ArchiveTagBackfillService {
  constructor(private readonly deps: ArchiveTagBackfillDeps) {}

  /**
   * Pull every active archive-tag mapping and add the missing ones to the
   * matching vault notes. Safe to run on every startup — a vault already in
   * sync performs a single GET and no writes.
   */
  async reconcileFromServer(): Promise<ArchiveTagBackfillResult> {
    const result = emptyResult();

    // Same feature guard as the outbound service and the WS tag listener.
    if (!this.deps.getSettings().enableMobileAnnotationSync) return result;

    const apiClient = this.deps.apiClient();
    if (!apiClient) {
      throw new Error('API client not initialised');
    }

    const response = await apiClient.getArchiveTags();
    result.serverMappings = response.archiveTags.length;
    if (result.serverMappings === 0) return result;

    const tagNameById = new Map(
      this.deps.tagStore.getTagDefinitions().map(def => [def.id, def.name]),
    );

    const tagsByArchive = new Map<string, string[]>();
    for (const mapping of response.archiveTags) {
      const name = tagNameById.get(mapping.tagId);
      if (!name) {
        result.unknownTagIds += 1;
        continue;
      }

      const existing = tagsByArchive.get(mapping.archiveId);
      if (existing) {
        existing.push(name);
      } else {
        tagsByArchive.set(mapping.archiveId, [name]);
      }
    }

    result.taggedArchives = tagsByArchive.size;

    for (const [archiveId, serverTags] of tagsByArchive) {
      const file = this.deps.archiveLookup.findBySourceArchiveId(archiveId);
      if (!file) {
        result.missingFiles += 1;
        continue;
      }

      const frontmatter = this.deps.app.metadataCache.getFileCache(file)?.frontmatter;
      const localTags = readStringArray(frontmatter?.archiveTags);
      if (findMissingTags(localTags, serverTags).length === 0) {
        result.alreadySyncedCount += 1;
        continue;
      }

      try {
        await this.applyServerTags(file, archiveId, serverTags);
        result.updatedCount += 1;
      } catch (error) {
        result.failedCount += 1;
        console.warn(`${LOG_PREFIX} Failed to apply tags`, { path: file.path, error });
      }
    }

    console.debug(`${LOG_PREFIX} Completed`, result);
    return result;
  }

  private async applyServerTags(file: TFile, archiveId: string, serverTags: string[]): Promise<void> {
    const outbound = this.deps.archiveTagOutbound?.();

    // Our own write triggers MetadataCache.changed; without this the outbound
    // service would push the whole merged set straight back to the server.
    outbound?.addSuppression(archiveId);

    let mergedTags: string[] = [];

    const write = (): Promise<void> => this.deps.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      mergedTags = mergeTagListsCaseInsensitive(readStringArray(fm.archiveTags), serverTags);
      fm.archiveTags = mergedTags;

      if (this.deps.getSettings().mirrorArchiveTagsToObsidianTags) {
        fm.tags = mergeTagListsCaseInsensitive(readStringArray(fm.tags), serverTags);
      }
    });

    await (this.deps.withArchiveWriteLocks
      ? this.deps.withArchiveWriteLocks(archiveId, write)
      : write());

    // Seed the outbound snapshot so the first later edit of this note diffs
    // against the synced set instead of an empty one.
    outbound?.primeSnapshot(file.path, mergedTags);
  }
}
