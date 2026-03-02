/**
 * TTSService
 *
 * Orchestrator for the plugin TTS pipeline.
 * Connects text processing, sentence parsing, provider synthesis, and audio playback.
 *
 * Pipeline:
 *   1. extractText(post) -> rawText + cleanedText + offsetMap
 *   2. parseSentences(cleanedText) -> Sentence[]
 *   3. detectLanguage(cleanedText) -> lang
 *   4. For each sentence: synthesize(text) -> ArrayBuffer -> decode -> play
 *   5. Prefetch next N sentences while current plays (gapless playback)
 *
 * Speed control:
 *   - Supertonic: rate passed to synthesis (pitch-preserving time stretch)
 *   - Azure: rate passed to synthesis (SSML prosody rate, pitch-preserving)
 *   - Both require prefetch re-synthesis on speed change; tradeoff vs instant playbackRate
 *
 * Skip safety (generation counter):
 *   - `generation` increments on every skip and abort
 *   - In-flight async ops capture generation at start and bail if it changed
 *   - Prevents stale prefetch buffers from contaminating the queue after rapid skips
 *
 * Exposes:
 *   - startPlayback / pause / resume / stop / skipToSentence
 *   - getExtractionResult() / getSentences() for highlighting
 *   - TTSState events for UI binding
 */

import type { PluginTTSProvider, PluginTTSProviderId } from './types';
import type { TextExtractionResult } from './TTSTextProcessor';
import type { Sentence } from './TTSSentenceParser';
import { extractText } from './TTSTextProcessor';
import { parseSentences } from './TTSSentenceParser';
import { detectLanguage } from './LanguageDetector';
import { TTSState } from './TTSState';
import { TTSAudioPlayer } from './TTSAudioPlayer';

// ============================================================================
// Constants
// ============================================================================

/**
 * Number of sentences to pre-render ahead of the current one.
 *
 * Supertonic uses 1 because its IPC is serial (one Node.js child process).
 * Stale prefetch requests block the stdin pipe, delaying the skip target.
 * Azure uses 3 because its HTTP API handles concurrent requests in parallel.
 */
const PREFETCH_AHEAD_DEFAULT = 3;
const PREFETCH_AHEAD_SERIAL = 1;

// ============================================================================
// Types
// ============================================================================

/** Minimal post shape for TTS playback. */
interface PostLike {
  fullContent?: string | null;
  previewText?: string | null;
  title?: string | null;
}

export interface TTSServiceOptions {
  /** Speech rate (0.5 - 2.0, default 1.0). Applied via synthesis (pitch-preserving) for Supertonic/Azure. */
  rate?: number;
  /** Voice ID override (provider-specific). */
  voiceId?: string;
  /** Language override (BCP-47). If not set, auto-detected. */
  lang?: string;
}

// ============================================================================
// TTSService
// ============================================================================

export class TTSService {
  readonly state: TTSState;

  private primaryProvider: PluginTTSProvider | null = null;
  private fallbackProvider: PluginTTSProvider | null = null;
  private activeProvider: PluginTTSProvider | null = null;
  private player: TTSAudioPlayer;
  private extraction: TextExtractionResult | null = null;
  private sentences: Sentence[] = [];
  private currentSentenceIndex = -1;
  private options: TTSServiceOptions = {};
  private detectedLang: string | undefined;
  private abortController: AbortController | null = null;

  /** Tracks the highest sentence index for which prefetch has been launched. */
  private prefetchWatermark = -1;

  /**
   * Monotonically increasing counter; bumped on every skip and abort.
   * In-flight async operations capture this at start and bail if it changed,
   * preventing stale synthesis/prefetch from contaminating the queue.
   */
  private generation = 0;

  constructor() {
    this.state = new TTSState();
    this.player = new TTSAudioPlayer({
      onEnded: () => this.onSentenceEnded(),
      onError: (error) => this.onPlaybackError(error),
    });
  }

  // ---------- Provider management -------------------------------------------

  setProvider(provider: PluginTTSProvider): void {
    this.primaryProvider = provider;
  }

  /**
   * Set a fallback provider used when the primary doesn't support the detected language.
   * For example, Supertonic (en/ko/es/pt/fr only) falls back to Azure for ja/zh/etc.
   */
  setFallbackProvider(provider: PluginTTSProvider | null): void {
    this.fallbackProvider = provider;
  }

  getProviderId(): PluginTTSProviderId | null {
    return this.activeProvider?.id ?? this.primaryProvider?.id ?? null;
  }

  // ---------- Rate control ---------------------------------------------------

  /**
   * Update the speech rate.
   *
   * - Supertonic: rate is passed to synthesis (pitch-preserving time stretch).
   * - Azure: rate is passed to synthesis (SSML prosody rate, pitch-preserving).
   * - Both: playbackRate stays at 1.0. Speed changes require re-synthesis of prefetched buffers.
   */
  setRate(rate: number): void {
    this.options = { ...this.options, rate };

    if (this.usesSynthesisRate()) {
      // Supertonic: invalidate prefetched buffers (synthesized at old rate)
      this.player.clearPrefetch();
      this.prefetchWatermark = this.currentSentenceIndex;
      // playbackRate stays at 1.0
    } else {
      // Azure: instant speed change via playbackRate
      this.player.setPlaybackRate(rate);
    }
  }

  /**
   * Whether the current provider handles rate during synthesis (not playback).
   * Both Supertonic (pitch-preserving time stretch) and Azure (SSML prosody rate)
   * apply rate at synthesis time to avoid pitch distortion from playbackRate.
   */
  private usesSynthesisRate(): boolean {
    const provider = this.activeProvider ?? this.primaryProvider;
    return provider?.id === 'supertonic' || provider?.id === 'azure';
  }

  /**
   * How many sentences to prefetch ahead.
   * Supertonic's serial IPC means stale prefetch requests block the stdin pipe,
   * so we limit to 1 to keep skip latency low while still enabling gapless playback.
   */
  private getPrefetchAhead(): number {
    return this.activeProvider?.id === 'supertonic' ? PREFETCH_AHEAD_SERIAL : PREFETCH_AHEAD_DEFAULT;
  }

  // ---------- Playback control ----------------------------------------------

  /**
   * Start TTS playback for a post.
   */
  async startPlayback(post: PostLike, options?: TTSServiceOptions): Promise<void> {
    // Abort any previous session
    this.abort();

    if (!this.primaryProvider) {
      this.state.emitError('No TTS provider configured', undefined, true);
      return;
    }

    this.options = options ?? {};
    this.abortController = new AbortController();

    // Step 1: Extract and clean text
    this.state.transition('loading');
    this.extraction = extractText(post);

    if (!this.extraction.isSpeakable) {
      this.state.emitError('Text is too short for TTS playback', undefined, false);
      return;
    }

    // Step 2: Parse sentences
    this.sentences = parseSentences(this.extraction.cleanedText);
    if (this.sentences.length === 0) {
      this.state.emitError('No sentences found in text', undefined, false);
      return;
    }

    // Step 3: Detect language
    this.detectedLang = this.options.lang ?? detectLanguage(this.extraction.cleanedText);

    // Step 3b: Select active provider for this playback session.
    // Always start from primary for every new post/session.
    this.activeProvider = this.primaryProvider;
    if (this.detectedLang && this.activeProvider && !this.activeProvider.supportsLanguage(this.detectedLang)) {
      if (this.fallbackProvider?.supportsLanguage(this.detectedLang)) {
        console.debug(
          `[TTSService] Language "${this.detectedLang}" not supported by ${this.activeProvider.id}, switching to ${this.fallbackProvider.id}`,
        );
        this.state.emitNotice(
          `Language not supported by ${this.activeProvider.id}. Using ${this.fallbackProvider.id} cloud TTS instead.`,
        );
        this.activeProvider = this.fallbackProvider;
      }
    }

    // Apply initial playback rate:
    // Supertonic/Azure handle rate in synthesis (pitch-preserving); playbackRate stays 1.0.
    if (this.usesSynthesisRate()) {
      this.player.setPlaybackRate(1.0);
    } else {
      this.player.setPlaybackRate(this.options.rate ?? 1.0);
    }

    // Step 4: Start sentence-by-sentence playback
    this.currentSentenceIndex = 0;
    this.prefetchWatermark = -1;
    await this.playSentence(0);
  }

  /**
   * Pause playback.
   */
  pause(): void {
    if (this.state.status !== 'playing') return;
    this.player.pause();
    this.state.transition('paused');
  }

  /**
   * Resume playback from paused state.
   */
  async resume(): Promise<void> {
    if (this.state.status !== 'paused') return;
    this.state.transition('playing');
    await this.player.resume();
  }

  /**
   * Stop playback entirely.
   */
  stop(): void {
    this.abort();
    this.state.reset();
  }

  /**
   * Skip to a specific sentence by index.
   */
  async skipToSentence(index: number): Promise<void> {
    if (index < 0 || index >= this.sentences.length) return;
    if (!this.activeProvider) return;

    // Cancel current playback but keep session state
    this.player.stop();
    // Cancel in-flight IPC requests so stale synthesis doesn't block the pipe
    this.activeProvider.cancelPendingSynthesis?.();
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    // Bump generation so in-flight operations from the previous skip bail out
    this.generation++;
    // Reapply playback rate after abort creates new controller
    // Supertonic: rate in synthesis, playbackRate stays 1.0
    this.player.setPlaybackRate(this.usesSynthesisRate() ? 1.0 : (this.options.rate ?? 1.0));

    this.currentSentenceIndex = index;
    this.prefetchWatermark = index - 1;
    await this.playSentence(index);
  }

  /**
   * Skip to next sentence.
   */
  async nextSentence(): Promise<void> {
    if (this.currentSentenceIndex < this.sentences.length - 1) {
      await this.skipToSentence(this.currentSentenceIndex + 1);
    }
  }

  /**
   * Skip to previous sentence.
   */
  async previousSentence(): Promise<void> {
    if (this.currentSentenceIndex > 0) {
      await this.skipToSentence(this.currentSentenceIndex - 1);
    }
  }

  // ---------- Accessors for UI/highlighting ---------------------------------

  getExtractionResult(): TextExtractionResult | null {
    return this.extraction;
  }

  getSentences(): Sentence[] {
    return this.sentences;
  }

  getCurrentSentenceIndex(): number {
    return this.currentSentenceIndex;
  }

  getDetectedLanguage(): string | undefined {
    return this.detectedLang;
  }

  // ---------- Internal pipeline ---------------------------------------------

  private async playSentence(index: number): Promise<void> {
    if (this.isAborted()) return;
    const provider = this.activeProvider;
    if (!provider) return;

    // Capture generation to detect skip/abort during async gaps
    const gen = this.generation;

    const sentence = this.sentences[index];
    if (!sentence) {
      // All sentences done
      this.state.reset();
      console.debug('[TTSService] tts_session_completed');
      return;
    }

    // Update state
    this.state.transition('synthesizing');
    this.state.setSentence(index, this.sentences.length, sentence.text);
    console.debug(`[TTSService] tts_sentence_advanced index=${index}/${this.sentences.length}`);

    try {
      // Supertonic: pass rate for pitch-preserving time stretch.
      // Azure: omit rate (speed via playbackRate, not synthesis).
      const synthRate = this.usesSynthesisRate() ? this.options.rate : undefined;
      const audioData = await provider.synthesize({
        text: sentence.text,
        lang: this.detectedLang,
        voiceId: this.options.voiceId,
        rate: synthRate,
      });

      if (gen !== this.generation) return;

      // Decode and play
      const buffer = await this.player.decode(audioData);
      if (gen !== this.generation) return;

      this.state.transition('playing');
      await this.player.play(buffer);

      // Kick off prefetch for upcoming sentences
      this.prefetchAhead(index);
    } catch (error) {
      if (gen !== this.generation) return;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[TTSService] tts_error sentence=${index}: ${message}`);
      this.state.emitError(message, provider.id, true);
    }
  }

  /**
   * Pre-render up to PREFETCH_AHEAD sentences beyond the given index.
   * Uses a watermark to avoid redundant synthesis calls.
   */
  private prefetchAhead(currentIndex: number): void {
    const ahead = this.getPrefetchAhead();
    for (let i = currentIndex + 1; i <= currentIndex + ahead && i < this.sentences.length; i++) {
      if (i <= this.prefetchWatermark) continue; // Already launched
      this.prefetchWatermark = i;
      void this.prefetchSentence(i);
    }
  }

  private async prefetchSentence(index: number): Promise<void> {
    const provider = this.activeProvider;
    if (!provider) return;

    // Capture generation — if a skip/abort occurs during synthesis,
    // this prefetch must NOT enqueue its stale buffer.
    const gen = this.generation;

    const sentence = this.sentences[index];
    if (!sentence) return;

    try {
      const synthRate = this.usesSynthesisRate() ? this.options.rate : undefined;
      const audioData = await provider.synthesize({
        text: sentence.text,
        lang: this.detectedLang,
        voiceId: this.options.voiceId,
        rate: synthRate,
      });

      if (gen !== this.generation) return;

      const buffer = await this.player.decode(audioData);
      if (gen !== this.generation) return;

      this.player.enqueuePrefetch(index, buffer);
    } catch {
      // Prefetch failure is non-critical; will synthesize on demand
    }
  }

  private onSentenceEnded(): void {
    if (this.isAborted()) return;

    // Capture generation so we don't advance state if a skip arrives mid-transition
    const gen = this.generation;
    const nextIndex = this.currentSentenceIndex + 1;
    if (nextIndex >= this.sentences.length) {
      // All done
      this.state.reset();
      console.debug('[TTSService] tts_session_completed');
      return;
    }

    this.currentSentenceIndex = nextIndex;

    // If a skip arrived between onEnded firing and here, bail out
    if (gen !== this.generation) return;

    // Try using prefetched buffer for the exact next sentence index
    const prefetched = this.player.dequeuePrefetch(nextIndex);
    if (prefetched) {
      const sentence = this.sentences[nextIndex];
      if (!sentence) {
        this.state.reset();
        return;
      }
      this.state.setSentence(nextIndex, this.sentences.length, sentence.text);
      this.state.transition('playing');
      console.debug(`[TTSService] tts_sentence_advanced index=${nextIndex}/${this.sentences.length}`);
      this.player.play(prefetched);
      // Continue prefetching further ahead
      this.prefetchAhead(nextIndex);
    } else {
      // No prefetched buffer, synthesize on demand
      this.playSentence(nextIndex);
    }
  }

  private onPlaybackError(error: Error): void {
    console.error('[TTSService] Playback error:', error.message);
    this.state.emitError(error.message, this.activeProvider?.id, true);
  }

  // ---------- Abort ---------------------------------------------------------

  private abort(): void {
    this.generation++;
    this.activeProvider?.cancelPendingSynthesis?.();
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.player.stop();
    this.extraction = null;
    this.sentences = [];
    this.currentSentenceIndex = -1;
    this.prefetchWatermark = -1;
    this.detectedLang = undefined;
    this.activeProvider = null;
  }

  private isAborted(): boolean {
    return this.abortController?.signal.aborted ?? true;
  }

  // ---------- Cleanup -------------------------------------------------------

  async destroy(): Promise<void> {
    this.abort();
    this.state.reset();
    await this.player.destroy();
    const primary = this.primaryProvider;
    const fallback = this.fallbackProvider;
    this.primaryProvider = null;
    this.fallbackProvider = null;

    if (primary) {
      await primary.destroy();
    }
    if (fallback && fallback !== primary) {
      await fallback.destroy();
    }
  }
}
