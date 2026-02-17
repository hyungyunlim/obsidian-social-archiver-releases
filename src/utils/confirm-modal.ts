/**
 * Confirm Modal Utility
 *
 * Reusable confirmation dialog using Obsidian's native Modal class.
 * Can be used from both TypeScript and Svelte components.
 */

import { App, Modal, Platform, Setting } from 'obsidian';

export interface ConfirmModalOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmClass?: 'danger' | 'warning' | 'default';
}

export interface InputConfirmModalOptions extends ConfirmModalOptions {
  /** Text that must be typed to enable confirm button */
  requiredInput: string;
  /** Placeholder for input field */
  inputPlaceholder?: string;
  /** Label shown above input */
  inputLabel?: string;
}

/**
 * Show a confirmation modal dialog
 * Returns a Promise that resolves to true if confirmed, false if cancelled
 */
export function showConfirmModal(app: App, options: ConfirmModalOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new ConfirmModal(app, options, resolve);
    modal.open();
  });
}

/**
 * Show a confirmation modal with required text input
 * User must type the exact requiredInput text to enable the confirm button
 */
export function showInputConfirmModal(app: App, options: InputConfirmModalOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new InputConfirmModal(app, options, resolve);
    modal.open();
  });
}

/**
 * Confirmation Modal Class
 */
class ConfirmModal extends Modal {
  private options: ConfirmModalOptions;
  private onResolve: (value: boolean) => void;
  private resolved: boolean = false;

  constructor(app: App, options: ConfirmModalOptions, onResolve: (value: boolean) => void) {
    super(app);
    this.options = options;
    this.onResolve = onResolve;
  }

  private resolveOnce(value: boolean): void {
    if (!this.resolved) {
      this.resolved = true;
      this.onResolve(value);
    }
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    const {
      title,
      message,
      confirmText = 'Confirm',
      cancelText = 'Cancel',
      confirmClass = 'default'
    } = this.options;

    contentEl.empty();

    // Add modal class for styling
    modalEl.addClass('social-archiver-modal', 'social-archiver-confirm-modal');

    // Modal size
    if (Platform.isMobile) {
      modalEl.addClass('cm-mobile');
    } else {
      modalEl.addClass('cm-desktop');
    }

    // Set title
    this.setTitle(title);

    // Message - simple paragraph
    const messageEl = contentEl.createEl('p', { cls: 'confirm-modal-message cm-message' });
    messageEl.setText(message);

    // Button row using Setting
    const buttonSetting = new Setting(contentEl)
      .setClass('confirm-modal-buttons');

    // Cancel button
    buttonSetting.addButton((btn) =>
      btn
        .setButtonText(cancelText)
        .onClick(() => {
          this.resolveOnce(false);
          this.close();
        })
    );

    // Confirm button
    buttonSetting.addButton((btn) => {
      btn.setButtonText(confirmText);

      if (confirmClass === 'danger') {
        btn.setWarning();
      } else if (confirmClass === 'default') {
        btn.setCta();
      }

      btn.onClick(() => {
        this.resolveOnce(true);
        this.close();
      });
    });

    // Keyboard shortcuts
    this.scope.register([], 'Escape', () => {
      this.resolveOnce(false);
      this.close();
      return false;
    });

    this.scope.register([], 'Enter', () => {
      this.resolveOnce(true);
      this.close();
      return false;
    });
  }

  onClose(): void {
    this.resolveOnce(false);
    this.contentEl.empty();
  }
}

/**
 * Input Confirmation Modal Class
 */
class InputConfirmModal extends Modal {
  private options: InputConfirmModalOptions;
  private onResolve: (value: boolean) => void;
  private resolved: boolean = false;
  private inputEl!: HTMLInputElement;
  private confirmBtn!: HTMLButtonElement;

  constructor(app: App, options: InputConfirmModalOptions, onResolve: (value: boolean) => void) {
    super(app);
    this.options = options;
    this.onResolve = onResolve;
  }

  private resolveOnce(value: boolean): void {
    if (!this.resolved) {
      this.resolved = true;
      this.onResolve(value);
    }
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    const {
      title,
      message,
      confirmText = 'Confirm',
      cancelText = 'Cancel',
      confirmClass = 'danger',
      requiredInput,
      inputPlaceholder = '',
      inputLabel = ''
    } = this.options;

    contentEl.empty();

    // Add modal class for styling
    modalEl.addClass('social-archiver-modal', 'social-archiver-confirm-modal');

    // Modal size
    if (Platform.isMobile) {
      modalEl.addClass('cm-mobile', 'cm-mobile-position');
    } else {
      modalEl.addClass('cm-desktop');
    }

    // Set title
    this.setTitle(title);

    // Message - simple paragraph
    const messageEl = contentEl.createEl('p', { cls: 'confirm-modal-message cm-message' });
    messageEl.setText(message);

    // Input section using Setting
    const inputSetting = new Setting(contentEl);

    if (inputLabel) {
      inputSetting.setName(inputLabel);
    }

    inputSetting.addText((text) => {
      this.inputEl = text.inputEl;
      text.setPlaceholder(inputPlaceholder);

      // Style input
      text.inputEl.addClass('cm-input-monospace');

      text.inputEl.addEventListener('input', () => {
        const matches = text.inputEl.value === requiredInput;
        this.confirmBtn.disabled = !matches;
        if (matches) {
          this.confirmBtn.removeClass('cm-btn-disabled');
        } else {
          this.confirmBtn.addClass('cm-btn-disabled');
        }
      });
    });

    // Button row using Setting
    const buttonSetting = new Setting(contentEl)
      .setClass('confirm-modal-buttons');

    // Cancel button
    buttonSetting.addButton((btn) =>
      btn
        .setButtonText(cancelText)
        .onClick(() => {
          this.resolveOnce(false);
          this.close();
        })
    );

    // Confirm button
    buttonSetting.addButton((btn) => {
      this.confirmBtn = btn.buttonEl;
      btn.setButtonText(confirmText);

      if (confirmClass === 'danger') {
        btn.setWarning();
      } else if (confirmClass === 'default') {
        btn.setCta();
      }

      btn.buttonEl.disabled = true;
      btn.buttonEl.addClass('cm-btn-disabled');

      btn.onClick(() => {
        if (this.inputEl.value === requiredInput) {
          this.resolveOnce(true);
          this.close();
        }
      });
    });

    // Keyboard shortcuts
    this.scope.register([], 'Escape', () => {
      this.resolveOnce(false);
      this.close();
      return false;
    });

    this.scope.register([], 'Enter', () => {
      if (this.inputEl.value === requiredInput) {
        this.resolveOnce(true);
        this.close();
      }
      return false;
    });

    // Focus input
    setTimeout(() => this.inputEl.focus(), 50);
  }

  onClose(): void {
    this.resolveOnce(false);
    this.contentEl.empty();
  }
}
