/**
 * TTSAudioPlayer
 *
 * Web Audio API player for synthesized TTS audio buffers.
 * Handles play/pause/resume/stop with offset tracking for seamless pause/resume.
 *
 * Architecture:
 *  - Lazy-initializes AudioContext on first play (browser autoplay policy)
 *  - Decodes ArrayBuffer (WAV/MP3) into AudioBuffer
 *  - Uses AudioBufferSourceNode for playback
 *  - playbackRate stays at 1.0 when provider handles rate during synthesis (Supertonic, Azure)
 *  - Prefetch map holds upcoming sentence buffers keyed by index for gapless playback
 *  - Index-based lookup ensures correct order even when async synthesis completes out-of-order
 *  - Pause stores elapsed offset; resume creates a new source from offset
 */

// ============================================================================
// Types
// ============================================================================

export interface AudioPlayerCallbacks {
  /** Fired when a buffer finishes playing naturally (not stopped). */
  onEnded: () => void;
  /** Fired on decode or playback errors. */
  onError: (error: Error) => void;
}

interface PlaybackState {
  source: AudioBufferSourceNode;
  buffer: AudioBuffer;
  startTime: number; // context.currentTime when playback started
  startOffset: number; // offset in seconds from buffer start (for resume)
}

// ============================================================================
// TTSAudioPlayer
// ============================================================================

export class TTSAudioPlayer {
  private context: AudioContext | null = null;
  private playback: PlaybackState | null = null;
  private callbacks: AudioPlayerCallbacks;
  private _pauseOffset = 0;
  private _pausedBuffer: AudioBuffer | null = null;
  private _stopped = false;

  /** Playback speed applied via AudioBufferSourceNode.playbackRate. */
  private _playbackRate = 1.0;

  /** Pre-decoded buffers keyed by sentence index for order-safe gapless playback. */
  private prefetchMap: Map<number, AudioBuffer> = new Map();

  constructor(callbacks: AudioPlayerCallbacks) {
    this.callbacks = callbacks;
  }

  // ---------- Lifecycle -----------------------------------------------------

  /**
   * Lazily initialize the AudioContext.
   * Must be called from a user gesture context on first invocation.
   */
  private ensureContext(): AudioContext {
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContext();
    }
    // Resume if suspended (e.g. after browser autoplay block)
    if (this.context.state === 'suspended') {
      void this.context.resume();
    }
    return this.context;
  }

  // ---------- Decoding ------------------------------------------------------

  /**
   * Decode an ArrayBuffer (WAV or MP3) into an AudioBuffer.
   */
  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.ensureContext();
    // Clone the buffer because decodeAudioData detaches the input
    const copy = data.slice(0);
    return ctx.decodeAudioData(copy);
  }

  // ---------- Playback rate -------------------------------------------------

  /**
   * Set playback speed. Applied immediately to current source if playing,
   * and to all future sources.
   */
  setPlaybackRate(rate: number): void {
    this._playbackRate = rate;
    if (this.playback) {
      this.playback.source.playbackRate.value = rate;
    }
  }

  getPlaybackRate(): number {
    return this._playbackRate;
  }

  // ---------- Playback ------------------------------------------------------

  /**
   * Play an AudioBuffer from the beginning (or from a specified offset).
   */
  async play(buffer: AudioBuffer, offset = 0): Promise<void> {
    this.stopSource(); // Stop any existing playback

    const ctx = this.ensureContext();
    this._stopped = false;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = this._playbackRate;
    source.connect(ctx.destination);

    source.onended = () => {
      if (!this._stopped && this.playback?.source === source) {
        this.playback = null;
        this.callbacks.onEnded();
      }
    };

    this.playback = {
      source,
      buffer,
      startTime: ctx.currentTime,
      startOffset: offset,
    };

    this._pauseOffset = 0;
    this._pausedBuffer = null;

    source.start(0, offset);
  }

  /**
   * Pause playback, storing the elapsed offset for resume.
   */
  pause(): void {
    if (!this.playback || !this.context) return;

    // Account for playbackRate: elapsed real time * rate = buffer time consumed
    const elapsed = this.context.currentTime - this.playback.startTime;
    this._pauseOffset = this.playback.startOffset + elapsed * this._playbackRate;
    this._pausedBuffer = this.playback.buffer;

    this.stopSource();
  }

  /**
   * Resume playback from the paused offset.
   */
  async resume(): Promise<void> {
    if (!this._pausedBuffer) return;

    // Clamp offset to buffer duration
    const offset = Math.min(this._pauseOffset, this._pausedBuffer.duration - 0.01);
    const buffer = this._pausedBuffer;
    this._pausedBuffer = null;
    this._pauseOffset = 0;

    await this.play(buffer, Math.max(0, offset));
  }

  /**
   * Stop playback entirely.
   */
  stop(): void {
    this._stopped = true;
    this.stopSource();
    this._pauseOffset = 0;
    this._pausedBuffer = null;
    this.prefetchMap.clear();
  }

  /**
   * Whether audio is currently playing.
   */
  get isPlaying(): boolean {
    return this.playback !== null;
  }

  /**
   * Whether audio is paused with a resume-able offset.
   */
  get isPaused(): boolean {
    return this._pausedBuffer !== null;
  }

  /**
   * Current playback position in seconds (0 if not playing).
   */
  get currentTime(): number {
    if (!this.playback || !this.context) return 0;
    const elapsed = this.context.currentTime - this.playback.startTime;
    return this.playback.startOffset + elapsed * this._playbackRate;
  }

  /**
   * Duration of the current buffer in seconds (0 if not playing).
   */
  get duration(): number {
    if (this.playback) return this.playback.buffer.duration;
    if (this._pausedBuffer) return this._pausedBuffer.duration;
    return 0;
  }

  // ---------- Prefetch map (order-safe gapless playback) ---------------------

  /**
   * Store a pre-decoded buffer for a specific sentence index.
   * Index-based storage ensures correct retrieval order even when
   * concurrent async synthesis operations complete out of order.
   */
  enqueuePrefetch(index: number, buffer: AudioBuffer): void {
    this.prefetchMap.set(index, buffer);
  }

  /**
   * Retrieve and remove the buffer for a specific sentence index.
   * Returns null if that index hasn't been prefetched yet.
   */
  dequeuePrefetch(index: number): AudioBuffer | null {
    const buffer = this.prefetchMap.get(index);
    if (buffer) {
      this.prefetchMap.delete(index);
      return buffer;
    }
    return null;
  }

  /**
   * Number of prefetched buffers.
   */
  get prefetchSize(): number {
    return this.prefetchMap.size;
  }

  /**
   * Clear all prefetched buffers (e.g., on skip/stop).
   */
  clearPrefetch(): void {
    this.prefetchMap.clear();
  }

  // ---------- Cleanup -------------------------------------------------------

  /**
   * Release all resources.
   */
  async destroy(): Promise<void> {
    this.stop();
    if (this.context && this.context.state !== 'closed') {
      await this.context.close();
    }
    this.context = null;
  }

  // ---------- Private -------------------------------------------------------

  private stopSource(): void {
    if (this.playback) {
      try {
        this.playback.source.onended = null;
        this.playback.source.stop();
        this.playback.source.disconnect();
      } catch {
        // Source may already be stopped
      }
      this.playback = null;
    }
  }
}
