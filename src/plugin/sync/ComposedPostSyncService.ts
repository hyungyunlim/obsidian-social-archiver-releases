/**
 * ComposedPostSyncService
 *
 * Manages durable queue for syncing composed posts to the server.
 *
 * Responsibilities:
 * - Enqueue create/update operations
 * - Flush queue: read vault file, reconstruct payload, upload media, POST to server
 * - On success: write sourceArchiveId, syncState='synced', serverSyncedAt to frontmatter
 * - On failure: increment retryCount, set syncState='failed' after max retries
 * - Persist queue to settings (survives app restart)
 * - Handle file deletion: remove pending queue entries
 *
 * Single Responsibility: composed post outbound sync orchestration
 */

import type { App, EventRef, TAbstractFile, TFile, Vault } from 'obsidian';
import type {
  WorkersAPIClient,
  CreateComposedPostRequest,
  UpdateComposedPostRequest,
} from '../../services/WorkersAPIClient';
import type {
  SocialArchiverSettings,
  PendingComposedPostSyncEntry,
} from '../../types/settings';

// ============================================================================
// Constants
// ============================================================================

const MAX_RETRIES = 3;
const LOG_PREFIX = '[Social Archiver] [ComposedPostSync]';

/** Debounce delay for update enqueue — avoids rapid re-saves creating many update requests. */
const UPDATE_DEBOUNCE_MS = 2000;

/**
 * Debounce delay for the background MetadataCache watcher.
 * Longer than the composer path (2s) since background edits are less time-sensitive.
 */
const BACKGROUND_EDIT_DEBOUNCE_MS = 5000;

/**
 * How long (ms) a clientPostId is suppressed after our own processFrontMatter write.
 * Prevents re-triggering the watcher on sync-success frontmatter updates.
 */
const SELF_WRITE_SUPPRESSION_MS = 10_000;

// ============================================================================
// ComposedPostSyncService
// ============================================================================

export class ComposedPostSyncService {
  private app: App;
  private vault: Vault;
  private settings: SocialArchiverSettings;
  private apiClient: WorkersAPIClient;
  private saveSettings: () => Promise<void>;
  private unregisterDeleteListener?: () => void;

  /** EventRef for the MetadataCache 'changed' listener (for offref cleanup). */
  private metadataCacheRef: EventRef | null = null;

  /**
   * Debounce timers for update operations keyed by clientPostId.
   * Cleared when the timer fires or when the file is deleted.
   */
  private updateDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Debounce timers for the background MetadataCache watcher, keyed by file path.
   * Separate from updateDebounceTimers so background and composer paths don't collide.
   */
  private bgEditDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Suppression set: clientPostIds that should not trigger background edit detection.
   * Populated when we write syncState/serverSyncedAt via processFrontMatter to avoid
   * re-enqueuing after our own writes.
   * Map<clientPostId, suppressedUntilMs>
   */
  private selfWriteSuppression = new Map<string, number>();

  /**
   * Content fingerprints keyed by clientPostId.
   * Used to skip update enqueue when file content has not changed.
   */
  private contentFingerprints = new Map<string, string>();

  constructor(
    app: App,
    vault: Vault,
    settings: SocialArchiverSettings,
    apiClient: WorkersAPIClient,
    saveSettings: () => Promise<void>
  ) {
    this.app = app;
    this.vault = vault;
    this.settings = settings;
    this.apiClient = apiClient;
    this.saveSettings = saveSettings;
  }

  // ============================================================================
  // Queue management
  // ============================================================================

  /**
   * Enqueue a create operation for a newly saved composed post.
   */
  async enqueueCreate(filePath: string, clientPostId: string): Promise<void> {
    const entry: PendingComposedPostSyncEntry = {
      op: 'create',
      filePath,
      clientPostId,
      queuedAt: new Date().toISOString(),
      retryCount: 0,
    };

    this.settings.pendingComposedPostSyncs = [
      ...(this.settings.pendingComposedPostSyncs ?? []),
      entry,
    ];
    await this.saveSettings();
  }

  /**
   * Enqueue an update operation for an already-synced composed post.
   */
  async enqueueUpdate(
    filePath: string,
    clientPostId: string,
    sourceArchiveId: string
  ): Promise<void> {
    // Remove any existing entry for this clientPostId before re-enqueuing
    this.settings.pendingComposedPostSyncs = (
      this.settings.pendingComposedPostSyncs ?? []
    ).filter((e) => e.clientPostId !== clientPostId);

    const entry: PendingComposedPostSyncEntry = {
      op: 'update',
      filePath,
      clientPostId,
      sourceArchiveId,
      queuedAt: new Date().toISOString(),
      retryCount: 0,
    };

    this.settings.pendingComposedPostSyncs = [
      ...this.settings.pendingComposedPostSyncs,
      entry,
    ];
    await this.saveSettings();
  }

  /**
   * Debounced update enqueue for composed posts that have already been synced.
   *
   * Reads the vault file, computes a content fingerprint, and schedules an
   * `enqueueUpdate` only if the content has changed since the last sync.
   * Multiple rapid saves within UPDATE_DEBOUNCE_MS collapse to a single enqueue.
   *
   * @param filePath  - Vault path to the composed post file
   * @param clientPostId - Stable client-side post ID (from frontmatter.clientPostId)
   * @param sourceArchiveId - Server-assigned archive ID (from frontmatter.sourceArchiveId)
   */
  enqueueUpdateDebounced(
    filePath: string,
    clientPostId: string,
    sourceArchiveId: string
  ): void {
    // Cancel any previous debounce timer for this post
    const existing = this.updateDebounceTimers.get(clientPostId);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.updateDebounceTimers.delete(clientPostId);
      void this.maybeEnqueueUpdate(filePath, clientPostId, sourceArchiveId);
    }, UPDATE_DEBOUNCE_MS);

    this.updateDebounceTimers.set(clientPostId, timer);
  }

  /**
   * Read the file, compute fingerprint, and enqueue an update only if content changed.
   */
  private async maybeEnqueueUpdate(
    filePath: string,
    clientPostId: string,
    sourceArchiveId: string
  ): Promise<void> {
    const file = this.vault.getFileByPath(filePath);
    if (!file) return;

    try {
      const raw = await this.vault.read(file);
      const fingerprint = this.computeFingerprint(raw);
      const lastFingerprint = this.contentFingerprints.get(clientPostId);

      if (fingerprint === lastFingerprint) {
        console.debug(`${LOG_PREFIX} Content unchanged, skipping update enqueue: ${clientPostId}`);
        return;
      }

      this.contentFingerprints.set(clientPostId, fingerprint);
      await this.enqueueUpdate(filePath, clientPostId, sourceArchiveId);
      void this.flush();
    } catch (error) {
      console.error(`${LOG_PREFIX} maybeEnqueueUpdate failed:`, error);
    }
  }

  /**
   * Simple string fingerprint via djb2 hash — fast, no crypto needed.
   */
  private computeFingerprint(content: string): string {
    let hash = 5381;
    for (let i = 0; i < content.length; i++) {
      hash = ((hash << 5) + hash) ^ content.charCodeAt(i);
      hash = hash >>> 0; // keep 32-bit unsigned
    }
    return hash.toString(16);
  }

  /**
   * Remove a queue entry by clientPostId (used when file is deleted before sync).
   */
  async removeFromQueue(clientPostId: string): Promise<void> {
    const before = (this.settings.pendingComposedPostSyncs ?? []).length;
    this.settings.pendingComposedPostSyncs = (
      this.settings.pendingComposedPostSyncs ?? []
    ).filter((e) => e.clientPostId !== clientPostId);
    const after = this.settings.pendingComposedPostSyncs.length;

    if (before !== after) {
      await this.saveSettings();
    }
  }

  // ============================================================================
  // Flush
  // ============================================================================

  /**
   * Process all pending queue entries.
   * Called on plugin load and after each enqueue.
   */
  async flush(): Promise<void> {
    const queue = this.settings.pendingComposedPostSyncs ?? [];
    if (queue.length === 0) return;

    // Work on a snapshot; we mutate settings.pendingComposedPostSyncs in place
    for (const entry of [...queue]) {
      await this.processEntry(entry);
    }
  }

  private async processEntry(entry: PendingComposedPostSyncEntry): Promise<void> {
    // Locate vault file
    const file = this.vault.getFileByPath(entry.filePath);
    if (!file) {
      // File was deleted — remove from queue
      console.log(`${LOG_PREFIX} File missing, removing from queue: ${entry.filePath}`);
      await this.removeFromQueue(entry.clientPostId);
      return;
    }

    try {
      // Read frontmatter + body
      const raw = await this.vault.read(file);
      const parsed = this.parseFrontmatterAndBody(raw);

      // Build media payload
      const mediaItems = await this.collectMedia(file, parsed.frontmatter);

      // Call the appropriate API
      if (entry.op === 'create') {
        await this.handleCreate(entry, file, parsed, mediaItems);
      } else {
        await this.handleUpdate(entry, file, parsed, mediaItems);
      }
    } catch (error) {
      await this.recordFailure(entry, error);
    }
  }

  private async handleCreate(
    entry: PendingComposedPostSyncEntry,
    file: TFile,
    parsed: { frontmatter: Record<string, unknown>; body: string },
    mediaItems: ComposedMediaItem[]
  ): Promise<void> {
    const request = this.buildCreateRequest(entry, parsed, mediaItems);
    const result = await this.apiClient.createComposedPost(request);

    // Suppress background watcher before writing sync fields to avoid re-triggering
    this.suppressSelfWrite(entry.clientPostId);

    // Write success fields to frontmatter
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      fm['sourceArchiveId'] = result.archiveId;
      fm['syncState'] = 'synced';
      fm['serverSyncedAt'] = result.createdAt;
    });

    // Remove from queue
    await this.removeFromQueue(entry.clientPostId);

    console.log(`${LOG_PREFIX} Create synced: ${entry.clientPostId} → ${result.archiveId}`);
  }

  private async handleUpdate(
    entry: PendingComposedPostSyncEntry,
    file: TFile,
    parsed: { frontmatter: Record<string, unknown>; body: string },
    mediaItems: ComposedMediaItem[]
  ): Promise<void> {
    if (!entry.sourceArchiveId) {
      throw new Error('Update entry missing sourceArchiveId');
    }

    const request = this.buildUpdateRequest(entry, parsed, mediaItems);
    const result = await this.apiClient.updateComposedPost(entry.sourceArchiveId, request);

    // Suppress background watcher before writing sync fields to avoid re-triggering
    this.suppressSelfWrite(entry.clientPostId);

    // Write success fields to frontmatter
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      fm['syncState'] = 'synced';
      fm['serverSyncedAt'] = result.updatedAt;
    });

    // Remove from queue
    await this.removeFromQueue(entry.clientPostId);

    console.log(`${LOG_PREFIX} Update synced: ${entry.clientPostId} (archiveId=${entry.sourceArchiveId})`);
  }

  private async recordFailure(
    entry: PendingComposedPostSyncEntry,
    error: unknown
  ): Promise<void> {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`${LOG_PREFIX} Sync failed (attempt ${entry.retryCount + 1}):`, errorMsg);

    const queue = this.settings.pendingComposedPostSyncs ?? [];
    const idx = queue.findIndex((e) => e.clientPostId === entry.clientPostId);
    if (idx === -1) return;

    const updated = { ...queue[idx]! };
    updated.retryCount += 1;
    updated.lastAttemptAt = new Date().toISOString();
    updated.lastError = errorMsg;

    this.settings.pendingComposedPostSyncs = [
      ...queue.slice(0, idx),
      updated,
      ...queue.slice(idx + 1),
    ];
    await this.saveSettings();

    // After max retries, mark as failed in frontmatter
    if (updated.retryCount >= MAX_RETRIES) {
      const file = this.vault.getFileByPath(entry.filePath);
      if (file) {
        try {
          // Suppress watcher before writing syncState='failed' to avoid re-triggering
          this.suppressSelfWrite(entry.clientPostId);
          await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            fm['syncState'] = 'failed';
          });
        } catch {
          // best-effort
        }
      }

      // Remove from queue after max retries
      await this.removeFromQueue(entry.clientPostId);
      console.error(`${LOG_PREFIX} Max retries reached, removed from queue: ${entry.clientPostId}`);
    }
  }

  // ============================================================================
  // Media collection
  // ============================================================================

  private async collectMedia(
    _file: TFile,
    frontmatter: Record<string, unknown>
  ): Promise<ComposedMediaItem[]> {
    // Extract media references from frontmatter linkPreviews or body scan
    // For now, media is embedded as vault paths in the markdown body
    // We scan for ![[path]] wikilinks and read those files
    const items: ComposedMediaItem[] = [];

    const mediaUrls = frontmatter['media'] as Array<{ url?: string; type?: string }> | undefined;
    if (!Array.isArray(mediaUrls)) return items;

    for (let i = 0; i < mediaUrls.length; i++) {
      const m = mediaUrls[i];
      if (!m?.url) continue;

      const mediaFile = this.vault.getFileByPath(m.url);
      if (!mediaFile) continue; // Missing media — skip, don't abort

      try {
        const data = await this.vault.readBinary(mediaFile);
        const contentType = this.inferContentType(mediaFile.name);
        items.push({
          data,
          filename: mediaFile.name,
          contentType,
          index: i,
        });
      } catch {
        // Skip unreadable media
      }
    }

    return items;
  }

  private inferContentType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      mp4: 'video/mp4',
      mov: 'video/quicktime',
    };
    return map[ext] ?? 'application/octet-stream';
  }

  // ============================================================================
  // Request builders
  // ============================================================================

  private buildCreateRequest(
    entry: PendingComposedPostSyncEntry,
    parsed: { frontmatter: Record<string, unknown>; body: string },
    _mediaItems: ComposedMediaItem[]
  ): CreateComposedPostRequest {
    const fm = parsed.frontmatter;
    return {
      clientPostId: entry.clientPostId,
      content: parsed.body,
      platform: 'post',
      publishedAt: fm['published'] as string | undefined,
      authorName: fm['author'] as string | undefined,
      authorUrl: fm['authorUrl'] as string | undefined,
    };
  }

  private buildUpdateRequest(
    entry: PendingComposedPostSyncEntry,
    parsed: { frontmatter: Record<string, unknown>; body: string },
    _mediaItems: ComposedMediaItem[]
  ): UpdateComposedPostRequest {
    const fm = parsed.frontmatter;
    return {
      clientPostId: entry.clientPostId,
      content: parsed.body,
      platform: 'post',
      publishedAt: fm['published'] as string | undefined,
      authorName: fm['author'] as string | undefined,
      authorUrl: fm['authorUrl'] as string | undefined,
    };
  }

  // ============================================================================
  // Frontmatter parsing
  // ============================================================================

  private parseFrontmatterAndBody(raw: string): {
    frontmatter: Record<string, unknown>;
    body: string;
  } {
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!fmMatch) {
      return { frontmatter: {}, body: raw };
    }

    const yamlBlock = fmMatch[1] ?? '';
    const body = fmMatch[2] ?? '';

    // Simple YAML key-value parser for scalar fields (sufficient for our use)
    const frontmatter: Record<string, unknown> = {};
    for (const line of yamlBlock.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (key) {
        // Remove surrounding quotes if present
        frontmatter[key] = value.replace(/^['"]|['"]$/g, '');
      }
    }

    return { frontmatter, body };
  }

  // ============================================================================
  // Plugin lifecycle
  // ============================================================================

  /**
   * Called on plugin load — registers vault delete listener, MetadataCache watcher,
   * and flushes pending queue.
   */
  async onPluginLoad(): Promise<void> {
    // Listen for vault file deletions to clean up orphaned queue entries
    const deleteHandler = (abstractFile: TAbstractFile) => {
      void this.onFileDeleted(abstractFile.path);
    };
    this.vault.on('delete', deleteHandler);
    this.unregisterDeleteListener = () => this.vault.off('delete', deleteHandler);

    // Listen for MetadataCache changes to detect background edits to composed posts
    this.metadataCacheRef = this.app.metadataCache.on('changed', (file: TFile) => {
      this.onMetadataChanged(file);
    });

    // Flush any pending entries from previous session
    try {
      await this.flush();
    } catch (error) {
      console.error(`${LOG_PREFIX} flush() on load failed:`, error);
    }
  }

  /**
   * Called when plugin unloads.
   */
  onPluginUnload(): void {
    this.unregisterDeleteListener?.();

    // Unregister MetadataCache watcher
    if (this.metadataCacheRef) {
      this.app.metadataCache.offref(this.metadataCacheRef);
      this.metadataCacheRef = null;
    }

    // Cancel all pending debounce timers (composer path)
    for (const timer of this.updateDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.updateDebounceTimers.clear();

    // Cancel all pending background edit debounce timers
    for (const timer of this.bgEditDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.bgEditDebounceTimers.clear();
  }

  // ============================================================================
  // Background edit detection (MetadataCache watcher)
  // ============================================================================

  /**
   * Fires whenever Obsidian's MetadataCache updates a file's parsed metadata.
   *
   * We only act on files that:
   * 1. Have `postOrigin: 'composer'` — so we only touch composed post notes.
   * 2. Have `sourceArchiveId` present — means the post was already synced to server.
   * 3. Have `clientPostId` — stable ID for queue dedup.
   * 4. Are NOT currently suppressed — i.e. we did not just write these fields ourselves.
   */
  private onMetadataChanged(file: TFile): void {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache?.frontmatter) return;

    const fm = cache.frontmatter as Record<string, unknown>;

    // Must be a composed post
    if (fm['postOrigin'] !== 'composer') return;

    // Must already be synced (sourceArchiveId present)
    const sourceArchiveId = fm['sourceArchiveId'];
    if (typeof sourceArchiveId !== 'string' || !sourceArchiveId) return;

    // Must have a stable clientPostId
    const clientPostId = fm['clientPostId'];
    if (typeof clientPostId !== 'string' || !clientPostId) return;

    // Skip if this post is in the suppression window (we just wrote it)
    if (this.isSuppressed(clientPostId)) return;

    // Debounce: cancel any existing background timer for this file
    const existing = this.bgEditDebounceTimers.get(file.path);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.bgEditDebounceTimers.delete(file.path);
      // maybeEnqueueUpdate will re-read file, compute fingerprint, and enqueue only if changed
      void this.maybeEnqueueUpdate(file.path, clientPostId, sourceArchiveId);
    }, BACKGROUND_EDIT_DEBOUNCE_MS);

    this.bgEditDebounceTimers.set(file.path, timer);
  }

  // ============================================================================
  // Self-write suppression helpers
  // ============================================================================

  /**
   * Suppress background edit detection for a clientPostId for SELF_WRITE_SUPPRESSION_MS.
   * Must be called BEFORE writing frontmatter fields via processFrontMatter.
   */
  private suppressSelfWrite(clientPostId: string): void {
    this.selfWriteSuppression.set(clientPostId, Date.now() + SELF_WRITE_SUPPRESSION_MS);
  }

  private isSuppressed(clientPostId: string): boolean {
    const until = this.selfWriteSuppression.get(clientPostId);
    if (until === undefined) return false;
    if (Date.now() >= until) {
      this.selfWriteSuppression.delete(clientPostId);
      return false;
    }
    return true;
  }

  /**
   * Update the settings reference (called when settings are reloaded externally).
   */
  updateSettings(settings: SocialArchiverSettings): void {
    this.settings = settings;
  }

  private async onFileDeleted(filePath: string): Promise<void> {
    // Cancel background edit debounce timer for this path (keyed by filePath)
    const bgTimer = this.bgEditDebounceTimers.get(filePath);
    if (bgTimer !== undefined) {
      clearTimeout(bgTimer);
      this.bgEditDebounceTimers.delete(filePath);
    }

    const queue = this.settings.pendingComposedPostSyncs ?? [];
    const match = queue.find((e) => e.filePath === filePath);
    if (match) {
      // Cancel any pending composer-path debounce timer for this post
      const timer = this.updateDebounceTimers.get(match.clientPostId);
      if (timer !== undefined) {
        clearTimeout(timer);
        this.updateDebounceTimers.delete(match.clientPostId);
      }
      this.contentFingerprints.delete(match.clientPostId);
      this.selfWriteSuppression.delete(match.clientPostId);
      await this.removeFromQueue(match.clientPostId);
      console.log(`${LOG_PREFIX} Removed queue entry for deleted file: ${filePath}`);
    }
  }
}

// ============================================================================
// Internal types
// ============================================================================

interface ComposedMediaItem {
  data: ArrayBuffer;
  filename: string;
  contentType: string;
  index: number;
}

// Re-export for consumers that imported these from this module
export type { CreateComposedPostRequest, UpdateComposedPostRequest };
