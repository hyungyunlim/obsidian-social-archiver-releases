/**
 * Plugin TTS Type Definitions
 *
 * Core interfaces and types for the Obsidian plugin TTS system.
 * Unlike the mobile app (streaming `speak()` API), the plugin uses
 * a `synthesize() -> ArrayBuffer` pattern:
 *   - Supertonic: WAV via stdio child process
 *   - Azure Speech: MP3 via REST API
 * Both are decoded and played through the Web Audio API.
 */

// ============================================================================
// Provider Identity
// ============================================================================

/** Available TTS provider engines for the plugin. */
export type PluginTTSProviderId = 'supertonic' | 'azure';

// ============================================================================
// State Machine
// ============================================================================

/**
 * TTS playback status — forms a finite state machine:
 *
 *   idle -> loading -> synthesizing -> playing <-> paused -> idle
 *   any  -> error   -> idle
 */
export type TTSStatus =
  | 'idle'
  | 'loading'
  | 'synthesizing'
  | 'playing'
  | 'paused'
  | 'error';

/** Valid state transitions. */
export const VALID_TRANSITIONS: Record<TTSStatus, TTSStatus[]> = {
  idle: ['loading'],
  loading: ['synthesizing', 'error', 'idle'],
  synthesizing: ['playing', 'error', 'idle'],
  playing: ['paused', 'idle', 'error', 'synthesizing'],
  paused: ['playing', 'idle', 'error'],
  error: ['idle'],
};

// ============================================================================
// State Events (dispatched via EventTarget)
// ============================================================================

/** Emitted when the TTS status changes. */
export interface TTSStateChangeDetail {
  previous: TTSStatus;
  current: TTSStatus;
}

/** Emitted when the currently spoken sentence advances. */
export interface TTSSentenceChangeDetail {
  index: number;
  total: number;
  text: string;
}

/** Emitted on TTS error. */
export interface TTSErrorDetail {
  message: string;
  provider?: PluginTTSProviderId;
  recoverable: boolean;
}

/** Emitted for informational notices (e.g., provider fallback). */
export interface TTSNoticeDetail {
  message: string;
}

// ============================================================================
// Synthesis Options
// ============================================================================

export interface TTSSynthesizeOptions {
  /** Text to synthesize into audio. */
  text: string;
  /** BCP-47 language tag (e.g. 'en-US', 'ko-KR'). */
  lang?: string;
  /** Speech rate multiplier (0.5 – 2.0, default 1.0). */
  rate?: number;
  /** Voice identifier (provider-specific). */
  voiceId?: string;
}

// ============================================================================
// Voice Metadata
// ============================================================================

export interface TTSVoice {
  /** Provider-specific voice identifier. */
  id: string;
  /** Human-readable voice name. */
  name: string;
  /** BCP-47 language tag. */
  lang: string;
  /** Voice gender hint. */
  gender?: 'male' | 'female';
  /** Voice quality tier (Azure HD voices have prosody restrictions). */
  tier?: 'standard' | 'hd';
  /** Which provider owns this voice. */
  provider: PluginTTSProviderId;
}

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Contract for a plugin TTS provider.
 *
 * Each provider converts text → audio bytes. Playback is handled
 * externally by TTSAudioPlayer (Web Audio API).
 */
export interface PluginTTSProvider {
  /** Provider identifier. */
  readonly id: PluginTTSProviderId;

  /**
   * Synthesize text into raw audio bytes.
   * @returns ArrayBuffer containing WAV (Supertonic) or MP3 (Azure) data.
   */
  synthesize(options: TTSSynthesizeOptions): Promise<ArrayBuffer>;

  /** List available voices, optionally filtered by language. */
  getVoices(lang?: string): Promise<TTSVoice[]>;

  /** Whether this provider is currently available (binary installed, API key set, etc.). */
  isAvailable(): Promise<boolean>;

  /**
   * Check whether this provider supports a given BCP-47 language tag.
   * Used by TTSService to decide whether to fall back to another provider.
   */
  supportsLanguage(lang: string): boolean;

  /**
   * Cancel all in-flight synthesis requests.
   * Called on skip/stop so stale requests don't block the IPC pipeline.
   * Optional — providers that use parallel HTTP (Azure) don't need this.
   */
  cancelPendingSynthesis?(): void;

  /** Release resources (kill child process, clear caches, etc.). */
  destroy(): Promise<void>;
}

// ============================================================================
// Text Processing Re-exports (convenience)
// ============================================================================

export type { TextExtractionResult } from './TTSTextProcessor';
export type { Sentence } from './TTSSentenceParser';
