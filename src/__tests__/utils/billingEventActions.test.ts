/**
 * billingEventActions tests — server-driven CTA dispatcher contract.
 *
 * PRD: `.taskmaster/docs/prd-billing-lifecycle-notifications-plugin.md` §6.2.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type {
  BillingEventApiPayload,
  BillingEventCtaAction,
} from '../../types/billing-events';
import {
  getMobileBillingHandoffUrl,
  getSupportMailtoUrl,
  dispatchBillingEventCta,
  openExternalBillingUrl,
} from '../../utils/billingEventActions';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<BillingEventApiPayload> = {}): BillingEventApiPayload {
  return {
    id: 'evt-test-1',
    type: 'trial_expiring_soon',
    severity: 'warning',
    state: 'active',
    priority: 50,
    title: 'Trial ending soon',
    body: 'Your trial expires in 24h.',
    cta: { action: 'update_and_pay_in_mobile', label: 'Open mobile app' },
    payload: {},
    dismissible: true,
    createdAt: '2026-05-05T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
    ...overrides,
  };
}

interface MockStore {
  dismiss: ReturnType<typeof vi.fn>;
}

interface MockPlugin {
  billingEventsStore: MockStore;
  workersApiClient: unknown;
}

function makeMockPlugin(): MockPlugin {
  return {
    billingEventsStore: {
      dismiss: vi.fn(async () => undefined),
    },
    workersApiClient: { __mock: true },
  };
}

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

describe('getMobileBillingHandoffUrl', () => {
  it('returns canonical URL with from/reason params when no eventId is given', () => {
    const url = getMobileBillingHandoffUrl();
    expect(url).toBe('https://social-archive.org/get-mobile?from=plugin&reason=billing-event');
  });

  it('appends billing_event_id when eventId is provided', () => {
    const url = getMobileBillingHandoffUrl('evt-123');
    expect(url).toBe(
      'https://social-archive.org/get-mobile?from=plugin&reason=billing-event&billing_event_id=evt-123',
    );
  });

  it('encodes eventId for URL safety', () => {
    const url = getMobileBillingHandoffUrl('evt with space');
    expect(url).toContain('billing_event_id=evt%20with%20space');
  });

  it('omits billing_event_id for empty string eventId', () => {
    const url = getMobileBillingHandoffUrl('');
    expect(url).toBe('https://social-archive.org/get-mobile?from=plugin&reason=billing-event');
  });
});

describe('getSupportMailtoUrl', () => {
  it('returns mailto: URL with the canonical support address', () => {
    expect(getSupportMailtoUrl()).toBe('mailto:support@social-archive.org');
  });
});

// ---------------------------------------------------------------------------
// openExternalBillingUrl
// ---------------------------------------------------------------------------

describe('openExternalBillingUrl', () => {
  let originalOpen: typeof window.open;

  beforeEach(() => {
    originalOpen = window.open;
  });

  afterEach(() => {
    window.open = originalOpen;
    vi.restoreAllMocks();
  });

  it('returns true when window.open returns a Window', async () => {
    const fakeWindow = {} as Window;
    window.open = vi.fn(() => fakeWindow) as unknown as typeof window.open;
    const result = await openExternalBillingUrl('https://example.com');
    expect(result).toBe(true);
    expect(window.open).toHaveBeenCalledWith('https://example.com', '_blank');
  });

  it('returns false when window.open returns null (popup blocked)', async () => {
    window.open = vi.fn(() => null) as unknown as typeof window.open;
    const result = await openExternalBillingUrl('https://example.com');
    expect(result).toBe(false);
  });

  it('returns false and does not throw when window.open throws', async () => {
    window.open = vi.fn(() => {
      throw new Error('blocked');
    }) as unknown as typeof window.open;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await openExternalBillingUrl('https://example.com');
    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// dispatchBillingEventCta — server-driven action verb routing
// ---------------------------------------------------------------------------

describe('dispatchBillingEventCta', () => {
  let originalOpen: typeof window.open;
  let openSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalOpen = window.open;
    openSpy = vi.fn(() => ({}) as Window);
    window.open = openSpy as unknown as typeof window.open;
  });

  afterEach(() => {
    window.open = originalOpen;
    vi.restoreAllMocks();
  });

  it('opens canonical handoff URL for update_and_pay_in_mobile', async () => {
    const event = makeEvent({ id: 'evt-1', cta: { action: 'update_and_pay_in_mobile', label: 'x' } });
    const plugin = makeMockPlugin();
    await dispatchBillingEventCta(event, plugin as never);
    expect(openSpy).toHaveBeenCalledWith(
      'https://social-archive.org/get-mobile?from=plugin&reason=billing-event&billing_event_id=evt-1',
      '_blank',
    );
  });

  it('opens canonical handoff URL for open_host_app (defensive fallback)', async () => {
    const event = makeEvent({ id: 'evt-2', cta: { action: 'open_host_app', label: 'x' } });
    const plugin = makeMockPlugin();
    await dispatchBillingEventCta(event, plugin as never);
    expect(openSpy).toHaveBeenCalledWith(
      'https://social-archive.org/get-mobile?from=plugin&reason=billing-event&billing_event_id=evt-2',
      '_blank',
    );
  });

  it('opens canonical handoff URL for open_paywall (defensive fallback — plugin has no native paywall)', async () => {
    const event = makeEvent({ id: 'evt-3', cta: { action: 'open_paywall', label: 'x' } });
    const plugin = makeMockPlugin();
    await dispatchBillingEventCta(event, plugin as never);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0]?.[0]).toContain('billing_event_id=evt-3');
  });

  it('opens canonical handoff URL for open_restore (defensive fallback — plugin has no native restore)', async () => {
    const event = makeEvent({ id: 'evt-4', cta: { action: 'open_restore', label: 'x' } });
    const plugin = makeMockPlugin();
    await dispatchBillingEventCta(event, plugin as never);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0]?.[0]).toContain('billing_event_id=evt-4');
  });

  it('does NOT open a URL for open_storage_settings (plugin no-op)', async () => {
    const event = makeEvent({ cta: { action: 'open_storage_settings', label: 'x' } });
    const plugin = makeMockPlugin();
    await expect(dispatchBillingEventCta(event, plugin as never)).resolves.toBeUndefined();
    expect(openSpy).not.toHaveBeenCalled();
    expect(plugin.billingEventsStore.dismiss).not.toHaveBeenCalled();
  });

  it('calls store.dismiss for dismiss action', async () => {
    const event = makeEvent({ cta: { action: 'dismiss', label: 'x' } });
    const plugin = makeMockPlugin();
    await dispatchBillingEventCta(event, plugin as never);
    expect(plugin.billingEventsStore.dismiss).toHaveBeenCalledTimes(1);
    expect(plugin.billingEventsStore.dismiss).toHaveBeenCalledWith(plugin.workersApiClient, event);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('swallows store.dismiss errors so the dispatcher never throws to UI', async () => {
    const event = makeEvent({ cta: { action: 'dismiss', label: 'x' } });
    const plugin = makeMockPlugin();
    plugin.billingEventsStore.dismiss = vi.fn(async () => {
      throw new Error('network');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(dispatchBillingEventCta(event, plugin as never)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('is a no-op for action=none', async () => {
    const event = makeEvent({ cta: { action: 'none', label: '' } });
    const plugin = makeMockPlugin();
    await dispatchBillingEventCta(event, plugin as never);
    expect(openSpy).not.toHaveBeenCalled();
    expect(plugin.billingEventsStore.dismiss).not.toHaveBeenCalled();
  });

  it('does not branch on event.type — same action verb same behavior across types', async () => {
    // Sanity: all listed lifecycle types route via cta.action only.
    const types: BillingEventApiPayload['type'][] = [
      'trial_expiring_soon',
      'subscription_cancellation_pending',
      'billing_issue',
      'plan_upgraded',
      'plan_revoked',
      'plan_expired',
      'plan_downgraded',
      'storage_warning',
      'storage_saturated',
    ];
    const plugin = makeMockPlugin();
    for (const t of types) {
      openSpy.mockClear();
      const event = makeEvent({
        type: t,
        cta: { action: 'update_and_pay_in_mobile', label: 'x' },
      });
      await dispatchBillingEventCta(event, plugin as never);
      expect(openSpy).toHaveBeenCalledTimes(1);
    }
  });

  it('exhaustively switches over BillingEventCtaAction (typecheck via cast)', async () => {
    const allActions: BillingEventCtaAction[] = [
      'open_paywall',
      'open_restore',
      'open_storage_settings',
      'open_host_app',
      'update_and_pay_in_mobile',
      'dismiss',
      'none',
    ];
    // Smoke: every documented action verb returns without throwing.
    const plugin = makeMockPlugin();
    for (const action of allActions) {
      const event = makeEvent({ cta: { action, label: 'x' } });
      await expect(dispatchBillingEventCta(event, plugin as never)).resolves.toBeUndefined();
    }
  });
});
