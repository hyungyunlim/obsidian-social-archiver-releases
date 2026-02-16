import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { App, Vault, TFile, TFolder, MetadataCache, CachedMetadata } from 'obsidian';
import type { Platform } from '@/types/post';

// Mock Obsidian module with inline class definitions
vi.mock('obsidian', () => {
  class TFile {
    path: string = '';
    name: string = '';
    basename: string = '';
    extension: string = 'md';
    stat = { ctime: Date.now(), mtime: Date.now(), size: 0 };
  }

  class TFolder {
    path: string = '';
    name: string = '';
    children: any[] = [];
  }

  return { TFile, TFolder };
});

// Import after mock is set up
import { AuthorVaultScanner } from '@/services/AuthorVaultScanner';
import { TFile as MockTFile, TFolder as MockTFolder } from 'obsidian';

// Mock PostDataParser
vi.mock('@/components/timeline/parsers/PostDataParser', () => ({
  PostDataParser: vi.fn().mockImplementation(() => ({
    parseFile: vi.fn(),
  })),
}));

import { PostDataParser } from '@/components/timeline/parsers/PostDataParser';

// ============================================================================
// Test Helpers
// ============================================================================

interface MockFileConfig {
  path: string;
  frontmatter?: Record<string, unknown>;
  content?: string;
}

function createMockFile(config: MockFileConfig): TFile {
  const file = new MockTFile();
  file.path = config.path;
  file.name = config.path.split('/').pop() || '';
  file.basename = config.path.split('/').pop()?.replace('.md', '') || '';
  file.extension = 'md';
  file.stat = { ctime: Date.now(), mtime: Date.now(), size: 100 };
  return file as unknown as TFile;
}

function createMockFolder(path: string, children: (TFile | TFolder)[]): TFolder {
  const folder = new MockTFolder();
  folder.path = path;
  folder.name = path.split('/').pop() || path;
  folder.children = children;
  return folder as unknown as TFolder;
}

function createMockApp(options: {
  files: MockFileConfig[];
  archivePath?: string;
}): App {
  const { files, archivePath = 'Social Archives' } = options;
  const fileMap = new Map<string, MockFileConfig>();
  const tFileMap = new Map<string, TFile>();

  files.forEach(f => {
    fileMap.set(f.path, f);
    tFileMap.set(f.path, createMockFile(f));
  });

  const mockMetadataCache: Partial<MetadataCache> = {
    getFileCache: vi.fn((file: TFile): CachedMetadata | null => {
      const config = fileMap.get(file.path);
      if (!config?.frontmatter) return null;
      return { frontmatter: config.frontmatter } as CachedMetadata;
    }),
  };

  // Create archive folder with files as children
  const archiveFiles = files.filter(f => f.path.startsWith(archivePath + '/'));
  const archiveFolder = createMockFolder(
    archivePath,
    archiveFiles.map(f => tFileMap.get(f.path)!)
  );

  const mockVault: Partial<Vault> = {
    getFolderByPath: vi.fn((path: string) => {
      if (path === archivePath) return archiveFolder;
      return null;
    }),
    cachedRead: vi.fn(async (file: TFile) => {
      const config = fileMap.get(file.path);
      return config?.content || '';
    }),
  };

  return {
    vault: mockVault as Vault,
    metadataCache: mockMetadataCache as MetadataCache,
  } as App;
}

// ============================================================================
// Tests
// ============================================================================

describe('AuthorVaultScanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Direct Archives (existing behavior)', () => {
    it('should extract author from direct archive (platform: facebook)', async () => {
      const app = createMockApp({
        files: [
          {
            path: 'Social Archives/facebook/test-post.md',
            frontmatter: {
              platform: 'facebook',
              author: 'John Doe',
              authorUrl: 'https://facebook.com/johndoe',
              authorAvatar: 'https://example.com/avatar.jpg',
              archived: '2024-01-15T10:00:00Z',
            },
          },
        ],
      });

      const scanner = new AuthorVaultScanner({ app });
      const result = await scanner.scanVault();

      expect(result.authors).toHaveLength(1);
      expect(result.authors[0]).toMatchObject({
        authorName: 'John Doe',
        authorUrl: 'https://facebook.com/johndoe',
        platform: 'facebook',
        avatar: 'https://example.com/avatar.jpg',
        sourceType: 'direct',
      });
    });

    it('should skip user-created posts (platform: post) when includeEmbeddedArchives is false', async () => {
      const app = createMockApp({
        files: [
          {
            path: 'Social Archives/posts/my-post.md',
            frontmatter: {
              platform: 'post',
              author: 'Me',
            },
          },
        ],
      });

      const scanner = new AuthorVaultScanner({
        app,
        includeEmbeddedArchives: false, // default
      });
      const result = await scanner.scanVault();

      expect(result.authors).toHaveLength(0);
      expect(result.filesSkipped).toBe(1);
    });

    it('should extract multiple authors from different files', async () => {
      const app = createMockApp({
        files: [
          {
            path: 'Social Archives/facebook/post1.md',
            frontmatter: {
              platform: 'facebook',
              author: 'User One',
              authorUrl: 'https://facebook.com/user1',
            },
          },
          {
            path: 'Social Archives/instagram/post2.md',
            frontmatter: {
              platform: 'instagram',
              author: 'User Two',
              authorUrl: 'https://instagram.com/user2',
            },
          },
        ],
      });

      const scanner = new AuthorVaultScanner({ app });
      const result = await scanner.scanVault();

      expect(result.authors).toHaveLength(2);
      expect(result.totalFilesScanned).toBe(2);
    });
  });

  describe('Embedded Archives', () => {
    it('should extract authors from embedded archives when option enabled', async () => {
      const mockPostData = {
        platform: 'post' as Platform,
        id: 'my-post',
        archivedDate: new Date('2024-01-20'),
        embeddedArchives: [
          {
            platform: 'facebook' as Platform,
            id: 'embedded-1',
            url: 'https://facebook.com/post/123',
            author: {
              name: 'Embedded Author',
              url: 'https://facebook.com/embeddedauthor',
              avatar: 'https://example.com/embedded-avatar.jpg',
            },
            archivedDate: new Date('2024-01-15'),
            content: { text: 'Embedded post content' },
            media: [],
          },
        ],
        author: { name: 'Me', url: '' },
        content: { text: 'My post' },
        media: [],
      };

      // Mock PostDataParser
      const mockParseFile = vi.fn().mockResolvedValue(mockPostData);
      (PostDataParser as any).mockImplementation(() => ({
        parseFile: mockParseFile,
      }));

      const app = createMockApp({
        files: [
          {
            path: 'Social Archives/posts/my-post.md',
            frontmatter: {
              platform: 'post',
              author: 'Me',
            },
            content: '## 📦 Referenced Social Media Posts\n\nSome embedded content',
          },
        ],
      });

      const scanner = new AuthorVaultScanner({
        app,
        includeEmbeddedArchives: true,
      });
      const result = await scanner.scanVault();

      expect(result.authors).toHaveLength(1);
      expect(result.authors[0]).toMatchObject({
        authorName: 'Embedded Author',
        authorUrl: 'https://facebook.com/embeddedauthor',
        platform: 'facebook',
        sourceType: 'embedded',
        sourceFilePath: 'Social Archives/posts/my-post.md',
        embeddedOriginalUrl: 'https://facebook.com/post/123',
      });
    });

    it('should skip files without embedded archives section (performance optimization)', async () => {
      const mockParseFile = vi.fn();
      (PostDataParser as any).mockImplementation(() => ({
        parseFile: mockParseFile,
      }));

      const app = createMockApp({
        files: [
          {
            path: 'Social Archives/posts/simple-post.md',
            frontmatter: {
              platform: 'post',
              author: 'Me',
            },
            content: 'Just a simple post without embedded archives',
          },
        ],
      });

      const scanner = new AuthorVaultScanner({
        app,
        includeEmbeddedArchives: true,
      });
      const result = await scanner.scanVault();

      // PostDataParser should NOT be called for files without embedded section
      expect(mockParseFile).not.toHaveBeenCalled();
      expect(result.authors).toHaveLength(0);
    });

    it('should extract multiple authors from multiple embedded archives', async () => {
      const mockPostData = {
        platform: 'post' as Platform,
        id: 'multi-embed-post',
        archivedDate: new Date('2024-01-20'),
        embeddedArchives: [
          {
            platform: 'facebook' as Platform,
            id: 'fb-embed',
            url: 'https://facebook.com/post/123',
            author: {
              name: 'Facebook Author',
              url: 'https://facebook.com/fbauthor',
            },
            content: { text: 'FB content' },
            media: [],
          },
          {
            platform: 'instagram' as Platform,
            id: 'ig-embed',
            url: 'https://instagram.com/p/abc',
            author: {
              name: 'Instagram Author',
              url: 'https://instagram.com/igauthor',
            },
            content: { text: 'IG content' },
            media: [],
          },
          {
            platform: 'x' as Platform,
            id: 'x-embed',
            url: 'https://x.com/status/789',
            author: {
              name: 'X Author',
              url: 'https://x.com/xauthor',
              handle: '@xauthor',
            },
            content: { text: 'X content' },
            media: [],
          },
        ],
        author: { name: 'Me', url: '' },
        content: { text: 'My post with multiple embeds' },
        media: [],
      };

      const mockParseFile = vi.fn().mockResolvedValue(mockPostData);
      (PostDataParser as any).mockImplementation(() => ({
        parseFile: mockParseFile,
      }));

      const app = createMockApp({
        files: [
          {
            path: 'Social Archives/posts/multi-embed.md',
            frontmatter: {
              platform: 'post',
              author: 'Me',
            },
            content: '## 📦 Referenced Social Media Posts\n\nMultiple embeds here',
          },
        ],
      });

      const scanner = new AuthorVaultScanner({
        app,
        includeEmbeddedArchives: true,
      });
      const result = await scanner.scanVault();

      expect(result.authors).toHaveLength(3);
      expect(result.authors.map(a => a.platform)).toEqual(['facebook', 'instagram', 'x']);
      expect(result.authors.every(a => a.sourceType === 'embedded')).toBe(true);
    });

    it('should detect alternate embedded section heading and normalize handles', async () => {
      const mockPostData = {
        platform: 'post' as Platform,
        id: 'embedded-archives-heading',
        embeddedArchives: [
          {
            platform: 'threads' as Platform,
            id: 'threads-embed',
            url: 'https://threads.net/@someone/post/1',
            author: {
              name: '',
              url: 'https://threads.net/@someone',
              handle: 'someone',
            },
            content: { text: 'Threads content' },
            media: [],
          },
        ],
        author: { name: 'Me', url: '' },
        content: { text: 'Post with alternate heading' },
        media: [],
      };

      const mockParseFile = vi.fn().mockResolvedValue(mockPostData);
      (PostDataParser as any).mockImplementation(() => ({
        parseFile: mockParseFile,
      }));

      const app = createMockApp({
        files: [
          {
            path: 'Social Archives/posts/embedded-archives.md',
            frontmatter: { platform: 'post' },
            content: '## Embedded Archives\n\nContent',
          },
        ],
      });

      const scanner = new AuthorVaultScanner({
        app,
        includeEmbeddedArchives: true,
      });
      const result = await scanner.scanVault();

      expect(result.authors).toHaveLength(1);
      expect(result.authors[0]).toMatchObject({
        authorName: '@someone',
        handle: '@someone',
        platform: 'threads',
      });
    });

    it('should filter out embedded archives with missing author.url', async () => {
      const mockPostData = {
        platform: 'post' as Platform,
        id: 'invalid-embed-post',
        embeddedArchives: [
          {
            platform: 'facebook' as Platform,
            id: 'valid-embed',
            url: 'https://facebook.com/post/123',
            author: {
              name: 'Valid Author',
              url: 'https://facebook.com/validauthor',
            },
            content: { text: 'Valid content' },
            media: [],
          },
          {
            platform: 'instagram' as Platform,
            id: 'invalid-embed',
            author: {
              name: 'Invalid Author',
              url: '', // Empty URL - should be filtered
            },
            content: { text: 'Invalid content' },
            media: [],
          },
          {
            platform: 'x' as Platform,
            id: 'no-url-embed',
            author: {
              name: 'No URL Author',
              // No url field - should be filtered
            },
            content: { text: 'No URL content' },
            media: [],
          },
        ],
        author: { name: 'Me', url: '' },
        content: { text: 'Post with invalid embeds' },
        media: [],
      };

      const mockParseFile = vi.fn().mockResolvedValue(mockPostData);
      (PostDataParser as any).mockImplementation(() => ({
        parseFile: mockParseFile,
      }));

      const app = createMockApp({
        files: [
          {
            path: 'Social Archives/posts/invalid-embed.md',
            frontmatter: { platform: 'post' },
            content: '## 📦 Referenced Social Media Posts\n\nContent',
          },
        ],
      });

      const scanner = new AuthorVaultScanner({
        app,
        includeEmbeddedArchives: true,
      });
      const result = await scanner.scanVault();

      // Only valid embed should be included
      expect(result.authors).toHaveLength(1);
      expect(result.authors[0].authorName).toBe('Valid Author');
    });

    it('should filter out embedded archives with platform: post', async () => {
      const mockPostData = {
        platform: 'post' as Platform,
        id: 'nested-post',
        embeddedArchives: [
          {
            platform: 'post' as Platform, // Should be filtered
            id: 'nested-user-post',
            author: {
              name: 'Nested Post Author',
              url: 'https://example.com/nested',
            },
            content: { text: 'Nested post' },
            media: [],
          },
          {
            platform: 'facebook' as Platform,
            id: 'valid-fb',
            url: 'https://facebook.com/123',
            author: {
              name: 'FB Author',
              url: 'https://facebook.com/fbauthor',
            },
            content: { text: 'FB content' },
            media: [],
          },
        ],
        author: { name: 'Me', url: '' },
        content: { text: 'Post' },
        media: [],
      };

      const mockParseFile = vi.fn().mockResolvedValue(mockPostData);
      (PostDataParser as any).mockImplementation(() => ({
        parseFile: mockParseFile,
      }));

      const app = createMockApp({
        files: [
          {
            path: 'Social Archives/posts/nested.md',
            frontmatter: { platform: 'post' },
            content: '## 📦 Referenced Social Media Posts\n\nContent',
          },
        ],
      });

      const scanner = new AuthorVaultScanner({
        app,
        includeEmbeddedArchives: true,
      });
      const result = await scanner.scanVault();

      // Only facebook embed should be included (platform: post filtered)
      expect(result.authors).toHaveLength(1);
      expect(result.authors[0].platform).toBe('facebook');
    });
  });

  describe('Mixed Direct and Embedded Archives', () => {
    it('should extract both direct and embedded authors in single scan', async () => {
      const mockPostData = {
        platform: 'post' as Platform,
        id: 'user-post',
        embeddedArchives: [
          {
            platform: 'instagram' as Platform,
            id: 'ig-embed',
            url: 'https://instagram.com/p/abc',
            author: {
              name: 'IG Embedded Author',
              url: 'https://instagram.com/igembedded',
            },
            content: { text: 'IG content' },
            media: [],
          },
        ],
        author: { name: 'Me', url: '' },
        content: { text: 'My post' },
        media: [],
      };

      const mockParseFile = vi.fn().mockResolvedValue(mockPostData);
      (PostDataParser as any).mockImplementation(() => ({
        parseFile: mockParseFile,
      }));

      const app = createMockApp({
        files: [
          {
            path: 'Social Archives/facebook/direct-post.md',
            frontmatter: {
              platform: 'facebook',
              author: 'Direct FB Author',
              authorUrl: 'https://facebook.com/directfb',
            },
          },
          {
            path: 'Social Archives/posts/user-post.md',
            frontmatter: {
              platform: 'post',
              author: 'Me',
            },
            content: '## 📦 Referenced Social Media Posts\n\nEmbedded content',
          },
        ],
      });

      const scanner = new AuthorVaultScanner({
        app,
        includeEmbeddedArchives: true,
      });
      const result = await scanner.scanVault();

      expect(result.authors).toHaveLength(2);

      const directAuthor = result.authors.find(a => a.sourceType !== 'embedded');
      const embeddedAuthor = result.authors.find(a => a.sourceType === 'embedded');

      expect(directAuthor).toMatchObject({
        authorName: 'Direct FB Author',
        platform: 'facebook',
      });
      expect(embeddedAuthor).toMatchObject({
        authorName: 'IG Embedded Author',
        platform: 'instagram',
        sourceType: 'embedded',
      });
    });
  });

  describe('Extended Metadata Extraction', () => {
    it('should extract all extended metadata fields from frontmatter', async () => {
      const app = createMockApp({
        files: [
          {
            path: 'Social Archives/x/extended-post.md',
            frontmatter: {
              platform: 'x',
              author: 'Test User',
              authorUrl: 'https://twitter.com/testuser',
              authorHandle: '@testuser',
              authorAvatar: '[[attachments/authors/x-testuser.jpg]]',
              authorFollowers: 50000,
              authorPostsCount: 1200,
              authorBio: 'Software developer',
              authorVerified: true,
              lastMetadataUpdate: '2024-03-15T10:30:00Z',
              archived: '2024-03-15T10:00:00Z',
            },
          },
        ],
      });

      const scanner = new AuthorVaultScanner({ app });
      const result = await scanner.scanVault();

      expect(result.authors).toHaveLength(1);
      expect(result.authors[0]).toMatchObject({
        authorName: 'Test User',
        authorUrl: 'https://twitter.com/testuser',
        platform: 'x',
        handle: '@testuser',
        localAvatar: 'attachments/authors/x-testuser.jpg',
        followers: 50000,
        postsCount: 1200,
        bio: 'Software developer',
        verified: true,
      });
      expect(result.authors[0].lastMetadataUpdate).toBeInstanceOf(Date);
    });

    it('should handle legacy archives without extended fields', async () => {
      const app = createMockApp({
        files: [
          {
            path: 'Social Archives/instagram/legacy-post.md',
            frontmatter: {
              platform: 'instagram',
              author: 'Legacy User',
              authorUrl: 'https://instagram.com/legacyuser',
              archived: '2023-01-01T00:00:00Z',
            },
          },
        ],
      });

      const scanner = new AuthorVaultScanner({ app });
      const result = await scanner.scanVault();

      expect(result.authors).toHaveLength(1);
      expect(result.authors[0]).toMatchObject({
        authorName: 'Legacy User',
        authorUrl: 'https://instagram.com/legacyuser',
        platform: 'instagram',
      });
      // Extended fields should be undefined (not present)
      expect(result.authors[0].localAvatar).toBeUndefined();
      expect(result.authors[0].followers).toBeUndefined();
      expect(result.authors[0].postsCount).toBeUndefined();
      expect(result.authors[0].bio).toBeUndefined();
      expect(result.authors[0].verified).toBeUndefined();
      expect(result.authors[0].lastMetadataUpdate).toBeUndefined();
    });

    describe('wikilink avatar path extraction', () => {
      it('should extract path from wikilink format [[path]]', async () => {
        const app = createMockApp({
          files: [
            {
              path: 'Social Archives/x/wikilink-post.md',
              frontmatter: {
                platform: 'x',
                author: 'Test',
                authorUrl: 'https://twitter.com/test',
                authorAvatar: '[[attachments/authors/x-test.jpg]]',
              },
            },
          ],
        });

        const scanner = new AuthorVaultScanner({ app });
        const result = await scanner.scanVault();

        expect(result.authors[0].localAvatar).toBe('attachments/authors/x-test.jpg');
      });

      it('should extract path from wikilink with alias [[path|alias]]', async () => {
        const app = createMockApp({
          files: [
            {
              path: 'Social Archives/x/wikilink-alias-post.md',
              frontmatter: {
                platform: 'x',
                author: 'Test',
                authorUrl: 'https://twitter.com/test',
                authorAvatar: '[[attachments/authors/x-test.jpg|Avatar]]',
              },
            },
          ],
        });

        const scanner = new AuthorVaultScanner({ app });
        const result = await scanner.scanVault();

        expect(result.authors[0].localAvatar).toBe('attachments/authors/x-test.jpg');
      });

      it('should handle plain path (not wikilink)', async () => {
        const app = createMockApp({
          files: [
            {
              path: 'Social Archives/x/plain-path-post.md',
              frontmatter: {
                platform: 'x',
                author: 'Test',
                authorUrl: 'https://twitter.com/test',
                authorAvatar: 'attachments/authors/x-test.jpg',
              },
            },
          ],
        });

        const scanner = new AuthorVaultScanner({ app });
        const result = await scanner.scanVault();

        expect(result.authors[0].localAvatar).toBe('attachments/authors/x-test.jpg');
      });

      it('should return null for empty/missing authorAvatar', async () => {
        const app = createMockApp({
          files: [
            {
              path: 'Social Archives/x/no-avatar-post.md',
              frontmatter: {
                platform: 'x',
                author: 'Test',
                authorUrl: 'https://twitter.com/test',
              },
            },
          ],
        });

        const scanner = new AuthorVaultScanner({ app });
        const result = await scanner.scanVault();

        expect(result.authors[0].localAvatar).toBeUndefined();
      });
    });

    describe('numeric field extraction', () => {
      it('should handle followers as number', async () => {
        const app = createMockApp({
          files: [
            {
              path: 'Social Archives/x/followers-number.md',
              frontmatter: {
                platform: 'x',
                author: 'Test',
                authorUrl: 'https://twitter.com/test',
                authorFollowers: 12500,
              },
            },
          ],
        });

        const scanner = new AuthorVaultScanner({ app });
        const result = await scanner.scanVault();

        expect(result.authors[0].followers).toBe(12500);
      });

      it('should handle followers as string (parse to number)', async () => {
        const app = createMockApp({
          files: [
            {
              path: 'Social Archives/x/followers-string.md',
              frontmatter: {
                platform: 'x',
                author: 'Test',
                authorUrl: 'https://twitter.com/test',
                authorFollowers: '12500',
              },
            },
          ],
        });

        const scanner = new AuthorVaultScanner({ app });
        const result = await scanner.scanVault();

        expect(result.authors[0].followers).toBe(12500);
      });

      it('should handle zero followers', async () => {
        const app = createMockApp({
          files: [
            {
              path: 'Social Archives/x/zero-followers.md',
              frontmatter: {
                platform: 'x',
                author: 'Test',
                authorUrl: 'https://twitter.com/test',
                authorFollowers: 0,
              },
            },
          ],
        });

        const scanner = new AuthorVaultScanner({ app });
        const result = await scanner.scanVault();

        expect(result.authors[0].followers).toBe(0);
      });
    });

    describe('verified status extraction', () => {
      it('should extract verified: true', async () => {
        const app = createMockApp({
          files: [
            {
              path: 'Social Archives/x/verified-true.md',
              frontmatter: {
                platform: 'x',
                author: 'Test',
                authorUrl: 'https://twitter.com/test',
                authorVerified: true,
              },
            },
          ],
        });

        const scanner = new AuthorVaultScanner({ app });
        const result = await scanner.scanVault();

        expect(result.authors[0].verified).toBe(true);
      });

      it('should not include verified when false', async () => {
        const app = createMockApp({
          files: [
            {
              path: 'Social Archives/x/verified-false.md',
              frontmatter: {
                platform: 'x',
                author: 'Test',
                authorUrl: 'https://twitter.com/test',
                authorVerified: false,
              },
            },
          ],
        });

        const scanner = new AuthorVaultScanner({ app });
        const result = await scanner.scanVault();

        // verified should be undefined (not included) when false
        expect(result.authors[0].verified).toBeUndefined();
      });
    });
  });

  describe('scanFile method', () => {
    it('should return first author for embedded archives', async () => {
      const mockPostData = {
        platform: 'post' as Platform,
        id: 'multi-embed',
        embeddedArchives: [
          {
            platform: 'facebook' as Platform,
            id: 'first',
            url: 'https://facebook.com/1',
            author: { name: 'First', url: 'https://facebook.com/first' },
            content: { text: '' },
            media: [],
          },
          {
            platform: 'instagram' as Platform,
            id: 'second',
            url: 'https://instagram.com/2',
            author: { name: 'Second', url: 'https://instagram.com/second' },
            content: { text: '' },
            media: [],
          },
        ],
        author: { name: 'Me', url: '' },
        content: { text: '' },
        media: [],
      };

      const mockParseFile = vi.fn().mockResolvedValue(mockPostData);
      (PostDataParser as any).mockImplementation(() => ({
        parseFile: mockParseFile,
      }));

      const app = createMockApp({
        files: [
          {
            path: 'Social Archives/posts/multi.md',
            frontmatter: { platform: 'post' },
            content: '## 📦 Referenced Social Media Posts\n\nContent',
          },
        ],
      });

      const scanner = new AuthorVaultScanner({
        app,
        includeEmbeddedArchives: true,
      });

      const file = createMockFile({
        path: 'Social Archives/posts/multi.md',
        frontmatter: { platform: 'post' },
        content: '## 📦 Referenced Social Media Posts\n\nContent',
      });
      const author = await scanner.scanFile(file);

      // Should return only the first embedded author
      expect(author).not.toBeNull();
      expect(author?.authorName).toBe('First');
    });
  });
});
