/**
 * RemoteArchiveIngestService
 *
 * Fetches a single archive from the server by ID and saves it to the vault.
 * Handles dedup checks (by sourceArchiveId and URL) to prevent duplicates.
 *
 * Shared by:
 * - `ws:archive_complete` handler (real-time direct archives from other clients)
 * - Future callers that need single-archive fetch+save without queue ACK logic
 *
 * Single Responsibility: remote archive fetch → dedup → save to vault
 */

import type { TFile } from 'obsidian';
import type { WorkersAPIClient, UserArchive } from '../../services/WorkersAPIClient';
import type { ArchiveLookupService } from '../../services/ArchiveLookupService';
import type { PendingPost } from '../../services/SubscriptionManager';
import type { PostData } from '../../types/post';
import type { LocalLockRegistry } from '../locks/LocalLockRegistry';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max retries for transient 404 (replication lag on server). */
const INGEST_FETCH_MAX_RETRIES = 2;

/** Delay (ms) between retries. */
const INGEST_FETCH_RETRY_DELAY = 1500;

// ---------------------------------------------------------------------------
// Dependency interface
// ---------------------------------------------------------------------------

export interface RemoteArchiveIngestDeps {
  /** Returns the current WorkersAPIClient instance, or undefined if not initialised. */
  apiClient: () => WorkersAPIClient | undefined;

  /** Returns the subset of plugin settings needed by this service. */
  settings: () => { archivePath: string };

  /** Returns true if the given URL was archived locally within the dedup window. */
  hasRecentlyArchivedUrl: (url: string | null | undefined) => boolean;

  /** Lookup service for checking existing vault files by sourceArchiveId. */
  archiveLookupService: ArchiveLookupService | null;

  /** Convert a server UserArchive into the local PostData format. */
  convertUserArchiveToPostData: (archive: UserArchive) => PostData;

  /** Persist a PendingPost to the vault (handles media download, path generation, etc.). */
  saveSubscriptionPost: (post: PendingPost) => Promise<boolean>;

  /** Persist with enough detail to immediately bind existing/new files to server archive IDs. */
  saveSubscriptionPostDetailed?: (post: PendingPost) => Promise<RemoteArchiveSaveResult>;

  /** Returns true when the local note is only a limited fallback archive. */
  isLimitedArchiveFile?: (file: TFile) => Promise<boolean>;

  /** Replace a limited or media-partial note with richer fetched archive content. */
  replaceExistingLimitedArchive?: (
    file: TFile,
    post: PendingPost,
  ) => Promise<RemoteArchiveSaveResult>;

  /** Refresh the timeline view after a successful save. */
  refreshTimelineView: () => void;

  /**
   * Fired AFTER a brand-new archive note is written to the vault (status
   * 'created'), with the new note's bound file + server archive id. Used to
   * render its managed `## Linked archives` section and upgrade any source note
   * already linking to it. Best-effort, fire-and-forget — never blocks ingest.
   *
   * Wired to LinkRelationSyncService.applyForArchive() in main.ts.
   */
  onArchiveIngested?: (file: TFile, archiveId: string) => void;

  /** Shared local write lock registry used by plugin archive/materialization writers. */
  localLockRegistry?: LocalLockRegistry;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type IngestResult = 'created' | 'existing' | 'skipped';

interface RemoteArchiveSaveResult {
  status: 'created' | 'updated' | 'existing' | 'skipped' | 'failed';
  file?: TFile;
  path?: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * RemoteArchiveIngestService
 *
 * Fetches a single archive from the server and saves it to the vault,
 * performing dedup checks at every stage.
 */
export class RemoteArchiveIngestService {
  constructor(private readonly deps: RemoteArchiveIngestDeps) {}

  /**
   * Fetch archive from server and save to vault.
   *
   * @param archiveId - The server-side archive ID to ingest
   * @param source - The caller context (for logging and subscription name)
   * @returns 'created' if a new file was written,
   *          'existing' if the archive already exists in the vault (dedup),
   *          'skipped' if the archive was not found on the server.
   */
  async ingestArchiveById(
    archiveId: string,
    source: 'client_sync' | 'archive_complete' | 'ai_comment_job' | 'transcription_job',
  ): Promise<IngestResult> {
    return this.withArchiveWriteLocks(archiveId, () => this.ingestArchiveByIdUnderLock(archiveId, source));
  }

  private async ingestArchiveByIdUnderLock(
    archiveId: string,
    source: 'client_sync' | 'archive_complete' | 'ai_comment_job' | 'transcription_job',
  ): Promise<IngestResult> {
    // 1. Check if already exists by sourceArchiveId
    const existing = this.deps.archiveLookupService?.findBySourceArchiveId(archiveId) ?? null;
    if (existing) {
      if (await this.updateExistingLimitedArchiveById(existing, archiveId, source)) {
        return 'created';
      }
      this.deps.refreshTimelineView();
      return 'existing';
    }

    // 2. Fetch from API (with retry for transient 404)
    const apiClient = this.deps.apiClient();
    if (!apiClient) {
      throw new Error('API client not initialized');
    }

    const archive = await this.fetchWithRetry(apiClient, archiveId);
    if (!archive) {
      return 'skipped';
    }

    // 3. Dedup by URL
    const url = archive.originalUrl;
    if (url && this.deps.hasRecentlyArchivedUrl(url)) {
      if (await this.bindSingleUrlMatch(archive, source)) {
        return 'existing';
      }
    }

    // 4. Re-check sourceArchiveId (race with client_sync)
    const recheck = this.deps.archiveLookupService?.findBySourceArchiveId(archiveId) ?? null;
    if (recheck) {
      this.deps.refreshTimelineView();
      return 'existing';
    }

    // 5. Convert and save
    const saveResult = await this.savePendingPost(this.buildPendingPost(archive, source));
    if (saveResult.status === 'failed' || saveResult.status === 'skipped') {
      return 'skipped';
    }

    if (saveResult.file) {
      await this.bindFileIdentity(saveResult.file, archive);
      // Late-resolution: render the new note's linked-archives section + upgrade
      // any source note already pointing at it. Fire-and-forget, non-fatal.
      if (saveResult.status === 'created' || saveResult.status === 'updated') {
        this.deps.onArchiveIngested?.(saveResult.file, archive.id);
      }
      this.deps.refreshTimelineView();
      return saveResult.status === 'updated' ? 'created' : saveResult.status;
    }

    if (await this.bindSingleUrlMatch(archive, source)) {
      return saveResult.status === 'updated' ? 'created' : saveResult.status;
    }

    this.deps.refreshTimelineView();
    return saveResult.status === 'updated' ? 'created' : saveResult.status;
  }

  private async withArchiveWriteLocks<T>(archiveId: string, fn: () => Promise<T>): Promise<T> {
    const registry = this.deps.localLockRegistry;
    if (!registry) return fn();
    return registry.withLocks(
      [
        { kind: 'archiveMaterialization', archiveId },
        { kind: 'markdownWrite', archiveId },
      ],
      fn,
    );
  }

  // -- private helpers ------------------------------------------------------

  /**
   * Fetch a UserArchive from the server with retry for transient 404.
   * Returns null if the archive is not found after all attempts.
   */
  private async fetchWithRetry(
    apiClient: WorkersAPIClient,
    archiveId: string,
  ): Promise<UserArchive | null> {
    for (let attempt = 0; attempt <= INGEST_FETCH_MAX_RETRIES; attempt++) {
      try {
        const response = await apiClient.getUserArchive(archiveId);
        if (response.archive) {
          return response.archive;
        }
      } catch (error: unknown) {
        // Transient 404: archive may not be propagated yet
        if (attempt < INGEST_FETCH_MAX_RETRIES && this.isNotFoundError(error)) {
          await new Promise<void>(resolve => window.setTimeout(resolve, INGEST_FETCH_RETRY_DELAY));
          continue;
        }
        // Non-404 or final attempt — rethrow
        if (!this.isNotFoundError(error)) {
          throw error;
        }
      }
    }
    return null;
  }

  private async savePendingPost(pendingPost: PendingPost): Promise<RemoteArchiveSaveResult> {
    if (this.deps.saveSubscriptionPostDetailed) {
      return this.deps.saveSubscriptionPostDetailed(pendingPost);
    }

    const saved = await this.deps.saveSubscriptionPost(pendingPost);
    return saved ? { status: 'created' } : { status: 'failed', reason: 'save returned false' };
  }

  private async bindSingleUrlMatch(
    archive: UserArchive,
    source: 'client_sync' | 'archive_complete' | 'ai_comment_job' | 'transcription_job',
  ): Promise<boolean> {
    const matches = this.deps.archiveLookupService?.findByOriginalUrl(archive.originalUrl) ?? [];
    if (matches.length !== 1) return false;

    if (await this.updateExistingLimitedArchive(matches[0]!, archive, source)) {
      return true;
    }

    await this.bindFileIdentity(matches[0]!, archive);
    this.deps.refreshTimelineView();
    return true;
  }

  private async updateExistingLimitedArchiveById(
    file: TFile,
    archiveId: string,
    source: 'client_sync' | 'archive_complete' | 'ai_comment_job' | 'transcription_job',
  ): Promise<boolean> {
    if (!this.deps.replaceExistingLimitedArchive) {
      return false;
    }

    const apiClient = this.deps.apiClient();
    if (!apiClient) return false;

    const archive = await this.fetchWithRetry(apiClient, archiveId);
    if (!archive) return false;

    return this.updateExistingLimitedArchive(file, archive, source);
  }

  private async updateExistingLimitedArchive(
    file: TFile,
    archive: UserArchive,
    source: 'client_sync' | 'archive_complete' | 'ai_comment_job' | 'transcription_job',
  ): Promise<boolean> {
    if (!this.deps.replaceExistingLimitedArchive) return false;

    const result = await this.deps.replaceExistingLimitedArchive(
      file,
      this.buildPendingPost(archive, source),
    );

    if (result.status !== 'updated') return false;

    await this.bindFileIdentity(result.file ?? file, archive);
    this.deps.refreshTimelineView();
    return true;
  }

  private buildPendingPost(
    archive: UserArchive,
    source: 'client_sync' | 'archive_complete' | 'ai_comment_job' | 'transcription_job',
  ): PendingPost {
    const postData = this.deps.convertUserArchiveToPostData(archive);
    postData.sourceArchiveId = archive.id;

    return {
      id: `ingest-${source}-${archive.id}`,
      subscriptionId: `realtime-${source}`,
      subscriptionName: source === 'client_sync'
        ? 'Mobile Sync'
        : source === 'ai_comment_job'
          ? 'AI Comment Job'
          : source === 'transcription_job'
            ? 'Transcription Job'
            : 'Realtime Sync',
      post: postData,
      destinationFolder: this.deps.settings().archivePath,
      archivedAt: new Date().toISOString(),
    };
  }

  private async bindFileIdentity(file: TFile, archive: UserArchive): Promise<void> {
    await this.deps.archiveLookupService?.backfillFileIdentity(file, archive.id);
    this.deps.archiveLookupService?.indexSavedFile(file, {
      sourceArchiveId: archive.id,
      originalUrl: archive.originalUrl,
    });
  }

  private isNotFoundError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const enriched = error as Error & { status?: number; code?: string };
    return (
      enriched.status === 404 ||
      enriched.code === 'ARCHIVE_NOT_FOUND' ||
      /archive not found/i.test(enriched.message) ||
      /not found/i.test(enriched.message)
    );
  }
}
