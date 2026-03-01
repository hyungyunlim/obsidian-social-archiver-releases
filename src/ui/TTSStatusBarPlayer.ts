/**
 * TTSStatusBarPlayer
 *
 * Status bar mini player for Editor TTS playback.
 *
 * Desktop: Inline status bar controls (prev, play/pause, next, progress, speed, close).
 * Mobile:  Persistent Notice with similar controls (since status bar is not visible).
 *
 * Subscribes to TTSState events to update UI. Calls back to EditorTTSController
 * for playback control.
 */

import { Notice, Platform, setIcon } from 'obsidian';
import type { TTSState } from '../services/tts/TTSState';
import { TTS_EVENT } from '../services/tts/TTSState';
import type { TTSSentenceChangeDetail, TTSStateChangeDetail } from '../services/tts/types';

// ============================================================================
// Speed options
// ============================================================================

const SPEED_STEPS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0] as const;

// ============================================================================
// Callbacks interface
// ============================================================================

export interface TTSPlayerCallbacks {
  onTogglePause: () => void;
  onNextSentence: () => void;
  onPreviousSentence: () => void;
  onSpeedChange: (speed: number) => void;
  onStop: () => void;
}

// ============================================================================
// TTSStatusBarPlayer
// ============================================================================

export class TTSStatusBarPlayer {
  // Desktop elements
  private statusBarEl: HTMLElement | null = null;
  private prevBtn: HTMLElement | null = null;
  private playPauseBtn: HTMLElement | null = null;
  private nextBtn: HTMLElement | null = null;
  private progressEl: HTMLElement | null = null;
  private speedBtn: HTMLElement | null = null;
  private closeBtn: HTMLElement | null = null;

  // Mobile notice
  private notice: Notice | null = null;
  private noticePlayPauseBtn: HTMLElement | null = null;
  private noticeProgressEl: HTMLElement | null = null;
  private noticeSpeedEl: HTMLElement | null = null;

  // State
  private currentSpeed: number;
  private sentenceIndex = 0;
  private sentenceTotal = 0;

  // Event listeners (for cleanup)
  private statusListener: ((e: Event) => void) | null = null;
  private sentenceListener: ((e: Event) => void) | null = null;

  constructor(
    private state: TTSState,
    private callbacks: TTSPlayerCallbacks,
    initialSpeed: number,
  ) {
    this.currentSpeed = initialSpeed;
  }

  // ---------- Desktop: Status bar player ------------------------------------

  /**
   * Initialize status bar player (desktop only).
   * @param statusBarItem - Element from plugin.addStatusBarItem()
   */
  initStatusBar(statusBarItem: HTMLElement): void {
    this.statusBarEl = statusBarItem;
    this.statusBarEl.addClass('sa-tts-statusbar');

    // Prev button
    this.prevBtn = this.createIconButton(this.statusBarEl, 'skip-back', 'Previous sentence');
    this.prevBtn.addEventListener('click', () => this.callbacks.onPreviousSentence());

    // Play/Pause button
    this.playPauseBtn = this.createIconButton(this.statusBarEl, 'play', 'Play / Pause');
    this.playPauseBtn.addEventListener('click', () => this.callbacks.onTogglePause());

    // Next button
    this.nextBtn = this.createIconButton(this.statusBarEl, 'skip-forward', 'Next sentence');
    this.nextBtn.addEventListener('click', () => this.callbacks.onNextSentence());

    // Progress label ("3/24")
    this.progressEl = this.statusBarEl.createSpan({ cls: 'sa-tts-statusbar-progress' });
    this.progressEl.textContent = '';

    // Speed button ("1.0x")
    this.speedBtn = this.statusBarEl.createEl('button', { cls: 'sa-tts-statusbar-speed' });
    this.speedBtn.textContent = this.formatSpeed(this.currentSpeed);
    this.speedBtn.setAttribute('aria-label', 'Change speed');
    this.speedBtn.addEventListener('click', () => this.cycleSpeed());

    // Close button
    this.closeBtn = this.createIconButton(this.statusBarEl, 'x', 'Stop reading');
    this.closeBtn.addEventListener('click', () => this.callbacks.onStop());
  }

  // ---------- Show / Hide ---------------------------------------------------

  show(): void {
    if (Platform.isMobile) {
      this.showNotice();
    } else {
      this.statusBarEl?.addClass('is-active');
    }
    this.subscribe();
  }

  dismiss(): void {
    this.unsubscribe();

    if (Platform.isMobile) {
      this.dismissNotice();
    } else {
      this.statusBarEl?.removeClass('is-active');
    }
  }

  // ---------- Mobile: Notice player -----------------------------------------

  private showNotice(): void {
    if (this.notice) return;

    this.notice = new Notice('', 0);
    const container = this.notice.messageEl;
    container.empty();
    container.addClass('sa-tts-notice');

    // Header
    const header = container.createDiv({ cls: 'sa-tts-notice-header' });
    const iconEl = header.createSpan();
    setIcon(iconEl, 'audio-lines');
    header.createSpan({ cls: 'sa-tts-notice-title', text: 'Reading aloud' });

    // Close button in header
    const headerClose = this.createNoticeButton(header, 'x', 'Stop');
    headerClose.addEventListener('click', () => this.callbacks.onStop());

    // Controls row
    const controls = container.createDiv({ cls: 'sa-tts-notice-controls' });

    const prevBtn = this.createNoticeButton(controls, 'skip-back', 'Previous');
    prevBtn.addEventListener('click', () => this.callbacks.onPreviousSentence());

    this.noticePlayPauseBtn = this.createNoticeButton(controls, 'play', 'Play/Pause');
    this.noticePlayPauseBtn.addEventListener('click', () => this.callbacks.onTogglePause());

    const nextBtn = this.createNoticeButton(controls, 'skip-forward', 'Next');
    nextBtn.addEventListener('click', () => this.callbacks.onNextSentence());

    // Info row (progress + speed)
    const info = container.createDiv({ cls: 'sa-tts-notice-info' });
    this.noticeProgressEl = info.createSpan({ text: '' });

    this.noticeSpeedEl = info.createSpan({ text: this.formatSpeed(this.currentSpeed) });
    this.noticeSpeedEl.setCssStyles({ cursor: 'pointer' });
    this.noticeSpeedEl.addEventListener('click', () => this.cycleSpeed());
  }

  private dismissNotice(): void {
    this.notice?.hide();
    this.notice = null;
    this.noticePlayPauseBtn = null;
    this.noticeProgressEl = null;
    this.noticeSpeedEl = null;
  }

  // ---------- Event subscriptions -------------------------------------------

  private subscribe(): void {
    this.statusListener = (e: Event) => {
      const detail = (e as CustomEvent<TTSStateChangeDetail>).detail;
      this.onStatusChange(detail);
    };
    this.sentenceListener = (e: Event) => {
      const detail = (e as CustomEvent<TTSSentenceChangeDetail>).detail;
      this.onSentenceChange(detail);
    };

    this.state.addEventListener(TTS_EVENT.STATUS_CHANGE, this.statusListener);
    this.state.addEventListener(TTS_EVENT.SENTENCE_CHANGE, this.sentenceListener);
  }

  private unsubscribe(): void {
    if (this.statusListener) {
      this.state.removeEventListener(TTS_EVENT.STATUS_CHANGE, this.statusListener);
      this.statusListener = null;
    }
    if (this.sentenceListener) {
      this.state.removeEventListener(TTS_EVENT.SENTENCE_CHANGE, this.sentenceListener);
      this.sentenceListener = null;
    }
  }

  // ---------- Event handlers ------------------------------------------------

  private onStatusChange(detail: TTSStateChangeDetail): void {
    const { current } = detail;

    // Update play/pause icon
    if (current === 'playing') {
      this.updatePlayPauseIcon('pause');
    } else if (current === 'paused') {
      this.updatePlayPauseIcon('play');
    } else if (current === 'synthesizing' || current === 'loading') {
      this.updatePlayPauseIcon('loader');
    }

    // Auto-dismiss on idle/error
    if (current === 'idle' || current === 'error') {
      this.dismiss();
    }
  }

  private onSentenceChange(detail: TTSSentenceChangeDetail): void {
    this.sentenceIndex = detail.index;
    this.sentenceTotal = detail.total;
    this.updateProgress();
  }

  // ---------- UI updates ----------------------------------------------------

  private updatePlayPauseIcon(icon: string): void {
    if (this.playPauseBtn) {
      this.playPauseBtn.empty();
      setIcon(this.playPauseBtn, icon);
    }
    if (this.noticePlayPauseBtn) {
      this.noticePlayPauseBtn.empty();
      setIcon(this.noticePlayPauseBtn, icon);
    }
  }

  private updateProgress(): void {
    const text = `${this.sentenceIndex + 1}/${this.sentenceTotal}`;
    if (this.progressEl) {
      this.progressEl.textContent = text;
    }
    if (this.noticeProgressEl) {
      this.noticeProgressEl.textContent = text;
    }
  }

  private cycleSpeed(): void {
    const currentIdx = SPEED_STEPS.indexOf(this.currentSpeed as typeof SPEED_STEPS[number]);
    const nextIdx = (currentIdx + 1) % SPEED_STEPS.length;
    this.currentSpeed = SPEED_STEPS[nextIdx] ?? 1.0;
    this.callbacks.onSpeedChange(this.currentSpeed);

    const label = this.formatSpeed(this.currentSpeed);
    if (this.speedBtn) {
      this.speedBtn.textContent = label;
    }
    if (this.noticeSpeedEl) {
      this.noticeSpeedEl.textContent = label;
    }
  }

  // ---------- Helpers -------------------------------------------------------

  private createIconButton(parent: HTMLElement, icon: string, ariaLabel: string): HTMLElement {
    const btn = parent.createEl('button', { cls: 'sa-tts-statusbar-btn' });
    btn.setAttribute('aria-label', ariaLabel);
    setIcon(btn, icon);
    return btn;
  }

  private createNoticeButton(parent: HTMLElement, icon: string, ariaLabel: string): HTMLElement {
    const btn = parent.createEl('button', { cls: 'sa-tts-notice-btn' });
    btn.setAttribute('aria-label', ariaLabel);
    setIcon(btn, icon);
    return btn;
  }

  private formatSpeed(speed: number): string {
    return `${speed.toFixed(speed % 1 === 0 ? 0 : speed % 0.5 === 0 ? 1 : 2)}x`;
  }

  // ---------- Cleanup -------------------------------------------------------

  destroy(): void {
    this.dismiss();
    this.statusBarEl = null;
  }
}
