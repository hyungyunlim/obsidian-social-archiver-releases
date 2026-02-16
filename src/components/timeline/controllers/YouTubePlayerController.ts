/**
 * YouTube Player Controller - Controls YouTube iframe via postMessage API
 * Single Responsibility: YouTube iframe control via postMessage API
 * @see https://medium.com/@mihauco/youtube-iframe-api-without-youtube-iframe-api-f0ac5fcf7c74
 */
export class YouTubePlayerController {
  private iframe: HTMLIFrameElement;
  private ready = false;
  private readyResolvers: Array<() => void> = [];

  // Event subscribers
  private timeUpdateCallbacks: Array<(currentTime: number) => void> = [];
  private stateChangeCallbacks: Array<(state: number) => void> = [];

  // Bound handler for cleanup
  private boundMessageHandler: ((event: MessageEvent) => void) | null = null;
  private boundLoadHandler: (() => void) | null = null;

  constructor(iframe: HTMLIFrameElement) {
    this.iframe = iframe;

    // Wait for iframe to load
    this.boundLoadHandler = () => {
      this.ready = true;
      // Enable listening mode to receive player state updates
      this.sendCommand('listening');
      // Resolve any waitForReady promises
      for (const resolve of this.readyResolvers) {
        resolve();
      }
      this.readyResolvers = [];
    };
    this.iframe.addEventListener('load', this.boundLoadHandler);

    // Listen for postMessage events from YouTube iframe
    this.boundMessageHandler = (event: MessageEvent) => {
      this.handleMessage(event);
    };
    window.addEventListener('message', this.boundMessageHandler);
  }

  /**
   * Parse postMessage events from YouTube iframe.
   * YouTube sends infoDelivery messages with currentTime and playerState.
   */
  private handleMessage(event: MessageEvent): void {
    // Only process messages from the iframe's origin
    if (!this.iframe.src) return;

    let data: any;
    try {
      data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    } catch {
      return; // Not JSON, ignore
    }

    if (!data || data.event !== 'infoDelivery' || !data.info) return;

    const info = data.info;

    // Time update
    if (typeof info.currentTime === 'number' && this.timeUpdateCallbacks.length > 0) {
      for (const cb of this.timeUpdateCallbacks) {
        cb(info.currentTime);
      }
    }

    // State change (1=playing, 2=paused, 0=ended, 3=buffering, 5=cued)
    if (typeof info.playerState === 'number' && this.stateChangeCallbacks.length > 0) {
      for (const cb of this.stateChangeCallbacks) {
        cb(info.playerState);
      }
    }
  }

  private sendCommand(func: string, args: any[] = []): void {
    if (!this.ready) {
      return;
    }

    const message = JSON.stringify({
      event: func === 'listening' ? 'listening' : 'command',
      func: func === 'listening' ? undefined : func,
      args
    });

    this.iframe.contentWindow?.postMessage(message, '*');
  }

  /**
   * Wait until the iframe is loaded and ready for commands.
   */
  public waitForReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.readyResolvers.push(resolve);
    });
  }

  /**
   * Subscribe to currentTime updates from the YouTube iframe.
   * Returns an unsubscribe function.
   */
  public onTimeUpdate(callback: (currentTime: number) => void): () => void {
    this.timeUpdateCallbacks.push(callback);
    return () => {
      this.timeUpdateCallbacks = this.timeUpdateCallbacks.filter((cb) => cb !== callback);
    };
  }

  /**
   * Subscribe to player state changes.
   * States: 0=ended, 1=playing, 2=paused, 3=buffering, 5=cued
   * Returns an unsubscribe function.
   */
  public onStateChange(callback: (state: number) => void): () => void {
    this.stateChangeCallbacks.push(callback);
    return () => {
      this.stateChangeCallbacks = this.stateChangeCallbacks.filter((cb) => cb !== callback);
    };
  }

  /**
   * Seek to specific time in video (in seconds)
   */
  public seekTo(seconds: number): void {
    this.sendCommand('seekTo', [seconds, true]);
  }

  /**
   * Play video
   */
  public play(): void {
    this.sendCommand('playVideo');
  }

  /**
   * Pause video
   */
  public pause(): void {
    this.sendCommand('pauseVideo');
  }

  /**
   * Mute video
   */
  public mute(): void {
    this.sendCommand('mute');
  }

  /**
   * Unmute video
   */
  public unmute(): void {
    this.sendCommand('unMute');
  }

  /**
   * Cleanup all event listeners and subscribers
   */
  public destroy(): void {
    if (this.boundMessageHandler) {
      window.removeEventListener('message', this.boundMessageHandler);
      this.boundMessageHandler = null;
    }
    if (this.boundLoadHandler) {
      this.iframe.removeEventListener('load', this.boundLoadHandler);
      this.boundLoadHandler = null;
    }
    this.timeUpdateCallbacks = [];
    this.stateChangeCallbacks = [];
    this.readyResolvers = [];
  }
}
