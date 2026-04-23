/**
 * Typed event bus for import progress events.
 *
 * The UI subscribes via {@link ImportProgressBus.subscribe}; the worker
 * publishes via {@link ImportProgressBus.emit}. Subscribers are isolated —
 * an error thrown by one listener never prevents others from being called
 * and never propagates back into the worker loop.
 */

import type { ImportProgressEvent, ImportProgressSubscriber } from '@/types/import';

export class ImportProgressBus {
  private subscribers = new Set<ImportProgressSubscriber>();

  /** Subscribe to every progress event. Returns an unsubscribe handle. */
  subscribe(cb: ImportProgressSubscriber): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  /** Publish an event to every subscriber. Failures are logged and swallowed. */
  emit(evt: ImportProgressEvent): void {
    for (const cb of Array.from(this.subscribers)) {
      try {
        cb(evt);
      } catch (err) {
        // Keep the bus resilient — one bad listener must not kill the flow.
        console.error('[ImportProgressBus] subscriber threw', err);
      }
    }
  }

  /** Size of the subscriber set (for tests). */
  get listenerCount(): number {
    return this.subscribers.size;
  }

  /** Remove every subscriber. */
  clear(): void {
    this.subscribers.clear();
  }
}
