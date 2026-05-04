/**
 * NoticeBanner unit tests.
 *
 * Coverage:
 *   - Title-only render when notice has a title.
 *   - Body inline render when notice has no title.
 *   - X button hidden for `dismissPolicy === 'sticky'`.
 *   - Impression telemetry is de-duped per (notice id, plugin session).
 *   - executeCta('open_paywall', ...) opens the smart-landing handoff
 *     URL with the correct lang param (no `cta.url` read).
 *   - executeCta('open_rewards', ...) is a no-op + warn (no throw).
 *   - executeCta rejects URL schemes outside the allowlist for
 *     `open_url`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The default obsidian mock does not export `setIcon` because some other
// renderer tests rely on its absence to exercise their fallback path.
// Stub it here so NoticeBanner's icon insertion runs without crashing.
vi.mock('obsidian', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('obsidian');
  return {
    ...actual,
    setIcon: (el: HTMLElement, iconName: string) => {
      el.setAttribute('data-icon', iconName);
    },
  };
});

import {
  NoticeBanner,
  executeCta,
  noticeLevelIcon,
  noticeLevelLabel,
} from '../../../components/timeline/NoticeBanner';
import type { NoticePayloadV1 } from '../../../types/notices';
import type { NoticesService } from '../../../services/NoticesService';
import type { NoticeTelemetryService } from '../../../services/NoticeTelemetryService';

// ----------------------------------------------------------------------------
// Test helpers
// ----------------------------------------------------------------------------

function makeNotice(overrides: Partial<NoticePayloadV1> = {}): NoticePayloadV1 {
  return {
    schemaVersion: 1,
    id: 'notice-1',
    surface: 'top_banner',
    priority: 0,
    level: 'info',
    body: 'Body text',
    dismissPolicy: 'per_id_local',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    trackingKey: 'tk-1',
    ...overrides,
  };
}

interface FakeNoticesService {
  visible: NoticePayloadV1 | null;
  dismiss: ReturnType<typeof vi.fn>;
  /** Trigger the registered onUpdate listener. */
  fire: () => void;
  /** Read the registered listener (for re-render testing). */
  service: Pick<NoticesService, 'getVisibleNotice' | 'dismiss' | 'onUpdate'>;
}

function makeFakeNoticesService(initial: NoticePayloadV1 | null): FakeNoticesService {
  const state = { visible: initial };
  let listener: (() => void) | null = null;
  const dismiss = vi.fn(async (id: string) => {
    if (state.visible?.id === id) state.visible = null;
    listener?.();
  });
  const service = {
    getVisibleNotice: () => state.visible,
    dismiss,
    onUpdate: (cb: () => void) => {
      listener = cb;
      return () => {
        listener = null;
      };
    },
  } as unknown as Pick<NoticesService, 'getVisibleNotice' | 'dismiss' | 'onUpdate'>;
  return {
    get visible() { return state.visible; },
    set visible(v) { state.visible = v; },
    dismiss,
    fire: () => listener?.(),
    service,
  };
}

function makeFakeTelemetry(): NoticeTelemetryService {
  return {
    trackImpression: vi.fn(),
    trackCtaClicked: vi.fn(),
    trackDismissed: vi.fn(),
  } as unknown as NoticeTelemetryService;
}

// ----------------------------------------------------------------------------
// Banner DOM rendering
// ----------------------------------------------------------------------------

describe('NoticeBanner — DOM rendering', () => {
  let parent: HTMLElement;

  beforeEach(() => {
    parent = document.createElement('div');
    document.body.appendChild(parent);
  });

  afterEach(() => {
    parent.remove();
  });

  it('renders title-only when notice has a title', () => {
    const fake = makeFakeNoticesService(
      makeNotice({ title: 'Heads up: maintenance', body: 'body should not show' }),
    );
    const banner = new NoticeBanner(parent, {
      noticesService: fake.service as unknown as NoticesService,
      telemetry: makeFakeTelemetry(),
      onOpenDetail: () => {},
    });
    banner.render();

    const text = parent.querySelector<HTMLElement>('.nb-text');
    expect(text).not.toBeNull();
    expect(text!.textContent).toBe('Heads up: maintenance');
    expect(text!.classList.contains('nb-text-title')).toBe(true);
    banner.destroy();
  });

  it('renders body inline when notice has no title', () => {
    const fake = makeFakeNoticesService(makeNotice({ body: 'inline body' }));
    const banner = new NoticeBanner(parent, {
      noticesService: fake.service as unknown as NoticesService,
      telemetry: makeFakeTelemetry(),
      onOpenDetail: () => {},
    });
    banner.render();

    const text = parent.querySelector<HTMLElement>('.nb-text');
    expect(text).not.toBeNull();
    expect(text!.textContent).toBe('inline body');
    expect(text!.classList.contains('nb-text-title')).toBe(false);
    banner.destroy();
  });

  it('hides the X button for sticky notices', () => {
    const fake = makeFakeNoticesService(
      makeNotice({ dismissPolicy: 'sticky', body: 'cannot dismiss' }),
    );
    const banner = new NoticeBanner(parent, {
      noticesService: fake.service as unknown as NoticesService,
      telemetry: makeFakeTelemetry(),
      onOpenDetail: () => {},
    });
    banner.render();

    expect(parent.querySelector('.nb-close')).toBeNull();
    banner.destroy();
  });

  it('shows the X button for non-sticky notices', () => {
    const fake = makeFakeNoticesService(
      makeNotice({ dismissPolicy: 'per_id_local' }),
    );
    const banner = new NoticeBanner(parent, {
      noticesService: fake.service as unknown as NoticesService,
      telemetry: makeFakeTelemetry(),
      onOpenDetail: () => {},
    });
    banner.render();

    expect(parent.querySelector('.nb-close')).not.toBeNull();
    banner.destroy();
  });

  it('removes the banner DOM when getVisibleNotice() returns null', () => {
    const fake = makeFakeNoticesService(makeNotice());
    const banner = new NoticeBanner(parent, {
      noticesService: fake.service as unknown as NoticesService,
      telemetry: makeFakeTelemetry(),
      onOpenDetail: () => {},
    });
    banner.render();
    expect(parent.querySelector('.nb-banner')).not.toBeNull();

    fake.visible = null;
    banner.render();
    expect(parent.querySelector('.nb-banner')).toBeNull();
    banner.destroy();
  });

  it('applies level-specific class', () => {
    const fake = makeFakeNoticesService(
      makeNotice({ level: 'warning' }),
    );
    const banner = new NoticeBanner(parent, {
      noticesService: fake.service as unknown as NoticesService,
      telemetry: makeFakeTelemetry(),
      onOpenDetail: () => {},
    });
    banner.render();
    const bannerEl = parent.querySelector('.nb-banner');
    expect(bannerEl?.classList.contains('nb-level-warning')).toBe(true);
    banner.destroy();
  });
});

// ----------------------------------------------------------------------------
// Telemetry de-dupe
// ----------------------------------------------------------------------------

describe('NoticeBanner — telemetry', () => {
  let parent: HTMLElement;

  beforeEach(() => {
    parent = document.createElement('div');
    document.body.appendChild(parent);
  });

  afterEach(() => {
    parent.remove();
  });

  it('fires impression once per (notice id, session) even on re-render', () => {
    const fake = makeFakeNoticesService(makeNotice());
    const telemetry = makeFakeTelemetry();
    const banner = new NoticeBanner(parent, {
      noticesService: fake.service as unknown as NoticesService,
      telemetry,
      onOpenDetail: () => {},
    });
    banner.render();
    banner.render();
    banner.render();
    fake.fire();

    expect(telemetry.trackImpression).toHaveBeenCalledTimes(1);
    banner.destroy();
  });

  it('fires impression separately for distinct notice ids', () => {
    const fake = makeFakeNoticesService(makeNotice({ id: 'a' }));
    const telemetry = makeFakeTelemetry();
    const banner = new NoticeBanner(parent, {
      noticesService: fake.service as unknown as NoticesService,
      telemetry,
      onOpenDetail: () => {},
    });
    banner.render();
    fake.visible = makeNotice({ id: 'b' });
    banner.render();

    expect(telemetry.trackImpression).toHaveBeenCalledTimes(2);
    banner.destroy();
  });

  it('fires dismissed telemetry on X button click', () => {
    const fake = makeFakeNoticesService(makeNotice({ dismissPolicy: 'per_id_local' }));
    const telemetry = makeFakeTelemetry();
    const banner = new NoticeBanner(parent, {
      noticesService: fake.service as unknown as NoticesService,
      telemetry,
      onOpenDetail: () => {},
    });
    banner.render();
    parent.querySelector<HTMLButtonElement>('.nb-close')!.click();

    expect(telemetry.trackDismissed).toHaveBeenCalledTimes(1);
    expect(fake.dismiss).toHaveBeenCalledWith('notice-1');
    banner.destroy();
  });

  it('opens the detail modal when title-bearing notice is clicked', () => {
    const fake = makeFakeNoticesService(makeNotice({ title: 'Hi', body: 'hello' }));
    const telemetry = makeFakeTelemetry();
    const onOpenDetail = vi.fn();
    const banner = new NoticeBanner(parent, {
      noticesService: fake.service as unknown as NoticesService,
      telemetry,
      onOpenDetail,
    });
    banner.render();
    parent.querySelector<HTMLElement>('.nb-banner')!.click();

    expect(onOpenDetail).toHaveBeenCalledTimes(1);
    // CTA telemetry must NOT fire from a title-banner click — the modal
    // owns the CTA telemetry so cancels don't get counted.
    expect(telemetry.trackCtaClicked).not.toHaveBeenCalled();
    banner.destroy();
  });

  it('fires CTA telemetry directly when titleless notice with CTA is clicked', () => {
    const fake = makeFakeNoticesService(
      makeNotice({
        body: 'titleless',
        cta: { label: 'Got it', action: 'dismiss' },
      }),
    );
    const telemetry = makeFakeTelemetry();
    const banner = new NoticeBanner(parent, {
      noticesService: fake.service as unknown as NoticesService,
      telemetry,
      onOpenDetail: () => {},
    });
    banner.render();
    parent.querySelector<HTMLElement>('.nb-banner')!.click();

    expect(telemetry.trackCtaClicked).toHaveBeenCalledTimes(1);
    expect(fake.dismiss).toHaveBeenCalledWith('notice-1');
    banner.destroy();
  });

  it('does not fire CTA telemetry when titleless notice without CTA is clicked', () => {
    const fake = makeFakeNoticesService(makeNotice({ body: 'no cta' }));
    const telemetry = makeFakeTelemetry();
    const banner = new NoticeBanner(parent, {
      noticesService: fake.service as unknown as NoticesService,
      telemetry,
      onOpenDetail: () => {},
    });
    banner.render();
    parent.querySelector<HTMLElement>('.nb-banner')!.click();
    expect(telemetry.trackCtaClicked).not.toHaveBeenCalled();
    banner.destroy();
  });
});

// ----------------------------------------------------------------------------
// executeCta()
// ----------------------------------------------------------------------------

describe('executeCta', () => {
  let originalOpen: typeof window.open;
  let openSpy: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalOpen = window.open;
    openSpy = vi.fn();
    // jsdom's window.open returns a stubbed Window; replace it entirely.
    Object.defineProperty(window, 'open', {
      configurable: true,
      writable: true,
      value: openSpy,
    });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(window, 'open', {
      configurable: true,
      writable: true,
      value: originalOpen,
    });
    warnSpy.mockRestore();
  });

  it('open_url opens https URLs in a new tab', () => {
    const dismiss = vi.fn();
    executeCta(
      makeNotice({
        cta: { label: 'go', action: 'open_url', url: 'https://example.com/x' },
      }),
      { noticesService: { dismiss } as unknown as NoticesService },
    );
    expect(openSpy).toHaveBeenCalledWith('https://example.com/x', '_blank');
  });

  it('open_url accepts sa:// scheme', () => {
    const dismiss = vi.fn();
    executeCta(
      makeNotice({
        cta: { label: 'open', action: 'open_url', url: 'sa://share/abc' },
      }),
      { noticesService: { dismiss } as unknown as NoticesService },
    );
    expect(openSpy).toHaveBeenCalledWith('sa://share/abc', '_blank');
  });

  it('open_url rejects http:// (not in allowlist)', () => {
    const dismiss = vi.fn();
    executeCta(
      makeNotice({
        cta: { label: 'go', action: 'open_url', url: 'http://example.com' },
      }),
      { noticesService: { dismiss } as unknown as NoticesService },
    );
    expect(openSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('open_url rejects javascript: scheme', () => {
    const dismiss = vi.fn();
    executeCta(
      makeNotice({
        cta: { label: 'go', action: 'open_url', url: 'javascript:alert(1)' },
      }),
      { noticesService: { dismiss } as unknown as NoticesService },
    );
    expect(openSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('open_url rejects malformed URL', () => {
    const dismiss = vi.fn();
    executeCta(
      makeNotice({
        cta: { label: 'go', action: 'open_url', url: 'not a url' },
      }),
      { noticesService: { dismiss } as unknown as NoticesService },
    );
    expect(openSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('open_paywall opens the smart-landing URL with from=plugin and en lang', () => {
    const dismiss = vi.fn();
    Object.defineProperty(navigator, 'language', {
      configurable: true,
      get: () => 'en-US',
    });
    executeCta(
      makeNotice({
        cta: { label: 'Get it', action: 'open_paywall' },
      }),
      { noticesService: { dismiss } as unknown as NoticesService },
    );
    expect(openSpy).toHaveBeenCalledWith(
      'https://social-archive.org/get-mobile?from=plugin&lang=en',
      '_blank',
    );
  });

  it('open_paywall uses ko lang when navigator.language starts with ko', () => {
    const dismiss = vi.fn();
    Object.defineProperty(navigator, 'language', {
      configurable: true,
      get: () => 'ko-KR',
    });
    executeCta(
      makeNotice({
        cta: { label: 'Get it', action: 'open_paywall' },
      }),
      { noticesService: { dismiss } as unknown as NoticesService },
    );
    expect(openSpy).toHaveBeenCalledWith(
      'https://social-archive.org/get-mobile?from=plugin&lang=ko',
      '_blank',
    );
  });

  it('open_paywall does NOT read cta.url from payload', () => {
    const dismiss = vi.fn();
    Object.defineProperty(navigator, 'language', {
      configurable: true,
      get: () => 'en',
    });
    executeCta(
      makeNotice({
        cta: {
          label: 'Get it',
          action: 'open_paywall',
          // Even if the server somehow sends a url, we ignore it.
          url: 'https://malicious.example/x' as string,
        },
      }),
      { noticesService: { dismiss } as unknown as NoticesService },
    );
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('social-archive.org/get-mobile'),
      '_blank',
    );
    expect(openSpy).not.toHaveBeenCalledWith(
      'https://malicious.example/x',
      expect.anything(),
    );
  });

  it('open_rewards is a no-op and logs a warning (no throw)', () => {
    const dismiss = vi.fn();
    expect(() =>
      executeCta(
        makeNotice({
          cta: { label: 'Rewards', action: 'open_rewards' },
        }),
        { noticesService: { dismiss } as unknown as NoticesService },
      ),
    ).not.toThrow();
    expect(openSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('open_rewards is unsupported'),
    );
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('dismiss action calls noticesService.dismiss', () => {
    const dismiss = vi.fn();
    executeCta(
      makeNotice({ id: 'X', cta: { label: 'OK', action: 'dismiss' } }),
      { noticesService: { dismiss } as unknown as NoticesService },
    );
    expect(dismiss).toHaveBeenCalledWith('X');
  });

  it('dismissPolicy=on_cta_local triggers dismiss after CTA fires', () => {
    const dismiss = vi.fn();
    Object.defineProperty(navigator, 'language', {
      configurable: true,
      get: () => 'en',
    });
    executeCta(
      makeNotice({
        id: 'OC',
        dismissPolicy: 'on_cta_local',
        cta: { label: 'Get', action: 'open_paywall' },
      }),
      { noticesService: { dismiss } as unknown as NoticesService },
    );
    expect(dismiss).toHaveBeenCalledWith('OC');
  });

  it('dismissPolicy=per_id_local does not auto-dismiss after CTA', () => {
    const dismiss = vi.fn();
    Object.defineProperty(navigator, 'language', {
      configurable: true,
      get: () => 'en',
    });
    executeCta(
      makeNotice({
        id: 'PID',
        dismissPolicy: 'per_id_local',
        cta: { label: 'Get', action: 'open_paywall' },
      }),
      { noticesService: { dismiss } as unknown as NoticesService },
    );
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('does nothing when notice has no cta', () => {
    const dismiss = vi.fn();
    executeCta(
      makeNotice({ cta: undefined }),
      { noticesService: { dismiss } as unknown as NoticesService },
    );
    expect(openSpy).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
  });
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

describe('noticeLevelIcon / noticeLevelLabel', () => {
  it('returns distinct icons per level', () => {
    expect(noticeLevelIcon('info')).toBe('info');
    expect(noticeLevelIcon('success')).toBe('check');
    expect(noticeLevelIcon('warning')).toBe('alert-triangle');
    expect(noticeLevelIcon('error')).toBe('x-circle');
  });

  it('returns human-readable labels per level', () => {
    expect(noticeLevelLabel('info')).toBe('Notice');
    expect(noticeLevelLabel('warning')).toBe('Heads up');
    expect(noticeLevelLabel('error')).toBe('Important');
    expect(noticeLevelLabel('success')).toBe('Success');
  });
});
