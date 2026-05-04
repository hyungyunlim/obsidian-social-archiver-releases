/**
 * In-App Notice Channel — plugin-side type definitions (schemaVersion 1).
 *
 * These types mirror the public-facing wire shapes shipped from
 * `workers/src/types/notices.ts`. They intentionally do NOT include
 * admin-only fields (audience, mode, copy_json, audit, etc.) — the plugin
 * only consumes the compiled, server-resolved payload returned by
 * `GET /api/app/notices`.
 *
 * Source of truth for the contract:
 *   - .taskmaster/docs/prd-in-app-notice-channel.md (server)
 *   - .taskmaster/docs/prd-in-app-notice-channel-plugin.md (this client)
 *
 * Bumping the schema version requires updating both this file and the
 * mobile copy (`mobile-app/src/api/notices.ts`).
 */

// ============================================================================
// Wire-format enums (subset of the worker types — public surface only)
// ============================================================================

export type NoticeSurfaceV1 = 'top_banner';

export type NoticeLevelV1 = 'info' | 'success' | 'warning' | 'error';

export type NoticeCtaActionV1 =
  | 'open_url'
  | 'open_paywall'
  | 'open_rewards'
  | 'dismiss';

export type NoticeDismissPolicyV1 =
  | 'per_id_local'
  | 'on_cta_local'
  | 'sticky';

// ============================================================================
// Wire payload contract — schemaVersion 1
// ============================================================================

export interface NoticeCtaV1 {
  label: string;
  action: NoticeCtaActionV1;
  /** Present iff `action === 'open_url'`. */
  url?: string;
}

export interface NoticePayloadV1 {
  schemaVersion: 1;
  id: string;
  surface: NoticeSurfaceV1;
  priority: number;
  level: NoticeLevelV1;
  title?: string;
  body: string;
  cta?: NoticeCtaV1;
  dismissPolicy: NoticeDismissPolicyV1;
  /** ISO8601 — clients hide past this. */
  expiresAt: string;
  /** Stable telemetry key, may differ from `id`. */
  trackingKey: string;
}

export interface NoticesResponseV1 {
  schemaVersion: 1;
  notices: NoticePayloadV1[];
  /** ISO8601 — used for clock-skew tolerant expiry checks. */
  serverTime: string;
}

/**
 * Localizable copy bundle. Plugin does not consume this directly today
 * (server returns already-localized `title`/`body`/`cta.label`), but it is
 * mirrored here for parity with the worker types in case future server
 * versions surface raw copy objects to the renderer.
 */
export interface NoticeCopyJsonV1 {
  defaultLocale: string;
  locales: Record<string, { title?: string; body: string; ctaLabel?: string }>;
}

// ============================================================================
// Telemetry payload contract (PRD §Telemetry)
// ============================================================================

export interface NoticeClientEventV1 {
  /** Client-generated UUID v4 (idempotency key for v3 ingestion). */
  eventId: string;
  noticeId: string;
  type: 'impressed' | 'cta_clicked' | 'dismissed';
  /** ISO8601. */
  occurredAt: string;
}

// ============================================================================
// Internal (non-wire) runtime state for the plugin's NoticesService
// ============================================================================

export interface NoticesServiceState {
  /** Server-provided notices, post-filter (top_banner + schemaVersion 1). */
  notices: NoticePayloadV1[];
  /** Epoch ms of the last successful fetch (null = never fetched). */
  lastFetchedAt: number | null;
  /**
   * `Date.parse(serverTime) - Date.now()` captured on the most recent
   * successful fetch. Used to mitigate device clock skew when comparing
   * `expiresAt`. Defaults to 0 until the first successful fetch.
   */
  serverTimeOffsetMs: number;
  /** Notice ids the user has locally dismissed. */
  dismissedIds: Set<string>;
  /**
   * True once the persisted dismiss-id set has been hydrated from settings.
   * Until this flips, no notice is rendered (PRD §Visibility Rules:
   * "Initial paint rule").
   */
  hydrated: boolean;
}

export type NoticesServiceListener = (state: NoticesServiceState) => void;

// ============================================================================
// Wire-envelope shapes (used internally by NoticesService when validating
// the `requestUrl` response). Not exported as part of the public surface.
// ============================================================================

export interface NoticesSuccessEnvelopeV1 {
  success: true;
  data: NoticesResponseV1;
}

export interface NoticesErrorEnvelopeV1 {
  success: false;
  error?: { code?: string; message?: string };
}

export type NoticesEnvelopeV1 =
  | NoticesSuccessEnvelopeV1
  | NoticesErrorEnvelopeV1;
