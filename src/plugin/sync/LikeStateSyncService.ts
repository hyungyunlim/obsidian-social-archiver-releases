/**
 * LikeStateSyncService
 *
 * Single Responsibility: Handle inbound `action_updated` events that carry
 * `isLiked` changes and apply them to local vault `like` frontmatter.
 */

import type { App, TFile } from 'obsidian';
import type { ActionUpdatedEventData } from '@/types/websocket';
import type { SocialArchiverSettings } from '@/types/settings';
import type { WorkersAPIClient } from '../../services/WorkersAPIClient';
import type { ArchiveLookupService } from '../../services/ArchiveLookupService';

const SUPPRESSION_TTL_MS = 10_000;
const LOG_PREFIX = '[Social Archiver] [LikeStateSyncService]';

export class LikeStateSyncService {
  onBeforeInboundWrite?: (archiveId: string) => void;
  onAfterInboundWrite?: () => void;

  private readonly suppressionMap = new Map<string, number>();

  constructor(
    private readonly app: App,
    private readonly apiClient: WorkersAPIClient,
    private readonly archiveLookup: ArchiveLookupService,
    private readonly getSettings: () => SocialArchiverSettings,
  ) {}

  addSuppression(archiveId: string): void {
    this.suppressionMap.set(archiveId, Date.now());
  }

  isSuppressed(archiveId: string): boolean {
    const ts = this.suppressionMap.get(archiveId);
    if (ts === undefined) return false;
    if (Date.now() - ts > SUPPRESSION_TTL_MS) {
      this.suppressionMap.delete(archiveId);
      return false;
    }
    return true;
  }

  async handleRemoteLikeState(eventData: ActionUpdatedEventData): Promise<void> {
    const { archiveId, sourceClientId, changes } = eventData;
    if (changes.isLiked === undefined) return;

    const newLikeState = changes.isLiked;
    const settings = this.getSettings();
    if (sourceClientId && sourceClientId === settings.syncClientId) return;
    if (this.isSuppressed(archiveId)) return;

    let file = this.archiveLookup.findBySourceArchiveId(archiveId);
    let sourceArchiveIdMissing = false;

    if (!file) {
      let originalUrl: string | undefined;
      try {
        const response = await this.apiClient.getUserArchive(archiveId);
        originalUrl = response.archive.originalUrl;
      } catch {
        return;
      }

      if (originalUrl) {
        const candidates = this.archiveLookup.findByOriginalUrl(originalUrl);
        if (candidates.length === 1) {
          file = candidates[0] ?? null;
          sourceArchiveIdMissing = true;
        } else if (candidates.length > 1) {
          console.warn(LOG_PREFIX, 'Ambiguous originalUrl match — skipping like state update.', {
            archiveId,
            originalUrl,
            matchCount: candidates.length,
          });
          return;
        }
      }
    }

    if (!file) return;

    const cache = this.app.metadataCache.getFileCache(file);
    const currentLike = cache?.frontmatter?.['like'];
    if (currentLike === newLikeState) return;

    this.onBeforeInboundWrite?.(archiveId);
    this.addSuppression(archiveId);

    try {
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        fm['like'] = newLikeState;
        if (sourceArchiveIdMissing && !fm['sourceArchiveId']) {
          fm['sourceArchiveId'] = archiveId;
        }
      });

      this.onAfterInboundWrite?.();
    } catch (err) {
      console.error(
        LOG_PREFIX,
        'Failed to update fm.like:',
        file.path,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async reconcileFromLibrarySync(
    file: TFile,
    archiveId: string,
    isLiked: boolean,
  ): Promise<void> {
    if (this.isSuppressed(archiveId)) return;

    const cache = this.app.metadataCache.getFileCache(file);
    const currentLike = cache?.frontmatter?.['like'];
    const currentBool = currentLike === true;
    if (currentBool === isLiked) return;

    this.onBeforeInboundWrite?.(archiveId);
    this.addSuppression(archiveId);

    try {
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        fm['like'] = isLiked;
        if (!fm['sourceArchiveId']) {
          fm['sourceArchiveId'] = archiveId;
        }
      });

      this.onAfterInboundWrite?.();
    } catch (err) {
      console.error(
        LOG_PREFIX,
        'Failed to reconcile fm.like:',
        file.path,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
