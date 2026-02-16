/**
 * useSwipeGesture - Touch Gesture Handler for Mobile
 *
 * Provides swipe gesture detection for mobile interactions:
 * - Swipe left: Delete action
 * - Swipe right: Toggle pause action
 * - Configurable thresholds and callbacks
 *
 * Single Responsibility: Detect and report swipe gestures
 */

/**
 * Swipe direction
 */
export type SwipeDirection = 'left' | 'right' | 'up' | 'down' | 'none';

/**
 * Swipe gesture configuration
 */
export interface SwipeGestureConfig {
  /** Minimum distance in pixels to trigger swipe */
  threshold?: number;
  /** Maximum time in ms for swipe to complete */
  maxTime?: number;
  /** Enable/disable vertical swipes */
  allowVertical?: boolean;
  /** Callback when swipe left is detected */
  onSwipeLeft?: () => void;
  /** Callback when swipe right is detected */
  onSwipeRight?: () => void;
  /** Callback when swipe up is detected */
  onSwipeUp?: () => void;
  /** Callback when swipe down is detected */
  onSwipeDown?: () => void;
  /** Callback for any swipe direction */
  onSwipe?: (direction: SwipeDirection, distance: number) => void;
}

/**
 * Touch tracking state
 */
interface TouchState {
  startX: number;
  startY: number;
  startTime: number;
  currentX: number;
  currentY: number;
  isTracking: boolean;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<SwipeGestureConfig> = {
  threshold: 50,
  maxTime: 300,
  allowVertical: false,
  onSwipeLeft: () => {},
  onSwipeRight: () => {},
  onSwipeUp: () => {},
  onSwipeDown: () => {},
  onSwipe: () => {}
};

/**
 * Create swipe gesture handlers for an element
 *
 * @param config Swipe gesture configuration
 * @returns Event handlers to attach to element
 */
export function createSwipeGestureHandlers(config: SwipeGestureConfig = {}) {
  const settings = { ...DEFAULT_CONFIG, ...config };

  const state: TouchState = {
    startX: 0,
    startY: 0,
    startTime: 0,
    currentX: 0,
    currentY: 0,
    isTracking: false
  };

  /**
   * Handle touch start
   */
  function handleTouchStart(event: TouchEvent): void {
    const touch = event.touches[0];
    if (!touch) return;

    state.startX = touch.clientX;
    state.startY = touch.clientY;
    state.currentX = touch.clientX;
    state.currentY = touch.clientY;
    state.startTime = Date.now();
    state.isTracking = true;
  }

  /**
   * Handle touch move
   */
  function handleTouchMove(event: TouchEvent): void {
    if (!state.isTracking) return;

    const touch = event.touches[0];
    if (!touch) return;

    state.currentX = touch.clientX;
    state.currentY = touch.clientY;

    // Prevent scroll if horizontal swipe is dominant
    const deltaX = Math.abs(state.currentX - state.startX);
    const deltaY = Math.abs(state.currentY - state.startY);

    if (deltaX > deltaY && deltaX > 10) {
      event.preventDefault();
    }
  }

  /**
   * Handle touch end
   */
  function handleTouchEnd(_event: TouchEvent): void {
    if (!state.isTracking) return;

    state.isTracking = false;

    const deltaX = state.currentX - state.startX;
    const deltaY = state.currentY - state.startY;
    const deltaTime = Date.now() - state.startTime;

    // Check if swipe was too slow
    if (deltaTime > settings.maxTime) {
      return;
    }

    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // Determine swipe direction
    let direction: SwipeDirection = 'none';

    if (absX > absY && absX >= settings.threshold) {
      // Horizontal swipe
      direction = deltaX > 0 ? 'right' : 'left';
    } else if (settings.allowVertical && absY > absX && absY >= settings.threshold) {
      // Vertical swipe
      direction = deltaY > 0 ? 'down' : 'up';
    }

    // Fire callbacks
    if (direction !== 'none') {
      const distance = direction === 'left' || direction === 'right' ? absX : absY;
      settings.onSwipe(direction, distance);

      switch (direction) {
        case 'left':
          settings.onSwipeLeft();
          break;
        case 'right':
          settings.onSwipeRight();
          break;
        case 'up':
          settings.onSwipeUp();
          break;
        case 'down':
          settings.onSwipeDown();
          break;
      }
    }
  }

  /**
   * Handle touch cancel
   */
  function handleTouchCancel(): void {
    state.isTracking = false;
  }

  /**
   * Get current swipe progress (0-1)
   */
  function getSwipeProgress(): { x: number; y: number; direction: SwipeDirection } {
    if (!state.isTracking) {
      return { x: 0, y: 0, direction: 'none' };
    }

    const deltaX = state.currentX - state.startX;
    const deltaY = state.currentY - state.startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    const progressX = Math.min(absX / settings.threshold, 1);
    const progressY = Math.min(absY / settings.threshold, 1);

    let direction: SwipeDirection = 'none';
    if (absX > absY) {
      direction = deltaX > 0 ? 'right' : 'left';
    } else if (absY > absX) {
      direction = deltaY > 0 ? 'down' : 'up';
    }

    return { x: progressX, y: progressY, direction };
  }

  return {
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
    getSwipeProgress
  };
}

/**
 * Svelte action for swipe gestures
 *
 * Usage in Svelte:
 * <div use:swipeGesture={{ onSwipeLeft: () => delete() }}>
 */
export function swipeGesture(node: HTMLElement, config: SwipeGestureConfig = {}) {
  const handlers = createSwipeGestureHandlers(config);

  node.addEventListener('touchstart', handlers.handleTouchStart, { passive: true });
  node.addEventListener('touchmove', handlers.handleTouchMove, { passive: false });
  node.addEventListener('touchend', handlers.handleTouchEnd, { passive: true });
  node.addEventListener('touchcancel', handlers.handleTouchCancel, { passive: true });

  return {
    update(newConfig: SwipeGestureConfig) {
      // Remove old listeners
      node.removeEventListener('touchstart', handlers.handleTouchStart);
      node.removeEventListener('touchmove', handlers.handleTouchMove);
      node.removeEventListener('touchend', handlers.handleTouchEnd);
      node.removeEventListener('touchcancel', handlers.handleTouchCancel);

      // Create new handlers with updated config
      const newHandlers = createSwipeGestureHandlers(newConfig);

      node.addEventListener('touchstart', newHandlers.handleTouchStart, { passive: true });
      node.addEventListener('touchmove', newHandlers.handleTouchMove, { passive: false });
      node.addEventListener('touchend', newHandlers.handleTouchEnd, { passive: true });
      node.addEventListener('touchcancel', newHandlers.handleTouchCancel, { passive: true });
    },
    destroy() {
      node.removeEventListener('touchstart', handlers.handleTouchStart);
      node.removeEventListener('touchmove', handlers.handleTouchMove);
      node.removeEventListener('touchend', handlers.handleTouchEnd);
      node.removeEventListener('touchcancel', handlers.handleTouchCancel);
    }
  };
}
