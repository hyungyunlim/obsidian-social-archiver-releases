/**
 * Unit tests for MediaPreviewService — bounded LRU + reference counting +
 * exactly-once revocation.
 *
 * jsdom does not implement URL.createObjectURL / revokeObjectURL, so we
 * install our own fakes that also back a fake fetch — letting us prove
 * "the URL resolves to the right blob" end-to-end without a real browser.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { MediaPreviewService } from '@/services/import-gallery/MediaPreviewService';

// ---------------------------------------------------------------------------
// Test harness: fake URL.createObjectURL / revokeObjectURL + fake fetch
// ---------------------------------------------------------------------------

let urlCounter = 0;
let urlToBlob: Map<string, Blob>;
let createSpy: Mock<[blob: Blob], string>;
let revokeSpy: Mock<[url: string], void>;
let fetchSpy: Mock<[input: RequestInfo | URL], Promise<Response>>;

function installUrlFakes(): void {
  urlCounter = 0;
  urlToBlob = new Map();

  createSpy = vi.fn((blob: Blob) => {
    const url = `blob:test://${++urlCounter}`;
    urlToBlob.set(url, blob);
    return url;
  });
  revokeSpy = vi.fn((url: string) => {
    urlToBlob.delete(url);
  });
  fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const blob = urlToBlob.get(url);
    if (!blob) {
      throw new Error(`fake fetch: unknown URL ${url}`);
    }
    // We cannot use the global Response constructor because jsdom's Blob
    // implementation lacks `arrayBuffer()` / `text()` and Response wrapping
    // mangles Blob payloads. Instead we expose a minimal Response-like
    // object whose `blob()` returns the exact Blob instance the URL was
    // created from — which is what callers actually need to render media.
    return {
      ok: true,
      status: 200,
      blob: async () => blob,
    } as unknown as Response;
  });

  // Cast to any so we can monkey-patch read-only globals in the test env.
  (global.URL as unknown as { createObjectURL: typeof createSpy }).createObjectURL = createSpy;
  (global.URL as unknown as { revokeObjectURL: typeof revokeSpy }).revokeObjectURL = revokeSpy;
  (global as unknown as { fetch: typeof fetchSpy }).fetch = fetchSpy;
}

function makeBlob(text: string): Blob {
  return new Blob([text], { type: 'text/plain' });
}

describe('MediaPreviewService', () => {
  beforeEach(() => {
    installUrlFakes();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // acquire — basic behavior
  // -------------------------------------------------------------------------

  it('acquire returns a blob: URL that resolves to the supplied blob', async () => {
    const svc = new MediaPreviewService({ capacity: 10 });
    const blob = makeBlob('hello-world');

    const url = await svc.acquire('job1', 'zipA', 'media/a.jpg', blob);

    expect(url).toMatch(/^blob:/);
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith(blob);

    // Fetch the URL and verify it resolves back to the exact blob the
    // caller handed in. (Identity check is the strongest assertion we can
    // make in jsdom, where Blob lacks `text()` / `arrayBuffer()`.)
    const res = await fetch(url);
    const fetched = await res.blob();
    expect(fetched).toBe(blob);
  });

  it('acquire on the same key reuses the URL and increments retain count', async () => {
    const svc = new MediaPreviewService({ capacity: 10 });
    const blob = makeBlob('a');

    const url1 = await svc.acquire('job1', 'zipA', 'a.jpg', blob);
    const url2 = await svc.acquire('job1', 'zipA', 'a.jpg', blob);
    const url3 = await svc.acquire('job1', 'zipA', 'a.jpg', blob);

    expect(url1).toBe(url2);
    expect(url2).toBe(url3);
    expect(createSpy).toHaveBeenCalledTimes(1);

    const stats = svc.getStats();
    expect(stats.size).toBe(1);
    expect(stats.pinnedCount).toBe(1);
  });

  it('different jobIds for the same zipKey/path produce independent entries', async () => {
    const svc = new MediaPreviewService({ capacity: 10 });
    const blob = makeBlob('a');

    const u1 = await svc.acquire('jobA', 'zip', 'p.jpg', blob);
    const u2 = await svc.acquire('jobB', 'zip', 'p.jpg', blob);

    expect(u1).not.toBe(u2);
    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(svc.getStats().size).toBe(2);
  });

  // -------------------------------------------------------------------------
  // release — does not revoke, just decrements
  // -------------------------------------------------------------------------

  it('release decrements retain; entry stays in cache (eviction frees later)', async () => {
    const svc = new MediaPreviewService({ capacity: 10 });
    const blob = makeBlob('a');

    await svc.acquire('j1', 'zip', 'a.jpg', blob);
    await svc.acquire('j1', 'zip', 'a.jpg', blob);

    expect(svc.getStats().pinnedCount).toBe(1);

    svc.release('j1', 'zip', 'a.jpg');
    // Still pinned (1 retain left).
    expect(svc.getStats().pinnedCount).toBe(1);
    expect(revokeSpy).not.toHaveBeenCalled();

    svc.release('j1', 'zip', 'a.jpg');
    // Now retain is 0, but entry is still in the cache — only LRU eviction frees it.
    expect(svc.getStats().pinnedCount).toBe(0);
    expect(svc.getStats().size).toBe(1);
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it('release on an unknown key is a no-op', () => {
    const svc = new MediaPreviewService({ capacity: 10 });
    expect(() => svc.release('ghost', 'zip', 'nope.jpg')).not.toThrow();
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it('release below zero is a no-op (does not go negative)', async () => {
    const svc = new MediaPreviewService({ capacity: 10 });
    await svc.acquire('j1', 'zip', 'a.jpg', makeBlob('a'));
    svc.release('j1', 'zip', 'a.jpg');
    svc.release('j1', 'zip', 'a.jpg'); // extra release
    svc.release('j1', 'zip', 'a.jpg'); // extra release
    expect(svc.getStats().pinnedCount).toBe(0);
    expect(svc.getStats().size).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Eviction — capacity, LRU order, pin protection
  // -------------------------------------------------------------------------

  it('evicts the oldest unpinned entry when capacity is exceeded', async () => {
    const svc = new MediaPreviewService({ capacity: 2 });

    const url1 = await svc.acquire('j1', 'zip', 'old.jpg', makeBlob('old'));
    svc.release('j1', 'zip', 'old.jpg'); // unpinned, oldest

    const url2 = await svc.acquire('j1', 'zip', 'mid.jpg', makeBlob('mid'));
    svc.release('j1', 'zip', 'mid.jpg'); // unpinned

    expect(svc.getStats().size).toBe(2);
    expect(revokeSpy).not.toHaveBeenCalled();

    // Third acquire pushes us over capacity → oldest unpinned should evict.
    const url3 = await svc.acquire('j1', 'zip', 'new.jpg', makeBlob('new'));

    expect(svc.getStats().size).toBe(2);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith(url1);

    // Sanity: the evicted URL no longer resolves; the survivors do.
    await expect(fetch(url1)).rejects.toThrow();
    await expect(fetch(url2)).resolves.toBeDefined();
    await expect(fetch(url3)).resolves.toBeDefined();
  });

  it('skips pinned entries during eviction even if older', async () => {
    const svc = new MediaPreviewService({ capacity: 2 });

    // Pinned (never released) — oldest in access order.
    const pinnedUrl = await svc.acquire('j1', 'zip', 'pinned.jpg', makeBlob('pin'));

    // Unpinned middle.
    const midUrl = await svc.acquire('j1', 'zip', 'mid.jpg', makeBlob('mid'));
    svc.release('j1', 'zip', 'mid.jpg');

    // Trigger eviction.
    const newUrl = await svc.acquire('j1', 'zip', 'new.jpg', makeBlob('new'));

    expect(svc.getStats().size).toBe(2);
    // Pinned must NOT be evicted; mid (unpinned) is.
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith(midUrl);

    await expect(fetch(pinnedUrl)).resolves.toBeDefined();
    await expect(fetch(newUrl)).resolves.toBeDefined();
    await expect(fetch(midUrl)).rejects.toThrow();
  });

  it('grows past capacity if every entry is pinned (no eligible victim)', async () => {
    const svc = new MediaPreviewService({ capacity: 2 });
    await svc.acquire('j1', 'zip', 'a.jpg', makeBlob('a'));
    await svc.acquire('j1', 'zip', 'b.jpg', makeBlob('b'));
    await svc.acquire('j1', 'zip', 'c.jpg', makeBlob('c'));

    // All pinned → eviction sweep finds no candidates → cache grows.
    expect(svc.getStats().size).toBe(3);
    expect(svc.getStats().pinnedCount).toBe(3);
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it('lastAccessedAt updates on cache-hit acquire (LRU promotion)', async () => {
    const svc = new MediaPreviewService({ capacity: 2 });

    const aUrl = await svc.acquire('j1', 'zip', 'a.jpg', makeBlob('a'));
    svc.release('j1', 'zip', 'a.jpg');

    const bUrl = await svc.acquire('j1', 'zip', 'b.jpg', makeBlob('b'));
    svc.release('j1', 'zip', 'b.jpg');

    // Touch `a` again → `b` becomes the oldest unpinned entry.
    await svc.acquire('j1', 'zip', 'a.jpg', makeBlob('a'));
    svc.release('j1', 'zip', 'a.jpg');

    // Trigger eviction — `b` should be the victim, not `a`.
    await svc.acquire('j1', 'zip', 'c.jpg', makeBlob('c'));

    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith(bUrl);
    await expect(fetch(aUrl)).resolves.toBeDefined();
    await expect(fetch(bUrl)).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // clearForJob
  // -------------------------------------------------------------------------

  it('clearForJob revokes every URL belonging to the job exactly once', async () => {
    const svc = new MediaPreviewService({ capacity: 10 });

    const u1 = await svc.acquire('jobA', 'zip', 'a.jpg', makeBlob('a'));
    const u2 = await svc.acquire('jobA', 'zip', 'b.jpg', makeBlob('b'));
    const u3 = await svc.acquire('jobB', 'zip', 'c.jpg', makeBlob('c'));

    svc.clearForJob('jobA');

    expect(revokeSpy).toHaveBeenCalledTimes(2);
    const revokedUrls = revokeSpy.mock.calls.map((c) => c[0]);
    expect(revokedUrls).toContain(u1);
    expect(revokedUrls).toContain(u2);
    expect(revokedUrls).not.toContain(u3);

    // jobB entry survives untouched.
    expect(svc.getStats().size).toBe(1);
    await expect(fetch(u3)).resolves.toBeDefined();
    await expect(fetch(u1)).rejects.toThrow();
    await expect(fetch(u2)).rejects.toThrow();
  });

  it('clearForJob is a no-op for unknown jobIds', async () => {
    const svc = new MediaPreviewService({ capacity: 10 });
    await svc.acquire('jobA', 'zip', 'a.jpg', makeBlob('a'));
    svc.clearForJob('phantom');
    expect(revokeSpy).not.toHaveBeenCalled();
    expect(svc.getStats().size).toBe(1);
  });

  // -------------------------------------------------------------------------
  // revokeObjectURL exactly once per blob across full lifetime
  // -------------------------------------------------------------------------

  it('revokes each URL exactly once across acquire/release/eviction', async () => {
    const svc = new MediaPreviewService({ capacity: 1 });

    // Acquire + release entry A; eviction will run when B arrives.
    const aUrl = await svc.acquire('j1', 'zip', 'a.jpg', makeBlob('a'));
    svc.release('j1', 'zip', 'a.jpg');

    // Acquire B → triggers eviction of A.
    const bUrl = await svc.acquire('j1', 'zip', 'b.jpg', makeBlob('b'));
    svc.release('j1', 'zip', 'b.jpg');

    // Acquire C → triggers eviction of B.
    await svc.acquire('j1', 'zip', 'c.jpg', makeBlob('c'));

    expect(revokeSpy).toHaveBeenCalledTimes(2);

    const calls = revokeSpy.mock.calls.map((c) => c[0]);
    expect(calls.filter((u) => u === aUrl)).toHaveLength(1);
    expect(calls.filter((u) => u === bUrl)).toHaveLength(1);
  });

  it('clearForJob does not double-revoke entries already evicted by capacity', async () => {
    const svc = new MediaPreviewService({ capacity: 1 });

    const aUrl = await svc.acquire('j1', 'zip', 'a.jpg', makeBlob('a'));
    svc.release('j1', 'zip', 'a.jpg');

    // Forces eviction of A.
    await svc.acquire('j1', 'zip', 'b.jpg', makeBlob('b'));
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith(aUrl);

    // Clearing the job should only revoke surviving entries (B), not re-revoke A.
    revokeSpy.mockClear();
    svc.clearForJob('j1');
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy.mock.calls[0]?.[0]).not.toBe(aUrl);
  });

  // -------------------------------------------------------------------------
  // getStats
  // -------------------------------------------------------------------------

  it('getStats reports size, capacity, and pinned counts', async () => {
    const svc = new MediaPreviewService({ capacity: 4 });

    expect(svc.getStats()).toEqual({ size: 0, capacity: 4, pinnedCount: 0 });

    await svc.acquire('j1', 'zip', 'a.jpg', makeBlob('a'));
    await svc.acquire('j1', 'zip', 'b.jpg', makeBlob('b'));
    svc.release('j1', 'zip', 'a.jpg');

    expect(svc.getStats()).toEqual({ size: 2, capacity: 4, pinnedCount: 1 });
  });

  // -------------------------------------------------------------------------
  // Constructor validation
  // -------------------------------------------------------------------------

  it('throws on non-positive capacity', () => {
    expect(() => new MediaPreviewService({ capacity: 0 })).toThrow();
    expect(() => new MediaPreviewService({ capacity: -1 })).toThrow();
    expect(() => new MediaPreviewService({ capacity: Number.NaN })).toThrow();
    expect(() => new MediaPreviewService({ capacity: Number.POSITIVE_INFINITY })).toThrow();
  });

  it('uses the default capacity when none provided', () => {
    const svc = new MediaPreviewService();
    expect(svc.getStats().capacity).toBe(150);
  });
});
