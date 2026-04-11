/**
 * LikeStateOutboundService
 *
 * Single Responsibility: Watch for `like` frontmatter changes in archive
 * notes and sync them to the server as `isLiked` via updateArchiveActions.
 */

import type { App, EventRef, TFile } from 'obsidian';
import type { WorkersAPIClient } from '@/services/WorkersAPIClient';
import type { SocialArchiverSettings } from '@/types/settings';
import type { ArchiveLookupService } from '@/services/ArchiveLookupService';

const DEBOUNCE_MS = 2000;
const SUPPRESSION_TTL_MS = 10_000;
const STARTUP_WINDOW_MS = 5000;
const LOG_PREFIX = '[Social Archiver] [LikeStateOutbound]';

export class LikeStateOutboundService {
  private readonly lastKnownLikeState = new Map<string, boolean>();
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly suppressionMap = new Map<string, number>();
  private changedEventRef: EventRef | null = null;
  private startedAt = 0;

  constructor(
    private readonly app: App,
    private readonly apiClient: WorkersAPIClient,
    private readonly archiveLookup: ArchiveLookupService,
    private readonly getSettings: () => SocialArchiverSettings,
  ) {}

  start(): void {
    if (this.changedEventRef !== null) return;

    this.startedAt = Date.now();
    this.changedEventRef = this.app.metadataCache.on(
      'changed',
      (file: TFile) => {
        this.onMetadataChanged(file);
      },
    );
  }

  stop(): void {
    if (this.changedEventRef !== null) {
      this.app.metadataCache.offref(this.changedEventRef);
      this.changedEventRef = null;
    }

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

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

  private onMetadataChanged(file: TFile): void {
    if (file.extension !== 'md') return;

    const settings = this.getSettings();
    if (!settings.syncClientId) return;

    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (!fm) return;

    let archiveId = typeof fm['sourceArchiveId'] === 'string' && fm['sourceArchiveId']
      ? fm['sourceArchiveId'] as string
      : undefined;

    if (!archiveId) {
      const identity = this.archiveLookup.getIdentityByPath(file.path);
      if (identity?.archiveId) {
        archiveId = identity.archiveId;
      }
    }

    const originalUrl = typeof fm['originalUrl'] === 'string' ? fm['originalUrl'] : undefined;
    if (!archiveId && !originalUrl) return;

    if (archiveId && this.isSuppressed(archiveId)) return;

    const currentLikeState = fm['like'] === true;
    const isFirstObservation = !this.lastKnownLikeState.has(file.path);

    if (isFirstObservation) {
      const inStartupWindow = (Date.now() - this.startedAt) < STARTUP_WINDOW_MS;
      if (inStartupWindow) {
        this.lastKnownLikeState.set(file.path, currentLikeState);
        return;
      }

      this.lastKnownLikeState.set(file.path, currentLikeState);
      if (!currentLikeState) return;
    }

    if (!isFirstObservation) {
      const lastState = this.lastKnownLikeState.get(file.path);
      if (currentLikeState === lastState) return;
      this.lastKnownLikeState.set(file.path, currentLikeState);
    }

    const existing = this.debounceTimers.get(file.path);
    if (existing !== undefined) clearTimeout(existing);

    this.debounceTimers.set(
      file.path,
      setTimeout(() => {
        this.debounceTimers.delete(file.path);
        void this.syncLikeState(archiveId, originalUrl, currentLikeState, file);
      }, DEBOUNCE_MS),
    );
  }

  private async syncLikeState(
    archiveId: string | undefined,
    originalUrl: string | undefined,
    isLiked: boolean,
    file: TFile,
  ): Promise<void> {
    try {
      if (!archiveId && originalUrl) {
        const result = await this.apiClient.getUserArchives({ originalUrl, limit: 1 });
        const found = result?.archives?.[0];
        if (found?.id) {
          archiveId = found.id;
          await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            fm['sourceArchiveId'] = archiveId;
          });
        }
      }

      if (!archiveId) {
        console.debug(`${LOG_PREFIX} Cannot resolve archiveId — skipping:`, file.path);
        return;
      }

      await this.apiClient.updateArchiveActions(archiveId, { isLiked });
      this.addSuppression(archiveId);

      console.debug(
        `${LOG_PREFIX} Synced like state to server:`,
        archiveId,
        { isLiked },
      );
    } catch (err) {
      console.error(
        `${LOG_PREFIX} Failed to sync like state:`,
        archiveId,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
