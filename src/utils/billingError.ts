export const PAYWALL_REQUIRED_CODE = 'PAYWALL_REQUIRED';

export interface PaywallRequiredDetails {
  reason?: string;
  plan?: string;
  used?: number;
  limit?: number;
  resetAt?: string;
  offeringId?: string;
  entitlementId?: string;
  [key: string]: unknown;
}

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
  return typeof raw === 'number' ? raw : undefined;
}

function formatIsoDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
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
    const message = readString(error, 'message') ?? readString(readRecord(error, 'apiError'), 'message');
    if (message) return message;
  }
  return '';
}

export function getPaywallRequiredDetails(error: unknown): PaywallRequiredDetails | undefined {
  if (!isRecord(error)) return undefined;

  const details = readRecord(error, 'details') ?? readRecord(readRecord(error, 'apiError'), 'details');
  if (details) return details as PaywallRequiredDetails;

  return getPaywallRequiredDetails(error.cause);
}

export function isPaywallRequiredError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code === PAYWALL_REQUIRED_CODE) return true;

  const message = getErrorMessage(error).toLowerCase();
  if (
    message.includes('paywall_required') ||
    message.includes('paywall required') ||
    message.includes('monthly archive limit reached')
  ) {
    return true;
  }

  if (isRecord(error)) {
    const apiError = readRecord(error, 'apiError');
    if (apiError && isPaywallRequiredError(apiError)) return true;
    if (isPaywallRequiredError(error.cause)) return true;
  }

  return false;
}

export function formatPaywallRequiredMessage(error: unknown): string {
  const details = getPaywallRequiredDetails(error);
  const existingMessage = getErrorMessage(error).trim();
  if (!details && existingMessage.includes('Upgrade your Social Archiver plan')) {
    return existingMessage;
  }

  const used = readNumber(details, 'used');
  const limit = readNumber(details, 'limit');
  const resetAt = readString(details, 'resetAt');
  const quota = used !== undefined && limit !== undefined ? ` (${used}/${limit} used)` : '';
  const reset = formatIsoDate(resetAt);
  const resetText = reset ? ` Resets ${reset}.` : '';

  return `Monthly archive limit reached${quota}.${resetText} Upgrade your Social Archiver plan, then retry.`;
}
