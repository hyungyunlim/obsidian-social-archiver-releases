/**
 * CacheManager - KV Store-based caching service
 */

import { createHash } from 'crypto';
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import {
  IKVStore,
  ICacheService,
  CacheEntry,
  CacheKey,
  CacheOptions,
  CacheStats,
  CacheConfig,
  CacheTTL,
  CacheInvalidationPattern,
  CacheEventType,
  CacheEvent,
  SerializedCacheEntry,
  CacheMetadata,
} from '../types/cache';
import { IService } from '../types/services';
import { Logger } from './Logger';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Default cache configuration
 */
const DEFAULT_CONFIG: CacheConfig = {
  defaultTTL: CacheTTL.STANDARD,
  enableCompression: true,
  compressionThreshold: 1024, // 1KB
  enableStaleWhileRevalidate: true,
  staleTTL: CacheTTL.SHORT,
  keyPrefix: 'social-archiver:cache:',
  version: '1.0.0',
};

/**
 * CacheManager service
 */
export class CacheManager implements IService, ICacheService {
  private kvStore: IKVStore;
  private config: CacheConfig;
  private logger?: Logger;
  private initialized = false;

  // Statistics tracking
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    writes: 0,
    deletes: 0,
    hitRate: 0,
    totalSize: 0,
    entryCount: 0,
    averageSize: 0,
    compressedEntries: 0,
    compressionRatio: 1,
  };

  // Event listeners
  private eventListeners: Map<CacheEventType, Set<(event: CacheEvent) => void>> = new Map();

  // Cache warming interval
  private warmingInterval?: NodeJS.Timeout;

  constructor(kvStore: IKVStore, config?: Partial<CacheConfig>, logger?: Logger) {
    this.kvStore = kvStore;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
  }

  /**
   * Initialize the cache manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger?.warn('CacheManager already initialized');
      return;
    }

    this.logger?.info('Initializing CacheManager', {
      config: {
        defaultTTL: this.config.defaultTTL,
        enableCompression: this.config.enableCompression,
        compressionThreshold: this.config.compressionThreshold,
        keyPrefix: this.config.keyPrefix,
        version: this.config.version,
      },
    });

    // Start cache warming if configured
    if (this.config.warming?.enabled) {
      await this.startWarming();
    }

    this.initialized = true;
    this.logger?.info('CacheManager initialized successfully');
  }

  /**
   * Shutdown the cache manager
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.logger?.info('Shutting down CacheManager');

    // Stop cache warming
    if (this.warmingInterval) {
      clearInterval(this.warmingInterval);
      this.warmingInterval = undefined;
    }

    // Clear event listeners
    this.eventListeners.clear();

    this.initialized = false;
    this.logger?.info('CacheManager shut down successfully');
  }

  /**
   * Get a cached entry
   */
  async get<T = unknown>(key: string, options: CacheOptions = {}): Promise<T | null> {
    this.ensureInitialized();

    if (options.bypassCache) {
      this.logger?.debug('Cache bypassed', { key });
      return null;
    }

    const cacheKey = this.buildCacheKey(key);
    this.logger?.debug('Cache get', { key, cacheKey });

    try {
      const serialized = await this.kvStore.get(cacheKey);

      if (!serialized) {
        this.recordMiss(key);
        return null;
      }

      const entry = await this.deserializeEntry<T>(serialized);

      // Check if entry is expired
      if (this.isExpired(entry)) {
        this.logger?.debug('Cache entry expired', { key, expiresAt: entry.metadata.expiresAt });

        // Handle stale-while-revalidate
        if (
          (options.staleWhileRevalidate ?? this.config.enableStaleWhileRevalidate) &&
          this.canServeStale(entry)
        ) {
          this.logger?.debug('Serving stale entry while revalidating', { key });
          this.recordHit(key, entry);
          this.emitEvent({ type: CacheEventType.HIT, key: cacheKey, timestamp: Date.now() });
          return entry.data;
        }

        // Delete expired entry
        await this.delete(key);
        this.recordMiss(key);
        return null;
      }

      // Update hit count
      entry.metadata.hits++;
      await this.updateMetadata(cacheKey, entry.metadata);

      this.recordHit(key, entry);
      this.emitEvent({ type: CacheEventType.HIT, key: cacheKey, timestamp: Date.now() });

      return entry.data;
    } catch (error) {
      this.logger?.error('Cache get error', error instanceof Error ? error : undefined, { key });
      this.recordMiss(key);
      return null;
    }
  }

  /**
   * Set a cache entry
   */
  async set<T = unknown>(key: string, value: T, options: CacheOptions = {}): Promise<void> {
    this.ensureInitialized();

    const cacheKey = this.buildCacheKey(key);
    this.logger?.debug('Cache set', { key, cacheKey, options });

    try {
      const ttl = options.ttl ?? this.config.defaultTTL;
      const now = Date.now();

      // Serialize data
      const dataString = JSON.stringify(value);

      // Handle undefined or other non-serializable values
      if (dataString === undefined) {
        this.logger?.warn('Cannot cache undefined value', { key });
        return;
      }

      const dataBuffer = Buffer.from(dataString, 'utf-8');
      const originalSize = dataBuffer.length;

      // Compress if enabled and above threshold
      const shouldCompress =
        (options.compress ?? this.config.enableCompression) &&
        originalSize >= (options.compressionThreshold ?? this.config.compressionThreshold);

      let finalData: string;
      let compressed = false;
      let finalSize = originalSize;

      if (shouldCompress) {
        try {
          const compressedBuffer = await gzipAsync(dataBuffer);
          finalData = compressedBuffer.toString('base64');
          finalSize = compressedBuffer.length;
          compressed = true;
          this.logger?.debug('Data compressed', {
            key,
            originalSize,
            compressedSize: finalSize,
            ratio: originalSize / finalSize,
          });
        } catch (error) {
          this.logger?.warn('Compression failed, storing uncompressed', { key, error });
          finalData = dataString;
        }
      } else {
        finalData = dataString;
      }

      const metadata: CacheMetadata = {
        createdAt: now,
        expiresAt: now + ttl * 1000,
        hits: 0,
        size: finalSize,
        etag: options.etag,
        lastModified: options.lastModified,
        compressed,
        platform: options.platform,
        version: this.config.version,
      };

      const entry: SerializedCacheEntry = {
        data: finalData,
        metadata,
      };

      // Store in KV
      const serialized = JSON.stringify(entry);
      await this.kvStore.put(cacheKey, serialized, { expirationTtl: ttl });

      // Update statistics
      this.recordWrite(key, finalSize, compressed, originalSize);
      this.emitEvent({
        type: CacheEventType.WRITE,
        key: cacheKey,
        timestamp: now,
        metadata: { size: finalSize, compressed },
      });

      this.logger?.debug('Cache entry stored', { key, cacheKey, ttl, size: finalSize, compressed });
    } catch (error) {
      this.logger?.error('Cache set error', error instanceof Error ? error : undefined, { key });
      throw error;
    }
  }

  /**
   * Delete a cache entry
   */
  async delete(key: string): Promise<void> {
    this.ensureInitialized();

    const cacheKey = this.buildCacheKey(key);
    this.logger?.debug('Cache delete', { key, cacheKey });

    try {
      await this.kvStore.delete(cacheKey);
      this.recordDelete(key);
      this.emitEvent({ type: CacheEventType.DELETE, key: cacheKey, timestamp: Date.now() });
      this.logger?.debug('Cache entry deleted', { key, cacheKey });
    } catch (error) {
      this.logger?.error('Cache delete error', error instanceof Error ? error : undefined, { key });
      throw error;
    }
  }

  /**
   * Check if a key exists in cache
   */
  async has(key: string): Promise<boolean> {
    this.ensureInitialized();

    const cacheKey = this.buildCacheKey(key);
    try {
      const value = await this.kvStore.get(cacheKey);
      return value !== null;
    } catch (error) {
      this.logger?.error('Cache has error', error instanceof Error ? error : undefined, { key });
      return false;
    }
  }

  /**
   * Generate a cache key from URL and options
   */
  generateKey(url: string, options: Record<string, unknown> = {}): CacheKey {
    // Sort options keys for consistent hashing
    const sortedOptions = Object.keys(options)
      .sort()
      .reduce((acc, key) => {
        acc[key] = options[key];
        return acc;
      }, {} as Record<string, unknown>);

    const paramsString = JSON.stringify(sortedOptions);
    const paramsHash = this.hash(paramsString);
    const urlHash = this.hash(url);
    const combinedHash = this.hash(`${urlHash}:${paramsHash}`);

    return {
      url,
      hash: combinedHash,
      platform: options.platform as string | undefined,
      paramsHash,
    };
  }

  /**
   * Invalidate cache entries matching a pattern
   */
  async invalidate(pattern: CacheInvalidationPattern): Promise<number> {
    this.ensureInitialized();

    this.logger?.info('Invalidating cache entries', { pattern });

    try {
      let invalidated = 0;
      const prefix = this.config.keyPrefix;

      // List all keys with prefix
      const result = await this.kvStore.list({ prefix, limit: 1000 });

      for (const item of result.keys) {
        const key = item.name;
        const shouldInvalidate = this.matchesPattern(key, pattern);

        if (shouldInvalidate) {
          await this.kvStore.delete(key);
          invalidated++;
          this.emitEvent({ type: CacheEventType.INVALIDATE, key, timestamp: Date.now() });
        }
      }

      this.logger?.info('Cache invalidation complete', { pattern, invalidated });
      return invalidated;
    } catch (error) {
      this.logger?.error('Cache invalidation error', error instanceof Error ? error : undefined, { pattern });
      throw error;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? this.stats.hits / totalRequests : 0;
    const averageSize = this.stats.entryCount > 0 ? this.stats.totalSize / this.stats.entryCount : 0;

    return {
      ...this.stats,
      hitRate,
      averageSize,
    };
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.logger?.info('Resetting cache statistics');
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      writes: 0,
      deletes: 0,
      hitRate: 0,
      totalSize: 0,
      entryCount: 0,
      averageSize: 0,
      compressedEntries: 0,
      compressionRatio: 1,
    };
  }

  /**
   * Warm cache with predefined URLs
   */
  async warm(urls: string[]): Promise<void> {
    this.ensureInitialized();

    this.logger?.info('Warming cache', { urlCount: urls.length });

    // This is a placeholder - actual implementation would need
    // to fetch data from the source and populate the cache
    for (const url of urls) {
      this.logger?.debug('Warming cache for URL', { url });
      // Implementation would call the actual data fetching service
      // and populate the cache using set()
    }

    this.logger?.info('Cache warming complete');
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    this.ensureInitialized();

    this.logger?.info('Clearing all cache entries');

    try {
      const prefix = this.config.keyPrefix;
      const result = await this.kvStore.list({ prefix, limit: 1000 });

      for (const item of result.keys) {
        await this.kvStore.delete(item.name);
      }

      this.resetStats();
      this.logger?.info('Cache cleared successfully');
    } catch (error) {
      this.logger?.error('Cache clear error', error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Add event listener
   */
  on(eventType: CacheEventType, listener: (event: CacheEvent) => void): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(listener);
  }

  /**
   * Remove event listener
   */
  off(eventType: CacheEventType, listener: (event: CacheEvent) => void): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  // Private helper methods

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('CacheManager not initialized. Call initialize() first.');
    }
  }

  private buildCacheKey(key: string): string {
    return `${this.config.keyPrefix}${key}`;
  }

  private hash(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }

  private async deserializeEntry<T>(serialized: string): Promise<CacheEntry<T>> {
    const entry: SerializedCacheEntry = JSON.parse(serialized);

    let data: T;

    if (entry.metadata.compressed) {
      // Decompress data
      try {
        const compressedBuffer = Buffer.from(entry.data, 'base64');
        const decompressedBuffer = await gunzipAsync(compressedBuffer);
        const decompressedString = decompressedBuffer.toString('utf-8');
        data = JSON.parse(decompressedString);
      } catch (error) {
        this.logger?.error('Decompression error', error instanceof Error ? error : undefined);
        throw new Error('Failed to decompress cache entry');
      }
    } else {
      data = JSON.parse(entry.data);
    }

    return {
      data,
      metadata: entry.metadata,
    };
  }

  private async updateMetadata(cacheKey: string, metadata: CacheMetadata): Promise<void> {
    try {
      const serialized = await this.kvStore.get(cacheKey);
      if (serialized) {
        const entry: SerializedCacheEntry = JSON.parse(serialized);
        entry.metadata = metadata;
        const ttl = Math.ceil((metadata.expiresAt - Date.now()) / 1000);
        await this.kvStore.put(cacheKey, JSON.stringify(entry), { expirationTtl: ttl });
      }
    } catch (error) {
      this.logger?.error('Error updating metadata', error instanceof Error ? error : undefined, { cacheKey });
    }
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() > entry.metadata.expiresAt;
  }

  private canServeStale(entry: CacheEntry): boolean {
    // Entry is expired but within stale grace period
    const staleTime = entry.metadata.expiresAt + this.config.staleTTL * 1000;
    return Date.now() <= staleTime;
  }

  private matchesPattern(key: string, pattern: CacheInvalidationPattern): boolean {
    const cleanKey = key.replace(this.config.keyPrefix, '');

    switch (pattern.type) {
      case 'exact':
        return cleanKey === pattern.pattern;
      case 'prefix':
        return cleanKey.startsWith(pattern.pattern);
      case 'suffix':
        return cleanKey.endsWith(pattern.pattern);
      case 'regex':
        return new RegExp(pattern.pattern).test(cleanKey);
      case 'tag':
        // Tags would need to be stored in metadata
        return false;
      default:
        return false;
    }
  }

  private recordHit(key: string, entry: CacheEntry): void {
    this.stats.hits++;
    this.logger?.debug('Cache hit', { key, hits: entry.metadata.hits });
  }

  private recordMiss(key: string): void {
    this.stats.misses++;
    this.logger?.debug('Cache miss', { key });
  }

  private recordWrite(key: string, size: number, compressed: boolean, originalSize: number): void {
    this.stats.writes++;
    this.stats.entryCount++;
    this.stats.totalSize += size;

    if (compressed) {
      this.stats.compressedEntries++;
      const ratio = originalSize / size;
      this.stats.compressionRatio =
        (this.stats.compressionRatio * (this.stats.compressedEntries - 1) + ratio) /
        this.stats.compressedEntries;
    }

    this.logger?.debug('Cache write recorded', { key, size, compressed });
  }

  private recordDelete(key: string): void {
    this.stats.deletes++;
    if (this.stats.entryCount > 0) {
      this.stats.entryCount--;
    }
    this.logger?.debug('Cache delete recorded', { key });
  }

  private emitEvent(event: CacheEvent): void {
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(event);
        } catch (error) {
          this.logger?.error('Event listener error', error instanceof Error ? error : undefined, { eventType: event.type });
        }
      });
    }
  }

  private async startWarming(): Promise<void> {
    if (!this.config.warming?.enabled) {
      return;
    }

    this.logger?.info('Starting cache warming', {
      interval: this.config.warming.interval,
      urlCount: this.config.warming.urls.length,
    });

    // Warm immediately
    await this.warm(this.config.warming.urls);

    // Set up interval for continuous warming
    this.warmingInterval = setInterval(async () => {
      await this.warm(this.config.warming!.urls);
    }, this.config.warming.interval);
  }
}
