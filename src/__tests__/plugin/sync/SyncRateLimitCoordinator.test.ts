import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SyncRateLimitCoordinator,
  isRateLimitError,
  getRetryAfterMs,
  DEFAULT_RATE_LIMIT_RETRY_MS,
} from '@/plugin/sync/SyncRateLimitCoordinator';

function makeRateLimitError(retryAfterSeconds?: number): Error {
  const error = new Error('Too many requests') as Error & {
    status: number;
    code: string;
    details?: unknown;
  };
  error.status = 429;
  error.code = 'RATE_LIMIT_EXCEEDED';
  if (retryAfterSeconds !== undefined) {
    error.details = { retryAfter: retryAfterSeconds };
  }
  return error;
}

describe('isRateLimitError', () => {
  it('detects HTTP 429 status', () => {
    const error = new Error('boom') as Error & { status: number };
    error.status = 429;
    expect(isRateLimitError(error)).toBe(true);
  });

  it('detects RATE_LIMIT_EXCEEDED code without status', () => {
    const error = new Error('boom') as Error & { code: string };
    error.code = 'RATE_LIMIT_EXCEEDED';
    expect(isRateLimitError(error)).toBe(true);
  });

  it('rejects other errors and non-errors', () => {
    const notFound = new Error('nope') as Error & { status: number };
    notFound.status = 404;
    expect(isRateLimitError(notFound)).toBe(false);
    expect(isRateLimitError(new Error('plain'))).toBe(false);
    expect(isRateLimitError('429')).toBe(false);
    expect(isRateLimitError(undefined)).toBe(false);
  });
});

describe('getRetryAfterMs', () => {
  it('reads details.retryAfter seconds from the Workers error body', () => {
    expect(getRetryAfterMs(makeRateLimitError(60))).toBe(60_000);
    expect(getRetryAfterMs(makeRateLimitError(2))).toBe(2_000);
  });

  it('falls back when retryAfter is absent or invalid', () => {
    expect(getRetryAfterMs(makeRateLimitError())).toBe(DEFAULT_RATE_LIMIT_RETRY_MS);
    expect(getRetryAfterMs(new Error('no details'), 5_000)).toBe(5_000);
    const bogus = makeRateLimitError();
    (bogus as Error & { details: unknown }).details = { retryAfter: -3 };
    expect(getRetryAfterMs(bogus, 5_000)).toBe(5_000);
  });

  it('clamps oversized Retry-After values to 5 minutes', () => {
    expect(getRetryAfterMs(makeRateLimitError(86_400))).toBe(5 * 60_000);
  });
});

describe('SyncRateLimitCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('grants tokens immediately while under the window budget', async () => {
    const coordinator = new SyncRateLimitCoordinator({ maxRequestsPerWindow: 3, windowMs: 60_000 });

    await expect(coordinator.acquire()).resolves.toBeUndefined();
    await expect(coordinator.acquire()).resolves.toBeUndefined();
    await expect(coordinator.acquire()).resolves.toBeUndefined();
  });

  it('queues the acquire that exceeds the budget until the window slides', async () => {
    const coordinator = new SyncRateLimitCoordinator({ maxRequestsPerWindow: 2, windowMs: 60_000 });

    await coordinator.acquire();
    await coordinator.acquire();

    let granted = false;
    const third = coordinator.acquire().then(() => {
      granted = true;
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(granted).toBe(false);

    // Oldest grant leaves the window at t=60s.
    await vi.advanceTimersByTimeAsync(31_000);
    await third;
    expect(granted).toBe(true);
  });

  it('holds every acquire during a reported 429 cooldown', async () => {
    const coordinator = new SyncRateLimitCoordinator({ maxRequestsPerWindow: 10, windowMs: 60_000 });

    coordinator.reportRateLimited(makeRateLimitError(30));
    expect(coordinator.cooldownRemainingMs).toBe(30_000);

    let granted = false;
    const pending = coordinator.acquire().then(() => {
      granted = true;
    });

    await vi.advanceTimersByTimeAsync(15_000);
    expect(granted).toBe(false);

    await vi.advanceTimersByTimeAsync(16_000);
    await pending;
    expect(granted).toBe(true);
  });

  it('does not shorten an existing longer cooldown', () => {
    const coordinator = new SyncRateLimitCoordinator();
    coordinator.reportRateLimited(makeRateLimitError(120));
    coordinator.reportRateLimited(makeRateLimitError(1));
    expect(coordinator.cooldownRemainingMs).toBe(120_000);
  });

  it('rejects with AbortError when the signal aborts and keeps serving later acquires', async () => {
    const coordinator = new SyncRateLimitCoordinator({ maxRequestsPerWindow: 1, windowMs: 60_000 });
    await coordinator.acquire();

    const controller = new AbortController();
    const aborted = coordinator.acquire(controller.signal);
    const abortedAssertion = expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await abortedAssertion;

    let granted = false;
    const next = coordinator.acquire().then(() => {
      granted = true;
    });
    await vi.advanceTimersByTimeAsync(61_000);
    await next;
    expect(granted).toBe(true);
  });

  it('serves waiters in FIFO order', async () => {
    const coordinator = new SyncRateLimitCoordinator({ maxRequestsPerWindow: 1, windowMs: 1_000 });
    const order: number[] = [];

    await coordinator.acquire();
    const first = coordinator.acquire().then(() => order.push(1));
    const second = coordinator.acquire().then(() => order.push(2));

    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
  });
});
