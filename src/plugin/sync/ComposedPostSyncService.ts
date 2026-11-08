/**
 * ComposedPostSyncService
 *
 * Manages durable queue for syncing composed posts to the server.
 *
 * Responsibilities:
 * - Enqueue create/update operations
 * - Flush queue: read vault file, reconstruct payload, upload new media, POST/PUT to server
 * - On success: write sourceArchiveId, syncState='synced', serverSyncedAt,
 *   syncedContentHash, syncedContentRevision and the synced media list to frontmatter
 * - On failure: transient failures wait in the queue; a rejection spends a
 *   retry, and the last one sets syncState='failed'. A 409 (another device
 *   edited the post) goes to the reconciler: adopt or conflict copy, never a retry.
 * - Persist queue to settings (survives app restart)
 * - Handle file deletion: remove pending queue entries
 * - Handle file rename/move: point pending queue entries at the new path
 *
 * An edit is a change to what the server stores (title, text, which embeds),
 * not to the file: frontmatter writes (ours, inbound sync, like/archive
 * toggles) send nothing, and neither do inbound rewrites of the note parts the
 * server doesn't store (annotations, highlight marks, linked archives,
 * comments). `syncedContentHash` keeps that true across restarts and devices,
 * and it is always read from the note as written (prd-plugin-my-posts-two-way-sync §3).
 *
 * Only two-way sync participants are pushed: a composed note (not a meeting or
 * audio note) with a numeric `syncedContentRevision`, not diverged, not CRLF.
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
import { getMimeTypeFromExtension } from '../../utils/media';
import { isImageUrl, isVideoUrl } from '../../utils/mediaType';
import { isComposedPostNote, isComposedSyncParticipant } from '../../utils/composedPostNote';
import { splitArchiveRefLines } from '../../utils/note-mentions';
import {
  composedFingerprint,
  isSyncableComposedNote,
  readComposedNote,
  readNoteFrontmatter,
  readSyncedMedia,
  sha256Hex,
  type ComposedAttachmentRef,
  type ComposedNoteParts,
} from './composed/composedNote';
import type { ComposedPostReconciler } from './composed/ComposedPostReconciler';
import type { EditorPresence } from './composed/EditorPresence';

// ============================================================================
// Constants
// ============================================================================

const MAX_RETRIES = 3;
const LOG_PREFIX = '[Social Archiver] [ComposedPostSync]';

/** A note in no editor: pushed this long after its last change (§5.2). */
const BACKGROUND_EDIT_DEBOUNCE_MS = 5000;

/** A note open in an editor: pushed once it has rested this long, or as soon as the user leaves it (§5.2). */
const OPEN_EDIT_DEBOUNCE_MS = 30_000;

/**
 * Offline, signed out (401), over quota (402), timed out, rate limited or a
 * server error: these pass, so the entry waits without spending a retry. Only
 * the server turning the request itself down counts.
 */
function isTransient(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status !== 'number' || status >= 500 || [401, 402, 408, 429].includes(status);
}

function errorCode(error: unknown): unknown {
  return (error as { code?: unknown } | null)?.code;
}

/** This user's composed-post media on R2: a gallery entry left remote (failed download) passes through as is. */
function isComposedR2MediaUrl(url: string): boolean {
  try {
    return new URL(url).pathname.startsWith('/media/archives/');
  } catch {
    return false;
  }
}

/** The optional collaborators of two-way sync; absent, pushes still work and a 409 waits for library sync. */
export interface ComposedPostSyncOptions {
  reconciler?: () => ComposedPostReconciler | undefined;
  presence?: () => EditorPresence | undefined;
  withArchiveWriteLocks?: <T>(archiveId: string, fn: () => Promise<T>) => Promise<T>;
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
  private readonly opts: ComposedPostSyncOptions;
  private unregisterVaultListeners?: () => void;
  private unsubscribeLeave?: () => void;

  /** EventRef for the MetadataCache 'changed' listener (for offref cleanup). */
  private metadataCacheRef: EventRef | null = null;

  /** Set by onPluginUnload (unloaded, signed out): flush() sends nothing until onPluginLoad. */
  private paused = false;

  /** The running flush pass; flush() calls made meanwhile share it. */
  private flushing: Promise<void> | null = null;
  /** A flush() call arrived mid-pass: run one more for entries queued after its snapshot. */
  private flushAgain = false;

  /** Debounced pushes of edited notes, keyed by file path; `run` fires one early (the user left the note). */
  private bgEditDebounceTimers = new Map<string, { timer: number; run: () => void }>();

  constructor(
    app: App,
    vault: Vault,
    settingsOrGetter: SocialArchiverSettings | (() => SocialArchiverSettings),
    apiClientOrGetter: WorkersAPIClient | (() => WorkersAPIClient),
    saveSettings: () => Promise<void>,
    opts: ComposedPostSyncOptions = {}
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
    this.opts = opts;
  }

  private get settings(): SocialArchiverSettings {
    return this.getSettings();
  }

  private withArchiveWriteLocks<T>(archiveId: string, fn: () => Promise<T>): Promise<T> {
    return this.opts.withArchiveWriteLocks ? this.opts.withArchiveWriteLocks(archiveId, fn) : fn();
  }

  /** The note's frontmatter from its text (the snapshot its fingerprint comes from), else MetadataCache. */
  private noteFrontmatter(file: TFile, raw: string): Record<string, unknown> | undefined {
    return readNoteFrontmatter(raw) ?? this.app.metadataCache.getFileCache(file)?.frontmatter;
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
   * Read the note and enqueue an update only if it is a participant and its
   * post differs from the one last synced (`syncedContentHash`).
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
      const fm = this.noteFrontmatter(file, raw);
      const parts = readComposedNote(raw);
      if (!isComposedSyncParticipant(fm) || !isSyncableComposedNote(parts)) return;
      if (composedFingerprint(parts) === fm?.['syncedContentHash']) {
        console.debug(`${LOG_PREFIX} Content unchanged, skipping update enqueue: ${clientPostId}`);
        return;
      }
      await this.enqueueUpdate(filePath, clientPostId, sourceArchiveId);
      void this.flush();
    } catch (error) {
      console.error(`${LOG_PREFIX} maybeEnqueueUpdate failed:`, error);
    }
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
      if (entry.op === 'create') {
        await this.handleCreate(entry, file);
      } else {
        await this.handleUpdate(entry, file);
      }
    } catch (error) {
      await this.recordFailure(entry, error);
    }
  }

  private async handleCreate(entry: PendingComposedPostSyncEntry, file: TFile): Promise<void> {
    const raw = await this.vault.read(file);
    const parts = readComposedNote(raw);
    const { content, syncedMedia } = await this.buildContent(entry.clientPostId, file, parts, this.noteFrontmatter(file, raw));
    const request: CreateComposedPostRequest = { clientPostId: entry.clientPostId, ...content };
    const result = await this.getApiClient().createComposedPost(request);

    // Write success fields to frontmatter. savePost already stamped the
    // identity pair, except on entries whose id flush() had to mint. The hash
    // is of what was sent: an edit made while the request ran then goes out as
    // an update. A new row is at revision 0 (POST returns none, F10).
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      fm['postOrigin'] = 'composer';
      fm['clientPostId'] = entry.clientPostId;
      fm['sourceArchiveId'] = result.archiveId;
      fm['syncState'] = 'synced';
      fm['serverSyncedAt'] = result.createdAt;
      fm['syncedContentHash'] = composedFingerprint(parts);
      fm['syncedContentRevision'] = 0;
      fm['syncedMedia'] = syncedMedia;
      delete fm['syncedMediaNext'];
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

  /**
   * PUT an edited participant note with its base revision, under the archive
   * write locks so it never races a pull of the same post. A note that is not
   * a participant (no baseline, diverged, media note, CRLF) leaves the queue:
   * migration or the diverged list decides what happens to it.
   */
  private async handleUpdate(entry: PendingComposedPostSyncEntry, file: TFile): Promise<void> {
    const archiveId = entry.sourceArchiveId;
    if (!archiveId) {
      throw new Error('Update entry missing sourceArchiveId');
    }

    await this.withArchiveWriteLocks(archiveId, async () => {
      const raw = await this.vault.read(file);
      const fm = this.noteFrontmatter(file, raw);
      const parts = readComposedNote(raw);
      if (!isComposedSyncParticipant(fm) || !isSyncableComposedNote(parts)) {
        // CRLF or no author line: logged, so a user asking why an edit never synced has an answer.
        console.warn(`${LOG_PREFIX} Not a two-way sync participant (no baseline, diverged, media note, CRLF or no author line), dropping update: ${entry.filePath}`);
        await this.removeFromQueue(entry.clientPostId);
        return;
      }
      // A pull already brought the note to what the server has.
      if (composedFingerprint(parts) === fm?.['syncedContentHash']) {
        await this.removeFromQueue(entry.clientPostId);
        return;
      }

      try {
        await this.put(file, parts, fm, archiveId, entry.clientPostId, fm?.['syncedContentRevision'] as number);
      } catch (error) {
        if (errorCode(error) !== 'POST_EDIT_CONFLICT') throw error;
        await this.resolveEditConflict(file, archiveId);
      }
      await this.removeFromQueue(entry.clientPostId);
      console.debug(`${LOG_PREFIX} Update handled: ${entry.clientPostId} (archiveId=${archiveId})`);
    });
  }

  /** §3: another device edited the post since this note's baseline. Never a retry. */
  private async resolveEditConflict(file: TFile, archiveId: string): Promise<void> {
    const reconciler = this.opts.reconciler?.();
    if (!reconciler) {
      console.warn(`${LOG_PREFIX} Edit conflict with no reconciler; library sync settles it: ${archiveId}`);
      return;
    }
    const { archive } = await this.getApiClient().getUserArchive(archiveId);
    const outcome = await reconciler.afterPushConflict(file, archive);
    console.debug(`${LOG_PREFIX} Edit conflict ${outcome}: ${archiveId}`);
  }

  /**
   * "Send vault version": PUT the note as it is with no base revision (last
   * writer wins), then stamp the baseline. A diverged note is allowed. Takes no
   * locks: the caller holds them.
   */
  async pushNote(file: TFile, opts: { baseContentRevision?: number }): Promise<void> {
    const raw = await this.vault.read(file);
    const fm = this.noteFrontmatter(file, raw);
    const archiveId = fm?.['sourceArchiveId'];
    const clientPostId = fm?.['clientPostId'];
    const parts = readComposedNote(raw);
    if (!isComposedPostNote(fm) || typeof archiveId !== 'string' || !archiveId
      || typeof clientPostId !== 'string' || !clientPostId) {
      throw new Error(`Not a synced composed post: ${file.path}`);
    }
    if (!isSyncableComposedNote(parts)) {
      throw new Error(`The note has Windows line endings or no author line, so it cannot sync: ${file.path}`);
    }
    await this.put(file, parts, fm, archiveId, clientPostId, opts.baseContentRevision);
  }

  // ponytail: quoteRefs is always true. Every route into participation
  // (create, adopt, pull) leaves the note's trailing ref lines equal to the
  // server's archive refs, so the note always holds the whole list.
  private async put(
    file: TFile,
    parts: ComposedNoteParts,
    fm: Record<string, unknown> | undefined,
    archiveId: string,
    clientPostId: string,
    baseContentRevision: number | undefined
  ): Promise<void> {
    const { content, syncedMedia } = await this.buildContent(clientPostId, file, parts, fm);
    const request: UpdateComposedPostRequest = {
      ...content,
      quoteRefs: true,
      ...(baseContentRevision !== undefined ? { baseContentRevision } : {}),
    };
    const result = await this.getApiClient().updateComposedPost(archiveId, request);
    await this.app.fileManager.processFrontMatter(file, (target: Record<string, unknown>) => {
      target['syncState'] = 'synced';
      target['serverSyncedAt'] = result.updatedAt;
      target['syncedContentHash'] = composedFingerprint(parts);
      target['syncedContentRevision'] = result.contentRevision;
      target['syncedMedia'] = syncedMedia;
      delete target['syncedMediaNext'];
    });
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
    const current = queue[idx];
    if (!current) return;

    const updated = { ...current };
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
    parts: ComposedNoteParts,
    fm: Record<string, unknown> | undefined
  ): Promise<{ content: ComposedPostContent; syncedMedia: string[] }> {
    const { media, syncedMedia } = await this.uploadMedia(clientPostId, file, parts.attachments, readSyncedMedia(fm));
    const preview = splitArchiveRefLines(parts.text).body;
    return {
      content: {
        title: parts.title,
        previewText: preview.slice(0, 500) || parts.title || null,
        fullContent: parts.text,
        thumbnailUrl: media.find((m) => m.type === 'image')?.url ?? null,
        media,
      },
      syncedMedia,
    };
  }

  /**
   * Upload the note's image and video attachments to R2, in note order,
   * except those the server already has: the same bytes keep the URL they
   * synced under, so a text edit uploads nothing. The server picks the index
   * of a new one (and dedupes identical bytes), so two devices never write
   * the same key. A gallery entry left remote (a failed download) is this
   * user's R2 media already and passes through.
   */
  private async uploadMedia(
    clientPostId: string,
    note: TFile,
    attachments: ComposedAttachmentRef[],
    synced: Map<string, string>
  ): Promise<{ media: NonNullable<ComposedPostContent['media']>; syncedMedia: string[] }> {
    const media: NonNullable<ComposedPostContent['media']> = [];
    const syncedMedia: string[] = [];
    for (const attachment of attachments) {
      if (attachment.remote) {
        if (isComposedR2MediaUrl(attachment.target)) {
          media.push({ url: attachment.target, type: isVideoUrl(attachment.target) ? 'video' : 'image' });
        }
        continue;
      }
      const file = this.app.metadataCache.getFirstLinkpathDest(attachment.target, note.path)
        ?? this.vault.getFileByPath(attachment.target);
      const type = file && (isImageUrl(file.path) ? 'image' : isVideoUrl(file.path) ? 'video' : null);
      // A deleted attachment: nothing to show on the server.
      if (!file || !type) continue;

      const data = await this.vault.readBinary(file);
      const hash = await sha256Hex(data);
      let url = synced.get(hash);
      if (!url) {
        try {
          const uploaded = await this.getApiClient().uploadComposedMedia({
            clientPostId,
            ext: file.extension.toLowerCase(),
            contentType: getMimeTypeFromExtension(file.extension),
            type,
            data,
          });
          url = uploaded.r2Url;
        } catch (error) {
          if (errorCode(error) !== 'MEDIA_LIMIT_REACHED') throw error;
          // The post's upload index space is spent: this embed stays in the vault only.
          console.warn(`${LOG_PREFIX} Upload limit reached for ${clientPostId}, not syncing ${file.path}`);
          continue;
        }
        // The same file embedded twice uploads once.
        synced.set(hash, url);
      }
      media.push({ url, type });
      syncedMedia.push(`${hash}:${url}`);
    }
    return { media, syncedMedia };
  }

  // ============================================================================
  // Plugin lifecycle
  // ============================================================================

  /**
   * Start syncing: registers vault delete and rename listeners, the
   * MetadataCache watcher and the editor-leave hook, then flushes pending
   * queue. The plugin calls this on every (re)init while signed in, so a
   * repeat call only flushes.
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

      // Listen for MetadataCache changes to detect edits to composed posts
      this.metadataCacheRef = this.app.metadataCache.on('changed', (file: TFile) => {
        this.notifyNoteChanged(file);
      });

      // Leaving a note (tab closed, another note opened) sends its edit now.
      this.unsubscribeLeave = this.opts.presence?.()?.onLeave((path) => {
        this.bgEditDebounceTimers.get(path)?.run();
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
    this.unsubscribeLeave?.();
    this.unsubscribeLeave = undefined;

    // Unregister MetadataCache watcher
    if (this.metadataCacheRef) {
      this.app.metadataCache.offref(this.metadataCacheRef);
      this.metadataCacheRef = null;
    }

    // Cancel all pending edit debounce timers
    for (const { timer } of this.bgEditDebounceTimers.values()) {
      window.clearTimeout(timer);
    }
    this.bgEditDebounceTimers.clear();
  }

  // ============================================================================
  // Edit detection (MetadataCache watcher)
  // ============================================================================

  /**
   * A note changed (MetadataCache re-indexed it, or the reconciler found a
   * local edit). Only two-way sync participants with a server row are pushed
   * (closes F6: other devices' Tier-3 notes and meeting/audio notes are never
   * PUT before they have a baseline). Frontmatter-only writes pass this gate;
   * maybeEnqueueUpdate drops them because the post is unchanged.
   */
  notifyNoteChanged(file: TFile): void {
    const fm: Record<string, unknown> | undefined = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!isComposedSyncParticipant(fm)) return;

    const sourceArchiveId = fm?.['sourceArchiveId'];
    if (typeof sourceArchiveId !== 'string' || !sourceArchiveId) return;
    const clientPostId = fm?.['clientPostId'];
    if (typeof clientPostId !== 'string' || !clientPostId) return;

    const existing = this.bgEditDebounceTimers.get(file.path);
    if (existing) window.clearTimeout(existing.timer);

    // Keyed by path; the TFile's path follows a rename, so the run reads it then.
    const run = (): void => {
      const pending = this.bgEditDebounceTimers.get(file.path);
      if (pending) window.clearTimeout(pending.timer);
      this.bgEditDebounceTimers.delete(file.path);
      void this.maybeEnqueueUpdate(file.path, clientPostId, sourceArchiveId);
    };
    const delay = this.opts.presence?.()?.isOpen(file.path) ? OPEN_EDIT_DEBOUNCE_MS : BACKGROUND_EDIT_DEBOUNCE_MS;
    this.bgEditDebounceTimers.set(file.path, { timer: window.setTimeout(run, delay), run });
  }

  private async onFileDeleted(filePath: string): Promise<void> {
    // Cancel the edit debounce timer for this path
    const pending = this.bgEditDebounceTimers.get(filePath);
    if (pending) {
      window.clearTimeout(pending.timer);
      this.bgEditDebounceTimers.delete(filePath);
    }

    const queue = this.settings.pendingComposedPostSyncs ?? [];
    const match = queue.find((e) => e.filePath === filePath);
    if (match) {
      await this.removeFromQueue(match.clientPostId);
      console.debug(`${LOG_PREFIX} Removed queue entry for deleted file: ${filePath}`);
    }
  }

  private async onFileRenamed(filePath: string, oldPath: string): Promise<void> {
    // Only the key moves: when the timer fires it reads the TFile's path,
    // which Obsidian has already updated in place.
    const pending = this.bgEditDebounceTimers.get(oldPath);
    if (pending) {
      this.bgEditDebounceTimers.delete(oldPath);
      this.bgEditDebounceTimers.set(filePath, pending);
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
