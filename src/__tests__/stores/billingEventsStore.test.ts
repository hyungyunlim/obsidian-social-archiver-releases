/**
 * billingEventsStore — Phase B+C real implementation tests.
 *
 * PRD: `.taskmaster/docs/prd-billing-lifecycle-notifications-plugin.md` §8.3,
 *      §11.1.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createBillingEventsStore,
  type BillingEventsState,
} from '@/stores/billingEventsStore';
import type { BillingEventApiPayload } from '@/types/billing-events';
import type { WorkersAPIClient } from '@/services/WorkersAPIClient';

function makeEvent(overrides: Partial<BillingEventApiPayload> = {}): BillingEventApiPayload {
  return {
    id: overrides.id ?? 'evt-1',
    type: 'billing_issue',
    severity: 'error',
    state: 'active',
    priority: 100,
    title: 'Payment issue',
    body: '...',
    cta: { action: 'update_and_pay_in_mobile', label: 'Update' },
    payload: {},
    dismissible: false,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeMockClient(
  overrides: Partial<{
    getActiveBillingEvents: WorkersAPIClient['getActiveBillingEvents'];
    dismissBillingEvent: WorkersAPIClient['dismissBillingEvent'];
  }> = {},
): WorkersAPIClient {
  return {
    getActiveBillingEvents: overrides.getActiveBillingEvents ?? vi.fn().mockResolvedValue([]),
    dismissBillingEvent: overrides.dismissBillingEvent ?? vi.fn().mockResolvedValue(true),
  } as unknown as WorkersAPIClient;
}

function readState(store: ReturnType<typeof createBillingEventsStore>): BillingEventsState {
  let state!: BillingEventsState;
  const unsub = store.subscribe((s) => (state = s));
  unsub();
  return state;
}

describe('billingEventsStore', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('starts with the empty initial state', () => {
    const store = createBillingEventsStore();
    const state = readState(store);
    expect(state.events).toEqual([]);
    expect(state.lastFetchedAt).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('subscribe runs immediately with the current state', () => {
    const store = createBillingEventsStore();
    const calls: BillingEventsState[] = [];
    const unsub = store.subscribe((s) => calls.push(s));
    expect(calls).toHaveLength(1);
    expect(calls[0].events).toEqual([]);
    unsub();
  });

  it('setEvents updates events + lastFetchedAt and clears error', () => {
    const store = createBillingEventsStore();
    const event = makeEvent();
    const before = Date.now();
    store.setEvents([event]);
    const state = readState(store);
    expect(state.events).toEqual([event]);
    expect(state.lastFetchedAt).toBeGreaterThanOrEqual(before);
    expect(state.error).toBeNull();
  });

  it('refresh success path commits events and clears loading', async () => {
    const event = makeEvent();
    const client = makeMockClient({
      getActiveBillingEvents: vi.fn().mockResolvedValue([event]),
    });
    const store = createBillingEventsStore();

    const observed: BillingEventsState[] = [];
    const unsub = store.subscribe((s) => observed.push(s));

    await store.refresh(client);
    unsub();

    // Should have observed loading=true at some point and then settled.
    expect(observed.some((s) => s.loading === true)).toBe(true);
    const final = observed[observed.length - 1];
    expect(final.events).toEqual([event]);
    expect(final.loading).toBe(false);
    expect(final.error).toBeNull();
    expect(final.lastFetchedAt).not.toBeNull();
  });

  it('refresh failure preserves prior events and sets error without throwing', async () => {
    const initial = makeEvent({ id: 'evt-existing' });
    const store = createBillingEventsStore();
    store.setEvents([initial]);

    const client = makeMockClient({
      getActiveBillingEvents: vi.fn().mockRejectedValue(new Error('boom')),
    });

    await expect(store.refresh(client)).resolves.toBeUndefined();

    const state = readState(store);
    expect(state.events).toEqual([initial]); // preserved
    expect(state.error).toBe('boom');
    expect(state.loading).toBe(false);
  });

  it('dismiss optimistically removes the event', async () => {
    const a = makeEvent({ id: 'a' });
    const b = makeEvent({ id: 'b' });
    const store = createBillingEventsStore();
    store.setEvents([a, b]);

    let dismissResolve: (v: boolean) => void = () => {};
    const dismissPromise = new Promise<boolean>((resolve) => {
      dismissResolve = resolve;
    });
    const client = makeMockClient({
      dismissBillingEvent: vi.fn().mockReturnValue(dismissPromise),
    });

    const dismissTask = store.dismiss(client, a);
    // Immediate optimistic removal — already gone before promise resolves.
    expect(readState(store).events).toEqual([b]);

    dismissResolve(true);
    await dismissTask;
    expect(readState(store).events).toEqual([b]);
  });

  it('dismiss keeps optimistic removal when server returns false', async () => {
    const a = makeEvent({ id: 'a' });
    const store = createBillingEventsStore();
    store.setEvents([a]);

    const client = makeMockClient({
      dismissBillingEvent: vi.fn().mockResolvedValue(false),
    });
    await store.dismiss(client, a);
    expect(readState(store).events).toEqual([]); // still removed
    expect(readState(store).error).toBeNull();
  });

  it('dismiss rolls back and sets error when API throws', async () => {
    const a = makeEvent({ id: 'a' });
    const b = makeEvent({ id: 'b' });
    const store = createBillingEventsStore();
    store.setEvents([a, b]);

    const client = makeMockClient({
      dismissBillingEvent: vi.fn().mockRejectedValue(new Error('network')),
    });

    await store.dismiss(client, a);

    const state = readState(store);
    expect(state.events).toEqual([a, b]); // restored
    expect(state.error).toMatch(/Failed to dismiss event/);
  });

  it('clear resets to initial state', () => {
    const store = createBillingEventsStore();
    store.setEvents([makeEvent()]);
    store.clear();
    const state = readState(store);
    expect(state.events).toEqual([]);
    expect(state.lastFetchedAt).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });
});
