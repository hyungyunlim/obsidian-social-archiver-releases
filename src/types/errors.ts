/**
 * Error codes for categorizing different types of errors
 */
export enum ErrorCode {
  // Network errors (1xxx)
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  CONNECTION_REFUSED = 'CONNECTION_REFUSED',
  DNS_LOOKUP_FAILED = 'DNS_LOOKUP_FAILED',

  // API errors (2xxx)
  API_ERROR = 'API_ERROR',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  AUTHORIZATION_FAILED = 'AUTHORIZATION_FAILED',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  INVALID_RESPONSE = 'INVALID_RESPONSE',

  // Validation errors (3xxx)
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_URL = 'INVALID_URL',
  INVALID_PLATFORM = 'INVALID_PLATFORM',
  INVALID_POST_DATA = 'INVALID_POST_DATA',
  INVALID_OPTIONS = 'INVALID_OPTIONS',

  // Vault errors (4xxx)
  VAULT_ERROR = 'VAULT_ERROR',
  FILE_CREATION_FAILED = 'FILE_CREATION_FAILED',
  FILE_READ_FAILED = 'FILE_READ_FAILED',
  FILE_WRITE_FAILED = 'FILE_WRITE_FAILED',
  FOLDER_CREATION_FAILED = 'FOLDER_CREATION_FAILED',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',

  // Media errors (5xxx)
  MEDIA_ERROR = 'MEDIA_ERROR',
  MEDIA_DOWNLOAD_FAILED = 'MEDIA_DOWNLOAD_FAILED',
  MEDIA_PROCESSING_FAILED = 'MEDIA_PROCESSING_FAILED',
  INVALID_MEDIA_TYPE = 'INVALID_MEDIA_TYPE',
  MEDIA_TOO_LARGE = 'MEDIA_TOO_LARGE',

  // Credit/License errors (6xxx)
  INSUFFICIENT_CREDITS = 'INSUFFICIENT_CREDITS',
  INVALID_LICENSE_KEY = 'INVALID_LICENSE_KEY',
  LICENSE_EXPIRED = 'LICENSE_EXPIRED',

  // Operation errors (7xxx)
  OPERATION_CANCELLED = 'OPERATION_CANCELLED',
  OPERATION_TIMEOUT = 'OPERATION_TIMEOUT',
  OPERATION_FAILED = 'OPERATION_FAILED',

  // Unknown/Internal errors (9xxx)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * Error context for debugging and logging
 */
export interface ErrorContext {
  url?: string;
  platform?: string;
  operation?: string;
  timestamp?: Date;
  stackTrace?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Error recovery suggestion
 */
export interface RecoverySuggestion {
  action: string;
  description: string;
  autoRecoverable: boolean;
}

/**
 * Base ArchiveError class
 * All custom errors in the application should extend this class
 */
export class ArchiveError extends Error {
  readonly code: ErrorCode;
  readonly userMessage: string;
  readonly context: ErrorContext;
  readonly severity: ErrorSeverity;
  readonly recoverySuggestions: RecoverySuggestion[];
  readonly isRetryable: boolean;

  constructor(options: {
    message: string;
    code: ErrorCode;
    userMessage: string;
    context?: ErrorContext;
    severity?: ErrorSeverity;
    recoverySuggestions?: RecoverySuggestion[];
    isRetryable?: boolean;
    cause?: Error;
  }) {
    super(options.message);

    // Set error name to constructor name
    this.name = this.constructor.name;

    // Set properties
    this.code = options.code;
    this.userMessage = options.userMessage;
    this.context = {
      ...options.context,
      timestamp: new Date(),
      stackTrace: this.stack,
    };
    this.severity = options.severity ?? ErrorSeverity.MEDIUM;
    this.recoverySuggestions = options.recoverySuggestions ?? [];
    this.isRetryable = options.isRetryable ?? false;

    // Set cause if provided (for error chaining)
    if (options.cause) {
      this.cause = options.cause;
    }

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to JSON for logging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      userMessage: this.userMessage,
      context: this.context,
      severity: this.severity,
      recoverySuggestions: this.recoverySuggestions,
      isRetryable: this.isRetryable,
      stack: this.stack,
    };
  }

  /**
   * Get user-friendly error message with suggestions
   */
  getUserFriendlyMessage(): string {
    let message = this.userMessage;

    if (this.recoverySuggestions.length > 0) {
      message += '\n\nSuggestions:';
      this.recoverySuggestions.forEach((suggestion, index) => {
        message += `\n${index + 1}. ${suggestion.description}`;
      });
    }

    return message;
  }
}

/**
 * Network-related errors
 */
export class NetworkError extends ArchiveError {
  constructor(options: {
    message: string;
    userMessage?: string;
    context?: ErrorContext;
    cause?: Error;
  }) {
    super({
      message: options.message,
      code: ErrorCode.NETWORK_ERROR,
      userMessage:
        options.userMessage ??
        'A network error occurred. Please check your internet connection and try again.',
      context: options.context,
      severity: ErrorSeverity.HIGH,
      isRetryable: true,
      recoverySuggestions: [
        {
          action: 'check_connection',
          description: 'Check your internet connection',
          autoRecoverable: false,
        },
        {
          action: 'retry',
          description: 'Retry the operation',
          autoRecoverable: true,
        },
      ],
      cause: options.cause,
    });
  }
}

/**
 * Validation-related errors
 */
export class ValidationError extends ArchiveError {
  constructor(options: {
    message: string;
    userMessage?: string;
    context?: ErrorContext;
    field?: string;
  }) {
    super({
      message: options.message,
      code: ErrorCode.VALIDATION_ERROR,
      userMessage: options.userMessage ?? 'Invalid input provided.',
      context: {
        ...options.context,
        metadata: {
          ...options.context?.metadata,
          field: options.field,
        },
      },
      severity: ErrorSeverity.LOW,
      isRetryable: false,
      recoverySuggestions: [
        {
          action: 'fix_input',
          description: 'Check and correct the input',
          autoRecoverable: false,
        },
      ],
    });
  }
}

/**
 * Vault-related errors
 */
export class VaultError extends ArchiveError {
  constructor(options: {
    message: string;
    userMessage?: string;
    context?: ErrorContext;
    operation?: string;
    cause?: Error;
  }) {
    super({
      message: options.message,
      code: ErrorCode.VAULT_ERROR,
      userMessage:
        options.userMessage ??
        'Failed to access or modify the vault. Please check your vault permissions.',
      context: {
        ...options.context,
        operation: options.operation,
      },
      severity: ErrorSeverity.HIGH,
      isRetryable: false,
      recoverySuggestions: [
        {
          action: 'check_permissions',
          description: 'Check vault and file permissions',
          autoRecoverable: false,
        },
        {
          action: 'check_disk_space',
          description: 'Ensure sufficient disk space is available',
          autoRecoverable: false,
        },
      ],
      cause: options.cause,
    });
  }
}

/**
 * Media-related errors
 */
export class MediaError extends ArchiveError {
  constructor(options: {
    message: string;
    userMessage?: string;
    context?: ErrorContext;
    mediaUrl?: string;
    cause?: Error;
  }) {
    super({
      message: options.message,
      code: ErrorCode.MEDIA_ERROR,
      userMessage:
        options.userMessage ??
        'Failed to download or process media. The media may be unavailable or corrupted.',
      context: {
        ...options.context,
        metadata: {
          ...options.context?.metadata,
          mediaUrl: options.mediaUrl,
        },
      },
      severity: ErrorSeverity.MEDIUM,
      isRetryable: true,
      recoverySuggestions: [
        {
          action: 'skip_media',
          description: 'Archive post without media',
          autoRecoverable: false,
        },
        {
          action: 'retry',
          description: 'Retry media download',
          autoRecoverable: true,
        },
      ],
      cause: options.cause,
    });
  }
}

/**
 * Rate limit errors
 */
export class RateLimitError extends ArchiveError {
  readonly retryAfter?: number;

  constructor(options: {
    message: string;
    userMessage?: string;
    context?: ErrorContext;
    retryAfter?: number;
  }) {
    const retryMessage = options.retryAfter
      ? ` Please try again in ${Math.ceil(options.retryAfter / 1000)} seconds.`
      : ' Please try again later.';

    super({
      message: options.message,
      code: ErrorCode.RATE_LIMIT_EXCEEDED,
      userMessage:
        options.userMessage ??
        `You've exceeded the rate limit.${retryMessage}`,
      context: {
        ...options.context,
        metadata: {
          ...options.context?.metadata,
          retryAfter: options.retryAfter,
        },
      },
      severity: ErrorSeverity.MEDIUM,
      isRetryable: true,
      recoverySuggestions: [
        {
          action: 'wait',
          description: `Wait ${options.retryAfter ? Math.ceil(options.retryAfter / 1000) : 60} seconds before retrying`,
          autoRecoverable: true,
        },
      ],
    });

    this.retryAfter = options.retryAfter;
  }
}

/**
 * Authentication errors
 */
export class AuthenticationError extends ArchiveError {
  constructor(options: {
    message: string;
    userMessage?: string;
    context?: ErrorContext;
  }) {
    super({
      message: options.message,
      code: ErrorCode.AUTHENTICATION_FAILED,
      userMessage:
        options.userMessage ??
        'Authentication failed. Please check your API key or license.',
      context: options.context,
      severity: ErrorSeverity.HIGH,
      isRetryable: false,
      recoverySuggestions: [
        {
          action: 'check_credentials',
          description: 'Verify your API key or license key',
          autoRecoverable: false,
        },
        {
          action: 'renew_license',
          description: 'Renew your license if expired',
          autoRecoverable: false,
        },
      ],
    });
  }
}

/**
 * Credit-related errors
 */
export class InsufficientCreditsError extends ArchiveError {
  readonly creditsRequired: number;
  readonly creditsAvailable: number;

  constructor(options: {
    message: string;
    userMessage?: string;
    context?: ErrorContext;
    creditsRequired: number;
    creditsAvailable: number;
  }) {
    super({
      message: options.message,
      code: ErrorCode.INSUFFICIENT_CREDITS,
      userMessage:
        options.userMessage ??
        `Insufficient credits. Required: ${options.creditsRequired}, Available: ${options.creditsAvailable}`,
      context: {
        ...options.context,
        metadata: {
          ...options.context?.metadata,
          creditsRequired: options.creditsRequired,
          creditsAvailable: options.creditsAvailable,
        },
      },
      severity: ErrorSeverity.MEDIUM,
      isRetryable: false,
      recoverySuggestions: [
        {
          action: 'upgrade',
          description: 'Upgrade to Pro for more credits',
          autoRecoverable: false,
        },
        {
          action: 'wait_renewal',
          description: 'Wait for monthly credit renewal',
          autoRecoverable: false,
        },
        {
          action: 'disable_features',
          description: 'Disable AI features to reduce credit usage',
          autoRecoverable: false,
        },
      ],
    });

    this.creditsRequired = options.creditsRequired;
    this.creditsAvailable = options.creditsAvailable;
  }
}

/**
 * Operation cancelled error
 */
export class OperationCancelledError extends ArchiveError {
  constructor(options?: {
    message?: string;
    userMessage?: string;
    context?: ErrorContext;
  }) {
    super({
      message: options?.message ?? 'Operation was cancelled by user',
      code: ErrorCode.OPERATION_CANCELLED,
      userMessage:
        options?.userMessage ??
        'The operation was cancelled. No changes were made.',
      context: options?.context,
      severity: ErrorSeverity.LOW,
      isRetryable: false,
      recoverySuggestions: [],
    });
  }
}

/**
 * Timeout error
 */
export class TimeoutError extends ArchiveError {
  readonly timeoutMs: number;

  constructor(options: {
    message: string;
    userMessage?: string;
    context?: ErrorContext;
    timeoutMs: number;
  }) {
    super({
      message: options.message,
      code: ErrorCode.OPERATION_TIMEOUT,
      userMessage:
        options.userMessage ??
        `Operation timed out after ${options.timeoutMs / 1000} seconds.`,
      context: {
        ...options.context,
        metadata: {
          ...options.context?.metadata,
          timeoutMs: options.timeoutMs,
        },
      },
      severity: ErrorSeverity.MEDIUM,
      isRetryable: true,
      recoverySuggestions: [
        {
          action: 'retry',
          description: 'Retry the operation',
          autoRecoverable: true,
        },
        {
          action: 'increase_timeout',
          description: 'Increase timeout settings if the issue persists',
          autoRecoverable: false,
        },
      ],
    });

    this.timeoutMs = options.timeoutMs;
  }
}

/**
 * Type guard to check if error is ArchiveError
 */
export function isArchiveError(error: unknown): error is ArchiveError {
  return error instanceof ArchiveError;
}

/**
 * Type guard to check if error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  return isArchiveError(error) && error.isRetryable;
}

/**
 * Convert unknown error to ArchiveError
 */
export function toArchiveError(error: unknown): ArchiveError {
  if (isArchiveError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new ArchiveError({
      message: error.message,
      code: ErrorCode.UNKNOWN_ERROR,
      userMessage: 'An unexpected error occurred. Please try again.',
      severity: ErrorSeverity.MEDIUM,
      cause: error,
    });
  }

  return new ArchiveError({
    message: String(error),
    code: ErrorCode.UNKNOWN_ERROR,
    userMessage: 'An unexpected error occurred. Please try again.',
    severity: ErrorSeverity.MEDIUM,
  });
}
