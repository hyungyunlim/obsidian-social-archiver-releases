/**
 * ReaderTTSController
 *
 * Bridge between TTSService and Reader Mode DOM.
 * Manages:
 *  - TTS header button (play/loading indicator)
 *  - Mini controller bar (play/pause, prev/next sentence, speed, progress)
 *  - Keyboard shortcuts (P, Shift+Arrow, [/], Escape priority)
 *  - Sentence highlighting and scroll sync
 *  - State event subscriptions
 */

import { setIcon, Notice } from 'obsidian';
import type { PostData } from '../../../types/post';
import type { SocialArchiverSettings } from '../../../types/settings';
import type { PluginTTSProvider } from '../../../services/tts/types';
import { TTSService } from '../../../services/tts/TTSService';
import { TTSHighlight } from '../../../services/tts/TTSHighlight';
import { TTSScrollSync } from '../../../services/tts/TTSScrollSync';
import { TTS_EVENT } from '../../../services/tts/TTSState';
import type { TTSStateChangeDetail, TTSSentenceChangeDetail, TTSErrorDetail, TTSNoticeDetail } from '../../../services/tts/types';
import { extractText } from '../../../services/tts/TTSTextProcessor';
import { parseSentences } from '../../../services/tts/TTSSentenceParser';
import { detectLanguage } from '../../../services/tts/LanguageDetector';

// ============================================================================
// Constants
// ============================================================================

const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
const DEFAULT_SPEED_INDEX = 2; // 1.0x
const MAX_AUTO_ADVANCE_STEPS = 100;

interface ReaderTTSControllerCallbacks {
  /**
   * Request reader-mode navigation to the next post for autoplay chaining.
   * Returns the newly focused post or null when no further navigation is possible.
   */
  onRequestNextPostForAutoplay?: () => Promise<PostData | null>;
  /**
   * Resolve a sequential post candidate for warmup prefetch.
   * `offsetFromCurrent=1` means immediate next post.
   */
  onResolvePrefetchCandidatePost?: (offsetFromCurrent: number) => PostData | null;
}

// ============================================================================
// ReaderTTSController
// ============================================================================

export class ReaderTTSController {
  private ttsService: TTSService;
  private highlight: TTSHighlight;
  private scrollSync: TTSScrollSync;
  private settings: SocialArchiverSettings;

  // UI elements
  private headerButton: HTMLElement | null = null;
  private miniController: HTMLElement | null = null;
  private playPauseBtn: HTMLElement | null = null;
  private prevBtn: HTMLElement | null = null;
  private nextBtn: HTMLElement | null = null;
  private speedBtn: HTMLElement | null = null;
  private stopBtn: HTMLElement | null = null;
  private progressLabel: HTMLElement | null = null;
  private followBtn: HTMLElement | null = null;

  // State
  private currentPost: PostData | null = null;
  private speedIndex = DEFAULT_SPEED_INDEX;
  private provider: PluginTTSProvider | null = null;
  private callbacks: ReaderTTSControllerCallbacks;
  private suppressNextIdleAutoAdvance = false;
  private autoAdvanceInProgress = false;
  private destroyed = false;
  private prefetchGeneration = 0;

  // Event listener refs for cleanup
  private statusListener: ((e: Event) => void) | null = null;
  private sentenceListener: ((e: Event) => void) | null = null;
  private errorListener: ((e: Event) => void) | null = null;
  private noticeListener: ((e: Event) => void) | null = null;

  constructor(settings: SocialArchiverSettings, callbacks: ReaderTTSControllerCallbacks = {}) {
    this.settings = settings;
    this.callbacks = callbacks;
    this.ttsService = new TTSService();
    this.highlight = new TTSHighlight();
    this.scrollSync = new TTSScrollSync({
      onStateChange: (state) => this.onScrollSyncStateChange(state),
    });

    // Restore speed from settings
    const savedRate = settings.tts?.speed ?? 1.0;
    const idx = SPEED_OPTIONS.indexOf(savedRate);
    if (idx !== -1) this.speedIndex = idx;

    // Subscribe to TTS state events
    this.statusListener = (e: Event) => {
      const detail = (e as CustomEvent<TTSStateChangeDetail>).detail;
      this.onStatusChange(detail);
    };
    this.sentenceListener = (e: Event) => {
      const detail = (e as CustomEvent<TTSSentenceChangeDetail>).detail;
      this.onSentenceChange(detail);
    };
    this.errorListener = (e: Event) => {
      const detail = (e as CustomEvent<TTSErrorDetail>).detail;
      this.onError(detail);
    };
    this.noticeListener = (e: Event) => {
      const detail = (e as CustomEvent<TTSNoticeDetail>).detail;
      new Notice(detail.message);
    };

    this.ttsService.state.addEventListener(TTS_EVENT.STATUS_CHANGE, this.statusListener);
    this.ttsService.state.addEventListener(TTS_EVENT.SENTENCE_CHANGE, this.sentenceListener);
    this.ttsService.state.addEventListener(TTS_EVENT.ERROR, this.errorListener);
    this.ttsService.state.addEventListener(TTS_EVENT.NOTICE, this.noticeListener);
  }

  // ---------- Provider setup ------------------------------------------------

  setProvider(provider: PluginTTSProvider): void {
    this.provider = provider;
    this.ttsService.setProvider(provider);
  }

  setFallbackProvider(provider: PluginTTSProvider | null): void {
    this.ttsService.setFallbackProvider(provider);
  }

  // ---------- DOM rendering -------------------------------------------------

  /**
   * Create the TTS button in the header right group.
   * Called by ReaderModeContentRenderer.renderHeader().
   */
  renderHeaderButton(parent: HTMLElement): void {
    this.headerButton = parent.createDiv({ cls: 'sa-reader-mode-header-btn sa-reader-tts-btn' });
    this.headerButton.setAttribute('title', 'Read aloud (P)');
    setIcon(this.headerButton, 'volume-2');

    this.headerButton.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.handleHeaderButtonClick();
    });

    // Reflect current state
    this.updateHeaderButton();
  }

  /**
   * Create the mini controller bar below the header.
   * Hidden by default, shown when TTS is active.
   */
  renderMiniController(parent: HTMLElement): void {
    this.miniController = parent.createDiv({ cls: 'sa-reader-tts-mini-controller' });
    this.miniController.style.display = 'none';

    // Previous sentence
    this.prevBtn = this.miniController.createDiv({ cls: 'sa-reader-tts-ctrl-btn' });
    this.prevBtn.setAttribute('title', 'Previous sentence (Shift+Left)');
    setIcon(this.prevBtn, 'skip-back');
    this.prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.ttsService.previousSentence();
    });

    // Play/Pause
    this.playPauseBtn = this.miniController.createDiv({ cls: 'sa-reader-tts-ctrl-btn sa-reader-tts-play-btn' });
    setIcon(this.playPauseBtn, 'play');
    this.playPauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.togglePlayback();
    });

    // Next sentence
    this.nextBtn = this.miniController.createDiv({ cls: 'sa-reader-tts-ctrl-btn' });
    this.nextBtn.setAttribute('title', 'Next sentence (Shift+Right)');
    setIcon(this.nextBtn, 'skip-forward');
    this.nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.ttsService.nextSentence();
    });

    // Progress label
    this.progressLabel = this.miniController.createDiv({ cls: 'sa-reader-tts-progress' });
    this.progressLabel.textContent = '';

    // Speed button
    this.speedBtn = this.miniController.createDiv({ cls: 'sa-reader-tts-ctrl-btn sa-reader-tts-speed-btn' });
    this.speedBtn.textContent = `${SPEED_OPTIONS[this.speedIndex]}x`;
    this.speedBtn.setAttribute('title', 'Change speed ([/])');
    this.speedBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cycleSpeed(1);
    });

    // Stop button (explicit close action in the mini player)
    this.stopBtn = this.miniController.createDiv({ cls: 'sa-reader-tts-ctrl-btn sa-reader-tts-close-btn' });
    this.stopBtn.setAttribute('title', 'Stop reading (Esc)');
    setIcon(this.stopBtn, 'x');
    this.stopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.stopPlayback({ suppressAutoAdvance: true });
    });

    // Follow along button (hidden by default)
    this.followBtn = parent.createDiv({ cls: 'sa-reader-tts-follow-btn' });
    this.followBtn.style.display = 'none';
    this.followBtn.textContent = 'Follow along';
    this.followBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.scrollSync.refollow();
      if (this.followBtn) {
        this.followBtn.style.display = 'none';
      }
    });
  }

  /**
   * Set the content body element for highlighting.
   */
  setContentBody(bodyElement: HTMLElement): void {
    this.highlight.setContainer(bodyElement);
  }

  /**
   * Set the scroll container for scroll sync.
   */
  setScrollContainer(scrollElement: HTMLElement): void {
    this.scrollSync.attach(scrollElement);
  }

  // ---------- Keyboard handling ---------------------------------------------

  /**
   * Handle a keyboard event. Returns true if consumed (caller should not process further).
   */
  handleKeyDown(e: KeyboardEvent): boolean {
    // P = toggle play/pause
    if (e.code === 'KeyP' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      void this.togglePlayback();
      return true;
    }

    // Shift+ArrowLeft = previous sentence
    if (e.key === 'ArrowLeft' && e.shiftKey && this.ttsService.state.isActive) {
      e.preventDefault();
      void this.ttsService.previousSentence();
      return true;
    }

    // Shift+ArrowRight = next sentence
    if (e.key === 'ArrowRight' && e.shiftKey && this.ttsService.state.isActive) {
      e.preventDefault();
      void this.ttsService.nextSentence();
      return true;
    }

    // [ = decrease speed
    if (e.key === '[' && this.ttsService.state.isActive) {
      e.preventDefault();
      this.cycleSpeed(-1);
      return true;
    }

    // ] = increase speed
    if (e.key === ']' && this.ttsService.state.isActive) {
      e.preventDefault();
      this.cycleSpeed(1);
      return true;
    }

    // Escape while TTS active = stop TTS (not close reader)
    if (e.key === 'Escape' && this.ttsService.state.isActive) {
      e.preventDefault();
      this.stopPlayback({ suppressAutoAdvance: true });
      return true;
    }

    return false;
  }

  // ---------- Post lifecycle ------------------------------------------------

  /**
   * Called when the reader navigates to a different post.
   */
  onPostChange(post: PostData | null): void {
    // Stop current playback
    this.prefetchGeneration++;
    this.stopPlayback({ suppressAutoAdvance: true });
    this.highlight.clearHighlights();
    this.scrollSync.stopFollowing();
    this.currentPost = post;
    this.hideMiniController();
  }

  // ---------- Playback control ----------------------------------------------

  private async handleHeaderButtonClick(): Promise<void> {
    if (this.ttsService.state.isActive) {
      this.stopPlayback({ suppressAutoAdvance: true });
      return;
    }

    await this.togglePlayback();
  }

  private async togglePlayback(): Promise<void> {
    const status = this.ttsService.state.status;

    if (status === 'playing') {
      this.ttsService.pause();
    } else if (status === 'paused') {
      await this.ttsService.resume();
    } else if (status === 'idle' || status === 'error') {
      if (!this.currentPost) return;
      await this.startPlaybackForPost(this.currentPost, { showProviderNotice: true });
    }
  }

  private async startPlaybackForPost(
    post: PostData,
    options: { showProviderNotice: boolean },
  ): Promise<void> {
    if (!this.provider) {
      if (options.showProviderNotice) {
        new Notice('No TTS provider configured. Check settings > Text-to-Speech.');
      }
      return;
    }

    const rate = SPEED_OPTIONS[this.speedIndex];
    const voiceId = this.settings.tts?.voiceId;
    const lang = this.settings.tts?.language;

    console.debug('[ReaderTTSController] tts_session_started');
    this.scrollSync.startFollowing();

    const content = post.content;
    const postLike = {
      fullContent: content.markdown ?? content.text ?? null,
      previewText: content.snippet ?? null,
      title: post.title ?? null,
    };
    await this.ttsService.startPlayback(postLike, {
      rate,
      voiceId: voiceId || undefined,
      lang: lang || undefined,
    });

    // Warm up the first sentence of the upcoming speakable post.
    // For Azure, this populates provider cache and reduces post-switch latency.
    void this.prefetchNextPostFirstSentence();
  }

  private isPostSpeakable(post: PostData): boolean {
    const content = post.content;
    const extraction = extractText({
      fullContent: content.markdown ?? content.text ?? null,
      previewText: content.snippet ?? null,
      title: post.title ?? null,
    });
    return extraction.isSpeakable;
  }

  private stopPlayback(options: { suppressAutoAdvance: boolean }): void {
    this.prefetchGeneration++;
    const wasActive = this.ttsService.state.isActive;
    if (options.suppressAutoAdvance && wasActive) {
      this.suppressNextIdleAutoAdvance = true;
    }
    this.ttsService.stop();
  }

  private buildPrefetchRequestForPost(
    post: PostData,
  ): { text: string; lang?: string; voiceId?: string } | null {
    const content = post.content;
    const extraction = extractText({
      fullContent: content.markdown ?? content.text ?? null,
      previewText: content.snippet ?? null,
      title: post.title ?? null,
    });
    if (!extraction.isSpeakable) return null;

    const sentences = parseSentences(extraction.cleanedText);
    const firstSentence = sentences[0]?.text?.trim();
    if (!firstSentence) return null;

    const lang = this.settings.tts?.language ?? detectLanguage(extraction.cleanedText);
    const voiceId = this.settings.tts?.voiceId || undefined;
    return {
      text: firstSentence,
      lang: lang || undefined,
      voiceId,
    };
  }

  private async prefetchNextPostFirstSentence(): Promise<void> {
    if (this.destroyed) return;
    if (this.provider?.id !== 'azure') return;
    if (!this.callbacks.onResolvePrefetchCandidatePost) return;

    const generation = ++this.prefetchGeneration;

    for (let offset = 1; offset <= MAX_AUTO_ADVANCE_STEPS; offset++) {
      if (this.destroyed || generation !== this.prefetchGeneration) return;

      const candidate = this.callbacks.onResolvePrefetchCandidatePost(offset);
      if (!candidate) return;

      const request = this.buildPrefetchRequestForPost(candidate);
      if (!request) continue; // Skip non-speakable posts.

      try {
        await this.provider.synthesize(request);
      } catch (error) {
        console.debug('[ReaderTTSController] next_post_prefetch_failed', error);
      }
      return;
    }
  }

  private cycleSpeed(direction: 1 | -1): void {
    const next = this.speedIndex + direction;
    // Wrap around: past the end → back to start, before start → go to end
    this.speedIndex = ((next % SPEED_OPTIONS.length) + SPEED_OPTIONS.length) % SPEED_OPTIONS.length;
    const newSpeed = SPEED_OPTIONS[this.speedIndex] ?? 1;

    if (this.speedBtn) {
      this.speedBtn.textContent = `${newSpeed}x`;
    }

    // Persist to settings
    if (this.settings.tts) {
      this.settings.tts.speed = newSpeed;
    }

    // Update playback rate — applied instantly via AudioBufferSourceNode.playbackRate
    // No re-synthesis or sentence restart needed
    this.ttsService.setRate(newSpeed);
  }

  // ---------- State event handlers ------------------------------------------

  private onStatusChange(detail: TTSStateChangeDetail): void {
    this.updateHeaderButton();
    this.updatePlayPauseButton();

    if (detail.current === 'idle') {
      const completedNaturally =
        detail.previous === 'playing' && !this.suppressNextIdleAutoAdvance;
      const suppressAutoAdvance = this.suppressNextIdleAutoAdvance;
      this.suppressNextIdleAutoAdvance = false;

      this.hideMiniController();
      this.highlight.clearHighlights();
      this.scrollSync.stopFollowing();
      if (this.followBtn) this.followBtn.style.display = 'none';

      if (!suppressAutoAdvance && completedNaturally) {
        void this.handlePlaybackCompletedAutoplay();
      }
    } else if (detail.current !== 'error') {
      this.showMiniController();
    }
  }

  private onSentenceChange(detail: TTSSentenceChangeDetail): void {
    // Update progress
    if (this.progressLabel) {
      this.progressLabel.textContent = `${detail.index + 1} / ${detail.total}`;
    }

    // Highlight sentence in DOM
    const extraction = this.ttsService.getExtractionResult();
    const sentences = this.ttsService.getSentences();
    const sentence = sentences[detail.index];

    if (sentence && extraction) {
      this.highlight.highlight(sentence, extraction.offsetMap, extraction.rawText);
    }
  }

  private onError(detail: TTSErrorDetail): void {
    console.error(`[ReaderTTSController] tts_error: ${detail.message}`);

    if (detail.recoverable) {
      new Notice(`TTS error: ${detail.message}. Playback stopped.`);
    } else {
      new Notice(`TTS unavailable: ${detail.message}`);
    }

    // Auto-recover to idle; do not treat this as natural completion.
    this.suppressNextIdleAutoAdvance = true;
    this.ttsService.state.reset();
  }

  private async handlePlaybackCompletedAutoplay(): Promise<void> {
    if (this.autoAdvanceInProgress || this.destroyed) return;
    if (!this.callbacks.onRequestNextPostForAutoplay) return;

    this.autoAdvanceInProgress = true;
    try {
      let attempts = 0;
      while (attempts < MAX_AUTO_ADVANCE_STEPS) {
        if (this.destroyed) return;

        const nextPost = await this.callbacks.onRequestNextPostForAutoplay();
        if (!nextPost) return;
        this.currentPost = nextPost;

        // Mirror mobile queue behavior: silently skip non-speakable posts.
        if (!this.isPostSpeakable(nextPost)) {
          attempts++;
          continue;
        }

        await this.startPlaybackForPost(nextPost, { showProviderNotice: false });
        return;
      }
    } finally {
      this.autoAdvanceInProgress = false;
    }
  }

  private onScrollSyncStateChange(state: 'idle' | 'following' | 'detached'): void {
    if (this.followBtn) {
      this.followBtn.style.display = state === 'detached' ? 'block' : 'none';
    }
  }

  // ---------- UI updates ----------------------------------------------------

  private updateHeaderButton(): void {
    if (!this.headerButton) return;

    const status = this.ttsService.state.status;
    this.headerButton.classList.toggle('sa-reader-tts-btn-active', status === 'playing' || status === 'paused');
    this.headerButton.classList.toggle('sa-reader-tts-btn-loading', status === 'loading' || status === 'synthesizing');

    if (status === 'playing' || status === 'paused') {
      setIcon(this.headerButton, 'volume-2');
      this.headerButton.setAttribute('title', 'Stop reading (Esc)');
    } else if (status === 'loading' || status === 'synthesizing') {
      setIcon(this.headerButton, 'loader');
      this.headerButton.setAttribute('title', 'Stop reading (Esc)');
    } else {
      setIcon(this.headerButton, 'volume-2');
      this.headerButton.setAttribute('title', 'Read aloud (P)');
    }
  }

  private updatePlayPauseButton(): void {
    if (!this.playPauseBtn) return;

    const status = this.ttsService.state.status;
    const isLoading = status === 'loading' || status === 'synthesizing';

    this.playPauseBtn.classList.toggle('sa-reader-tts-btn-loading', isLoading);

    if (isLoading) {
      setIcon(this.playPauseBtn, 'loader');
      this.playPauseBtn.setAttribute('title', 'Synthesizing…');
    } else if (status === 'playing') {
      setIcon(this.playPauseBtn, 'pause');
      this.playPauseBtn.setAttribute('title', 'Pause (P)');
    } else {
      setIcon(this.playPauseBtn, 'play');
      this.playPauseBtn.setAttribute('title', 'Play (P)');
    }
  }

  private showMiniController(): void {
    if (this.miniController) {
      this.miniController.style.display = 'flex';
    }
  }

  private hideMiniController(): void {
    if (this.miniController) {
      this.miniController.style.display = 'none';
    }
  }

  // ---------- Cleanup -------------------------------------------------------

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.suppressNextIdleAutoAdvance = true;
    this.autoAdvanceInProgress = false;
    this.prefetchGeneration++;

    // Remove event listeners
    if (this.statusListener) {
      this.ttsService.state.removeEventListener(TTS_EVENT.STATUS_CHANGE, this.statusListener);
    }
    if (this.sentenceListener) {
      this.ttsService.state.removeEventListener(TTS_EVENT.SENTENCE_CHANGE, this.sentenceListener);
    }
    if (this.errorListener) {
      this.ttsService.state.removeEventListener(TTS_EVENT.ERROR, this.errorListener);
    }
    if (this.noticeListener) {
      this.ttsService.state.removeEventListener(TTS_EVENT.NOTICE, this.noticeListener);
    }

    this.highlight.destroy();
    this.scrollSync.destroy();
    await this.ttsService.destroy();

    this.headerButton = null;
    this.miniController = null;
    this.playPauseBtn = null;
    this.prevBtn = null;
    this.nextBtn = null;
    this.speedBtn = null;
    this.stopBtn = null;
    this.progressLabel = null;
    this.followBtn = null;
    this.currentPost = null;
  }
}
