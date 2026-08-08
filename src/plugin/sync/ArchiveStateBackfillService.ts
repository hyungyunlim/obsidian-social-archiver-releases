/**
 * ArchiveStateBackfillService
 *
 * Server-canonical repair pass for local `archive` frontmatter. This pass does
 * not depend on ArchiveLookupService or MetadataCache; it reads markdown files
 * directly and matches by `sourceArchiveId`.
 */

import type { App, TFile } from 'obsidian';
import type { WorkersAPIClient } from '../../services/WorkersAPIClient';

const PAGE_SIZE = 100;

export interface ArchiveStateBackfillResult {
  serverArchives: number;
  scannedFiles: number;
  matchedFiles: number;
  alreadySyncedCount: number;
  updatedCount: number;
  missingServerCount: number;
  failedCount: number;
}

export interface ArchiveStateBackfillDeps {
  app: App;
  apiClient: () => WorkersAPIClient | undefined;
  reconcileArchiveState: (file: TFile, archiveId: string, isBookmarked: boolean) => Promise<void>;
  reconcileShareState?: (file: TFile, archiveId: string, shareUrl: string | null) => Promise<void>;
}

interface ServerArchiveState {
  isBookmarked: boolean;
  /** `undefined` = server omitted the field (older API); `null` = not shared. */
  shareUrl?: string | null;
}

export interface ArchiveStateFrontmatterIdentity {
  sourceArchiveId?: string;
  archive: boolean;
}

function unquoteYamlScalar(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '').trim();
}

function readFrontmatterScalar(frontmatter: string, key: string): string | undefined {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*?)\\s*$`, 'm'));
  const value = match?.[1];
  return value === undefined ? undefined : unquoteYamlScalar(value);
}

function parseYamlBoolean(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return normalized === 'true' || normalized === 'yes';
}

export function parseArchiveStateFrontmatterIdentity(
  content: string,
): ArchiveStateFrontmatterIdentity | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const frontmatter = match?.[1];
  if (!frontmatter) return null;

  const sourceArchiveId = readFrontmatterScalar(frontmatter, 'sourceArchiveId');
  const archive = parseYamlBoolean(readFrontmatterScalar(frontmatter, 'archive'));

  return {
    ...(sourceArchiveId ? { sourceArchiveId } : {}),
    archive,
  };
}

export class ArchiveStateBackfillService {
  private readonly deps: ArchiveStateBackfillDeps;

  constructor(deps: ArchiveStateBackfillDeps) {
    this.deps = deps;
  }

  async reconcileFromServer(): Promise<ArchiveStateBackfillResult> {
    const serverStates = await this.fetchServerStates();
    const result: ArchiveStateBackfillResult = {
      serverArchives: serverStates.size,
      scannedFiles: 0,
      matchedFiles: 0,
      alreadySyncedCount: 0,
      updatedCount: 0,
      missingServerCount: 0,
      failedCount: 0,
    };

    for (const file of this.deps.app.vault.getMarkdownFiles()) {
      result.scannedFiles += 1;

      try {
        const content = await this.deps.app.vault.cachedRead(file);
        const identity = parseArchiveStateFrontmatterIdentity(content);
        if (!identity?.sourceArchiveId) continue;

        result.matchedFiles += 1;
        const serverState = serverStates.get(identity.sourceArchiveId);
        if (serverState === undefined) {
          result.missingServerCount += 1;
          continue;
        }

        // Share state has its own no-op guard inside reconcileShareState, so it
        // is reconciled independently of whether the bookmark flag drifted.
        if (this.deps.reconcileShareState && serverState.shareUrl !== undefined) {
          await this.deps.reconcileShareState(
            file,
            identity.sourceArchiveId,
            serverState.shareUrl,
          );
        }

        if (identity.archive === serverState.isBookmarked) {
          result.alreadySyncedCount += 1;
          continue;
        }

        await this.deps.reconcileArchiveState(
          file,
          identity.sourceArchiveId,
          serverState.isBookmarked,
        );
        result.updatedCount += 1;
      } catch (error) {
        result.failedCount += 1;
        console.warn('[Social Archiver] [ArchiveStateBackfill] Failed to reconcile file', {
          path: file.path,
          error,
        });
      }
    }

    console.debug('[Social Archiver] [ArchiveStateBackfill] Completed', result);
    return result;
  }

  private async fetchServerStates(): Promise<Map<string, ServerArchiveState>> {
    const apiClient = this.deps.apiClient();
    if (!apiClient) {
      throw new Error('API client not initialised');
    }

    const states = new Map<string, ServerArchiveState>();
    let offset = 0;

    while (true) {
      const response = await apiClient.getUserArchives({
        limit: PAGE_SIZE,
        offset,
        fields: 'sync_metadata',
      });

      for (const archive of response.archives) {
        if (typeof archive.isBookmarked === 'boolean') {
          states.set(archive.id, {
            isBookmarked: archive.isBookmarked,
            ...(archive.shareUrl !== undefined ? { shareUrl: archive.shareUrl } : {}),
          });
        }
      }

      if (!response.hasMore || response.archives.length === 0) {
        break;
      }

      offset += response.archives.length;
    }

    return states;
  }
}
