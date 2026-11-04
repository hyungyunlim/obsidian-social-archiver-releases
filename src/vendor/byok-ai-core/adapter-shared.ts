/**
 * What the four provider adapters share: requests through the host transport,
 * error mapping, streamed-text reporting, and the result rules. Internal.
 */
import type {
  ByokCitation,
  ByokDeepResearchHandle,
  ByokDeepResearchRequest,
  ByokDeepResearchState,
  ByokGenerateHandlers,
  ByokGenerateRequest,
  ByokGenerateResult,
} from './client';
import type { ByokProviderId } from './providers';
import type { SseFrame } from './sse';
import type { ByokHttpRequest, ByokHttpResponse, ByokTransport } from './transport';
import { ByokError, normalizeProviderError } from './errors';
import { BYOK_PROVIDERS, byokAuthHeaders } from './providers';

export interface AdapterContext {
  provider: ByokProviderId;
  apiKey: string;
  transport: ByokTransport;
}

export interface ByokAdapter {
  generate(ctx: AdapterContext, req: ByokGenerateRequest, handlers: ByokGenerateHandlers): Promise<ByokGenerateResult>;
  deepResearch?: {
    start(ctx: AdapterContext, req: ByokDeepResearchRequest): Promise<ByokDeepResearchHandle>;
    poll(ctx: AdapterContext, handle: ByokDeepResearchHandle): Promise<ByokDeepResearchState>;
    cancel(ctx: AdapterContext, handle: ByokDeepResearchHandle): Promise<void>;
  };
}

/**
 * Every provider counts reasoning tokens toward its output cap (OpenAI
 * reasoning models, Claude adaptive thinking, Gemini thinking, OpenRouter), so
 * a cap of just the answer budget can end a run before any visible text.
 * ponytail: fixed allowance at provider-default reasoning effort; tune per
 * model when cost or latency data says so.
 */
export function outputTokenLimit(req: ByokGenerateRequest): number {
  return req.maxOutputTokens + (req.webSearch ? 16_000 : 8_000);
}

export function request(
  ctx: AdapterContext,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  options: { stream?: boolean | undefined; signal?: AbortSignal | undefined } = {},
): ByokHttpRequest {
  return {
    url: `${BYOK_PROVIDERS[ctx.provider].baseUrl}${path}`,
    method,
    headers: {
      ...byokAuthHeaders(ctx.provider, ctx.apiKey),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.stream ? { stream: true } : {}),
  };
}

/** The transport's answer when it is 2xx; otherwise a ByokError (never the request or its headers). */
export async function send(ctx: AdapterContext, req: ByokHttpRequest): Promise<ByokHttpResponse> {
  const { provider } = ctx;
  if (req.signal?.aborted) throw cancelledError(provider);
  let res: ByokHttpResponse;
  try {
    res = await ctx.transport(req);
  } catch (error) {
    if (req.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw cancelledError(provider);
    const reason = error instanceof Error ? error.message : String(error);
    throw new ByokError('network', `Could not reach ${BYOK_PROVIDERS[provider].label}: ${reason}`, {
      provider,
      // Anthropic sends its 4xx without CORS headers: in a browser a bad key looks like this.
      ...(provider === 'anthropic' ? { hint: 'invalid_key_maybe' as const } : {}),
    });
  }
  // A transport that cannot abort (Obsidian requestUrl) still answers; drop the answer.
  if (req.signal?.aborted) throw cancelledError(provider);
  if (res.status < 200 || res.status > 299) {
    const body = await res.text().catch(() => '');
    throw normalizeProviderError(provider, res.status, body, res.headers);
  }
  return res;
}

export async function readJson(ctx: AdapterContext, res: ByokHttpResponse): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new ByokError('unknown', `${BYOK_PROVIDERS[ctx.provider].label} sent an answer this app cannot read.`, {
      provider: ctx.provider,
    });
  }
}

export function cancelledError(provider: ByokProviderId): ByokError {
  return new ByokError('cancelled', `The ${BYOK_PROVIDERS[provider].label} request was cancelled.`, { provider });
}

/** A frame's JSON payload, or undefined (`[DONE]`, keep-alives, anything unreadable). */
export function frameJson(frame: SseFrame): JsonRecord | undefined {
  try {
    return asRecord(JSON.parse(frame.data));
  } catch {
    return undefined;
  }
}

/** Status updates for a streamed run: `generating` once, on the first text. */
export function streamReporter(handlers: ByokGenerateHandlers): { searching(): void; text(delta: string): void } {
  let generating = false;
  return {
    searching: () => handlers.onStatus?.({ phase: 'searching' }),
    text(delta) {
      if (!delta) return;
      if (!generating) {
        generating = true;
        handlers.onStatus?.({ phase: 'generating' });
      }
      handlers.onDelta?.(delta);
    },
  };
}

/** Citations in first-seen order, one per URL, http(s) only. */
export function citationCollector(): { add(url: unknown, title?: unknown): void; list(): ByokCitation[] } {
  const seen = new Map<string, ByokCitation>();
  return {
    add(url, title) {
      const href = str(url)?.trim();
      if (!href || !/^https?:\/\//i.test(href) || seen.has(href)) return;
      const name = str(title)?.trim();
      seen.set(href, name ? { url: href, title: name } : { url: href });
    },
    list: () => [...seen.values()],
  };
}

/** Usage with the counts a provider reported (finite, non-negative); the rest left out. */
export function usageOf(counts: {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  cachedInputTokens?: number | undefined;
  webSearchCalls?: number | undefined;
}): ByokGenerateResult['usage'] {
  const usage: ByokGenerateResult['usage'] = {};
  for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens', 'webSearchCalls'] as const) {
    const value = counts[key];
    if (value !== undefined && Number.isFinite(value) && value >= 0) usage[key] = value;
  }
  return usage;
}

/**
 * The result, trimmed. An empty answer is an error, not a result: the
 * provider refused, or reasoning spent the whole output budget.
 */
export function finishResult(provider: ByokProviderId, result: ByokGenerateResult): ByokGenerateResult {
  const text = result.text.trim();
  if (text) return { ...result, text };
  const label = BYOK_PROVIDERS[provider].label;
  if (result.finishReason === 'content_filter') {
    throw new ByokError('content_blocked', `${label} declined to answer.`, { provider });
  }
  throw new ByokError(
    'unknown',
    result.finishReason === 'length'
      ? `${label} used the whole output budget before answering.`
      : `${label} returned an empty answer.`,
    { provider },
  );
}

/** Non-empty parts joined by a blank line. */
export function joinParts(...parts: (string | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join('\n\n');
}

export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

export function records(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    const record = asRecord(item);
    return record ? [record] : [];
  });
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
