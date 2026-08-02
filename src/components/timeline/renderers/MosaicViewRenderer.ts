import { type App, TFile, setIcon } from 'obsidian';
import type { PostData } from '../../../types/post';
import { maybeProxyCdnUrl } from '../../../utils/cdnProxy';
import { getPlatformSimpleIcon } from '../../../services/IconService';
import { createSVGElement } from '../../../utils/dom-helpers';

/**
 * Thumbnail pick result for a mosaic tile.
 * `type: 'video'` means "render a <video> element" (no poster image found);
 * a video WITH a thumbnail resolves to `type: 'image'`.
 */
export interface MosaicThumbnail {
  url: string;
  type: 'image' | 'video';
}

/** The subset of PostData the thumbnail pick needs (keeps tests light). */
export type MosaicThumbnailSource = Pick<PostData, 'media' | 'thumbnail'> & {
  metadata?: { externalLinkImage?: string };
};

/**
 * Pick the best thumbnail for a mosaic tile (pure — unit-tested).
 * Priority: first image media → post.thumbnail (YouTube) → first video's
 * poster → first video itself → external link image → null (text tile).
 */
export function pickMosaicThumbnail(post: MosaicThumbnailSource): MosaicThumbnail | null {
  const media = post.media ?? [];

  const firstImage = media.find((m) => m.type === 'image' && m.url);
  if (firstImage) {
    return { url: firstImage.url, type: 'image' };
  }

  if (post.thumbnail) {
    return { url: post.thumbnail, type: 'image' };
  }

  const firstVideo = media.find((m) => m.type === 'video' && m.url);
  if (firstVideo) {
    const poster = firstVideo.thumbnail || firstVideo.r2ThumbnailUrl || firstVideo.thumbnailUrl;
    if (poster) {
      return { url: poster, type: 'image' };
    }
    return { url: firstVideo.url, type: 'video' };
  }

  const linkImage = post.metadata?.externalLinkImage;
  if (linkImage) {
    return { url: linkImage, type: 'image' };
  }

  return null;
}

/**
 * Build a plain-text excerpt for text-only tiles (pure — unit-tested).
 * Collapses whitespace and truncates on a word boundary with an ellipsis.
 */
export function mosaicTextExcerpt(text: string, maxLength = 200): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  const slice = collapsed.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(' ');
  // Only respect the word boundary when it doesn't chop off most of the text.
  const cut = lastSpace > maxLength * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

/**
 * MosaicViewRenderer — Pinterest-style mixed-content board for the timeline.
 * Single Responsibility: mosaic view rendering (media tiles + text tiles).
 *
 * Unlike GalleryViewRenderer (media files only, re-reads the vault), this is
 * fed pre-filtered PostData from TimelineContainer — no vault.read() here.
 *
 * ponytail: unvirtualized DOM + CSS multicol column-major order — accepted
 * ceiling per the architecture plan; virtualize only if large vaults hurt.
 */
export class MosaicViewRenderer {
  private lazyLoadObserver: IntersectionObserver | null = null;

  constructor(private app: App) {}

  /** Disconnect observers from a previous render. */
  destroy(): void {
    this.lazyLoadObserver?.disconnect();
    this.lazyLoadObserver = null;
  }

  /**
   * Render the mosaic grid into `container`.
   * @param scrollRoot the actual scrolling ancestor (used as IO root)
   */
  render(container: HTMLElement, posts: PostData[], scrollRoot: HTMLElement | null): void {
    this.destroy();

    if (posts.length === 0) {
      const emptyDiv = container.createDiv('sa-mosaic-empty sa-text-center sa-text-muted');
      emptyDiv.createEl('p', { text: 'No posts to show' });
      return;
    }

    const gridEl = container.createDiv('sa-mosaic');

    // Same lazy-load pattern as GalleryViewRenderer: data-src + IO, 400px margin.
    this.lazyLoadObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const card = entry.target as HTMLElement;
          const img = card.querySelector('img[data-src]');
          if (img instanceof HTMLImageElement) {
            img.src = img.dataset['src'] || '';
            img.removeAttribute('data-src');
          }
          const video = card.querySelector('video[data-src]');
          if (video instanceof HTMLVideoElement) {
            video.src = video.dataset['src'] || '';
            video.removeAttribute('data-src');
          }
          this.lazyLoadObserver?.unobserve(card);
        }
      },
      { root: scrollRoot, rootMargin: '400px', threshold: 0.01 }
    );

    for (const post of posts) {
      this.renderCard(gridEl, post);
    }
  }

  private renderCard(gridEl: HTMLElement, post: PostData): void {
    const cardEl = gridEl.createDiv('sa-mosaic-card');
    cardEl.setAttribute('role', 'button');
    cardEl.setAttribute('tabindex', '0');

    const thumb = pickMosaicThumbnail(post);
    const resolvedSrc = thumb ? this.resolveMediaSrc(thumb.url) : null;

    if (thumb && resolvedSrc) {
      this.renderThumbnail(cardEl, thumb, resolvedSrc, post);
    } else {
      this.renderTextTile(cardEl, post);
    }

    // Footer is ALWAYS visible — no hover-only affordances (Obsidian mobile/iPad).
    this.renderFooter(cardEl, post);

    const openPost = () => {
      if (!post.filePath) return;
      const file = this.app.vault.getAbstractFileByPath(post.filePath);
      if (file instanceof TFile) {
        void this.app.workspace.getLeaf().openFile(file);
      }
    };
    cardEl.addEventListener('click', openPost);
    cardEl.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' || evt.key === ' ') {
        evt.preventDefault();
        openPost();
      }
    });
  }

  private renderThumbnail(
    cardEl: HTMLElement,
    thumb: MosaicThumbnail,
    resolvedSrc: string,
    post: PostData
  ): void {
    const mediaContainer = cardEl.createDiv('sa-mosaic-media');

    if (thumb.type === 'image') {
      const imgEl = mediaContainer.createEl('img', {
        attr: {
          'data-src': resolvedSrc,
          alt: post.title || 'Archived media',
          loading: 'lazy',
        },
      });
      imgEl.addClass('sa-mosaic-media-loading');
      // Measure-on-load: min-height placeholder until natural size known.
      // No dims are persisted to notes — accepted plan constraint.
      imgEl.onload = () => imgEl.addClass('is-loaded');
      imgEl.onerror = () => {
        imgEl.remove();
        mediaContainer.remove();
        this.renderTextTile(cardEl, post, true);
      };
    } else {
      const videoEl = mediaContainer.createEl('video', {
        attr: {
          'data-src': resolvedSrc,
          playsinline: 'true',
          preload: 'metadata',
        },
      });
      videoEl.muted = true;
      videoEl.addClass('sa-mosaic-media-loading');
      videoEl.onloadeddata = () => videoEl.addClass('is-loaded');
      videoEl.onerror = () => {
        videoEl.remove();
        mediaContainer.remove();
        this.renderTextTile(cardEl, post, true);
      };
    }

    // Play badge so video tiles read as video without hover.
    const hasVideo = thumb.type === 'video' || post.media?.some((m) => m.type === 'video');
    if (hasVideo) {
      const playIcon = mediaContainer.createDiv('sa-mosaic-play-icon');
      setIcon(playIcon, 'play');
    }

    this.lazyLoadObserver?.observe(cardEl);
  }

  private renderTextTile(cardEl: HTMLElement, post: PostData, prepend = false): void {
    const textEl = cardEl.createDiv('sa-mosaic-text');
    textEl.setAttribute('data-platform', post.platform);
    if (prepend) {
      // Media failed to load after the footer was already rendered — keep the
      // text tile above the footer.
      cardEl.prepend(textEl);
    }

    if (post.title) {
      textEl.createDiv({ cls: 'sa-mosaic-text-title', text: post.title });
    }
    const excerpt = mosaicTextExcerpt(post.content?.text || '');
    if (excerpt) {
      textEl.createDiv({ cls: 'sa-mosaic-text-body', text: excerpt });
    }
    if (!post.title && !excerpt) {
      textEl.createDiv({ cls: 'sa-mosaic-text-body sa-text-muted', text: '(no text)' });
    }
  }

  private renderFooter(cardEl: HTMLElement, post: PostData): void {
    const footerEl = cardEl.createDiv('sa-mosaic-footer');

    const platformIcon = getPlatformSimpleIcon(post.platform, post.author?.url);
    if (platformIcon) {
      const iconWrapper = footerEl.createDiv('sa-mosaic-footer-icon');
      const svg = createSVGElement(platformIcon, {
        fill: 'var(--text-muted)',
        width: '100%',
        height: '100%',
      });
      iconWrapper.appendChild(svg);
    }

    const metaEl = footerEl.createDiv('sa-mosaic-footer-meta');
    const label = post.title || mosaicTextExcerpt(post.content?.text || '', 80);
    if (label) {
      metaEl.createDiv({ cls: 'sa-mosaic-footer-title', text: label });
    }
    if (post.author?.name) {
      metaEl.createDiv({ cls: 'sa-mosaic-footer-author', text: post.author.name });
    }
  }

  /**
   * Resolve a media reference to something an <img>/<video> can load:
   * remote URLs go through the CDN proxy (403-blocking CDNs), vault-relative
   * paths through the adapter resource path. Mirrors PostCardRenderer's
   * `resolvePreviewMediaUrl` policy.
   */
  private resolveMediaSrc(raw: string): string | null {
    if (/^(?:https?:|data:|blob:)/i.test(raw)) {
      return maybeProxyCdnUrl(raw);
    }
    try {
      return this.app.vault.adapter.getResourcePath(raw.replace(/^\.\//, ''));
    } catch {
      return null;
    }
  }
}
