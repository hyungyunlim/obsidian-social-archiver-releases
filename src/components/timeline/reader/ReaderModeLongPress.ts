/**
 * ReaderModeLongPress - 400ms tap-hold detection for mobile reader mode entry
 *
 * Mobile only (guarded by Platform.isMobile). Attaches pointer events
 * to a target element and fires a callback after 400ms hold, cancelled
 * if the pointer moves > 10px or lifts before the timer.
 */

import { Platform as ObsidianPlatform } from 'obsidian';

export class ReaderModeLongPress {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private startX = 0;
  private startY = 0;
  private active = false;

  private static readonly HOLD_MS = 400;
  private static readonly MOVE_THRESHOLD = 10;

  private el: HTMLElement;
  private callback: () => void;

  // Bound handlers for cleanup
  private onPointerDown!: (e: PointerEvent) => void;
  private onPointerMove!: (e: PointerEvent) => void;
  private onPointerUp!: () => void;

  constructor(el: HTMLElement, callback: () => void) {
    this.el = el;
    this.callback = callback;

    // Skip entirely on desktop
    if (!ObsidianPlatform.isMobile) return;

    this.onPointerDown = this.handleDown.bind(this);
    this.onPointerMove = this.handleMove.bind(this);
    this.onPointerUp = this.cancel.bind(this);

    this.el.addEventListener('pointerdown', this.onPointerDown);
  }

  destroy(): void {
    this.cancel();
    if (ObsidianPlatform.isMobile) {
      this.el.removeEventListener('pointerdown', this.onPointerDown);
    }
  }

  private handleDown(e: PointerEvent): void {
    // Only primary pointer
    if (e.button !== 0) return;

    this.startX = e.clientX;
    this.startY = e.clientY;
    this.active = true;

    document.addEventListener('pointermove', this.onPointerMove);
    document.addEventListener('pointerup', this.onPointerUp);
    document.addEventListener('pointercancel', this.onPointerUp);

    this.timer = setTimeout(() => {
      if (this.active) {
        this.active = false;
        this.cleanup();
        this.callback();
      }
    }, ReaderModeLongPress.HOLD_MS);
  }

  private handleMove(e: PointerEvent): void {
    if (!this.active) return;
    const dx = Math.abs(e.clientX - this.startX);
    const dy = Math.abs(e.clientY - this.startY);
    if (dx > ReaderModeLongPress.MOVE_THRESHOLD || dy > ReaderModeLongPress.MOVE_THRESHOLD) {
      this.cancel();
    }
  }

  private cancel(): void {
    this.active = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.cleanup();
  }

  private cleanup(): void {
    document.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerup', this.onPointerUp);
    document.removeEventListener('pointercancel', this.onPointerUp);
  }
}
