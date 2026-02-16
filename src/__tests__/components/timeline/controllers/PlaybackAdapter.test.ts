import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HtmlMediaPlaybackAdapter,
  YouTubeIframePlaybackAdapter
} from '../../../../components/timeline/controllers/PlaybackAdapter';

// --- HtmlMediaPlaybackAdapter ---

describe('HtmlMediaPlaybackAdapter', () => {
  let mockElement: HTMLAudioElement;

  beforeEach(() => {
    mockElement = {
      currentTime: 0,
      paused: true,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLAudioElement;
  });

  it('should detect audio type', () => {
    const adapter = new HtmlMediaPlaybackAdapter(mockElement);
    expect(adapter.type).toBe('audio');
  });

  it('should delegate play/pause/seekTo to element', () => {
    const adapter = new HtmlMediaPlaybackAdapter(mockElement);
    adapter.play();
    expect(mockElement.play).toHaveBeenCalled();

    adapter.pause();
    expect(mockElement.pause).toHaveBeenCalled();

    adapter.seekTo(42);
    expect(mockElement.currentTime).toBe(42);
  });

  it('should return current time and paused state', () => {
    mockElement.currentTime = 15.5;
    mockElement.paused = false;
    Object.defineProperty(mockElement, 'paused', { value: false });

    const adapter = new HtmlMediaPlaybackAdapter(mockElement);
    expect(adapter.getCurrentTime()).toBe(15.5);
    expect(adapter.isPaused()).toBe(false);
  });

  it('should subscribe and unsubscribe from timeupdate', () => {
    const adapter = new HtmlMediaPlaybackAdapter(mockElement);
    const callback = vi.fn();

    const unsub = adapter.onTimeUpdate(callback);
    expect(mockElement.addEventListener).toHaveBeenCalledWith(
      'timeupdate',
      expect.any(Function)
    );

    unsub();
    expect(mockElement.removeEventListener).toHaveBeenCalledWith(
      'timeupdate',
      expect.any(Function)
    );
  });

  it('should cleanup all listeners on destroy', () => {
    const adapter = new HtmlMediaPlaybackAdapter(mockElement);
    adapter.onTimeUpdate(vi.fn());
    adapter.onTimeUpdate(vi.fn());

    adapter.destroy();
    expect(mockElement.removeEventListener).toHaveBeenCalledTimes(2);
  });
});

// --- YouTubeIframePlaybackAdapter ---

describe('YouTubeIframePlaybackAdapter', () => {
  let mockController: {
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    seekTo: ReturnType<typeof vi.fn>;
    onTimeUpdate?: ReturnType<typeof vi.fn>;
    onStateChange?: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockController = {
      play: vi.fn(),
      pause: vi.fn(),
      seekTo: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should have youtube-iframe type', () => {
    const adapter = new YouTubeIframePlaybackAdapter(mockController, 300);
    expect(adapter.type).toBe('youtube-iframe');
  });

  it('should delegate play/pause/seekTo to controller', () => {
    const adapter = new YouTubeIframePlaybackAdapter(mockController, 300);

    adapter.play();
    expect(mockController.play).toHaveBeenCalled();

    adapter.pause();
    expect(mockController.pause).toHaveBeenCalled();

    adapter.seekTo(60);
    expect(mockController.seekTo).toHaveBeenCalledWith(60);
  });

  it('should track estimated time after seekTo', () => {
    const adapter = new YouTubeIframePlaybackAdapter(mockController, 300);
    adapter.seekTo(120);
    expect(adapter.getCurrentTime()).toBe(120);
  });

  it('should use event-based time update when controller supports it', () => {
    const unsubFn = vi.fn();
    mockController.onTimeUpdate = vi.fn().mockReturnValue(unsubFn);

    const adapter = new YouTubeIframePlaybackAdapter(mockController, 300);
    const callback = vi.fn();

    const unsub = adapter.onTimeUpdate(callback);
    expect(mockController.onTimeUpdate).toHaveBeenCalled();

    // Simulate controller calling back with time
    const registeredCallback = mockController.onTimeUpdate.mock.calls[0][0];
    registeredCallback(45.5);
    expect(callback).toHaveBeenCalledWith(45.5);
    expect(adapter.getCurrentTime()).toBe(45.5);

    unsub();
  });

  it('should fall back to polling when controller lacks onTimeUpdate', () => {
    vi.useFakeTimers();
    const adapter = new YouTubeIframePlaybackAdapter(mockController, 300);
    const callback = vi.fn();

    adapter.onTimeUpdate(callback);
    adapter.play(); // Must be playing for polling to emit

    vi.advanceTimersByTime(500); // 2 ticks at 250ms
    expect(callback).toHaveBeenCalled();
    expect(adapter.getCurrentTime()).toBeGreaterThan(0);

    adapter.destroy();
    vi.useRealTimers();
  });

  it('should stop polling on destroy', () => {
    vi.useFakeTimers();
    const adapter = new YouTubeIframePlaybackAdapter(mockController, 300);
    const callback = vi.fn();

    adapter.onTimeUpdate(callback);
    adapter.play();
    adapter.destroy();

    callback.mockClear();
    vi.advanceTimersByTime(1000);
    expect(callback).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
