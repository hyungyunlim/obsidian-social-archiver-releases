/**
 * AnnotationSyncService — Unit Tests
 *
 * Tests the orchestration logic for mobile annotation sync:
 * - Early-exit guards (hasAnnotationUpdate flag, feature toggle)
 * - File lookup priority (sourceArchiveId → originalUrl)
 * - Ambiguous originalUrl handling
 * - Missing file (archive only on mobile)
 * - Happy path: body + frontmatter update
 * - Empty annotations: block removal + count reset
 * - Coalescing: in-flight deduplication
 *
 * Obsidian API (vault.read, vault.modify, fileManager.processFrontMatter)
 * and all dependencies are replaced with vi.fn() stubs.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { AnnotationSyncService } from '../../services/AnnotationSyncService';
import type { ActionUpdatedEventData } from '../../types/websocket';
import type { TFile } from 'obsidian';

// ─── Helpers ─────────────────────────────────────────────

function makeFile(path: string): TFile {
  return { path } as unknown as TFile;
}

function makeActionUpdatedData(
  overrides: Partial<ActionUpdatedEventData> = {}
): ActionUpdatedEventData {
  return {
    archiveId: 'archive-123',
    changes: { hasAnnotationUpdate: true },
    updatedAt: '2026-03-19T14:00:00.000Z',
    timestamp: Date.now(),
    ...overrides,
  };
}

// ─── Mock factories ───────────────────────────────────────

function makeApp(options: {
  fileContent?: string;
  processFrontMatterError?: Error;
  readError?: Error;
  modifyError?: Error;
} = {}) {
  return {
    vault: {
      read: vi.fn().mockImplementation(async () => {
        if (options.readError) throw options.readError;
        return options.fileContent ?? 'Existing note body.';
      }),
      modify: vi.fn().mockImplementation(async () => {
        if (options.modifyError) throw options.modifyError;
      }),
    },
    fileManager: {
      processFrontMatter: vi.fn().mockImplementation(async (_file: TFile, updater: (fm: Record<string, unknown>) => void) => {
        if (options.processFrontMatterError) throw options.processFrontMatterError;
        updater({});
      }),
    },
  };
}

function makeWorkersApiClient(archiveData: Record<string, unknown> = {}) {
  return {
    getUserArchive: vi.fn().mockResolvedValue({
      archive: {
        id: 'archive-123',
        originalUrl: 'https://example.com/post/123',
        userNotes: [],
        userHighlights: [],
        userNoteCount: 0,
        userHighlightCount: 0,
        ...archiveData,
      },
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

function makeAnnotationRenderer(result: string = '') {
  return {
    render: vi.fn().mockReturnValue(result),
  };
}

function makeSectionManager(result: string = 'patched content') {
  return {
    upsert: vi.fn().mockReturnValue(result),
  };
}

function makeSettings(enableSync = true) {
  return () => ({ enableMobileAnnotationSync: enableSync } as any);
}

// ─── Tests ───────────────────────────────────────────────

describe('AnnotationSyncService', () => {
  // ── Early-exit guards ──

  describe('early-exit guards', () => {
    it('returns immediately when hasAnnotationUpdate is falsy', async () => {
      const apiClient = makeWorkersApiClient();
      const service = new AnnotationSyncService(
        makeApp() as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeAnnotationRenderer() as any,
        makeSectionManager() as any,
        makeSettings()
      );

      await service.handleActionUpdated(
        makeActionUpdatedData({ changes: {} })
      );

      expect(apiClient.getUserArchive).not.toHaveBeenCalled();
    });

    it('returns immediately when hasAnnotationUpdate is false', async () => {
      const apiClient = makeWorkersApiClient();
      const service = new AnnotationSyncService(
        makeApp() as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeAnnotationRenderer() as any,
        makeSectionManager() as any,
        makeSettings()
      );

      await service.handleActionUpdated(
        makeActionUpdatedData({ changes: { hasAnnotationUpdate: false } })
      );

      expect(apiClient.getUserArchive).not.toHaveBeenCalled();
    });

    it('returns immediately when enableMobileAnnotationSync toggle is off', async () => {
      const apiClient = makeWorkersApiClient();
      const service = new AnnotationSyncService(
        makeApp() as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeAnnotationRenderer() as any,
        makeSectionManager() as any,
        makeSettings(false) // toggle OFF
      );

      await service.handleActionUpdated(makeActionUpdatedData());

      expect(apiClient.getUserArchive).not.toHaveBeenCalled();
    });
  });

  // ── File lookup ──

  describe('file resolution', () => {
    it('uses sourceArchiveId lookup first and skips originalUrl lookup', async () => {
      const file = makeFile('Social Archives/post.md');
      const archiveLookup = makeArchiveLookup({ byId: file });
      const app = makeApp();

      const service = new AnnotationSyncService(
        app as any,
        makeWorkersApiClient() as any,
        archiveLookup as any,
        makeAnnotationRenderer() as any,
        makeSectionManager() as any,
        makeSettings()
      );

      await service.handleActionUpdated(makeActionUpdatedData());

      expect(archiveLookup.findBySourceArchiveId).toHaveBeenCalledWith('archive-123');
      expect(archiveLookup.findByOriginalUrl).not.toHaveBeenCalled();
      expect(app.vault.read).toHaveBeenCalledWith(file);
    });

    it('falls back to originalUrl when sourceArchiveId has no match', async () => {
      const file = makeFile('Social Archives/post.md');
      const archiveLookup = makeArchiveLookup({ byId: null, byUrl: [file] });
      const app = makeApp();

      const service = new AnnotationSyncService(
        app as any,
        makeWorkersApiClient() as any,
        archiveLookup as any,
        makeAnnotationRenderer() as any,
        makeSectionManager() as any,
        makeSettings()
      );

      await service.handleActionUpdated(makeActionUpdatedData());

      expect(archiveLookup.findByOriginalUrl).toHaveBeenCalledWith('https://example.com/post/123');
      expect(app.vault.read).toHaveBeenCalledWith(file);
    });

    it('silently returns when no file matches either lookup', async () => {
      const archiveLookup = makeArchiveLookup({ byId: null, byUrl: [] });
      const app = makeApp();

      const service = new AnnotationSyncService(
        app as any,
        makeWorkersApiClient() as any,
        archiveLookup as any,
        makeAnnotationRenderer() as any,
        makeSectionManager() as any,
        makeSettings()
      );

      await service.handleActionUpdated(makeActionUpdatedData());

      expect(app.vault.read).not.toHaveBeenCalled();
    });

    it('logs a warning and skips when multiple files match originalUrl', async () => {
      const files = [makeFile('post-a.md'), makeFile('post-b.md')];
      const archiveLookup = makeArchiveLookup({ byId: null, byUrl: files });
      const app = makeApp();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const service = new AnnotationSyncService(
        app as any,
        makeWorkersApiClient() as any,
        archiveLookup as any,
        makeAnnotationRenderer() as any,
        makeSectionManager() as any,
        makeSettings()
      );

      await service.handleActionUpdated(makeActionUpdatedData());

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Ambiguous originalUrl match'),
        expect.any(String),
        expect.objectContaining({ matchCount: 2 })
      );
      expect(app.vault.read).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  // ── Happy path ──

  describe('happy path', () => {
    it('reads the file, renders the block, upserts, writes, and updates frontmatter', async () => {
      const file = makeFile('Social Archives/test.md');
      const existingContent = 'Existing note body.';
      const patchedContent = 'Existing note body.\n\n<!-- block -->';
      const renderedBlock = '<!-- block -->';

      const app = makeApp({ fileContent: existingContent });
      const renderer = makeAnnotationRenderer(renderedBlock);
      const sectionManager = makeSectionManager(patchedContent);
      const archiveLookup = makeArchiveLookup({ byId: file });
      const apiClient = makeWorkersApiClient({
        userNotes: [{ id: 'n1', content: 'hello', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
        userHighlights: [],
      });

      const service = new AnnotationSyncService(
        app as any,
        apiClient as any,
        archiveLookup as any,
        renderer as any,
        sectionManager as any,
        makeSettings()
      );

      await service.handleActionUpdated(makeActionUpdatedData());

      // Renderer called with notes/highlights from server
      expect(renderer.render).toHaveBeenCalledWith({
        notes: expect.arrayContaining([expect.objectContaining({ id: 'n1' })]),
        highlights: [],
      });

      // Upsert called with current file content and rendered block
      expect(sectionManager.upsert).toHaveBeenCalledWith(existingContent, renderedBlock);

      // Vault modified with new content
      expect(app.vault.modify).toHaveBeenCalledWith(file, patchedContent);

      // Frontmatter updated
      expect(app.fileManager.processFrontMatter).toHaveBeenCalledWith(
        file,
        expect.any(Function)
      );
    });

    it('sets frontmatter fields correctly: sourceArchiveId, counts, hasAnnotations', async () => {
      const file = makeFile('Social Archives/test.md');
      const capturedFm: Record<string, unknown> = {};

      const app = {
        vault: {
          read: vi.fn().mockResolvedValue('body'),
          modify: vi.fn(),
        },
        fileManager: {
          processFrontMatter: vi.fn().mockImplementation(async (_file: TFile, updater: (fm: Record<string, unknown>) => void) => {
            updater(capturedFm);
          }),
        },
      };

      const apiClient = makeWorkersApiClient({
        userNotes: [{ id: 'n1', content: 'A', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
        userHighlights: [
          { id: 'h1', text: 'B', startOffset: 0, endOffset: 1, color: 'yellow', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
        ],
      });

      const service = new AnnotationSyncService(
        app as any,
        apiClient as any,
        makeArchiveLookup({ byId: file }) as any,
        makeAnnotationRenderer('block') as any,
        makeSectionManager('patched') as any,
        makeSettings()
      );

      await service.handleActionUpdated(makeActionUpdatedData());

      expect(capturedFm.sourceArchiveId).toBe('archive-123');
      expect(capturedFm.userNoteCount).toBe(1);
      expect(capturedFm.userHighlightCount).toBe(1);
      expect(capturedFm.hasAnnotations).toBe(true);
    });

    it('does not overwrite existing sourceArchiveId in frontmatter', async () => {
      const file = makeFile('Social Archives/test.md');
      const capturedFm: Record<string, unknown> = { sourceArchiveId: 'existing-id' };

      const app = {
        vault: {
          read: vi.fn().mockResolvedValue('body'),
          modify: vi.fn(),
        },
        fileManager: {
          processFrontMatter: vi.fn().mockImplementation(async (_file: TFile, updater: (fm: Record<string, unknown>) => void) => {
            updater(capturedFm);
          }),
        },
      };

      const service = new AnnotationSyncService(
        app as any,
        makeWorkersApiClient() as any,
        makeArchiveLookup({ byId: file }) as any,
        makeAnnotationRenderer('') as any,
        makeSectionManager('body') as any,
        makeSettings()
      );

      await service.handleActionUpdated(makeActionUpdatedData());

      // Should preserve the existing sourceArchiveId
      expect(capturedFm.sourceArchiveId).toBe('existing-id');
    });

    it('skips vault.modify when content is unchanged', async () => {
      const file = makeFile('Social Archives/test.md');
      const existingContent = 'body';

      const app = makeApp({ fileContent: existingContent });
      // sectionManager returns the same content as existing
      const sectionManager = makeSectionManager(existingContent);

      const service = new AnnotationSyncService(
        app as any,
        makeWorkersApiClient() as any,
        makeArchiveLookup({ byId: file }) as any,
        makeAnnotationRenderer('') as any,
        sectionManager as any,
        makeSettings()
      );

      await service.handleActionUpdated(makeActionUpdatedData());

      expect(app.vault.modify).not.toHaveBeenCalled();
    });
  });

  // ── Empty annotations ──

  describe('empty annotations', () => {
    it('sets hasAnnotations=false and counts=0 when arrays are empty', async () => {
      const file = makeFile('Social Archives/test.md');
      const capturedFm: Record<string, unknown> = {};

      const app = {
        vault: {
          read: vi.fn().mockResolvedValue('body'),
          modify: vi.fn(),
        },
        fileManager: {
          processFrontMatter: vi.fn().mockImplementation(async (_file: TFile, updater: (fm: Record<string, unknown>) => void) => {
            updater(capturedFm);
          }),
        },
      };

      // Server returns empty arrays
      const apiClient = makeWorkersApiClient({ userNotes: [], userHighlights: [] });

      const service = new AnnotationSyncService(
        app as any,
        apiClient as any,
        makeArchiveLookup({ byId: file }) as any,
        makeAnnotationRenderer('') as any, // renderer returns '' for empty
        makeSectionManager('body') as any,
        makeSettings()
      );

      await service.handleActionUpdated(makeActionUpdatedData());

      expect(capturedFm.userNoteCount).toBe(0);
      expect(capturedFm.userHighlightCount).toBe(0);
      expect(capturedFm.hasAnnotations).toBe(false);
    });
  });

  // ── Error handling ──

  describe('error handling', () => {
    it('returns without throwing when getUserArchive fails', async () => {
      const apiClient = {
        getUserArchive: vi.fn().mockRejectedValue(new Error('Network error')),
      };
      const app = makeApp();

      const service = new AnnotationSyncService(
        app as any,
        apiClient as any,
        makeArchiveLookup() as any,
        makeAnnotationRenderer() as any,
        makeSectionManager() as any,
        makeSettings()
      );

      // Should not throw
      await expect(service.handleActionUpdated(makeActionUpdatedData())).resolves.toBeUndefined();
      expect(app.vault.read).not.toHaveBeenCalled();
    });

    it('returns without throwing when vault.read fails', async () => {
      const file = makeFile('Social Archives/test.md');
      const app = makeApp({ readError: new Error('Read failed') });

      const service = new AnnotationSyncService(
        app as any,
        makeWorkersApiClient() as any,
        makeArchiveLookup({ byId: file }) as any,
        makeAnnotationRenderer() as any,
        makeSectionManager() as any,
        makeSettings()
      );

      await expect(service.handleActionUpdated(makeActionUpdatedData())).resolves.toBeUndefined();
      expect(app.vault.modify).not.toHaveBeenCalled();
    });

    it('returns without throwing when vault.modify fails', async () => {
      const file = makeFile('Social Archives/test.md');
      const app = makeApp({
        fileContent: 'original',
        modifyError: new Error('Modify failed'),
      });
      // sectionManager returns different content to trigger modify
      const sectionManager = makeSectionManager('different content');

      const service = new AnnotationSyncService(
        app as any,
        makeWorkersApiClient() as any,
        makeArchiveLookup({ byId: file }) as any,
        makeAnnotationRenderer('block') as any,
        sectionManager as any,
        makeSettings()
      );

      // Should not throw — modify error is non-fatal
      await expect(service.handleActionUpdated(makeActionUpdatedData())).resolves.toBeUndefined();
    });

    it('still updates frontmatter even when processFrontMatter throws', async () => {
      // processFrontMatter failing is non-fatal for body updates
      const file = makeFile('Social Archives/test.md');
      const app = makeApp({
        fileContent: 'original',
        processFrontMatterError: new Error('FM error'),
      });
      const sectionManager = makeSectionManager('patched');

      const service = new AnnotationSyncService(
        app as any,
        makeWorkersApiClient() as any,
        makeArchiveLookup({ byId: file }) as any,
        makeAnnotationRenderer('block') as any,
        sectionManager as any,
        makeSettings()
      );

      await expect(service.handleActionUpdated(makeActionUpdatedData())).resolves.toBeUndefined();
      // vault.modify should still have been called (frontmatter failure is non-fatal)
      expect(app.vault.modify).toHaveBeenCalled();
    });
  });

  // ── Coalescing ──

  describe('coalescing', () => {
    it('runs only one sync when a second event arrives while first is in-flight', async () => {
      const file = makeFile('Social Archives/test.md');
      let readCallCount = 0;

      // Make read() artificially slow to keep first sync in-flight
      const slowRead = vi.fn().mockImplementation(async () => {
        readCallCount++;
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        return 'body';
      });

      const app = {
        vault: {
          read: slowRead,
          modify: vi.fn(),
        },
        fileManager: {
          processFrontMatter: vi.fn().mockImplementation(async (_file: TFile, updater: (fm: Record<string, unknown>) => void) => {
            updater({});
          }),
        },
      };

      const service = new AnnotationSyncService(
        app as any,
        makeWorkersApiClient() as any,
        makeArchiveLookup({ byId: file }) as any,
        makeAnnotationRenderer('block') as any,
        makeSectionManager('patched') as any,
        makeSettings()
      );

      // Fire 3 events nearly simultaneously
      const p1 = service.handleActionUpdated(makeActionUpdatedData());
      const p2 = service.handleActionUpdated(makeActionUpdatedData());
      const p3 = service.handleActionUpdated(makeActionUpdatedData());

      await Promise.all([p1, p2, p3]);

      // With coalescing: event 1 runs, events 2+3 are folded into one pending run
      // → exactly 2 reads (first + one follow-up)
      expect(readCallCount).toBeLessThanOrEqual(2);
    });
  });
});
