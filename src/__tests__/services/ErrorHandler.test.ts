import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ErrorHandler } from '@/services/ErrorHandler';
import {
  ArchiveError,
  NetworkError,
  ValidationError,
  RateLimitError,
  ErrorCode,
  ErrorSeverity,
} from '@/types/errors';

describe('ErrorHandler', () => {
  let errorHandler: ErrorHandler;

  beforeEach(() => {
    errorHandler = new ErrorHandler({
      enableLogging: true,
      enableTelemetry: false,
      maxLogEntries: 10,
    });
  });

  describe('initialization', () => {
    it('should initialize with empty log', async () => {
      await errorHandler.initialize();

      const log = errorHandler.getErrorLog();
      expect(log).toEqual([]);
    });

    it('should clear existing log on initialization', async () => {
      // Add some errors
      await errorHandler.handle(new Error('Test 1'));
      await errorHandler.handle(new Error('Test 2'));

      expect(errorHandler.getErrorLog().length).toBe(2);

      // Re-initialize
      await errorHandler.initialize();

      expect(errorHandler.getErrorLog().length).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should handle Error instances', async () => {
      const error = new Error('Test error');
      const handled = await errorHandler.handle(error);

      expect(handled).toBeInstanceOf(ArchiveError);
      expect(handled.message).toBe('Test error');
      expect(handled.code).toBe(ErrorCode.UNKNOWN_ERROR);
    });

    it('should handle ArchiveError instances', async () => {
      const error = new NetworkError({
        message: 'Network error',
      });

      const handled = await errorHandler.handle(error);

      expect(handled).toBe(error);
      expect(handled.code).toBe(ErrorCode.NETWORK_ERROR);
    });

    it('should handle string errors', async () => {
      const handled = await errorHandler.handle('String error');

      expect(handled).toBeInstanceOf(ArchiveError);
      expect(handled.message).toBe('String error');
    });

    it('should add errors to log', async () => {
      await errorHandler.handle(new Error('Test 1'));
      await errorHandler.handle(new Error('Test 2'));

      const log = errorHandler.getErrorLog();

      expect(log.length).toBe(2);
      expect(log[0].error.message).toBe('Test 1');
      expect(log[1].error.message).toBe('Test 2');
    });

    it('should add context to errors', async () => {
      const error = new Error('Test error');
      const context = {
        url: 'https://example.com',
        platform: 'facebook',
      };

      const handled = await errorHandler.handle(error, context);

      expect(handled.context.url).toBe('https://example.com');
      expect(handled.context.platform).toBe('facebook');
    });

    it('should merge context for ArchiveErrors', async () => {
      const error = new NetworkError({
        message: 'Network error',
        context: { url: 'https://example.com' },
      });

      const additionalContext = {
        platform: 'facebook',
        operation: 'archive',
      };

      const handled = await errorHandler.handle(error, additionalContext);

      expect(handled.context.url).toBe('https://example.com');
      expect(handled.context.platform).toBe('facebook');
      expect(handled.context.operation).toBe('archive');
    });

    it('should call onError callback', async () => {
      const onError = vi.fn();
      const handler = new ErrorHandler({ onError });

      const error = new Error('Test error');
      await handler.handle(error);

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(expect.any(ArchiveError));
    });
  });

  describe('error log management', () => {
    it('should limit log entries', async () => {
      const handler = new ErrorHandler({ maxLogEntries: 3 });

      // Add more errors than the limit
      await handler.handle(new Error('Error 1'));
      await handler.handle(new Error('Error 2'));
      await handler.handle(new Error('Error 3'));
      await handler.handle(new Error('Error 4'));

      const log = handler.getErrorLog();

      expect(log.length).toBe(3);
      expect(log[0].error.message).toBe('Error 2');
      expect(log[2].error.message).toBe('Error 4');
    });

    it('should generate unique error IDs', async () => {
      await errorHandler.handle(new Error('Error 1'));
      await errorHandler.handle(new Error('Error 2'));

      const log = errorHandler.getErrorLog();

      expect(log[0].id).not.toBe(log[1].id);
      expect(log[0].id).toMatch(/^err_\d+_[a-z0-9]+$/);
    });

    it('should include timestamp in log entries', async () => {
      const before = new Date();
      await errorHandler.handle(new Error('Test error'));
      const after = new Date();

      const log = errorHandler.getErrorLog();

      expect(log[0].timestamp).toBeInstanceOf(Date);
      expect(log[0].timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(log[0].timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should clear log', async () => {
      await errorHandler.handle(new Error('Error 1'));
      await errorHandler.handle(new Error('Error 2'));

      expect(errorHandler.getErrorLog().length).toBe(2);

      errorHandler.clearLog();

      expect(errorHandler.getErrorLog().length).toBe(0);
    });

    it('should get recent errors', async () => {
      for (let i = 0; i < 5; i++) {
        await errorHandler.handle(new Error(`Error ${i}`));
      }

      const recent = errorHandler.getRecentErrors(3);

      expect(recent.length).toBe(3);
      expect(recent[0].error.message).toBe('Error 2');
      expect(recent[2].error.message).toBe('Error 4');
    });
  });

  describe('error filtering', () => {
    beforeEach(async () => {
      await errorHandler.handle(
        new NetworkError({ message: 'Network error 1' })
      );
      await errorHandler.handle(
        new ValidationError({ message: 'Validation error 1' })
      );
      await errorHandler.handle(
        new NetworkError({ message: 'Network error 2' })
      );
    });

    it('should get errors by code', () => {
      const networkErrors = errorHandler.getErrorsByCode(
        ErrorCode.NETWORK_ERROR
      );
      const validationErrors = errorHandler.getErrorsByCode(
        ErrorCode.VALIDATION_ERROR
      );

      expect(networkErrors.length).toBe(2);
      expect(validationErrors.length).toBe(1);
    });

    it('should get errors by severity', () => {
      const highSeverity = errorHandler.getErrorsBySeverity(ErrorSeverity.HIGH);
      const lowSeverity = errorHandler.getErrorsBySeverity(ErrorSeverity.LOW);

      expect(highSeverity.length).toBe(2); // NetworkErrors
      expect(lowSeverity.length).toBe(1); // ValidationError
    });
  });

  describe('error statistics', () => {
    beforeEach(async () => {
      await errorHandler.handle(
        new NetworkError({ message: 'Network error 1' })
      );
      await errorHandler.handle(
        new NetworkError({ message: 'Network error 2' })
      );
      await errorHandler.handle(
        new ValidationError({ message: 'Validation error' })
      );
    });

    it('should calculate total errors', () => {
      const stats = errorHandler.getStats();

      expect(stats.totalErrors).toBe(3);
    });

    it('should count errors by code', () => {
      const stats = errorHandler.getStats();

      expect(stats.errorsByCode.get(ErrorCode.NETWORK_ERROR)).toBe(2);
      expect(stats.errorsByCode.get(ErrorCode.VALIDATION_ERROR)).toBe(1);
    });

    it('should count errors by severity', () => {
      const stats = errorHandler.getStats();

      expect(stats.errorsBySeverity.get(ErrorSeverity.HIGH)).toBe(2);
      expect(stats.errorsBySeverity.get(ErrorSeverity.LOW)).toBe(1);
    });

    it('should calculate recovery rate', () => {
      const stats = errorHandler.getStats();

      expect(stats.recoveryRate).toBe(0); // No recoveries yet
    });
  });

  describe('recovery strategies', () => {
    it('should register recovery strategies', () => {
      const strategy = vi.fn().mockResolvedValue(true);

      errorHandler.registerRecoveryStrategy(
        ErrorCode.NETWORK_ERROR,
        strategy
      );

      // Strategy registration doesn't throw
      expect(() =>
        errorHandler.registerRecoveryStrategy(ErrorCode.NETWORK_ERROR, strategy)
      ).not.toThrow();
    });

    it('should attempt recovery for retryable errors', async () => {
      const strategy = vi.fn().mockResolvedValue(true);
      errorHandler.registerRecoveryStrategy(
        ErrorCode.NETWORK_ERROR,
        strategy
      );

      const error = new NetworkError({ message: 'Network error' });
      await errorHandler.handle(error);

      expect(strategy).toHaveBeenCalledWith(error);
    });

    it('should not attempt recovery for non-retryable errors', async () => {
      const strategy = vi.fn().mockResolvedValue(true);
      errorHandler.registerRecoveryStrategy(
        ErrorCode.VALIDATION_ERROR,
        strategy
      );

      const error = new ValidationError({ message: 'Validation error' });
      await errorHandler.handle(error);

      // ValidationError has no auto-recoverable suggestions
      expect(strategy).not.toHaveBeenCalled();
    });

    it('should update recovery status in log', async () => {
      const strategy = vi.fn().mockResolvedValue(true);
      errorHandler.registerRecoveryStrategy(
        ErrorCode.RATE_LIMIT_EXCEEDED,
        strategy
      );

      const error = new RateLimitError({
        message: 'Rate limit',
        retryAfter: 1000,
      });
      await errorHandler.handle(error);

      const log = errorHandler.getErrorLog();
      const entry = log.find(e => e.error.code === ErrorCode.RATE_LIMIT_EXCEEDED);

      expect(entry?.recovered).toBe(true);
    });

    it('should handle recovery failures gracefully', async () => {
      const strategy = vi.fn().mockRejectedValue(new Error('Recovery failed'));
      errorHandler.registerRecoveryStrategy(
        ErrorCode.NETWORK_ERROR,
        strategy
      );

      const error = new NetworkError({ message: 'Network error' });

      // Should not throw
      await expect(errorHandler.handle(error)).resolves.toBeDefined();
    });
  });

  describe('utility methods', () => {
    it('should check if error should be retried', () => {
      const retryable = new NetworkError({ message: 'Network error' });
      const nonRetryable = new ValidationError({ message: 'Validation error' });
      const regularError = new Error('Regular error');

      expect(errorHandler.shouldRetry(retryable)).toBe(true);
      expect(errorHandler.shouldRetry(nonRetryable)).toBe(false);
      expect(errorHandler.shouldRetry(regularError)).toBe(false);
    });

    it('should get user message', () => {
      const error = new NetworkError({ message: 'Network error' });
      const message = errorHandler.getUserMessage(error);

      expect(message).toContain('network error occurred');
      expect(message).toContain('Suggestions:');
    });

    it('should format error for display', () => {
      const error = new NetworkError({ message: 'Network error' });
      const formatted = errorHandler.formatError(error);

      expect(formatted.title).toBe('Network Error');
      expect(formatted.message).toBeDefined();
      expect(formatted.suggestions).toBeInstanceOf(Array);
      expect(formatted.severity).toBe(ErrorSeverity.HIGH);
    });

    it('should format unknown errors', () => {
      const error = new Error('Unknown error');
      const formatted = errorHandler.formatError(error);

      expect(formatted.title).toBe('Unknown Error');
      expect(formatted.severity).toBe(ErrorSeverity.MEDIUM);
    });
  });

  describe('disposal', () => {
    it('should clear log on disposal', async () => {
      await errorHandler.handle(new Error('Error 1'));
      await errorHandler.handle(new Error('Error 2'));

      expect(errorHandler.getErrorLog().length).toBe(2);

      await errorHandler.dispose();

      expect(errorHandler.getErrorLog().length).toBe(0);
    });

    it('should clear recovery strategies on disposal', async () => {
      const strategy = vi.fn().mockResolvedValue(true);
      errorHandler.registerRecoveryStrategy(
        ErrorCode.NETWORK_ERROR,
        strategy
      );

      await errorHandler.dispose();

      // After disposal, strategies should be cleared
      const error = new NetworkError({ message: 'Network error' });
      await errorHandler.handle(error);

      expect(strategy).not.toHaveBeenCalled();
    });
  });

  describe('telemetry', () => {
    it('should send telemetry when enabled', async () => {
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const handler = new ErrorHandler({ enableTelemetry: true });

      await handler.handle(new Error('Test error'));

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Telemetry]',
        expect.objectContaining({
          code: ErrorCode.UNKNOWN_ERROR,
          severity: ErrorSeverity.MEDIUM,
        })
      );

      consoleSpy.mockRestore();
    });

    it('should not send telemetry when disabled', async () => {
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const handler = new ErrorHandler({ enableTelemetry: false });

      await handler.handle(new Error('Test error'));

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('error titles', () => {
    it('should provide titles for all error codes', () => {
      const errorCodes = Object.values(ErrorCode);

      errorCodes.forEach(code => {
        const error = new ArchiveError({
          message: 'Test',
          code,
          userMessage: 'Test',
        });

        const formatted = errorHandler.formatError(error);

        expect(formatted.title).toBeDefined();
        expect(formatted.title).not.toBe('');
      });
    });
  });
});
