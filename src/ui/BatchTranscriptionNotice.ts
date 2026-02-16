/**
 * BatchTranscriptionNotice - Persistent Notice UI for batch transcription progress
 *
 * Single Responsibility: Display batch transcription progress, stats, and control buttons
 * using Obsidian's Notice API with custom DOM and inline styles (Obsidian CSS variables).
 */

import { Notice, setIcon } from 'obsidian';
import type { BatchTranscriptionManager } from '../services/BatchTranscriptionManager';
import type { BatchProgress, BatchOperationStatus } from '../types/batch-transcription';

export class BatchTranscriptionNotice {
  private notice: Notice | null = null;
  private unsubscribe: (() => void) | null = null;
  private autoDismissTimer: ReturnType<typeof setTimeout> | null = null;

  private titleEl!: HTMLElement;
  private progressBarEl!: HTMLElement;
  private progressBarFill!: HTMLElement;
  private statusEl!: HTMLElement;
  private statsEl!: HTMLElement;
  private buttonsEl!: HTMLElement;

  constructor(private manager: BatchTranscriptionManager) {}

  show(): void {
    if (this.notice) return;

    // duration=0 → persistent Notice
    this.notice = new Notice('', 0);
    const container = this.notice.noticeEl;
    container.empty();
    container.addClass('social-archiver-batch-notice');
    Object.assign(container.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      padding: '12px 16px',
      maxWidth: '360px',
      width: '360px',
    });

    // Header row: icon + title
    const headerRow = container.createDiv();
    Object.assign(headerRow.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    });

    const iconEl = headerRow.createSpan();
    Object.assign(iconEl.style, {
      display: 'flex',
      alignItems: 'center',
      flexShrink: '0',
      color: 'var(--text-accent)',
    });
    iconEl.style.setProperty('--icon-size', '16px');
    setIcon(iconEl, 'mic');

    this.titleEl = headerRow.createSpan();
    Object.assign(this.titleEl.style, {
      fontWeight: 'var(--font-semibold)',
      fontSize: 'var(--font-ui-small)',
      color: 'var(--text-normal)',
    });

    // Progress bar
    this.progressBarEl = container.createDiv();
    Object.assign(this.progressBarEl.style, {
      height: '4px',
      borderRadius: '2px',
      background: 'var(--background-modifier-border)',
      overflow: 'hidden',
    });

    this.progressBarFill = this.progressBarEl.createDiv();
    Object.assign(this.progressBarFill.style, {
      height: '100%',
      borderRadius: '2px',
      background: 'var(--interactive-accent)',
      transition: 'width 0.3s ease',
      width: '0%',
    });

    // Status text (current file being processed)
    this.statusEl = container.createDiv();
    Object.assign(this.statusEl.style, {
      fontSize: '12px',
      color: 'var(--text-muted)',
      lineHeight: '1.4',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    });

    // Stats (done/failed/skipped counts)
    this.statsEl = container.createDiv();
    Object.assign(this.statsEl.style, {
      fontSize: '11px',
      color: 'var(--text-faint)',
    });

    // Buttons row
    this.buttonsEl = container.createDiv();
    Object.assign(this.buttonsEl.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginTop: '2px',
    });

    // Subscribe to progress updates
    this.unsubscribe = this.manager.onProgress((progress) => {
      this.update(progress);
    });

    // Initial render
    this.update(this.manager.getProgress());
  }

  dismiss(): void {
    if (this.autoDismissTimer) {
      clearTimeout(this.autoDismissTimer);
      this.autoDismissTimer = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.notice?.hide();
    this.notice = null;
  }

  private update(progress: BatchProgress): void {
    if (!this.notice) return;

    // Title
    this.titleEl.textContent = this.getTitle(progress.status);

    // Progress bar
    const pct = progress.totalItems > 0
      ? Math.round(((progress.completedItems + progress.failedItems + progress.skippedItems) / progress.totalItems) * 100)
      : 0;
    this.progressBarFill.style.width = `${pct}%`;

    // Progress bar color based on status
    if (progress.status === 'completed') {
      this.progressBarFill.style.background = 'var(--color-green)';
    } else if (progress.status === 'cancelled') {
      this.progressBarFill.style.background = 'var(--text-muted)';
    } else if (progress.status === 'paused') {
      this.progressBarFill.style.background = 'var(--color-yellow)';
    } else {
      this.progressBarFill.style.background = 'var(--interactive-accent)';
    }

    // Hide progress bar during scanning (no meaningful progress yet)
    this.progressBarEl.style.display = progress.status === 'scanning' ? 'none' : 'block';

    // Status
    this.statusEl.textContent = this.getStatusText(progress);

    // Stats
    if (progress.totalItems > 0) {
      const parts: string[] = [];
      if (progress.completedItems > 0) parts.push(`${progress.completedItems} done`);
      if (progress.failedItems > 0) parts.push(`${progress.failedItems} failed`);
      if (progress.skippedItems > 0) parts.push(`${progress.skippedItems} skipped`);
      this.statsEl.textContent = parts.length > 0
        ? `${parts.join(', ')} / ${progress.totalItems} total`
        : `0 / ${progress.totalItems} total`;
      this.statsEl.style.display = 'block';
    } else {
      this.statsEl.style.display = 'none';
    }

    // Buttons
    this.renderButtons(progress.status);

    // Auto-dismiss on terminal states
    if (progress.status === 'completed' || progress.status === 'cancelled') {
      if (!this.autoDismissTimer) {
        this.autoDismissTimer = setTimeout(() => this.dismiss(), 5000);
      }
    }
  }

  private getTitle(status: BatchOperationStatus): string {
    switch (status) {
      case 'scanning': return 'Scanning...';
      case 'running': return 'Transcribing...';
      case 'paused': return 'Paused';
      case 'completed': return 'Complete';
      case 'cancelled': return 'Cancelled';
      default: return 'Batch Transcription';
    }
  }

  private getStatusText(progress: BatchProgress): string {
    if (progress.status === 'scanning') return 'Scanning archive folder for videos...';
    if (progress.status === 'completed') return 'All items processed.';
    if (progress.status === 'cancelled') return 'Operation cancelled.';
    if (progress.status === 'paused') return `Paused at item ${progress.currentIndex + 1} of ${progress.totalItems}.`;

    if (!progress.currentFile) return 'Processing...';
    const fileName = progress.currentFile.split('/').pop() || progress.currentFile;
    const stage = progress.currentStage === 'downloading' ? 'Downloading' : 'Transcribing';
    return `${stage}: ${fileName} (${progress.currentIndex + 1}/${progress.totalItems})`;
  }

  private renderButtons(status: BatchOperationStatus): void {
    this.buttonsEl.empty();

    if (status === 'running' || status === 'scanning') {
      this.createButton(this.buttonsEl, 'Pause', 'pause', 'default', () => this.manager.pause());
      this.createButton(this.buttonsEl, 'Cancel', 'x', 'danger', () => this.manager.cancel());
    } else if (status === 'paused') {
      this.createButton(this.buttonsEl, 'Resume', 'play', 'primary', () => this.manager.resume());
      this.createButton(this.buttonsEl, 'Cancel', 'x', 'danger', () => this.manager.cancel());
    }
  }

  private createButton(
    parent: HTMLElement,
    label: string,
    icon: string,
    variant: 'default' | 'primary' | 'danger',
    onClick: () => void
  ): HTMLButtonElement {
    const btn = parent.createEl('button');

    // Base styles
    Object.assign(btn.style, {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      padding: '4px 12px',
      fontSize: '12px',
      fontFamily: 'inherit',
      fontWeight: 'var(--font-medium)',
      borderRadius: 'var(--radius-s)',
      cursor: 'pointer',
      border: '1px solid transparent',
      lineHeight: '1.5',
      transition: 'background 0.15s ease, color 0.15s ease',
    });

    // Variant styles
    switch (variant) {
      case 'primary':
        Object.assign(btn.style, {
          background: 'var(--interactive-accent)',
          color: 'var(--text-on-accent)',
          border: '1px solid var(--interactive-accent)',
        });
        break;
      case 'danger':
        Object.assign(btn.style, {
          background: 'none',
          color: 'var(--text-muted)',
          border: '1px solid var(--background-modifier-border)',
        });
        break;
      default:
        Object.assign(btn.style, {
          background: 'var(--background-modifier-hover)',
          color: 'var(--text-normal)',
          border: '1px solid var(--background-modifier-border)',
        });
        break;
    }

    // Icon
    const iconEl = btn.createSpan();
    Object.assign(iconEl.style, {
      display: 'flex',
      alignItems: 'center',
    });
    iconEl.style.setProperty('--icon-size', '12px');
    setIcon(iconEl, icon);

    // Label
    btn.createSpan({ text: label });

    // Hover effects
    const originalBg = btn.style.background;
    const originalColor = btn.style.color;
    btn.addEventListener('mouseenter', () => {
      if (variant === 'danger') {
        btn.style.color = 'var(--color-red)';
        btn.style.borderColor = 'var(--color-red)';
      } else if (variant === 'primary') {
        btn.style.filter = 'brightness(1.1)';
      } else {
        btn.style.background = 'var(--background-modifier-border)';
      }
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = originalBg;
      btn.style.color = originalColor;
      btn.style.filter = '';
      if (variant === 'danger') {
        btn.style.borderColor = 'var(--background-modifier-border)';
      }
    });

    btn.addEventListener('click', onClick);

    return btn;
  }
}
