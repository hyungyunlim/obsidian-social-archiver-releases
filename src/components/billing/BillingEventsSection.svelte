<script lang="ts">
/**
 * BillingEventsSection — settings card stack for active billing lifecycle
 * events delivered by `GET /api/user/billing-events`.
 *
 * PRD: `.taskmaster/docs/prd-billing-lifecycle-notifications-plugin.md`
 *      §6.5 (placement), §8.4 (rendering rules), §9.4 (mount).
 *
 * Server is the source of truth for copy and CTA action. This component:
 *   - Subscribes to `plugin.billingEventsStore` and re-renders on commits.
 *   - Filters to `event.state === 'active'`.
 *   - Renders nothing when there are no active events and no inline error.
 *   - Renders title / body / cta.label verbatim from the server payload.
 *   - Maps severity (`info` | `warning` | `error`) to color tone via
 *     Obsidian CSS variables — never hex.
 *   - Maps event TYPE (not severity) to a visual icon hint via
 *     `setIcon` from the host Obsidian API.
 *   - Hides the CTA button for `cta.action === 'none'` or empty label.
 *   - Hides the dismiss `✕` for non-dismissible rows.
 *   - Delegates CTA execution to the action verb dispatcher in
 *     `utils/billingEventActions.ts` (no `event.type` switching here).
 */
import { onDestroy } from 'svelte';
import { setIcon } from 'obsidian';

import type SocialArchiverPlugin from '../../main';
import type {
  BillingEventApiPayload,
  BillingEventSeverity,
  BillingEventType,
} from '../../types/billing-events';
import type { BillingEventsState } from '../../stores/billingEventsStore';
import { dispatchBillingEventCta } from '../../utils/billingEventActions';

interface Props {
  plugin: SocialArchiverPlugin;
}

let { plugin }: Props = $props();

// ---------------------------------------------------------------------------
// Store subscription — bridge `BillingEventsStore.subscribe` (Svelte 1.x
// contract: `(run) => unsubscribe`) into Svelte 5 Runes state.
// ---------------------------------------------------------------------------

let storeState = $state<BillingEventsState>({
  events: [],
  lastFetchedAt: null,
  loading: false,
  error: null,
});

const unsubscribe = plugin.billingEventsStore.subscribe((next) => {
  storeState = next;
});

onDestroy(() => {
  unsubscribe();
});

// ---------------------------------------------------------------------------
// Derived view state
// ---------------------------------------------------------------------------

/**
 * Active events only. Server presorts by `priority desc`, but a defensive
 * resort keeps the UI deterministic if a future store mutation reorders.
 */
let activeEvents = $derived(
  storeState.events
    .filter((event) => event.state === 'active')
    .slice()
    .sort((a, b) => b.priority - a.priority),
);

/**
 * Section visibility — PRD §8.4: "Do not render the section when there are
 * no active events and no error."
 */
let shouldRender = $derived(
  activeEvents.length > 0 || storeState.error !== null,
);

// ---------------------------------------------------------------------------
// Severity → CSS variable color tone
// ---------------------------------------------------------------------------

function severityIconColor(severity: BillingEventSeverity): string {
  switch (severity) {
    case 'error':
      return 'var(--text-error)';
    case 'warning':
      return 'var(--text-warning)';
    case 'info':
    default:
      return 'var(--text-accent)';
  }
}

function severityBorderColor(severity: BillingEventSeverity): string {
  switch (severity) {
    case 'error':
      return 'var(--text-error)';
    case 'warning':
      return 'var(--text-warning)';
    case 'info':
    default:
      return 'var(--interactive-accent)';
  }
}

// ---------------------------------------------------------------------------
// Event type → Obsidian icon name (visual hint only — not for behavior)
//
// Mirrors the mobile billing-events visual contract:
//   billing_issue / plan_revoked            → x-circle
//   subscription_cancellation_pending       → clock
//   trial_expiring_soon                     → clock
//   plan_upgraded                           → sparkles
//   plan_expired / plan_downgraded          → alert-triangle
//   storage_saturated                       → alert-triangle
//   storage_warning                         → alert-circle
// ---------------------------------------------------------------------------

function iconForEventType(type: BillingEventType): string {
  switch (type) {
    case 'billing_issue':
    case 'plan_revoked':
      return 'x-circle';
    case 'subscription_cancellation_pending':
    case 'trial_expiring_soon':
      return 'clock';
    case 'plan_upgraded':
      return 'sparkles';
    case 'plan_expired':
    case 'plan_downgraded':
    case 'storage_saturated':
      return 'alert-triangle';
    case 'storage_warning':
      return 'alert-circle';
    default:
      return 'info';
  }
}

/**
 * Action attribute that mounts the icon via `setIcon`. Re-runs when the
 * icon name changes — using the icon name as the action argument lets
 * Svelte invalidate the action when the type changes (rare, but cheap).
 */
function iconAction(node: HTMLElement, iconName: string) {
  setIcon(node, iconName);
  return {
    update(next: string) {
      node.empty?.();
      node.innerHTML = '';
      setIcon(node, next);
    },
  };
}

// ---------------------------------------------------------------------------
// CTA / dismiss handlers
// ---------------------------------------------------------------------------

async function handleCtaClick(event: BillingEventApiPayload): Promise<void> {
  await dispatchBillingEventCta(event, plugin);
}

async function handleDismissClick(event: BillingEventApiPayload): Promise<void> {
  try {
    await plugin.billingEventsStore.dismiss(plugin.workersApiClient, event);
  } catch (err) {
    // Store already restored optimistic remove on throw and surfaced an
    // inline error via state.error. Log for support diagnostics.
    console.warn('[BillingEventsSection] dismiss failed', err);
  }
}

function shouldRenderCta(event: BillingEventApiPayload): boolean {
  return event.cta.action !== 'none' && event.cta.label.length > 0;
}
</script>

{#if shouldRender}
  <section class="billing-events-section" aria-label="Billing notifications">
    {#if storeState.error}
      <div class="billing-events-error" role="alert">
        {storeState.error}
      </div>
    {/if}

    {#each activeEvents as event (event.id)}
      <article
        class="billing-event-card"
        data-severity={event.severity}
        data-event-type={event.type}
        style:border-left-color={severityBorderColor(event.severity)}
      >
        <div
          class="billing-event-icon"
          style:color={severityIconColor(event.severity)}
          use:iconAction={iconForEventType(event.type)}
          aria-hidden="true"
        ></div>

        <div class="billing-event-body">
          <div class="billing-event-title">{event.title}</div>
          <div class="billing-event-message">{event.body}</div>

          {#if shouldRenderCta(event)}
            <div class="billing-event-actions">
              <button
                class="billing-event-cta"
                type="button"
                onclick={() => handleCtaClick(event)}
              >
                {event.cta.label}
              </button>
            </div>
          {/if}
        </div>

        {#if event.dismissible}
          <button
            class="billing-event-dismiss"
            type="button"
            aria-label="Dismiss notification"
            onclick={() => handleDismissClick(event)}
          >
            ✕
          </button>
        {/if}
      </article>
    {/each}

    {#if storeState.loading && activeEvents.length === 0}
      <div class="billing-events-loading">Loading billing notifications…</div>
    {/if}
  </section>
{/if}

<style>
.billing-events-section {
  display: flex;
  flex-direction: column;
  gap: 0.5em;
  margin-top: 1em;
  margin-bottom: 1em;
}

.billing-event-card {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: start;
  gap: 0.75em;
  padding: 0.75em 1em;
  border: 1px solid var(--background-modifier-border);
  border-left-width: 3px;
  border-radius: 4px;
  background: var(--background-secondary);
}

.billing-event-icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-top: 0.15em;
}

.billing-event-icon :global(svg) {
  width: 18px;
  height: 18px;
}

.billing-event-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25em;
}

.billing-event-title {
  font-weight: 600;
  color: var(--text-normal);
  font-size: 0.95em;
  line-height: 1.3;
}

.billing-event-message {
  color: var(--text-muted);
  font-size: 0.875em;
  line-height: 1.45;
  white-space: pre-wrap;
}

.billing-event-actions {
  display: flex;
  gap: 0.5em;
  margin-top: 0.4em;
}

.billing-event-cta {
  background: var(--interactive-accent);
  color: var(--text-on-accent);
  border: 1px solid var(--interactive-accent);
  padding: 0.35em 0.85em;
  border-radius: 4px;
  font-size: 0.85em;
  font-weight: 500;
  cursor: pointer;
}

.billing-event-cta:hover {
  background: var(--interactive-accent-hover);
  border-color: var(--interactive-accent-hover);
}

.billing-event-dismiss {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 0.95em;
  line-height: 1;
  cursor: pointer;
  border-radius: 4px;
}

.billing-event-dismiss:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}

.billing-events-error {
  padding: 0.5em 0.75em;
  border: 1px solid var(--text-error);
  border-radius: 4px;
  background: var(--background-modifier-error);
  color: var(--text-error);
  font-size: 0.875em;
}

.billing-events-loading {
  color: var(--text-muted);
  font-size: 0.85em;
  padding: 0.25em 0.5em;
}
</style>
