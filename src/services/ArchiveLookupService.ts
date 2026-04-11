/**
 * ArchiveLookupService
 *
 * Finds vault files by `sourceArchiveId` or `originalUrl` frontmatter
 * using Obsidian's MetadataCache. Maintains a lazy in-memory index that
 * is incrementally updated via MetadataCache `changed` events.
 *
 * Single Responsibility: Archive file lookup by stable identifiers
 */

import { type App, type CachedMetadata, type EventRef, type MetadataCache, TFile } from 'obsidian';
import type { ArchiveFileIdentity } from '../plugin/sync/ArchiveDeleteSyncService';
import type { IService } from './base/IService';

// ============================================================================
// URL Normalization
// ============================================================================

/**
 * Normalize a URL for comparison purposes.
 *
 * Rules (per PRD):
 * - Strip trailing slash when safe (trailing slash on path-only URLs is not significant)
 * - Preserve platform-significant path segments
 * - Do NOT blindly strip query/hash — only remove known tracking params
 *
 * This is intentionally conservative. False negatives (missed matches) are
 * safer than false positives (wrong file overwritten).
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove known tracking query parameters only
    const TRACKING_PARAMS = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
      'fbclid', 'gclid', 'igshid', 'ref_src', 'ref_url',
    ];
    for (const param of TRACKING_PARAMS) {
      parsed.searchParams.delete(param);
    }
    // Strip trailing slash from pathname only (not from hostname)
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;
    // Normalize to lowercase scheme + host, preserve case for path (platform-significant)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    // Not a valid URL — fall back to simple trailing-slash strip
    return url.endsWith('/') ? url.slice(0, -1) : url;
  }
}

// ============================================================================
// Index Types
// ============================================================================

interface ArchiveIndex {
  /** sourceArchiveId -> TFile (stable, 1:1 mapping) */
  bySourceArchiveId: Map<string, TFile>;
  /** normalized originalUrl -> TFile[] (may have multiple if re-archived) */
  byOriginalUrl: Map<string, TFile[]>;
  /** file path -> ArchiveFileIdentity (for delete sync / path fallback) */
  byPath: Map<string, ArchiveFileIdentity>;
  /** Set of file paths already in index (for tracking deletions/renames) */
  indexedPaths: Set<string>;
  built: boolean;
}

// ============================================================================
// ArchiveLookupService
// ============================================================================

/**
 * ArchiveLookupService
 *
 * Provides fast lookups of vault markdown files by:
 * - `sourceArchiveId` frontmatter field (stable server-side identifier)
 * - `originalUrl` frontmatter field (human-readable fallback, may be ambiguous)
 *
 * The index is built lazily on first lookup and kept up-to-date via the
 * MetadataCache `changed` event. Call `destroy()` before plugin unload to
 * unregister the event listener.
 */
export class ArchiveLookupService implements IService {
  private readonly app: App;
  private readonly index: ArchiveIndex = {
    bySourceArchiveId: new Map(),
    byOriginalUrl: new Map(),
    byPath: new Map(),
    indexedPaths: new Set(),
    built: false,
  };
  private changedEventRef: EventRef | null = null;
  private renameEventRef: EventRef | null = null;
  private deleteEventRef: EventRef | null = null;
  private resolvedEventRef: EventRef | null = null;
  private deleteHandlers: Set<(identity: ArchiveFileIdentity) => void> = new Set();

  constructor(app: App) {
    this.app = app;
  }

  // --------------------------------------------------------------------------
  // IService Lifecycle
  // --------------------------------------------------------------------------

  initialize(): void {
    // Build the index after MetadataCache has finished parsing all files.
    // At plugin load time, getFileCache() may return null because the cache
    // isn't populated yet. The `resolved` event fires once all pending
    // metadata parsing is complete — file deletions by the user can only
    // happen after the workspace is ready, which is well after `resolved`.
    if ((this.app.metadataCache as MetadataCache & { resolved?: boolean }).resolved) {
      this.ensureIndexBuilt();
    } else {
      this.resolvedEventRef = this.app.metadataCache.on('resolved', () => {
        this.ensureIndexBuilt();
        if (this.resolvedEventRef) {
          this.app.metadataCache.offref(this.resolvedEventRef);
          this.resolvedEventRef = null;
        }
      });
    }

    // Register MetadataCache `changed` listener for incremental index updates.
    this.changedEventRef = this.app.metadataCache.on(
      'changed',
      (file: TFile, _data: string, cache: CachedMetadata) => {
        // Only update index if it has already been built (lazy init)
        if (!this.index.built) return;
        this.updateIndexForFile(file, cache);
      }
    );

    // Track renames so byPath stays consistent (key = file.path)
    this.renameEventRef = this.app.vault.on('rename', (file, oldPath) => {
      if (!this.index.built) return;
      if (!(file instanceof TFile)) return;

      const identity = this.index.byPath.get(oldPath);
      if (identity) {
        this.index.byPath.delete(oldPath);
        identity.path = file.path;
        this.index.byPath.set(file.path, identity);

        // Update indexedPaths
        this.index.indexedPaths.delete(oldPath);
        this.index.indexedPaths.add(file.path);
      }
    });

    // Emit identity to subscribers BEFORE pruning the index on vault delete
    this.deleteEventRef = this.app.vault.on('delete', (file) => {
      if (!this.index.built) return;
      if (!(file instanceof TFile)) return;

      const identity = this.index.byPath.get(file.path);
      if (identity) {
        // Emit to subscribers BEFORE pruning the index
        for (const handler of this.deleteHandlers) {
          try {
            handler(identity);
          } catch (e) {
            console.error('[Social Archiver] [ArchiveLookup] Delete handler error', e);
          }
        }
        // Now prune the index
        this.removeFileFromIndex(file.path);
      }
    });
  }

  dispose(): void {
    this.destroy();
  }

  isHealthy(): boolean {
    return true;
  }

  /**
   * Unregister MetadataCache event listener.
   * Call this from plugin `onunload()` or when the service is no longer needed.
   */
  destroy(): void {
    if (this.changedEventRef !== null) {
      this.app.metadataCache.offref(this.changedEventRef);
      this.changedEventRef = null;
    }
    if (this.renameEventRef !== null) {
      this.app.vault.offref(this.renameEventRef);
      this.renameEventRef = null;
    }
    if (this.deleteEventRef !== null) {
      this.app.vault.offref(this.deleteEventRef);
      this.deleteEventRef = null;
    }
    if (this.resolvedEventRef !== null) {
      this.app.metadataCache.offref(this.resolvedEventRef);
      this.resolvedEventRef = null;
    }
    // Clear index memory
    this.index.bySourceArchiveId.clear();
    this.index.byOriginalUrl.clear();
    this.index.byPath.clear();
    this.index.indexedPaths.clear();
    this.index.built = false;
    this.deleteHandlers.clear();
  }

  // --------------------------------------------------------------------------
  // Public Lookup API
  // --------------------------------------------------------------------------

  /**
   * Find a vault file by `sourceArchiveId` frontmatter field.
   *
   * This is the primary (stable) lookup. Returns `null` when no match is found.
   *
   * Complexity: O(1) after index is built.
   */
  findBySourceArchiveId(archiveId: string): TFile | null {
    this.ensureIndexBuilt();
    return this.index.bySourceArchiveId.get(archiveId) ?? null;
  }

  /**
   * Find vault files by `originalUrl` frontmatter field.
   *
   * This is the fallback lookup. May return multiple files if the same URL
   * was archived more than once.
   *
   * Per PRD ambiguous-match policy: if multiple files are returned, the caller
   * (AnnotationSyncService) must NOT auto-update and should log a warning.
   *
   * Complexity: O(1) after index is built.
   */
  findByOriginalUrl(originalUrl: string): TFile[] {
    this.ensureIndexBuilt();
    const normalized = normalizeUrl(originalUrl);
    return this.index.byOriginalUrl.get(normalized) ?? [];
  }

  /**
   * Find vault file by `clientPostId` frontmatter field.
   *
   * This is a fallback lookup for composed posts during the race window where
   * sourceArchiveId hasn't been written yet. Uses a linear scan of MetadataCache
   * since clientPostId is not indexed — acceptable because this is only called
   * for archive_source='composed' posts (rare).
   *
   * Complexity: O(N) where N is vault file count — use sparingly.
   */
  findByClientPostId(clientPostId: string): TFile | null {
    if (!clientPostId) return null;
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache?.frontmatter?.clientPostId === clientPostId) {
        return file;
      }
    }
    return null;
  }

  /**
   * Write `sourceArchiveId` into a file's frontmatter.
   *
   * Used to backfill the stable identifier on first successful annotation sync,
   * so subsequent lookups can use the O(1) `findBySourceArchiveId` path.
   *
   * Uses Obsidian's `processFrontMatter` which handles YAML serialization
   * and avoids clobbering other frontmatter fields.
   */
  async backfillFileIdentity(file: TFile, archiveId: string): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      fm.sourceArchiveId = archiveId;
    });
    // Optimistically update the in-memory index (MetadataCache `changed` will
    // also fire, but the optimistic update ensures the lookup is immediately
    // consistent within the same call chain).
    if (this.index.built) {
      this.index.bySourceArchiveId.set(archiveId, file);
    }
  }

  /**
   * Immediately register a newly-saved file in the lookup index.
   *
   * Called after vault write so the same sync run can detect it as existing
   * on subsequent pages without waiting for MetadataCache to fire `changed`.
   * This is critical when processing 500 archives in one run: items saved on
   * page 1 must be discoverable by dedup checks on page 2.
   *
   * Works regardless of whether the index has been built yet — if the index
   * has not been built, the registration still ensures the file is available
   * immediately once the index is initialized via the regular lazy build.
   */
  indexSavedFile(file: TFile, data: { sourceArchiveId?: string; originalUrl?: string }): void {
    // Ensure the index is in a state where we can write into it.
    // If the index hasn't been built yet, build it first so that the maps are
    // populated and our new entry is consistent with the rest of the vault.
    this.ensureIndexBuilt();

    // Always track the file path
    this.index.indexedPaths.add(file.path);

    if (data.sourceArchiveId || data.originalUrl) {
      this.index.byPath.set(file.path, {
        path: file.path,
        archiveId: data.sourceArchiveId,
        originalUrl: data.originalUrl,
      });
    }

    // Register by sourceArchiveId (stable 1:1 mapping)
    if (data.sourceArchiveId && data.sourceArchiveId.length > 0) {
      this.index.bySourceArchiveId.set(data.sourceArchiveId, file);
    }

    // Register by normalized originalUrl (many-to-one mapping)
    if (data.originalUrl && data.originalUrl.length > 0) {
      const normalized = normalizeUrl(data.originalUrl);
      const existing = this.index.byOriginalUrl.get(normalized);
      if (existing) {
        // Avoid duplicate TFile references for the same path
        if (!existing.some((f) => f.path === file.path)) {
          existing.push(file);
        }
      } else {
        this.index.byOriginalUrl.set(normalized, [file]);
      }
    }
  }

  /**
   * Return the ArchiveFileIdentity for a vault file by its path.
   *
   * Files with either `sourceArchiveId` or `originalUrl` are tracked in the
   * `byPath` index. Returns `null` when the path is not indexed.
   *
   * Complexity: O(1) after index is built.
   */
  getIdentityByPath(filePath: string): ArchiveFileIdentity | null {
    this.ensureIndexBuilt();
    return this.index.byPath.get(filePath) ?? null;
  }

  /**
   * Subscribe to archive file deletion events.
   * The handler receives the ArchiveFileIdentity of the deleted file
   * BEFORE the index is pruned, so the archiveId is still available.
   *
   * @returns An unsubscribe function.
   */
  onArchivedFileDeleted(handler: (identity: ArchiveFileIdentity) => void): () => void {
    this.deleteHandlers.add(handler);
    return () => { this.deleteHandlers.delete(handler); };
  }

  // --------------------------------------------------------------------------
  // Index Management (Private)
  // --------------------------------------------------------------------------

  /**
   * Build the full index by scanning all markdown files via MetadataCache.
   * Called at most once (lazy init on first lookup).
   */
  private buildIndex(): void {
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      this.addFileToIndex(file, cache);
    }
    this.index.built = true;
  }

  /**
   * Ensure the index has been built.
   */
  private ensureIndexBuilt(): void {
    if (!this.index.built) {
      this.buildIndex();
    }
  }

  /**
   * Update the index for a single file when its metadata changes.
   * This is called from the MetadataCache `changed` event handler.
   */
  private updateIndexForFile(file: TFile, cache: CachedMetadata | null): void {
    // Remove any stale entries for this file path before re-adding
    this.removeFileFromIndex(file.path);
    this.addFileToIndex(file, cache);
  }

  /**
   * Add a single file's metadata to the index.
   */
  private addFileToIndex(file: TFile, cache: CachedMetadata | null | undefined): void {
    const fm = cache?.frontmatter;
    if (!fm) return;

    this.index.indexedPaths.add(file.path);

    // Index by sourceArchiveId (stable 1:1 mapping)
    const archiveId: unknown = fm.sourceArchiveId;
    const originalUrl: unknown = fm.originalUrl;
    if (
      (typeof archiveId === 'string' && archiveId.length > 0) ||
      (typeof originalUrl === 'string' && originalUrl.length > 0)
    ) {
      this.index.byPath.set(file.path, {
        path: file.path,
        archiveId: typeof archiveId === 'string' && archiveId.length > 0 ? archiveId : undefined,
        originalUrl: typeof originalUrl === 'string' ? originalUrl : undefined,
      });
    }

    if (typeof archiveId === 'string' && archiveId.length > 0) {
      this.index.bySourceArchiveId.set(archiveId, file);
    }

    // Index by normalised originalUrl (may be many-to-one)
    if (typeof originalUrl === 'string' && originalUrl.length > 0) {
      const normalized = normalizeUrl(originalUrl);
      const existing = this.index.byOriginalUrl.get(normalized);
      if (existing) {
        // Avoid duplicate TFile references for the same path
        if (!existing.some((f) => f.path === file.path)) {
          existing.push(file);
        }
      } else {
        this.index.byOriginalUrl.set(normalized, [file]);
      }
    }
  }

  /**
   * Remove all index entries for a given file path.
   * Must be called before re-indexing a file whose metadata has changed.
   */
  private removeFileFromIndex(filePath: string): void {
    if (!this.index.indexedPaths.has(filePath)) return;
    this.index.indexedPaths.delete(filePath);
    this.index.byPath.delete(filePath);

    // Remove from sourceArchiveId index
    for (const [archiveId, file] of this.index.bySourceArchiveId) {
      if (file.path === filePath) {
        this.index.bySourceArchiveId.delete(archiveId);
        break; // A file can only have one sourceArchiveId
      }
    }

    // Remove from originalUrl index
    for (const [url, files] of this.index.byOriginalUrl) {
      const filtered = files.filter((f) => f.path !== filePath);
      if (filtered.length === 0) {
        this.index.byOriginalUrl.delete(url);
      } else if (filtered.length !== files.length) {
        this.index.byOriginalUrl.set(url, filtered);
      }
    }
  }
}
