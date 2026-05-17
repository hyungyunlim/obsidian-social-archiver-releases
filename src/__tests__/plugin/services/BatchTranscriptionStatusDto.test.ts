import { describe, expect, it } from 'vitest';
import {
  snapshotTranscriptionStatus,
  type BatchTranscriptionStatusDto,
} from '@/plugin/services/BatchTranscriptionStatusDto';
import type { BatchTranscriptionManager } from '@/services/BatchTranscriptionManager';
import type { BatchOperationStatus, BatchMode, BatchProgress } from '@/types/batch-transcription';

/**
 * Build a minimal `BatchTranscriptionManager` stand-in for snapshot tests.
 * We avoid instantiating the real manager (which pulls in vault, settings,
 * and TranscriptionService) — the DTO is intentionally decoupled and only
 * reads `getStatus()` / `getProgress()`.
 */
function makeManager(
  overrides: Partial<BatchProgress> & { status?: BatchOperationStatus } = {},
): BatchTranscriptionManager {
  const progress: BatchProgress = {
    status: overrides.status ?? 'idle',
    mode: overrides.mode ?? ('transcribe-only' as BatchMode),
    totalItems: overrides.totalItems ?? 0,
    completedItems: overrides.completedItems ?? 0,
    failedItems: overrides.failedItems ?? 0,
    skippedItems: overrides.skippedItems ?? 0,
    currentIndex: overrides.currentIndex ?? 0,
    currentFile: overrides.currentFile,
    currentStage: overrides.currentStage,
    elapsedMs: overrides.elapsedMs ?? 0,
  };
  return {
    getStatus(): BatchOperationStatus {
      return progress.status;
    },
    getProgress(): BatchProgress {
      return progress;
    },
  } as unknown as BatchTranscriptionManager;
}

describe('BatchTranscriptionStatusDto', () => {
  it('produces a stable shape for idle managers', () => {
    const dto = snapshotTranscriptionStatus(makeManager());
    const keys = Object.keys(dto).sort();
    expect(keys).toEqual(
      [
        'state',
        'mode',
        'totalItems',
        'processedItems',
        'failedItems',
        'remainingItems',
        'startedAt',
        'updatedAt',
      ].sort(),
    );
    expect(dto.state).toBe('idle');
    expect(dto.mode).toBeNull();
    expect(dto.startedAt).toBeNull();
    expect(typeof dto.updatedAt).toBe('string');
    expect(dto.totalItems).toBe(0);
    expect(dto.processedItems).toBe(0);
    expect(dto.failedItems).toBe(0);
    expect(dto.remainingItems).toBe(0);
  });

  it('exposes mode + currentFilePath when the batch is running', () => {
    const dto = snapshotTranscriptionStatus(
      makeManager({
        status: 'running',
        mode: 'download-and-transcribe',
        totalItems: 5,
        completedItems: 2,
        failedItems: 1,
        skippedItems: 0,
        currentFile: 'Social Archives/Post/2026/04/note.md',
        elapsedMs: 1234,
      }),
    );
    expect(dto.state).toBe('running');
    expect(dto.mode).toBe('download-and-transcribe');
    expect(dto.totalItems).toBe(5);
    expect(dto.processedItems).toBe(2);
    expect(dto.failedItems).toBe(1);
    // 5 total - 2 done - 1 failed - 0 skipped = 2 remaining
    expect(dto.remainingItems).toBe(2);
    expect(dto.currentFilePath).toBe('Social Archives/Post/2026/04/note.md');
    expect(dto.startedAt).not.toBeNull();
  });

  it('hides currentFilePath when the batch is idle or terminal', () => {
    const idleDto = snapshotTranscriptionStatus(
      makeManager({ status: 'idle', currentFile: 'leftover.md' }),
    );
    expect(idleDto.currentFilePath).toBeUndefined();

    const completedDto = snapshotTranscriptionStatus(
      makeManager({
        status: 'completed',
        currentFile: 'leftover.md',
        totalItems: 3,
        completedItems: 3,
      }),
    );
    expect(completedDto.currentFilePath).toBeUndefined();
  });

  it('clamps remainingItems to 0 even when counters are inconsistent', () => {
    const dto = snapshotTranscriptionStatus(
      makeManager({
        status: 'running',
        totalItems: 2,
        completedItems: 5, // intentionally inconsistent
        failedItems: 0,
        skippedItems: 0,
      }),
    );
    expect(dto.remainingItems).toBe(0);
  });

  it('returns a frozen deep clone — mutations do not leak into the manager', () => {
    const manager = makeManager({
      status: 'running',
      totalItems: 1,
      completedItems: 0,
      elapsedMs: 10,
    });
    const dto = snapshotTranscriptionStatus(manager);
    expect(Object.isFrozen(dto)).toBe(true);

    // Attempting to mutate the DTO in strict mode throws; in non-strict it
    // silently fails. Either way the manager state must be unaffected.
    try {
      // @ts-expect-error: frozen object mutation
      (dto as BatchTranscriptionStatusDto).state = 'cancelled';
    } catch {
      // expected in strict mode
    }
    expect(manager.getProgress().status).toBe('running');
    expect(manager.getProgress().totalItems).toBe(1);
  });

  it('updatedAt is a valid ISO string close to now', () => {
    const before = Date.now();
    const dto = snapshotTranscriptionStatus(makeManager());
    const after = Date.now();
    const ts = Date.parse(dto.updatedAt);
    expect(Number.isFinite(ts)).toBe(true);
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(after + 1000);
  });
});
