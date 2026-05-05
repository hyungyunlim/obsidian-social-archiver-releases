/**
 * Billing event CTA helpers — server-driven dispatcher for the Obsidian plugin.
 *
 * PRD: `.taskmaster/docs/prd-billing-lifecycle-notifications-plugin.md` §6.2, §8.5.
 *
 * IMPORTANT — server is source of truth for the action:
 *   - Dispatch is driven exclusively by `event.cta.action`. Do **not** branch
 *     on `event.type` here. Visual concerns (icon, color tone) live in the
 *     section component.
 *   - The plugin owns no native paywall/restore. `open_paywall` and
 *     `open_restore` defensively fall back to the canonical mobile handoff
 *     URL so an unexpected server payload still does something useful.
 *   - `open_storage_settings` is intentionally a no-op in V1. The plugin has
 *     no separate storage settings deep link; the section card stays visible
 *     for the user to read and the server-issued `dismiss` action is the
 *     only way to clear it.
 *   - `dismiss` delegates to the plugin-owned `billingEventsStore` so the
 *     optimistic remove + rollback contract stays in one place.
 */
import { Notice } from 'obsidian';

import type {
  BillingEventApiPayload,
  BillingEventCtaAction,
} from '../types/billing-events';
import type SocialArchiverPlugin from '../main';

/**
 * Canonical mobile handoff URL — mirrors the constant used by
 * `NoticeBanner.executeCta` for `open_paywall`. Plugin policy: never read a
 * destination URL from the server payload; the plugin owns this string.
 */
const MOBILE_HANDOFF_URL = 'https://social-archive.org/get-mobile';

const MOBILE_HANDOFF_FALLBACK_NOTICE =
  'Could not open URL. Visit social-archive.org/get-mobile';

const SUPPORT_EMAIL = 'support@social-archive.org';

/**
 * Build the plugin-owned mobile handoff URL.
 *
 * Always tagged with `from=plugin&reason=billing-event` so server-side
 * landing analytics can distinguish billing CTAs from generic "Get Mobile"
 * banners. When the event id is supplied it is appended as
 * `billing_event_id` — the smart-landing page is expected to ignore unknown
 * params, so this is safe even before the page learns about the parameter.
 */
export function getMobileBillingHandoffUrl(eventId?: string): string {
  const base = `${MOBILE_HANDOFF_URL}?from=plugin&reason=billing-event`;
  if (eventId && eventId.length > 0) {
    return `${base}&billing_event_id=${encodeURIComponent(eventId)}`;
  }
  return base;
}

/** `mailto:` URL for product-approved support escalation. V1 unused, exposed for future server CTA. */
export function getSupportMailtoUrl(): string {
  return `mailto:${SUPPORT_EMAIL}`;
}

/**
 * Open an external URL via `window.open(_, '_blank')` — the same primitive
 * used by `NoticeBanner.executeCta` for `open_paywall`. Returns `true` only
 * when `window.open` returns a truthy `Window` reference (popup not blocked
 * and the host actually opened a new context). On failure shows a plain
 * Obsidian Notice so the user is not left with a silent dead-end.
 */
export async function openExternalBillingUrl(url: string): Promise<boolean> {
  try {
    const opened = window.open(url, '_blank');
    if (opened) {
      return true;
    }
  } catch (err) {
    console.warn('[billingEventActions] openExternalBillingUrl threw', err);
  }
  new Notice(MOBILE_HANDOFF_FALLBACK_NOTICE);
  return false;
}

/**
 * Server-driven CTA dispatcher.
 *
 * Routes solely on `event.cta.action`. The mapping below is the V1 contract
 * documented in PRD §6.2. Anything not handled defensively falls back to the
 * mobile handoff URL — the most common user-facing intent for billing CTAs
 * the plugin cannot execute natively (paywall, restore, native host app).
 */
export async function dispatchBillingEventCta(
  event: BillingEventApiPayload,
  plugin: SocialArchiverPlugin,
): Promise<void> {
  const action: BillingEventCtaAction = event.cta.action;

  switch (action) {
    case 'update_and_pay_in_mobile':
    case 'open_host_app':
    case 'open_paywall':
    case 'open_restore': {
      // Plugin has no native paywall / restore / host-app entry. The
      // canonical handoff URL routes the user to the mobile app where they
      // can sign in with the same account and complete the action.
      const url = getMobileBillingHandoffUrl(event.id);
      await openExternalBillingUrl(url);
      return;
    }
    case 'open_storage_settings': {
      // Plugin has no separate storage settings deep link in V1 — the card
      // itself is the surface. Intentional no-op so the card stays visible.
      return;
    }
    case 'dismiss': {
      // Defensive: if the row is non-dismissible the store still no-ops on
      // the server side. We forward unconditionally so the dispatcher is a
      // pure function of `cta.action`.
      try {
        await plugin.billingEventsStore.dismiss(plugin.workersApiClient, event);
      } catch (err) {
        console.warn('[billingEventActions] dismiss failed', err);
      }
      return;
    }
    case 'none': {
      // Caller should hide the CTA button — but if it somehow fires, no-op.
      return;
    }
    default: {
      // Future server actions land here; defensive fallback to the handoff
      // URL keeps users from hitting a dead button until the plugin learns
      // the new action verb.
      const exhaustiveCheck: never = action;
      void exhaustiveCheck;
      const url = getMobileBillingHandoffUrl(event.id);
      await openExternalBillingUrl(url);
      return;
    }
  }
}
