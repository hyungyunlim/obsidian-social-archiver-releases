/**
 * ArchiveTagOutboundService — Unit Tests
 *
 * Tests the outbound archive-tag sync behavior:
 * - Tag additions trigger upsertTags + upsertArchiveTags
 * - Tag removals trigger deleteArchiveTags
 * - No change = no API calls
 * - Suppressed archiveId is skipped
 * - NOTE: ArchiveTagOutboundService does NOT have a first-observation guard.
 *   It syncs on any delta from the empty initial baseline.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ArchiveTagOutboundService } from '../../plugin/sync/ArchiveTagOutboundService';
import type { TFile } from 'obsidian';

// ─── Helpers ─────────────────────────────────────────────

function makeFile(path: string): TFile {
  return { path, extension: 'md' } as unknown as TFile;
}

// ─── Mock factories ───────────────────────────────────────

/**
 * Creates an app mock whose MetadataCache triggers the registered "changed"
 * callback when `_trigger(file)` is called. Frontmatter is provided per-file
 * via the `fmByPath` map (or a single default `fm`).
 */
function makeApp(options: {
  fm?: Record<string, unknown>;
  fmByPath?: Map<string, Record<string, unknown>>;
} = {}) {
  let registeredCallback: ((file: TFile) => void) | null = null;

  const app = {
    _trigger(file: TFile) {
      registeredCallback?.(file);
    },
    _setFm(path: string, fm: Record<string, unknown>) {
      if (!options.fmByPath) {
        options.fmByPath = new Map();
      }
      options.fmByPath.set(path, fm);
    },
    metadataCache: {
      on: vi.fn().mockImplementation((_event: string, cb: (file: TFile) => void) => {
        registeredCallback = cb;
        return { __type: 'eventRef' };
      }),
      offref: vi.fn(),
      getFileCache: vi.fn().mockImplementation((file: TFile) => {
        if (options.fmByPath) {
          const fm = options.fmByPath.get(file.path);
          return fm ? { frontmatter: fm } : null;
        }
        return options.fm ? { frontmatter: options.fm } : null;
      }),
    },
  };

  return app;
}

function makeApiClient() {
  return {
    upsertTags: vi.fn().mockResolvedValue({}),
    upsertArchiveTags: vi.fn().mockResolvedValue({}),
    deleteArchiveTags: vi.fn().mockResolvedValue({}),
  };
}

function makeArchiveLookup() {
  return {
    findBySourceArchiveId: vi.fn(),
    findByOriginalUrl: vi.fn().mockReturnValue([]),
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

describe('ArchiveTagOutboundService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Tag additions ──

  describe('tag additions', () => {
    it('calls upsertTags and upsertArchiveTags when tags are first set', async () => {
      const file = makeFile('Social Archives/post.md');
      const fmByPath = new Map<string, Record<string, unknown>>();
      // Start with tags already present (will diff against empty initial baseline)
      fmByPath.set(file.path, { sourceArchiveId: 'archive-123', archiveTags: ['tag-a'] });

      const app = makeApp({ fmByPath });
      const apiClient = makeApiClient();

      const service = new ArchiveTagOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings({ syncClientId: 'test-client' })
      );

      service.start();

      // Trigger — service sees ['tag-a'] vs empty baseline, so syncs
      app._trigger(file);
      await vi.runAllTimersAsync();

      expect(apiClient.upsertTags).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: 'tag-a' })]),
        'test-client'
      );
      expect(apiClient.upsertArchiveTags).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ archiveId: 'archive-123' })]),
        'test-client'
      );
    });

    it('calls upsertTags and upsertArchiveTags when a new tag is added to an existing set', async () => {
      const file = makeFile('Social Archives/post.md');
      const fmByPath = new Map<string, Record<string, unknown>>();

      // First: one tag
      fmByPath.set(file.path, { sourceArchiveId: 'archive-123', archiveTags: ['existing-tag'] });

      const app = makeApp({ fmByPath });
      const apiClient = makeApiClient();
      const service = new ArchiveTagOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings({ syncClientId: 'test-client' })
      );
      service.seedTagCache([{ id: 'tag-id-existing', name: 'existing-tag' }]);

      service.start();

      // First trigger — syncs 'existing-tag' (vs empty baseline)
      app._trigger(file);
      await vi.runAllTimersAsync();

      // Clear call history for the second assertion
      apiClient.upsertTags.mockClear();
      apiClient.upsertArchiveTags.mockClear();

      // Advance past the suppression TTL (10s) set by the first sync
      await vi.advanceTimersByTimeAsync(11_000);

      // Now add a new tag
      fmByPath.set(file.path, { sourceArchiveId: 'archive-123', archiveTags: ['existing-tag', 'new-tag'] });

      // Second trigger — should only sync 'new-tag' (delta)
      app._trigger(file);
      await vi.runAllTimersAsync();

      expect(apiClient.upsertTags).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: 'new-tag' })]),
        'test-client'
      );
      expect(apiClient.upsertArchiveTags).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ archiveId: 'archive-123' })]),
        'test-client'
      );
    });
  });

  // ── Tag removals ──

  describe('tag removals', () => {
    it('calls deleteArchiveTags when a tag is removed (ID known in cache)', async () => {
      const file = makeFile('Social Archives/post.md');
      const fmByPath = new Map<string, Record<string, unknown>>();

      // Start with two tags
      fmByPath.set(file.path, { sourceArchiveId: 'archive-123', archiveTags: ['keep-tag', 'remove-tag'] });

      const app = makeApp({ fmByPath });
      const apiClient = makeApiClient();
      const service = new ArchiveTagOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings({ syncClientId: 'test-client' })
      );

      // Seed cache so we know the IDs before syncing
      service.seedTagCache([
        { id: 'id-keep', name: 'keep-tag' },
        { id: 'id-remove', name: 'remove-tag' },
      ]);

      service.start();

      // First trigger — syncs both tags (vs empty baseline)
      app._trigger(file);
      await vi.runAllTimersAsync();

      apiClient.deleteArchiveTags.mockClear();
      apiClient.upsertTags.mockClear();
      apiClient.upsertArchiveTags.mockClear();

      // Advance past the suppression TTL set by the first sync
      await vi.advanceTimersByTimeAsync(11_000);

      // Remove one tag
      fmByPath.set(file.path, { sourceArchiveId: 'archive-123', archiveTags: ['keep-tag'] });

      app._trigger(file);
      await vi.runAllTimersAsync();

      expect(apiClient.deleteArchiveTags).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ archiveId: 'archive-123', tagId: 'id-remove' }),
        ]),
        'test-client'
      );
    });
  });

  // ── No change = no API calls ──

  describe('no change', () => {
    it('does not call any API method when tags are unchanged after first sync', async () => {
      const file = makeFile('Social Archives/post.md');
      const fmByPath = new Map<string, Record<string, unknown>>();
      fmByPath.set(file.path, { sourceArchiveId: 'archive-123', archiveTags: ['tag-a'] });

      const app = makeApp({ fmByPath });
      const apiClient = makeApiClient();

      const service = new ArchiveTagOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings()
      );

      service.start();

      // First trigger — syncs 'tag-a' vs empty
      app._trigger(file);
      await vi.runAllTimersAsync();

      apiClient.upsertTags.mockClear();
      apiClient.upsertArchiveTags.mockClear();
      apiClient.deleteArchiveTags.mockClear();

      // Trigger again with same tags — should be no-op
      app._trigger(file);
      await vi.runAllTimersAsync();

      expect(apiClient.upsertTags).not.toHaveBeenCalled();
      expect(apiClient.upsertArchiveTags).not.toHaveBeenCalled();
      expect(apiClient.deleteArchiveTags).not.toHaveBeenCalled();
    });

    it('does not call any API method when file has no archiveTags and baseline is empty', async () => {
      const file = makeFile('Social Archives/post.md');
      // archiveTags absent (undefined) — both current and previous are []
      const app = makeApp({ fm: { sourceArchiveId: 'archive-123' } });
      const apiClient = makeApiClient();

      const service = new ArchiveTagOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings()
      );

      service.start();
      app._trigger(file);
      await vi.runAllTimersAsync();

      // [] === [] — no diff, no API calls
      expect(apiClient.upsertTags).not.toHaveBeenCalled();
      expect(apiClient.upsertArchiveTags).not.toHaveBeenCalled();
      expect(apiClient.deleteArchiveTags).not.toHaveBeenCalled();
    });
  });

  // ── Suppression ──

  describe('suppression', () => {
    it('skips sync when archiveId is suppressed via addSuppression', async () => {
      const file = makeFile('Social Archives/post.md');
      const fmByPath = new Map<string, Record<string, unknown>>();
      fmByPath.set(file.path, { sourceArchiveId: 'archive-123', archiveTags: ['tag-a'] });

      const app = makeApp({ fmByPath });
      const apiClient = makeApiClient();

      const service = new ArchiveTagOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings()
      );

      service.start();

      // Suppress before the first trigger
      service.addSuppression('archive-123');

      app._trigger(file);
      await vi.runAllTimersAsync();

      // API should NOT be called due to suppression
      expect(apiClient.upsertTags).not.toHaveBeenCalled();
      expect(apiClient.upsertArchiveTags).not.toHaveBeenCalled();
    });

    it('isSuppressed returns false after TTL expires', async () => {
      const service = new ArchiveTagOutboundService(
        makeApp() as any,
        makeApiClient() as any,
        makeArchiveLookup() as any,
        makeSettings()
      );

      service.addSuppression('archive-999');
      expect(service.isSuppressed('archive-999')).toBe(true);

      // Advance past the 10s suppression window
      await vi.advanceTimersByTimeAsync(11_000);

      expect(service.isSuppressed('archive-999')).toBe(false);
    });
  });

  // ── No sourceArchiveId ──

  describe('no sourceArchiveId', () => {
    it('ignores files without sourceArchiveId', async () => {
      const file = makeFile('Notes/random-note.md');
      const app = makeApp({ fm: { archiveTags: ['tag-a', 'tag-b'] } }); // no sourceArchiveId
      const apiClient = makeApiClient();

      const service = new ArchiveTagOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings()
      );

      service.start();

      app._trigger(file);
      await vi.runAllTimersAsync();

      // No API calls since the file lacks sourceArchiveId
      expect(apiClient.upsertTags).not.toHaveBeenCalled();
      expect(apiClient.upsertArchiveTags).not.toHaveBeenCalled();
    });

    it('ignores files with no frontmatter', async () => {
      const file = makeFile('Notes/no-fm.md');
      const app = makeApp({ fm: undefined });
      const apiClient = makeApiClient();

      const service = new ArchiveTagOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings()
      );

      service.start();
      app._trigger(file);
      await vi.runAllTimersAsync();

      expect(apiClient.upsertTags).not.toHaveBeenCalled();
    });
  });

  // ── Feature toggle off ──

  describe('feature toggle', () => {
    it('ignores all changes when enableMobileAnnotationSync is off', async () => {
      const file = makeFile('Social Archives/post.md');
      const fmByPath = new Map<string, Record<string, unknown>>();
      fmByPath.set(file.path, { sourceArchiveId: 'archive-123', archiveTags: ['tag-a'] });

      const app = makeApp({ fmByPath });
      const apiClient = makeApiClient();

      const service = new ArchiveTagOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings({ enableMobileAnnotationSync: false })
      );

      service.start();

      app._trigger(file);
      await vi.runAllTimersAsync();

      expect(apiClient.upsertTags).not.toHaveBeenCalled();
      expect(apiClient.upsertArchiveTags).not.toHaveBeenCalled();
    });
  });
});
