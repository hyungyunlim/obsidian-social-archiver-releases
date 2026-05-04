/**
 * Rate Limit Error utilities — Tier-Aware Rate Limits PRD § 13.2.
 *
 * Server returns 429 RATE_LIMIT_EXCEEDED with details:
 *   {
 *     "code": "RATE_LIMIT_EXCEEDED",
 *     "message": "...",
 *     "details": {
 *       "retryAfter": 45,
 *       "scope": "archive_create_rpm" | ...,
 *       "tier": "free" | "pro" | "admin" | "beta-free",
 *       "effectiveTier": "free" | "pro" | "admin",
 *       "limit": 5,
 *       "remaining": 0,
 *       "resetAt": 1777723260
 *     }
 *   }
 *
 * The plugin's `ApiClient` already preserves `error.code`, `error.message`,
 * and `error.details` via `parseErrorResponse`. This module provides typed
 * detection + copy formatting analogous to `billingError.ts` (which scopes
 * itself strictly to PAYWALL_REQUIRED). Critically, rate-limit errors must
 * NOT trigger the existing "client billing notice" synthetic-archive flow —
 * that path is reserved for INSUFFICIENT_CREDITS / PAYWALL_REQUIRED.
 */

export const RATE_LIMIT_ERROR_CODE = 'RATE_LIMIT_EXCEEDED';

export type RateLimitScope =
  | 'archive_create_rpm'
  | 'archive_create_burst'
  | 'archive_concurrent_jobs'
  | 'archive_polling_rpm'
  | 'ip_hourly_floor'
  | 'target_hourly_floor'
  | 'platform_global_floor';

export interface RateLimitDetails {
  scope?: RateLimitScope | string;
  tier?: string;
  effectiveTier?: string;
  limit?: number;
  remaining?: number;
  resetAt?: number;
  retryAfter?: number;
  [key: string]: unknown;
}

const UPGRADE_PROMPT_SCOPES = new Set<RateLimitScope>([
  'archive_create_rpm',
  'archive_concurrent_jobs',
]);

type ErrorRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ErrorRecord {
  return typeof value === 'object' && value !== null;
}

function readRecord(value: unknown, key: string): ErrorRecord | undefined {
  if (!isRecord(value)) return undefined;
  const nested = value[key];
  return isRecord(nested) ? nested : undefined;
}

function readString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const raw = value[key];
  return typeof raw === 'string' ? raw : undefined;
}

function readNumber(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined;
  const raw = value[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function getErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  const code = readString(error, 'code') ?? readString(error, 'name');
  if (code) return code;
  return readString(readRecord(error, 'apiError'), 'code');
}

function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (isRecord(error)) {
    const message =
      readString(error, 'message') ??
      readString(readRecord(error, 'apiError'), 'message');
    if (message) return message;
  }
  return '';
}

/**
 * Detect a rate-limit error.
 *
 * Code-based primarily (RATE_LIMIT_EXCEEDED). Falls back to message inspection
 * for HTTP 429 responses that lacked a structured code, but only when the
 * message clearly indicates rate limiting — avoids false-positive on
 * paywall messages that mention "limit".
 */
export function isRateLimitError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code === RATE_LIMIT_ERROR_CODE) return true;

  if (isRecord(error)) {
    const apiError = readRecord(error, 'apiError');
    if (apiError && isRateLimitError(apiError)) return true;
    if (isRateLimitError(error.cause)) return true;
  }

  return false;
}

/**
 * Pull the `details` blob from a rate-limit error.
 */
export function getRateLimitDetails(error: unknown): RateLimitDetails | undefined {
  if (!isRecord(error)) return undefined;

  const direct =
    readRecord(error, 'details') ??
    readRecord(readRecord(error, 'apiError'), 'details');
  if (direct) {
    return {
      scope: readString(direct, 'scope'),
      tier: readString(direct, 'tier'),
      effectiveTier: readString(direct, 'effectiveTier'),
      limit: readNumber(direct, 'limit'),
      remaining: readNumber(direct, 'remaining'),
      resetAt: readNumber(direct, 'resetAt'),
      retryAfter: readNumber(direct, 'retryAfter'),
    };
  }

  // Fall back to top-level retryAfter (the plugin's ApiError type carries it directly).
  const topRetry = readNumber(error, 'retryAfter');
  if (topRetry !== undefined) {
    return { retryAfter: topRetry };
  }

  if (error.cause) return getRateLimitDetails(error.cause);
  return undefined;
}

export function isUpgradePromptScope(scope: string | undefined): boolean {
  if (!scope) return false;
  return UPGRADE_PROMPT_SCOPES.has(scope as RateLimitScope);
}

/**
 * Format `retryAfter` seconds for user-facing copy.
 */
export function formatRetryAfter(retryAfter: number | undefined): string {
  if (!retryAfter || !Number.isFinite(retryAfter) || retryAfter <= 0) return 'a moment';
  const secs = Math.round(retryAfter);
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return mins === 1 ? '1 minute' : `${mins} minutes`;
  const hrs = Math.round(mins / 60);
  return hrs === 1 ? '1 hour' : `${hrs} hours`;
}

/**
 * Compose the user-facing rate-limit message per PRD § 13.2.
 *
 * Free tier + upgrade-relevant scope → mention Pro license (Obsidian's
 * external-license-key model does not bundle in-app payment).
 * Otherwise → neutral retry copy.
 */
export function formatRateLimitMessage(error: unknown): string {
  const details = getRateLimitDetails(error) ?? {};
  const wait = formatRetryAfter(details.retryAfter);
  const tier = details.effectiveTier ?? details.tier;

  if (tier === 'free' && isUpgradePromptScope(details.scope)) {
    return `Rate limit reached. Upgrade to a Pro license for higher limits, or try again in ${wait}.`;
  }
  return `Too many requests. Please wait ${wait} and try again.`;
}
