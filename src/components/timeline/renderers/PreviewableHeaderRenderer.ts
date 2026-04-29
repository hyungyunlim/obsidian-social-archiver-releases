/**
 * PreviewableHeaderRenderer
 * ---------------------------------------------------------------------------
 * Self-contained visual renderer for the *header strip* of a post card —
 * avatar + author name + handle/time row + platform pill + crosspost
 * indicator + optional subscription badge frame + optional author-note
 * tooltip frame.
 *
 * Shares CSS class names with `PostCardRenderer` (`pcr-header`,
 * `pcr-author-name`, `pcr-time-row`, `pcr-platform-link`, etc.) so the
 * existing vault stylesheet (`src/styles/components/post-card.css`) applies
 * unchanged. WYSIWYG between the vault timeline and gallery preview surfaces
 * is the contract per PRD `prd-instagram-import-gallery.md` §0.
 *
 * --- Design notes ---------------------------------------------------------
 *
 *  - Round 2 of the PostCardRenderer extraction. PostCardRenderer is NOT
 *    modified by this file — Round 3 wires the delegation. This file is
 *    composable and stand-alone.
 *
 *  - Every dependency in `PreviewContext` is OPTIONAL except `resolveMediaUrl`.
 *    Missing capabilities degrade gracefully:
 *      - no `app`/`component`  → caption rendering punts to plain text
 *      - no `isSubscribed`     → no subscription badge frame
 *      - no `getAuthorNoteSnippet` → no author-note tooltip frame
 *      - no `onAuthorClick`    → author area is non-interactive
 *
 *  - The subscription badge here is a FRAME ONLY (visual chrome with stable
 *    `data-action="subscribe-badge"` attribute). PostCardRenderer remains
 *    responsible for wiring the click handler in Round 3. This keeps the
 *    sub-renderer free of vault-state coupling.
 *
 *  - Same author-note tooltip approach: emit a stable `data-author-tooltip`
 *    attribute with the snippet text. PostCardRenderer can replace the
 *    tooltip body with a Markdown-rendered preview after the fact.
 *
 *  - DOM helpers below use plain `document.createElement` (rather than the
 *    Obsidian `createDiv`/`createEl` enrichments) so the same code runs in
 *    the test mock without enrichment helpers. Identical output in both
 *    contexts.
 *
 *  - `setIcon` / `MarkdownRenderer` are not exported from the test mock for
 *    `obsidian`. Where we use them, we guard with `typeof === 'function'`
 *    so this file imports cleanly under both vitest and the Obsidian runtime.
 */

import { setIcon } from 'obsidian';
import type { PostData } from '@/types/post';
import {
  formatRelativeTime,
  computeInitials,
  normalizeUrlForComparison,
} from './PreviewableHelpers';
import {
  getPlatformSimpleIcon,
  getPlatformLucideIcon,
  getPublisherIconEntry,
} from '@/services/IconService';
import { createSVGElement } from '@/utils/dom-helpers';
import type { PreviewContext } from './PreviewableContext';

// Re-export so existing direct imports of `PreviewContext` from this file
// keep working without a cascade of touch-ups across the codebase.
export type { PreviewContext } from './PreviewableContext';

/**
 * Visual-chrome renderer for a post card's header strip.
 *
 * Stateless on purpose: re-rendering for new data means calling `renderHeader`
 * again on a fresh container.
 */
export class PreviewableHeaderRenderer {
  constructor(private readonly context: PreviewContext) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Render the full header strip (avatar + author name + handle + time row +
   * platform pill + optional subscription badge frame + optional author-note
   * tooltip frame + crosspost indicator) into `contentArea`.
   *
   * Returns the header element so the caller can attach overlays / handlers
   * (PostCardRenderer wires the subscription click handler this way in
   * Round 3).
   */
  public renderHeader(contentArea: HTMLElement, post: PostData): HTMLElement {
    const header = this.makeDiv(contentArea, 'mb-2 sa-flex-row sa-gap-10 pcr-header');

    // Left: avatar
    this.renderAvatar(header, post);

    // Middle: author name + handle/timestamp + community
    const middleSection = this.makeDiv(header, 'sa-flex-1 pcr-middle-section');

    // Author name row (with optional subscription badge frame)
    const authorNameRow = this.makeDiv(middleSection, 'sa-flex-row sa-gap-6');

    // Author name
    const displayName = post.author?.name ?? '';
    const authorName = document.createElement('strong');
    authorName.textContent = displayName;
    authorName.classList.add('pcr-author-name');
    // Use plain style.setProperty (Obsidian's setCssProps is not in the mock).
    authorName.style.setProperty('--pcr-author-font-size', '14px');
    authorName.style.setProperty('--pcr-author-max-width', '320px');
    authorNameRow.appendChild(authorName);

    if (post.author?.url && this.context.onAuthorClick) {
      authorName.setAttribute('title', `View ${displayName}'s detail`);
      authorName.style.cursor = 'pointer';
      authorName.addEventListener('click', (e) => {
        e.stopPropagation();
        this.context.onAuthorClick?.(post);
      });
    }

    // Author-note tooltip affordance (frame only; PostCardRenderer can
    // upgrade the body to rich Markdown post-hoc).
    if (this.context.getAuthorNoteSnippet) {
      const snippet = this.context.getAuthorNoteSnippet(post);
      if (snippet) {
        authorName.setAttribute('data-author-tooltip', snippet);
        // Visible affordance: a small dot indicator next to the name so
        // users notice the note exists. The tooltip body lives on the
        // strong element via the data attribute.
        const noteDot = document.createElement('span');
        noteDot.classList.add('pcr-author-note-indicator');
        noteDot.setAttribute('aria-label', 'Has author note');
        noteDot.setAttribute('title', snippet);
        authorNameRow.appendChild(noteDot);
      }
    }

    // Subscription badge frame (frame only; click handler wired in Round 3).
    if (this.context.isSubscribed) {
      const subscribed = this.context.isSubscribed(post);
      this.renderSubscriptionBadgeFrame(authorNameRow, subscribed);
    }

    // Time row (with optional community / podcast author segments)
    const timeRow = this.makeDiv(middleSection, 'pcr-time-row');

    const timestamp = post.metadata?.timestamp ?? null;
    const relative = formatRelativeTime(timestamp);
    if (relative) {
      const timeSpan = document.createElement('span');
      timeSpan.classList.add('pcr-nowrap');
      timeSpan.classList.add('text-xs');
      timeSpan.style.color = 'var(--text-muted)';
      timeSpan.textContent = relative;
      timeRow.appendChild(timeSpan);
    }

    // Podcast: episode author next to timestamp
    if (post.platform === 'podcast' && post.author?.handle) {
      this.appendSeparator(timeRow);
      const episodeAuthorSpan = document.createElement('span');
      episodeAuthorSpan.classList.add('pcr-episode-author');
      episodeAuthorSpan.classList.add('text-xs');
      episodeAuthorSpan.style.color = 'var(--text-muted)';
      episodeAuthorSpan.textContent = `by ${post.author.handle}`;
      timeRow.appendChild(episodeAuthorSpan);
    }

    // Reddit: subreddit link
    if (post.platform === 'reddit' && post.content?.community) {
      this.appendSeparator(timeRow);
      const subredditLink = document.createElement('a');
      subredditLink.classList.add('pcr-community-link');
      subredditLink.classList.add('text-xs');
      subredditLink.textContent = `r/${post.content.community.name}`;
      subredditLink.href = post.content.community.url;
      subredditLink.setAttribute('target', '_blank');
      subredditLink.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      timeRow.appendChild(subredditLink);
    }

    // Naver: cafe link
    if (post.platform === 'naver' && post.content?.community) {
      this.appendSeparator(timeRow);
      const cafeLink = document.createElement('a');
      cafeLink.classList.add('pcr-cafe-link');
      cafeLink.classList.add('text-xs');
      cafeLink.textContent = post.content.community.name;
      cafeLink.setAttribute('title', post.content.community.name);
      cafeLink.href = post.content.community.url;
      cafeLink.setAttribute('target', '_blank');
      cafeLink.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      timeRow.appendChild(cafeLink);
    }

    // Right: original-post link (platform pill). Skip for `post` platform.
    if (post.platform !== 'post') {
      this.renderOriginalPostLink(header, post);
    }

    // Crosspost indicator (Threads). Always present at end of header when
    // applicable. Reads from `post.threadsPostUrl` (the actual field name
    // used by the rest of the codebase).
    if (post.threadsPostUrl) {
      this.renderCrossPostIndicator(header, post.threadsPostUrl);
    }

    return header;
  }

  /**
   * Render avatar inline (no platform badge stack — that lives separately in
   * the platform pill on the right of the header). Returns the avatar
   * container so callers can attach overlays.
   *
   * Standalone avatar render — called by PostCardRenderer for embedded posts
   * where only the avatar is needed.
   */
  public renderAvatar(parent: HTMLElement, post: PostData): HTMLElement {
    const avatarContainer = this.makeDiv(
      parent,
      'author-avatar-container sa-flex-shrink-0 sa-icon-40 sa-relative sa-clickable sa-transition-opacity',
    );

    const avatarSrc = this.context.resolveMediaUrl(post.author?.avatar);

    if (avatarSrc) {
      const avatarImg = document.createElement('img');
      avatarImg.loading = 'lazy';
      avatarImg.classList.add('sa-icon-40', 'sa-rounded-full', 'sa-object-cover', 'pcr-avatar-img');
      avatarImg.src = avatarSrc;
      avatarImg.alt = post.author?.name ?? '';
      avatarContainer.appendChild(avatarImg);

      // Fallback to initials on image error
      avatarImg.addEventListener('error', () => {
        avatarImg.classList.add('sa-hidden');
        this.appendInitialsFallback(avatarContainer, post.author?.name);
      });
    } else {
      this.appendInitialsFallback(avatarContainer, post.author?.name);
    }

    return avatarContainer;
  }

  /**
   * Render the platform-icon link pointing to the original post.
   *
   * Returns the rendered link container, or `null` when no link could be
   * produced (for non-podcast platforms without a target URL).
   */
  public renderOriginalPostLink(parent: HTMLElement, post: PostData): HTMLElement | null {
    const targetUrl = this.getPostOriginalUrl(post);
    const isPodcast = post.platform === 'podcast';
    const podcastFallbackUrl = isPodcast ? post.author?.url : null;

    // Skip if no URL and not podcast
    if (!targetUrl && !isPodcast) return null;

    const linkContainer = this.makeDiv(parent, 'platform-icon-badge pcr-platform-link');
    linkContainer.setAttribute('data-platform', post.platform);

    const hasLink = !!(targetUrl || podcastFallbackUrl);
    if (hasLink) {
      linkContainer.classList.add('pcr-platform-link-clickable');
    }

    // Publisher attribution (web archives only): prefer persisted slug, fall
    // back to URL-based lookup. When matched, the rendered icon and tooltip
    // reflect the publisher rather than the generic web platform.
    const publisherEntry = post.platform === 'web'
      ? getPublisherIconEntry(post.publisher?.slug, post.url)
      : null;

    const tooltipLabel = publisherEntry
      ? (hasLink ? `Open on ${publisherEntry.name}` : publisherEntry.name)
      : (hasLink ? `Open on ${post.platform}` : post.platform);
    linkContainer.setAttribute('title', tooltipLabel);
    linkContainer.setAttribute('aria-label', tooltipLabel);

    const iconWrapper = this.makeDiv(linkContainer, 'pcr-platform-icon-wrapper');

    if (publisherEntry) {
      if (publisherEntry.icon.type === 'svg') {
        try {
          const svg = createSVGElement(
            publisherEntry.icon.data,
            {
              fill: 'var(--text-accent)',
              width: '100%',
              height: '100%',
            },
            publisherEntry.icon.viewBox
          );
          iconWrapper.appendChild(svg);
        } catch {
          // SVG creation failed in degraded environments; iconWrapper stays empty.
        }
      } else {
        const img = document.createElement('img');
        img.setAttribute('src', publisherEntry.icon.url);
        img.setAttribute('alt', publisherEntry.name);
        img.setAttribute('loading', 'lazy');
        img.classList.add('publisher-icon-img');
        iconWrapper.appendChild(img);
      }
    } else {
      const icon = getPlatformSimpleIcon(post.platform, post.author?.url);
      if (icon) {
        try {
          const svg = createSVGElement(icon, {
            fill: 'var(--text-accent)',
            width: '100%',
            height: '100%',
          });
          iconWrapper.appendChild(svg);
        } catch {
          // SVG creation failed in degraded environments; iconWrapper stays empty.
        }
      } else {
        // Lucide fallback (e.g. LinkedIn).
        const lucideIconName = getPlatformLucideIcon(post.platform);
        const lucideWrapper = this.makeDiv(iconWrapper, 'pcr-lucide-fill');
        this.safeSetIcon(lucideWrapper, lucideIconName);
      }
    }

    const finalUrl = targetUrl || podcastFallbackUrl;
    if (finalUrl) {
      linkContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open(finalUrl, '_blank');
      });
    }

    return linkContainer;
  }

  /**
   * Render the Threads cross-post indicator badge.
   *
   * Returns the rendered badge element. Returns the existing badge if one is
   * already present in the header (idempotent — matches PostCardRenderer's
   * `injectCrossPostBadge` behavior).
   */
  public renderCrossPostIndicator(parent: HTMLElement, threadsUrl: string): HTMLElement {
    const existing = parent.querySelector<HTMLElement>('.pcr-crosspost-badge');
    if (existing) return existing;

    const badge = this.makeDiv(parent, 'pcr-crosspost-badge');
    badge.setAttribute('title', 'Cross-posted to Threads');
    badge.setAttribute('aria-label', 'Cross-posted to Threads');

    const iconWrapper = this.makeDiv(badge, 'pcr-crosspost-icon-wrapper');

    const threadsIcon = getPlatformSimpleIcon('threads');
    if (threadsIcon) {
      try {
        const svg = createSVGElement(threadsIcon, {
          fill: 'currentColor',
          width: '100%',
          height: '100%',
        });
        iconWrapper.appendChild(svg);
      } catch {
        // SVG creation failed; iconWrapper stays empty.
      }
    }

    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      window.open(threadsUrl, '_blank');
    });

    return badge;
  }

  /**
   * Render a small inline highlight badge: " · 🖍 N".
   * Pure visual.
   */
  public renderHighlightBadge(parent: HTMLElement, count = 0): HTMLElement {
    const badge = document.createElement('span');
    badge.classList.add('pcr-highlight-badge');
    parent.appendChild(badge);

    const icon = document.createElement('span');
    icon.classList.add('pcr-highlight-badge-icon');
    badge.appendChild(icon);
    this.safeSetIcon(icon, 'highlighter');

    const text = document.createElement('span');
    text.textContent = ` ${count}`;
    badge.appendChild(text);

    return badge;
  }

  // -------------------------------------------------------------------------
  // Pure data transforms (no DOM)
  // -------------------------------------------------------------------------

  /**
   * Enrich an embedded post with the parent's `localAvatar` if both are
   * the same author (self-boost). Returns a new PostData (does not mutate
   * the input).
   */
  public enrichWithParentAvatar(embeddedPost: PostData, parentPost: PostData): PostData {
    // Skip if embedded post already has localAvatar
    if (embeddedPost.author?.localAvatar) {
      return embeddedPost;
    }

    // Skip if parent doesn't have localAvatar
    if (!parentPost.author?.localAvatar) {
      return embeddedPost;
    }

    // Check if same author (by URL or handle)
    const isSameAuthor = this.isSameAuthorForAvatar(embeddedPost.author, parentPost.author);
    if (!isSameAuthor) {
      return embeddedPost;
    }

    // Inject parent's localAvatar
    return {
      ...embeddedPost,
      author: {
        ...embeddedPost.author,
        localAvatar: parentPost.author.localAvatar,
      },
    };
  }

  /**
   * Check whether two authors should be considered the same person for
   * avatar inheritance purposes. Compares by URL, then handle, then
   * username — falsy on all three means "different".
   */
  public isSameAuthorForAvatar(
    author1: PostData['author'] | undefined,
    author2: PostData['author'] | undefined,
  ): boolean {
    if (!author1 || !author2) return false;

    // Compare by URL first (most reliable)
    if (author1.url && author2.url) {
      if (normalizeUrlForComparison(author1.url) === normalizeUrlForComparison(author2.url)) {
        return true;
      }
    }
    // Compare by handle
    if (author1.handle && author2.handle) {
      const normalizeHandle = (h: string): string => h.toLowerCase().replace(/^@/, '');
      if (normalizeHandle(author1.handle) === normalizeHandle(author2.handle)) {
        return true;
      }
    }
    // Compare by username
    if (author1.username && author2.username) {
      return author1.username.toLowerCase() === author2.username.toLowerCase();
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Get the URL the platform-pill link should target. Mirrors the original
   * `PostCardRenderer.getPostOriginalUrl` behavior: prefer `post.url`,
   * fall back to author URL only for podcast-style platforms.
   *
   * Kept simple here to avoid pulling in vault-coupled URL resolution logic.
   * If callers need richer behavior they can compute the URL beforehand and
   * stash it on `post.url`.
   */
  private getPostOriginalUrl(post: PostData): string | null {
    if (post.url) return post.url;
    return null;
  }

  private renderSubscriptionBadgeFrame(container: HTMLElement, subscribed: boolean): HTMLElement {
    const badge = this.makeDiv(container, 'pcr-badge');
    // Stable hook so PostCardRenderer can attach the click handler post-hoc.
    badge.setAttribute('data-action', 'subscribe-badge');
    badge.setAttribute('data-subscribed', subscribed ? 'true' : 'false');

    if (subscribed) {
      badge.classList.add('pcr-badge-subscribed');
      badge.setAttribute('title', 'Click to unsubscribe');
      const iconContainer = this.makeDiv(badge, 'pcr-badge-icon');
      this.safeSetIcon(iconContainer, 'bell');
    } else {
      badge.classList.add('pcr-badge-unsubscribed');
      badge.setAttribute('title', 'Click to subscribe');
      const iconContainer = this.makeDiv(badge, 'pcr-badge-icon');
      this.safeSetIcon(iconContainer, 'bell-plus');
    }

    return badge;
  }

  private appendInitialsFallback(container: HTMLElement, name: string | undefined | null): void {
    const fallback = document.createElement('div');
    fallback.classList.add(
      'sa-icon-40',
      'sa-rounded-full',
      'sa-text-md',
      'sa-font-semibold',
      'pcr-avatar-fallback',
    );
    fallback.textContent = computeInitials(name);
    container.appendChild(fallback);
  }

  private appendSeparator(parent: HTMLElement): void {
    const sep = document.createElement('span');
    sep.textContent = '·';
    sep.classList.add('pcr-separator');
    sep.classList.add('text-xs');
    sep.style.color = 'var(--text-muted)';
    parent.appendChild(sep);
  }

  /**
   * Wraps `setIcon` so the file imports cleanly even when the test mock for
   * `obsidian` does not export it. Failures are swallowed — the icon slot
   * just stays empty in degraded contexts.
   */
  private safeSetIcon(el: HTMLElement, name: string): void {
    try {
      if (typeof setIcon === 'function') {
        setIcon(el, name);
      }
    } catch {
      // Degraded environment — icon slot remains empty.
    }
  }

  /**
   * Plain `document.createElement('div')` + class assignment. Matches the
   * pattern used in `PreviewableCardRenderer` so the same code runs under
   * vitest (no Obsidian element enrichments) and the Obsidian runtime.
   */
  private makeDiv(parent: HTMLElement, classes: string): HTMLDivElement {
    const div = document.createElement('div');
    if (classes) {
      for (const cls of classes.split(/\s+/).filter(Boolean)) {
        div.classList.add(cls);
      }
    }
    parent.appendChild(div);
    return div;
  }
}
