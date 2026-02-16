/**
 * Cache-related types and interfaces for KV Store integration
 */

/**
 * Time-to-live options for cached entries
 */
export enum CacheTTL {
  /** 5 minutes - for frequently changing content */
  SHORT = 5 * 60,
  /** 1 hour - for moderately dynamic content */
  MEDIUM = 60 * 60,
  /** 24 hours - for successful responses (default) */
  STANDARD = 24 * 60 * 60,
  /** 48 hours - for permanent content (images, videos) */
  LONG = 48 * 60 * 60,
  /** 7 days - for static content */
  EXTENDED = 7 * 24 * 60 * 60,
}

/**
 * Cache entry metadata
 */
export interface CacheMetadata {
  /** Timestamp when the entry was created */
  createdAt: number;
  /** Timestamp when the entry expires */
  expiresAt: number;
  /** Number of times this entry has been accessed */
  hits: number;
  /** Size of the cached data in bytes */
  size: number;
  /** ETtag for cache validation */
  etag?: string;
  /** Last modified timestamp from source */
  lastModified?: number;
  /** Whether the data is compressed */
  compressed: boolean;
  /** Platform that generated this cache entry */
  platform?: string;
  /** Version of the cache schema */
  version: string;
}

/**
 * Cached entry structure
 */
export interface CacheEntry<T = unknown> {
  /** Cached data */
  data: T;
  /** Entry metadata */
  metadata: CacheMetadata;
}

/**
 * Serialized cache entry for KV storage
 */
export interface SerializedCacheEntry {
  /** Base64-encoded (possibly compressed) data */
  data: string;
  /** Entry metadata */
  metadata: CacheMetadata;
}

/**
 * Options for cache operations
 */
export interface CacheOptions {
  /** Time-to-live in seconds (overrides TTL enum) */
  ttl?: number;
  /** Whether to compress the data before caching */
  compress?: boolean;
  /** Minimum size in bytes for compression to be applied */
  compressionThreshold?: number;
  /** Whether to bypass cache and force refresh */
  bypassCache?: boolean;
  /** Whether to use stale-while-revalidate pattern */
  staleWhileRevalidate?: boolean;
  /** Grace period for stale entries (seconds) */
  staleTTL?: number;
  /** Custom ETag for cache validation */
  etag?: string;
  /** Last modified timestamp for cache validation */
  lastModified?: number;
  /** Platform identifier for cache key generation */
  platform?: string;
  /** Additional tags for cache organization */
  tags?: string[];
}

/**
 * Cache key structure
 */
export interface CacheKey {
  /** Original URL or identifier */
  url: string;
  /** Hash of the URL and options */
  hash: string;
  /** Platform identifier */
  platform?: string;
  /** Additional parameters hash */
  paramsHash?: string;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Total number of cache hits */
  hits: number;
  /** Total number of cache misses */
  misses: number;
  /** Total number of cache evictions */
  evictions: number;
  /** Total number of cache writes */
  writes: number;
  /** Total number of cache deletes */
  deletes: number;
  /** Cache hit rate (0-1) */
  hitRate: number;
  /** Total size of cached data in bytes */
  totalSize: number;
  /** Number of entries in cache */
  entryCount: number;
  /** Average entry size in bytes */
  averageSize: number;
  /** Number of compressed entries */
  compressedEntries: number;
  /** Compression ratio (original size / compressed size) */
  compressionRatio: number;
}

/**
 * Cache warming configuration
 */
export interface CacheWarmingConfig {
  /** Whether cache warming is enabled */
  enabled: boolean;
  /** URLs to pre-warm */
  urls: string[];
  /** Interval for warming in milliseconds */
  interval: number;
  /** Maximum concurrent warming requests */
  concurrency: number;
}

/**
 * Cache invalidation pattern
 */
export interface CacheInvalidationPattern {
  /** Pattern type */
  type: 'prefix' | 'suffix' | 'regex' | 'exact' | 'tag';
  /** Pattern value */
  pattern: string;
  /** Maximum age for selective invalidation */
  maxAge?: number;
}

/**
 * Cache event types
 */
export enum CacheEventType {
  HIT = 'hit',
  MISS = 'miss',
  WRITE = 'write',
  DELETE = 'delete',
  EVICT = 'evict',
  EXPIRE = 'expire',
  INVALIDATE = 'invalidate',
}

/**
 * Cache event
 */
export interface CacheEvent {
  /** Event type */
  type: CacheEventType;
  /** Cache key */
  key: string;
  /** Timestamp */
  timestamp: number;
  /** Event metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Cache migration strategy
 */
export interface CacheMigration {
  /** Source version */
  from: string;
  /** Target version */
  to: string;
  /** Migration function */
  migrate: (entry: SerializedCacheEntry) => SerializedCacheEntry | null;
  /** Whether to delete entries that fail migration */
  deleteOnFailure?: boolean;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  /** Default TTL in seconds */
  defaultTTL: CacheTTL | number;
  /** Whether to enable compression */
  enableCompression: boolean;
  /** Minimum size for compression in bytes */
  compressionThreshold: number;
  /** Maximum cache size in bytes */
  maxSize?: number;
  /** Maximum number of entries */
  maxEntries?: number;
  /** Whether to enable stale-while-revalidate */
  enableStaleWhileRevalidate: boolean;
  /** Grace period for stale entries in seconds */
  staleTTL: number;
  /** Cache warming configuration */
  warming?: CacheWarmingConfig;
  /** Cache key prefix */
  keyPrefix: string;
  /** Current cache schema version */
  version: string;
  /** Available migrations */
  migrations?: CacheMigration[];
}

/**
 * KV Store interface (abstraction for different KV implementations)
 */
export interface IKVStore {
  /**
   * Get a value from the KV store
   */
  get(key: string): Promise<string | null>;

  /**
   * Set a value in the KV store
   */
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;

  /**
   * Delete a value from the KV store
   */
  delete(key: string): Promise<void>;

  /**
   * List keys matching a prefix
   */
  list(options?: { prefix?: string; limit?: number }): Promise<{ keys: Array<{ name: string }> }>;
}

/**
 * Cache service interface
 */
export interface ICacheService {
  /**
   * Get a cached entry
   */
  get<T = unknown>(key: string, options?: CacheOptions): Promise<T | null>;

  /**
   * Set a cache entry
   */
  set<T = unknown>(key: string, value: T, options?: CacheOptions): Promise<void>;

  /**
   * Delete a cache entry
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a key exists in cache
   */
  has(key: string): Promise<boolean>;

  /**
   * Generate a cache key from URL and options
   */
  generateKey(url: string, options?: Record<string, unknown>): CacheKey;

  /**
   * Invalidate cache entries matching a pattern
   */
  invalidate(pattern: CacheInvalidationPattern): Promise<number>;

  /**
   * Get cache statistics
   */
  getStats(): CacheStats;

  /**
   * Reset cache statistics
   */
  resetStats(): void;

  /**
   * Warm cache with predefined URLs
   */
  warm(urls: string[]): Promise<void>;

  /**
   * Clear all cache entries
   */
  clear(): Promise<void>;
}
