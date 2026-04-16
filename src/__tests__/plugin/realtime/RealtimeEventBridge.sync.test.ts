/**
 * RealtimeEventBridge -- subscription sync reliability tests
 *
 * Tests the defense-in-depth sync behavior introduced for subscription post
 * reliability:
 *
 * 1. `ws:connected` schedules `syncSubscriptionPosts()` with ~1s delay
 * 2. `archive_added` with `source=subscription` triggers debounced sync
 * 3. `archive_added` with other source does NOT trigger sync
 * 4. Multiple `archive_added` events within debounce window produce ONE sync
 * 5. `clear()` cancels pending `archive_added` debounce timer
 * 6. `subscription_post` ACK uses injected capability on success
 * 7. ACK failure after direct save is non-fatal
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

// ---- Helpers ---------------------------------------------------------------

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
    workspace: {
      getLeavesOfType: vi.fn().mockReturnValue([]),
    },
    vault: {
      getMarkdownFiles: vi.fn().mockReturnValue([]),
    },
    fileManager: {
      processFrontMatter: vi.fn(),
    },
    metadataCache: {
      getFileCache: vi.fn(),
    },
  };
}

// ---- Minimal deps builder --------------------------------------------------

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
    schedule: vi.fn().mockImplementation((cb: () => void, delay: number) => {
      return window.setTimeout(cb, delay);
    }),
    currentCrawlWorkerJobId: { value: undefined },
    wsPostBatchCount: { value: 0 },
    wsPostBatchTimer: { value: undefined },
    ...overrides,
  };
}

// ---- Tests -----------------------------------------------------------------

describe('RealtimeEventBridge -- subscription sync reliability', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // 1. WS reconnect trigger
  // --------------------------------------------------------------------------

  it('schedules syncSubscriptionPosts on ws:connected with ~1s delay', async () => {
    const syncSubscriptionPosts = vi.fn().mockResolvedValue(undefined);
    const scheduleFn = vi.fn().mockImplementation((cb: () => void, delay: number) => {
      return window.setTimeout(cb, delay);
    });

    const events = makeEvents();
    const deps = makeDeps({
      events: events as any,
      syncSubscriptionPosts,
      schedule: scheduleFn,
    });

    const bridge = new RealtimeEventBridge(deps);
    bridge.setup();

    // Trigger ws:connected
    await events.trigger('ws:connected', undefined);

    // schedule() should have been called with a ~1s delay for subscription sync
    const subscriptionSyncCall = scheduleFn.mock.calls.find(
      (call: [() => void, number]) => call[1] === 1000
    );
    expect(subscriptionSyncCall).toBeDefined();

    // syncSubscriptionPosts should NOT have been called yet (it's scheduled)
    expect(syncSubscriptionPosts).not.toHaveBeenCalled();

    // Advance timer past the 1s delay
    vi.advanceTimersByTime(1000);

    // Allow the async callback (void promise) to resolve
    await vi.runAllTimersAsync();

    // Now it should have been called with 'ws-connected' trigger
    expect(syncSubscriptionPosts).toHaveBeenCalledWith('ws-connected');
  });

  // --------------------------------------------------------------------------
  // 2. archive_added with source=subscription triggers sync
  // --------------------------------------------------------------------------

  it('triggers debounced syncSubscriptionPosts on archive_added with source=subscription', async () => {
    const syncSubscriptionPosts = vi.fn().mockResolvedValue(undefined);

    const events = makeEvents();
    const deps = makeDeps({
      events: events as any,
      syncSubscriptionPosts,
      schedule: vi.fn().mockImplementation((cb: () => void, delay: number) => {
        return window.setTimeout(cb, delay);
      }),
    });

    const bridge = new RealtimeEventBridge(deps);
    bridge.setup();

    // Trigger archive_added with source=subscription
    await events.trigger('ws:archive_added', {
      type: 'archive_added',
      data: {
        archiveId: 'archive-1',
        source: 'subscription',
        subscriptionId: 'sub-1',
      },
    });

    // Not called yet (debounced)
    expect(syncSubscriptionPosts).not.toHaveBeenCalled();

    // Advance past the 2s debounce window
    vi.advanceTimersByTime(2000);
    await vi.runAllTimersAsync();

    // Now it should fire with 'archive-added' trigger
    expect(syncSubscriptionPosts).toHaveBeenCalledWith('archive-added');
  });

  // --------------------------------------------------------------------------
  // 3. archive_added with other source does NOT trigger sync
  // --------------------------------------------------------------------------

  it('does NOT trigger sync on archive_added with non-subscription source', async () => {
    const syncSubscriptionPosts = vi.fn().mockResolvedValue(undefined);

    const events = makeEvents();
    const deps = makeDeps({
      events: events as any,
      syncSubscriptionPosts,
      schedule: vi.fn().mockImplementation((cb: () => void, delay: number) => {
        return window.setTimeout(cb, delay);
      }),
    });

    const bridge = new RealtimeEventBridge(deps);
    bridge.setup();

    // Trigger archive_added with a non-subscription source
    await events.trigger('ws:archive_added', {
      type: 'archive_added',
      data: {
        archiveId: 'archive-1',
        source: 'manual',
      },
    });

    // Advance well past any possible debounce
    vi.advanceTimersByTime(5000);
    await vi.runAllTimersAsync();

    // Should never be called for non-subscription sources
    expect(syncSubscriptionPosts).not.toHaveBeenCalledWith('archive-added');
  });

  it('does NOT trigger sync on archive_added with no source field', async () => {
    const syncSubscriptionPosts = vi.fn().mockResolvedValue(undefined);

    const events = makeEvents();
    const deps = makeDeps({
      events: events as any,
      syncSubscriptionPosts,
      schedule: vi.fn().mockImplementation((cb: () => void, delay: number) => {
        return window.setTimeout(cb, delay);
      }),
    });

    const bridge = new RealtimeEventBridge(deps);
    bridge.setup();

    // Trigger archive_added with no data.source
    await events.trigger('ws:archive_added', {
      type: 'archive_added',
      data: { archiveId: 'archive-1' },
    });

    vi.advanceTimersByTime(5000);
    await vi.runAllTimersAsync();

    expect(syncSubscriptionPosts).not.toHaveBeenCalledWith('archive-added');
  });

  // --------------------------------------------------------------------------
  // 4. Debounce: multiple archive_added events produce ONE sync call
  // --------------------------------------------------------------------------

  it('debounces multiple archive_added events into a single sync call', async () => {
    const syncSubscriptionPosts = vi.fn().mockResolvedValue(undefined);

    const events = makeEvents();
    const deps = makeDeps({
      events: events as any,
      syncSubscriptionPosts,
      schedule: vi.fn().mockImplementation((cb: () => void, delay: number) => {
        return window.setTimeout(cb, delay);
      }),
    });

    const bridge = new RealtimeEventBridge(deps);
    bridge.setup();

    // Fire 5 archive_added events in rapid succession (500ms apart)
    for (let i = 0; i < 5; i++) {
      await events.trigger('ws:archive_added', {
        type: 'archive_added',
        data: {
          archiveId: `archive-${i}`,
          source: 'subscription',
          subscriptionId: `sub-${i}`,
        },
      });
      vi.advanceTimersByTime(500);
    }

    // Advance past the debounce window from the last event
    vi.advanceTimersByTime(2000);
    await vi.runAllTimersAsync();

    // Only ONE sync call should fire (debounced)
    const archiveAddedCalls = syncSubscriptionPosts.mock.calls.filter(
      (call: [string?]) => call[0] === 'archive-added'
    );
    expect(archiveAddedCalls.length).toBe(1);
  });

  // --------------------------------------------------------------------------
  // 5. clear() cancels archive_added debounce timer
  // --------------------------------------------------------------------------

  it('clear() cancels pending archive_added debounce timer', async () => {
    const syncSubscriptionPosts = vi.fn().mockResolvedValue(undefined);

    const events = makeEvents();
    const deps = makeDeps({
      events: events as any,
      syncSubscriptionPosts,
      schedule: vi.fn().mockImplementation((cb: () => void, delay: number) => {
        return window.setTimeout(cb, delay);
      }),
    });

    const bridge = new RealtimeEventBridge(deps);
    bridge.setup();

    // Trigger archive_added to start a debounce timer
    await events.trigger('ws:archive_added', {
      type: 'archive_added',
      data: {
        archiveId: 'archive-1',
        source: 'subscription',
      },
    });

    // Call clear() before debounce fires
    bridge.clear();

    // Advance past the debounce window
    vi.advanceTimersByTime(5000);
    await vi.runAllTimersAsync();

    // Sync should NOT have been triggered (timer was cancelled)
    expect(syncSubscriptionPosts).not.toHaveBeenCalledWith('archive-added');
  });

  // --------------------------------------------------------------------------
  // 6. subscription_post ACK uses injected capability
  // --------------------------------------------------------------------------

  it('calls acknowledgePendingPosts after successful subscription_post save', async () => {
    const acknowledgePendingPosts = vi.fn().mockResolvedValue(undefined);
    const saveSubscriptionPost = vi.fn().mockResolvedValue(true); // save succeeds

    const events = makeEvents();
    const deps = makeDeps({
      events: events as any,
      acknowledgePendingPosts,
      saveSubscriptionPost,
    });

    const bridge = new RealtimeEventBridge(deps);
    bridge.setup();

    await events.trigger('ws:subscription_post', {
      post: {
        platform: 'x',
        id: 'post-1',
        content: { text: 'hello' },
        author: { name: 'test' },
        media: [],
        metadata: {},
      },
      destinationFolder: 'Social Archives/X',
      pendingPostId: 'pending-abc',
      subscriptionId: 'sub-1',
      subscriptionName: 'Test Sub',
    });

    // ACK should have been called with the pendingPostId
    expect(acknowledgePendingPosts).toHaveBeenCalledWith(['pending-abc']);
  });

  it('does NOT call acknowledgePendingPosts when save returns false', async () => {
    const acknowledgePendingPosts = vi.fn().mockResolvedValue(undefined);
    const saveSubscriptionPost = vi.fn().mockResolvedValue(false); // save fails

    const events = makeEvents();
    const deps = makeDeps({
      events: events as any,
      acknowledgePendingPosts,
      saveSubscriptionPost,
    });

    const bridge = new RealtimeEventBridge(deps);
    bridge.setup();

    await events.trigger('ws:subscription_post', {
      post: {
        platform: 'x',
        id: 'post-1',
        content: { text: 'hello' },
        author: { name: 'test' },
        media: [],
        metadata: {},
      },
      destinationFolder: 'Social Archives/X',
      pendingPostId: 'pending-abc',
      subscriptionId: 'sub-1',
    });

    expect(acknowledgePendingPosts).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // 7. ACK failure after direct save is non-fatal
  // --------------------------------------------------------------------------

  it('ACK failure after successful save does not throw or break the handler', async () => {
    const acknowledgePendingPosts = vi.fn().mockRejectedValue(new Error('ACK failed'));
    const saveSubscriptionPost = vi.fn().mockResolvedValue(true);
    const syncSubscriptionPosts = vi.fn().mockResolvedValue(undefined);

    const events = makeEvents();
    const deps = makeDeps({
      events: events as any,
      acknowledgePendingPosts,
      saveSubscriptionPost,
      syncSubscriptionPosts,
    });

    const bridge = new RealtimeEventBridge(deps);
    bridge.setup();

    // This should NOT throw even though ACK fails
    await expect(
      events.trigger('ws:subscription_post', {
        post: {
          platform: 'x',
          id: 'post-1',
          content: { text: 'hello' },
          author: { name: 'test' },
          media: [],
          metadata: {},
        },
        destinationFolder: 'Social Archives/X',
        pendingPostId: 'pending-abc',
        subscriptionId: 'sub-1',
      })
    ).resolves.not.toThrow();

    // Save was called and succeeded
    expect(saveSubscriptionPost).toHaveBeenCalled();

    // ACK was attempted
    expect(acknowledgePendingPosts).toHaveBeenCalledWith(['pending-abc']);

    // The handler should not have fallen through to the fallback sync
    // (the catch around ACK is non-critical, so the save is still considered successful)
    expect(syncSubscriptionPosts).not.toHaveBeenCalledWith('subscription-post-fallback');
  });

  // --------------------------------------------------------------------------
  // Additional edge case: ws:connected also triggers processPendingSyncQueue
  // --------------------------------------------------------------------------

  it('ws:connected schedules processPendingSyncQueue when syncClientId is set', async () => {
    const processPendingSyncQueue = vi.fn().mockResolvedValue(undefined);
    const scheduleFn = vi.fn().mockImplementation((cb: () => void, delay: number) => {
      return window.setTimeout(cb, delay);
    });

    const events = makeEvents();
    const deps = makeDeps({
      events: events as any,
      processPendingSyncQueue,
      schedule: scheduleFn,
      settings: () => ({ enableMobileAnnotationSync: true, syncClientId: 'client-1' } as any),
    });

    const bridge = new RealtimeEventBridge(deps);
    bridge.setup();

    await events.trigger('ws:connected', undefined);

    // Should have scheduled a 2s delayed call for processPendingSyncQueue
    const syncQueueCall = scheduleFn.mock.calls.find(
      (call: [() => void, number]) => call[1] === 2000
    );
    expect(syncQueueCall).toBeDefined();
  });
});
