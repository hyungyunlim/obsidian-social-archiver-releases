/**
 * TTSState
 *
 * EventTarget-based state machine for TTS playback status.
 * Replaces Zustand (unavailable in Obsidian plugin) with CustomEvent dispatching.
 *
 * State transitions:
 *   idle -> loading -> synthesizing -> playing <-> paused -> idle
 *   any  -> error   -> idle
 *
 * Events:
 *   'statuschange'   — TTSStateChangeDetail
 *   'sentencechange'  — TTSSentenceChangeDetail
 *   'error'           — TTSErrorDetail
 */

import type {
  TTSStatus,
  TTSStateChangeDetail,
  TTSSentenceChangeDetail,
  TTSErrorDetail,
  TTSNoticeDetail,
  PluginTTSProviderId,
} from './types';
import { VALID_TRANSITIONS } from './types';

// ============================================================================
// Event name constants
// ============================================================================

export const TTS_EVENT = {
  STATUS_CHANGE: 'statuschange',
  SENTENCE_CHANGE: 'sentencechange',
  ERROR: 'error',
  NOTICE: 'notice',
} as const;

// ============================================================================
// TTSState class
// ============================================================================

export class TTSState extends EventTarget {
  private _status: TTSStatus = 'idle';
  private _sentenceIndex = -1;
  private _sentenceTotal = 0;
  private _sentenceText = '';

  // ---------- Getters -------------------------------------------------------

  get status(): TTSStatus {
    return this._status;
  }

  get sentenceIndex(): number {
    return this._sentenceIndex;
  }

  get sentenceTotal(): number {
    return this._sentenceTotal;
  }

  get isPlaying(): boolean {
    return this._status === 'playing';
  }

  get isPaused(): boolean {
    return this._status === 'paused';
  }

  get isActive(): boolean {
    return this._status !== 'idle' && this._status !== 'error';
  }

  // ---------- State transitions ---------------------------------------------

  /**
   * Transition to a new status.
   * @returns `true` if the transition was valid and applied, `false` otherwise.
   */
  transition(next: TTSStatus): boolean {
    if (this._status === next) return true; // no-op

    const allowed = VALID_TRANSITIONS[this._status];
    if (!allowed.includes(next)) {
      console.warn(
        `[TTSState] Invalid transition: ${this._status} -> ${next}`,
      );
      return false;
    }

    const previous = this._status;
    this._status = next;

    // Reset sentence tracking on idle
    if (next === 'idle') {
      this._sentenceIndex = -1;
      this._sentenceTotal = 0;
      this._sentenceText = '';
    }

    this.dispatchEvent(
      new CustomEvent<TTSStateChangeDetail>(TTS_EVENT.STATUS_CHANGE, {
        detail: { previous, current: next },
      }),
    );

    return true;
  }

  /**
   * Update the current sentence position and emit event.
   */
  setSentence(index: number, total: number, text: string): void {
    this._sentenceIndex = index;
    this._sentenceTotal = total;
    this._sentenceText = text;

    this.dispatchEvent(
      new CustomEvent<TTSSentenceChangeDetail>(TTS_EVENT.SENTENCE_CHANGE, {
        detail: { index, total, text },
      }),
    );
  }

  /**
   * Emit an error and optionally transition to 'error' status.
   */
  emitError(
    message: string,
    provider?: PluginTTSProviderId,
    recoverable = false,
  ): void {
    // Transition to error state (always valid from any state)
    const previous = this._status;
    this._status = 'error';

    this.dispatchEvent(
      new CustomEvent<TTSStateChangeDetail>(TTS_EVENT.STATUS_CHANGE, {
        detail: { previous, current: 'error' },
      }),
    );

    this.dispatchEvent(
      new CustomEvent<TTSErrorDetail>(TTS_EVENT.ERROR, {
        detail: { message, provider, recoverable },
      }),
    );
  }

  /**
   * Emit an informational notice (e.g., provider fallback).
   */
  emitNotice(message: string): void {
    this.dispatchEvent(
      new CustomEvent<TTSNoticeDetail>(TTS_EVENT.NOTICE, {
        detail: { message },
      }),
    );
  }

  /**
   * Reset to idle state unconditionally (used for cleanup).
   */
  reset(): void {
    const previous = this._status;
    this._status = 'idle';
    this._sentenceIndex = -1;
    this._sentenceTotal = 0;
    this._sentenceText = '';

    if (previous !== 'idle') {
      this.dispatchEvent(
        new CustomEvent<TTSStateChangeDetail>(TTS_EVENT.STATUS_CHANGE, {
          detail: { previous, current: 'idle' },
        }),
      );
    }
  }
}
