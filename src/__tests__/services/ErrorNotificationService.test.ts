import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ErrorNotificationService, ErrorSeverity, ErrorCategory } from '@/services/ErrorNotificationService';
import { Notice } from 'obsidian';
import {
  RateLimitError,
  AuthenticationError,
  InvalidRequestError,
  ServerError,
  NetworkError,
  TimeoutError
} from '@/types/errors/http-errors';

// Mock Obsidian Notice
vi.mock('obsidian', () => ({
  Notice: vi.fn().mockImplementation((message: string, duration?: number) => {
    return {
      noticeEl: {
        removeClass: vi.fn(),
        addClass: vi.fn(),
        createEl: vi.fn(() => ({
          addEventListener: vi.fn()
        }))
      },
      hide: vi.fn(),
      setMessage: vi.fn()
    };
  })
}));

describe('ErrorNotificationService', () => {
  let service: ErrorNotificationService;

  beforeEach(async () => {
    service = new ErrorNotificationService();
    await service.initialize();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await service.cleanup();
  });

  describe('Service Lifecycle', () => {
    it('should initialize successfully', () => {
      expect(service.isServiceInitialized()).toBe(true);
      expect(service.name).toBe('ErrorNotificationService');
    });

    it('should cleanup without errors', async () => {
      service.showInfo('Test 1');
      service.showInfo('Test 2');

      await expect(service.cleanup()).resolves.not.toThrow();
      expect(service.isServiceInitialized()).toBe(false);
    });
  });

  describe('HTTP Error Mapping', () => {
    it('should map RateLimitError correctly', () => {
      const error = new RateLimitError('Too many requests', 429);
      const notice = service.showError(error);

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining('Too many requests'),
        expect.any(Number)
      );
    });

    it('should map AuthenticationError correctly', () => {
      const error = new AuthenticationError('Invalid API key', 401);
      const notice = service.showError(error);

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining('Authentication failed'),
        expect.any(Number)
      );
    });

    it('should map InvalidRequestError correctly', () => {
      const error = new InvalidRequestError('Bad request', 400, {});
      const notice = service.showError(error);

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining('Invalid request'),
        expect.any(Number)
      );
    });

    it('should map ServerError correctly', () => {
      const error = new ServerError('Internal server error', 500);
      const notice = service.showError(error);

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining('Server error'),
        expect.any(Number)
      );
    });

    it('should map NetworkError correctly', () => {
      const error = new NetworkError('Network failure');
      const notice = service.showError(error);

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining('Network error'),
        expect.any(Number)
      );
    });

    it('should map TimeoutError correctly', () => {
      const error = new TimeoutError('Request timeout');
      const notice = service.showError(error);

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining('timed out'),
        expect.any(Number)
      );
    });
  });

  describe('Error Key Detection', () => {
    it('should detect vault quota exceeded', () => {
      const error = new Error('Storage quota exceeded in vault');
      service.showError(error);

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining('Vault storage is full'),
        0 // Persistent
      );
    });

    it('should detect storage quota exceeded', () => {
      const error = new Error('Local storage full');
      service.showError(error);

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining('Local storage is full'),
        expect.any(Number)
      );
    });

    it('should detect permission denied', () => {
      const error = new Error('Permission denied to access file');
      service.showError(error);

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining('Permission denied'),
        expect.any(Number)
      );
    });

    it('should detect timeout errors', () => {
      const error = new Error('Request timeout after 30s');
      service.showError(error);

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining('timed out'),
        expect.any(Number)
      );
    });

    it('should handle unknown errors', () => {
      const error = new Error('Something completely unexpected');
      service.showError(error);

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining('unexpected error'),
        expect.any(Number)
      );
    });
  });

  describe('Error Categories', () => {
    it('should categorize network errors', () => {
      const error = new NetworkError('Connection failed');
      const category = service.getErrorCategory(error);

      expect(category).toBe(ErrorCategory.NETWORK);
    });

    it('should categorize authentication errors', () => {
      const error = new AuthenticationError('Unauthorized', 401);
      const category = service.getErrorCategory(error);

      expect(category).toBe(ErrorCategory.AUTHENTICATION);
    });

    it('should categorize validation errors', () => {
      const error = new InvalidRequestError('Invalid input', 400, {});
      const category = service.getErrorCategory(error);

      expect(category).toBe(ErrorCategory.VALIDATION);
    });

    it('should categorize vault errors', () => {
      const error = new Error('Vault permission denied');
      const category = service.getErrorCategory(error);

      expect(category).toBe(ErrorCategory.VAULT);
    });
  });

  describe('Retry Logic', () => {
    it('should identify retryable errors', () => {
      const networkError = new NetworkError('Connection failed');
      expect(service.isRetryable(networkError)).toBe(true);

      const serverError = new ServerError('Internal error', 500);
      expect(service.isRetryable(serverError)).toBe(true);

      const timeoutError = new TimeoutError('Timeout');
      expect(service.isRetryable(timeoutError)).toBe(true);
    });

    it('should identify non-retryable errors', () => {
      const authError = new AuthenticationError('Invalid key', 401);
      expect(service.isRetryable(authError)).toBe(false);

      const validationError = new InvalidRequestError('Bad input', 400, {});
      expect(service.isRetryable(validationError)).toBe(false);
    });
  });

  describe('Custom Options', () => {
    it('should use custom severity', () => {
      const error = new Error('Test error');
      service.showError(error, { severity: ErrorSeverity.WARNING });

      const notice = vi.mocked(Notice).mock.results[0].value;
      expect(notice.noticeEl.addClass).toHaveBeenCalledWith('notice-warning');
    });

    it('should use custom duration', () => {
      const error = new Error('Test error');
      service.showError(error, { duration: 10000 });

      expect(Notice).toHaveBeenCalledWith(
        expect.any(String),
        10000
      );
    });

    it('should include details in message', () => {
      const error = new Error('Test error');
      service.showError(error, {
        details: 'Additional context here'
      });

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining('Additional context here'),
        expect.any(Number)
      );
    });

    it('should add action button', () => {
      const error = new Error('Test error');
      const callback = vi.fn();

      service.showError(error, {
        action: {
          label: 'Retry',
          callback
        }
      });

      const notice = vi.mocked(Notice).mock.results[0].value;
      expect(notice.noticeEl.createEl).toHaveBeenCalledWith(
        'button',
        expect.objectContaining({ text: 'Retry' })
      );
    });
  });

  describe('Convenience Methods', () => {
    it('should show warning', () => {
      service.showWarning('Warning message');

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining('Warning message'),
        4000
      );
    });

    it('should show info', () => {
      service.showInfo('Info message');

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining('Info message'),
        3000
      );
    });

    it('should show success', () => {
      service.showSuccess('Success message');

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining('Success message'),
        3000
      );
    });
  });

  describe('Notice Management', () => {
    it('should hide specific notice', () => {
      const notice = service.showInfo('Test');
      service.hideNotice(notice);

      expect(notice.hide).toHaveBeenCalled();
    });

    it('should hide all notices without errors', () => {
      service.showInfo('Test 1');
      service.showInfo('Test 2');

      expect(() => service.hideAll()).not.toThrow();
    });
  });

  describe('String Error Keys', () => {
    it('should handle string error keys', () => {
      service.showError('rate-limit');

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining('Too many requests'),
        expect.any(Number)
      );
    });

    it('should handle custom error keys', () => {
      service.showError('vault-quota-exceeded');

      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining('Vault storage is full'),
        0
      );
    });
  });
});
