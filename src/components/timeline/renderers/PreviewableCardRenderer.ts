/**
 * PreviewableCardRenderer
 * ---------------------------------------------------------------------------
 * Visual-chrome orchestrator for a `PostData` value, designed to be reused by
 * any *preview* surface that needs to render a real-looking post card without
 * dragging in vault-only chrome (action buttons, comment composer, AI banners,
 * share state, file lookups, etc.).
 *
 * Round 3 of the PostCardRenderer extraction. Replaces the previous "parallel
 * implementation" file (which inlined header/caption/media/interactions
 * markup) with a thin composition of the 4 Round-2 sub-renderers:
 *
 *   - PreviewableHeaderRenderer       — avatar / author / handle / time / pill
 *   - PreviewableContentRenderer      — caption / blog body / banners / gmaps
 *   - PreviewableMediaRenderer        — hero image / video poster / +N badge
 *   - PreviewableInteractionsRenderer — read-only count badges
 *
 * --- Engineering commitments (PRD §0) -------------------------------------
 *
 *   - SAME class as before — both consumers (`ImportGalleryContainer`,
 *     `PostCardRenderer.previewable`) instantiate this same class. No fork.
 *
 *   - SAME CSS class names as `PostCardRenderer` (`.pcr-card`, `.pcr-header`,
 *     `.pcr-content`, `.pcr-interactions`, `.pcr-action-btn`, …) so the
 *     existing vault stylesheet (`src/styles/components/post-card.css`)
 *     applies unchanged. WYSIWYG between preview and timeline.
 *
 *   - Every dependency in `PreviewContext` is OPTIONAL except
 *     `resolveMediaUrl`. Missing capabilities degrade gracefully (no
 *     subscription badge, no author note tooltip, plain-text caption, etc.) —
 *     never throw. Safe to mount inside a Svelte component without an `App`
 *     handle.
 *
 *   - No new third-party deps. No build-config changes.
 *
 * --- Caller contract -----------------------------------------------------
 *
 * `render()` returns the outer `.pcr-card` element so callers can layer
 * additional chrome on top:
 *
 *   - `PostCardRenderer` appends action buttons, AI banners, comments thread,
 *     tag chips by reading the children of the returned card and appending
 *     siblings to the `.post-content-area` container.
 *
 *   - `ImportGalleryContainer` (gallery preview) just keeps the returned
 *     element and lets its overlay component handle selection / duplicate
 *     state outside the renderer's purview.
 */

import type { PostData } from '@/types/post';
import { PreviewableHeaderRenderer } from './PreviewableHeaderRenderer';
import { PreviewableContentRenderer } from './PreviewableContentRenderer';
import { PreviewableMediaRenderer } from './PreviewableMediaRenderer';
import { PreviewableInteractionsRenderer } from './PreviewableInteractionsRenderer';
import type { PreviewContext } from './PreviewableContext';

// Re-export so callers that previously imported `PreviewContext` from this
// module (Round 2 wiring + the Svelte gallery container) keep working without
// a churn of import-path edits.
export type { PreviewContext } from './PreviewableContext';

/**
 * Visual-chrome orchestrator. Stateless beyond the constructor `context` and
 * the four sub-renderers it owns — re-rendering for new data means calling
 * `render()` again on a fresh container.
 */
export class PreviewableCardRenderer {
  private readonly header: PreviewableHeaderRenderer;
  private readonly content: PreviewableContentRenderer;
  private readonly media: PreviewableMediaRenderer;
  private readonly interactions: PreviewableInteractionsRenderer;

  constructor(private readonly context: PreviewContext) {
    this.header = new PreviewableHeaderRenderer(context);
    this.content = new PreviewableContentRenderer(context);
    this.media = new PreviewableMediaRenderer(context);
    this.interactions = new PreviewableInteractionsRenderer(context);
  }

  /**
   * Render the visual chrome of a post card into `container`.
   *
   * DOM tree (matches the trimmed shape PostCardRenderer.render() composes
   * for the visual portion of every card):
   *
   *   <div class="pcr-card">
   *     <div class="post-content-area">
   *       <div class="pcr-header">…</div>
   *       <div class="pcr-content">…</div>
   *       <div class="pcr-media-hero">…</div>      ← only when media exists OR placeholder
   *       <div class="pcr-interactions">…</div>    ← only when counts > 0
   *     </div>
   *   </div>
   *
   * Returns the outer `.pcr-card` element so callers can:
   *   - append vault-only chrome (action buttons, AI banners, comments)
   *   - find & enrich elements via stable data attributes
   *     (`[data-action="subscribe-badge"]`, `[data-author-tooltip]`, …)
   *
   * The `_isEmbedded` argument is accepted for API parity with
   * `PostCardRenderer.render(container, post, isEmbedded)` so the host can
   * pass it straight through. The orchestrator does not currently branch on
   * it (the embedded vs top-level distinction lives in the buttons / chrome
   * layers above this renderer).
   */
  public async render(
    container: HTMLElement,
    post: PostData,
    _isEmbedded: boolean = false,
  ): Promise<HTMLElement> {
    // Outer card wrapper — same class names as the vault timeline.
    const card = this.makeDiv(container, 'pcr-card sa-relative sa-rounded-lg pcr-preview-card');

    const contentArea = this.makeDiv(card, 'post-content-area sa-w-full sa-overflow-hidden');

    // 1. Header: avatar + author + time + platform pill (+ optional
    //    subscription badge frame + optional author-note tooltip frame).
    this.header.renderHeader(contentArea, post);

    // 2. Caption / blog body / podcast metadata strip / Google Maps business
    //    info / banner factories. Async because Obsidian's MarkdownRenderer
    //    is async when `app + component` are supplied.
    await this.content.renderContent(contentArea, post);

    // 3. Hero image (or video poster, or "+N" badge for multi-item posts).
    //    The Media sub-renderer renders a `pcr-media-hero` wrapper unconditionally
    //    when media exists, with a "Preview loading…" placeholder when the URL
    //    isn't yet resolved. For text-only posts we render a small placeholder
    //    so the grid layout stays consistent.
    const mediaList = post.media ?? [];
    if (mediaList.length > 0) {
      this.media.renderHeroImage(contentArea, post);
    } else {
      this.renderTextOnlyPlaceholder(contentArea);
    }

    // 4. Read-only interactions (counts portion only — no buttons).
    //    Caller layers vault-coupled action buttons on top.
    if (this.hasAnyInteractionCount(post)) {
      const interactionsEl = this.makeDiv(contentArea, 'pcr-interactions pcr-preview-interactions');
      this.interactions.renderCounts(interactionsEl, post);
    }

    // Optional whole-card click handler (preview surfaces opt in to a tap-to-
    // detail behavior; vault timeline opts out — long-press handles reader
    // mode separately).
    if (this.context.onCardClick) {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => this.context.onCardClick?.(post));
    }

    return card;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Render the "Text-only post" placeholder for posts with no media. Keeps
   * the gallery grid layout consistent — every cell occupies an identical
   * frame whether or not it has visible media.
   */
  private renderTextOnlyPlaceholder(parent: HTMLElement): void {
    const empty = this.makeDiv(
      parent,
      'pcr-media-hero pcr-preview-media pcr-preview-media--text',
    );
    empty.style.position = 'relative';
    empty.style.aspectRatio = '1 / 1';
    empty.style.background = 'var(--background-secondary, #f5f5f5)';
    empty.style.display = 'flex';
    empty.style.alignItems = 'center';
    empty.style.justifyContent = 'center';
    empty.style.borderRadius = '4px';
    empty.style.overflow = 'hidden';

    const label = document.createElement('span');
    label.textContent = 'Text-only post';
    label.style.color = 'var(--text-muted)';
    label.style.fontSize = 'var(--font-ui-smaller, 0.8rem)';
    empty.appendChild(label);
  }

  private hasAnyInteractionCount(post: PostData): boolean {
    const meta = post.metadata ?? ({} as PostData['metadata']);
    return (
      (typeof meta.likes === 'number' && meta.likes > 0) ||
      (typeof meta.comments === 'number' && meta.comments > 0) ||
      (typeof meta.shares === 'number' && meta.shares > 0) ||
      (typeof meta.views === 'number' && meta.views > 0)
    );
  }

  /**
   * Plain `document.createElement('div')` + class assignment. Matches the
   * pattern used in the sub-renderers so the same code runs under vitest
   * (no Obsidian element enrichments) and the Obsidian runtime.
   */
  private makeDiv(parent: HTMLElement, classes?: string): HTMLDivElement {
    const div = document.createElement('div');
    if (classes) {
      for (const c of classes.split(/\s+/).filter(Boolean)) {
        div.classList.add(c);
      }
    }
    parent.appendChild(div);
    return div;
  }
}
