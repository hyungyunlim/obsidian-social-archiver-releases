/**
 * ArchiveStateSyncService — Unit Tests
 *
 * Tests the inbound bookmark-state sync from WebSocket events:
 * - Early-exit guards (isBookmarked undefined, echo prevention, suppression)
 * - File lookup: sourceArchiveId (O(1)) → server fetch → originalUrl fallback
 * - No-op guard: fm.archive already matches incoming value
 * - Happy path: writes fm.archive, no backfill when sourceArchiveId found
 * - Backfill: sourceArchiveId written to frontmatter when lookup used URL fallback
 * - Ambiguous originalUrl: skip and do not write
 * - API error on fallback fetch: graceful return, no write
 * - processFrontMatter error: logged, no throw
 * - Suppression API: addSuppression / isSuppressed lifecycle and TTL expiry
 *
 * All Obsidian API surfaces (fileManager.processFrontMatter, metadataCache.getFileCache)
 * and external dependencies (WorkersAPIClient, ArchiveLookupService) are replaced
 * with vi.fn() stubs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArchiveStateSyncService } from '../../../plugin/sync/ArchiveStateSyncService';
import type { ActionUpdatedEventData } from '../../../types/websocket';
import type { TFile } from 'obsidian';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFile(path: string): TFile {
  return { path, extension: 'md' } as unknown as TFile;
}

function makeEventData(
  overrides: Partial<ActionUpdatedEventData> = {},
): ActionUpdatedEventData {
  return {
    archiveId: 'archive-abc',
    changes: { isBookmarked: true },
    updatedAt: '2026-03-27T12:00:00.000Z',
    timestamp: Date.now(),
    ...overrides,
  };
}

// ─── Mock factories ───────────────────────────────────────────────────────────

/**
 * Build a minimal App mock.
 *
 * @param currentFrontmatter - The frontmatter the cache returns for any file.
 *                             Controls the no-op guard comparison.
 * @param processFrontMatterFn - Optional override to capture/inspect the updater call.
 */
function makeApp(
  options: {
    currentFrontmatter?: Record<string, unknown>;
    processFrontMatterError?: Error;
  } = {},
) {
  const capturedFm: Record<string, unknown>[] = [];

  const app = {
    metadataCache: {
      getFileCache: vi.fn().mockReturnValue(
        options.currentFrontmatter !== undefined
          ? { frontmatter: options.currentFrontmatter }
          : null,
      ),
    },
    fileManager: {
      processFrontMatter: vi.fn().mockImplementation(
        async (_file: TFile, updater: (fm: Record<string, unknown>) => void) => {
          if (options.processFrontMatterError) throw options.processFrontMatterError;
          const fm: Record<string, unknown> = {};
          capturedFm.push(fm);
          updater(fm);
        },
      ),
    },
    _capturedFm: capturedFm,
  };

  return app;
}

function makeApiClient(options: {
  originalUrl?: string;
  throwError?: Error;
} = {}) {
  return {
    getUserArchive: vi.fn().mockImplementation(async () => {
      if (options.throwError) throw options.throwError;
      return {
        archive: {
          id: 'archive-abc',
          originalUrl: options.originalUrl ?? 'https://example.com/post/1',
        },
      };
    }),
  };
}

function makeArchiveLookup(options: {
  byId?: TFile | null;
  byUrl?: TFile[];
} = {}) {
  return {
    findBySourceArchiveId: vi.fn().mockReturnValue(options.byId ?? null),
    findByOriginalUrl: vi.fn().mockReturnValue(options.byUrl ?? []),
  };
}

function makeSettings(syncClientId = 'client-xyz') {
  return () => ({ syncClientId } as any);
}

function makeService(overrides: {
  app?: ReturnType<typeof makeApp>;
  apiClient?: ReturnType<typeof makeApiClient>;
  archiveLookup?: ReturnType<typeof makeArchiveLookup>;
  getSettings?: () => any;
} = {}) {
  const app = overrides.app ?? makeApp();
  const apiClient = overrides.apiClient ?? makeApiClient();
  const archiveLookup = overrides.archiveLookup ?? makeArchiveLookup();
  const getSettings = overrides.getSettings ?? makeSettings();

  const service = new ArchiveStateSyncService(
    app as any,
    apiClient as any,
    archiveLookup as any,
    getSettings,
  );

  return { service, app, apiClient, archiveLookup };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ArchiveStateSyncService', () => {

  // ── Early-exit guards ──────────────────────────────────────────────────────

  describe('early-exit guards', () => {
    it('returns immediately when isBookmarked is undefined', async () => {
      const { service, apiClient } = makeService();
      await service.handleRemoteArchiveState(makeEventData({ changes: {} }));
      expect(apiClient.getUserArchive).not.toHaveBeenCalled();
    });

    it('returns immediately when sourceClientId matches own syncClientId (echo prevention)', async () => {
      const { service, apiClient } = makeService({
        getSettings: makeSettings('my-client'),
      });

      await service.handleRemoteArchiveState(
        makeEventData({ sourceClientId: 'my-client', changes: { isBookmarked: true } }),
      );

      expect(apiClient.getUserArchive).not.toHaveBeenCalled();
    });

    it('does NOT skip when sourceClientId is different from own syncClientId', async () => {
      const file = makeFile('post.md');
      const { service, apiClient, archiveLookup } = makeService({
        app: makeApp({ currentFrontmatter: { archive: false } }),
        archiveLookup: makeArchiveLookup({ byId: file }),
        getSettings: makeSettings('my-client'),
      });

      await service.handleRemoteArchiveState(
        makeEventData({ sourceClientId: 'other-client', changes: { isBookmarked: true } }),
      );

      // lookup was attempted and apiClient NOT needed (found via sourceArchiveId)
      expect(archiveLookup.findBySourceArchiveId).toHaveBeenCalled();
      expect(apiClient.getUserArchive).not.toHaveBeenCalled();
    });

    it('returns immediately when archiveId is in active suppression window', async () => {
      const { service, apiClient } = makeService();

      service.addSuppression('archive-abc');

      await service.handleRemoteArchiveState(makeEventData({ changes: { isBookmarked: true } }));

      expect(apiClient.getUserArchive).not.toHaveBeenCalled();
    });

    it('does NOT skip when suppression has expired', async () => {
      const file = makeFile('post.md');
      const { service, apiClient, archiveLookup } = makeService({
        app: makeApp({ currentFrontmatter: { archive: false } }),
        archiveLookup: makeArchiveLookup({ byId: file }),
      });

      // Manually inject a stale timestamp (11 seconds ago > 10s TTL)
      (service as any).suppressionMap.set('archive-abc', Date.now() - 11_000);

      await service.handleRemoteArchiveState(makeEventData({ changes: { isBookmarked: true } }));

      // Should proceed past suppression check
      expect(archiveLookup.findBySourceArchiveId).toHaveBeenCalled();
      expect(apiClient.getUserArchive).not.toHaveBeenCalled(); // found via sourceArchiveId
    });

    it('returns without writing when fm.archive already equals incoming value (no-op)', async () => {
      const file = makeFile('post.md');
      // Current frontmatter has archive: true, incoming is also true
      const app = makeApp({ currentFrontmatter: { archive: true } });
      const { service } = makeService({
        app,
        archiveLookup: makeArchiveLookup({ byId: file }),
      });

      await service.handleRemoteArchiveState(makeEventData({ changes: { isBookmarked: true } }));

      expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
    });
  });

  // ── File lookup ────────────────────────────────────────────────────────────

  describe('file lookup', () => {
    it('uses sourceArchiveId lookup first (fast O(1) path)', async () => {
      const file = makeFile('Social Archives/post.md');
      const app = makeApp({ currentFrontmatter: { archive: false } });
      const { service, archiveLookup, apiClient } = makeService({
        app,
        archiveLookup: makeArchiveLookup({ byId: file }),
      });

      await service.handleRemoteArchiveState(makeEventData({ changes: { isBookmarked: true } }));

      expect(archiveLookup.findBySourceArchiveId).toHaveBeenCalledWith('archive-abc');
      // URL path should not be triggered
      expect(apiClient.getUserArchive).not.toHaveBeenCalled();
      expect(archiveLookup.findByOriginalUrl).not.toHaveBeenCalled();
    });

    it('falls back to server fetch + originalUrl when sourceArchiveId lookup misses', async () => {
      const file = makeFile('Social Archives/post.md');
      const app = makeApp({ currentFrontmatter: { archive: false } });
      const apiClient = makeApiClient({ originalUrl: 'https://example.com/post/1' });
      const archiveLookup = makeArchiveLookup({ byId: null, byUrl: [file] });

      const { service } = makeService({ app, apiClient, archiveLookup });

      await service.handleRemoteArchiveState(makeEventData({ changes: { isBookmarked: true } }));

      expect(apiClient.getUserArchive).toHaveBeenCalledWith('archive-abc');
      expect(archiveLookup.findByOriginalUrl).toHaveBeenCalledWith('https://example.com/post/1');
      expect(app.fileManager.processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));
    });

    it('returns without writing when no file found for archiveId or originalUrl', async () => {
      const app = makeApp();
      const archiveLookup = makeArchiveLookup({ byId: null, byUrl: [] });
      const { service } = makeService({ app, archiveLookup });

      await service.handleRemoteArchiveState(makeEventData({ changes: { isBookmarked: true } }));

      expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
    });

    it('skips write when originalUrl produces ambiguous (multiple) matches', async () => {
      const app = makeApp();
      const file1 = makeFile('Social Archives/post-a.md');
      const file2 = makeFile('Social Archives/post-b.md');
      const archiveLookup = makeArchiveLookup({ byId: null, byUrl: [file1, file2] });
      const { service } = makeService({ app, archiveLookup });

      await service.handleRemoteArchiveState(makeEventData({ changes: { isBookmarked: true } }));

      expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
    });

    it('returns gracefully when API fetch for URL fallback throws', async () => {
      const app = makeApp();
      const apiClient = makeApiClient({ throwError: new Error('Network error') });
      const archiveLookup = makeArchiveLookup({ byId: null });

      const { service } = makeService({ app, apiClient, archiveLookup });

      // Should not throw
      await expect(
        service.handleRemoteArchiveState(makeEventData({ changes: { isBookmarked: true } })),
      ).resolves.toBeUndefined();

      expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
    });
  });

  // ── Frontmatter writes ─────────────────────────────────────────────────────

  describe('frontmatter writes', () => {
    it('sets fm.archive = true when incoming isBookmarked is true', async () => {
      const file = makeFile('post.md');
      const app = makeApp({ currentFrontmatter: { archive: false } });
      const { service } = makeService({
        app,
        archiveLookup: makeArchiveLookup({ byId: file }),
      });

      await service.handleRemoteArchiveState(makeEventData({ changes: { isBookmarked: true } }));

      expect(app.fileManager.processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));
      // Verify updater sets fm.archive
      const updater = (app.fileManager.processFrontMatter as any).mock.calls[0][1];
      const fm: Record<string, unknown> = {};
      updater(fm);
      expect(fm.archive).toBe(true);
    });

    it('sets fm.archive = false when incoming isBookmarked is false', async () => {
      const file = makeFile('post.md');
      const app = makeApp({ currentFrontmatter: { archive: true } });
      const { service } = makeService({
        app,
        archiveLookup: makeArchiveLookup({ byId: file }),
      });

      await service.handleRemoteArchiveState(makeEventData({ changes: { isBookmarked: false } }));

      const updater = (app.fileManager.processFrontMatter as any).mock.calls[0][1];
      const fm: Record<string, unknown> = {};
      updater(fm);
      expect(fm.archive).toBe(false);
    });

    it('backfills sourceArchiveId into frontmatter when file was found via URL fallback', async () => {
      const file = makeFile('Social Archives/post.md');
      const app = makeApp({ currentFrontmatter: { archive: false } });
      const apiClient = makeApiClient({ originalUrl: 'https://example.com/post/1' });
      const archiveLookup = makeArchiveLookup({ byId: null, byUrl: [file] });

      const { service } = makeService({ app, apiClient, archiveLookup });

      await service.handleRemoteArchiveState(makeEventData({ changes: { isBookmarked: true } }));

      const updater = (app.fileManager.processFrontMatter as any).mock.calls[0][1];
      const fm: Record<string, unknown> = {};
      updater(fm);
      expect(fm.archive).toBe(true);
      expect(fm.sourceArchiveId).toBe('archive-abc');
    });

    it('does NOT overwrite an existing sourceArchiveId during backfill', async () => {
      const file = makeFile('Social Archives/post.md');
      const app = makeApp({ currentFrontmatter: { archive: false } });
      const apiClient = makeApiClient({ originalUrl: 'https://example.com/post/1' });
      const archiveLookup = makeArchiveLookup({ byId: null, byUrl: [file] });

      const { service } = makeService({ app, apiClient, archiveLookup });

      await service.handleRemoteArchiveState(makeEventData({ changes: { isBookmarked: true } }));

      const updater = (app.fileManager.processFrontMatter as any).mock.calls[0][1];
      // Pre-populate sourceArchiveId so the backfill guard fires
      const fm: Record<string, unknown> = { sourceArchiveId: 'already-set' };
      updater(fm);
      // The guard `if (sourceArchiveIdMissing && !fm.sourceArchiveId)` should keep the existing value
      expect(fm.sourceArchiveId).toBe('already-set');
    });

    it('does NOT write sourceArchiveId when file was found via sourceArchiveId lookup', async () => {
      const file = makeFile('post.md');
      const app = makeApp({ currentFrontmatter: { archive: false } });
      const { service } = makeService({
        app,
        archiveLookup: makeArchiveLookup({ byId: file }),
      });

      await service.handleRemoteArchiveState(makeEventData({ changes: { isBookmarked: true } }));

      const updater = (app.fileManager.processFrontMatter as any).mock.calls[0][1];
      const fm: Record<string, unknown> = {};
      updater(fm);
      // sourceArchiveIdMissing = false, so sourceArchiveId must not be written
      expect(fm.sourceArchiveId).toBeUndefined();
    });

    it('logs an error and does not throw when processFrontMatter rejects', async () => {
      const file = makeFile('post.md');
      const app = makeApp({
        currentFrontmatter: { archive: false },
        processFrontMatterError: new Error('disk full'),
      });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { service } = makeService({
        app,
        archiveLookup: makeArchiveLookup({ byId: file }),
      });

      await expect(
        service.handleRemoteArchiveState(makeEventData({ changes: { isBookmarked: true } })),
      ).resolves.toBeUndefined();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ArchiveStateSyncService]'),
        'Failed to update fm.archive:',
        file.path,
        'disk full',
      );

      consoleErrorSpy.mockRestore();
    });
  });

  // ── Suppression behaviour ──────────────────────────────────────────────────

  describe('suppression', () => {
    it('registers suppression before processFrontMatter so loop guard is active', async () => {
      const file = makeFile('post.md');
      let suppressionActiveAtWrite = false;
      const app = makeApp({ currentFrontmatter: { archive: false } });
      // Override processFrontMatter to check suppression mid-call
      let capturedService: ArchiveStateSyncService;
      (app.fileManager.processFrontMatter as any).mockImplementation(
        async (_file: TFile, _updater: (fm: Record<string, unknown>) => void) => {
          suppressionActiveAtWrite = capturedService.isSuppressed('archive-abc');
          const fm: Record<string, unknown> = {};
          _updater(fm);
        },
      );

      const { service } = makeService({
        app,
        archiveLookup: makeArchiveLookup({ byId: file }),
      });
      capturedService = service;

      await service.handleRemoteArchiveState(makeEventData({ changes: { isBookmarked: true } }));

      expect(suppressionActiveAtWrite).toBe(true);
    });

    it('addSuppression makes isSuppressed return true', () => {
      const { service } = makeService();
      expect(service.isSuppressed('archive-abc')).toBe(false);
      service.addSuppression('archive-abc');
      expect(service.isSuppressed('archive-abc')).toBe(true);
    });

    it('isSuppressed returns false after TTL expires', () => {
      const { service } = makeService();
      service.addSuppression('archive-abc');

      // Simulate TTL expiry by backdating the timestamp
      (service as any).suppressionMap.set('archive-abc', Date.now() - 11_000);

      expect(service.isSuppressed('archive-abc')).toBe(false);
      // Also verifies the entry was pruned
      expect((service as any).suppressionMap.has('archive-abc')).toBe(false);
    });

    it('isSuppressed returns false for an unknown archiveId', () => {
      const { service } = makeService();
      expect(service.isSuppressed('unknown-id')).toBe(false);
    });

    it('successive writes after suppression expires are processed normally', async () => {
      const file = makeFile('post.md');
      const app = makeApp({ currentFrontmatter: { archive: false } });
      const { service } = makeService({
        app,
        archiveLookup: makeArchiveLookup({ byId: file }),
      });

      // First write
      await service.handleRemoteArchiveState(makeEventData({ changes: { isBookmarked: true } }));
      expect(app.fileManager.processFrontMatter).toHaveBeenCalledTimes(1);

      // Expire suppression
      (service as any).suppressionMap.set('archive-abc', Date.now() - 11_000);

      // Update mock to return the updated frontmatter so the no-op guard doesn't fire
      (app.metadataCache.getFileCache as any).mockReturnValue({ frontmatter: { archive: true } });

      // Second write (isBookmarked: false — different from current true)
      await service.handleRemoteArchiveState(makeEventData({ changes: { isBookmarked: false } }));
      expect(app.fileManager.processFrontMatter).toHaveBeenCalledTimes(2);
    });
  });

  // ── reconcileFromLibrarySync ────────────────────────────────────────────────

  describe('reconcileFromLibrarySync', () => {
    it('writes fm.archive when server value differs from local (false → true)', async () => {
      const file = makeFile('post.md');
      const app = makeApp({ currentFrontmatter: { archive: false } });
      const { service } = makeService({
        app,
        archiveLookup: makeArchiveLookup({ byId: file }),
      });

      await service.reconcileFromLibrarySync(file, 'archive-abc', true);

      expect(app.fileManager.processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));
      const updater = (app.fileManager.processFrontMatter as any).mock.calls[0][1];
      const fm: Record<string, unknown> = {};
      updater(fm);
      expect(fm.archive).toBe(true);
    });

    it('writes fm.archive when server value differs from local (true → false)', async () => {
      const file = makeFile('post.md');
      const app = makeApp({ currentFrontmatter: { archive: true } });
      const { service } = makeService({
        app,
        archiveLookup: makeArchiveLookup({ byId: file }),
      });

      await service.reconcileFromLibrarySync(file, 'archive-abc', false);

      expect(app.fileManager.processFrontMatter).toHaveBeenCalledOnce();
      const updater = (app.fileManager.processFrontMatter as any).mock.calls[0][1];
      const fm: Record<string, unknown> = {};
      updater(fm);
      expect(fm.archive).toBe(false);
    });

    it('no-op when fm.archive already matches server value', async () => {
      const file = makeFile('post.md');
      const app = makeApp({ currentFrontmatter: { archive: true } });
      const { service } = makeService({
        app,
        archiveLookup: makeArchiveLookup({ byId: file }),
      });

      await service.reconcileFromLibrarySync(file, 'archive-abc', true);

      expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
    });

    it('no-op when fm.archive is undefined (treated as false) and server value is false', async () => {
      const file = makeFile('post.md');
      // archive not present in frontmatter → undefined → normalised to false
      const app = makeApp({ currentFrontmatter: {} });
      const { service } = makeService({
        app,
        archiveLookup: makeArchiveLookup({ byId: file }),
      });

      await service.reconcileFromLibrarySync(file, 'archive-abc', false);

      expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
    });

    it('skips when archiveId is suppressed (user just changed it locally)', async () => {
      const file = makeFile('post.md');
      const app = makeApp({ currentFrontmatter: { archive: false } });
      const { service } = makeService({
        app,
        archiveLookup: makeArchiveLookup({ byId: file }),
      });

      service.addSuppression('archive-abc');

      await service.reconcileFromLibrarySync(file, 'archive-abc', true);

      expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
    });

    it('registers suppression before writing so outbound echo is blocked', async () => {
      const file = makeFile('post.md');
      const app = makeApp({ currentFrontmatter: { archive: false } });
      let suppressionActiveAtWrite = false;
      let capturedService: ArchiveStateSyncService;
      (app.fileManager.processFrontMatter as any).mockImplementation(
        async (_file: TFile, _updater: (fm: Record<string, unknown>) => void) => {
          suppressionActiveAtWrite = capturedService.isSuppressed('archive-abc');
          _updater({});
        },
      );

      const { service } = makeService({
        app,
        archiveLookup: makeArchiveLookup({ byId: file }),
      });
      capturedService = service;

      await service.reconcileFromLibrarySync(file, 'archive-abc', true);

      expect(suppressionActiveAtWrite).toBe(true);
    });

    it('backfills sourceArchiveId when not present in frontmatter', async () => {
      const file = makeFile('post.md');
      const app = makeApp({ currentFrontmatter: { archive: false } });
      const { service } = makeService({
        app,
        archiveLookup: makeArchiveLookup({ byId: file }),
      });

      await service.reconcileFromLibrarySync(file, 'archive-abc', true);

      const updater = (app.fileManager.processFrontMatter as any).mock.calls[0][1];
      const fm: Record<string, unknown> = {};
      updater(fm);
      expect(fm.sourceArchiveId).toBe('archive-abc');
    });

    it('does NOT overwrite an existing sourceArchiveId', async () => {
      const file = makeFile('post.md');
      const app = makeApp({ currentFrontmatter: { archive: false } });
      const { service } = makeService({
        app,
        archiveLookup: makeArchiveLookup({ byId: file }),
      });

      await service.reconcileFromLibrarySync(file, 'archive-abc', true);

      const updater = (app.fileManager.processFrontMatter as any).mock.calls[0][1];
      const fm: Record<string, unknown> = { sourceArchiveId: 'pre-existing-id' };
      updater(fm);
      expect(fm.sourceArchiveId).toBe('pre-existing-id');
    });

    it('removes suppression and rethrows when processFrontMatter fails', async () => {
      const file = makeFile('post.md');
      const app = makeApp({
        currentFrontmatter: { archive: false },
        processFrontMatterError: new Error('disk error'),
      });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { service } = makeService({
        app,
        archiveLookup: makeArchiveLookup({ byId: file }),
      });

      await expect(
        service.reconcileFromLibrarySync(file, 'archive-abc', true),
      ).rejects.toThrow('disk error');

      // Suppression must be removed so future writes are not blocked
      expect(service.isSuppressed('archive-abc')).toBe(false);

      consoleErrorSpy.mockRestore();
    });
  });

  // ── Composite scenario ─────────────────────────────────────────────────────

  describe('composite scenario', () => {
    it('full happy path: found by sourceArchiveId, writes archive=true', async () => {
      const file = makeFile('Social Archives/Facebook/2026-03-27 - post.md');
      const app = makeApp({ currentFrontmatter: { archive: false, sourceArchiveId: 'archive-abc' } });
      const archiveLookup = makeArchiveLookup({ byId: file });
      const apiClient = makeApiClient();
      const { service } = makeService({ app, archiveLookup, apiClient });

      await service.handleRemoteArchiveState(
        makeEventData({
          archiveId: 'archive-abc',
          sourceClientId: 'mobile-client',
          changes: { isBookmarked: true },
        }),
      );

      // No server fetch needed — found via index
      expect(apiClient.getUserArchive).not.toHaveBeenCalled();

      // processFrontMatter called with the correct file
      expect(app.fileManager.processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));

      // Verify the updater sets archive correctly and does NOT touch sourceArchiveId
      const updater = (app.fileManager.processFrontMatter as any).mock.calls[0][1];
      const fm: Record<string, unknown> = {};
      updater(fm);
      expect(fm.archive).toBe(true);
      expect(fm.sourceArchiveId).toBeUndefined();

      // Suppression is active after the write
      expect(service.isSuppressed('archive-abc')).toBe(true);
    });
  });
});
