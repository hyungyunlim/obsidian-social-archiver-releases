/**
 * PreviewableInteractionsRenderer
 * ---------------------------------------------------------------------------
 * Sub-renderer for the **counts portion** of a post card's interactions row
 * (likes / comments / shares / views). This is the SLIMMEST member of the
 * Round-2 sub-renderer family — it intentionally renders only the read-only
 * social-proof badges, never the action buttons (Like, Archive, Share, Edit,
 * Delete, Tag, Reader-Mode, Open-Note, Overflow). Action buttons stay inside
 * `PostCardRenderer` because each one dispatches a vault-coupled callback.
 *
 * Round-2 design notes (PRD `prd-instagram-import-gallery.md` §0):
 *
 *  - **No fork.** `PostCardRenderer.ts` is NOT modified in this round —
 *    Round-3 will rewire its `renderInteractions` to compose this class with
 *    its own button group. Until then this file is dormant code, exercised
 *    only by its own tests and by the Import Gallery preview path.
 *
 *  - **WYSIWYG class names.** The DOM emitted here uses the SAME CSS class
 *    names as the source (`pcr-action-btn`, `pcr-action-icon`,
 *    `pcr-action-count`) so `src/styles/components/post-card.css` styles
 *    the gallery preview identically to the vault timeline.
 *
 *  - **Platform-agnostic.** Works for any `PostData`. Counts that are zero
 *    or absent are silently omitted — never rendered as `"0"`. (PRD §0.)
 *
 *  - **No new third-party deps.** Pure DOM via `document.createElement`,
 *    matching `PreviewableCardRenderer`'s approach. We deliberately do NOT
 *    pull in `setIcon` / `setCssProps` — those are Obsidian-runtime helpers
 *    that don't exist in the unit-test mock. The `pcr-action-icon` slot is
 *    still emitted (so the stylesheet's icon-positioning rules apply); a
 *    plain text glyph (`♥`, `💬`, `↻`, `👁`) lives inside it. This degrades
 *    gracefully: the eventual Round-3 wiring can replace the glyph with
 *    `setIcon(slot, 'heart')` from inside `PostCardRenderer` without
 *    changing the surrounding DOM.
 *
 *  - **Composable split.** The public `renderCounts()` method appends
 *    counts INTO an existing interactions container created by the caller.
 *    Round-3's `PostCardRenderer.render()` will:
 *
 *        1. create the outer `.pcr-interactions` container (with
 *           `pcr-interactions-bordered` toggled by `isEmbedded`)
 *        2. call `interactionsRenderer.renderCounts(interactionsEl, post)`
 *           to fill the LEFT side with read-only count badges
 *        3. append `<div class="pcr-spacer">` itself
 *        4. append its own action buttons (Like, Archive, Share, …) on
 *           the RIGHT side — these stay vault-coupled
 *
 *    For preview-only consumers (the Instagram Import Gallery), step (1) is
 *    still the caller's responsibility, but steps (3) and (4) are skipped:
 *    the counts alone are a complete read-only social-proof preview.
 */

import { setIcon } from 'obsidian';
import type { PostData } from '../../../types/post';
import { formatNumber } from './PreviewableHelpers';
import type { PreviewContext } from './PreviewableContext';

// Re-export so existing direct imports of `PreviewContext` from this file
// keep working without a cascade of touch-ups across the codebase.
export type { PreviewContext } from './PreviewableContext';

/**
 * The four kinds of count badges this renderer knows how to emit. Order
 * here is the canonical render order used by `renderCounts()`.
 */
export type CountKind = 'likes' | 'comments' | 'shares' | 'views';

/**
 * Lucide icon names used inside the `.pcr-action-icon` slot. These match
 * the icon vocabulary used by `PostCardRenderer.renderInteractions` so the
 * gallery preview is visually identical to the vault timeline.
 *
 * `setIcon` is imported from 'obsidian' but defensively guarded at the call
 * site — the unit-test obsidian mock doesn't expose it, so we fall back to
 * the previous unicode glyph for that slot. This preserves test coverage
 * for environments without Obsidian's runtime.
 */
const COUNT_LUCIDE_ICONS: Record<CountKind, string> = {
  likes: 'heart',
  comments: 'message-circle',
  // `repeat-2` matches what the vault timeline (`PostCardRenderer`) emits for
  // the share/reblog action — keeping the gallery preview visually
  // identical to what users see in the timeline (PRD §0 WYSIWYG).
  shares: 'repeat-2',
  views: 'eye',
};

/**
 * Fallback unicode glyphs rendered when `setIcon` is unavailable (jsdom
 * unit tests, headless preview surfaces, etc.). The DOM structure and the
 * surrounding `.pcr-action-icon` slot are identical regardless of which
 * branch fires, so `post-card.css` styles both paths uniformly.
 */
const COUNT_ICON_FALLBACKS: Record<CountKind, string> = {
  likes: '\u2665',     // ♥
  comments: '\uD83D\uDCAC', // 💬
  shares: '\u21BB',    // ↻
  views: '\uD83D\uDC41', // 👁
};

/**
 * Render the read-only counts portion of a post card's interactions row.
 *
 * Stateless and side-effect free: instances retain only the constructor
 * `context` for parity with sibling sub-renderers. The same instance can
 * be reused across many posts.
 */
export class PreviewableInteractionsRenderer {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(private readonly context: PreviewContext) {}

  /**
   * Append the counts portion (likes / comments / shares / views) into
   * `interactionsEl`, which the caller has already created with the
   * `.pcr-interactions` class. Counts whose value is missing or zero are
   * silently skipped — there is no `"0 ❤"` rendering.
   *
   * Returns a logical "counts container" element so callers can refine,
   * style, or measure. Today we use the same `interactionsEl` as the
   * container and return it directly; the contract leaves room for a
   * future grouping wrapper without breaking callers.
   *
   * Caller is expected to append the spacer + action-button group AFTER
   * this call (vault-coupled buttons stay in `PostCardRenderer`).
   */
  public renderCounts(
    interactionsEl: HTMLElement,
    post: PostData,
  ): HTMLElement {
    const meta = post?.metadata ?? ({} as PostData['metadata']);

    // Order matches the PostCardRenderer source (likes -> comments -> shares).
    // Views is appended at the end because the source omits it from its
    // interaction bar today; the gallery preview includes it for parity
    // with `PreviewableCardRenderer.renderInteractions`.
    this.appendCountIfPresent(interactionsEl, 'likes', meta.likes);
    this.appendCountIfPresent(interactionsEl, 'comments', meta.comments);
    this.appendCountIfPresent(interactionsEl, 'shares', meta.shares);
    this.appendCountIfPresent(interactionsEl, 'views', meta.views);

    return interactionsEl;
  }

  /**
   * Render a single count badge into `parent`. Useful for compact toolbars
   * (e.g. the gallery's per-card overlay) that need just one number with
   * its icon, not the full row. Always renders, even for zero — callers
   * choosing `renderSingleCount()` are opting in explicitly to a fixed slot.
   *
   * Returns the badge element so callers can attach handlers if they need
   * to (the badge is a `<div>` so it is non-interactive by default,
   * matching the source's `.pcr-action-btn` count behavior).
   */
  public renderSingleCount(
    parent: HTMLElement,
    kind: CountKind,
    value: number,
  ): HTMLElement {
    return this.createCountBadge(parent, kind, value);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Skip-or-render decision shared by the loop in `renderCounts()`.
   * Treats `undefined`, `null`, non-finite, and `<= 0` as "no data".
   */
  private appendCountIfPresent(
    parent: HTMLElement,
    kind: CountKind,
    value: number | undefined | null,
  ): void {
    if (value === undefined || value === null) return;
    if (!Number.isFinite(value)) return;
    if (value <= 0) return;
    this.createCountBadge(parent, kind, value);
  }

  /**
   * Build a single `.pcr-action-btn` count badge with the canonical
   * source DOM:
   *
   *   <div class="pcr-action-btn">
   *     <div class="pcr-action-icon">[glyph]</div>
   *     <span class="pcr-action-count">[formatted number]</span>
   *   </div>
   *
   * The `--pcr-meta-gap` CSS variable is set inline (matching the source's
   * `setCssProps` call) so the post-card stylesheet can pick it up.
   */
  private createCountBadge(
    parent: HTMLElement,
    kind: CountKind,
    value: number,
  ): HTMLElement {
    const btn = document.createElement('div');
    btn.classList.add('pcr-action-btn');
    btn.setAttribute('data-count-kind', kind);
    // Source uses `setCssProps({'--pcr-meta-gap': '6px'})` which is just an
    // Obsidian wrapper around `style.setProperty`. We use the public DOM
    // API directly so the sub-renderer works in jsdom unit tests where
    // the Obsidian element enrichments aren't installed.
    btn.style.setProperty('--pcr-meta-gap', '6px');

    const iconSlot = document.createElement('div');
    iconSlot.classList.add('pcr-action-icon');
    // Prefer the lucide SVG (matches vault timeline). Fall back to the
    // unicode glyph when `setIcon` is absent — jsdom unit tests, the
    // headless preview, or any environment that doesn't ship Obsidian's
    // runtime helpers will hit this branch.
    if (typeof setIcon === 'function') {
      setIcon(iconSlot, COUNT_LUCIDE_ICONS[kind]);
    } else {
      iconSlot.textContent = COUNT_ICON_FALLBACKS[kind];
    }
    btn.appendChild(iconSlot);

    const countEl = document.createElement('span');
    countEl.classList.add('pcr-action-count');
    countEl.textContent = formatNumber(value);
    btn.appendChild(countEl);

    parent.appendChild(btn);
    return btn;
  }
}
