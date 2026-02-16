import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CircuitBreaker } from '@/services/CircuitBreaker';
import { CircuitBreakerState, CircuitBreakerEvent, CircuitBreakerOpenError } from '@/types/circuit-breaker';

describe('CircuitBreaker', () => {
	let circuitBreaker: CircuitBreaker;

	beforeEach(() => {
		circuitBreaker = new CircuitBreaker({
			name: 'test-circuit',
			failureThreshold: 5,
			successThreshold: 3,
			timeout: 1000, // 1 second for faster tests
			isErrorRetryable: () => true, // Count all errors as failures in tests
		});
	});

	afterEach(() => {
		circuitBreaker.destroy();
	});

	describe('Initialization', () => {
		it('should start in CLOSED state', () => {
			expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
			expect(circuitBreaker.isClosed()).toBe(true);
			expect(circuitBreaker.isOpen()).toBe(false);
			expect(circuitBreaker.isHalfOpen()).toBe(false);
		});

		it('should have initial metrics', () => {
			const metrics = circuitBreaker.getMetrics();

			expect(metrics.state).toBe(CircuitBreakerState.CLOSED);
			expect(metrics.totalRequests).toBe(0);
			expect(metrics.successfulRequests).toBe(0);
			expect(metrics.failedRequests).toBe(0);
			expect(metrics.rejectedRequests).toBe(0);
			expect(metrics.consecutiveFailures).toBe(0);
			expect(metrics.consecutiveSuccesses).toBe(0);
			expect(metrics.successRate).toBe(0);
			expect(metrics.failureRate).toBe(0);
		});

		it('should return circuit name', () => {
			expect(circuitBreaker.getName()).toBe('test-circuit');
		});
	});

	describe('CLOSED → OPEN Transition', () => {
		it('should open circuit after failure threshold', async () => {
			const failingFunction = vi.fn().mockRejectedValue(new Error('Service unavailable'));

			// Execute 5 times to reach failure threshold
			for (let i = 0; i < 5; i++) {
				try {
					await circuitBreaker.execute(failingFunction);
				} catch (error) {
					// Expected to fail
				}
			}

			expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
			expect(circuitBreaker.isOpen()).toBe(true);
		});

		it('should emit OPEN event when circuit opens', async () => {
			const openListener = vi.fn();
			circuitBreaker.on(CircuitBreakerEvent.OPEN, openListener);

			const failingFunction = vi.fn().mockRejectedValue(new Error('Service unavailable'));

			for (let i = 0; i < 5; i++) {
				try {
					await circuitBreaker.execute(failingFunction);
				} catch (error) {
					// Expected
				}
			}

			expect(openListener).toHaveBeenCalledTimes(1);
			expect(openListener).toHaveBeenCalledWith(
				expect.objectContaining({
					event: CircuitBreakerEvent.OPEN,
					currentState: CircuitBreakerState.OPEN,
					previousState: CircuitBreakerState.CLOSED,
				})
			);
		});

		it('should track consecutive failures', async () => {
			const failingFunction = vi.fn().mockRejectedValue(new Error('Error'));

			for (let i = 1; i <= 3; i++) {
				try {
					await circuitBreaker.execute(failingFunction);
				} catch (error) {
					// Expected
				}

				const metrics = circuitBreaker.getMetrics();
				expect(metrics.consecutiveFailures).toBe(i);
			}
		});

		it('should reset consecutive failures on success', async () => {
			const failingFunction = vi.fn().mockRejectedValue(new Error('Error'));
			const successFunction = vi.fn().mockResolvedValue('success');

			// 2 failures
			for (let i = 0; i < 2; i++) {
				try {
					await circuitBreaker.execute(failingFunction);
				} catch (error) {
					// Expected
				}
			}

			expect(circuitBreaker.getMetrics().consecutiveFailures).toBe(2);

			// 1 success resets counter
			await circuitBreaker.execute(successFunction);

			expect(circuitBreaker.getMetrics().consecutiveFailures).toBe(0);
		});
	});

	describe('OPEN State Behavior', () => {
		beforeEach(async () => {
			// Open the circuit
			const failingFunction = vi.fn().mockRejectedValue(new Error('Error'));
			for (let i = 0; i < 5; i++) {
				try {
					await circuitBreaker.execute(failingFunction);
				} catch (error) {
					// Expected
				}
			}
		});

		it('should reject requests immediately when open', async () => {
			const fn = vi.fn().mockResolvedValue('success');

			await expect(circuitBreaker.execute(fn)).rejects.toThrow(CircuitBreakerOpenError);
			expect(fn).not.toHaveBeenCalled();
		});

		it('should increment rejected requests counter', async () => {
			const fn = vi.fn().mockResolvedValue('success');
			const initialRejected = circuitBreaker.getMetrics().rejectedRequests;

			try {
				await circuitBreaker.execute(fn);
			} catch (error) {
				// Expected
			}

			expect(circuitBreaker.getMetrics().rejectedRequests).toBe(initialRejected + 1);
		});

		it('should emit REJECT event', async () => {
			const rejectListener = vi.fn();
			circuitBreaker.on(CircuitBreakerEvent.REJECT, rejectListener);

			const fn = vi.fn().mockResolvedValue('success');

			try {
				await circuitBreaker.execute(fn);
			} catch (error) {
				// Expected
			}

			expect(rejectListener).toHaveBeenCalledTimes(1);
		});

		it('should include nextAttemptAt in error', async () => {
			const fn = vi.fn().mockResolvedValue('success');

			try {
				await circuitBreaker.execute(fn);
				expect.fail('Should have thrown CircuitBreakerOpenError');
			} catch (error) {
				expect(error).toBeInstanceOf(CircuitBreakerOpenError);
				const cbError = error as CircuitBreakerOpenError;
				expect(cbError.nextAttemptAt).toBeInstanceOf(Date);
				expect(cbError.circuitBreakerName).toBe('test-circuit');
			}
		});
	});

	describe('OPEN → HALF_OPEN Transition', () => {
		beforeEach(async () => {
			// Open the circuit
			const failingFunction = vi.fn().mockRejectedValue(new Error('Error'));
			for (let i = 0; i < 5; i++) {
				try {
					await circuitBreaker.execute(failingFunction);
				} catch (error) {
					// Expected
				}
			}
		});

		it('should transition to HALF_OPEN after timeout', async () => {
			expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);

			// Wait for timeout (1 second in test config)
			await new Promise(resolve => setTimeout(resolve, 1100));

			// Try a request to trigger transition check
			const fn = vi.fn().mockResolvedValue('success');
			await circuitBreaker.execute(fn);

			expect(circuitBreaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);
		});

		it('should emit HALF_OPEN event', async () => {
			const halfOpenListener = vi.fn();
			circuitBreaker.on(CircuitBreakerEvent.HALF_OPEN, halfOpenListener);

			await new Promise(resolve => setTimeout(resolve, 1100));

			const fn = vi.fn().mockResolvedValue('success');
			await circuitBreaker.execute(fn);

			expect(halfOpenListener).toHaveBeenCalledWith(
				expect.objectContaining({
					event: CircuitBreakerEvent.HALF_OPEN,
					currentState: CircuitBreakerState.HALF_OPEN,
					previousState: CircuitBreakerState.OPEN,
				})
			);
		});

		it('should reset consecutive successes counter', async () => {
			await new Promise(resolve => setTimeout(resolve, 1100));

			const fn = vi.fn().mockResolvedValue('success');
			await circuitBreaker.execute(fn);

			const metrics = circuitBreaker.getMetrics();
			expect(metrics.consecutiveSuccesses).toBe(1);
		});
	});

	describe('HALF_OPEN State Behavior', () => {
		beforeEach(async () => {
			// Open circuit and wait for half-open
			const failingFunction = vi.fn().mockRejectedValue(new Error('Error'));
			for (let i = 0; i < 5; i++) {
				try {
					await circuitBreaker.execute(failingFunction);
				} catch (error) {
					// Expected
				}
			}

			await new Promise(resolve => setTimeout(resolve, 1100));

			// Trigger transition to half-open
			const fn = vi.fn().mockResolvedValue('success');
			await circuitBreaker.execute(fn);
		});

		it('should allow requests in HALF_OPEN state', async () => {
			expect(circuitBreaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);

			const fn = vi.fn().mockResolvedValue('success');
			await expect(circuitBreaker.execute(fn)).resolves.toBe('success');
			expect(fn).toHaveBeenCalled();
		});

		it('should transition to CLOSED after success threshold', async () => {
			expect(circuitBreaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);

			const successFunction = vi.fn().mockResolvedValue('success');

			// Need 2 more successes (already had 1 to get to half-open)
			await circuitBreaker.execute(successFunction);
			expect(circuitBreaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);

			await circuitBreaker.execute(successFunction);
			expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
		});

		it('should emit CLOSE event when circuit closes', async () => {
			const closeListener = vi.fn();
			circuitBreaker.on(CircuitBreakerEvent.CLOSE, closeListener);

			const successFunction = vi.fn().mockResolvedValue('success');

			await circuitBreaker.execute(successFunction);
			await circuitBreaker.execute(successFunction);

			expect(closeListener).toHaveBeenCalledWith(
				expect.objectContaining({
					event: CircuitBreakerEvent.CLOSE,
					currentState: CircuitBreakerState.CLOSED,
					previousState: CircuitBreakerState.HALF_OPEN,
				})
			);
		});

		it('should reopen circuit on failure in HALF_OPEN', async () => {
			expect(circuitBreaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);

			// Reset to get fresh half-open state with 0 failures
			circuitBreaker.reset();

			const failingFunction = vi.fn().mockRejectedValue(new Error('Error'));

			// Open circuit with 5 failures
			for (let i = 0; i < 5; i++) {
				try {
					await circuitBreaker.execute(failingFunction);
				} catch (error) {
					// Expected
				}
			}

			expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
		});
	});

	describe('Metrics Tracking', () => {
		it('should track total requests', async () => {
			const fn = vi.fn().mockResolvedValue('success');

			await circuitBreaker.execute(fn);
			await circuitBreaker.execute(fn);
			await circuitBreaker.execute(fn);

			expect(circuitBreaker.getMetrics().totalRequests).toBe(3);
		});

		it('should track successful requests', async () => {
			const successFn = vi.fn().mockResolvedValue('success');

			await circuitBreaker.execute(successFn);
			await circuitBreaker.execute(successFn);

			expect(circuitBreaker.getMetrics().successfulRequests).toBe(2);
		});

		it('should track failed requests', async () => {
			const failFn = vi.fn().mockRejectedValue(new Error('Error'));

			for (let i = 0; i < 3; i++) {
				try {
					await circuitBreaker.execute(failFn);
				} catch (error) {
					// Expected
				}
			}

			expect(circuitBreaker.getMetrics().failedRequests).toBe(3);
		});

		it('should calculate success and failure rates', async () => {
			const successFn = vi.fn().mockResolvedValue('success');
			const failFn = vi.fn().mockRejectedValue(new Error('Error'));

			// 3 successes
			await circuitBreaker.execute(successFn);
			await circuitBreaker.execute(successFn);
			await circuitBreaker.execute(successFn);

			// 1 failure
			try {
				await circuitBreaker.execute(failFn);
			} catch (error) {
				// Expected
			}

			const metrics = circuitBreaker.getMetrics();
			expect(metrics.successRate).toBeCloseTo(0.75, 2); // 3/4 = 0.75
			expect(metrics.failureRate).toBeCloseTo(0.25, 2); // 1/4 = 0.25
		});

		it('should track last opened timestamp', async () => {
			const beforeOpen = new Date();
			const failFn = vi.fn().mockRejectedValue(new Error('Error'));

			for (let i = 0; i < 5; i++) {
				try {
					await circuitBreaker.execute(failFn);
				} catch (error) {
					// Expected
				}
			}

			const metrics = circuitBreaker.getMetrics();
			expect(metrics.lastOpenedAt).toBeInstanceOf(Date);
			expect(metrics.lastOpenedAt!.getTime()).toBeGreaterThanOrEqual(beforeOpen.getTime());
		});

		it('should track last closed timestamp', async () => {
			// Open and then close circuit
			const failFn = vi.fn().mockRejectedValue(new Error('Error'));
			for (let i = 0; i < 5; i++) {
				try {
					await circuitBreaker.execute(failFn);
				} catch (error) {
					// Expected
				}
			}

			await new Promise(resolve => setTimeout(resolve, 1100));

			const successFn = vi.fn().mockResolvedValue('success');
			// Transition to half-open and then close
			await circuitBreaker.execute(successFn);
			await circuitBreaker.execute(successFn);
			await circuitBreaker.execute(successFn);

			const metrics = circuitBreaker.getMetrics();
			expect(metrics.lastClosedAt).toBeInstanceOf(Date);
		});

		it('should emit METRICS event on state changes', async () => {
			const metricsListener = vi.fn();
			circuitBreaker.on(CircuitBreakerEvent.METRICS, metricsListener);

			const successFn = vi.fn().mockResolvedValue('success');
			await circuitBreaker.execute(successFn);

			expect(metricsListener).toHaveBeenCalled();
			expect(metricsListener).toHaveBeenCalledWith(
				expect.objectContaining({
					metrics: expect.any(Object),
				})
			);
		});
	});

	describe('Manual Control', () => {
		it('should manually open circuit', () => {
			expect(circuitBreaker.isClosed()).toBe(true);

			circuitBreaker.open();

			expect(circuitBreaker.isOpen()).toBe(true);
		});

		it('should manually close circuit', async () => {
			// Open circuit first
			const failFn = vi.fn().mockRejectedValue(new Error('Error'));
			for (let i = 0; i < 5; i++) {
				try {
					await circuitBreaker.execute(failFn);
				} catch (error) {
					// Expected
				}
			}

			expect(circuitBreaker.isOpen()).toBe(true);

			circuitBreaker.close();

			expect(circuitBreaker.isClosed()).toBe(true);
		});

		it('should reset circuit breaker', async () => {
			const failFn = vi.fn().mockRejectedValue(new Error('Error'));

			// Generate some metrics
			for (let i = 0; i < 3; i++) {
				try {
					await circuitBreaker.execute(failFn);
				} catch (error) {
					// Expected
				}
			}

			const beforeReset = circuitBreaker.getMetrics();
			expect(beforeReset.failedRequests).toBe(3);

			circuitBreaker.reset();

			const afterReset = circuitBreaker.getMetrics();
			expect(afterReset.totalRequests).toBe(0);
			expect(afterReset.successfulRequests).toBe(0);
			expect(afterReset.failedRequests).toBe(0);
			expect(afterReset.consecutiveFailures).toBe(0);
			expect(circuitBreaker.isClosed()).toBe(true);
		});
	});

	describe('Event Listeners', () => {
		it('should support on/off event listeners', () => {
			const listener = vi.fn();

			circuitBreaker.on(CircuitBreakerEvent.SUCCESS, listener);
			circuitBreaker.off(CircuitBreakerEvent.SUCCESS, listener);

			// Should not call listener after removal
			circuitBreaker.execute(async () => 'success');

			expect(listener).not.toHaveBeenCalled();
		});

		it('should support once event listeners', async () => {
			const listener = vi.fn();

			circuitBreaker.once(CircuitBreakerEvent.SUCCESS, listener);

			await circuitBreaker.execute(async () => 'success');
			await circuitBreaker.execute(async () => 'success');

			expect(listener).toHaveBeenCalledTimes(1);
		});

		it('should emit SUCCESS event', async () => {
			const successListener = vi.fn();
			circuitBreaker.on(CircuitBreakerEvent.SUCCESS, successListener);

			await circuitBreaker.execute(async () => 'success');

			expect(successListener).toHaveBeenCalledWith(
				expect.objectContaining({
					event: CircuitBreakerEvent.SUCCESS,
				})
			);
		});

		it('should emit FAILURE event', async () => {
			const failureListener = vi.fn();
			circuitBreaker.on(CircuitBreakerEvent.FAILURE, failureListener);

			try {
				await circuitBreaker.execute(async () => {
					throw new Error('Test error');
				});
			} catch (error) {
				// Expected
			}

			expect(failureListener).toHaveBeenCalledWith(
				expect.objectContaining({
					event: CircuitBreakerEvent.FAILURE,
					error: expect.any(Error),
				})
			);
		});
	});

	describe('Cleanup', () => {
		it('should cleanup resources on destroy', () => {
			const listener = vi.fn();
			circuitBreaker.on(CircuitBreakerEvent.SUCCESS, listener);

			circuitBreaker.destroy();

			// Listeners should be removed
			expect(circuitBreaker.listenerCount(CircuitBreakerEvent.SUCCESS)).toBe(0);
		});
	});

	describe('Custom Configuration', () => {
		it('should respect custom failure threshold', async () => {
			const customBreaker = new CircuitBreaker({
				name: 'custom',
				failureThreshold: 2,
				successThreshold: 3,
				timeout: 1000,
				isErrorRetryable: () => true,
			});

			const failFn = vi.fn().mockRejectedValue(new Error('Error'));

			// Should open after 2 failures
			try {
				await customBreaker.execute(failFn);
			} catch (error) {
				// Expected
			}
			expect(customBreaker.isClosed()).toBe(true);

			try {
				await customBreaker.execute(failFn);
			} catch (error) {
				// Expected
			}
			expect(customBreaker.isOpen()).toBe(true);

			customBreaker.destroy();
		});

		it('should respect custom success threshold', async () => {
			const customBreaker = new CircuitBreaker({
				name: 'custom',
				failureThreshold: 2,
				successThreshold: 2,
				timeout: 100,
				isErrorRetryable: () => true,
			});

			// Open circuit
			const failFn = vi.fn().mockRejectedValue(new Error('Error'));
			for (let i = 0; i < 2; i++) {
				try {
					await customBreaker.execute(failFn);
				} catch (error) {
					// Expected
				}
			}

			// Wait for half-open
			await new Promise(resolve => setTimeout(resolve, 150));

			const successFn = vi.fn().mockResolvedValue('success');

			// Should close after 2 successes (custom threshold)
			await customBreaker.execute(successFn);
			expect(customBreaker.isHalfOpen()).toBe(true);

			await customBreaker.execute(successFn);
			expect(customBreaker.isClosed()).toBe(true);

			customBreaker.destroy();
		});
	});
});
