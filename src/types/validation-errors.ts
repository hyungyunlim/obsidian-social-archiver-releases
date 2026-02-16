/**
 * Profile Validation Error Types and Messages
 *
 * Provides user-friendly error handling for profile validation:
 * - Error codes mapping
 * - User-facing messages with suggestions
 * - Retry logic helpers
 *
 * Single Responsibility: Define validation error types and messages
 */

// ============================================================================
// Error Codes
// ============================================================================

/**
 * All possible validation error codes
 */
export type ValidationErrorCode =
  | 'INVALID_URL'
  | 'PRIVATE_PROFILE'
  | 'PROFILE_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'VALIDATION_TIMEOUT'
  | 'NETWORK_ERROR'
  | 'CRAWL_FAILED'
  | 'UNSUPPORTED_PLATFORM'
  | 'INVALID_RESPONSE'
  | 'VALIDATION_FAILED'
  | 'HTTP_ERROR'
  | 'UNKNOWN_ERROR';

// ============================================================================
// Error Message Structure
// ============================================================================

/**
 * User-facing error message with recovery suggestions
 */
export interface ValidationErrorMessage {
  /** Short title for the error */
  title: string;
  /** Detailed explanation */
  message: string;
  /** Suggested action for the user */
  suggestion: string;
  /** Whether the user can retry this action */
  canRetry: boolean;
  /** Retry delay in seconds (if applicable) */
  retryDelay?: number;
}

// ============================================================================
// Error Messages Map
// ============================================================================

/**
 * Map of error codes to user-friendly messages
 */
export const VALIDATION_ERROR_MESSAGES: Record<ValidationErrorCode, ValidationErrorMessage> = {
  INVALID_URL: {
    title: 'Invalid URL',
    message: 'Please enter a valid Instagram profile URL.',
    suggestion: 'Format: instagram.com/username or @username',
    canRetry: false,
  },

  PRIVATE_PROFILE: {
    title: 'Private Profile',
    message: 'This profile is private and cannot be monitored.',
    suggestion: 'Try a public profile or ask the user to make their profile public.',
    canRetry: false,
  },

  PROFILE_NOT_FOUND: {
    title: 'Profile Not Found',
    message: 'This profile doesn\'t exist or has been deleted.',
    suggestion: 'Please check the username spelling and try again.',
    canRetry: false,
  },

  RATE_LIMITED: {
    title: 'Please Wait',
    message: 'Too many requests. Please try again later.',
    suggestion: 'Wait a few minutes before trying again.',
    canRetry: true,
    retryDelay: 60,
  },

  VALIDATION_TIMEOUT: {
    title: 'Validation Timed Out',
    message: 'The profile validation took too long to complete.',
    suggestion: 'Please try again. If the problem persists, the profile may be temporarily unavailable.',
    canRetry: true,
    retryDelay: 5,
  },

  NETWORK_ERROR: {
    title: 'Network Error',
    message: 'Unable to connect to the server.',
    suggestion: 'Check your internet connection and try again.',
    canRetry: true,
    retryDelay: 3,
  },

  CRAWL_FAILED: {
    title: 'Validation Failed',
    message: 'Failed to validate the profile. This may be a temporary issue.',
    suggestion: 'Please try again in a few moments.',
    canRetry: true,
    retryDelay: 10,
  },

  UNSUPPORTED_PLATFORM: {
    title: 'Unsupported Platform',
    message: 'This platform is not supported for subscriptions yet.',
    suggestion: 'Currently only Instagram profiles are supported.',
    canRetry: false,
  },

  INVALID_RESPONSE: {
    title: 'Invalid Response',
    message: 'Received an unexpected response from the server.',
    suggestion: 'Please try again. If the problem persists, contact support.',
    canRetry: true,
    retryDelay: 5,
  },

  VALIDATION_FAILED: {
    title: 'Validation Failed',
    message: 'Could not validate the profile.',
    suggestion: 'Please check the URL and try again.',
    canRetry: true,
    retryDelay: 5,
  },

  HTTP_ERROR: {
    title: 'Server Error',
    message: 'The server returned an error.',
    suggestion: 'Please try again later.',
    canRetry: true,
    retryDelay: 10,
  },

  UNKNOWN_ERROR: {
    title: 'Unknown Error',
    message: 'An unexpected error occurred.',
    suggestion: 'Please try again. If the problem persists, contact support.',
    canRetry: true,
    retryDelay: 5,
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get user-friendly error message for a validation error code
 *
 * @param code Error code from API or polling
 * @returns User-facing error message with suggestions
 */
export function getValidationErrorMessage(code: string): ValidationErrorMessage {
  const errorCode = code as ValidationErrorCode;
  return VALIDATION_ERROR_MESSAGES[errorCode] ?? VALIDATION_ERROR_MESSAGES.UNKNOWN_ERROR;
}

/**
 * Check if an error code represents a retryable error
 *
 * @param code Error code
 * @returns True if the user can retry
 */
export function isRetryableError(code: string): boolean {
  const message = getValidationErrorMessage(code);
  return message.canRetry;
}

/**
 * Get suggested retry delay for an error
 *
 * @param code Error code
 * @returns Delay in seconds, or 0 if not retryable
 */
export function getRetryDelay(code: string): number {
  const message = getValidationErrorMessage(code);
  return message.retryDelay ?? 0;
}
