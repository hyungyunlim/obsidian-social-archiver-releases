import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TTSState, TTS_EVENT } from '@/services/tts/TTSState';
import type { TTSStateChangeDetail, TTSSentenceChangeDetail, TTSErrorDetail } from '@/services/tts/types';

describe('TTSState', () => {
	let state: TTSState;

	beforeEach(() => {
		state = new TTSState();
	});

	describe('initial state', () => {
		it('should start in idle status', () => {
			expect(state.status).toBe('idle');
		});

		it('should have sentenceIndex -1', () => {
			expect(state.sentenceIndex).toBe(-1);
		});

		it('should have sentenceTotal 0', () => {
			expect(state.sentenceTotal).toBe(0);
		});

		it('should not be playing', () => {
			expect(state.isPlaying).toBe(false);
		});

		it('should not be paused', () => {
			expect(state.isPaused).toBe(false);
		});

		it('should not be active', () => {
			expect(state.isActive).toBe(false);
		});
	});

	describe('transition', () => {
		it('should transition idle -> loading', () => {
			expect(state.transition('loading')).toBe(true);
			expect(state.status).toBe('loading');
		});

		it('should transition loading -> synthesizing', () => {
			state.transition('loading');
			expect(state.transition('synthesizing')).toBe(true);
			expect(state.status).toBe('synthesizing');
		});

		it('should transition synthesizing -> playing', () => {
			state.transition('loading');
			state.transition('synthesizing');
			expect(state.transition('playing')).toBe(true);
			expect(state.status).toBe('playing');
			expect(state.isPlaying).toBe(true);
		});

		it('should transition playing -> paused', () => {
			state.transition('loading');
			state.transition('synthesizing');
			state.transition('playing');
			expect(state.transition('paused')).toBe(true);
			expect(state.status).toBe('paused');
			expect(state.isPaused).toBe(true);
			expect(state.isPlaying).toBe(false);
		});

		it('should transition paused -> playing', () => {
			state.transition('loading');
			state.transition('synthesizing');
			state.transition('playing');
			state.transition('paused');
			expect(state.transition('playing')).toBe(true);
			expect(state.status).toBe('playing');
		});

		it('should transition playing -> synthesizing (for next sentence)', () => {
			state.transition('loading');
			state.transition('synthesizing');
			state.transition('playing');
			expect(state.transition('synthesizing')).toBe(true);
			expect(state.status).toBe('synthesizing');
		});

		it('should transition playing -> idle (playback complete)', () => {
			state.transition('loading');
			state.transition('synthesizing');
			state.transition('playing');
			expect(state.transition('idle')).toBe(true);
			expect(state.status).toBe('idle');
		});

		it('should reject invalid transitions', () => {
			// idle -> playing is not valid (must go through loading/synthesizing)
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			expect(state.transition('playing')).toBe(false);
			expect(state.status).toBe('idle');
			consoleSpy.mockRestore();
		});

		it('should return true for no-op same-state transition', () => {
			expect(state.transition('idle')).toBe(true);
			expect(state.status).toBe('idle');
		});

		it('should reset sentence tracking when transitioning to idle', () => {
			state.transition('loading');
			state.transition('synthesizing');
			state.transition('playing');
			state.setSentence(5, 10, 'Test sentence');
			state.transition('idle');
			expect(state.sentenceIndex).toBe(-1);
			expect(state.sentenceTotal).toBe(0);
		});
	});

	describe('events', () => {
		it('should emit statuschange event on transition', () => {
			const handler = vi.fn();
			state.addEventListener(TTS_EVENT.STATUS_CHANGE, handler);

			state.transition('loading');

			expect(handler).toHaveBeenCalledTimes(1);
			const event = handler.mock.calls[0][0] as CustomEvent<TTSStateChangeDetail>;
			expect(event.detail.previous).toBe('idle');
			expect(event.detail.current).toBe('loading');
		});

		it('should not emit statuschange for same-state no-op', () => {
			const handler = vi.fn();
			state.addEventListener(TTS_EVENT.STATUS_CHANGE, handler);

			state.transition('idle'); // same state

			expect(handler).not.toHaveBeenCalled();
		});

		it('should emit sentencechange event on setSentence', () => {
			const handler = vi.fn();
			state.addEventListener(TTS_EVENT.SENTENCE_CHANGE, handler);

			state.setSentence(2, 10, 'Hello world.');

			expect(handler).toHaveBeenCalledTimes(1);
			const event = handler.mock.calls[0][0] as CustomEvent<TTSSentenceChangeDetail>;
			expect(event.detail.index).toBe(2);
			expect(event.detail.total).toBe(10);
			expect(event.detail.text).toBe('Hello world.');
		});
	});

	describe('setSentence', () => {
		it('should update sentence tracking properties', () => {
			state.setSentence(3, 8, 'Test sentence.');
			expect(state.sentenceIndex).toBe(3);
			expect(state.sentenceTotal).toBe(8);
		});
	});

	describe('emitError', () => {
		it('should transition to error state', () => {
			state.transition('loading');
			state.emitError('Something went wrong', 'azure', true);
			expect(state.status).toBe('error');
		});

		it('should emit statuschange and error events', () => {
			const statusHandler = vi.fn();
			const errorHandler = vi.fn();
			state.addEventListener(TTS_EVENT.STATUS_CHANGE, statusHandler);
			state.addEventListener(TTS_EVENT.ERROR, errorHandler);

			state.transition('loading');
			statusHandler.mockClear();

			state.emitError('Test error', 'supertonic', false);

			// statuschange: loading -> error
			expect(statusHandler).toHaveBeenCalledTimes(1);
			const statusEvent = statusHandler.mock.calls[0][0] as CustomEvent<TTSStateChangeDetail>;
			expect(statusEvent.detail.previous).toBe('loading');
			expect(statusEvent.detail.current).toBe('error');

			// error event
			expect(errorHandler).toHaveBeenCalledTimes(1);
			const errorEvent = errorHandler.mock.calls[0][0] as CustomEvent<TTSErrorDetail>;
			expect(errorEvent.detail.message).toBe('Test error');
			expect(errorEvent.detail.provider).toBe('supertonic');
			expect(errorEvent.detail.recoverable).toBe(false);
		});

		it('should work from any state', () => {
			// From idle
			state.emitError('Error from idle');
			expect(state.status).toBe('error');

			// Reset and test from playing
			state.reset();
			state.transition('loading');
			state.transition('synthesizing');
			state.transition('playing');
			state.emitError('Error from playing');
			expect(state.status).toBe('error');
		});
	});

	describe('reset', () => {
		it('should reset to idle from any state', () => {
			state.transition('loading');
			state.transition('synthesizing');
			state.transition('playing');
			state.setSentence(5, 10, 'Test');

			state.reset();

			expect(state.status).toBe('idle');
			expect(state.sentenceIndex).toBe(-1);
			expect(state.sentenceTotal).toBe(0);
			expect(state.isActive).toBe(false);
		});

		it('should emit statuschange event when not already idle', () => {
			state.transition('loading');

			const handler = vi.fn();
			state.addEventListener(TTS_EVENT.STATUS_CHANGE, handler);

			state.reset();

			expect(handler).toHaveBeenCalledTimes(1);
			const event = handler.mock.calls[0][0] as CustomEvent<TTSStateChangeDetail>;
			expect(event.detail.previous).toBe('loading');
			expect(event.detail.current).toBe('idle');
		});

		it('should not emit event when already idle', () => {
			const handler = vi.fn();
			state.addEventListener(TTS_EVENT.STATUS_CHANGE, handler);

			state.reset();

			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe('isActive', () => {
		it('should be true for loading, synthesizing, playing, paused', () => {
			state.transition('loading');
			expect(state.isActive).toBe(true);

			state.transition('synthesizing');
			expect(state.isActive).toBe(true);

			state.transition('playing');
			expect(state.isActive).toBe(true);

			state.transition('paused');
			expect(state.isActive).toBe(true);
		});

		it('should be false for idle and error', () => {
			expect(state.isActive).toBe(false); // idle

			state.emitError('test');
			expect(state.isActive).toBe(false); // error
		});
	});
});
