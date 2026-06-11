/**
 * ClipGuideModal — the 3-step "clip without an account" guide.
 *
 * Anonymous mode's design premise: installing the browser extension IS the
 * onboarding. The plugin alone cannot archive anything without an account,
 * so every logged-out surface funnels to this shared guide instead of a
 * dead-end login wall. Consumed by the timeline empty state, the settings
 * anonymous home card, and the archive modal capability guide.
 *
 * Steps:  install extension (Web Store CTA + guide link for non-Chrome) →
 *         clip a post → it appears in the timeline.
 * State:  the plugin cannot detect extension installation, but it CAN
 *         detect received clips — `settings.localClipCount > 0` swaps the
 *         marketing tagline for a "N clips saved locally" done-state line.
 * Footer: honest account upsell (URL archiving, sync, sharing) with an
 *         "Open settings" link to the auth form. No nags; the guide only
 *         appears when the user opens it from a CTA.
 *
 * Spec: `.taskmaster/docs/prd-plugin-anonymous-local-mode.md` (S1.2)
 */

import { Modal, Platform } from 'obsidian';
import type SocialArchiverPlugin from '../main';
import { BROWSER_EXTENSION_LINKS } from '../constants';

export class ClipGuideModal extends Modal {
  private readonly plugin: SocialArchiverPlugin;

  constructor(plugin: SocialArchiverPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();

    modalEl.addClass('social-archiver-modal', 'sa-clip-guide-modal');
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');

    contentEl.addClass('sa-clip-guide-content');

    const titleEl = contentEl.createEl('h2', {
      cls: 'sa-clip-guide-title',
      text: 'Clip from your browser',
    });
    titleEl.id = 'sa-clip-guide-title';
    modalEl.setAttribute('aria-labelledby', 'sa-clip-guide-title');

    this.renderStatusLine(contentEl);
    this.renderSteps(contentEl);
    this.renderFooter(contentEl);

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

  /**
   * Marketing tagline before the first clip; once `localClipCount > 0` the
   * guide has done its job, so swap to a quiet done-state counter instead.
   */
  private renderStatusLine(contentEl: HTMLElement): void {
    const clipCount = this.plugin.settings.localClipCount;

    if (clipCount > 0) {
      contentEl.createEl('p', {
        cls: 'sa-clip-guide-done',
        text: `${clipCount} ${clipCount === 1 ? 'clip' : 'clips'} saved locally so far`,
      });
      return;
    }

    contentEl.createEl('p', {
      cls: 'sa-clip-guide-tagline',
      text: 'Save posts straight to your vault — no account needed.',
    });
  }

  private renderSteps(contentEl: HTMLElement): void {
    const stepsEl = contentEl.createDiv({ cls: 'sa-clip-guide-steps' });

    // Step 1 — install, with the Web Store CTA as the modal's primary action.
    const installStep = this.createStep(stepsEl, '1');
    installStep.textEl.setText('Install the browser extension');

    if (Platform.isMobile) {
      // Extension is desktop-browser-only; hint without hiding the guide so
      // mobile users still learn the workflow exists.
      installStep.body.createEl('p', {
        cls: 'sa-clip-guide-mobile-hint',
        text: 'Clipping works from a desktop browser — install the extension on your computer.',
      });
    }

    const installActions = installStep.body.createDiv({ cls: 'sa-clip-guide-install-actions' });

    const installBtn = installActions.createEl('button', {
      cls: 'mod-cta sa-clip-guide-install-btn',
      text: 'Install from Chrome Web Store',
    });
    installBtn.addEventListener('click', () => {
      window.open(BROWSER_EXTENSION_LINKS.CHROME_WEB_STORE, '_blank');
    });

    const guideLink = installActions.createEl('a', {
      cls: 'sa-clip-guide-link',
      text: 'Extension guide',
    });
    guideLink.setAttr('href', BROWSER_EXTENSION_LINKS.GUIDE);
    guideLink.setAttr('target', '_blank');
    guideLink.setAttr('rel', 'noopener noreferrer');
    guideLink.setAttr('aria-label', 'Extension guide for non-Chrome browsers');

    // Step 2 — clip a post (action name emphasized like a UI label).
    const clipStep = this.createStep(stepsEl, '2');
    clipStep.textEl.appendText('Open a post (X, Instagram, Reddit, …) and click ');
    clipStep.textEl.createEl('em', { text: 'Clip to Obsidian' });

    // Step 3 — arrival.
    const arriveStep = this.createStep(stepsEl, '3');
    arriveStep.textEl.setText('Your clip appears in the timeline here — no account needed');
  }

  /**
   * Create one numbered step row; returns the body container (for actions or
   * hints below the step text) and the text element itself.
   */
  private createStep(
    stepsEl: HTMLElement,
    number: string
  ): { body: HTMLElement; textEl: HTMLElement } {
    const step = stepsEl.createDiv({ cls: 'sa-clip-guide-step' });
    step.createEl('span', { cls: 'sa-clip-guide-step-number', text: number });

    const body = step.createDiv({ cls: 'sa-clip-guide-step-body' });
    const textEl = body.createEl('span', { cls: 'sa-clip-guide-step-text' });
    return { body, textEl };
  }

  private renderFooter(contentEl: HTMLElement): void {
    const footer = contentEl.createEl('p', { cls: 'sa-clip-guide-footer' });
    footer.appendText('Archiving by URL, sync, and sharing need a free account. ');

    const settingsLink = footer.createEl('a', {
      cls: 'sa-clip-guide-footer-link',
      text: 'Open settings',
    });
    settingsLink.addEventListener('click', (event) => {
      event.preventDefault();
      this.close();
      this.openPluginSettings();
    });
  }

  private openPluginSettings(): void {
    // @ts-expect-error — app.setting is available at runtime but not in public Obsidian types
    (this.app.setting as { open: () => void; openTabById: (id: string) => void }).open();
    // @ts-expect-error — app.setting is available at runtime but not in public Obsidian types
    (this.app.setting as { open: () => void; openTabById: (id: string) => void }).openTabById(this.plugin.manifest.id);
  }
}
