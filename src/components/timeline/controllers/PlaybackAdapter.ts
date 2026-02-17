/**
 * PlaybackAdapter - Unified media playback abstraction
 * Single Responsibility: Abstract media playback control for TranscriptRenderer
 *
 * Allows TranscriptRenderer to work with audio, local video, and YouTube iframe
 * through a single interface without knowing the underlying media type.
 */

export interface PlaybackAdapter {
  readonly type: 'audio' | 'local-video' | 'youtube-iframe';

  play(): Promise<void> | void;
  pause(): void;
  seekTo(seconds: number): void;

  getCurrentTime(): number;
  isPaused(): boolean;

  /** Subscribe to time updates. Returns unsubscribe function. */
  onTimeUpdate(callback: (currentTime: number) => void): () => void;

  destroy(): void;
}

/**
 * HtmlMediaPlaybackAdapter - Adapter for HTMLAudioElement and HTMLVideoElement
 * Both share the HTMLMediaElement API, so a single adapter handles both.
 */
export class HtmlMediaPlaybackAdapter implements PlaybackAdapter {
  readonly type: 'audio' | 'local-video';
  private listeners: Array<{ event: string; handler: EventListener }> = [];

  constructor(private readonly element: HTMLMediaElement) {
    this.type = element instanceof HTMLVideoElement ? 'local-video' : 'audio';
  }

  play(): Promise<void> {
    return this.element.play().catch(() => {
      // Ignore autoplay policy errors
    });
  }

  pause(): void {
    this.element.pause();
  }

  seekTo(seconds: number): void {
    this.element.currentTime = seconds;
  }

  getCurrentTime(): number {
    return this.element.currentTime;
  }

  isPaused(): boolean {
    return this.element.paused;
  }

  onTimeUpdate(callback: (currentTime: number) => void): () => void {
    const handler = () => callback(this.element.currentTime);
    this.element.addEventListener('timeupdate', handler);
    this.listeners.push({ event: 'timeupdate', handler });

    return () => {
      this.element.removeEventListener('timeupdate', handler);
      this.listeners = this.listeners.filter((l) => l.handler !== handler);
    };
  }

  destroy(): void {
    for (const { event, handler } of this.listeners) {
      this.element.removeEventListener(event, handler);
    }
    this.listeners = [];
  }
}

/**
 * YouTubeIframePlaybackAdapter - Adapter for YouTube iframe via YouTubePlayerController
 *
 * YouTube iframe does not expose native timeupdate events.
 * Strategy:
 * - Primary: Use infoDelivery postMessage events from the YouTube iframe (currentTime)
 * - Fallback: 250ms polling when infoDelivery events are not received
 *
 * Requires YouTubePlayerController with extended event API:
 * - onTimeUpdate(callback): subscribe to currentTime updates
 * - destroy(): cleanup message listeners
 */
export class YouTubeIframePlaybackAdapter implements PlaybackAdapter {
  readonly type = 'youtube-iframe' as const;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private estimatedTime = 0;
  private playing = false;
  private unsubscribeTimeUpdate: (() => void) | null = null;
  private usePollingFallback = false;

  constructor(
    private readonly controller: {
      play(): void;
      pause(): void;
      seekTo(seconds: number): void;
      onTimeUpdate?(callback: (currentTime: number) => void): () => void;
      onStateChange?(callback: (state: number) => void): () => void;
      destroy?(): void;
    },
    private readonly duration: number = 0
  ) {}

  play(): void {
    this.controller.play();
    this.playing = true;
  }

  pause(): void {
    this.controller.pause();
    this.playing = false;
  }

  seekTo(seconds: number): void {
    this.controller.seekTo(seconds);
    this.estimatedTime = seconds;
  }

  getCurrentTime(): number {
    return this.estimatedTime;
  }

  isPaused(): boolean {
    return !this.playing;
  }

  onTimeUpdate(callback: (currentTime: number) => void): () => void {
    // Try event-based time update first (requires controller extension)
    if (this.controller.onTimeUpdate) {
      this.unsubscribeTimeUpdate = this.controller.onTimeUpdate((time) => {
        this.estimatedTime = time;
        callback(time);
      });

      // Also subscribe to state changes for play/pause tracking
      if (this.controller.onStateChange) {
        const unsubState = this.controller.onStateChange((state) => {
          // YouTube player states: 1=playing, 2=paused, 0=ended
          this.playing = state === 1;
        });
        const originalUnsub = this.unsubscribeTimeUpdate;
        this.unsubscribeTimeUpdate = () => {
          originalUnsub();
          unsubState();
        };
      }

      return () => {
        this.unsubscribeTimeUpdate?.();
        this.unsubscribeTimeUpdate = null;
      };
    }

    // Fallback: polling-based time estimation
    this.usePollingFallback = true;
    this.pollingInterval = setInterval(() => {
      if (this.playing) {
        this.estimatedTime += 0.25;
        if (this.duration > 0 && this.estimatedTime > this.duration) {
          this.estimatedTime = this.duration;
          this.playing = false;
        }
        callback(this.estimatedTime);
      }
    }, 250);

    return () => {
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
      }
    };
  }

  destroy(): void {
    this.unsubscribeTimeUpdate?.();
    this.unsubscribeTimeUpdate = null;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
}
