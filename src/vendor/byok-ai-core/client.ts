/**
 * One provider, one key, the host's transport: validate, list models,
 * generate (streamed or not), and deep research (OpenAI, Gemini). Every
 * failure is a ByokError; nothing here stores the key or puts it in a URL.
 */
import type { ByokAdapter, AdapterContext } from './adapter-shared';
import type { ByokMessage } from './chat';
import type { ByokModelInfo, ByokProviderId } from './providers';
import type { ByokTransport } from './transport';
import { anthropicAdapter } from './adapter-anthropic';
import { geminiAdapter } from './adapter-gemini';
import { openaiAdapter } from './adapter-openai';
import { openrouterAdapter } from './adapter-openrouter';
import { asRecord, readJson, send } from './adapter-shared';
import { ByokError } from './errors';
import { BYOK_PROVIDERS, listModelsRequest, parseListModels, validateKeyRequest } from './providers';

export interface ByokGenerateRequest {
  model: string;
  /** Instructions (cacheable: keep them stable across a conversation). */
  system: string;
  /** The untrusted article block (`buildArticleContext`), placed where the provider can cache it. */
  context?: string | undefined;
  /** Oldest first, starting and ending with a user turn (`buildChatMessages`). */
  messages: readonly ByokMessage[];
  /**
   * Budget for the visible answer. Adapters add room for reasoning tokens,
   * which every provider counts toward its output cap.
   */
  maxOutputTokens: number;
  /** Sent to OpenRouter only: OpenAI's and Claude's current models reject it, Gemini 3.6+ ignores it. */
  temperature?: number | undefined;
  /** Research and fact checks: the provider's own web search (and fetch, where it has one). */
  webSearch?: boolean | undefined;
  /** Ask for server-sent events; `onDelta` then sees text as it arrives. */
  stream?: boolean | undefined;
  signal?: AbortSignal | undefined;
}

export type ByokRunStatus = { phase: 'requesting' | 'searching' | 'generating' };

export interface ByokGenerateHandlers {
  /** Streamed text, for display. The result's `text` is authoritative. */
  onDelta?(text: string): void;
  onStatus?(status: ByokRunStatus): void;
}

export interface ByokCitation {
  url: string;
  title?: string;
}

export interface ByokGenerateResult {
  /** Never empty: an empty answer is a ByokError. */
  text: string;
  /** The model id the provider reports, which may differ from the one requested. */
  model: string;
  /** As reported: input includes cached tokens, output includes reasoning tokens. */
  usage: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; webSearchCalls?: number };
  citations: ByokCitation[];
  finishReason: 'stop' | 'length' | 'content_filter' | 'other';
}

export interface ByokDeepResearchRequest {
  /** OpenAI: a Responses model (catalog `deepResearch`); Gemini: the Deep Research agent id. */
  model: string;
  system: string;
  context?: string | undefined;
  /** `buildResearchPrompt({ depth: 'deep' })` user turn. */
  prompt: string;
  signal?: AbortSignal | undefined;
}

/** JSON-safe: persist it to resume polling after a restart. */
export interface ByokDeepResearchHandle {
  provider: 'openai' | 'gemini';
  id: string;
  model: string;
  /** Epoch ms. */
  startedAt: number;
}

export type ByokDeepResearchState =
  | { status: 'queued' | 'running' }
  | { status: 'completed'; result: ByokGenerateResult }
  | { status: 'failed' | 'cancelled'; error: ByokError };

export type ByokValidateResult =
  | { ok: true; models: ByokModelInfo[]; freeTier?: boolean }
  | { ok: false; error: ByokError };

export interface ByokClient {
  readonly provider: ByokProviderId;
  /** A free call; never throws. OpenRouter also reports whether the key is on the free tier. */
  validateKey(): Promise<ByokValidateResult>;
  listModels(): Promise<ByokModelInfo[]>;
  generate(req: ByokGenerateRequest, handlers?: ByokGenerateHandlers): Promise<ByokGenerateResult>;
  /** OpenAI and Gemini only (a background job on the provider). */
  startDeepResearch(req: ByokDeepResearchRequest): Promise<ByokDeepResearchHandle>;
  /**
   * Rejects with a ByokError when the poll request itself fails (keep polling
   * when `byokErrorToJobErrorCode(code).retryable`); resolves `failed` when
   * the provider reports the job failed.
   */
  pollDeepResearch(handle: ByokDeepResearchHandle): Promise<ByokDeepResearchState>;
  cancelDeepResearch(handle: ByokDeepResearchHandle): Promise<void>;
}

const ADAPTERS: Readonly<Record<ByokProviderId, ByokAdapter>> = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
  openrouter: openrouterAdapter,
};

export function createByokClient(options: {
  provider: ByokProviderId;
  apiKey: string;
  transport: ByokTransport;
}): ByokClient {
  const ctx: AdapterContext = { provider: options.provider, apiKey: options.apiKey.trim(), transport: options.transport };
  const { provider } = ctx;
  const adapter = ADAPTERS[provider];
  const label = BYOK_PROVIDERS[provider].label;
  const scrub = (error: unknown) => scrubKey(error, ctx.apiKey);
  const guard = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      throw scrub(error);
    }
  };
  const deepResearch = (handle?: ByokDeepResearchHandle) => {
    if (!adapter.deepResearch || (handle && handle.provider !== provider)) {
      throw new ByokError('unknown', `${label} has no deep research.`, { provider });
    }
    return adapter.deepResearch;
  };
  const listModels = async () =>
    parseListModels(provider, await readJson(ctx, await send(ctx, listModelsRequest(provider, ctx.apiKey))));

  return {
    provider,
    async validateKey() {
      if (!ctx.apiKey) return { ok: false, error: new ByokError('invalid_key', `Enter a ${label} API key.`, { provider }) };
      try {
        const json = await readJson(ctx, await send(ctx, validateKeyRequest(provider, ctx.apiKey)));
        if (provider !== 'openrouter') return { ok: true, models: parseListModels(provider, json) };
        // OpenRouter validates on /key, which reports the tier but no models.
        const freeTier = asRecord(asRecord(json)?.data)?.is_free_tier;
        return { ok: true, models: await listModels(), ...(typeof freeTier === 'boolean' ? { freeTier } : {}) };
      } catch (error) {
        const scrubbed = scrub(error);
        if (scrubbed instanceof ByokError) return { ok: false, error: scrubbed };
        throw scrubbed;
      }
    },
    listModels: () => guard(listModels),
    generate: (req, handlers = {}) =>
      guard(() => {
        handlers.onStatus?.({ phase: 'requesting' });
        return adapter.generate(ctx, req, handlers);
      }),
    startDeepResearch: (req) => guard(() => deepResearch().start(ctx, req)),
    pollDeepResearch: (handle) =>
      guard(async () => {
        const state = await deepResearch(handle).poll(ctx, handle);
        return 'error' in state ? { ...state, error: scrub(state.error) as ByokError } : state;
      }),
    cancelDeepResearch: (handle) => guard(() => deepResearch(handle).cancel(ctx, handle)),
  };
}

/**
 * Pattern redaction covers the four providers' key formats; this also removes
 * the exact key in case a provider echoes one in a format nobody anticipated.
 */
function scrubKey(error: unknown, apiKey: string): unknown {
  if (!(error instanceof ByokError) || apiKey.length < 8 || !error.message.includes(apiKey)) return error;
  return new ByokError(error.code, error.message.split(apiKey).join('[redacted]'), {
    provider: error.provider,
    status: error.status,
    retryAfterSeconds: error.retryAfterSeconds,
    hint: error.hint,
  });
}
