/**
 * The network for byok-ai-core inside Obsidian. Everything goes through
 * `requestUrl` (no CORS, works on mobile) except streamed answers, which
 * need `window.fetch` — the only way to read a body as it arrives. Request
 * headers carry the key: nothing here logs a request.
 */
import { requestUrl } from 'obsidian';
import { BYOK_PROVIDERS, type ByokHttpRequest, type ByokHttpResponse, type ByokTransport } from '../../vendor/byok-ai-core';

const ANTHROPIC_ORIGIN = new URL(BYOK_PROVIDERS.anthropic.baseUrl).origin;

export function createObsidianByokTransport(): ByokTransport {
  return async (req) => {
    if (!req.stream) return viaRequestUrl(req);
    try {
      return await viaFetch(req);
    } catch (error) {
      // Anthropic sends its 4xx without CORS headers, so the browser hides a
      // bad-key answer behind a network error. requestUrl is not bound by
      // CORS: ask once more there and hand the core the real answer.
      if (req.signal?.aborted || !req.url.startsWith(ANTHROPIC_ORIGIN)) throw error;
      return viaRequestUrl(req);
    }
  };
}

/** No streaming and no abort: the whole answer at once (the core drops one that arrives after an abort). */
async function viaRequestUrl(req: ByokHttpRequest): Promise<ByokHttpResponse> {
  const res = await requestUrl({
    url: req.url,
    method: req.method,
    headers: req.headers,
    ...(req.body === undefined ? {} : { body: req.body }),
    throw: false,
  });
  return {
    status: res.status,
    headers: res.headers,
    text: () => Promise.resolve(res.text),
    body: null,
  };
}

async function viaFetch(req: ByokHttpRequest): Promise<ByokHttpResponse> {
  const res = await window.fetch(req.url, {
    method: req.method,
    headers: req.headers,
    ...(req.body === undefined ? {} : { body: req.body }),
    ...(req.signal ? { signal: req.signal } : {}),
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return { status: res.status, headers, text: () => res.text(), body: res.body };
}

/** Fail fast: a first run with no stored catalog waits for this once. */
const CATALOG_TIMEOUT_MS = 5_000;

/** `GET /api/byok/model-catalog` (public, no user data): the remote model catalog JSON. */
export async function fetchByokModelCatalog(endpoint: string): Promise<unknown> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error('Model catalog request timed out')), CATALOG_TIMEOUT_MS);
  });
  try {
    const res = await Promise.race([
      requestUrl({ url: `${endpoint}/api/byok/model-catalog`, method: 'GET', throw: false }),
      timeout,
    ]);
    if (res.status < 200 || res.status > 299) throw new Error(`Model catalog answered HTTP ${res.status}`);
    return JSON.parse(res.text) as unknown;
  } finally {
    window.clearTimeout(timer);
  }
}
