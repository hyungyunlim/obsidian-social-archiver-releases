/**
 * Tests for PreviewableContentRenderer — Round 2B of the PostCardRenderer
 * extraction refactor. Covers the post-card *content area* sub-renderer.
 *
 * Coverage focus:
 *   - Caption rendering with markdown path (mocked MarkdownRenderer presence)
 *     vs plain-text fallback when `app`/`component` are absent.
 *   - Hashtag click handlers attach iff `context.onHashtagClick` is set.
 *   - Podcast metadata strip uses `formatDuration` for runtimes.
 *   - Banner factories emit the canonical CSS class names from
 *     `post-card.css` so the vault stylesheet applies unchanged (PRD §0
 *     WYSIWYG contract).
 *   - Pure markdown helpers (escapeMarkdownHeadings, convertWikilinkImages)
 *     produce expected output for the regression cases that motivated them.
 *   - Reblog short-circuit: when isReblog + quotedPost are set, no caption
 *     body is rendered (caller mounts a separate quotedPost card).
 *   - Google Maps business info renders with address/hours/website data.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  PreviewableContentRenderer,
  type PreviewContext,
} from '@/components/timeline/renderers/PreviewableContentRenderer';
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

const identityResolver = (raw: string | undefined | null): string | undefined =>
  raw ?? undefined;

function makeRenderer(overrides: Partial<PreviewContext> = {}): PreviewableContentRenderer {
  return new PreviewableContentRenderer({
    resolveMediaUrl: identityResolver,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PreviewableContentRenderer', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = makeContainer();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // -------------------------------------------------------------------------
  // renderContent — markdown vs plain-text path
  // -------------------------------------------------------------------------

  it('renders captions as plain-text <p> with line breaks when app/component are absent', async () => {
    const renderer = makeRenderer();
    const wrapper = await renderer.renderContent(
      container,
      basePost({ content: { text: 'paragraph one\nline two\n\nparagraph two' } }),
    );

    const contentText = wrapper.querySelector('.pcr-content-text');
    expect(contentText).toBeTruthy();

    // Markdown was NOT interpreted — no `<strong>` for `**bold**`, no <h1> for `# heading`.
    // The fallback emits one <p> per blank-line-delimited paragraph.
    const paragraphs = contentText?.querySelectorAll('p') ?? [];
    expect(paragraphs.length).toBe(2);
    // First paragraph contains both the line text and a <br> between lines.
    expect(paragraphs[0]?.querySelector('br')).toBeTruthy();
  });

  it('routes captions through MarkdownRenderer.render when app + component are both present', async () => {
    // Use vi.doMock so the mock applies to the dynamic import inside the renderer.
    const renderSpy = vi.fn(async (
      _app: unknown,
      md: string,
      el: HTMLElement,
    ): Promise<void> => {
      // Simulate Obsidian's MarkdownRenderer producing one element with the
      // markdown text — the test only cares that the call happened.
      const div = document.createElement('div');
      div.className = 'mocked-md';
      div.textContent = md;
      el.appendChild(div);
    });
    vi.doMock('obsidian', async () => {
      const actual = await vi.importActual<Record<string, unknown>>('obsidian');
      return { ...actual, MarkdownRenderer: { render: renderSpy } };
    });

    // Re-import the renderer AFTER the mock so its dynamic import sees the override.
    const { PreviewableContentRenderer: RendererCtor } = await import(
      '@/components/timeline/renderers/PreviewableContentRenderer'
    );
    const renderer = new RendererCtor({
      resolveMediaUrl: identityResolver,
      app: {} as unknown as PreviewContext['app'],
      component: {} as unknown as PreviewContext['component'],
    });

    await renderer.renderContent(
      container,
      basePost({ content: { text: 'A short caption' } }),
    );

    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.mocked-md')?.textContent).toContain('A short caption');
  });

  it('skips body rendering for a reblog with a quotedPost (caller mounts the quote card)', async () => {
    const renderer = makeRenderer();
    const wrapper = await renderer.renderContent(
      container,
      basePost({
        isReblog: true,
        quotedPost: { ...basePost({ id: 'quoted' }) } as PostData['quotedPost'],
        content: { text: 'reblog comment that should NOT render here' },
      }),
    );

    expect(wrapper.classList.contains('pcr-content-empty-reblog')).toBe(true);
    expect(wrapper.querySelector('.pcr-content-text')).toBeNull();
    expect(container.textContent).not.toContain('reblog comment');
  });

  it('renders an empty caption gracefully (no .pcr-content-text body)', async () => {
    const renderer = makeRenderer();
    const wrapper = await renderer.renderContent(container, basePost({ content: { text: '' } }));

    // Wrapper exists, plain-text body has no paragraphs (nothing to render).
    expect(wrapper.classList.contains('pcr-content')).toBe(true);
    const contentText = wrapper.querySelector('.pcr-content-text');
    // The body div is created (pre-render) but contains zero <p> when text is empty.
    expect(contentText?.querySelectorAll('p').length ?? 0).toBe(0);
  });

  // -------------------------------------------------------------------------
  // renderTextWithHashtags
  // -------------------------------------------------------------------------

  it('renderTextWithHashtags emits clickable anchors when onHashtagClick is set', () => {
    const clicked: string[] = [];
    const renderer = makeRenderer({
      onHashtagClick: (h) => clicked.push(h),
    });

    // Use a newline to terminate the hashtag — the source pattern captures
    // until next # or newline, so spaces are kept inside the hashtag span.
    renderer.renderTextWithHashtags(container, 'hello #world\nrest of caption', basePost());

    const link = container.querySelector('a.pcr-hashtag-link') as HTMLAnchorElement | null;
    expect(link).toBeTruthy();
    expect(link?.textContent).toBe('#world');
    expect(link?.getAttribute('href')).toContain('instagram.com');

    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(clicked).toEqual(['world']);
  });

  it('renderTextWithHashtags emits passive spans (NOT anchors) when onHashtagClick is omitted', () => {
    const renderer = makeRenderer();
    renderer.renderTextWithHashtags(container, 'hello #world', basePost());

    expect(container.querySelector('a.pcr-hashtag-link')).toBeNull();
    const span = container.querySelector('span.pcr-hashtag-span');
    expect(span?.textContent).toBe('#world');
  });

  // -------------------------------------------------------------------------
  // renderPodcastMetadata
  // -------------------------------------------------------------------------

  it('renderPodcastMetadata shows duration via formatDuration helper', () => {
    const renderer = makeRenderer();
    const bar = renderer.renderPodcastMetadata(
      container,
      basePost({
        platform: 'podcast',
        metadata: {
          timestamp: new Date(),
          episode: 12,
          season: 3,
          duration: 3665, // 1:01:05
          hosts: ['Alice'],
          guests: ['Bob', 'Carol'],
          explicit: true,
        },
      }),
    );

    expect(bar.classList.contains('pcr-podcast-metadata')).toBe(true);
    const items = Array.from(bar.querySelectorAll('.pcr-podcast-metadata-item')).map(
      (el) => el.textContent ?? '',
    );
    expect(items[0]).toBe('S3E12');
    // formatDuration converts 3665 → "1:01:05".
    expect(items.some((t) => t.includes('1:01:05'))).toBe(true);
    expect(items.some((t) => t.includes('Host: Alice'))).toBe(true);
    expect(items.some((t) => t.includes('Guests: Bob, Carol'))).toBe(true);
    expect(items.some((t) => t.includes('Explicit'))).toBe(true);
  });

  it('renderPodcastMetadata returns an empty placeholder when no metadata is present', () => {
    const renderer = makeRenderer();
    const bar = renderer.renderPodcastMetadata(
      container,
      basePost({ metadata: { timestamp: new Date() } }),
    );
    expect(bar.classList.contains('pcr-podcast-metadata--empty')).toBe(true);
    expect(bar.querySelector('.pcr-podcast-metadata-item')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Banner factories — emit canonical class names so post-card.css applies.
  // -------------------------------------------------------------------------

  it('renderArchivingProgressBanner emits .pcr-suggestion-banner-filled with a spinner and label', () => {
    const renderer = makeRenderer();
    const banner = renderer.renderArchivingProgressBanner(container, basePost());

    expect(banner.classList.contains('archive-progress-banner')).toBe(true);
    expect(banner.classList.contains('pcr-suggestion-banner')).toBe(true);
    expect(banner.classList.contains('pcr-suggestion-banner-filled')).toBe(true);
    expect(banner.querySelector('.pcr-spinner')).toBeTruthy();
    expect(banner.querySelector('.pcr-banner-message')?.textContent).toBe(
      'Archiving in background...',
    );
  });

  it('renderStatusBanner with kind="downloaded" emits a status banner with the canonical message', () => {
    const renderer = makeRenderer();
    const banner = renderer.renderStatusBanner(container, basePost(), 'downloaded');

    expect(banner.classList.contains('archive-status-banner')).toBe(true);
    expect(banner.classList.contains('pcr-suggestion-banner')).toBe(true);
    expect(banner.querySelector('.pcr-banner-message')?.textContent).toBe('Video downloaded');
  });

  it('renderStatusBanner with kind="download-declined" returns a hidden noop placeholder', () => {
    const renderer = makeRenderer();
    const banner = renderer.renderStatusBanner(container, basePost(), 'download-declined');
    expect(banner.classList.contains('sa-hidden')).toBe(true);
    expect(banner.querySelector('.pcr-banner-message')).toBeNull();
  });

  it('renderSuggestionBanner emits accept + decline buttons that fire their callbacks', () => {
    let acceptCalled = 0;
    let declineCalled = 0;
    const renderer = makeRenderer();
    const banner = renderer.renderSuggestionBanner(container, {
      message: 'Custom prompt?',
      onAccept: () => { acceptCalled += 1; },
      onDecline: () => { declineCalled += 1; },
    });

    expect(banner.classList.contains('archive-suggestion-banner')).toBe(true);
    expect(banner.classList.contains('pcr-suggestion-banner')).toBe(true);
    expect(banner.querySelector('.pcr-banner-message')?.textContent).toBe('Custom prompt?');

    const cancelBtn = banner.querySelector('.pcr-icon-btn-cancel') as HTMLButtonElement | null;
    const acceptBtn = banner.querySelector('.pcr-icon-btn-accent') as HTMLButtonElement | null;
    expect(cancelBtn).toBeTruthy();
    expect(acceptBtn).toBeTruthy();

    cancelBtn?.click();
    acceptBtn?.click();
    expect(declineCalled).toBe(1);
    expect(acceptCalled).toBe(1);
  });

  it('renderSuggestionBanner omits buttons when no callbacks are supplied (passive banner)', () => {
    const renderer = makeRenderer();
    const banner = renderer.renderSuggestionBanner(container, { message: 'Just a notice' });
    expect(banner.querySelector('.pcr-icon-btn-cancel')).toBeNull();
    expect(banner.querySelector('.pcr-icon-btn-accent')).toBeNull();
    expect(banner.querySelector('.pcr-banner-message')?.textContent).toBe('Just a notice');
  });

  // -------------------------------------------------------------------------
  // renderGoogleMapsBusinessInfo
  // -------------------------------------------------------------------------

  it('renderGoogleMapsBusinessInfo renders address / hours / website rows', () => {
    const renderer = makeRenderer();
    const wrapper = renderer.renderGoogleMapsBusinessInfo(
      container,
      basePost({
        platform: 'gmaps',
        author: { name: 'Pho Quoc', url: '', verified: true },
        content: { text: 'Categories: Vietnamese restaurant' },
        metadata: {
          timestamp: new Date(),
          location: '126 Đường Trần Hưng Đạo, Dương Tơ, Phú Quốc, Kiên Giang 92000, Vietnam',
          latitude: 10.2,
          longitude: 103.95,
        },
        raw: {
          open_hours: {
            Monday: '6:30 AM–10:30 PM',
            Tuesday: '6:30 AM–10:30 PM',
            Wednesday: '6:30 AM–10:30 PM',
            Thursday: '6:30 AM–10:30 PM',
            Friday: '6:30 AM–10:30 PM',
            Saturday: '6:30 AM–10:30 PM',
            Sunday: '6:30 AM–10:30 PM',
          },
          open_website: 'https://example.com/pho-quoc/',
        },
      }),
    );

    expect(wrapper.classList.contains('pcr-gmaps-business-info')).toBe(true);

    // Address row uses abbreviated label but full title attribute.
    const addressLabel = wrapper.querySelector('.pcr-gmaps-address-label') as HTMLElement | null;
    expect(addressLabel?.textContent).toContain('126 Đường Trần Hưng Đạo');
    expect(addressLabel?.getAttribute('title')).toContain('92000');

    // Hours summary collapses identical daily hours into "Open daily …".
    const hoursText = wrapper.querySelector('.pcr-gmaps-hours-text');
    expect(hoursText?.textContent).toContain('Open daily 6:30 AM–10:30 PM');

    // Website row strips protocol + trailing slash.
    const websiteText = wrapper.querySelector('.pcr-gmaps-website-text');
    expect(websiteText?.textContent).toBe('example.com/pho-quoc');
  });

  // -------------------------------------------------------------------------
  // Pure helpers — exposed via the renderContent path so we test them through
  // their public effect (escape behavior in the rendered DOM text).
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Escape behavior — markdown-only (Polish A2 bug fix)
  //
  // Previously the renderer escaped Setext headings, ordered-list patterns,
  // and angle brackets BEFORE branching on app/component availability. That
  // leaked literal `\===`, `2025\.`, and `&lt;…&gt;` into the plain-text
  // fallback DOM (visible to gallery preview users). The escapes are now
  // confined to the markdown path; the plain-text path receives the raw
  // user text via `textContent`.
  // -------------------------------------------------------------------------

  it('does NOT leak Setext-heading escape backslashes into the plain-text fallback', async () => {
    const renderer = makeRenderer();
    const wrapper = await renderer.renderContent(
      container,
      basePost({ content: { text: 'Title\n===\nbody' } }),
    );
    const body = wrapper.querySelector('.pcr-content-text');
    // No `\===` artifact — the user sees their text verbatim.
    expect(body?.textContent).not.toContain('\\===');
    expect(body?.textContent).toContain('===');
  });

  it('does NOT leak ordered-list escape backslashes into the plain-text fallback', async () => {
    const renderer = makeRenderer();
    const wrapper = await renderer.renderContent(
      container,
      basePost({ content: { text: '2025. 11. 6 update notes' } }),
    );
    const body = wrapper.querySelector('.pcr-content-text');
    // The screenshot bug: `2025\. 11. 6` instead of `2025. 11. 6`. Fixed.
    expect(body?.textContent).not.toContain('2025\\.');
    expect(body?.textContent).toContain('2025. 11. 6');
  });

  it('does NOT HTML-escape angle brackets in the plain-text fallback', async () => {
    const renderer = makeRenderer();
    const wrapper = await renderer.renderContent(
      container,
      basePost({ content: { text: '<인수공통> Sentinel' } }),
    );
    const body = wrapper.querySelector('.pcr-content-text');
    // textContent is XSS-safe, so leaving the literal `<` is correct here.
    expect(body?.textContent).not.toContain('&lt;');
    expect(body?.textContent).toContain('<인수공통> Sentinel');
  });

  it('does NOT leak ordered-list backslashes for "1. foo\\n2. bar" plain-text caption', async () => {
    // Regression test for the user-reported gallery bug:
    //   1\. 강남구 자곡동 강남자곡힐스테이트- 1339세대
    //   2\. 송파구 장지동 송파더센트레- 1139세대
    // should render as `1. ...` / `2. ...`.
    const renderer = makeRenderer();
    const wrapper = await renderer.renderContent(
      container,
      basePost({ content: { text: '1. foo\n2. bar' } }),
    );
    const body = wrapper.querySelector('.pcr-content-text');
    expect(body?.textContent).not.toContain('1\\.');
    expect(body?.textContent).not.toContain('2\\.');
    expect(body?.textContent).toContain('1. foo');
    expect(body?.textContent).toContain('2. bar');
  });

  it('applies escapes on the MARKDOWN path (with app + component) so MarkdownRenderer parses literally', async () => {
    // Mirror the existing markdown-path test: capture what was passed to
    // MarkdownRenderer.render() and assert the escapes were applied
    // upstream. The escaped string is what the markdown parser consumes;
    // it never reaches user-visible DOM with backslashes.
    const renderSpy = vi.fn(async (
      _app: unknown,
      md: string,
      el: HTMLElement,
    ): Promise<void> => {
      const div = document.createElement('div');
      div.className = 'mocked-md';
      div.textContent = md;
      el.appendChild(div);
    });
    vi.doMock('obsidian', async () => {
      const actual = await vi.importActual<Record<string, unknown>>('obsidian');
      return { ...actual, MarkdownRenderer: { render: renderSpy } };
    });

    const { PreviewableContentRenderer: RendererCtor } = await import(
      '@/components/timeline/renderers/PreviewableContentRenderer'
    );
    const renderer = new RendererCtor({
      resolveMediaUrl: identityResolver,
      app: {} as unknown as PreviewContext['app'],
      component: {} as unknown as PreviewContext['component'],
    });

    await renderer.renderContent(
      container,
      basePost({ content: { text: '1. foo\n2. bar' } }),
    );

    expect(renderSpy).toHaveBeenCalledTimes(1);
    const passedMarkdown = renderSpy.mock.calls[0]?.[1] as string;
    // Escapes ARE applied on the markdown path so the parser doesn't
    // promote `1.` / `2.` to an ordered-list.
    expect(passedMarkdown).toContain('1\\.');
    expect(passedMarkdown).toContain('2\\.');
  });

  it('convertWikilinkImages runs on the MARKDOWN path: ![[file.webp]] is rewritten and resolveMediaUrl is invoked', async () => {
    // The wikilink → markdown image conversion only makes sense when
    // MarkdownRenderer will consume the output. On the plain-text fallback
    // it would emit `![[…]]` syntax that is meaningless to end users.
    const resolveCalls: string[] = [];
    const renderSpy = vi.fn(async (): Promise<void> => {
      // No-op renderer — we only care about the markdown payload.
    });
    vi.doMock('obsidian', async () => {
      const actual = await vi.importActual<Record<string, unknown>>('obsidian');
      return { ...actual, MarkdownRenderer: { render: renderSpy } };
    });

    const { PreviewableContentRenderer: RendererCtor } = await import(
      '@/components/timeline/renderers/PreviewableContentRenderer'
    );
    const renderer = new RendererCtor({
      resolveMediaUrl: (raw) => {
        if (raw) resolveCalls.push(raw);
        return raw ?? undefined;
      },
      app: {} as unknown as PreviewContext['app'],
      component: {} as unknown as PreviewContext['component'],
    });

    await renderer.renderBlogContent(
      container,
      basePost({
        platform: 'naver',
        content: {
          text: '',
          rawMarkdown: 'Intro\n![[photo with space.webp]]\nMore text',
        },
      }),
    );

    // The resolver was invoked with the URL-encoded path produced by
    // convertWikilinkImages — proves the wikilink → markdown conversion ran.
    expect(resolveCalls.some((c) => c.includes('photo%20with%20space.webp'))).toBe(true);
  });

  it('does NOT call convertWikilinkImages or resolveMediaUrl in the plain-text blog-content fallback', async () => {
    // When app/component are absent, the blog-content path should leave
    // wikilink image syntax alone (it's meaningless in plain text) and skip
    // the inline-image resolver entirely.
    const resolveCalls: string[] = [];
    const renderer = makeRenderer({
      resolveMediaUrl: (raw) => {
        if (raw) resolveCalls.push(raw);
        return raw ?? undefined;
      },
    });
    await renderer.renderBlogContent(
      container,
      basePost({
        platform: 'naver',
        content: {
          text: '',
          rawMarkdown: 'Intro\n![[photo with space.webp]]\nMore text',
        },
      }),
    );
    expect(resolveCalls).toHaveLength(0);
    // The body text contains the original wikilink form verbatim.
    const body = container.querySelector('.pcr-blog-content');
    expect(body?.textContent).toContain('![[photo with space.webp]]');
  });

  // -------------------------------------------------------------------------
  // Class shape: PreviewContext should accept the minimal required field.
  // -------------------------------------------------------------------------

  it('accepts a minimal PreviewContext with only resolveMediaUrl', async () => {
    const ctx: PreviewContext = { resolveMediaUrl: () => undefined };
    const renderer = new PreviewableContentRenderer(ctx);
    const wrapper = await renderer.renderContent(container, basePost());
    expect(wrapper).toBeInstanceOf(HTMLElement);
  });

  it('normalizeTagFontSizes adds the post-body-text class when missing', () => {
    const renderer = makeRenderer();
    const el = document.createElement('div');
    expect(el.classList.contains('post-body-text')).toBe(false);
    renderer.normalizeTagFontSizes(el);
    expect(el.classList.contains('post-body-text')).toBe(true);
    // Calling twice is a no-op.
    renderer.normalizeTagFontSizes(el);
    expect(el.classList.length).toBe(1);
  });
});
