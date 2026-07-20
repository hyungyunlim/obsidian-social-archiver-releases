import { describe, expect, it } from 'vitest';
import { getCloudCreditBreakdown, resolveCloudCreditQuota } from '@/services/CloudCreditUsage';
import type { BillingUsageResponse } from '@/services/WorkersAPIClient';

const quota = {
  period: '2026-07',
  used: 3,
  reserved: 1,
  limit: 50,
  remaining: 46,
  resetAt: '2026-08-01T00:00:00.000Z',
  unlimited: false,
  breakdown: [
    { actionType: 'comment.summary', used: 2, reserved: 1 },
    { actionType: 'maps.google_text_search', used: 1, reserved: 0 },
  ],
} as const;

describe('CloudCreditUsage', () => {
  it('prefers the new Cloud-credit quota while accepting the legacy AI alias', () => {
    // Given: both aliases are returned during the compatibility window.
    const usage = { cloudCreditQuota: quota, aiActionQuota: { ...quota, remaining: 1 } } as BillingUsageResponse;

    // When: the single visible balance is resolved.
    const resolved = resolveCloudCreditQuota(usage);

    // Then: the canonical balance wins and no second balance is created.
    expect(resolved?.remaining).toBe(46);
  });

  it('falls back to old aiActionQuota responses and groups AI and Google usage', () => {
    // Given: an older Worker response only has the compatibility alias.
    const usage = { aiActionQuota: quota } as BillingUsageResponse;

    // When: the visible quota and breakdown are derived.
    const resolved = resolveCloudCreditQuota(usage);
    const breakdown = getCloudCreditBreakdown(resolved);

    // Then: one balance exposes an AI/Google split.
    expect(resolved?.remaining).toBe(46);
    expect(breakdown).toEqual({
      ai: { used: 2, reserved: 1 },
      googleMaps: { used: 1, reserved: 0 },
    });
  });
});
