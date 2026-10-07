import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

/** What savePost writes; PostDataParser skips a 'post' note missing any of these. */
const NOTE_FRONTMATTER = { platform: 'post', author: 'Test', published: '2026-03-26 09:00' };

/** A composed note as savePost writes it: body, then the template's footer. */
function composerNote(body: string, frontmatter: Record<string, string> = {}): string {
  const yaml = Object.entries({ ...NOTE_FRONTMATTER, ...frontmatter })
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
  return `---\n${yaml}\n---\n\n${body}\n\n---\n\n**Author:** Test | **Published:** 2026-03-26 09:00\n`;
}

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
        ? { frontmatter: { ...NOTE_FRONTMATTER, ...fileFrontmatter } }
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

function makeMockVault(fileContent = composerNote('Body content'), fileExists = true) {
  const mockFile = { path: 'test/path.md' } as TFile;
  const read = vi.fn().mockResolvedValue(fileContent);
  return {
    getFileByPath: vi.fn().mockReturnValue(fileExists ? mockFile : null),
    read,
    cachedRead: read,
    readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Vault;
}

function makeMockApiClient(overrides?: Partial<WorkersAPIClient>) {
  return {
    createComposedPost: vi.fn().mockResolvedValue({ archiveId: 'srv-123', createdAt: '2026-03-26T00:00:00Z' }),
    updateComposedPost: vi.fn().mockResolvedValue({ success: true, updatedAt: '2026-03-26T00:00:00Z' }),
    uploadComposedMedia: vi.fn().mockResolvedValue({
      r2Url: 'https://cdn/m1', r2Key: 'k1', type: 'image', contentType: 'image/jpeg', size: 1,
    }),
    ...overrides,
  } as unknown as WorkersAPIClient;
}

function makeSettings(queue: PendingComposedPostSyncEntry[] = []): SocialArchiverSettings {
  return {
    pendingComposedPostSyncs: queue,
  } as unknown as SocialArchiverSettings;
}

function createEntry(clientPostId: string, filePath = 'path/post.md'): PendingComposedPostSyncEntry {
  return { op: 'create', filePath, clientPostId, queuedAt: '2026-01-01T00:00:00Z', retryCount: 0 };
}

/** What WorkersAPIClient.request throws for a non-2xx response. */
function httpError(message: string, status = 400): Error {
  return Object.assign(new Error(message), { status });
}

describe('ComposedPostSyncService', () => {
  let settings: SocialArchiverSettings;
  let saveSettings: () => Promise<void>;

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
        expect.objectContaining({ clientPostId: 'cid-1', fullContent: 'Body content' })
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

    it('spends a retry when the server rejects the post', async () => {
      settings = makeSettings([createEntry('cid-fail')]);

      const apiClient = makeMockApiClient({
        createComposedPost: vi.fn().mockRejectedValue(httpError('Invalid request body')),
      });

      const service = new ComposedPostSyncService(makeMockApp(), makeMockVault(), settings, apiClient, saveSettings);

      await service.flush();

      expect(settings.pendingComposedPostSyncs[0]?.retryCount).toBe(1);
      expect(settings.pendingComposedPostSyncs[0]?.lastError).toContain('Invalid request body');
    });

    it('keeps the entry through failures that pass, without spending a retry', async () => {
      settings = makeSettings([createEntry('cid-wait')]);
      const createComposedPost = vi.fn();
      const service = new ComposedPostSyncService(
        makeMockApp(), makeMockVault(), settings, makeMockApiClient({ createComposedPost }), saveSettings
      );

      // Offline, signed out, over quota, rate limited, server down: each would
      // have cost one of three tries now that every startup flushes.
      for (const failure of [
        new Error('net::ERR_INTERNET_DISCONNECTED'),
        httpError('Unauthorized', 401),
        httpError('Monthly limit reached', 402),
        httpError('Too many requests', 429),
        httpError('Service unavailable', 503),
      ]) {
        createComposedPost.mockRejectedValueOnce(failure);
        await service.flush();
      }

      expect(settings.pendingComposedPostSyncs).toEqual([
        expect.objectContaining({ clientPostId: 'cid-wait', retryCount: 0, lastError: 'Service unavailable' }),
      ]);
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
        createComposedPost: vi.fn().mockRejectedValue(httpError('Persistent error')),
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
        expect.objectContaining({ fullContent: 'Body content' })
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
        on: vi.fn().mockImplementation((event: string, fn: (f: { path: string }) => void) => {
          if (event === 'delete') deleteHandler = fn;
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
  // File rename detection
  // ============================================================================

  describe('onPluginLoad file rename listener', () => {
    /**
     * Like Obsidian: a TFile is found only at its current path, and a rename
     * updates that same TFile's path, then fires 'rename' with the old one.
     */
    function renamingVault(...paths: string[]): { vault: Vault; rename: (oldPath: string, newPath: string) => void } {
      const files = paths.map((path) => ({ path }) as TFile);
      let renameHandler: ((file: TFile, oldPath: string) => void) | undefined;
      const vault = {
        ...makeMockVault(),
        getFileByPath: vi.fn((path: string) => files.find((f) => f.path === path) ?? null),
        on: vi.fn((event: string, fn: (file: TFile, oldPath: string) => void) => {
          if (event === 'rename') renameHandler = fn;
        }),
      } as unknown as Vault;
      const rename = (oldPath: string, newPath: string): void => {
        const file = files.find((f) => f.path === oldPath);
        if (!file) throw new Error(`No file at ${oldPath}`);
        file.path = newPath;
        renameHandler?.(file, oldPath);
      };
      return { vault, rename };
    }

    /** processFrontMatter that records the path each write landed on. */
    function stampRecordingApp(): { app: App; stamps: { path: string; fm: Record<string, unknown> }[] } {
      const stamps: { path: string; fm: Record<string, unknown> }[] = [];
      const app = makeMockApp(async (file, fn) => {
        const fm: Record<string, unknown> = {};
        fn(fm);
        stamps.push({ path: file.path, fm });
      });
      return { app, stamps };
    }

    it('creates a queued post whose note was moved, and stamps it at the new path', async () => {
      settings = makeSettings([createEntry('cid-moved', 'Drafts/post.md')]);
      const { vault, rename } = renamingVault('Drafts/post.md');
      const { app, stamps } = stampRecordingApp();
      const createComposedPost = vi.fn()
        .mockRejectedValueOnce(new Error('net::ERR_INTERNET_DISCONNECTED'))
        .mockResolvedValue({ archiveId: 'srv-moved', createdAt: '2026-03-26T00:00:00Z' });
      const service = new ComposedPostSyncService(
        app, vault, settings, makeMockApiClient({ createComposedPost }), saveSettings
      );

      await service.onPluginLoad(); // offline: the create stays queued
      vi.mocked(saveSettings).mockClear();
      rename('Drafts/post.md', 'Archive/2026/post.md');

      // Saved, so a restart before the next flush still finds the note.
      expect(saveSettings).toHaveBeenCalledTimes(1);
      expect(settings.pendingComposedPostSyncs).toEqual([
        expect.objectContaining({ clientPostId: 'cid-moved', filePath: 'Archive/2026/post.md' }),
      ]);

      await service.flush(); // back online

      expect(createComposedPost).toHaveBeenCalledTimes(2);
      expect(stamps).toEqual([{
        path: 'Archive/2026/post.md',
        fm: expect.objectContaining({ clientPostId: 'cid-moved', sourceArchiveId: 'srv-moved', syncState: 'synced' }),
      }]);
      expect(settings.pendingComposedPostSyncs).toHaveLength(0);
    });

    it('follows a note moved while the running flush pass is still on an earlier entry', async () => {
      settings = makeSettings([createEntry('cid-1', 'Drafts/one.md'), createEntry('cid-2', 'Drafts/two.md')]);
      const { vault, rename } = renamingVault('Drafts/one.md', 'Drafts/two.md');
      const { app, stamps } = stampRecordingApp();
      let release = (): void => {};
      const createComposedPost = vi.fn()
        .mockImplementationOnce(() => new Promise((resolve) => {
          release = (): void => resolve({ archiveId: 'srv-1', createdAt: '2026-03-26T00:00:00Z' });
        }))
        .mockResolvedValue({ archiveId: 'srv-2', createdAt: '2026-03-26T00:00:00Z' });
      const service = new ComposedPostSyncService(
        app, vault, settings, makeMockApiClient({ createComposedPost }), saveSettings
      );

      const startup = service.onPluginLoad();
      await vi.waitFor(() => expect(createComposedPost).toHaveBeenCalledTimes(1));
      rename('Drafts/two.md', 'Archive/two.md'); // the pass already took its snapshot
      release();
      await startup;

      expect(stamps.map(({ path, fm }) => [path, fm['sourceArchiveId']])).toEqual([
        ['Drafts/one.md', 'srv-1'],
        ['Archive/two.md', 'srv-2'],
      ]);
      expect(settings.pendingComposedPostSyncs).toHaveLength(0);
    });
  });

  // ============================================================================
  // Update debounce + fingerprint
  // ============================================================================

  describe('enqueueUpdateDebounced', () => {
    it('skips enqueue when content fingerprint is unchanged', async () => {
      const content = composerNote('Same body');
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
      const contents = [composerNote('Body v1'), composerNote('Body v2')];
      const mockFile = { path: 'path/post.md' } as TFile;
      const vault = {
        getFileByPath: vi.fn().mockReturnValue(mockFile),
        read: vi.fn().mockImplementation(() => Promise.resolve(contents[readCount++ % 2])),
        cachedRead: vi.fn().mockResolvedValue(composerNote('Body v2')),
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
        on: vi.fn().mockImplementation((event: string, fn: (f: { path: string }) => void) => {
          if (event === 'delete') deleteHandler = fn;
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
        read: vi.fn().mockResolvedValue(composerNote('Edited body content')),
        cachedRead: vi.fn().mockResolvedValue(composerNote('Edited body content')),
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
        expect.objectContaining({ fullContent: 'Edited body content' })
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
        read: vi.fn().mockResolvedValue(composerNote('Rapid edits')),
        cachedRead: vi.fn().mockResolvedValue(composerNote('Rapid edits')),
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
  // Own sync writes
  // ============================================================================

  describe('own sync writes', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('do not send the post again, while an edit made right after a sync does', async () => {
      vi.useFakeTimers();
      const mockFile = { path: 'posts/synced.md' } as TFile;
      const metadataCache = makeMockMetadataCache({
        postOrigin: 'composer',
        sourceArchiveId: 'srv-own',
        clientPostId: 'cid-own',
      });
      // Like Obsidian, MetadataCache reports our own processFrontMatter write.
      const app = makeMockApp(async (_file, fn) => {
        fn({});
        metadataCache.trigger(mockFile);
      }, metadataCache);
      let note = composerNote('Synced text');
      const read = vi.fn(async () => note);
      const vault = { ...makeMockVault(), getFileByPath: vi.fn().mockReturnValue(mockFile), read, cachedRead: read } as unknown as Vault;
      settings = makeSettings([{
        op: 'update',
        filePath: mockFile.path,
        clientPostId: 'cid-own',
        sourceArchiveId: 'srv-own',
        queuedAt: '2026-01-01T00:00:00Z',
        retryCount: 0,
      }]);
      const apiClient = makeMockApiClient();
      const service = new ComposedPostSyncService(app, vault, settings, apiClient, saveSettings);

      await service.onPluginLoad();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(apiClient.updateComposedPost).toHaveBeenCalledTimes(1);

      // A 10 s window after each sync used to swallow this edit.
      note = composerNote('Edited a second later');
      metadataCache.trigger(mockFile);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(apiClient.updateComposedPost).toHaveBeenCalledTimes(2);
      expect(apiClient.updateComposedPost).toHaveBeenLastCalledWith(
        'srv-own',
        expect.objectContaining({ fullContent: 'Edited a second later' })
      );
    });
  });

  // ============================================================================
  // The plugin's one instance: overlapping flushes, stop/start, live settings
  // ============================================================================

  describe('as the plugin-wide instance', () => {
    it('sends each entry once when flushes overlap, and what was queued during the pass', async () => {
      settings = makeSettings([createEntry('cid-1', 'path/one.md')]);
      let release = (): void => {};
      const createComposedPost = vi.fn()
        .mockImplementationOnce(() => new Promise((resolve) => {
          release = (): void => resolve({ archiveId: 'srv-1', createdAt: '2026-03-26T00:00:00Z' });
        }))
        .mockResolvedValue({ archiveId: 'srv-2', createdAt: '2026-03-26T00:00:00Z' });
      const service = new ComposedPostSyncService(
        makeMockApp(), makeMockVault(), settings, makeMockApiClient({ createComposedPost }), saveSettings
      );

      const startup = service.flush();
      await vi.waitFor(() => expect(createComposedPost).toHaveBeenCalledTimes(1));
      // The composer queues a second post and flushes while the first is in flight.
      await service.enqueueCreate('path/two.md', 'cid-2');
      const composer = service.flush();
      release();
      await Promise.all([startup, composer]);

      expect(createComposedPost.mock.calls.map(([request]) => (request as { clientPostId: string }).clientPostId))
        .toEqual(['cid-1', 'cid-2']);
      expect(settings.pendingComposedPostSyncs).toHaveLength(0);
    });

    it('sends nothing while stopped, and starting again only flushes', async () => {
      settings = makeSettings([createEntry('cid-wait')]);
      const app = makeMockApp();
      const vault = makeMockVault();
      const apiClient = makeMockApiClient();
      const service = new ComposedPostSyncService(app, vault, settings, apiClient, saveSettings);

      service.onPluginUnload(); // signed out
      await service.flush(); // the composer
      expect(apiClient.createComposedPost).not.toHaveBeenCalled();
      expect(settings.pendingComposedPostSyncs).toHaveLength(1);

      await service.onPluginLoad(); // signed in
      await service.onPluginLoad(); // any later settings save re-inits
      expect(apiClient.createComposedPost).toHaveBeenCalledTimes(1);
      expect(settings.pendingComposedPostSyncs).toHaveLength(0);
      expect(vault.on).toHaveBeenCalledTimes(2); // 'delete' and 'rename', once
      expect(app.metadataCache.on).toHaveBeenCalledTimes(1);
    });

    it('writes the queue into the settings object the plugin holds now', async () => {
      // saveSettingsPartial() replaces the plugin's settings object on every save.
      let current = makeSettings([createEntry('cid-1', 'path/one.md'), createEntry('cid-2', 'path/two.md')]);
      const save = vi.fn(async () => {
        current = { ...current };
      });
      const service = new ComposedPostSyncService(makeMockApp(), makeMockVault(), () => current, makeMockApiClient(), save);

      await service.flush();

      // A held reference removed cid-2 from a copy the plugin had already dropped.
      expect(current.pendingComposedPostSyncs).toHaveLength(0);
    });
  });
});
