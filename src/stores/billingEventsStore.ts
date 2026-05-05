/**
 * Billing events store — Phase B+C real implementation.
 *
 * PRD: `.taskmaster/docs/prd-billing-lifecycle-notifications-plugin.md` §8.3,
 *      §6.3.
 *
 * Owns the plugin-side billing-events state (events list, fetch status,
 * inline error). The interface contract was frozen in Phase A so
 * `BillingEventsSection.svelte` (Phase D) can typecheck against
 * `BillingEventsStore` while this implementation lands.
 *
 * Design notes:
 *   - Uses Svelte `writable` so the section can `$store` it directly.
 *   - Preserves prior `events` on transient `refresh` failure so users don't
 *     suddenly see a card disappear because of a flaky network.
 *   - `dismiss` is optimistic: removes the event immediately, calls
 *     `client.dismissBillingEvent(id)`, and rolls back only when the call
 *     throws. A `false` return (server no-op) is treated as success because
 *     the server is already in the target state per PRD §6.3.
 */

import { writable, type Writable } from 'svelte/store';
import type { BillingEventApiPayload } from '../types/billing-events';
import type { WorkersAPIClient } from '../services/WorkersAPIClient';

export interface BillingEventsState {
  events: BillingEventApiPayload[];
  /** Epoch ms of the last successful fetch, or `null` if never fetched. */
  lastFetchedAt: number | null;
  loading: boolean;
  error: string | null;
}

/**
 * Plugin-owned billing events store. Uses Svelte-compatible subscribe API so
 * `BillingEventsSection.svelte` can `$store` it directly.
 *
 * Lifecycle:
 *   - `setEvents(events)` — synchronous commit, e.g. after a startup fetch
 *     done by `main.ts` outside the store.
 *   - `refresh(client)` — fetches `/api/user/billing-events`, sets
 *     `loading=true` then commits/clears `error`.
 *   - `dismiss(client, event)` — optimistic remove + POST dismiss; on
 *     thrown error the previous list is restored and `error` is set so
 *     the section can show inline error chrome.
 *   - `clear()` — resets to the empty/initial state. Called on logout /
 *     auth token removal so prior account events don't leak across swaps.
 */
export interface BillingEventsStore {
  /** Svelte-compatible subscribe; returns an unsubscribe function. */
  subscribe: (run: (state: BillingEventsState) => void) => () => void;
  setEvents(events: BillingEventApiPayload[]): void;
  refresh(client: WorkersAPIClient): Promise<void>;
  dismiss(client: WorkersAPIClient, event: BillingEventApiPayload): Promise<void>;
  clear(): void;
}

const INITIAL_STATE: BillingEventsState = {
  events: [],
  lastFetchedAt: null,
  loading: false,
  error: null,
};

function snapshot(state: BillingEventsState): BillingEventsState {
  return {
    events: state.events,
    lastFetchedAt: state.lastFetchedAt,
    loading: state.loading,
    error: state.error,
  };
}

export function createBillingEventsStore(): BillingEventsStore {
  const store: Writable<BillingEventsState> = writable<BillingEventsState>({
    ...INITIAL_STATE,
  });

  const setEvents = (events: BillingEventApiPayload[]): void => {
    store.update((prev) => ({
      ...prev,
      events,
      lastFetchedAt: Date.now(),
      error: null,
    }));
  };

  const refresh = async (client: WorkersAPIClient): Promise<void> => {
    store.update((prev) => ({ ...prev, loading: true }));
    try {
      const events = await client.getActiveBillingEvents();
      store.update((prev) => ({
        ...prev,
        events,
        lastFetchedAt: Date.now(),
        loading: false,
        error: null,
      }));
    } catch (err) {
      // `getActiveBillingEvents()` is fail-soft (returns []), but defensively
      // catch anything that might still bubble up and preserve prior events
      // so the user doesn't lose visibility into existing cards on a
      // transient failure.
      store.update((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to refresh billing events',
      }));
    }
  };

  const dismiss = async (
    client: WorkersAPIClient,
    event: BillingEventApiPayload,
  ): Promise<void> => {
    let previousEvents: BillingEventApiPayload[] = [];
    store.update((prev) => {
      previousEvents = prev.events;
      return {
        ...prev,
        events: prev.events.filter((e) => e.id !== event.id),
        error: null,
      };
    });

    try {
      // `false` from server is "already dismissed" / no-op — keep optimistic
      // removal because the server is already in the target state.
      await client.dismissBillingEvent(event.id);
    } catch (err) {
      store.update((prev) => ({
        ...prev,
        events: previousEvents,
        error:
          err instanceof Error
            ? `Failed to dismiss event: ${err.message}`
            : 'Failed to dismiss event',
      }));
    }
  };

  const clear = (): void => {
    store.set({ ...INITIAL_STATE });
  };

  return {
    subscribe: (run) => {
      // svelte/store `writable.subscribe` invokes `run(state)` synchronously
      // with the current value, then on every change. Wrap it so we hand
      // out a snapshot rather than the internal mutable reference.
      return store.subscribe((state) => run(snapshot(state)));
    },
    setEvents,
    refresh,
    dismiss,
    clear,
  };
}
