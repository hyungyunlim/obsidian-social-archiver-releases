/**
 * NoticeTelemetryService — best-effort analytics adapter for the in-app
 * notice channel.
 *
 * Emits `notice_impression`, `notice_cta_clicked`, and `notice_dismissed`
 * events to the existing `POST /api/events` analytics endpoint. The
 * payload mirrors mobile's telemetry shape so the operator dashboards do
 * not need a separate ingestion path.
 *
 * Spec: `.taskmaster/docs/prd-in-app-notice-channel-plugin.md` §Telemetry
 *
 * Guarantees:
 *   - All errors are swallowed. UI code never sees an exception from
 *     this service.
 *   - Impressions are de-duped per `(notice id, plugin session)` so a
 *     single banner re-render does not double-count.
 *   - When neither `username` nor `deviceId` is available, the upload is
 *     skipped (logged at debug level only) — the server will eventually
 *     dedupe by `event_id` once v3 ingestion lands, but we'd rather not
 *     spam unauthenticated events.
 */

import { requestUrl } from 'obsidian';
import type { WorkersAPIClient } from './WorkersAPIClient';
import type { SocialArchiverSettings } from '../types/settings';
import type { NoticePayloadV1 } from '../types/notices';

// ============================================================================
// Types
// ============================================================================

export interface NoticeTelemetryServiceDeps {
  apiClient: Pick<WorkersAPIClient, 'getEndpoint' | 'getAuthToken'>;
  getSettings: () => SocialArchiverSettings;
  logger?: (message: string, ...args: unknown[]) => void;
}

type NoticeTelemetryEvent =
  | 'notice_impression'
  | 'notice_cta_clicked'
  | 'notice_dismissed';

type NoticeTelemetryType = 'impressed' | 'cta_clicked' | 'dismissed';

// ============================================================================
// Helpers
// ============================================================================

function logDefault(message: string, ...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.debug(`[NoticeTelemetry] ${message}`, ...args);
}

/**
 * Generate a UUID v4 — uses `crypto.randomUUID()` when available
 * (Electron exposes it on the renderer for years), otherwise falls back
 * to a Math.random based generator. This is fine for telemetry event ids;
 * collisions are tolerable because the server dedupes by `(event_id,
 * session_id)` and `event_id` is only an idempotency hint.
 */
function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC4122-ish fallback — not crypto-grade.
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  // Set version (4) and variant (10xx) bits.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const b = Array.from(bytes, hex).join('');
  return `${b.slice(0, 8)}-${b.slice(8, 12)}-${b.slice(12, 16)}-${b.slice(16, 20)}-${b.slice(20)}`;
}

/**
 * Cheap, non-crypto FNV-1a 32-bit hash → 8-hex-char fingerprint, padded
 * out to 16 chars for symmetry with mobile's hashing strategy. The
 * server does not rely on this being cryptographic; it is just a stable
 * pseudonym so the analytics pipeline can group events by user without
 * receiving the raw username.
 */
function hashUserId(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // Mix once more for the upper bytes so we can present 16 hex chars.
  let hash2 = Math.imul(hash ^ 0xdeadbeef, 0x01000193) >>> 0;
  for (let i = input.length - 1; i >= 0; i--) {
    hash2 ^= input.charCodeAt(i);
    hash2 = Math.imul(hash2, 0x01000193) >>> 0;
  }
  const hi = hash.toString(16).padStart(8, '0');
  const lo = hash2.toString(16).padStart(8, '0');
  return `${hi}${lo}`;
}

function eventNameForType(type: NoticeTelemetryType): NoticeTelemetryEvent {
  switch (type) {
    case 'impressed':
      return 'notice_impression';
    case 'cta_clicked':
      return 'notice_cta_clicked';
    case 'dismissed':
      return 'notice_dismissed';
  }
}

// ============================================================================
// Service
// ============================================================================

export class NoticeTelemetryService {
  private readonly deps: NoticeTelemetryServiceDeps;
  private readonly log: (message: string, ...args: unknown[]) => void;
  private readonly sessionId: string;
  private readonly impressedNoticeIds = new Set<string>();

  constructor(deps: NoticeTelemetryServiceDeps) {
    this.deps = deps;
    this.log = deps.logger ?? logDefault;
    this.sessionId = generateUuid();
  }

  /**
   * Record a notice impression. De-duped per `(notice.id, session)` so
   * the banner can call this on every render without double-counting.
   */
  trackImpression(notice: NoticePayloadV1): void {
    if (this.impressedNoticeIds.has(notice.id)) {
      return;
    }
    this.impressedNoticeIds.add(notice.id);
    this.send(notice, 'impressed');
  }

  /** Record a CTA click. Always sent — clicks are intentional. */
  trackCtaClicked(notice: NoticePayloadV1): void {
    this.send(notice, 'cta_clicked');
  }

  /** Record a dismiss action. Always sent. */
  trackDismissed(notice: NoticePayloadV1): void {
    this.send(notice, 'dismissed');
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private send(notice: NoticePayloadV1, type: NoticeTelemetryType): void {
    const settings = this.deps.getSettings();
    const userIdSource = settings.username || settings.deviceId;
    if (!userIdSource) {
      this.log(
        `skipping ${type} upload: no username or deviceId available`,
        { noticeId: notice.id },
      );
      return;
    }

    const eventId = generateUuid();
    const occurredAt = new Date().toISOString();
    const eventName = eventNameForType(type);
    const userIdHash = hashUserId(userIdSource);

    const body = JSON.stringify({
      events: [
        {
          event_id: eventId,
          event: eventName,
          timestamp: occurredAt,
          session_id: this.sessionId,
          user_id_hash: userIdHash,
          properties: {
            event_id: eventId,
            notice_id: notice.id,
            tracking_key: notice.trackingKey,
            type,
            occurred_at: occurredAt,
            level: notice.level,
            surface: notice.surface,
            client: 'obsidian-plugin',
          },
        },
      ],
    });

    const endpoint = this.deps.apiClient.getEndpoint().replace(/\/$/, '');
    const url = `${endpoint}/api/events`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Client': 'obsidian-plugin',
      'X-Platform': 'obsidian',
    };
    const token = this.deps.apiClient.getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Fire and forget. We deliberately do not `await` here so callers
    // (banner click handlers) stay synchronous, but we still attach a
    // `.catch` to swallow any rejection from the underlying promise.
    try {
      const promise = requestUrl({
        url,
        method: 'POST',
        headers,
        body,
        throw: false,
      });
      // `requestUrl` returns a promise; guard the rejection path even
      // when the synchronous setup succeeds.
      Promise.resolve(promise).catch((error: unknown) => {
        this.log(
          `${eventName} upload failed:`,
          error instanceof Error ? error.message : String(error),
        );
      });
    } catch (error) {
      this.log(
        `${eventName} upload threw synchronously:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
