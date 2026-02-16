import type { IService } from './base/IService';
import {
  ArchiveError,
  ErrorCode,
  ErrorSeverity,
  isArchiveError,
  toArchiveError,
  type ErrorContext,
  type RecoverySuggestion,
} from '@/types/errors';

/**
 * Error log entry
 */
export interface ErrorLogEntry {
  id: string;
  error: ArchiveError;
  timestamp: Date;
  handled: boolean;
  recovered: boolean;
}

/**
 * Error handler configuration
 */
export interface ErrorHandlerConfig {
  enableLogging?: boolean;
  enableTelemetry?: boolean;
  maxLogEntries?: number;
  onError?: (error: ArchiveError) => void;
}

/**
 * Error recovery strategy
 */
export type RecoveryStrategy = (error: ArchiveError) => Promise<boolean>;

/**
 * Error statistics
 */
export interface ErrorStats {
  totalErrors: number;
  errorsByCode: Map<ErrorCode, number>;
  errorsBySeverity: Map<ErrorSeverity, number>;
  recoveryRate: number;
}

/**
 * ErrorHandler - Centralized error processing and recovery
 *
 * Single Responsibility: Error handling, logging, and recovery coordination
 */
export class ErrorHandler implements IService {
  private config: Required<ErrorHandlerConfig>;
  private errorLog: ErrorLogEntry[] = [];
  private recoveryStrategies: Map<ErrorCode, RecoveryStrategy> = new Map();
  private errorCount: number = 0;
  private recoveredCount: number = 0;

  constructor(config: ErrorHandlerConfig = {}) {
    this.config = {
      enableLogging: config.enableLogging ?? true,
      enableTelemetry: config.enableTelemetry ?? false,
      maxLogEntries: config.maxLogEntries ?? 100,
      onError: config.onError ?? (() => {}),
    };

    // Register default recovery strategies
    this.registerDefaultRecoveryStrategies();
  }

  async initialize(): Promise<void> {
    // Clear any existing error log
    this.errorLog = [];
    this.errorCount = 0;
    this.recoveredCount = 0;
  }

  async dispose(): Promise<void> {
    // Clear error log and strategies
    this.errorLog = [];
    this.recoveryStrategies.clear();
  }

  /**
   * Handle an error
   */
  async handle(error: unknown, context?: ErrorContext): Promise<ArchiveError> {
    // Convert to ArchiveError if needed
    const archiveError = this.normalizeError(error, context);

    // Increment counter
    this.errorCount++;

    // Log error
    if (this.config.enableLogging) {
      this.logError(archiveError);
    }

    // Send telemetry
    if (this.config.enableTelemetry) {
      this.sendTelemetry(archiveError);
    }

    // Call error callback
    this.config.onError(archiveError);

    // Attempt recovery
    const recovered = await this.attemptRecovery(archiveError);

    // Update log entry
    this.updateLogEntry(archiveError, recovered);

    if (recovered) {
      this.recoveredCount++;
    }

    return archiveError;
  }

  /**
   * Register a recovery strategy for an error code
   */
  registerRecoveryStrategy(code: ErrorCode, strategy: RecoveryStrategy): void {
    this.recoveryStrategies.set(code, strategy);
  }

  /**
   * Attempt to recover from an error
   */
  private async attemptRecovery(error: ArchiveError): Promise<boolean> {
    // Check if error has a recovery strategy
    const strategy = this.recoveryStrategies.get(error.code);
    if (!strategy) {
      return false;
    }

    // Check if error is auto-recoverable
    const hasAutoRecoverableSuggestion = error.recoverySuggestions.some(
      suggestion => suggestion.autoRecoverable
    );

    if (!hasAutoRecoverableSuggestion) {
      return false;
    }

    try {
      return await strategy(error);
    } catch (recoveryError) {
      return false;
    }
  }

  /**
   * Normalize error to ArchiveError
   */
  private normalizeError(
    error: unknown,
    context?: ErrorContext
  ): ArchiveError {
    if (isArchiveError(error)) {
      // Merge context if provided
      if (context) {
        return new ArchiveError({
          message: error.message,
          code: error.code,
          userMessage: error.userMessage,
          context: { ...error.context, ...context },
          severity: error.severity,
          recoverySuggestions: error.recoverySuggestions,
          isRetryable: error.isRetryable,
          cause: error.cause instanceof Error ? error.cause : undefined,
        });
      }
      return error;
    }

    // Convert to ArchiveError
    const archiveError = toArchiveError(error);

    // Add context if provided
    if (context) {
      return new ArchiveError({
        message: archiveError.message,
        code: archiveError.code,
        userMessage: archiveError.userMessage,
        context: { ...archiveError.context, ...context },
        severity: archiveError.severity,
        recoverySuggestions: archiveError.recoverySuggestions,
        isRetryable: archiveError.isRetryable,
        cause: archiveError.cause instanceof Error ? archiveError.cause : undefined,
      });
    }

    return archiveError;
  }

  /**
   * Log error
   */
  private logError(error: ArchiveError): void {
    const entry: ErrorLogEntry = {
      id: this.generateErrorId(),
      error,
      timestamp: new Date(),
      handled: true,
      recovered: false,
    };

    this.errorLog.push(entry);

    // Trim log if it exceeds max entries
    if (this.errorLog.length > this.config.maxLogEntries) {
      this.errorLog.shift();
    }

    // Console logging removed
  }

  /**
   * Update log entry with recovery status
   */
  private updateLogEntry(error: ArchiveError, recovered: boolean): void {
    const entry = this.errorLog.find(
      e => e.error === error || e.error.message === error.message
    );
    if (entry) {
      entry.recovered = recovered;
    }
  }

  /**
   * Generate unique error ID
   */
  private generateErrorId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Send telemetry data
   */
  private sendTelemetry(error: ArchiveError): void {
    // TODO: Implement telemetry service integration
    // This would send error data to analytics service
  }

  /**
   * Register default recovery strategies
   */
  private registerDefaultRecoveryStrategies(): void {
    // Network errors - no automatic recovery (handled by retry logic)
    this.registerRecoveryStrategy(
      ErrorCode.NETWORK_ERROR,
      async () => false
    );

    // Rate limit errors - wait and retry
    this.registerRecoveryStrategy(
      ErrorCode.RATE_LIMIT_EXCEEDED,
      async (error) => {
        const retryAfter = error.context.metadata?.retryAfter as number | undefined;
        if (retryAfter) {
          await this.sleep(retryAfter);
          return true;
        }
        return false;
      }
    );

    // Timeout errors - no automatic recovery
    this.registerRecoveryStrategy(
      ErrorCode.OPERATION_TIMEOUT,
      async () => false
    );

    // Media errors - can skip media and continue
    this.registerRecoveryStrategy(
      ErrorCode.MEDIA_ERROR,
      async () => {
        // Let caller decide whether to skip media
        return false;
      }
    );
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get error log
   */
  getErrorLog(): ErrorLogEntry[] {
    return [...this.errorLog];
  }

  /**
   * Get error statistics
   */
  getStats(): ErrorStats {
    const errorsByCode = new Map<ErrorCode, number>();
    const errorsBySeverity = new Map<ErrorSeverity, number>();

    this.errorLog.forEach(entry => {
      // Count by code
      const codeCount = errorsByCode.get(entry.error.code) ?? 0;
      errorsByCode.set(entry.error.code, codeCount + 1);

      // Count by severity
      const severityCount = errorsBySeverity.get(entry.error.severity) ?? 0;
      errorsBySeverity.set(entry.error.severity, severityCount + 1);
    });

    const recoveryRate =
      this.errorCount > 0 ? this.recoveredCount / this.errorCount : 0;

    return {
      totalErrors: this.errorCount,
      errorsByCode,
      errorsBySeverity,
      recoveryRate,
    };
  }

  /**
   * Clear error log
   */
  clearLog(): void {
    this.errorLog = [];
  }

  /**
   * Get recent errors
   */
  getRecentErrors(count: number = 10): ErrorLogEntry[] {
    return this.errorLog.slice(-count);
  }

  /**
   * Get errors by severity
   */
  getErrorsBySeverity(severity: ErrorSeverity): ErrorLogEntry[] {
    return this.errorLog.filter(entry => entry.error.severity === severity);
  }

  /**
   * Get errors by code
   */
  getErrorsByCode(code: ErrorCode): ErrorLogEntry[] {
    return this.errorLog.filter(entry => entry.error.code === code);
  }

  /**
   * Check if error should be retried
   */
  shouldRetry(error: unknown): boolean {
    const archiveError = isArchiveError(error)
      ? error
      : toArchiveError(error);
    return archiveError.isRetryable;
  }

  /**
   * Get user-friendly error message
   */
  getUserMessage(error: unknown): string {
    const archiveError = isArchiveError(error)
      ? error
      : toArchiveError(error);
    return archiveError.getUserFriendlyMessage();
  }

  /**
   * Format error for display
   */
  formatError(error: unknown): {
    title: string;
    message: string;
    suggestions: RecoverySuggestion[];
    severity: ErrorSeverity;
  } {
    const archiveError = isArchiveError(error)
      ? error
      : toArchiveError(error);

    return {
      title: this.getErrorTitle(archiveError.code),
      message: archiveError.userMessage,
      suggestions: archiveError.recoverySuggestions,
      severity: archiveError.severity,
    };
  }

  /**
   * Get error title from code
   */
  private getErrorTitle(code: ErrorCode): string {
    const titles: Record<ErrorCode, string> = {
      [ErrorCode.NETWORK_ERROR]: 'Network Error',
      [ErrorCode.TIMEOUT_ERROR]: 'Timeout Error',
      [ErrorCode.CONNECTION_REFUSED]: 'Connection Refused',
      [ErrorCode.DNS_LOOKUP_FAILED]: 'DNS Lookup Failed',
      [ErrorCode.API_ERROR]: 'API Error',
      [ErrorCode.RATE_LIMIT_EXCEEDED]: 'Rate Limit Exceeded',
      [ErrorCode.AUTHENTICATION_FAILED]: 'Authentication Failed',
      [ErrorCode.AUTHORIZATION_FAILED]: 'Authorization Failed',
      [ErrorCode.RESOURCE_NOT_FOUND]: 'Resource Not Found',
      [ErrorCode.INVALID_RESPONSE]: 'Invalid Response',
      [ErrorCode.VALIDATION_ERROR]: 'Validation Error',
      [ErrorCode.INVALID_URL]: 'Invalid URL',
      [ErrorCode.INVALID_PLATFORM]: 'Invalid Platform',
      [ErrorCode.INVALID_POST_DATA]: 'Invalid Post Data',
      [ErrorCode.INVALID_OPTIONS]: 'Invalid Options',
      [ErrorCode.VAULT_ERROR]: 'Vault Error',
      [ErrorCode.FILE_CREATION_FAILED]: 'File Creation Failed',
      [ErrorCode.FILE_READ_FAILED]: 'File Read Failed',
      [ErrorCode.FILE_WRITE_FAILED]: 'File Write Failed',
      [ErrorCode.FOLDER_CREATION_FAILED]: 'Folder Creation Failed',
      [ErrorCode.INSUFFICIENT_PERMISSIONS]: 'Insufficient Permissions',
      [ErrorCode.MEDIA_ERROR]: 'Media Error',
      [ErrorCode.MEDIA_DOWNLOAD_FAILED]: 'Media Download Failed',
      [ErrorCode.MEDIA_PROCESSING_FAILED]: 'Media Processing Failed',
      [ErrorCode.INVALID_MEDIA_TYPE]: 'Invalid Media Type',
      [ErrorCode.MEDIA_TOO_LARGE]: 'Media Too Large',
      [ErrorCode.INSUFFICIENT_CREDITS]: 'Insufficient Credits',
      [ErrorCode.INVALID_LICENSE_KEY]: 'Invalid License Key',
      [ErrorCode.LICENSE_EXPIRED]: 'License Expired',
      [ErrorCode.OPERATION_CANCELLED]: 'Operation Cancelled',
      [ErrorCode.OPERATION_TIMEOUT]: 'Operation Timeout',
      [ErrorCode.OPERATION_FAILED]: 'Operation Failed',
      [ErrorCode.INTERNAL_ERROR]: 'Internal Error',
      [ErrorCode.UNKNOWN_ERROR]: 'Unknown Error',
    };

    return titles[code] ?? 'Error';
  }
}
