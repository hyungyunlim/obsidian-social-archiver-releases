/**
 * TrackedTimerManager - Centralized timer lifecycle management
 *
 * Tracks all setTimeout/setInterval IDs and provides bulk cleanup on dispose.
 * Prevents memory leaks from orphaned timer callbacks when components or
 * services are destroyed while timers are still pending.
 *
 * Single Responsibility: Track and clean up timer IDs
 *
 * Usage:
 *   const timers = new TrackedTimerManager();
 *   timers.setTimeout(() => doWork(), 5000);
 *   timers.setInterval(() => poll(), 60000);
 *   // On cleanup:
 *   timers.dispose(); // Clears all pending timers
 */
export class TrackedTimerManager {
  private timeoutIds = new Set<number>();
  private intervalIds = new Set<number>();

  /**
   * Schedule a tracked setTimeout. Auto-removes from tracking when it fires.
   */
  setTimeout(callback: () => void, delay: number): number {
    const id = window.setTimeout(() => {
      this.timeoutIds.delete(id);
      callback();
    }, delay);
    this.timeoutIds.add(id);
    return id;
  }

  /**
   * Schedule a tracked setInterval.
   */
  setInterval(callback: () => void, interval: number): number {
    const id = window.setInterval(callback, interval);
    this.intervalIds.add(id);
    return id;
  }

  /**
   * Cancel a specific tracked timeout.
   */
  clearTimeout(id: number): void {
    window.clearTimeout(id);
    this.timeoutIds.delete(id);
  }

  /**
   * Cancel a specific tracked interval.
   */
  clearInterval(id: number): void {
    window.clearInterval(id);
    this.intervalIds.delete(id);
  }

  /**
   * Clear all tracked timers. Call on component/service destroy.
   */
  dispose(): void {
    for (const id of this.timeoutIds) {
      window.clearTimeout(id);
    }
    this.timeoutIds.clear();

    for (const id of this.intervalIds) {
      window.clearInterval(id);
    }
    this.intervalIds.clear();
  }

  /**
   * Number of currently pending timers (for diagnostics).
   */
  get pendingCount(): number {
    return this.timeoutIds.size + this.intervalIds.size;
  }
}
