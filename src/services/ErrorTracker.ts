/**
 * ErrorTracker - Comprehensive error tracking and logging system
 *
 * Features:
 * - Structured error logging with context
 * - Error categorization and severity levels
 * - Stack trace capture
 * - User action tracking
 * - Sensitive data filtering
 * - Debug mode toggle
 * - Error statistics and reporting
 */

import type { IService } from './base/IService';
import { ErrorCategory, ErrorSeverity } from './ErrorNotificationService';
import { Platform } from 'obsidian';

/**
 * Error log entry
 */
export interface ErrorLogEntry {
  id: string;
  timestamp: number;
  error: Error;
  category: ErrorCategory;
  severity: ErrorSeverity;
  context: ErrorContext;
  stackTrace?: string;
  userAction?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Error context information
 */
export interface ErrorContext {
  component?: string;
  operation?: string;
  userId?: string;
  sessionId?: string;
  userAgent?: string;
  platform?: string;
  pluginVersion?: string;
}

/**
 * Error statistics
 */
export interface ErrorStats {
  totalErrors: number;
  errorsByCategory: Record<ErrorCategory, number>;
  errorsBySeverity: Record<ErrorSeverity, number>;
  recentErrors: ErrorLogEntry[];
  mostCommonErrors: Array<{
    message: string;
    count: number;
  }>;
}

/**
 * Sensitive data patterns to filter
 */
const SENSITIVE_PATTERNS = [
  /api[_-]?key/i,
  /token/i,
  /password/i,
  /secret/i,
  /auth/i,
  /bearer/i,
  /credential/i,
  /private[_-]?key/i
];

/**
 * ErrorTracker - Tracks and logs errors for debugging
 */
export class ErrorTracker implements IService {
  public readonly name = 'ErrorTracker';
  private isInitialized = false;
  private errorLog: ErrorLogEntry[] = [];
  private debugMode: boolean = false;
  private sessionId: string;
  private readonly maxLogSize = 1000; // Keep last 1000 errors
  private errorCounts: Map<string, number> = new Map();

  constructor(debugMode: boolean = false) {
    this.debugMode = debugMode;
    this.sessionId = this.generateSessionId();
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Load debug mode from settings if available
    // (This would be integrated with plugin settings)

    this.isInitialized = true;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    // Optionally persist error log before cleanup
    // (Could be saved to a file for debugging)

    this.errorLog = [];
    this.errorCounts.clear();
    this.isInitialized = false;
  }

  /**
   * Check if service is initialized
   */
  isServiceInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Track an error
   * @param error - Error to track
   * @param context - Error context
   * @param category - Error category
   * @param severity - Error severity
   * @param userAction - User action that led to error
   * @returns Error log entry
   */
  trackError(
    error: Error,
    context: ErrorContext = {},
    category: ErrorCategory = ErrorCategory.UNKNOWN,
    severity: ErrorSeverity = ErrorSeverity.ERROR,
    userAction?: string
  ): ErrorLogEntry {
    const entry: ErrorLogEntry = {
      id: this.generateErrorId(),
      timestamp: Date.now(),
      error,
      category,
      severity,
      context: {
        ...context,
        sessionId: this.sessionId,
        userAgent: this.getUserAgent(),
        platform: this.getPlatform()
      },
      stackTrace: error.stack,
      userAction,
      metadata: {}
    };

    // Filter sensitive data
    entry.metadata = this.filterSensitiveData(entry.metadata || {});

    // Add to log
    this.addToLog(entry);

    // Update error count
    this.incrementErrorCount(error.message);

    // Log to console in debug mode
    if (this.debugMode) {
      this.logToConsole(entry);
    }

    return entry;
  }

  /**
   * Track a network error with specific context
   */
  trackNetworkError(
    error: Error,
    url: string,
    method: string,
    _statusCode?: number,
    context: ErrorContext = {}
  ): ErrorLogEntry {
    return this.trackError(
      error,
      {
        ...context,
        operation: `${method} ${url}`
      },
      ErrorCategory.NETWORK,
      ErrorSeverity.ERROR,
      `Network request to ${url}`
    );
  }

  /**
   * Track a vault error
   */
  trackVaultError(
    error: Error,
    operation: string,
    filePath?: string,
    context: ErrorContext = {}
  ): ErrorLogEntry {
    return this.trackError(
      error,
      {
        ...context,
        operation,
        component: filePath
      },
      ErrorCategory.VAULT,
      ErrorSeverity.ERROR,
      `Vault operation: ${operation}`
    );
  }

  /**
   * Track a validation error
   */
  trackValidationError(
    error: Error,
    field: string,
    _value: unknown,
    context: ErrorContext = {}
  ): ErrorLogEntry {
    return this.trackError(
      error,
      {
        ...context,
        component: field,
        operation: 'validation'
      },
      ErrorCategory.VALIDATION,
      ErrorSeverity.WARNING,
      `Validation failed for field: ${field}`
    );
  }

  /**
   * Enable or disable debug mode
   */
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }

  /**
   * Get debug mode status
   */
  isDebugMode(): boolean {
    return this.debugMode;
  }

  /**
   * Get error statistics
   */
  getStats(): ErrorStats {
    const errorsByCategory: Record<ErrorCategory, number> = {
      [ErrorCategory.NETWORK]: 0,
      [ErrorCategory.VAULT]: 0,
      [ErrorCategory.VALIDATION]: 0,
      [ErrorCategory.AUTHENTICATION]: 0,
      [ErrorCategory.STORAGE]: 0,
      [ErrorCategory.API]: 0,
      [ErrorCategory.UNKNOWN]: 0
    };

    const errorsBySeverity: Record<ErrorSeverity, number> = {
      [ErrorSeverity.INFO]: 0,
      [ErrorSeverity.WARNING]: 0,
      [ErrorSeverity.ERROR]: 0,
      [ErrorSeverity.CRITICAL]: 0
    };

    for (const entry of this.errorLog) {
      errorsByCategory[entry.category]++;
      errorsBySeverity[entry.severity]++;
    }

    const mostCommonErrors = Array.from(this.errorCounts.entries())
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalErrors: this.errorLog.length,
      errorsByCategory,
      errorsBySeverity,
      recentErrors: this.errorLog.slice(-10),
      mostCommonErrors
    };
  }

  /**
   * Get all error logs
   */
  getLogs(
    filter?: {
      category?: ErrorCategory;
      severity?: ErrorSeverity;
      since?: number;
      limit?: number;
    }
  ): ErrorLogEntry[] {
    let logs = this.errorLog;

    if (filter) {
      if (filter.category) {
        logs = logs.filter(entry => entry.category === filter.category);
      }
      if (filter.severity) {
        logs = logs.filter(entry => entry.severity === filter.severity);
      }
      if (filter.since !== undefined) {
        logs = logs.filter(entry => entry.timestamp >= filter.since!);
      }
      if (filter.limit) {
        logs = logs.slice(-filter.limit);
      }
    }

    return logs;
  }

  /**
   * Clear all error logs
   */
  clearLogs(): void {
    this.errorLog = [];
    this.errorCounts.clear();
  }

  /**
   * Export error logs as JSON
   */
  exportLogs(): string {
    return JSON.stringify({
      sessionId: this.sessionId,
      exportedAt: Date.now(),
      stats: this.getStats(),
      logs: this.errorLog
    }, null, 2);
  }

  /**
   * Add entry to log with size management
   */
  private addToLog(entry: ErrorLogEntry): void {
    this.errorLog.push(entry);

    // Keep log size under limit
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog = this.errorLog.slice(-this.maxLogSize);
    }
  }

  /**
   * Increment error count for a message
   */
  private incrementErrorCount(message: string): void {
    const count = this.errorCounts.get(message) || 0;
    this.errorCounts.set(message, count + 1);
  }

  /**
   * Log to console in debug mode
   */
  private logToConsole(entry: ErrorLogEntry): void {
    // Silent - debug logging removed
  }

  /**
   * Filter sensitive data from object
   */
  private filterSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
    const filtered: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      // Check if key matches sensitive pattern
      const isSensitive = SENSITIVE_PATTERNS.some(pattern => pattern.test(key));

      if (isSensitive) {
        filtered[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        filtered[key] = this.filterSensitiveData(value as Record<string, unknown>);
      } else {
        filtered[key] = value;
      }
    }

    return filtered;
  }

  /**
   * Generate unique error ID
   */
  private generateErrorId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get user agent information
   */
  private getUserAgent(): string {
    const platform = Platform.isMobile ? 'mobile' : 'desktop';
    const os = Platform.isIosApp ? 'iOS' :
               Platform.isAndroidApp ? 'Android' :
               Platform.isMacOS ? 'macOS' :
               Platform.isWin ? 'Windows' :
               Platform.isLinux ? 'Linux' : 'unknown';

    return `Obsidian/${platform}/${os}`;
  }

  /**
   * Get platform information
   */
  private getPlatform(): string {
    if (Platform.isIosApp) return 'iOS';
    if (Platform.isAndroidApp) return 'Android';
    if (Platform.isMacOS) return 'macOS';
    if (Platform.isWin) return 'Windows';
    if (Platform.isLinux) return 'Linux';
    return 'Unknown';
  }
}
