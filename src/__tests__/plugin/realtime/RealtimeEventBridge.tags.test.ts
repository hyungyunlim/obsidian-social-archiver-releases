/**
 * RealtimeEventBridge — archive_tags_updated handling tests
 *
 * Tests the new tag sync behavior introduced in the full cross-platform sync:
 * 1. `archive_tags_updated` writes to `archiveTags` (NOT `tags`)
 * 2. Server tags REPLACE existing archiveTags (replacement semantics, not additive)
 * 3. Own `sourceClientId` echo is skipped
 * 4. Suppressed archiveId is skipped (via ArchiveTagOutboundService)
 * 5. `tags` frontmatter is NOT modified
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock TimelineView (and its deep imports that require Obsidian Component) before importing RealtimeEventBridge
vi.mock('../../../views/TimelineView', () => ({
  TimelineView: class MockTimelineView {
    suppressAutoRefresh() {}
    resumeAutoRefresh() {}
  },
  VIEW_TYPE_TIMELINE: 'timeline',
}));

import { RealtimeEventBridge } from '../../../plugin/realtime/RealtimeEventBridge';
import type { RealtimeEventBridgeDeps } from '../../../plugin/realtime/RealtimeEventBridge';
import type { TFile } from 'obsidian';

// ─── Helpers ─────────────────────────────────────────────

function makeFile(path: string): TFile {
  return { path } as unknown as TFile;
}

/**
 * Minimal Events implementation that supports on/offref/trigger.
 * Matches what RealtimeEventBridge requires.
 */
function makeEvents() {
  type Listener = (data: unknown) => void;
  const map = new Map<string, Set<Listener>>();
  let refCount = 0;
  const refToEventName = new Map<number, string>();

  return {
    on(name: string, cb: Listener) {
      if (!map.has(name)) map.set(name, new Set());
      map.get(name)!.add(cb);
      const ref = refCount++;
      refToEventName.set(ref, name);
      return ref;
    },
    offref(ref: number) {
      // noop — good enough for tests
      refToEventName.delete(ref);
    },
    async trigger(name: string, data: unknown) {
      const listeners = map.get(name);
      if (!listeners) return;
      for (const listener of listeners) {
        await (listener as (data: unknown) => Promise<void> | void)(data);
      }
    },
  };
}

function makeApp(options: {
  processFrontMatterFn?: (file: TFile, updater: (fm: Record<string, unknown>) => void) => Promise<void>;
} = {}) {
  return {
    workspace: {
      getLeavesOfType: vi.fn().mockReturnValue([]),
    },
    vault: {
      getMarkdownFiles: vi.fn().mockReturnValue([]),
    },
    fileManager: {
      processFrontMatter: vi.fn().mockImplementation(
        async (file: TFile, updater: (fm: Record<string, unknown>) => void) => {
          options.processFrontMatterFn?.(file, updater);
        }
      ),
    },
    metadataCache: {
      getFileCache: vi.fn(),
    },
  };
}

// ─── Minimal deps builder ─────────────────────────────────

function makeDeps(overrides: Partial<RealtimeEventBridgeDeps> = {}): RealtimeEventBridgeDeps {
  return {
    events: makeEvents() as any,
    app: makeApp() as any,
    pendingJobsManager: { getJobByWorkerJobId: vi.fn(), getJob: vi.fn(), updateJob: vi.fn(), removeJob: vi.fn() },
    archiveJobTracker: { completeJob: vi.fn(), failJob: vi.fn() } as any,
    crawlJobTracker: {
      getJobByWorkerJobId: vi.fn(),
      failJob: vi.fn(),
      getJob: vi.fn(),
      getInternalJobIdByWorkerJobId: vi.fn(),
      getAllJobs: vi.fn().mockReturnValue([]),
      startJob: vi.fn(),
      completeJob: vi.fn(),
      incrementProgressByWorkerJobId: vi.fn(),
    } as any,
    acknowledgePendingPosts: undefined,
    archiveLookupService: undefined,
    annotationSyncService: undefined,
    archiveDeleteSyncService: undefined,
    archiveTagOutboundService: undefined,
    settings: () => ({ enableMobileAnnotationSync: true, syncClientId: 'my-client-id' } as any),
    apiClient: () => undefined,
    processCompletedJob: vi.fn(),
    processFailedJob: vi.fn(),
    saveSubscriptionPost: vi.fn().mockResolvedValue(false),
    syncSubscriptionPosts: vi.fn().mockResolvedValue(undefined),
    createProfileNote: vi.fn().mockResolvedValue(undefined),
    refreshTimelineView: vi.fn(),
    processPendingSyncQueue: vi.fn().mockResolvedValue(undefined),
    processSyncQueueItem: vi.fn().mockResolvedValue(false),
    getReadableErrorMessage: vi.fn().mockReturnValue('error'),
    processingJobs: new Set(),
    notify: vi.fn(),
    schedule: vi.fn(),
    currentCrawlWorkerJobId: { value: undefined },
    wsPostBatchCount: { value: 0 },
    wsPostBatchTimer: { value: undefined },
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────

describe('RealtimeEventBridge — archive_tags_updated handling', () => {
  // ── Test 1: writes to archiveTags, not tags ──

  it('writes server tags to archiveTags frontmatter field (NOT tags)', async () => {
    const file = makeFile('Social Archives/post.md');
    const capturedFm: Record<string, unknown> = { tags: ['local-tag'], archiveTags: [] };

    const app = makeApp({
      processFrontMatterFn: (_file, updater) => { updater(capturedFm); return Promise.resolve(); },
    });

    const archiveLookupService = {
      findBySourceArchiveId: vi.fn().mockReturnValue(file),
      findByOriginalUrl: vi.fn().mockReturnValue([]),
    };

    const events = makeEvents();
    const deps = makeDeps({
      events: events as any,
      app: app as any,
      archiveLookupService: archiveLookupService as any,
      settings: () => ({ enableMobileAnnotationSync: true, syncClientId: 'my-client-id' } as any),
    });

    const bridge = new RealtimeEventBridge(deps);
    bridge.setup();

    await events.trigger('ws:archive_tags_updated', {
      type: 'archive_tags_updated',
      data: {
        archiveId: 'archive-abc',
        tags: ['server-tag-1', 'server-tag-2'],
        updatedAt: '2026-01-01T00:00:00Z',
        timestamp: Date.now(),
        sourceClientId: 'other-client',
      },
    });

    // archiveTags must be replaced with server tags
    expect(capturedFm.archiveTags).toEqual(['server-tag-1', 'server-tag-2']);
  });

  // ── Test 2: replacement semantics ──

  it('REPLACES archiveTags with server list (does not merge)', async () => {
    const file = makeFile('Social Archives/post.md');
    const capturedFm: Record<string, unknown> = {
      archiveTags: ['old-tag-a', 'old-tag-b', 'old-tag-c'],
    };

    const app = makeApp({
      processFrontMatterFn: (_file, updater) => { updater(capturedFm); return Promise.resolve(); },
    });

    const archiveLookupService = {
      findBySourceArchiveId: vi.fn().mockReturnValue(file),
      findByOriginalUrl: vi.fn().mockReturnValue([]),
    };

    const events = makeEvents();
    const deps = makeDeps({
      events: events as any,
      app: app as any,
      archiveLookupService: archiveLookupService as any,
    });

    const bridge = new RealtimeEventBridge(deps);
    bridge.setup();

    await events.trigger('ws:archive_tags_updated', {
      type: 'archive_tags_updated',
      data: {
        archiveId: 'archive-abc',
        tags: ['new-tag-x'],
        updatedAt: '2026-01-01T00:00:00Z',
        timestamp: Date.now(),
        sourceClientId: 'other-client',
      },
    });

    // Old tags must be fully replaced — no merging
    expect(capturedFm.archiveTags).toEqual(['new-tag-x']);
    expect(Array.isArray(capturedFm.archiveTags)).toBe(true);
    expect((capturedFm.archiveTags as string[]).includes('old-tag-a')).toBe(false);
  });

  // ── Test 3: own sourceClientId echo suppression ──

  it('skips processing when sourceClientId matches our own syncClientId', async () => {
    const file = makeFile('Social Archives/post.md');
    const app = makeApp();
    const processFrontMatterSpy = app.fileManager.processFrontMatter;

    const archiveLookupService = {
      findBySourceArchiveId: vi.fn().mockReturnValue(file),
      findByOriginalUrl: vi.fn().mockReturnValue([]),
    };

    const events = makeEvents();
    const deps = makeDeps({
      events: events as any,
      app: app as any,
      archiveLookupService: archiveLookupService as any,
      settings: () => ({ enableMobileAnnotationSync: true, syncClientId: 'my-client-id' } as any),
    });

    const bridge = new RealtimeEventBridge(deps);
    bridge.setup();

    await events.trigger('ws:archive_tags_updated', {
      type: 'archive_tags_updated',
      data: {
        archiveId: 'archive-abc',
        tags: ['tag-1'],
        updatedAt: '2026-01-01T00:00:00Z',
        timestamp: Date.now(),
        sourceClientId: 'my-client-id', // same as our syncClientId
      },
    });

    // processFrontMatter must NOT be called (echo skipped)
    expect(processFrontMatterSpy).not.toHaveBeenCalled();
  });

  // ── Test 4: suppressed archiveId via ArchiveTagOutboundService ──

  it('skips when ArchiveTagOutboundService reports suppression', async () => {
    const file = makeFile('Social Archives/post.md');
    const app = makeApp();
    const processFrontMatterSpy = app.fileManager.processFrontMatter;

    const archiveTagOutboundService = {
      isSuppressed: vi.fn().mockReturnValue(true), // suppressed!
      addSuppression: vi.fn(),
    };

    const archiveLookupService = {
      findBySourceArchiveId: vi.fn().mockReturnValue(file),
      findByOriginalUrl: vi.fn().mockReturnValue([]),
    };

    const events = makeEvents();
    const deps = makeDeps({
      events: events as any,
      app: app as any,
      archiveLookupService: archiveLookupService as any,
      archiveTagOutboundService: archiveTagOutboundService as any,
      settings: () => ({ enableMobileAnnotationSync: true, syncClientId: 'my-client-id' } as any),
    });

    const bridge = new RealtimeEventBridge(deps);
    bridge.setup();

    await events.trigger('ws:archive_tags_updated', {
      type: 'archive_tags_updated',
      data: {
        archiveId: 'archive-abc',
        tags: ['tag-1'],
        updatedAt: '2026-01-01T00:00:00Z',
        timestamp: Date.now(),
        sourceClientId: 'other-client', // not our own clientId
      },
    });

    // processFrontMatter must NOT be called — suppressed
    expect(processFrontMatterSpy).not.toHaveBeenCalled();
  });

  // ── Test 5: tags frontmatter is NOT modified ──

  it('does NOT modify the tags frontmatter field', async () => {
    const file = makeFile('Social Archives/post.md');
    const capturedFm: Record<string, unknown> = {
      tags: ['local-tag-a', 'local-tag-b'],
      archiveTags: [],
    };

    const app = makeApp({
      processFrontMatterFn: (_file, updater) => { updater(capturedFm); return Promise.resolve(); },
    });

    const archiveLookupService = {
      findBySourceArchiveId: vi.fn().mockReturnValue(file),
      findByOriginalUrl: vi.fn().mockReturnValue([]),
    };

    const events = makeEvents();
    const deps = makeDeps({
      events: events as any,
      app: app as any,
      archiveLookupService: archiveLookupService as any,
    });

    const bridge = new RealtimeEventBridge(deps);
    bridge.setup();

    await events.trigger('ws:archive_tags_updated', {
      type: 'archive_tags_updated',
      data: {
        archiveId: 'archive-abc',
        tags: ['server-tag'],
        updatedAt: '2026-01-01T00:00:00Z',
        timestamp: Date.now(),
        sourceClientId: 'other-client',
      },
    });

    // tags must remain completely unchanged
    expect(capturedFm.tags).toEqual(['local-tag-a', 'local-tag-b']);
  });

  // ── Test 6: no vault file found ──

  it('does nothing when no vault file matches the archiveId', async () => {
    const app = makeApp();
    const processFrontMatterSpy = app.fileManager.processFrontMatter;

    const archiveLookupService = {
      findBySourceArchiveId: vi.fn().mockReturnValue(null), // no match
      findByOriginalUrl: vi.fn().mockReturnValue([]),
    };

    const events = makeEvents();
    const deps = makeDeps({
      events: events as any,
      app: app as any,
      archiveLookupService: archiveLookupService as any,
    });

    const bridge = new RealtimeEventBridge(deps);
    bridge.setup();

    await events.trigger('ws:archive_tags_updated', {
      type: 'archive_tags_updated',
      data: {
        archiveId: 'nonexistent-archive',
        tags: ['tag-1'],
        updatedAt: '2026-01-01T00:00:00Z',
        timestamp: Date.now(),
        sourceClientId: 'other-client',
      },
    });

    expect(processFrontMatterSpy).not.toHaveBeenCalled();
  });

  // ── Test 7: feature toggle off ──

  it('does nothing when enableMobileAnnotationSync is off', async () => {
    const file = makeFile('Social Archives/post.md');
    const app = makeApp();
    const processFrontMatterSpy = app.fileManager.processFrontMatter;

    const archiveLookupService = {
      findBySourceArchiveId: vi.fn().mockReturnValue(file),
      findByOriginalUrl: vi.fn().mockReturnValue([]),
    };

    const events = makeEvents();
    const deps = makeDeps({
      events: events as any,
      app: app as any,
      archiveLookupService: archiveLookupService as any,
      settings: () => ({ enableMobileAnnotationSync: false, syncClientId: 'my-client-id' } as any),
    });

    const bridge = new RealtimeEventBridge(deps);
    bridge.setup();

    await events.trigger('ws:archive_tags_updated', {
      type: 'archive_tags_updated',
      data: {
        archiveId: 'archive-abc',
        tags: ['tag-1'],
        updatedAt: '2026-01-01T00:00:00Z',
        timestamp: Date.now(),
        sourceClientId: 'other-client',
      },
    });

    expect(processFrontMatterSpy).not.toHaveBeenCalled();
  });

  // ── Test 8: addSuppression is called before writing (prevent re-trigger) ──

  it('calls archiveTagOutboundService.addSuppression before writing frontmatter', async () => {
    const file = makeFile('Social Archives/post.md');
    const addSuppressionCallOrder: string[] = [];

    const app = makeApp({
      processFrontMatterFn: (_file, updater) => {
        addSuppressionCallOrder.push('processFrontMatter');
        updater({});
        return Promise.resolve();
      },
    });

    const archiveTagOutboundService = {
      isSuppressed: vi.fn().mockReturnValue(false),
      addSuppression: vi.fn().mockImplementation(() => {
        addSuppressionCallOrder.push('addSuppression');
      }),
    };

    const archiveLookupService = {
      findBySourceArchiveId: vi.fn().mockReturnValue(file),
      findByOriginalUrl: vi.fn().mockReturnValue([]),
    };

    const events = makeEvents();
    const deps = makeDeps({
      events: events as any,
      app: app as any,
      archiveLookupService: archiveLookupService as any,
      archiveTagOutboundService: archiveTagOutboundService as any,
    });

    const bridge = new RealtimeEventBridge(deps);
    bridge.setup();

    await events.trigger('ws:archive_tags_updated', {
      type: 'archive_tags_updated',
      data: {
        archiveId: 'archive-abc',
        tags: ['tag-1'],
        updatedAt: '2026-01-01T00:00:00Z',
        timestamp: Date.now(),
        sourceClientId: 'other-client',
      },
    });

    // addSuppression must be called BEFORE processFrontMatter
    const suppressionIdx = addSuppressionCallOrder.indexOf('addSuppression');
    const fmIdx = addSuppressionCallOrder.indexOf('processFrontMatter');
    expect(suppressionIdx).toBeGreaterThanOrEqual(0);
    expect(fmIdx).toBeGreaterThan(suppressionIdx);
  });
});
