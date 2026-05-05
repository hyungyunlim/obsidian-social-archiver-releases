/**
 * WorkersAPIClient — billing-events methods (Phase B+C).
 *
 * Covers:
 *   - GET /api/user/billing-events envelope parsing
 *   - X-Client-Capabilities header (no native_paywall)
 *   - X-Client: obsidian-plugin
 *   - Fail-soft return [] on HTTP non-2xx, network error, JSON parse error,
 *     unauthenticated state
 *   - POST /api/user/billing-events/:id/dismiss returns true only on
 *     {success:true, data.dismissed:true}
 *
 * PRD: `.taskmaster/docs/prd-billing-lifecycle-notifications-plugin.md` §7.3,
 *      §8.6, §11.1.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkersAPIClient } from '@/services/WorkersAPIClient';
import { __setRequestUrlHandler } from 'obsidian';
import type { BillingEventApiPayload } from '@/types/billing-events';

type RequestHandler = (params: any) => Promise<any>;

interface CapturedRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function setHandler(
  handler: (req: CapturedRequest) => Promise<any> | any,
  captured?: CapturedRequest[],
): void {
  __setRequestUrlHandler(async (params: any) => {
    if (captured) captured.push(params);
    return handler(params);
  });
}

function makeEvent(overrides: Partial<BillingEventApiPayload> = {}): BillingEventApiPayload {
  return {
    id: 'evt-1',
    type: 'billing_issue',
    severity: 'error',
    state: 'active',
    priority: 100,
    title: 'Payment issue',
    body: 'There is a problem with your payment method.',
    cta: { action: 'update_and_pay_in_mobile', label: 'Update payment' },
    payload: {},
    dismissible: false,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeClient(authToken: string | undefined = 'test-token'): WorkersAPIClient {
  const client = new WorkersAPIClient({
    endpoint: 'https://api.test.com',
    authToken,
    pluginVersion: '3.4.1',
  });
  client.initialize();
  return client;
}

describe('WorkersAPIClient — getActiveBillingEvents', () => {
  beforeEach(() => {
    __setRequestUrlHandler(null);
  });

  afterEach(() => {
    __setRequestUrlHandler(null);
  });

  it('parses the envelope and returns events array', async () => {
    const event = makeEvent();
    setHandler(() => ({
      status: 200,
      headers: {},
      json: {
        success: true,
        data: {
          schemaVersion: 1,
          serverTime: '2026-05-05T00:00:00.000Z',
          events: [event],
        },
      },
      text: '',
      arrayBuffer: new ArrayBuffer(0),
    }));

    const client = makeClient();
    const result = await client.getActiveBillingEvents();
    expect(result).toEqual([event]);
  });

  it('sends X-Client-Capabilities and X-Client: obsidian-plugin', async () => {
    const captured: CapturedRequest[] = [];
    setHandler(
      () => ({
        status: 200,
        headers: {},
        json: { success: true, data: { schemaVersion: 1, serverTime: '', events: [] } },
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      }),
      captured,
    );

    const client = makeClient();
    await client.getActiveBillingEvents();

    expect(captured).toHaveLength(1);
    const headers = captured[0].headers ?? {};
    expect(headers['X-Client']).toBe('obsidian-plugin');
    expect(headers['X-Client-Capabilities']).toBe(
      'billing-v1,app-update-v1,external_billing_handoff-v1',
    );
    // Critical: never advertise native paywall capability from plugin.
    expect(headers['X-Client-Capabilities']).not.toMatch(/native_paywall/);
    expect(headers['Authorization']).toBe('Bearer test-token');
  });

  it('returns [] on HTTP 401', async () => {
    setHandler(() => ({
      status: 401,
      headers: {},
      json: { success: false, error: { code: 'UNAUTHORIZED' } },
      text: '',
      arrayBuffer: new ArrayBuffer(0),
    }));
    const client = makeClient();
    const result = await client.getActiveBillingEvents();
    expect(result).toEqual([]);
  });

  it('returns [] on HTTP 500', async () => {
    setHandler(() => ({
      status: 500,
      headers: {},
      json: null,
      text: 'Internal Server Error',
      arrayBuffer: new ArrayBuffer(0),
    }));
    const client = makeClient();
    const result = await client.getActiveBillingEvents();
    expect(result).toEqual([]);
  });

  it('returns [] on network throw', async () => {
    setHandler(() => {
      throw new Error('network down');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = makeClient();
    const result = await client.getActiveBillingEvents();
    expect(result).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns [] when JSON body is malformed (no events array)', async () => {
    setHandler(() => ({
      status: 200,
      headers: {},
      json: { success: true, data: { schemaVersion: 1, serverTime: '', events: 'not-an-array' } },
      text: '',
      arrayBuffer: new ArrayBuffer(0),
    }));
    const client = makeClient();
    const result = await client.getActiveBillingEvents();
    expect(result).toEqual([]);
  });

  it('returns [] when unauthenticated (no auth token)', async () => {
    const captured: CapturedRequest[] = [];
    setHandler(
      () => ({
        status: 200,
        headers: {},
        json: { success: true, data: { events: [makeEvent()] } },
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      }),
      captured,
    );
    const client = makeClient(undefined);
    const result = await client.getActiveBillingEvents();
    expect(result).toEqual([]);
    // Should not have hit network at all.
    expect(captured).toHaveLength(0);
  });
});

describe('WorkersAPIClient — dismissBillingEvent', () => {
  beforeEach(() => {
    __setRequestUrlHandler(null);
  });
  afterEach(() => {
    __setRequestUrlHandler(null);
  });

  it('posts to /api/user/billing-events/:id/dismiss', async () => {
    const captured: CapturedRequest[] = [];
    setHandler(
      () => ({
        status: 200,
        headers: {},
        json: { success: true, data: { dismissed: true } },
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      }),
      captured,
    );

    const client = makeClient();
    const result = await client.dismissBillingEvent('evt-abc');
    expect(result).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe('https://api.test.com/api/user/billing-events/evt-abc/dismiss');
    expect(captured[0].method).toBe('POST');
    expect(captured[0].headers?.['X-Client-Capabilities']).toBe(
      'billing-v1,app-update-v1,external_billing_handoff-v1',
    );
  });

  it('url-encodes the event id', async () => {
    const captured: CapturedRequest[] = [];
    setHandler(
      () => ({
        status: 200,
        headers: {},
        json: { success: true, data: { dismissed: true } },
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      }),
      captured,
    );

    const client = makeClient();
    await client.dismissBillingEvent('evt with/space');
    expect(captured[0].url).toBe(
      'https://api.test.com/api/user/billing-events/evt%20with%2Fspace/dismiss',
    );
  });

  it('returns false when server returns dismissed=false', async () => {
    setHandler(() => ({
      status: 200,
      headers: {},
      json: { success: true, data: { dismissed: false } },
      text: '',
      arrayBuffer: new ArrayBuffer(0),
    }));
    const client = makeClient();
    const result = await client.dismissBillingEvent('evt-1');
    expect(result).toBe(false);
  });

  it('returns false on HTTP non-2xx', async () => {
    setHandler(() => ({
      status: 404,
      headers: {},
      json: { success: false, error: { code: 'NOT_FOUND' } },
      text: '',
      arrayBuffer: new ArrayBuffer(0),
    }));
    const client = makeClient();
    const result = await client.dismissBillingEvent('missing');
    expect(result).toBe(false);
  });

  it('returns false when success=false in body', async () => {
    setHandler(() => ({
      status: 200,
      headers: {},
      json: { success: false, error: { code: 'X' } },
      text: '',
      arrayBuffer: new ArrayBuffer(0),
    }));
    const client = makeClient();
    const result = await client.dismissBillingEvent('evt-1');
    expect(result).toBe(false);
  });
});
