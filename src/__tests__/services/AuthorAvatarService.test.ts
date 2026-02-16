import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthorAvatarService } from '@/services/AuthorAvatarService';
import type { Vault, TFile, TFolder } from 'obsidian';
import type { SocialArchiverSettings } from '@/types/settings';
import { DEFAULT_SETTINGS } from '@/types/settings';

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

// Create mock settings
const createMockSettings = (overrides: Partial<SocialArchiverSettings> = {}): SocialArchiverSettings => ({
  ...DEFAULT_SETTINGS,
  ...overrides,
});

// Create mock Vault
const createMockVault = () => {
  const files = new Map<string, TFile>();
  const folders = new Set<string>();

  const mockAdapter = {
    exists: vi.fn(async (path: string) => files.has(path)),
  };

  const mockVault = {
    adapter: mockAdapter,
    getFolderByPath: vi.fn((path: string) => {
      if (folders.has(path)) {
        return { path, name: path.split('/').pop() || '', children: [] };
      }
      return null;
    }),
    getAbstractFileByPath: vi.fn((path: string) => {
      return files.get(path) || null;
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

  return { mockVault, files, folders, mockAdapter };
};

// Create mock image data with JPEG magic bytes
const createMockJpegData = (size: number = 100): ArrayBuffer => {
  const buffer = new ArrayBuffer(size);
  const view = new Uint8Array(buffer);
  // JPEG magic bytes: FF D8 FF
  view[0] = 0xff;
  view[1] = 0xd8;
  view[2] = 0xff;
  return buffer;
};

// Create mock PNG data
const createMockPngData = (size: number = 100): ArrayBuffer => {
  const buffer = new ArrayBuffer(size);
  const view = new Uint8Array(buffer);
  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  view[0] = 0x89;
  view[1] = 0x50;
  view[2] = 0x4e;
  view[3] = 0x47;
  view[4] = 0x0d;
  view[5] = 0x0a;
  view[6] = 0x1a;
  view[7] = 0x0a;
  return buffer;
};

// Create mock WebP data
const createMockWebpData = (size: number = 100): ArrayBuffer => {
  const buffer = new ArrayBuffer(Math.max(size, 12));
  const view = new Uint8Array(buffer);
  // WebP: RIFF....WEBP
  view[0] = 0x52; // R
  view[1] = 0x49; // I
  view[2] = 0x46; // F
  view[3] = 0x46; // F
  view[8] = 0x57; // W
  view[9] = 0x45; // E
  view[10] = 0x42; // B
  view[11] = 0x50; // P
  return buffer;
};

describe('AuthorAvatarService', () => {
  let service: AuthorAvatarService;
  let mockVault: Vault;
  let mockAdapter: { exists: ReturnType<typeof vi.fn> };
  let files: Map<string, TFile>;
  let settings: SocialArchiverSettings;

  beforeEach(() => {
    const vaultSetup = createMockVault();
    mockVault = vaultSetup.mockVault;
    mockAdapter = vaultSetup.mockAdapter;
    files = vaultSetup.files;
    settings = createMockSettings();

    service = new AuthorAvatarService({
      vault: mockVault,
      settings,
      timeout: 5000,
    });

    vi.mocked(fetch).mockReset();
    mockAdapter.exists.mockReset();
  });

  describe('sanitizeFilename', () => {
    it('should remove invalid filesystem characters', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => createMockJpegData(),
      } as Response);
      mockAdapter.exists.mockResolvedValue(false);

      await service.downloadAndSaveAvatar(
        'https://example.com/avatar.jpg',
        'x',
        'user:name/with*invalid|chars',
        false
      );

      expect(mockVault.createBinary).toHaveBeenCalled();
      const calledPath = vi.mocked(mockVault.createBinary).mock.calls[0]![0];
      expect(calledPath).not.toContain(':');
      expect(calledPath).not.toContain('/user');
      expect(calledPath).not.toContain('*');
      expect(calledPath).not.toContain('|');
    });

    it('should replace whitespace with underscore', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => createMockJpegData(),
      } as Response);
      mockAdapter.exists.mockResolvedValue(false);

      await service.downloadAndSaveAvatar(
        'https://example.com/avatar.jpg',
        'instagram',
        'user name with spaces',
        false
      );

      const calledPath = vi.mocked(mockVault.createBinary).mock.calls[0]![0];
      expect(calledPath).toContain('user_name_with_spaces');
    });

    it('should limit filename length to 50 characters', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => createMockJpegData(),
      } as Response);
      mockAdapter.exists.mockResolvedValue(false);

      const longUsername = 'a'.repeat(100);
      await service.downloadAndSaveAvatar(
        'https://example.com/avatar.jpg',
        'tiktok',
        longUsername,
        false
      );

      const calledPath = vi.mocked(mockVault.createBinary).mock.calls[0]![0];
      // Filename format: {platform}-{username}.{ext}
      // The username part should be truncated to 50 chars
      expect(calledPath).toContain('tiktok-' + 'a'.repeat(50));
    });
  });

  describe('duplicate detection', () => {
    it('should skip download if file exists and overwrite=false', async () => {
      const existingPath = 'attachments/social-archives/authors/x-testuser.jpg';
      mockAdapter.exists.mockImplementation(async (path: string) => path === existingPath);

      const result = await service.downloadAndSaveAvatar(
        'https://example.com/avatar.jpg',
        'x',
        'testuser',
        false
      );

      expect(result).toBe(existingPath);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should overwrite if file exists and overwrite=true', async () => {
      const existingPath = 'attachments/social-archives/authors/x-testuser.jpg';
      mockAdapter.exists.mockImplementation(async (path: string) => path === existingPath);
      files.set(existingPath, { path: existingPath } as TFile);

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => createMockJpegData(),
      } as Response);

      await service.downloadAndSaveAvatar(
        'https://example.com/avatar.jpg',
        'x',
        'testuser',
        true
      );

      expect(fetch).toHaveBeenCalled();
      expect(mockVault.delete).toHaveBeenCalled();
      expect(mockVault.createBinary).toHaveBeenCalled();
    });

    it('should check multiple extensions when looking for existing files', async () => {
      const existingPath = 'attachments/social-archives/authors/instagram-testuser.png';
      mockAdapter.exists.mockImplementation(async (path: string) => path === existingPath);

      const result = await service.downloadAndSaveAvatar(
        'https://example.com/avatar.jpg',
        'instagram',
        'testuser',
        false
      );

      // Should find the existing .png file even when downloading .jpg
      expect(result).toBe(existingPath);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('size validation', () => {
    it('should skip download if Content-Length exceeds 10MB', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({
          'content-type': 'image/jpeg',
          'content-length': String(11 * 1024 * 1024), // 11MB
        }),
        arrayBuffer: async () => createMockJpegData(),
      } as Response);
      mockAdapter.exists.mockResolvedValue(false);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await service.downloadAndSaveAvatar(
        'https://example.com/large-avatar.jpg',
        'facebook',
        'testuser',
        false
      );

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Avatar too large')
      );

      consoleSpy.mockRestore();
    });

    it('should allow download if Content-Length is exactly 10MB', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({
          'content-type': 'image/jpeg',
          'content-length': String(10 * 1024 * 1024), // 10MB
        }),
        arrayBuffer: async () => createMockJpegData(100),
      } as Response);
      mockAdapter.exists.mockResolvedValue(false);

      const result = await service.downloadAndSaveAvatar(
        'https://example.com/avatar.jpg',
        'facebook',
        'testuser',
        false
      );

      expect(result).not.toBeNull();
      expect(mockVault.createBinary).toHaveBeenCalled();
    });

    it('should proceed if Content-Length is missing and check actual size', async () => {
      // No content-length header, but actual data is small
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => createMockJpegData(1000),
      } as Response);
      mockAdapter.exists.mockResolvedValue(false);

      const result = await service.downloadAndSaveAvatar(
        'https://example.com/avatar.jpg',
        'facebook',
        'testuser',
        false
      );

      expect(result).not.toBeNull();
    });

    it('should reject if actual data exceeds 10MB even without Content-Length', async () => {
      const largeData = new ArrayBuffer(11 * 1024 * 1024);
      const view = new Uint8Array(largeData);
      view[0] = 0xff;
      view[1] = 0xd8;
      view[2] = 0xff;

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => largeData,
      } as Response);
      mockAdapter.exists.mockResolvedValue(false);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await service.downloadAndSaveAvatar(
        'https://example.com/avatar.jpg',
        'facebook',
        'testuser',
        false
      );

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Avatar too large')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('extension inference', () => {
    it('should infer extension from Content-Type header', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: async () => createMockPngData(),
      } as Response);
      mockAdapter.exists.mockResolvedValue(false);

      await service.downloadAndSaveAvatar(
        'https://example.com/avatar', // No extension in URL
        'x',
        'testuser',
        false
      );

      const calledPath = vi.mocked(mockVault.createBinary).mock.calls[0]![0];
      expect(calledPath).toMatch(/\.png$/);
    });

    it('should infer extension from URL when Content-Type is missing', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({}),
        arrayBuffer: async () => createMockJpegData(),
      } as Response);
      mockAdapter.exists.mockResolvedValue(false);

      await service.downloadAndSaveAvatar(
        'https://example.com/avatar.webp',
        'instagram',
        'testuser',
        false
      );

      const calledPath = vi.mocked(mockVault.createBinary).mock.calls[0]![0];
      expect(calledPath).toMatch(/\.webp$/);
    });

    it('should infer extension from binary magic numbers as fallback', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({}), // No content-type
        arrayBuffer: async () => createMockWebpData(),
      } as Response);
      mockAdapter.exists.mockResolvedValue(false);

      await service.downloadAndSaveAvatar(
        'https://example.com/avatar', // No extension
        'tiktok',
        'testuser',
        false
      );

      const calledPath = vi.mocked(mockVault.createBinary).mock.calls[0]![0];
      expect(calledPath).toMatch(/\.webp$/);
    });

    it('should detect JPEG from magic bytes', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({}),
        arrayBuffer: async () => createMockJpegData(),
      } as Response);
      mockAdapter.exists.mockResolvedValue(false);

      await service.downloadAndSaveAvatar(
        'https://example.com/avatar',
        'facebook',
        'testuser',
        false
      );

      const calledPath = vi.mocked(mockVault.createBinary).mock.calls[0]![0];
      expect(calledPath).toMatch(/\.jpg$/);
    });

    it('should detect PNG from magic bytes', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({}),
        arrayBuffer: async () => createMockPngData(),
      } as Response);
      mockAdapter.exists.mockResolvedValue(false);

      await service.downloadAndSaveAvatar(
        'https://example.com/avatar',
        'linkedin',
        'testuser',
        false
      );

      const calledPath = vi.mocked(mockVault.createBinary).mock.calls[0]![0];
      expect(calledPath).toMatch(/\.png$/);
    });

    it('should default to jpg when extension cannot be determined', async () => {
      // Create data that doesn't match any known magic bytes
      const unknownData = new ArrayBuffer(20);

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({}),
        arrayBuffer: async () => unknownData,
      } as Response);
      mockAdapter.exists.mockResolvedValue(false);

      await service.downloadAndSaveAvatar(
        'https://example.com/avatar',
        'youtube',
        'testuser',
        false
      );

      const calledPath = vi.mocked(mockVault.createBinary).mock.calls[0]![0];
      expect(calledPath).toMatch(/\.jpg$/);
    });
  });

  describe('error handling', () => {
    it('should return null on network failure', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));
      mockAdapter.exists.mockResolvedValue(false);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await service.downloadAndSaveAvatar(
        'https://example.com/avatar.jpg',
        'x',
        'testuser',
        false
      );

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to download avatar')
      );

      consoleSpy.mockRestore();
    });

    it('should return null on HTTP error', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
      } as Response);
      mockAdapter.exists.mockResolvedValue(false);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await service.downloadAndSaveAvatar(
        'https://example.com/avatar.jpg',
        'instagram',
        'testuser',
        false
      );

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch avatar: HTTP 404')
      );

      consoleSpy.mockRestore();
    });

    it('should return null on empty data', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => new ArrayBuffer(0),
      } as Response);
      mockAdapter.exists.mockResolvedValue(false);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await service.downloadAndSaveAvatar(
        'https://example.com/avatar.jpg',
        'tiktok',
        'testuser',
        false
      );

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Empty avatar data')
      );

      consoleSpy.mockRestore();
    });

    it('should return null on invalid MIME type', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'text/html' }),
        arrayBuffer: async () => createMockJpegData(),
      } as Response);
      mockAdapter.exists.mockResolvedValue(false);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await service.downloadAndSaveAvatar(
        'https://example.com/avatar.jpg',
        'facebook',
        'testuser',
        false
      );

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid MIME type')
      );

      consoleSpy.mockRestore();
    });

    it('should return null on missing URL', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await service.downloadAndSaveAvatar(
        '',
        'x',
        'testuser',
        false
      );

      expect(result).toBeNull();
      expect(fetch).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should return null on missing username', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await service.downloadAndSaveAvatar(
        'https://example.com/avatar.jpg',
        'x',
        '',
        false
      );

      expect(result).toBeNull();
      expect(fetch).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should preserve original URL in logs on failure', async () => {
      const originalUrl = 'https://example.com/avatar.jpg';
      vi.mocked(fetch).mockRejectedValue(new Error('Test error'));
      mockAdapter.exists.mockResolvedValue(false);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await service.downloadAndSaveAvatar(originalUrl, 'x', 'testuser', false);

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('settings integration', () => {
    it('should use mediaPath from settings', async () => {
      const customSettings = createMockSettings({ mediaPath: 'custom/media/path' });
      const customService = new AuthorAvatarService({
        vault: mockVault,
        settings: customSettings,
        timeout: 5000,
      });

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => createMockJpegData(),
      } as Response);
      mockAdapter.exists.mockResolvedValue(false);

      await customService.downloadAndSaveAvatar(
        'https://example.com/avatar.jpg',
        'x',
        'testuser',
        false
      );

      const calledPath = vi.mocked(mockVault.createBinary).mock.calls[0]![0];
      expect(calledPath).toContain('custom/media/path/authors/');
    });

    it('should use default mediaPath if not set', async () => {
      const defaultSettings = createMockSettings({ mediaPath: '' });
      const defaultService = new AuthorAvatarService({
        vault: mockVault,
        settings: defaultSettings,
        timeout: 5000,
      });

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => createMockJpegData(),
      } as Response);
      mockAdapter.exists.mockResolvedValue(false);

      await defaultService.downloadAndSaveAvatar(
        'https://example.com/avatar.jpg',
        'x',
        'testuser',
        false
      );

      const calledPath = vi.mocked(mockVault.createBinary).mock.calls[0]![0];
      expect(calledPath).toContain('attachments/social-archives/authors/');
    });

    it('should allow updating settings at runtime', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => createMockJpegData(),
      } as Response);
      mockAdapter.exists.mockResolvedValue(false);

      // First download with default settings
      await service.downloadAndSaveAvatar(
        'https://example.com/avatar1.jpg',
        'x',
        'user1',
        false
      );

      // Update settings
      const newSettings = createMockSettings({ mediaPath: 'new/path' });
      service.updateSettings(newSettings);

      // Second download should use new path
      await service.downloadAndSaveAvatar(
        'https://example.com/avatar2.jpg',
        'x',
        'user2',
        false
      );

      const calls = vi.mocked(mockVault.createBinary).mock.calls;
      expect(calls[0]![0]).toContain('attachments/social-archives/authors/');
      expect(calls[1]![0]).toContain('new/path/authors/');
    });
  });

  describe('path generation', () => {
    it('should generate correct path format: {mediaPath}/authors/{platform}-{username}.{ext}', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: async () => createMockPngData(),
      } as Response);
      mockAdapter.exists.mockResolvedValue(false);

      await service.downloadAndSaveAvatar(
        'https://example.com/avatar.png',
        'instagram',
        'john_doe',
        false
      );

      const calledPath = vi.mocked(mockVault.createBinary).mock.calls[0]![0];
      expect(calledPath).toBe('attachments/social-archives/authors/instagram-john_doe.png');
    });

    it('should create parent folders', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => createMockJpegData(),
      } as Response);
      mockAdapter.exists.mockResolvedValue(false);

      await service.downloadAndSaveAvatar(
        'https://example.com/avatar.jpg',
        'x',
        'testuser',
        false
      );

      expect(mockVault.createFolder).toHaveBeenCalled();
    });
  });

  describe('utility methods', () => {
    it('avatarExists should return true if avatar file exists', async () => {
      const existingPath = 'attachments/social-archives/authors/x-testuser.jpg';
      mockAdapter.exists.mockImplementation(async (path: string) => path === existingPath);

      const exists = await service.avatarExists('x', 'testuser');

      expect(exists).toBe(true);
    });

    it('avatarExists should return false if avatar does not exist', async () => {
      mockAdapter.exists.mockResolvedValue(false);

      const exists = await service.avatarExists('x', 'nonexistent');

      expect(exists).toBe(false);
    });

    it('getAvatarPath should return path if avatar exists', async () => {
      const existingPath = 'attachments/social-archives/authors/instagram-testuser.webp';
      mockAdapter.exists.mockImplementation(async (path: string) => path === existingPath);

      const path = await service.getAvatarPath('instagram', 'testuser');

      expect(path).toBe(existingPath);
    });

    it('getAvatarPath should return null if avatar does not exist', async () => {
      mockAdapter.exists.mockResolvedValue(false);

      const path = await service.getAvatarPath('tiktok', 'nonexistent');

      expect(path).toBeNull();
    });

    it('deleteAvatar should delete existing avatar', async () => {
      const existingPath = 'attachments/social-archives/authors/x-testuser.jpg';
      mockAdapter.exists.mockImplementation(async (path: string) => path === existingPath);
      files.set(existingPath, { path: existingPath } as TFile);

      const result = await service.deleteAvatar('x', 'testuser');

      expect(result).toBe(true);
      expect(mockVault.delete).toHaveBeenCalled();
    });

    it('deleteAvatar should return false if avatar does not exist', async () => {
      mockAdapter.exists.mockResolvedValue(false);

      const result = await service.deleteAvatar('x', 'nonexistent');

      expect(result).toBe(false);
      expect(mockVault.delete).not.toHaveBeenCalled();
    });
  });
});
