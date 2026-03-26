/**
 * AnnotationOutboundService — Unit Tests
 *
 * Tests the outbound comment sync behavior:
 * - First observation records baseline without triggering sync
 * - Subsequent comment change debounces and syncs
 * - Synthetic primary note ID format
 * - Preserves existing mobile notes on sync
 * - Empty comment removes synthetic primary note
 * - Suppressed archiveId is skipped
 * - Files without sourceArchiveId are ignored
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnnotationOutboundService } from '../../plugin/sync/AnnotationOutboundService';
import type { TFile } from 'obsidian';

// ─── Helpers ─────────────────────────────────────────────

function makeFile(path: string, ext = 'md'): TFile {
  return { path, extension: ext } as unknown as TFile;
}

// ─── Mock factories ───────────────────────────────────────

function makeApp(options: {
  fm?: Record<string, unknown>;
  fmByPath?: Record<string, Record<string, unknown>>;
  onRef?: (ref: unknown) => void;
  onOffref?: () => void;
} = {}) {
  /** Stored "changed" callback */
  let registeredCallback: ((file: TFile, data: string) => void) | null = null;
  let storedRef: unknown = null;

  return {
    _trigger(file: TFile) {
      registeredCallback?.(file, '');
    },
    metadataCache: {
      on: vi.fn().mockImplementation((_event: string, cb: (file: TFile, data: string) => void) => {
        registeredCallback = cb;
        storedRef = { __type: 'eventRef' };
        options.onRef?.(storedRef);
        return storedRef;
      }),
      offref: vi.fn().mockImplementation(() => {
        options.onOffref?.();
      }),
      getFileCache: vi.fn().mockImplementation((file: TFile) => {
        if (options.fmByPath) {
          const fm = options.fmByPath[file.path];
          return fm ? { frontmatter: fm } : null;
        }
        return options.fm ? { frontmatter: options.fm } : null;
      }),
    },
  };
}

function makeApiClient(serverNotes: unknown[] = []) {
  return {
    getUserArchive: vi.fn().mockResolvedValue({
      archive: {
        id: 'archive-123',
        userNotes: serverNotes,
        userHighlights: [],
      },
    }),
    updateArchiveActions: vi.fn().mockResolvedValue({}),
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

describe('AnnotationOutboundService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── First observation ──

  describe('first observation', () => {
    it('records baseline on first metadata change and does NOT trigger sync', async () => {
      const file = makeFile('Social Archives/post.md');
      const fm = { sourceArchiveId: 'archive-123', comment: 'Initial comment' };
      const app = makeApp({ fm });
      const apiClient = makeApiClient();

      const service = new AnnotationOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings()
      );

      service.start();
      // Fire the first metadata change
      app._trigger(file);

      // Advance past debounce window
      await vi.runAllTimersAsync();

      // Should NOT have called the API on first observation
      expect(apiClient.getUserArchive).not.toHaveBeenCalled();
      expect(apiClient.updateArchiveActions).not.toHaveBeenCalled();
    });
  });

  // ── Comment change triggers sync ──

  describe('comment change after baseline', () => {
    it('debounces and triggers sync when comment changes after baseline', async () => {
      const file = makeFile('Social Archives/post.md');

      // Two different frontmatter snapshots: first = baseline, second = changed
      let callCount = 0;
      const fmSnapshots: Record<string, unknown>[] = [
        { sourceArchiveId: 'archive-123', comment: 'First comment' },
        { sourceArchiveId: 'archive-123', comment: 'Updated comment' },
      ];

      const app = makeApp({});
      (app.metadataCache.getFileCache as ReturnType<typeof vi.fn>).mockImplementation(() => {
        const fm = fmSnapshots[Math.min(callCount, fmSnapshots.length - 1)]!;
        callCount++;
        return { frontmatter: fm };
      });

      const apiClient = makeApiClient([]);

      const service = new AnnotationOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings()
      );

      service.start();

      // First trigger = baseline (no sync)
      app._trigger(file);
      await vi.runAllTimersAsync();
      expect(apiClient.getUserArchive).not.toHaveBeenCalled();

      // Second trigger = comment changed (should sync after debounce)
      app._trigger(file);
      await vi.runAllTimersAsync();

      expect(apiClient.getUserArchive).toHaveBeenCalledWith('archive-123');
      expect(apiClient.updateArchiveActions).toHaveBeenCalledWith(
        'archive-123',
        expect.objectContaining({ userNotes: expect.any(Array) })
      );
    });
  });

  // ── Synthetic primary note format ──

  describe('synthetic primary note ID', () => {
    it('creates synthetic note with id = obsidian:{clientId}:primary', async () => {
      const file = makeFile('Social Archives/post.md');
      const clientId = 'my-client-id';

      let callCount = 0;
      const app = makeApp({});
      (app.metadataCache.getFileCache as ReturnType<typeof vi.fn>).mockImplementation(() => {
        const comment = callCount === 0 ? 'baseline' : 'new comment text';
        callCount++;
        return { frontmatter: { sourceArchiveId: 'archive-123', comment } };
      });

      const apiClient = makeApiClient([]);

      const service = new AnnotationOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings({ syncClientId: clientId })
      );

      service.start();

      // Baseline
      app._trigger(file);
      await vi.runAllTimersAsync();

      // Changed
      app._trigger(file);
      await vi.runAllTimersAsync();

      const updateCall = (apiClient.updateArchiveActions as ReturnType<typeof vi.fn>).mock.calls[0];
      const notes = (updateCall![1] as { userNotes: Array<{ id: string }> }).userNotes;
      const primaryNote = notes.find((n) => n.id === `obsidian:${clientId}:primary`);
      expect(primaryNote).toBeDefined();
    });
  });

  // ── Preserves existing mobile notes ──

  describe('mobile note preservation', () => {
    it('preserves existing mobile notes (does not overwrite them)', async () => {
      const file = makeFile('Social Archives/post.md');

      let callCount = 0;
      const app = makeApp({});
      (app.metadataCache.getFileCache as ReturnType<typeof vi.fn>).mockImplementation(() => {
        const comment = callCount === 0 ? 'baseline' : 'new comment';
        callCount++;
        return { frontmatter: { sourceArchiveId: 'archive-123', comment } };
      });

      const mobileNotes = [
        { id: 'mobile-note-1', content: 'Mobile comment A', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
        { id: 'mobile-note-2', content: 'Mobile comment B', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      ];
      const apiClient = makeApiClient(mobileNotes);

      const service = new AnnotationOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings({ syncClientId: 'my-client' })
      );

      service.start();

      // Baseline
      app._trigger(file);
      await vi.runAllTimersAsync();

      // Comment changed
      app._trigger(file);
      await vi.runAllTimersAsync();

      const updateCall = (apiClient.updateArchiveActions as ReturnType<typeof vi.fn>).mock.calls[0];
      const notes = (updateCall![1] as { userNotes: Array<{ id: string }> }).userNotes;

      // Mobile notes must still be present
      expect(notes.some((n) => n.id === 'mobile-note-1')).toBe(true);
      expect(notes.some((n) => n.id === 'mobile-note-2')).toBe(true);
    });
  });

  // ── Empty comment removes primary note ──

  describe('empty comment', () => {
    it('removes synthetic primary note when comment is cleared', async () => {
      const file = makeFile('Social Archives/post.md');
      const clientId = 'client-xyz';
      const syntheticNoteId = `obsidian:${clientId}:primary`;

      let callCount = 0;
      const app = makeApp({});
      (app.metadataCache.getFileCache as ReturnType<typeof vi.fn>).mockImplementation(() => {
        // First call = baseline with content, second call = cleared (empty string)
        const comment = callCount === 0 ? 'original text' : '';
        callCount++;
        return { frontmatter: { sourceArchiveId: 'archive-123', comment } };
      });

      // Server already has the synthetic primary note
      const apiClient = makeApiClient([
        { id: syntheticNoteId, content: 'original text', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      ]);

      const service = new AnnotationOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings({ syncClientId: clientId })
      );

      service.start();

      // Baseline
      app._trigger(file);
      await vi.runAllTimersAsync();

      // Comment cleared
      app._trigger(file);
      await vi.runAllTimersAsync();

      const updateCall = (apiClient.updateArchiveActions as ReturnType<typeof vi.fn>).mock.calls[0];
      const notes = (updateCall![1] as { userNotes: Array<{ id: string }> }).userNotes;

      // Synthetic primary note must be removed
      expect(notes.some((n) => n.id === syntheticNoteId)).toBe(false);
    });
  });

  // ── Suppression ──

  describe('suppression', () => {
    it('does not trigger outbound sync when archiveId is suppressed', async () => {
      const file = makeFile('Social Archives/post.md');

      let callCount = 0;
      const app = makeApp({});
      (app.metadataCache.getFileCache as ReturnType<typeof vi.fn>).mockImplementation(() => {
        const comment = callCount === 0 ? 'baseline' : 'changed';
        callCount++;
        return { frontmatter: { sourceArchiveId: 'archive-123', comment } };
      });

      const apiClient = makeApiClient([]);

      const service = new AnnotationOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings()
      );

      service.start();

      // Baseline (establishes callCount=1 frontmatter)
      app._trigger(file);
      await vi.runAllTimersAsync();

      // Add suppression for this archive
      service.addSuppression('archive-123');

      // Trigger change — should be skipped due to suppression
      app._trigger(file);
      await vi.runAllTimersAsync();

      // Suppression should prevent any API call
      expect(apiClient.getUserArchive).not.toHaveBeenCalled();
      expect(apiClient.updateArchiveActions).not.toHaveBeenCalled();
    });
  });

  // ── Files without sourceArchiveId are ignored ──

  describe('no sourceArchiveId', () => {
    it('ignores files that do not have a sourceArchiveId in frontmatter', async () => {
      const file = makeFile('Notes/plain-note.md');
      const app = makeApp({ fm: { comment: 'some comment' } }); // No sourceArchiveId
      const apiClient = makeApiClient([]);

      const service = new AnnotationOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings()
      );

      service.start();
      app._trigger(file);
      await vi.runAllTimersAsync();

      // No API call — the file has no sourceArchiveId
      expect(apiClient.getUserArchive).not.toHaveBeenCalled();
    });

    it('ignores non-markdown files', async () => {
      const file = makeFile('attachments/image.png', 'png');
      const app = makeApp({ fm: { sourceArchiveId: 'archive-123', comment: 'hello' } });
      const apiClient = makeApiClient([]);

      const service = new AnnotationOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings()
      );

      service.start();
      app._trigger(file);
      await vi.runAllTimersAsync();

      expect(apiClient.getUserArchive).not.toHaveBeenCalled();
    });

    it('ignores files without frontmatter', async () => {
      const file = makeFile('Social Archives/no-fm.md');
      const app = makeApp({ fm: undefined });
      const apiClient = makeApiClient([]);

      const service = new AnnotationOutboundService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeSettings()
      );

      service.start();
      app._trigger(file);
      await vi.runAllTimersAsync();

      expect(apiClient.getUserArchive).not.toHaveBeenCalled();
    });
  });
});
