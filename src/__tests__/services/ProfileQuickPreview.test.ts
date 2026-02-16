import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestUrl } from 'obsidian';
import {
  ProfileQuickPreview,
  QuickPreviewTimeoutError,
  QuickPreviewFailedError,
  type QuickPreviewResult,
} from '@/services/ProfileQuickPreview';

vi.mock('obsidian', () => ({
  requestUrl: vi.fn(),
}));

describe('ProfileQuickPreview', () => {
  let service: ProfileQuickPreview;
  const mockRequestUrl = requestUrl as unknown as vi.Mock;

  beforeEach(async () => {
    service = new ProfileQuickPreview({
      endpoint: 'https://api.example.com',
      timeout: 3000,
      cacheTTL: 300000, // 5 minutes
      maxRetries: 1,
    });
    await service.initialize();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await service.dispose();
  });

  describe('fetchQuickPreview', () => {
    it('should return complete preview data from Worker API', async () => {
      const mockResponse = {
        json: {
          success: true,
          data: {
            displayName: 'John Doe',
            avatar: 'https://example.com/avatar.jpg',
            bio: 'Software developer',
            handle: 'johndoe',
            platform: 'instagram',
          },
          cached: false,
        },
      };

      mockRequestUrl.mockResolvedValueOnce(mockResponse);

      const result = await service.fetchQuickPreview(
        'https://instagram.com/johndoe',
        'instagram'
      );

      expect(result.handle).toBe('johndoe');
      expect(result.displayName).toBe('John Doe');
      expect(result.avatar).toBe('https://example.com/avatar.jpg');
      expect(result.bio).toBe('Software developer');
      expect(result.platform).toBe('instagram');
      expect(result.source).toBe('og_tags');
      expect(result.profileUrl).toBe('https://instagram.com/johndoe');
    });

    it('should handle partial data (missing avatar/bio)', async () => {
      const mockResponse = {
        json: {
          success: true,
          data: {
            displayName: 'Jane Doe',
            avatar: null,
            bio: null,
            handle: 'janedoe',
            platform: 'x',
          },
          cached: false,
        },
      };

      mockRequestUrl.mockResolvedValueOnce(mockResponse);

      const result = await service.fetchQuickPreview('https://x.com/janedoe');

      expect(result.handle).toBe('janedoe');
      expect(result.displayName).toBe('Jane Doe');
      expect(result.avatar).toBeNull();
      expect(result.bio).toBeNull();
      expect(result.platform).toBe('x');
      expect(result.source).toBe('og_tags'); // Still og_tags because displayName exists
    });

    it('should return url_parse source when no og data available', async () => {
      const mockResponse = {
        json: {
          success: true,
          data: {
            displayName: null,
            avatar: null,
            bio: null,
            handle: 'testuser',
            platform: 'tiktok',
          },
          cached: false,
        },
      };

      mockRequestUrl.mockResolvedValueOnce(mockResponse);

      const result = await service.fetchQuickPreview('https://tiktok.com/@testuser');

      expect(result.handle).toBe('testuser');
      expect(result.displayName).toBeNull();
      expect(result.source).toBe('url_parse');
    });

    it('should return fallback on network error', async () => {
      mockRequestUrl.mockRejectedValue(new Error('Network error'));

      const result = await service.fetchQuickPreview(
        'https://instagram.com/fallbackuser',
        'instagram'
      );

      expect(result.handle).toBe('fallbackuser');
      expect(result.displayName).toBeNull();
      expect(result.avatar).toBeNull();
      expect(result.source).toBe('url_parse');
      expect(result.platform).toBe('instagram');
    });

    it('should return fallback on API error response', async () => {
      const mockResponse = {
        json: {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid URL',
          },
        },
      };

      mockRequestUrl.mockResolvedValueOnce(mockResponse);
      // For retry
      mockRequestUrl.mockResolvedValueOnce(mockResponse);

      const result = await service.fetchQuickPreview('https://facebook.com/testuser');

      expect(result.source).toBe('url_parse');
      expect(result.handle).toBe('testuser');
    });

    it('should retry once on failure before fallback', async () => {
      const failResponse = {
        json: {
          success: false,
          error: { code: 'SERVER_ERROR', message: 'Temporary error' },
        },
      };

      const successResponse = {
        json: {
          success: true,
          data: {
            displayName: 'Success User',
            avatar: null,
            bio: null,
            handle: 'successuser',
            platform: 'instagram',
          },
        },
      };

      mockRequestUrl
        .mockResolvedValueOnce(failResponse)
        .mockResolvedValueOnce(successResponse);

      const result = await service.fetchQuickPreview('https://instagram.com/successuser');

      expect(mockRequestUrl).toHaveBeenCalledTimes(2);
      expect(result.displayName).toBe('Success User');
      expect(result.source).toBe('og_tags');
    });

    it('should use cache on subsequent requests', async () => {
      const mockResponse = {
        json: {
          success: true,
          data: {
            displayName: 'Cached User',
            avatar: 'https://example.com/cached.jpg',
            bio: 'Cached bio',
            handle: 'cacheduser',
            platform: 'linkedin',
          },
        },
      };

      mockRequestUrl.mockResolvedValueOnce(mockResponse);

      // First request - fetches from API
      const result1 = await service.fetchQuickPreview('https://linkedin.com/in/cacheduser');
      expect(mockRequestUrl).toHaveBeenCalledTimes(1);
      expect(result1.displayName).toBe('Cached User');

      // Second request - should use cache
      const result2 = await service.fetchQuickPreview('https://linkedin.com/in/cacheduser');
      expect(mockRequestUrl).toHaveBeenCalledTimes(1); // No additional API call
      expect(result2.displayName).toBe('Cached User');
    });

    it('should normalize URL for cache key', async () => {
      const mockResponse = {
        json: {
          success: true,
          data: {
            displayName: 'Normalized User',
            avatar: null,
            bio: null,
            handle: 'normalizeduser',
            platform: 'instagram',
          },
        },
      };

      mockRequestUrl.mockResolvedValueOnce(mockResponse);

      // First request with trailing slash
      await service.fetchQuickPreview('https://instagram.com/normalizeduser/');
      expect(mockRequestUrl).toHaveBeenCalledTimes(1);

      // Second request without trailing slash - should hit cache
      await service.fetchQuickPreview('https://instagram.com/normalizeduser');
      expect(mockRequestUrl).toHaveBeenCalledTimes(1); // No additional call
    });
  });

  describe('cache management', () => {
    it('should clear cache when dispose is called', async () => {
      const mockResponse = {
        json: {
          success: true,
          data: {
            displayName: 'Test User',
            avatar: null,
            bio: null,
            handle: 'testuser',
            platform: 'instagram',
          },
        },
      };

      mockRequestUrl.mockResolvedValue(mockResponse);

      await service.fetchQuickPreview('https://instagram.com/testuser');
      expect(mockRequestUrl).toHaveBeenCalledTimes(1);

      // Dispose and reinitialize
      await service.dispose();
      await service.initialize();

      // Should fetch again after cache cleared
      await service.fetchQuickPreview('https://instagram.com/testuser');
      expect(mockRequestUrl).toHaveBeenCalledTimes(2);
    });

    it('should report cache stats correctly', async () => {
      const mockResponse = {
        json: {
          success: true,
          data: {
            displayName: 'Stats User',
            avatar: null,
            bio: null,
            handle: 'statsuser',
            platform: 'instagram',
          },
        },
      };

      mockRequestUrl.mockResolvedValue(mockResponse);

      // Initially empty
      let stats = service.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.oldestEntry).toBeNull();

      // Add one entry
      await service.fetchQuickPreview('https://instagram.com/statsuser');
      stats = service.getCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.oldestEntry).not.toBeNull();
    });

    it('should clear cache manually', async () => {
      const mockResponse = {
        json: {
          success: true,
          data: {
            displayName: 'Clear User',
            avatar: null,
            bio: null,
            handle: 'clearuser',
            platform: 'instagram',
          },
        },
      };

      mockRequestUrl.mockResolvedValue(mockResponse);

      await service.fetchQuickPreview('https://instagram.com/clearuser');
      expect(service.getCacheStats().size).toBe(1);

      service.clearCache();
      expect(service.getCacheStats().size).toBe(0);
    });
  });

  describe('platform detection', () => {
    it('should detect platform from various URLs', async () => {
      // Create service with no retries for faster testing
      const fastService = new ProfileQuickPreview({
        endpoint: 'https://api.example.com',
        maxRetries: 0, // No retries for this test
      });
      await fastService.initialize();

      const testCases = [
        { url: 'https://instagram.com/user', expectedPlatform: 'instagram' },
        { url: 'https://x.com/user', expectedPlatform: 'x' },
        { url: 'https://twitter.com/user', expectedPlatform: 'x' },
        { url: 'https://tiktok.com/@user', expectedPlatform: 'tiktok' },
        { url: 'https://facebook.com/user', expectedPlatform: 'facebook' },
        { url: 'https://linkedin.com/in/user', expectedPlatform: 'linkedin' },
        { url: 'https://youtube.com/@user', expectedPlatform: 'youtube' },
        { url: 'https://threads.net/@user', expectedPlatform: 'threads' },
        { url: 'https://reddit.com/user/username', expectedPlatform: 'reddit' },
        { url: 'https://bsky.app/profile/user.bsky.social', expectedPlatform: 'bluesky' },
      ];

      for (const { url, expectedPlatform } of testCases) {
        // Mock network failure to force fallback which uses platform detection
        mockRequestUrl.mockRejectedValueOnce(new Error('Network error'));

        const result = await fastService.fetchQuickPreview(url);
        expect(result.platform, `Failed for ${url}`).toBe(expectedPlatform);
      }

      await fastService.dispose();
    });
  });

  describe('error handling', () => {
    it('should throw when not initialized', async () => {
      const uninitializedService = new ProfileQuickPreview({
        endpoint: 'https://api.example.com',
      });

      await expect(
        uninitializedService.fetchQuickPreview('https://instagram.com/test')
      ).rejects.toThrow('not initialized');
    });
  });
});
