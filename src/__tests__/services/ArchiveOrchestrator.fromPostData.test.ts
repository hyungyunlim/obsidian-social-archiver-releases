import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ArchiveOrchestrator } from '@/services/ArchiveOrchestrator';
import type { ArchiveService } from '@/services/ArchiveService';
import type { MarkdownConverter } from '@/services/MarkdownConverter';
import type { VaultManager } from '@/services/VaultManager';
import type { MediaHandler } from '@/services/MediaHandler';
import type { LinkPreviewExtractor } from '@/services/LinkPreviewExtractor';
import type { PostData } from '@/types/post';
import type { TFile } from 'obsidian';

/**
 * Tests for `orchestrateFromPostData()` — the server-fetch-skipping entry
 * point used by the browser clip deep-link flow.
 * See prd-extension-anonymous-local-mode.md (Phase 1).
 */
describe('ArchiveOrchestrator.orchestrateFromPostData', () => {
  let orchestrator: ArchiveOrchestrator;
  let mockArchiveService: ArchiveService;
  let mockMarkdownConverter: MarkdownConverter;
  let mockVaultManager: VaultManager;
  let mockMediaHandler: MediaHandler;
  let mockLinkPreviewExtractor: LinkPreviewExtractor;

  const notePath = 'Social Archives/Instagram/2026/06/2026-06-01 - Demo User - DEMO123.md';
  const mockFile: TFile = { path: notePath } as TFile;
  const mediaFile: TFile = {
    path: 'attachments/social-archives/instagram/DEMO123/00-image.jpg',
  } as TFile;

  const mockMarkdownResult = {
    frontmatter: { platform: 'instagram' } as Record<string, unknown>,
    content: '# Demo User\n\nHello from a clipped post',
    fullDocument: '---\nplatform: instagram\n---\n\n# Demo User\n\nHello from a clipped post',
  };

  function makePostData(overrides: Partial<PostData> = {}): PostData {
    return {
      platform: 'instagram',
      id: 'DEMO123',
      url: 'https://www.instagram.com/p/DEMO123/',
      author: { name: 'Demo User', url: 'https://www.instagram.com/demo/' },
      content: { text: 'Hello from a clipped post' },
      media: [{ type: 'image', url: 'https://cdn.example.com/img.jpg' }],
      metadata: { timestamp: '2026-06-01T12:00:00.000Z' },
      ...overrides,
    };
  }

  beforeEach(() => {
    mockArchiveService = {
      initialize: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
      isHealthy: vi.fn().mockResolvedValue(true),
      archivePost: vi.fn().mockRejectedValue(new Error('must not be called')),
      detectPlatform: vi.fn().mockReturnValue('instagram'),
      validateUrl: vi.fn().mockReturnValue(true),
    } as unknown as ArchiveService;

    mockMarkdownConverter = {
      initialize: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
      isHealthy: vi.fn().mockResolvedValue(true),
      convert: vi.fn().mockReturnValue(mockMarkdownResult),
      updateFullDocument: vi.fn().mockReturnValue(mockMarkdownResult),
      setFrontmatterSettings: vi.fn(),
      setIncludeHashtagsAsObsidianTags: vi.fn(),
    } as unknown as MarkdownConverter;

    mockVaultManager = {
      initialize: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
      isHealthy: vi.fn().mockResolvedValue(true),
      generateFilePath: vi.fn().mockReturnValue(notePath),
      savePost: vi.fn().mockResolvedValue(notePath),
      getFileByPath: vi.fn().mockReturnValue(mockFile),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    } as unknown as VaultManager;

    mockMediaHandler = {
      initialize: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
      isHealthy: vi.fn().mockResolvedValue(true),
      downloadMedia: vi.fn().mockResolvedValue([
        {
          originalUrl: 'https://cdn.example.com/img.jpg',
          localPath: mediaFile.path,
          type: 'image' as const,
          size: 1024,
          file: mediaFile,
          sourceIndex: 0,
        },
      ]),
      deleteMedia: vi.fn().mockResolvedValue(undefined),
    } as unknown as MediaHandler;

    mockLinkPreviewExtractor = {
      initialize: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
      isHealthy: vi.fn().mockReturnValue(true),
      extractUrls: vi.fn().mockReturnValue([]),
    } as unknown as LinkPreviewExtractor;

    orchestrator = new ArchiveOrchestrator({
      archiveService: mockArchiveService,
      markdownConverter: mockMarkdownConverter,
      vaultManager: mockVaultManager,
      mediaHandler: mockMediaHandler,
      linkPreviewExtractor: mockLinkPreviewExtractor,
      enableCache: true,
      maxRetries: 1,
      retryDelay: 1,
    });
  });

  it('creates a note without any server fetch and consumes no credits', async () => {
    const result = await orchestrator.orchestrateFromPostData(makePostData());

    expect(result.success).toBe(true);
    expect(result.filePath).toBe(notePath);
    expect(result.creditsUsed).toBe(0);
    expect(mockArchiveService.archivePost).not.toHaveBeenCalled();
    expect(mockMarkdownConverter.convert).toHaveBeenCalledTimes(1);
    expect(mockVaultManager.savePost).toHaveBeenCalledTimes(1);
  });

  it('downloads media and rewrites media URLs to local vault paths', async () => {
    const postData = makePostData();
    const result = await orchestrator.orchestrateFromPostData(postData);

    expect(result.success).toBe(true);
    expect(mockMediaHandler.downloadMedia).toHaveBeenCalledTimes(1);
    expect(mockMediaHandler.downloadMedia).toHaveBeenCalledWith(
      [expect.objectContaining({ url: 'https://cdn.example.com/img.jpg' })],
      'instagram',
      'DEMO123',
      'Demo User',
      expect.any(Function)
    );
    expect(postData.media[0]?.url).toBe(mediaFile.path);
  });

  it('skips media download when downloadMedia is false', async () => {
    const result = await orchestrator.orchestrateFromPostData(makePostData(), {
      enableAI: false,
      downloadMedia: false,
      removeTracking: true,
      generateShareLink: false,
      deepResearch: false,
    });

    expect(result.success).toBe(true);
    expect(mockMediaHandler.downloadMedia).not.toHaveBeenCalled();
  });

  it('rejects post data missing identity fields', async () => {
    const result = await orchestrator.orchestrateFromPostData(
      makePostData({ id: '' })
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/requires postData/);
    expect(mockVaultManager.savePost).not.toHaveBeenCalled();
  });

  it('rolls back downloaded media when the vault save fails', async () => {
    (mockVaultManager.savePost as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Disk full')
    );

    const result = await orchestrator.orchestrateFromPostData(makePostData());

    expect(result.success).toBe(false);
    expect(result.error).toBe('Disk full');
    expect(mockMediaHandler.deleteMedia).toHaveBeenCalledWith(mediaFile);
    expect(mockVaultManager.deleteFile).not.toHaveBeenCalled();
  });

  it('reports cancellation when the abort signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await orchestrator.orchestrateFromPostData(makePostData(), {
      enableAI: false,
      downloadMedia: true,
      removeTracking: true,
      generateShareLink: false,
      deepResearch: false,
      abortSignal: controller.signal,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Archive cancelled by user');
    expect(mockVaultManager.savePost).not.toHaveBeenCalled();
  });

  it('keeps orchestrate() behavior intact (regression: shared pipeline extraction)', async () => {
    (mockArchiveService.archivePost as ReturnType<typeof vi.fn>).mockResolvedValue(
      makePostData()
    );

    const result = await orchestrator.orchestrate('https://www.instagram.com/p/DEMO123/');

    expect(result.success).toBe(true);
    expect(result.filePath).toBe(notePath);
    expect(result.creditsUsed).toBe(1);
    expect(mockArchiveService.archivePost).toHaveBeenCalledTimes(1);
    expect(mockVaultManager.savePost).toHaveBeenCalledTimes(1);
  });
});
