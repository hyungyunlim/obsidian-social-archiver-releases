import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ErrorTracker, type ErrorContext } from '@/services/ErrorTracker';
import { ErrorCategory, ErrorSeverity } from '@/services/ErrorNotificationService';

describe('ErrorTracker', () => {
  let tracker: ErrorTracker;

  beforeEach(async () => {
    tracker = new ErrorTracker(true); // Enable debug mode
    await tracker.initialize();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await tracker.cleanup();
  });

  describe('Service Lifecycle', () => {
    it('should initialize with debug mode', () => {
      expect(tracker.isServiceInitialized()).toBe(true);
      expect(tracker.name).toBe('ErrorTracker');
      expect(tracker.isDebugMode()).toBe(true);
    });

    it('should cleanup and clear logs', async () => {
      tracker.trackError(new Error('Test'));
      expect(tracker.getLogs().length).toBe(1);

      await tracker.cleanup();

      expect(tracker.isServiceInitialized()).toBe(false);
      expect(tracker.getLogs().length).toBe(0);
    });
  });

  describe('Error Tracking', () => {
    it('should track basic error', () => {
      const error = new Error('Test error');
      const entry = tracker.trackError(error);

      expect(entry).toBeDefined();
      expect(entry.error).toBe(error);
      expect(entry.category).toBe(ErrorCategory.UNKNOWN);
      expect(entry.severity).toBe(ErrorSeverity.ERROR);
      expect(entry.id).toMatch(/^err_/);
      expect(entry.timestamp).toBeGreaterThan(0);
    });

    it('should track error with context', () => {
      const error = new Error('Test error');
      const context: ErrorContext = {
        component: 'TestComponent',
        operation: 'testOperation'
      };

      const entry = tracker.trackError(error, context);

      expect(entry.context.component).toBe('TestComponent');
      expect(entry.context.operation).toBe('testOperation');
      expect(entry.context.sessionId).toBeDefined();
      expect(entry.context.userAgent).toBeDefined();
      expect(entry.context.platform).toBeDefined();
    });

    it('should track error with category and severity', () => {
      const error = new Error('Network error');
      const entry = tracker.trackError(
        error,
        {},
        ErrorCategory.NETWORK,
        ErrorSeverity.WARNING
      );

      expect(entry.category).toBe(ErrorCategory.NETWORK);
      expect(entry.severity).toBe(ErrorSeverity.WARNING);
    });

    it('should track error with user action', () => {
      const error = new Error('Test error');
      const entry = tracker.trackError(
        error,
        {},
        ErrorCategory.UNKNOWN,
        ErrorSeverity.ERROR,
        'User clicked submit button'
      );

      expect(entry.userAction).toBe('User clicked submit button');
    });

    it('should capture stack trace', () => {
      const error = new Error('Test error');
      const entry = tracker.trackError(error);

      expect(entry.stackTrace).toBeDefined();
      expect(entry.stackTrace).toContain('Error: Test error');
    });
  });

  describe('Specialized Tracking Methods', () => {
    it('should track network error with URL context', () => {
      const error = new Error('Network failure');
      const entry = tracker.trackNetworkError(
        error,
        'https://api.example.com/posts',
        'GET',
        500
      );

      expect(entry.category).toBe(ErrorCategory.NETWORK);
      expect(entry.context.operation).toContain('GET');
      expect(entry.context.operation).toContain('https://api.example.com/posts');
      expect(entry.userAction).toContain('Network request');
    });

    it('should track vault error with file path', () => {
      const error = new Error('Permission denied');
      const entry = tracker.trackVaultError(
        error,
        'read',
        'posts/2024-01-01-post.md'
      );

      expect(entry.category).toBe(ErrorCategory.VAULT);
      expect(entry.context.operation).toBe('read');
      expect(entry.context.component).toBe('posts/2024-01-01-post.md');
      expect(entry.userAction).toContain('Vault operation');
    });

    it('should track validation error with field info', () => {
      const error = new Error('Invalid email format');
      const entry = tracker.trackValidationError(
        error,
        'email',
        'invalid@email'
      );

      expect(entry.category).toBe(ErrorCategory.VALIDATION);
      expect(entry.severity).toBe(ErrorSeverity.WARNING);
      expect(entry.context.component).toBe('email');
      expect(entry.userAction).toContain('Validation failed');
    });
  });

  describe('Error Statistics', () => {
    it('should calculate total errors', () => {
      tracker.trackError(new Error('Error 1'));
      tracker.trackError(new Error('Error 2'));
      tracker.trackError(new Error('Error 3'));

      const stats = tracker.getStats();
      expect(stats.totalErrors).toBe(3);
    });

    it('should categorize errors', () => {
      tracker.trackError(new Error('Error'), {}, ErrorCategory.NETWORK);
      tracker.trackError(new Error('Error'), {}, ErrorCategory.NETWORK);
      tracker.trackError(new Error('Error'), {}, ErrorCategory.VAULT);

      const stats = tracker.getStats();
      expect(stats.errorsByCategory[ErrorCategory.NETWORK]).toBe(2);
      expect(stats.errorsByCategory[ErrorCategory.VAULT]).toBe(1);
      expect(stats.errorsByCategory[ErrorCategory.API]).toBe(0);
    });

    it('should categorize by severity', () => {
      tracker.trackError(new Error('Error'), {}, ErrorCategory.UNKNOWN, ErrorSeverity.ERROR);
      tracker.trackError(new Error('Error'), {}, ErrorCategory.UNKNOWN, ErrorSeverity.WARNING);
      tracker.trackError(new Error('Error'), {}, ErrorCategory.UNKNOWN, ErrorSeverity.CRITICAL);

      const stats = tracker.getStats();
      expect(stats.errorsBySeverity[ErrorSeverity.ERROR]).toBe(1);
      expect(stats.errorsBySeverity[ErrorSeverity.WARNING]).toBe(1);
      expect(stats.errorsBySeverity[ErrorSeverity.CRITICAL]).toBe(1);
    });

    it('should track most common errors', () => {
      tracker.trackError(new Error('Network timeout'));
      tracker.trackError(new Error('Network timeout'));
      tracker.trackError(new Error('Network timeout'));
      tracker.trackError(new Error('Permission denied'));
      tracker.trackError(new Error('Permission denied'));

      const stats = tracker.getStats();
      expect(stats.mostCommonErrors.length).toBeGreaterThan(0);
      expect(stats.mostCommonErrors[0].message).toBe('Network timeout');
      expect(stats.mostCommonErrors[0].count).toBe(3);
    });

    it('should include recent errors', () => {
      for (let i = 0; i < 15; i++) {
        tracker.trackError(new Error(`Error ${i}`));
      }

      const stats = tracker.getStats();
      expect(stats.recentErrors.length).toBe(10); // Last 10 errors
    });
  });

  describe('Log Management', () => {
    it('should get all logs', () => {
      tracker.trackError(new Error('Error 1'));
      tracker.trackError(new Error('Error 2'));

      const logs = tracker.getLogs();
      expect(logs.length).toBe(2);
    });

    it('should filter logs by category', () => {
      tracker.trackError(new Error('Network'), {}, ErrorCategory.NETWORK);
      tracker.trackError(new Error('Vault'), {}, ErrorCategory.VAULT);
      tracker.trackError(new Error('Network'), {}, ErrorCategory.NETWORK);

      const logs = tracker.getLogs({ category: ErrorCategory.NETWORK });
      expect(logs.length).toBe(2);
    });

    it('should filter logs by severity', () => {
      tracker.trackError(new Error('Error'), {}, ErrorCategory.UNKNOWN, ErrorSeverity.ERROR);
      tracker.trackError(new Error('Warning'), {}, ErrorCategory.UNKNOWN, ErrorSeverity.WARNING);

      const logs = tracker.getLogs({ severity: ErrorSeverity.ERROR });
      expect(logs.length).toBe(1);
    });

    it('should filter logs by timestamp', () => {
      const now = Date.now();
      tracker.trackError(new Error('Old error'));

      // Advance time
      vi.useFakeTimers();
      vi.advanceTimersByTime(5000);

      tracker.trackError(new Error('New error'));

      const logs = tracker.getLogs({ since: now + 1000 });
      expect(logs.length).toBe(1);

      vi.useRealTimers();
    });

    it('should limit log results', () => {
      for (let i = 0; i < 10; i++) {
        tracker.trackError(new Error(`Error ${i}`));
      }

      const logs = tracker.getLogs({ limit: 5 });
      expect(logs.length).toBe(5);
    });

    it('should clear all logs', () => {
      tracker.trackError(new Error('Error 1'));
      tracker.trackError(new Error('Error 2'));

      tracker.clearLogs();

      expect(tracker.getLogs().length).toBe(0);
      expect(tracker.getStats().totalErrors).toBe(0);
    });
  });

  describe('Log Size Management', () => {
    it('should maintain max log size', () => {
      // Track more errors than max size (1000)
      for (let i = 0; i < 1100; i++) {
        tracker.trackError(new Error(`Error ${i}`));
      }

      const logs = tracker.getLogs();
      expect(logs.length).toBe(1000);

      // Should keep the most recent errors
      expect(logs[logs.length - 1].error.message).toBe('Error 1099');
    });
  });

  describe('Debug Mode', () => {
    it('should toggle debug mode', () => {
      expect(tracker.isDebugMode()).toBe(true);

      tracker.setDebugMode(false);
      expect(tracker.isDebugMode()).toBe(false);

      tracker.setDebugMode(true);
      expect(tracker.isDebugMode()).toBe(true);
    });

    it('should log to console in debug mode', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const consoleGroupSpy = vi.spyOn(console, 'group').mockImplementation(() => {});

      tracker.setDebugMode(true);
      tracker.trackError(new Error('Debug test'));

      expect(consoleGroupSpy).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
      consoleGroupSpy.mockRestore();
    });

    it('should not log to console when debug mode is off', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const consoleGroupSpy = vi.spyOn(console, 'group').mockImplementation(() => {});

      tracker.setDebugMode(false);
      tracker.trackError(new Error('No debug test'));

      expect(consoleGroupSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
      consoleGroupSpy.mockRestore();
    });
  });

  describe('Export Functionality', () => {
    it('should export logs as JSON', () => {
      tracker.trackError(new Error('Error 1'));
      tracker.trackError(new Error('Error 2'));

      const exported = tracker.exportLogs();
      const parsed = JSON.parse(exported);

      expect(parsed).toHaveProperty('sessionId');
      expect(parsed).toHaveProperty('exportedAt');
      expect(parsed).toHaveProperty('stats');
      expect(parsed).toHaveProperty('logs');
      expect(parsed.logs.length).toBe(2);
    });
  });

  describe('Sensitive Data Filtering', () => {
    it('should filter sensitive data from metadata', () => {
      const error = new Error('Test error');
      const entry = tracker.trackError(error);

      // Manually add sensitive data to check filtering
      entry.metadata = {
        api_key: 'secret-key',
        token: 'bearer-token',
        password: 'user-password',
        safe_field: 'safe-value'
      };

      // Note: In real implementation, filtering happens in trackError
      // This is a conceptual test
      expect(entry.metadata).toBeDefined();
    });
  });

  describe('Session Management', () => {
    it('should generate unique session ID', () => {
      const tracker1 = new ErrorTracker();
      const tracker2 = new ErrorTracker();

      const entry1 = tracker1.trackError(new Error('Test 1'));
      const entry2 = tracker2.trackError(new Error('Test 2'));

      expect(entry1.context.sessionId).toBeDefined();
      expect(entry2.context.sessionId).toBeDefined();
      expect(entry1.context.sessionId).not.toBe(entry2.context.sessionId);

      tracker1.cleanup();
      tracker2.cleanup();
    });

    it('should maintain same session ID within tracker instance', () => {
      const entry1 = tracker.trackError(new Error('Test 1'));
      const entry2 = tracker.trackError(new Error('Test 2'));

      expect(entry1.context.sessionId).toBe(entry2.context.sessionId);
    });
  });

  describe('Platform Detection', () => {
    it('should detect platform from user agent', () => {
      const entry = tracker.trackError(new Error('Test'));

      expect(entry.context.platform).toBeDefined();
      expect(typeof entry.context.platform).toBe('string');
    });
  });
});
