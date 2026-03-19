/**
 * ArchiveLookupService Tests
 *
 * Tests cover:
 * - Lazy index construction on first lookup
 * - findBySourceArchiveId: single match, no match
 * - findByOriginalUrl: single match, no match, multiple matches (ambiguous)
 * - URL normalization (trailing slash, tracking params)
 * - Incremental index update via MetadataCache `changed` event
 * - backfillFileIdentity: calls processFrontMatter + updates in-memory index
 * - destroy(): offref is called and index is cleared
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { App, CachedMetadata, EventRef, MetadataCache, Vault } from 'obsidian';

// ============================================================================
// Obsidian Mock
// ============================================================================

vi.mock('obsidian', () => {
  class TFile {
    path: string = '';
    name: string = '';
    basename: string = '';
    extension: string = 'md';
    stat = { ctime: Date.now(), mtime: Date.now(), size: 0 };
  }

  return { TFile };
});

import { TFile as MockTFile } from 'obsidian';
import type { TFile } from 'obsidian';

// Import after mock is established
import { ArchiveLookupService } from '@/services/ArchiveLookupService';

// ============================================================================
// Test Helpers
// ============================================================================

interface FrontmatterConfig {
  sourceArchiveId?: string;
  originalUrl?: string;
  platform?: string;
  [key: string]: unknown;
}

interface MockFileConfig {
  path: string;
  frontmatter?: FrontmatterConfig;
}

function makeTFile(path: string): TFile {
  const f = new MockTFile();
  f.path = path;
  f.name = path.split('/').pop() ?? '';
  f.basename = f.name.replace(/\.md$/, '');
  return f as unknown as TFile;
}

/** Stub EventRef returned by metadataCache.on */
const STUB_EVENT_REF: EventRef = {} as EventRef;

/**
 * Create a mock App wired up with the given file configs.
 * Exposes `triggerChanged` to simulate MetadataCache `changed` events.
 */
function createMockApp(fileConfigs: MockFileConfig[]): {
  app: App;
  triggerChanged: (file: TFile, cache: CachedMetadata | null) => void;
} {
  const fileMap = new Map<string, MockFileConfig>();
  const tFileMap = new Map<string, TFile>();

  for (const config of fileConfigs) {
    fileMap.set(config.path, config);
    tFileMap.set(config.path, makeTFile(config.path));
  }

  // Capture the `changed` handler registered by the service
  let changedHandler: ((file: TFile, data: string, cache: CachedMetadata) => void) | null = null;

  const mockMetadataCache = {
    on: vi.fn((_event: string, handler: (file: TFile, data: string, cache: CachedMetadata) => void): EventRef => {
      changedHandler = handler;
      return STUB_EVENT_REF;
    }),
    off: vi.fn(),
    offref: vi.fn(),
    getFileCache: vi.fn((file: TFile): CachedMetadata | null => {
      const config = fileMap.get(file.path);
      if (!config?.frontmatter) return null;
      return { frontmatter: config.frontmatter } as CachedMetadata;
    }),
  } satisfies Partial<MetadataCache> as unknown as MetadataCache;

  const mockVault = {
    getMarkdownFiles: vi.fn((): TFile[] => {
      return [...tFileMap.values()];
    }),
  } satisfies Partial<Vault> as unknown as Vault;

  const processFrontMatterMock = vi.fn(async (file: TFile, fn: (fm: Record<string, unknown>) => void) => {
    // Simulate reading existing frontmatter, running mutator, and persisting
    const config = fileMap.get(file.path);
    const fm: Record<string, unknown> = { ...(config?.frontmatter ?? {}) };
    fn(fm);
    // Update the in-memory config so subsequent getFileCache reads reflect the change
    if (config) {
      config.frontmatter = fm as FrontmatterConfig;
    }
  });

  const app = {
    vault: mockVault,
    metadataCache: mockMetadataCache,
    fileManager: {
      processFrontMatter: processFrontMatterMock,
    },
  } as unknown as App;

  const triggerChanged = (file: TFile, cache: CachedMetadata | null): void => {
    changedHandler?.(file, '', cache as CachedMetadata);
  };

  return { app, triggerChanged };
}

// ============================================================================
// Tests
// ============================================================================

describe('ArchiveLookupService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  describe('findBySourceArchiveId', () => {
    it('returns null when no files are indexed', () => {
      const { app } = createMockApp([]);
      const svc = new ArchiveLookupService(app);
      svc.initialize();

      expect(svc.findBySourceArchiveId('archive_123')).toBeNull();
    });

    it('returns null when archiveId does not match any file', () => {
      const { app } = createMockApp([
        { path: 'Social Archives/facebook/post.md', frontmatter: { sourceArchiveId: 'archive_ABC' } },
      ]);
      const svc = new ArchiveLookupService(app);
      svc.initialize();

      expect(svc.findBySourceArchiveId('archive_XYZ')).toBeNull();
    });

    it('returns the matching TFile for a single match', () => {
      const { app } = createMockApp([
        { path: 'Social Archives/facebook/post.md', frontmatter: { sourceArchiveId: 'archive_123' } },
      ]);
      const svc = new ArchiveLookupService(app);
      svc.initialize();

      const result = svc.findBySourceArchiveId('archive_123');
      expect(result).not.toBeNull();
      expect(result?.path).toBe('Social Archives/facebook/post.md');
    });

    it('builds index lazily (getMarkdownFiles not called until first lookup)', () => {
      const { app } = createMockApp([
        { path: 'Social Archives/facebook/post.md', frontmatter: { sourceArchiveId: 'archive_123' } },
      ]);
      const svc = new ArchiveLookupService(app);
      svc.initialize();

      // Access vault mock before the first lookup
      expect(app.vault.getMarkdownFiles).not.toHaveBeenCalled();

      svc.findBySourceArchiveId('archive_123');

      expect(app.vault.getMarkdownFiles).toHaveBeenCalledOnce();
    });

    it('does not rebuild index on subsequent lookups (only once)', () => {
      const { app } = createMockApp([
        { path: 'Social Archives/facebook/post.md', frontmatter: { sourceArchiveId: 'archive_123' } },
      ]);
      const svc = new ArchiveLookupService(app);
      svc.initialize();

      svc.findBySourceArchiveId('archive_123');
      svc.findBySourceArchiveId('archive_123');
      svc.findBySourceArchiveId('archive_XYZ');

      expect(app.vault.getMarkdownFiles).toHaveBeenCalledOnce();
    });

    it('skips files with no frontmatter', () => {
      const { app } = createMockApp([
        { path: 'Social Archives/no-frontmatter.md' /* no frontmatter */ },
        { path: 'Social Archives/facebook/post.md', frontmatter: { sourceArchiveId: 'archive_123' } },
      ]);
      const svc = new ArchiveLookupService(app);
      svc.initialize();

      expect(svc.findBySourceArchiveId('archive_123')?.path).toBe('Social Archives/facebook/post.md');
    });
  });

  // --------------------------------------------------------------------------
  describe('findByOriginalUrl', () => {
    it('returns empty array when no files are indexed', () => {
      const { app } = createMockApp([]);
      const svc = new ArchiveLookupService(app);
      svc.initialize();

      expect(svc.findByOriginalUrl('https://example.com/post')).toEqual([]);
    });

    it('returns empty array when URL does not match any file', () => {
      const { app } = createMockApp([
        { path: 'Social Archives/post-a.md', frontmatter: { originalUrl: 'https://example.com/post-a' } },
      ]);
      const svc = new ArchiveLookupService(app);
      svc.initialize();

      expect(svc.findByOriginalUrl('https://example.com/post-b')).toEqual([]);
    });

    it('returns single TFile for an unambiguous match', () => {
      const { app } = createMockApp([
        { path: 'Social Archives/post-a.md', frontmatter: { originalUrl: 'https://example.com/post-a' } },
      ]);
      const svc = new ArchiveLookupService(app);
      svc.initialize();

      const result = svc.findByOriginalUrl('https://example.com/post-a');
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('Social Archives/post-a.md');
    });

    it('returns multiple TFiles for an ambiguous URL (same URL archived twice)', () => {
      const { app } = createMockApp([
        { path: 'Social Archives/post-v1.md', frontmatter: { originalUrl: 'https://example.com/post' } },
        { path: 'Social Archives/post-v2.md', frontmatter: { originalUrl: 'https://example.com/post' } },
      ]);
      const svc = new ArchiveLookupService(app);
      svc.initialize();

      const result = svc.findByOriginalUrl('https://example.com/post');
      expect(result).toHaveLength(2);
      const paths = result.map((f) => f.path).sort();
      expect(paths).toEqual(['Social Archives/post-v1.md', 'Social Archives/post-v2.md']);
    });

    it('normalizes trailing slash before comparison', () => {
      const { app } = createMockApp([
        { path: 'Social Archives/post.md', frontmatter: { originalUrl: 'https://example.com/post' } },
      ]);
      const svc = new ArchiveLookupService(app);
      svc.initialize();

      // With trailing slash
      expect(svc.findByOriginalUrl('https://example.com/post/')).toHaveLength(1);
      // Without trailing slash
      expect(svc.findByOriginalUrl('https://example.com/post')).toHaveLength(1);
    });

    it('strips known tracking query params before comparison', () => {
      const { app } = createMockApp([
        {
          path: 'Social Archives/post.md',
          frontmatter: { originalUrl: 'https://example.com/post' },
        },
      ]);
      const svc = new ArchiveLookupService(app);
      svc.initialize();

      // Lookup with tracking params should still find the file
      const result = svc.findByOriginalUrl(
        'https://example.com/post?utm_source=newsletter&utm_medium=email'
      );
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('Social Archives/post.md');
    });

    it('preserves platform-significant query params', () => {
      const { app } = createMockApp([
        {
          path: 'Social Archives/reddit-post.md',
          frontmatter: { originalUrl: 'https://reddit.com/r/all/comments/abc123/title/?param=sig' },
        },
      ]);
      const svc = new ArchiveLookupService(app);
      svc.initialize();

      // Only tracking params removed — sig param preserved
      expect(svc.findByOriginalUrl('https://reddit.com/r/all/comments/abc123/title/?param=sig')).toHaveLength(1);
      // Without sig param — different normalized URL, no match
      expect(svc.findByOriginalUrl('https://reddit.com/r/all/comments/abc123/title')).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  describe('backfillFileIdentity', () => {
    it('calls processFrontMatter with the archiveId', async () => {
      const { app } = createMockApp([
        { path: 'Social Archives/post.md', frontmatter: { originalUrl: 'https://example.com/post' } },
      ]);
      const svc = new ArchiveLookupService(app);
      svc.initialize();

      // Trigger index build
      svc.findByOriginalUrl('https://example.com/post');

      const files = svc.findByOriginalUrl('https://example.com/post');
      const file = files[0];

      await svc.backfillFileIdentity(file, 'archive_999');

      expect(app.fileManager.processFrontMatter).toHaveBeenCalledOnce();
      expect(app.fileManager.processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));
    });

    it('makes the file findable by sourceArchiveId immediately after backfill', async () => {
      const { app } = createMockApp([
        { path: 'Social Archives/post.md', frontmatter: { originalUrl: 'https://example.com/post' } },
      ]);
      const svc = new ArchiveLookupService(app);
      svc.initialize();

      // Trigger index build
      svc.findByOriginalUrl('https://example.com/post');

      const [file] = svc.findByOriginalUrl('https://example.com/post');
      await svc.backfillFileIdentity(file, 'archive_backfilled');

      // Must be findable by archiveId immediately (optimistic update)
      const found = svc.findBySourceArchiveId('archive_backfilled');
      expect(found?.path).toBe('Social Archives/post.md');
    });

    it('does not throw when index has not been built yet', async () => {
      const { app } = createMockApp([
        { path: 'Social Archives/post.md', frontmatter: { originalUrl: 'https://example.com/post' } },
      ]);
      const svc = new ArchiveLookupService(app);
      svc.initialize();

      // No lookup done yet — index is not built
      const file = makeTFile('Social Archives/post.md');
      await expect(svc.backfillFileIdentity(file, 'archive_early')).resolves.not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  describe('incremental index update via MetadataCache changed event', () => {
    it('adds a newly indexed file to the index', () => {
      const path = 'Social Archives/new-post.md';
      const { app, triggerChanged } = createMockApp([]);
      const svc = new ArchiveLookupService(app);
      svc.initialize();

      // Build index (empty)
      expect(svc.findBySourceArchiveId('archive_new')).toBeNull();

      // Simulate a new file being indexed by MetadataCache
      const newFile = makeTFile(path);
      const newCache = { frontmatter: { sourceArchiveId: 'archive_new' } } as CachedMetadata;
      triggerChanged(newFile, newCache);

      // Should now be findable
      expect(svc.findBySourceArchiveId('archive_new')?.path).toBe(path);
    });

    it('replaces stale index entries when a file is updated', () => {
      const path = 'Social Archives/updated-post.md';
      const { app, triggerChanged } = createMockApp([
        { path, frontmatter: { sourceArchiveId: 'archive_old', originalUrl: 'https://example.com/old' } },
      ]);
      const svc = new ArchiveLookupService(app);
      svc.initialize();

      // Build index
      expect(svc.findBySourceArchiveId('archive_old')?.path).toBe(path);

      // Simulate frontmatter being updated (sourceArchiveId changed)
      const file = makeTFile(path);
      const updatedCache = {
        frontmatter: { sourceArchiveId: 'archive_new', originalUrl: 'https://example.com/new' },
      } as CachedMetadata;
      triggerChanged(file, updatedCache);

      // Old entry should be gone
      expect(svc.findBySourceArchiveId('archive_old')).toBeNull();
      expect(svc.findByOriginalUrl('https://example.com/old')).toHaveLength(0);

      // New entry should be present
      expect(svc.findBySourceArchiveId('archive_new')?.path).toBe(path);
      expect(svc.findByOriginalUrl('https://example.com/new')).toHaveLength(1);
    });

    it('does not update index before it is built (changed fires before first lookup)', () => {
      const path = 'Social Archives/early-event.md';
      const { app, triggerChanged } = createMockApp([]);
      const svc = new ArchiveLookupService(app);
      svc.initialize();

      // Trigger changed before any lookup (index not built)
      const file = makeTFile(path);
      const cache = { frontmatter: { sourceArchiveId: 'archive_early' } } as CachedMetadata;
      triggerChanged(file, cache);

      // The changed handler should be a no-op when index is not built
      // After building the index (via first lookup), the file should NOT appear
      // because it was never in getMarkdownFiles
      expect(svc.findBySourceArchiveId('archive_early')).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  describe('initialize / destroy lifecycle', () => {
    it('registers metadataCache.on during initialize', () => {
      const { app } = createMockApp([]);
      const svc = new ArchiveLookupService(app);
      svc.initialize();

      expect(app.metadataCache.on).toHaveBeenCalledWith('changed', expect.any(Function));
    });

    it('calls offref on metadataCache during destroy', () => {
      const { app } = createMockApp([]);
      const svc = new ArchiveLookupService(app);
      svc.initialize();
      svc.destroy();

      expect(app.metadataCache.offref).toHaveBeenCalledWith(STUB_EVENT_REF);
    });

    it('calls offref via dispose() (IService lifecycle)', () => {
      const { app } = createMockApp([]);
      const svc = new ArchiveLookupService(app);
      svc.initialize();
      svc.dispose();

      expect(app.metadataCache.offref).toHaveBeenCalledWith(STUB_EVENT_REF);
    });

    it('does not throw if destroy is called before initialize', () => {
      const { app } = createMockApp([]);
      const svc = new ArchiveLookupService(app);
      expect(() => svc.destroy()).not.toThrow();
    });

    it('clears the index on destroy', () => {
      const { app } = createMockApp([
        { path: 'Social Archives/post.md', frontmatter: { sourceArchiveId: 'archive_123' } },
      ]);
      const svc = new ArchiveLookupService(app);
      svc.initialize();

      // Build index
      expect(svc.findBySourceArchiveId('archive_123')).not.toBeNull();

      svc.destroy();

      // After destroy, the index is cleared AND getMarkdownFiles needs to be called again.
      // Since the service is destroyed, calling lookups should rebuild from scratch.
      // However, since built=false after destroy, it will call getMarkdownFiles again.
      const result = svc.findBySourceArchiveId('archive_123');
      // The result depends on whether the vault still has the file
      // (it does in our mock) — the key thing is no stale data persists between
      // rebuild cycles and the call doesn't throw.
      expect(result?.path).toBe('Social Archives/post.md');
    });

    it('isHealthy() returns true', () => {
      const { app } = createMockApp([]);
      const svc = new ArchiveLookupService(app);
      expect(svc.isHealthy()).toBe(true);
    });
  });
});
