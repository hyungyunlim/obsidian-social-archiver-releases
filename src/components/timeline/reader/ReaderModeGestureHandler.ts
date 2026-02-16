/**
 * ReaderModeGestureHandler - Pointer-based swipe detection for reader mode
 *
 * Uses pointer events (pointerdown, pointermove, pointerup) for cross-platform
 * support (mouse + touch). Resolves scroll vs swipe conflicts by checking
 * which axis accumulates movement first.
 *
 * Navigation threshold: 25% screen width OR 500px/s velocity.
 * Rubber-band effect (0.3 damping) at boundaries.
 */

export interface GestureCallbacks {
  onSwipeProgress: (progress: number) => void;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  onSwipeCancel: () => void;
  isAtStart: () => boolean;
  isAtEnd: () => boolean;
}

export class ReaderModeGestureHandler {
  private el: HTMLElement;
  private callbacks: GestureCallbacks;

  private tracking = false;
  private dragMode = false;
  private scrollMode = false;
  private startX = 0;
  private startY = 0;
  private startTime = 0;
  private currentDeltaX = 0;

  // Thresholds
  private static readonly SCROLL_LOCK_PX = 20;
  private static readonly DRAG_LOCK_PX = 40;
  private static readonly NAV_RATIO = 0.25;
  private static readonly NAV_VELOCITY = 500; // px/s
  private static readonly BOUNDARY_DAMPING = 0.3;

  // Bound handlers for cleanup
  private onPointerDown: (e: PointerEvent) => void;
  private onPointerMove: (e: PointerEvent) => void;
  private onPointerUp: (e: PointerEvent) => void;

  constructor(el: HTMLElement, callbacks: GestureCallbacks) {
    this.el = el;
    this.callbacks = callbacks;

    this.onPointerDown = this.handlePointerDown.bind(this);
    this.onPointerMove = this.handlePointerMove.bind(this);
    this.onPointerUp = this.handlePointerUp.bind(this);

    this.el.addEventListener('pointerdown', this.onPointerDown);
  }

  destroy(): void {
    this.el.removeEventListener('pointerdown', this.onPointerDown);
    document.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerup', this.onPointerUp);
    document.removeEventListener('pointercancel', this.onPointerUp);
  }

  private handlePointerDown(e: PointerEvent): void {
    // Only track primary pointer (left mouse / first touch)
    if (e.button !== 0) return;

    // Desktop: skip mouse events — text selection via drag takes priority.
    // Keyboard arrows handle navigation on desktop.
    if (e.pointerType === 'mouse') return;

    // Don't interfere with an active text selection (e.g. long-press handles)
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) return;

    this.tracking = true;
    this.dragMode = false;
    this.scrollMode = false;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.startTime = Date.now();
    this.currentDeltaX = 0;

    document.addEventListener('pointermove', this.onPointerMove);
    document.addEventListener('pointerup', this.onPointerUp);
    document.addEventListener('pointercancel', this.onPointerUp);
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.tracking) return;

    // If a text selection appeared (e.g. long-press on mobile), abort tracking
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) {
      this.tracking = false;
      this.dragMode = false;
      return;
    }

    const deltaX = e.clientX - this.startX;
    const deltaY = e.clientY - this.startY;
    const absDX = Math.abs(deltaX);
    const absDY = Math.abs(deltaY);

    // Phase 1: Determine intent (scroll vs swipe)
    if (!this.dragMode && !this.scrollMode) {
      if (absDY > ReaderModeGestureHandler.SCROLL_LOCK_PX) {
        // Vertical movement first → allow scroll, cancel swipe tracking
        this.scrollMode = true;
        return;
      }
      if (absDX > ReaderModeGestureHandler.DRAG_LOCK_PX) {
        // Horizontal movement first → enter drag mode
        this.dragMode = true;
      }
      return;
    }

    if (this.scrollMode) return;

    // Phase 2: Drag mode — report progress
    e.preventDefault(); // Prevent scroll while dragging

    let effectiveDelta = deltaX;

    // Apply rubber-band damping at boundaries
    if ((deltaX > 0 && this.callbacks.isAtStart()) || (deltaX < 0 && this.callbacks.isAtEnd())) {
      effectiveDelta = deltaX * ReaderModeGestureHandler.BOUNDARY_DAMPING;
    }

    this.currentDeltaX = effectiveDelta;
    const progress = effectiveDelta / window.innerWidth;
    this.callbacks.onSwipeProgress(progress);
  }

  private handlePointerUp(_e: PointerEvent): void {
    document.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerup', this.onPointerUp);
    document.removeEventListener('pointercancel', this.onPointerUp);

    if (!this.tracking || !this.dragMode) {
      this.tracking = false;
      return;
    }

    this.tracking = false;

    const elapsed = (Date.now() - this.startTime) / 1000; // seconds
    const velocity = Math.abs(this.currentDeltaX) / Math.max(elapsed, 0.01);
    const ratio = Math.abs(this.currentDeltaX) / window.innerWidth;

    const navigated = ratio >= ReaderModeGestureHandler.NAV_RATIO || velocity >= ReaderModeGestureHandler.NAV_VELOCITY;

    if (navigated && this.currentDeltaX > 0 && !this.callbacks.isAtStart()) {
      this.callbacks.onSwipeRight(); // swipe right → prev post
    } else if (navigated && this.currentDeltaX < 0 && !this.callbacks.isAtEnd()) {
      this.callbacks.onSwipeLeft(); // swipe left → next post
    } else {
      this.callbacks.onSwipeCancel();
    }
  }
}
