/**
 * RealtimeEventBridge — media repair (Ship 3, item 7).
 *
 * Covers the `ws:media_preserved` sentinel media-region repair:
 *  - `repairable`/`partial`/`completed` statuses trigger repair; `failed` does not.
 *  - localpath sentinels inside the plugin-owned region are replaced with an
 *    Unavailable callout, touching ONLY the region body.
 *  - no region → a non-destructive "review needed" callout is appended.
 *  - locally-deleted notes are recreated ONLY when the opt-in setting is ON.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../views/TimelineView', () => ({
  TimelineView: class MockTimelineView {
    suppressAutoRefresh() {}
    resumeAutoRefresh() {}
  },
  VIEW_TYPE_TIMELINE: 'timeline',
}));

// MediaHandler is dynamically imported by the handler; stub it so the legacy
// expired-media pass is inert (no placeholders are present in these notes).
vi.mock('../../../services/MediaHandler', () => ({
  MediaHandler: class MockMediaHandler {
    redownloadExpiredMedia = vi.fn().mockResolvedValue(null);
    dispose = vi.fn();
  },
}));

import { RealtimeEventBridge } from '../../../plugin/realtime/RealtimeEventBridge';
import type { RealtimeEventBridgeDeps } from '../../../plugin/realtime/RealtimeEventBridge';
import { SentinelMediaRegionManager } from '../../../plugin/realtime/SentinelMediaRegionManager';

const ARCHIVE_ID = 'arch-xyz';

function makeEvents() {
  type Listener = (data: unknown) => void;
  const map = new Map<string, Set<Listener>>();
  let refCount = 0;
  return {
    on(name: string, cb: Listener) {
      if (!map.has(name)) map.set(name, new Set());
      map.get(name)!.add(cb);
      return refCount++;
    },
    offref() {},
    async trigger(name: string, data: unknown) {
      const listeners = map.get(name);
      if (!listeners) return;
      for (const listener of listeners) {
        await (listener as (d: unknown) => Promise<void> | void)(data);
      }
    },
  };
}

/** A fake vault file whose content is held in a mutable closure. */
function makeVaultFile(initial: string) {
  const state = { content: initial };
  const file = { path: `Social Archives/${ARCHIVE_ID}.md`, basename: ARCHIVE_ID } as never;
  return { state, file };
}

function makeApp(state: { content: string }, file: unknown) {
  return {
    workspace: { getLeavesOfType: vi.fn().mockReturnValue([]) },
    vault: {
      getMarkdownFiles: vi.fn().mockReturnValue([]),
      read: vi.fn().mockImplementation(async () => state.content),
      modify: vi.fn().mockImplementation(async (_f: unknown, next: string) => {
        state.content = next;
      }),
    },
    fileManager: { processFrontMatter: vi.fn() },
    metadataCache: {
      getFileCache: vi.fn().mockReturnValue({
        frontmatter: { platform: 'instagram', authorHandle: '@tester' },
      }),
    },
  };
}

function makeDeps(overrides: Partial<RealtimeEventBridgeDeps> = {}): RealtimeEventBridgeDeps {
  return {
    events: makeEvents() as any,
    app: makeApp({ content: '' }, undefined) as any,
    pendingJobsManager: {} as any,
    archiveJobTracker: {} as any,
    crawlJobTracker: { getAllJobs: vi.fn().mockReturnValue([]) } as any,
    archiveLookupService: { findBySourceArchiveId: vi.fn().mockReturnValue(null) } as any,
    annotationSyncService: undefined,
    settings: () => ({ recreateLocallyDeletedNotesOnRepair: false } as any),
    apiClient: () => undefined,
    processCompletedJob: vi.fn(),
    processFailedJob: vi.fn(),
    saveSubscriptionPost: vi.fn().mockResolvedValue(false),
    syncSubscriptionPosts: vi.fn().mockResolvedValue({ total: 0, saved: 0, failed: 0 }),
    createProfileNote: vi.fn().mockResolvedValue(undefined),
    refreshTimelineView: vi.fn(),
    recoverLocationFrontmatterSync: vi.fn().mockResolvedValue(true),
    processPendingSyncQueue: vi.fn().mockResolvedValue(undefined),
    processSyncQueueItem: vi.fn().mockResolvedValue(false),
    ingestRemoteArchive: vi.fn().mockResolvedValue('skipped'),
    getReadableErrorMessage: vi.fn().mockReturnValue('error'),
    processingJobs: new Set(),
    hasRecentlyArchivedUrl: vi.fn().mockReturnValue(false),
    notify: vi.fn(),
    schedule: vi.fn().mockImplementation((cb: () => void, delay: number) => window.setTimeout(cb, delay)),
    currentCrawlWorkerJobId: { value: undefined },
    wsPostBatchCount: { value: 0 },
    wsPostBatchTimer: { value: undefined },
    ...overrides,
  };
}

/** Fire a media_preserved event and flush the handler's internal 3s delay. */
async function fireRepair(events: any, status: string): Promise<void> {
  const trigger = events.trigger('ws:media_preserved', {
    type: 'media_preserved',
    data: { archiveId: ARCHIVE_ID, status },
  });
  await vi.advanceTimersByTimeAsync(3500);
  await trigger;
}

describe('RealtimeEventBridge — media repair (Ship 3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('replaces localpath sentinels inside the region with an Unavailable callout (repairable)', async () => {
    const note = [
      '# Title',
      'Intro that must be preserved.',
      '',
      SentinelMediaRegionManager.wrap(ARCHIVE_ID, '![](localpath:media/x.jpg)'),
      '',
      '## Notes',
      'Personal notes preserved.',
    ].join('\n');
    const { state, file } = makeVaultFile(note);
    const events = makeEvents() as any;
    const deps = makeDeps({
      events,
      app: makeApp(state, file) as any,
      archiveLookupService: { findBySourceArchiveId: vi.fn().mockReturnValue(file) } as any,
    });
    new RealtimeEventBridge(deps).setup();

    await fireRepair(events, 'repairable');

    expect(state.content).toContain('> [!note] Media Unavailable');
    expect(state.content).not.toContain('localpath:');
    // Surrounding content untouched.
    expect(state.content).toContain('Intro that must be preserved.');
    expect(state.content).toContain('Personal notes preserved.');
    // Region markers intact.
    expect(state.content).toContain(`<!-- sa:media:start id=${ARCHIVE_ID} -->`);
    expect(state.content).toContain('<!-- sa:media:end -->');
  });

  it('appends a review-needed callout when no region exists', async () => {
    const note = '# Title\nNo managed region here.\n![](localpath:media/x.jpg)';
    const { state, file } = makeVaultFile(note);
    const events = makeEvents() as any;
    const deps = makeDeps({
      events,
      app: makeApp(state, file) as any,
      archiveLookupService: { findBySourceArchiveId: vi.fn().mockReturnValue(file) } as any,
    });
    new RealtimeEventBridge(deps).setup();

    await fireRepair(events, 'repairable');

    expect(state.content).toContain('[!note] Media updated — review needed');
    expect(state.content).toContain('<!-- sa:media:review-needed -->');
    // No structural rewrite of the body content.
    expect(state.content).toContain('No managed region here.');
  });

  it('does not duplicate the review-needed callout on repeated events', async () => {
    const note = '# Title\nNo region.';
    const { state, file } = makeVaultFile(note);
    const events = makeEvents() as any;
    const deps = makeDeps({
      events,
      app: makeApp(state, file) as any,
      archiveLookupService: { findBySourceArchiveId: vi.fn().mockReturnValue(file) } as any,
    });
    new RealtimeEventBridge(deps).setup();

    await fireRepair(events, 'repairable');
    await fireRepair(events, 'partial');

    const occurrences = state.content.split('<!-- sa:media:review-needed -->').length - 1;
    expect(occurrences).toBe(1);
  });

  it('ignores a failed status (no action)', async () => {
    const note = SentinelMediaRegionManager.wrap(ARCHIVE_ID, '![](localpath:media/x.jpg)');
    const { state, file } = makeVaultFile(note);
    const events = makeEvents() as any;
    const app = makeApp(state, file) as any;
    const deps = makeDeps({
      events,
      app,
      archiveLookupService: { findBySourceArchiveId: vi.fn().mockReturnValue(file) } as any,
    });
    new RealtimeEventBridge(deps).setup();

    await fireRepair(events, 'failed');

    expect(app.vault.read).not.toHaveBeenCalled();
    expect(state.content).toContain('localpath:media/x.jpg'); // unchanged
  });

  it('does NOT recreate a locally-deleted note when the setting is OFF', async () => {
    const events = makeEvents() as any;
    const ingestRemoteArchive = vi.fn().mockResolvedValue('skipped');
    const deps = makeDeps({
      events,
      ingestRemoteArchive,
      settings: () => ({ recreateLocallyDeletedNotesOnRepair: false } as any),
      archiveLookupService: { findBySourceArchiveId: vi.fn().mockReturnValue(null) } as any,
    });
    new RealtimeEventBridge(deps).setup();

    await fireRepair(events, 'repairable');

    expect(ingestRemoteArchive).not.toHaveBeenCalled();
  });

  it('recreates a locally-deleted note when the opt-in setting is ON', async () => {
    const events = makeEvents() as any;
    const ingestRemoteArchive = vi.fn().mockResolvedValue('created');
    const deps = makeDeps({
      events,
      ingestRemoteArchive,
      settings: () => ({ recreateLocallyDeletedNotesOnRepair: true } as any),
      archiveLookupService: { findBySourceArchiveId: vi.fn().mockReturnValue(null) } as any,
    });
    new RealtimeEventBridge(deps).setup();

    await fireRepair(events, 'repairable');

    expect(ingestRemoteArchive).toHaveBeenCalledWith(ARCHIVE_ID, 'client_sync');
  });
});
