/**
 * AnnotationFallbackPoller
 *
 * Single Responsibility: when the Realtime WebSocket is degraded from the
 * private to the public channel (ticket failure), periodically re-fetch the
 * user's archive delta via `getUserArchives({ updatedAfter, includeDeleted })`
 * so that annotation/action events the public channel cannot deliver still
 * make it to the vault (§5.8, §5.9).
 *
 * State machine:
 *
 *   idle ──start()──▶ polling ──stop()──▶ idle
 *                      │
 *                      └─ tick (30 s ± 5 s jitter) ──▶ fetch delta
 *                           │
 *                           ├─ success  → update `updatedAfter`, re-arm
 *                           └─ error    → fail-closed: stop, wait for next
 *                                         WS recovery or external start()
 *
 * Annotation-flip detection (Codex HOLD #6):
 *   `GET /api/user/archives` only returns count fields
 *   (`userHighlightCount` / `userNoteCount`) — the full `userHighlights` /
 *   `userNotes` arrays live on `GET /api/user/archives/:archiveId`. To catch
 *   the first-ever annotation (0 → 1) we must:
 *     1. Track the previous count snapshot per archive across ticks.
 *     2. When a flip is observed (any of the annotation counts increased, or
 *        the archive newly has annotations), fetch per-archive detail via
 *        `apiClient.getUserArchive(id)` and deliver the hydrated record to
 *        `onArchiveUpdate`.
 *   Archives whose counts are unchanged (or non-flipping, e.g. 2 → 2) do NOT
 *   trigger a detail fetch — delivered as-is so the caller can still react
 *   to non-annotation fields (isLiked, shareUrl, etc.) if needed.
 *
 * Guardrails:
 *  - Fail-closed on network errors: do not loop retries. The WebSocket's
 *    own reconnect loop is the recovery path; this poller is only a safety
 *    net while degraded. A detail-fetch failure stops the poller for the
 *    same reason (any upstream instability must defer to WS recovery).
 *  - Exposes `isActive()` for diagnostics and a force-tick `pollOnce()`
 *    hook used by unit tests (not part of the production code path).
 */

import type { UserArchive, WorkersAPIClient } from './WorkersAPIClient';

export interface AnnotationFallbackPollerDeps {
  /** API client used to fetch the archive delta and per-archive details. */
  apiClient: WorkersAPIClient;
  /**
   * Receives every archive returned by the delta query. When an annotation
   * count flip is detected the poller fetches per-archive detail first so
   * the archive passed here is hydrated with full `userNotes` /
   * `userHighlights` arrays (not just counts).
   */
  onArchiveUpdate: (archive: UserArchive) => void;
  /** Polling cadence; defaults to 30 s with ±5 s jitter. */
  intervalMs?: number;
  jitterMs?: number;
  /** Inject a deterministic random for jitter in tests. */
  random?: () => number;
  /** Inject timer primitives for tests. */
  setTimer?: (cb: () => void, ms: number) => number;
  clearTimer?: (id: number) => void;
}

/** Snapshot of annotation counts for a single archive between ticks. */
interface AnnotationCountSnapshot {
  noteCount: number;
  highlightCount: number;
}

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_JITTER_MS = 5_000;

export class AnnotationFallbackPoller {
  private readonly apiClient: WorkersAPIClient;
  private readonly onArchiveUpdate: (archive: UserArchive) => void;
  private readonly intervalMs: number;
  private readonly jitterMs: number;
  private readonly random: () => number;
  private readonly setTimer: (cb: () => void, ms: number) => number;
  private readonly clearTimer: (id: number) => void;

  /** Rolling watermark; updated on each successful tick. */
  private updatedAfter: string;
  private timerId: number | null = null;
  private active = false;

  /**
   * Per-archive annotation count snapshot across ticks. Used to detect flips
   * (e.g. 0 → 1 note/highlight) so we can hydrate via per-archive detail
   * fetch. Cleared on `start()` so a new degrade session starts fresh.
   */
  private readonly countSnapshots: Map<string, AnnotationCountSnapshot> = new Map();

  constructor(deps: AnnotationFallbackPollerDeps) {
    this.apiClient = deps.apiClient;
    this.onArchiveUpdate = deps.onArchiveUpdate;
    this.intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.jitterMs = deps.jitterMs ?? DEFAULT_JITTER_MS;
    this.random = deps.random ?? Math.random;

    // Use provided timer primitives, otherwise use window timers if present
    // (Obsidian runs in a browser-like env), otherwise setTimeout/clearTimeout.
    const hasWindow = typeof window !== 'undefined';
    this.setTimer = deps.setTimer
      ?? (hasWindow
        ? ((cb, ms) => window.setTimeout(cb, ms))
        : ((cb, ms) => setTimeout(cb, ms) as unknown as number));
    this.clearTimer = deps.clearTimer
      ?? (hasWindow
        ? ((id) => window.clearTimeout(id))
        : ((id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>)));

    // Start the watermark at "now" — we only care about updates that arrive
    // while we're degraded; anything older than `start()` should have come
    // through a prior private-channel WS event.
    this.updatedAfter = new Date().toISOString();
  }

  isActive(): boolean {
    return this.active;
  }

  /** Start polling if not already active. Idempotent. */
  start(): void {
    if (this.active) return;
    this.active = true;
    // Reset watermark so we only pick up events after the degrade point.
    this.updatedAfter = new Date().toISOString();
    // Drop stale count snapshots from the previous degrade session — the
    // vault may have received private-channel events in the meantime so the
    // snapshot is no longer authoritative.
    this.countSnapshots.clear();
    this.scheduleNext();
  }

  /** Stop polling. Idempotent. */
  stop(): void {
    this.active = false;
    if (this.timerId !== null) {
      this.clearTimer(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Execute a single tick. Used by the internal timer and by tests.
   * Fails closed on error: the poller stops, and the caller must call
   * `start()` again (typically on a future WS degrade event) to resume.
   */
  async pollOnce(): Promise<void> {
    if (!this.active) return;
    try {
      const response = await this.apiClient.getUserArchives({
        updatedAfter: this.updatedAfter,
        includeDeleted: true,
      });

      // Advance watermark to server time (preferred) or now() fallback.
      // `serverTime` shape mirrors GET /api/user/archives response contract.
      const serverTime = (response as { serverTime?: string }).serverTime;
      this.updatedAfter = typeof serverTime === 'string' && serverTime
        ? serverTime
        : new Date().toISOString();

      for (const archive of response.archives ?? []) {
        // Detect annotation count flips vs previous snapshot. The list
        // endpoint only carries count fields — the full userNotes /
        // userHighlights arrays live on the per-archive detail endpoint.
        const prev = this.countSnapshots.get(archive.id);
        const currentNoteCount = Math.max(0, archive.userNoteCount ?? 0);
        const currentHighlightCount = Math.max(0, archive.userHighlightCount ?? 0);
        const prevNoteCount = prev?.noteCount ?? 0;
        const prevHighlightCount = prev?.highlightCount ?? 0;

        // Update snapshot immediately — even if the flip-fetch fails we do
        // not want to loop on the same archive; failures stop the poller
        // outright (fail-closed below).
        this.countSnapshots.set(archive.id, {
          noteCount: currentNoteCount,
          highlightCount: currentHighlightCount,
        });

        const countsIncreased =
          currentNoteCount > prevNoteCount || currentHighlightCount > prevHighlightCount;
        const firstEverAnnotation =
          !prev && (currentNoteCount > 0 || currentHighlightCount > 0);

        let hydrated = archive;
        if (countsIncreased || firstEverAnnotation) {
          // Count flip → hydrate via per-archive detail endpoint so the
          // reconciler receives the full userNotes / userHighlights arrays.
          const detail = await this.apiClient.getUserArchive(archive.id);
          hydrated = detail.archive;
        }

        try {
          this.onArchiveUpdate(hydrated);
        } catch (err) {
          // Per-archive handler errors must not stop the whole tick.
          console.warn(
            '[AnnotationFallbackPoller] onArchiveUpdate threw for',
            archive.id,
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      if (this.active) this.scheduleNext();
    } catch (err) {
      // Fail-closed: stop polling and wait for next WS event / recovery.
      // Covers both list-fetch and per-archive detail-fetch failures.
      console.warn(
        '[AnnotationFallbackPoller] tick failed, stopping fallback polling until next WS degrade:',
        err instanceof Error ? err.message : String(err),
      );
      this.stop();
    }
  }

  private scheduleNext(): void {
    if (!this.active) return;
    if (this.timerId !== null) {
      this.clearTimer(this.timerId);
      this.timerId = null;
    }
    const jitter = this.jitterMs > 0 ? Math.round(this.random() * this.jitterMs) : 0;
    const delay = this.intervalMs + jitter;
    this.timerId = this.setTimer(() => {
      this.timerId = null;
      void this.pollOnce();
    }, delay);
  }
}
