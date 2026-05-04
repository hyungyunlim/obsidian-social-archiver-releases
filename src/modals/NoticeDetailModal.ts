/**
 * NoticeDetailModal — full-detail view for a notice with a `title`.
 *
 * Banner-only notices (no title) skip this modal entirely; the inline
 * banner row renders the body and tap fires the CTA directly. When a
 * notice carries a `title`, the banner shows only the title, and tapping
 * pops this modal so the body has room to breathe and the CTA gets a
 * dedicated button.
 *
 * Header: pill-shaped eyebrow with level icon + concise label, plus a
 *         close X.
 * Body:   scrollable plain-text body (rendered via setText only —
 *         never as HTML, per PRD §"Security And Policy").
 * Action: primary button (`cta.label`) when CTA present, otherwise a
 *         secondary "Close" button.
 *
 * CTA telemetry is owned by this modal (not the banner) so a user who
 * opens but cancels does not get counted as a CTA click.
 *
 * Spec: `.taskmaster/docs/prd-in-app-notice-channel-plugin.md`
 */

import { App, Modal, setIcon } from 'obsidian';
import {
  executeCta,
  noticeLevelIcon,
  noticeLevelLabel,
} from '../components/timeline/NoticeBanner';
import type { NoticePayloadV1 } from '../types/notices';
import type { NoticesService } from '../services/NoticesService';
import type { NoticeTelemetryService } from '../services/NoticeTelemetryService';

export interface NoticeDetailModalDeps {
  telemetry: NoticeTelemetryService;
  noticesService: NoticesService;
}

export class NoticeDetailModal extends Modal {
  private readonly notice: NoticePayloadV1;
  private readonly deps: NoticeDetailModalDeps;

  constructor(app: App, notice: NoticePayloadV1, deps: NoticeDetailModalDeps) {
    super(app);
    this.notice = notice;
    this.deps = deps;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();

    modalEl.addClass('social-archiver-modal', 'nb-modal');
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');

    this.renderHeader(contentEl);

    const title = this.notice.title?.trim();
    if (title) {
      const titleEl = contentEl.createEl('h2', {
        cls: 'nb-modal-title',
        text: title,
      });
      titleEl.id = 'nb-modal-title';
      modalEl.setAttribute('aria-labelledby', 'nb-modal-title');
    }

    // Body — plain text only. Setting `textContent` prevents arbitrary
    // HTML rendering even though the server validates copy on admin
    // write (PRD §Security).
    const bodyEl = contentEl.createEl('div', { cls: 'nb-modal-body' });
    bodyEl.textContent = this.notice.body;

    contentEl.createEl('div', { cls: 'nb-modal-divider' });

    this.renderActions(contentEl);

    // Allow ESC to close — Obsidian Modal hooks scope.register via base
    // class but we add Enter as a quick-close affordance.
    this.scope.register([], 'Escape', () => {
      this.close();
      return false;
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  private renderHeader(contentEl: HTMLElement): void {
    // Obsidian's Modal base class auto-renders a close (×) button in the
    // top-right of `modalEl`, so we render only the eyebrow chip in our
    // header and rely on the platform affordance for closing.
    const header = contentEl.createDiv({ cls: 'nb-modal-header' });

    const eyebrow = header.createDiv({
      cls: `nb-modal-eyebrow nb-level-${this.notice.level}`,
    });
    const eyebrowIcon = eyebrow.createSpan();
    setIcon(eyebrowIcon, noticeLevelIcon(this.notice.level));
    eyebrow.createSpan({
      cls: 'nb-modal-eyebrow-label',
      text: noticeLevelLabel(this.notice.level),
    });
  }

  private renderActions(contentEl: HTMLElement): void {
    const actions = contentEl.createDiv({ cls: 'nb-modal-actions' });
    const cta = this.notice.cta;

    if (cta) {
      const primary = actions.createEl('button', {
        cls: 'nb-modal-button nb-modal-button-primary mod-cta',
        text: cta.label,
      });
      primary.addEventListener('click', () => {
        // Telemetry for the CTA fires here so cancels don't inflate the
        // click count.
        this.deps.telemetry.trackCtaClicked(this.notice);
        executeCta(this.notice, { noticesService: this.deps.noticesService });
        this.close();
      });
      // Focus the primary button for keyboard accessibility.
      primary.focus();
    } else {
      const closeBtn = actions.createEl('button', {
        cls: 'nb-modal-button nb-modal-button-secondary',
        text: 'Close',
      });
      closeBtn.addEventListener('click', () => {
        this.close();
      });
      closeBtn.focus();
    }
  }
}
