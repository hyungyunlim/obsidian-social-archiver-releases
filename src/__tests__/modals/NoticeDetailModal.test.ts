/**
 * NoticeDetailModal unit tests.
 *
 * Coverage:
 *   - Renders title, body, and primary CTA button (when CTA present).
 *   - Renders Close button when no CTA present.
 *   - Primary button click fires CTA telemetry then runs the action and
 *     closes the modal.
 *   - Modal close (X / secondary) does not fire CTA telemetry.
 *   - Body uses setText (no HTML execution from notice body).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// `setIcon` is not part of the default obsidian mock — provide a stub so
// the modal's onOpen() doesn't crash when it injects level icons.
vi.mock('obsidian', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('obsidian');
  return {
    ...actual,
    setIcon: (el: HTMLElement, iconName: string) => {
      el.setAttribute('data-icon', iconName);
    },
  };
});

import { NoticeDetailModal } from '../../modals/NoticeDetailModal';
import type { NoticePayloadV1 } from '../../types/notices';
import type { NoticesService } from '../../services/NoticesService';
import type { NoticeTelemetryService } from '../../services/NoticeTelemetryService';

function makeNotice(overrides: Partial<NoticePayloadV1> = {}): NoticePayloadV1 {
  return {
    schemaVersion: 1,
    id: 'modal-test-1',
    surface: 'top_banner',
    priority: 0,
    level: 'warning',
    title: 'Maintenance window',
    body: 'We will be down briefly.',
    dismissPolicy: 'on_cta_local',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    trackingKey: 'tk-modal',
    ...overrides,
  };
}

function makeFakeTelemetry(): NoticeTelemetryService {
  return {
    trackImpression: vi.fn(),
    trackCtaClicked: vi.fn(),
    trackDismissed: vi.fn(),
  } as unknown as NoticeTelemetryService;
}

function makeFakeNoticesService(): Pick<NoticesService, 'dismiss'> & { dismissMock: ReturnType<typeof vi.fn> } {
  const dismiss = vi.fn(async () => {});
  return {
    dismiss,
    dismissMock: dismiss,
  } as unknown as Pick<NoticesService, 'dismiss'> & { dismissMock: ReturnType<typeof vi.fn> };
}

describe('NoticeDetailModal', () => {
  let originalOpen: typeof window.open;
  let openSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalOpen = window.open;
    openSpy = vi.fn();
    Object.defineProperty(window, 'open', {
      configurable: true,
      writable: true,
      value: openSpy,
    });
    Object.defineProperty(navigator, 'language', {
      configurable: true,
      get: () => 'en-US',
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'open', {
      configurable: true,
      writable: true,
      value: originalOpen,
    });
  });

  it('renders title, body, and primary CTA when CTA is present', () => {
    const telemetry = makeFakeTelemetry();
    const noticesService = makeFakeNoticesService();
    const notice = makeNotice({
      cta: { label: 'Get the app', action: 'open_paywall' },
    });
    const modal = new NoticeDetailModal({}, notice, {
      telemetry,
      noticesService: noticesService as unknown as NoticesService,
    });
    modal.open();

    const title = modal.contentEl.querySelector('.nb-modal-title');
    const body = modal.contentEl.querySelector('.nb-modal-body');
    const primary = modal.contentEl.querySelector('.nb-modal-button-primary');

    expect(title?.textContent).toBe('Maintenance window');
    expect(body?.textContent).toBe('We will be down briefly.');
    expect(primary?.textContent).toBe('Get the app');
    modal.close();
  });

  it('renders a Close button when no CTA is present', () => {
    const telemetry = makeFakeTelemetry();
    const noticesService = makeFakeNoticesService();
    const notice = makeNotice({ cta: undefined });
    const modal = new NoticeDetailModal({}, notice, {
      telemetry,
      noticesService: noticesService as unknown as NoticesService,
    });
    modal.open();

    expect(modal.contentEl.querySelector('.nb-modal-button-primary')).toBeNull();
    const secondary = modal.contentEl.querySelector('.nb-modal-button-secondary');
    expect(secondary?.textContent).toBe('Close');
    modal.close();
  });

  it('primary CTA button fires telemetry, runs the action, and closes the modal', () => {
    const telemetry = makeFakeTelemetry();
    const noticesService = makeFakeNoticesService();
    const notice = makeNotice({
      cta: { label: 'Open', action: 'open_paywall' },
    });
    const modal = new NoticeDetailModal({}, notice, {
      telemetry,
      noticesService: noticesService as unknown as NoticesService,
    });
    const closeSpy = vi.spyOn(modal, 'close');
    modal.open();

    const primary = modal.contentEl.querySelector<HTMLButtonElement>(
      '.nb-modal-button-primary',
    )!;
    primary.click();

    expect(telemetry.trackCtaClicked).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('social-archive.org/get-mobile'),
      '_blank',
    );
    expect(closeSpy).toHaveBeenCalled();
  });

  it('secondary Close button does NOT fire CTA telemetry', () => {
    const telemetry = makeFakeTelemetry();
    const noticesService = makeFakeNoticesService();
    const notice = makeNotice({ cta: undefined });
    const modal = new NoticeDetailModal({}, notice, {
      telemetry,
      noticesService: noticesService as unknown as NoticesService,
    });
    modal.open();
    modal.contentEl.querySelector<HTMLButtonElement>(
      '.nb-modal-button-secondary',
    )!.click();
    expect(telemetry.trackCtaClicked).not.toHaveBeenCalled();
  });

  it('header renders only the eyebrow chip (Obsidian Modal owns the X close)', () => {
    const telemetry = makeFakeTelemetry();
    const noticesService = makeFakeNoticesService();
    const notice = makeNotice({
      cta: { label: 'Open', action: 'open_paywall' },
    });
    const modal = new NoticeDetailModal({}, notice, {
      telemetry,
      noticesService: noticesService as unknown as NoticesService,
    });
    modal.open();
    // Our header should not duplicate Obsidian's built-in close button.
    expect(modal.contentEl.querySelector('.nb-modal-close')).toBeNull();
    expect(modal.contentEl.querySelector('.nb-modal-eyebrow')).not.toBeNull();
  });

  it('renders body via setText (no HTML injection)', () => {
    const telemetry = makeFakeTelemetry();
    const noticesService = makeFakeNoticesService();
    const notice = makeNotice({
      title: undefined,
      body: '<script>window.__pwn = true;</script><b>html</b>',
    });
    const modal = new NoticeDetailModal({}, notice, {
      telemetry,
      noticesService: noticesService as unknown as NoticesService,
    });
    modal.open();
    const body = modal.contentEl.querySelector('.nb-modal-body')!;
    // textContent should be the literal source, no executed script.
    expect(body.textContent).toBe('<script>window.__pwn = true;</script><b>html</b>');
    expect(body.querySelector('script')).toBeNull();
    expect(body.querySelector('b')).toBeNull();
    modal.close();
  });

  it('renders eyebrow with the level label and class', () => {
    const telemetry = makeFakeTelemetry();
    const noticesService = makeFakeNoticesService();
    const notice = makeNotice({ level: 'error' });
    const modal = new NoticeDetailModal({}, notice, {
      telemetry,
      noticesService: noticesService as unknown as NoticesService,
    });
    modal.open();
    const eyebrow = modal.contentEl.querySelector('.nb-modal-eyebrow');
    expect(eyebrow?.classList.contains('nb-level-error')).toBe(true);
    expect(eyebrow?.querySelector('.nb-modal-eyebrow-label')?.textContent).toBe('Important');
    modal.close();
  });
});
