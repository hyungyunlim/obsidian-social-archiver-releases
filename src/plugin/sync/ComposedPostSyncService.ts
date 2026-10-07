/**
 * ComposedPostSyncService
 *
 * Manages durable queue for syncing composed posts to the server.
 *
 * Responsibilities:
 * - Enqueue create/update operations
 * - Flush queue: read vault file, reconstruct payload, upload new media, POST to server
 * - On success: write sourceArchiveId, syncState='synced', serverSyncedAt,
 *   syncedContentHash and the synced media list to frontmatter
 * - On failure: transient failures wait in the queue; a rejection spends a
 *   retry, and the last one sets syncState='failed'
 * - Persist queue to settings (survives app restart)
 * - Handle file deletion: remove pending queue entries
 * - Handle file rename/move: point pending queue entries at the new path
 *
 * An edit is a change to what the server stores (text, title, which embeds),
 * not to the file: frontmatter writes (ours, inbound sync, like/archive
 * toggles) send nothing, and neither do inbound rewrites of the note parts the
 * server doesn't store (annotations, highlight marks, linked archives,
 * comments). `syncedContentHash` keeps that true across restarts and devices.
 *
 * Single Responsibility: composed post outbound sync orchestration
 */

import type { App, EventRef, TAbstractFile, TFile, Vault } from 'obsidian';
import type {
  WorkersAPIClient,
  ComposedPostContent,
  CreateComposedPostRequest,
  UpdateComposedPostRequest,
} from '../../services/WorkersAPIClient';
import type {
  SocialArchiverSettings,
  PendingComposedPostSyncEntry,
} from '../../types/settings';
import type { PostData } from '../../types/post';
import { PostDataParser } from '../../components/timeline/parsers/PostDataParser';
import { stripHighlightMarks } from '../../components/timeline/reader/ReaderHighlightManager';
import { getMimeTypeFromExtension } from '../../utils/media';
import { isImageUrl, isVideoUrl } from '../../utils/mediaType';
import { decodePathFromMarkdownLink } from '../../utils/url';

// ============================================================================
// Constants
// ============================================================================

const MAX_RETRIES = 3;
const LOG_PREFIX = '[Social Archiver] [ComposedPostSync]';

/** The upload route's last index (MAX_ARCHIVE_MEDIA - 1 in workers/src/types/user-archives.ts). */
const MAX_MEDIA_INDEX = 24;

/** Debounce delay for update enqueue — avoids rapid re-saves creating many update requests. */
const UPDATE_DEBOUNCE_MS = 2000;

/**
 * Debounce delay for the background MetadataCache watcher.
 * Longer than the composer path (2s) since background edits are less time-sensitive.
 */
const BACKGROUND_EDIT_DEBOUNCE_MS = 5000;

/**
 * Offline, signed out (401), over quota (402), timed out, rate limited or a
 * server error: these pass, so the entry waits without spending a retry. Only
 * the server turning the request itself down counts.
 */
function isTransient(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status !== 'number' || status >= 500 || [401, 402, 408, 429].includes(status);
}

/**
 * The post's text as the server stores it: the text the timeline card shows.
 * PostDataParser already leaves out the footer, the media gallery, embedded
 * archives and the sections other services keep in the note (annotations,
 * linked archives, comments, AI comments, transcripts, place and product
 * blocks). Two things inbound sync writes into the text go too: the
 * `==marks==` highlights are painted with (highlights sync on their own, with
 * offsets into the unmarked text), and the rule a section written above the
 * footer leaves behind (platform comments).
 */
function composedPostText(post: PostData): string {
  return stripHighlightMarks(post.content.text).canonical
    .replace(/(?:(?:^|\n)\s*---)+$/, '')
    .trimEnd();
}

/** What a sync writes to frontmatter for readSyncedMedia. */
interface SyncedMediaFields {
  syncedMedia: string[];
  syncedMediaNext: number;
}

/**
 * The media the server last accepted, from frontmatter: `syncedMedia` lists
 * `<sha256>:<r2Url>` in note order, and `syncedMediaNext` is the lowest upload
 * index never used. Keyed by content, not path: an edit trashes a removed
 * image before it saves the added one, so a pasted `image.png` can take the
 * removed one's path.
 */
function readSyncedMedia(fm: Record<string, unknown> | undefined): { urls: Map<string, string>; next: number } {
  const urls = new Map<string, string>();
  const list: unknown = fm?.['syncedMedia'];
  for (const entry of Array.isArray(list) ? (list as unknown[]) : []) {
    if (typeof entry !== 'string') continue;
    const colon = entry.indexOf(':');
    if (colon > 0) urls.set(entry.slice(0, colon), entry.slice(colon + 1));
  }
  const next: unknown = fm?.['syncedMediaNext'];
  return { urls, next: typeof next === 'number' && Number.isInteger(next) && next > 0 ? next : 0 };
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * A new composed post's stable id: frontmatter `clientPostId`, queue key, and
 * the server's create idempotency key / `post_id` (must match /^[a-zA-Z0-9_-]+$/).
 */
export function createComposedPostId(): string {
  return `post_${crypto.randomUUID()}`;
}

/**
 * The server row a composer note has, or gets when its create lands: the
 * create uses the clientPostId as the row id. A share names it even before
 * then, and the server links the share to the row once it exists. Any other
 * note: undefined.
 */
export function composedArchiveId(frontmatter: Record<string, unknown> | undefined): string | undefined {
  const clientPostId = frontmatter?.['clientPostId'];
  return frontmatter?.['postOrigin'] === 'composer' && typeof clientPostId === 'string' && clientPostId
    ? clientPostId
    : undefined;
}

// ============================================================================
// ComposedPostSyncService
// ============================================================================

export class ComposedPostSyncService {
  private app: App;
  private vault: Vault;
  /**
   * The plugin's saveSettingsPartial() replaces its settings object on every
   * save, so a held reference would keep writing the queue into a copy nobody
   * persists. Read it fresh each time.
   */
  private getSettings: () => SocialArchiverSettings;
  private getApiClient: () => WorkersAPIClient;
  private saveSettings: () => Promise<void>;
  private unregisterVaultListeners?: () => void;

  /** EventRef for the MetadataCache 'changed' listener (for offref cleanup). */
  private metadataCacheRef: EventRef | null = null;

  /** Set by onPluginUnload (unloaded, signed out): flush() sends nothing until onPluginLoad. */
  private paused = false;

  /** The running flush pass; flush() calls made meanwhile share it. */
  private flushing: Promise<void> | null = null;
  /** A flush() call arrived mid-pass: run one more for entries queued after its snapshot. */
  private flushAgain = false;

  /**
   * Debounce timers for update operations keyed by clientPostId.
   * Cleared when the timer fires or when the file is deleted.
   */
  private updateDebounceTimers = new Map<string, number>();

  /**
   * Debounce timers for the background MetadataCache watcher, keyed by file path.
   * Separate from updateDebounceTimers so background and composer paths don't collide.
   */
  private bgEditDebounceTimers = new Map<string, number>();

  /**
   * Post fingerprints keyed by clientPostId: the last one enqueued or synced.
   * Skips an update that would send the same post again; frontmatter
   * `syncedContentHash` does the same across restarts.
   */
  private contentFingerprints = new Map<string, string>();

  constructor(
    app: App,
    vault: Vault,
    settingsOrGetter: SocialArchiverSettings | (() => SocialArchiverSettings),
    apiClientOrGetter: WorkersAPIClient | (() => WorkersAPIClient),
    saveSettings: () => Promise<void>
  ) {
    this.app = app;
    this.vault = vault;
    this.getSettings = typeof settingsOrGetter === 'function'
      ? settingsOrGetter
      : (): SocialArchiverSettings => settingsOrGetter;
    this.getApiClient = typeof apiClientOrGetter === 'function'
      ? apiClientOrGetter
      : () => apiClientOrGetter;
    this.saveSettings = saveSettings;
  }

  private get settings(): SocialArchiverSettings {
    return this.getSettings();
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
      window.clearTimeout(existing);
    }

    const timer = window.setTimeout(() => {
      this.updateDebounceTimers.delete(clientPostId);
      void this.maybeEnqueueUpdate(filePath, clientPostId, sourceArchiveId);
    }, UPDATE_DEBOUNCE_MS);

    this.updateDebounceTimers.set(clientPostId, timer);
  }

  /**
   * Parse the note and enqueue an update only if the post differs from the
   * one last synced (`syncedContentHash`) or enqueued.
   */
  private async maybeEnqueueUpdate(
    filePath: string,
    clientPostId: string,
    sourceArchiveId: string
  ): Promise<void> {
    const file = this.vault.getFileByPath(filePath);
    if (!file) return;

    try {
      const post = await new PostDataParser(this.vault, this.app).parseFile(file);
      if (!post) return;

      const fingerprint = this.fingerprint(post);
      const syncedFingerprint: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.['syncedContentHash'];
      if (fingerprint === syncedFingerprint || fingerprint === this.contentFingerprints.get(clientPostId)) {
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
   * What buildContent() sends, short of uploading: the R2 URLs are only known
   * after an upload, so the embeds count by vault path.
   */
  private fingerprint(post: PostData): string {
    return this.computeFingerprint(
      JSON.stringify([post.title ?? null, composedPostText(post), post.media.map((m) => m.url)])
    );
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
   * Called on plugin load and after each enqueue. One pass runs at a time: a
   * call made during a pass shares it and gets one more pass, so the composer,
   * the watcher and plugin load never send an entry twice.
   */
  flush(): Promise<void> {
    if (this.paused) return Promise.resolve();
    if (this.flushing) {
      this.flushAgain = true;
      return this.flushing;
    }

    this.flushing = (async (): Promise<void> => {
      try {
        do {
          this.flushAgain = false;
          await this.flushPass();
        } while (this.flushAgain && !this.paused);
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  private async flushPass(): Promise<void> {
    const queue = this.settings.pendingComposedPostSyncs ?? [];
    if (queue.length === 0) return;

    // Through 4.9.0 the composer queued posts with no id. The server rejects
    // those, and they all collide on `undefined` here, so give each its own id
    // now; handleCreate stamps it into the note.
    if (queue.some((e) => !e.clientPostId)) {
      for (const e of queue) e.clientPostId ||= createComposedPostId();
      await this.saveSettings();
    }

    // Work on a snapshot; we mutate settings.pendingComposedPostSyncs in place
    for (const entry of [...queue]) {
      if (this.paused) return;
      await this.processEntry(entry);
    }
  }

  private async processEntry(entry: PendingComposedPostSyncEntry): Promise<void> {
    // Locate vault file
    const file = this.vault.getFileByPath(entry.filePath);
    if (!file) {
      // File was deleted — remove from queue
      console.debug(`${LOG_PREFIX} File missing, removing from queue: ${entry.filePath}`);
      await this.removeFromQueue(entry.clientPostId);
      return;
    }

    try {
      // The post as the timeline card shows it: the template's footer and
      // the vault-only media embeds are not part of the text.
      const post = await new PostDataParser(this.vault, this.app).parseFile(file);
      if (!post) {
        throw new Error(`Could not read composed post: ${entry.filePath}`);
      }

      if (entry.op === 'create') {
        await this.handleCreate(entry, file, post);
      } else {
        await this.handleUpdate(entry, file, post);
      }
    } catch (error) {
      await this.recordFailure(entry, error);
    }
  }

  private async handleCreate(
    entry: PendingComposedPostSyncEntry,
    file: TFile,
    post: PostData
  ): Promise<void> {
    const { content, syncedMedia, syncedMediaNext } = await this.buildContent(entry.clientPostId, file, post);
    const request: CreateComposedPostRequest = { clientPostId: entry.clientPostId, ...content };
    const result = await this.getApiClient().createComposedPost(request);
    const syncedContentHash = this.fingerprint(post);
    this.contentFingerprints.set(entry.clientPostId, syncedContentHash);

    // Write success fields to frontmatter. savePost already stamped the
    // identity pair, except on entries whose id flush() had to mint. The
    // watcher sees this write and the hash makes it skip it, unless the note
    // was edited while the request ran: that edit then goes out as an update.
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      fm['postOrigin'] = 'composer';
      fm['clientPostId'] = entry.clientPostId;
      fm['sourceArchiveId'] = result.archiveId;
      fm['syncState'] = 'synced';
      fm['serverSyncedAt'] = result.createdAt;
      fm['syncedContentHash'] = syncedContentHash;
      fm['syncedMedia'] = syncedMedia;
      fm['syncedMediaNext'] = syncedMediaNext;
    });

    // Remove from queue
    await this.removeFromQueue(entry.clientPostId);

    console.debug(`${LOG_PREFIX} Create synced: ${entry.clientPostId} → ${result.archiveId}`);

    // A share made before this create is linked by the server when it named
    // the row. One from a plugin that didn't name it (4.9.0 and earlier) is
    // linked here, or library sync reads the post as unshared and clears the
    // note's share fields.
    const shareUrl: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.['shareUrl'];
    if (typeof shareUrl === 'string' && shareUrl) {
      try {
        await this.getApiClient().updateArchiveActions(result.archiveId, { shareUrl });
      } catch (error) {
        console.warn(`${LOG_PREFIX} Linking the note's share failed: ${entry.clientPostId}`, error);
      }
    }
  }

  private async handleUpdate(
    entry: PendingComposedPostSyncEntry,
    file: TFile,
    post: PostData
  ): Promise<void> {
    if (!entry.sourceArchiveId) {
      throw new Error('Update entry missing sourceArchiveId');
    }

    const { content, syncedMedia, syncedMediaNext } = await this.buildContent(entry.clientPostId, file, post);
    const request: UpdateComposedPostRequest = content;
    const result = await this.getApiClient().updateComposedPost(entry.sourceArchiveId, request);
    const syncedContentHash = this.fingerprint(post);
    this.contentFingerprints.set(entry.clientPostId, syncedContentHash);

    // Write success fields to frontmatter
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      fm['syncState'] = 'synced';
      fm['serverSyncedAt'] = result.updatedAt;
      fm['syncedContentHash'] = syncedContentHash;
      fm['syncedMedia'] = syncedMedia;
      fm['syncedMediaNext'] = syncedMediaNext;
    });

    // Remove from queue
    await this.removeFromQueue(entry.clientPostId);

    console.debug(`${LOG_PREFIX} Update synced: ${entry.clientPostId} (archiveId=${entry.sourceArchiveId})`);
  }

  private async recordFailure(
    entry: PendingComposedPostSyncEntry,
    error: unknown
  ): Promise<void> {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const transient = isTransient(error);
    console.error(
      `${LOG_PREFIX} Sync failed (${transient ? 'will retry' : `attempt ${entry.retryCount + 1}`}):`,
      errorMsg
    );

    const queue = this.settings.pendingComposedPostSyncs ?? [];
    const idx = queue.findIndex((e) => e.clientPostId === entry.clientPostId);
    if (idx === -1) return;

    const updated = { ...queue[idx]! };
    if (!transient) updated.retryCount += 1;
    updated.lastAttemptAt = new Date().toISOString();
    updated.lastError = errorMsg;

    this.settings.pendingComposedPostSyncs = [
      ...queue.slice(0, idx),
      updated,
      ...queue.slice(idx + 1),
    ];
    await this.saveSettings();

    // After max rejections, mark as failed in frontmatter
    if (updated.retryCount >= MAX_RETRIES) {
      const file = this.vault.getFileByPath(entry.filePath);
      if (file) {
        try {
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
  // Request content
  // ============================================================================

  /**
   * What create and update both send, rebuilt from the note on every attempt,
   * and the media list frontmatter keeps once the server accepts it.
   */
  private async buildContent(
    clientPostId: string,
    file: TFile,
    post: PostData
  ): Promise<{ content: ComposedPostContent } & SyncedMediaFields> {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const { media, ...synced } = await this.uploadMedia(clientPostId, post.media, readSyncedMedia(fm));
    const text = composedPostText(post);
    return {
      content: {
        title: post.title ?? null,
        previewText: text.slice(0, 500) || post.title || null,
        fullContent: text,
        thumbnailUrl: media.find((m) => m.type === 'image')?.url ?? null,
        media,
      },
      ...synced,
    };
  }

  // ponytail: an index is spent per upload the server accepted, so a post gets
  // 25 uploads over its life (indices 0..24). Past that an added embed stays in
  // the vault only (logged) and the rest still sync. The cap is the upload
  // route's key space, not the post's media count: raise that route's index
  // max (UploadMediaRequestSchema) if posts reach it.
  /**
   * Upload the note's image and video embeds to R2, in note order, except
   * those the server already has: the same bytes keep the URL they synced
   * under, so a text edit uploads nothing. A new one takes an index no upload
   * has used. Reusing one would put new bytes under a URL that mobile, desktop
   * and share-web cache as immutable, and they would keep showing the old
   * image. The next index is saved only once the server accepts the post, so
   * a retry overwrites the same keys.
   */
  private async uploadMedia(
    clientPostId: string,
    items: PostData['media'],
    synced: ReturnType<typeof readSyncedMedia>
  ): Promise<{ media: NonNullable<ComposedPostContent['media']> } & SyncedMediaFields> {
    const media: NonNullable<ComposedPostContent['media']> = [];
    const syncedMedia: string[] = [];
    let next = synced.next;
    for (const item of items) {
      // PostDataParser's regex fallback leaves `![](…)` paths markdown-encoded.
      const file = this.vault.getFileByPath(item.url)
        ?? this.vault.getFileByPath(decodePathFromMarkdownLink(item.url));
      const type = file && (isImageUrl(file.path) ? 'image' : isVideoUrl(file.path) ? 'video' : null);
      // A deleted attachment, an embedded note or PDF: nothing to show on the server.
      if (!file || !type) continue;

      const data = await this.vault.readBinary(file);
      const hash = await sha256Hex(data);
      let url = synced.urls.get(hash);
      if (!url) {
        if (next > MAX_MEDIA_INDEX) {
          console.warn(`${LOG_PREFIX} No upload index left for ${clientPostId}, not syncing ${file.path}`);
          continue;
        }
        const uploaded = await this.getApiClient().uploadComposedMedia({
          clientPostId,
          index: next,
          ext: file.extension.toLowerCase(),
          contentType: getMimeTypeFromExtension(file.extension),
          type,
          data,
        });
        url = uploaded.r2Url;
        next += 1;
        // The same file embedded twice uploads once.
        synced.urls.set(hash, url);
      }
      media.push({ url, type });
      syncedMedia.push(`${hash}:${url}`);
    }
    return { media, syncedMedia, syncedMediaNext: next };
  }

  // ============================================================================
  // Plugin lifecycle
  // ============================================================================

  /**
   * Start syncing: registers vault delete and rename listeners and the
   * MetadataCache watcher, then flushes pending queue. The plugin calls this on
   * every (re)init while signed in, so a repeat call only flushes.
   */
  async onPluginLoad(): Promise<void> {
    this.paused = false;

    if (!this.unregisterVaultListeners) {
      // Listen for vault file deletions to clean up orphaned queue entries
      const deleteHandler = (abstractFile: TAbstractFile): void => {
        void this.onFileDeleted(abstractFile.path);
      };
      // A moved or renamed note keeps its queue entry. Moving a folder fires
      // this once for every file in it.
      const renameHandler = (abstractFile: TAbstractFile, oldPath: string): void => {
        void this.onFileRenamed(abstractFile.path, oldPath);
      };
      this.vault.on('delete', deleteHandler as (...data: unknown[]) => unknown);
      this.vault.on('rename', renameHandler as (...data: unknown[]) => unknown);
      this.unregisterVaultListeners = (): void => {
        this.vault.off('delete', deleteHandler as (...data: unknown[]) => unknown);
        this.vault.off('rename', renameHandler as (...data: unknown[]) => unknown);
      };

      // Listen for MetadataCache changes to detect background edits to composed posts
      this.metadataCacheRef = this.app.metadataCache.on('changed', (file: TFile) => {
        this.onMetadataChanged(file);
      });
    }

    // Flush any pending entries from previous session
    try {
      await this.flush();
    } catch (error) {
      console.error(`${LOG_PREFIX} flush() on load failed:`, error);
    }
  }

  /**
   * Stop syncing (plugin unload, signed out). Queued entries stay queued, and
   * flush() sends nothing until the next onPluginLoad().
   */
  onPluginUnload(): void {
    this.paused = true;
    this.unregisterVaultListeners?.();
    this.unregisterVaultListeners = undefined;

    // Unregister MetadataCache watcher
    if (this.metadataCacheRef) {
      this.app.metadataCache.offref(this.metadataCacheRef);
      this.metadataCacheRef = null;
    }

    // Cancel all pending debounce timers (composer path)
    for (const timer of this.updateDebounceTimers.values()) {
      window.clearTimeout(timer);
    }
    this.updateDebounceTimers.clear();

    // Cancel all pending background edit debounce timers
    for (const timer of this.bgEditDebounceTimers.values()) {
      window.clearTimeout(timer);
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
   *
   * Frontmatter-only writes (our sync fields, inbound sync, like/archive)
   * pass these checks; maybeEnqueueUpdate drops them because the post is unchanged.
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

    // Debounce: cancel any existing background timer for this file
    const existing = this.bgEditDebounceTimers.get(file.path);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }

    const timer = window.setTimeout(() => {
      this.bgEditDebounceTimers.delete(file.path);
      // maybeEnqueueUpdate will re-read file, compute fingerprint, and enqueue only if changed
      void this.maybeEnqueueUpdate(file.path, clientPostId, sourceArchiveId);
    }, BACKGROUND_EDIT_DEBOUNCE_MS);

    this.bgEditDebounceTimers.set(file.path, timer);
  }

  private async onFileDeleted(filePath: string): Promise<void> {
    // Cancel background edit debounce timer for this path (keyed by filePath)
    const bgTimer = this.bgEditDebounceTimers.get(filePath);
    if (bgTimer !== undefined) {
      window.clearTimeout(bgTimer);
      this.bgEditDebounceTimers.delete(filePath);
    }

    const queue = this.settings.pendingComposedPostSyncs ?? [];
    const match = queue.find((e) => e.filePath === filePath);
    if (match) {
      // Cancel any pending composer-path debounce timer for this post
      const timer = this.updateDebounceTimers.get(match.clientPostId);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        this.updateDebounceTimers.delete(match.clientPostId);
      }
      this.contentFingerprints.delete(match.clientPostId);
      await this.removeFromQueue(match.clientPostId);
      console.debug(`${LOG_PREFIX} Removed queue entry for deleted file: ${filePath}`);
    }
  }

  private async onFileRenamed(filePath: string, oldPath: string): Promise<void> {
    // Only the key moves: when the timer fires it reads the TFile's path,
    // which Obsidian has already updated in place.
    const bgTimer = this.bgEditDebounceTimers.get(oldPath);
    if (bgTimer !== undefined) {
      this.bgEditDebounceTimers.delete(oldPath);
      this.bgEditDebounceTimers.set(filePath, bgTimer);
    }

    // In place: a running flush pass holds these same entry objects, and would
    // otherwise find no file at the old path and drop the entry.
    const moved = (this.settings.pendingComposedPostSyncs ?? []).filter((e) => e.filePath === oldPath);
    if (moved.length === 0) return;
    for (const entry of moved) entry.filePath = filePath;
    await this.saveSettings();
    console.debug(`${LOG_PREFIX} Queue entry follows renamed file: ${oldPath} → ${filePath}`);
  }
}

// Re-export for consumers that imported these from this module
export type { CreateComposedPostRequest, UpdateComposedPostRequest };
