import type { ArchiveOrchestrator } from '@/services/ArchiveOrchestrator';
import type { ClipPayload } from '@/types/clip';
import type { PostData } from '@/types/post';

export interface LocalClipServiceConfig {
  /**
   * Lazy orchestrator accessor — the orchestrator is constructed during
   * `initializeServices()` and may briefly be unavailable right after a
   * deep link wakes the app.
   */
  getOrchestrator: () => ArchiveOrchestrator | undefined;
  /** Download clip media into the vault. Defaults to true. */
  downloadMedia?: boolean;
}

export interface LocalClipResult {
  filePath: string;
}

/**
 * LocalClipService — import a browser clip into the vault without any server
 * round-trip.
 *
 * Single Responsibility: local-only provenance marking + delegation to the
 * shared ArchiveOrchestrator post-fetch pipeline (media download, markdown
 * conversion, vault save with rollback). Decoding/validation lives in
 * ClipPayloadCodec; protocol-handler plumbing lives in main.ts.
 *
 * This path works fully logged-out: no auth token is required anywhere
 * (MediaHandler's proxy + requestUrl downloads are unauthenticated).
 * See prd-extension-anonymous-local-mode.md (Phase 1).
 */
export class LocalClipService {
  constructor(private readonly config: LocalClipServiceConfig) {}

  async importClip(payload: ClipPayload): Promise<LocalClipResult> {
    const orchestrator = this.config.getOrchestrator();
    if (!orchestrator) {
      throw new Error('Social Archiver is still initializing. Please try again in a moment.');
    }

    const postData = payload.postData;
    this.markLocalClipProvenance(postData, payload);

    // Channel B+ folder handoff: the sender already wrote media files into
    // the vault and media[].url are vault-relative paths — downloading would
    // misinterpret them as URLs. Entries that failed sender-side keep their
    // remote URL and render as remote embeds.
    const downloadMedia =
      payload.mediaDelivery === 'local' ? false : (this.config.downloadMedia ?? true);

    const result = await orchestrator.orchestrateFromPostData(postData, {
      enableAI: false,
      deepResearch: false,
      generateShareLink: false,
      removeTracking: true,
      downloadMedia,
      // Deep-link imports must never pop modals (Large Media Guard etc.).
      isForeground: false,
    });

    if (!result.success || !result.filePath) {
      throw new Error(result.error || 'Clip import failed');
    }

    return { filePath: result.filePath };
  }

  /**
   * Mirror of the Instagram saved-import local-only marker
   * (`ImportWorker.markLocalOnlyImportPostData`): records that this note was
   * produced without a server archive row, so later sync/upsell flows can
   * find it and offer account backfill.
   */
  private markLocalClipProvenance(postData: PostData, payload: ClipPayload): void {
    postData.metadata.socialArchiverImportMode = 'local-only';
    postData.metadata.socialArchiverImportSource = `browser-clip:${payload.source}`;
    postData.metadata.socialArchiverServerArchiveId = 'none';
    delete postData.sourceArchiveId;

    if (!postData.archivedDate) {
      const clippedAt = payload.clippedAt ? new Date(payload.clippedAt) : null;
      postData.archivedDate =
        clippedAt && !Number.isNaN(clippedAt.getTime()) ? clippedAt : new Date();
    }
  }
}
