/**
 * BulkArchiveActionAccumulator -- Unit Tests
 *
 * Tests the batched outbound sync accumulator:
 * - Single item flushes via single-item endpoint
 * - Multiple items flush via bulk endpoint
 * - archiveId-based merge (last-write-wins per field)
 * - isLiked + isBookmarked merge into single action
 * - Debounce resets on each enqueue
 * - destroy() flushes remaining items
 * - Flush errors are caught and logged
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BulkArchiveActionAccumulator } from '../../plugin/sync/BulkArchiveActionAccumulator';

// ─── Mock API Client ───────────────────────────────────────

function makeApiClient() {
  return {
    updateArchiveActions: vi.fn().mockResolvedValue({ success: true }),
    bulkUpdateArchiveActions: vi.fn().mockResolvedValue({
      updatedIds: [],
      failed: [],
    }),
  };
}

// ─── Tests ─────────────────────────────────────────────────

describe('BulkArchiveActionAccumulator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes single item via updateArchiveActions', async () => {
    const apiClient = makeApiClient();
    const accumulator = new BulkArchiveActionAccumulator(apiClient as any);

    accumulator.enqueue({ archiveId: 'a1', isLiked: true });

    // Advance past the 3s debounce
    await vi.advanceTimersByTimeAsync(3500);

    expect(apiClient.updateArchiveActions).toHaveBeenCalledOnce();
    expect(apiClient.updateArchiveActions).toHaveBeenCalledWith('a1', { isLiked: true });
    expect(apiClient.bulkUpdateArchiveActions).not.toHaveBeenCalled();

    accumulator.destroy();
  });

  it('flushes multiple items via bulkUpdateArchiveActions', async () => {
    const apiClient = makeApiClient();
    apiClient.bulkUpdateArchiveActions.mockResolvedValue({
      updatedIds: ['a1', 'a2'],
      failed: [],
    });

    const accumulator = new BulkArchiveActionAccumulator(apiClient as any);

    accumulator.enqueue({ archiveId: 'a1', isLiked: true });
    accumulator.enqueue({ archiveId: 'a2', isBookmarked: false });

    await vi.advanceTimersByTimeAsync(3500);

    expect(apiClient.bulkUpdateArchiveActions).toHaveBeenCalledOnce();
    expect(apiClient.bulkUpdateArchiveActions).toHaveBeenCalledWith([
      { archiveId: 'a1', isLiked: true },
      { archiveId: 'a2', isBookmarked: false },
    ]);
    expect(apiClient.updateArchiveActions).not.toHaveBeenCalled();

    accumulator.destroy();
  });

  it('merges actions for the same archiveId (last-write-wins)', async () => {
    const apiClient = makeApiClient();
    const accumulator = new BulkArchiveActionAccumulator(apiClient as any);

    accumulator.enqueue({ archiveId: 'a1', isLiked: true });
    accumulator.enqueue({ archiveId: 'a1', isLiked: false });

    await vi.advanceTimersByTimeAsync(3500);

    expect(apiClient.updateArchiveActions).toHaveBeenCalledOnce();
    expect(apiClient.updateArchiveActions).toHaveBeenCalledWith('a1', { isLiked: false });

    accumulator.destroy();
  });

  it('merges isLiked and isBookmarked for the same archiveId', async () => {
    const apiClient = makeApiClient();
    const accumulator = new BulkArchiveActionAccumulator(apiClient as any);

    accumulator.enqueue({ archiveId: 'a1', isLiked: true });
    accumulator.enqueue({ archiveId: 'a1', isBookmarked: true });

    await vi.advanceTimersByTimeAsync(3500);

    expect(apiClient.updateArchiveActions).toHaveBeenCalledOnce();
    expect(apiClient.updateArchiveActions).toHaveBeenCalledWith('a1', {
      isLiked: true,
      isBookmarked: true,
    });

    accumulator.destroy();
  });

  it('resets debounce timer on each enqueue', async () => {
    const apiClient = makeApiClient();
    const accumulator = new BulkArchiveActionAccumulator(apiClient as any);

    accumulator.enqueue({ archiveId: 'a1', isLiked: true });

    // Advance 2 seconds (not yet flushed)
    await vi.advanceTimersByTimeAsync(2000);
    expect(apiClient.updateArchiveActions).not.toHaveBeenCalled();

    // Enqueue another item (resets timer)
    accumulator.enqueue({ archiveId: 'a2', isBookmarked: false });

    // Advance another 2 seconds (still not flushed, debounce was reset)
    await vi.advanceTimersByTimeAsync(2000);
    expect(apiClient.updateArchiveActions).not.toHaveBeenCalled();
    expect(apiClient.bulkUpdateArchiveActions).not.toHaveBeenCalled();

    // Advance 1 more second (total 3s since last enqueue)
    await vi.advanceTimersByTimeAsync(1500);
    expect(apiClient.bulkUpdateArchiveActions).toHaveBeenCalledOnce();

    accumulator.destroy();
  });

  it('destroy() flushes remaining items', async () => {
    const apiClient = makeApiClient();
    const accumulator = new BulkArchiveActionAccumulator(apiClient as any);

    accumulator.enqueue({ archiveId: 'a1', isLiked: true });
    accumulator.enqueue({ archiveId: 'a2', isBookmarked: true });

    // Destroy before the debounce fires
    accumulator.destroy();

    // The flush is fire-and-forget but the API should have been called
    // Need to let the microtask queue run
    await vi.advanceTimersByTimeAsync(0);

    expect(apiClient.bulkUpdateArchiveActions).toHaveBeenCalledOnce();
  });

  it('destroy() with empty pending does not call API', () => {
    const apiClient = makeApiClient();
    const accumulator = new BulkArchiveActionAccumulator(apiClient as any);

    accumulator.destroy();

    expect(apiClient.updateArchiveActions).not.toHaveBeenCalled();
    expect(apiClient.bulkUpdateArchiveActions).not.toHaveBeenCalled();
  });

  it('handles flush errors without throwing', async () => {
    const apiClient = makeApiClient();
    apiClient.updateArchiveActions.mockRejectedValue(new Error('Network error'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const accumulator = new BulkArchiveActionAccumulator(apiClient as any);

    accumulator.enqueue({ archiveId: 'a1', isLiked: true });

    // Should not throw
    await vi.advanceTimersByTimeAsync(3500);

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();

    accumulator.destroy();
  });

  it('does not flush when no items are pending after timer fires', async () => {
    const apiClient = makeApiClient();
    const accumulator = new BulkArchiveActionAccumulator(apiClient as any);

    accumulator.enqueue({ archiveId: 'a1', isLiked: true });

    // Advance to flush
    await vi.advanceTimersByTimeAsync(3500);
    expect(apiClient.updateArchiveActions).toHaveBeenCalledOnce();

    // No further calls after second timer period
    await vi.advanceTimersByTimeAsync(3500);
    expect(apiClient.updateArchiveActions).toHaveBeenCalledOnce();

    accumulator.destroy();
  });

  it('handles mixed merge: 3 archives, 2 with same id', async () => {
    const apiClient = makeApiClient();
    apiClient.bulkUpdateArchiveActions.mockResolvedValue({
      updatedIds: ['a1', 'a2'],
      failed: [],
    });

    const accumulator = new BulkArchiveActionAccumulator(apiClient as any);

    accumulator.enqueue({ archiveId: 'a1', isLiked: true });
    accumulator.enqueue({ archiveId: 'a2', isBookmarked: true });
    accumulator.enqueue({ archiveId: 'a1', isBookmarked: false }); // merge with a1

    await vi.advanceTimersByTimeAsync(3500);

    expect(apiClient.bulkUpdateArchiveActions).toHaveBeenCalledOnce();
    const callArgs = apiClient.bulkUpdateArchiveActions.mock.calls[0]![0] as Array<{
      archiveId: string;
      isLiked?: boolean;
      isBookmarked?: boolean;
    }>;
    expect(callArgs).toHaveLength(2);

    const a1Action = callArgs.find((a) => a.archiveId === 'a1');
    expect(a1Action).toEqual({ archiveId: 'a1', isLiked: true, isBookmarked: false });

    const a2Action = callArgs.find((a) => a.archiveId === 'a2');
    expect(a2Action).toEqual({ archiveId: 'a2', isBookmarked: true });

    accumulator.destroy();
  });
});
