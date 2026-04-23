/**
 * Tests for PreviewableHeaderRenderer — the visual-chrome renderer for the
 * post card *header strip* (Round 2A of the PostCardRenderer extraction).
 *
 * Coverage focus:
 *   - Avatar rendering: image when `resolveMediaUrl` succeeds, initials
 *     fallback when it returns undefined.
 *   - Author name + handle/timestamp from `PostData`.
 *   - Platform pill carries a `data-platform` attribute and shares the
 *     `pcr-platform-link` class with PostCardRenderer's output (WYSIWYG
 *     contract per PRD §0).
 *   - Crosspost indicator only renders when `post.threadsPostUrl` is set.
 *   - Subscription badge frame only renders when `context.isSubscribed`
 *     is provided AND returns true.
 *   - Author-note tooltip frame only renders when
 *     `context.getAuthorNoteSnippet` is provided AND returns non-null.
 *   - Pure data transforms (`enrichWithParentAvatar`, `isSameAuthorForAvatar`).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PreviewableHeaderRenderer,
  type PreviewContext,
} from '@/components/timeline/renderers/PreviewableHeaderRenderer';
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

// Identity resolver: pass URLs straight through.
const identityResolver = (raw: string | undefined | null): string | undefined => raw ?? undefined;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PreviewableHeaderRenderer', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = makeContainer();
  });

  // -------------------------------------------------------------------------
  // CSS class contract — WYSIWYG with PostCardRenderer
  // -------------------------------------------------------------------------

  it('emits the same .pcr-header / .pcr-author-name / .pcr-time-row CSS classes as PostCardRenderer', () => {
    const renderer = new PreviewableHeaderRenderer({ resolveMediaUrl: identityResolver });
    const header = renderer.renderHeader(container, basePost());

    expect(header.classList.contains('pcr-header')).toBe(true);
    expect(header.querySelector('.pcr-author-name')).toBeTruthy();
    expect(header.querySelector('.pcr-time-row')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Avatar
  // -------------------------------------------------------------------------

  it('renders an <img> avatar when resolveMediaUrl returns a URL', () => {
    const renderer = new PreviewableHeaderRenderer({ resolveMediaUrl: identityResolver });
    renderer.renderHeader(
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
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toBe('https://example.com/ada.png');
    // Initials fallback should NOT also be present.
    expect(container.querySelector('.pcr-avatar-fallback')).toBeNull();
  });

  it('falls back to initials when resolveMediaUrl returns undefined', () => {
    const renderer = new PreviewableHeaderRenderer({ resolveMediaUrl: () => undefined });
    renderer.renderHeader(
      container,
      basePost({
        author: { name: 'Ada Lovelace', url: 'https://x', handle: 'ada' },
      }),
    );

    const fallback = container.querySelector('.pcr-avatar-fallback');
    expect(fallback?.textContent).toBe('AL');
    expect(container.querySelector('.pcr-avatar-img')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Author name + relative time
  // -------------------------------------------------------------------------

  it('renders the author name from PostData', () => {
    const renderer = new PreviewableHeaderRenderer({ resolveMediaUrl: identityResolver });
    renderer.renderHeader(container, basePost({ author: { name: 'Alpha', url: '', handle: 'alpha' } }));

    expect(container.querySelector('.pcr-author-name')?.textContent).toBe('Alpha');
  });

  it('renders the relative time string from formatRelativeTime in the time row', () => {
    const renderer = new PreviewableHeaderRenderer({ resolveMediaUrl: identityResolver });
    // Use a timestamp far in the past so we get the absolute date branch
    // (which is deterministic regardless of test wall clock).
    renderer.renderHeader(
      container,
      basePost({ metadata: { timestamp: new Date('2020-01-15T00:00:00Z') } }),
    );

    const timeRow = container.querySelector('.pcr-time-row');
    expect(timeRow).toBeTruthy();
    expect(timeRow?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    expect(timeRow?.querySelector('.pcr-nowrap')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Platform pill (original-post link)
  // -------------------------------------------------------------------------

  it('renders the platform pill with a data-platform attribute matching the post', () => {
    const renderer = new PreviewableHeaderRenderer({ resolveMediaUrl: identityResolver });
    renderer.renderHeader(container, basePost({ platform: 'instagram' }));

    const pill = container.querySelector('.pcr-platform-link') as HTMLElement | null;
    expect(pill).toBeTruthy();
    expect(pill?.getAttribute('data-platform')).toBe('instagram');
  });

  it('skips the platform pill for the user-post platform "post"', () => {
    const renderer = new PreviewableHeaderRenderer({ resolveMediaUrl: identityResolver });
    renderer.renderHeader(container, basePost({ platform: 'post', url: '' }));

    expect(container.querySelector('.pcr-platform-link')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Crosspost indicator
  // -------------------------------------------------------------------------

  it('renders the crosspost indicator only when post.threadsPostUrl is set', () => {
    const renderer = new PreviewableHeaderRenderer({ resolveMediaUrl: identityResolver });

    // Without threadsPostUrl
    renderer.renderHeader(container, basePost());
    expect(container.querySelector('.pcr-crosspost-badge')).toBeNull();

    // With threadsPostUrl
    document.body.innerHTML = '';
    container = makeContainer();
    renderer.renderHeader(
      container,
      basePost({ threadsPostUrl: 'https://www.threads.net/@me/post/abc' }),
    );
    expect(container.querySelector('.pcr-crosspost-badge')).toBeTruthy();
  });

  it('renderCrossPostIndicator is idempotent — does not duplicate the badge on a second call', () => {
    const renderer = new PreviewableHeaderRenderer({ resolveMediaUrl: identityResolver });
    const header = renderer.renderHeader(
      container,
      basePost({ threadsPostUrl: 'https://www.threads.net/@me/post/abc' }),
    );

    renderer.renderCrossPostIndicator(header, 'https://www.threads.net/@me/post/abc');
    expect(header.querySelectorAll('.pcr-crosspost-badge').length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Subscription badge frame
  // -------------------------------------------------------------------------

  it('omits the subscription badge frame when context.isSubscribed is not provided', () => {
    const renderer = new PreviewableHeaderRenderer({ resolveMediaUrl: identityResolver });
    renderer.renderHeader(container, basePost());

    expect(container.querySelector('[data-action="subscribe-badge"]')).toBeNull();
  });

  it('renders the subscription badge frame when context.isSubscribed returns true', () => {
    const ctx: PreviewContext = {
      resolveMediaUrl: identityResolver,
      isSubscribed: () => true,
    };
    const renderer = new PreviewableHeaderRenderer(ctx);
    renderer.renderHeader(container, basePost());

    const badge = container.querySelector('[data-action="subscribe-badge"]') as HTMLElement | null;
    expect(badge).toBeTruthy();
    expect(badge?.getAttribute('data-subscribed')).toBe('true');
    expect(badge?.classList.contains('pcr-badge-subscribed')).toBe(true);
  });

  it('renders the subscription badge frame in unsubscribed state when isSubscribed returns false', () => {
    const ctx: PreviewContext = {
      resolveMediaUrl: identityResolver,
      isSubscribed: () => false,
    };
    const renderer = new PreviewableHeaderRenderer(ctx);
    renderer.renderHeader(container, basePost());

    const badge = container.querySelector('[data-action="subscribe-badge"]') as HTMLElement | null;
    expect(badge).toBeTruthy();
    expect(badge?.getAttribute('data-subscribed')).toBe('false');
    expect(badge?.classList.contains('pcr-badge-unsubscribed')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Author-note tooltip frame
  // -------------------------------------------------------------------------

  it('omits the author-note tooltip when context.getAuthorNoteSnippet is not provided', () => {
    const renderer = new PreviewableHeaderRenderer({ resolveMediaUrl: identityResolver });
    renderer.renderHeader(container, basePost());

    const author = container.querySelector('.pcr-author-name') as HTMLElement | null;
    expect(author?.getAttribute('data-author-tooltip')).toBeNull();
    expect(container.querySelector('.pcr-author-note-indicator')).toBeNull();
  });

  it('renders the author-note tooltip frame only when getAuthorNoteSnippet returns non-null', () => {
    const ctx: PreviewContext = {
      resolveMediaUrl: identityResolver,
      getAuthorNoteSnippet: (post) =>
        post.author.name === 'Jane Doe' ? 'A short note about Jane.' : null,
    };
    const renderer = new PreviewableHeaderRenderer(ctx);
    renderer.renderHeader(container, basePost());

    const author = container.querySelector('.pcr-author-name') as HTMLElement | null;
    expect(author?.getAttribute('data-author-tooltip')).toBe('A short note about Jane.');
    expect(container.querySelector('.pcr-author-note-indicator')).toBeTruthy();
  });

  it('does not render the tooltip frame when getAuthorNoteSnippet returns null', () => {
    const ctx: PreviewContext = {
      resolveMediaUrl: identityResolver,
      getAuthorNoteSnippet: () => null,
    };
    const renderer = new PreviewableHeaderRenderer(ctx);
    renderer.renderHeader(container, basePost());

    const author = container.querySelector('.pcr-author-name') as HTMLElement | null;
    expect(author?.getAttribute('data-author-tooltip')).toBeNull();
    expect(container.querySelector('.pcr-author-note-indicator')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Author click handler
  // -------------------------------------------------------------------------

  it('does not attach an author click handler when onAuthorClick is omitted', () => {
    const renderer = new PreviewableHeaderRenderer({ resolveMediaUrl: identityResolver });
    renderer.renderHeader(container, basePost());

    const author = container.querySelector('.pcr-author-name') as HTMLElement | null;
    expect(author?.style.cursor).not.toBe('pointer');
  });

  it('attaches the author click handler and forwards the post when onAuthorClick is set', () => {
    let received: PostData | null = null;
    const ctx: PreviewContext = {
      resolveMediaUrl: identityResolver,
      onAuthorClick: (p) => { received = p; },
    };
    const renderer = new PreviewableHeaderRenderer(ctx);
    renderer.renderHeader(container, basePost({ id: 'click-test' }));

    const author = container.querySelector('.pcr-author-name') as HTMLElement | null;
    expect(author?.style.cursor).toBe('pointer');
    author?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(received).not.toBeNull();
    expect((received as unknown as PostData)?.id).toBe('click-test');
  });

  // -------------------------------------------------------------------------
  // Reddit / Naver community segments inside time row
  // -------------------------------------------------------------------------

  it('renders the Reddit subreddit link inside the time row when content.community is set', () => {
    const renderer = new PreviewableHeaderRenderer({ resolveMediaUrl: identityResolver });
    renderer.renderHeader(
      container,
      basePost({
        platform: 'reddit',
        content: {
          text: 'hi',
          community: { name: 'AskReddit', url: 'https://reddit.com/r/AskReddit' },
        },
      }),
    );

    const link = container.querySelector('.pcr-community-link') as HTMLAnchorElement | null;
    expect(link).toBeTruthy();
    expect(link?.textContent).toBe('r/AskReddit');
    expect(link?.href).toContain('reddit.com/r/AskReddit');
  });

  // -------------------------------------------------------------------------
  // Pure data transforms
  // -------------------------------------------------------------------------

  it('enrichWithParentAvatar injects parent.localAvatar into matching embedded post', () => {
    const renderer = new PreviewableHeaderRenderer({ resolveMediaUrl: identityResolver });
    const parent = basePost({
      author: { name: 'Jane', url: 'https://x.com/jane', handle: 'jane', localAvatar: 'attachments/jane.png' },
    });
    const embedded = basePost({
      id: 'embedded',
      author: { name: 'Jane', url: 'https://x.com/jane', handle: 'jane' },
    });

    const result = renderer.enrichWithParentAvatar(embedded, parent);

    expect(result.author.localAvatar).toBe('attachments/jane.png');
    // Original embedded post is not mutated.
    expect(embedded.author.localAvatar).toBeUndefined();
  });

  it('enrichWithParentAvatar returns the embedded post unchanged when authors differ', () => {
    const renderer = new PreviewableHeaderRenderer({ resolveMediaUrl: identityResolver });
    const parent = basePost({
      author: { name: 'Jane', url: 'https://x.com/jane', handle: 'jane', localAvatar: 'attachments/jane.png' },
    });
    const embedded = basePost({
      id: 'embedded',
      author: { name: 'John', url: 'https://x.com/john', handle: 'john' },
    });

    const result = renderer.enrichWithParentAvatar(embedded, parent);

    expect(result.author.localAvatar).toBeUndefined();
    expect(result).toBe(embedded);
  });

  it('isSameAuthorForAvatar matches by URL (case + trailing slash insensitive)', () => {
    const renderer = new PreviewableHeaderRenderer({ resolveMediaUrl: identityResolver });
    const a = { name: 'A', url: 'https://x.com/jane/', handle: 'jane' };
    const b = { name: 'A', url: 'https://X.com/jane', handle: 'jane' };

    expect(renderer.isSameAuthorForAvatar(a, b)).toBe(true);
  });

  it('isSameAuthorForAvatar returns false for unrelated authors', () => {
    const renderer = new PreviewableHeaderRenderer({ resolveMediaUrl: identityResolver });
    const a = { name: 'A', url: 'https://x.com/jane', handle: 'jane' };
    const b = { name: 'B', url: 'https://x.com/john', handle: 'john' };

    expect(renderer.isSameAuthorForAvatar(a, b)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Highlight badge
  // -------------------------------------------------------------------------

  it('renderHighlightBadge emits a .pcr-highlight-badge with the given count', () => {
    const renderer = new PreviewableHeaderRenderer({ resolveMediaUrl: identityResolver });
    const badge = renderer.renderHighlightBadge(container, 7);

    expect(badge.classList.contains('pcr-highlight-badge')).toBe(true);
    expect(badge.querySelector('.pcr-highlight-badge-icon')).toBeTruthy();
    expect(badge.textContent).toContain('7');
  });

  // -------------------------------------------------------------------------
  // Type-level reassurance: minimal context must compile
  // -------------------------------------------------------------------------

  it('accepts a minimal PreviewContext with only resolveMediaUrl', () => {
    const ctx: PreviewContext = { resolveMediaUrl: () => undefined };
    const renderer = new PreviewableHeaderRenderer(ctx);
    const header = renderer.renderHeader(container, basePost());
    expect(header).toBeInstanceOf(HTMLElement);
  });
});
