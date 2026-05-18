import { describe, expect, it, vi } from 'vitest';
import { LocalLockRegistry } from '../../../plugin/locks/LocalLockRegistry';

const archiveLock = { kind: 'archiveMaterialization' as const, archiveId: 'archive-1' };
const markdownLock = { kind: 'markdownWrite' as const, archiveId: 'archive-1' };

describe('LocalLockRegistry', () => {
  it('serializes work for the same key and releases in completion order', async () => {
    const registry = new LocalLockRegistry();
    const events: string[] = [];
    let releaseFirst!: () => void;

    const first = registry.withLock(markdownLock, async () => {
      events.push('first:start');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      events.push('first:end');
    });

    const second = registry.withLock(markdownLock, async () => {
      events.push('second:start');
      events.push('second:end');
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);

    releaseFirst();
    await Promise.all([first, second]);

    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('releases the lock when the protected operation throws', async () => {
    const registry = new LocalLockRegistry();
    const events: string[] = [];

    await expect(
      registry.withLock(markdownLock, async () => {
        events.push('throwing');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await registry.withLock(markdownLock, async () => {
      events.push('after');
    });

    expect(events).toEqual(['throwing', 'after']);
  });

  it('cancels a waiter without blocking later lock users', async () => {
    const registry = new LocalLockRegistry();
    const abortController = new AbortController();
    let releaseFirst!: () => void;

    const first = registry.withLock(markdownLock, async () => {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    });

    const cancelled = registry.withLock(
      markdownLock,
      async () => {
        throw new Error('should not run');
      },
      { signal: abortController.signal },
    );

    abortController.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });

    const after = vi.fn();
    const third = registry.withLock(markdownLock, async () => {
      after();
    });

    releaseFirst();
    await Promise.all([first, third]);

    expect(after).toHaveBeenCalledOnce();
  });

  it('rejects multi-lock acquisition when keys are not in registry order', async () => {
    const registry = new LocalLockRegistry();

    await expect(
      registry.withLocks([markdownLock, archiveLock], async () => undefined),
    ).rejects.toThrow('Local locks acquired out of order');
  });

  it('serializes batch, remote-style, and delta-sync markdown writers for one archive', async () => {
    const registry = new LocalLockRegistry();
    const events: string[] = [];
    let activeWriters = 0;
    let maxActiveWriters = 0;

    async function writer(label: string): Promise<void> {
      await registry.withLocks([archiveLock, markdownLock], async () => {
        activeWriters++;
        maxActiveWriters = Math.max(maxActiveWriters, activeWriters);
        events.push(`${label}:start`);
        await Promise.resolve();
        events.push(`${label}:end`);
        activeWriters--;
      });
    }

    await Promise.all([
      writer('batch-transcription'),
      writer('remote-transcription'),
      writer('delta-sync'),
    ]);

    expect(maxActiveWriters).toBe(1);
    expect(events).toEqual([
      'batch-transcription:start',
      'batch-transcription:end',
      'remote-transcription:start',
      'remote-transcription:end',
      'delta-sync:start',
      'delta-sync:end',
    ]);
  });
});
