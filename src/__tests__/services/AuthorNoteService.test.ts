/**
 * AuthorNoteService Tests
 *
 * Tests for:
 *   - buildAuthorKey: URL-based keys, name-based fallback, empty URL fallback
 *   - generateFilename: handle-based, name-based, special char sanitization
 *   - updateNote merge rules: user-owned fields preserved, plugin-managed updated
 *   - Legacy key promotion: name-based -> URL-based when URL becomes available
 *   - Body preservation: createNote scaffold, updateNote frontmatter-only
 *   - Key generation consistency: deterministic output, URL normalization
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthorNoteService } from '@/services/AuthorNoteService';
import {
  AUTHOR_NOTE_TYPE,
  AUTHOR_NOTE_VERSION,
  USER_OWNED_FIELDS,
} from '@/types/author-note';
import type { AuthorNoteData } from '@/types/author-note';
import { TFile, TFolder } from 'obsidian';
import type { App, MetadataCache, FileManager } from 'obsidian';

// ============================================================================
// Mock factories
// ============================================================================

/** Helper to create a proper TFile mock that passes instanceof checks */
function makeTFile(path: string): TFile {
  return new TFile(path);
}

/** Helper to create a proper TFolder mock that passes instanceof checks */
function makeTFolder(path: string, children: Array<TFile | TFolder> = []): TFolder {
  return new TFolder(path, children);
}

/**
 * Set up a mock App with interconnected vault, metadataCache, and fileManager.
 *
 * For tests that need the index (findNoteByKey, upsertFromArchive update path),
 * callers must:
 *   1. Add TFile instances to `files` map
 *   2. Add frontmatter entries to `fileCacheMap`
 *   3. Set up a TFolder with those TFile children in `folderMap`
 *   4. Call `service.invalidateIndex()` to force rebuild
 */
function createMockApp() {
  const files = new Map<string, TFile>();
  const folderMap = new Map<string, TFolder>();
  const fileCacheMap = new Map<string, { frontmatter: Record<string, unknown> }>();
  const fileContentMap = new Map<string, string>();

  const mockApp = {
    vault: {
      create: vi.fn(async (path: string, _content: string) => {
        const file = makeTFile(path);
        files.set(path, file);
        fileContentMap.set(path, _content);
        return file;
      }),
      getFileByPath: vi.fn((path: string) => files.get(path) || null),
      getFolderByPath: vi.fn((path: string) => folderMap.get(path) || null),
      createFolder: vi.fn(async (path: string) => {
        const folder = makeTFolder(path);
        folderMap.set(path, folder);
        return folder;
      }),
      cachedRead: vi.fn(async (file: TFile) => fileContentMap.get(file.path) || ''),
    },
    metadataCache: {
      getFileCache: vi.fn((file: TFile) => {
        return fileCacheMap.get(file.path) || null;
      }),
    } as unknown as MetadataCache,
    fileManager: {
      processFrontMatter: vi.fn(
        async (file: TFile, updater: (fm: Record<string, unknown>) => void) => {
          const cache = fileCacheMap.get(file.path);
          const fm = cache?.frontmatter ? { ...cache.frontmatter } : {};
          updater(fm);
          fileCacheMap.set(file.path, { frontmatter: fm });
        },
      ),
    } as unknown as FileManager,
  } as unknown as App;

  return { mockApp, files, folderMap, fileCacheMap, fileContentMap };
}

function createService(
  mockApp: App,
  options?: { authorNotesPath?: string; enabled?: boolean },
) {
  return new AuthorNoteService({
    app: mockApp,
    getAuthorNotesPath: () => options?.authorNotesPath ?? 'Authors',
    isEnabled: () => options?.enabled ?? true,
  });
}

/**
 * Helper to wire up the index for tests that need findNoteByKey / upsertFromArchive
 * to find existing notes. Creates proper TFile + TFolder with children so that
 * collectMarkdownFiles works with instanceof checks.
 */
function setupIndexableNote(
  ctx: ReturnType<typeof createMockApp>,
  filePath: string,
  frontmatter: Record<string, unknown>,
) {
  const file = makeTFile(filePath);
  ctx.files.set(filePath, file);
  ctx.fileCacheMap.set(filePath, { frontmatter });
  ctx.fileContentMap.set(filePath, frontmatterToContent(frontmatter));

  // Set up the Authors folder with this file as a child
  const folderPath = filePath.substring(0, filePath.lastIndexOf('/')) || 'Authors';
  const existingFolder = ctx.folderMap.get(folderPath);
  if (existingFolder) {
    existingFolder.children.push(file);
  } else {
    ctx.folderMap.set(folderPath, makeTFolder(folderPath, [file]));
  }

  return file;
}

function frontmatterToContent(frontmatter: Record<string, unknown>): string {
  const serialize = (value: unknown): string => {
    if (typeof value === 'string') {
      const needsQuotes = value.includes(':') || value.includes('#') || value.includes('[') ||
        value.includes(']') || value.includes('{') || value.includes('}') ||
        value.includes(',') || value.includes('"') || value.includes("'") ||
        value === '';
      return needsQuotes ? `"${value.replace(/"/g, '\\"')}"` : value;
    }
    return String(value);
  };

  const lines = Object.entries(frontmatter).flatMap(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return [`${key}: []`];
      }
      return [`${key}:`, ...value.map((item) => `  - ${serialize(item)}`)];
    }
    return [`${key}: ${serialize(value)}`];
  });

  return `---\n${lines.join('\n')}\n---\n\n## Notes\n`;
}

function makeNoteData(overrides?: Partial<AuthorNoteData>): AuthorNoteData {
  return {
    type: AUTHOR_NOTE_TYPE,
    noteVersion: AUTHOR_NOTE_VERSION,
    authorKey: 'facebook:url:https://www.facebook.com/johndoe',
    legacyKeys: [],
    platform: 'facebook',
    authorName: 'John Doe',
    authorUrl: 'https://www.facebook.com/johndoe',
    authorHandle: 'johndoe',
    archiveCount: 1,
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    lastMetadataUpdate: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('AuthorNoteService', () => {
  // --------------------------------------------------------------------------
  // buildAuthorKey
  // --------------------------------------------------------------------------
  describe('buildAuthorKey', () => {
    let service: AuthorNoteService;

    beforeEach(() => {
      const { mockApp } = createMockApp();
      service = createService(mockApp);
    });

    it('should generate URL-based key when URL is provided', () => {
      const key = service.buildAuthorKey(
        'https://www.facebook.com/john',
        'John',
        'facebook',
      );
      expect(key).toContain('facebook:url:');
      expect(key).not.toContain(':name:');
    });

    it('should generate name-based key when URL is undefined', () => {
      const key = service.buildAuthorKey(undefined, 'John Doe', 'facebook');
      expect(key).toContain('facebook:name:');
      expect(key).not.toContain(':url:');
    });

    it('should generate name-based key when URL is empty string', () => {
      const key = service.buildAuthorKey('', 'John Doe', 'facebook');
      expect(key).toContain('facebook:name:');
    });

    it('should normalize name in name-based key (lowercase, trim)', () => {
      const key = service.buildAuthorKey(undefined, '  John Doe  ', 'facebook');
      expect(key).toBe('facebook:name:john doe');
    });

    it('should strip @ prefix from name in name-based key', () => {
      const key = service.buildAuthorKey(undefined, '@karpathy', 'x');
      expect(key).toBe('x:name:karpathy');
    });

    it('should remove parenthetical notes from name', () => {
      const key = service.buildAuthorKey(
        undefined,
        'John Doe (Official)',
        'facebook',
      );
      expect(key).toBe('facebook:name:john doe');
    });

    it('should normalize twitter.com to x.com in URL-based key', () => {
      const key1 = service.buildAuthorKey(
        'https://twitter.com/karpathy',
        'Andrej',
        'x',
      );
      const key2 = service.buildAuthorKey(
        'https://x.com/karpathy',
        'Andrej',
        'x',
      );
      expect(key1).toBe(key2);
    });

    it('should strip trailing slashes from URL', () => {
      const key1 = service.buildAuthorKey(
        'https://www.facebook.com/johndoe/',
        'John',
        'facebook',
      );
      const key2 = service.buildAuthorKey(
        'https://www.facebook.com/johndoe',
        'John',
        'facebook',
      );
      expect(key1).toBe(key2);
    });

    it('should convert http to https', () => {
      const key1 = service.buildAuthorKey(
        'http://www.facebook.com/johndoe',
        'John',
        'facebook',
      );
      const key2 = service.buildAuthorKey(
        'https://www.facebook.com/johndoe',
        'John',
        'facebook',
      );
      expect(key1).toBe(key2);
    });

    it('should produce consistent keys for same inputs', () => {
      const inputs = [
        ['https://www.instagram.com/john.doe', 'John Doe', 'instagram'] as const,
        ['https://x.com/karpathy', 'Andrej Karpathy', 'x'] as const,
        [undefined, 'Jane Doe', 'facebook'] as const,
      ];

      for (const [url, name, platform] of inputs) {
        const key1 = service.buildAuthorKey(url, name, platform);
        const key2 = service.buildAuthorKey(url, name, platform);
        expect(key1).toBe(key2);
      }
    });

    it('should produce different keys for different platforms with same name', () => {
      const keyFb = service.buildAuthorKey(undefined, 'John Doe', 'facebook');
      const keyX = service.buildAuthorKey(undefined, 'John Doe', 'x');
      expect(keyFb).not.toBe(keyX);
    });

    it('should produce different keys for different platforms with same URL path', () => {
      const keyFb = service.buildAuthorKey(
        'https://www.facebook.com/john',
        'John',
        'facebook',
      );
      const keyIg = service.buildAuthorKey(
        'https://www.instagram.com/john',
        'John',
        'instagram',
      );
      expect(keyFb).not.toBe(keyIg);
    });
  });

  // --------------------------------------------------------------------------
  // generateFilename
  // --------------------------------------------------------------------------
  describe('generateFilename', () => {
    let service: AuthorNoteService;

    beforeEach(() => {
      const { mockApp } = createMockApp();
      service = createService(mockApp);
    });

    it('should generate handle-based filename', () => {
      const filename = service.generateFilename('facebook', 'john.doe', 'John Doe');
      expect(filename).toBe('facebook-john.doe.md');
    });

    it('should generate name-based filename when handle is undefined', () => {
      const filename = service.generateFilename('instagram', undefined, 'My Name');
      expect(filename).toBe('instagram-my-name.md');
    });

    it('should fallback to "unknown" when both handle and name are missing', () => {
      const filename = service.generateFilename('x', undefined, undefined);
      expect(filename).toBe('x-unknown.md');
    });

    it('should strip leading @ from handle', () => {
      const filename = service.generateFilename('x', '@karpathy', 'Andrej Karpathy');
      expect(filename).toBe('x-karpathy.md');
    });

    it('should lowercase the slug', () => {
      const filename = service.generateFilename('facebook', 'John.Doe', undefined);
      expect(filename).toBe('facebook-john.doe.md');
    });

    it('should replace spaces with hyphens', () => {
      const filename = service.generateFilename(
        'facebook',
        undefined,
        'John Michael Doe',
      );
      expect(filename).toBe('facebook-john-michael-doe.md');
    });

    it('should sanitize illegal filename characters', () => {
      const filename = service.generateFilename(
        'facebook',
        'user/with:special*chars?"<>|',
        undefined,
      );
      expect(filename).not.toContain('/');
      expect(filename).not.toContain(':');
      expect(filename).not.toContain('*');
      expect(filename).not.toContain('?');
      expect(filename).not.toContain('"');
      expect(filename).not.toContain('<');
      expect(filename).not.toContain('>');
      expect(filename).not.toContain('|');
      expect(filename).toMatch(/^facebook-.*\.md$/);
    });

    it('should collapse multiple hyphens', () => {
      const filename = service.generateFilename('facebook', 'a---b', undefined);
      expect(filename).toBe('facebook-a-b.md');
    });

    it('should trim leading/trailing hyphens from slug', () => {
      const filename = service.generateFilename('facebook', '-test-', undefined);
      expect(filename).toBe('facebook-test.md');
    });

    it('should truncate long slugs to max length', () => {
      const longName = 'a'.repeat(200);
      const filename = service.generateFilename('x', longName, undefined);
      // Platform prefix + hyphen + slug(max 80) + .md
      expect(filename.length).toBeLessThanOrEqual('x-'.length + 80 + '.md'.length);
    });

    it('should handle names with spaces', () => {
      const filename = service.generateFilename('facebook', undefined, 'John Doe');
      expect(filename).toBe('facebook-john-doe.md');
    });
  });

  // --------------------------------------------------------------------------
  // createNote -- body preservation
  // --------------------------------------------------------------------------
  describe('createNote', () => {
    it('should create file with YAML frontmatter and default body', async () => {
      const ctx = createMockApp();
      ctx.folderMap.set('Authors', makeTFolder('Authors'));
      const service = createService(ctx.mockApp);

      const data = makeNoteData();
      await service.createNote(data);

      expect(ctx.mockApp.vault.create).toHaveBeenCalledOnce();
      const [path, content] = (
        ctx.mockApp.vault.create as ReturnType<typeof vi.fn>
      ).mock.calls[0];

      expect(path).toMatch(/^Authors\//);
      expect(path).toMatch(/\.md$/);

      // Content starts with frontmatter
      expect(content).toMatch(/^---\n/);
      expect(content).toContain('type: social-archiver-author');
      expect(content).toContain(`noteVersion: ${AUTHOR_NOTE_VERSION}`);
      expect(content).toContain('authorKey: ');

      // Body contains default scaffold
      expect(content).toContain('## Notes');
    });

    it('should handle filename collision by appending hash', async () => {
      const ctx = createMockApp();
      ctx.folderMap.set('Authors', makeTFolder('Authors'));

      // Pre-populate a file at the expected path
      const existingFile = makeTFile('Authors/facebook-johndoe.md');
      ctx.files.set('Authors/facebook-johndoe.md', existingFile);

      const service = createService(ctx.mockApp);

      const data = makeNoteData({ authorHandle: 'johndoe' });
      await service.createNote(data);

      const [path] = (ctx.mockApp.vault.create as ReturnType<typeof vi.fn>).mock
        .calls[0];
      // Should have appended hash to avoid collision
      expect(path).toMatch(/^Authors\/facebook-johndoe--[a-z0-9]+\.md$/);
    });

    it('should ensure folder exists before creating note', async () => {
      const ctx = createMockApp();
      const service = createService(ctx.mockApp);

      const data = makeNoteData();
      await service.createNote(data);

      expect(ctx.mockApp.vault.createFolder).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // upsertFromSyncedProfile
  // --------------------------------------------------------------------------
  describe('upsertFromSyncedProfile', () => {
    it('updates an existing note even when metadata cache is cold on startup', async () => {
      const ctx = createMockApp();
      const service = createService(ctx.mockApp);

      const filePath = 'Authors/facebook-johndoe.md';
      const file = setupIndexableNote(ctx, filePath, {
        type: AUTHOR_NOTE_TYPE,
        noteVersion: AUTHOR_NOTE_VERSION,
        authorKey: 'facebook:url:https://www.facebook.com/johndoe',
        legacyKeys: [],
        platform: 'facebook',
        authorName: 'John Doe',
      });

      // Simulate startup before MetadataCache parsed the author note.
      ctx.fileCacheMap.clear();
      service.invalidateIndex();

      const result = await service.upsertFromSyncedProfile({
        authorKey: 'facebook:url:https://www.facebook.com/johndoe',
        platform: 'facebook',
        authorName: 'John Doe',
        authorUrl: 'https://www.facebook.com/johndoe',
        authorHandle: 'johndoe',
        displayNameOverride: 'Johnny',
        bioOverride: '',
        aliases: [],
        fetchedBio: 'Fetched bio',
        updatedAt: '2026-04-10T00:00:00.000Z',
      } as any);

      expect(result).toBe(file);
      expect(ctx.mockApp.vault.create).not.toHaveBeenCalled();
      expect(ctx.mockApp.fileManager.processFrontMatter).toHaveBeenCalledWith(
        file,
        expect.any(Function),
      );
    });

    it('finds a renamed note by scanning disk frontmatter when the index misses', async () => {
      const ctx = createMockApp();
      const service = createService(ctx.mockApp);

      const filePath = 'Authors/custom-renamed-author-note.md';
      const file = setupIndexableNote(ctx, filePath, {
        type: AUTHOR_NOTE_TYPE,
        noteVersion: AUTHOR_NOTE_VERSION,
        authorKey: 'facebook:url:https://www.facebook.com/johndoe',
        legacyKeys: [],
        platform: 'facebook',
        authorName: 'John Doe',
      });

      ctx.fileCacheMap.clear();
      service.invalidateIndex();

      const result = await service.upsertFromSyncedProfile({
        authorKey: 'facebook:url:https://www.facebook.com/johndoe',
        platform: 'facebook',
        authorName: 'John Doe',
        authorUrl: 'https://www.facebook.com/johndoe',
        authorHandle: 'johndoe',
        displayNameOverride: '',
        bioOverride: 'My bio',
        aliases: ['JD'],
        fetchedBio: '',
        updatedAt: '2026-04-10T00:00:00.000Z',
      } as any);

      expect(result).toBe(file);
      expect(ctx.mockApp.vault.create).not.toHaveBeenCalled();
      expect(ctx.mockApp.fileManager.processFrontMatter).toHaveBeenCalledWith(
        file,
        expect.any(Function),
      );
    });
  });

  // --------------------------------------------------------------------------
  // updateNote -- merge rules
  // --------------------------------------------------------------------------
  describe('updateNote', () => {
    it('should NOT overwrite user-owned fields', async () => {
      const ctx = createMockApp();
      const service = createService(ctx.mockApp);

      const filePath = 'Authors/facebook-johndoe.md';
      const file = makeTFile(filePath);

      ctx.fileCacheMap.set(filePath, {
        frontmatter: {
          type: AUTHOR_NOTE_TYPE,
          authorKey: 'facebook:url:https://www.facebook.com/johndoe',
          displayNameOverride: 'My Custom Name',
          aliases: ['JD', 'Johnny'],
          tags: ['friend', 'tech'],
        },
      });

      // Attempt to overwrite user-owned fields
      await service.updateNote(file, {
        displayNameOverride: 'OVERWRITTEN',
        aliases: ['SHOULD_NOT_APPEAR'],
        tags: ['SHOULD_NOT_APPEAR'],
        authorName: 'John Doe Updated', // plugin-managed, should update
      });

      const updatedFm = ctx.fileCacheMap.get(filePath)!.frontmatter;

      // User-owned fields should be preserved (not overwritten)
      expect(updatedFm.displayNameOverride).toBe('My Custom Name');
      expect(updatedFm.aliases).toEqual(['JD', 'Johnny']);
      expect(updatedFm.tags).toEqual(['friend', 'tech']);

      // Plugin-managed field should be updated
      expect(updatedFm.authorName).toBe('John Doe Updated');
    });

    it('should update plugin-managed fields', async () => {
      const ctx = createMockApp();
      const service = createService(ctx.mockApp);

      const filePath = 'Authors/facebook-johndoe.md';
      const file = makeTFile(filePath);

      ctx.fileCacheMap.set(filePath, {
        frontmatter: {
          type: AUTHOR_NOTE_TYPE,
          authorKey: 'facebook:url:https://www.facebook.com/johndoe',
          authorName: 'John Doe',
          archiveCount: 5,
          followers: 100,
        },
      });

      await service.updateNote(file, {
        authorName: 'John Doe Updated',
        archiveCount: 6,
        followers: 200,
        bio: 'New bio',
        avatar: 'https://new-avatar.jpg',
      });

      const updatedFm = ctx.fileCacheMap.get(filePath)!.frontmatter;
      expect(updatedFm.authorName).toBe('John Doe Updated');
      expect(updatedFm.archiveCount).toBe(6);
      expect(updatedFm.followers).toBe(200);
      expect(updatedFm.bio).toBe('New bio');
      expect(updatedFm.avatar).toBe('https://new-avatar.jpg');
    });

    it('should skip undefined values in updates', async () => {
      const ctx = createMockApp();
      const service = createService(ctx.mockApp);

      const filePath = 'Authors/facebook-johndoe.md';
      const file = makeTFile(filePath);

      ctx.fileCacheMap.set(filePath, {
        frontmatter: {
          type: AUTHOR_NOTE_TYPE,
          authorKey: 'facebook:url:https://www.facebook.com/johndoe',
          bio: 'Existing bio',
        },
      });

      await service.updateNote(file, {
        bio: undefined, // should not clear existing bio
        authorName: 'New Name',
      });

      const updatedFm = ctx.fileCacheMap.get(filePath)!.frontmatter;
      expect(updatedFm.bio).toBe('Existing bio');
      expect(updatedFm.authorName).toBe('New Name');
    });

    it('should call processFrontMatter (not modify body)', async () => {
      const ctx = createMockApp();
      const service = createService(ctx.mockApp);

      const filePath = 'Authors/x-karpathy.md';
      const file = makeTFile(filePath);

      ctx.fileCacheMap.set(filePath, {
        frontmatter: {
          type: AUTHOR_NOTE_TYPE,
          authorKey: 'x:url:https://x.com/karpathy',
        },
      });

      await service.updateNote(file, { archiveCount: 10 });

      // processFrontMatter was called, NOT vault.create (body untouched)
      expect(ctx.mockApp.fileManager.processFrontMatter).toHaveBeenCalledOnce();
      expect(ctx.mockApp.vault.create).not.toHaveBeenCalled();
    });

    it('should verify all USER_OWNED_FIELDS are protected', () => {
      expect(USER_OWNED_FIELDS).toContain('displayNameOverride');
      expect(USER_OWNED_FIELDS).toContain('aliases');
      expect(USER_OWNED_FIELDS).toContain('tags');
      expect(USER_OWNED_FIELDS.size).toBe(3);
    });
  });

  // --------------------------------------------------------------------------
  // Legacy key promotion
  // --------------------------------------------------------------------------
  describe('legacy key promotion (upsertFromArchive)', () => {
    it('should promote name-based key to URL-based key when URL becomes available', async () => {
      const ctx = createMockApp();
      const service = createService(ctx.mockApp);

      const filePath = 'Authors/facebook-johndoe.md';
      const nameBasedKey = 'facebook:name:john doe';

      setupIndexableNote(ctx, filePath, {
        type: AUTHOR_NOTE_TYPE,
        noteVersion: AUTHOR_NOTE_VERSION,
        authorKey: nameBasedKey,
        legacyKeys: [],
        platform: 'facebook',
        authorName: 'John Doe',
        archiveCount: 3,
      });

      service.invalidateIndex();

      const postData = {
        platform: 'facebook',
        id: 'post-456',
        url: 'https://facebook.com/post/456',
        author: {
          name: 'John Doe',
          url: 'https://www.facebook.com/johndoe',
        },
        content: { text: 'New post' },
        media: [],
        metadata: { timestamp: new Date() },
      };

      await service.upsertFromArchive(postData as any);

      expect(ctx.mockApp.fileManager.processFrontMatter).toHaveBeenCalled();

      const updatedFm = ctx.fileCacheMap.get(filePath)!.frontmatter;

      // The key should now be URL-based
      expect(updatedFm.authorKey).toContain(':url:');
      expect(updatedFm.authorKey).not.toContain(':name:');

      // The old name-based key should be in legacyKeys
      expect(updatedFm.legacyKeys).toContain(nameBasedKey);

      // authorUrl should be set
      expect(updatedFm.authorUrl).toBeTruthy();
    });

    it('should not demote URL-based key to name-based key', async () => {
      const ctx = createMockApp();
      const service = createService(ctx.mockApp);

      const filePath = 'Authors/facebook-johndoe.md';
      const urlBasedKey = 'facebook:url:https://www.facebook.com/johndoe';

      setupIndexableNote(ctx, filePath, {
        type: AUTHOR_NOTE_TYPE,
        noteVersion: AUTHOR_NOTE_VERSION,
        authorKey: urlBasedKey,
        legacyKeys: [],
        platform: 'facebook',
        authorName: 'John Doe',
        authorUrl: 'https://www.facebook.com/johndoe',
        archiveCount: 5,
      });

      service.invalidateIndex();

      const postData = {
        platform: 'facebook',
        id: 'post-789',
        url: 'https://facebook.com/post/789',
        author: {
          name: 'John Doe',
          url: 'https://www.facebook.com/johndoe',
        },
        content: { text: 'Another post' },
        media: [],
        metadata: { timestamp: new Date() },
      };

      await service.upsertFromArchive(postData as any);

      const updatedFm = ctx.fileCacheMap.get(filePath)!.frontmatter;
      expect(updatedFm.authorKey).toBe(urlBasedKey);
      expect(updatedFm.legacyKeys).toEqual([]);
    });

    it('should not duplicate existing entries in legacyKeys', async () => {
      const ctx = createMockApp();
      const service = createService(ctx.mockApp);

      const filePath = 'Authors/facebook-johndoe.md';
      const nameBasedKey = 'facebook:name:john doe';

      setupIndexableNote(ctx, filePath, {
        type: AUTHOR_NOTE_TYPE,
        noteVersion: AUTHOR_NOTE_VERSION,
        authorKey: nameBasedKey,
        legacyKeys: [nameBasedKey], // Already in legacyKeys
        platform: 'facebook',
        authorName: 'John Doe',
        archiveCount: 3,
      });

      service.invalidateIndex();

      const postData = {
        platform: 'facebook',
        id: 'post-101',
        url: 'https://facebook.com/post/101',
        author: {
          name: 'John Doe',
          url: 'https://www.facebook.com/johndoe',
        },
        content: { text: 'Post' },
        media: [],
        metadata: { timestamp: new Date() },
      };

      await service.upsertFromArchive(postData as any);

      const updatedFm = ctx.fileCacheMap.get(filePath)!.frontmatter;
      const legacyKeys = updatedFm.legacyKeys as string[];

      // Should not have duplicate entries
      const uniqueKeys = [...new Set(legacyKeys)];
      expect(legacyKeys.length).toBe(uniqueKeys.length);
    });
  });

  // --------------------------------------------------------------------------
  // upsertFromArchive -- create + update flows
  // --------------------------------------------------------------------------
  describe('upsertFromArchive', () => {
    it('should return null when disabled', async () => {
      const { mockApp } = createMockApp();
      const service = createService(mockApp, { enabled: false });

      const postData = {
        platform: 'facebook',
        id: 'p1',
        url: 'https://facebook.com/post/1',
        author: { name: 'Test', url: 'https://facebook.com/test' },
        content: { text: 'Text' },
        media: [],
        metadata: { timestamp: new Date() },
      };

      const result = await service.upsertFromArchive(postData as any);
      expect(result).toBeNull();
    });

    it('should return null when both name and URL are missing', async () => {
      const { mockApp } = createMockApp();
      const service = createService(mockApp);

      const postData = {
        platform: 'facebook',
        id: 'p1',
        url: 'https://facebook.com/post/1',
        author: { name: '', url: '' },
        content: { text: 'Text' },
        media: [],
        metadata: { timestamp: new Date() },
      };

      const result = await service.upsertFromArchive(postData as any);
      expect(result).toBeNull();
    });

    it('should create new note if no existing note found', async () => {
      const ctx = createMockApp();
      ctx.folderMap.set('Authors', makeTFolder('Authors'));
      const service = createService(ctx.mockApp);

      const postData = {
        platform: 'instagram',
        id: 'p1',
        url: 'https://instagram.com/p/abc123',
        author: {
          name: 'Jane Smith',
          url: 'https://www.instagram.com/janesmith',
          handle: 'janesmith',
          avatar: 'https://avatar.com/jane.jpg',
          bio: 'Photographer',
          followers: 5000,
          verified: true,
        },
        content: { text: 'Beautiful sunset' },
        media: [],
        metadata: { timestamp: new Date() },
      };

      const result = await service.upsertFromArchive(postData as any);

      expect(result).not.toBeNull();
      expect(ctx.mockApp.vault.create).toHaveBeenCalledOnce();

      const [, content] = (ctx.mockApp.vault.create as ReturnType<typeof vi.fn>)
        .mock.calls[0];
      expect(content).toContain('authorName: Jane Smith');
      expect(content).toContain('platform: instagram');
      expect(content).toContain('archiveCount: 1');
      expect(content).toContain('## Notes');
    });

    it('should increment archiveCount on update', async () => {
      const ctx = createMockApp();
      const service = createService(ctx.mockApp);

      const filePath = 'Authors/x-karpathy.md';

      setupIndexableNote(ctx, filePath, {
        type: AUTHOR_NOTE_TYPE,
        noteVersion: AUTHOR_NOTE_VERSION,
        authorKey: 'x:url:https://x.com/karpathy',
        legacyKeys: [],
        platform: 'x',
        authorName: 'Andrej Karpathy',
        authorUrl: 'https://x.com/karpathy',
        archiveCount: 10,
      });

      service.invalidateIndex();

      const postData = {
        platform: 'x',
        id: 'tweet-1',
        url: 'https://x.com/karpathy/status/123',
        author: {
          name: 'Andrej Karpathy',
          url: 'https://x.com/karpathy',
        },
        content: { text: 'New tweet' },
        media: [],
        metadata: { timestamp: new Date() },
      };

      await service.upsertFromArchive(postData as any);

      const updatedFm = ctx.fileCacheMap.get(filePath)!.frontmatter;
      expect(updatedFm.archiveCount).toBe(11);
    });
  });

  // --------------------------------------------------------------------------
  // readNote + parseFrontmatter
  // --------------------------------------------------------------------------
  describe('readNote', () => {
    it('should return null for non-author-note files', () => {
      const ctx = createMockApp();
      const service = createService(ctx.mockApp);

      const filePath = 'Notes/random-note.md';
      const file = makeTFile(filePath);

      ctx.fileCacheMap.set(filePath, {
        frontmatter: {
          type: 'some-other-type',
          title: 'Random Note',
        },
      });

      const result = service.readNote(file);
      expect(result).toBeNull();
    });

    it('should return null when no cache available', () => {
      const ctx = createMockApp();
      const service = createService(ctx.mockApp);

      const file = makeTFile('Authors/test.md');

      const result = service.readNote(file);
      expect(result).toBeNull();
    });

    it('should parse valid author note frontmatter', () => {
      const ctx = createMockApp();
      const service = createService(ctx.mockApp);

      const filePath = 'Authors/facebook-johndoe.md';
      const file = makeTFile(filePath);

      ctx.fileCacheMap.set(filePath, {
        frontmatter: {
          type: AUTHOR_NOTE_TYPE,
          noteVersion: 1,
          authorKey: 'facebook:url:https://www.facebook.com/johndoe',
          legacyKeys: ['facebook:name:john doe'],
          platform: 'facebook',
          authorName: 'John Doe',
          authorUrl: 'https://www.facebook.com/johndoe',
          authorHandle: 'johndoe',
          avatar: 'https://avatar.com/john.jpg',
          followers: 1000,
          archiveCount: 5,
          lastSeenAt: '2026-01-01T00:00:00.000Z',
          displayNameOverride: 'Johnny',
          aliases: ['JD'],
          tags: ['friend'],
        },
      });

      const result = service.readNote(file);
      expect(result).not.toBeNull();
      expect(result!.type).toBe(AUTHOR_NOTE_TYPE);
      expect(result!.authorKey).toBe(
        'facebook:url:https://www.facebook.com/johndoe',
      );
      expect(result!.legacyKeys).toEqual(['facebook:name:john doe']);
      expect(result!.platform).toBe('facebook');
      expect(result!.authorName).toBe('John Doe');
      expect(result!.followers).toBe(1000);
      expect(result!.archiveCount).toBe(5);
      expect(result!.displayNameOverride).toBe('Johnny');
      expect(result!.aliases).toEqual(['JD']);
      expect(result!.tags).toEqual(['friend']);
    });

    it('should default archiveCount to 0 if missing', () => {
      const ctx = createMockApp();
      const service = createService(ctx.mockApp);

      const filePath = 'Authors/test.md';
      const file = makeTFile(filePath);

      ctx.fileCacheMap.set(filePath, {
        frontmatter: {
          type: AUTHOR_NOTE_TYPE,
          authorKey: 'x:name:test',
          platform: 'x',
          authorName: 'Test',
        },
      });

      const result = service.readNote(file);
      expect(result!.archiveCount).toBe(0);
    });

    it('should filter non-string values from legacyKeys', () => {
      const ctx = createMockApp();
      const service = createService(ctx.mockApp);

      const filePath = 'Authors/test.md';
      const file = makeTFile(filePath);

      ctx.fileCacheMap.set(filePath, {
        frontmatter: {
          type: AUTHOR_NOTE_TYPE,
          authorKey: 'x:name:test',
          legacyKeys: ['valid:key', 123, null, 'another:key'],
          platform: 'x',
          authorName: 'Test',
        },
      });

      const result = service.readNote(file);
      expect(result!.legacyKeys).toEqual(['valid:key', 'another:key']);
    });
  });

  // --------------------------------------------------------------------------
  // Index management
  // --------------------------------------------------------------------------
  describe('index management', () => {
    it('should find note by authorKey', () => {
      const ctx = createMockApp();
      const service = createService(ctx.mockApp);

      const filePath = 'Authors/facebook-johndoe.md';

      setupIndexableNote(ctx, filePath, {
        type: AUTHOR_NOTE_TYPE,
        authorKey: 'facebook:url:https://www.facebook.com/johndoe',
        legacyKeys: [],
      });

      service.invalidateIndex();

      const found = service.findNoteByKey(
        'facebook:url:https://www.facebook.com/johndoe',
      );
      expect(found).not.toBeNull();
      expect(found!.path).toBe(filePath);
    });

    it('should find note by legacyKey', () => {
      const ctx = createMockApp();
      const service = createService(ctx.mockApp);

      const filePath = 'Authors/facebook-johndoe.md';
      const legacyKey = 'facebook:name:john doe';

      setupIndexableNote(ctx, filePath, {
        type: AUTHOR_NOTE_TYPE,
        authorKey: 'facebook:url:https://www.facebook.com/johndoe',
        legacyKeys: [legacyKey],
      });

      service.invalidateIndex();

      const found = service.findNoteByKey(legacyKey);
      expect(found).not.toBeNull();
      expect(found!.path).toBe(filePath);
    });

    it('should return null for unknown key', () => {
      const ctx = createMockApp();
      ctx.folderMap.set('Authors', makeTFolder('Authors'));
      const service = createService(ctx.mockApp);

      service.invalidateIndex();

      const found = service.findNoteByKey('nonexistent:key');
      expect(found).toBeNull();
    });

    it('should invalidate cache and rebuild on next access', () => {
      const ctx = createMockApp();
      ctx.folderMap.set('Authors', makeTFolder('Authors'));
      const service = createService(ctx.mockApp);

      service.invalidateIndex();

      // First lookup: empty
      expect(service.findNoteByKey('x:name:test')).toBeNull();

      // Now add a file via setupIndexableNote
      const filePath = 'Authors/x-test.md';
      setupIndexableNote(ctx, filePath, {
        type: AUTHOR_NOTE_TYPE,
        authorKey: 'x:name:test',
        legacyKeys: [],
      });

      // Without invalidation, cache is stale
      expect(service.findNoteByKey('x:name:test')).toBeNull();

      // After invalidation, should find it
      service.invalidateIndex();
      expect(service.findNoteByKey('x:name:test')).not.toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // noteToEntry
  // --------------------------------------------------------------------------
  describe('noteToEntry', () => {
    it('should use displayNameOverride as authorName when set', () => {
      const { mockApp } = createMockApp();
      const service = createService(mockApp);

      const data = makeNoteData({
        authorName: 'John Doe',
        displayNameOverride: 'Johnny',
      });
      const file = makeTFile('Authors/facebook-johndoe.md');

      const entry = service.noteToEntry(data, file);
      expect(entry.authorName).toBe('Johnny');
      expect(entry.hasNote).toBe(true);
      expect(entry.noteFilePath).toBe('Authors/facebook-johndoe.md');
    });

    it('should fall back to authorName when displayNameOverride is not set', () => {
      const { mockApp } = createMockApp();
      const service = createService(mockApp);

      const data = makeNoteData({
        authorName: 'John Doe',
        displayNameOverride: undefined,
      });
      const file = makeTFile('Authors/facebook-johndoe.md');

      const entry = service.noteToEntry(data, file);
      expect(entry.authorName).toBe('John Doe');
    });
  });
});
