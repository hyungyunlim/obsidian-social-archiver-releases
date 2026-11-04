/**
 * The four providers a user can bring a key for. Fixed endpoints only: no
 * user-editable base URL (a synced `baseUrl` once sent another plugin's keys
 * to an attacker).
 *
 * Type imports only in this file: `scripts/byok-model-canary.mjs` runs it
 * under Node's type stripping, which cannot resolve extensionless value
 * imports. `__tests__/byok-ai-core/importRules.test.ts` enforces it.
 */
import type { ByokHttpRequest } from './transport';

export const BYOK_PROVIDER_IDS = ['openai', 'anthropic', 'gemini', 'openrouter'] as const;
export type ByokProviderId = (typeof BYOK_PROVIDER_IDS)[number];

/** Value stored in `AIComment.meta.cli` and used as the executor provider id. */
export const BYOK_STORED_PROVIDER_IDS = [
  'openai-api',
  'anthropic-api',
  'gemini-api',
  'openrouter-api',
] as const;
export type ByokStoredProviderId = (typeof BYOK_STORED_PROVIDER_IDS)[number];

export interface ByokProviderSpec {
  id: ByokProviderId;
  storedId: ByokStoredProviderId;
  /** Brand. Stored comments say `<label> API`; engine pickers say `<label> (my key)`. */
  label: string;
  /** Origin plus API version prefix; request paths are appended to it. */
  baseUrl: string;
  keyPrefixHint: string;
  keyCreateUrl: string;
  billingUrl: string;
  privacyUrl: string;
  capabilities: { webSearch: boolean; deepResearch: boolean; streaming: boolean };
  /**
   * Show the data-use warning: on Gemini's free tier Google may use inputs and
   * outputs for training and human review, and EEA/UK/CH users need the paid tier.
   */
  dataUseNote: boolean;
}

/** URLs checked 2026-11-04 (OpenAI's dashboard blocks scripted checks; its URLs are the documented ones). */
export const BYOK_PROVIDERS: Readonly<Record<ByokProviderId, ByokProviderSpec>> = {
  openai: {
    id: 'openai',
    storedId: 'openai-api',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyPrefixHint: 'sk-',
    keyCreateUrl: 'https://platform.openai.com/api-keys',
    billingUrl: 'https://platform.openai.com/settings/organization/billing/overview',
    privacyUrl: 'https://openai.com/enterprise-privacy/',
    capabilities: { webSearch: true, deepResearch: true, streaming: true },
    dataUseNote: false,
  },
  anthropic: {
    id: 'anthropic',
    storedId: 'anthropic-api',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    keyPrefixHint: 'sk-ant-',
    keyCreateUrl: 'https://platform.claude.com/settings/keys',
    billingUrl: 'https://platform.claude.com/settings/billing',
    privacyUrl: 'https://www.anthropic.com/legal/privacy',
    capabilities: { webSearch: true, deepResearch: false, streaming: true },
    dataUseNote: false,
  },
  gemini: {
    id: 'gemini',
    storedId: 'gemini-api',
    label: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    keyPrefixHint: 'AIza',
    keyCreateUrl: 'https://aistudio.google.com/apikey',
    billingUrl: 'https://aistudio.google.com/docs/billing',
    privacyUrl: 'https://aistudio.google.com/docs/terms',
    capabilities: { webSearch: true, deepResearch: true, streaming: true },
    dataUseNote: true,
  },
  openrouter: {
    id: 'openrouter',
    storedId: 'openrouter-api',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyPrefixHint: 'sk-or-',
    keyCreateUrl: 'https://openrouter.ai/settings/keys',
    billingUrl: 'https://openrouter.ai/settings/credits',
    privacyUrl: 'https://openrouter.ai/privacy',
    capabilities: { webSearch: true, deepResearch: false, streaming: true },
    dataUseNote: false,
  },
};

export function isByokProviderId(value: unknown): value is ByokProviderId {
  return typeof value === 'string' && (BYOK_PROVIDER_IDS as readonly string[]).includes(value);
}

export function isByokStoredProviderId(value: unknown): value is ByokStoredProviderId {
  return typeof value === 'string' && (BYOK_STORED_PROVIDER_IDS as readonly string[]).includes(value);
}

export function toStoredProviderId(provider: ByokProviderId): ByokStoredProviderId {
  return BYOK_PROVIDERS[provider].storedId;
}

export function fromStoredProviderId(stored: ByokStoredProviderId): ByokProviderId {
  return stored.slice(0, -'-api'.length) as ByokProviderId;
}

/** "OpenAI API": the label on stored comments; lower-cased and dash-joined it is the stored id again. */
export function byokCommentLabel(stored: ByokStoredProviderId): string {
  return `${BYOK_PROVIDERS[fromStoredProviderId(stored)].label} API`;
}

/** `…abcd`, the only form of a key the UI shows. Too short to hide anything → nothing. */
export function keyFingerprint(key: string): string {
  const trimmed = key.trim();
  return trimmed.length >= 8 ? `…${trimmed.slice(-4)}` : '…';
}

export interface ByokModelInfo {
  id: string;
  label?: string;
  /** false = the provider says this model cannot use web search; absent = unknown. */
  webSearch?: boolean;
  contextWindow?: number;
}

export function byokAuthHeaders(provider: ByokProviderId, key: string): Record<string, string> {
  const apiKey = key.trim();
  switch (provider) {
    case 'openai':
      return { Authorization: `Bearer ${apiKey}` };
    case 'anthropic':
      return {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // Without it Anthropic refuses calls from a browser or webview origin.
        'anthropic-dangerous-direct-browser-access': 'true',
      };
    case 'gemini':
      // Header only, never `?key=`: keeps keys out of URLs, logs and Sentry breadcrumbs.
      return { 'x-goog-api-key': apiKey };
    case 'openrouter':
      return {
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://social-archive.org',
        'X-Title': 'Social Archiver',
      };
  }
}

const MODEL_LIST_PATH: Readonly<Record<ByokProviderId, string>> = {
  openai: '/models',
  anthropic: '/models?limit=1000',
  gemini: '/models?pageSize=1000',
  openrouter: '/models',
};

function getRequest(provider: ByokProviderId, key: string, path: string): ByokHttpRequest {
  return {
    url: `${BYOK_PROVIDERS[provider].baseUrl}${path}`,
    method: 'GET',
    headers: byokAuthHeaders(provider, key),
  };
}

/**
 * A free call that proves the key works. Gemini answers a bad key with 400,
 * not 401; OpenRouter's `/key` also reports `is_free_tier`.
 */
export function validateKeyRequest(provider: ByokProviderId, key: string): ByokHttpRequest {
  return getRequest(provider, key, provider === 'openrouter' ? '/key' : MODEL_LIST_PATH[provider]);
}

export function listModelsRequest(provider: ByokProviderId, key: string): ByokHttpRequest {
  return getRequest(provider, key, MODEL_LIST_PATH[provider]);
}

/** A prefix allowlist too, so a new media family (e.g. `sora-2`) never becomes a text default. */
const OPENAI_TEXT_PREFIX = /^(?:gpt-|o\d|chatgpt-)/;
const OPENAI_NON_TEXT =
  /embedding|tts|whisper|dall-e|image|audio|realtime|transcribe|moderation|computer-use|search-preview|gpt-live/;
const GEMINI_NON_TEXT = /embedding|aqa|imagen|veo|tts|image|live|native-audio|lyria|banana|transcribe|omni/;

/** The text-generation models in a provider's list response, in the provider's order. */
export function parseListModels(provider: ByokProviderId, json: unknown): ByokModelInfo[] {
  const root = asRecord(json);
  switch (provider) {
    case 'openai':
      return records(root?.data).flatMap((model) => {
        const id = str(model.id);
        return id && OPENAI_TEXT_PREFIX.test(id) && !OPENAI_NON_TEXT.test(id) ? [{ id }] : [];
      });
    case 'anthropic':
      return records(root?.data).flatMap((model) => {
        const id = str(model.id);
        if (!id?.startsWith('claude-') || model.lifecycle === 'retired') return [];
        const webSearch = asRecord(asRecord(asRecord(model.capabilities)?.server_tools)?.web_search)?.supported;
        return [
          modelInfo(id, str(model.display_name), typeof webSearch === 'boolean' ? webSearch : undefined, positive(model.max_input_tokens)),
        ];
      });
    case 'gemini':
      return records(root?.models).flatMap((model) => {
        const id = str(model.name)?.replace(/^models\//, '');
        const methods: unknown[] = Array.isArray(model.supportedGenerationMethods) ? model.supportedGenerationMethods : [];
        if (!id || !methods.includes('generateContent') || GEMINI_NON_TEXT.test(id)) return [];
        return [modelInfo(id, str(model.displayName), undefined, positive(model.inputTokenLimit))];
      });
    case 'openrouter':
      return records(root?.data).flatMap((model) => {
        const id = str(model.id);
        const output: unknown = asRecord(model.architecture)?.output_modalities;
        const endpoints: unknown = model.endpoints;
        if (!id || id.endsWith(':batch') || !Array.isArray(output) || !output.includes('text')) return [];
        // `:batch` variants list only /api/v1/batches.
        if (Array.isArray(endpoints) && !endpoints.includes('/api/v1/chat/completions')) return [];
        return [modelInfo(id, str(model.name), undefined, positive(model.context_length))];
      });
  }
}

/**
 * Comment types a BYOK provider runs for an executor job: all but
 * `connections` (needs the vault, CLI only) and `chat` (interactive, never a job).
 */
export const BYOK_EXECUTOR_COMMENT_TYPES = [
  'summary',
  'factcheck',
  'critique',
  'keypoints',
  'sentiment',
  'translation',
  'translate-transcript',
  'glossary',
  'reformat',
  'custom',
  'research',
] as const;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

function records(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    const record = asRecord(item);
    return record ? [record] : [];
  });
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function modelInfo(
  id: string,
  label: string | undefined,
  webSearch: boolean | undefined,
  contextWindow: number | undefined,
): ByokModelInfo {
  return {
    id,
    ...(label ? { label } : {}),
    ...(webSearch === undefined ? {} : { webSearch }),
    ...(contextWindow ? { contextWindow } : {}),
  };
}
