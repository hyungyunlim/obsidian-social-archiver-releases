/**
 * ProfileQuickPreview Service
 *
 * Fetches lightweight profile previews using og:tags from Worker API
 * without triggering full BrightData crawl for optimistic UI display.
 *
 * Single Responsibility: Quick profile preview fetching with caching
 */

import { requestUrl } from 'obsidian';
import type { IService } from './base/IService';
import type { Platform } from '@/types/post';

/**
 * Quick preview result from Worker API
 */
export interface QuickPreviewResult {
  handle: string;
  displayName: string | null;
  avatar: string | null;
  bio: string | null;
  profileUrl: string;
  platform: Platform;
  source: 'og_tags' | 'url_parse';
}

/**
 * Worker API response format
 */
interface WorkerQuickPreviewResponse {
  success: boolean;
  data?: {
    displayName: string | null;
    avatar: string | null;
    bio: string | null;
    handle: string;
    platform: string;
  };
  error?: {
    code: string;
    message: string;
  };
  cached?: boolean;
}

/**
 * Expand URL response format
 */
interface ExpandUrlResponse {
  success: boolean;
  data?: {
    originalUrl: string;
    expandedUrl: string;
    handle: string;
    platform: string;
    wasExpanded: boolean;
  };
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Expanded URL result
 */
export interface ExpandedUrlResult {
  originalUrl: string;
  expandedUrl: string;
  handle: string;
  platform: Platform;
  wasExpanded: boolean;
}

/**
 * Error types for quick preview
 */
export class QuickPreviewTimeoutError extends Error {
  constructor(message = 'Quick preview request timed out') {
    super(message);
    this.name = 'QuickPreviewTimeoutError';
  }
}

export class QuickPreviewFailedError extends Error {
  code: string;

  constructor(message: string, code = 'PREVIEW_FAILED') {
    super(message);
    this.name = 'QuickPreviewFailedError';
    this.code = code;
  }
}

/**
 * Cache entry for preview results
 */
interface CacheEntry {
  result: QuickPreviewResult;
  timestamp: number;
  expiresAt: number;
}

/**
 * Service configuration
 */
export interface ProfileQuickPreviewConfig {
  endpoint: string;
  timeout?: number;        // Request timeout in ms (default: 3000)
  cacheTTL?: number;       // Cache TTL in ms (default: 300000 = 5 min)
  maxRetries?: number;     // Max retry attempts (default: 1)
}

/**
 * ProfileQuickPreview Service
 *
 * Fetches quick profile previews from Worker API with caching and retry logic
 */
export class ProfileQuickPreview implements IService {
  private config: Required<ProfileQuickPreviewConfig>;
  private cache: Map<string, CacheEntry> = new Map();
  private initialized = false;

  constructor(config: ProfileQuickPreviewConfig) {
    this.config = {
      timeout: 3000,      // 3 seconds default
      cacheTTL: 300000,   // 5 minutes default
      maxRetries: 1,      // 1 retry default
      ...config,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Validate endpoint
    try {
      new URL(this.config.endpoint);
    } catch {
      throw new Error(`Invalid Workers API endpoint: ${this.config.endpoint}`);
    }

    this.initialized = true;
  }

  async dispose(): Promise<void> {
    this.cache.clear();
    this.initialized = false;
  }

  /**
   * Fetch quick preview for a profile URL
   *
   * @param url - Profile URL to fetch preview for
   * @param platform - Optional platform hint
   * @returns QuickPreviewResult with profile data or URL-parsed fallback
   */
  async fetchQuickPreview(
    url: string,
    platform?: Platform
  ): Promise<QuickPreviewResult> {
    this.ensureInitialized();

    // Generate cache key
    const cacheKey = this.generateCacheKey(url);

    // Check cache first
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    // Try to fetch with retry logic
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = await this.fetchFromWorker(url, platform);

        // Cache successful result
        this.setCache(cacheKey, result);

        return result;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on timeout (already waited long enough)
        if (error instanceof QuickPreviewTimeoutError) {
          break;
        }

        // Exponential backoff before retry
        if (attempt < this.config.maxRetries) {
          await this.delay(Math.min(1000 * Math.pow(2, attempt), 2000));
        }
      }
    }

    // All retries failed - return URL-parsed fallback
    console.warn(
      '[ProfileQuickPreview] All attempts failed, returning fallback:',
      lastError?.message
    );

    return this.createFallbackResult(url, platform);
  }

  /**
   * Expand a share URL to its actual profile URL
   * Used for Facebook share URLs from mobile app
   *
   * @param url - Share URL to expand
   * @returns Expanded URL result with actual profile URL and handle
   */
  async expandShareUrl(url: string): Promise<ExpandedUrlResult> {
    this.ensureInitialized();

    const apiUrl = new URL('/api/profiles/expand-url', this.config.endpoint);
    apiUrl.searchParams.set('url', url);

    try {
      const response = await requestUrl({
        url: apiUrl.toString(),
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        throw: false,
      });

      const data: ExpandUrlResponse = response.json;

      if (!data.success || !data.data) {
        throw new QuickPreviewFailedError(
          data.error?.message || 'Failed to expand URL',
          data.error?.code || 'EXPANSION_FAILED'
        );
      }

      return {
        originalUrl: data.data.originalUrl,
        expandedUrl: data.data.expandedUrl,
        handle: data.data.handle,
        platform: data.data.platform as Platform,
        wasExpanded: data.data.wasExpanded,
      };

    } catch (error) {
      if (error instanceof QuickPreviewFailedError) {
        throw error;
      }

      throw new QuickPreviewFailedError(
        error instanceof Error ? error.message : String(error),
        'NETWORK_ERROR'
      );
    }
  }

  /**
   * Check if a URL is a Facebook share URL that needs expansion
   */
  static isFacebookShareUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return (
        urlObj.hostname.includes('facebook.com') &&
        urlObj.pathname.startsWith('/share/')
      );
    } catch {
      return false;
    }
  }

  /**
   * Fetch preview from Worker API
   */
  private async fetchFromWorker(
    url: string,
    platform?: Platform
  ): Promise<QuickPreviewResult> {
    const apiUrl = new URL('/api/profiles/quick-preview', this.config.endpoint);
    apiUrl.searchParams.set('url', url);
    if (platform) {
      apiUrl.searchParams.set('platform', platform);
    }

    try {
      const response = await requestUrl({
        url: apiUrl.toString(),
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        throw: false,
      });

      // Handle timeout (requestUrl doesn't support AbortController well)
      // We rely on server-side timeout (3 seconds)

      const data: WorkerQuickPreviewResponse = response.json;

      if (!data.success) {
        throw new QuickPreviewFailedError(
          data.error?.message || 'Unknown error',
          data.error?.code || 'UNKNOWN_ERROR'
        );
      }

      if (!data.data) {
        throw new QuickPreviewFailedError('No data returned', 'NO_DATA');
      }

      // Determine source based on whether we got og:tags data
      const hasOgData = data.data.displayName || data.data.avatar || data.data.bio;
      const source: 'og_tags' | 'url_parse' = hasOgData ? 'og_tags' : 'url_parse';

      return {
        handle: data.data.handle,
        displayName: data.data.displayName,
        avatar: data.data.avatar,
        bio: data.data.bio,
        profileUrl: url,
        platform: (data.data.platform as Platform) || platform || 'facebook',
        source,
      };

    } catch (error) {
      // Handle specific error types
      if (error instanceof QuickPreviewFailedError) {
        throw error;
      }

      // Check for timeout-related errors
      if (
        error instanceof Error &&
        (error.message.includes('timeout') || error.message.includes('ETIMEDOUT'))
      ) {
        throw new QuickPreviewTimeoutError();
      }

      // Re-throw as QuickPreviewFailedError
      throw new QuickPreviewFailedError(
        error instanceof Error ? error.message : String(error),
        'NETWORK_ERROR'
      );
    }
  }

  /**
   * Create fallback result from URL parsing
   */
  private createFallbackResult(url: string, platform?: Platform): QuickPreviewResult {
    const handle = this.extractHandleFromUrl(url);
    const detectedPlatform = platform || this.detectPlatformFromUrl(url);

    return {
      handle: handle || 'unknown',
      displayName: null,
      avatar: null,
      bio: null,
      profileUrl: url,
      platform: detectedPlatform,
      source: 'url_parse',
    };
  }

  /**
   * Extract handle from profile URL
   */
  private extractHandleFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;

      // Common patterns for extracting handles
      // /@username or /username
      const patterns = [
        /^\/@([a-zA-Z0-9._-]+)\/?$/,           // /@handle
        /^\/in\/([a-zA-Z0-9-]+)\/?$/,          // LinkedIn /in/handle
        /^\/profile\/([a-zA-Z0-9._-]+)\/?$/,   // Bluesky /profile/handle
        /^\/(?:user|u)\/([a-zA-Z0-9_-]+)\/?$/, // Reddit /user/handle
        /^\/([a-zA-Z0-9._]+)\/?$/,             // Generic /handle
      ];

      for (const pattern of patterns) {
        const match = pathname.match(pattern);
        if (match?.[1]) {
          return match[1];
        }
      }

      // Fallback: extract first path segment
      const segments = pathname.split('/').filter(Boolean);
      return segments[0]?.replace('@', '') || '';

    } catch {
      return '';
    }
  }

  /**
   * Detect platform from URL
   */
  private detectPlatformFromUrl(url: string): Platform {
    try {
      const hostname = new URL(url).hostname.toLowerCase();

      if (hostname.includes('instagram.com')) return 'instagram';
      if (hostname.includes('x.com') || hostname.includes('twitter.com')) return 'x';
      if (hostname.includes('tiktok.com')) return 'tiktok';
      if (hostname.includes('facebook.com') || hostname.includes('fb.com')) return 'facebook';
      if (hostname.includes('linkedin.com')) return 'linkedin';
      if (hostname.includes('youtube.com')) return 'youtube';
      if (hostname.includes('threads.net')) return 'threads';
      if (hostname.includes('reddit.com')) return 'reddit';
      if (hostname.includes('bsky.app')) return 'bluesky';
      if (hostname.includes('pinterest.com')) return 'pinterest';
      if (hostname.includes('substack.com')) return 'substack';
      if (hostname.includes('tumblr.com')) return 'tumblr';
      if (hostname.includes('mastodon')) return 'mastodon';

      return 'facebook'; // Default fallback
    } catch {
      return 'facebook';
    }
  }

  /**
   * Generate cache key from URL
   */
  private generateCacheKey(url: string): string {
    try {
      const urlObj = new URL(url);
      // Normalize: lowercase hostname, remove trailing slash
      urlObj.hostname = urlObj.hostname.toLowerCase();
      if (urlObj.pathname.endsWith('/') && urlObj.pathname.length > 1) {
        urlObj.pathname = urlObj.pathname.slice(0, -1);
      }
      return urlObj.toString();
    } catch {
      return url;
    }
  }

  /**
   * Get cached result if valid
   */
  private getCached(key: string): QuickPreviewResult | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.result;
  }

  /**
   * Store result in cache
   */
  private setCache(key: string, result: QuickPreviewResult): void {
    const now = Date.now();

    this.cache.set(key, {
      result,
      timestamp: now,
      expiresAt: now + this.config.cacheTTL,
    });

    // Cleanup old entries periodically (keep cache size manageable)
    if (this.cache.size > 100) {
      this.cleanupExpiredCache();
    }
  }

  /**
   * Remove expired cache entries
   */
  private cleanupExpiredCache(): void {
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cached entries
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; oldestEntry: number | null } {
    let oldest: number | null = null;

    for (const entry of this.cache.values()) {
      if (oldest === null || entry.timestamp < oldest) {
        oldest = entry.timestamp;
      }
    }

    return {
      size: this.cache.size,
      oldestEntry: oldest,
    };
  }

  /**
   * Ensure service is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('ProfileQuickPreview not initialized. Call initialize() first.');
    }
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
