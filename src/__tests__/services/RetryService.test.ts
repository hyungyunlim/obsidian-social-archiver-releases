import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RetryService, CircuitState } from '@/services/RetryService';
import {
  RateLimitError,
  AuthenticationError,
  InvalidRequestError,
  NetworkError,
  TimeoutError
} from '@/types/errors/http-errors';

describe('RetryService', () => {
  let service: RetryService;

  beforeEach(async () => {
    vi.useFakeTimers();
    service = new RetryService();
    await service.initialize();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await service.cleanup();
  });

  describe('Service Lifecycle', () => {
    it('should initialize successfully', () => {
      expect(service.isServiceInitialized()).toBe(true);
      expect(service.name).toBe('RetryService');
    });

    it('should cleanup circuits', async () => {
      await service.execute(() => Promise.resolve('test'), undefined, 'test-circuit');
      await service.cleanup();

      expect(service.isServiceInitialized()).toBe(false);
    });
  });

  describe('Basic Retry Logic', () => {
    it('should succeed on first attempt', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      const result = await service.execute(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new NetworkError('Network error'))
        .mockRejectedValueOnce(new NetworkError('Network error'))
        .mockResolvedValue('success');

      const promise = service.execute(operation, { maxAttempts: 3 });

      // Fast-forward through delays
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should throw after max attempts', async () => {
      const operation = vi.fn().mockRejectedValue(new NetworkError('Network error'));

      const promise = service.execute(operation, { maxAttempts: 3 });

      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('Network error');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should not retry non-retryable errors', async () => {
      const operation = vi.fn().mockRejectedValue(new AuthenticationError('Unauthorized', 401));

      await expect(service.execute(operation)).rejects.toThrow('Unauthorized');
      expect(operation).toHaveBeenCalledTimes(1); // No retry
    });

    it('should not retry validation errors', async () => {
      const operation = vi.fn().mockRejectedValue(new InvalidRequestError('Bad request', 400));

      await expect(service.execute(operation)).rejects.toThrow('Bad request');
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe('Exponential Backoff', () => {
    it('should use exponential backoff delays', async () => {
      const operation = vi.fn().mockRejectedValue(new NetworkError('Error'));
      const delays: number[] = [];

      const config = {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 10000,
        jitterFactor: 0,
        onRetry: (_attempt: number, _error: Error, delay: number) => {
          delays.push(delay);
        }
      };

      const promise = service.execute(operation, config);
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow();

      // First delay: 1000ms, Second delay: 2000ms
      expect(delays.length).toBe(2);
      expect(delays[0]).toBe(1000); // baseDelay * 2^0
      expect(delays[1]).toBe(2000); // baseDelay * 2^1
    });

    it('should cap delay at maxDelay', async () => {
      const operation = vi.fn().mockRejectedValue(new NetworkError('Error'));
      const delays: number[] = [];

      const config = {
        maxAttempts: 5,
        baseDelay: 1000,
        maxDelay: 3000,
        jitterFactor: 0,
        onRetry: (_attempt: number, _error: Error, delay: number) => {
          delays.push(delay);
        }
      };

      const promise = service.execute(operation, config);
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow();

      // Delays should not exceed maxDelay
      expect(delays.every(delay => delay <= 3000)).toBe(true);
    });

    it('should add jitter to delays', async () => {
      const operation = vi.fn().mockRejectedValue(new NetworkError('Error'));
      const delays: number[] = [];

      const config = {
        maxAttempts: 3,
        baseDelay: 1000,
        jitterFactor: 0.3, // 30% jitter
        onRetry: (_attempt: number, _error: Error, delay: number) => {
          delays.push(delay);
        }
      };

      const promise = service.execute(operation, config);
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow();

      // With jitter, delays should vary from base
      expect(delays.length).toBe(2);
      // First delay should be around 1000ms ± 30%
      expect(delays[0]).toBeGreaterThan(700);
      expect(delays[0]).toBeLessThan(1300);
    });
  });

  describe('Rate Limit Handling', () => {
    it('should always retry rate limit errors', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new RateLimitError('Rate limited', 429))
        .mockResolvedValue('success');

      const promise = service.executeWithRateLimit(operation);
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should respect custom shouldRetry for non-rate-limit errors', async () => {
      const operation = vi.fn().mockRejectedValue(new AuthenticationError('Unauthorized', 401));

      const config = {
        shouldRetry: (error: Error) => error instanceof AuthenticationError
      };

      const promise = service.executeWithRateLimit(operation, config);
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow();
      expect(operation).toHaveBeenCalledTimes(3); // Retried because custom shouldRetry returns true
    });
  });

  describe('Circuit Breaker', () => {
    it('should start in CLOSED state', () => {
      const state = service.getCircuitState('test-circuit');
      expect(state).toBe(CircuitState.CLOSED);
    });

    it('should open circuit after failure threshold', async () => {
      const operation = vi.fn().mockRejectedValue(new NetworkError('Error'));

      // Execute 5 failures (default threshold)
      for (let i = 0; i < 5; i++) {
        try {
          const promise = service.execute(operation, { maxAttempts: 1 }, 'test-circuit');
          await vi.runAllTimersAsync();
          await promise;
        } catch {
          // Expected
        }
      }

      const state = service.getCircuitState('test-circuit');
      expect(state).toBe(CircuitState.OPEN);
    });

    it('should reject requests when circuit is OPEN', async () => {
      const operation = vi.fn().mockRejectedValue(new NetworkError('Error'));

      // Open the circuit
      for (let i = 0; i < 5; i++) {
        try {
          await service.execute(operation, { maxAttempts: 1 }, 'test-circuit');
        } catch {
          // Expected
        }
      }

      // Try to execute with open circuit
      await expect(
        service.execute(() => Promise.resolve('test'), undefined, 'test-circuit')
      ).rejects.toThrow('Circuit breaker is OPEN');
    });

    it('should transition to HALF_OPEN after timeout', async () => {
      const operation = vi.fn()
        .mockRejectedValue(new NetworkError('Error'));

      // Open the circuit
      for (let i = 0; i < 5; i++) {
        try {
          await service.execute(operation, { maxAttempts: 1 }, 'test-circuit');
        } catch {
          // Expected
        }
      }

      expect(service.getCircuitState('test-circuit')).toBe(CircuitState.OPEN);

      // Fast-forward past circuit timeout (60 seconds)
      vi.advanceTimersByTime(61000);

      // Circuit should be half-open now, allowing test requests
      operation.mockResolvedValue('success');
      await service.execute(operation, undefined, 'test-circuit');

      expect(service.getCircuitState('test-circuit')).toBe(CircuitState.HALF_OPEN);
    });

    it('should close circuit after success threshold in HALF_OPEN', async () => {
      // Open the circuit
      const failingOp = vi.fn().mockRejectedValue(new NetworkError('Error'));
      for (let i = 0; i < 5; i++) {
        try {
          await service.execute(failingOp, { maxAttempts: 1 }, 'test-circuit');
        } catch {
          // Expected
        }
      }

      // Move to HALF_OPEN
      vi.advanceTimersByTime(61000);

      // Succeed twice (default success threshold is 2)
      const successOp = vi.fn().mockResolvedValue('success');
      await service.execute(successOp, undefined, 'test-circuit');
      await service.execute(successOp, undefined, 'test-circuit');

      expect(service.getCircuitState('test-circuit')).toBe(CircuitState.CLOSED);
    });

    it('should reopen circuit on failure in HALF_OPEN', async () => {
      // Open the circuit
      const failingOp = vi.fn().mockRejectedValue(new NetworkError('Error'));
      for (let i = 0; i < 5; i++) {
        try {
          await service.execute(failingOp, { maxAttempts: 1 }, 'test-circuit');
        } catch {
          // Expected
        }
      }

      // Move to HALF_OPEN
      vi.advanceTimersByTime(61000);

      // Fail in HALF_OPEN state
      try {
        await service.execute(failingOp, { maxAttempts: 1 }, 'test-circuit');
      } catch {
        // Expected
      }

      expect(service.getCircuitState('test-circuit')).toBe(CircuitState.OPEN);
    });

    it('should handle multiple circuits independently', async () => {
      const operation = vi.fn().mockRejectedValue(new NetworkError('Error'));

      // Open circuit-1
      for (let i = 0; i < 5; i++) {
        try {
          await service.execute(operation, { maxAttempts: 1 }, 'circuit-1');
        } catch {
          // Expected
        }
      }

      // circuit-2 should still be closed
      expect(service.getCircuitState('circuit-1')).toBe(CircuitState.OPEN);
      expect(service.getCircuitState('circuit-2')).toBe(CircuitState.CLOSED);
    });

    it('should reset circuit manually', async () => {
      const operation = vi.fn().mockRejectedValue(new NetworkError('Error'));

      // Open the circuit
      for (let i = 0; i < 5; i++) {
        try {
          await service.execute(operation, { maxAttempts: 1 }, 'test-circuit');
        } catch {
          // Expected
        }
      }

      expect(service.getCircuitState('test-circuit')).toBe(CircuitState.OPEN);

      service.resetCircuit('test-circuit');

      expect(service.getCircuitState('test-circuit')).toBe(CircuitState.CLOSED);
    });
  });

  describe('Custom Configuration', () => {
    it('should use custom max attempts', async () => {
      const operation = vi.fn().mockRejectedValue(new NetworkError('Error'));

      const promise = service.execute(operation, { maxAttempts: 5 });
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow();
      expect(operation).toHaveBeenCalledTimes(5);
    });

    it('should use custom shouldRetry', async () => {
      const operation = vi.fn().mockRejectedValue(new NetworkError('Error'));

      const config = {
        shouldRetry: () => false // Never retry
      };

      await expect(service.execute(operation, config)).rejects.toThrow();
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should call onRetry callback', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new NetworkError('Error'))
        .mockResolvedValue('success');

      const onRetry = vi.fn();

      const promise = service.execute(operation, { onRetry });
      await vi.runAllTimersAsync();

      await promise;
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(NetworkError), expect.any(Number));
    });
  });

  describe('getAllCircuits', () => {
    it('should return all circuit states', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      await service.execute(operation, undefined, 'circuit-1');
      await service.execute(operation, undefined, 'circuit-2');

      const circuits = service.getAllCircuits();

      expect(circuits.size).toBe(2);
      expect(circuits.get('circuit-1')).toBe(CircuitState.CLOSED);
      expect(circuits.get('circuit-2')).toBe(CircuitState.CLOSED);
    });
  });
});
