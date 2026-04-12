/**
 * DeleteConfirmModal
 *
 * Obsidian Modal presented when the user deletes a vault file that has a
 * corresponding server archive. Asks whether the server copy should also be
 * deleted.
 *
 * Single Responsibility: user confirmation UI for outbound archive delete
 */

import { App, Modal } from 'obsidian';

// ============================================================================
// Public types
// ============================================================================

export interface DeleteConfirmResult {
  /** What the user chose to do with the server copy. */
  action: 'delete-on-server' | 'keep-on-server';
  /** If true, persist `confirmBeforeServerDelete = false` in settings. */
  dontAskAgain: boolean;
}

// ============================================================================
// Modal
// ============================================================================

export class DeleteConfirmModal extends Modal {
  private readonly resolve: (result: DeleteConfirmResult) => void;
  private readonly pendingCount: number;

  constructor(app: App, resolve: (result: DeleteConfirmResult) => void, pendingCount: number) {
    super(app);
    this.resolve = resolve;
    this.pendingCount = pendingCount;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();

    // Modal class for scoped CSS
    modalEl.addClass('social-archiver-modal', 'sa-delete-confirm-modal');

    // Title
    contentEl.createEl('h3', {
      text: 'Delete from server too?',
      cls: 'sa-delete-confirm-title',
    });

    // Explanation with count
    const countText = this.pendingCount === 1
      ? '1 archived note was'
      : `${this.pendingCount} archived notes were`;
    contentEl.createEl('p', {
      text: `${countText} deleted from the vault. Do you also want to delete the server copies?`,
      cls: 'sa-delete-confirm-desc',
    });

    // Warning about Library Sync re-importing the note
    contentEl.createEl('p', {
      text: 'If you keep them on the server, they may appear again during Library Sync.',
      cls: 'sa-delete-confirm-warning mod-warning',
    });

    // "Don't ask again" checkbox row
    const checkboxContainer = contentEl.createDiv({ cls: 'sa-delete-confirm-checkbox' });
    const checkbox = checkboxContainer.createEl('input', { type: 'checkbox' });
    checkbox.id = 'sa-delete-dont-ask-again';
    checkboxContainer.createEl('label', {
      text: " Don't ask again",
      attr: { for: 'sa-delete-dont-ask-again' },
    });

    // Button row
    const buttonContainer = contentEl.createDiv({ cls: 'sa-delete-confirm-buttons' });

    const keepBtn = buttonContainer.createEl('button', {
      text: 'Keep on Server',
      cls: 'sa-delete-confirm-keep',
    });
    keepBtn.addEventListener('click', () => {
      this.resolve({ action: 'keep-on-server', dontAskAgain: checkbox.checked });
      this.close();
    });

    const deleteBtn = buttonContainer.createEl('button', {
      text: 'Delete on Server',
      cls: 'sa-delete-confirm-delete mod-warning',
    });
    deleteBtn.addEventListener('click', () => {
      this.resolve({ action: 'delete-on-server', dontAskAgain: checkbox.checked });
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// ============================================================================
// Convenience factory
// ============================================================================

/**
 * Open the DeleteConfirmModal and return a promise that resolves with the
 * user's choice once they click a button.
 *
 * The promise never rejects — if the user dismisses the modal without
 * clicking a button (e.g. pressing Escape), it resolves with `keep-on-server`.
 */
export function showDeleteConfirmModal(app: App, pendingCount: number): Promise<DeleteConfirmResult> {
  return new Promise<DeleteConfirmResult>((resolve) => {
    // Wrap the resolve so that if the modal is closed without a button click
    // (e.g. Escape key / backdrop click) we still get a safe default.
    let settled = false;
    const settle = (result: DeleteConfirmResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const modal = new DeleteConfirmModal(app, settle, pendingCount);

    // If the user closes without choosing, treat as "keep on server"
    const origOnClose = modal.onClose.bind(modal);
    modal.onClose = function () {
      origOnClose();
      settle({ action: 'keep-on-server', dontAskAgain: false });
    };

    modal.open();
  });
}
