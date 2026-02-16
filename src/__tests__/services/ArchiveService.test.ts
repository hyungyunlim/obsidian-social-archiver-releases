import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArchiveService } from '@/services/ArchiveService';
import { ApiClient } from '@/services/ApiClient';
import type { PostData, Platform } from '@/types/post';
import type { ArchiveOptions } from '@/types/archive';
import type { ArchiveResponse } from '@/types/api';

// Mock ApiClient
vi.mock('@/services/ApiClient');

describe('ArchiveService', () => {
  let archiveService: ArchiveService;
  let mockApiClient: any;

  const mockPostData: PostData = {
    schemaVersion: '1.0.0',
    platform: 'facebook' as Platform,
    id: 'test-123',
    url: 'https://facebook.com/post/123',
    author: {
      name: 'Test User',
      url: 'https://facebook.com/user/test',
    },
    content: {
      text: 'Test post content',
    },
    media: [],
    metadata: {
      timestamp: new Date('2024-01-01'),
    },
  };

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock API client
    mockApiClient = {
      isHealthy: vi.fn().mockResolvedValue(true),
      archivePost: vi.fn().mockResolvedValue({
        jobId: 'job-123',
        status: 'pending',
      } as ArchiveResponse),
      waitForJob: vi.fn().mockResolvedValue(mockPostData),
    };

    // Create service
    archiveService = new ArchiveService({
      apiClient: mockApiClient,
      licenseKey: 'test-key',
    });
  });

  describe('initialization', () => {
    it('should initialize successfully when API client is healthy', async () => {
      await expect(archiveService.initialize()).resolves.not.toThrow();
      expect(mockApiClient.isHealthy).toHaveBeenCalled();
    });

    it('should throw error when API client is unhealthy', async () => {
      mockApiClient.isHealthy.mockResolvedValue(false);

      await expect(archiveService.initialize()).rejects.toThrow(
        'API client is not healthy'
      );
    });
  });

  describe('isHealthy', () => {
    it('should return health status from API client', async () => {
      mockApiClient.isHealthy.mockResolvedValue(true);
      expect(await archiveService.isHealthy()).toBe(true);

      mockApiClient.isHealthy.mockResolvedValue(false);
      expect(await archiveService.isHealthy()).toBe(false);
    });
  });

  describe('detectPlatform', () => {
    it('should detect Facebook platform', () => {
      expect(archiveService.detectPlatform('https://facebook.com/post/123')).toBe(
        'facebook'
      );
      expect(archiveService.detectPlatform('https://www.facebook.com/post/123')).toBe(
        'facebook'
      );
    });

    it('should detect LinkedIn platform', () => {
      expect(archiveService.detectPlatform('https://linkedin.com/post/123')).toBe(
        'linkedin'
      );
    });

    it('should detect Instagram platform', () => {
      expect(archiveService.detectPlatform('https://instagram.com/p/123')).toBe(
        'instagram'
      );
    });

    it('should detect TikTok platform', () => {
      expect(archiveService.detectPlatform('https://tiktok.com/@user/video/123')).toBe(
        'tiktok'
      );
    });

    it('should detect X platform', () => {
      expect(archiveService.detectPlatform('https://x.com/user/status/123')).toBe(
        'x'
      );
      expect(
        archiveService.detectPlatform('https://twitter.com/user/status/123')
      ).toBe('x');
    });

    it('should detect Threads platform', () => {
      expect(archiveService.detectPlatform('https://threads.net/t/123')).toBe(
        'threads'
      );
    });

    it('should throw error for unsupported platform', () => {
      expect(() =>
        archiveService.detectPlatform('https://unsupported.com/post/123')
      ).toThrow('Unsupported platform');
    });

    it('should be case insensitive', () => {
      expect(archiveService.detectPlatform('https://FACEBOOK.COM/post/123')).toBe(
        'facebook'
      );
    });
  });

  describe('validateUrl', () => {
    it('should validate correct HTTP URLs', () => {
      expect(archiveService.validateUrl('http://example.com')).toBe(true);
      expect(archiveService.validateUrl('https://example.com')).toBe(true);
    });

    it('should reject invalid URL formats', () => {
      expect(archiveService.validateUrl('not-a-url')).toBe(false);
      expect(archiveService.validateUrl('')).toBe(false);
    });

    it('should reject non-HTTP protocols', () => {
      expect(archiveService.validateUrl('ftp://example.com')).toBe(false);
      expect(archiveService.validateUrl('file:///path/to/file')).toBe(false);
    });
  });

  describe('archivePost', () => {
    const testUrl = 'https://facebook.com/post/123';
    const testOptions: ArchiveOptions = {
      enableAI: true,
      downloadMedia: true,
      removeTracking: false,
      generateShareLink: false,
      deepResearch: false,
    };

    it('should successfully archive a post', async () => {
      const result = await archiveService.archivePost(testUrl, testOptions);

      expect(result).toBeDefined();
      expect(result.platform).toBe('facebook');
      expect(result.id).toBe('test-123');
      expect(mockApiClient.archivePost).toHaveBeenCalledWith({
        url: testUrl,
        options: {
          enableAI: true,
          deepResearch: false,
          downloadMedia: true,
        },
        licenseKey: 'test-key',
      });
      expect(mockApiClient.waitForJob).toHaveBeenCalledWith(
        'job-123',
        expect.any(Function)
      );
    });

    it('should call progress callback', async () => {
      const onProgress = vi.fn();

      await archiveService.archivePost(testUrl, testOptions, onProgress);

      expect(onProgress).toHaveBeenCalled();
      expect(onProgress.mock.calls.some(([progress]) => progress === 10)).toBe(true);
      expect(onProgress.mock.calls.some(([progress]) => progress === 100)).toBe(true);
    });

    it('should map job progress to overall progress', async () => {
      const onProgress = vi.fn();

      mockApiClient.waitForJob.mockImplementation(
        async (_jobId: string, callback?: (progress: number) => void) => {
          // Simulate job progress updates
          callback?.(0);
          callback?.(50);
          callback?.(100);
          return mockPostData;
        }
      );

      await archiveService.archivePost(testUrl, testOptions, onProgress);

      // Check that progress was mapped from 30-90 range
      const progressValues = onProgress.mock.calls.map(([p]) => p);
      expect(progressValues).toContain(30); // Start of job
      expect(progressValues.some(p => p >= 30 && p <= 90)).toBe(true);
    });

    it('should throw error for invalid URL', async () => {
      await expect(
        archiveService.archivePost('invalid-url', testOptions)
      ).rejects.toThrow('Invalid URL format');
    });

    it('should wrap API errors with context', async () => {
      mockApiClient.archivePost.mockRejectedValue(
        new Error('API error')
      );

      await expect(
        archiveService.archivePost(testUrl, testOptions)
      ).rejects.toThrow(/Failed to archive post from.*API error/);
    });

    it('should sanitize post data', async () => {
      const unsanitizedData = {
        ...mockPostData,
        content: {
          text: 'Test\0content', // Contains null byte
          html: '<p>Test</p><script>alert("xss")</script>',
        },
      };

      mockApiClient.waitForJob.mockResolvedValue(unsanitizedData);

      const result = await archiveService.archivePost(testUrl, testOptions);

      expect(result.content.text).toBe('Testcontent'); // Null byte removed
      expect(result.content.html).not.toContain('<script>'); // Script tag removed
    });

    it('should validate response data format', async () => {
      mockApiClient.waitForJob.mockResolvedValue({
        // Invalid: missing required fields
        platform: 'facebook',
      });

      await expect(
        archiveService.archivePost(testUrl, testOptions)
      ).rejects.toThrow('Invalid post data format');
    });

    it('should normalize URLs in post data', async () => {
      const dataWithUnnormalizedUrls = {
        ...mockPostData,
        url: 'HTTPS://FACEBOOK.COM/POST/123',
        author: {
          ...mockPostData.author,
          url: 'HTTPS://FACEBOOK.COM/USER/TEST',
        },
      };

      mockApiClient.waitForJob.mockResolvedValue(dataWithUnnormalizedUrls);

      const result = await archiveService.archivePost(testUrl, testOptions);

      expect(result.url).toBe('https://facebook.com/POST/123');
      expect(result.author.url).toBe('https://facebook.com/USER/TEST');
    });
  });

  describe('dispose', () => {
    it('should dispose without errors', async () => {
      await expect(archiveService.dispose()).resolves.not.toThrow();
    });
  });
});
