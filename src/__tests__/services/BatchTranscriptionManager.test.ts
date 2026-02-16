import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { BatchTranscriptionManager, type BatchTranscriptionManagerDeps } from '@/services/BatchTranscriptionManager';
import type { BatchOperationStatus } from '@/types/batch-transcription';

// Mock obsidian module (duck-typed — manager no longer uses instanceof)
vi.mock('obsidian', async () => {
  const actual = await vi.importActual<typeof import('obsidian')>('obsidian');
  return {
    ...actual,
    normalizePath: (p: string) => p.replace(/\\/g, '/').replace(/\/+/g, '/'),
  };
});

// Mock TranscriptionService
vi.mock('@/services/TranscriptionService', () => ({
  TranscriptionService: vi.fn().mockImplementation(() => ({
    transcribe: vi.fn().mockResolvedValue({
      segments: [{ id: 0, start: 0, end: 5, text: 'Hello world' }],
      language: 'en',
      duration: 5,
      processingTime: 1000,
      model: 'small',
      hasWordTimestamps: false,
    }),
  })),
}));

// Mock WhisperDetector
vi.mock('@/utils/whisper', () => ({
  WhisperDetector: {
    isAvailable: vi.fn().mockResolvedValue(true),
  },
}));

/** Create a duck-typed TFile (has extension, basename, no children) */
function mockFile(path: string) {
  return {
    path,
    basename: path.split('/').pop()?.replace('.md', '') || '',
    extension: 'md',
  };
}

/** Create a duck-typed TFolder (has children array) */
function mockFolder(path: string) {
  return { path, children: [] };
}

function createMockDeps(overrides?: Partial<BatchTranscriptionManagerDeps>): BatchTranscriptionManagerDeps {
  const localStorage: Record<string, string | null> = {};

  const mockFiles = [
    mockFile('Social Archives/note1.md'),
    mockFile('Social Archives/note2.md'),
  ];

  return {
    app: {
      vault: {
        getAbstractFileByPath: vi.fn((path: string) => {
          if (path === 'Social Archives') return mockFolder(path);
          if (path.endsWith('.md')) return mockFile(path);
          return null;
        }),
        read: vi.fn().mockResolvedValue('# Test note\n\nSome content'),
        modify: vi.fn().mockResolvedValue(undefined),
      },
      metadataCache: {
        getFileCache: vi.fn().mockReturnValue({
          frontmatter: { platform: 'youtube', author: 'testuser' },
        }),
      },
      fileManager: {
        processFrontMatter: vi.fn().mockImplementation(async (_file: unknown, cb: (fm: Record<string, unknown>) => void) => {
          cb({});
        }),
      },
      loadLocalStorage: vi.fn((key: string) => localStorage[key] ?? null),
      saveLocalStorage: vi.fn((key: string, value: string | null) => {
        if (value === null) delete localStorage[key];
        else localStorage[key] = value;
      }),
    } as unknown as BatchTranscriptionManagerDeps['app'],
    settings: {
      archivePath: 'Social Archives',
      mediaPath: 'attachments/social-archives',
      transcription: {
        enabled: true,
        preferredVariant: 'auto',
        preferredModel: 'small',
        language: 'auto',
        batchMode: 'transcribe-only',
      },
    } as BatchTranscriptionManagerDeps['settings'],
    resolveLocalVideoPathsInNote: vi.fn().mockResolvedValue(['attachments/video.mp4']),
    collectMarkdownFiles: vi.fn().mockReturnValue(mockFiles),
    toAbsoluteVaultPath: vi.fn((p: string) => `/vault/${p}`),
    appendTranscriptSection: vi.fn((content: string) => content + '\n\n## Transcript\n\n[00:00] Hello world\n'),
    extractDownloadableVideoUrls: vi.fn().mockReturnValue([]),
    downloadMedia: vi.fn().mockResolvedValue([{ localPath: 'attachments/downloaded.mp4' }]),
    isYtDlpUrl: vi.fn().mockReturnValue(false),
    downloadWithYtDlp: vi.fn().mockResolvedValue('attachments/social-archives/youtube/video.mp4'),
    refreshTimelineView: vi.fn(),
    ...overrides,
  };
}

describe('BatchTranscriptionManager', () => {
  let manager: BatchTranscriptionManager;
  let deps: BatchTranscriptionManagerDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    manager = new BatchTranscriptionManager(deps);
  });

  // ─── State Transitions ─────────────────────────────────────────────

  describe('state transitions', () => {
    it('starts in idle status', () => {
      expect(manager.getStatus()).toBe('idle');
    });

    it('transitions idle → scanning → running → completed', async () => {
      const states: BatchOperationStatus[] = [];
      manager.onProgress((p) => {
        if (states.length === 0 || states[states.length - 1] !== p.status) {
          states.push(p.status);
        }
      });

      await manager.start('transcribe-only');

      expect(states).toContain('scanning');
      expect(states).toContain('running');
      expect(states).toContain('completed');
      expect(manager.getStatus()).toBe('completed');
    });

    it('transitions to completed with no items when no files match', async () => {
      deps = createMockDeps({ collectMarkdownFiles: vi.fn().mockReturnValue([]) });
      manager = new BatchTranscriptionManager(deps);

      await manager.start('transcribe-only');
      expect(manager.getStatus()).toBe('completed');
    });

    it('transitions scanning → completed when all files already transcribed', async () => {
      (deps.app.metadataCache.getFileCache as Mock).mockReturnValue({
        frontmatter: { videoTranscribed: true },
      });

      await manager.start('transcribe-only');
      expect(manager.getStatus()).toBe('completed');
    });
  });

  // ─── Scan Filtering ────────────────────────────────────────────────

  describe('scan filtering', () => {
    it('skips notes with videoTranscribed === true', async () => {
      (deps.app.metadataCache.getFileCache as Mock).mockReturnValue({
        frontmatter: { videoTranscribed: true },
      });

      await manager.start('transcribe-only');
      expect(manager.getProgress().totalItems).toBe(0);
    });

    it('skips notes without local video in transcribe-only mode', async () => {
      (deps.resolveLocalVideoPathsInNote as Mock).mockResolvedValue([]);

      await manager.start('transcribe-only');
      expect(manager.getProgress().totalItems).toBe(0);
    });

    it('includes notes with downloadable URL in download-and-transcribe mode', async () => {
      (deps.resolveLocalVideoPathsInNote as Mock).mockResolvedValue([]);
      (deps.extractDownloadableVideoUrls as Mock).mockReturnValue(['https://example.com/video.mp4']);

      await manager.start('download-and-transcribe');
      expect(manager.getProgress().totalItems).toBe(2);
    });
  });

  // ─── Pause / Resume ────────────────────────────────────────────────

  describe('pause and resume', () => {
    it('pauses after current file completes (cooperative)', async () => {
      let callCount = 0;
      (deps.appendTranscriptSection as Mock).mockImplementation((content: string) => {
        callCount++;
        if (callCount === 1) manager.pause();
        return content + '\n\n## Transcript\n';
      });

      await manager.start('transcribe-only');

      expect(manager.getStatus()).toBe('paused');
      expect(manager.getProgress().completedItems).toBeGreaterThanOrEqual(1);
    });

    it('resumes from next pending item', async () => {
      let callCount = 0;
      (deps.appendTranscriptSection as Mock).mockImplementation((content: string) => {
        callCount++;
        if (callCount === 1) manager.pause();
        return content + '\n\n## Transcript\n';
      });

      await manager.start('transcribe-only');
      expect(manager.getStatus()).toBe('paused');
      const completedBefore = manager.getProgress().completedItems;

      (deps.appendTranscriptSection as Mock).mockImplementation((content: string) =>
        content + '\n\n## Transcript\n'
      );

      await manager.resume();
      expect(manager.getStatus()).toBe('completed');
      expect(manager.getProgress().completedItems).toBeGreaterThan(completedBefore);
    });

    it('skips files that no longer exist on resume', async () => {
      let callCount = 0;
      (deps.appendTranscriptSection as Mock).mockImplementation((content: string) => {
        callCount++;
        if (callCount === 1) manager.pause();
        return content + '\n\n## Transcript\n';
      });

      await manager.start('transcribe-only');
      expect(manager.getStatus()).toBe('paused');

      // Simulate archivePath change: remaining files no longer exist
      (deps.app.vault.getAbstractFileByPath as Mock).mockReturnValue(null);

      (deps.appendTranscriptSection as Mock).mockImplementation((content: string) =>
        content + '\n\n## Transcript\n'
      );

      await manager.resume();
      expect(manager.getStatus()).toBe('completed');
      expect(manager.getProgress().skippedItems).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Cancel ────────────────────────────────────────────────────────

  describe('cancel', () => {
    it('cancels from running state (cooperative)', async () => {
      let callCount = 0;
      (deps.appendTranscriptSection as Mock).mockImplementation((content: string) => {
        callCount++;
        if (callCount === 1) manager.cancel();
        return content + '\n\n## Transcript\n';
      });

      await manager.start('transcribe-only');
      expect(manager.getStatus()).toBe('cancelled');
    });

    it('cancels immediately from paused state', async () => {
      let callCount = 0;
      (deps.appendTranscriptSection as Mock).mockImplementation((content: string) => {
        callCount++;
        if (callCount === 1) manager.pause();
        return content + '\n\n## Transcript\n';
      });

      await manager.start('transcribe-only');
      expect(manager.getStatus()).toBe('paused');

      manager.cancel();
      expect(manager.getStatus()).toBe('cancelled');
    });

    it('ignores cancel when idle', () => {
      manager.cancel();
      expect(manager.getStatus()).toBe('idle');
    });
  });

  // ─── Single Execution Guard ────────────────────────────────────────

  describe('single execution guard', () => {
    it('rejects start() when paused (not idle)', async () => {
      let callCount = 0;
      (deps.appendTranscriptSection as Mock).mockImplementation((content: string) => {
        callCount++;
        if (callCount === 1) manager.pause();
        return content + '\n\n## Transcript\n';
      });

      await manager.start('transcribe-only');
      expect(manager.getStatus()).toBe('paused');

      // Reset mock so resume finishes normally
      (deps.appendTranscriptSection as Mock).mockImplementation((content: string) =>
        content + '\n\n## Transcript\n'
      );

      await manager.resume();
      expect(manager.getStatus()).toBe('completed');
    });
  });

  // ─── Persistence ───────────────────────────────────────────────────

  describe('persistence', () => {
    it('saves state on pause', async () => {
      let callCount = 0;
      (deps.appendTranscriptSection as Mock).mockImplementation((content: string) => {
        callCount++;
        if (callCount === 1) manager.pause();
        return content + '\n\n## Transcript\n';
      });

      await manager.start('transcribe-only');
      expect(deps.app.saveLocalStorage).toHaveBeenCalled();

      const saveCalls = (deps.app.saveLocalStorage as Mock).mock.calls as [string, string | null][];
      const nonNullSaves = saveCalls.filter((call) => call[1] !== null);
      expect(nonNullSaves.length).toBeGreaterThan(0);
    });

    it('deletes persisted state on completion', async () => {
      await manager.start('transcribe-only');

      const saveCalls = (deps.app.saveLocalStorage as Mock).mock.calls as [string, string | null][];
      const lastCall = saveCalls[saveCalls.length - 1];
      expect(lastCall?.[1]).toBeNull();
    });

    it('restores paused state with tryRestore()', () => {
      const state = {
        version: 1,
        mode: 'transcribe-only',
        status: 'running',
        items: [
          { filePath: 'note1.md', status: 'completed' },
          { filePath: 'note2.md', status: 'pending' },
        ],
        currentIndex: 1,
        startedAt: Date.now() - 60000,
      };

      (deps.app.loadLocalStorage as Mock).mockReturnValue(JSON.stringify(state));
      const freshManager = new BatchTranscriptionManager(deps);
      freshManager.tryRestore();

      expect(freshManager.getStatus()).toBe('paused');
      expect(freshManager.getProgress().totalItems).toBe(2);
    });

    it('ignores invalid persisted state', () => {
      (deps.app.loadLocalStorage as Mock).mockReturnValue('invalid json{{{');
      const freshManager = new BatchTranscriptionManager(deps);
      freshManager.tryRestore();
      expect(freshManager.getStatus()).toBe('idle');
    });

    it('ignores null persisted state', () => {
      (deps.app.loadLocalStorage as Mock).mockReturnValue(null);
      const freshManager = new BatchTranscriptionManager(deps);
      freshManager.tryRestore();
      expect(freshManager.getStatus()).toBe('idle');
    });
  });

  // ─── Observer ──────────────────────────────────────────────────────

  describe('observer', () => {
    it('notifies observers on progress changes', async () => {
      const updates: BatchOperationStatus[] = [];
      manager.onProgress((p) => updates.push(p.status));

      await manager.start('transcribe-only');

      expect(updates.length).toBeGreaterThan(0);
      expect(updates[0]).toBe('scanning');
    });

    it('unsubscribes correctly', async () => {
      const updates: BatchOperationStatus[] = [];
      const unsubscribe = manager.onProgress((p) => updates.push(p.status));
      unsubscribe();

      await manager.start('transcribe-only');
      expect(updates.length).toBe(0);
    });
  });

  // ─── Progress ──────────────────────────────────────────────────────

  describe('getProgress', () => {
    it('returns correct initial progress', () => {
      const progress = manager.getProgress();
      expect(progress.status).toBe('idle');
      expect(progress.totalItems).toBe(0);
      expect(progress.completedItems).toBe(0);
      expect(progress.failedItems).toBe(0);
    });

    it('returns correct progress after completion', async () => {
      await manager.start('transcribe-only');

      const progress = manager.getProgress();
      expect(progress.status).toBe('completed');
      expect(progress.completedItems).toBe(2);
      expect(progress.failedItems).toBe(0);
    });
  });

  // ─── Frontmatter Updates ──────────────────────────────────────────

  describe('frontmatter updates', () => {
    it('updates frontmatter on successful transcription', async () => {
      await manager.start('transcribe-only');

      expect(deps.app.fileManager.processFrontMatter).toHaveBeenCalled();
      const callCount = (deps.app.fileManager.processFrontMatter as Mock).mock.calls.length;
      expect(callCount).toBeGreaterThanOrEqual(4);
    });

    it('updates frontmatter on transcription failure', async () => {
      const { TranscriptionService } = await import('@/services/TranscriptionService');
      (TranscriptionService as unknown as Mock).mockImplementation(() => ({
        transcribe: vi.fn().mockRejectedValue(new Error('Whisper crashed')),
      }));

      const failDeps = createMockDeps();
      const failManager = new BatchTranscriptionManager(failDeps);
      await failManager.start('transcribe-only');

      expect(failDeps.app.fileManager.processFrontMatter).toHaveBeenCalled();
      expect(failManager.getProgress().failedItems).toBe(2);
    });
  });

  // ─── Download Mode ────────────────────────────────────────────────

  describe('download-and-transcribe mode', () => {
    it('downloads video before transcribing', async () => {
      // Restore TranscriptionService mock (may have been overridden by prior tests)
      const { TranscriptionService } = await import('@/services/TranscriptionService');
      (TranscriptionService as unknown as Mock).mockImplementation(() => ({
        transcribe: vi.fn().mockResolvedValue({
          segments: [{ id: 0, start: 0, end: 5, text: 'Hello world' }],
          language: 'en',
          duration: 5,
          processingTime: 1000,
          model: 'small',
          hasWordTimestamps: false,
        }),
      }));

      (deps.resolveLocalVideoPathsInNote as Mock).mockResolvedValue([]);
      (deps.extractDownloadableVideoUrls as Mock).mockReturnValue(['https://example.com/video.mp4']);

      await manager.start('download-and-transcribe');

      expect(deps.downloadMedia).toHaveBeenCalled();
      expect(manager.getProgress().completedItems).toBe(2);
    });

    it('uses yt-dlp for supported URLs (YouTube, TikTok)', async () => {
      // Restore TranscriptionService mock
      const { TranscriptionService } = await import('@/services/TranscriptionService');
      (TranscriptionService as unknown as Mock).mockImplementation(() => ({
        transcribe: vi.fn().mockResolvedValue({
          segments: [{ id: 0, start: 0, end: 5, text: 'Hello world' }],
          language: 'en',
          duration: 5,
          processingTime: 1000,
          model: 'small',
          hasWordTimestamps: false,
        }),
      }));

      (deps.resolveLocalVideoPathsInNote as Mock).mockResolvedValue([]);
      (deps.extractDownloadableVideoUrls as Mock).mockReturnValue(['https://www.youtube.com/watch?v=abc123']);
      (deps.isYtDlpUrl as Mock).mockReturnValue(true);
      (deps.downloadWithYtDlp as Mock).mockResolvedValue('attachments/social-archives/youtube/video.mp4');

      await manager.start('download-and-transcribe');

      expect(deps.downloadWithYtDlp).toHaveBeenCalled();
      expect(deps.downloadMedia).not.toHaveBeenCalled();
      expect(manager.getProgress().completedItems).toBe(2);
    });
  });

  // ─── dispose ──────────────────────────────────────────────────────

  describe('dispose', () => {
    it('clears observers on dispose', () => {
      const updates: BatchOperationStatus[] = [];
      manager.onProgress((p) => updates.push(p.status));
      manager.dispose();
      expect(manager.getStatus()).toBe('idle');
    });
  });
});
