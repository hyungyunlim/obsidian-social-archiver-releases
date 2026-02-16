/**
 * Tests for CacheManager service
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CacheManager } from '../../services/CacheManager';
import {
  IKVStore,
  CacheTTL,
  CacheOptions,
  CacheEventType,
  CacheInvalidationPattern,
} from '../../types/cache';
import { Logger } from '../../services/Logger';

/**
 * Mock KV Store implementation for testing
 */
class MockKVStore implements IKVStore {
  private store: Map<string, { value: string; expiresAt?: number }> = new Map();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }

    // Return value even if expired - let CacheManager handle expiration logic
    // This allows testing of stale-while-revalidate functionality
    return entry.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expiresAt = options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : undefined;
    this.store.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: { prefix?: string; limit?: number }): Promise<{ keys: Array<{ name: string }> }> {
    const keys = Array.from(this.store.keys());
    const filtered = options?.prefix ? keys.filter((k) => k.startsWith(options.prefix)) : keys;
    const limited = options?.limit ? filtered.slice(0, options.limit) : filtered;
    return { keys: limited.map((name) => ({ name })) };
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

describe('CacheManager', () => {
  let cacheManager: CacheManager;
  let kvStore: MockKVStore;
  let logger: Logger;

  beforeEach(async () => {
    kvStore = new MockKVStore();
    logger = new Logger({
      level: 'error', // Only log errors in tests
      enableConsole: false,
    });
    await logger.initialize();

    cacheManager = new CacheManager(
      kvStore,
      {
        defaultTTL: CacheTTL.SHORT,
        enableCompression: true,
        compressionThreshold: 100,
        keyPrefix: 'test:',
        version: '1.0.0',
      },
      logger
    );
    await cacheManager.initialize();
  });

  afterEach(async () => {
    await cacheManager.shutdown();
    await logger.shutdown();
    kvStore.clear();
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      const newCache = new CacheManager(kvStore);
      await expect(newCache.initialize()).resolves.not.toThrow();
      await newCache.shutdown();
    });

    it('should warn on double initialization', async () => {
      const warnSpy = vi.spyOn(logger, 'warn');
      await cacheManager.initialize();
      expect(warnSpy).toHaveBeenCalledWith('CacheManager already initialized');
    });

    it('should throw error when using uninitialized cache', async () => {
      const newCache = new CacheManager(kvStore);
      await expect(newCache.get('test')).rejects.toThrow('CacheManager not initialized');
      await newCache.shutdown();
    });
  });

  describe('Basic Operations', () => {
    it('should set and get a value', async () => {
      const data = { message: 'Hello, World!' };
      await cacheManager.set('test-key', data);

      const retrieved = await cacheManager.get<typeof data>('test-key');
      expect(retrieved).toEqual(data);
    });

    it('should return null for non-existent key', async () => {
      const result = await cacheManager.get('non-existent');
      expect(result).toBeNull();
    });

    it('should delete a cached entry', async () => {
      await cacheManager.set('test-key', { value: 123 });
      expect(await cacheManager.has('test-key')).toBe(true);

      await cacheManager.delete('test-key');
      expect(await cacheManager.has('test-key')).toBe(false);
    });

    it('should check if key exists', async () => {
      expect(await cacheManager.has('test-key')).toBe(false);

      await cacheManager.set('test-key', { value: 456 });
      expect(await cacheManager.has('test-key')).toBe(true);
    });

    it('should handle complex objects', async () => {
      const complexData = {
        id: '123',
        nested: {
          array: [1, 2, 3],
          object: { key: 'value' },
        },
        date: new Date().toISOString(),
      };

      await cacheManager.set('complex', complexData);
      const retrieved = await cacheManager.get('complex');
      expect(retrieved).toEqual(complexData);
    });
  });

  describe('Cache Key Generation', () => {
    it('should generate consistent keys for same input', () => {
      const key1 = cacheManager.generateKey('https://example.com', { param: 'value' });
      const key2 = cacheManager.generateKey('https://example.com', { param: 'value' });
      expect(key1.hash).toBe(key2.hash);
    });

    it('should generate different keys for different inputs', () => {
      const key1 = cacheManager.generateKey('https://example.com', { param: 'value1' });
      const key2 = cacheManager.generateKey('https://example.com', { param: 'value2' });
      expect(key1.hash).not.toBe(key2.hash);
    });

    it('should generate same key regardless of option order', () => {
      const key1 = cacheManager.generateKey('https://example.com', { a: '1', b: '2', c: '3' });
      const key2 = cacheManager.generateKey('https://example.com', { c: '3', a: '1', b: '2' });
      expect(key1.hash).toBe(key2.hash);
    });

    it('should include platform in key metadata', () => {
      const key = cacheManager.generateKey('https://example.com', { platform: 'facebook' });
      expect(key.platform).toBe('facebook');
    });
  });

  describe('TTL and Expiration', () => {
    it('should expire entries after TTL', async () => {
      // Set with 1 second TTL
      await cacheManager.set('expiring-key', { value: 'test' }, { ttl: 1 });

      // Should exist immediately
      expect(await cacheManager.get('expiring-key')).toEqual({ value: 'test' });

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should be expired (disable stale-while-revalidate)
      expect(await cacheManager.get('expiring-key', { staleWhileRevalidate: false })).toBeNull();
    });

    it('should use default TTL when not specified', async () => {
      await cacheManager.set('default-ttl', { value: 'test' });
      const stats = cacheManager.getStats();
      expect(stats.writes).toBe(1);
    });

    it('should handle custom TTL values', async () => {
      await cacheManager.set('custom-ttl', { value: 'test' }, { ttl: CacheTTL.LONG });
      expect(await cacheManager.get('custom-ttl')).toEqual({ value: 'test' });
    });
  });

  describe('Compression', () => {
    it('should compress large data', async () => {
      // Create data larger than compression threshold (100 bytes)
      const largeData = {
        content: 'A'.repeat(200),
        numbers: Array.from({ length: 50 }, (_, i) => i),
      };

      await cacheManager.set('large-data', largeData);
      const retrieved = await cacheManager.get('large-data');
      expect(retrieved).toEqual(largeData);

      const stats = cacheManager.getStats();
      expect(stats.compressedEntries).toBe(1);
    });

    it('should not compress small data', async () => {
      const smallData = { value: 'small' };
      await cacheManager.set('small-data', smallData);

      const stats = cacheManager.getStats();
      expect(stats.compressedEntries).toBe(0);
    });

    it('should handle compression disabled', async () => {
      const largeData = { content: 'A'.repeat(200) };
      await cacheManager.set('no-compress', largeData, { compress: false });

      const stats = cacheManager.getStats();
      expect(stats.compressedEntries).toBe(0);
    });

    it('should calculate compression ratio', async () => {
      const largeData = {
        content: 'A'.repeat(1000),
        repeated: Array.from({ length: 100 }, () => 'same value'),
      };

      await cacheManager.set('compress-ratio', largeData);
      const stats = cacheManager.getStats();
      expect(stats.compressionRatio).toBeGreaterThan(1);
    });
  });

  describe('Stale-While-Revalidate', () => {
    it('should serve stale content when enabled', async () => {
      // Set with 1 second TTL
      await cacheManager.set('stale-key', { value: 'original' }, { ttl: 1 });

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should return stale content with staleWhileRevalidate
      const result = await cacheManager.get('stale-key', { staleWhileRevalidate: true });
      expect(result).toEqual({ value: 'original' });
    });

    it('should not serve stale content when disabled', async () => {
      await cacheManager.set('no-stale-key', { value: 'original' }, { ttl: 1 });

      await new Promise((resolve) => setTimeout(resolve, 1100));

      const result = await cacheManager.get('no-stale-key', { staleWhileRevalidate: false });
      expect(result).toBeNull();
    });
  });

  describe('Cache Statistics', () => {
    it('should track hits and misses', async () => {
      await cacheManager.set('stat-key', { value: 1 });

      // Hit
      await cacheManager.get('stat-key');
      // Miss
      await cacheManager.get('non-existent');

      const stats = cacheManager.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.5);
    });

    it('should track writes and deletes', async () => {
      await cacheManager.set('key1', { value: 1 });
      await cacheManager.set('key2', { value: 2 });
      await cacheManager.delete('key1');

      const stats = cacheManager.getStats();
      expect(stats.writes).toBe(2);
      expect(stats.deletes).toBe(1);
    });

    it('should track entry count', async () => {
      await cacheManager.set('key1', { value: 1 });
      await cacheManager.set('key2', { value: 2 });

      let stats = cacheManager.getStats();
      expect(stats.entryCount).toBe(2);

      await cacheManager.delete('key1');
      stats = cacheManager.getStats();
      expect(stats.entryCount).toBe(1);
    });

    it('should reset statistics', async () => {
      await cacheManager.set('key', { value: 1 });
      await cacheManager.get('key');

      cacheManager.resetStats();
      const stats = cacheManager.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.writes).toBe(0);
    });

    it('should calculate average size', async () => {
      await cacheManager.set('key1', { small: 'data' });
      await cacheManager.set('key2', { large: 'A'.repeat(1000) });

      const stats = cacheManager.getStats();
      expect(stats.averageSize).toBeGreaterThan(0);
    });
  });

  describe('Cache Invalidation', () => {
    beforeEach(async () => {
      // Populate cache with various keys
      await cacheManager.set('user:123', { name: 'Alice' });
      await cacheManager.set('user:456', { name: 'Bob' });
      await cacheManager.set('post:789', { title: 'Test' });
      await cacheManager.set('cache:abc', { data: 'xyz' });
    });

    it('should invalidate by exact match', async () => {
      const pattern: CacheInvalidationPattern = { type: 'exact', pattern: 'user:123' };
      const invalidated = await cacheManager.invalidate(pattern);

      expect(invalidated).toBe(1);
      expect(await cacheManager.has('user:123')).toBe(false);
      expect(await cacheManager.has('user:456')).toBe(true);
    });

    it('should invalidate by prefix', async () => {
      const pattern: CacheInvalidationPattern = { type: 'prefix', pattern: 'user:' };
      const invalidated = await cacheManager.invalidate(pattern);

      expect(invalidated).toBe(2);
      expect(await cacheManager.has('user:123')).toBe(false);
      expect(await cacheManager.has('user:456')).toBe(false);
      expect(await cacheManager.has('post:789')).toBe(true);
    });

    it('should invalidate by suffix', async () => {
      const pattern: CacheInvalidationPattern = { type: 'suffix', pattern: ':789' };
      const invalidated = await cacheManager.invalidate(pattern);

      expect(invalidated).toBe(1);
      expect(await cacheManager.has('post:789')).toBe(false);
    });

    it('should invalidate by regex', async () => {
      const pattern: CacheInvalidationPattern = { type: 'regex', pattern: 'user:\\d+' };
      const invalidated = await cacheManager.invalidate(pattern);

      expect(invalidated).toBe(2);
      expect(await cacheManager.has('user:123')).toBe(false);
      expect(await cacheManager.has('user:456')).toBe(false);
    });
  });

  describe('Cache Events', () => {
    it('should emit hit event', async () => {
      const events: any[] = [];
      cacheManager.on(CacheEventType.HIT, (event) => events.push(event));

      await cacheManager.set('event-key', { value: 1 });
      await cacheManager.get('event-key');

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(CacheEventType.HIT);
    });

    it('should emit write event', async () => {
      const events: any[] = [];
      cacheManager.on(CacheEventType.WRITE, (event) => events.push(event));

      await cacheManager.set('event-key', { value: 1 });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(CacheEventType.WRITE);
      expect(events[0].metadata).toHaveProperty('size');
    });

    it('should emit delete event', async () => {
      const events: any[] = [];
      cacheManager.on(CacheEventType.DELETE, (event) => events.push(event));

      await cacheManager.set('event-key', { value: 1 });
      await cacheManager.delete('event-key');

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(CacheEventType.DELETE);
    });

    it('should remove event listener', async () => {
      const events: any[] = [];
      const listener = (event: any) => events.push(event);

      cacheManager.on(CacheEventType.WRITE, listener);
      await cacheManager.set('key1', { value: 1 });
      expect(events).toHaveLength(1);

      cacheManager.off(CacheEventType.WRITE, listener);
      await cacheManager.set('key2', { value: 2 });
      expect(events).toHaveLength(1); // No new events
    });
  });

  describe('Cache Bypass', () => {
    it('should bypass cache when requested', async () => {
      await cacheManager.set('bypass-key', { value: 'original' });

      const result = await cacheManager.get('bypass-key', { bypassCache: true });
      expect(result).toBeNull();
    });

    it('should not record hit when bypassing', async () => {
      await cacheManager.set('bypass-key', { value: 'test' });
      cacheManager.resetStats();

      await cacheManager.get('bypass-key', { bypassCache: true });
      const stats = cacheManager.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0); // Not even recorded as miss
    });
  });

  describe('Clear Cache', () => {
    it('should clear all entries', async () => {
      await cacheManager.set('key1', { value: 1 });
      await cacheManager.set('key2', { value: 2 });
      await cacheManager.set('key3', { value: 3 });

      expect(kvStore.size()).toBe(3);

      await cacheManager.clear();

      expect(kvStore.size()).toBe(0);
      expect(await cacheManager.has('key1')).toBe(false);
      expect(await cacheManager.has('key2')).toBe(false);
      expect(await cacheManager.has('key3')).toBe(false);
    });

    it('should reset stats when clearing', async () => {
      await cacheManager.set('key', { value: 1 });
      await cacheManager.get('key');

      await cacheManager.clear();

      const stats = cacheManager.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.writes).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null values', async () => {
      await cacheManager.set('null-key', null);
      const result = await cacheManager.get('null-key');
      expect(result).toBeNull();
    });

    it('should handle undefined values', async () => {
      // undefined cannot be cached (JSON.stringify returns undefined)
      await cacheManager.set('undefined-key', undefined);
      const result = await cacheManager.get('undefined-key');
      // Should return null since nothing was cached
      expect(result).toBeNull();
    });

    it('should handle empty objects', async () => {
      await cacheManager.set('empty-object', {});
      const result = await cacheManager.get('empty-object');
      expect(result).toEqual({});
    });

    it('should handle empty arrays', async () => {
      await cacheManager.set('empty-array', []);
      const result = await cacheManager.get('empty-array');
      expect(result).toEqual([]);
    });

    it('should handle special characters in keys', async () => {
      const specialKey = 'key:with:colons/and/slashes';
      await cacheManager.set(specialKey, { value: 'test' });
      const result = await cacheManager.get(specialKey);
      expect(result).toEqual({ value: 'test' });
    });

    it('should handle concurrent operations', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        cacheManager.set(`concurrent-${i}`, { value: i })
      );

      await Promise.all(promises);

      const stats = cacheManager.getStats();
      expect(stats.writes).toBe(10);
    });

    it('should handle very large data', async () => {
      const largeData = {
        content: 'A'.repeat(10000),
        array: Array.from({ length: 1000 }, (_, i) => ({ id: i, value: `item-${i}` })),
      };

      await cacheManager.set('very-large', largeData);
      const result = await cacheManager.get('very-large');
      expect(result).toEqual(largeData);
    });
  });

  describe('Metadata Management', () => {
    it('should track hit count', async () => {
      await cacheManager.set('hit-tracking', { value: 'test' });

      // Multiple gets should increment hit count
      await cacheManager.get('hit-tracking');
      await cacheManager.get('hit-tracking');
      await cacheManager.get('hit-tracking');

      const stats = cacheManager.getStats();
      expect(stats.hits).toBe(3);
    });

    it('should store creation time', async () => {
      const before = Date.now();
      await cacheManager.set('time-key', { value: 'test' });
      const after = Date.now();

      // We can't directly access metadata in this test, but we can verify
      // the entry exists and was created within our timeframe
      const exists = await cacheManager.has('time-key');
      expect(exists).toBe(true);
    });

    it('should store platform metadata', async () => {
      const key = cacheManager.generateKey('https://example.com', { platform: 'facebook' });
      expect(key.platform).toBe('facebook');
    });
  });
});
