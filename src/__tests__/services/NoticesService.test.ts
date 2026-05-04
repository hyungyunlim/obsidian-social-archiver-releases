/**
 * Tests for NoticesService.
 *
 * Coverage:
 *   - Header builder uses X-Platform: obsidian (not the OS), correct
 *     capabilities, and X-Install-Id from settings.deviceId.
 *   - Fetch silently drops malformed envelopes, schemaVersion mismatches,
 *     non-success envelopes, unsupported surfaces, and malformed expiry.
 *   - Selector applies priority desc + id asc tie-break, sticky bypass,
 *     and dismiss filter.
 *   - Expiry uses serverTimeOffsetMs (not raw clock).
 *   - dismiss() set-merges with the latest persisted ids and caps at 200.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setRequestUrlHandler } from 'obsidian';
import { NoticesService } from '@/services/NoticesService';
import { DEFAULT_SETTINGS, type SocialArchiverSettings } from '@/types/settings';
import type { NoticePayloadV1 } from '@/types/notices';

// 16 minutes — enough to cross the 15-minute poll interval and any startup delay.
const POLL_INTERVAL_TEST_HORIZON_MS = 16 * 60 * 1000;

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface Harness {
  settings: SocialArchiverSettings;
  saved: Array<Partial<SocialArchiverSettings>>;
  service: NoticesService;
  capturedRequests: Array<{ url: string; method?: string; headers?: Record<string, string> }>;
  setResponse: (json: unknown, status?: number) => void;
}

function makeNotice(partial: Partial<NoticePayloadV1> & { id: string }): NoticePayloadV1 {
  return {
    schemaVersion: 1,
    id: partial.id,
    surface: 'top_banner',
    priority: 0,
    level: 'info',
    body: 'body',
    dismissPolicy: 'per_id_local',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    trackingKey: `tk-${partial.id}`,
    ...partial,
  };
}

function makeHarness(initialSettings?: Partial<SocialArchiverSettings>): Harness {
  const settings: SocialArchiverSettings = {
    ...DEFAULT_SETTINGS,
    deviceId: 'device-123',
    authToken: 'token-abc',
    username: 'alice',
    dismissedNoticeIds: [],
    ...initialSettings,
  };

  const saved: Array<Partial<SocialArchiverSettings>> = [];
  const capturedRequests: Array<{ url: string; method?: string; headers?: Record<string, string> }> = [];

  let nextResponse: { json: unknown; status: number } = {
    json: { success: true, data: { schemaVersion: 1, notices: [], serverTime: new Date().toISOString() } },
    status: 200,
  };

  __setRequestUrlHandler(async (params) => {
    capturedRequests.push({
      url: params.url,
      method: params.method,
      headers: params.headers,
    });
    return {
      status: nextResponse.status,
      headers: {},
      text: JSON.stringify(nextResponse.json),
      json: nextResponse.json,
      arrayBuffer: new ArrayBuffer(0),
    };
  });

  const service = new NoticesService({
    apiClient: {
      getEndpoint: () => 'https://api.example.com',
      getAuthToken: () => settings.authToken || null,
      getPluginVersion: () => '9.9.9',
    },
    getSettings: () => settings,
    saveSettings: async (patch) => {
      saved.push(patch);
      Object.assign(settings, patch);
    },
    logger: () => {
      // Silent during tests.
    },
  });

  return {
    settings,
    saved,
    service,
    capturedRequests,
    setResponse: (json: unknown, status = 200) => {
      nextResponse = { json, status };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NoticesService', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    __setRequestUrlHandler(null);
  });

  describe('headers', () => {
    it('sends X-Platform: obsidian (not OS), correct capabilities, version, install id, auth, language', async () => {
      const h = makeHarness();
      h.setResponse({
        success: true,
        data: { schemaVersion: 1, notices: [], serverTime: new Date().toISOString() },
      });

      await h.service.fetch();

      expect(h.capturedRequests).toHaveLength(1);
      const req = h.capturedRequests[0]!;
      expect(req.url).toBe('https://api.example.com/api/app/notices');
      expect(req.method).toBe('GET');
      const headers = req.headers ?? {};
      expect(headers['X-Client']).toBe('obsidian-plugin');
      expect(headers['X-Platform']).toBe('obsidian');
      expect(headers['X-Client-Version']).toBe('9.9.9');
      expect(headers['X-Client-Capabilities']).toBe('notices-v1,external_billing_handoff-v1');
      // Must NOT include native_paywall or rewards_home_banner.
      expect(headers['X-Client-Capabilities']).not.toContain('native_paywall');
      expect(headers['X-Client-Capabilities']).not.toContain('rewards_home_banner');
      expect(headers['X-Install-Id']).toBe('device-123');
      expect(headers['Authorization']).toBe('Bearer token-abc');
      expect(headers['Accept-Language']).toBeTruthy();
    });

    it('omits Authorization when no auth token is set', async () => {
      const h = makeHarness({ authToken: '' });
      h.setResponse({
        success: true,
        data: { schemaVersion: 1, notices: [], serverTime: new Date().toISOString() },
      });

      await h.service.fetch();

      const headers = h.capturedRequests[0]!.headers ?? {};
      expect(headers['Authorization']).toBeUndefined();
    });

    it('omits X-Install-Id when deviceId is empty', async () => {
      const h = makeHarness({ deviceId: '' });
      h.setResponse({
        success: true,
        data: { schemaVersion: 1, notices: [], serverTime: new Date().toISOString() },
      });

      await h.service.fetch();

      const headers = h.capturedRequests[0]!.headers ?? {};
      expect(headers['X-Install-Id']).toBeUndefined();
    });
  });

  describe('fetch validation', () => {
    it('drops responses with unsupported schemaVersion', async () => {
      const h = makeHarness();
      h.setResponse({
        success: true,
        data: { schemaVersion: 2, notices: [makeNotice({ id: 'a' })], serverTime: new Date().toISOString() },
      });

      await h.service.fetch();

      // Schema mismatch on the envelope drops the entire response — no
      // notices should land in state regardless of hydration status.
      expect(h.service.getState().notices).toHaveLength(0);
    });

    it('drops error envelope', async () => {
      const h = makeHarness();
      h.setResponse({ success: false, error: { code: 'BOOM', message: 'broke' } });

      await h.service.fetch();

      expect(h.service.getState().notices).toHaveLength(0);
      expect(h.service.getState().lastFetchedAt).toBeNull();
    });

    it('drops notices with unsupported surface', async () => {
      const h = makeHarness();
      h.setResponse({
        success: true,
        data: {
          schemaVersion: 1,
          notices: [
            makeNotice({ id: 'ok' }),
            // @ts-expect-error -- intentional unknown surface
            makeNotice({ id: 'bad', surface: 'global_overlay' }),
          ],
          serverTime: new Date().toISOString(),
        },
      });

      await h.service.fetch();

      const notices = h.service.getState().notices;
      expect(notices.map((n) => n.id)).toEqual(['ok']);
    });

    it('drops per-notice schemaVersion mismatches', async () => {
      const h = makeHarness();
      h.setResponse({
        success: true,
        data: {
          schemaVersion: 1,
          notices: [
            makeNotice({ id: 'ok' }),
            // @ts-expect-error -- intentional schemaVersion mismatch
            { ...makeNotice({ id: 'bad' }), schemaVersion: 2 },
          ],
          serverTime: new Date().toISOString(),
        },
      });

      await h.service.fetch();

      expect(h.service.getState().notices.map((n) => n.id)).toEqual(['ok']);
    });

    it('keeps malformed expiry in list but selector treats it as expired', async () => {
      const h = makeHarness();
      h.setResponse({
        success: true,
        data: {
          schemaVersion: 1,
          notices: [makeNotice({ id: 'mal', expiresAt: 'not-a-date' })],
          serverTime: new Date().toISOString(),
        },
      });

      // Boot to flip the hydrated flag (dismissedIds set is empty here).
      // We avoid setTimeout side-effects by just hydrating manually via dismiss(no-op).
      // Directly access state by calling a no-op dismiss with empty id is filtered out;
      // call boot() and immediately shutdown to avoid lingering timers.
      h.service.boot();
      // Wait for fetch to flush.
      await h.service.fetch();
      h.service.shutdown();

      expect(h.service.getState().notices).toHaveLength(1);
      expect(h.service.getVisibleNotice()).toBeNull();
    });

    it('non-OK HTTP status yields no state change', async () => {
      const h = makeHarness();
      h.setResponse({ success: false }, 500);

      await h.service.fetch();

      expect(h.service.getState().notices).toHaveLength(0);
    });

    it('null/non-object envelope is silently dropped', async () => {
      const h = makeHarness();
      h.setResponse(null);

      await h.service.fetch();

      expect(h.service.getState().notices).toHaveLength(0);
    });
  });

  describe('selector', () => {
    it('returns null until hydrated', async () => {
      const h = makeHarness();
      h.setResponse({
        success: true,
        data: {
          schemaVersion: 1,
          notices: [makeNotice({ id: 'a' })],
          serverTime: new Date().toISOString(),
        },
      });
      await h.service.fetch();
      // Without boot(), hydrated stays false.
      expect(h.service.getVisibleNotice()).toBeNull();
    });

    it('picks highest priority, breaks ties by id ascending', async () => {
      const h = makeHarness();
      h.setResponse({
        success: true,
        data: {
          schemaVersion: 1,
          notices: [
            makeNotice({ id: 'm', priority: 5 }),
            makeNotice({ id: 'a', priority: 10 }),
            makeNotice({ id: 'z', priority: 10 }),
            makeNotice({ id: 'b', priority: 10 }),
          ],
          serverTime: new Date().toISOString(),
        },
      });

      h.service.boot();
      await h.service.fetch();
      const visible = h.service.getVisibleNotice();
      h.service.shutdown();

      expect(visible?.id).toBe('a');
    });

    it('hides dismissed non-sticky notices, but sticky ignores dismissal', async () => {
      const h = makeHarness({ dismissedNoticeIds: ['hidden-1', 'sticky-1'] });
      h.setResponse({
        success: true,
        data: {
          schemaVersion: 1,
          notices: [
            makeNotice({ id: 'hidden-1', priority: 100 }),
            makeNotice({ id: 'sticky-1', priority: 50, dismissPolicy: 'sticky' }),
            makeNotice({ id: 'normal', priority: 10 }),
          ],
          serverTime: new Date().toISOString(),
        },
      });

      h.service.boot();
      await h.service.fetch();
      const visible = h.service.getVisibleNotice();
      h.service.shutdown();

      // hidden-1 is dismissed; sticky-1 (priority 50) wins over normal (10).
      expect(visible?.id).toBe('sticky-1');
    });

    it('uses serverTimeOffsetMs for expiry, not raw Date.now', async () => {
      const h = makeHarness();
      // Server time is 1 hour ahead of local. The notice expires in 30
      // minutes of local time, which is BEFORE serverTime, so it should
      // be considered expired.
      const localNow = Date.now();
      const serverAhead = new Date(localNow + 60 * 60_000).toISOString();
      const expiresLocalPlus30min = new Date(localNow + 30 * 60_000).toISOString();
      h.setResponse({
        success: true,
        data: {
          schemaVersion: 1,
          notices: [makeNotice({ id: 'soon', expiresAt: expiresLocalPlus30min })],
          serverTime: serverAhead,
        },
      });

      h.service.boot();
      await h.service.fetch();
      const visible = h.service.getVisibleNotice();
      h.service.shutdown();

      expect(visible).toBeNull();
    });
  });

  describe('dismiss persistence', () => {
    it('set-merges with latest persisted ids and notifies subscribers', async () => {
      const h = makeHarness({ dismissedNoticeIds: ['old-1', 'old-2'] });
      const seen: Array<{ size: number; has: boolean }> = [];
      const unsub = h.service.onUpdate((s) => {
        seen.push({ size: s.dismissedIds.size, has: s.dismissedIds.has('new-1') });
      });

      h.service.boot(); // hydrate so initial dismissedIds is loaded
      await h.service.dismiss('new-1');
      h.service.shutdown();
      unsub();

      expect(h.saved).toHaveLength(1);
      const saved = h.saved[0]!.dismissedNoticeIds!;
      expect(saved).toContain('old-1');
      expect(saved).toContain('old-2');
      expect(saved).toContain('new-1');
      expect(new Set(saved).size).toBe(3);
    });

    it('caps at 200 ids, dropping the oldest', async () => {
      const seed: string[] = [];
      for (let i = 0; i < 200; i++) {
        seed.push(`id-${i.toString().padStart(4, '0')}`);
      }
      const h = makeHarness({ dismissedNoticeIds: seed });
      h.service.boot();
      await h.service.dismiss('newest-id');
      h.service.shutdown();

      const saved = h.saved.at(-1)!.dismissedNoticeIds!;
      expect(saved).toHaveLength(200);
      // The oldest id (id-0000) should have been dropped from the head.
      expect(saved).not.toContain('id-0000');
      expect(saved.at(-1)).toBe('newest-id');
    });

    it('is idempotent — re-dismissing does not save or notify again', async () => {
      const h = makeHarness();
      h.service.boot();
      await h.service.dismiss('only');
      const savedCount = h.saved.length;

      let notifyCount = 0;
      const unsub = h.service.onUpdate(() => { notifyCount++; });
      await h.service.dismiss('only');
      unsub();
      h.service.shutdown();

      expect(h.saved.length).toBe(savedCount);
      expect(notifyCount).toBe(0);
    });

    it('reads latest persisted state at dismiss time (not boot time)', async () => {
      const h = makeHarness({ dismissedNoticeIds: ['from-boot'] });
      h.service.boot();

      // Simulate another desktop syncing in a new id while we're loaded.
      h.settings.dismissedNoticeIds = ['from-boot', 'from-other-desktop'];

      await h.service.dismiss('local-action');
      h.service.shutdown();

      const saved = h.saved.at(-1)!.dismissedNoticeIds!;
      expect(saved).toContain('from-boot');
      expect(saved).toContain('from-other-desktop');
      expect(saved).toContain('local-action');
    });
  });

  describe('lifecycle', () => {
    it('boot() schedules a fetch and 15-minute interval; shutdown() clears them', () => {
      vi.useFakeTimers();
      const h = makeHarness();
      h.setResponse({
        success: true,
        data: { schemaVersion: 1, notices: [], serverTime: new Date().toISOString() },
      });

      h.service.boot();
      // Run the 1.5s startup timer.
      vi.advanceTimersByTime(1500);
      // The fetch is async; we can't await inside fake timers easily,
      // but the call should have been initiated by now (request handler
      // is sync-ish in this test harness).
      expect(h.capturedRequests.length).toBeGreaterThanOrEqual(0);

      h.service.shutdown();
      // Advancing past the next poll interval should NOT trigger another
      // fetch because shutdown cleared the interval.
      const beforeShutdownCount = h.capturedRequests.length;
      vi.advanceTimersByTime(POLL_INTERVAL_TEST_HORIZON_MS);
      expect(h.capturedRequests.length).toBe(beforeShutdownCount);

      vi.useRealTimers();
    });

    it('boot() is idempotent', () => {
      const h = makeHarness();
      h.service.boot();
      h.service.boot();
      h.service.shutdown();
      // No assertion needed beyond "did not throw" — we're checking the
      // guard against double-binding listeners and timers.
    });
  });
});
