import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComposedPostSyncService } from '../../../plugin/sync/ComposedPostSyncService';
import type { SocialArchiverSettings, PendingComposedPostSyncEntry } from '../../../types/settings';
import type { WorkersAPIClient } from '../../../services/WorkersAPIClient';
import type { App, TFile, Vault } from 'obsidian';

// Minimal obsidian mock
vi.mock('obsidian', () => ({
  App: vi.fn(),
  Vault: vi.fn(),
  TFile: vi.fn(),
}));

type MetadataChangedHandler = (file: TFile) => void;

interface MockMetadataCache {
  _handler: MetadataChangedHandler | null;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  offref: ReturnType<typeof vi.fn>;
  getFileCache: ReturnType<typeof vi.fn>;
  trigger: (file: TFile) => void;
}

function makeMockMetadataCache(fileFrontmatter?: Record<string, unknown>): MockMetadataCache {
  const cache: MockMetadataCache = {
    _handler: null,
    on: vi.fn().mockImplementation((_event: string, fn: MetadataChangedHandler) => {
      cache._handler = fn;
      return { id: 'ref-1' }; // EventRef mock
    }),
    off: vi.fn(),
    offref: vi.fn(),
    getFileCache: vi.fn().mockReturnValue(
      fileFrontmatter !== undefined
        ? { frontmatter: fileFrontmatter }
        : null
    ),
    trigger: (file: TFile) => {
      cache._handler?.(file);
    },
  };
  return cache;
}

function makeMockApp(
  processFrontMatter?: (file: TFile, fn: (fm: Record<string, unknown>) => void) => Promise<void>,
  metadataCache?: MockMetadataCache
) {
  return {
    fileManager: {
      processFrontMatter: processFrontMatter ?? vi.fn().mockResolvedValue(undefined),
    },
    metadataCache: metadataCache ?? makeMockMetadataCache(),
  } as unknown as App;
}

function makeMockVault(fileContent?: string, fileExists = true) {
  const mockFile = { path: 'test/path.md' } as TFile;
  return {
    getFileByPath: vi.fn().mockReturnValue(fileExists ? mockFile : null),
    read: vi.fn().mockResolvedValue(fileContent ?? '---\nauthor: Test\n---\nBody content'),
    readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Vault;
}

function makeMockApiClient(overrides?: Partial<WorkersAPIClient>) {
  return {
    createComposedPost: vi.fn().mockResolvedValue({ archiveId: 'srv-123', createdAt: '2026-03-26T00:00:00Z' }),
    updateComposedPost: vi.fn().mockResolvedValue({ success: true, updatedAt: '2026-03-26T00:00:00Z' }),
    uploadComposedMedia: vi.fn().mockResolvedValue({ mediaId: 'm1', url: 'https://cdn/m1' }),
    ...overrides,
  } as unknown as WorkersAPIClient;
}

function makeSettings(queue: PendingComposedPostSyncEntry[] = []): SocialArchiverSettings {
  return {
    pendingComposedPostSyncs: queue,
  } as unknown as SocialArchiverSettings;
}

describe('ComposedPostSyncService', () => {
  let settings: SocialArchiverSettings;
  let saveSettings: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    settings = makeSettings();
    saveSettings = vi.fn().mockResolvedValue(undefined);
  });

  // ============================================================================
  // Queue operations
  // ============================================================================

  describe('enqueueCreate', () => {
    it('adds a create entry to the queue and persists settings', async () => {
      const service = new ComposedPostSyncService(
        makeMockApp(),
        makeMockVault(),
        settings,
        makeMockApiClient(),
        saveSettings
      );

      await service.enqueueCreate('path/post.md', 'client-id-1');

      expect(settings.pendingComposedPostSyncs).toHaveLength(1);
      expect(settings.pendingComposedPostSyncs[0]).toMatchObject({
        op: 'create',
        filePath: 'path/post.md',
        clientPostId: 'client-id-1',
        retryCount: 0,
      });
      expect(saveSettings).toHaveBeenCalledTimes(1);
    });
  });

  describe('enqueueUpdate', () => {
    it('replaces existing entry and adds update entry', async () => {
      const existing: PendingComposedPostSyncEntry = {
        op: 'create',
        filePath: 'path/post.md',
        clientPostId: 'client-id-1',
        queuedAt: '2026-01-01T00:00:00Z',
        retryCount: 0,
      };
      settings = makeSettings([existing]);

      const service = new ComposedPostSyncService(
        makeMockApp(),
        makeMockVault(),
        settings,
        makeMockApiClient(),
        saveSettings
      );

      await service.enqueueUpdate('path/post.md', 'client-id-1', 'srv-archive-42');

      expect(settings.pendingComposedPostSyncs).toHaveLength(1);
      expect(settings.pendingComposedPostSyncs[0]).toMatchObject({
        op: 'update',
        clientPostId: 'client-id-1',
        sourceArchiveId: 'srv-archive-42',
        retryCount: 0,
      });
    });
  });

  describe('removeFromQueue', () => {
    it('removes entry by clientPostId', async () => {
      const entry: PendingComposedPostSyncEntry = {
        op: 'create',
        filePath: 'path/post.md',
        clientPostId: 'to-remove',
        queuedAt: '2026-01-01T00:00:00Z',
        retryCount: 0,
      };
      settings = makeSettings([entry]);

      const service = new ComposedPostSyncService(
        makeMockApp(),
        makeMockVault(),
        settings,
        makeMockApiClient(),
        saveSettings
      );

      await service.removeFromQueue('to-remove');

      expect(settings.pendingComposedPostSyncs).toHaveLength(0);
      expect(saveSettings).toHaveBeenCalledTimes(1);
    });

    it('does not persist if entry not found', async () => {
      const service = new ComposedPostSyncService(
        makeMockApp(),
        makeMockVault(),
        settings,
        makeMockApiClient(),
        saveSettings
      );

      await service.removeFromQueue('non-existent');

      expect(saveSettings).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Flush — create operation
  // ============================================================================

  describe('flush — create', () => {
    it('calls createComposedPost and writes frontmatter on success', async () => {
      const entry: PendingComposedPostSyncEntry = {
        op: 'create',
        filePath: 'path/post.md',
        clientPostId: 'cid-1',
        queuedAt: '2026-01-01T00:00:00Z',
        retryCount: 0,
      };
      settings = makeSettings([entry]);

      const writtenFm: Record<string, unknown>[] = [];
      const app = makeMockApp(async (_file, fn) => {
        const fm: Record<string, unknown> = {};
        fn(fm);
        writtenFm.push(fm);
      });

      const apiClient = makeMockApiClient();
      const service = new ComposedPostSyncService(app, makeMockVault(), settings, apiClient, saveSettings);

      await service.flush();

      expect(apiClient.createComposedPost).toHaveBeenCalledWith(
        expect.objectContaining({ clientPostId: 'cid-1', platform: 'post' })
      );
      expect(writtenFm[0]).toMatchObject({ sourceArchiveId: 'srv-123', syncState: 'synced' });
      expect(settings.pendingComposedPostSyncs).toHaveLength(0);
    });

    it('removes entry if vault file is missing', async () => {
      const entry: PendingComposedPostSyncEntry = {
        op: 'create',
        filePath: 'path/missing.md',
        clientPostId: 'cid-gone',
        queuedAt: '2026-01-01T00:00:00Z',
        retryCount: 0,
      };
      settings = makeSettings([entry]);

      const vault = makeMockVault(undefined, false); // file does not exist
      const apiClient = makeMockApiClient();
      const service = new ComposedPostSyncService(makeMockApp(), vault, settings, apiClient, saveSettings);

      await service.flush();

      expect(apiClient.createComposedPost).not.toHaveBeenCalled();
      expect(settings.pendingComposedPostSyncs).toHaveLength(0);
    });

    it('increments retryCount on API failure', async () => {
      const entry: PendingComposedPostSyncEntry = {
        op: 'create',
        filePath: 'path/post.md',
        clientPostId: 'cid-fail',
        queuedAt: '2026-01-01T00:00:00Z',
        retryCount: 0,
      };
      settings = makeSettings([entry]);

      const apiClient = makeMockApiClient({
        createComposedPost: vi.fn().mockRejectedValue(new Error('Network error')),
      });

      const service = new ComposedPostSyncService(makeMockApp(), makeMockVault(), settings, apiClient, saveSettings);

      await service.flush();

      expect(settings.pendingComposedPostSyncs[0]?.retryCount).toBe(1);
      expect(settings.pendingComposedPostSyncs[0]?.lastError).toContain('Network error');
    });

    it('marks syncState=failed and removes entry after MAX_RETRIES', async () => {
      const entry: PendingComposedPostSyncEntry = {
        op: 'create',
        filePath: 'path/post.md',
        clientPostId: 'cid-maxfail',
        queuedAt: '2026-01-01T00:00:00Z',
        retryCount: 2, // one more will hit MAX_RETRIES (3)
      };
      settings = makeSettings([entry]);

      const writtenFm: Record<string, unknown>[] = [];
      const app = makeMockApp(async (_file, fn) => {
        const fm: Record<string, unknown> = {};
        fn(fm);
        writtenFm.push(fm);
      });

      const apiClient = makeMockApiClient({
        createComposedPost: vi.fn().mockRejectedValue(new Error('Persistent error')),
      });

      const service = new ComposedPostSyncService(app, makeMockVault(), settings, apiClient, saveSettings);

      await service.flush();

      expect(settings.pendingComposedPostSyncs).toHaveLength(0);
      expect(writtenFm.some((fm) => fm['syncState'] === 'failed')).toBe(true);
    });
  });

  // ============================================================================
  // Flush — update operation
  // ============================================================================

  describe('flush — update', () => {
    it('calls updateComposedPost and writes syncState=synced', async () => {
      const entry: PendingComposedPostSyncEntry = {
        op: 'update',
        filePath: 'path/post.md',
        clientPostId: 'cid-u1',
        sourceArchiveId: 'srv-99',
        queuedAt: '2026-01-01T00:00:00Z',
        retryCount: 0,
      };
      settings = makeSettings([entry]);

      const writtenFm: Record<string, unknown>[] = [];
      const app = makeMockApp(async (_file, fn) => {
        const fm: Record<string, unknown> = {};
        fn(fm);
        writtenFm.push(fm);
      });

      const apiClient = makeMockApiClient();
      const service = new ComposedPostSyncService(app, makeMockVault(), settings, apiClient, saveSettings);

      await service.flush();

      expect(apiClient.updateComposedPost).toHaveBeenCalledWith(
        'srv-99',
        expect.objectContaining({ clientPostId: 'cid-u1' })
      );
      expect(writtenFm[0]).toMatchObject({ syncState: 'synced' });
      expect(settings.pendingComposedPostSyncs).toHaveLength(0);
    });
  });

  // ============================================================================
  // File deletion detection
  // ============================================================================

  describe('onPluginLoad file deletion listener', () => {
    it('removes queue entry when matching file is deleted', async () => {
      const entry: PendingComposedPostSyncEntry = {
        op: 'create',
        filePath: 'path/to/delete.md',
        clientPostId: 'cid-del',
        queuedAt: '2026-01-01T00:00:00Z',
        retryCount: 0,
      };
      settings = makeSettings([entry]);

      let deleteHandler: ((f: { path: string }) => void) | undefined;
      const vault = {
        getFileByPath: vi.fn().mockReturnValue({ path: 'path/to/delete.md' }),
        read: vi.fn().mockResolvedValue('---\nauthor: Test\n---\nbody'),
        readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
        on: vi.fn().mockImplementation((_event: string, fn: (f: { path: string }) => void) => {
          deleteHandler = fn;
        }),
        off: vi.fn(),
      } as unknown as Vault;

      // Don't actually flush (queue has a file that "exists" only in vault mock)
      // Just test the delete listener wiring
      const apiClient = makeMockApiClient({
        createComposedPost: vi.fn().mockResolvedValue({ archiveId: 'x', createdAt: 'y' }),
      });

      const service = new ComposedPostSyncService(makeMockApp(), vault, settings, apiClient, saveSettings);
      await service.onPluginLoad();

      // Simulate file deletion event
      deleteHandler?.({ path: 'path/to/delete.md' });

      // Allow microtask to run
      await Promise.resolve();

      expect(settings.pendingComposedPostSyncs).toHaveLength(0);
    });
  });

  // ============================================================================
  // Update debounce + fingerprint
  // ============================================================================

  describe('enqueueUpdateDebounced', () => {
    it('skips enqueue when content fingerprint is unchanged', async () => {
      const content = '---\nauthor: Test\n---\nSame body';
      const vault = makeMockVault(content);
      const apiClient = makeMockApiClient();
      const service = new ComposedPostSyncService(makeMockApp(), vault, settings, apiClient, saveSettings);

      // First call sets the fingerprint; after debounce fires, maybeEnqueueUpdate
      // calls enqueueUpdate then flush() — the API is called and queue is cleared.
      service.enqueueUpdateDebounced('path/post.md', 'cid-fp', 'srv-1');
      await new Promise((r) => setTimeout(r, 2100));

      // Debounce fired → update was enqueued and flushed (API called once)
      expect((apiClient.updateComposedPost as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
      // Queue was cleared by flush
      expect(settings.pendingComposedPostSyncs).toHaveLength(0);

      // Second call with same content — fingerprint matches, should skip
      service.enqueueUpdateDebounced('path/post.md', 'cid-fp', 'srv-1');
      await new Promise((r) => setTimeout(r, 2100));

      // API still called only once — second call was skipped due to unchanged fingerprint
      expect((apiClient.updateComposedPost as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
      expect(settings.pendingComposedPostSyncs).toHaveLength(0);
    }, 10000);

    it('enqueues update when content fingerprint changes', async () => {
      let readCount = 0;
      const contents = ['---\nauthor: Test\n---\nBody v1', '---\nauthor: Test\n---\nBody v2'];
      const mockFile = { path: 'path/post.md' } as TFile;
      const vault = {
        getFileByPath: vi.fn().mockReturnValue(mockFile),
        read: vi.fn().mockImplementation(() => Promise.resolve(contents[readCount++ % 2])),
        readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as Vault;

      const apiClient = makeMockApiClient();
      const service = new ComposedPostSyncService(makeMockApp(), vault, settings, apiClient, saveSettings);

      // First call
      service.enqueueUpdateDebounced('path/post.md', 'cid-change', 'srv-2');
      await new Promise((r) => setTimeout(r, 2100));
      expect(settings.pendingComposedPostSyncs.length + (apiClient.updateComposedPost as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);

      // Second call with different content
      service.enqueueUpdateDebounced('path/post.md', 'cid-change', 'srv-2');
      await new Promise((r) => setTimeout(r, 2100));
      // Should have attempted update (either queued or called API)
      expect((apiClient.updateComposedPost as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    }, 10000);

    it('cancels pending debounce timer on file deletion via vault event', async () => {
      let deleteHandler: ((f: { path: string }) => void) | undefined;
      const mockFile = { path: 'path/post.md' } as TFile;
      const vault = {
        getFileByPath: vi.fn().mockReturnValue(mockFile),
        read: vi.fn().mockResolvedValue('---\nauthor: Test\n---\nBody'),
        readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
        on: vi.fn().mockImplementation((_event: string, fn: (f: { path: string }) => void) => {
          deleteHandler = fn;
        }),
        off: vi.fn(),
      } as unknown as Vault;

      const apiClient = makeMockApiClient({
        createComposedPost: vi.fn().mockResolvedValue({ archiveId: 'x', createdAt: 'y' }),
      });
      const service = new ComposedPostSyncService(makeMockApp(), vault, settings, apiClient, saveSettings);
      await service.onPluginLoad();

      // Add an entry and schedule a debounce
      await service.enqueueCreate('path/post.md', 'cid-cancel');
      service.enqueueUpdateDebounced('path/post.md', 'cid-cancel', 'srv-3');

      // Simulate file deletion before debounce fires
      deleteHandler?.({ path: 'path/post.md' });
      await Promise.resolve();

      // Queue should be empty (entry removed, debounce cancelled)
      expect(settings.pendingComposedPostSyncs).toHaveLength(0);
    });

    it('clears all debounce timers on plugin unload', () => {
      const service = new ComposedPostSyncService(makeMockApp(), makeMockVault(), settings, makeMockApiClient(), saveSettings);

      service.enqueueUpdateDebounced('path/a.md', 'cid-a', 'srv-a');
      service.enqueueUpdateDebounced('path/b.md', 'cid-b', 'srv-b');

      // Should not throw — clears timers
      expect(() => service.onPluginUnload()).not.toThrow();
    });
  });

  // ============================================================================
  // Background MetadataCache watcher
  // ============================================================================

  describe('background edit detection (MetadataCache.changed)', () => {
    it('registers MetadataCache listener on plugin load', async () => {
      const metadataCache = makeMockMetadataCache();
      const app = makeMockApp(undefined, metadataCache);

      const vault = {
        getFileByPath: vi.fn().mockReturnValue(null),
        read: vi.fn(),
        readBinary: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as Vault;

      const service = new ComposedPostSyncService(app, vault, settings, makeMockApiClient(), saveSettings);
      await service.onPluginLoad();

      expect(metadataCache.on).toHaveBeenCalledWith('changed', expect.any(Function));
    });

    it('does not trigger update for non-composer files', async () => {
      const mockFile = { path: 'notes/random.md' } as TFile;
      const metadataCache = makeMockMetadataCache({
        postOrigin: 'archive', // NOT 'composer'
        sourceArchiveId: 'srv-99',
        clientPostId: 'cid-x',
      });
      const app = makeMockApp(undefined, metadataCache);
      const vault = {
        getFileByPath: vi.fn().mockReturnValue(mockFile),
        read: vi.fn().mockResolvedValue('---\nauthor: Test\n---\nBody'),
        readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as Vault;

      const apiClient = makeMockApiClient();
      const service = new ComposedPostSyncService(app, vault, settings, apiClient, saveSettings);
      await service.onPluginLoad();

      // Trigger metadata changed for a non-composer file
      metadataCache.trigger(mockFile);

      // Wait beyond debounce period
      await new Promise((r) => setTimeout(r, 5200));

      expect(apiClient.updateComposedPost).not.toHaveBeenCalled();
    }, 10000);

    it('does not trigger update for composer files without sourceArchiveId (not yet synced)', async () => {
      const mockFile = { path: 'posts/draft.md' } as TFile;
      const metadataCache = makeMockMetadataCache({
        postOrigin: 'composer',
        clientPostId: 'cid-draft',
        // sourceArchiveId intentionally absent — post not yet synced
      });
      const app = makeMockApp(undefined, metadataCache);
      const vault = {
        getFileByPath: vi.fn().mockReturnValue(mockFile),
        read: vi.fn().mockResolvedValue('---\npostOrigin: composer\n---\nDraft body'),
        readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as Vault;

      const apiClient = makeMockApiClient();
      const service = new ComposedPostSyncService(app, vault, settings, apiClient, saveSettings);
      await service.onPluginLoad();

      metadataCache.trigger(mockFile);

      await new Promise((r) => setTimeout(r, 5200));

      expect(apiClient.updateComposedPost).not.toHaveBeenCalled();
    }, 10000);

    it('enqueues update after debounce when composer file with sourceArchiveId changes', async () => {
      const mockFile = { path: 'posts/synced.md' } as TFile;
      const metadataCache = makeMockMetadataCache({
        postOrigin: 'composer',
        sourceArchiveId: 'srv-bg-1',
        clientPostId: 'cid-bg-1',
      });
      const app = makeMockApp(undefined, metadataCache);
      const vault = {
        getFileByPath: vi.fn().mockReturnValue(mockFile),
        read: vi.fn().mockResolvedValue('---\npostOrigin: composer\nsourceArchiveId: srv-bg-1\nclientPostId: cid-bg-1\n---\nEdited body content'),
        readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as Vault;

      const apiClient = makeMockApiClient();
      const service = new ComposedPostSyncService(app, vault, settings, apiClient, saveSettings);
      await service.onPluginLoad();

      // Trigger background edit detection
      metadataCache.trigger(mockFile);

      // Wait for the 5s background debounce + some margin
      await new Promise((r) => setTimeout(r, 5200));

      // Should have called updateComposedPost (content was fresh so fingerprint was new)
      expect(apiClient.updateComposedPost).toHaveBeenCalledWith(
        'srv-bg-1',
        expect.objectContaining({ clientPostId: 'cid-bg-1' })
      );
    }, 12000);

    it('collapses rapid MetadataCache events into one update via debounce', async () => {
      const mockFile = { path: 'posts/rapid.md' } as TFile;
      const metadataCache = makeMockMetadataCache({
        postOrigin: 'composer',
        sourceArchiveId: 'srv-rapid',
        clientPostId: 'cid-rapid',
      });
      const app = makeMockApp(undefined, metadataCache);
      const vault = {
        getFileByPath: vi.fn().mockReturnValue(mockFile),
        read: vi.fn().mockResolvedValue('---\npostOrigin: composer\nsourceArchiveId: srv-rapid\nclientPostId: cid-rapid\n---\nRapid edits'),
        readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as Vault;

      const apiClient = makeMockApiClient();
      const service = new ComposedPostSyncService(app, vault, settings, apiClient, saveSettings);
      await service.onPluginLoad();

      // Fire 5 rapid events — only the last one should result in an API call
      metadataCache.trigger(mockFile);
      metadataCache.trigger(mockFile);
      metadataCache.trigger(mockFile);
      metadataCache.trigger(mockFile);
      metadataCache.trigger(mockFile);

      await new Promise((r) => setTimeout(r, 5300));

      // Should only have been called once (debounce collapsed 5 events)
      expect((apiClient.updateComposedPost as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    }, 12000);

    it('unregisters MetadataCache listener on plugin unload', async () => {
      const metadataCache = makeMockMetadataCache();
      const app = makeMockApp(undefined, metadataCache);

      const vault = {
        getFileByPath: vi.fn().mockReturnValue(null),
        read: vi.fn(),
        readBinary: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as Vault;

      const service = new ComposedPostSyncService(app, vault, settings, makeMockApiClient(), saveSettings);
      await service.onPluginLoad();

      service.onPluginUnload();

      expect(metadataCache.offref).toHaveBeenCalledWith(expect.objectContaining({ id: 'ref-1' }));
    });
  });

  // ============================================================================
  // Self-write suppression
  // ============================================================================

  describe('self-write suppression', () => {
    it('does not re-trigger update after flush writes syncState to frontmatter', async () => {
      const mockFile = { path: 'posts/synced.md' } as TFile;
      const metadataCache = makeMockMetadataCache({
        postOrigin: 'composer',
        sourceArchiveId: 'srv-suppress',
        clientPostId: 'cid-suppress',
      });

      const writtenFm: Record<string, unknown>[] = [];
      // processFrontMatter triggers metadataCache changed after writing
      const processFrontMatter = vi.fn().mockImplementation(async (_file: TFile, fn: (fm: Record<string, unknown>) => void) => {
        const fm: Record<string, unknown> = {};
        fn(fm);
        writtenFm.push(fm);
        // Simulate Obsidian triggering MetadataCache.changed after our write
        metadataCache.trigger(mockFile);
      });

      const app = makeMockApp(processFrontMatter, metadataCache);
      const vault = {
        getFileByPath: vi.fn().mockReturnValue(mockFile),
        read: vi.fn().mockResolvedValue('---\npostOrigin: composer\nsourceArchiveId: srv-suppress\nclientPostId: cid-suppress\n---\nContent'),
        readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as Vault;

      const entry: PendingComposedPostSyncEntry = {
        op: 'update',
        filePath: 'posts/synced.md',
        clientPostId: 'cid-suppress',
        sourceArchiveId: 'srv-suppress',
        queuedAt: '2026-01-01T00:00:00Z',
        retryCount: 0,
      };
      settings = makeSettings([entry]);

      const apiClient = makeMockApiClient();
      const service = new ComposedPostSyncService(app, vault, settings, apiClient, saveSettings);
      await service.onPluginLoad();

      // Flush the pending update — should write syncState='synced', which triggers MetadataCache.changed
      await service.flush();

      // The MetadataCache.changed event fired during processFrontMatter should be suppressed
      // Wait beyond background debounce period
      await new Promise((r) => setTimeout(r, 5300));

      // API should only have been called once (from the flush, not again from the suppressed event)
      expect((apiClient.updateComposedPost as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    }, 12000);
  });
});
