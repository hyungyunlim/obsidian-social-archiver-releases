/**
 * LargeMediaGuardService Tests
 *
 * Covers:
 *   - inspectTopLevelMedia: size detection via HEAD + Range fallback, fail-open
 *     on unknown size, non-video skipping, empty input, probe timeout.
 *   - promptIfNeeded: no-prompt short-circuits, modal decision mapping, ESC /
 *     backdrop dismissal POST-FIX behavior (returns 'download', suppression off).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LargeMediaGuardService } from '../LargeMediaGuardService';
import type { OversizedMediaInfo } from '../LargeMediaGuardService';
import type { Media, PostData } from '@/types/post';
import type { SocialArchiverSettings } from '@/types/settings';
// Test-only mock hooks exposed by test/mocks/obsidian.ts. Not present in real
// Obsidian typings, so we cast through `unknown`.
import * as ObsidianMock from 'obsidian';

type RequestUrlParam = { url: string; method?: string; headers?: Record<string, string>; body?: string; throw?: boolean };
type RequestUrlResponse = {
  status: number;
  headers: Record<string, string>;
  text: string;
  json: unknown;
  arrayBuffer: ArrayBuffer;
};

const { __setRequestUrlHandler } = ObsidianMock as unknown as {
  __setRequestUrlHandler: (h: ((p: RequestUrlParam) => Promise<RequestUrlResponse>) | null) => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ProbeResponse = {
  status?: number;
  headers?: Record<string, string>;
};

/** Build a minimal PostData that satisfies the subset used by promptIfNeeded. */
function makePostData(overrides: Partial<PostData> = {}): PostData {
  return {
    platform: 'x',
    id: 'test-1',
    url: 'https://twitter.com/test/status/1',
    author: { name: 'Test', url: 'https://twitter.com/test' },
    content: { text: '', html: '', hashtags: [] },
    media: [],
    metadata: { timestamp: new Date('2026-01-01T00:00:00Z') },
    linkPreviews: [],
    ...overrides,
  } as PostData;
}

function makeSettings(
  overrides: Partial<SocialArchiverSettings> = {}
): SocialArchiverSettings {
  return {
    largeVideoPromptThresholdMB: 100,
    ...overrides,
  } as unknown as SocialArchiverSettings;
}

function buildResponse(probe: ProbeResponse): RequestUrlResponse {
  return {
    status: probe.status ?? 200,
    headers: probe.headers ?? {},
    text: '',
    json: null,
    arrayBuffer: new ArrayBuffer(0),
  };
}

/**
 * Register a requestUrl handler that looks up responses by URL + HTTP method.
 *
 * Falls back to `throw: true` → rejected promise (simulates network failure).
 */
function installUrlHandler(
  responses: Record<string, { HEAD?: ProbeResponse | 'fail'; RANGE?: ProbeResponse | 'fail' }>
): void {
  __setRequestUrlHandler(async (params: RequestUrlParam) => {
    const key = params.url;
    const method = (params.method ?? 'GET').toUpperCase();
    const bucket = responses[key];
    if (!bucket) {
      throw new Error(`unexpected URL in test: ${params.url}`);
    }
    const rule = method === 'HEAD' ? bucket.HEAD : bucket.RANGE;
    if (!rule) {
      throw new Error(`no ${method} rule for ${params.url}`);
    }
    if (rule === 'fail') {
      throw new Error('network failure');
    }
    return buildResponse(rule);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LargeMediaGuardService', () => {
  afterEach(() => {
    __setRequestUrlHandler(null);
    vi.restoreAllMocks();
  });

  describe('inspectTopLevelMedia', () => {
    it('returns empty when media array is empty', async () => {
      const service = new LargeMediaGuardService({} as unknown as never, makeSettings());
      const result = await service.inspectTopLevelMedia([], 100);
      expect(result.oversizedVideoUrls).toEqual([]);
      expect(result.estimatedBytesByUrl.size).toBe(0);
    });

    it('returns empty when threshold <= 0 (feature disabled)', async () => {
      installUrlHandler({
        'https://cdn.example.com/big.mp4': {
          HEAD: { headers: { 'content-length': String(1024 * 1024 * 500) } },
        },
      });
      const service = new LargeMediaGuardService({} as unknown as never, makeSettings());
      const result = await service.inspectTopLevelMedia(
        [{ type: 'video', url: 'https://cdn.example.com/big.mp4' }],
        0
      );
      expect(result.oversizedVideoUrls).toEqual([]);
    });

    it('flags oversized via Content-Length from HEAD', async () => {
      const FIVE_HUNDRED_MB = 500 * 1024 * 1024;
      installUrlHandler({
        'https://cdn.example.com/big.mp4': {
          HEAD: { headers: { 'content-length': String(FIVE_HUNDRED_MB) } },
        },
      });
      const service = new LargeMediaGuardService({} as unknown as never, makeSettings());
      const result = await service.inspectTopLevelMedia(
        [{ type: 'video', url: 'https://cdn.example.com/big.mp4' }],
        100
      );
      expect(result.oversizedVideoUrls).toEqual(['https://cdn.example.com/big.mp4']);
      expect(result.estimatedBytesByUrl.get('https://cdn.example.com/big.mp4')).toBe(
        FIVE_HUNDRED_MB
      );
    });

    it('does not flag when Content-Length is below threshold', async () => {
      const TEN_MB = 10 * 1024 * 1024;
      installUrlHandler({
        'https://cdn.example.com/small.mp4': {
          HEAD: { headers: { 'content-length': String(TEN_MB) } },
        },
      });
      const service = new LargeMediaGuardService({} as unknown as never, makeSettings());
      const result = await service.inspectTopLevelMedia(
        [{ type: 'video', url: 'https://cdn.example.com/small.mp4' }],
        100
      );
      expect(result.oversizedVideoUrls).toEqual([]);
      expect(result.estimatedBytesByUrl.get('https://cdn.example.com/small.mp4')).toBe(TEN_MB);
    });

    it('falls back to Range GET when HEAD lacks Content-Length', async () => {
      installUrlHandler({
        'https://cdn.example.com/range.mp4': {
          // HEAD response has no content-length header
          HEAD: { headers: {} },
          RANGE: {
            status: 206,
            headers: { 'content-range': 'bytes 0-0/12345678' },
          },
        },
      });
      const service = new LargeMediaGuardService({} as unknown as never, makeSettings({ largeVideoPromptThresholdMB: 1 }));
      const result = await service.inspectTopLevelMedia(
        [{ type: 'video', url: 'https://cdn.example.com/range.mp4' }],
        1
      );
      expect(result.estimatedBytesByUrl.get('https://cdn.example.com/range.mp4')).toBe(12345678);
      expect(result.oversizedVideoUrls).toEqual(['https://cdn.example.com/range.mp4']);
    });

    it('fails open when both HEAD and Range fail (URL absent from oversized list)', async () => {
      installUrlHandler({
        'https://cdn.example.com/unknown.mp4': {
          HEAD: 'fail',
          RANGE: 'fail',
        },
      });
      const service = new LargeMediaGuardService({} as unknown as never, makeSettings());
      const result = await service.inspectTopLevelMedia(
        [{ type: 'video', url: 'https://cdn.example.com/unknown.mp4' }],
        100
      );
      expect(result.oversizedVideoUrls).toEqual([]);
      expect(result.estimatedBytesByUrl.has('https://cdn.example.com/unknown.mp4')).toBe(false);
    });

    it('skips non-video media (image / audio / document)', async () => {
      // No HEAD handler registered — if a probe is attempted it will throw,
      // but the service should skip non-video media entirely.
      __setRequestUrlHandler(async (params) => {
        throw new Error(`non-video probe attempted: ${params.url}`);
      });
      const service = new LargeMediaGuardService({} as unknown as never, makeSettings());
      const media: Media[] = [
        { type: 'image', url: 'https://cdn.example.com/pic.jpg' },
        { type: 'audio', url: 'https://cdn.example.com/song.mp3' },
        { type: 'document', url: 'https://cdn.example.com/doc.pdf' },
      ];
      const result = await service.inspectTopLevelMedia(media, 100);
      expect(result.oversizedVideoUrls).toEqual([]);
      expect(result.estimatedBytesByUrl.size).toBe(0);
    });

    it('returns only the oversized videos when multiple videos are present', async () => {
      const OVER = 500 * 1024 * 1024;
      const UNDER = 10 * 1024 * 1024;
      installUrlHandler({
        'https://cdn.example.com/over.mp4': {
          HEAD: { headers: { 'content-length': String(OVER) } },
        },
        'https://cdn.example.com/under.mp4': {
          HEAD: { headers: { 'content-length': String(UNDER) } },
        },
      });
      const service = new LargeMediaGuardService({} as unknown as never, makeSettings());
      const result = await service.inspectTopLevelMedia(
        [
          { type: 'video', url: 'https://cdn.example.com/under.mp4' },
          { type: 'video', url: 'https://cdn.example.com/over.mp4' },
        ],
        100
      );
      expect(result.oversizedVideoUrls).toEqual(['https://cdn.example.com/over.mp4']);
      expect(result.estimatedBytesByUrl.get('https://cdn.example.com/under.mp4')).toBe(UNDER);
      expect(result.estimatedBytesByUrl.get('https://cdn.example.com/over.mp4')).toBe(OVER);
    });

    it('reads Content-Length case-insensitively', async () => {
      const OVER = 500 * 1024 * 1024;
      installUrlHandler({
        'https://cdn.example.com/case.mp4': {
          HEAD: { headers: { 'Content-Length': String(OVER) } },
        },
      });
      const service = new LargeMediaGuardService({} as unknown as never, makeSettings());
      const result = await service.inspectTopLevelMedia(
        [{ type: 'video', url: 'https://cdn.example.com/case.mp4' }],
        100
      );
      expect(result.oversizedVideoUrls).toEqual(['https://cdn.example.com/case.mp4']);
    });

    it('times out a stuck request and treats the URL as unknown (not in oversized list)', async () => {
      // requestUrl that never resolves — simulates a probe that hangs beyond
      // the service's 8s internal timer. We advance fake timers to trip it.
      vi.useFakeTimers();
      let headHang: (() => void) | null = null;
      __setRequestUrlHandler(
        () =>
          new Promise<RequestUrlResponse>(() => {
            // Never resolves — promise is intentionally dangling.
            headHang = () => {};
          })
      );
      const service = new LargeMediaGuardService({} as unknown as never, makeSettings());
      const inspection = service.inspectTopLevelMedia(
        [{ type: 'video', url: 'https://cdn.example.com/hang.mp4' }],
        100
      );
      // Advance past the 8s HEAD timeout AND the 8s Range fallback timeout.
      await vi.advanceTimersByTimeAsync(20_000);
      const result = await inspection;
      expect(result.oversizedVideoUrls).toEqual([]);
      expect(result.estimatedBytesByUrl.has('https://cdn.example.com/hang.mp4')).toBe(false);
      // Prevent "unused variable" — headHang retained to keep the promise alive.
      void headHang;
      vi.useRealTimers();
    });

    it('ignores non-http(s) URLs (e.g. local / data URLs)', async () => {
      __setRequestUrlHandler(async (params) => {
        throw new Error(`should not probe: ${params.url}`);
      });
      const service = new LargeMediaGuardService({} as unknown as never, makeSettings());
      const media: Media[] = [
        { type: 'video', url: 'attachments/social-archives/local.mp4' },
        { type: 'video', url: 'data:video/mp4;base64,AAAA' },
      ];
      const result = await service.inspectTopLevelMedia(media, 100);
      expect(result.oversizedVideoUrls).toEqual([]);
    });
  });

  describe('promptIfNeeded', () => {
    it('returns null when no oversized URLs were detected', async () => {
      const service = new LargeMediaGuardService({} as unknown as never, makeSettings());
      const info: OversizedMediaInfo = {
        oversizedVideoUrls: [],
        estimatedBytesByUrl: new Map(),
      };
      const result = await service.promptIfNeeded(info, makePostData());
      expect(result).toBeNull();
    });

    it('returns null when mediaPromptSuppressed === true', async () => {
      const service = new LargeMediaGuardService({} as unknown as never, makeSettings());
      const info: OversizedMediaInfo = {
        oversizedVideoUrls: ['https://cdn.example.com/big.mp4'],
        estimatedBytesByUrl: new Map([['https://cdn.example.com/big.mp4', 500 * 1024 * 1024]]),
      };
      const post = makePostData({ mediaPromptSuppressed: true });
      const result = await service.promptIfNeeded(info, post);
      expect(result).toBeNull();
    });

    it("resolves with 'download' when the download button is clicked", async () => {
      const service = new LargeMediaGuardService({} as unknown as never, makeSettings());
      const info: OversizedMediaInfo = {
        oversizedVideoUrls: ['https://cdn.example.com/big.mp4'],
        estimatedBytesByUrl: new Map([['https://cdn.example.com/big.mp4', 500 * 1024 * 1024]]),
      };
      const promise = service.promptIfNeeded(info, makePostData());
      await flushMicrotasks();
      clickButton('Download local media');
      const decision = await promise;
      expect(decision).toEqual({ action: 'download', suppressPromptForArchive: false });
    });

    it("resolves with 'detach' when the 'Keep note only' button is clicked", async () => {
      const service = new LargeMediaGuardService({} as unknown as never, makeSettings());
      const info: OversizedMediaInfo = {
        oversizedVideoUrls: ['https://cdn.example.com/big.mp4'],
        estimatedBytesByUrl: new Map([['https://cdn.example.com/big.mp4', 500 * 1024 * 1024]]),
      };
      const promise = service.promptIfNeeded(info, makePostData());
      await flushMicrotasks();
      clickButton('Keep note only');
      const decision = await promise;
      expect(decision).toEqual({ action: 'detach', suppressPromptForArchive: false });
    });

    it("propagates 'Don't ask again' checkbox state (suppress=true) on download", async () => {
      const service = new LargeMediaGuardService({} as unknown as never, makeSettings());
      const info: OversizedMediaInfo = {
        oversizedVideoUrls: ['https://cdn.example.com/big.mp4'],
        estimatedBytesByUrl: new Map([['https://cdn.example.com/big.mp4', 500 * 1024 * 1024]]),
      };
      const promise = service.promptIfNeeded(info, makePostData());
      await flushMicrotasks();
      toggleDontAskAgain();
      clickButton('Download local media');
      const decision = await promise;
      expect(decision).toEqual({ action: 'download', suppressPromptForArchive: true });
    });

    /**
     * POST-FIX behavior: dismissing the modal (ESC / backdrop click) after the
     * user explicitly started an archive should default to 'download', not
     * silently discard local media. suppressPromptForArchive stays false.
     *
     * This is the expected behavior once the sibling fix agent ships — the
     * current code resolves to 'detach' on dismissal which is considered a bug.
     */
    it("resolves with 'download' (non-suppressed) when the modal is dismissed without a choice", async () => {
      const service = new LargeMediaGuardService({} as unknown as never, makeSettings());
      const info: OversizedMediaInfo = {
        oversizedVideoUrls: ['https://cdn.example.com/big.mp4'],
        estimatedBytesByUrl: new Map([['https://cdn.example.com/big.mp4', 500 * 1024 * 1024]]),
      };
      const promise = service.promptIfNeeded(info, makePostData());
      await flushMicrotasks();
      // Dismiss by directly calling close() — simulates Escape / backdrop close.
      dismissModal();
      const decision = await promise;
      expect(decision).toEqual({ action: 'download', suppressPromptForArchive: false });
    });
  });
});

// ---------------------------------------------------------------------------
// Modal interaction helpers
// ---------------------------------------------------------------------------

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  // Second flush for any nested resolves inside the modal open path.
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}

function findAllButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
}

function clickButton(label: string): void {
  const target = findAllButtons().find((btn) => btn.textContent?.trim() === label);
  if (!target) {
    throw new Error(
      `Could not find button labelled "${label}". Available: ${findAllButtons()
        .map((b) => b.textContent?.trim())
        .join(', ')}`
    );
  }
  target.click();
}

function toggleDontAskAgain(): void {
  const checkbox = document.querySelector<HTMLInputElement>('#sa-large-video-dont-ask-again');
  if (!checkbox) throw new Error('Don\'t-ask-again checkbox not found');
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event('change'));
}

/**
 * Simulate ESC / backdrop dismissal by closing the most-recently-opened modal
 * without clicking a button. In Obsidian, ESC / backdrop triggers Modal.close()
 * which invokes onClose() — the same path we exercise here.
 */
function dismissModal(): void {
  const lastModal = (globalThis as unknown as { __lastOpenedModal?: { close: () => void } })
    .__lastOpenedModal;
  if (!lastModal) {
    throw new Error('No modal instance captured — modal did not open?');
  }
  lastModal.close();
}

// ---------------------------------------------------------------------------
// Modal instance capture
// ---------------------------------------------------------------------------

/**
 * Wrap the mocked Modal so we can reach the live instance from test helpers.
 * This runs once per file and cooperates with the obsidian mock's Modal class.
 */
beforeEach(async () => {
  const obsidian = await import('obsidian');
  const BaseModal = (obsidian as unknown as { Modal: typeof import('obsidian').Modal }).Modal;

  type InstrumentedCtor = typeof BaseModal & { __instrumented?: boolean };
  const BM = BaseModal as InstrumentedCtor;
  if (BM.__instrumented) return;

  const originalOpen = BaseModal.prototype.open;

  BaseModal.prototype.open = function patchedOpen(this: InstanceType<typeof BaseModal>) {
    (globalThis as unknown as { __lastOpenedModal?: unknown }).__lastOpenedModal = this;
    originalOpen.call(this);
  };

  BM.__instrumented = true;

  // Reset captured instance and any prior modal DOM between tests.
  (globalThis as unknown as { __lastOpenedModal?: unknown }).__lastOpenedModal = undefined;
  document.body.innerHTML = '';
});
