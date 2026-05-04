/**
 * NoticeBanner — In-App Notice Channel renderer (timeline surface).
 *
 * Pure TypeScript DOM-builder banner that mirrors the existing
 * LibrarySyncBanner / CrawlStatusBanner pattern. Subscribes to a
 * NoticesService instance and re-renders when its state changes.
 *
 * Visual contract:
 *   - Title-bearing notice  → single-line title-only row, click opens
 *                             NoticeDetailModal (delegated via deps).
 *   - Title-less notice     → body inline; click executes CTA directly
 *                             when a CTA is present, no-op otherwise.
 *   - X dismiss button      → calls NoticesService.dismiss(). Hidden for
 *                             dismissPolicy === 'sticky'.
 *
 * Telemetry:
 *   - `notice_impression` once per (notice id, plugin session).
 *   - `notice_cta_clicked` only fires for clicks that *initiate* a CTA
 *     (banner click on titleless rows; NoticeDetailModal owns the modal
 *     CTA telemetry).
 *   - `notice_dismissed` on X press.
 *
 * Spec: `.taskmaster/docs/prd-in-app-notice-channel-plugin.md`
 */

import { setIcon } from 'obsidian';
import type {
  NoticeLevelV1,
  NoticePayloadV1,
} from '../../types/notices';
import type { NoticesService } from '../../services/NoticesService';
import type { NoticeTelemetryService } from '../../services/NoticeTelemetryService';

// ============================================================================
// Constants
// ============================================================================

/** URL schemes the plugin will open via `window.open`. */
const ALLOWED_URL_SCHEMES: ReadonlySet<string> = new Set([
  'https:',
  'sa:',
  'obsidian:',
]);

/**
 * Plugin-owned mobile billing handoff URL. Intentionally hardcoded here
 * (not read from notice payload) per PRD §"CTA Action Mapping": the
 * server only sends `cta.url` for `open_url` action.
 */
const MOBILE_HANDOFF_URL = 'https://social-archive.org/get-mobile';

// ============================================================================
// Level → icon mapping (shared with NoticeDetailModal via export)
// ============================================================================

export function noticeLevelIcon(level: NoticeLevelV1): string {
  switch (level) {
    case 'success':
      return 'check';
    case 'warning':
      return 'alert-triangle';
    case 'error':
      return 'x-circle';
    case 'info':
    default:
      return 'info';
  }
}

export function noticeLevelLabel(level: NoticeLevelV1): string {
  switch (level) {
    case 'success':
      return 'Success';
    case 'warning':
      return 'Heads up';
    case 'error':
      return 'Important';
    case 'info':
    default:
      return 'Notice';
  }
}

// ============================================================================
// CTA execution helper — exported so NoticeDetailModal reuses the exact
// same action mapping without duplicating it.
// ============================================================================

export interface ExecuteCtaDeps {
  noticesService: Pick<NoticesService, 'dismiss'>;
}

/**
 * Execute the action attached to a notice's CTA. Pure routing —
 * telemetry is owned by the caller (banner / detail modal) so each
 * surface can decide whether the click was intentional.
 *
 * Notes:
 *   - `open_url`: scheme allowlist enforced; invalid → console.warn,
 *     no-op (do not throw).
 *   - `open_paywall`: opens the plugin-owned handoff URL; never reads
 *     `cta.url` (PRD §"CTA Action Mapping").
 *   - `open_rewards`: warn + return; rewards surface does not exist on
 *     the plugin.
 *   - `dismiss`: same as the X button.
 *
 * After the action runs, applies `dismissPolicy === 'on_cta_local'`
 * idempotently. `dismiss` action callers don't need to worry about
 * duplicate dismiss calls — `NoticesService.dismiss()` is idempotent.
 */
export function executeCta(
  notice: NoticePayloadV1,
  deps: ExecuteCtaDeps,
): void {
  const cta = notice.cta;
  if (!cta) return;

  switch (cta.action) {
    case 'open_url': {
      if (!cta.url) {
        console.warn('[NoticeBanner] open_url notice is missing cta.url');
        break;
      }
      if (!isAllowedUrl(cta.url)) {
        console.warn(
          '[NoticeBanner] open_url rejected: scheme not in allowlist',
          cta.url,
        );
        break;
      }
      window.open(cta.url, '_blank');
      break;
    }
    case 'open_paywall': {
      const lang = pluginLang();
      const url = `${MOBILE_HANDOFF_URL}?from=plugin&lang=${lang}`;
      window.open(url, '_blank');
      break;
    }
    case 'open_rewards': {
      console.warn(
        '[NoticeBanner] open_rewards is unsupported in the Obsidian plugin',
      );
      break;
    }
    case 'dismiss': {
      void deps.noticesService.dismiss(notice.id);
      break;
    }
  }

  // dismissPolicy === 'on_cta_local' clears the notice on this install
  // after a CTA fires. Idempotent with the explicit `dismiss` action.
  if (notice.dismissPolicy === 'on_cta_local') {
    void deps.noticesService.dismiss(notice.id);
  }
}

function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_URL_SCHEMES.has(parsed.protocol);
  } catch {
    return false;
  }
}

function pluginLang(): 'ko' | 'en' {
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
    return navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en';
  }
  return 'en';
}

// ============================================================================
// Banner component
// ============================================================================

export interface NoticeBannerDeps {
  noticesService: NoticesService;
  telemetry: NoticeTelemetryService;
  /** Owner-side hook for opening the detail modal (Obsidian Modal). */
  onOpenDetail: (notice: NoticePayloadV1) => void;
}

export class NoticeBanner {
  private readonly parentEl: HTMLElement;
  private readonly deps: NoticeBannerDeps;

  /** The actual banner DOM, lazily created/destroyed in render(). */
  private bannerEl: HTMLElement | null = null;

  /** Cleanup functions for listeners attached to the current bannerEl. */
  private listenerCleanups: Array<() => void> = [];

  /** Notice ids whose impression event has already been recorded. */
  private readonly impressedIds = new Set<string>();

  /** NoticesService.onUpdate unsubscribe. */
  private unsubscribe: (() => void) | null = null;

  constructor(parentEl: HTMLElement, deps: NoticeBannerDeps) {
    this.parentEl = parentEl;
    this.deps = deps;

    // Subscribe to state changes; listener triggers a re-render.
    this.unsubscribe = this.deps.noticesService.onUpdate(() => {
      this.render();
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Idempotent render. Called from constructor (initial paint),
   * NoticesService.onUpdate listener, and manual external triggers.
   */
  render(): void {
    const notice = this.deps.noticesService.getVisibleNotice();
    if (!notice) {
      this.removeBanner();
      return;
    }

    // Rebuild the row each call so we don't have to diff title/body/CTA
    // changes for the same notice id (rare but possible if the server
    // mutates a notice without rotating the id).
    this.removeBanner();
    this.bannerEl = this.buildBannerEl(notice);
    this.parentEl.appendChild(this.bannerEl);

    // Fire impression telemetry once per (notice id, session).
    if (!this.impressedIds.has(notice.id)) {
      this.impressedIds.add(notice.id);
      this.deps.telemetry.trackImpression(notice);
    }
  }

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.removeBanner();
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  private buildBannerEl(notice: NoticePayloadV1): HTMLElement {
    const title = notice.title?.trim();
    const hasTitle = !!title;
    const hasCta = !!notice.cta;
    const isSticky = notice.dismissPolicy === 'sticky';
    const tappable = hasTitle || hasCta;

    // Outer row
    const banner = document.createElement('div');
    banner.classList.add('nb-banner', `nb-level-${notice.level}`);
    if (tappable) {
      banner.classList.add('nb-banner-tappable');
    }
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');

    // Icon
    const iconEl = document.createElement('span');
    iconEl.classList.add('nb-icon');
    setIcon(iconEl, noticeLevelIcon(notice.level));
    banner.appendChild(iconEl);

    // Text — title only when title present, otherwise body inline.
    // Use textContent (not innerHTML) so untrusted notice copy can never
    // execute as markup. This is the same effect as Obsidian's
    // `el.setText(...)`, but works on a plain `document.createElement`
    // node without depending on the Obsidian element-prototype patches.
    const textEl = document.createElement('span');
    textEl.classList.add('nb-text');
    if (hasTitle) textEl.classList.add('nb-text-title');
    textEl.textContent = hasTitle ? title! : notice.body;
    banner.appendChild(textEl);

    // Title or body region click handling.
    if (tappable) {
      const handleClick = (e: MouseEvent): void => {
        // Stop propagation so this doesn't bubble into the X button or
        // any owning row click handler.
        e.stopPropagation();
        this.handleBodyClick(notice);
      };
      // Bind at the row level so the whole strip is clickable, but skip
      // events that originated on the X button (handled separately).
      banner.addEventListener('click', handleClick);
      this.listenerCleanups.push(() =>
        banner.removeEventListener('click', handleClick),
      );
    }

    // X dismiss
    if (!isSticky) {
      const closeBtn = document.createElement('button');
      closeBtn.classList.add('nb-close');
      closeBtn.setAttribute('aria-label', 'Dismiss notice');
      setIcon(closeBtn, 'x');

      const handleClose = (e: MouseEvent): void => {
        e.stopPropagation();
        this.handleDismiss(notice);
      };
      closeBtn.addEventListener('click', handleClose);
      this.listenerCleanups.push(() =>
        closeBtn.removeEventListener('click', handleClose),
      );
      banner.appendChild(closeBtn);
    }

    return banner;
  }

  private handleBodyClick(notice: NoticePayloadV1): void {
    const hasTitle = !!notice.title?.trim();

    // Title present → defer to the detail modal. Telemetry for the CTA
    // fires from inside the modal so we don't double-count when the
    // user opens the modal but cancels.
    if (hasTitle) {
      this.deps.onOpenDetail(notice);
      return;
    }

    // Titleless + no CTA → no-op (do not fire CTA telemetry to keep
    // signal clean).
    if (!notice.cta) return;

    // Titleless with CTA → fire CTA directly.
    this.deps.telemetry.trackCtaClicked(notice);
    executeCta(notice, { noticesService: this.deps.noticesService });
  }

  private handleDismiss(notice: NoticePayloadV1): void {
    this.deps.telemetry.trackDismissed(notice);
    void this.deps.noticesService.dismiss(notice.id);
  }

  private removeBanner(): void {
    for (const cleanup of this.listenerCleanups) {
      try {
        cleanup();
      } catch {
        // Listener cleanup must never throw; swallow defensively.
      }
    }
    this.listenerCleanups = [];

    if (this.bannerEl && this.bannerEl.parentElement) {
      this.bannerEl.parentElement.removeChild(this.bannerEl);
    }
    this.bannerEl = null;
  }
}
