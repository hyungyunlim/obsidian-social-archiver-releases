/**
 * billingEventNoticer — high-severity Notice dedupe.
 *
 * PRD: `.taskmaster/docs/prd-billing-lifecycle-notifications-plugin.md` §6.1,
 *      §6.4.
 */

import { describe, it, expect } from 'vitest';
import { createBillingEventNoticer } from '@/plugin/billing/billingEventNoticer';
import type {
  BillingEventApiPayload,
  BillingEventType,
} from '@/types/billing-events';

function makeEvent(
  type: BillingEventType,
  overrides: Partial<BillingEventApiPayload> = {},
): BillingEventApiPayload {
  return {
    id: overrides.id ?? `evt-${type}`,
    type,
    severity: 'error',
    state: 'active',
    priority: 100,
    title: 't',
    body: 'b',
    cta: { action: 'update_and_pay_in_mobile', label: 'Update' },
    payload: {},
    dismissible: false,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('billingEventNoticer', () => {
  it('shows once for high-severity active billing_issue', () => {
    const noticer = createBillingEventNoticer();
    const event = makeEvent('billing_issue');
    expect(noticer.shouldShow(event)).toBe(true);
    noticer.markShown(event.id);
    expect(noticer.shouldShow(event)).toBe(false);
  });

  it('shows for plan_revoked and trial_expiring_soon (high severity)', () => {
    const noticer = createBillingEventNoticer();
    expect(noticer.shouldShow(makeEvent('plan_revoked', { id: 'r1' }))).toBe(true);
    expect(noticer.shouldShow(makeEvent('trial_expiring_soon', { id: 't1' }))).toBe(true);
  });

  it('skips low-severity types', () => {
    const noticer = createBillingEventNoticer();
    expect(noticer.shouldShow(makeEvent('storage_warning'))).toBe(false);
    expect(noticer.shouldShow(makeEvent('storage_saturated'))).toBe(false);
    expect(noticer.shouldShow(makeEvent('plan_downgraded'))).toBe(false);
    expect(noticer.shouldShow(makeEvent('plan_expired'))).toBe(false);
    expect(noticer.shouldShow(makeEvent('plan_upgraded'))).toBe(false);
    expect(noticer.shouldShow(makeEvent('subscription_cancellation_pending'))).toBe(false);
  });

  it('skips dismissed/resolved state', () => {
    const noticer = createBillingEventNoticer();
    expect(
      noticer.shouldShow(makeEvent('billing_issue', { state: 'dismissed' })),
    ).toBe(false);
    expect(
      noticer.shouldShow(makeEvent('billing_issue', { state: 'resolved' })),
    ).toBe(false);
  });

  it('reset clears the shown set so the same id can be re-shown', () => {
    const noticer = createBillingEventNoticer();
    const event = makeEvent('billing_issue');
    noticer.markShown(event.id);
    expect(noticer.shouldShow(event)).toBe(false);
    noticer.reset();
    expect(noticer.shouldShow(event)).toBe(true);
  });
});
