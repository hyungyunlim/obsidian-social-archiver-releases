/**
 * isPaidPlan — gating for quota-consuming conveniences (clip auto-upload,
 * PRD Phase C). Paid = any plan other than free/beta-free, and only while
 * authenticated.
 */

import { describe, it, expect } from 'vitest';
import { isPaidPlan } from '@/utils/auth';
import type SocialArchiverPlugin from '@/main';
import type { BillingUsageSummary } from '@/types/settings';

function makePlugin(settings: {
  isVerified?: boolean;
  authToken?: string;
  tier?: string;
  billingUsage?: Pick<BillingUsageSummary, 'plan'>;
}): SocialArchiverPlugin {
  return {
    settings: {
      isVerified: settings.isVerified ?? true,
      authToken: settings.authToken ?? 'token',
      tier: settings.tier ?? 'free',
      billingUsage: settings.billingUsage,
    },
  } as unknown as SocialArchiverPlugin;
}

describe('isPaidPlan', () => {
  it('returns false while logged out, regardless of plan', () => {
    expect(isPaidPlan(makePlugin({ authToken: '', tier: 'pro' }))).toBe(false);
    expect(isPaidPlan(makePlugin({ isVerified: false, tier: 'pro' }))).toBe(false);
  });

  it('returns false for free and beta-free plans', () => {
    expect(isPaidPlan(makePlugin({ billingUsage: { plan: 'free' } }))).toBe(false);
    expect(isPaidPlan(makePlugin({ billingUsage: { plan: 'beta-free' } }))).toBe(false);
    expect(isPaidPlan(makePlugin({ tier: 'free' }))).toBe(false);
    expect(isPaidPlan(makePlugin({ tier: 'beta-free' }))).toBe(false);
  });

  it('returns true for paid plans', () => {
    expect(isPaidPlan(makePlugin({ billingUsage: { plan: 'premium' } }))).toBe(true);
    expect(isPaidPlan(makePlugin({ billingUsage: { plan: 'lifetime' } }))).toBe(true);
    expect(isPaidPlan(makePlugin({ billingUsage: { plan: 'admin' } }))).toBe(true);
    expect(isPaidPlan(makePlugin({ tier: 'pro' }))).toBe(true);
    expect(isPaidPlan(makePlugin({ tier: 'admin' }))).toBe(true);
  });

  it('prefers the billing usage snapshot over the legacy tier', () => {
    // Ledger says free — legacy tier must not unlock the gate.
    expect(
      isPaidPlan(makePlugin({ tier: 'pro', billingUsage: { plan: 'free' } })),
    ).toBe(false);
    expect(
      isPaidPlan(makePlugin({ tier: 'free', billingUsage: { plan: 'premium' } })),
    ).toBe(true);
  });
});
