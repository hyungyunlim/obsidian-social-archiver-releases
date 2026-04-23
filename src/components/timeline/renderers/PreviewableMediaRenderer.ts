/**
 * PreviewableMediaRenderer
 * ---------------------------------------------------------------------------
 * Visual-chrome renderer for the **media area** of a post card. Designed to
 * be reused by any *preview* surface that needs to render media without
 * dragging in the vault-coupled `MediaGalleryRenderer` /
 * `YouTubeEmbedRenderer` / `LinkPreviewRenderer` stack.
 *
 * Today's primary consumer is the Instagram Import Review Gallery
 * (`src/ui/instagram-import/ImportGalleryContainer.svelte`) which calls
 * `renderHeroImage` to show a single hero + "+N" badge in the slim card body.
 *
 * --- Design notes --------------------------------------------------------
 *
 *  - Single Responsibility: this class owns the *visual* DOM of the media
 *    area. It does NOT own:
 *      * vault file lookups (`findDownloadedVideo`, `getResourcePath`)
 *      * YouTube player controllers (vault-side seek dispatch)
 *      * lightbox modal trigger lifecycle (lightbox visual frame is provided
 *        as a no-op-friendly utility — the vault timeline can wire its own
 *        modal open via a callback)
 *
 *  - Per the parent PRD `prd-instagram-import-gallery.md` §0, every output
 *    uses the SAME CSS class names as the equivalent code path in
 *    `PostCardRenderer` (`pcr-gallery`, `pcr-gallery-main`, `pcr-video-*`,
 *    `pcr-gmaps-*`, `pcr-map-*`, `sa-map-*`, etc.) so the existing vault
 *    stylesheet (`src/styles/components/post-card.css`) applies unchanged.
 *
 *  - For the new "simple hero" path that the import gallery actually uses
 *    today, we introduce two new BEM-style hooks:
 *      `.pcr-media-hero` — single hero image / video poster
 *      `.pcr-media-count-badge` — the floating "+N" overflow badge
 *    These are meant to be drop-in counterparts to the more complex
 *    `MediaGalleryRenderer` carousel — they intentionally render LESS chrome
 *    so a slim card body stays slim. (Tradeoff: no swipe between siblings,
 *    no lightbox-on-click out of the box. Callers can wrap the returned
 *    element in their own gesture handler.)
 *
 *  - DOM helpers below use plain `document.createElement` instead of
 *    Obsidian's `createDiv`/`createEl` enrichments. The enrichments DO exist
 *    on every element at Obsidian runtime, but they are not present in the
 *    unit-test mock. Using plain DOM works in both contexts and produces
 *    identical DOM trees.
 *
 *  - Leaflet (used by `renderGoogleMapsEmbed`) is imported as a static
 *    namespace. When the host environment doesn't ship Leaflet (e.g. some
 *    test harnesses), the embed gracefully falls back to a text-only
 *    location card instead of throwing. This matches the source's behavior.
 */

import * as L from 'leaflet';
import type { PostData } from '../../../types/post';
// Imported for parity with sibling renderers / future-proofing of the
// PreviewContext shape — not currently consumed by the media renderer.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { extractYouTubeVideoId as _extractYouTubeVideoId } from './PreviewableHelpers';
import type { PreviewContext } from './PreviewableContext';

// Re-export so existing direct imports of `PreviewContext` from this file
// keep working without a cascade of touch-ups across the codebase.
export type { PreviewContext } from './PreviewableContext';

/**
 * Options for `renderLocalVideoWithRef` — currently a strict superset of
 * `renderLocalVideo` for forward compatibility with the source's overloads.
 */
export interface RenderLocalVideoOpts {
  /**
   * If provided, overrides the default Obsidian-style attributes. Most
   * callers should leave this `undefined`.
   */
  attrs?: Record<string, string>;
}

export class PreviewableMediaRenderer {
  constructor(private readonly context: PreviewContext) {}

  // -------------------------------------------------------------------------
  // Hero / multi-media carousel
  //
  // Used by the Instagram Import Review Gallery and any other preview surface
  // that wants a slim card body. Single-item posts render a bare hero (no
  // chrome). Multi-item posts get a self-contained carousel with chevron
  // navigation, dot indicators, "N / M" counter, keyboard arrows, and touch
  // swipe — all in vanilla JS / DOM (no third-party deps).
  //
  // State model: `currentIndex` lives in a per-call closure. Each
  // `renderHeroImage` invocation produces an isolated carousel instance —
  // there is no module-level map keyed by post id, because each card mounts
  // a fresh DOM subtree and the import gallery never re-uses carousel nodes
  // across rerenders.
  // -------------------------------------------------------------------------

  /**
   * Render the post media into `parent`:
   *
   *   - 0 items: empty wrapper (caller may layer a text-only placeholder).
   *   - 1 item: bare hero image / video frame (no nav / dots / counter).
   *   - 2+ items: full carousel — track of frames, prev/next chevrons,
   *     dot indicators, "N / M" counter (top-right), keyboard arrow nav,
   *     touch swipe, and inline `<video controls playsinline>` for the
   *     CURRENT frame when it is a video. Off-screen video frames render
   *     a cheap `<img>` poster so the grid stays light.
   *
   * Returns the wrapper element so callers can layer overlays (selection
   * checkbox, drag handles, etc.) without re-querying the DOM.
   */
  public renderHeroImage(parent: HTMLElement, post: PostData): HTMLElement {
    const wrapper = this.makeDiv(parent, 'pcr-media-hero');
    wrapper.style.position = 'relative';
    wrapper.style.aspectRatio = '1 / 1';
    wrapper.style.overflow = 'hidden';
    // Neutral wrapper background so when portrait (9:16) or landscape (16:9)
    // media gets letterboxed inside the 1:1 frame (object-fit: contain), the
    // empty strips read as a deliberate thumbnail frame rather than a styling
    // gap. `--background-secondary` adapts to Obsidian light/dark themes.
    wrapper.style.background = 'var(--background-secondary)';

    const media = post.media ?? [];

    if (media.length === 0) {
      // Text-only post — caller decides whether to label it. We still
      // return the wrapper so layout calculations work uniformly.
      return wrapper;
    }

    if (media.length === 1) {
      // Single item: bare hero, no carousel chrome.
      const frame = this.makeDiv(wrapper, 'pcr-media-carousel-frame');
      frame.style.width = '100%';
      frame.style.height = '100%';
      frame.style.position = 'relative';
      this.populateFrame(frame, media[0]!, /* isCurrent */ true);
      return wrapper;
    }

    // -- Multi-item carousel -------------------------------------------------
    return this.buildCarousel(wrapper, media);
  }

  /**
   * Build the multi-item carousel inside `wrapper`. Returns the same wrapper
   * so the public method has a uniform return shape.
   */
  private buildCarousel(
    wrapper: HTMLElement,
    media: PostData['media'],
  ): HTMLElement {
    wrapper.classList.add('pcr-media-carousel');
    wrapper.setAttribute('tabindex', '0');
    wrapper.setAttribute('role', 'group');
    wrapper.setAttribute('aria-roledescription', 'carousel');

    const total = media.length;
    let currentIndex = 0;

    // Track holds all frames; only the current one is visible (display:block).
    const track = this.makeDiv(wrapper, 'pcr-media-carousel-track');
    track.style.position = 'relative';
    track.style.width = '100%';
    track.style.height = '100%';

    const frames: HTMLElement[] = [];
    media.forEach((item, idx) => {
      const frame = this.makeDiv(track, 'pcr-media-carousel-frame');
      frame.setAttribute('data-frame-index', String(idx));
      frame.style.position = 'absolute';
      frame.style.inset = '0';
      frame.style.width = '100%';
      frame.style.height = '100%';
      frame.style.display = idx === 0 ? 'block' : 'none';
      this.populateFrame(frame, item, /* isCurrent */ idx === 0);
      frames.push(frame);
    });

    // Counter overlay (top-right) replaces the legacy "+N" badge.
    const counter = this.makeDiv(wrapper, 'pcr-media-carousel-counter');
    counter.textContent = `1 / ${total}`;
    counter.setAttribute('aria-label', `${total} media items`);
    counter.style.position = 'absolute';
    counter.style.top = '8px';
    counter.style.right = '8px';
    counter.style.padding = '2px 8px';
    counter.style.background = 'rgba(0, 0, 0, 0.55)';
    counter.style.color = '#fff';
    counter.style.borderRadius = '999px';
    counter.style.fontSize = 'var(--font-ui-smaller, 0.75rem)';
    counter.style.fontWeight = '600';
    counter.style.pointerEvents = 'none';
    counter.style.zIndex = '2';

    // Prev / Next chevron buttons — 44px hit area minimum (mobile target).
    const prevBtn = document.createElement('button');
    prevBtn.classList.add('pcr-media-carousel-nav', 'pcr-media-carousel-nav-prev');
    prevBtn.type = 'button';
    prevBtn.setAttribute('aria-label', 'Previous media');
    prevBtn.textContent = '‹';
    this.styleNavButton(prevBtn, 'left');

    const nextBtn = document.createElement('button');
    nextBtn.classList.add('pcr-media-carousel-nav', 'pcr-media-carousel-nav-next');
    nextBtn.type = 'button';
    nextBtn.setAttribute('aria-label', 'Next media');
    nextBtn.textContent = '›';
    this.styleNavButton(nextBtn, 'right');

    wrapper.appendChild(prevBtn);
    wrapper.appendChild(nextBtn);

    // Dot indicators (bottom).
    const dots = this.makeDiv(wrapper, 'pcr-media-carousel-dots');
    dots.style.position = 'absolute';
    dots.style.left = '0';
    dots.style.right = '0';
    dots.style.bottom = '8px';
    dots.style.display = 'flex';
    dots.style.justifyContent = 'center';
    dots.style.gap = '4px';
    dots.style.pointerEvents = 'none';
    dots.style.zIndex = '2';

    const dotEls: HTMLElement[] = [];
    for (let i = 0; i < total; i++) {
      const dot = document.createElement('span');
      dot.classList.add('pcr-media-carousel-dot');
      if (i === 0) dot.classList.add('pcr-media-carousel-dot-active');
      dot.style.width = '6px';
      dot.style.height = '6px';
      dot.style.borderRadius = '999px';
      dot.style.background =
        i === 0 ? 'var(--interactive-accent, #fff)' : 'rgba(255, 255, 255, 0.55)';
      dot.style.transition = 'background-color 120ms ease';
      dots.appendChild(dot);
      dotEls.push(dot);
    }

    // Reflect current index on the wrapper for tests & host introspection.
    wrapper.setAttribute('data-current-index', '0');

    const goTo = (next: number): void => {
      const target = ((next % total) + total) % total;
      if (target === currentIndex) return;

      // Pause any playing video on the OUTGOING frame before we hide it.
      const outgoing = frames[currentIndex];
      if (outgoing) {
        const playingVideo = outgoing.querySelector('video');
        if (playingVideo && typeof playingVideo.pause === 'function') {
          try {
            playingVideo.pause();
          } catch {
            // Best-effort — never let a pause failure break navigation.
          }
        }
        outgoing.style.display = 'none';
      }

      // Show incoming frame. If it was rendered as a poster <img> (because
      // it wasn't current at build time), upgrade it to a real <video>
      // element now so the user can actually play it.
      const incoming = frames[target];
      if (incoming) {
        const item = media[target];
        if (item) {
          this.upgradeFrameToCurrent(incoming, item);
        }
        incoming.style.display = 'block';
      }

      currentIndex = target;
      wrapper.setAttribute('data-current-index', String(currentIndex));
      counter.textContent = `${currentIndex + 1} / ${total}`;
      dotEls.forEach((d, i) => {
        if (i === currentIndex) {
          d.classList.add('pcr-media-carousel-dot-active');
          d.style.background = 'var(--interactive-accent, #fff)';
        } else {
          d.classList.remove('pcr-media-carousel-dot-active');
          d.style.background = 'rgba(255, 255, 255, 0.55)';
        }
      });
    };

    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      goTo(currentIndex - 1);
    });
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      goTo(currentIndex + 1);
    });

    // Keyboard nav — only when the carousel itself has focus, so this
    // doesn't fight with global hotkeys when a sibling card is focused.
    wrapper.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        goTo(currentIndex + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        goTo(currentIndex - 1);
      }
    });

    // Touch swipe — vanilla touchstart/touchend, ~30px threshold.
    // Tracks horizontal delta only; ignores swipes that look like vertical
    // scroll attempts so the page remains scrollable on mobile.
    const SWIPE_THRESHOLD_PX = 30;
    let touchStartX = 0;
    let touchStartY = 0;
    let trackingTouch = false;
    wrapper.addEventListener(
      'touchstart',
      (e: TouchEvent) => {
        const t = e.changedTouches[0];
        if (!t) return;
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        trackingTouch = true;
      },
      { passive: true },
    );
    wrapper.addEventListener(
      'touchend',
      (e: TouchEvent) => {
        if (!trackingTouch) return;
        trackingTouch = false;
        const t = e.changedTouches[0];
        if (!t) return;
        const dx = t.clientX - touchStartX;
        const dy = t.clientY - touchStartY;
        if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
        if (Math.abs(dy) > Math.abs(dx)) return; // vertical scroll, ignore
        if (dx < 0) {
          goTo(currentIndex + 1);
        } else {
          goTo(currentIndex - 1);
        }
      },
      { passive: true },
    );

    return wrapper;
  }

  /**
   * Populate a frame with the right element type for the given media item:
   *
   *   - resolve fails → "Preview loading…" placeholder
   *   - image → <img loading="lazy">
   *   - video + isCurrent → <video controls playsinline poster=...>
   *   - video + !isCurrent → cheap <img> poster (upgraded later via
   *     `upgradeFrameToCurrent` when the user navigates to it)
   */
  private populateFrame(
    frame: HTMLElement,
    item: PostData['media'][number],
    isCurrent: boolean,
  ): void {
    if (item.type === 'video') {
      if (isCurrent) {
        // For the playable frame we need the actual video URL — NOT the
        // poster — as <video src>. `pickVideoSrc` resolves the video URL
        // first; `renderVideoElement` separately resolves the poster.
        const videoSrc = this.pickVideoSrc(item);
        if (!videoSrc) {
          this.renderPlaceholder(frame);
          return;
        }
        this.renderVideoElement(frame, item, videoSrc);
        return;
      }
      // Off-screen video: cheap <img> poster only. `pickMediaSrc` prefers
      // the poster URL, which is exactly what we want here.
      const posterSrc = this.pickMediaSrc(item);
      if (!posterSrc) {
        this.renderPlaceholder(frame);
        return;
      }
      this.renderImageElement(frame, item, posterSrc, /* lazy */ true);
      return;
    }
    // Plain image frame.
    const src = this.pickMediaSrc(item);
    if (!src) {
      this.renderPlaceholder(frame);
      return;
    }
    this.renderImageElement(frame, item, src, /* lazy */ !isCurrent);
  }

  /**
   * When the user navigates to a video frame that was previously rendered
   * as a cheap <img> poster, swap it for a real <video> so they can play.
   * Idempotent — if the frame already contains a <video>, this is a no-op.
   */
  private upgradeFrameToCurrent(
    frame: HTMLElement,
    item: PostData['media'][number],
  ): void {
    if (item.type !== 'video') return;
    if (frame.querySelector('video')) return; // already upgraded
    const videoSrc = this.pickVideoSrc(item);
    if (!videoSrc) return;
    this.emptyElement(frame);
    this.renderVideoElement(frame, item, videoSrc);
  }

  /**
   * Resolve the playable video URL for a media item. Prefers the canonical
   * `url` field (the actual video bytes) over thumbnail / poster URLs.
   *
   * Distinct from `pickMediaSrc` which prefers the poster — the two have
   * opposite priorities by design: posters are cheap to render in a grid;
   * the playable URL is required when the user actually wants to play.
   */
  private pickVideoSrc(m: PostData['media'][number]): string | undefined {
    return this.context.resolveMediaUrl(m.url);
  }

  private renderImageElement(
    frame: HTMLElement,
    item: PostData['media'][number],
    src: string,
    lazy: boolean,
  ): void {
    const img = document.createElement('img');
    img.src = src;
    img.alt = item.altText ?? item.alt ?? '';
    if (lazy) img.loading = 'lazy';
    img.classList.add('pcr-media-carousel-img', 'pcr-media-hero-img');
    img.style.width = '100%';
    img.style.height = '100%';
    // `contain` (not `cover`): preserves the media's intrinsic aspect ratio
    // inside the fixed 1:1 wrapper. For portrait (9:16) Reels and landscape
    // (16:9) clips, `cover` would crop ~50% of the visible content — bad for
    // a "preview before importing" surface. The wrapper background fills the
    // letterbox strips so the layout still reads as a uniform tile.
    img.style.objectFit = 'contain';
    img.style.display = 'block';
    frame.appendChild(img);
  }

  private renderVideoElement(
    frame: HTMLElement,
    item: PostData['media'][number],
    src: string,
  ): void {
    const video = document.createElement('video');
    video.classList.add('pcr-media-carousel-video');
    video.setAttribute('controls', 'true');
    // playsinline is required on iOS Safari — without it iOS forces
    // fullscreen playback and breaks the gallery UX.
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.setAttribute('preload', 'metadata');
    const poster =
      this.context.resolveMediaUrl(item.thumbnail) ||
      this.context.resolveMediaUrl(item.thumbnailUrl);
    if (poster) video.setAttribute('poster', poster);
    video.src = src;
    video.style.width = '100%';
    video.style.height = '100%';
    // `contain` (not `cover`): same rationale as the image path — Reels/
    // portrait videos must show their full frame in the import preview, not
    // a center-cropped square. The `#000` background fills the letterbox
    // strips with the conventional video-frame look.
    video.style.objectFit = 'contain';
    video.style.display = 'block';
    video.style.background = '#000';
    // Stop click bubbling so tapping a video control doesn't re-trigger
    // gallery-level handlers (selection, etc.).
    video.addEventListener('click', (e) => e.stopPropagation());
    frame.appendChild(video);
  }

  private renderPlaceholder(frame: HTMLElement): void {
    const placeholder = this.makeDiv(
      frame,
      'pcr-media-carousel-placeholder pcr-media-hero-placeholder',
    );
    placeholder.style.width = '100%';
    placeholder.style.height = '100%';
    placeholder.style.display = 'flex';
    placeholder.style.alignItems = 'center';
    placeholder.style.justifyContent = 'center';
    placeholder.style.color = 'var(--text-muted)';
    placeholder.style.fontSize = 'var(--font-ui-smaller, 0.8rem)';
    const label = document.createElement('span');
    label.textContent = 'Preview loading…';
    placeholder.appendChild(label);
  }

  private styleNavButton(btn: HTMLButtonElement, side: 'left' | 'right'): void {
    btn.style.position = 'absolute';
    btn.style.top = '50%';
    btn.style.transform = 'translateY(-50%)';
    if (side === 'left') {
      btn.style.left = '4px';
    } else {
      btn.style.right = '4px';
    }
    // 44px hit area minimum per iOS HIG / Polish A1 spec.
    btn.style.width = '44px';
    btn.style.height = '44px';
    btn.style.minWidth = '44px';
    btn.style.minHeight = '44px';
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.padding = '0';
    btn.style.border = 'none';
    btn.style.borderRadius = '999px';
    btn.style.background = 'rgba(0, 0, 0, 0.45)';
    btn.style.color = '#fff';
    btn.style.fontSize = '24px';
    btn.style.lineHeight = '1';
    btn.style.cursor = 'pointer';
    btn.style.zIndex = '2';
  }

  // -------------------------------------------------------------------------
  // Inline image gallery (extracted verbatim from
  // PostCardRenderer.createInlineImageGallery — used by blog posts)
  // -------------------------------------------------------------------------

  /**
   * Build an inline image gallery from already-rendered <img>/<video>
   * elements (e.g. parsed out of blog post markdown by
   * `styleBlogInlineImages`). Returns the gallery root element — the caller
   * is responsible for inserting it into the DOM.
   *
   * Behavior is preserved verbatim from the source method so visual diffs
   * are zero. CSS class names (`pcr-gallery*`, `inline-image-gallery`,
   * `gallery-*`) match the source.
   */
  public createInlineImageGallery(mediaItems: HTMLElement[]): HTMLElement {
    const gallery = document.createElement('div');
    gallery.className = 'inline-image-gallery pcr-gallery';

    const count = mediaItems.length;

    // Main display area
    const mainDisplay = document.createElement('div');
    mainDisplay.className = 'gallery-main-display pcr-gallery-main';

    // Create main image container
    const mainImageContainer = document.createElement('div');
    mainImageContainer.className = 'pcr-gallery-main-container';

    const firstMedia = mediaItems[0];
    if (!firstMedia) return gallery;
    const mainMedia = firstMedia.cloneNode(true) as HTMLElement;
    mainMedia.className = 'gallery-image gallery-main-image pcr-gallery-main-image';
    if (mainMedia instanceof HTMLVideoElement) {
      mainMedia.setAttribute('controls', 'true');
      mainMedia.setAttribute('preload', 'metadata');
    }
    mainImageContainer.appendChild(mainMedia);
    mainDisplay.appendChild(mainImageContainer);

    // Add counter badge if more than 1 image
    if (count > 1) {
      const counter = document.createElement('div');
      counter.className = 'gallery-counter pcr-gallery-counter';
      counter.textContent = `1/${count}`;
      mainDisplay.appendChild(counter);

      // Navigation arrows (hover handled by CSS .pcr-gallery-main:hover .pcr-gallery-nav)
      const prevBtn = document.createElement('button');
      prevBtn.className = 'gallery-nav gallery-prev pcr-gallery-nav pcr-gallery-nav-prev';
      prevBtn.textContent = '‹';

      const nextBtn = document.createElement('button');
      nextBtn.className = 'gallery-nav gallery-next pcr-gallery-nav pcr-gallery-nav-next';
      nextBtn.textContent = '›';

      mainDisplay.appendChild(prevBtn);
      mainDisplay.appendChild(nextBtn);

      // Navigation logic
      let currentIndex = 0;
      const updateDisplay = () => {
        const currentMedia = mediaItems[currentIndex];
        if (!currentMedia) return;
        const newImg = currentMedia.cloneNode(true) as HTMLElement;
        newImg.className = 'gallery-image gallery-main-image pcr-gallery-main-image';
        if (newImg instanceof HTMLVideoElement) {
          newImg.setAttribute('controls', 'true');
          newImg.setAttribute('preload', 'metadata');
        }
        this.emptyElement(mainImageContainer);
        mainImageContainer.appendChild(newImg);
        counter.textContent = `${currentIndex + 1}/${count}`;

        if (newImg instanceof HTMLImageElement) {
          newImg.addEventListener('click', (e) => {
            e.stopPropagation();
            const imageUrls = mediaItems
              .filter((item): item is HTMLImageElement => item instanceof HTMLImageElement)
              .map((item) => item.src);
            const imageIndex = imageUrls.indexOf(newImg.src);
            if (imageIndex >= 0) {
              this.openImageLightbox(imageUrls, imageIndex);
            }
          });
        }
      };

      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentIndex = (currentIndex - 1 + count) % count;
        updateDisplay();
      });

      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentIndex = (currentIndex + 1) % count;
        updateDisplay();
      });

      if (mainMedia instanceof HTMLImageElement) {
        mainMedia.addEventListener('click', (e) => {
          e.stopPropagation();
          const imageUrls = mediaItems
            .filter((item): item is HTMLImageElement => item instanceof HTMLImageElement)
            .map((item) => item.src);
          const imageIndex = imageUrls.indexOf(mainMedia.src);
          if (imageIndex >= 0) {
            this.openImageLightbox(imageUrls, imageIndex);
          }
        });
      }
    } else {
      // Single image - just add click handler
      if (mainMedia instanceof HTMLImageElement) {
        mainMedia.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openImageLightbox([mainMedia.src], 0);
        });
      }
    }

    gallery.appendChild(mainDisplay);

    // Thumbnail strip for 3+ images
    if (count >= 3) {
      const thumbnailStrip = document.createElement('div');
      thumbnailStrip.className = 'gallery-thumbnails pcr-gallery-thumbnails';

      mediaItems.forEach((media, index) => {
        const thumb = document.createElement('div');
        thumb.className =
          index === 0
            ? 'pcr-gallery-thumb pcr-gallery-thumb-active'
            : 'pcr-gallery-thumb pcr-gallery-thumb-inactive';

        const thumbImg = media.cloneNode(true) as HTMLElement;
        thumbImg.className = 'gallery-image pcr-gallery-thumb-img';
        if (thumbImg instanceof HTMLVideoElement) {
          thumbImg.removeAttribute('controls');
          thumbImg.muted = true;
          thumbImg.preload = 'metadata';
        }
        thumb.appendChild(thumbImg);

        thumb.addEventListener('click', (e) => {
          e.stopPropagation();
          // Update main display
          const clickedImage = mediaItems[index];
          if (!clickedImage) return;
          const newImg = clickedImage.cloneNode(true) as HTMLElement;
          newImg.className = 'gallery-image gallery-main-image pcr-gallery-main-image';
          if (newImg instanceof HTMLVideoElement) {
            newImg.setAttribute('controls', 'true');
            newImg.setAttribute('preload', 'metadata');
          }
          this.emptyElement(mainImageContainer);
          mainImageContainer.appendChild(newImg);

          // Update counter
          const counterEl = mainDisplay.querySelector('.gallery-counter');
          if (counterEl) counterEl.textContent = `${index + 1}/${count}`;

          if (newImg instanceof HTMLImageElement) {
            newImg.addEventListener('click', (event) => {
              event.stopPropagation();
              const imageUrls = mediaItems
                .filter((item): item is HTMLImageElement => item instanceof HTMLImageElement)
                .map((item) => item.src);
              const imageIndex = imageUrls.indexOf(newImg.src);
              if (imageIndex >= 0) {
                this.openImageLightbox(imageUrls, imageIndex);
              }
            });
          }

          // Update thumbnail styles
          thumbnailStrip.querySelectorAll('div').forEach((t, i) => {
            const thumbEl = t as HTMLElement;
            thumbEl.classList.remove(
              'pcr-gallery-thumb-active',
              'pcr-gallery-thumb-inactive',
            );
            thumbEl.classList.add(
              i === index ? 'pcr-gallery-thumb-active' : 'pcr-gallery-thumb-inactive',
            );
          });
        });

        thumbnailStrip.appendChild(thumb);
      });

      gallery.appendChild(thumbnailStrip);
    }

    return gallery;
  }

  // -------------------------------------------------------------------------
  // Lightbox
  // -------------------------------------------------------------------------

  /**
   * Open a fullscreen lightbox for the given image URLs starting at
   * `startIndex`. Implementation is verbatim from
   * `PostCardRenderer.openImageLightbox` so visual / keyboard behavior is
   * unchanged. CSS class names match the source (`pcr-lightbox-*`).
   *
   * If `imageSrcs` is empty, the call is a no-op (caller invariant).
   */
  public openImageLightbox(imageSrcs: string[], startIndex: number): void {
    if (imageSrcs.length === 0) return;

    const overlay = document.createElement('div');
    overlay.className = 'image-lightbox-overlay pcr-lightbox-overlay';

    let currentIndex = startIndex;
    const count = imageSrcs.length;

    const imgContainer = document.createElement('div');
    imgContainer.className = 'pcr-lightbox-container';

    const img = document.createElement('img');
    img.src = imageSrcs[currentIndex] ?? '';
    img.className = 'pcr-lightbox-image';
    imgContainer.appendChild(img);

    let counter: HTMLDivElement | null = null;
    if (count > 1) {
      counter = document.createElement('div');
      counter.className = 'pcr-lightbox-counter';
      counter.textContent = `${currentIndex + 1} / ${count}`;
      imgContainer.appendChild(counter);

      // Navigation
      const prevBtn = document.createElement('button');
      prevBtn.textContent = '‹';
      prevBtn.className = 'pcr-lightbox-nav pcr-lightbox-prev';

      const nextBtn = document.createElement('button');
      nextBtn.textContent = '›';
      nextBtn.className = 'pcr-lightbox-nav pcr-lightbox-next';

      const updateLightbox = () => {
        img.src = imageSrcs[currentIndex] ?? '';
        if (counter) counter.textContent = `${currentIndex + 1} / ${count}`;
      };

      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentIndex = (currentIndex - 1 + count) % count;
        updateLightbox();
      });

      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentIndex = (currentIndex + 1) % count;
        updateLightbox();
      });

      overlay.appendChild(prevBtn);
      overlay.appendChild(nextBtn);
    }

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.className = 'pcr-lightbox-close';
    closeBtn.addEventListener('click', () => overlay.remove());

    overlay.appendChild(imgContainer);
    overlay.appendChild(closeBtn);

    // Close on background click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // Keyboard: Escape closes, Arrow keys cycle.
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', handleKeydown);
      } else if (e.key === 'ArrowLeft' && count > 1) {
        currentIndex = (currentIndex - 1 + count) % count;
        img.src = imageSrcs[currentIndex] ?? '';
        if (counter) counter.textContent = `${currentIndex + 1} / ${count}`;
      } else if (e.key === 'ArrowRight' && count > 1) {
        currentIndex = (currentIndex + 1) % count;
        img.src = imageSrcs[currentIndex] ?? '';
        if (counter) counter.textContent = `${currentIndex + 1} / ${count}`;
      }
    };
    document.addEventListener('keydown', handleKeydown);

    document.body.appendChild(overlay);
  }

  // -------------------------------------------------------------------------
  // Local video element factory
  // -------------------------------------------------------------------------

  /**
   * Render a local <video> element with the same default attributes as
   * the source `PostCardRenderer.renderLocalVideo`. The `src` MUST be a
   * URL ready for the browser (vault adapter resource path, blob:, network
   * URL, data:, etc.) — caller is responsible for the resolution.
   *
   * Returns the created <video> element (not the wrapper) so the caller
   * can attach error / loadedmetadata listeners or wire it into a
   * controller. The wrapper div carries the `pcr-video-container` class
   * exactly like the source.
   */
  public renderLocalVideo(parent: HTMLElement, src: string): HTMLVideoElement {
    const wrapper = this.makeDiv(parent, 'local-video-container pcr-video-container');
    const video = document.createElement('video');
    video.classList.add('pcr-video-element');
    // PRD requires playsinline for iOS Safari compat — without this iOS
    // forces fullscreen playback which breaks the timeline UX.
    video.setAttribute('controls', 'true');
    video.setAttribute('preload', 'metadata');
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.src = src;
    wrapper.appendChild(video);
    return video;
  }

  /**
   * Helper that returns the same <video> element as `renderLocalVideo`.
   * Kept as a separate entry point for parity with the source method
   * `renderLocalVideoWithRef` — gives the caller a direct ref without
   * requiring a follow-up `querySelector`.
   *
   * The optional `opts.attrs` lets callers override the default attribute
   * set (e.g. omit `controls` for an autoplay loop). When omitted, the
   * defaults match `renderLocalVideo` exactly.
   */
  public renderLocalVideoWithRef(
    parent: HTMLElement,
    src: string,
    opts?: RenderLocalVideoOpts,
  ): HTMLVideoElement {
    if (!opts?.attrs) {
      return this.renderLocalVideo(parent, src);
    }
    const wrapper = this.makeDiv(parent, 'local-video-container pcr-video-container');
    const video = document.createElement('video');
    video.classList.add('pcr-video-element');
    for (const [k, v] of Object.entries(opts.attrs)) {
      video.setAttribute(k, v);
    }
    // playsinline is non-negotiable per PRD § iOS Safari compat — even when
    // the caller supplies a custom attribute set, we re-assert these so
    // overriding `controls` / `preload` doesn't accidentally break iOS.
    if (!opts.attrs['playsinline']) {
      video.setAttribute('playsinline', 'true');
    }
    if (!opts.attrs['webkit-playsinline']) {
      video.setAttribute('webkit-playsinline', 'true');
    }
    video.src = src;
    wrapper.appendChild(video);
    return video;
  }

  // -------------------------------------------------------------------------
  // Embed path helpers (pure — moved verbatim from PostCardRenderer)
  // -------------------------------------------------------------------------

  /**
   * Extract local video embed paths from a markdown string. Recognises:
   *   - Obsidian wiki embeds: `![[path/to/video.mp4]]`
   *   - Markdown image/links: `![alt](path/to/video.mp4)` or `[alt](...)`
   *
   * Returns deduplicated paths, in source order. Pure / static — no `this`
   * dependencies, safe to call without instantiating the renderer.
   */
  public static extractLocalVideoEmbedPaths(content: string): string[] {
    const paths: string[] = [];

    // Obsidian wiki embeds: ![[path/to/video.mp4]] or ![[path/to/video.mp4|alias]]
    const wikiEmbedRegex = /!\[\[([^\]]+\.(mp4|webm|mov|avi|mkv|m4v)(?:\|[^\]]*)?)\]\]/gi;
    let wikiMatch;
    while ((wikiMatch = wikiEmbedRegex.exec(content)) !== null) {
      const rawPath = wikiMatch[1];
      if (!rawPath) continue;
      const cleanPath = rawPath.split('|')[0]?.trim() || '';
      if (cleanPath) paths.push(cleanPath);
    }

    // Markdown links/images: [title](path/to/video.mp4) or ![title](path/to/video.mp4)
    const markdownEmbedRegex =
      /!?\[[^\]]*?\]\(([^)\s]+?\.(mp4|webm|mov|avi|mkv|m4v))(?:\s+["'][^"']*["'])?\)/gi;
    let markdownMatch;
    while ((markdownMatch = markdownEmbedRegex.exec(content)) !== null) {
      const rawPath = markdownMatch[1];
      if (!rawPath) continue;
      const cleanPath = rawPath.replace(/^<|>$/g, '').trim();
      if (cleanPath) paths.push(cleanPath);
    }

    return Array.from(new Set(paths));
  }

  /**
   * Normalize a local video embed path for vault lookup. Strips wrapping
   * angle brackets / quotes, normalizes path separators, decodes URI
   * escapes, and removes leading `./` / `../` traversal prefixes.
   */
  public static normalizeLocalEmbedPath(path: string): string {
    let normalized = String(path || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^<|>$/g, '')
      .replace(/^["']|["']$/g, '');

    if (!normalized) return '';

    normalized = normalized.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '');

    try {
      const decoded = decodeURIComponent(normalized);
      if (decoded) {
        normalized = decoded;
      }
    } catch {
      // Keep original when decode fails.
    }

    return normalized;
  }

  /**
   * Detect a coarse platform label from a URL — used by the source's video
   * fallback logic to decide whether a YouTube iframe is the right
   * fallback. Pure / static.
   */
  public static detectPlatformFromUrl(url: string): string {
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
    if (url.includes('tiktok.com')) return 'tiktok';
    if (url.includes('vimeo.com')) return 'vimeo';
    if (url.includes('dailymotion.com')) return 'dailymotion';
    if (url.includes('twitter.com') || url.includes('x.com')) return 'x';
    if (url.includes('instagram.com')) return 'instagram';
    return 'video';
  }

  // -------------------------------------------------------------------------
  // Google Maps embed (Leaflet + OpenStreetMap)
  // -------------------------------------------------------------------------

  /**
   * Inject Leaflet CSS. Kept as a no-op for backward compatibility with
   * the source — the actual CSS is bundled in `post-card.css` and does
   * not need runtime injection. Call sites that previously depended on
   * this method continue to work without modification.
   */
  public injectLeafletCss(): void {
    // Leaflet CSS is bundled in post-card.css — no runtime injection needed.
  }

  /**
   * Render a Google Maps embed (interactive Leaflet map + OpenStreetMap
   * tiles + custom marker + info bar). Behavior matches
   * `PostCardRenderer.renderGoogleMapsEmbed` verbatim, including the
   * IntersectionObserver-based lazy initialization.
   *
   * Returns the wrapper element. If the post lacks coordinates, returns
   * a (still-attached) empty wrapper so callers can branch on
   * `wrapper.children.length === 0` if they need to.
   *
   * If Leaflet fails to initialize (e.g. test harness without DOM
   * measurements), falls back to a text-only location card and logs to
   * `console.error` — never throws.
   */
  public renderGoogleMapsEmbed(parent: HTMLElement, post: PostData): HTMLElement {
    const wrapper = this.makeDiv(parent, 'sa-map-wrapper pcr-gmaps-map-wrapper');

    const lat = post.metadata.latitude;
    const lng = post.metadata.longitude;

    // Skip if no coordinates available.
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return wrapper;
    }

    // Inject CSS once (no-op kept for symmetry with source).
    this.injectLeafletCss();

    const mapContainer = this.makeDiv(wrapper, 'pcr-gmaps-map-container');

    // Touch overlay — intercepts touch events so Leaflet doesn't capture
    // scroll. Click on overlay opens Google Maps in a new tab.
    const touchOverlay = this.makeDiv(wrapper, 'pcr-gmaps-map-touch-overlay');
    touchOverlay.addEventListener('click', () => {
      window.open(post.url || `https://www.google.com/maps?q=${lat},${lng}`, '_blank');
    });

    let mapInitialized = false;

    const initializeMap = () => {
      if (mapInitialized) return;
      mapInitialized = true;

      try {
        const map = L.map(mapContainer, {
          center: [lat, lng],
          zoom: 15,
          zoomControl: !L.Browser.mobile,
          scrollWheelZoom: false,
          attributionControl: false,
          // Completely disable touch/mouse interactions to prevent jitter.
          dragging: false,
          touchZoom: false,
          doubleClickZoom: false,
          boxZoom: false,
          keyboard: false,
          // `tap` is a valid Leaflet option but missing from @types/leaflet.
          tap: false,
        } as L.MapOptions);

        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
        }).addTo(map);

        // Custom attribution — top-left corner, low z-index.
        const attr = document.createElement('div');
        attr.classList.add('pcr-gmaps-map-attr');
        attr.textContent = '© ';
        const link = document.createElement('a');
        link.textContent = 'OSM';
        link.href = 'https://www.openstreetmap.org/copyright';
        link.target = '_blank';
        attr.appendChild(link);
        wrapper.appendChild(attr);

        // Custom marker via div icon.
        const markerIcon = L.divIcon({
          className: 'sa-map-marker',
          html:
            '<div style="font-size: 28px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">📍</div>',
          iconSize: [30, 40],
          iconAnchor: [15, 40],
        });

        L.marker([lat, lng], { icon: markerIcon }).addTo(map);

        // Fix tile loading after container measurement settles.
        window.setTimeout(() => {
          map.invalidateSize();
        }, 100);
      } catch (err) {
        console.error('[PreviewableMediaRenderer] Failed to initialize Leaflet map:', err);
        // Fallback: text-only location card.
        mapContainer.classList.add('pcr-map-fallback-text');
        mapContainer.textContent = `📍 ${post.metadata.location || `${lat}, ${lng}`}`;
      }
    };

    // Lazy-load the map when it scrolls into view. IntersectionObserver
    // is widely supported but may not exist in degraded test envs — guard.
    if (typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && !mapInitialized) {
              initializeMap();
              observer.disconnect();
            }
          });
        },
        {
          rootMargin: '100px',
          threshold: 0.1,
        },
      );
      observer.observe(mapContainer);
    } else {
      // No IO — initialize eagerly (acceptable in non-grid contexts).
      initializeMap();
    }

    // Location info bar.
    const linkContainer = this.makeDiv(wrapper, 'pcr-map-link-container');

    if (post.metadata.location) {
      const locationText = document.createElement('span');
      locationText.textContent = post.metadata.location;
      locationText.classList.add('pcr-map-location-text');
      linkContainer.appendChild(locationText);
    }

    const linksDiv = this.makeDiv(linkContainer, 'pcr-map-links');

    // Directions link.
    const directionsUrl = this.buildGoogleMapsDirectionsUrl(
      lat,
      lng,
      post.metadata.location,
      post.author.name,
    );
    const directionsLink = document.createElement('a');
    directionsLink.textContent = 'Directions';
    directionsLink.classList.add('pcr-map-link');
    directionsLink.href = directionsUrl;
    directionsLink.target = '_blank';
    directionsLink.addEventListener('click', (e) => e.stopPropagation());
    linksDiv.appendChild(directionsLink);

    // Google Maps link.
    const gmapLink = document.createElement('a');
    gmapLink.textContent = 'Open in maps';
    gmapLink.classList.add('pcr-map-link');
    gmapLink.href = post.url || `https://www.google.com/maps?q=${lat},${lng}`;
    gmapLink.target = '_blank';
    gmapLink.addEventListener('click', (e) => e.stopPropagation());
    linksDiv.appendChild(gmapLink);

    return wrapper;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private buildGoogleMapsDirectionsUrl(
    lat?: number,
    lng?: number,
    address?: string,
    placeName?: string,
  ): string {
    if (typeof lat === 'number' && typeof lng === 'number') {
      const destination = encodeURIComponent(`${lat},${lng}`);
      return `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
    }
    if (address) {
      return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
    }
    if (placeName) {
      return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(placeName)}`;
    }
    return 'https://www.google.com/maps';
  }

  /**
   * Pick the best src for a hero image / video poster. For videos, prefer
   * the thumbnail (poster image) over the video URL — much cheaper to
   * render in a card grid. Falls through resolver rejections silently.
   */
  private pickMediaSrc(m: PostData['media'][number]): string | undefined {
    return (
      this.context.resolveMediaUrl(m.thumbnail) ||
      this.context.resolveMediaUrl(m.thumbnailUrl) ||
      this.context.resolveMediaUrl(m.url)
    );
  }

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

  /**
   * DOM helper — replicates Obsidian's `HTMLElement.empty()` enrichment
   * which is missing from JSDOM. Removes all child nodes.
   */
  private emptyElement(el: HTMLElement): void {
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }
}
