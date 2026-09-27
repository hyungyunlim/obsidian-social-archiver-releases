import { App, Modal, Platform, setIcon } from 'obsidian';
import { t } from '../i18n';
import type { ReleaseNoteUpdate } from '../plugin/release-notes/releaseNoteUpdates';

/**
 * "What's new" after a plugin update, opening on the newest release. When
 * several releases were skipped, wider screens list them beside the text
 * (newest first), like the desktop app; phones page one at a time with
 * Previous/Next, like the mobile app.
 *
 * Same content as the mobile and desktop apps: a one-line header (What's new ·
 * version · date · Important), the summary as the lead, highlights, a link to
 * the entry on the release notes page, and Got it. The hub entry's headline is
 * left out — the header names the release and the summary opens with the
 * gist. Copy is plain text (setText), never HTML.
 */
export class ReleaseNotesModal extends Modal {
  private readonly entries: ReleaseNoteUpdate[];
  private readonly onCloseCallback?: () => void;
  private index: number;

  private positionEl?: HTMLElement;
  private metaEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private linkEl!: HTMLAnchorElement;
  private previousButton?: HTMLButtonElement;
  private nextButton?: HTMLButtonElement;
  /** Index-aligned with `entries`; empty without the list. */
  private readonly tabs: HTMLButtonElement[] = [];

  constructor(app: App, entries: ReleaseNoteUpdate[], onCloseCallback?: () => void) {
    super(app);
    this.entries = entries;
    this.onCloseCallback = onCloseCallback;
    this.index = entries.length - 1;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    modalEl.addClass('social-archiver-modal', 'sa-release-notes-modal');
    modalEl.addClass(Platform.isMobile ? 'am-modal--mobile' : 'sa-release-notes-modal--wide');
    modalEl.setAttribute('aria-labelledby', 'sa-release-notes-title');
    const withList = this.entries.length > 1 && !Platform.isPhone;

    const header = contentEl.createDiv({ cls: 'sa-release-notes-header' });
    header.createSpan({
      cls: 'sa-release-notes-eyebrow',
      text: t('rn.eyebrow'),
      attr: { id: 'sa-release-notes-title' },
    });
    this.metaEl = header.createDiv({ cls: 'sa-release-notes-meta' });

    const main = contentEl.createDiv({ cls: 'sa-release-notes-main' });
    if (withList) {
      main.addClass('mod-list');
      // The height follows the shown release; anchoring at the top keeps the
      // header and list still while it changes.
      this.containerEl.addClass('sa-release-notes-container');
      this.createList(main);
    }
    this.bodyEl = main.createDiv({
      cls: 'sa-release-notes-content',
      // Focusable so the keyboard can scroll long notes.
      attr: withList ? { id: 'sa-release-notes-panel', role: 'tabpanel', tabindex: '0' } : {},
    });

    const footer = contentEl.createDiv({ cls: 'sa-release-notes-footer' });
    if (this.entries.length > 1) {
      if (!withList) {
        const pager = footer.createDiv({ cls: 'sa-release-notes-pager' });
        this.previousButton = this.createPageButton(pager, 'chevron-left', t('rn.previous'), -1);
        this.positionEl = pager.createSpan({ cls: 'sa-release-notes-position' });
        this.nextButton = this.createPageButton(pager, 'chevron-right', t('rn.next'), 1);
      }
      this.scope.register([], 'ArrowLeft', () => this.go(-1));
      this.scope.register([], 'ArrowRight', () => this.go(1));
    }
    this.linkEl = footer.createEl('a', {
      cls: 'external-link sa-release-notes-link',
      text: t('rn.openHub'),
      attr: { target: '_blank', rel: 'noopener' },
    });
    const doneButton = footer.createEl('button', { cls: 'mod-cta', text: t('rn.done') });
    doneButton.addEventListener('click', () => this.close());

    this.showPage();
    doneButton.focus();
  }

  onClose(): void {
    this.contentEl.empty();
    this.onCloseCallback?.();
  }

  /** A vertical tablist, newest first; ↑/↓ and Home/End move in list order. */
  private createList(parent: HTMLElement): void {
    const list = parent.createDiv({
      cls: 'sa-release-notes-list',
      attr: { role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': t('rn.releases') },
    });
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (!entry) continue;
      const tab = list.createEl('button', {
        cls: 'sa-release-notes-tab',
        attr: {
          type: 'button',
          role: 'tab',
          id: `sa-release-notes-tab-${i}`,
          'aria-controls': 'sa-release-notes-panel',
        },
      });
      tab.createSpan({ cls: 'sa-release-notes-tab-version', text: `v${entry.version}` });
      if (entry.important) {
        tab.createSpan({ cls: 'sa-release-notes-badge', text: t('rn.important') });
      }
      tab.createSpan({ cls: 'sa-release-notes-tab-date', text: entry.dateLabel });
      tab.addEventListener('click', () => this.select(i));
      this.tabs[i] = tab;
    }
    list.addEventListener('keydown', (event) => {
      const moves: Record<string, number> = {
        ArrowUp: this.index + 1,
        ArrowDown: this.index - 1,
        Home: this.entries.length - 1,
        End: 0,
      };
      const next = moves[event.key];
      if (next === undefined) return;
      event.preventDefault();
      this.select(next);
    });
  }

  private createPageButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    step: number
  ): HTMLButtonElement {
    const button = parent.createEl('button', {
      cls: 'clickable-icon sa-release-notes-page',
      attr: { 'aria-label': label, type: 'button' },
    });
    setIcon(button, icon);
    button.addEventListener('click', () => this.go(step));
    return button;
  }

  /** Returns false so Obsidian's scope treats the arrow key as handled. */
  private go(step: number): boolean {
    this.select(this.index + step);
    return false;
  }

  private select(next: number): void {
    if (next < 0 || next >= this.entries.length || next === this.index) return;
    this.index = next;
    this.showPage();
  }

  private showPage(): void {
    const entry = this.entries[this.index];
    if (!entry) return;
    const total = this.entries.length;

    this.positionEl?.setText(t('rn.position', { index: this.index + 1, total }));

    this.metaEl.empty();
    if (entry.important) {
      this.metaEl.createSpan({ cls: 'sa-release-notes-badge', text: t('rn.important') });
    }
    this.metaEl.createSpan({ cls: 'sa-release-notes-version', text: `v${entry.version}` });
    this.metaEl.createSpan({ text: '·', attr: { 'aria-hidden': 'true' } });
    this.metaEl.createSpan({ cls: 'sa-release-notes-date', text: entry.dateLabel });

    this.bodyEl.empty();
    this.bodyEl.createEl('p', { cls: 'sa-release-notes-summary', text: entry.summary });
    const list = this.bodyEl.createEl('ul');
    for (const highlight of entry.highlights) list.createEl('li', { text: highlight });

    this.linkEl.href = entry.url;

    if (this.tabs.length > 0) {
      const tabHadFocus = this.tabs.some((tab) => tab === activeDocument.activeElement);
      this.tabs.forEach((tab, i) => {
        tab.setAttribute('aria-selected', String(i === this.index));
        tab.tabIndex = i === this.index ? 0 : -1;
      });
      this.bodyEl.setAttribute('aria-labelledby', `sa-release-notes-tab-${this.index}`);
      // Keyboard focus follows the selection when it came from the list.
      if (tabHadFocus) this.tabs[this.index]?.focus();
    }

    if (this.previousButton && this.nextButton) {
      const wasFocused = activeDocument.activeElement;
      this.previousButton.disabled = this.index === 0;
      this.nextButton.disabled = this.index === total - 1;
      // Paging to either end disables the button under focus; keep keyboard
      // focus on the pager instead of dropping it to the document.
      if (wasFocused instanceof HTMLButtonElement && wasFocused.disabled) {
        (wasFocused === this.previousButton ? this.nextButton : this.previousButton).focus();
      }
    }

    this.modalEl.scrollTop = 0;
    this.bodyEl.scrollTop = 0;
  }
}
