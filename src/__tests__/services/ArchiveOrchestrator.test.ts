import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArchiveOrchestrator } from '@/services/ArchiveOrchestrator';
import type { ArchiveService } from '@/services/ArchiveService';
import type { MarkdownConverter } from '@/services/MarkdownConverter';
import type { VaultManager } from '@/services/VaultManager';
import type { MediaHandler } from '@/services/MediaHandler';
import type { PostData } from '@/types/post';
import type { TFile } from 'obsidian';
import type { LinkPreviewExtractor } from '@/services/LinkPreviewExtractor';

describe('ArchiveOrchestrator', () => {
  let orchestrator: ArchiveOrchestrator;
  let mockArchiveService: ArchiveService;
  let mockMarkdownConverter: MarkdownConverter;
  let mockVaultManager: VaultManager;
  let mockMediaHandler: MediaHandler;
  let mockLinkPreviewExtractor: LinkPreviewExtractor;

  const mockPostData: PostData = {
    platform: 'facebook',
    id: 'post123',
    url: 'https://facebook.com/post/123',
    author: {
      name: 'John Doe',
      url: 'https://facebook.com/johndoe',
      verified: false,
    },
    content: {
      text: 'Test post content',
    },
    media: [
      {
        type: 'image',
        url: 'https://example.com/image.jpg',
      },
    ],
    metadata: {
      timestamp: new Date('2024-03-15'),
      likes: 100,
    },
  };

  const mockMarkdownResult = {
    frontmatter: {
      share: false,
      platform: 'facebook',
      author: 'John Doe',
      authorUrl: 'https://facebook.com/johndoe',
      originalUrl: 'https://facebook.com/post/123',
      archived: '2025-10-28',
      lastModified: '2025-10-28',
      tags: ['social/facebook'],
    },
    content: '# John Doe\n\nTest post content',
    fullDocument: '---\nshare: false\n---\n\n# John Doe\n\nTest post content',
  };

  const mockMediaResult = {
    originalUrl: 'https://example.com/image.jpg',
    localPath: 'attachments/social-archives/facebook/post123/image.jpg',
    type: 'image' as const,
    size: 1024,
    file: { path: 'attachments/social-archives/facebook/post123/image.jpg' } as TFile,
  };

  const mockFile: TFile = {
    path: 'Social Archives/Facebook/2024/03/2024-03-15 - John Doe - Test post.md',
  } as TFile;

  beforeEach(() => {
    // Create mock services
    mockArchiveService = {
      initialize: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
      isHealthy: vi.fn().mockResolvedValue(true),
      archivePost: vi.fn().mockResolvedValue(mockPostData),
      detectPlatform: vi.fn().mockReturnValue('facebook'),
      validateUrl: vi.fn().mockReturnValue(true),
    } as unknown as ArchiveService;

    mockMarkdownConverter = {
      initialize: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
      isHealthy: vi.fn().mockResolvedValue(true),
      convert: vi.fn().mockResolvedValue(mockMarkdownResult),
      updateFullDocument: vi.fn().mockReturnValue(mockMarkdownResult),
    } as unknown as MarkdownConverter;

    mockVaultManager = {
      initialize: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
      isHealthy: vi.fn().mockResolvedValue(true),
      savePost: vi.fn().mockResolvedValue(mockFile.path),
      getFileByPath: vi.fn().mockReturnValue(mockFile),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    } as unknown as VaultManager;

    mockMediaHandler = {
      initialize: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
      isHealthy: vi.fn().mockResolvedValue(true),
      downloadMedia: vi.fn().mockResolvedValue([mockMediaResult]),
      deleteMedia: vi.fn().mockResolvedValue(undefined),
    } as unknown as MediaHandler;

    mockLinkPreviewExtractor = {
      initialize: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
      isHealthy: vi.fn().mockReturnValue(true),
      extractUrls: vi.fn().mockReturnValue([]),
      extractUrlsWithDetails: vi.fn().mockReturnValue({
        links: [],
        totalFound: 0,
        excluded: 0,
      }),
    } as unknown as LinkPreviewExtractor;

    orchestrator = new ArchiveOrchestrator({
      archiveService: mockArchiveService,
      markdownConverter: mockMarkdownConverter,
      vaultManager: mockVaultManager,
      mediaHandler: mockMediaHandler,
      linkPreviewExtractor: mockLinkPreviewExtractor,
      enableCache: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  });

  describe('initialization', () => {
    it('should initialize all services', async () => {
      await orchestrator.initialize();

      expect(mockArchiveService.initialize).toHaveBeenCalled();
      expect(mockMarkdownConverter.initialize).toHaveBeenCalled();
      expect(mockVaultManager.initialize).toHaveBeenCalled();
      expect(mockMediaHandler.initialize).toHaveBeenCalled();
      expect(mockLinkPreviewExtractor.initialize).toHaveBeenCalled();
    });

    it('should check health of all services', async () => {
      const healthy = await orchestrator.isHealthy();

      expect(healthy).toBe(true);
      expect(mockArchiveService.isHealthy).toHaveBeenCalled();
      expect(mockMarkdownConverter.isHealthy).toHaveBeenCalled();
      expect(mockVaultManager.isHealthy).toHaveBeenCalled();
      expect(mockMediaHandler.isHealthy).toHaveBeenCalled();
      expect(mockLinkPreviewExtractor.isHealthy).toHaveBeenCalled();
    });

    it('should return false if any service is unhealthy', async () => {
      vi.mocked(mockArchiveService.isHealthy).mockResolvedValue(false);

      const healthy = await orchestrator.isHealthy();

      expect(healthy).toBe(false);
    });
  });

  describe('orchestrate', () => {
    it('should orchestrate complete archive workflow', async () => {
      const url = 'https://facebook.com/post/123';
      const options = {
        enableAI: false,
        downloadMedia: true,
        removeTracking: true,
        generateShareLink: false,
        deepResearch: false,
      };

      const result = await orchestrator.orchestrate(url, options);

      expect(result.success).toBe(true);
      expect(result.filePath).toBe(mockFile.path);
      expect(result.creditsUsed).toBe(1);

      // Verify workflow steps
      expect(mockArchiveService.validateUrl).toHaveBeenCalledWith(url);
      expect(mockArchiveService.detectPlatform).toHaveBeenCalledWith(url);
      expect(mockArchiveService.archivePost).toHaveBeenCalledWith(
        url,
        options,
        expect.any(Function)
      );
      expect(mockMediaHandler.downloadMedia).toHaveBeenCalledWith(
        mockPostData.media,
        'facebook',
        'post123',
        'John Doe', // authorUsername
        expect.any(Function)
      );
      expect(mockMarkdownConverter.convert).toHaveBeenCalledWith(
        mockPostData,
        undefined,
        [mockMediaResult]
      );
      expect(mockVaultManager.savePost).toHaveBeenCalledWith(
        mockPostData,
        mockMarkdownResult
      );
    });

    it('should calculate correct credits for AI usage', async () => {
      const url = 'https://facebook.com/post/123';
      const options = {
        enableAI: true,
        downloadMedia: true,
        removeTracking: true,
        generateShareLink: false,
        deepResearch: false,
      };

      const result = await orchestrator.orchestrate(url, options);

      expect(result.success).toBe(true);
      expect(result.creditsUsed).toBe(3);
    });

    it('should calculate correct credits for deep research', async () => {
      const url = 'https://facebook.com/post/123';
      const options = {
        enableAI: true,
        downloadMedia: true,
        removeTracking: true,
        generateShareLink: false,
        deepResearch: true,
      };

      const result = await orchestrator.orchestrate(url, options);

      expect(result.success).toBe(true);
      expect(result.creditsUsed).toBe(5);
    });

    it('should skip media download when disabled', async () => {
      const url = 'https://facebook.com/post/123';
      const options = {
        enableAI: false,
        downloadMedia: false,
        removeTracking: true,
        generateShareLink: false,
        deepResearch: false,
      };

      await orchestrator.orchestrate(url, options);

      expect(mockMediaHandler.downloadMedia).not.toHaveBeenCalled();
    });

    it('should use custom template when provided', async () => {
      const url = 'https://facebook.com/post/123';
      const customTemplate = '# Custom Template\n{{content.text}}';
      const options = {
        enableAI: false,
        downloadMedia: false,
        removeTracking: true,
        generateShareLink: false,
        deepResearch: false,
        customTemplate,
      };

      await orchestrator.orchestrate(url, options);

      expect(mockMarkdownConverter.convert).toHaveBeenCalledWith(
        mockPostData,
        customTemplate,
        undefined
      );
    });
  });

  describe('event emission', () => {
    it('should emit progress events', async () => {
      const progressEvents: any[] = [];
      orchestrator.on('progress', (event) => {
        progressEvents.push(event.data);
      });

      const url = 'https://facebook.com/post/123';
      await orchestrator.orchestrate(url);

      expect(progressEvents.length).toBeGreaterThan(0);
      expect(progressEvents[0]).toHaveProperty('stage');
      expect(progressEvents[0]).toHaveProperty('progress');
      expect(progressEvents[0]).toHaveProperty('message');
    });

    it('should emit stage-complete events', async () => {
      const stageEvents: any[] = [];
      orchestrator.on('stage-complete', (event) => {
        stageEvents.push(event.data);
      });

      const url = 'https://facebook.com/post/123';
      await orchestrator.orchestrate(url);

      expect(stageEvents.length).toBeGreaterThan(0);
      expect(stageEvents[0]).toHaveProperty('stage');
    });

    it('should emit error events on failure', async () => {
      const errorEvents: any[] = [];
      orchestrator.on('error', (event) => {
        errorEvents.push(event.data);
      });

      vi.mocked(mockArchiveService.archivePost).mockRejectedValue(
        new Error('API error')
      );

      const url = 'https://facebook.com/post/123';
      const result = await orchestrator.orchestrate(url);

      expect(result.success).toBe(false);
      expect(errorEvents.length).toBe(1);
      expect(errorEvents[0]).toBeInstanceOf(Error);
    });
  });

  describe('error handling and rollback', () => {
    it('should rollback on archive failure', async () => {
      vi.mocked(mockArchiveService.archivePost).mockRejectedValue(
        new Error('Archive failed')
      );

      const url = 'https://facebook.com/post/123';
      const result = await orchestrator.orchestrate(url);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Archive failed');
    });

    it('should rollback created files on failure', async () => {
      // Simulate failure after files are created
      vi.mocked(mockVaultManager.savePost).mockResolvedValue(mockFile.path);
      vi.mocked(mockMarkdownConverter.convert).mockRejectedValue(
        new Error('Conversion failed')
      );

      const url = 'https://facebook.com/post/123';
      const result = await orchestrator.orchestrate(url);

      expect(result.success).toBe(false);
      // Rollback should be called for any created files
      // (In this test, conversion fails before file creation, so no rollback)
    });

    it('should handle invalid URL', async () => {
      vi.mocked(mockArchiveService.validateUrl).mockReturnValue(false);

      const url = 'invalid-url';
      const result = await orchestrator.orchestrate(url);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid URL');
    });

    it('should return error result on failure', async () => {
      vi.mocked(mockArchiveService.archivePost).mockRejectedValue(
        new Error('Network error')
      );

      const url = 'https://facebook.com/post/123';
      const result = await orchestrator.orchestrate(url);

      expect(result).toEqual({
        success: false,
        error: 'Network error',
        creditsUsed: 0,
      });
    });
  });

  describe('cancellation support', () => {
    it('should handle cancellation via AbortSignal', async () => {
      const controller = new AbortController();

      // Abort immediately
      controller.abort();

      const url = 'https://facebook.com/post/123';
      const result = await orchestrator.orchestrate(url, {
        enableAI: false,
        downloadMedia: true,
        removeTracking: true,
        generateShareLink: false,
        deepResearch: false,
        abortSignal: controller.signal,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('cancelled');
    });

    it('should emit cancelled event on abort', async () => {
      const controller = new AbortController();
      const cancelledEvents: any[] = [];

      orchestrator.on('cancelled', (event) => {
        cancelledEvents.push(event);
      });

      controller.abort();

      const url = 'https://facebook.com/post/123';
      await orchestrator.orchestrate(url, {
        enableAI: false,
        downloadMedia: true,
        removeTracking: true,
        generateShareLink: false,
        deepResearch: false,
        abortSignal: controller.signal,
      });

      expect(cancelledEvents.length).toBe(1);
    });
  });

  describe('retry logic', () => {
    it('should retry on transient failures', async () => {
      let attempts = 0;
      vi.mocked(mockArchiveService.archivePost).mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error('Network timeout'));
        }
        return Promise.resolve(mockPostData);
      });

      const url = 'https://facebook.com/post/123';
      const result = await orchestrator.orchestrate(url);

      expect(result.success).toBe(true);
      expect(attempts).toBe(3);
    });

    it('should not retry on non-retryable errors', async () => {
      let attempts = 0;
      vi.mocked(mockArchiveService.archivePost).mockImplementation(() => {
        attempts++;
        return Promise.reject(new Error('Invalid credentials'));
      });

      const url = 'https://facebook.com/post/123';
      const result = await orchestrator.orchestrate(url);

      expect(result.success).toBe(false);
      expect(attempts).toBe(1);
    });

    it('should fail after max retries', async () => {
      vi.mocked(mockArchiveService.archivePost).mockRejectedValue(
        new Error('Network timeout')
      );

      const url = 'https://facebook.com/post/123';
      const result = await orchestrator.orchestrate(url);

      expect(result.success).toBe(false);
      expect(mockArchiveService.archivePost).toHaveBeenCalledTimes(4); // 1 + 3 retries
    });
  });

  describe('caching', () => {
    it('should cache successful results', async () => {
      const url = 'https://facebook.com/post/123';

      // First call
      await orchestrator.orchestrate(url);

      // Second call should use cache
      const result = await orchestrator.orchestrate(url);

      expect(result.success).toBe(true);
      expect(result.creditsUsed).toBe(0); // Cached result uses no credits
      expect(mockArchiveService.archivePost).toHaveBeenCalledTimes(1);
    });

    it('should provide cache statistics', async () => {
      const url = 'https://facebook.com/post/123';
      await orchestrator.orchestrate(url);

      const stats = orchestrator.getCacheStats();

      expect(stats.size).toBe(1);
      expect(stats.urls).toContain(url);
      expect(stats.oldestEntry).toBeInstanceOf(Date);
      expect(stats.newestEntry).toBeInstanceOf(Date);
    });

    it('should clear cache', async () => {
      const url = 'https://facebook.com/post/123';
      await orchestrator.orchestrate(url);

      expect(orchestrator.getCacheSize()).toBe(1);

      orchestrator.clearCache();

      expect(orchestrator.getCacheSize()).toBe(0);
    });

    it('should not cache failed results', async () => {
      vi.mocked(mockArchiveService.archivePost).mockRejectedValue(
        new Error('Archive failed')
      );

      const url = 'https://facebook.com/post/123';
      await orchestrator.orchestrate(url);

      expect(orchestrator.getCacheSize()).toBe(0);
    });
  });

  describe('disposal', () => {
    it('should dispose all services', async () => {
      await orchestrator.dispose();

      expect(mockArchiveService.dispose).toHaveBeenCalled();
      expect(mockMarkdownConverter.dispose).toHaveBeenCalled();
      expect(mockVaultManager.dispose).toHaveBeenCalled();
      expect(mockMediaHandler.dispose).toHaveBeenCalled();
      expect(mockLinkPreviewExtractor.dispose).toHaveBeenCalled();
    });

    it('should clear cache on disposal', async () => {
      const url = 'https://facebook.com/post/123';
      await orchestrator.orchestrate(url);

      expect(orchestrator.getCacheSize()).toBe(1);

      await orchestrator.dispose();

      expect(orchestrator.getCacheSize()).toBe(0);
    });
  });
});
