/**
 * CliResponse — single-responsibility module for:
 *   - Building the standard CLI response envelope (success/error).
 *   - Mapping error codes to a `retryable` flag.
 *   - Recursive redaction of sensitive fields prior to serialization.
 *   - Formatting envelopes as JSON or short human-readable text.
 *
 * This module must remain free of dependencies on Obsidian, plugin
 * services, and settings reads. Redaction must work even if the plugin
 * is half-initialized.
 */

// -----------------------------------------------------------------------------
// Error codes
// -----------------------------------------------------------------------------

/**
 * Reserved CLI error codes. Mirrors the table in
 * `docs/specs/obsidian-cli-agent-skill-prd.md` §"Standard response envelope".
 */
export const ErrorCode = {
  CLI_UNAVAILABLE: 'CLI_UNAVAILABLE',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  UNSUPPORTED_PLATFORM: 'UNSUPPORTED_PLATFORM',
  SERVICE_NOT_READY: 'SERVICE_NOT_READY',
  PAYWALL_REQUIRED: 'PAYWALL_REQUIRED',
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
  RATE_LIMITED: 'RATE_LIMITED',
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
  DOC_ID_STALE: 'DOC_ID_STALE',
  OPERATION_FAILED: 'OPERATION_FAILED',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Whether each error code is safe for an agent to retry. Used to populate
 * `error.retryable` so agents have a uniform signal regardless of which
 * handler produced the response.
 */
export const RETRYABLE_BY_CODE: Readonly<Record<ErrorCodeValue, boolean>> = Object.freeze({
  [ErrorCode.CLI_UNAVAILABLE]: false,
  [ErrorCode.AUTH_REQUIRED]: false,
  [ErrorCode.INVALID_ARGUMENT]: false,
  [ErrorCode.UNSUPPORTED_PLATFORM]: false,
  [ErrorCode.SERVICE_NOT_READY]: true,
  [ErrorCode.PAYWALL_REQUIRED]: false,
  [ErrorCode.INSUFFICIENT_CREDITS]: false,
  [ErrorCode.RATE_LIMITED]: true,
  [ErrorCode.JOB_NOT_FOUND]: false,
  [ErrorCode.NETWORK_ERROR]: true,
  [ErrorCode.TIMEOUT_ERROR]: true,
  [ErrorCode.CIRCUIT_OPEN]: true,
  [ErrorCode.DOC_ID_STALE]: true,
  // OPERATION_FAILED is generic; callers may override with `retryable` opt.
  [ErrorCode.OPERATION_FAILED]: false,
});

/**
 * Billing fallback message. Re-used by handlers that surface
 * `INSUFFICIENT_CREDITS` or `PAYWALL_REQUIRED` so wording stays consistent
 * with `CLAUDE_MEMORIZE.md` §"Billing Fallback 운영 규칙".
 */
export const BILLING_FALLBACK_MESSAGE =
  'Insufficient credits. Upgrade or restore via the mobile app using the same account, or apply a license key in plugin settings.';

// -----------------------------------------------------------------------------
// Envelope shapes
// -----------------------------------------------------------------------------

export interface CliResponseSuccess<T> {
  ok: true;
  command: string;
  version: string;
  data: T;
  warnings?: string[];
}

export interface CliResponseError {
  ok: false;
  command: string;
  version: string;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
  warnings?: string[];
}

export type CliResponse<T> = CliResponseSuccess<T> | CliResponseError;

// -----------------------------------------------------------------------------
// Builders
// -----------------------------------------------------------------------------

export interface OkOptions {
  warnings?: string[];
}

export interface ErrOptions {
  /** Override the default `retryable` mapping for this code. */
  retryable?: boolean;
  /** Optional structured details. Will be redacted before serialization. */
  details?: Record<string, unknown>;
  warnings?: string[];
}

/**
 * Build a success envelope.
 *
 * Caller is responsible for passing the current plugin version (typically
 * `plugin.manifest.version`) so this module stays decoupled from Obsidian.
 */
export function ok<T>(
  command: string,
  version: string,
  data: T,
  opts: OkOptions = {},
): CliResponseSuccess<T> {
  const envelope: CliResponseSuccess<T> = {
    ok: true,
    command,
    version,
    data,
  };
  if (opts.warnings && opts.warnings.length > 0) {
    envelope.warnings = opts.warnings;
  }
  return envelope;
}

/**
 * Build an error envelope.
 *
 * `code` should be one of `ErrorCode.*`. Unknown codes are accepted (for
 * forward-compat) but receive `retryable: false` by default.
 */
export function err(
  command: string,
  version: string,
  code: string,
  message: string,
  opts: ErrOptions = {},
): CliResponseError {
  const known = (RETRYABLE_BY_CODE as Record<string, boolean | undefined>)[code];
  const retryable = opts.retryable ?? known ?? false;
  const envelope: CliResponseError = {
    ok: false,
    command,
    version,
    error: {
      code,
      message: truncate(message, 500),
      retryable,
    },
  };
  if (opts.details) {
    envelope.error.details = redact(opts.details) as Record<string, unknown>;
  }
  if (opts.warnings && opts.warnings.length > 0) {
    envelope.warnings = opts.warnings;
  }
  return envelope;
}

// -----------------------------------------------------------------------------
// Redaction
// -----------------------------------------------------------------------------

// Match sensitive credential keys (case-insensitive). Two policies:
//
//   1. Exact-match well-known credential names (e.g. `authToken`,
//      `Authorization`, `cookie`, `password`, `naverCookie`).
//   2. Suffix match for compound camelCase keys like `accessToken`,
//      `refreshToken`, `apiKey`, `userSecret`, `sessionCookie`.
//
// We use an explicit allow-list rather than a naive `^auth` prefix so
// innocent keys like `authenticated`, `authorized`, or `tokenizer` are
// NOT redacted.
const SENSITIVE_KEY_EXACT = new Set(
  [
    'auth',
    'authtoken',
    'authorization',
    'cookie',
    'cookies',
    'password',
    'apikey',
    'api_key',
    'api-key',
    'secret',
    'bearer',
    'navercookie',
    'token', // bare key only
  ].map((k) => k.toLowerCase()),
);
// Endings (case-insensitive). Match keys ending with these credential nouns
// when they appear at the tail of a compound identifier.
const SENSITIVE_KEY_SUFFIXES = ['Token', 'Cookie', 'Password', 'Secret', 'ApiKey', 'Bearer', 'Authorization'];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SENSITIVE_KEY_EXACT.has(lower)) return true;
  for (const suffix of SENSITIVE_KEY_SUFFIXES) {
    const suffixLower = suffix.toLowerCase();
    if (lower.length > suffixLower.length && lower.endsWith(suffixLower)) {
      // Require the suffix boundary to be a real word boundary — the
      // character right before the suffix must be a separator
      // (`_`, `-`, `.`) or an uppercase letter (camelCase). This stops
      // false positives like `mistoken`/`recookie`.
      const idx = key.length - suffix.length;
      if (idx <= 0) continue;
      const prev = key[idx - 1];
      const here = key[idx];
      if (prev === undefined || here === undefined) continue;
      if (prev === '_' || prev === '-' || prev === '.') return true;
      if (prev >= 'a' && prev <= 'z' && here >= 'A' && here <= 'Z') return true;
      // Whole-word match: if the entire key equals the suffix.
      if (lower === suffixLower) return true;
    }
  }
  return false;
}

// JWT-ish (three base64url groups separated by dots).
const JWT_PATTERN = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
// `Bearer <token>` form.
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._\-+/=]+/gi;
// Very long opaque tokens (32+ chars, alphanumeric + URL-safe + base64 chars)
// but only when surrounded by non-word boundaries — minimize false positives
// against normal sentences.
const OPAQUE_TOKEN_PATTERN = /\b[A-Za-z0-9_\-+/=]{40,}\b/g;

const REDACTED = '[REDACTED]';

/**
 * Recursively redact sensitive values inside an arbitrary structure. Returns
 * a deep-cloned, scrubbed copy — the input is never mutated.
 *
 * Rules:
 *   - Keys matching `SENSITIVE_KEY_PATTERN` → value becomes `[REDACTED]`.
 *   - String values matching JWT / `Bearer …` / long opaque token patterns
 *     are partially replaced with `[REDACTED]`.
 *   - Absolute filesystem paths that look like a user home directory are
 *     collapsed to `<absolute>` (callers can pass `verbose=true` to bypass
 *     by stripping the redact call entirely).
 */
export function redact<T>(value: T): T {
  return redactInternal(value, new WeakSet()) as T;
}

function redactInternal(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint' || typeof value === 'symbol') return value;
  if (typeof value === 'function') return undefined;

  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    return value.map((item) => redactInternal(item, seen));
  }

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
    };
  }

  if (typeof value === 'object') {
    if (seen.has(value as object)) return '[Circular]';
    seen.add(value as object);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = redactInternal(v, seen);
      }
    }
    return out;
  }

  return value;
}

function redactString(input: string): string {
  let out = input;
  out = out.replace(BEARER_PATTERN, `Bearer ${REDACTED}`);
  out = out.replace(JWT_PATTERN, REDACTED);
  // Absolute paths under typical user homes — collapse rather than echo.
  // /Users/foo/..., /home/foo/..., C:\Users\foo\... patterns.
  out = out.replace(/(?:^|\s)(\/(?:Users|home)\/[^\s'"]+|[A-Z]:\\Users\\[^\s'"]+)/g, ' <absolute>');
  // Very long opaque tokens last (don't double-process anything already redacted).
  out = out.replace(OPAQUE_TOKEN_PATTERN, (match) => {
    // Skip already-redacted markers and obvious URLs.
    if (match === REDACTED.replace(/[[\]]/g, '')) return match;
    return REDACTED;
  });
  return out;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

// -----------------------------------------------------------------------------
// Formatting
// -----------------------------------------------------------------------------

export type CliFormat = 'json' | 'text';

/**
 * Serialize an envelope for output. JSON is pretty-printed for human
 * readability; text mode produces a single short line (<=200 chars) summary.
 */
export function format<T>(response: CliResponse<T>, mode: CliFormat = 'json'): string {
  if (mode === 'text') return formatText(response);
  // JSON: redact one more time at the boundary as a safety net.
  const scrubbed = redact(response);
  return JSON.stringify(scrubbed, null, 2);
}

function formatText<T>(response: CliResponse<T>): string {
  if (response.ok) {
    const summary = summarizeData(response.data);
    const line = `OK ${response.command}${summary ? `: ${summary}` : ''}`;
    return truncate(line, 200);
  }
  const e = response.error;
  const line = `ERR ${response.command} ${e.code}: ${e.message}`;
  return truncate(line, 200);
}

function summarizeData<T>(data: T): string {
  if (data === null || data === undefined) return '';
  if (typeof data !== 'object') return String(data);
  const parts: string[] = [];
  const obj = data as Record<string, unknown>;
  const keys = ['jobId', 'status', 'platform', 'filePath', 'subscriptionId', 'batchJobId', 'username', 'vault'];
  for (const k of keys) {
    if (k in obj && obj[k] !== undefined && obj[k] !== null) {
      parts.push(`${k}=${String(obj[k])}`);
    }
    if (parts.length >= 4) break;
  }
  return parts.join(' ');
}
