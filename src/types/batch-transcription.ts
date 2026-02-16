/**
 * Batch Transcription Types
 *
 * Types for the batch download & transcribe feature.
 */

/** Batch processing mode */
export type BatchMode = 'transcribe-only' | 'download-and-transcribe';

/** Overall operation status */
export type BatchOperationStatus = 'idle' | 'scanning' | 'running' | 'paused' | 'completed' | 'cancelled';

/** Per-item processing status */
export type BatchItemStatus = 'pending' | 'downloading' | 'transcribing' | 'completed' | 'failed' | 'skipped';

/** A single file to be processed in the batch */
export interface BatchItem {
  filePath: string;
  status: BatchItemStatus;
  /** Local video path (resolved during scan or after download) */
  videoPath?: string;
  /** Remote video URL (for download-and-transcribe mode) */
  videoUrl?: string;
  /** Error message if failed */
  error?: string;
}

/** Aggregate progress snapshot */
export interface BatchProgress {
  status: BatchOperationStatus;
  mode: BatchMode;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  skippedItems: number;
  currentIndex: number;
  currentFile?: string;
  currentStage?: 'downloading' | 'transcribing';
  elapsedMs: number;
}

/** Persisted state for crash recovery */
export interface PersistedBatchState {
  version: 1;
  mode: BatchMode;
  status: BatchOperationStatus;
  items: BatchItem[];
  currentIndex: number;
  startedAt: number;
  pausedAt?: number;
}

/** Observer callback for progress updates */
export type BatchProgressObserver = (progress: BatchProgress) => void;
