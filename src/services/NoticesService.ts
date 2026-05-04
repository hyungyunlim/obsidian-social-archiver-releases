/**
 * NoticesService — Obsidian plugin client for the in-app notice channel.
 *
 * Spec:
 *   - .taskmaster/docs/prd-in-app-notice-channel-plugin.md (this client)
 *   - .taskmaster/docs/prd-in-app-notice-channel.md (server contract)
 *
 * Responsibilities:
 *   1. Hydrate the persisted dismiss-id set from plugin settings on boot.
 *   2. Poll `GET /api/app/notices` on startup, on visibility/online events,
 *      and every 15 minutes while loaded.
 *   3. Validate the response envelope and drop unsupported surfaces /
 *      schema versions / malformed expiries silently.
 *   4. Track `serverTimeOffsetMs` so expiry checks tolerate device clock
 *      skew.
 *   5. Persist dismissals back to settings using a set-merge strategy so
 *      synced installs do not clobber each other.
 *   6. Expose a selector (`getVisibleNotice`) and a subscription channel
 *      (`onUpdate`) for the UI layer (Agent B owns the renderer).
 *
 * Out of scope:
 *   - Rendering the banner / modal (Agent B)
 *   - Telemetry firing (delegated to NoticeTelemetryService)
 *   - Auth refresh (handled by the existing API client)
 */

import { requestUrl } from 'obsidian';
import type { WorkersAPIClient } from './WorkersAPIClient';
import type { SocialArchiverSettings } from '../types/settings';
import type {
  NoticePayloadV1,
  NoticesResponseV1,
  NoticesEnvelopeV1,
  NoticesServiceState,
  NoticesServiceListener,
} from '../types/notices';

// ============================================================================
// Constants
// ============================================================================

/** Maximum number of dismissed ids retained in settings (PRD §Dismiss Persistence). */
const MAX_DISMISSED_IDS = 200;

/** Delay between plugin load and the first fetch (PRD §Polling Cadence). */
const STARTUP_FETCH_DELAY_MS = 1500;

/** Interval between background fetches while the plugin is loaded. */
const POLL_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Capabilities advertised in `X-Client-Capabilities`. Mirrors mobile's
 * "billing-v1,app-update-v1,notices-v1" set, but excludes `native_paywall`
 * and `rewards_home_banner` because the plugin cannot service those
 * actions per Obsidian community policy.
 */
const CLIENT_CAPABILITIES = 'notices-v1,external_billing_handoff-v1';

/** Surfaces this client knows how to render. */
const SUPPORTED_SURFACES: ReadonlySet<string> = new Set(['top_banner']);

// ============================================================================
// Dependency injection contract
// ============================================================================

export interface NoticesServiceDeps {
  /**
   * Existing API client. We use it for `getEndpoint()` and
   * `getAuthToken()` only — headers are built independently because the
   * notices endpoint requires `X-Platform: obsidian` (not the desktop OS
   * value the API client emits by default).
   */
  apiClient: Pick<WorkersAPIClient, 'getEndpoint' | 'getAuthToken' | 'getPluginVersion'>;

  /** Returns the latest persisted plugin settings. Called on each access. */
  getSettings: () => SocialArchiverSettings;

  /**
   * Persist a partial settings patch. Implementations must merge with the
   * current `data.json` snapshot (the plugin's existing `saveSettings`
   * helper does this).
   */
  saveSettings: (patch: Partial<SocialArchiverSettings>) => Promise<void>;

  /** Optional debug logger. Defaults to `console.debug`. */
  logger?: (message: string, ...args: unknown[]) => void;

  /**
   * Optional plugin manifest version override. When provided, takes
   * precedence over `apiClient.getPluginVersion()`. Useful in tests.
   */
  pluginVersion?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function logDefault(message: string, ...args: unknown[]): void {
  // Use console.debug so production builds stay quiet without users
  // having to wire in a real Logger instance.
  // eslint-disable-next-line no-console
  console.debug(`[NoticesService] ${message}`, ...args);
}

function isExpired(notice: NoticePayloadV1, nowMs: number, offsetMs: number): boolean {
  const expiry = Date.parse(notice.expiresAt);
  if (Number.isNaN(expiry)) {
    // Malformed expiry — treat as expired to fail closed.
    return true;
  }
  return expiry <= nowMs + offsetMs;
}

/**
 * Pick the highest priority unexpired non-dismissed top_banner notice.
 * Tie-break: priority desc, then id asc (lexicographic).
 *
 * Mirrors `selectVisibleNotice` from `mobile-app/src/stores/noticesStore.ts`.
 */
function selectVisibleFromState(state: NoticesServiceState): NoticePayloadV1 | null {
  if (!state.hydrated) return null;

  const nowMs = Date.now();
  const candidates: NoticePayloadV1[] = [];

  for (const notice of state.notices) {
    if (notice.surface !== 'top_banner') continue;
    if (isExpired(notice, nowMs, state.serverTimeOffsetMs)) continue;
    if (notice.dismissPolicy !== 'sticky' && state.dismissedIds.has(notice.id)) {
      continue;
    }
    candidates.push(notice);
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.id.localeCompare(b.id);
  });

  return candidates[0] ?? null;
}

// ============================================================================
// Service
// ============================================================================

export class NoticesService {
  private readonly deps: NoticesServiceDeps;
  private readonly log: (message: string, ...args: unknown[]) => void;

  private state: NoticesServiceState = {
    notices: [],
    lastFetchedAt: null,
    serverTimeOffsetMs: 0,
    dismissedIds: new Set<string>(),
    hydrated: false,
  };

  private readonly listeners = new Set<NoticesServiceListener>();

  // Lifecycle handles
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityHandler: (() => void) | null = null;
  private onlineHandler: (() => void) | null = null;
  private booted = false;
  private fetching = false;

  constructor(deps: NoticesServiceDeps) {
    this.deps = deps;
    this.log = deps.logger ?? logDefault;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Hydrate dismiss state from settings, schedule the initial fetch, and
   * wire focus/online listeners + the 15-minute interval.
   *
   * Idempotent — calling `boot()` twice is a no-op so callers don't have
   * to track it.
   */
  boot(): void {
    if (this.booted) return;
    this.booted = true;

    // 1. Hydrate dismissed ids synchronously so the very first paint of
    //    the banner respects prior dismissals even if the fetch hasn't
    //    landed yet. We still gate rendering behind `hydrated === true`
    //    via the selector, because PRD §Visibility Rules requires us to
    //    wait for the first fetch to complete or fail before showing
    //    anything (notice payloads are not persisted, so the in-memory
    //    list is empty until then anyway).
    this.hydrateDismissed();

    // 2. Schedule the staggered startup fetch.
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      void this.fetch();
    }, STARTUP_FETCH_DELAY_MS);

    // 3. Wire visibility/online listeners. Use guarded references in case
    //    we're running outside a browser-like environment (e.g. SSR, but
    //    also some test setups). Obsidian renders inside Electron so
    //    `document` and `window` are always available at runtime — these
    //    guards exist purely for safety.
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this.visibilityHandler = () => {
        if (document.visibilityState === 'visible' && this.shouldFetch()) {
          void this.fetch();
        }
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      this.onlineHandler = () => {
        if (this.shouldFetch()) {
          void this.fetch();
        }
      };
      window.addEventListener('online', this.onlineHandler);
    }

    // 4. 15-minute periodic refresh.
    this.pollTimer = setInterval(() => {
      if (this.shouldFetch()) {
        void this.fetch();
      }
    }, POLL_INTERVAL_MS);
  }

  /**
   * Tear down all timers and listeners. Called from `Plugin.onunload()`.
   */
  shutdown(): void {
    if (this.startupTimer !== null) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    if (this.onlineHandler && typeof window !== 'undefined') {
      window.removeEventListener('online', this.onlineHandler);
      this.onlineHandler = null;
    }
    this.listeners.clear();
    this.booted = false;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Fetch the latest notices and update state. Best-effort — network
   * errors, malformed responses, and unknown schema versions are
   * swallowed silently (PRD §Polling Cadence "silent best effort").
   *
   * Concurrent calls are coalesced: while a fetch is in flight, any
   * additional `fetch()` calls return immediately.
   */
  async fetch(): Promise<void> {
    if (this.fetching) {
      return;
    }
    this.fetching = true;
    try {
      await this.fetchInner();
    } finally {
      this.fetching = false;
    }
  }

  /**
   * Mark a notice dismissed and persist the update. Idempotent — calling
   * with an already-dismissed id is a no-op (no save, no listener
   * notification).
   */
  async dismiss(id: string): Promise<void> {
    if (!id) return;
    if (this.state.dismissedIds.has(id)) return;

    // Update in-memory first so the UI hides the banner immediately even
    // if the settings save is slow.
    const nextSet = new Set(this.state.dismissedIds);
    nextSet.add(id);
    this.setState({ dismissedIds: nextSet });

    // Set-merge with the latest persisted ids so a parallel sync from
    // another desktop doesn't clobber unique entries on either side.
    const persisted = this.deps.getSettings().dismissedNoticeIds ?? [];
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const existing of persisted) {
      if (typeof existing !== 'string') continue;
      const trimmed = existing.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      merged.push(trimmed);
    }
    if (!seen.has(id)) {
      seen.add(id);
      merged.push(id);
    }

    // Cap at 200 ids — PRD §Dismiss Persistence "keep the most recent
    // 200". Sliding-window via array order: drop from the head.
    const trimmed = merged.length > MAX_DISMISSED_IDS
      ? merged.slice(merged.length - MAX_DISMISSED_IDS)
      : merged;

    try {
      await this.deps.saveSettings({ dismissedNoticeIds: trimmed });
    } catch (error) {
      // Persistence failure is recoverable — the user dismissed for this
      // session and we'll re-show on next launch. Acceptable per PRD.
      this.log(
        'dismiss persist failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Return the single notice that should currently render (or `null` if
   * the timeline should show nothing). Pure function over current state.
   */
  getVisibleNotice(): NoticePayloadV1 | null {
    return selectVisibleFromState(this.state);
  }

  /**
   * Subscribe to state changes. Returns an unsubscribe function. The
   * listener is NOT invoked on subscription — callers should query
   * `getVisibleNotice()` once to render the initial state.
   */
  onUpdate(listener: NoticesServiceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Snapshot of the current state. Exposed primarily for tests; the UI
   * should use `getVisibleNotice()` instead.
   */
  getState(): NoticesServiceState {
    return {
      ...this.state,
      // Defensive copy of the Set so callers can't mutate internal state.
      dismissedIds: new Set(this.state.dismissedIds),
      notices: [...this.state.notices],
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private hydrateDismissed(): void {
    const persisted = this.deps.getSettings().dismissedNoticeIds ?? [];
    const set = new Set<string>();
    for (const id of persisted) {
      if (typeof id === 'string' && id.trim()) {
        set.add(id.trim());
      }
    }
    this.setState({ dismissedIds: set, hydrated: true });
  }

  private shouldFetch(): boolean {
    // Skip when offline — we'd just timeout and burn battery.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return false;
    }
    return true;
  }

  private buildHeaders(): Record<string, string> {
    const settings = this.deps.getSettings();
    const pluginVersion =
      this.deps.pluginVersion ?? this.deps.apiClient.getPluginVersion();

    const acceptLanguage = typeof navigator !== 'undefined' && navigator.language
      ? navigator.language
      : 'en';

    const headers: Record<string, string> = {
      'X-Client': 'obsidian-plugin',
      'X-Client-Version': pluginVersion,
      // Critical: override the API client's `X-Platform` (which would
      // emit macos|windows|linux|ios|android) so the notice matcher's
      // `platforms: ['obsidian']` audience rule actually matches.
      'X-Platform': 'obsidian',
      'X-Client-Capabilities': CLIENT_CAPABILITIES,
      'Accept-Language': acceptLanguage,
    };

    // Stable install id — settings.deviceId is currently vault-synced,
    // which is acceptable for v2 because authenticated users are matched
    // by userId. PRD §Request Headers covers the future migration path.
    if (settings.deviceId) {
      headers['X-Install-Id'] = settings.deviceId;
    }

    const token = this.deps.apiClient.getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
  }

  private async fetchInner(): Promise<void> {
    if (!this.shouldFetch()) {
      return;
    }

    const endpoint = this.deps.apiClient.getEndpoint().replace(/\/$/, '');
    const url = `${endpoint}/api/app/notices`;

    let envelope: NoticesEnvelopeV1 | null = null;
    try {
      const response = await requestUrl({
        url,
        method: 'GET',
        headers: this.buildHeaders(),
        throw: false,
      });
      if (response.status < 200 || response.status >= 300) {
        this.log('non-OK status:', response.status);
        return;
      }
      envelope = response.json as NoticesEnvelopeV1;
    } catch (error) {
      this.log(
        'fetch failed:',
        error instanceof Error ? error.message : String(error),
      );
      return;
    }

    if (!envelope || typeof envelope !== 'object') {
      this.log('malformed envelope');
      return;
    }
    if (envelope.success === false) {
      const code = envelope.error?.code ?? 'unknown';
      const message = envelope.error?.message ?? 'no message';
      this.log(`server returned error envelope: ${code} - ${message}`);
      return;
    }

    const data = envelope.data as NoticesResponseV1 | undefined;
    if (!data || typeof data !== 'object') {
      this.log('missing data in success envelope');
      return;
    }
    if (data.schemaVersion !== 1) {
      this.log(
        'unsupported schemaVersion',
        (data as { schemaVersion?: unknown }).schemaVersion,
      );
      return;
    }
    if (!Array.isArray(data.notices)) {
      this.log('notices field is not an array');
      return;
    }

    // Filter notices to supported surface + schema version. Malformed
    // expiries are kept in the list because the selector treats them as
    // expired (fail-closed) rather than dropping them silently here —
    // this gives operators a way to detect bad payloads via telemetry.
    const filtered = data.notices.filter((n) => {
      if (!n || typeof n !== 'object') return false;
      if (n.schemaVersion !== 1) return false;
      if (!SUPPORTED_SURFACES.has(n.surface)) return false;
      return true;
    });

    // Server time offset for clock-skew tolerant expiry checks.
    let serverTimeOffsetMs = this.state.serverTimeOffsetMs;
    if (typeof data.serverTime === 'string') {
      const parsed = Date.parse(data.serverTime);
      if (!Number.isNaN(parsed)) {
        serverTimeOffsetMs = parsed - Date.now();
      }
    }

    this.setState({
      notices: filtered,
      lastFetchedAt: Date.now(),
      serverTimeOffsetMs,
    });
  }

  private setState(patch: Partial<NoticesServiceState>): void {
    this.state = { ...this.state, ...patch };
    this.notifyListeners();
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (error) {
        this.log(
          'listener threw:',
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }
}
