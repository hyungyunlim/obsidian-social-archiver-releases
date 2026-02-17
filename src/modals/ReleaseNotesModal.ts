import { Modal, App, MarkdownRenderer, Platform, Component } from 'obsidian';
import type { ReleaseNote } from '../release-notes';

/**
 * Release Notes Modal
 *
 * Displays release notes to users after plugin updates.
 * Uses Obsidian's native Modal with MarkdownRenderer for proper rendering.
 * Follows the same pattern as ArchiveModal and RedditSubscribeModal.
 */
export class ReleaseNotesModal extends Modal {
  private version: string;
  private releaseNote: ReleaseNote;
  private onCloseCallback?: () => void;
  private component: Component;

  constructor(
    app: App,
    version: string,
    releaseNote: ReleaseNote,
    onCloseCallback?: () => void
  ) {
    super(app);
    this.version = version;
    this.releaseNote = releaseNote;
    this.onCloseCallback = onCloseCallback;
    this.component = new Component();
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();

    // Load component for markdown rendering lifecycle
    this.component.load();

    // Add modal class for styling (same pattern as ArchiveModal)
    modalEl.addClass('social-archiver-modal', 'release-notes-modal');

    // ARIA attributes for accessibility
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.setAttribute('aria-labelledby', 'release-notes-title');

    // Mobile modal size adjustments (same as ArchiveModal)
    if (Platform.isMobile) {
      modalEl.addClass('am-modal--mobile');
      contentEl.addClass('rnm-content--mobile');
    }

    // Title with ARIA id
    const titleEl = contentEl.createEl('h2', {
      text: `Social Archiver — What's New in v${this.version}`,
      cls: 'release-notes-title',
    });
    titleEl.id = 'release-notes-title';

    // Important badge (inline with title)
    if (this.releaseNote.isImportant) {
      const badgeEl = titleEl.createSpan({ cls: 'release-notes-badge mod-cta' });
      badgeEl.textContent = 'Important';
    }

    // Date subtitle
    contentEl.createEl('p', {
      text: this.releaseNote.date,
      cls: 'release-notes-date setting-item-description',
    });

    // Content container with markdown
    const contentContainer = contentEl.createDiv({ cls: 'release-notes-content' });

    // Render markdown content
    MarkdownRenderer.render(
      this.app,
      this.releaseNote.notes.trim(),
      contentContainer,
      '',
      this.component
    );

    // iOS: Convert YouTube embeds to clickable links (embeds don't work on iOS)
    if (Platform.isMobile && !Platform.isAndroidApp) {
      this.convertYouTubeEmbedsToLinks(contentContainer);
    }

    // QR code block (if provided) — insert after the first section (before second h2)
    if (this.releaseNote.qrCode) {
      const { svgBase64, url, label } = this.releaseNote.qrCode;
      const qrContainer = document.createElement('div');
      qrContainer.className = 'release-notes-qr rnm-qr-container';

      const qrImg = qrContainer.createEl('img', {
        attr: { src: `data:image/svg+xml;base64,${svgBase64}`, alt: 'QR Code' },
      });
      const size = Platform.isMobile ? '110px' : '140px';
      qrImg.setCssProps({'--rnm-qr-size': size});
      qrImg.addClass('rnm-qr-image');

      const qrLink = qrContainer.createEl('a', {
        text: label,
        cls: 'external-link',
        attr: { href: url, target: '_blank' },
      });
      qrLink.addClass('rnm-qr-link');

      // Insert before the second h2 (after iOS section, before Performance section)
      const headings = contentContainer.querySelectorAll('h2');
      const secondHeading = headings.item(1);
      if (secondHeading) {
        secondHeading.before(qrContainer);
      } else {
        contentContainer.appendChild(qrContainer);
      }
    }

    // Footer with button
    const footerEl = contentEl.createDiv({ cls: 'release-notes-footer' });

    // Got it button - uses Obsidian's mod-cta class
    const buttonEl = footerEl.createEl('button', {
      text: 'Got it',
      cls: 'mod-cta',
    });
    buttonEl.addEventListener('click', () => this.close());

    // Focus button for keyboard accessibility
    buttonEl.focus();

    // Keyboard shortcuts
    this.scope.register([], 'Escape', () => {
      this.close();
      return false;
    });
    this.scope.register([], 'Enter', () => {
      this.close();
      return false;
    });
  }

  onClose(): void {
    const { contentEl } = this;

    // Unload component to prevent memory leaks
    this.component.unload();

    contentEl.empty();

    // Call the callback after modal closes
    if (this.onCloseCallback) {
      this.onCloseCallback();
    }
  }

  /**
   * Convert YouTube embeds/iframes to clickable links (for iOS compatibility)
   */
  private convertYouTubeEmbedsToLinks(container: HTMLElement): void {
    // Find YouTube iframes
    const iframes = container.querySelectorAll('iframe[src*="youtube"]');
    iframes.forEach((iframe) => {
      const src = iframe.getAttribute('src') || '';
      const videoId = src.match(/embed\/([^?]+)/)?.[1];
      if (videoId) {
        const link = document.createElement('a');
        link.href = `https://www.youtube.com/watch?v=${videoId}`;
        link.textContent = `Watch on YouTube`;
        link.className = 'external-link';
        link.setAttribute('target', '_blank');
        iframe.replaceWith(link);
      }
    });

    // Find any YouTube external embed elements (Obsidian's format)
    const externalEmbeds = container.querySelectorAll('.external-embed[src*="youtube"]');
    externalEmbeds.forEach((embed) => {
      const src = embed.getAttribute('src') || '';
      const link = document.createElement('a');
      link.href = src;
      link.textContent = `Watch on YouTube`;
      link.className = 'external-link';
      link.setAttribute('target', '_blank');
      embed.replaceWith(link);
    });
  }
}
