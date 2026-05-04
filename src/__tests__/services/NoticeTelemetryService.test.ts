/**
 * Tests for NoticeTelemetryService.
 *
 * Coverage:
 *   - trackImpression de-dupes per (notice id, session)
 *   - Each event gets a fresh UUID event_id
 *   - notice_id and tracking_key are forwarded
 *   - Skipped silently when neither username nor deviceId is present
 *   - Throws nothing into the caller even when the network rejects
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setRequestUrlHandler } from 'obsidian';
import { NoticeTelemetryService } from '@/services/NoticeTelemetryService';
import { DEFAULT_SETTINGS, type SocialArchiverSettings } from '@/types/settings';
import type { NoticePayloadV1 } from '@/types/notices';

function makeNotice(id: string, overrides: Partial<NoticePayloadV1> = {}): NoticePayloadV1 {
  return {
    schemaVersion: 1,
    id,
    surface: 'top_banner',
    priority: 0,
    level: 'info',
    body: 'b',
    dismissPolicy: 'per_id_local',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    trackingKey: `tk-${id}`,
    ...overrides,
  };
}

interface CapturedRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function setup(settingsOverrides: Partial<SocialArchiverSettings> = {}) {
  const settings: SocialArchiverSettings = {
    ...DEFAULT_SETTINGS,
    deviceId: 'dev-x',
    username: 'alice',
    authToken: 'tk',
    ...settingsOverrides,
  };
  const captured: CapturedRequest[] = [];

  __setRequestUrlHandler(async (params) => {
    captured.push({
      url: params.url,
      method: params.method,
      headers: params.headers,
      body: params.body,
    });
    return {
      status: 200,
      headers: {},
      text: '',
      json: { success: true },
      arrayBuffer: new ArrayBuffer(0),
    };
  });

  const service = new NoticeTelemetryService({
    apiClient: {
      getEndpoint: () => 'https://api.example.com',
      getAuthToken: () => settings.authToken || null,
    },
    getSettings: () => settings,
    logger: () => {},
  });

  return { service, captured, settings };
}

// Resolve all microtasks so fire-and-forget calls have time to flush
// through the mock handler.
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('NoticeTelemetryService', () => {
  beforeEach(() => {
    __setRequestUrlHandler(null);
  });

  afterEach(() => {
    __setRequestUrlHandler(null);
  });

  it('trackImpression sends event with UUID event_id, notice_id, tracking_key', async () => {
    const { service, captured } = setup();
    const notice = makeNotice('n1');

    service.trackImpression(notice);
    await flush();

    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe('https://api.example.com/api/events');
    expect(captured[0]!.method).toBe('POST');
    const body = JSON.parse(captured[0]!.body || '{}');
    expect(body.events).toHaveLength(1);
    const event = body.events[0];
    expect(event.event).toBe('notice_impression');
    expect(typeof event.event_id).toBe('string');
    // UUID v4 shape: 8-4-4-4-12 hex.
    expect(event.event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(event.session_id).toBeTruthy();
    expect(event.user_id_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(event.properties.notice_id).toBe('n1');
    expect(event.properties.tracking_key).toBe('tk-n1');
    expect(event.properties.client).toBe('obsidian-plugin');
    expect(event.properties.event_id).toBe(event.event_id);
  });

  it('trackImpression de-dupes per notice id within the same session', async () => {
    const { service, captured } = setup();
    const notice = makeNotice('dedupe-me');

    service.trackImpression(notice);
    service.trackImpression(notice);
    service.trackImpression(notice);
    await flush();

    expect(captured).toHaveLength(1);
  });

  it('different notice ids are NOT deduped against each other', async () => {
    const { service, captured } = setup();
    service.trackImpression(makeNotice('a'));
    service.trackImpression(makeNotice('b'));
    await flush();
    expect(captured).toHaveLength(2);
  });

  it('cta_clicked and dismissed are always sent (no de-dupe)', async () => {
    const { service, captured } = setup();
    const notice = makeNotice('repeat');

    service.trackCtaClicked(notice);
    service.trackCtaClicked(notice);
    service.trackDismissed(notice);
    service.trackDismissed(notice);
    await flush();

    expect(captured).toHaveLength(4);
    const events = captured.map((c) => JSON.parse(c.body || '{}').events[0].event);
    expect(events).toEqual([
      'notice_cta_clicked',
      'notice_cta_clicked',
      'notice_dismissed',
      'notice_dismissed',
    ]);
  });

  it('skips upload when no username AND no deviceId is present', async () => {
    const { service, captured } = setup({ username: '', deviceId: '' });
    service.trackImpression(makeNotice('orphan'));
    await flush();
    expect(captured).toHaveLength(0);
  });

  it('uses deviceId for the user_id_hash when username is empty', async () => {
    const { service, captured } = setup({ username: '', deviceId: 'fallback-dev' });
    service.trackImpression(makeNotice('any'));
    await flush();
    expect(captured).toHaveLength(1);
    const event = JSON.parse(captured[0]!.body || '{}').events[0];
    expect(event.user_id_hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('does not throw to the caller when the network rejects', async () => {
    const { service } = setup();
    __setRequestUrlHandler(async () => {
      throw new Error('boom');
    });

    expect(() => service.trackImpression(makeNotice('explode'))).not.toThrow();
    expect(() => service.trackCtaClicked(makeNotice('explode-2'))).not.toThrow();
    expect(() => service.trackDismissed(makeNotice('explode-3'))).not.toThrow();
    await flush();
  });

  it('uses Authorization header when auth token is set', async () => {
    const { service, captured } = setup({ authToken: 'sekret' });
    service.trackImpression(makeNotice('auth'));
    await flush();
    expect(captured[0]!.headers?.['Authorization']).toBe('Bearer sekret');
  });

  it('omits Authorization when no auth token', async () => {
    const { service, captured } = setup({ authToken: '' });
    service.trackImpression(makeNotice('noauth'));
    await flush();
    expect(captured[0]!.headers?.['Authorization']).toBeUndefined();
  });
});
