import { describe, expect, it } from 'vitest';
import {
  formatPaywallRequiredMessage,
  getPaywallRequiredDetails,
  isPaywallRequiredError,
} from '@/utils/billingError';

describe('billingError utilities', () => {
  it('detects PAYWALL_REQUIRED by server error code', () => {
    const error = Object.assign(new Error('Monthly archive limit reached'), {
      code: 'PAYWALL_REQUIRED',
      status: 402,
      details: {
        reason: 'archive_quota_exceeded',
        used: 10,
        limit: 10,
        resetAt: '2026-05-01T00:00:00.000Z',
      },
    });

    expect(isPaywallRequiredError(error)).toBe(true);
    expect(getPaywallRequiredDetails(error)).toMatchObject({
      reason: 'archive_quota_exceeded',
      used: 10,
      limit: 10,
      resetAt: '2026-05-01T00:00:00.000Z',
    });
  });

  it('detects PAYWALL_REQUIRED through nested apiError and cause', () => {
    const cause = {
      apiError: {
        code: 'PAYWALL_REQUIRED',
        message: 'Monthly archive limit reached',
        details: { used: 10, limit: 10, resetAt: '2026-05-01T00:00:00.000Z' },
      },
    };
    const wrapped = new Error('Failed to archive post');
    wrapped.cause = cause;

    expect(isPaywallRequiredError(wrapped)).toBe(true);
    expect(formatPaywallRequiredMessage(wrapped)).toBe(
      'Monthly archive limit reached (10/10 used). Resets 2026-05-01. Upgrade your Social Archiver plan, then retry.'
    );
  });

  it('does not classify generic 402 credit errors as paywall required', () => {
    const error = Object.assign(new Error('Insufficient credits'), {
      code: 'INSUFFICIENT_CREDITS',
      status: 402,
    });

    expect(isPaywallRequiredError(error)).toBe(false);
  });
});
