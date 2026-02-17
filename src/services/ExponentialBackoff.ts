/**
 * Exponential Backoff with Jitter
 * Implements retry mechanism with exponential backoff to handle transient failures
 */

import type {
	RetryConfig,
	RetryAttempt,
	RetryResult,
	BackoffStrategy,
	BackoffDelay,
} from '@/types/retry';
import { BackoffStrategy as Strategy } from '@/types/retry';
import { isRetryableError } from '@/types/errors/http-errors';
import { CircuitBreakerOpenError } from '@/types/circuit-breaker';

/**
 * Default retry configuration
 */
const DEFAULT_CONFIG: RetryConfig = {
	maxAttempts: 3,
	baseDelay: 1000, // 1 second
	maxDelay: 32000, // 32 seconds
	jitterRange: 1000, // 1 second
	isRetryable: isRetryableError,
};

/**
 * Exponential Backoff
 * Provides retry logic with exponential backoff and jitter
 */
export class ExponentialBackoff {
	private readonly config: RetryConfig;
	private readonly strategy: BackoffStrategy;

	constructor(config?: Partial<RetryConfig>, strategy: BackoffStrategy = Strategy.EXPONENTIAL) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.strategy = strategy;
	}

	/**
	 * Execute function with retry logic
	 */
	public async execute<T>(
		fn: () => Promise<T>,
		abortSignal?: AbortSignal
	): Promise<RetryResult<T>> {
		const retryAttempts: RetryAttempt[] = [];
		const startTime = Date.now();
		let lastError: Error | undefined;

		for (let attempt = 0; attempt <= this.config.maxAttempts; attempt++) {
			// Check if aborted
			if (abortSignal?.aborted) {
				return {
					success: false,
					error: new Error('Operation aborted'),
					attempts: attempt,
					totalTime: Date.now() - startTime,
					retryAttempts,
				};
			}

			try {
				// First attempt or retry
				const result = await fn();

				return {
					success: true,
					value: result,
					attempts: attempt + 1,
					totalTime: Date.now() - startTime,
					retryAttempts,
				};
			} catch (error) {
				lastError = error as Error;

				// Don't retry if circuit breaker is open
				if (error instanceof CircuitBreakerOpenError) {
					return {
						success: false,
						error: lastError,
						attempts: attempt + 1,
						totalTime: Date.now() - startTime,
						retryAttempts,
					};
				}

				// Check if error is retryable
				const shouldRetry = this.config.isRetryable?.(lastError) ?? isRetryableError(lastError);

				// If this is the last attempt or error is not retryable, fail
				if (attempt >= this.config.maxAttempts || !shouldRetry) {
					return {
						success: false,
						error: lastError,
						attempts: attempt + 1,
						totalTime: Date.now() - startTime,
						retryAttempts,
					};
				}

				// Calculate delay for next retry
				const backoffDelay = this.calculateDelay(attempt + 1);
				const delay = backoffDelay.totalDelay;

				// Record retry attempt
				const retryAttempt: RetryAttempt = {
					attemptNumber: attempt,
					totalAttempts: attempt + 1,
					maxAttempts: this.config.maxAttempts,
					delay,
					error: lastError,
					timestamp: new Date(),
				};

				retryAttempts.push(retryAttempt);

				// Call onRetry callback
				if (this.config.onRetry) {
					this.config.onRetry(attempt + 1, delay, lastError);
				}

				// Log retry attempt
				this.logRetryAttempt(retryAttempt);

				// Wait before retrying
				await this.sleep(delay, abortSignal);
			}
		}

		// Should never reach here, but TypeScript needs it
		return {
			success: false,
			error: lastError ?? new Error('Unknown error'),
			attempts: this.config.maxAttempts + 1,
			totalTime: Date.now() - startTime,
			retryAttempts,
		};
	}

	/**
	 * Calculate delay with exponential backoff and jitter
	 */
	public calculateDelay(attempt: number): BackoffDelay {
		let baseDelay: number;

		switch (this.strategy) {
			case Strategy.EXPONENTIAL:
				// Exponential: baseDelay * 2^attempt
				baseDelay = this.config.baseDelay * Math.pow(2, attempt - 1);
				break;

			case Strategy.LINEAR:
				// Linear: baseDelay * attempt
				baseDelay = this.config.baseDelay * attempt;
				break;

			case Strategy.FIXED:
				// Fixed: always baseDelay
				baseDelay = this.config.baseDelay;
				break;

			default:
				baseDelay = this.config.baseDelay;
		}

		// Cap at maxDelay
		baseDelay = Math.min(baseDelay, this.config.maxDelay);

		// Add jitter: random value between 0 and jitterRange
		const jitter = Math.random() * this.config.jitterRange;

		const totalDelay = baseDelay + jitter;

		return {
			baseDelay,
			jitter,
			totalDelay,
			attempt,
		};
	}

	/**
	 * Sleep for specified duration with abort support
	 */
	private sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			if (abortSignal?.aborted) {
				reject(new Error('Operation aborted'));
				return;
			}

			let abortHandler: (() => void) | undefined;

			const timeout = setTimeout(() => {
				// Clean up abort listener when timeout resolves naturally
				if (abortSignal && abortHandler) {
					abortSignal.removeEventListener('abort', abortHandler);
				}
				resolve();
			}, ms);

			// Handle abort during sleep
			if (abortSignal) {
				abortHandler = () => {
					clearTimeout(timeout);
					reject(new Error('Operation aborted'));
				};

				abortSignal.addEventListener('abort', abortHandler, { once: true });
			}
		});
	}

	/**
	 * Log retry attempt
	 */
	private logRetryAttempt(_attempt: RetryAttempt): void {
		if (process.env.NODE_ENV === 'development') {
			// Logging removed
		}
	}

	/**
	 * Get configuration
	 */
	public getConfig(): RetryConfig {
		return { ...this.config };
	}

	/**
	 * Get strategy
	 */
	public getStrategy(): BackoffStrategy {
		return this.strategy;
	}
}

/**
 * Helper function to create exponential backoff with custom config
 */
export function createExponentialBackoff(
	config?: Partial<RetryConfig>
): ExponentialBackoff {
	return new ExponentialBackoff(config, Strategy.EXPONENTIAL);
}

/**
 * Helper function to create linear backoff
 */
export function createLinearBackoff(
	config?: Partial<RetryConfig>
): ExponentialBackoff {
	return new ExponentialBackoff(config, Strategy.LINEAR);
}

/**
 * Helper function to create fixed backoff
 */
export function createFixedBackoff(
	config?: Partial<RetryConfig>
): ExponentialBackoff {
	return new ExponentialBackoff(config, Strategy.FIXED);
}
