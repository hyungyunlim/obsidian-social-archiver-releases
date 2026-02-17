/**
 * Retryable HTTP Client
 * Combines ResilientHttpClient with ExponentialBackoff for automatic retries
 */

import { ResilientHttpClient, type ResilientHttpClientConfig } from './ResilientHttpClient';
import { ExponentialBackoff } from './ExponentialBackoff';
import type { HttpRequestConfig, HttpResponse } from '@/types/brightdata';
import type { RetryConfig } from '@/types/retry';
import type { IService } from './base/IService';

/**
 * Configuration for retryable HTTP client
 */
export interface RetryableHttpClientConfig extends ResilientHttpClientConfig {
	retry?: Partial<RetryConfig>;
}

/**
 * Retryable HTTP Client
 * Provides HTTP client with circuit breaker and automatic retries
 */
export class RetryableHttpClient implements IService {
	private readonly resilientClient: ResilientHttpClient;
	private readonly backoff: ExponentialBackoff;
	// Reserved for future use
	// private readonly _config: RetryableHttpClientConfig;

	constructor(config: RetryableHttpClientConfig) {
		// this._config = config;

		// Initialize resilient HTTP client (with circuit breaker)
		this.resilientClient = new ResilientHttpClient(config);

		// Initialize exponential backoff
		this.backoff = new ExponentialBackoff({
			maxAttempts: 3,
			baseDelay: 1000,
			maxDelay: 32000,
			jitterRange: 1000,
			...config.retry,
			onRetry: (attempt, delay, error) => {
				if (process.env.NODE_ENV === 'development') {
					// Logging removed
				}

				// Call custom onRetry if provided
				if (config.retry?.onRetry) {
					config.retry.onRetry(attempt, delay, error);
				}
			},
		});
	}

	/**
	 * IService implementation
	 */
	public getName(): string {
		return 'RetryableHttpClient';
	}

	public initialize(): void {
		this.resilientClient.initialize();
	}

	public shutdown(): void {
		this.resilientClient.shutdown();
	}

	/**
	 * Make HTTP request with retry logic
	 */
	public async request<T = unknown>(
		config: HttpRequestConfig
	): Promise<HttpResponse<T>> {
		const result = await this.backoff.execute(
			async () => {
				return this.resilientClient.request<T>(config);
			},
			config.signal
		);

		if (!result.success) {
			throw result.error;
		}

		return result.value as HttpResponse<T>;
	}

	/**
	 * GET request with retry logic
	 */
	public async get<T = unknown>(
		url: string,
		config?: Partial<HttpRequestConfig>
	): Promise<HttpResponse<T>> {
		const result = await this.backoff.execute(
			async () => {
				return this.resilientClient.get<T>(url, config);
			},
			config?.signal
		);

		if (!result.success) {
			throw result.error;
		}

		return result.value as HttpResponse<T>;
	}

	/**
	 * POST request with retry logic
	 */
	public async post<T = unknown>(
		url: string,
		data?: unknown,
		config?: Partial<HttpRequestConfig>
	): Promise<HttpResponse<T>> {
		const result = await this.backoff.execute(
			async () => {
				return this.resilientClient.post<T>(url, data, config);
			},
			config?.signal
		);

		if (!result.success) {
			throw result.error;
		}

		return result.value as HttpResponse<T>;
	}

	/**
	 * PUT request with retry logic
	 */
	public async put<T = unknown>(
		url: string,
		data?: unknown,
		config?: Partial<HttpRequestConfig>
	): Promise<HttpResponse<T>> {
		const result = await this.backoff.execute(
			async () => {
				return this.resilientClient.put<T>(url, data, config);
			},
			config?.signal
		);

		if (!result.success) {
			throw result.error;
		}

		return result.value as HttpResponse<T>;
	}

	/**
	 * DELETE request with retry logic
	 */
	public async delete<T = unknown>(
		url: string,
		config?: Partial<HttpRequestConfig>
	): Promise<HttpResponse<T>> {
		const result = await this.backoff.execute(
			async () => {
				return this.resilientClient.delete<T>(url, config);
			},
			config?.signal
		);

		if (!result.success) {
			throw result.error;
		}

		return result.value as HttpResponse<T>;
	}

	/**
	 * Get underlying resilient client (with circuit breaker)
	 */
	public getResilientClient(): ResilientHttpClient {
		return this.resilientClient;
	}

	/**
	 * Get exponential backoff instance
	 */
	public getBackoff(): ExponentialBackoff {
		return this.backoff;
	}

	/**
	 * Get circuit breaker from resilient client
	 */
	public getCircuitBreaker() {
		return this.resilientClient.getCircuitBreaker();
	}

	/**
	 * Check if circuit is open
	 */
	public isCircuitOpen(): boolean {
		return this.resilientClient.isCircuitOpen();
	}

	/**
	 * Get circuit breaker metrics
	 */
	public getCircuitMetrics() {
		return this.resilientClient.getCircuitMetrics();
	}

	/**
	 * Reset circuit breaker
	 */
	public resetCircuit(): void {
		this.resilientClient.resetCircuit();
	}
}
