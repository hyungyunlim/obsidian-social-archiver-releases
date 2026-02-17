/**
 * ErrorNotificationService - User-friendly error notifications using Obsidian Notice API
 *
 * Features:
 * - Centralized error message mapping
 * - Type-safe error handling
 * - Consistent UX across the plugin
 * - Different notice types (error, warning, info, success)
 * - Actionable error messages
 */

import { Notice } from 'obsidian';
import type { IService } from './base/IService';
import {
  RateLimitError,
  AuthenticationError,
  InvalidRequestError,
  ServerError,
  NetworkError,
  TimeoutError,
  type HttpError
} from '@/types/errors/http-errors';

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical'
}

/**
 * Error category types
 */
export enum ErrorCategory {
  NETWORK = 'network',
  VAULT = 'vault',
  VALIDATION = 'validation',
  AUTHENTICATION = 'authentication',
  STORAGE = 'storage',
  API = 'api',
  UNKNOWN = 'unknown'
}

/**
 * Error notification options
 */
export interface ErrorNotificationOptions {
  severity?: ErrorSeverity;
  duration?: number;
  action?: {
    label: string;
    callback: () => void;
  };
  details?: string;
}

/**
 * User-friendly error message mapping
 */
interface ErrorMessageMap {
  [key: string]: {
    message: string;
    severity: ErrorSeverity;
    category: ErrorCategory;
    defaultDuration: number;
  };
}

/**
 * ErrorNotificationService - Manages user-facing error notifications
 */
export class ErrorNotificationService implements IService {
  public readonly name = 'ErrorNotificationService';
  private isInitialized = false;
  private activeNotices: Map<string, Notice> = new Map();
  private pendingTimers: Set<ReturnType<typeof setTimeout>> = new Set();

  /**
   * Error message mapping from technical errors to user-friendly messages
   */
  private readonly errorMessages: ErrorMessageMap = {
    // Network errors
    'network-timeout': {
      message: '⏱️ Request timed out. Please check your internet connection and try again.',
      severity: ErrorSeverity.ERROR,
      category: ErrorCategory.NETWORK,
      defaultDuration: 5000
    },
    'network-offline': {
      message: '📡 No internet connection. Please check your network and try again.',
      severity: ErrorSeverity.ERROR,
      category: ErrorCategory.NETWORK,
      defaultDuration: 5000
    },
    'network-error': {
      message: '🌐 Network error occurred. Please try again.',
      severity: ErrorSeverity.ERROR,
      category: ErrorCategory.NETWORK,
      defaultDuration: 5000
    },

    // API errors
    'rate-limit': {
      message: '⏳ Too many requests. Please wait a moment and try again.',
      severity: ErrorSeverity.WARNING,
      category: ErrorCategory.API,
      defaultDuration: 5000
    },
    'api-authentication': {
      message: '🔐 Authentication failed. Please check your API key in settings.',
      severity: ErrorSeverity.ERROR,
      category: ErrorCategory.AUTHENTICATION,
      defaultDuration: 7000
    },
    'api-invalid-request': {
      message: '❌ Invalid request. Please check your input and try again.',
      severity: ErrorSeverity.ERROR,
      category: ErrorCategory.VALIDATION,
      defaultDuration: 5000
    },
    'api-server-error': {
      message: '🔧 Server error occurred. Please try again later.',
      severity: ErrorSeverity.ERROR,
      category: ErrorCategory.API,
      defaultDuration: 5000
    },

    // Vault errors
    'vault-quota-exceeded': {
      message: '💾 Vault storage is full. Please free up space and try again.',
      severity: ErrorSeverity.CRITICAL,
      category: ErrorCategory.VAULT,
      defaultDuration: 0 // Persistent until dismissed
    },
    'vault-permission-denied': {
      message: '🔒 Permission denied. Cannot write to vault.',
      severity: ErrorSeverity.ERROR,
      category: ErrorCategory.VAULT,
      defaultDuration: 5000
    },
    'vault-file-not-found': {
      message: '📁 File not found in vault.',
      severity: ErrorSeverity.WARNING,
      category: ErrorCategory.VAULT,
      defaultDuration: 4000
    },

    // Storage errors (localStorage)
    'storage-quota-exceeded': {
      message: '💿 Local storage is full. Old drafts will be cleaned up automatically.',
      severity: ErrorSeverity.WARNING,
      category: ErrorCategory.STORAGE,
      defaultDuration: 5000
    },
    'storage-unavailable': {
      message: '💾 Storage unavailable. Some features may not work correctly.',
      severity: ErrorSeverity.WARNING,
      category: ErrorCategory.STORAGE,
      defaultDuration: 5000
    },

    // Validation errors
    'invalid-url': {
      message: '🔗 Invalid URL format. Please check and try again.',
      severity: ErrorSeverity.ERROR,
      category: ErrorCategory.VALIDATION,
      defaultDuration: 4000
    },
    'invalid-image-format': {
      message: '🖼️ Unsupported image format. Please use JPG, PNG, or WebP.',
      severity: ErrorSeverity.ERROR,
      category: ErrorCategory.VALIDATION,
      defaultDuration: 5000
    },
    'invalid-file-size': {
      message: '📏 File size exceeds maximum limit.',
      severity: ErrorSeverity.ERROR,
      category: ErrorCategory.VALIDATION,
      defaultDuration: 4000
    },
    'missing-required-field': {
      message: '⚠️ Required field is missing. Please fill in all required fields.',
      severity: ErrorSeverity.WARNING,
      category: ErrorCategory.VALIDATION,
      defaultDuration: 4000
    },

    // Share API errors
    'share-create-failed': {
      message: '🔗 Failed to create share link. Please try again.',
      severity: ErrorSeverity.ERROR,
      category: ErrorCategory.API,
      defaultDuration: 5000
    },
    'share-not-found': {
      message: '🔍 Share link not found or has expired.',
      severity: ErrorSeverity.WARNING,
      category: ErrorCategory.API,
      defaultDuration: 4000
    },
    'share-password-incorrect': {
      message: '🔑 Incorrect password. Please try again.',
      severity: ErrorSeverity.WARNING,
      category: ErrorCategory.AUTHENTICATION,
      defaultDuration: 4000
    },

    // Credits errors
    'insufficient-credits': {
      message: '💳 Insufficient credits. Please upgrade your plan or purchase more credits.',
      severity: ErrorSeverity.WARNING,
      category: ErrorCategory.API,
      defaultDuration: 7000
    },

    // Unknown error
    'unknown-error': {
      message: '❓ An unexpected error occurred. Please try again.',
      severity: ErrorSeverity.ERROR,
      category: ErrorCategory.UNKNOWN,
      defaultDuration: 5000
    }
  };

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    this.isInitialized = true;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    // Clear all pending notice timers
    for (const timer of this.pendingTimers) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();

    // Hide all active notices
    for (const notice of this.activeNotices.values()) {
      notice.hide();
    }
    this.activeNotices.clear();

    this.isInitialized = false;
  }

  /**
   * Check if service is initialized
   */
  isServiceInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Show an error notification
   * @param error - Error object or error key
   * @param options - Notification options
   */
  showError(
    error: Error | HttpError | string,
    options: ErrorNotificationOptions = {}
  ): Notice {
    const errorKey = this.getErrorKey(error);
    const errorInfo = this.errorMessages[errorKey] || this.errorMessages['unknown-error'];

    if (!errorInfo) {
      return new Notice('An unknown error occurred', 5000);
    }

    const severity = options.severity || errorInfo.severity;
    const duration = options.duration !== undefined ? options.duration : errorInfo.defaultDuration;

    // Format message
    let message = errorInfo.message;
    if (options.details) {
      message += `\n${options.details}`;
    }

    // Create notice
    const notice = new Notice(message, duration);

    // Add action button if provided
    if (options.action) {
      const buttonEl = notice.messageEl.createEl('button', {
        text: options.action.label,
        cls: 'error-action-button'
      });
      buttonEl.addEventListener('click', () => {
        options.action!.callback();
        notice.hide();
      });
    }

    // Style based on severity
    this.styleNotice(notice, severity);

    // Track active notice
    const noticeId = `${errorKey}-${Date.now()}`;
    this.activeNotices.set(noticeId, notice);

    // Remove from tracking when hidden
    this.scheduleNoticeCleanup(noticeId, duration || 5000);

    return notice;
  }

  /**
   * Show a warning notification
   */
  showWarning(message: string, duration: number = 4000): Notice {
    const notice = new Notice(`⚠️ ${message}`, duration);
    this.styleNotice(notice, ErrorSeverity.WARNING);

    // Track active notice
    const noticeId = `warning-${Date.now()}`;
    this.activeNotices.set(noticeId, notice);

    // Remove from tracking when hidden
    this.scheduleNoticeCleanup(noticeId, duration);

    return notice;
  }

  /**
   * Show an info notification
   */
  showInfo(message: string, duration: number = 3000): Notice {
    const notice = new Notice(`ℹ️ ${message}`, duration);
    this.styleNotice(notice, ErrorSeverity.INFO);

    // Track active notice
    const noticeId = `info-${Date.now()}`;
    this.activeNotices.set(noticeId, notice);

    // Remove from tracking when hidden
    this.scheduleNoticeCleanup(noticeId, duration);

    return notice;
  }

  /**
   * Show a success notification
   */
  showSuccess(message: string, duration: number = 3000): Notice {
    const notice = new Notice(`✅ ${message}`, duration);
    this.styleNotice(notice, ErrorSeverity.INFO);

    // Track active notice
    const noticeId = `success-${Date.now()}`;
    this.activeNotices.set(noticeId, notice);

    // Remove from tracking when hidden
    this.scheduleNoticeCleanup(noticeId, duration);

    return notice;
  }

  /** Schedule notice cleanup with tracked timer */
  private scheduleNoticeCleanup(noticeId: string, duration: number): void {
    const timer = setTimeout(() => {
      this.pendingTimers.delete(timer);
      this.activeNotices.delete(noticeId);
    }, duration);
    this.pendingTimers.add(timer);
  }

  /**
   * Get error key from error object
   */
  private getErrorKey(error: Error | HttpError | string): string {
    if (typeof error === 'string') {
      return error;
    }

    // Map HTTP errors to error keys
    if (error instanceof RateLimitError) {
      return 'rate-limit';
    }
    if (error instanceof AuthenticationError) {
      return 'api-authentication';
    }
    if (error instanceof InvalidRequestError) {
      return 'api-invalid-request';
    }
    if (error instanceof ServerError) {
      return 'api-server-error';
    }
    if (error instanceof NetworkError) {
      return 'network-error';
    }
    if (error instanceof TimeoutError) {
      return 'network-timeout';
    }

    // Check error message for specific patterns
    const message = error.message.toLowerCase();
    if (message.includes('quota') && message.includes('exceeded')) {
      return 'vault-quota-exceeded';
    }
    if (message.includes('storage') && message.includes('full')) {
      return 'storage-quota-exceeded';
    }
    if (message.includes('permission denied')) {
      return 'vault-permission-denied';
    }
    if (message.includes('not found')) {
      return 'vault-file-not-found';
    }
    if (message.includes('invalid url')) {
      return 'invalid-url';
    }
    if (message.includes('timeout')) {
      return 'network-timeout';
    }

    return 'unknown-error';
  }

  /**
   * Style notice based on severity
   */
  private styleNotice(notice: Notice, severity: ErrorSeverity): void {
    const noticeEl = notice.messageEl;

    // Remove default styling
    noticeEl.removeClass('notice');

    // Add severity-specific class
    switch (severity) {
      case ErrorSeverity.INFO:
        noticeEl.addClass('notice-info');
        break;
      case ErrorSeverity.WARNING:
        noticeEl.addClass('notice-warning');
        break;
      case ErrorSeverity.ERROR:
        noticeEl.addClass('notice-error');
        break;
      case ErrorSeverity.CRITICAL:
        noticeEl.addClass('notice-critical');
        break;
    }
  }

  /**
   * Get error category for an error
   */
  getErrorCategory(error: Error | HttpError | string): ErrorCategory {
    const errorKey = this.getErrorKey(error);
    const errorInfo = this.errorMessages[errorKey];
    return errorInfo?.category || ErrorCategory.UNKNOWN;
  }

  /**
   * Check if error is retryable
   */
  isRetryable(error: Error | HttpError | string): boolean {
    const category = this.getErrorCategory(error);

    // Network, timeout, and some API errors are retryable
    return [
      ErrorCategory.NETWORK,
      ErrorCategory.API
    ].includes(category) && !(error instanceof AuthenticationError);
  }

  /**
   * Hide a specific notice
   */
  hideNotice(notice: Notice): void {
    notice.hide();
  }

  /**
   * Hide all active notices
   */
  hideAll(): void {
    for (const notice of this.activeNotices.values()) {
      notice.hide();
    }
    this.activeNotices.clear();
  }
}
