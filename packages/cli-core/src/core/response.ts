/**
 * CliResponse — single-responsibility module for:
 *   - Building the standard CLI response envelope (success/error).
 *   - Mapping error codes to a `retryable` flag.
 *   - Recursive redaction of sensitive fields prior to serialization.
 *   - Formatting envelopes as JSON or short human-readable text.
 *
 * Host-agnostic: this module has ZERO dependencies on Obsidian, Tauri,
 * plugin/desktop services, or settings reads. It is the canonical home of the
 * CLI response contract shared by every host adapter.
 *
 * Ported verbatim from `src/plugin/cli/CliResponse.ts` (Obsidian plugin) as the
 * shared `cli-core` contract per docs/specs/desktop-cli-agent-skill-prd.md §6.
 */

// -----------------------------------------------------------------------------
// Error codes
// -----------------------------------------------------------------------------

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
 *
 * NOTE: the desktop CLI wording will likely diverge from the plugin's ("apply a
 * license key in plugin settings") — see PRD Open Questions. Kept identical for
 * now so cli-core stays a single source of truth.
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
 * Build a success envelope. Caller passes the current host version so this
 * module stays decoupled from any specific host.
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
 * Build an error envelope. `code` should be one of `ErrorCode.*`. Unknown
 * codes are accepted (forward-compat) but receive `retryable: false` by default.
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
    envelope.error.details = redact(opts.details);
  }
  if (opts.warnings && opts.warnings.length > 0) {
    envelope.warnings = opts.warnings;
  }
  return envelope;
}

// -----------------------------------------------------------------------------
// Redaction
// -----------------------------------------------------------------------------

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
const SENSITIVE_KEY_SUFFIXES = ['Token', 'Cookie', 'Password', 'Secret', 'ApiKey', 'Bearer', 'Authorization'];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SENSITIVE_KEY_EXACT.has(lower)) return true;
  for (const suffix of SENSITIVE_KEY_SUFFIXES) {
    const suffixLower = suffix.toLowerCase();
    if (lower.length > suffixLower.length && lower.endsWith(suffixLower)) {
      const idx = key.length - suffix.length;
      if (idx <= 0) continue;
      const prev = key[idx - 1];
      const here = key[idx];
      if (prev === undefined || here === undefined) continue;
      if (prev === '_' || prev === '-' || prev === '.') return true;
      if (prev >= 'a' && prev <= 'z' && here >= 'A' && here <= 'Z') return true;
      if (lower === suffixLower) return true;
    }
  }
  return false;
}

const JWT_PATTERN = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._\-+/=]+/gi;
const OPAQUE_TOKEN_PATTERN = /\b[A-Za-z0-9_\-+/=]{40,}\b/g;

const REDACTED = '[REDACTED]';
const REDACTED_BARE = REDACTED.replace(/[[\]]/g, '');

/**
 * Keys whose values are known to be non-secret identifiers or pagination
 * cursors. Their string values skip the opaque-token catch-all so legitimate
 * long ids round-trip intact — most importantly the `aicj_<uuid>` job id
 * returned by `ai-comment`, which downstream agents must read to poll
 * `job --id <jobId>`. base64 pagination cursors (which are shape-identical to
 * secrets and so cannot be spared by value inspection alone) are handled here
 * too.
 *
 * This is checked AFTER `isSensitiveKey`, and none of these keys are sensitive,
 * so a value that genuinely belongs under a sensitive key name (e.g. `authToken`)
 * is never reached by this branch. Bearer/JWT/absolute-path scrubbing still runs
 * on these values; only the broad "any long opaque string" rule is skipped.
 */
const SAFE_ID_KEYS = new Set(
  [
    'id',
    'jobId',
    'batchJobId',
    'parentJobId',
    'archiveId',
    'clientId',
    'targetClientId',
    'subscriptionId',
    'runId',
    'postId',
    'requestId',
    'messageId',
    'commentId',
    'relationId',
    'cursor',
    'nextCursor',
    'prevCursor',
  ].map((k) => k.toLowerCase()),
);

function isSafeIdKey(key: string): boolean {
  return SAFE_ID_KEYS.has(key.toLowerCase());
}

// Standard, non-secret identifier shapes that the opaque-token catch-all must
// NOT scrub even under an unrecognized key: UUIDs, UUIDs with a short non-secret
// prefix (e.g. the `aicj_` on AI-comment job ids), and pure hex digests (content
// hashes, dedup hashes, etc.). Secrets that happen to be UUID-shaped (e.g. a
// `crypto.randomUUID()` claim token) are protected by `isSensitiveKey` via their
// `*Token`/`*Secret` key name, not by value shape, so excluding these here does
// not weaken key-based redaction.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIXED_UUID_PATTERN =
  /^[A-Za-z][A-Za-z0-9]*[._-][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_DIGEST_PATTERN = /^[0-9a-f]+$/i;

function isStandardIdentifier(token: string): boolean {
  return UUID_PATTERN.test(token) || PREFIXED_UUID_PATTERN.test(token) || HEX_DIGEST_PATTERN.test(token);
}

/**
 * Recursively redact sensitive values inside an arbitrary structure. Returns a
 * deep-cloned, scrubbed copy — the input is never mutated.
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
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) {
        out[k] = REDACTED;
      } else if (isSafeIdKey(k) && typeof v === 'string') {
        out[k] = redactString(v, { skipOpaque: true });
      } else {
        out[k] = redactInternal(v, seen);
      }
    }
    return out;
  }

  return value;
}

function redactString(input: string, opts: { skipOpaque?: boolean } = {}): string {
  let out = input;
  out = out.replace(BEARER_PATTERN, `Bearer ${REDACTED}`);
  out = out.replace(JWT_PATTERN, REDACTED);
  // Absolute paths under typical user homes — collapse rather than echo.
  out = out.replace(/(?:^|\s)(\/(?:Users|home)\/[^\s'"]+|[A-Z]:\\Users\\[^\s'"]+)/g, ' <absolute>');
  // The opaque-token catch-all is intentionally skipped for known-safe id keys
  // (see SAFE_ID_KEYS) whose values are non-secret identifiers/cursors.
  if (opts.skipOpaque) return out;
  // Very long opaque tokens last (don't double-process anything already redacted,
  // and leave standard identifiers — UUIDs, prefixed ids, hex digests — intact so
  // legitimate long ids are not mistaken for secrets).
  out = out.replace(OPAQUE_TOKEN_PATTERN, (match) => {
    if (match === REDACTED_BARE) return match;
    if (isStandardIdentifier(match)) return match;
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
 * Serialize an envelope for output. JSON is pretty-printed; text mode produces
 * a single short line (<=200 chars) summary.
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
  const keys = ['jobId', 'status', 'platform', 'filePath', 'subscriptionId', 'batchJobId', 'username', 'store'];
  for (const k of keys) {
    const value = obj[k];
    if (value !== undefined && value !== null) {
      const text = summarizePrimitive(value);
      if (text) parts.push(`${k}=${text}`);
    }
    if (parts.length >= 4) break;
  }
  return parts.join(' ');
}

function summarizePrimitive(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}
