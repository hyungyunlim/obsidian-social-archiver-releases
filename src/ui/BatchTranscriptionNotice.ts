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
    const container = this.notice.messageEl;
    container.empty();
    container.addClass('social-archiver-batch-notice');
    container.addClass('sa-flex-col', 'sa-gap-8', 'sa-p-12', 'sa-px-16');

    // Header row: icon + title
    const headerRow = container.createDiv();
    headerRow.addClass('sa-flex-row', 'sa-gap-8');

    const iconEl = headerRow.createSpan();
    iconEl.addClass('sa-inline-flex', 'sa-flex-shrink-0', 'sa-text-accent', 'sa-icon-16');
    setIcon(iconEl, 'mic');

    this.titleEl = headerRow.createSpan();
    this.titleEl.addClass('sa-font-semibold', 'sa-text-sm', 'sa-text-normal');

    // Progress bar
    this.progressBarEl = container.createDiv();
    this.progressBarEl.addClass('sa-overflow-hidden', 'btn-progress-bar');

    this.progressBarFill = this.progressBarEl.createDiv();
    this.progressBarFill.addClass('sa-h-full', 'btn-progress-fill', 'btn-fill-accent');

    // Status text (current file being processed)
    this.statusEl = container.createDiv();
    this.statusEl.addClass('sa-text-sm', 'sa-text-muted', 'sa-leading-normal', 'sa-truncate');

    // Stats (done/failed/skipped counts)
    this.statsEl = container.createDiv();
    this.statsEl.addClass('sa-text-xs', 'sa-text-faint');

    // Buttons row
    this.buttonsEl = container.createDiv();
    this.buttonsEl.addClass('sa-flex-row', 'sa-gap-8', 'sa-mt-2');

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
    this.progressBarFill.setCssProps({ '--btn-progress': `${pct}%` });

    // Progress bar color based on status
    this.progressBarFill.removeClass('btn-fill-accent', 'btn-fill-green', 'btn-fill-muted', 'btn-fill-yellow');
    if (progress.status === 'completed') {
      this.progressBarFill.addClass('btn-fill-green');
    } else if (progress.status === 'cancelled') {
      this.progressBarFill.addClass('btn-fill-muted');
    } else if (progress.status === 'paused') {
      this.progressBarFill.addClass('btn-fill-yellow');
    } else {
      this.progressBarFill.addClass('btn-fill-accent');
    }

    // Hide progress bar during scanning (no meaningful progress yet)
    if (progress.status === 'scanning') {
      this.progressBarEl.addClass('sa-hidden');
    } else {
      this.progressBarEl.removeClass('sa-hidden');
    }

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
      this.statsEl.removeClass('sa-hidden');
    } else {
      this.statsEl.addClass('sa-hidden');
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
      this.createButton(this.buttonsEl, 'Resume', 'play', 'primary', () => { void this.manager.resume(); });
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
    btn.addClass('sa-inline-flex', 'sa-flex-row', 'sa-gap-4', 'sa-px-12', 'sa-py-4', 'sa-text-sm', 'sa-font-medium', 'sa-clickable', 'sa-leading-normal', 'btn-action-button');

    // Variant styles
    switch (variant) {
      case 'primary':
        btn.addClass('sa-bg-accent', 'btn-variant-primary');
        break;
      case 'danger':
        btn.addClass('sa-text-muted', 'btn-variant-danger');
        break;
      default:
        btn.addClass('sa-bg-hover', 'sa-text-normal', 'btn-variant-default');
        break;
    }

    // Icon
    const iconEl = btn.createSpan();
    iconEl.addClass('sa-inline-flex', 'sa-icon-12');
    setIcon(iconEl, icon);

    // Label
    btn.createSpan({ text: label });

    btn.addEventListener('click', onClick);

    return btn;
  }
}
