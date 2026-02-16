import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	ExponentialBackoff,
	createExponentialBackoff,
	createLinearBackoff,
	createFixedBackoff,
} from '@/services/ExponentialBackoff';
import { BackoffStrategy } from '@/types/retry';
import { CircuitBreakerOpenError } from '@/types/circuit-breaker';

describe('ExponentialBackoff', () => {
	let backoff: ExponentialBackoff;

	beforeEach(() => {
		backoff = new ExponentialBackoff({
			maxAttempts: 3,
			baseDelay: 100, // Faster tests
			maxDelay: 1000,
			jitterRange: 50,
			isRetryable: () => true, // Count all errors as retryable in tests
		});
	});

	describe('Delay Calculation', () => {
		describe('Exponential Strategy', () => {
			it('should calculate exponential delays', () => {
				const delay1 = backoff.calculateDelay(1);
				const delay2 = backoff.calculateDelay(2);
				const delay3 = backoff.calculateDelay(3);

				// Base delays: 100 * 2^0 = 100, 100 * 2^1 = 200, 100 * 2^2 = 400
				expect(delay1.baseDelay).toBe(100);
				expect(delay2.baseDelay).toBe(200);
				expect(delay3.baseDelay).toBe(400);
			});

			it('should add jitter to base delay', () => {
				const delay = backoff.calculateDelay(1);

				expect(delay.jitter).toBeGreaterThanOrEqual(0);
				expect(delay.jitter).toBeLessThanOrEqual(50);
				expect(delay.totalDelay).toBe(delay.baseDelay + delay.jitter);
			});

			it('should cap at maxDelay', () => {
				const backoffWithLowMax = new ExponentialBackoff({
					maxAttempts: 10,
					baseDelay: 100,
					maxDelay: 500,
					jitterRange: 0,
				});

				const delay = backoffWithLowMax.calculateDelay(10);

				expect(delay.baseDelay).toBe(500);
			});
		});

		describe('Linear Strategy', () => {
			it('should calculate linear delays', () => {
				const linearBackoff = new ExponentialBackoff(
					{ baseDelay: 100, maxDelay: 1000, jitterRange: 0 },
					BackoffStrategy.LINEAR
				);

				const delay1 = linearBackoff.calculateDelay(1);
				const delay2 = linearBackoff.calculateDelay(2);
				const delay3 = linearBackoff.calculateDelay(3);

				// Linear: 100 * 1 = 100, 100 * 2 = 200, 100 * 3 = 300
				expect(delay1.baseDelay).toBe(100);
				expect(delay2.baseDelay).toBe(200);
				expect(delay3.baseDelay).toBe(300);
			});
		});

		describe('Fixed Strategy', () => {
			it('should use fixed delay', () => {
				const fixedBackoff = new ExponentialBackoff(
					{ baseDelay: 100, maxDelay: 1000, jitterRange: 0 },
					BackoffStrategy.FIXED
				);

				const delay1 = fixedBackoff.calculateDelay(1);
				const delay2 = fixedBackoff.calculateDelay(2);
				const delay3 = fixedBackoff.calculateDelay(3);

				expect(delay1.baseDelay).toBe(100);
				expect(delay2.baseDelay).toBe(100);
				expect(delay3.baseDelay).toBe(100);
			});
		});
	});

	describe('Retry Execution', () => {
		it('should succeed on first attempt', async () => {
			const fn = vi.fn().mockResolvedValue('success');

			const result = await backoff.execute(fn);

			expect(result.success).toBe(true);
			expect(result.value).toBe('success');
			expect(result.attempts).toBe(1);
			expect(fn).toHaveBeenCalledTimes(1);
			expect(result.retryAttempts).toHaveLength(0);
		});

		it('should retry on failure', async () => {
			const fn = vi
				.fn()
				.mockRejectedValueOnce(new Error('Failure 1'))
				.mockRejectedValueOnce(new Error('Failure 2'))
				.mockResolvedValue('success');

			const result = await backoff.execute(fn);

			expect(result.success).toBe(true);
			expect(result.value).toBe('success');
			expect(result.attempts).toBe(3);
			expect(fn).toHaveBeenCalledTimes(3);
			expect(result.retryAttempts).toHaveLength(2);
		});

		it('should fail after max attempts', async () => {
			const fn = vi.fn().mockRejectedValue(new Error('Always fails'));

			const result = await backoff.execute(fn);

			expect(result.success).toBe(false);
			expect(result.error).toBeInstanceOf(Error);
			expect(result.error?.message).toBe('Always fails');
			expect(result.attempts).toBe(4); // Initial + 3 retries
			expect(fn).toHaveBeenCalledTimes(4);
			expect(result.retryAttempts).toHaveLength(3);
		});

		it('should track retry attempts', async () => {
			const fn = vi
				.fn()
				.mockRejectedValueOnce(new Error('Fail 1'))
				.mockRejectedValueOnce(new Error('Fail 2'))
				.mockResolvedValue('success');

			const result = await backoff.execute(fn);

			expect(result.retryAttempts).toHaveLength(2);
			expect(result.retryAttempts[0].attemptNumber).toBe(0);
			expect(result.retryAttempts[0].totalAttempts).toBe(1);
			expect(result.retryAttempts[0].error.message).toBe('Fail 1');

			expect(result.retryAttempts[1].attemptNumber).toBe(1);
			expect(result.retryAttempts[1].totalAttempts).toBe(2);
			expect(result.retryAttempts[1].error.message).toBe('Fail 2');
		});

		it('should calculate total time', async () => {
			const fn = vi
				.fn()
				.mockRejectedValueOnce(new Error('Fail'))
				.mockResolvedValue('success');

			const result = await backoff.execute(fn);

			expect(result.totalTime).toBeGreaterThan(0);
			// Should be at least baseDelay (100ms)
			expect(result.totalTime).toBeGreaterThanOrEqual(100);
		});
	});

	describe('Retry Predicate', () => {
		it('should use custom retry predicate', async () => {
			const customBackoff = new ExponentialBackoff({
				maxAttempts: 3,
				baseDelay: 10,
				maxDelay: 100,
				jitterRange: 0,
				isRetryable: (error) => error.message.includes('retryable'),
			});

			const fn = vi.fn().mockRejectedValue(new Error('not retryable'));

			const result = await customBackoff.execute(fn);

			expect(result.success).toBe(false);
			expect(result.attempts).toBe(1); // No retries
			expect(fn).toHaveBeenCalledTimes(1);
		});

		it('should retry on retryable errors', async () => {
			const customBackoff = new ExponentialBackoff({
				maxAttempts: 3,
				baseDelay: 10,
				maxDelay: 100,
				jitterRange: 0,
				isRetryable: (error) => error.message.includes('retryable'),
			});

			const fn = vi
				.fn()
				.mockRejectedValueOnce(new Error('retryable error'))
				.mockResolvedValue('success');

			const result = await customBackoff.execute(fn);

			expect(result.success).toBe(true);
			expect(result.attempts).toBe(2);
			expect(fn).toHaveBeenCalledTimes(2);
		});
	});

	describe('Circuit Breaker Integration', () => {
		it('should not retry if circuit breaker is open', async () => {
			const fn = vi.fn().mockRejectedValue(
				new CircuitBreakerOpenError('test', new Date(Date.now() + 60000))
			);

			const result = await backoff.execute(fn);

			expect(result.success).toBe(false);
			expect(result.error).toBeInstanceOf(CircuitBreakerOpenError);
			expect(result.attempts).toBe(1); // No retries
			expect(fn).toHaveBeenCalledTimes(1);
			expect(result.retryAttempts).toHaveLength(0);
		});
	});

	describe('Abort Controller Support', () => {
		it('should support abortion before execution', async () => {
			const controller = new AbortController();
			controller.abort();

			const fn = vi.fn().mockResolvedValue('success');

			const result = await backoff.execute(fn, controller.signal);

			expect(result.success).toBe(false);
			expect(result.error?.message).toBe('Operation aborted');
			expect(fn).not.toHaveBeenCalled();
		});

		it('should support abortion during retry', async () => {
			const controller = new AbortController();
			const fn = vi.fn().mockRejectedValue(new Error('Fail'));

			// Abort after first failure
			setTimeout(() => controller.abort(), 50);

			const result = await backoff.execute(fn, controller.signal);

			expect(result.success).toBe(false);
			expect(result.error?.message).toContain('abort');
		});
	});

	describe('onRetry Callback', () => {
		it('should call onRetry callback', async () => {
			const onRetry = vi.fn();
			const backoffWithCallback = new ExponentialBackoff({
				maxAttempts: 2,
				baseDelay: 10,
				maxDelay: 100,
				jitterRange: 0,
				onRetry,
				isRetryable: () => true,
			});

			const fn = vi
				.fn()
				.mockRejectedValueOnce(new Error('Fail'))
				.mockResolvedValue('success');

			await backoffWithCallback.execute(fn);

			expect(onRetry).toHaveBeenCalledTimes(1);
			expect(onRetry).toHaveBeenCalledWith(
				1,
				expect.any(Number),
				expect.any(Error)
			);
		});
	});

	describe('Configuration', () => {
		it('should return configuration', () => {
			const config = backoff.getConfig();

			expect(config.maxAttempts).toBe(3);
			expect(config.baseDelay).toBe(100);
			expect(config.maxDelay).toBe(1000);
			expect(config.jitterRange).toBe(50);
		});

		it('should return strategy', () => {
			expect(backoff.getStrategy()).toBe(BackoffStrategy.EXPONENTIAL);
		});
	});

	describe('Helper Functions', () => {
		it('should create exponential backoff', () => {
			const exp = createExponentialBackoff({ maxAttempts: 5 });

			expect(exp.getStrategy()).toBe(BackoffStrategy.EXPONENTIAL);
			expect(exp.getConfig().maxAttempts).toBe(5);
		});

		it('should create linear backoff', () => {
			const linear = createLinearBackoff({ maxAttempts: 5 });

			expect(linear.getStrategy()).toBe(BackoffStrategy.LINEAR);
			expect(linear.getConfig().maxAttempts).toBe(5);
		});

		it('should create fixed backoff', () => {
			const fixed = createFixedBackoff({ maxAttempts: 5 });

			expect(fixed.getStrategy()).toBe(BackoffStrategy.FIXED);
			expect(fixed.getConfig().maxAttempts).toBe(5);
		});
	});

	describe('Edge Cases', () => {
		it('should handle zero max attempts', async () => {
			const zeroBackoff = new ExponentialBackoff({
				maxAttempts: 0,
				baseDelay: 10,
				maxDelay: 100,
				jitterRange: 0,
			});

			const fn = vi.fn().mockRejectedValue(new Error('Fail'));

			const result = await zeroBackoff.execute(fn);

			expect(result.success).toBe(false);
			expect(result.attempts).toBe(1); // At least one attempt
			expect(fn).toHaveBeenCalledTimes(1);
		});

		it('should handle very large attempt numbers', () => {
			const delay = backoff.calculateDelay(1000);

			// Should cap at maxDelay
			expect(delay.baseDelay).toBe(1000);
		});

		it('should handle zero jitter range', () => {
			const noJitterBackoff = new ExponentialBackoff({
				maxAttempts: 3,
				baseDelay: 100,
				maxDelay: 1000,
				jitterRange: 0,
			});

			const delay = noJitterBackoff.calculateDelay(1);

			expect(delay.jitter).toBe(0);
			expect(delay.totalDelay).toBe(delay.baseDelay);
		});
	});

	describe('Jitter Randomness', () => {
		it('should produce different jitter values', () => {
			const delays = [];
			for (let i = 0; i < 10; i++) {
				delays.push(backoff.calculateDelay(1).jitter);
			}

			// Check that we have at least some variation
			const uniqueValues = new Set(delays);
			expect(uniqueValues.size).toBeGreaterThan(1);
		});

		it('should keep jitter within range', () => {
			for (let i = 0; i < 100; i++) {
				const delay = backoff.calculateDelay(1);
				expect(delay.jitter).toBeGreaterThanOrEqual(0);
				expect(delay.jitter).toBeLessThanOrEqual(50);
			}
		});
	});
});
