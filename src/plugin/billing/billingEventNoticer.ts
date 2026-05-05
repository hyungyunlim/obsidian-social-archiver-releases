/**
 * Billing event Notice dedupe — plugin-session only.
 *
 * PRD: `.taskmaster/docs/prd-billing-lifecycle-notifications-plugin.md` §6.1,
 *      §6.4.
 *
 * Obsidian `Notice` is transient and has no buttons, so it serves as
 * lightweight high-severity awareness only. The actionable surface is the
 * Settings card (Phase D). Even within the awareness role we must dedupe so
 * a `billing_status_updated` reconnect storm doesn't fire the same Notice
 * repeatedly for the same event id.
 *
 * Server `dismissed_at` / `resolved_at` are the durable source of truth.
 * Plugin only needs an in-memory set per session — `reset()` is wired to
 * logout in `main.ts`.
 */

import type {
  BillingEventApiPayload,
  BillingEventType,
} from '../../types/billing-events';

/**
 * High-severity event types that warrant an immediate Obsidian Notice.
 *
 * Per PRD §6.1: `billing_issue`, `plan_revoked`, `trial_expiring_soon`.
 * Any other event type is rendered only inside the Settings section.
 */
const HIGH_SEVERITY_TYPES: ReadonlySet<BillingEventType> = new Set<BillingEventType>([
  'billing_issue',
  'plan_revoked',
  'trial_expiring_soon',
]);

export interface BillingEventNoticer {
  /**
   * Returns `true` when the event is high-severity, currently active, AND
   * has not already shown a Notice in this plugin session.
   */
  shouldShow(event: BillingEventApiPayload): boolean;
  /** Mark `eventId` as having shown a Notice this session. */
  markShown(eventId: string): void;
  /** Clear the shown set — call on logout. */
  reset(): void;
}

export function createBillingEventNoticer(): BillingEventNoticer {
  const shown = new Set<string>();

  return {
    shouldShow(event: BillingEventApiPayload): boolean {
      if (event.state !== 'active') return false;
      if (!HIGH_SEVERITY_TYPES.has(event.type)) return false;
      return !shown.has(event.id);
    },
    markShown(eventId: string): void {
      shown.add(eventId);
    },
    reset(): void {
      shown.clear();
    },
  };
}
