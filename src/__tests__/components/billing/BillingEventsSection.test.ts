/**
 * BillingEventsSection tests.
 *
 * PRD: `.taskmaster/docs/prd-billing-lifecycle-notifications-plugin.md` §8.4.
 *
 * Coverage:
 *   - Empty events + no error → component renders nothing.
 *   - Single event renders title / body / cta label verbatim from server.
 *   - All five lifecycle event types render without throwing.
 *   - cta.action='none' or empty label → CTA button hidden.
 *   - dismissible=false → dismiss `✕` hidden.
 *   - Click CTA → dispatchBillingEventCta(event, plugin) called.
 *   - Click dismiss → plugin.billingEventsStore.dismiss invoked.
 *   - Inline error chrome appears when state.error is set.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@testing-library/svelte';
import { fireEvent } from '@testing-library/dom';

// Provide setIcon stub so the component can mount under the default
// obsidian mock (which intentionally omits setIcon).
vi.mock('obsidian', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('obsidian');
  return {
    ...actual,
    setIcon: (el: HTMLElement, iconName: string) => {
      el.setAttribute('data-icon', iconName);
    },
  };
});

// Mock the dispatcher so the component test stays focused on UI wiring.
const dispatchSpy = vi.fn(async () => undefined);
vi.mock('../../../utils/billingEventActions', () => ({
  dispatchBillingEventCta: (...args: unknown[]) => dispatchSpy(...args),
}));

import BillingEventsSection from '../../../components/billing/BillingEventsSection.svelte';
import type {
  BillingEventApiPayload,
  BillingEventType,
} from '../../../types/billing-events';
import type {
  BillingEventsState,
  BillingEventsStore,
} from '../../../stores/billingEventsStore';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<BillingEventApiPayload> = {}): BillingEventApiPayload {
  return {
    id: 'evt-1',
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

interface MockStoreHandle {
  store: BillingEventsStore;
  emit: (state: BillingEventsState) => void;
  dismissMock: ReturnType<typeof vi.fn>;
  setEventsMock: ReturnType<typeof vi.fn>;
  refreshMock: ReturnType<typeof vi.fn>;
  clearMock: ReturnType<typeof vi.fn>;
}

function makeMockStore(initial: BillingEventsState): MockStoreHandle {
  let current = initial;
  const subscribers = new Set<(s: BillingEventsState) => void>();
  const dismissMock = vi.fn(async () => undefined);
  const setEventsMock = vi.fn();
  const refreshMock = vi.fn(async () => undefined);
  const clearMock = vi.fn();

  const store: BillingEventsStore = {
    subscribe: (run) => {
      subscribers.add(run);
      run(current);
      return () => {
        subscribers.delete(run);
      };
    },
    setEvents: setEventsMock,
    refresh: refreshMock,
    dismiss: dismissMock,
    clear: clearMock,
  };

  return {
    store,
    emit: (next: BillingEventsState) => {
      current = next;
      for (const run of subscribers) run(next);
    },
    dismissMock,
    setEventsMock,
    refreshMock,
    clearMock,
  };
}

interface MockPluginHandle {
  plugin: { billingEventsStore: BillingEventsStore; workersApiClient: unknown };
  store: MockStoreHandle;
}

function makeMockPlugin(initial: BillingEventsState): MockPluginHandle {
  const store = makeMockStore(initial);
  return {
    store,
    plugin: {
      billingEventsStore: store.store,
      workersApiClient: { __mock: true },
    },
  };
}

const emptyState: BillingEventsState = {
  events: [],
  lastFetchedAt: null,
  loading: false,
  error: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BillingEventsSection', () => {
  beforeEach(() => {
    dispatchSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when there are no active events and no error', () => {
    const { plugin } = makeMockPlugin(emptyState);
    const { container } = mount(BillingEventsSection, { props: { plugin: plugin as never } });

    expect(container.querySelector('.billing-events-section')).toBeNull();
    expect(container.querySelector('.billing-event-card')).toBeNull();
  });

  it('renders nothing when only resolved/dismissed events are present', () => {
    const { plugin } = makeMockPlugin({
      ...emptyState,
      events: [
        makeEvent({ id: 'r-1', state: 'resolved' }),
        makeEvent({ id: 'd-1', state: 'dismissed' }),
      ],
    });
    const { container } = mount(BillingEventsSection, { props: { plugin: plugin as never } });
    expect(container.querySelector('.billing-event-card')).toBeNull();
  });

  it('renders title, body, and CTA label verbatim from server payload', () => {
    const { plugin } = makeMockPlugin({
      ...emptyState,
      events: [
        makeEvent({
          title: 'Server-issued title',
          body: 'Server-issued body line.',
          cta: { action: 'update_and_pay_in_mobile', label: 'Server label' },
        }),
      ],
    });
    const { container } = mount(BillingEventsSection, { props: { plugin: plugin as never } });

    expect(container.querySelector('.billing-event-title')?.textContent).toBe('Server-issued title');
    expect(container.querySelector('.billing-event-message')?.textContent).toBe(
      'Server-issued body line.',
    );
    expect(container.querySelector('.billing-event-cta')?.textContent?.trim()).toBe('Server label');
  });

  it('renders all lifecycle event types without throwing', () => {
    const types: BillingEventType[] = [
      'trial_expiring_soon',
      'subscription_cancellation_pending',
      'billing_issue',
      'plan_upgraded',
      'plan_revoked',
    ];
    for (const type of types) {
      const { plugin } = makeMockPlugin({
        ...emptyState,
        events: [makeEvent({ id: `evt-${type}`, type })],
      });
      const { container } = mount(BillingEventsSection, { props: { plugin: plugin as never } });
      const card = container.querySelector('.billing-event-card');
      expect(card).toBeTruthy();
      expect(card?.getAttribute('data-event-type')).toBe(type);
    }
  });

  it('hides CTA button when cta.action === "none"', () => {
    const { plugin } = makeMockPlugin({
      ...emptyState,
      events: [makeEvent({ cta: { action: 'none', label: 'x' } })],
    });
    const { container } = mount(BillingEventsSection, { props: { plugin: plugin as never } });
    expect(container.querySelector('.billing-event-cta')).toBeNull();
  });

  it('hides CTA button when cta.label is empty even if action is non-none', () => {
    const { plugin } = makeMockPlugin({
      ...emptyState,
      events: [makeEvent({ cta: { action: 'update_and_pay_in_mobile', label: '' } })],
    });
    const { container } = mount(BillingEventsSection, { props: { plugin: plugin as never } });
    expect(container.querySelector('.billing-event-cta')).toBeNull();
  });

  it('hides dismiss button when event.dismissible === false (e.g. billing_issue)', () => {
    const { plugin } = makeMockPlugin({
      ...emptyState,
      events: [
        makeEvent({
          id: 'bi-1',
          type: 'billing_issue',
          severity: 'error',
          dismissible: false,
        }),
      ],
    });
    const { container } = mount(BillingEventsSection, { props: { plugin: plugin as never } });
    expect(container.querySelector('.billing-event-dismiss')).toBeNull();
  });

  it('renders dismiss button when event.dismissible === true', () => {
    const { plugin } = makeMockPlugin({
      ...emptyState,
      events: [makeEvent({ dismissible: true })],
    });
    const { container } = mount(BillingEventsSection, { props: { plugin: plugin as never } });
    expect(container.querySelector('.billing-event-dismiss')).toBeTruthy();
  });

  it('invokes dispatchBillingEventCta with event + plugin on CTA click', async () => {
    const event = makeEvent({ cta: { action: 'update_and_pay_in_mobile', label: 'Open' } });
    const { plugin } = makeMockPlugin({ ...emptyState, events: [event] });
    const { container } = mount(BillingEventsSection, { props: { plugin: plugin as never } });

    const ctaBtn = container.querySelector('.billing-event-cta') as HTMLButtonElement;
    expect(ctaBtn).toBeTruthy();
    await fireEvent.click(ctaBtn);

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledWith(event, plugin);
  });

  it('invokes plugin.billingEventsStore.dismiss on dismiss click', async () => {
    const event = makeEvent({ dismissible: true });
    const { plugin, store } = makeMockPlugin({ ...emptyState, events: [event] });
    const { container } = mount(BillingEventsSection, { props: { plugin: plugin as never } });

    const dismissBtn = container.querySelector('.billing-event-dismiss') as HTMLButtonElement;
    expect(dismissBtn).toBeTruthy();
    await fireEvent.click(dismissBtn);

    expect(store.dismissMock).toHaveBeenCalledTimes(1);
    expect(store.dismissMock).toHaveBeenCalledWith(plugin.workersApiClient, event);
  });

  it('renders inline error chrome when state.error is set', () => {
    const { plugin } = makeMockPlugin({
      events: [],
      lastFetchedAt: null,
      loading: false,
      error: 'Failed to refresh billing events.',
    });
    const { container } = mount(BillingEventsSection, { props: { plugin: plugin as never } });

    const errorEl = container.querySelector('.billing-events-error');
    expect(errorEl).toBeTruthy();
    expect(errorEl?.textContent?.trim()).toBe('Failed to refresh billing events.');
  });

  it('renders multiple events in priority desc order', () => {
    const low = makeEvent({ id: 'low', priority: 10, title: 'Low priority' });
    const high = makeEvent({ id: 'high', priority: 90, title: 'High priority' });
    const mid = makeEvent({ id: 'mid', priority: 50, title: 'Mid priority' });
    const { plugin } = makeMockPlugin({ ...emptyState, events: [low, mid, high] });
    const { container } = mount(BillingEventsSection, { props: { plugin: plugin as never } });

    const titles = Array.from(container.querySelectorAll('.billing-event-title')).map(
      (el) => el.textContent,
    );
    expect(titles).toEqual(['High priority', 'Mid priority', 'Low priority']);
  });

  it('re-renders when the store emits a new state', () => {
    const { plugin, store } = makeMockPlugin(emptyState);
    const { container } = mount(BillingEventsSection, { props: { plugin: plugin as never } });
    expect(container.querySelector('.billing-event-card')).toBeNull();

    store.emit({ ...emptyState, events: [makeEvent({ title: 'Now visible' })] });
    expect(container.querySelector('.billing-event-title')?.textContent).toBe('Now visible');
  });
});
