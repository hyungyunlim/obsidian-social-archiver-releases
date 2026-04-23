/**
 * Tests for `PreviewableInteractionsRenderer` — the read-only counts portion
 * of a post card's interactions row (likes / comments / shares / views).
 *
 * Coverage focus (per Round-2D agent spec):
 *   - Each count category renders when its value is present and > 0
 *   - Zero / missing counts are silently omitted
 *   - Large numbers go through `formatNumber` ("1.5K", "1M")
 *   - Emitted DOM uses the same CSS class names as `PostCardRenderer`
 *     (`pcr-action-btn`, `pcr-action-icon`, `pcr-action-count`)
 *   - `renderCounts` returns the counts container
 *   - `renderSingleCount` works for each `CountKind`
 *
 * The renderer is intentionally tiny — these tests exercise every public
 * surface area and every count category so Round-3's delegation rewire
 * can be validated against a stable contract.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  PreviewableInteractionsRenderer,
  type PreviewContext,
  type CountKind,
} from '@/components/timeline/renderers/PreviewableInteractionsRenderer';
import type { PostData } from '@/types/post';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeInteractionsContainer(): HTMLElement {
  // Caller (PostCardRenderer.render in Round-3) is responsible for creating
  // the outer `.pcr-interactions` element. Mirror that contract here.
  const div = document.createElement('div');
  div.classList.add('pcr-interactions');
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

// Identity resolver — `PreviewContext` requires `resolveMediaUrl` even
// though this sub-renderer doesn't consult it.
const identityContext: PreviewContext = {
  resolveMediaUrl: (raw) => raw ?? undefined,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PreviewableInteractionsRenderer', () => {
  let interactionsEl: HTMLElement;
  let renderer: PreviewableInteractionsRenderer;

  beforeEach(() => {
    document.body.innerHTML = '';
    interactionsEl = makeInteractionsContainer();
    renderer = new PreviewableInteractionsRenderer(identityContext);
  });

  // -------------------------------------------------------------------------
  // renderCounts — per-category presence / absence
  // -------------------------------------------------------------------------

  it('renders the likes count when post.metadata.likes > 0', () => {
    const post = basePost({
      metadata: { timestamp: new Date(), likes: 12 },
    });

    renderer.renderCounts(interactionsEl, post);

    const badge = interactionsEl.querySelector(
      '[data-count-kind="likes"] .pcr-action-count',
    );
    expect(badge?.textContent).toBe('12');
  });

  it('renders the comments count when post.metadata.comments > 0', () => {
    const post = basePost({
      metadata: { timestamp: new Date(), comments: 3 },
    });

    renderer.renderCounts(interactionsEl, post);

    const badge = interactionsEl.querySelector(
      '[data-count-kind="comments"] .pcr-action-count',
    );
    expect(badge?.textContent).toBe('3');
  });

  it('renders the shares count when post.metadata.shares > 0', () => {
    const post = basePost({
      metadata: { timestamp: new Date(), shares: 5 },
    });

    renderer.renderCounts(interactionsEl, post);

    const badge = interactionsEl.querySelector(
      '[data-count-kind="shares"] .pcr-action-count',
    );
    expect(badge?.textContent).toBe('5');
  });

  it('renders the views count when post.metadata.views > 0 (YouTube/TikTok)', () => {
    const post = basePost({
      platform: 'youtube',
      metadata: { timestamp: new Date(), views: 1500 },
    });

    renderer.renderCounts(interactionsEl, post);

    const badge = interactionsEl.querySelector(
      '[data-count-kind="views"] .pcr-action-count',
    );
    expect(badge?.textContent).toBe('1.5K');
  });

  it('skips zero-valued counts (no "0 ❤" badges)', () => {
    const post = basePost({
      metadata: {
        timestamp: new Date(),
        likes: 0,
        comments: 0,
        shares: 0,
        views: 0,
      },
    });

    renderer.renderCounts(interactionsEl, post);

    expect(interactionsEl.querySelectorAll('.pcr-action-btn')).toHaveLength(0);
  });

  it('skips counts whose values are missing entirely', () => {
    const post = basePost({
      // metadata has no likes / comments / shares / views fields
      metadata: { timestamp: new Date() },
    });

    renderer.renderCounts(interactionsEl, post);

    expect(interactionsEl.querySelectorAll('.pcr-action-btn')).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // renderCounts — formatting + DOM contract
  // -------------------------------------------------------------------------

  it('formats large numbers via formatNumber (1500 -> "1.5K", 1000000 -> "1M")', () => {
    const post = basePost({
      metadata: {
        timestamp: new Date(),
        likes: 1500,
        comments: 1_000_000,
        shares: 12_000,
      },
    });

    renderer.renderCounts(interactionsEl, post);

    const likes = interactionsEl.querySelector(
      '[data-count-kind="likes"] .pcr-action-count',
    );
    const comments = interactionsEl.querySelector(
      '[data-count-kind="comments"] .pcr-action-count',
    );
    const shares = interactionsEl.querySelector(
      '[data-count-kind="shares"] .pcr-action-count',
    );

    expect(likes?.textContent).toBe('1.5K');
    expect(comments?.textContent).toBe('1M');
    expect(shares?.textContent).toBe('12K');
  });

  it('emits the same CSS class names as PostCardRenderer (.pcr-action-btn + .pcr-action-count + .pcr-action-icon)', () => {
    const post = basePost({
      metadata: { timestamp: new Date(), likes: 7 },
    });

    renderer.renderCounts(interactionsEl, post);

    const btn = interactionsEl.querySelector('.pcr-action-btn');
    expect(btn).toBeTruthy();
    expect(btn?.querySelector('.pcr-action-icon')).toBeTruthy();
    expect(btn?.querySelector('.pcr-action-count')).toBeTruthy();
  });

  it('renders counts in the canonical order (likes -> comments -> shares -> views)', () => {
    const post = basePost({
      metadata: {
        timestamp: new Date(),
        likes: 10,
        comments: 20,
        shares: 30,
        views: 40,
      },
    });

    renderer.renderCounts(interactionsEl, post);

    const kinds = Array.from(
      interactionsEl.querySelectorAll<HTMLElement>('[data-count-kind]'),
    ).map((el) => el.getAttribute('data-count-kind'));

    expect(kinds).toEqual(['likes', 'comments', 'shares', 'views']);
  });

  it('returns the counts container element from renderCounts', () => {
    const post = basePost({
      metadata: { timestamp: new Date(), likes: 1 },
    });

    const returned = renderer.renderCounts(interactionsEl, post);

    expect(returned).toBe(interactionsEl);
  });

  it('does NOT emit any vault-coupled action buttons (Like / Archive / Share / etc.)', () => {
    // Sanity guard: if a future edit accidentally pulls in an action button,
    // this test catches it by counting badges. Each badge must be a count.
    const post = basePost({
      metadata: {
        timestamp: new Date(),
        likes: 1,
        comments: 1,
        shares: 1,
        views: 1,
      },
    });

    renderer.renderCounts(interactionsEl, post);

    const badges = interactionsEl.querySelectorAll<HTMLElement>('.pcr-action-btn');
    expect(badges).toHaveLength(4);
    badges.forEach((badge) => {
      // Every emitted button MUST carry a count kind. Action buttons in
      // PostCardRenderer would not.
      expect(badge.getAttribute('data-count-kind')).toBeTruthy();
      expect(badge.querySelector('.pcr-action-count')).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // renderSingleCount
  // -------------------------------------------------------------------------

  it('renderSingleCount produces a single badge for each CountKind', () => {
    const kinds: CountKind[] = ['likes', 'comments', 'shares', 'views'];

    for (const kind of kinds) {
      const parent = document.createElement('div');
      const badge = renderer.renderSingleCount(parent, kind, 42);

      expect(parent.children).toHaveLength(1);
      expect(parent.firstElementChild).toBe(badge);
      expect(badge.classList.contains('pcr-action-btn')).toBe(true);
      expect(badge.getAttribute('data-count-kind')).toBe(kind);
      expect(
        badge.querySelector('.pcr-action-count')?.textContent,
      ).toBe('42');
    }
  });

  // -------------------------------------------------------------------------
  // Lucide icon integration (Polish A2)
  // -------------------------------------------------------------------------

  it('falls back to a unicode glyph in .pcr-action-icon when setIcon is unavailable', () => {
    // The default obsidian test mock does not export `setIcon`. Verify the
    // fallback path renders the canonical glyph as plain text so jsdom
    // and headless preview surfaces still get a visible icon.
    const post = basePost({
      metadata: { timestamp: new Date(), likes: 1 },
    });

    renderer.renderCounts(interactionsEl, post);

    const iconSlot = interactionsEl.querySelector(
      '[data-count-kind="likes"] .pcr-action-icon',
    );
    expect(iconSlot).toBeTruthy();
    // Heart glyph U+2665 — the previous unicode vocabulary.
    expect(iconSlot?.textContent).toBe('\u2665');
    // No SVG was injected on the fallback path.
    expect(iconSlot?.querySelector('svg')).toBeNull();
  });

  it('invokes setIcon with the canonical lucide name when obsidian provides it', async () => {
    // The renderer uses a top-level `import { setIcon } from 'obsidian'` so
    // the binding is resolved at module load time. To inject a spy we use
    // `vi.spyOn` against the obsidian module namespace AND re-import the
    // renderer module after `vi.resetModules` so its import sees the patched
    // namespace. This mirrors the real-runtime path where Obsidian's
    // `setIcon` is exported globally.
    vi.resetModules();
    const obsidianModule = await import('obsidian') as Record<string, unknown>;

    const setIconSpy = vi.fn((el: HTMLElement, name: string) => {
      // Simulate Obsidian: inject an <svg> with a data-icon attribute so the
      // test can confirm `setIcon` was invoked AND the right name landed in
      // the right slot.
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('data-icon', name);
      el.appendChild(svg);
    });

    const originalSetIcon = obsidianModule.setIcon;
    try {
      // The mock has no `setIcon` export — define one so the renderer's
      // top-level binding picks it up after we re-import the module below.
      Object.defineProperty(obsidianModule, 'setIcon', {
        value: setIconSpy,
        writable: true,
        configurable: true,
      });

      const { PreviewableInteractionsRenderer: RendererCtor } = await import(
        '@/components/timeline/renderers/PreviewableInteractionsRenderer'
      );
      const liveRenderer = new RendererCtor(identityContext);

      const post = basePost({
        metadata: {
          timestamp: new Date(),
          likes: 1,
          comments: 2,
          shares: 3,
          views: 4,
        },
      });
      liveRenderer.renderCounts(interactionsEl, post);

      const calledNames = setIconSpy.mock.calls.map((c) => c[1]);
      expect(calledNames).toEqual(['heart', 'message-circle', 'repeat-2', 'eye']);

      // Each slot received the SVG injected by the spy — proves `setIcon`
      // wrote into the right element.
      expect(
        interactionsEl.querySelector('[data-count-kind="likes"] svg[data-icon="heart"]'),
      ).toBeTruthy();
      expect(
        interactionsEl.querySelector('[data-count-kind="comments"] svg[data-icon="message-circle"]'),
      ).toBeTruthy();
      expect(
        interactionsEl.querySelector('[data-count-kind="shares"] svg[data-icon="repeat-2"]'),
      ).toBeTruthy();
      expect(
        interactionsEl.querySelector('[data-count-kind="views"] svg[data-icon="eye"]'),
      ).toBeTruthy();
    } finally {
      // Restore the obsidian module so subsequent tests in other files see
      // the original mock surface.
      if (originalSetIcon === undefined) {
        delete (obsidianModule as { setIcon?: unknown }).setIcon;
      } else {
        Object.defineProperty(obsidianModule, 'setIcon', {
          value: originalSetIcon,
          writable: true,
          configurable: true,
        });
      }
      vi.resetModules();
    }
  });
});
