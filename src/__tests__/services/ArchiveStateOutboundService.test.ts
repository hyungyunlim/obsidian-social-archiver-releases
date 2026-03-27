/**
 * ArchiveStateOutboundService — Unit Tests
 *
 * Tests the outbound archive-state (isBookmarked) sync behavior:
 * - First observation during startup window records baseline without syncing
 * - First observation outside startup window syncs if archive=true
 * - Subsequent change to archive field debounces and syncs
 * - No change = no API call
 * - false → false (default) does not sync on first observation
 * - Suppressed archiveId is skipped
 * - Files without sourceArchiveId or originalUrl are ignored
 * - Non-markdown files are ignored
 * - Files without frontmatter are ignored
 * - Feature toggle off suppresses all changes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ArchiveStateOutboundService } from '../../plugin/sync/ArchiveStateOutboundService';
import type { TFile } from 'obsidian';

// ─── Helpers ─────────────────────────────────────────────

function makeFile(path: string, ext = 'md'): TFile {
  return { path, extension: ext } as unknown as TFile;
}

// ─── Mock factories ───────────────────────────────────────

/**
 * Creates an app mock whose MetadataCache triggers the registered "changed"
 * callback when `_trigger(file)` is called.
 */
function makeApp(options: {
  fm?: Record<string, unknown>;
  fmByPath?: Map<string, Record<string, unknown>>;
} = {}) {
  let registeredCallback: ((file: TFile, data: string) => void) | null = null;

  const app = {
    _trigger(file: TFile) {
      registeredCallback?.(file, '');
    },
    _setFm(path: string, fm: Record<string, unknown>) {
      if (!options.fmByPath) {
        options.fmByPath = new Map();
      }
      options.fmByPath.set(path, fm);
    },
    metadataCache: {
      on: vi.fn().mockImplementation((_event: string, cb: (file: TFile, data: string) => void) => {
        registeredCallback = cb;
        return { __type: 'eventRef' };
      }),
      offref: vi.fn(),
      getFileCache: vi.fn().mockImplementation((file: TFile) => {
        if (options.fmByPath) {
          const fm = options.fmByPath.get(file.path);
          return fm !== undefined ? { frontmatter: fm } : null;
        }
        return options.fm !== undefined ? { frontmatter: options.fm } : null;
      }),
    },
    fileManager: {
      processFrontMatter: vi.fn().mockResolvedValue(undefined),
    },
  };

  return app;
}

function makeApiClient() {
  return {
    updateArchiveActions: vi.fn().mockResolvedValue({ success: true }),
    getUserArchives: vi.fn().mockResolvedValue({ archives: [] }),
  };
}

function makeArchiveLookup(identityByPath: Record<string, { archiveId: string }> = {}) {
  return {
    getIdentityByPath: vi.fn().mockImplementation((path: string) => identityByPath[path] ?? null),
  };
}

function makeSettings(overrides: Partial<{ enableMobileAnnotationSync: boolean; syncClientId: string }> = {}) {
  return () => ({
    enableMobileAnnotationSync: true,
    syncClientId: 'test-client-id',
    ...overrides,
  } as any);
}

// ─── Tests ───────────────────────────────────────────────

describe('ArchiveStateOutboundService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Startup window ──

  describe('startup window', () => {
    it('records baseline on first observation during startup window and does NOT sync', async () => {
      const file = makeFile('Social Archives/post.md');
      const fm = { sourceArchiveId: 'archive-123', archive: true };
      const app = makeApp({ fm });
      const apiClient = makeApiClient();

      const service = new ArchiveStateOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings(),
      );

      service.start(); // startedAt = now (within startup window)

      // First trigger — within 5s startup window
      app._trigger(file);
      await vi.runAllTimersAsync();

      // Should NOT have called the API on first observation during startup window
      expect(apiClient.updateArchiveActions).not.toHaveBeenCalled();
    });

    it('records baseline as false when archive is undefined during startup window', async () => {
      const file = makeFile('Social Archives/post.md');
      const app = makeApp({ fm: { sourceArchiveId: 'archive-123' } }); // archive field absent
      const apiClient = makeApiClient();

      const service = new ArchiveStateOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings(),
      );

      service.start();
      app._trigger(file);
      await vi.runAllTimersAsync();

      expect(apiClient.updateArchiveActions).not.toHaveBeenCalled();
    });
  });

  // ── First observation outside startup window ──

  describe('first observation outside startup window', () => {
    it('syncs when archive=true is seen for the first time after startup window', async () => {
      const file = makeFile('Social Archives/post.md');
      const fmByPath = new Map<string, Record<string, unknown>>();
      fmByPath.set(file.path, { sourceArchiveId: 'archive-123', archive: true });

      const app = makeApp({ fmByPath });
      const apiClient = makeApiClient();

      const service = new ArchiveStateOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings(),
      );

      service.start();

      // Advance past the 5-second startup window
      await vi.advanceTimersByTimeAsync(5001);

      // First observation outside startup window with archive=true
      app._trigger(file);
      await vi.runAllTimersAsync();

      expect(apiClient.updateArchiveActions).toHaveBeenCalledWith(
        'archive-123',
        { isBookmarked: true },
      );
    });

    it('does NOT sync when archive=false is seen for the first time outside startup window', async () => {
      const file = makeFile('Social Archives/post.md');
      const fmByPath = new Map<string, Record<string, unknown>>();
      fmByPath.set(file.path, { sourceArchiveId: 'archive-123', archive: false });

      const app = makeApp({ fmByPath });
      const apiClient = makeApiClient();

      const service = new ArchiveStateOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings(),
      );

      service.start();
      await vi.advanceTimersByTimeAsync(5001);

      app._trigger(file);
      await vi.runAllTimersAsync();

      // false is the default — nothing to push
      expect(apiClient.updateArchiveActions).not.toHaveBeenCalled();
    });
  });

  // ── State change after baseline ──

  describe('state change after baseline', () => {
    it('debounces and syncs when archive changes from false to true', async () => {
      const file = makeFile('Social Archives/post.md');
      const fmByPath = new Map<string, Record<string, unknown>>();

      // Baseline: archive=false
      fmByPath.set(file.path, { sourceArchiveId: 'archive-123', archive: false });

      const app = makeApp({ fmByPath });
      const apiClient = makeApiClient();

      const service = new ArchiveStateOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings(),
      );

      service.start();

      // First trigger = baseline (within startup window)
      app._trigger(file);
      await vi.runAllTimersAsync();
      expect(apiClient.updateArchiveActions).not.toHaveBeenCalled();

      // User toggles archive to true
      fmByPath.set(file.path, { sourceArchiveId: 'archive-123', archive: true });

      // Second trigger = actual change
      app._trigger(file);
      await vi.runAllTimersAsync();

      expect(apiClient.updateArchiveActions).toHaveBeenCalledWith(
        'archive-123',
        { isBookmarked: true },
      );
    });

    it('syncs when archive changes from true to false', async () => {
      const file = makeFile('Social Archives/post.md');
      const fmByPath = new Map<string, Record<string, unknown>>();
      fmByPath.set(file.path, { sourceArchiveId: 'archive-123', archive: true });

      const app = makeApp({ fmByPath });
      const apiClient = makeApiClient();

      const service = new ArchiveStateOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings(),
      );

      service.start();

      // Baseline (in startup window)
      app._trigger(file);
      await vi.runAllTimersAsync();
      expect(apiClient.updateArchiveActions).not.toHaveBeenCalled();

      // User toggles back to false
      fmByPath.set(file.path, { sourceArchiveId: 'archive-123', archive: false });

      app._trigger(file);
      await vi.runAllTimersAsync();

      expect(apiClient.updateArchiveActions).toHaveBeenCalledWith(
        'archive-123',
        { isBookmarked: false },
      );
    });
  });

  // ── No change ──

  describe('no change', () => {
    it('does not call any API method when archive value is unchanged', async () => {
      const file = makeFile('Social Archives/post.md');
      const fmByPath = new Map<string, Record<string, unknown>>();
      fmByPath.set(file.path, { sourceArchiveId: 'archive-123', archive: true });

      const app = makeApp({ fmByPath });
      const apiClient = makeApiClient();

      const service = new ArchiveStateOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings(),
      );

      service.start();

      // First trigger = baseline
      app._trigger(file);
      await vi.runAllTimersAsync();
      expect(apiClient.updateArchiveActions).not.toHaveBeenCalled();

      // Second trigger — same value, no change
      app._trigger(file);
      await vi.runAllTimersAsync();

      expect(apiClient.updateArchiveActions).not.toHaveBeenCalled();
    });
  });

  // ── Suppression ──

  describe('suppression', () => {
    it('skips sync when archiveId is suppressed via addSuppression', async () => {
      const file = makeFile('Social Archives/post.md');
      const fmByPath = new Map<string, Record<string, unknown>>();
      fmByPath.set(file.path, { sourceArchiveId: 'archive-123', archive: false });

      const app = makeApp({ fmByPath });
      const apiClient = makeApiClient();

      const service = new ArchiveStateOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings(),
      );

      service.start();

      // Baseline
      app._trigger(file);
      await vi.runAllTimersAsync();

      // Change the value
      fmByPath.set(file.path, { sourceArchiveId: 'archive-123', archive: true });

      // Suppress before second trigger
      service.addSuppression('archive-123');

      app._trigger(file);
      await vi.runAllTimersAsync();

      // Suppression should prevent any API call
      expect(apiClient.updateArchiveActions).not.toHaveBeenCalled();
    });

    it('isSuppressed returns false after TTL expires', async () => {
      const service = new ArchiveStateOutboundService(
        makeApp() as any,
        makeApiClient() as any,
        makeArchiveLookup() as any,
        makeSettings(),
      );

      service.addSuppression('archive-999');
      expect(service.isSuppressed('archive-999')).toBe(true);

      // Advance past the 10s suppression window
      await vi.advanceTimersByTimeAsync(11_000);

      expect(service.isSuppressed('archive-999')).toBe(false);
    });

    it('auto-suppresses after a successful outbound sync', async () => {
      const file = makeFile('Social Archives/post.md');
      const fmByPath = new Map<string, Record<string, unknown>>();
      fmByPath.set(file.path, { sourceArchiveId: 'archive-123', archive: false });

      const app = makeApp({ fmByPath });
      const apiClient = makeApiClient();

      const service = new ArchiveStateOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings(),
      );

      service.start();

      // Baseline
      app._trigger(file);
      await vi.runAllTimersAsync();

      // Change
      fmByPath.set(file.path, { sourceArchiveId: 'archive-123', archive: true });
      app._trigger(file);
      await vi.runAllTimersAsync();

      // After sync, archiveId should be suppressed
      expect(service.isSuppressed('archive-123')).toBe(true);
    });
  });

  // ── Archive note detection ──

  describe('archive note detection', () => {
    it('ignores files without sourceArchiveId and without originalUrl', async () => {
      const file = makeFile('Notes/plain-note.md');
      const app = makeApp({ fm: { title: 'Random note', archive: true } }); // no archive identifiers
      const apiClient = makeApiClient();

      const service = new ArchiveStateOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings(),
      );

      service.start();
      app._trigger(file);
      await vi.runAllTimersAsync();

      expect(apiClient.updateArchiveActions).not.toHaveBeenCalled();
    });

    it('uses sourceArchiveId from frontmatter when available', async () => {
      const file = makeFile('Social Archives/post.md');
      const fmByPath = new Map<string, Record<string, unknown>>();
      fmByPath.set(file.path, { sourceArchiveId: 'archive-fm-id', archive: false });

      const app = makeApp({ fmByPath });
      const apiClient = makeApiClient();

      const service = new ArchiveStateOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup({ 'Social Archives/post.md': { archiveId: 'archive-index-id' } }) as any,
        makeSettings(),
      );

      service.start();

      // Baseline
      app._trigger(file);
      await vi.runAllTimersAsync();

      fmByPath.set(file.path, { sourceArchiveId: 'archive-fm-id', archive: true });
      app._trigger(file);
      await vi.runAllTimersAsync();

      // Must use frontmatter value, not index
      expect(apiClient.updateArchiveActions).toHaveBeenCalledWith(
        'archive-fm-id',
        { isBookmarked: true },
      );
    });

    it('falls back to ArchiveLookupService path index when sourceArchiveId absent', async () => {
      const file = makeFile('Social Archives/post.md');
      const fmByPath = new Map<string, Record<string, unknown>>();
      fmByPath.set(file.path, { originalUrl: 'https://x.com/foo/1', archive: false });

      const app = makeApp({ fmByPath });
      const apiClient = makeApiClient();

      const lookup = makeArchiveLookup({
        'Social Archives/post.md': { archiveId: 'archive-from-index' },
      });

      const service = new ArchiveStateOutboundService(
        app as any,
        apiClient as any,
        lookup as any,
        makeSettings(),
      );

      service.start();

      // Baseline
      app._trigger(file);
      await vi.runAllTimersAsync();

      fmByPath.set(file.path, { originalUrl: 'https://x.com/foo/1', archive: true });
      app._trigger(file);
      await vi.runAllTimersAsync();

      expect(apiClient.updateArchiveActions).toHaveBeenCalledWith(
        'archive-from-index',
        { isBookmarked: true },
      );
    });
  });

  // ── File type guards ──

  describe('file type guards', () => {
    it('ignores non-markdown files', async () => {
      const file = makeFile('attachments/image.png', 'png');
      const app = makeApp({ fm: { sourceArchiveId: 'archive-123', archive: true } });
      const apiClient = makeApiClient();

      const service = new ArchiveStateOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings(),
      );

      service.start();
      app._trigger(file);
      await vi.runAllTimersAsync();

      expect(apiClient.updateArchiveActions).not.toHaveBeenCalled();
    });

    it('ignores files without frontmatter', async () => {
      const file = makeFile('Social Archives/no-fm.md');
      // fm=undefined → getFileCache returns null
      const app = makeApp({ fm: undefined });
      const apiClient = makeApiClient();

      const service = new ArchiveStateOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings(),
      );

      service.start();
      app._trigger(file);
      await vi.runAllTimersAsync();

      expect(apiClient.updateArchiveActions).not.toHaveBeenCalled();
    });
  });

  // ── Feature toggle ──

  describe('feature toggle', () => {
    it('ignores all changes when enableMobileAnnotationSync is off', async () => {
      const file = makeFile('Social Archives/post.md');
      const fmByPath = new Map<string, Record<string, unknown>>();
      fmByPath.set(file.path, { sourceArchiveId: 'archive-123', archive: false });

      const app = makeApp({ fmByPath });
      const apiClient = makeApiClient();

      const service = new ArchiveStateOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings({ enableMobileAnnotationSync: false }),
      );

      service.start();

      fmByPath.set(file.path, { sourceArchiveId: 'archive-123', archive: true });
      app._trigger(file);
      await vi.runAllTimersAsync();

      expect(apiClient.updateArchiveActions).not.toHaveBeenCalled();
    });
  });

  // ── Lifecycle ──

  describe('lifecycle', () => {
    it('stop() unregisters the MetadataCache listener', () => {
      const app = makeApp({ fm: {} });
      const service = new ArchiveStateOutboundService(
        app as any,
        makeApiClient() as any,
        makeArchiveLookup() as any,
        makeSettings(),
      );

      service.start();
      service.stop();

      expect(app.metadataCache.offref).toHaveBeenCalledTimes(1);
    });

    it('start() is idempotent — registers listener only once', () => {
      const app = makeApp({ fm: {} });
      const service = new ArchiveStateOutboundService(
        app as any,
        makeApiClient() as any,
        makeArchiveLookup() as any,
        makeSettings(),
      );

      service.start();
      service.start();
      service.start();

      expect(app.metadataCache.on).toHaveBeenCalledTimes(1);
    });
  });
});
