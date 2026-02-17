/**
 * Resilient HTTP Client with Circuit Breaker
 * Wraps BrightDataHttpClient with circuit breaker protection
 */

import { BrightDataHttpClient } from './BrightDataHttpClient';
import { CircuitBreaker } from './CircuitBreaker';
import type { HttpClientConfig, HttpRequestConfig, HttpResponse } from '@/types/brightdata';
import type { CircuitBreakerConfig } from '@/types/circuit-breaker';
import { CircuitBreakerEvent } from '@/types/circuit-breaker';
import type { IService } from './base/IService';

/**
 * Configuration for resilient HTTP client
 */
export interface ResilientHttpClientConfig extends HttpClientConfig {
	circuitBreaker?: Partial<CircuitBreakerConfig>;
}

/**
 * Resilient HTTP Client
 * Combines BrightDataHttpClient with CircuitBreaker for fault tolerance
 */
export class ResilientHttpClient implements IService {
	private readonly httpClient: BrightDataHttpClient;
	private readonly circuitBreaker: CircuitBreaker;
	// Reserved for future use
	// private readonly _config: ResilientHttpClientConfig;

	constructor(config: ResilientHttpClientConfig) {
		// this._config = config;

		// Initialize HTTP client
		this.httpClient = new BrightDataHttpClient(config);

		// Initialize circuit breaker
		this.circuitBreaker = new CircuitBreaker({
			name: `${config.baseURL}-circuit`,
			failureThreshold: 5,
			successThreshold: 3,
			timeout: 60000,
			...config.circuitBreaker,
		});

		// Setup circuit breaker event logging
		this.setupCircuitBreakerLogging();
	}

	/**
	 * Setup circuit breaker event logging
	 */
	private setupCircuitBreakerLogging(): void {
		this.circuitBreaker.on(CircuitBreakerEvent.OPEN, (_data) => {
			if (process.env.NODE_ENV === 'development') {
				// Logging removed
			}
		});

		this.circuitBreaker.on(CircuitBreakerEvent.HALF_OPEN, (_data) => {
			if (process.env.NODE_ENV === 'development') {
				// Logging removed
			}
		});

		this.circuitBreaker.on(CircuitBreakerEvent.CLOSE, (_data) => {
			if (process.env.NODE_ENV === 'development') {
				// Logging removed
			}
		});
	}

	/**
	 * IService implementation
	 */
	public getName(): string {
		return 'ResilientHttpClient';
	}

	public initialize(): void {
		this.httpClient.initialize();
	}

	public shutdown(): void {
		this.circuitBreaker.destroy();
		this.httpClient.shutdown();
	}

	/**
	 * Make HTTP request with circuit breaker protection
	 */
	public async request<T = unknown>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
		return this.circuitBreaker.execute(async () => {
			return this.httpClient.request<T>(config);
		});
	}

	/**
	 * GET request with circuit breaker protection
	 */
	public async get<T = unknown>(
		url: string,
		config?: Partial<HttpRequestConfig>
	): Promise<HttpResponse<T>> {
		return this.circuitBreaker.execute(async () => {
			return this.httpClient.get<T>(url, config);
		});
	}

	/**
	 * POST request with circuit breaker protection
	 */
	public async post<T = unknown>(
		url: string,
		data?: unknown,
		config?: Partial<HttpRequestConfig>
	): Promise<HttpResponse<T>> {
		return this.circuitBreaker.execute(async () => {
			return this.httpClient.post<T>(url, data, config);
		});
	}

	/**
	 * PUT request with circuit breaker protection
	 */
	public async put<T = unknown>(
		url: string,
		data?: unknown,
		config?: Partial<HttpRequestConfig>
	): Promise<HttpResponse<T>> {
		return this.circuitBreaker.execute(async () => {
			return this.httpClient.put<T>(url, data, config);
		});
	}

	/**
	 * DELETE request with circuit breaker protection
	 */
	public async delete<T = unknown>(
		url: string,
		config?: Partial<HttpRequestConfig>
	): Promise<HttpResponse<T>> {
		return this.circuitBreaker.execute(async () => {
			return this.httpClient.delete<T>(url, config);
		});
	}

	/**
	 * Get circuit breaker instance for monitoring
	 */
	public getCircuitBreaker(): CircuitBreaker {
		return this.circuitBreaker;
	}

	/**
	 * Get underlying HTTP client
	 */
	public getHttpClient(): BrightDataHttpClient {
		return this.httpClient;
	}

	/**
	 * Check if circuit is open
	 */
	public isCircuitOpen(): boolean {
		return this.circuitBreaker.isOpen();
	}

	/**
	 * Get circuit breaker metrics
	 */
	public getCircuitMetrics() {
		return this.circuitBreaker.getMetrics();
	}

	/**
	 * Manually reset circuit breaker
	 */
	public resetCircuit(): void {
		this.circuitBreaker.reset();
	}
}
