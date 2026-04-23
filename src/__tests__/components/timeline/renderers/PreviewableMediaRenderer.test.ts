/**
 * Tests for PreviewableMediaRenderer — the visual-chrome renderer for the
 * media area of a post card.
 *
 * Polish A1 (Instagram Import Review Gallery): the legacy single-hero +
 * "+N" badge was replaced with a real multi-image carousel and inline
 * video playback. Coverage focus:
 *
 *   - `renderHeroImage` — single image (bare hero, no chrome), multi-image
 *     carousel (nav buttons, dots, counter, keyboard arrows, swipe with
 *     pause-on-leave for videos), unresolved-URL placeholder, and the
 *     empty-media wrapper return.
 *   - `renderLocalVideo` — preserves PRD-mandated iOS Safari attributes
 *     (`playsinline` + `webkit-playsinline`).
 *   - Pure helpers (`extractLocalVideoEmbedPaths`, `normalizeLocalEmbedPath`,
 *     `detectPlatformFromUrl`) ported verbatim from PostCardRenderer.
 *   - `injectLeafletCss` is a no-op (matches source behavior).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PreviewableMediaRenderer,
  type PreviewContext,
} from '@/components/timeline/renderers/PreviewableMediaRenderer';
import type { PostData } from '@/types/post';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeContainer(): HTMLElement {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return div;
}

function basePost(overrides: Partial<PostData> = {}): PostData {
  return {
    platform: 'instagram',
    id: 'post-1',
    url: 'https://instagram.com/p/abc',
    author: {
      name: 'Jane Doe',
      url: 'https://instagram.com/janedoe',
      handle: 'janedoe',
    },
    content: { text: 'Hello world' },
    media: [],
    metadata: { timestamp: new Date('2026-04-01T12:00:00Z') },
    ...overrides,
  };
}

// Identity resolver: pass URLs straight through (good for fixture URLs).
const identityResolver = (raw: string | undefined | null): string | undefined =>
  raw ?? undefined;

const baseContext: PreviewContext = { resolveMediaUrl: identityResolver };

// ---------------------------------------------------------------------------
// renderHeroImage — single-item path
// ---------------------------------------------------------------------------

describe('PreviewableMediaRenderer.renderHeroImage — single item', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = makeContainer();
  });

  it('renders a single hero image with NO carousel chrome (no nav, no dots, no counter)', () => {
    const renderer = new PreviewableMediaRenderer(baseContext);
    renderer.renderHeroImage(
      container,
      basePost({
        media: [{ type: 'image', url: 'https://example.com/photo.jpg' }],
      }),
    );

    const wrapper = container.querySelector('.pcr-media-hero');
    expect(wrapper).toBeTruthy();

    // Single image rendered, no carousel chrome.
    const img = wrapper?.querySelector('img.pcr-media-hero-img') as HTMLImageElement | null;
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toBe('https://example.com/photo.jpg');

    expect(wrapper?.querySelector('.pcr-media-carousel-nav')).toBeNull();
    expect(wrapper?.querySelector('.pcr-media-carousel-dots')).toBeNull();
    expect(wrapper?.querySelector('.pcr-media-carousel-counter')).toBeNull();
    expect(wrapper?.classList.contains('pcr-media-carousel')).toBe(false);
  });

  it('renders an empty wrapper (no img, no chrome) when the post has no media', () => {
    const renderer = new PreviewableMediaRenderer(baseContext);
    renderer.renderHeroImage(container, basePost({ media: [] }));

    const wrapper = container.querySelector('.pcr-media-hero');
    expect(wrapper).toBeTruthy();
    expect(wrapper?.querySelector('img')).toBeNull();
    expect(wrapper?.querySelector('video')).toBeNull();
    expect(wrapper?.querySelector('.pcr-media-carousel-counter')).toBeNull();
  });

  it('renders a "Preview loading…" placeholder when resolveMediaUrl returns undefined', () => {
    // Simulates ImportGalleryContainer's resolver before the
    // IntersectionObserver has materialized blob bytes for a ZIP-relative
    // path.
    const renderer = new PreviewableMediaRenderer({
      resolveMediaUrl: () => undefined,
    });
    renderer.renderHeroImage(
      container,
      basePost({ media: [{ type: 'image', url: 'media/photo.jpg' }] }),
    );

    expect(container.querySelector('img')).toBeNull();
    const placeholder = container.querySelector('.pcr-media-carousel-placeholder');
    expect(placeholder).toBeTruthy();
    expect(placeholder?.textContent).toContain('Preview loading');
  });

  it('returns the wrapper element so callers can layer overlays', () => {
    const renderer = new PreviewableMediaRenderer(baseContext);
    const wrapper = renderer.renderHeroImage(
      container,
      basePost({ media: [{ type: 'image', url: 'https://example.com/photo.jpg' }] }),
    );

    expect(wrapper).toBeInstanceOf(HTMLElement);
    expect(wrapper.classList.contains('pcr-media-hero')).toBe(true);
    expect(wrapper.parentElement).toBe(container);
  });

  it('renders a video frame as <video controls playsinline> when it is the current item', () => {
    const renderer = new PreviewableMediaRenderer(baseContext);
    renderer.renderHeroImage(
      container,
      basePost({
        media: [
          {
            type: 'video',
            url: 'https://example.com/video.mp4',
            thumbnail: 'https://example.com/poster.jpg',
          },
        ],
      }),
    );

    const video = container.querySelector('video.pcr-media-carousel-video') as
      | HTMLVideoElement
      | null;
    expect(video).toBeTruthy();
    expect(video?.getAttribute('controls')).toBe('true');
    expect(video?.getAttribute('playsinline')).toBe('true');
    expect(video?.getAttribute('webkit-playsinline')).toBe('true');
    expect(video?.getAttribute('preload')).toBe('metadata');
    expect(video?.getAttribute('poster')).toBe('https://example.com/poster.jpg');
    expect(video?.getAttribute('src')).toBe('https://example.com/video.mp4');
  });

  // -- 9:16 / portrait media display fix -------------------------------------
  //
  // The wrapper is locked to aspect-ratio: 1 / 1 (so the gallery grid stays
  // visually uniform). To still show the FULL frame of vertical (9:16 Reels)
  // and horizontal (16:9) media inside that square, the <img>/<video>
  // elements must use `object-fit: contain` (letterbox), not `cover` (crop).
  // The wrapper paints a neutral background behind the letterbox strips so
  // the layout reads as a deliberate frame, not a styling bug.

  it('renders <img> with object-fit: contain so portrait/landscape media is not cropped', () => {
    const renderer = new PreviewableMediaRenderer(baseContext);
    renderer.renderHeroImage(
      container,
      basePost({
        media: [{ type: 'image', url: 'https://example.com/portrait.jpg' }],
      }),
    );

    const img = container.querySelector(
      'img.pcr-media-hero-img',
    ) as HTMLImageElement | null;
    expect(img).toBeTruthy();
    expect(img?.style.objectFit).toBe('contain');
  });

  it('renders <video> with object-fit: contain so 9:16 Reels are not cropped', () => {
    const renderer = new PreviewableMediaRenderer(baseContext);
    renderer.renderHeroImage(
      container,
      basePost({
        media: [
          {
            type: 'video',
            url: 'https://example.com/reel.mp4',
            thumbnail: 'https://example.com/reel-poster.jpg',
          },
        ],
      }),
    );

    const video = container.querySelector(
      'video.pcr-media-carousel-video',
    ) as HTMLVideoElement | null;
    expect(video).toBeTruthy();
    expect(video?.style.objectFit).toBe('contain');
    // Video keeps its #000 backdrop — fills letterbox strips with the
    // conventional video-frame look (kept distinct from the wrapper bg).
    expect(video?.style.background).toContain('rgb(0, 0, 0)');
  });

  it('paints a neutral wrapper background so letterbox strips read as a frame, not a bug', () => {
    const renderer = new PreviewableMediaRenderer(baseContext);
    const wrapper = renderer.renderHeroImage(
      container,
      basePost({
        media: [{ type: 'image', url: 'https://example.com/portrait.jpg' }],
      }),
    );

    // jsdom preserves the inline-style string verbatim — assert on the raw
    // style attribute so we don't depend on jsdom's CSS variable resolution.
    expect(wrapper.style.background || wrapper.getAttribute('style') || '').toContain(
      'var(--background-secondary)',
    );
  });

  it('keeps the neutral wrapper background on the multi-item carousel path too', () => {
    const renderer = new PreviewableMediaRenderer(baseContext);
    const wrapper = renderer.renderHeroImage(
      container,
      basePost({
        media: [
          { type: 'image', url: 'https://example.com/a.jpg' },
          { type: 'image', url: 'https://example.com/b.jpg' },
        ],
      }),
    );

    // Same wrapper element, now upgraded to a carousel — bg must persist
    // because mixed-aspect-ratio media inside a swipeable track has the
    // same letterbox concern as the single-item path.
    expect(wrapper.classList.contains('pcr-media-carousel')).toBe(true);
    expect(wrapper.style.background || wrapper.getAttribute('style') || '').toContain(
      'var(--background-secondary)',
    );
  });
});

// ---------------------------------------------------------------------------
// renderHeroImage — multi-item carousel path
// ---------------------------------------------------------------------------

describe('PreviewableMediaRenderer.renderHeroImage — carousel', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = makeContainer();
  });

  it('renders prev/next buttons, dot row, and "1 / N" counter for a multi-item post', () => {
    const renderer = new PreviewableMediaRenderer(baseContext);
    renderer.renderHeroImage(
      container,
      basePost({
        media: [
          { type: 'image', url: 'https://example.com/a.jpg' },
          { type: 'image', url: 'https://example.com/b.jpg' },
          { type: 'image', url: 'https://example.com/c.jpg' },
        ],
      }),
    );

    const wrapper = container.querySelector('.pcr-media-hero');
    expect(wrapper?.classList.contains('pcr-media-carousel')).toBe(true);
    expect(wrapper?.getAttribute('data-current-index')).toBe('0');

    expect(wrapper?.querySelector('.pcr-media-carousel-nav-prev')).toBeTruthy();
    expect(wrapper?.querySelector('.pcr-media-carousel-nav-next')).toBeTruthy();

    const counter = wrapper?.querySelector('.pcr-media-carousel-counter');
    expect(counter?.textContent).toBe('1 / 3');
    expect(counter?.getAttribute('aria-label')).toBe('3 media items');

    const dots = wrapper?.querySelectorAll('.pcr-media-carousel-dot');
    expect(dots?.length).toBe(3);
    expect(dots?.[0]?.classList.contains('pcr-media-carousel-dot-active')).toBe(true);
    expect(dots?.[1]?.classList.contains('pcr-media-carousel-dot-active')).toBe(false);
    expect(dots?.[2]?.classList.contains('pcr-media-carousel-dot-active')).toBe(false);
  });

  it('advances to frame 2 when the next button is clicked (counter, active dot, visible frame all update)', () => {
    const renderer = new PreviewableMediaRenderer(baseContext);
    renderer.renderHeroImage(
      container,
      basePost({
        media: [
          { type: 'image', url: 'https://example.com/a.jpg' },
          { type: 'image', url: 'https://example.com/b.jpg' },
          { type: 'image', url: 'https://example.com/c.jpg' },
        ],
      }),
    );

    const wrapper = container.querySelector('.pcr-media-hero') as HTMLElement;
    const nextBtn = wrapper.querySelector(
      '.pcr-media-carousel-nav-next',
    ) as HTMLButtonElement;
    nextBtn.click();

    expect(wrapper.getAttribute('data-current-index')).toBe('1');
    expect(wrapper.querySelector('.pcr-media-carousel-counter')?.textContent).toBe('2 / 3');

    const frames = wrapper.querySelectorAll('.pcr-media-carousel-frame');
    expect((frames[0] as HTMLElement).style.display).toBe('none');
    expect((frames[1] as HTMLElement).style.display).toBe('block');
    expect((frames[2] as HTMLElement).style.display).toBe('none');

    const dots = wrapper.querySelectorAll('.pcr-media-carousel-dot');
    expect(dots[0]?.classList.contains('pcr-media-carousel-dot-active')).toBe(false);
    expect(dots[1]?.classList.contains('pcr-media-carousel-dot-active')).toBe(true);
  });

  it('wraps from last → first when next is clicked on the final frame', () => {
    const renderer = new PreviewableMediaRenderer(baseContext);
    renderer.renderHeroImage(
      container,
      basePost({
        media: [
          { type: 'image', url: 'https://example.com/a.jpg' },
          { type: 'image', url: 'https://example.com/b.jpg' },
        ],
      }),
    );

    const wrapper = container.querySelector('.pcr-media-hero') as HTMLElement;
    const nextBtn = wrapper.querySelector(
      '.pcr-media-carousel-nav-next',
    ) as HTMLButtonElement;
    nextBtn.click(); // 0 -> 1
    nextBtn.click(); // 1 -> 0 (wrap)

    expect(wrapper.getAttribute('data-current-index')).toBe('0');
    expect(wrapper.querySelector('.pcr-media-carousel-counter')?.textContent).toBe('1 / 2');
  });

  it('wraps from first → last when prev is clicked on frame 0', () => {
    const renderer = new PreviewableMediaRenderer(baseContext);
    renderer.renderHeroImage(
      container,
      basePost({
        media: [
          { type: 'image', url: 'https://example.com/a.jpg' },
          { type: 'image', url: 'https://example.com/b.jpg' },
          { type: 'image', url: 'https://example.com/c.jpg' },
        ],
      }),
    );

    const wrapper = container.querySelector('.pcr-media-hero') as HTMLElement;
    const prevBtn = wrapper.querySelector(
      '.pcr-media-carousel-nav-prev',
    ) as HTMLButtonElement;
    prevBtn.click(); // 0 -> 2 (wrap)

    expect(wrapper.getAttribute('data-current-index')).toBe('2');
    expect(wrapper.querySelector('.pcr-media-carousel-counter')?.textContent).toBe('3 / 3');
  });

  it('renders the current video frame as <video> and other video frames as cheap <img> posters', () => {
    const renderer = new PreviewableMediaRenderer(baseContext);
    renderer.renderHeroImage(
      container,
      basePost({
        media: [
          {
            type: 'video',
            url: 'https://example.com/v1.mp4',
            thumbnail: 'https://example.com/p1.jpg',
          },
          {
            type: 'video',
            url: 'https://example.com/v2.mp4',
            thumbnail: 'https://example.com/p2.jpg',
          },
        ],
      }),
    );

    const wrapper = container.querySelector('.pcr-media-hero') as HTMLElement;
    const frames = wrapper.querySelectorAll('.pcr-media-carousel-frame');

    // Frame 0 is current → real <video>.
    const frame0Video = frames[0]?.querySelector('video') as HTMLVideoElement | null;
    expect(frame0Video).toBeTruthy();
    expect(frame0Video?.getAttribute('controls')).toBe('true');
    expect(frame0Video?.getAttribute('playsinline')).toBe('true');

    // Frame 1 is NOT current → cheap <img> poster only.
    const frame1Video = frames[1]?.querySelector('video');
    const frame1Img = frames[1]?.querySelector('img');
    expect(frame1Video).toBeNull();
    expect(frame1Img).toBeTruthy();
    expect(frame1Img?.getAttribute('src')).toBe('https://example.com/p2.jpg');
  });

  it('upgrades the next video frame to <video> on navigation, and pauses the previous video', () => {
    // jsdom does not implement HTMLMediaElement.pause() — install a spy.
    const pauseSpy = vi.fn();
    const originalPause = (HTMLVideoElement.prototype as { pause?: unknown }).pause;
    (HTMLVideoElement.prototype as { pause: () => void }).pause = pauseSpy;

    try {
      const renderer = new PreviewableMediaRenderer(baseContext);
      renderer.renderHeroImage(
        container,
        basePost({
          media: [
            {
              type: 'video',
              url: 'https://example.com/v1.mp4',
              thumbnail: 'https://example.com/p1.jpg',
            },
            {
              type: 'video',
              url: 'https://example.com/v2.mp4',
              thumbnail: 'https://example.com/p2.jpg',
            },
          ],
        }),
      );

      const wrapper = container.querySelector('.pcr-media-hero') as HTMLElement;
      const nextBtn = wrapper.querySelector(
        '.pcr-media-carousel-nav-next',
      ) as HTMLButtonElement;
      nextBtn.click();

      expect(pauseSpy).toHaveBeenCalledTimes(1);

      // Frame 1 should now have a <video>.
      const frames = wrapper.querySelectorAll('.pcr-media-carousel-frame');
      const frame1Video = frames[1]?.querySelector('video') as HTMLVideoElement | null;
      expect(frame1Video).toBeTruthy();
      expect(frame1Video?.getAttribute('src')).toBe('https://example.com/v2.mp4');
    } finally {
      if (originalPause === undefined) {
        delete (HTMLVideoElement.prototype as { pause?: unknown }).pause;
      } else {
        (HTMLVideoElement.prototype as { pause: unknown }).pause = originalPause;
      }
    }
  });

  it('shows a "Preview loading…" placeholder for individual frames whose URL has not resolved yet', () => {
    // Resolver only knows about the second URL — first frame has no src yet.
    const partialResolver: PreviewContext = {
      resolveMediaUrl: (raw) => (raw === 'https://example.com/b.jpg' ? raw : undefined),
    };
    const renderer = new PreviewableMediaRenderer(partialResolver);
    renderer.renderHeroImage(
      container,
      basePost({
        media: [
          { type: 'image', url: 'media/a.jpg' },
          { type: 'image', url: 'https://example.com/b.jpg' },
        ],
      }),
    );

    const frames = container.querySelectorAll('.pcr-media-carousel-frame');
    expect(
      frames[0]?.querySelector('.pcr-media-carousel-placeholder'),
    ).toBeTruthy();
    expect(frames[0]?.querySelector('img')).toBeNull();
    expect(frames[1]?.querySelector('img')).toBeTruthy();
  });

  it('responds to ArrowRight / ArrowLeft keys when the carousel has focus', () => {
    const renderer = new PreviewableMediaRenderer(baseContext);
    renderer.renderHeroImage(
      container,
      basePost({
        media: [
          { type: 'image', url: 'https://example.com/a.jpg' },
          { type: 'image', url: 'https://example.com/b.jpg' },
          { type: 'image', url: 'https://example.com/c.jpg' },
        ],
      }),
    );

    const wrapper = container.querySelector('.pcr-media-hero') as HTMLElement;
    expect(wrapper.getAttribute('tabindex')).toBe('0');

    wrapper.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(wrapper.getAttribute('data-current-index')).toBe('1');

    wrapper.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(wrapper.getAttribute('data-current-index')).toBe('2');

    wrapper.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(wrapper.getAttribute('data-current-index')).toBe('1');
  });

  it('falls back to thumbnailUrl (legacy field) when thumbnail is missing for a video poster', () => {
    const renderer = new PreviewableMediaRenderer(baseContext);
    renderer.renderHeroImage(
      container,
      basePost({
        media: [
          {
            type: 'video',
            url: 'https://example.com/v.mp4',
            thumbnailUrl: 'https://example.com/legacy-poster.jpg',
          },
        ],
      }),
    );

    const video = container.querySelector('video.pcr-media-carousel-video') as
      | HTMLVideoElement
      | null;
    expect(video?.getAttribute('poster')).toBe('https://example.com/legacy-poster.jpg');
  });
});

// ---------------------------------------------------------------------------
// renderLocalVideo
// ---------------------------------------------------------------------------

describe('PreviewableMediaRenderer.renderLocalVideo', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = makeContainer();
  });

  it('emits <video> with playsinline + webkit-playsinline (PRD iOS Safari requirement)', () => {
    const renderer = new PreviewableMediaRenderer(baseContext);
    const video = renderer.renderLocalVideo(
      container,
      'app://local/attachments/video.mp4',
    );

    expect(video).toBeInstanceOf(HTMLVideoElement);
    expect(video.getAttribute('playsinline')).toBe('true');
    expect(video.getAttribute('webkit-playsinline')).toBe('true');
    expect(video.getAttribute('controls')).toBe('true');
    expect(video.getAttribute('preload')).toBe('metadata');
    expect(video.src).toContain('video.mp4');
  });

  it('wraps the <video> in `.pcr-video-container` (matches PostCardRenderer source)', () => {
    const renderer = new PreviewableMediaRenderer(baseContext);
    renderer.renderLocalVideo(container, 'https://example.com/clip.mp4');

    const wrapper = container.querySelector('.pcr-video-container');
    expect(wrapper).toBeTruthy();
    expect(wrapper?.classList.contains('local-video-container')).toBe(true);
    expect(wrapper?.querySelector('video.pcr-video-element')).toBeTruthy();
  });

  it('renderLocalVideoWithRef returns the video element with iOS attrs even when caller supplies custom attrs', () => {
    const renderer = new PreviewableMediaRenderer(baseContext);
    const video = renderer.renderLocalVideoWithRef(
      container,
      'https://example.com/clip.mp4',
      { attrs: { autoplay: 'true', loop: 'true', muted: 'true' } },
    );

    expect(video).toBeInstanceOf(HTMLVideoElement);
    // Custom attrs honored.
    expect(video.getAttribute('autoplay')).toBe('true');
    expect(video.getAttribute('loop')).toBe('true');
    // iOS attrs re-asserted as a safety net (PRD mandate).
    expect(video.getAttribute('playsinline')).toBe('true');
    expect(video.getAttribute('webkit-playsinline')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// Pure helpers (static — extracted verbatim from PostCardRenderer)
// ---------------------------------------------------------------------------

describe('PreviewableMediaRenderer.extractLocalVideoEmbedPaths', () => {
  it('extracts paths from Obsidian wiki embeds', () => {
    const md = 'Intro text\n\n![[attachments/social-archives/youtube/video.mp4]]\n\nMore text';
    const paths = PreviewableMediaRenderer.extractLocalVideoEmbedPaths(md);
    expect(paths).toEqual(['attachments/social-archives/youtube/video.mp4']);
  });

  it('strips the alias from `![[path|alias]]` wiki embeds', () => {
    const md = '![[attachments/clip.mp4|My Clip]]';
    const paths = PreviewableMediaRenderer.extractLocalVideoEmbedPaths(md);
    expect(paths).toEqual(['attachments/clip.mp4']);
  });

  it('extracts paths from markdown image / link syntax', () => {
    const md = 'Look: ![alt](attachments/sample.webm) and [link](videos/talk.mov)';
    const paths = PreviewableMediaRenderer.extractLocalVideoEmbedPaths(md);
    expect(paths).toContain('attachments/sample.webm');
    expect(paths).toContain('videos/talk.mov');
  });

  it('deduplicates repeated paths, preserving source order', () => {
    const md = '![[a.mp4]]\n\n![alt](a.mp4)\n\n![[b.mp4]]';
    const paths = PreviewableMediaRenderer.extractLocalVideoEmbedPaths(md);
    expect(paths).toEqual(['a.mp4', 'b.mp4']);
  });

  it('returns an empty array when there are no video embeds', () => {
    const md = 'Plain text with ![[image.png]] and [link](page.md)';
    const paths = PreviewableMediaRenderer.extractLocalVideoEmbedPaths(md);
    expect(paths).toEqual([]);
  });
});

describe('PreviewableMediaRenderer.normalizeLocalEmbedPath', () => {
  it('strips leading `./` prefix', () => {
    expect(PreviewableMediaRenderer.normalizeLocalEmbedPath('./attachments/clip.mp4')).toBe(
      'attachments/clip.mp4',
    );
  });

  it('strips one or more leading `../` prefixes', () => {
    expect(PreviewableMediaRenderer.normalizeLocalEmbedPath('../../foo/bar.mp4')).toBe(
      'foo/bar.mp4',
    );
  });

  it('normalizes backslashes to forward slashes', () => {
    expect(PreviewableMediaRenderer.normalizeLocalEmbedPath('attachments\\clip.mp4')).toBe(
      'attachments/clip.mp4',
    );
  });

  it('strips wrapping angle brackets and quotes', () => {
    expect(PreviewableMediaRenderer.normalizeLocalEmbedPath('<attachments/clip.mp4>')).toBe(
      'attachments/clip.mp4',
    );
    expect(PreviewableMediaRenderer.normalizeLocalEmbedPath('"attachments/clip.mp4"')).toBe(
      'attachments/clip.mp4',
    );
  });

  it('decodes percent-encoded paths', () => {
    expect(
      PreviewableMediaRenderer.normalizeLocalEmbedPath('attachments/My%20Clip.mp4'),
    ).toBe('attachments/My Clip.mp4');
  });

  it('returns empty string for empty/whitespace input', () => {
    expect(PreviewableMediaRenderer.normalizeLocalEmbedPath('')).toBe('');
    expect(PreviewableMediaRenderer.normalizeLocalEmbedPath('   ')).toBe('');
  });
});

describe('PreviewableMediaRenderer.detectPlatformFromUrl', () => {
  it('identifies youtube and youtu.be URLs', () => {
    expect(PreviewableMediaRenderer.detectPlatformFromUrl('https://youtube.com/watch?v=abc')).toBe(
      'youtube',
    );
    expect(PreviewableMediaRenderer.detectPlatformFromUrl('https://youtu.be/abc')).toBe('youtube');
  });

  it('identifies tiktok / vimeo / dailymotion / x / instagram', () => {
    expect(PreviewableMediaRenderer.detectPlatformFromUrl('https://tiktok.com/@a')).toBe('tiktok');
    expect(PreviewableMediaRenderer.detectPlatformFromUrl('https://vimeo.com/1')).toBe('vimeo');
    expect(PreviewableMediaRenderer.detectPlatformFromUrl('https://dailymotion.com/x')).toBe(
      'dailymotion',
    );
    expect(PreviewableMediaRenderer.detectPlatformFromUrl('https://twitter.com/x/status/1')).toBe(
      'x',
    );
    expect(PreviewableMediaRenderer.detectPlatformFromUrl('https://x.com/x/status/1')).toBe('x');
    expect(PreviewableMediaRenderer.detectPlatformFromUrl('https://instagram.com/p/abc')).toBe(
      'instagram',
    );
  });

  it('returns "video" for unknown URLs', () => {
    expect(PreviewableMediaRenderer.detectPlatformFromUrl('https://unknown.example/v.mp4')).toBe(
      'video',
    );
  });
});

// ---------------------------------------------------------------------------
// injectLeafletCss is a backward-compat no-op
// ---------------------------------------------------------------------------

describe('PreviewableMediaRenderer.injectLeafletCss', () => {
  it('is a no-op (CSS is bundled in post-card.css)', () => {
    const renderer = new PreviewableMediaRenderer(baseContext);
    // Should neither throw nor mutate the document head.
    const headBefore = document.head.innerHTML;
    renderer.injectLeafletCss();
    expect(document.head.innerHTML).toBe(headBefore);
  });
});
