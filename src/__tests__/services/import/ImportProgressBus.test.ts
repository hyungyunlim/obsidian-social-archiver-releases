/**
 * Unit tests for ImportProgressBus — publish/subscribe semantics.
 */

import { describe, it, expect, vi } from 'vitest';
import { ImportProgressBus } from '@/services/import/ImportProgressBus';

describe('ImportProgressBus', () => {
  it('delivers events to each subscriber', () => {
    const bus = new ImportProgressBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(a);
    bus.subscribe(b);
    bus.emit({ type: 'job.started', jobId: 'x' });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe removes a listener', () => {
    const bus = new ImportProgressBus();
    const cb = vi.fn();
    const off = bus.subscribe(cb);
    off();
    bus.emit({ type: 'job.started', jobId: 'x' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('listener errors do not affect other listeners', () => {
    const bus = new ImportProgressBus();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = vi.fn();
    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe(ok);
    expect(() => bus.emit({ type: 'job.started', jobId: 'x' })).not.toThrow();
    expect(ok).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('clear() removes all subscribers', () => {
    const bus = new ImportProgressBus();
    bus.subscribe(() => {});
    bus.subscribe(() => {});
    expect(bus.listenerCount).toBe(2);
    bus.clear();
    expect(bus.listenerCount).toBe(0);
  });
});
