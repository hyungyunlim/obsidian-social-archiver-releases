/**
 * Transcription Types and Interfaces
 *
 * Types for Whisper-based audio transcription feature.
 */

import type { WhisperModel, WhisperVariant } from '../utils/whisper';

/**
 * A single transcription segment from Whisper JSON output
 */
export interface TranscriptionSegment {
  /** Segment ID (0-indexed) */
  id: number;
  /** Start time in seconds */
  start: number;
  /** End time in seconds */
  end: number;
  /** Transcribed text */
  text: string;
  /** Word-level timestamps (if enabled) */
  words?: TranscriptionWord[];
}

/**
 * Word-level timestamp data
 */
export interface TranscriptionWord {
  /** The word text */
  word: string;
  /** Start time in seconds */
  start: number;
  /** End time in seconds */
  end: number;
  /** Confidence probability (0-1) */
  probability: number;
}

/**
 * Complete transcription result from Whisper
 */
export interface TranscriptionResult {
  /** Array of transcription segments */
  segments: TranscriptionSegment[];
  /** Detected or specified language code */
  language: string;
  /** Total audio duration in seconds */
  duration: number;
  /** Processing time in milliseconds */
  processingTime: number;
  /** Whisper model used for transcription */
  model: WhisperModel;
  /** Whether word-level timestamps are included */
  hasWordTimestamps: boolean;
}

/**
 * Progress update during transcription
 */
export interface TranscriptionProgress {
  /** Progress percentage (0-100) */
  percentage: number;
  /** Current position in the audio (seconds) */
  currentTime: number;
  /** Total audio duration (seconds) */
  totalDuration: number;
  /** Human-readable status message */
  status: string;
}

/**
 * Options for starting a transcription
 */
export interface TranscriptionOptions {
  /** Whisper model to use */
  model: WhisperModel;
  /** Language code or 'auto' for detection */
  language: string;
  /** Preferred Whisper variant ('auto' to use detection priority order) */
  preferredVariant?: 'auto' | WhisperVariant;
  /** Custom Whisper binary path (overrides auto-detection) */
  customWhisperPath?: string;
  /** Skip validation for custom path (for ARM64/edge cases) */
  forceEnableCustomPath?: boolean;
  /** Audio duration in seconds (from PostData). If provided, ffprobe detection is skipped. */
  audioDuration?: number;
  /** Progress callback */
  onProgress?: (progress: TranscriptionProgress) => void;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

/**
 * Error codes for transcription failures
 */
export type TranscriptionErrorCode =
  | 'NOT_INSTALLED'
  | 'MODEL_NOT_FOUND'
  | 'AUDIO_NOT_FOUND'
  | 'INVALID_AUDIO'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'OUT_OF_MEMORY'
  | 'UNKNOWN';

/**
 * Default user-facing error messages
 */
const DEFAULT_ERROR_MESSAGES: Record<TranscriptionErrorCode, string> = {
  NOT_INSTALLED: 'Whisper is not installed. Please install it to use transcription.',
  MODEL_NOT_FOUND: 'Whisper model not found. Please download the model first.',
  AUDIO_NOT_FOUND: 'Audio file not found. Please download the audio first.',
  INVALID_AUDIO: 'Unsupported audio format. Supported: mp3, m4a, ogg, wav.',
  CANCELLED: 'Transcription was cancelled.',
  TIMEOUT: 'Transcription timed out. Try a smaller model.',
  OUT_OF_MEMORY: 'Not enough memory. Try a smaller model.',
  UNKNOWN: 'An error occurred during transcription.',
};

/**
 * Custom error class for transcription failures
 */
export class TranscriptionError extends Error {
  /** Error code for programmatic handling */
  readonly code: TranscriptionErrorCode;
  /** User-friendly error message */
  readonly userMessage: string;

  constructor(
    code: TranscriptionErrorCode,
    message: string,
    userMessage?: string
  ) {
    super(message);
    this.name = 'TranscriptionError';
    this.code = code;
    this.userMessage = userMessage || DEFAULT_ERROR_MESSAGES[code];

    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TranscriptionError);
    }
  }
}

/**
 * Transcription metadata stored in YAML frontmatter
 */
export interface TranscriptionMetadata {
  /** Whisper model used */
  model: string;
  /** Detected/specified language */
  language: string;
  /** Audio duration in seconds */
  duration: number;
  /** ISO timestamp of transcription completion */
  transcribedAt: string;
  /** Processing time in milliseconds */
  processingTime: number;
  /** Whether word timestamps are available */
  hasWordTimestamps: boolean;
}

/**
 * Whisper transcript data stored in PostData
 */
export interface WhisperTranscript {
  /** Transcription segments */
  segments: TranscriptionSegment[];
  /** Language code */
  language: string;
}

/**
 * Helper function to get user message for error code
 */
export function getTranscriptionErrorMessage(code: TranscriptionErrorCode): string {
  return DEFAULT_ERROR_MESSAGES[code];
}

/**
 * Check if an error is a TranscriptionError
 */
export function isTranscriptionError(error: unknown): error is TranscriptionError {
  return error instanceof TranscriptionError;
}
