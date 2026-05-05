/**
 * RealtimeEventBridge — billing_status_updated lifecycle event flow.
 *
 * PRD: `.taskmaster/docs/prd-billing-lifecycle-notifications-plugin.md` §6.4,
 *      §8.2, §11.1.
 *
 * Verifies:
 *   - WS event → refreshBillingUsage called (existing behavior preserved)
 *   - WS event → refreshBillingEvents called → commitBillingEvents called
 *   - High-severity event → Notice shown ONCE per session per id
 *   - Low-severity event → no Notice
 *   - refreshBillingEvents reject → refreshBillingUsage still completed,
 *     no throw out of listener
 *   - refreshBillingUsage reject → refreshBillingEvents still attempted,
 *     no throw out of listener
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock TimelineView (and its deep imports that require Obsidian Component)
// before importing RealtimeEventBridge.
vi.mock('../../../views/TimelineView', () => ({
  TimelineView: class MockTimelineView {
    suppressAutoRefresh() {}
    resumeAutoRefresh() {}
  },
  VIEW_TYPE_TIMELINE: 'timeline',
}));

import { RealtimeEventBridge } from '../../../plugin/realtime/RealtimeEventBridge';
import type { RealtimeEventBridgeDeps } from '../../../plugin/realtime/RealtimeEventBridge';
import type { BillingEventApiPayload } from '../../../types/billing-events';

// ---- Helpers ---------------------------------------------------------------

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

function makeApp() {
  return {
    workspace: { getLeavesOfType: vi.fn().mockReturnValue([]) },
    vault: { getMarkdownFiles: vi.fn().mockReturnValue([]) },
    fileManager: { processFrontMatter: vi.fn() },
    metadataCache: { getFileCache: vi.fn() },
  };
}

function makeDeps(overrides: Partial<RealtimeEventBridgeDeps> = {}): RealtimeEventBridgeDeps {
  return {
    events: makeEvents() as any,
    app: makeApp() as any,
    pendingJobsManager: {
      getJobByWorkerJobId: vi.fn(),
      getJob: vi.fn(),
      updateJob: vi.fn(),
      removeJob: vi.fn(),
    },
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
    settings: () =>
      ({ enableMobileAnnotationSync: true, syncClientId: 'my-client-id' } as any),
    apiClient: () => undefined,
    processCompletedJob: vi.fn(),
    processFailedJob: vi.fn(),
    saveSubscriptionPost: vi.fn().mockResolvedValue(false),
    syncSubscriptionPosts: vi.fn().mockResolvedValue(undefined),
    createProfileNote: vi.fn().mockResolvedValue(undefined),
    refreshBillingUsage: vi.fn().mockResolvedValue(true),
    refreshTimelineView: vi.fn(),
    processPendingSyncQueue: vi.fn().mockResolvedValue(undefined),
    processSyncQueueItem: vi.fn().mockResolvedValue(false),
    getReadableErrorMessage: vi.fn().mockReturnValue('error'),
    processingJobs: new Set(),
    notify: vi.fn(),
    schedule: vi.fn().mockImplementation((cb: () => void, delay: number) => {
      return window.setTimeout(cb, delay);
    }),
    hasRecentlyArchivedUrl: vi.fn().mockReturnValue(false),
    ingestRemoteArchive: vi.fn().mockResolvedValue('skipped'),
    currentCrawlWorkerJobId: { value: undefined },
    wsPostBatchCount: { value: 0 },
    wsPostBatchTimer: { value: undefined },
    ...overrides,
  };
}

function makeEvent(
  overrides: Partial<BillingEventApiPayload> = {},
): BillingEventApiPayload {
  return {
    id: overrides.id ?? 'evt-1',
    type: 'billing_issue',
    severity: 'error',
    state: 'active',
    priority: 100,
    title: 'Payment issue',
    body: '...',
    cta: { action: 'update_and_pay_in_mobile', label: 'Update' },
    payload: {},
    dismissible: false,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

const wsMessage = {
  type: 'billing_status_updated',
  data: {
    reason: 'billing_issue' as const,
    eventType: 'BILLING_ISSUE',
    updatedAt: '2026-05-05T00:00:00.000Z',
    timestamp: Date.UTC(2026, 4, 5),
  },
};

// ---- Tests -----------------------------------------------------------------

describe('RealtimeEventBridge — billing-events on ws:billing_status_updated', () => {
  // The Obsidian mock `Notice` class is a no-op constructor; we don't need
  // to spy on it directly. Notice-show count is observed via the
  // `markBillingEventNoticed` callback, which the bridge invokes
  // immediately after constructing the Notice (see
  // `setupBillingStatusUpdatedListener` in `RealtimeEventBridge.ts`).
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refreshes billing-events and commits them when WS fires', async () => {
    const events = makeEvents() as any;
    const refreshBillingUsage = vi.fn().mockResolvedValue(true);
    const event = makeEvent();
    const refreshBillingEvents = vi.fn().mockResolvedValue([event]);
    const commitBillingEvents = vi.fn();

    const deps = makeDeps({
      events,
      refreshBillingUsage,
      refreshBillingEvents,
      commitBillingEvents,
      shouldShowBillingEventNotice: () => false,
      markBillingEventNoticed: vi.fn(),
    });

    const bridge = new RealtimeEventBridge(deps);
    bridge.setup();

    await events.trigger('ws:billing_status_updated', wsMessage);

    expect(refreshBillingUsage).toHaveBeenCalledOnce();
    expect(refreshBillingEvents).toHaveBeenCalledOnce();
    expect(commitBillingEvents).toHaveBeenCalledWith([event]);
  });

  it('shows Obsidian Notice once per session for high-severity event id', async () => {
    const events = makeEvents() as any;
    const event = makeEvent({ id: 'evt-billing' });

    // We observe Notice show-count via `markBillingEventNoticed` since the
    // bridge invokes it immediately after `new Notice(...)`. The Obsidian
    // mock `Notice` is a no-op so direct counting is not necessary for
    // the dedupe-once-per-session semantics under test.
    const markBillingEventNoticed = vi.fn();
    let firstCall = true;
    const shouldShowBillingEventNotice = vi.fn().mockImplementation(() => {
      // Mimic noticer behavior: true the first time, false thereafter.
      if (firstCall) {
        firstCall = false;
        return true;
      }
      return false;
    });

    const deps = makeDeps({
      events,
      refreshBillingEvents: vi.fn().mockResolvedValue([event]),
      commitBillingEvents: vi.fn(),
      shouldShowBillingEventNotice,
      markBillingEventNoticed,
    });

    const bridge = new RealtimeEventBridge(deps);
    bridge.setup();

    await events.trigger('ws:billing_status_updated', wsMessage);
    await events.trigger('ws:billing_status_updated', wsMessage);

    // Notice path executed exactly once across the two WS events.
    expect(markBillingEventNoticed).toHaveBeenCalledTimes(1);
    expect(markBillingEventNoticed).toHaveBeenCalledWith('evt-billing');
    // Predicate asked twice (one per refresh cycle).
    expect(shouldShowBillingEventNotice).toHaveBeenCalledTimes(2);
  });

  it('does not show Notice for low-severity event', async () => {
    const events = makeEvents() as any;
    const event = makeEvent({ type: 'storage_warning', severity: 'warning' });
    const markBillingEventNoticed = vi.fn();
    const shouldShowBillingEventNotice = vi.fn().mockReturnValue(false);

    const deps = makeDeps({
      events,
      refreshBillingEvents: vi.fn().mockResolvedValue([event]),
      commitBillingEvents: vi.fn(),
      shouldShowBillingEventNotice,
      markBillingEventNoticed,
    });

    const bridge = new RealtimeEventBridge(deps);
    bridge.setup();

    await events.trigger('ws:billing_status_updated', wsMessage);

    expect(shouldShowBillingEventNotice).toHaveBeenCalledOnce();
    expect(markBillingEventNoticed).not.toHaveBeenCalled();
  });

  it('still completes refreshBillingUsage when refreshBillingEvents rejects', async () => {
    const events = makeEvents() as any;
    const refreshBillingUsage = vi.fn().mockResolvedValue(true);
    const refreshBillingEvents = vi.fn().mockRejectedValue(new Error('boom'));
    const commitBillingEvents = vi.fn();

    const deps = makeDeps({
      events,
      refreshBillingUsage,
      refreshBillingEvents,
      commitBillingEvents,
    });

    const bridge = new RealtimeEventBridge(deps);
    bridge.setup();

    // Listener must not throw out.
    await expect(
      events.trigger('ws:billing_status_updated', wsMessage),
    ).resolves.toBeUndefined();

    expect(refreshBillingUsage).toHaveBeenCalledOnce();
    expect(refreshBillingEvents).toHaveBeenCalledOnce();
    expect(commitBillingEvents).not.toHaveBeenCalled();
  });

  it('still attempts refreshBillingEvents when refreshBillingUsage rejects', async () => {
    const events = makeEvents() as any;
    const refreshBillingUsage = vi.fn().mockRejectedValue(new Error('usage failed'));
    const refreshBillingEvents = vi.fn().mockResolvedValue([]);
    const commitBillingEvents = vi.fn();

    const deps = makeDeps({
      events,
      refreshBillingUsage,
      refreshBillingEvents,
      commitBillingEvents,
    });

    const bridge = new RealtimeEventBridge(deps);
    bridge.setup();

    await expect(
      events.trigger('ws:billing_status_updated', wsMessage),
    ).resolves.toBeUndefined();

    expect(refreshBillingUsage).toHaveBeenCalledOnce();
    expect(refreshBillingEvents).toHaveBeenCalledOnce();
    expect(commitBillingEvents).toHaveBeenCalledWith([]);
  });
});
