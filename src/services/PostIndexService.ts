import type { Vault, App, TFile, TAbstractFile } from 'obsidian';
import type { Platform } from '@shared/platforms/types';

/**
 * Lightweight metadata entry for a single post in the index.
 * Contains only the fields needed for filtering, sorting, and search
 * — full PostData is loaded on-demand when the card enters the viewport.
 */
export interface PostIndexEntry {
  // Identity
  id: string;
  platform: Platform;
  filePath: string;
  fileModifiedTime: number; // mtime for staleness check

  // Filtering / sorting
  authorName: string;
  authorHandle?: string;
  publishedDate?: number; // epoch ms
  archivedDate?: number;  // epoch ms
  tags: string[];
  hashtags: string[];
  like: boolean;
  archive: boolean;
  subscribed: boolean;
  subscriptionId?: string;

  // Pre-joined search text (fast substring matching)
  searchText: string;

  // Series grouping
  seriesId?: string;
  episodeNumber?: number;

  // Display metadata (enough for skeleton sizing / series grouping)
  title?: string;
  url: string;
  mediaCount: number;
  commentCount: number;
  likesCount?: number;
  commentsCount?: number;
  type?: 'post' | 'profile';
  comment?: string;
  shareUrl?: string;

  // Timestamp for sort fallback
  metadataTimestamp: number; // epoch ms
}

/**
 * Serialized index stored in the plugin data directory.
 */
interface PostIndex {
  version: number;
  entries: Record<string, PostIndexEntry>; // keyed by filePath
  lastUpdated: number;
}

const INDEX_VERSION = 1;
const INDEX_FILE_NAME = 'post-index.json';
const SAVE_DEBOUNCE_MS = 5_000;

/**
 * PostIndexService — Metadata index cache for instant timeline loading.
 *
 * Instead of re-parsing every YAML frontmatter on each timeline open,
 * we cache lightweight PostIndexEntry objects and only re-parse files
 * whose mtime has changed.
 *
 * Storage: `.obsidian/plugins/social-archiver/post-index.json`
 * (separate from data.json to avoid bloating plugin settings)
 */
export class PostIndexService {
  private index: PostIndex = { version: INDEX_VERSION, entries: {}, lastUpdated: 0 };
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private indexPath: string;

  constructor(
    private vault: Vault,
    private app: App,
    private pluginDir: string // e.g. ".obsidian/plugins/social-archiver"
  ) {
    this.indexPath = `${this.pluginDir}/${INDEX_FILE_NAME}`;
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  /** Load cached index from disk. Returns false if file doesn't exist or is corrupt. */
  async load(): Promise<boolean> {
    try {
      const raw = await this.vault.adapter.read(this.indexPath);
      const parsed = JSON.parse(raw) as PostIndex;
      if (parsed.version !== INDEX_VERSION) {
        // Version mismatch — rebuild
        return false;
      }
      this.index = parsed;
      return true;
    } catch {
      return false;
    }
  }

  /** Persist index to disk (debounced). */
  scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer !== null) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  /** Flush any pending save immediately (call on plugin unload). */
  async flush(): Promise<void> {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty) {
      await this.saveNow();
    }
  }

  private async saveNow(): Promise<void> {
    this.dirty = false;
    this.index.lastUpdated = Date.now();
    try {
      const json = JSON.stringify(this.index);
      await this.vault.adapter.write(this.indexPath, json);
    } catch (err) {
      console.error('[PostIndexService] Failed to save index:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Incremental update API
  // ---------------------------------------------------------------------------

  /** Return all cached entries (keyed by filePath). */
  getEntries(): Record<string, PostIndexEntry> {
    return this.index.entries;
  }

  /** Return entries as a flat array. */
  getEntriesArray(): PostIndexEntry[] {
    return Object.values(this.index.entries);
  }

  /** Return the cached entry for a file, or undefined. */
  getEntry(filePath: string): PostIndexEntry | undefined {
    return this.index.entries[filePath];
  }

  /** Upsert an entry (called after parsing a file). */
  setEntry(entry: PostIndexEntry): void {
    this.index.entries[entry.filePath] = entry;
    this.scheduleSave();
  }

  /** Remove an entry (called on file delete). */
  removeEntry(filePath: string): void {
    if (this.index.entries[filePath]) {
      delete this.index.entries[filePath];
      this.scheduleSave();
    }
  }

  /** Rename a file path key (called on file rename). */
  renameEntry(oldPath: string, newPath: string): void {
    const entry = this.index.entries[oldPath];
    if (entry) {
      entry.filePath = newPath;
      delete this.index.entries[oldPath];
      this.index.entries[newPath] = entry;
      this.scheduleSave();
    }
  }

  /**
   * Determine which files need re-parsing.
   * Returns arrays of files to parse and stale paths to remove.
   */
  diffWithVault(
    vaultFiles: TFile[],
    archivePath: string
  ): { toParse: TFile[]; toRemove: string[] } {
    const toParse: TFile[] = [];
    const currentPaths = new Set<string>();

    for (const file of vaultFiles) {
      if (!file.path.startsWith(archivePath) || file.extension !== 'md') continue;
      currentPaths.add(file.path);

      const cached = this.index.entries[file.path];
      if (!cached || cached.fileModifiedTime !== file.stat.mtime) {
        toParse.push(file);
      }
    }

    // Find entries that no longer have a corresponding vault file
    const toRemove: string[] = [];
    for (const path of Object.keys(this.index.entries)) {
      if (!currentPaths.has(path)) {
        toRemove.push(path);
      }
    }

    return { toParse, toRemove };
  }

  /** Clear the entire index (for forced rebuild). */
  clear(): void {
    this.index.entries = {};
    this.scheduleSave();
  }

  /** Total number of indexed posts. */
  get size(): number {
    return Object.keys(this.index.entries).length;
  }

  // ---------------------------------------------------------------------------
  // Build PostIndexEntry from PostData (used by PostDataParser bridge)
  // ---------------------------------------------------------------------------

  /**
   * Build a PostIndexEntry from a parsed file.
   * This is the "projection" from heavy PostData → lightweight index entry.
   */
  static buildEntry(
    file: TFile,
    frontmatter: Record<string, unknown>,
    contentText: string,
    platform: Platform,
    metadata: {
      authorName: string;
      authorHandle?: string;
      title?: string;
      url: string;
      tags: string[];
      hashtags: string[];
      like: boolean;
      archive: boolean;
      subscribed: boolean;
      subscriptionId?: string;
      publishedDate?: Date;
      archivedDate?: Date;
      mediaCount: number;
      commentCount: number;
      likesCount?: number;
      commentsCount?: number;
      type?: 'post' | 'profile';
      comment?: string;
      shareUrl?: string;
      seriesId?: string;
      episodeNumber?: number;
      metadataTimestamp: Date;
    }
  ): PostIndexEntry {
    // Build searchText: join all searchable fields for fast search
    const searchParts = [
      metadata.authorName,
      metadata.authorHandle || '',
      contentText,
      metadata.comment || '',
      platform,
      metadata.title || '',
      ...metadata.tags,
      ...metadata.hashtags,
    ];
    const searchText = searchParts.join(' ').toLowerCase();

    return {
      id: file.basename,
      platform,
      filePath: file.path,
      fileModifiedTime: file.stat.mtime,
      authorName: metadata.authorName,
      authorHandle: metadata.authorHandle,
      publishedDate: metadata.publishedDate?.getTime(),
      archivedDate: metadata.archivedDate?.getTime(),
      tags: metadata.tags,
      hashtags: metadata.hashtags,
      like: metadata.like,
      archive: metadata.archive,
      subscribed: metadata.subscribed,
      subscriptionId: metadata.subscriptionId,
      searchText,
      seriesId: metadata.seriesId,
      episodeNumber: metadata.episodeNumber,
      title: metadata.title,
      url: metadata.url,
      mediaCount: metadata.mediaCount,
      commentCount: metadata.commentCount,
      likesCount: metadata.likesCount,
      commentsCount: metadata.commentsCount,
      type: metadata.type,
      comment: metadata.comment,
      shareUrl: metadata.shareUrl,
      metadataTimestamp: metadata.metadataTimestamp.getTime(),
    };
  }
}
