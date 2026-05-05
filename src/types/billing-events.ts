/**
 * Billing event types for `GET /api/user/billing-events` and
 * `POST /api/user/billing-events/:id/dismiss` consumed by the Obsidian plugin.
 *
 * Mirrors `mobile-app/src/types/billing-events.ts`. **Server is the source of
 * truth** — bump `schemaVersion` and update this file together with
 * `workers/src/services/billingEventApiResponse.ts` whenever the contract
 * evolves. Keep the type literals in lockstep with
 * `workers/src/services/BillingNotificationService.ts` and
 * `workers/src/services/billingEventApiResponse.ts`.
 *
 * PRD: `.taskmaster/docs/prd-billing-lifecycle-notifications-plugin.md` §7.1.
 *
 * IMPORTANT — server-driven contract:
 *   - The server picks `cta.action` based on `X-Client` +
 *     `X-Client-Capabilities` and the event type. The plugin MUST NOT
 *     recompute or override the action per `event.type`.
 *   - `priority` is already sorted desc by the server. The plugin renders
 *     the events in the order received.
 *   - `title` and `body` are rendered as-is. Do not reassemble copy from the
 *     raw `payload` fields — those are for analytics / archive-detail markers
 *     only.
 *   - An empty `events` array is the production steady-state because
 *     `BILLING_NOTIFICATION_MODE` is unset by default. Empty must not surface
 *     loading or error chrome.
 */

/**
 * Event taxonomy — must stay in sync with
 * `workers/src/services/BillingNotificationService.ts`.
 *
 * `prd-billing-lifecycle-notifications.md` §6.4 introduced five new lifecycle
 * event types beyond the original storage + plan_downgraded / plan_expired
 * set. All copy (title, body, CTA label) is server-driven via
 * `billingEventCopy.ts`; the plugin only owns the type literal so the API
 * response typechecks and the renderer can dispatch on `event.type` for
 * visual concerns (icon, color).
 */
export type BillingEventType =
  | 'storage_saturated'
  | 'storage_warning'
  | 'plan_downgraded'
  | 'plan_expired'
  // PRD §6.4 — lifecycle additions
  | 'trial_expiring_soon'
  | 'subscription_cancellation_pending'
  | 'billing_issue'
  | 'plan_upgraded'
  | 'plan_revoked';

/** Visual severity hint — drives banner color / icon at the UI layer. */
export type BillingEventSeverity = 'info' | 'warning' | 'error';

/**
 * State machine for the row on the server. The plugin only ever sees
 * `'active'` events; `'dismissed'` and `'resolved'` rows are filtered out
 * before send. Modeled here for completeness so future server changes
 * (e.g. soft-resolved rows surfacing for audit purposes) typecheck cleanly.
 */
export type BillingEventState = 'active' | 'dismissed' | 'resolved';

/**
 * Server-decided CTA action. The Obsidian plugin sends
 * `X-Client-Capabilities: billing-v1,app-update-v1,external_billing_handoff-v1`
 * (NEVER `native_paywall`) so it should normally receive
 * `update_and_pay_in_mobile` or `dismiss`. The other action verbs are listed
 * here so payloads from other clients (or future plugin capabilities)
 * typecheck — the plugin's CTA dispatcher defensively maps unsupported
 * actions to the mobile handoff URL.
 */
export type BillingEventCtaAction =
  | 'open_paywall'
  | 'open_restore'
  | 'open_storage_settings'
  | 'open_host_app'
  | 'update_and_pay_in_mobile'
  | 'dismiss'
  | 'none';

export interface BillingEventCta {
  action: BillingEventCtaAction;
  label: string;
}

/** Single billing event as delivered by `GET /api/user/billing-events`. */
export interface BillingEventApiPayload {
  id: string;
  type: BillingEventType;
  severity: BillingEventSeverity;
  state: BillingEventState;
  /** Higher = more prominent. Server pre-sorts events by priority desc. */
  priority: number;
  title: string;
  body: string;
  cta: BillingEventCta;
  /**
   * Sanitized payload — server strips raw media URLs, license keys, and
   * other sensitive fields before send. Plugin SHOULD NOT reassemble user
   * copy from these fields; use `title` / `body` instead.
   */
  payload: Record<string, unknown>;
  /**
   * `false` for events that must remain visible until the underlying
   * condition resolves on the server (e.g. `storage_saturated`,
   * `billing_issue`, `plan_revoked`). The UI layer MUST honor this flag —
   * don't render a dismiss affordance and don't call `dismissBillingEvent`
   * for non-dismissible rows.
   */
  dismissible: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Top-level shape of the `GET /api/user/billing-events` `data` field. */
export interface BillingEventsResponse {
  /** Bumps when the event taxonomy / payload schema changes. Currently `1`. */
  schemaVersion: number;
  /** ISO-8601 server clock — useful for debugging client/server skew. */
  serverTime: string;
  events: BillingEventApiPayload[];
}
