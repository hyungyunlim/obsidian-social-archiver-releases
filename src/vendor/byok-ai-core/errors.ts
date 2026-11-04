/**
 * Every provider failure as one error type with a code clients localize.
 * A ByokError never carries the key or any request header: its message always
 * goes through redactSecrets, and nothing else from the request is copied in.
 */
import type { ByokProviderId } from './providers';
import { BYOK_PROVIDERS } from './providers';

export type ByokErrorCode =
  | 'invalid_key'
  | 'insufficient_credit'
  | 'rate_limited'
  | 'model_not_found'
  | 'region_blocked'
  | 'content_blocked'
  | 'context_too_long'
  | 'provider_unavailable'
  | 'network'
  | 'cancelled'
  | 'unknown';

export interface ByokErrorOptions {
  provider?: ByokProviderId | undefined;
  status?: number | undefined;
  retryAfterSeconds?: number | undefined;
  hint?: 'invalid_key_maybe' | undefined;
}

export class ByokError extends Error {
  readonly code: ByokErrorCode;
  readonly provider?: ByokProviderId;
  /** HTTP status of the provider's answer; absent for network failures and in-stream errors. */
  readonly status?: number;
  readonly retryAfterSeconds?: number;
  /**
   * The browser hid the provider's answer (Anthropic sends its 4xx without CORS
   * headers), so a bad key is a likely cause of this network error.
   */
  readonly hint?: 'invalid_key_maybe';

  constructor(code: ByokErrorCode, message: string, options: ByokErrorOptions = {}) {
    super(redactSecrets(message));
    this.name = 'ByokError';
    this.code = code;
    if (options.provider) this.provider = options.provider;
    if (options.status) this.status = options.status;
    if (options.retryAfterSeconds !== undefined) this.retryAfterSeconds = options.retryAfterSeconds;
    if (options.hint) this.hint = options.hint;
  }
}

const SECRETS: readonly RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{8,}/g,
  /\bsk-or-[A-Za-z0-9_-]{8,}/g,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\bBearer\s+\S+/gi,
  /\b(?:x-goog-api-key|x-api-key)["']?\s*[:=]\s*["']?[^\s"']+/gi,
];

/** Key-shaped text (all four providers' formats, auth headers) → `[redacted]`. */
export function redactSecrets(text: string): string {
  return SECRETS.reduce((out, pattern) => out.replace(pattern, '[redacted]'), text);
}

export function isModelGoneError(error: unknown): boolean {
  return error instanceof ByokError && error.code === 'model_not_found';
}

/** Executor `/fail` payload for a BYOK failure (plan §2.8). */
export function byokErrorToJobErrorCode(code: ByokErrorCode): { errorCode: string; retryable: boolean } {
  switch (code) {
    case 'invalid_key':
      return { errorCode: 'PROVIDER_AUTH_REQUIRED', retryable: false };
    case 'insufficient_credit':
      return { errorCode: 'PROVIDER_QUOTA_EXCEEDED', retryable: false };
    case 'rate_limited':
      return { errorCode: 'PROVIDER_RATE_LIMITED', retryable: true };
    case 'model_not_found':
      return { errorCode: 'PROVIDER_MISSING', retryable: false };
    case 'region_blocked':
    case 'content_blocked':
      return { errorCode: 'PROVIDER_REFUSED', retryable: false };
    case 'context_too_long':
      return { errorCode: 'CONTENT_TOO_LONG', retryable: false };
    case 'provider_unavailable':
    case 'network':
      return { errorCode: 'PROVIDER_UNAVAILABLE', retryable: true };
    case 'cancelled':
      return { errorCode: 'PROCESS_CANCELLED', retryable: false };
    case 'unknown':
      return { errorCode: 'UNKNOWN', retryable: false };
  }
}

interface ErrorDetail {
  message: string;
  /** Lower-cased type, code, status and reason (machine-readable fields only). */
  codes: string;
  /** `codes` plus the lower-cased message. */
  text: string;
  /** OpenRouter `error.metadata.limit_source`. */
  limitSource: string;
  /** Gemini RetryInfo `retryDelay`, in seconds. */
  retryDelay?: number;
}

/**
 * A provider's error answer (HTTP status + body text, or status 200 with the
 * body of an in-stream error event) → ByokError. Covers PRD §5.4 and the
 * model-gone shapes of plan §2.8; anything unrecognised falls back on the status.
 */
export function normalizeProviderError(
  provider: ByokProviderId,
  status: number,
  body: string,
  headers?: Record<string, string>,
): ByokError {
  const detail = errorDetail(body);
  const label = BYOK_PROVIDERS[provider].label;
  const message = detail.message || (status >= 300 ? `${label} answered HTTP ${status}.` : `${label} reported an error.`);
  return new ByokError(classify(provider, status, detail), message, {
    provider,
    status: status >= 300 ? status : undefined,
    retryAfterSeconds: retryAfter(headers) ?? detail.retryDelay,
  });
}

function classify(provider: ByokProviderId, status: number, detail: ErrorDetail): ByokErrorCode {
  if (/context[ _-]?(?:length|limit)|context window|prompt is too long|input token count|maximum context|request_too_large/.test(detail.text)) {
    return 'context_too_long';
  }
  if (isModelGone(provider, status, detail.text)) return 'model_not_found';
  return PROVIDER_RULES[provider](status, detail) ?? byStatus(status, detail.codes);
}

/**
 * Per provider, because the same words mean different things: an OpenAI or
 * Gemini rate-limit message can mention billing, so credit is read from codes
 * (OpenAI) or gated on status (Gemini), never from free text alone.
 */
const PROVIDER_RULES: Readonly<
  Record<ByokProviderId, (status: number, detail: ErrorDetail) => ByokErrorCode | undefined>
> = {
  openai(status, { text, codes }) {
    if (/insufficient_quota|credit_balance|spend_limit|usage_limit|billing/.test(codes)) return 'insufficient_credit';
    if (status === 401) return 'invalid_key';
    if (status === 403) return /country|region|territor/.test(text) ? 'region_blocked' : 'invalid_key';
    if (/content_policy|invalid_prompt|bio_policy|misalignment|safety/.test(codes)) return 'content_blocked';
    if (status === 429 || /rate_limit|slow_down/.test(codes)) return 'rate_limited';
    return undefined;
  },
  anthropic(status, { text, codes }) {
    // An org that bars browser calls (ZDR etc.): no key change fixes it.
    if (/cors requests are not allowed/.test(text)) return 'unknown';
    if (status === 402 || /billing_error/.test(codes) || /credit balance|spend (?:limit|cap)|usage limit/.test(text)) {
      return 'insufficient_credit';
    }
    if (status === 401 || /authentication_error/.test(codes)) return 'invalid_key';
    if (status === 403 || /permission_error|forbidden/.test(codes)) {
      return /request not allowed|country|region|territor/.test(text) ? 'region_blocked' : 'invalid_key';
    }
    if (status === 429 || /rate_limit_error/.test(codes)) return 'rate_limited';
    if (/overloaded_error|api_error|timeout_error/.test(codes)) return 'provider_unavailable';
    return undefined;
  },
  gemini(status, { text, codes }) {
    if (status === 429 || /resource_exhausted|rate_limit_exceeded|quota_exceeded|too_many_requests/.test(codes)) {
      return 'rate_limited';
    }
    if (status === 402 || /payment_required/.test(codes)) return 'insufficient_credit';
    if (status === 401 || /api key not valid|api_key_invalid|api key expired|api_key_expired|authentication|unauthenticated/.test(text)) {
      return 'invalid_key';
    }
    if (/location is not supported|country|region|territor/.test(text)) return 'region_blocked';
    if ((status === 400 || status === 403) && /billing|prepay|credit/.test(text)) return 'insufficient_credit';
    if (status === 403 || /permission_denied/.test(codes)) return 'invalid_key';
    if (/safety|recitation|prohibited_content|blocklist|spii|content_blocked|\blanguage\b/.test(codes)) return 'content_blocked';
    if (status === 499 || /\bcancelled\b/.test(codes)) return 'cancelled';
    return undefined;
  },
  openrouter(status, { text, limitSource }) {
    if (limitSource === 'openrouter_in_flight_budget') return 'rate_limited'; // wait for Retry-After
    if (status === 402 || limitSource !== '' || (status === 403 && /budget/.test(text))) return 'insufficient_credit';
    if (status === 401) return 'invalid_key';
    if (status === 403) return /country|region|territor/.test(text) ? 'region_blocked' : 'content_blocked'; // moderation, guardrails
    return undefined;
  },
};

function byStatus(status: number, codes: string): ByokErrorCode {
  if (status === 401 || status === 403) return 'invalid_key';
  if (status === 402) return 'insufficient_credit';
  if (status === 413) return 'context_too_long';
  if (status === 429 || /rate_limit/.test(codes)) return 'rate_limited';
  if (status === 408 || status >= 500 || /server_error|api_error|overloaded|unavailable|internal|timeout|deadline_exceeded/.test(codes)) {
    return 'provider_unavailable';
  }
  return 'unknown';
}

function isModelGone(provider: ByokProviderId, status: number, text: string): boolean {
  if (/model_not_found|unsupported_model/.test(text)) return true;
  switch (provider) {
    case 'openai':
    case 'anthropic':
      return (status === 404 || /not_found_error/.test(text)) && /model/.test(text);
    case 'gemini':
      return (status === 404 && /model/.test(text)) || /not supported for generatecontent|is not found for api version/.test(text);
    case 'openrouter':
      return (
        (status === 400 || status === 404) &&
        !/data policy/.test(text) &&
        /not a valid model|no endpoints found|model[^.]* not found|unknown model/.test(text)
      );
  }
}

function errorDetail(body: string): ErrorDetail {
  let root: unknown;
  try {
    root = JSON.parse(body);
  } catch {
    // Not JSON: a proxy page or plain text. HTML says nothing useful.
    const plain = body.trim().startsWith('<') ? '' : body.replace(/\s+/g, ' ').trim().slice(0, 300);
    return { message: plain, codes: '', text: plain.toLowerCase(), limitSource: '' };
  }
  const outer = asRecord(root);
  // OpenAI/Anthropic/Gemini/OpenRouter nest the details under `error`; OpenAI stream `error` events do not.
  const error = asRecord(outer?.error) ?? outer ?? {};
  const details = Array.isArray(error.details) ? error.details.map(asRecord) : [];
  const reason = details.map((item) => str(item?.reason)).find(Boolean) ?? '';
  const delay = details.map((item) => str(item?.retryDelay)).find(Boolean);
  const metadata = asRecord(error.metadata);
  const message = (str(error.message) ?? '').slice(0, 500);
  const code = typeof error.code === 'number' ? '' : (str(error.code) ?? '');
  const codes = [str(error.type), code, str(error.status), reason].filter(Boolean).join(' ').toLowerCase();
  const seconds = delay ? Number.parseFloat(delay) : Number.NaN;
  return {
    message,
    codes,
    text: `${codes} ${message.toLowerCase()}`,
    limitSource: str(metadata?.limit_source) ?? '',
    ...(Number.isFinite(seconds) ? { retryDelay: Math.ceil(seconds) } : {}),
  };
}

function retryAfter(headers: Record<string, string> | undefined): number | undefined {
  if (!headers) return undefined;
  const value = Object.entries(headers).find(([name]) => name.toLowerCase() === 'retry-after')?.[1]?.trim();
  if (!value) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.ceil(Number(value));
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}
