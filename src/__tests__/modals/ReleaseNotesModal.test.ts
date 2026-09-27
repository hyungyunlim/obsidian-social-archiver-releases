import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `setIcon` is not part of the default obsidian mock.
vi.mock('obsidian', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('obsidian');
  return {
    ...actual,
    setIcon: (el: HTMLElement, iconName: string) => el.setAttribute('data-icon', iconName),
  };
});

import { Platform } from 'obsidian';
import { ReleaseNotesModal } from '../../modals/ReleaseNotesModal';
import type { ReleaseNoteUpdate } from '../../plugin/release-notes/releaseNoteUpdates';

function update(version: string, important = false): ReleaseNoteUpdate {
  return {
    id: `obsidian-${version}`,
    version,
    dateLabel: `Date ${version}`,
    title: `Title ${version}`,
    summary: `Summary ${version}`,
    highlights: [`First ${version}`, `Second ${version}`],
    important,
    url: `https://social-archive.org/release-notes?platform=obsidian#${version}`,
  };
}

const THREE = () => [update('4.7.9'), update('4.7.10', true), update('4.7.11')];

function open(entries: ReleaseNoteUpdate[], onClose = vi.fn()) {
  const modal = new ReleaseNotesModal({} as never, entries, onClose);
  modal.open();
  const el = modal.contentEl;
  const text = (selector: string) => el.querySelector(selector)?.textContent ?? null;
  const button = (label: string) =>
    el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const tabs = () => [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const selectedTab = () => tabs().find((tab) => tab.getAttribute('aria-selected') === 'true');
  return { modal, el, text, button, tabs, selectedTab, onClose };
}

function press(element: Element | null | undefined, key: string): void {
  element?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

describe('ReleaseNotesModal', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('on desktop', () => {
    it('lists the skipped releases beside the newest one', () => {
      const { modal, el, text, button, tabs, selectedTab } = open(THREE());

      expect(modal.modalEl.classList.contains('sa-release-notes-modal--wide')).toBe(true);
      expect(modal.containerEl.classList.contains('sa-release-notes-container')).toBe(true);
      expect(tabs().map((tab) => tab.querySelector('.sa-release-notes-tab-version')?.textContent)).toEqual([
        'v4.7.11',
        'v4.7.10',
        'v4.7.9',
      ]);
      expect(selectedTab()?.id).toBe('sa-release-notes-tab-2');
      expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
      expect(tabs()[1]?.querySelector('.sa-release-notes-badge')?.textContent).toBe('Important');
      expect(el.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(selectedTab()?.id);

      expect(text('.sa-release-notes-summary')).toBe('Summary 4.7.11');
      // The hub headline is not repeated in the modal.
      expect(el.textContent).not.toContain('Title 4.7.11');
      expect(text('.sa-release-notes-meta .sa-release-notes-version')).toBe('v4.7.11');
      expect(text('.sa-release-notes-meta .sa-release-notes-date')).toBe('Date 4.7.11');
      expect([...el.querySelectorAll('.sa-release-notes-content li')].map((li) => li.textContent)).toEqual([
        'First 4.7.11',
        'Second 4.7.11',
      ]);
      // The list is the navigation: no pager.
      expect(button('Previous update')).toBeNull();
      expect(text('.sa-release-notes-position')).toBeNull();
      expect(el.querySelector<HTMLAnchorElement>('.sa-release-notes-link')?.href).toContain('#4.7.11');
    });

    it('shows an older release when its row is picked', () => {
      const { el, text, tabs, selectedTab } = open(THREE());

      tabs()[1]?.click();

      expect(text('.sa-release-notes-summary')).toBe('Summary 4.7.10');
      expect(text('.sa-release-notes-meta .sa-release-notes-badge')).toBe('Important');
      expect(selectedTab()?.id).toBe('sa-release-notes-tab-1');
      expect(el.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(
        'sa-release-notes-tab-1'
      );
      expect(el.querySelector<HTMLAnchorElement>('.sa-release-notes-link')?.href).toContain('#4.7.10');
    });

    it('moves through the list with the arrow keys, Home and End', () => {
      const { text, selectedTab } = open(THREE());
      selectedTab()?.focus();

      press(selectedTab(), 'ArrowDown');
      expect(text('.sa-release-notes-summary')).toBe('Summary 4.7.10');
      expect(document.activeElement).toBe(selectedTab());

      press(selectedTab(), 'End');
      expect(text('.sa-release-notes-summary')).toBe('Summary 4.7.9');
      expect(document.activeElement).toBe(selectedTab());

      press(selectedTab(), 'ArrowDown');
      expect(text('.sa-release-notes-summary')).toBe('Summary 4.7.9');

      press(selectedTab(), 'Home');
      expect(text('.sa-release-notes-summary')).toBe('Summary 4.7.11');
      expect(document.activeElement).toBe(selectedTab());
    });

    it('shows a single release without a list or pager', () => {
      const { modal, el, text, button } = open([update('4.7.11')]);

      expect(modal.modalEl.classList.contains('sa-release-notes-modal--wide')).toBe(true);
      expect(modal.containerEl.classList.contains('sa-release-notes-container')).toBe(false);
      expect(el.querySelector('[role="tablist"]')).toBeNull();
      expect(el.querySelector('[role="tabpanel"]')).toBeNull();
      expect(button('Previous update')).toBeNull();
      expect(text('.sa-release-notes-summary')).toBe('Summary 4.7.11');
    });

    it('reports the close once Got it is pressed', () => {
      const { el, onClose } = open([update('4.7.11')]);

      el.querySelector<HTMLButtonElement>('button.mod-cta')?.click();

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('on a phone', () => {
    beforeEach(() => {
      Object.assign(Platform, { isMobile: true, isPhone: true });
    });

    afterEach(() => {
      Object.assign(Platform, { isMobile: false, isPhone: false });
    });

    it('opens on the newest release with the rest reachable backwards', () => {
      const { modal, el, text, button } = open(THREE());

      expect(modal.modalEl.classList.contains('am-modal--mobile')).toBe(true);
      expect(modal.modalEl.classList.contains('sa-release-notes-modal--wide')).toBe(false);
      expect(el.querySelector('[role="tablist"]')).toBeNull();
      expect(text('.sa-release-notes-summary')).toBe('Summary 4.7.11');
      expect(text('.sa-release-notes-version')).toBe('v4.7.11');
      expect(text('.sa-release-notes-position')).toBe('3 / 3');
      expect(button('Previous update')?.disabled).toBe(false);
      expect(button('Next update')?.disabled).toBe(true);
    });

    it('pages back through skipped releases and forward again', () => {
      const { text, button } = open(THREE());

      button('Previous update')?.click();
      expect(text('.sa-release-notes-summary')).toBe('Summary 4.7.10');
      expect(text('.sa-release-notes-position')).toBe('2 / 3');
      expect(text('.sa-release-notes-badge')).toBe('Important');

      button('Previous update')?.click();
      expect(text('.sa-release-notes-summary')).toBe('Summary 4.7.9');
      expect(button('Previous update')?.disabled).toBe(true);
      expect(text('.sa-release-notes-badge')).toBeNull();

      button('Next update')?.click();
      expect(text('.sa-release-notes-summary')).toBe('Summary 4.7.10');
      expect(button('Next update')?.disabled).toBe(false);
    });

    it('keeps focus on the pager when paging reaches the oldest release', () => {
      const { button } = open([update('4.7.10'), update('4.7.11')]);
      const previous = button('Previous update');
      previous?.focus();

      previous?.click();

      expect(previous?.disabled).toBe(true);
      expect(document.activeElement).toBe(button('Next update'));
    });
  });
});
