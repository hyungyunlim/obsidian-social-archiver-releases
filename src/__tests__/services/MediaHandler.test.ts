import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MediaHandler } from '@/services/MediaHandler';
import type { Vault, TFile, TFolder } from 'obsidian';
import type { Media, Platform } from '@/types/post';

// Mock Obsidian's normalizePath function
vi.mock('obsidian', async () => {
  const actual = await vi.importActual<typeof import('obsidian')>('obsidian');
  return {
    ...actual,
    normalizePath: (path: string) => path.replace(/\\/g, '/').replace(/\/+/g, '/'),
  };
});

// Mock fetch
global.fetch = vi.fn();

// Mock Vault
const createMockVault = () => {
  const files = new Map<string, TFile>();
  const folders = new Set<string>();

  const mockVault = {
    getFolderByPath: vi.fn((path: string) => {
      if (folders.has(path)) {
        return { path, name: path.split('/').pop() || '', children: [] };
      }
      return null;
    }),
    createFolder: vi.fn(async (path: string) => {
      folders.add(path);
      return { path, name: path.split('/').pop() || '', children: [] } as TFolder;
    }),
    createBinary: vi.fn(async (path: string, data: ArrayBuffer) => {
      const file = {
        path,
        name: path.split('/').pop() || '',
        basename: path.split('/').pop()?.split('.')[0] || '',
        extension: path.split('.').pop() || '',
        stat: { ctime: Date.now(), mtime: Date.now(), size: data.byteLength },
        vault: mockVault,
      } as unknown as TFile;
      files.set(path, file);
      return file;
    }),
    delete: vi.fn(async (file: TFile) => {
      files.delete(file.path);
    }),
  } as unknown as Vault;

  return { mockVault, files, folders };
};

describe('MediaHandler', () => {
  let mediaHandler: MediaHandler;
  let mockVault: Vault;

  const mockImageData = new ArrayBuffer(100);
  const mockVideoData = new ArrayBuffer(200);

  beforeEach(() => {
    const { mockVault: vault } = createMockVault();
    mockVault = vault;
    mediaHandler = new MediaHandler({
      vault: mockVault,
      maxConcurrent: 2,
      timeout: 5000,
    });

    // Reset fetch mock
    vi.mocked(fetch).mockReset();
  });

  describe('initialization', () => {
    it('should initialize without errors', async () => {
      await expect(mediaHandler.initialize()).resolves.not.toThrow();
    });
  });

  describe('downloadMedia', () => {
    it('should download single media file', async () => {
      const media: Media[] = [
        {
          type: 'image',
          url: 'https://example.com/image.jpg',
        },
      ];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: async () => mockImageData,
      } as Response);

      const results = await mediaHandler.downloadMedia(
        media,
        'facebook',
        'post-123',
        'testuser'
      );

      expect(results).toHaveLength(1);
      expect(results[0].originalUrl).toBe('https://example.com/image.jpg');
      expect(results[0].type).toBe('image');
      expect(results[0].size).toBe(100);
      expect(mockVault.createBinary).toHaveBeenCalled();
    });

    it('should download multiple media files', async () => {
      const media: Media[] = [
        { type: 'image', url: 'https://example.com/image1.jpg' },
        { type: 'image', url: 'https://example.com/image2.jpg' },
        { type: 'video', url: 'https://example.com/video.mp4' },
      ];

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => mockImageData,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => mockImageData,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => mockVideoData,
        } as Response);

      const results = await mediaHandler.downloadMedia(
        media,
        'facebook',
        'post-123',
        'testuser'
      );

      expect(results).toHaveLength(3);
      expect(results[0].type).toBe('image');
      expect(results[1].type).toBe('image');
      expect(results[2].type).toBe('video');
    });

    it('should call progress callback', async () => {
      const media: Media[] = [
        { type: 'image', url: 'https://example.com/image1.jpg' },
        { type: 'image', url: 'https://example.com/image2.jpg' },
      ];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: async () => mockImageData,
      } as Response);

      const onProgress = vi.fn();

      await mediaHandler.downloadMedia(
        media,
        'facebook',
        'post-123',
        'testuser',
        onProgress
      );

      expect(onProgress).toHaveBeenCalledWith(1, 2);
      expect(onProgress).toHaveBeenCalledWith(2, 2);
    });

    it('should respect concurrency limit', async () => {
      const media: Media[] = [
        { type: 'image', url: 'https://example.com/image1.jpg' },
        { type: 'image', url: 'https://example.com/image2.jpg' },
        { type: 'image', url: 'https://example.com/image3.jpg' },
      ];

      let activeDownloads = 0;
      let maxConcurrent = 0;

      vi.mocked(fetch).mockImplementation(async () => {
        activeDownloads++;
        maxConcurrent = Math.max(maxConcurrent, activeDownloads);
        await new Promise(resolve => setTimeout(resolve, 10));
        activeDownloads--;
        return {
          ok: true,
          arrayBuffer: async () => mockImageData,
        } as Response;
      });

      await mediaHandler.downloadMedia(media, 'facebook', 'post-123', 'testuser');

      expect(maxConcurrent).toBeLessThanOrEqual(2); // maxConcurrent = 2
    });

    it('should create parent folders', async () => {
      const media: Media[] = [
        { type: 'image', url: 'https://example.com/image.jpg' },
      ];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: async () => mockImageData,
      } as Response);

      await mediaHandler.downloadMedia(media, 'facebook', 'post-123', 'testuser');

      expect(mockVault.createFolder).toHaveBeenCalled();
    });

    it('should handle download errors', async () => {
      const media: Media[] = [
        { type: 'image', url: 'https://example.com/image.jpg' },
      ];

      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response);

      await expect(
        mediaHandler.downloadMedia(media, 'facebook', 'post-123', 'testuser')
      ).rejects.toThrow(/Failed to download media/);
    });

    it('should handle network errors', async () => {
      const media: Media[] = [
        { type: 'image', url: 'https://example.com/image.jpg' },
      ];

      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      await expect(
        mediaHandler.downloadMedia(media, 'facebook', 'post-123', 'testuser')
      ).rejects.toThrow(/Failed to download media/);
    });

    it('should handle timeout', async () => {
      const media: Media[] = [
        { type: 'image', url: 'https://example.com/image.jpg' },
      ];

      vi.mocked(fetch).mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => {
              const error = new Error('AbortError');
              error.name = 'AbortError';
              reject(error);
            }, 100);
          })
      );

      await expect(
        mediaHandler.downloadMedia(media, 'facebook', 'post-123', 'testuser')
      ).rejects.toThrow(/Download timeout/);
    });
  });

  describe('media type detection', () => {
    it('should detect image by extension', async () => {
      const media: Media[] = [
        { type: 'image', url: 'https://example.com/photo.jpg' },
      ];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: async () => mockImageData,
      } as Response);

      const results = await mediaHandler.downloadMedia(
        media,
        'facebook',
        'post-123',
        'testuser'
      );

      expect(results[0].type).toBe('image');
    });

    it('should detect video by extension', async () => {
      const media: Media[] = [
        { type: 'video', url: 'https://example.com/video.mp4' },
      ];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: async () => mockVideoData,
      } as Response);

      const results = await mediaHandler.downloadMedia(
        media,
        'facebook',
        'post-123',
        'testuser'
      );

      expect(results[0].type).toBe('video');
    });

    it('should detect audio by extension', async () => {
      const media: Media[] = [
        { type: 'audio', url: 'https://example.com/audio.mp3' },
      ];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(50),
      } as Response);

      const results = await mediaHandler.downloadMedia(
        media,
        'facebook',
        'post-123',
        'testuser'
      );

      expect(results[0].type).toBe('audio');
    });

    it('should use MIME type if provided', async () => {
      const media: Media[] = [
        {
          type: 'image',
          url: 'https://example.com/file',
          mimeType: 'image/jpeg',
        },
      ];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: async () => mockImageData,
      } as Response);

      const results = await mediaHandler.downloadMedia(
        media,
        'facebook',
        'post-123',
        'testuser'
      );

      expect(results[0].type).toBe('image');
    });

    it('should default to document for unknown types', async () => {
      const media: Media[] = [
        { type: 'document', url: 'https://example.com/file.unknown' },
      ];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(50),
      } as Response);

      const results = await mediaHandler.downloadMedia(
        media,
        'facebook',
        'post-123',
        'testuser'
      );

      expect(results[0].type).toBe('document');
    });
  });

  describe('path generation', () => {
    it('should generate organized paths', async () => {
      const media: Media[] = [
        { type: 'image', url: 'https://example.com/image.jpg' },
      ];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: async () => mockImageData,
      } as Response);

      const results = await mediaHandler.downloadMedia(
        media,
        'facebook',
        'post-123',
        'testuser'
      );

      expect(results[0].localPath).toContain('attachments/social-archives');
      expect(results[0].localPath).toContain('facebook');
      expect(results[0].localPath).toContain('testuser');
    });

    it('should use custom base path', async () => {
      mediaHandler = new MediaHandler({
        vault: mockVault,
        basePath: 'custom/media',
      });

      const media: Media[] = [
        { type: 'image', url: 'https://example.com/image.jpg' },
      ];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: async () => mockImageData,
      } as Response);

      const results = await mediaHandler.downloadMedia(
        media,
        'facebook',
        'post-123',
        'testuser'
      );

      expect(results[0].localPath).toContain('custom/media');
    });

    it('should sanitize filenames', async () => {
      const media: Media[] = [
        { type: 'image', url: 'https://example.com/image:with*invalid|chars.jpg' },
      ];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: async () => mockImageData,
      } as Response);

      const results = await mediaHandler.downloadMedia(
        media,
        'facebook',
        'post-123',
        'testuser'
      );

      expect(results[0].localPath).not.toContain(':');
      expect(results[0].localPath).not.toContain('*');
      expect(results[0].localPath).not.toContain('|');
    });

    it('should generate fallback filename for URLs without extension', async () => {
      const media: Media[] = [
        { type: 'image', url: 'https://example.com/file' },
      ];

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: async () => mockImageData,
      } as Response);

      const results = await mediaHandler.downloadMedia(
        media,
        'facebook',
        'post-123',
        'testuser'
      );

      expect(results[0].localPath).toMatch(/media-\d+/);
    });
  });

  describe('deleteMedia', () => {
    it('should delete media file', async () => {
      const file = {
        path: 'attachments/image.jpg',
        name: 'image.jpg',
      } as TFile;

      await mediaHandler.deleteMedia(file);

      expect(mockVault.delete).toHaveBeenCalledWith(file);
    });

    it('should throw error if delete fails', async () => {
      const file = { path: 'test.jpg' } as TFile;
      vi.mocked(mockVault.delete).mockRejectedValue(new Error('Delete failed'));

      await expect(mediaHandler.deleteMedia(file)).rejects.toThrow(
        /Failed to delete media/
      );
    });
  });

  describe('getQueueStatus', () => {
    it('should return queue status', () => {
      const status = mediaHandler.getQueueStatus();

      expect(status).toHaveProperty('active');
      expect(status).toHaveProperty('queued');
      expect(status.active).toBe(0);
      expect(status.queued).toBe(0);
    });
  });

  describe('cleanupOrphanedMedia', () => {
    it('should return empty array for dry run', async () => {
      const orphaned = await mediaHandler.cleanupOrphanedMedia(true);

      expect(orphaned).toEqual([]);
    });
  });
});
