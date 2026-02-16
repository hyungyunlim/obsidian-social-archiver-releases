import { describe, it, expect } from 'vitest';
import {
  ArchiveError,
  NetworkError,
  ValidationError,
  VaultError,
  MediaError,
  RateLimitError,
  AuthenticationError,
  InsufficientCreditsError,
  OperationCancelledError,
  TimeoutError,
  ErrorCode,
  ErrorSeverity,
  isArchiveError,
  isRetryableError,
  toArchiveError,
} from '@/types/errors';

describe('errors', () => {
  describe('ArchiveError', () => {
    it('should create base error with all properties', () => {
      const error = new ArchiveError({
        message: 'Test error',
        code: ErrorCode.INTERNAL_ERROR,
        userMessage: 'User friendly message',
        context: {
          url: 'https://example.com',
          platform: 'facebook',
        },
        severity: ErrorSeverity.HIGH,
        isRetryable: true,
      });

      expect(error.name).toBe('ArchiveError');
      expect(error.message).toBe('Test error');
      expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(error.userMessage).toBe('User friendly message');
      expect(error.context.url).toBe('https://example.com');
      expect(error.context.platform).toBe('facebook');
      expect(error.context.timestamp).toBeInstanceOf(Date);
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.isRetryable).toBe(true);
    });

    it('should set default severity to MEDIUM', () => {
      const error = new ArchiveError({
        message: 'Test error',
        code: ErrorCode.INTERNAL_ERROR,
        userMessage: 'User message',
      });

      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
    });

    it('should set default isRetryable to false', () => {
      const error = new ArchiveError({
        message: 'Test error',
        code: ErrorCode.INTERNAL_ERROR,
        userMessage: 'User message',
      });

      expect(error.isRetryable).toBe(false);
    });

    it('should convert to JSON', () => {
      const error = new ArchiveError({
        message: 'Test error',
        code: ErrorCode.INTERNAL_ERROR,
        userMessage: 'User message',
        context: { url: 'https://example.com' },
        severity: ErrorSeverity.HIGH,
        isRetryable: true,
        recoverySuggestions: [
          {
            action: 'retry',
            description: 'Try again',
            autoRecoverable: true,
          },
        ],
      });

      const json = error.toJSON();

      expect(json).toHaveProperty('name', 'ArchiveError');
      expect(json).toHaveProperty('message', 'Test error');
      expect(json).toHaveProperty('code', ErrorCode.INTERNAL_ERROR);
      expect(json).toHaveProperty('userMessage', 'User message');
      expect(json).toHaveProperty('severity', ErrorSeverity.HIGH);
      expect(json).toHaveProperty('isRetryable', true);
      expect(json).toHaveProperty('recoverySuggestions');
      expect(json).toHaveProperty('stack');
    });

    it('should get user-friendly message with suggestions', () => {
      const error = new ArchiveError({
        message: 'Test error',
        code: ErrorCode.INTERNAL_ERROR,
        userMessage: 'User message',
        recoverySuggestions: [
          {
            action: 'retry',
            description: 'Try again',
            autoRecoverable: true,
          },
          {
            action: 'check',
            description: 'Check your settings',
            autoRecoverable: false,
          },
        ],
      });

      const message = error.getUserFriendlyMessage();

      expect(message).toContain('User message');
      expect(message).toContain('Suggestions:');
      expect(message).toContain('1. Try again');
      expect(message).toContain('2. Check your settings');
    });

    it('should chain errors with cause', () => {
      const originalError = new Error('Original error');
      const archiveError = new ArchiveError({
        message: 'Wrapped error',
        code: ErrorCode.INTERNAL_ERROR,
        userMessage: 'User message',
        cause: originalError,
      });

      expect(archiveError.cause).toBe(originalError);
    });
  });

  describe('NetworkError', () => {
    it('should create network error with default properties', () => {
      const error = new NetworkError({
        message: 'Connection failed',
      });

      expect(error.name).toBe('NetworkError');
      expect(error.code).toBe(ErrorCode.NETWORK_ERROR);
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.isRetryable).toBe(true);
      expect(error.recoverySuggestions.length).toBeGreaterThan(0);
    });

    it('should use custom user message if provided', () => {
      const error = new NetworkError({
        message: 'Connection failed',
        userMessage: 'Custom message',
      });

      expect(error.userMessage).toBe('Custom message');
    });

    it('should include recovery suggestions', () => {
      const error = new NetworkError({
        message: 'Connection failed',
      });

      const checkConnection = error.recoverySuggestions.find(
        s => s.action === 'check_connection'
      );
      const retry = error.recoverySuggestions.find(s => s.action === 'retry');

      expect(checkConnection).toBeDefined();
      expect(retry).toBeDefined();
      expect(retry?.autoRecoverable).toBe(true);
    });
  });

  describe('ValidationError', () => {
    it('should create validation error', () => {
      const error = new ValidationError({
        message: 'Invalid input',
        field: 'url',
      });

      expect(error.name).toBe('ValidationError');
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(error.severity).toBe(ErrorSeverity.LOW);
      expect(error.isRetryable).toBe(false);
      expect(error.context.metadata?.field).toBe('url');
    });

    it('should have fix_input recovery suggestion', () => {
      const error = new ValidationError({
        message: 'Invalid input',
      });

      const fixInput = error.recoverySuggestions.find(
        s => s.action === 'fix_input'
      );

      expect(fixInput).toBeDefined();
      expect(fixInput?.autoRecoverable).toBe(false);
    });
  });

  describe('VaultError', () => {
    it('should create vault error with operation context', () => {
      const error = new VaultError({
        message: 'Failed to create file',
        operation: 'create_file',
      });

      expect(error.name).toBe('VaultError');
      expect(error.code).toBe(ErrorCode.VAULT_ERROR);
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.isRetryable).toBe(false);
      expect(error.context.operation).toBe('create_file');
    });

    it('should include permission and disk space suggestions', () => {
      const error = new VaultError({
        message: 'Failed to create file',
      });

      const checkPermissions = error.recoverySuggestions.find(
        s => s.action === 'check_permissions'
      );
      const checkDiskSpace = error.recoverySuggestions.find(
        s => s.action === 'check_disk_space'
      );

      expect(checkPermissions).toBeDefined();
      expect(checkDiskSpace).toBeDefined();
    });
  });

  describe('MediaError', () => {
    it('should create media error with media URL', () => {
      const error = new MediaError({
        message: 'Download failed',
        mediaUrl: 'https://example.com/image.jpg',
      });

      expect(error.name).toBe('MediaError');
      expect(error.code).toBe(ErrorCode.MEDIA_ERROR);
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.isRetryable).toBe(true);
      expect(error.context.metadata?.mediaUrl).toBe('https://example.com/image.jpg');
    });

    it('should have skip and retry suggestions', () => {
      const error = new MediaError({
        message: 'Download failed',
      });

      const skipMedia = error.recoverySuggestions.find(
        s => s.action === 'skip_media'
      );
      const retry = error.recoverySuggestions.find(s => s.action === 'retry');

      expect(skipMedia).toBeDefined();
      expect(retry).toBeDefined();
      expect(retry?.autoRecoverable).toBe(true);
    });
  });

  describe('RateLimitError', () => {
    it('should create rate limit error with retry after', () => {
      const error = new RateLimitError({
        message: 'Rate limit exceeded',
        retryAfter: 60000, // 60 seconds
      });

      expect(error.name).toBe('RateLimitError');
      expect(error.code).toBe(ErrorCode.RATE_LIMIT_EXCEEDED);
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.isRetryable).toBe(true);
      expect(error.retryAfter).toBe(60000);
      expect(error.userMessage).toContain('60 seconds');
    });

    it('should create rate limit error without retry after', () => {
      const error = new RateLimitError({
        message: 'Rate limit exceeded',
      });

      expect(error.userMessage).toContain('try again later');
      expect(error.retryAfter).toBeUndefined();
    });

    it('should have wait recovery suggestion', () => {
      const error = new RateLimitError({
        message: 'Rate limit exceeded',
        retryAfter: 60000,
      });

      const wait = error.recoverySuggestions.find(s => s.action === 'wait');

      expect(wait).toBeDefined();
      expect(wait?.autoRecoverable).toBe(true);
      expect(wait?.description).toContain('60 seconds');
    });
  });

  describe('AuthenticationError', () => {
    it('should create authentication error', () => {
      const error = new AuthenticationError({
        message: 'Invalid API key',
      });

      expect(error.name).toBe('AuthenticationError');
      expect(error.code).toBe(ErrorCode.AUTHENTICATION_FAILED);
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.isRetryable).toBe(false);
    });

    it('should have credential check suggestions', () => {
      const error = new AuthenticationError({
        message: 'Invalid API key',
      });

      const checkCredentials = error.recoverySuggestions.find(
        s => s.action === 'check_credentials'
      );
      const renewLicense = error.recoverySuggestions.find(
        s => s.action === 'renew_license'
      );

      expect(checkCredentials).toBeDefined();
      expect(renewLicense).toBeDefined();
    });
  });

  describe('InsufficientCreditsError', () => {
    it('should create insufficient credits error', () => {
      const error = new InsufficientCreditsError({
        message: 'Not enough credits',
        creditsRequired: 5,
        creditsAvailable: 2,
      });

      expect(error.name).toBe('InsufficientCreditsError');
      expect(error.code).toBe(ErrorCode.INSUFFICIENT_CREDITS);
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.isRetryable).toBe(false);
      expect(error.creditsRequired).toBe(5);
      expect(error.creditsAvailable).toBe(2);
      expect(error.userMessage).toContain('Required: 5');
      expect(error.userMessage).toContain('Available: 2');
    });

    it('should have upgrade and feature disable suggestions', () => {
      const error = new InsufficientCreditsError({
        message: 'Not enough credits',
        creditsRequired: 5,
        creditsAvailable: 2,
      });

      const upgrade = error.recoverySuggestions.find(s => s.action === 'upgrade');
      const disableFeatures = error.recoverySuggestions.find(
        s => s.action === 'disable_features'
      );

      expect(upgrade).toBeDefined();
      expect(disableFeatures).toBeDefined();
    });
  });

  describe('OperationCancelledError', () => {
    it('should create operation cancelled error with defaults', () => {
      const error = new OperationCancelledError();

      expect(error.name).toBe('OperationCancelledError');
      expect(error.code).toBe(ErrorCode.OPERATION_CANCELLED);
      expect(error.severity).toBe(ErrorSeverity.LOW);
      expect(error.isRetryable).toBe(false);
      expect(error.message).toContain('cancelled');
    });

    it('should accept custom message', () => {
      const error = new OperationCancelledError({
        message: 'User cancelled',
        userMessage: 'You cancelled the operation',
      });

      expect(error.message).toBe('User cancelled');
      expect(error.userMessage).toBe('You cancelled the operation');
    });
  });

  describe('TimeoutError', () => {
    it('should create timeout error with timeout value', () => {
      const error = new TimeoutError({
        message: 'Operation timed out',
        timeoutMs: 30000,
      });

      expect(error.name).toBe('TimeoutError');
      expect(error.code).toBe(ErrorCode.OPERATION_TIMEOUT);
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.isRetryable).toBe(true);
      expect(error.timeoutMs).toBe(30000);
      expect(error.userMessage).toContain('30 seconds');
    });

    it('should have retry and increase timeout suggestions', () => {
      const error = new TimeoutError({
        message: 'Operation timed out',
        timeoutMs: 30000,
      });

      const retry = error.recoverySuggestions.find(s => s.action === 'retry');
      const increaseTimeout = error.recoverySuggestions.find(
        s => s.action === 'increase_timeout'
      );

      expect(retry).toBeDefined();
      expect(retry?.autoRecoverable).toBe(true);
      expect(increaseTimeout).toBeDefined();
    });
  });

  describe('Type guards and utilities', () => {
    it('isArchiveError should identify ArchiveError instances', () => {
      const archiveError = new ArchiveError({
        message: 'Test',
        code: ErrorCode.INTERNAL_ERROR,
        userMessage: 'Test',
      });
      const regularError = new Error('Test');

      expect(isArchiveError(archiveError)).toBe(true);
      expect(isArchiveError(regularError)).toBe(false);
      expect(isArchiveError('string')).toBe(false);
      expect(isArchiveError(null)).toBe(false);
    });

    it('isRetryableError should check retryable flag', () => {
      const retryableError = new NetworkError({
        message: 'Network error',
      });
      const nonRetryableError = new ValidationError({
        message: 'Validation error',
      });
      const regularError = new Error('Test');

      expect(isRetryableError(retryableError)).toBe(true);
      expect(isRetryableError(nonRetryableError)).toBe(false);
      expect(isRetryableError(regularError)).toBe(false);
    });

    it('toArchiveError should convert Error to ArchiveError', () => {
      const regularError = new Error('Test error');
      const archiveError = toArchiveError(regularError);

      expect(archiveError).toBeInstanceOf(ArchiveError);
      expect(archiveError.message).toBe('Test error');
      expect(archiveError.code).toBe(ErrorCode.UNKNOWN_ERROR);
      expect(archiveError.severity).toBe(ErrorSeverity.MEDIUM);
    });

    it('toArchiveError should convert string to ArchiveError', () => {
      const archiveError = toArchiveError('String error');

      expect(archiveError).toBeInstanceOf(ArchiveError);
      expect(archiveError.message).toBe('String error');
      expect(archiveError.code).toBe(ErrorCode.UNKNOWN_ERROR);
    });

    it('toArchiveError should return ArchiveError as-is', () => {
      const original = new NetworkError({
        message: 'Network error',
      });
      const converted = toArchiveError(original);

      expect(converted).toBe(original);
    });
  });

  describe('Error context', () => {
    it('should capture timestamp in context', () => {
      const before = new Date();
      const error = new ArchiveError({
        message: 'Test',
        code: ErrorCode.INTERNAL_ERROR,
        userMessage: 'Test',
      });
      const after = new Date();

      expect(error.context.timestamp).toBeInstanceOf(Date);
      expect(error.context.timestamp!.getTime()).toBeGreaterThanOrEqual(
        before.getTime()
      );
      expect(error.context.timestamp!.getTime()).toBeLessThanOrEqual(
        after.getTime()
      );
    });

    it('should capture stack trace in context', () => {
      const error = new ArchiveError({
        message: 'Test',
        code: ErrorCode.INTERNAL_ERROR,
        userMessage: 'Test',
      });

      expect(error.context.stackTrace).toBeDefined();
      expect(error.stack).toBeDefined();
    });

    it('should merge custom context', () => {
      const error = new ArchiveError({
        message: 'Test',
        code: ErrorCode.INTERNAL_ERROR,
        userMessage: 'Test',
        context: {
          url: 'https://example.com',
          platform: 'facebook',
          metadata: {
            customField: 'value',
          },
        },
      });

      expect(error.context.url).toBe('https://example.com');
      expect(error.context.platform).toBe('facebook');
      expect(error.context.metadata).toEqual({ customField: 'value' });
    });
  });

  describe('Recovery suggestions', () => {
    it('should provide empty suggestions by default', () => {
      const error = new ArchiveError({
        message: 'Test',
        code: ErrorCode.INTERNAL_ERROR,
        userMessage: 'Test',
      });

      expect(error.recoverySuggestions).toEqual([]);
    });

    it('should include custom recovery suggestions', () => {
      const suggestions = [
        {
          action: 'retry',
          description: 'Try again',
          autoRecoverable: true,
        },
        {
          action: 'manual_fix',
          description: 'Fix manually',
          autoRecoverable: false,
        },
      ];

      const error = new ArchiveError({
        message: 'Test',
        code: ErrorCode.INTERNAL_ERROR,
        userMessage: 'Test',
        recoverySuggestions: suggestions,
      });

      expect(error.recoverySuggestions).toEqual(suggestions);
    });

    it('should distinguish auto-recoverable suggestions', () => {
      const error = new NetworkError({
        message: 'Network error',
      });

      const autoRecoverable = error.recoverySuggestions.filter(
        s => s.autoRecoverable
      );
      const manualRecovery = error.recoverySuggestions.filter(
        s => !s.autoRecoverable
      );

      expect(autoRecoverable.length).toBeGreaterThan(0);
      expect(manualRecovery.length).toBeGreaterThan(0);
    });
  });
});
