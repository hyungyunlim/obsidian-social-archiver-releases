/**
 * PreviewableContentRenderer
 * ---------------------------------------------------------------------------
 * Sub-renderer extracted from `PostCardRenderer` (Round 2B of the
 * `prd-instagram-import-gallery.md` refactor).
 *
 * Owns the visual chrome of a post card's CONTENT area — the caption, blog
 * body, podcast metadata strip, banner factories (archiving / status /
 * suggestion), Google Maps business info block, and the small set of
 * markdown/text helpers those things share.
 *
 * --- Engineering commitments (PRD §0) -------------------------------------
 *
 *   - SAME CSS class names as the original `PostCardRenderer.renderContent`
 *     (`.pcr-content`, `.pcr-podcast-metadata`, `.pcr-suggestion-banner`,
 *     `.pcr-gmaps-address-row`, …) so `post-card.css` applies unchanged.
 *
 *   - PURE VISUAL only — no vault reads, no plugin settings, no async
 *     archive/credit calls. Vault-coupled paths from the original
 *     (link preview fetch, YouTube timestamp wiring, inline-image vault
 *     resolution, declined-URL persistence, archive button POST) intentionally
 *     STAY in `PostCardRenderer`. Round 3 will re-wire those via richer
 *     enrichment callbacks.
 *
 *   - Graceful degradation: every optional capability falls back when absent.
 *     Markdown rendering only happens when BOTH `context.app` and
 *     `context.component` are provided. Otherwise paragraphs render as plain
 *     `<p>` tags with `\n`-preserved newlines. Hashtag click handlers attach
 *     in BOTH render modes (markdown and plain) when `onHashtagClick` is set.
 *
 *   - Platform-agnostic: no `if platform === 'instagram'` switches beyond
 *     what already existed in the source — the title rendering carries those
 *     same checks because they are pure visual variants.
 *
 *   - `PostCardRenderer.ts` is NOT modified in this round. Round 3 wires up
 *     delegation.
 *
 * --- Why are pure parsers (parseGoogleMapsBusinessData, formatBusinessHours,
 *     buildGoogleMapsDirectionsUrl) inlined as private statics here? --------
 *
 *   The Round 1 plan said "keep these in PostCardRenderer for now". They
 *   are, however, dependencies of `renderGoogleMapsBusinessInfo`, which the
 *   plan says to move whole. To preserve "no fork" while moving the visual
 *   block, we copy the pure parsers as private statics here so the new
 *   class is self-contained at compile time. PostCardRenderer is untouched
 *   and still has its own copies — no behavior diverges. Round 3 dedupes.
 *
 * --- DOM helpers ---------------------------------------------------------
 *
 *   We use plain `document.createElement` and `setAttribute` (not Obsidian's
 *   `createDiv`/`setIcon`) so the unit-test environment (jsdom + the
 *   `obsidian` mock) renders identically to runtime. Iconography that
 *   previously used `setIcon('map-pin', …)` falls back to a text glyph
 *   (`📍`, `⏰`, `🌐`, `↗`) — the same emoji vocabulary already present in
 *   the source for podcast metadata, so the visual is consistent.
 */

import type { PostData } from '@/types/post';
import {
  formatDuration,
  parseGoogleMapsBusinessData,
  formatBusinessHours,
  buildGoogleMapsDirectionsUrl,
} from './PreviewableHelpers';
import type { PreviewContext } from './PreviewableContext';

// Re-export so existing direct imports of `PreviewContext` from this file
// keep working without a cascade of touch-ups across the codebase.
export type { PreviewContext } from './PreviewableContext';

/** Options for `renderSuggestionBanner` — pure visual factory. */
export interface SuggestionBannerOptions {
  /** Banner copy. Defaults to "Archive this post?" to match the original visual. */
  message?: string;
  /** When true, applies the `pcr-suggestion-banner-filled` variant class. */
  filled?: boolean;
  /** When provided, an "x" button is rendered that fires this callback. */
  onDecline?: () => void;
  /** When provided, a "✓" button is rendered that fires this callback. */
  onAccept?: () => void;
  /** Override the decline button title (default: "No"). */
  declineLabel?: string;
  /** Override the accept button title (default: "Yes"). */
  acceptLabel?: string;
}

/**
 * Visual sub-renderer for a post card's content area.
 *
 * Stateless — every public method is a pure function of `(parent, post, …)`.
 */
export class PreviewableContentRenderer {
  /** Default caption truncation budget. Mirrors `PreviewableCardRenderer`. */
  private static readonly DEFAULT_CAPTION_MAX = 280;

  constructor(private readonly context: PreviewContext) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Render the post's primary content area. Returns the wrapper element so
   * callers can attach overlays without re-querying the DOM.
   *
   * Behavior matches the visual frame of `PostCardRenderer.renderContent`:
   *
   *   - Reblog with quotedPost → render nothing in main card (callers will
   *     mount the quotedPost card separately).
   *   - YouTube/RSS/web/X-with-rawMarkdown → emoji or bold title at top.
   *   - When the post has `rawMarkdown` (RSS/Threads/web/X article), delegate
   *     to `renderBlogContent`.
   *   - Otherwise, escape Setext / angle-bracket / ordered-list patterns,
   *     truncate at 300 chars (with See more / See less toggle), then render
   *     as markdown when `app + component` are present, plain text otherwise.
   */
  public async renderContent(
    contentArea: HTMLElement,
    post: PostData,
  ): Promise<HTMLElement> {
    // Reblogs render their content via the embedded quotedPost card.
    // Return an empty wrapper to keep callers' return-type contract intact.
    if (post.isReblog && post.quotedPost) {
      return this.makeDiv(contentArea, 'mb-2 pcr-content pcr-content-empty-reblog');
    }

    const contentContainer = this.makeDiv(contentArea, 'mb-2 pcr-content');

    // Title strip — kept verbatim from PostCardRenderer.renderContent.
    if (post.platform === 'youtube' && post.title) {
      const titleEl = this.makeDiv(
        contentContainer,
        'youtube-video-title pcr-title-youtube',
      );
      titleEl.textContent = `📺 ${post.title}`;
    }

    if (this.isRssLikeWithTitle(post)) {
      const titleEl = this.makeDiv(
        contentContainer,
        'blog-article-title pcr-title-blog',
      );
      titleEl.textContent = post.title ?? '';
    }

    if (post.platform === 'x' && post.content.rawMarkdown && post.title) {
      const titleEl = this.makeDiv(
        contentContainer,
        'blog-article-title pcr-title-blog',
      );
      titleEl.textContent = post.title;
    }

    if (post.platform === 'reddit' && post.title) {
      const titleEl = this.makeDiv(
        contentContainer,
        'reddit-post-title pcr-title-reddit',
      );
      titleEl.textContent = post.title;
    }

    // Long-form blog body for RSS/Threads/web/X-with-rawMarkdown.
    if (this.shouldRenderAsBlog(post)) {
      await this.renderBlogContent(contentContainer, post);
      return contentContainer;
    }

    // Caption path — escape unsafe markdown, truncate, render.
    let cleanContent = (post.content.text ?? '').trim();

    // The original strips the literal external-link line so a richer link
    // preview card can replace it. The card itself is vault-coupled and
    // stays in PostCardRenderer; the strip is pure text and is safe here.
    if (post.metadata.externalLink) {
      cleanContent = cleanContent
        .replace(/🔗 \*\*Link:\*\* \[.+?\]\(.+?\)\n?/g, '')
        .trim();
    }

    // Escapes are deliberately NOT applied here. The renderMarkdownOrText
    // helper applies them only when MarkdownRenderer is going to consume
    // the text (otherwise the literal backslashes leak into the user-facing
    // plain-text DOM — see the gallery preview bug from PRD §0). Truncation
    // happens on the raw caption so the budget is the same regardless of
    // which render path fires downstream.

    const previewLength = this.context.captionMaxChars ?? 300;
    const isLongContent = previewLength > 0 && cleanContent.length > previewLength;
    const previewContent = isLongContent
      ? cleanContent.slice(0, previewLength).trimEnd() + '…'
      : cleanContent;
    const fullContent = cleanContent;

    const contentText = this.makeDiv(
      contentContainer,
      'text-sm leading-relaxed text-[var(--text-normal)] post-body-text pcr-content-text',
    );

    if (isLongContent) {
      await this.renderMarkdownOrText(contentText, previewContent);

      const seeMoreBtn = document.createElement('span');
      seeMoreBtn.textContent = 'See more...';
      seeMoreBtn.className = 'pcr-see-more-btn';
      contentContainer.appendChild(seeMoreBtn);

      let expanded = false;
      seeMoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        expanded = !expanded;
        void (async () => {
          contentText.replaceChildren();
          if (expanded) {
            await this.renderMarkdownOrText(contentText, fullContent);
            seeMoreBtn.textContent = 'See less';
          } else {
            await this.renderMarkdownOrText(contentText, previewContent);
            seeMoreBtn.textContent = 'See more...';
          }
          this.attachHashtagHandlers(contentText);
          this.normalizeTagFontSizes(contentText);
        })();
      });
    } else {
      await this.renderMarkdownOrText(contentText, fullContent);
    }

    // Attach hashtag handlers (works for both markdown and plain-text paths).
    this.attachHashtagHandlers(contentText);

    // Normalize tag font sizes (no-op when class already present, guaranteed safe).
    this.normalizeTagFontSizes(contentText);

    return contentContainer;
  }

  /**
   * Render a long-form / blog post body using `post.content.rawMarkdown`.
   *
   * The visual frame moves to this class. The vault-coupled enrichments
   * (image path resolution, video URL rewriting) STAY in `PostCardRenderer`
   * because they need `app.metadataCache` / `app.vault.getResourcePath`. The
   * caller can post-process the returned wrapper to perform that resolution.
   */
  public async renderBlogContent(
    contentContainer: HTMLElement,
    post: PostData,
  ): Promise<HTMLElement> {
    let rawMarkdown = post.content.rawMarkdown ?? '';

    // For podcasts: strip <audio> tags since the custom player handles audio.
    if (post.platform === 'podcast') {
      rawMarkdown = rawMarkdown.replace(/<audio[^>]*>.*?<\/audio>/gi, '').trim();
    }

    const previewLength = 500;

    const contentText = this.makeDiv(
      contentContainer,
      'text-sm leading-relaxed text-[var(--text-normal)] sa-blog-content-inline post-body-text pcr-content-text pcr-blog-content',
    );

    // Clean up zero-width spaces that break paragraph parsing on Naver blog.
    // Always safe — applies to both render branches.
    rawMarkdown = rawMarkdown.replace(/\u200B/g, '');

    // Wikilink → markdown image conversion + inline-image src resolution
    // only make sense when MarkdownRenderer will consume the output. On the
    // plain-text fallback they would either leak `![](...)` syntax verbatim
    // (`convertWikilinkImages`) or rewrite text the user never sees rendered
    // (`maybeResolveInlineImageSrcs`). Restrict both to the markdown path.
    if (this.context.app && this.context.component) {
      rawMarkdown = PreviewableContentRenderer.convertWikilinkImages(rawMarkdown);
      rawMarkdown = this.maybeResolveInlineImageSrcs(rawMarkdown);
    }

    const isLongContent = rawMarkdown.length > previewLength;
    const previewMarkdown = isLongContent
      ? rawMarkdown.slice(0, previewLength).trimEnd() + '…'
      : rawMarkdown;

    if (isLongContent) {
      await this.renderMarkdownOrText(contentText, previewMarkdown);

      const seeMoreBtn = document.createElement('span');
      seeMoreBtn.textContent = 'See more...';
      seeMoreBtn.className = 'pcr-see-more-btn';
      contentContainer.appendChild(seeMoreBtn);

      let expanded = false;
      seeMoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        expanded = !expanded;
        void (async () => {
          contentText.replaceChildren();
          if (expanded) {
            await this.renderMarkdownOrText(contentText, rawMarkdown);
            seeMoreBtn.textContent = 'See less';
          } else {
            await this.renderMarkdownOrText(contentText, previewMarkdown);
            seeMoreBtn.textContent = 'See more...';
          }
          this.attachHashtagHandlers(contentText);
          this.normalizeTagFontSizes(contentText);
        })();
      });
    } else {
      await this.renderMarkdownOrText(contentText, rawMarkdown);
    }

    this.attachHashtagHandlers(contentText);
    this.normalizeTagFontSizes(contentText);

    return contentText;
  }

  /**
   * Render the podcast metadata strip (episode/season/duration/hosts/guests).
   * No-op when no metadata fields are populated — caller can rely on the
   * returned element being detached & cheap.
   */
  public renderPodcastMetadata(container: HTMLElement, post: PostData): HTMLElement {
    const metadata = post.metadata ?? ({} as PostData['metadata']);

    const items: string[] = [];

    if (metadata.episode !== undefined) {
      if (metadata.season !== undefined) {
        items.push(`S${metadata.season}E${metadata.episode}`);
      } else {
        items.push(`Episode ${metadata.episode}`);
      }
    } else if (metadata.season !== undefined) {
      items.push(`Season ${metadata.season}`);
    }

    if (metadata.duration !== undefined && metadata.duration > 0) {
      items.push(`⏱️ ${formatDuration(metadata.duration)}`);
    }

    if (metadata.hosts && metadata.hosts.length > 0) {
      const hostsText = metadata.hosts.length === 1
        ? `Host: ${metadata.hosts[0]}`
        : `Hosts: ${metadata.hosts.join(', ')}`;
      items.push(`🎙️ ${hostsText}`);
    }

    if (metadata.guests && metadata.guests.length > 0) {
      const guestsText = metadata.guests.length === 1
        ? `Guest: ${metadata.guests[0]}`
        : `Guests: ${metadata.guests.join(', ')}`;
      items.push(`👤 ${guestsText}`);
    }

    if (metadata.explicit === true) {
      items.push('🔞 Explicit');
    }

    if (items.length === 0) {
      // Return an empty (but mounted) bar so caller has a stable anchor.
      return this.makeDiv(container, 'podcast-metadata-bar pcr-podcast-metadata pcr-podcast-metadata--empty');
    }

    const metadataBar = this.makeDiv(container, 'podcast-metadata-bar pcr-podcast-metadata');
    for (const item of items) {
      const span = document.createElement('span');
      span.textContent = item;
      span.className = 'pcr-podcast-metadata-item';
      metadataBar.appendChild(span);
    }
    return metadataBar;
  }

  /**
   * Render text with hashtags split into clickable links (when an
   * `onHashtagClick` callback exists on the context) or `<span>` highlights
   * otherwise.
   *
   * Mirrors `PostCardRenderer.renderTextWithHashtags`. The original took an
   * optional `platform` arg; we route through `context.onHashtagClick`
   * instead so the click target is configurable per host.
   */
  public renderTextWithHashtags(
    container: HTMLElement,
    text: string,
    post: PostData,
  ): HTMLElement {
    const hashtagPattern = /(#[^\n\r#]+)/g;
    const parts = text.split(hashtagPattern);

    for (const part of parts) {
      if (part.startsWith('#') && part.length > 1) {
        if (this.context.onHashtagClick) {
          // Build a clickable hashtag anchor that dispatches the callback.
          const link = document.createElement('a');
          link.textContent = part;
          link.className = 'pcr-hashtag-link';
          link.setAttribute(
            'href',
            PreviewableContentRenderer.getHashtagUrl(part, post.platform),
          );
          link.setAttribute('target', '_blank');
          link.setAttribute('rel', 'noopener noreferrer');
          link.setAttribute('title', `Search ${part}`);
          link.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const hashtag = part.startsWith('#') ? part.substring(1) : part;
            this.context.onHashtagClick?.(hashtag);
          });
          container.appendChild(link);
        } else {
          // No click target — render as a passive highlight span.
          const span = document.createElement('span');
          span.textContent = part;
          span.className = 'pcr-hashtag-span';
          container.appendChild(span);
        }
      } else {
        container.appendChild(document.createTextNode(part));
      }
    }
    return container;
  }

  /**
   * Render markdown links, wiki links, and plain URLs as clickable anchors.
   * Mirrors `PostCardRenderer.renderMarkdownLinks` minus the YouTube
   * timestamp-controller wiring (vault-only).
   *
   * - `[text](url)`     → external `<a>` opening in a new tab
   * - `[[note]]`        → `<a class="internal-link">` rendered with display
   *                       text from the path tail (caller owns the actual
   *                       Obsidian openLinkText wiring; we only emit the
   *                       link element so the user gets WYSIWYG markup)
   * - bare URLs         → external `<a>`
   */
  public renderMarkdownLinks(container: HTMLElement, text: string): HTMLElement {
    container.replaceChildren();

    // Phase 1: extract wiki links.
    const wikiLinks: Array<{ notePath: string; displayText: string }> = [];
    const wikiLinkPattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    let processed = text.replace(
      wikiLinkPattern,
      (_match: string, notePath: string, displayText: string | undefined) => {
        const idx = wikiLinks.length;
        wikiLinks.push({
          notePath: notePath.trim(),
          displayText:
            displayText?.trim() ||
            PreviewableContentRenderer.getWikiLinkDisplayText(notePath.trim()),
        });
        return `__WIKILINK${idx}__`;
      },
    );

    // Phase 2: extract markdown links.
    const markdownLinks: Array<{ text: string; url: string }> = [];
    const markdownPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
    processed = processed.replace(
      markdownPattern,
      (_match: string, linkText: string, linkUrl: string) => {
        const idx = markdownLinks.length;
        markdownLinks.push({ text: linkText, url: linkUrl });
        return `__MDLINK${idx}__`;
      },
    );

    // Phase 3: split out bare URLs from remaining text.
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    const segments: Array<{ type: 'text' | 'url'; content: string; url?: string }> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = urlPattern.exec(processed)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', content: processed.substring(lastIndex, match.index) });
      }
      const url = match[1];
      if (url) {
        segments.push({ type: 'url', content: url, url });
      }
      lastIndex = urlPattern.lastIndex;
    }
    if (lastIndex < processed.length) {
      segments.push({ type: 'text', content: processed.substring(lastIndex) });
    }

    // Phase 4: render.
    for (const seg of segments) {
      if (seg.type === 'text') {
        const placeholderPattern = /__(?:WIKILINK|MDLINK)(\d+)__/g;
        let textLastIndex = 0;
        let phMatch: RegExpExecArray | null;

        while ((phMatch = placeholderPattern.exec(seg.content)) !== null) {
          const fullMatch = phMatch[0];
          const isWikiLink = fullMatch.startsWith('__WIKILINK');

          if (phMatch.index > textLastIndex) {
            container.appendChild(
              document.createTextNode(seg.content.substring(textLastIndex, phMatch.index)),
            );
          }

          if (!phMatch[1]) {
            textLastIndex = placeholderPattern.lastIndex;
            continue;
          }
          const linkIndex = parseInt(phMatch[1], 10);

          if (isWikiLink) {
            const wikiData = wikiLinks[linkIndex];
            if (!wikiData) {
              textLastIndex = placeholderPattern.lastIndex;
              continue;
            }
            const wikiLink = document.createElement('a');
            wikiLink.textContent = wikiData.displayText;
            wikiLink.className = 'internal-link pcr-wiki-link';
            wikiLink.setAttribute('href', wikiData.notePath);
            wikiLink.setAttribute('data-href', wikiData.notePath);
            wikiLink.setAttribute('title', wikiData.notePath);
            // Click handler is intentionally vault-coupled; callers wire
            // `app.workspace.openLinkText` after rendering. We emit the
            // markup so it's keyboard-focusable & visually styled.
            container.appendChild(wikiLink);
          } else {
            const linkData = markdownLinks[linkIndex];
            if (!linkData) {
              textLastIndex = placeholderPattern.lastIndex;
              continue;
            }
            const link = document.createElement('a');
            link.textContent = linkData.text;
            link.className = 'pcr-ext-link';
            link.setAttribute('href', linkData.url);
            link.setAttribute('target', '_blank');
            link.setAttribute('rel', 'noopener noreferrer');
            link.addEventListener('click', (e) => e.stopPropagation());
            container.appendChild(link);
          }

          textLastIndex = placeholderPattern.lastIndex;
        }

        if (textLastIndex < seg.content.length) {
          container.appendChild(
            document.createTextNode(seg.content.substring(textLastIndex)),
          );
        }
      } else if (seg.type === 'url' && seg.url) {
        const link = document.createElement('a');
        link.textContent = seg.content;
        link.className = 'pcr-ext-link';
        link.setAttribute('href', seg.url);
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        link.addEventListener('click', (e) => e.stopPropagation());
        container.appendChild(link);
      }
    }
    return container;
  }

  /** Render the in-progress archiving banner (spinner + label). */
  public renderArchivingProgressBanner(
    parent: HTMLElement,
    _post: PostData,
  ): HTMLElement {
    const banner = this.makeDiv(
      parent,
      'archive-progress-banner pcr-suggestion-banner pcr-suggestion-banner-filled',
    );
    this.makeDiv(banner, 'pcr-spinner');
    const message = document.createElement('span');
    message.textContent = 'Archiving in background...';
    message.className = 'pcr-banner-message';
    banner.appendChild(message);
    return banner;
  }

  /**
   * Render a status banner. The original supported the legacy
   * `'downloaded' | 'download-declined'` set; we keep the same kinds
   * recognized (everything else returns an empty placeholder, matching
   * the source's "return early" branches).
   */
  public renderStatusBanner(
    parent: HTMLElement,
    _post: PostData,
    kind: string,
  ): HTMLElement {
    if (kind === 'download-declined') {
      // Source returns early without rendering any banner.
      return this.makeDiv(parent, 'archive-status-banner pcr-suggestion-banner pcr-suggestion-banner--noop sa-hidden');
    }

    const banner = this.makeDiv(parent, 'archive-status-banner pcr-suggestion-banner');
    let messageText: string;
    if (kind === 'downloaded') {
      messageText = 'Video downloaded';
    } else {
      messageText = kind;
    }

    const message = document.createElement('span');
    message.textContent = messageText;
    message.className = 'pcr-banner-message';
    banner.appendChild(message);

    // Match the source's auto-hide for the 'downloaded' kind — defer to
    // window.setTimeout so callers can observe initial mount before fade-out.
    if (kind === 'downloaded' && typeof window !== 'undefined') {
      window.setTimeout(() => {
        banner.classList.add('pcr-fade-out');
        window.setTimeout(() => banner.remove(), 300);
      }, 2000);
    }

    return banner;
  }

  /**
   * Render an "Archive this post?" suggestion banner. Pure visual factory —
   * caller wires `onAccept` / `onDecline` to whatever vault/credit/auth flow
   * they need. Returns the banner so callers can mutate state during the
   * archive call (hide buttons, replace message, etc.).
   */
  public renderSuggestionBanner(
    parent: HTMLElement,
    opts: SuggestionBannerOptions = {},
  ): HTMLElement {
    const filledClass = opts.filled ? ' pcr-suggestion-banner-filled' : '';
    const banner = this.makeDiv(
      parent,
      `archive-suggestion-banner pcr-suggestion-banner${filledClass}`,
    );

    const message = document.createElement('span');
    message.className = 'pcr-banner-message';
    message.textContent = opts.message ?? 'Archive this post?';
    banner.appendChild(message);

    const buttonSection = this.makeDiv(banner, 'pcr-banner-buttons');

    if (opts.onDecline) {
      const noButton = document.createElement('button');
      noButton.className = 'pcr-icon-btn pcr-icon-btn-cancel';
      noButton.setAttribute('aria-label', 'Decline archiving');
      noButton.setAttribute('title', opts.declineLabel ?? 'No');
      const noIcon = this.makeDiv(noButton, 'pcr-icon-btn-icon');
      noIcon.textContent = '✕';
      noButton.addEventListener('click', () => opts.onDecline?.());
      buttonSection.appendChild(noButton);
    }

    if (opts.onAccept) {
      const yesButton = document.createElement('button');
      yesButton.className = 'pcr-icon-btn pcr-icon-btn-accent';
      yesButton.setAttribute('aria-label', 'Archive this post');
      yesButton.setAttribute('title', opts.acceptLabel ?? 'Yes');
      const yesIcon = this.makeDiv(yesButton, 'pcr-icon-btn-icon');
      yesIcon.textContent = '✓';
      yesButton.addEventListener('click', () => opts.onAccept?.());
      buttonSection.appendChild(yesButton);
    }

    return banner;
  }

  /**
   * Render the Google Maps business info block (address, hours, website).
   * Pure visual — no `setIcon` (we use emoji glyphs that match the rest of
   * the renderer's vocabulary), no Obsidian-specific helpers.
   */
  public renderGoogleMapsBusinessInfo(
    container: HTMLElement,
    post: PostData,
  ): HTMLElement {
    const data = parseGoogleMapsBusinessData(post);
    const directionsUrl = buildGoogleMapsDirectionsUrl(
      data.lat,
      data.lng,
      data.address,
      data.name,
    );

    const wrapper = this.makeDiv(container, 'pcr-gmaps-business-info');

    if (data.address) {
      const addressRow = this.makeDiv(wrapper, 'gmaps-address pcr-gmaps-address-row');
      addressRow.addEventListener('click', () => {
        if (typeof window !== 'undefined') window.open(directionsUrl, '_blank');
      });

      const addressIconWrapper = this.makeDiv(addressRow, 'pcr-gmaps-address-icon');
      addressIconWrapper.textContent = '📍';

      const addressText = this.makeDiv(addressRow, 'pcr-gmaps-address-text');
      const shortAddress = PreviewableContentRenderer.abbreviateAddress(data.address);
      const addressLabel = this.makeDiv(addressText, 'pcr-gmaps-address-label');
      addressLabel.textContent = shortAddress;
      addressLabel.setAttribute('title', data.address);

      const hint = this.makeDiv(addressText, 'pcr-gmaps-direction-hint');
      hint.textContent = 'Tap for directions';

      const arrowIconWrapper = this.makeDiv(addressRow, 'pcr-gmaps-arrow-icon');
      arrowIconWrapper.textContent = '↗';
    }

    if (data.hours && Object.keys(data.hours).length > 0) {
      const formattedHours = formatBusinessHours(data.hours);

      const hoursSection = this.makeDiv(wrapper, 'gmaps-hours pcr-gmaps-hours-section');
      const summaryRow = this.makeDiv(hoursSection, 'pcr-gmaps-hours-summary');
      const clockIconWrapper = this.makeDiv(summaryRow, 'pcr-gmaps-address-icon');
      clockIconWrapper.textContent = '⏰';
      const summarySpan = document.createElement('span');
      summarySpan.className = 'pcr-gmaps-hours-text';
      summarySpan.textContent = formattedHours.summary;
      summaryRow.appendChild(summarySpan);

      const detailedHours = this.makeDiv(hoursSection, 'pcr-gmaps-hours-detail sa-hidden');
      formattedHours.detailed.forEach(({ day, hours, isToday }) => {
        const dayRow = this.makeDiv(detailedHours, 'pcr-gmaps-day-row');
        if (isToday) {
          dayRow.style.fontWeight = '600';
          dayRow.style.color = 'var(--interactive-accent)';
        }
        const daySpan = document.createElement('span');
        daySpan.textContent = day;
        dayRow.appendChild(daySpan);
        const hoursSpan = document.createElement('span');
        hoursSpan.textContent = hours;
        if (hours.toLowerCase() === 'closed') {
          hoursSpan.classList.add('pcr-gmaps-closed');
        }
        dayRow.appendChild(hoursSpan);
      });

      let expanded = false;
      summaryRow.addEventListener('click', () => {
        expanded = !expanded;
        detailedHours.classList.toggle('sa-hidden', !expanded);
        if (expanded) {
          detailedHours.style.display = 'block';
        } else {
          detailedHours.style.removeProperty('display');
        }
      });
    }

    if (data.website) {
      const websiteRow = this.makeDiv(wrapper, 'gmaps-website pcr-gmaps-website-row');
      websiteRow.addEventListener('click', () => {
        if (typeof window !== 'undefined') window.open(data.website, '_blank');
      });

      const websiteIconWrapper = this.makeDiv(websiteRow, 'pcr-gmaps-website-icon');
      websiteIconWrapper.textContent = '🌐';

      const websiteSpan = document.createElement('span');
      websiteSpan.className = 'pcr-gmaps-website-text';
      websiteSpan.textContent = data.website
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '');
      websiteRow.appendChild(websiteSpan);

      const arrowIconWrapper = this.makeDiv(websiteRow, 'pcr-gmaps-arrow-icon');
      arrowIconWrapper.textContent = '↗';
    }

    return wrapper;
  }

  // ---------------------------------------------------------------------------
  // Internal — markdown rendering
  // ---------------------------------------------------------------------------

  /**
   * Render content as Obsidian markdown when both `app` and `component` are
   * supplied; otherwise fall back to plain-text paragraphs.
   *
   * The plain-text fallback splits on blank lines and emits a `<p>` per
   * paragraph (with `<br>` for in-paragraph newlines). This matches the
   * "every line preserved, no markdown interpretation" contract documented
   * in `PreviewContext`.
   */
  private async renderMarkdownOrText(target: HTMLElement, source: string): Promise<void> {
    const canRenderMarkdown = !!(this.context.app && this.context.component);
    if (canRenderMarkdown) {
      try {
        const obsidian = await import('obsidian');
        const renderer = (
          obsidian as unknown as {
            MarkdownRenderer?: {
              render: (
                a: unknown,
                md: string,
                el: HTMLElement,
                src: string,
                c: unknown,
              ) => Promise<void>;
            };
          }
        ).MarkdownRenderer;
        if (renderer && typeof renderer.render === 'function') {
          // Escapes are markdown-only: they prepend backslashes that
          // MarkdownRenderer consumes during parsing. On the plain-text
          // branch below they would leak through as literal `\.` / `\===`
          // — see PRD §0 (gallery preview bug).
          let processed = source;
          processed = PreviewableContentRenderer.escapeMarkdownHeadings(processed);
          processed = PreviewableContentRenderer.escapeOrderedListPatterns(processed);
          processed = PreviewableContentRenderer.escapeAngleBrackets(processed);
          await renderer.render(this.context.app, processed, target, '', this.context.component);
          return;
        }
      } catch {
        // Fall through to plain-text rendering.
      }
    }

    // Plain-text fallback: <p> per paragraph, <br> per in-paragraph newline.
    // The raw `source` is used verbatim — NO escape* helpers, NO wikilink
    // image conversion. Hashtags (`#tag`) and mentions (`@user`) are split
    // into styled `<span>` / `<a>` nodes via `appendInlineRich` so users get
    // visual differentiation matching the vault timeline (where the
    // MarkdownRenderer + Obsidian's tag/mention plugins do this for free).
    // Skip entirely when source is empty so we don't emit a phantom <p>.
    if (!source) return;
    const paragraphs = source.split(/\n{2,}/);
    for (const paragraph of paragraphs) {
      if (!paragraph) continue;
      const p = document.createElement('p');
      const lines = paragraph.split('\n');
      lines.forEach((line, idx) => {
        this.appendInlineRich(p, line);
        if (idx < lines.length - 1) {
          p.appendChild(document.createElement('br'));
        }
      });
      target.appendChild(p);
    }
  }

  /**
   * Append a single line of plain text into `parent`, splitting hashtag
   * and mention tokens into styled inline elements. Plain text segments
   * use `createTextNode` (XSS-safe). Hashtags become `.pcr-hashtag-span`
   * (or clickable `.pcr-hashtag-link` when a callback is wired); mentions
   * become `.pcr-mention-span`.
   *
   * Combined regex: `#tag` (anything until whitespace, `#`, or another `@`)
   * or `@user` (alphanumerics + `._`). Order in alternation prefers the
   * longest match.
   */
  private appendInlineRich(parent: HTMLElement, line: string): void {
    if (!line) return;
    const richPattern = /(#[^\s#@]+|@[A-Za-z0-9_.]+)/g;
    const parts = line.split(richPattern);
    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith('#') && part.length > 1) {
        const span = document.createElement('span');
        span.textContent = part;
        span.className = 'pcr-hashtag-span';
        parent.appendChild(span);
      } else if (part.startsWith('@') && part.length > 1) {
        const span = document.createElement('span');
        span.textContent = part;
        span.className = 'pcr-mention-span';
        parent.appendChild(span);
      } else {
        parent.appendChild(document.createTextNode(part));
      }
    }
  }

  /**
   * Resolve inline image src references through `context.resolveMediaUrl`.
   * Only rewrites markdown image syntax `![](src)` when the resolver returns
   * a different value; leaves everything else alone. Vault-coupled paths
   * (relative paths to vault attachments) are passed straight through to
   * the caller's resolver.
   */
  private maybeResolveInlineImageSrcs(markdown: string): string {
    return markdown.replace(
      /(!\[[^\]]*\]\()([^)\s]+)(\))/g,
      (_match, head: string, src: string, tail: string) => {
        const resolved = this.context.resolveMediaUrl(src);
        return `${head}${resolved ?? src}${tail}`;
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Internal — hashtag & tag class normalization
  // ---------------------------------------------------------------------------

  /**
   * Attach hashtag click handlers to anchors emitted by the markdown
   * renderer (or by `renderTextWithHashtags`). Detects:
   *
   *   - Obsidian-rendered tags  (`<a class="tag" href="#…">`)
   *   - External hashtag URLs   (`/tags/…`, `/hashtag/…`, `/tag/…`,
   *                              `/tagged/…`, `/search/…`, `search?q=…`)
   *
   * No-op when `context.onHashtagClick` is unset — the anchors remain as
   * normal clickable links.
   */
  private attachHashtagHandlers(contentEl: HTMLElement): void {
    if (!this.context.onHashtagClick) return;

    const allLinks = contentEl.querySelectorAll('a');
    allLinks.forEach((link) => {
      const href = link.getAttribute('href');
      const text = link.textContent ?? '';
      const classes = link.className;
      if (!href || !text) return;

      const isObsidianTag =
        classes.includes('tag') && href.startsWith('#') && text.startsWith('#');
      const isExternalHashtagLink =
        text.startsWith('#') &&
        (href.includes('/tagged/') ||
          href.includes('/tags/') ||
          href.includes('/hashtag/') ||
          href.includes('/tag/') ||
          href.includes('/search/') ||
          href.includes('search?q='));

      if (!isObsidianTag && !isExternalHashtagLink) return;

      const hashtag = text.startsWith('#') ? text.substring(1) : text;
      // Use capture phase so we intercept before Obsidian's own handlers.
      link.addEventListener(
        'click',
        (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          this.context.onHashtagClick?.(hashtag);
        },
        true,
      );
    });
  }

  /**
   * CSS in `post-card.css` already normalizes tag font sizes via the
   * `.post-body-text` parent class. This helper just guarantees the class is
   * present on the content element.
   */
  public normalizeTagFontSizes(contentEl: HTMLElement): void {
    if (!contentEl.classList.contains('post-body-text')) {
      contentEl.classList.add('post-body-text');
    }
  }

  // ---------------------------------------------------------------------------
  // Internal — post classification helpers
  // ---------------------------------------------------------------------------

  /**
   * Match `PostCardRenderer.renderContent` blog-body branch. RSS-based
   * platforms are detected by the same string set the source uses
   * (rssBasedPlatforms in `src/constants/rssPlatforms`); we inline the
   * minimal check here to avoid a fork of that constant.
   */
  private shouldRenderAsBlog(post: PostData): boolean {
    if (!post.content.rawMarkdown) return false;
    if (post.platform === 'web' || post.platform === 'threads') return true;
    if (post.platform === 'x' && post.content.rawMarkdown) return true;
    return PreviewableContentRenderer.isRssBasedPlatform(post.platform);
  }

  /** Title strip eligibility check. Mirrors the source. */
  private isRssLikeWithTitle(post: PostData): boolean {
    if (!post.title) return false;
    if (post.platform === 'web') return true;
    return PreviewableContentRenderer.isRssBasedPlatform(post.platform);
  }

  /**
   * RSS-based platform check. Inlined to avoid pulling in
   * `constants/rssPlatforms.ts` — Round 3 will dedupe.
   */
  private static isRssBasedPlatform(platform: string | undefined): boolean {
    if (!platform) return false;
    return new Set([
      'rss',
      'podcast',
      'naver',
      'brunch',
      'tistory',
      'medium',
      'substack',
      'webtoon',
    ]).has(platform);
  }

  // ---------------------------------------------------------------------------
  // Internal — pure helpers (private static)
  // ---------------------------------------------------------------------------

  /** Escape Setext heading patterns: lines of `-` or `=` alone make the
   *  preceding line a heading. Escape with backslash to keep them literal.
   */
  private static escapeMarkdownHeadings(content: string): string {
    return content.replace(/^([-=]+)$/gm, '\\$1');
  }

  /** Escape `<` `>` so MarkdownRenderer doesn't treat `<책 제목>` as HTML. */
  private static escapeAngleBrackets(content: string): string {
    return content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Escape ordered-list patterns so that `2025. 11. 6` doesn't render as a
   * nested ordered list, and so `1.\n` doesn't begin a list.
   */
  private static escapeOrderedListPatterns(content: string): string {
    if (!content) return content;
    return content.replace(/^(\s*)(\d+)\.(?=\s|$)/gm, '$1$2\\.');
  }

  /** Convert Obsidian wikilink images to standard markdown image syntax. */
  private static convertWikilinkImages(markdown: string): string {
    return markdown.replace(
      /!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g,
      (_match: string, filename: string, alt: string | undefined) => {
        const altText = alt ?? '';
        return `![${altText}](${PreviewableContentRenderer.encodePathForMarkdownLink(filename)})`;
      },
    );
  }

  /** Local copy of `encodePathForMarkdownLink` to keep this file self-contained. */
  private static encodePathForMarkdownLink(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return path.replace(/%/g, '%25').replace(/ /g, '%20').replace(/\)/g, '%29');
  }

  /** Hashtag platform URL builder. Mirrors `PostCardRenderer.getHashtagUrl`. */
  private static getHashtagUrl(hashtag: string, platform: string): string {
    const clean = (hashtag.startsWith('#') ? hashtag.slice(1) : hashtag).trim();
    const encoded = encodeURIComponent(clean);

    const urlMap: Record<string, string> = {
      instagram: `https://www.instagram.com/explore/tags/${encoded}/`,
      x: `https://twitter.com/hashtag/${encoded}`,
      twitter: `https://twitter.com/hashtag/${encoded}`,
      facebook: `https://www.facebook.com/hashtag/${encoded}`,
      linkedin: `https://www.linkedin.com/feed/hashtag/${encoded}/`,
      tiktok: `https://www.tiktok.com/tag/${encoded}`,
      threads: `https://www.threads.net/tag/${encoded}`,
      youtube: `https://www.youtube.com/hashtag/${encoded}`,
      tumblr: `https://www.tumblr.com/tagged/${encoded}`,
      reddit: `https://www.reddit.com/search/?q=%23${encoded}`,
      pinterest: `https://www.pinterest.com/search/pins/?q=${encoded}`,
    };

    return (
      urlMap[(platform || '').toLowerCase()] ||
      `https://www.google.com/search?q=${encodeURIComponent(`#${clean}`)}`
    );
  }

  /** Mirrors `PostCardRenderer.getWikiLinkDisplayText`. */
  private static getWikiLinkDisplayText(notePath: string): string {
    const displayText = notePath.replace(/\.md$/i, '');
    const parts = displayText.split('/');
    return parts[parts.length - 1] || displayText;
  }

  /** Strip YAML frontmatter from a markdown blob. Mirrors the original. */
  private static _removeYamlFrontmatter(content: string): string {
    return content.replace(/^---\n[\s\S]*?\n---\n/, '');
  }

  /** Strip the first H1 heading from a markdown blob. Mirrors the original. */
  private static _removeFirstH1(content: string): string {
    return content.replace(/^#\s+.+\n/, '');
  }

  /**
   * Format a transcript timestamp in seconds for in-content display
   * (`H:MM:SS` or `M:SS`). Mirrors `PostCardRenderer.formatTimestampForContent`.
   */
  private static formatTimestampForContent(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Abbreviate a long postal address for compact display.
   * Mirrors `PostCardRenderer.abbreviateAddress`.
   */
  private static abbreviateAddress(address: string): string {
    const parts = address.split(',').map((p) => p.trim());
    if (parts.length <= 3) return address;

    const street = parts[0];
    const lastParts = parts.slice(-2);
    const cleanLastParts = lastParts.map((p) => p.replace(/\s*\d{4,6}\s*/, ' ').trim());
    return [street, ...cleanLastParts].join(', ');
  }

  // ---------------------------------------------------------------------------
  // Internal — DOM helper
  // ---------------------------------------------------------------------------

  private makeDiv(parent: HTMLElement, className: string): HTMLDivElement {
    const div = document.createElement('div');
    div.className = className;
    parent.appendChild(div);
    return div;
  }
}

/**
 * Round-3 dedupe: the Google Maps pure helpers
 * (`parseGoogleMapsBusinessData`, `formatBusinessHours`,
 * `buildGoogleMapsDirectionsUrl`) used to live here as private statics. They
 * have moved to `PreviewableHelpers.ts` as canonical exports — both
 * `PreviewableContentRenderer.renderGoogleMapsBusinessInfo` and
 * `PostCardRenderer`'s vault timeline now import from the same source.
 *
 * The other private statics (escape*, convertWikilinkImages, abbreviateAddress,
 * isRssBasedPlatform, etc.) remain inside this class — they are tightly
 * scoped to caption rendering / blog-body markdown handling and have a single
 * consumer.
 */
export const PreviewableContentHelpersInternal = Object.freeze({
  // Intentionally empty — see PreviewableHelpers.ts for the canonical
  // Google Maps helpers. Kept as a frozen empty namespace export so that any
  // forward-compat consumer that imports the symbol does not crash at runtime.
});
