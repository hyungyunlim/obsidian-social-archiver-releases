/**
 * ShareStateSyncService
 *
 * Single Responsibility: Handle inbound `action_updated` events that carry
 * `shareUrl` changes (share enabled/disabled from share-web or mobile) and
 * apply them to local vault `share` / `shareUrl` / `shareExpiry` frontmatter.
 *
 * Note: share deletion is also broadcast as a separate `share_deleted` event
 * (handled in RealtimeEventBridge.setupShareDeletedListener). This service
 * additionally handles the `action_updated` channel so that share creation
 * AND any `shareUrl: null` clears sent via action_updated are applied.
 */

import type { App } from 'obsidian';
import type { ActionUpdatedEventData } from '@/types/websocket';
import type { SocialArchiverSettings } from '@/types/settings';
import type { WorkersAPIClient } from '../../services/WorkersAPIClient';
import type { ArchiveLookupService } from '../../services/ArchiveLookupService';

const SUPPRESSION_TTL_MS = 10_000;
const LOG_PREFIX = '[Social Archiver] [ShareStateSyncService]';

export class ShareStateSyncService {
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

  async handleRemoteShareState(eventData: ActionUpdatedEventData): Promise<void> {
    const { archiveId, sourceClientId, changes } = eventData;
    if (changes.shareUrl === undefined) return;

    const nextShareUrl = changes.shareUrl;
    const enabling = typeof nextShareUrl === 'string' && nextShareUrl.length > 0;

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
          console.warn(LOG_PREFIX, 'Ambiguous originalUrl match — skipping share state update.', {
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
    const currentShareUrl = cache?.frontmatter?.['shareUrl'];
    const currentShare = cache?.frontmatter?.['share'];

    if (enabling) {
      if (currentShareUrl === nextShareUrl && currentShare === true) return;
    } else {
      if (!currentShareUrl && currentShare !== true) return;
    }

    this.onBeforeInboundWrite?.(archiveId);
    this.addSuppression(archiveId);

    try {
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        if (enabling) {
          fm['share'] = true;
          fm['shareUrl'] = nextShareUrl;
        } else {
          fm['share'] = false;
          delete fm['shareUrl'];
          delete fm['shareExpiry'];
        }
        if (sourceArchiveIdMissing && !fm['sourceArchiveId']) {
          fm['sourceArchiveId'] = archiveId;
        }
      });

      this.onAfterInboundWrite?.();
    } catch (err) {
      console.error(
        LOG_PREFIX,
        'Failed to update share frontmatter:',
        file.path,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
