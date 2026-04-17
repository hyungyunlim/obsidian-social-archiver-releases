/**
 * AnnotationFallbackPoller — Unit Tests
 *
 * Covers the receive-path resilience polling state machine:
 *   - start() schedules a tick
 *   - stop() halts and cleans the timer
 *   - tick success → re-arms with rolling updatedAfter watermark
 *   - tick error  → fail-closed (stop, no retry loop)
 *   - recovery    → after start → stop, re-arm works on next start
 *
 * No real timers are used; we inject deterministic setTimer/clearTimer mocks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnnotationFallbackPoller } from '../../services/AnnotationFallbackPoller';
import type { UserArchive, WorkersAPIClient } from '../../services/WorkersAPIClient';

// ─── Harness ────────────────────────────────────────────────────────────────

type Task = { id: number; cb: () => void; delay: number };

class TimerHarness {
  private tasks: Task[] = [];
  private seq = 0;

  readonly setTimer = vi.fn((cb: () => void, delay: number): number => {
    const id = ++this.seq;
    this.tasks.push({ id, cb, delay });
    return id;
  });

  readonly clearTimer = vi.fn((id: number): void => {
    this.tasks = this.tasks.filter((t) => t.id !== id);
  });

  /** Run the most recently scheduled task (FIFO across the remaining set). */
  async flushNext(): Promise<void> {
    const next = this.tasks.shift();
    if (!next) return;
    next.cb();
    // Give microtasks a chance to propagate awaited fetches. Poller ticks
    // chain multiple awaits (list fetch → optional detail fetch per archive),
    // so drain generously; `Promise.resolve()` is cheap.
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  }

  pendingCount(): number {
    return this.tasks.length;
  }
}

function makeArchive(id: string, overrides: Partial<UserArchive> = {}): UserArchive {
  return {
    id,
    userId: 'user-1',
    platform: 'x',
    postId: 'p',
    originalUrl: `https://x.com/${id}`,
    title: null,
    authorName: null,
    authorUrl: null,
    authorAvatarUrl: null,
    previewText: null,
    fullContent: null,
    thumbnailUrl: null,
    thumbnailUrls: null,
    media: null,
    postedAt: null,
    archivedAt: '2026-04-17T00:00:00.000Z',
    likesCount: null,
    commentCount: null,
    sharesCount: null,
    viewsCount: null,
    metadata: null,
    isLiked: false,
    isBookmarked: false,
    isArchived: false,
    isShared: false,
    ...overrides,
  } as UserArchive;
}

function makeApiClient(
  response: { archives: UserArchive[]; serverTime?: string } = { archives: [] },
  opts: {
    fail?: Error;
    detailFail?: Error;
    /**
     * Per-archive detail payload; keys are archive IDs. Falls back to the
     * matching list entry when a key is missing, so legacy tests that don't
     * exercise the flip path don't need to specify it.
     */
    detail?: Record<string, UserArchive>;
  } = {},
): WorkersAPIClient {
  return {
    getUserArchives: vi.fn().mockImplementation(async () => {
      if (opts.fail) throw opts.fail;
      return response;
    }),
    getUserArchive: vi.fn().mockImplementation(async (archiveId: string) => {
      if (opts.detailFail) throw opts.detailFail;
      const hydrated = opts.detail?.[archiveId]
        ?? response.archives.find((a) => a.id === archiveId);
      if (!hydrated) {
        throw new Error(`test harness: no detail record for ${archiveId}`);
      }
      return { archive: hydrated };
    }),
  } as unknown as WorkersAPIClient;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('AnnotationFallbackPoller', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('starts polling on start() and schedules the next tick', () => {
    const timer = new TimerHarness();
    const apiClient = makeApiClient();
    const onArchiveUpdate = vi.fn();

    const poller = new AnnotationFallbackPoller({
      apiClient,
      onArchiveUpdate,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      random: () => 0.5,
    });

    expect(poller.isActive()).toBe(false);
    poller.start();
    expect(poller.isActive()).toBe(true);
    expect(timer.setTimer).toHaveBeenCalledTimes(1);
    expect(timer.pendingCount()).toBe(1);
  });

  it('stop() halts polling and clears pending timer', () => {
    const timer = new TimerHarness();
    const apiClient = makeApiClient();

    const poller = new AnnotationFallbackPoller({
      apiClient,
      onArchiveUpdate: vi.fn(),
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      random: () => 0,
    });

    poller.start();
    poller.stop();

    expect(poller.isActive()).toBe(false);
    expect(timer.clearTimer).toHaveBeenCalledTimes(1);
    expect(timer.pendingCount()).toBe(0);
  });

  it('calls onArchiveUpdate for each returned archive and re-arms after success', async () => {
    const timer = new TimerHarness();
    const archive = makeArchive('arch-1');
    const apiClient = makeApiClient({
      archives: [archive],
      serverTime: '2026-04-17T01:00:00.000Z',
    });
    const onArchiveUpdate = vi.fn();

    const poller = new AnnotationFallbackPoller({
      apiClient,
      onArchiveUpdate,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      random: () => 0,
    });

    poller.start();
    await timer.flushNext();

    expect(apiClient.getUserArchives).toHaveBeenCalledWith(
      expect.objectContaining({ includeDeleted: true }),
    );
    expect(onArchiveUpdate).toHaveBeenCalledWith(archive);
    // Re-armed after success
    expect(poller.isActive()).toBe(true);
    expect(timer.pendingCount()).toBe(1);
  });

  it('fails closed on network error (stops polling, no loop)', async () => {
    const timer = new TimerHarness();
    const apiClient = makeApiClient({ archives: [] }, { fail: new Error('offline') });

    const poller = new AnnotationFallbackPoller({
      apiClient,
      onArchiveUpdate: vi.fn(),
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      random: () => 0,
    });

    poller.start();
    await timer.flushNext();

    expect(poller.isActive()).toBe(false);
    expect(timer.pendingCount()).toBe(0);
  });

  it('recovers: after stop(), a subsequent start() works again', async () => {
    const timer = new TimerHarness();
    const archive = makeArchive('arch-2');
    const apiClient = makeApiClient({ archives: [archive] });
    const onArchiveUpdate = vi.fn();

    const poller = new AnnotationFallbackPoller({
      apiClient,
      onArchiveUpdate,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      random: () => 0,
    });

    poller.start();
    await timer.flushNext();
    poller.stop();

    expect(poller.isActive()).toBe(false);

    poller.start();
    await timer.flushNext();

    expect(onArchiveUpdate).toHaveBeenCalledTimes(2);
    expect(poller.isActive()).toBe(true);
  });

  // ── Codex HOLD #6: annotation count-flip detection ───────────────────────
  //
  // The delta list only carries `userNoteCount` / `userHighlightCount`. The
  // full arrays live on `GET /api/user/archives/:archiveId`. The poller must
  // detect count flips and hydrate via per-archive detail fetch so the first
  // annotation (0 → 1) still reaches the reconciler.

  it('first-annotation flip (0 → 1 note) triggers detail fetch and hydrates arrays', async () => {
    const timer = new TimerHarness();

    // Tick 1: the archive enters the delta with zero counts (seed snapshot).
    // Tick 2: the archive reappears with userNoteCount = 1 → flip.
    const seedArchive = makeArchive('arch-flip', {
      userNoteCount: 0,
      userHighlightCount: 0,
    });
    const flippedListRow = makeArchive('arch-flip', {
      userNoteCount: 1,
      userHighlightCount: 0,
      // List endpoint does NOT populate the arrays — intentionally omitted.
    });
    const hydratedDetail = makeArchive('arch-flip', {
      userNoteCount: 1,
      userHighlightCount: 0,
      userNotes: [
        {
          id: 'note-1',
          text: 'first note ever',
          createdAt: '2026-04-17T01:00:00.000Z',
        },
      ] as unknown as UserArchive['userNotes'],
      userHighlights: [],
    });

    // Distinct responses per tick. `getUserArchive` returns the hydrated one.
    const tickResponses = [
      { archives: [seedArchive], serverTime: '2026-04-17T00:30:00.000Z' },
      { archives: [flippedListRow], serverTime: '2026-04-17T01:00:00.000Z' },
    ];
    const getUserArchives = vi.fn().mockImplementation(async () => {
      return tickResponses.shift() ?? { archives: [] };
    });
    const getUserArchive = vi.fn().mockImplementation(async (id: string) => {
      if (id !== 'arch-flip') throw new Error(`unexpected detail fetch for ${id}`);
      return { archive: hydratedDetail };
    });
    const apiClient = { getUserArchives, getUserArchive } as unknown as WorkersAPIClient;

    const onArchiveUpdate = vi.fn();

    const poller = new AnnotationFallbackPoller({
      apiClient,
      onArchiveUpdate,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      random: () => 0,
    });

    poller.start();
    await timer.flushNext(); // Tick 1 — snapshot seeded, no flip, no detail fetch.

    expect(getUserArchive).not.toHaveBeenCalled();
    expect(onArchiveUpdate).toHaveBeenCalledTimes(1);
    // Tick 1 delivers the seed row as-is (no flip).
    expect(onArchiveUpdate).toHaveBeenLastCalledWith(seedArchive);

    await timer.flushNext(); // Tick 2 — 0 → 1 flip should hydrate.

    expect(getUserArchive).toHaveBeenCalledTimes(1);
    expect(getUserArchive).toHaveBeenCalledWith('arch-flip');
    // The hydrated record (with full userNotes array) is what the caller sees.
    expect(onArchiveUpdate).toHaveBeenCalledTimes(2);
    expect(onArchiveUpdate).toHaveBeenLastCalledWith(hydratedDetail);
    const lastCall = onArchiveUpdate.mock.calls[1]![0] as UserArchive;
    expect(lastCall.userNotes?.length).toBe(1);
  });

  it('stable counts (2 → 2) does NOT trigger a detail fetch', async () => {
    const timer = new TimerHarness();

    const seedArchive = makeArchive('arch-stable', {
      userNoteCount: 2,
      userHighlightCount: 0,
    });
    const sameRow = makeArchive('arch-stable', {
      userNoteCount: 2,
      userHighlightCount: 0,
    });

    const tickResponses = [
      { archives: [seedArchive], serverTime: '2026-04-17T00:30:00.000Z' },
      { archives: [sameRow], serverTime: '2026-04-17T01:00:00.000Z' },
    ];
    const getUserArchives = vi.fn().mockImplementation(async () => {
      return tickResponses.shift() ?? { archives: [] };
    });
    // Tick 1 triggers firstEverAnnotation (no prior snapshot, counts > 0),
    // so the detail endpoint is called once. We still need a valid response
    // so the tick itself completes; the assertion below verifies tick 2
    // (stable 2 → 2) does NOT add a second call.
    const getUserArchive = vi
      .fn()
      .mockResolvedValue({ archive: seedArchive });
    const apiClient = { getUserArchives, getUserArchive } as unknown as WorkersAPIClient;

    const onArchiveUpdate = vi.fn();

    const poller = new AnnotationFallbackPoller({
      apiClient,
      onArchiveUpdate,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      random: () => 0,
    });

    poller.start();
    // Tick 1: first observation → snapshot seeded. The first observation is
    // NOT a flip (not a 0 → N increase, the prior state is unknown); the
    // poller uses `firstEverAnnotation` only when the seed snapshot is
    // absent AND counts are > 0 ... but the contract we enforce here is
    // specifically about the stable case (N → N with a prior snapshot). We
    // therefore seed with a fetch that already shows 2 notes so that the
    // firstEverAnnotation branch fires on tick 1, then verify tick 2 is a
    // no-op detail-fetch-wise.
    await timer.flushNext();
    // Tick 1 counts went 0 (no snapshot) → 2 → treated as firstEverAnnotation
    // → detail fetch. Verify the behavior explicitly so the contract is
    // documented, then check tick 2's stability.
    expect(getUserArchive).toHaveBeenCalledTimes(1);

    await timer.flushNext(); // Tick 2 — counts 2 → 2, no flip.

    // Still just the one detail-fetch from tick 1. Tick 2 must not re-fetch.
    expect(getUserArchive).toHaveBeenCalledTimes(1);
    expect(onArchiveUpdate).toHaveBeenCalledTimes(2);
    // Tick 2 delivers the list row as-is (no hydration).
    expect(onArchiveUpdate).toHaveBeenLastCalledWith(sameRow);
  });

  it('hasAnnotations flip (false → true via highlight count) triggers detail fetch', async () => {
    const timer = new TimerHarness();

    const seedArchive = makeArchive('arch-highlight', {
      userNoteCount: 0,
      userHighlightCount: 0,
    });
    const flippedListRow = makeArchive('arch-highlight', {
      userNoteCount: 0,
      userHighlightCount: 1,
    });
    const hydratedDetail = makeArchive('arch-highlight', {
      userNoteCount: 0,
      userHighlightCount: 1,
      userNotes: [],
      userHighlights: [
        { id: 'hl-1', text: 'first highlight ever' },
      ] as unknown as UserArchive['userHighlights'],
    });

    const tickResponses = [
      { archives: [seedArchive], serverTime: '2026-04-17T00:30:00.000Z' },
      { archives: [flippedListRow], serverTime: '2026-04-17T01:00:00.000Z' },
    ];
    const getUserArchives = vi.fn().mockImplementation(async () => {
      return tickResponses.shift() ?? { archives: [] };
    });
    const getUserArchive = vi.fn().mockImplementation(async () => ({
      archive: hydratedDetail,
    }));
    const apiClient = { getUserArchives, getUserArchive } as unknown as WorkersAPIClient;

    const onArchiveUpdate = vi.fn();

    const poller = new AnnotationFallbackPoller({
      apiClient,
      onArchiveUpdate,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      random: () => 0,
    });

    poller.start();
    await timer.flushNext(); // Tick 1 — seed snapshot at 0/0, no fetch.
    expect(getUserArchive).not.toHaveBeenCalled();

    await timer.flushNext(); // Tick 2 — highlight count 0 → 1 flip.

    expect(getUserArchive).toHaveBeenCalledTimes(1);
    expect(getUserArchive).toHaveBeenCalledWith('arch-highlight');
    expect(onArchiveUpdate).toHaveBeenLastCalledWith(hydratedDetail);
    const lastCall = onArchiveUpdate.mock.calls.at(-1)![0] as UserArchive;
    expect(lastCall.userHighlights?.length).toBe(1);
  });

  it('detail-fetch failure during flip stops the poller (fail-closed)', async () => {
    const timer = new TimerHarness();

    const flippedListRow = makeArchive('arch-broken', {
      userNoteCount: 1,
      userHighlightCount: 0,
    });

    const getUserArchives = vi.fn().mockResolvedValue({
      archives: [flippedListRow],
      serverTime: '2026-04-17T01:00:00.000Z',
    });
    const getUserArchive = vi.fn().mockRejectedValue(new Error('detail-offline'));
    const apiClient = { getUserArchives, getUserArchive } as unknown as WorkersAPIClient;

    const onArchiveUpdate = vi.fn();

    const poller = new AnnotationFallbackPoller({
      apiClient,
      onArchiveUpdate,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      random: () => 0,
    });

    poller.start();
    await timer.flushNext();

    // First tick: firstEverAnnotation is true (count 1, no prior snapshot) →
    // triggers detail fetch → detail throws → poller stops (fail-closed).
    expect(getUserArchive).toHaveBeenCalledWith('arch-broken');
    expect(poller.isActive()).toBe(false);
    expect(timer.pendingCount()).toBe(0);
    // The handler must not have been called with half-baked data.
    expect(onArchiveUpdate).not.toHaveBeenCalled();
  });
});
