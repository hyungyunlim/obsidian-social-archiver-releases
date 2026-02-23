import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VaultManager } from '@/services/VaultManager';
import type { Vault, TFile, TFolder } from 'obsidian';
import type { PostData, Platform } from '@/types/post';
import type { MarkdownResult } from '@/services/MarkdownConverter';

// Mock Obsidian's normalizePath function
vi.mock('obsidian', async () => {
  const actual = await vi.importActual<typeof import('obsidian')>('obsidian');
  return {
    ...actual,
    normalizePath: (path: string) => path.replace(/\\/g, '/').replace(/\/+/g, '/'),
  };
});

// Mock Vault
const createMockVault = () => {
  const files = new Map<string, TFile>();
  const folders = new Set<string>();

  const mockVault = {
    getRoot: vi.fn(() => ({ path: '/', name: '' })),
    getFileByPath: vi.fn((path: string) => files.get(path) || null),
    getFolderByPath: vi.fn((path: string) => {
      if (folders.has(path)) {
        return { path, name: path.split('/').pop() || '', children: [] };
      }
      return null;
    }),
    create: vi.fn(async (path: string, content: string) => {
      const file = {
        path,
        name: path.split('/').pop() || '',
        basename: path.split('/').pop()?.replace('.md', '') || '',
        extension: 'md',
        stat: { ctime: Date.now(), mtime: Date.now(), size: content.length },
        vault: mockVault,
      } as unknown as TFile;
      files.set(path, file);
      return file;
    }),
    createFolder: vi.fn(async (path: string) => {
      folders.add(path);
      return { path, name: path.split('/').pop() || '', children: [] } as TFolder;
    }),
    modify: vi.fn(async (file: TFile, content: string) => {
      files.set(file.path, { ...file, stat: { ...file.stat, mtime: Date.now(), size: content.length } });
    }),
    delete: vi.fn(async (file: TFile) => {
      files.delete(file.path);
    }),
    trash: vi.fn(async (file: TFile) => {
      files.delete(file.path);
    }),
    read: vi.fn(async (file: TFile) => `content of ${file.path}`),
    getFiles: vi.fn(() => Array.from(files.values())),
  } as unknown as Vault;

  return { mockVault, files, folders };
};

describe('VaultManager', () => {
  let vaultManager: VaultManager;
  let mockVault: Vault;

  const mockPostData: PostData = {
    platform: 'facebook' as Platform,
    id: 'test-123',
    url: 'https://facebook.com/post/123',
    author: {
      name: 'Test User',
      url: 'https://facebook.com/user/test',
    },
    content: {
      text: 'This is a test post',
    },
    media: [],
    metadata: {
      timestamp: new Date('2024-01-15T10:30:00Z'),
    },
  };

  const mockMarkdown: MarkdownResult = {
    frontmatter: {
      share: false,
      platform: 'facebook',
      author: 'Test User',
      authorUrl: 'https://facebook.com/user/test',
      originalUrl: 'https://facebook.com/post/123',
      archived: '2025-10-28',
      lastModified: '2025-10-28',
      tags: ['social/facebook'],
    },
    content: '# Test Post\n\nThis is content',
    fullDocument: '---\nplatform: facebook\n---\n\n# Test Post\n\nThis is content',
  };

  beforeEach(() => {
    const { mockVault: vault } = createMockVault();
    mockVault = vault;
    vaultManager = new VaultManager({ vault: mockVault });
  });

  describe('initialization', () => {
    it('should initialize successfully when vault is accessible', async () => {
      await expect(vaultManager.initialize()).resolves.not.toThrow();
      expect(mockVault.getRoot).toHaveBeenCalled();
    });

    it('should throw error when vault is not accessible', async () => {
      vi.mocked(mockVault.getRoot).mockImplementation(() => {
        throw new Error('Vault not accessible');
      });

      await expect(vaultManager.initialize()).rejects.toThrow('Vault is not accessible');
    });
  });

  describe('savePost', () => {
    it('should save post to vault with correct path structure', async () => {
      const path = await vaultManager.savePost(mockPostData, mockMarkdown);

      expect(path).toContain('Social Archives');
      expect(path).toContain('Facebook');
      expect(path).toContain('2024');
      expect(path).toContain('01'); // January
      expect(path).toContain('.md');
      expect(mockVault.create).toHaveBeenCalled();
    });

    it('should create parent folders before saving file', async () => {
      await vaultManager.savePost(mockPostData, mockMarkdown);

      expect(mockVault.createFolder).toHaveBeenCalled();
    });

    it('should generate unique path if file already exists', async () => {
      // First save
      const path1 = await vaultManager.savePost(mockPostData, mockMarkdown);

      // Second save with same data
      const path2 = await vaultManager.savePost(mockPostData, mockMarkdown);

      expect(path1).not.toBe(path2);
      expect(path2).toContain(' 1.md');
    });

    it('should sanitize invalid filename characters', async () => {
      const postWithInvalidChars = {
        ...mockPostData,
        author: { ...mockPostData.author, name: 'User/With\\Invalid:Chars*' },
        content: { text: 'Post with "quotes" and <brackets>' },
      };

      const path = await vaultManager.savePost(postWithInvalidChars, mockMarkdown);

      // Extract filename from path (the path will contain '/' as directory separators)
      const filename = path.split('/').pop() || '';

      // Check that the filename doesn't contain invalid characters
      expect(filename).not.toContain('\\');
      expect(filename).not.toContain(':');
      expect(filename).not.toContain('*');
      expect(filename).not.toContain('"');
      expect(filename).not.toContain('<');
      expect(filename).not.toContain('>');
    });

    it('should truncate long titles', async () => {
      const postWithLongTitle = {
        ...mockPostData,
        content: {
          text: 'This is a very long title that exceeds fifty characters and should be truncated properly',
        },
      };

      const path = await vaultManager.savePost(postWithLongTitle, mockMarkdown);
      const filename = path.split('/').pop() || '';

      expect(filename.length).toBeLessThan(200);
      expect(filename).toContain('...');
    });
  });

  describe('path organization strategies', () => {
    it('should organize by platform when strategy is "platform"', async () => {
      vaultManager = new VaultManager({
        vault: mockVault,
        organizationStrategy: 'platform',
      });

      const path = await vaultManager.savePost(mockPostData, mockMarkdown);

      expect(path).toContain('Facebook/2024/01');
    });

    it('should organize by platform only when strategy is "platform-only"', async () => {
      vaultManager = new VaultManager({
        vault: mockVault,
        organizationStrategy: 'platform-only',
      });

      const path = await vaultManager.savePost(mockPostData, mockMarkdown);
      const prefix = 'Social Archives/Facebook/';

      expect(path.startsWith(prefix)).toBe(true);
      expect(path.slice(prefix.length).includes('/')).toBe(false);
    });

    it('should organize by date when strategy is "date"', async () => {
      vaultManager = new VaultManager({
        vault: mockVault,
        organizationStrategy: 'date',
      });

      const path = await vaultManager.savePost(mockPostData, mockMarkdown);

      expect(path).toContain('2024/01/15');
      expect(path).not.toContain('Facebook');
    });

    it('should use flat structure when strategy is "flat"', async () => {
      vaultManager = new VaultManager({
        vault: mockVault,
        organizationStrategy: 'flat',
      });

      const path = await vaultManager.savePost(mockPostData, mockMarkdown);

      const pathParts = path.split('/');
      expect(pathParts.length).toBeLessThanOrEqual(3); // Base folder + filename
    });

    it('should use custom base path', async () => {
      vaultManager = new VaultManager({
        vault: mockVault,
        basePath: 'My Custom Archives',
      });

      const path = await vaultManager.savePost(mockPostData, mockMarkdown);

      expect(path).toContain('My Custom Archives');
    });
  });

  describe('filename template (fileNameFormat)', () => {
    it('should use template when fileNameFormat is provided', async () => {
      vaultManager = new VaultManager({
        vault: mockVault,
        fileNameFormat: '{published_date} {platform}-{slug}-{short_id}',
      });

      const path = await vaultManager.savePost(mockPostData, mockMarkdown);
      const filename = path.split('/').pop() || '';

      expect(filename).toBe('2024-01-15 Facebook-this-is-a-test-post-st-123.md');
    });

    it('should substitute all supported tokens', async () => {
      vaultManager = new VaultManager({
        vault: mockVault,
        fileNameFormat: '{published_date} - {author} - {title} ({short_id})',
      });

      const path = await vaultManager.savePost(mockPostData, mockMarkdown);
      const filename = path.split('/').pop() || '';

      expect(filename).toContain('2024-01-15');
      expect(filename).toContain('Test User');
      expect(filename).toContain('This is a test post');
      expect(filename).toContain('t-123');
    });

    it('should support {post_id} token with full post ID', async () => {
      vaultManager = new VaultManager({
        vault: mockVault,
        fileNameFormat: '{author} - {post_id}',
      });

      const path = await vaultManager.savePost(mockPostData, mockMarkdown);
      const filename = path.split('/').pop() || '';

      expect(filename).toBe('Test User - test-123.md');
    });

    it('should support {platform} token', async () => {
      vaultManager = new VaultManager({
        vault: mockVault,
        fileNameFormat: '{platform} - {title}',
      });

      const path = await vaultManager.savePost(mockPostData, mockMarkdown);
      const filename = path.split('/').pop() || '';

      expect(filename).toContain('Facebook');
    });

    it('should support {slug} token with lowercase hyphenated text', async () => {
      vaultManager = new VaultManager({
        vault: mockVault,
        fileNameFormat: '{slug}',
      });

      const path = await vaultManager.savePost(mockPostData, mockMarkdown);
      const filename = path.split('/').pop() || '';

      expect(filename).toBe('this-is-a-test-post.md');
    });

    it('should support {shortId} alias for {short_id}', async () => {
      vaultManager = new VaultManager({
        vault: mockVault,
        fileNameFormat: '{author} ({shortId})',
      });

      const path = await vaultManager.savePost(mockPostData, mockMarkdown);
      const filename = path.split('/').pop() || '';

      expect(filename).toContain('t-123');
    });

    it('should leave unknown tokens as literal text after sanitization', async () => {
      vaultManager = new VaultManager({
        vault: mockVault,
        fileNameFormat: '{author} - {unknown_token}',
      });

      const path = await vaultManager.savePost(mockPostData, mockMarkdown);
      const filename = path.split('/').pop() || '';

      // Unknown token braces remain as literal text (sanitized: { and } are kept)
      expect(filename).toContain('Test User');
      expect(filename).toContain('{unknown_token}');
    });

    it('should truncate filename to 200 chars before .md', async () => {
      const longTitlePost = {
        ...mockPostData,
        content: {
          text: 'A'.repeat(300),
        },
      };

      vaultManager = new VaultManager({
        vault: mockVault,
        fileNameFormat: '{title} - {author} - extra text padding to make it longer',
      });

      const path = await vaultManager.savePost(longTitlePost, mockMarkdown);
      const filename = path.split('/').pop() || '';
      const basenameLength = filename.replace('.md', '').length;

      expect(basenameLength).toBeLessThanOrEqual(200);
    });

    it('should fallback to default filename if template produces empty result', async () => {
      vaultManager = new VaultManager({
        vault: mockVault,
        fileNameFormat: '   ',
      });

      const path = await vaultManager.savePost(mockPostData, mockMarkdown);
      const filename = path.split('/').pop() || '';

      // Should use default format: "YYYY-MM-DD - author - title (shortId).md"
      expect(filename).toContain('2024-01-15');
      expect(filename).toContain('Test User');
    });

    it('should fallback to default when fileNameFormat is not set', async () => {
      vaultManager = new VaultManager({
        vault: mockVault,
        // no fileNameFormat
      });

      const path = await vaultManager.savePost(mockPostData, mockMarkdown);
      const filename = path.split('/').pop() || '';

      // Default format: "YYYY-MM-DD - author - title (shortId).md"
      expect(filename).toContain('2024-01-15');
      expect(filename).toContain('Test User');
      expect(filename).toContain('t-123');
    });

    it('should support {archived_date} token with current date', async () => {
      const today = new Date().toISOString().slice(0, 10);

      vaultManager = new VaultManager({
        vault: mockVault,
        fileNameFormat: '{archived_date} - {author}',
      });

      const path = await vaultManager.savePost(mockPostData, mockMarkdown);
      const filename = path.split('/').pop() || '';

      expect(filename).toContain(today);
    });

    it('should use postData.title when available (e.g., YouTube)', async () => {
      const youtubePost = {
        ...mockPostData,
        platform: 'youtube' as Platform,
        title: 'My YouTube Video Title',
      };

      vaultManager = new VaultManager({
        vault: mockVault,
        fileNameFormat: '{title} ({short_id})',
      });

      const path = await vaultManager.savePost(youtubePost, mockMarkdown);
      const filename = path.split('/').pop() || '';

      expect(filename).toContain('My YouTube Video Title');
    });

    it('should sanitize invalid characters in template output', async () => {
      const postWithSpecialChars = {
        ...mockPostData,
        author: { ...mockPostData.author, name: 'User:With*Invalid"Chars' },
      };

      vaultManager = new VaultManager({
        vault: mockVault,
        fileNameFormat: '{author} - {title}',
      });

      const path = await vaultManager.savePost(postWithSpecialChars, mockMarkdown);
      const filename = path.split('/').pop() || '';

      expect(filename).not.toContain(':');
      expect(filename).not.toContain('*');
      expect(filename).not.toContain('"');
    });
  });

  describe('updateNote', () => {
    it('should update existing file content', async () => {
      const file = await mockVault.create('test.md', 'old content');
      const newContent = 'new content';

      await vaultManager.updateNote(file, newContent);

      expect(mockVault.modify).toHaveBeenCalledWith(file, newContent);
    });

    it('should throw error if update fails', async () => {
      const file = await mockVault.create('test.md', 'content');
      vi.mocked(mockVault.modify).mockRejectedValue(new Error('Update failed'));

      await expect(vaultManager.updateNote(file, 'new')).rejects.toThrow(
        /Failed to update file/
      );
    });
  });

  describe('fileExists', () => {
    it('should return true for existing files', async () => {
      await mockVault.create('test.md', 'content');

      const exists = await vaultManager.fileExists('test.md');

      expect(exists).toBe(true);
    });

    it('should return false for non-existing files', async () => {
      const exists = await vaultManager.fileExists('nonexistent.md');

      expect(exists).toBe(false);
    });
  });

  describe('createFolderIfNotExists', () => {
    it('should create folder if it does not exist', async () => {
      await vaultManager.createFolderIfNotExists('test/folder');

      expect(mockVault.createFolder).toHaveBeenCalled();
    });

    it('should not create folder if it already exists', async () => {
      await mockVault.createFolder('existing');

      vi.clearAllMocks();
      await vaultManager.createFolderIfNotExists('existing');

      expect(mockVault.createFolder).not.toHaveBeenCalled();
    });

    it('should create parent folders recursively', async () => {
      await vaultManager.createFolderIfNotExists('a/b/c');

      expect(mockVault.createFolder).toHaveBeenCalledWith('a');
      expect(mockVault.createFolder).toHaveBeenCalledWith('a/b');
      expect(mockVault.createFolder).toHaveBeenCalledWith('a/b/c');
    });
  });

  describe('generateUniquePath', () => {
    it('should return original path if file does not exist', async () => {
      const uniquePath = await vaultManager.generateUniquePath('test.md');

      expect(uniquePath).toBe('test.md');
    });

    it('should append number if file exists', async () => {
      await mockVault.create('test.md', 'content');

      const uniquePath = await vaultManager.generateUniquePath('test.md');

      expect(uniquePath).toBe('test 1.md');
    });

    it('should increment number for multiple duplicates', async () => {
      await mockVault.create('test.md', 'content');
      await mockVault.create('test 1.md', 'content');
      await mockVault.create('test 2.md', 'content');

      const uniquePath = await vaultManager.generateUniquePath('test.md');

      expect(uniquePath).toBe('test 3.md');
    });

    it('should generate unique path when a folder exists at the target path', async () => {
      await mockVault.createFolder('test.md');

      const uniquePath = await vaultManager.generateUniquePath('test.md');

      expect(uniquePath).toBe('test 1.md');
    });
  });

  describe('deleteFile', () => {
    it('should delete file from vault', async () => {
      const file = await mockVault.create('test.md', 'content');

      await vaultManager.deleteFile(file);

      expect(mockVault.delete).toHaveBeenCalledWith(file);
    });

    it('should throw error if delete fails', async () => {
      const file = await mockVault.create('test.md', 'content');
      vi.mocked(mockVault.delete).mockRejectedValue(new Error('Delete failed'));

      await expect(vaultManager.deleteFile(file)).rejects.toThrow(
        /Failed to delete file/
      );
    });
  });

  describe('trashFile', () => {
    it('should move file to system trash by default', async () => {
      const file = await mockVault.create('test.md', 'content');

      await vaultManager.trashFile(file);

      expect(mockVault.trash).toHaveBeenCalledWith(file, true);
    });

    it('should move file to local trash when specified', async () => {
      const file = await mockVault.create('test.md', 'content');

      await vaultManager.trashFile(file, false);

      expect(mockVault.trash).toHaveBeenCalledWith(file, false);
    });
  });

  describe('readFile', () => {
    it('should read file content', async () => {
      const file = await mockVault.create('test.md', 'content');

      const content = await vaultManager.readFile(file);

      expect(content).toBe('content of test.md');
      expect(mockVault.read).toHaveBeenCalledWith(file);
    });

    it('should throw error if read fails', async () => {
      const file = await mockVault.create('test.md', 'content');
      vi.mocked(mockVault.read).mockRejectedValue(new Error('Read failed'));

      await expect(vaultManager.readFile(file)).rejects.toThrow(
        /Failed to read file/
      );
    });
  });

  describe('getFileByPath', () => {
    it('should return file if it exists', async () => {
      const file = await mockVault.create('test.md', 'content');

      const result = vaultManager.getFileByPath('test.md');

      expect(result).toBe(file);
    });

    it('should return null if file does not exist', () => {
      const result = vaultManager.getFileByPath('nonexistent.md');

      expect(result).toBeNull();
    });
  });

  describe('getStats', () => {
    it('should return vault statistics', async () => {
      await mockVault.create('file1.md', 'content1');
      await mockVault.create('file2.md', 'longer content');

      const stats = await vaultManager.getStats();

      expect(stats.totalFiles).toBe(2);
      expect(stats.totalSize).toBeGreaterThan(0);
    });
  });
});
