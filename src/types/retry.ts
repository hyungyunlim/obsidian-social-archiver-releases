/**
 * Retry and Exponential Backoff Types
 */

/**
 * Retry configuration
 */
export interface RetryConfig {
	/** Maximum number of retry attempts (default: 3) */
	maxAttempts: number;
	/** Base delay in milliseconds (default: 1000) */
	baseDelay: number;
	/** Maximum delay in milliseconds (default: 32000) */
	maxDelay: number;
	/** Jitter range in milliseconds (default: 1000) */
	jitterRange: number;
	/** Custom predicate to determine if error is retryable */
	isRetryable?: (error: Error) => boolean;
	/** Callback for retry attempts */
	onRetry?: (attempt: number, delay: number, error: Error) => void;
}

/**
 * Retry attempt information
 */
export interface RetryAttempt {
	/** Current attempt number (0-indexed) */
	attemptNumber: number;
	/** Total attempts made so far */
	totalAttempts: number;
	/** Maximum attempts allowed */
	maxAttempts: number;
	/** Delay before this attempt in ms */
	delay: number;
	/** Error that triggered this retry */
	error: Error;
	/** Timestamp of this attempt */
	timestamp: Date;
}

/**
 * Retry result
 */
export interface RetryResult<T> {
	/** The result value if successful */
	value?: T;
	/** The error if all retries failed */
	error?: Error;
	/** Whether the operation succeeded */
	success: boolean;
	/** Total number of attempts made */
	attempts: number;
	/** Total time spent retrying in ms */
	totalTime: number;
	/** List of all retry attempts */
	retryAttempts: RetryAttempt[];
}

/**
 * Backoff strategy
 */
export enum BackoffStrategy {
	/** Exponential backoff: delay = baseDelay * 2^attempt */
	EXPONENTIAL = 'exponential',
	/** Linear backoff: delay = baseDelay * attempt */
	LINEAR = 'linear',
	/** Fixed backoff: delay = baseDelay */
	FIXED = 'fixed',
}

/**
 * Backoff calculation result
 */
export interface BackoffDelay {
	/** Base delay before jitter */
	baseDelay: number;
	/** Jitter amount added */
	jitter: number;
	/** Total delay (baseDelay + jitter) */
	totalDelay: number;
	/** Current attempt number */
	attempt: number;
}
