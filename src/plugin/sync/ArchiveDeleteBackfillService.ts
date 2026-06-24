/**
 * ArchiveDeleteBackfillService
 *
 * Server-canonical repair pass for archives deleted while Obsidian missed the
 * delta. This pass reads markdown files directly and does not depend on
 * ArchiveLookupService / MetadataCache, because those can miss cold-cache files.
 */

import type { App, TFile } from 'obsidian';
import type { WorkersAPIClient } from '../../services/WorkersAPIClient';

const PAGE_SIZE = 100;

export interface ArchiveDeleteBackfillResult {
  serverDeletedIds: number;
  serverDeletedUrls: number;
  serverActiveUrls: number;
  scannedFiles: number;
  matchedFiles: number;
  matchedByUrlCount: number;
  deletedCount: number;
  failedCount: number;
}

export interface ArchiveDeleteBackfillDeps {
  app: App;
  apiClient: () => WorkersAPIClient | undefined;
  updatedAfter: string;
  handleDeletedFile: (file: TFile, archiveId: string) => Promise<boolean>;
}

function unquoteYamlScalar(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '').trim();
}

function readFrontmatterScalar(frontmatter: string, key: string): string | undefined {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*?)\\s*$`, 'm'));
  const value = match?.[1];
  return value === undefined ? undefined : unquoteYamlScalar(value);
}

export interface ArchiveDeleteFrontmatterIdentity {
  sourceArchiveId?: string;
  originalUrl?: string;
}

export function parseArchiveDeleteFrontmatterIdentity(
  content: string,
): ArchiveDeleteFrontmatterIdentity | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const frontmatter = match?.[1];
  if (!frontmatter) return null;

  const sourceArchiveId = readFrontmatterScalar(frontmatter, 'sourceArchiveId');
  const originalUrl = readFrontmatterScalar(frontmatter, 'originalUrl');

  if (!sourceArchiveId && !originalUrl) return null;

  return {
    ...(sourceArchiveId ? { sourceArchiveId } : {}),
    ...(originalUrl ? { originalUrl } : {}),
  };
}

export function parseSourceArchiveIdFromMarkdown(content: string): string | null {
  return parseArchiveDeleteFrontmatterIdentity(content)?.sourceArchiveId ?? null;
}

interface ServerDeleteSnapshot {
  deletedIds: Set<string>;
  deletedOriginalUrls: Map<string, string>;
  activeOriginalUrls: Set<string>;
}

export class ArchiveDeleteBackfillService {
  private readonly deps: ArchiveDeleteBackfillDeps;

  constructor(deps: ArchiveDeleteBackfillDeps) {
    this.deps = deps;
  }

  async reconcileFromServer(): Promise<ArchiveDeleteBackfillResult> {
    const snapshot = await this.fetchServerDeleteSnapshot();
    const result: ArchiveDeleteBackfillResult = {
      serverDeletedIds: snapshot.deletedIds.size,
      serverDeletedUrls: snapshot.deletedOriginalUrls.size,
      serverActiveUrls: snapshot.activeOriginalUrls.size,
      scannedFiles: 0,
      matchedFiles: 0,
      matchedByUrlCount: 0,
      deletedCount: 0,
      failedCount: 0,
    };

    if (snapshot.deletedIds.size === 0 && snapshot.deletedOriginalUrls.size === 0) {
      console.debug('[Social Archiver] [ArchiveDeleteBackfill] No server tombstones found');
      return result;
    }

    for (const file of this.deps.app.vault.getMarkdownFiles()) {
      result.scannedFiles += 1;

      try {
        const content = await this.deps.app.vault.cachedRead(file);
        const identity = parseArchiveDeleteFrontmatterIdentity(content);
        if (!identity) continue;

        let archiveId: string | undefined;
        let matchedByUrl = false;

        if (identity.sourceArchiveId && snapshot.deletedIds.has(identity.sourceArchiveId)) {
          archiveId = identity.sourceArchiveId;
        } else if (
          !identity.sourceArchiveId &&
          identity.originalUrl &&
          !snapshot.activeOriginalUrls.has(identity.originalUrl)
        ) {
          archiveId = snapshot.deletedOriginalUrls.get(identity.originalUrl);
          matchedByUrl = Boolean(archiveId);
        }

        if (!archiveId) continue;

        result.matchedFiles += 1;
        if (matchedByUrl) {
          result.matchedByUrlCount += 1;
        }
        const deleted = await this.deps.handleDeletedFile(file, archiveId);
        if (deleted) {
          result.deletedCount += 1;
        } else {
          result.failedCount += 1;
        }
      } catch (error) {
        result.failedCount += 1;
        console.warn('[Social Archiver] [ArchiveDeleteBackfill] Failed to reconcile file', {
          path: file.path,
          error,
        });
      }
    }

    console.debug('[Social Archiver] [ArchiveDeleteBackfill] Completed', result);
    return result;
  }

  private async fetchServerDeleteSnapshot(): Promise<ServerDeleteSnapshot> {
    const apiClient = this.deps.apiClient();
    if (!apiClient) {
      throw new Error('API client not initialised');
    }

    const deletedIds = new Set<string>();
    const deletedOriginalUrls = new Map<string, string>();
    const activeOriginalUrls = new Set<string>();
    let offset = 0;
    let firstPage = true;

    while (true) {
      const response = await apiClient.getUserArchives({
        limit: PAGE_SIZE,
        offset,
        updatedAfter: this.deps.updatedAfter,
        includeDeleted: true,
        fields: 'sync_metadata',
      });

      for (const archiveId of response.deletedIds ?? []) {
        if (archiveId) deletedIds.add(archiveId);
      }

      if (firstPage) {
        for (const archive of response.deletedArchives ?? []) {
          if (!archive.id) continue;
          deletedIds.add(archive.id);
          if (archive.originalUrl && !deletedOriginalUrls.has(archive.originalUrl)) {
            deletedOriginalUrls.set(archive.originalUrl, archive.id);
          }
        }
        firstPage = false;
      }

      for (const archive of response.archives) {
        if (archive.originalUrl) {
          activeOriginalUrls.add(archive.originalUrl);
        }
      }

      if (!response.hasMore || response.archives.length === 0) {
        break;
      }

      offset += response.archives.length;
    }

    return { deletedIds, deletedOriginalUrls, activeOriginalUrls };
  }
}
