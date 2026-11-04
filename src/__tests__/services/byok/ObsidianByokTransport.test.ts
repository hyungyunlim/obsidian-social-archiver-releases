import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setRequestUrlHandler, type RequestUrlParam } from 'obsidian';
import { createObsidianByokTransport, fetchByokModelCatalog } from '../../../services/byok/ObsidianByokTransport';

// Built at runtime: the public mirror's secret scan rejects any key-shaped literal (sk-…).
const FAKE_KEY = ['sk', 'test-1234567890abcdef'].join('-');

function requestUrlAnswer(status: number, text: string) {
  return { status, headers: { 'content-type': 'application/json' }, text, json: null, arrayBuffer: new ArrayBuffer(0) };
}

describe('createObsidianByokTransport', () => {
  const originalFetch = window.fetch;
  let calls: RequestUrlParam[];

  beforeEach(() => {
    calls = [];
    __setRequestUrlHandler(async (params) => {
      calls.push(params);
      return requestUrlAnswer(401, '{"error":{"type":"authentication_error","message":"invalid x-api-key"}}');
    });
  });

  afterEach(() => {
    __setRequestUrlHandler(null);
    window.fetch = originalFetch;
  });

  it('sends non-streamed requests through requestUrl and never throws on a provider error', async () => {
    const transport = createObsidianByokTransport();
    const res = await transport({
      url: 'https://api.openai.com/v1/models',
      method: 'GET',
      headers: { Authorization: `Bearer ${FAKE_KEY}` },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: 'https://api.openai.com/v1/models', method: 'GET', throw: false });
    expect(calls[0]).not.toHaveProperty('body');
    expect(res.status).toBe(401);
    expect(res.body).toBeNull();
    await expect(res.text()).resolves.toContain('authentication_error');
  });

  it('streams through window.fetch with the body, headers and abort signal', async () => {
    const stream = new ReadableStream<Uint8Array>();
    const fetch = vi.fn(async () => new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    window.fetch = fetch as typeof window.fetch;
    const controller = new AbortController();
    const res = await createObsidianByokTransport()({
      url: 'https://api.openai.com/v1/responses',
      method: 'POST',
      headers: { Authorization: `Bearer ${FAKE_KEY}` },
      body: '{"stream":true}',
      stream: true,
      signal: controller.signal,
    });
    expect(fetch).toHaveBeenCalledWith('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${FAKE_KEY}` },
      body: '{"stream":true}',
      signal: controller.signal,
    });
    expect(calls).toHaveLength(0);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(res.body).toBe(stream);
  });

  it('asks requestUrl again when Anthropic\'s CORS-less error makes fetch reject', async () => {
    window.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof window.fetch;
    const res = await createObsidianByokTransport()({
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: { 'x-api-key': FAKE_KEY },
      body: '{}',
      stream: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(res.status).toBe(401);
    expect(res.body).toBeNull();
  });

  it('rethrows a fetch failure for other providers, and any failure after an abort', async () => {
    const failure = new TypeError('Failed to fetch');
    window.fetch = vi.fn(async () => {
      throw failure;
    }) as typeof window.fetch;
    const transport = createObsidianByokTransport();
    await expect(
      transport({ url: 'https://openrouter.ai/api/v1/chat/completions', method: 'POST', headers: {}, body: '{}', stream: true }),
    ).rejects.toBe(failure);

    const controller = new AbortController();
    controller.abort();
    await expect(
      transport({ url: 'https://api.anthropic.com/v1/messages', method: 'POST', headers: {}, body: '{}', stream: true, signal: controller.signal }),
    ).rejects.toBe(failure);
    expect(calls).toHaveLength(0);
  });
});

describe('fetchByokModelCatalog', () => {
  afterEach(() => {
    __setRequestUrlHandler(null);
    vi.useRealTimers();
  });

  it('returns the endpoint JSON and rejects a non-2xx answer', async () => {
    const urls: string[] = [];
    __setRequestUrlHandler(async (params) => {
      urls.push(params.url);
      return requestUrlAnswer(200, '{"success":true,"data":{"schemaVersion":1}}');
    });
    await expect(fetchByokModelCatalog('https://api.test')).resolves.toEqual({ success: true, data: { schemaVersion: 1 } });
    expect(urls).toEqual(['https://api.test/api/byok/model-catalog']);

    __setRequestUrlHandler(async () => requestUrlAnswer(503, ''));
    await expect(fetchByokModelCatalog('https://api.test')).rejects.toThrow('503');
  });

  it('gives up quickly when the endpoint does not answer', async () => {
    vi.useFakeTimers();
    __setRequestUrlHandler(() => new Promise(() => undefined));
    const pending = fetchByokModelCatalog('https://api.test');
    const assertion = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });
});
