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

import type { WorkersAPIClient, UserArchive } from '../../services/WorkersAPIClient';
import type { ArchiveLookupService } from '../../services/ArchiveLookupService';
import type { PendingPost } from '../../services/SubscriptionManager';
import type { PostData } from '../../types/post';

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

  /** Refresh the timeline view after a successful save. */
  refreshTimelineView: () => void;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type IngestResult = 'created' | 'existing' | 'skipped';

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
    source: 'client_sync' | 'archive_complete',
  ): Promise<IngestResult> {
    // 1. Check if already exists by sourceArchiveId
    const existing = this.deps.archiveLookupService?.findBySourceArchiveId(archiveId) ?? null;
    if (existing) {
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
      return 'existing';
    }

    // 4. Re-check sourceArchiveId (race with client_sync)
    const recheck = this.deps.archiveLookupService?.findBySourceArchiveId(archiveId) ?? null;
    if (recheck) {
      this.deps.refreshTimelineView();
      return 'existing';
    }

    // 5. Convert and save
    const postData = this.deps.convertUserArchiveToPostData(archive);
    const pendingPost: PendingPost = {
      id: `ingest-${source}-${archiveId}`,
      subscriptionId: `realtime-${source}`,
      subscriptionName: source === 'client_sync' ? 'Mobile Sync' : 'Realtime Sync',
      post: postData,
      destinationFolder: this.deps.settings().archivePath,
      archivedAt: new Date().toISOString(),
    };

    const saved = await this.deps.saveSubscriptionPost(pendingPost);
    if (saved) {
      this.deps.refreshTimelineView();
      return 'created';
    }

    // saveSubscriptionPost returns false for existing files
    return 'existing';
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
          await new Promise<void>(resolve => setTimeout(resolve, INGEST_FETCH_RETRY_DELAY));
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
