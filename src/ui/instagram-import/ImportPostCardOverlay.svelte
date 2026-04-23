<script lang="ts">
  /**
   * ImportPostCardOverlay — single review-card wrapper for the Instagram
   * Import Review Gallery (PRD prd-instagram-import-gallery.md §5.3, §6).
   *
   * Responsibilities (single-responsibility per PRD §0):
   *   1. Wrap a child card (slot) in a positioned container.
   *   2. Paint the per-card selection checkbox in the top-right with a 44 px
   *      hit area — only the checkbox area intercepts clicks; the rest of
   *      the card is non-interactive in this gallery context (PRD §5.3
   *      "click-to-expand reader on card body — review must stay strictly
   *      selection-focused; the card body is non-interactive in the gallery
   *      context").
   *   3. Render duplicate items at reduced opacity with an `Already archived`
   *      badge; their checkbox is disabled and not focusable.
   *   4. Forward keyboard activation (`Space` / `Enter`) on the focused
   *      checkbox to `onToggle`.
   *
   * Out of scope here: the actual post body (caption, media, author chrome).
   * That is rendered by the parent (`ImportGalleryContainer`) into the slot.
   *
   * Testing surface (manual):
   *   - Unit: render with `isDuplicate=true` → checkbox is `disabled` and the
   *     wrapper has `data-import-duplicate="true"`.
   *   - Unit: render with `isSelected=true` → checkbox has `aria-checked="true"`
   *     and the visible indicator is the filled state.
   *   - Manual: pointer events on the card body do NOT fire `onToggle`.
   *
   * PRD: §5.3 (visible selection control with 44 px hit area).
   *
   * --------------------------------------------------------------------------
   * Visual contract — Instagram-style circular selection indicator (Polish A3)
   * --------------------------------------------------------------------------
   * The checkbox replaces the old "system checkbox + translucent backdrop"
   * with a clean circular indicator that pops against any media tile, mirroring
   * Instagram's own selection UI:
   *
   *   Unselected → 24 px circle, transparent fill, 2 px white outline,
   *                subtle 0,0,0,0.3 outer drop shadow for contrast on
   *                light/dark backgrounds.
   *   Selected   → 24 px circle, solid `var(--interactive-accent)` fill,
   *                white checkmark inside, NO border (clean filled circle),
   *                soft white drop shadow ring.
   *   Hover      → 1.05× scale-up over 100ms (filled or unfilled).
   *   Focus      → 2 px solid `var(--interactive-accent)` outline OUTSIDE
   *                the indicator (offset 2 px) for keyboard nav.
   *   Disabled   → muted color, no hover scale, cursor not-allowed.
   *
   * Hit area stays 44 × 44 px (preserved for accessibility per PRD §5.3).
   *
   * --------------------------------------------------------------------------
   * Manual visual verification checklist (Polish A3)
   * --------------------------------------------------------------------------
   *   1. Open the gallery on a job with a mix of images, videos, and text-only
   *      posts. The unselected circle should be visible against bright photos
   *      AND dark photos AND the empty "Text-only post" tile.
   *   2. Click a card's checkbox → the circle fills with accent color and
   *      shows a white checkmark. The card grows an accent border.
   *   3. Hover over an unselected checkbox → it scales up subtly (1.05×).
   *   4. Tab to a checkbox → a thin accent outline appears OUTSIDE the
   *      circle (not inside / not on the icon background).
   *   5. A duplicate card shows the muted indicator and "Already archived"
   *      badge; clicking it does NOT toggle selection.
   */

  import type { Snippet } from 'svelte';

  type Props = {
    /** Stable post identity — used in aria-label only; no logic depends on it. */
    postId: string;
    /** True when the store says this card is selected. */
    isSelected: boolean;
    /** True when the server preflight reported this post is already archived. */
    isDuplicate: boolean;
    /**
     * Display label for the checkbox aria-label. Instagram shortcode is
     * usually 6-11 chars and recognizable, so we surface it directly.
     */
    shortcode: string;
    /** Pre-bound toggle handler. The component never reaches into the store. */
    onToggle: () => void;
    /** Card body, rendered inside the wrapper. */
    children?: Snippet;
  };

  let { postId, isSelected, isDuplicate, shortcode, onToggle, children }: Props = $props();

  function handleCheckboxClick(e: MouseEvent): void {
    // Stop propagation so a future card-body click handler (if ever wired)
    // does not double-fire. PRD §5.3: checkbox click only toggles selection.
    e.stopPropagation();
    if (isDuplicate) return;
    onToggle();
  }

  function handleCheckboxKeydown(e: KeyboardEvent): void {
    if (isDuplicate) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      onToggle();
    }
  }
</script>

<div
  class="sa-ig-card"
  class:sa-ig-card--duplicate={isDuplicate}
  class:sa-ig-card--selected={isSelected && !isDuplicate}
  data-import-post-id={postId}
  data-import-duplicate={isDuplicate ? 'true' : 'false'}
  data-import-selected={isSelected && !isDuplicate ? 'true' : 'false'}
>
  {#if isDuplicate}
    <div class="sa-ig-card__dup-badge" aria-hidden="true">Already archived</div>
  {/if}

  <button
    type="button"
    class="sa-ig-card__checkbox"
    role="checkbox"
    aria-checked={isSelected && !isDuplicate}
    aria-label={isDuplicate
      ? `Already archived: post ${shortcode}`
      : `Select post ${shortcode}`}
    aria-disabled={isDuplicate ? 'true' : 'false'}
    disabled={isDuplicate}
    tabindex={isDuplicate ? -1 : 0}
    onclick={handleCheckboxClick}
    onkeydown={handleCheckboxKeydown}
  >
    <span
      class="sa-ig-card__checkbox-indicator"
      class:sa-ig-card__checkbox-indicator--selected={isSelected && !isDuplicate}
      aria-hidden="true"
    >
      {#if isSelected && !isDuplicate}
        <!-- filled circle + white checkmark -->
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="12" fill="currentColor" />
          <polyline
            points="6.5 12.5 10.5 16 17.5 8.5"
            fill="none"
            stroke="var(--text-on-accent, #fff)"
            stroke-width="2.4"
          />
        </svg>
      {:else}
        <!-- outline circle (empty) -->
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <circle
            cx="12"
            cy="12"
            r="11"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          />
        </svg>
      {/if}
    </span>
  </button>

  <div class="sa-ig-card__body">
    {#if children}
      {@render children()}
    {/if}
  </div>
</div>

<style>
  .sa-ig-card {
    position: relative;
    display: block;
    border-radius: var(--radius-m, 6px);
    background: var(--background-primary, transparent);
    border: 1px solid var(--background-modifier-border, #ccc);
    overflow: hidden;
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }

  .sa-ig-card--selected {
    border-color: var(--interactive-accent, #3b82f6);
    box-shadow: 0 0 0 1px var(--interactive-accent, #3b82f6);
  }

  .sa-ig-card--duplicate {
    opacity: 0.5;
  }

  .sa-ig-card--duplicate .sa-ig-card__body {
    pointer-events: none;
  }

  /* Checkbox positioned top-right with a 44 px hit area + 24 px circular
     indicator. The button itself fills 44×44 (hit area); the inner
     indicator is 24×24 and centered. Per PRD §5.3 only the checkbox area
     intercepts clicks — siblings stay pointer-events:auto while the rest
     of the card body is currently non-interactive (no body click handler).

     The button itself has NO background pad (Polish A3). The indicator
     is the only visible chrome — an Instagram-style circular dot. */
  /* Double-class specificity bump (`.sa-ig-card__checkbox.sa-ig-card__checkbox`)
     beats Obsidian's core `button` styles which apply `border` + `background`
     by default. Without the bump our `border: none` / `background: transparent`
     are overridden and the checkbox shows a default button border. */
  .sa-ig-card__checkbox.sa-ig-card__checkbox {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 2;
    width: 44px;
    height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    margin: 0;
    border: none;
    background: transparent;
    box-shadow: none;
    color: var(--interactive-accent, #3b82f6);
    cursor: pointer;
    border-radius: 50%;
  }

  .sa-ig-card__checkbox.sa-ig-card__checkbox:hover {
    background: transparent;
    box-shadow: none;
  }

  .sa-ig-card__checkbox:focus-visible {
    outline: none;
  }

  /* Drive the focus ring on the *indicator* so the outline sits on the
     visible 24 px circle, not on the 44 px empty hit area. */
  .sa-ig-card__checkbox:focus-visible .sa-ig-card__checkbox-indicator {
    outline: 2px solid var(--interactive-accent, #3b82f6);
    outline-offset: 2px;
    border-radius: 50%;
  }

  .sa-ig-card__checkbox:disabled {
    cursor: not-allowed;
    color: var(--text-muted, #777);
  }

  /* ---- Indicator: 24 px circle ------------------------------------- */
  .sa-ig-card__checkbox-indicator {
    display: inline-flex;
    width: 24px;
    height: 24px;
    line-height: 0;
    align-items: center;
    justify-content: center;
    /* No background pad. The SVG circle itself is the visible chrome. */
    background: transparent;
    border-radius: 50%;
    /* Unselected default: white stroke (rendered via SVG `stroke`), plus
       a subtle outer shadow so the ring reads on bright photo backgrounds.
       See `--selected` variant for the filled treatment. */
    color: #ffffff;
    /* Outer shadow gives contrast on busy / bright media tiles. */
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35))
      drop-shadow(0 0 1px rgba(0, 0, 0, 0.25));
    transition: transform 100ms ease, filter 120ms ease, color 120ms ease;
    transform-origin: center center;
  }

  /* Selected: solid accent fill, white checkmark, soft white ring for
     contrast on dark/colorful backgrounds. No border — the filled circle
     IS the indicator. */
  .sa-ig-card__checkbox-indicator--selected {
    color: var(--interactive-accent, #3b82f6);
    filter: drop-shadow(0 0 0 1.5px rgba(255, 255, 255, 0.9))
      drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35));
  }

  /* Hover: gentle scale-up. Only active for enabled checkboxes. */
  .sa-ig-card__checkbox:hover:not(:disabled) .sa-ig-card__checkbox-indicator {
    transform: scale(1.05);
  }

  /* Disabled: muted color, no scale. */
  .sa-ig-card__checkbox:disabled .sa-ig-card__checkbox-indicator {
    color: var(--text-muted, rgba(255, 255, 255, 0.55));
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.25));
    transform: none;
  }

  .sa-ig-card__dup-badge {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 2;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--background-modifier-error-hover, rgba(231, 76, 60, 0.15));
    color: var(--text-error, #e74c3c);
    font-size: var(--font-ui-smaller, 0.75rem);
    font-weight: var(--font-semibold, 600);
    text-transform: none;
    pointer-events: none;
  }

  .sa-ig-card__body {
    /* Body is currently non-interactive — see PRD §5.3 explicit exclusion of
       click-to-expand reader. We do NOT set pointer-events:none on selected
       cards because the user might still want to copy text or drag-select
       caption text. The parent simply doesn't wire any body click handler. */
    display: block;
  }
</style>
