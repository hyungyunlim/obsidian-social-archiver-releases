/**
 * Tests for PreviewableCardRenderer — the visual-chrome orchestrator that
 * composes the 4 Round-2 sub-renderers (header / content / media /
 * interactions) for any preview surface (Instagram Import Review Gallery,
 * future X / Bluesky bookmarks gallery, vault timeline via PostCardRenderer).
 *
 * Round 3 of the PostCardRenderer extraction. The previous "parallel
 * implementation" of this file inlined header / caption / media / interactions
 * markup directly. The orchestrator now delegates to sub-renderers, so the
 * emitted DOM uses sub-renderer class names (`.pcr-header`, `.pcr-content`,
 * `.pcr-media-hero`, `.pcr-interactions`) rather than the previous
 * `.pcr-preview-*` aliases. Tests updated accordingly while preserving the
 * coverage focus:
 *
 *   - Pure visual output (no vault dependencies wired in)
 *   - Graceful degradation when optional `PreviewContext` fields are absent
 *   - Same CSS class names as `PostCardRenderer` (WYSIWYG contract per PRD §0)
 *   - Media slot states: hero image, video poster, multi-item +N badge,
 *     unresolved-url placeholder, text-only placeholder
 *   - Caption: plain-text fallback when no `app`/`component`, truncation
 *   - Interaction counts hidden when all metadata values are zero/missing
 *   - Composition: each sub-renderer gets the SAME context instance
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PreviewableCardRenderer,
  type PreviewContext,
} from '@/components/timeline/renderers/PreviewableCardRenderer';
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
  } as PostData;
}

// Identity resolver: pass URLs straight through (good for fixture URLs).
const identityResolver = (raw: string | undefined | null): string | undefined => raw ?? undefined;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PreviewableCardRenderer', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = makeContainer();
  });

  // -------------------------------------------------------------------------
  // Basic rendering
  // -------------------------------------------------------------------------

  it('renders the outer card with the same CSS classes as PostCardRenderer (WYSIWYG)', async () => {
    const renderer = new PreviewableCardRenderer({ resolveMediaUrl: identityResolver });
    const card = await renderer.render(container, basePost());

    expect(card.classList.contains('pcr-card')).toBe(true);
    // Header / content classes match the vault timeline so the existing
    // post-card.css applies unchanged.
    expect(container.querySelector('.pcr-header')).toBeTruthy();
    expect(container.querySelector('.post-content-area')).toBeTruthy();
  });

  it('renders the author name in the header (delegated to PreviewableHeaderRenderer)', async () => {
    const renderer = new PreviewableCardRenderer({ resolveMediaUrl: identityResolver });
    await renderer.render(container, basePost());

    const author = container.querySelector('.pcr-author-name');
    expect(author?.textContent).toBe('Jane Doe');
  });

  // -------------------------------------------------------------------------
  // Media URL resolution (delegated to PreviewableMediaRenderer)
  // -------------------------------------------------------------------------

  it('renders the hero image when resolveMediaUrl returns a URL', async () => {
    const renderer = new PreviewableCardRenderer({ resolveMediaUrl: identityResolver });
    await renderer.render(
      container,
      basePost({
        media: [
          { type: 'image', url: 'https://example.com/photo.jpg' },
        ],
      }),
    );

    // Sub-renderer emits `.pcr-media-hero-img`.
    const img = container.querySelector('.pcr-media-hero img') as HTMLImageElement | null;
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toBe('https://example.com/photo.jpg');
  });

  it('passes a blob: URL through the renderer for ZIP-extracted previews', async () => {
    // Simulates ImportGalleryContainer's resolver: ZIP-relative path → blob: URL.
    const blobUrl = 'blob:http://obsidian.test/abc-123';
    const renderer = new PreviewableCardRenderer({
      resolveMediaUrl: (raw) => (raw === 'media/photo.jpg' ? blobUrl : raw ?? undefined),
    });
    await renderer.render(
      container,
      basePost({ media: [{ type: 'image', url: 'media/photo.jpg' }] }),
    );

    const img = container.querySelector('.pcr-media-hero img') as HTMLImageElement | null;
    expect(img?.getAttribute('src')).toBe(blobUrl);
  });

  it('renders the "Preview loading…" placeholder when media exists but URL is unresolved', async () => {
    // resolveMediaUrl returns undefined for ZIP-relative paths that have not
    // been extracted yet. The renderer must NOT emit a broken <img>.
    const renderer = new PreviewableCardRenderer({
      resolveMediaUrl: () => undefined,
    });
    await renderer.render(
      container,
      basePost({ media: [{ type: 'image', url: 'media/photo.jpg' }] }),
    );

    expect(container.querySelector('.pcr-media-hero img')).toBeNull();
    const placeholder = container.querySelector('.pcr-media-hero-placeholder');
    expect(placeholder?.textContent).toContain('Preview loading');
  });

  it('renders the "Text-only post" placeholder when there is no media at all', async () => {
    const renderer = new PreviewableCardRenderer({ resolveMediaUrl: identityResolver });
    await renderer.render(container, basePost({ media: [] }));

    const empty = container.querySelector('.pcr-preview-media--text');
    expect(empty?.textContent).toContain('Text-only');
  });

  it('renders a carousel counter when there are multiple media items', async () => {
    // Polish A1: the legacy `+N` badge was replaced by a real carousel with a
    // "current / total" counter (e.g. "1 / 3"). The sub-renderer emits
    // `.pcr-media-carousel-counter` which lives inside the carousel wrapper.
    const renderer = new PreviewableCardRenderer({ resolveMediaUrl: identityResolver });
    await renderer.render(
      container,
      basePost({
        media: [
          { type: 'image', url: 'https://example.com/a.jpg' },
          { type: 'image', url: 'https://example.com/b.jpg' },
          { type: 'image', url: 'https://example.com/c.jpg' },
        ],
      }),
    );

    const counter = container.querySelector('.pcr-media-carousel-counter');
    expect(counter?.textContent).toBe('1 / 3');
  });

  // -------------------------------------------------------------------------
  // Caption — graceful degradation when no app/component (delegated to
  // PreviewableContentRenderer; renders as plain-text <p> tags)
  // -------------------------------------------------------------------------

  it('renders the caption as plain text when app/component are absent', async () => {
    // Default test setup: no app, no component, no MarkdownRenderer touched.
    const renderer = new PreviewableCardRenderer({ resolveMediaUrl: identityResolver });
    await renderer.render(
      container,
      basePost({ content: { text: 'A caption with **bold** that should NOT render as bold' } }),
    );

    // Content sub-renderer wraps caption in `.pcr-content > .pcr-content-text`.
    const caption = container.querySelector('.pcr-content-text');
    // Markdown is preserved as text — no `<strong>` element.
    expect(caption?.textContent).toContain('**bold**');
    expect(caption?.querySelector('strong')).toBeNull();
  });

  it('preserves line breaks in the plain-text caption', async () => {
    const renderer = new PreviewableCardRenderer({ resolveMediaUrl: identityResolver });
    await renderer.render(
      container,
      basePost({ content: { text: 'line one\nline two' } }),
    );

    const caption = container.querySelector('.pcr-content-text');
    // Plain-text path emits <p> with <br> for in-paragraph newlines.
    expect(caption?.querySelector('br')).toBeTruthy();
  });

  it('truncates long captions through the content sub-renderer', async () => {
    // The content sub-renderer truncates at `captionMaxChars` (or 300 by default)
    // and shows a "See more..." button. We assert the button is present.
    const longText = 'A'.repeat(500);
    const renderer = new PreviewableCardRenderer({
      resolveMediaUrl: identityResolver,
      captionMaxChars: 50,
    });
    await renderer.render(container, basePost({ content: { text: longText } }));

    const seeMore = container.querySelector('.pcr-see-more-btn');
    expect(seeMore).toBeTruthy();
    expect(seeMore?.textContent).toContain('See more');
  });

  // -------------------------------------------------------------------------
  // Interactions display (delegated to PreviewableInteractionsRenderer)
  // -------------------------------------------------------------------------

  it('omits the interactions bar when all metadata counts are missing or zero', async () => {
    const renderer = new PreviewableCardRenderer({ resolveMediaUrl: identityResolver });
    await renderer.render(container, basePost({ metadata: { timestamp: new Date(), likes: 0 } }));

    expect(container.querySelector('.pcr-interactions')).toBeNull();
  });

  it('renders the interactions bar with formatted counts when metadata has values', async () => {
    const renderer = new PreviewableCardRenderer({ resolveMediaUrl: identityResolver });
    await renderer.render(
      container,
      basePost({
        metadata: {
          timestamp: new Date(),
          likes: 1234,
          comments: 56,
          shares: 7,
        },
      }),
    );

    const bar = container.querySelector('.pcr-interactions');
    expect(bar).toBeTruthy();
    // Sub-renderer formats 1234 -> 1.2K via PreviewableHelpers.formatNumber.
    expect(bar?.textContent).toContain('1.2K');
    expect(bar?.textContent).toContain('56');
    // The composer adds the marker class so the gallery stylesheet can hook
    // a preview-specific selector if needed.
    expect(bar?.classList.contains('pcr-preview-interactions')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Avatar fallback path (delegated to PreviewableHeaderRenderer)
  // -------------------------------------------------------------------------

  it('renders an initials fallback avatar when the author has no avatar URL', async () => {
    const renderer = new PreviewableCardRenderer({ resolveMediaUrl: identityResolver });
    await renderer.render(
      container,
      basePost({
        author: { name: 'Ada Lovelace', url: 'https://x', handle: 'ada' },
      }),
    );

    const fallback = container.querySelector('.pcr-avatar-fallback');
    expect(fallback?.textContent).toBe('AL');
    expect(container.querySelector('.pcr-avatar-img')).toBeNull();
  });

  it('renders an <img> avatar when resolveMediaUrl returns one', async () => {
    const renderer = new PreviewableCardRenderer({ resolveMediaUrl: identityResolver });
    await renderer.render(
      container,
      basePost({
        author: {
          name: 'Ada',
          url: 'https://x',
          handle: 'ada',
          avatar: 'https://example.com/ada.png',
        },
      }),
    );

    const img = container.querySelector('.pcr-avatar-img') as HTMLImageElement | null;
    expect(img?.getAttribute('src')).toBe('https://example.com/ada.png');
  });

  // -------------------------------------------------------------------------
  // Click handler
  // -------------------------------------------------------------------------

  it('does not attach a click handler when onCardClick is omitted', async () => {
    const renderer = new PreviewableCardRenderer({ resolveMediaUrl: identityResolver });
    const card = await renderer.render(container, basePost());

    expect(card.style.cursor).not.toBe('pointer');
  });

  it('attaches a click handler when onCardClick is provided', async () => {
    let clicked: PostData | null = null;
    const renderer = new PreviewableCardRenderer({
      resolveMediaUrl: identityResolver,
      onCardClick: (p) => { clicked = p; },
    });
    const card = await renderer.render(container, basePost({ id: 'click-test' }));

    expect(card.style.cursor).toBe('pointer');
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicked).not.toBeNull();
    expect((clicked as unknown as PostData)?.id).toBe('click-test');
  });

  // -------------------------------------------------------------------------
  // Multi-call safety: rendering twice into different containers must not
  // share state (the renderer is stateless on purpose).
  // -------------------------------------------------------------------------

  it('produces independent DOM trees when called multiple times', async () => {
    const renderer = new PreviewableCardRenderer({ resolveMediaUrl: identityResolver });
    const a = makeContainer();
    const b = makeContainer();

    await renderer.render(a, basePost({ id: 'a', author: { name: 'Alpha', url: '', handle: 'alpha' } }));
    await renderer.render(b, basePost({ id: 'b', author: { name: 'Beta', url: '', handle: 'beta' } }));

    expect(a.querySelector('.pcr-author-name')?.textContent).toBe('Alpha');
    expect(b.querySelector('.pcr-author-name')?.textContent).toBe('Beta');
  });

  // -------------------------------------------------------------------------
  // PreviewContext shape — type-level reassurance via call-site
  // -------------------------------------------------------------------------

  it('accepts a minimal PreviewContext with only resolveMediaUrl', async () => {
    // This test is primarily a type-check: the interface must NOT require
    // any field beyond resolveMediaUrl.
    const ctx: PreviewContext = { resolveMediaUrl: () => undefined };
    const renderer = new PreviewableCardRenderer(ctx);
    const card = await renderer.render(container, basePost());
    expect(card).toBeInstanceOf(HTMLElement);
  });

  // -------------------------------------------------------------------------
  // Composition assertions (Round 3 — verifies the orchestrator wires the
  // sub-renderers in the documented order)
  // -------------------------------------------------------------------------

  it('renders header, content, media, and interactions in the expected order', async () => {
    const renderer = new PreviewableCardRenderer({ resolveMediaUrl: identityResolver });
    await renderer.render(
      container,
      basePost({
        media: [{ type: 'image', url: 'https://example.com/p.jpg' }],
        metadata: { timestamp: new Date(), likes: 1 },
      }),
    );

    const contentArea = container.querySelector('.post-content-area');
    expect(contentArea).toBeTruthy();
    const children = Array.from(contentArea?.children ?? []);
    // header → content → media → interactions
    expect(children[0]?.classList.contains('pcr-header')).toBe(true);
    expect(children[1]?.classList.contains('pcr-content')).toBe(true);
    expect(children[2]?.classList.contains('pcr-media-hero')).toBe(true);
    expect(children[3]?.classList.contains('pcr-interactions')).toBe(true);
  });
});
