/**
 * MediaPreviewService — bounded LRU cache of object URLs for in-viewport
 * media previews in the Import Review Gallery.
 *
 * Background
 * ----------
 * The gallery renders many ZIP-extracted media items (images / videos) at
 * once. Each preview needs a `blob:` URL the browser can render. Naively
 * calling {@link URL.createObjectURL} for every render leaks URLs because
 * the browser holds them alive until the page unloads. This service:
 *
 *   1. Materialises a single `blob:` URL per (jobId, zipKey, relPath) tuple.
 *   2. Reference-counts callers via `acquire` / `release` so multiple cards
 *      pointing at the same media share one URL.
 *   3. Keeps recently-used entries hot, evicts only unpinned entries (i.e.
 *      `retainCount === 0`), and calls {@link URL.revokeObjectURL} exactly
 *      once when an entry is dropped.
 *
 * Design constraints (PRD §0)
 * ---------------------------
 * - Platform-agnostic: knows nothing about Instagram, PostData, or ZIP
 *   parsing. Callers (e.g. ZipPostDataAdapter) must hand in the raw bytes.
 * - No third-party deps; uses only the standard `URL` API.
 *
 * Cache key contract
 * ------------------
 * Entries are keyed by the composite tuple `(jobId, zipKey, relativePath)`.
 *
 *   - `jobId`        — the import job that owns the entry; used by
 *                      {@link clearForJob} to bulk-release.
 *   - `zipKey`       — a stable identifier for the source ZIP (e.g. the
 *                      file name plus size, or a content hash). The caller
 *                      is responsible for choosing this consistently — two
 *                      callers that key the same ZIP differently will get
 *                      independent cache entries.
 *   - `relativePath` — the path inside the ZIP, e.g. `media/posts/abc.jpg`.
 *
 * Concurrency
 * -----------
 * The service is fully synchronous; the `Promise<string>` return on
 * {@link acquire} exists only as a forward-compat shim in case a future
 * version adds async dedup (e.g. coalescing concurrent decode work). In v1
 * the promise resolves on the same microtask.
 */

/**
 * Bound chosen for the typical Import Review Gallery viewport: ~10 cards
 * × ~5 media each, plus comfortable headroom for scroll buffer (PRD §7.2).
 */
const DEFAULT_CAPACITY = 150;

/**
 * NUL byte separates key parts. Real ZIP paths cannot contain NUL bytes,
 * so the joined string is unambiguous.
 */
const KEY_SEP = '\u0000';

interface CacheEntry {
  jobId: string;
  zipKey: string;
  relativePath: string;
  blob: Blob;
  objectUrl: string;
  retainCount: number;
  lastAccessedAt: number;
}

export interface MediaPreviewServiceStats {
  /** Number of entries currently held in the cache. */
  size: number;
  /** Capacity ceiling beyond which eviction runs. */
  capacity: number;
  /** Entries with `retainCount > 0` (pinned, not eligible for eviction). */
  pinnedCount: number;
}

export interface MediaPreviewServiceOptions {
  /**
   * Maximum number of entries kept in the cache. Defaults to
   * {@link DEFAULT_CAPACITY}. Callers can shrink this for tests.
   */
  capacity?: number;
}

export class MediaPreviewService {
  private readonly capacity: number;
  /**
   * Composite-key → entry map. We use a plain `Map` (insertion-order is
   * fine for iteration) and rely on `lastAccessedAt` rather than insertion
   * order for LRU decisions.
   */
  private readonly cache = new Map<string, CacheEntry>();
  /** Monotonic counter so two acquires in the same tick still order. */
  private accessClock = 0;

  constructor(options: MediaPreviewServiceOptions = {}) {
    const cap = options.capacity ?? DEFAULT_CAPACITY;
    if (!Number.isFinite(cap) || cap <= 0) {
      throw new Error(
        `MediaPreviewService: capacity must be a positive finite number, got ${cap}`,
      );
    }
    this.capacity = Math.floor(cap);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Acquire a `blob:` URL for the given (jobId, zipKey, relativePath) tuple.
   *
   * If an entry already exists, increments its retain count and returns the
   * existing URL. Otherwise creates a new entry from the supplied `blob`.
   *
   * The caller MUST pair every `acquire` with a matching {@link release}
   * (or {@link clearForJob}) — otherwise the entry becomes a permanent
   * pin and will never be evicted.
   *
   * @param jobId         Import job that owns the entry.
   * @param zipKey        Stable identifier for the source ZIP. See class-level
   *                      contract — inconsistent keys will fragment the cache.
   * @param relativePath  Path within the ZIP.
   * @param blob          Bytes for the media. Ignored on cache hit; the
   *                      original blob is reused. Only consulted on cache miss.
   */
  async acquire(
    jobId: string,
    zipKey: string,
    relativePath: string,
    blob: Blob,
  ): Promise<string> {
    const key = this.makeKey(jobId, zipKey, relativePath);
    const existing = this.cache.get(key);
    if (existing) {
      existing.retainCount += 1;
      existing.lastAccessedAt = ++this.accessClock;
      return existing.objectUrl;
    }
    const entry: CacheEntry = {
      jobId,
      zipKey,
      relativePath,
      blob,
      objectUrl: URL.createObjectURL(blob),
      retainCount: 1,
      lastAccessedAt: ++this.accessClock,
    };
    this.cache.set(key, entry);
    this.evictIfOverCapacity();
    return entry.objectUrl;
  }

  /**
   * Release one retain on the given (jobId, zipKey, relativePath) entry.
   *
   * This does NOT revoke the URL — entries linger in the cache and serve
   * future acquires for free. Actual revocation happens during eviction
   * (capacity overrun) or {@link clearForJob}.
   *
   * Releasing an unknown key or an already-zero entry is a no-op (we are
   * defensive here so a stray `$effect` cleanup cannot crash the UI).
   */
  release(jobId: string, zipKey: string, relativePath: string): void {
    const key = this.makeKey(jobId, zipKey, relativePath);
    const entry = this.cache.get(key);
    if (!entry) return;
    if (entry.retainCount > 0) {
      entry.retainCount -= 1;
    }
  }

  /**
   * Drop every entry that belongs to `jobId`.
   *
   * All matching entries have their retain counts zeroed and their object
   * URLs revoked exactly once. This is intended for cleanup when an import
   * job is finished or abandoned.
   *
   * Pinned entries (retainCount > 0) are also dropped — the job is gone, so
   * any UI still holding a reference is operating on stale state and will
   * see broken `blob:` URLs (browsers return 404 for revoked URLs). Keeping
   * them alive would leak; revoking is the safer default.
   */
  clearForJob(jobId: string): void {
    const toDelete: string[] = [];
    for (const [key, entry] of this.cache) {
      if (entry.jobId !== jobId) continue;
      URL.revokeObjectURL(entry.objectUrl);
      toDelete.push(key);
    }
    for (const key of toDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * Snapshot of current cache state. Intended primarily for tests and
   * debugging panels.
   */
  getStats(): MediaPreviewServiceStats {
    let pinned = 0;
    for (const entry of this.cache.values()) {
      if (entry.retainCount > 0) pinned += 1;
    }
    return {
      size: this.cache.size,
      capacity: this.capacity,
      pinnedCount: pinned,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private makeKey(jobId: string, zipKey: string, relativePath: string): string {
    return `${jobId}${KEY_SEP}${zipKey}${KEY_SEP}${relativePath}`;
  }

  /**
   * Evict unpinned (`retainCount === 0`) entries in LRU order until the
   * cache size is back within `capacity`. Pinned entries are skipped — if
   * the entire cache is pinned (degenerate case), the cache simply grows
   * past the soft cap until pins release.
   */
  private evictIfOverCapacity(): void {
    if (this.cache.size <= this.capacity) return;

    // Collect unpinned entries sorted by oldest access first.
    const candidates: { key: string; entry: CacheEntry }[] = [];
    for (const [key, entry] of this.cache) {
      if (entry.retainCount === 0) {
        candidates.push({ key, entry });
      }
    }
    candidates.sort((a, b) => a.entry.lastAccessedAt - b.entry.lastAccessedAt);

    for (const { key, entry } of candidates) {
      if (this.cache.size <= this.capacity) break;
      URL.revokeObjectURL(entry.objectUrl);
      this.cache.delete(key);
    }
  }
}
