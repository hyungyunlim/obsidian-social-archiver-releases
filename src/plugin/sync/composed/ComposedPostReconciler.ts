/**
 * Inbound handling of one composed post (prd-plugin-my-posts-two-way-sync §3,
 * §5.3, §5.4): compares the note with the server row and pulls, reports a
 * conflict, or hands a local edit to push.
 *
 * Callers hold the archive write locks (library sync, WS ingest), except the
 * deferred path, which takes them itself. A note open in an editor is never
 * rewritten: the write waits until the user leaves it.
 */

import type { App, TFile } from 'obsidian';
import type { UserArchive, WorkersAPIClient } from '../../../services/WorkersAPIClient';
import { isComposedPostNote } from '../../../utils/composedPostNote';
import {
  composedFingerprint,
  isComposedServerRow,
  isSyncableComposedNote,
  readComposedNote,
  readNoteFrontmatter,
  sameComposedText,
  serverComposedText,
  type ComposedNoteParts,
} from './composedNote';
import { decideComposedSync } from './decideComposedSync';
import type { EditorPresence } from './EditorPresence';
import type { ComposedPostPullWriter, DownloadedComposedMedia } from './ComposedPostPullWriter';
import type { ComposedConflictCopyWriter } from './ComposedConflictCopyWriter';

const LOG_PREFIX = '[Social Archiver] [ComposedReconcile]';

export type ComposedReconcileResult = 'not-composed' | 'skipped' | 'none' | 'push' | 'pulled' | 'conflict' | 'deferred';

export interface ComposedPostReconcilerDeps {
  app: App;
  presence: EditorPresence;
  pullWriter: ComposedPostPullWriter;
  conflictWriter: ComposedConflictCopyWriter;
  apiClient: () => WorkersAPIClient | undefined;
  withArchiveWriteLocks: <T>(archiveId: string, fn: () => Promise<T>) => Promise<T>;
  /** → ComposedPostSyncService.notifyNoteChanged */
  requestPush: (file: TFile) => void;
  /** Repaints highlight marks after a rewrite. */
  afterPull?: (file: TFile, archive: UserArchive) => Promise<void>;
}

export class ComposedPostReconciler {
  /** Paths whose pull or conflict waits for the editor to close. */
  private readonly deferred = new Set<string>();
  private unsubscribe?: () => void;

  constructor(private readonly deps: ComposedPostReconcilerDeps) {}

  async reconcile(file: TFile, archive: UserArchive): Promise<ComposedReconcileResult> {
    if (!isComposedServerRow(archive)) return 'not-composed';
    const raw = await this.deps.app.vault.read(file);
    const fm = this.frontmatter(file, raw);
    if (!isComposedPostNote(fm) || fm?.['syncState'] === 'diverged') return 'skipped';
    const parts = readComposedNote(raw);
    if (!isSyncableComposedNote(parts)) {
      console.warn(`${LOG_PREFIX} CRLF note or note without its author line left out of two-way sync: ${file.path}`);
      return 'skipped';
    }
    const sameText = sameComposedText(parts.text, serverComposedText(archive));
    if (typeof fm?.['syncedContentRevision'] !== 'number') return this.joinWithoutBaseline(file, archive, parts, sameText);

    const action = decideComposedSync({
      noteChanged: composedFingerprint(parts) !== fm['syncedContentHash'],
      serverRevision: archive.contentRevision ?? 0,
      syncedRevision: fm['syncedContentRevision'],
    });
    if (action === 'none') return 'none';
    if (action === 'push') {
      this.deps.requestPush(file);
      return 'push';
    }
    // Both sides moved to the same text (Obsidian Sync carried it, or a 409
    // retried after the editor closed): nothing to keep a copy of.
    if (action === 'conflict' && sameText) return this.adopt(file, archive, parts);
    if (this.deferIfOpen(file)) return 'deferred';
    if (action === 'conflict') {
      await this.applyConflict(file, archive);
      return 'conflict';
    }
    await this.deps.pullWriter.write(file, archive);
    await this.deps.afterPull?.(file, archive);
    return 'pulled';
  }

  /** A fresh Tier-3/WS note of a composed row joins two-way sync. */
  async stampNew(file: TFile, archive: UserArchive, downloaded?: DownloadedComposedMedia): Promise<void> {
    if (!isComposedServerRow(archive)) return;
    await this.deps.pullWriter.stampBaseline(file, archive, downloaded);
  }

  /**
   * A queue-path save (client sync) of a composed row: a new note gets its
   * baseline, a note already in the vault reconciles. Never fatal: library
   * sync reconciles it again. The caller holds the archive write locks.
   */
  async afterQueueSave(
    result: { status: string; file?: TFile; media?: DownloadedComposedMedia },
    archive: UserArchive,
  ): Promise<void> {
    if (!result.file || !isComposedServerRow(archive)) return;
    try {
      if (result.status === 'created' || result.status === 'updated') await this.stampNew(result.file, archive, result.media);
      else if (result.status === 'existing') await this.reconcile(result.file, archive);
    } catch (error) {
      console.warn(`${LOG_PREFIX} Composed post sync after a queue save failed: ${archive.id}`, error);
    }
  }

  // ponytail: text only, as PRD §3 says. A race where only the media differ
  // adopts the server's revision with the note's own media list.
  /** A push got 409: the same text means another device sent this edit (adopt); anything else is a conflict. */
  async afterPushConflict(file: TFile, archive: UserArchive): Promise<'adopted' | 'conflict' | 'deferred'> {
    const parts = readComposedNote(await this.deps.app.vault.read(file));
    if (sameComposedText(parts.text, serverComposedText(archive))) {
      return (await this.adopt(file, archive, parts)) === 'deferred' ? 'deferred' : 'adopted';
    }
    if (this.deferIfOpen(file)) return 'deferred';
    await this.applyConflict(file, archive);
    return 'conflict';
  }

  start(): void {
    this.unsubscribe ??= this.deps.presence.onLeave((path) => {
      if (this.deferred.has(path)) void this.retryDeferred(path);
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.deferred.clear();
  }

  private frontmatter(file: TFile, raw: string): Record<string, unknown> | null {
    return readNoteFrontmatter(raw) ?? this.deps.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
  }

  private deferIfOpen(file: TFile): boolean {
    if (!this.deps.presence.isOpen(file.path)) {
      this.deferred.delete(file.path);
      return false;
    }
    this.deferred.add(file.path);
    return true;
  }

  /**
   * The note says what the server says. Byte-equal: baseline only (a
   * frontmatter write, fine in an open editor). Equal only once normalized
   * (old writer escapes, whitespace): the note takes the server's bytes, so
   * the next edit never pushes the escapes (§5.5).
   */
  private async adopt(file: TFile, archive: UserArchive, parts: ComposedNoteParts): Promise<'none' | 'pulled' | 'deferred'> {
    if (parts.text === serverComposedText(archive)) {
      await this.deps.pullWriter.stampBaseline(file, archive);
      return 'none';
    }
    if (this.deferIfOpen(file)) return 'deferred';
    await this.deps.pullWriter.write(file, archive);
    await this.deps.afterPull?.(file, archive);
    return 'pulled';
  }

  /**
   * A composed note with no baseline: a stamp that failed, or a note an older
   * plugin wrote and Obsidian Sync carried here. The same text joins two-way
   * sync; anything else waits for the user in the diverged list.
   */
  private async joinWithoutBaseline(
    file: TFile,
    archive: UserArchive,
    parts: ComposedNoteParts,
    sameText: boolean,
  ): Promise<ComposedReconcileResult> {
    if (sameText) return this.adopt(file, archive, parts);
    await this.deps.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      fm['syncState'] = 'diverged';
      fm['postOrigin'] = 'composer';
      fm['clientPostId'] = archive.postId;
      fm['sourceArchiveId'] = archive.id;
    });
    return 'skipped';
  }

  /** The vault version is saved first; then the note takes the server version. */
  private async applyConflict(file: TFile, archive: UserArchive): Promise<void> {
    await this.deps.conflictWriter.write(file);
    await this.deps.pullWriter.write(file, archive);
    await this.deps.afterPull?.(file, archive);
  }

  private async retryDeferred(path: string): Promise<void> {
    this.deferred.delete(path);
    const file = this.deps.app.vault.getFileByPath(path);
    const api = this.deps.apiClient();
    if (!file || !api) return;
    const archiveId: unknown = this.deps.app.metadataCache.getFileCache(file)?.frontmatter?.['sourceArchiveId'];
    if (typeof archiveId !== 'string' || !archiveId) return;
    try {
      const { archive } = await api.getUserArchive(archiveId);
      await this.deps.withArchiveWriteLocks(archiveId, () => this.reconcile(file, archive));
    } catch (error) {
      // The next library sync or WS event reconciles it again.
      console.warn(`${LOG_PREFIX} Deferred reconcile failed for ${path}:`, error);
    }
  }
}
