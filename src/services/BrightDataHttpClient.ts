/**
 * BrightData HTTP Client with interceptors and rate limiting
 */

import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import type {
	HttpClientConfig,
	HttpRequestConfig,
	HttpResponse,
	RateLimitInfo,
	RequestMetadata,
	ResponseMetadata,
} from '@/types/brightdata';
import {
	HttpError,
	NetworkError,
	TimeoutError,
	RateLimitError,
	AuthenticationError,
	InvalidRequestError,
	ServerError,
	BrightDataError,
} from '@/types/errors/http-errors';
import type { IService } from './base/IService';

/**
 * Generate unique request ID for tracing
 */
function generateRequestId(): string {
	return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Extract rate limit information from response headers
 */
function extractRateLimitInfo(headers: Record<string, string>): RateLimitInfo | undefined {
	const limit = headers['x-ratelimit-limit'];
	const remaining = headers['x-ratelimit-remaining'];
	const reset = headers['x-ratelimit-reset'];
	const retryAfter = headers['retry-after'];

	if (!limit && !remaining && !reset) {
		return undefined;
	}

	return {
		limit: limit ? parseInt(limit, 10) : 0,
		remaining: remaining ? parseInt(remaining, 10) : 0,
		reset: reset ? new Date(parseInt(reset, 10) * 1000) : new Date(),
		retryAfter: retryAfter ? parseInt(retryAfter, 10) : undefined,
	};
}

/**
 * Transform axios error to standardized HttpError
 */
function transformAxiosError(error: unknown): HttpError {
	// Type guard for axios errors
	if (axios.isAxiosError(error)) {
		const request: HttpRequestConfig | undefined = error.config
			? {
					method: (error.config.method?.toUpperCase() as HttpRequestConfig['method']) ?? 'GET',
					url: error.config.url ?? '',
					headers: error.config.headers as Record<string, string>,
					params: error.config.params,
					data: error.config.data,
					timeout: error.config.timeout,
			  }
			: undefined;

		const response: HttpResponse | undefined = error.response
			? {
					data: error.response.data,
					status: error.response.status,
					statusText: error.response.statusText,
					headers: error.response.headers as Record<string, string>,
					config: request!,
					duration: 0,
			  }
			: undefined;

		// Network errors
		if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
			return new TimeoutError(
				error.message || 'Request timeout',
				request
			);
		}

		if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
			return new NetworkError(
				error.message || 'Network error',
				request,
				error
			);
		}

		// HTTP status code errors
		if (error.response) {
			const status = error.response.status;

			// Rate limit errors
			if (status === 429) {
				const rateLimitInfo = extractRateLimitInfo(error.response.headers as Record<string, string>);
				return new RateLimitError(
					error.response.data?.message || 'Rate limit exceeded',
					{
						statusCode: status,
						request,
						response,
						retryAfter: rateLimitInfo?.retryAfter,
						limit: rateLimitInfo?.limit,
						remaining: rateLimitInfo?.remaining,
					}
				);
			}

			// Authentication errors
			if (status === 401 || status === 403) {
				return new AuthenticationError(
					error.response.data?.message || 'Authentication failed',
					status,
					request,
					response
				);
			}

			// Invalid request errors
			if (status === 400 || status === 422) {
				return new InvalidRequestError(
					error.response.data?.message || 'Invalid request',
					status,
					{
						request,
						response,
						validationErrors: error.response.data?.errors,
					}
				);
			}

			// Server errors
			if (status >= 500 && status <= 599) {
				return new ServerError(
					error.response.data?.message || 'Server error',
					status,
					request,
					response
				);
			}

			// Generic HTTP error
			return new HttpError(
				error.response.data?.message || error.message || 'HTTP error',
				`HTTP_${status}`,
				{
					statusCode: status,
					request,
					response,
					isRetryable: status >= 500,
				}
			);
		}

		// Request was made but no response received
		return new NetworkError(
			error.message || 'Network error occurred',
			request,
			error
		);
	}

	// Non-axios errors
	if (error instanceof Error) {
		return new HttpError(
			error.message,
			'UNKNOWN_ERROR',
			{
				isRetryable: false,
				cause: error,
			}
		);
	}

	// Unknown error type
	return new HttpError(
		'An unknown error occurred',
		'UNKNOWN_ERROR',
		{
			isRetryable: false,
		}
	);
}

/**
 * BrightData HTTP Client
 * Provides HTTP communication with BrightData API including interceptors,
 * rate limiting, error handling, and request tracing
 */
export class BrightDataHttpClient implements IService {
	private readonly axios: AxiosInstance;
	private readonly config: HttpClientConfig;
	private readonly requestMetadataMap: Map<string, RequestMetadata>;

	constructor(config: HttpClientConfig) {
		this.config = config;
		this.requestMetadataMap = new Map();

		// Create axios instance with base configuration
		this.axios = axios.create({
			baseURL: config.baseURL,
			timeout: config.timeout,
			headers: {
				'Content-Type': 'application/json',
				'User-Agent': 'ObsidianSocialArchiver/1.0',
				...config.headers,
			},
		});

		// Setup interceptors
		this.setupRequestInterceptor();
		this.setupResponseInterceptor();
	}

	/**
	 * IService implementation
	 */
	public getName(): string {
		return 'BrightDataHttpClient';
	}

	public async initialize(): Promise<void> {
		// Verify API key is configured
		if (!this.config.apiKey) {
			throw new BrightDataError(
				'API key is required',
				'MISSING_API_KEY',
				{ isRetryable: false }
			);
		}
	}

	public async shutdown(): Promise<void> {
		// Clear any pending requests
		this.requestMetadataMap.clear();
	}

	/**
	 * Setup request interceptor
	 * Adds authentication, correlation IDs, timestamps, and request tracing
	 */
	private setupRequestInterceptor(): void {
		this.axios.interceptors.request.use(
			(config) => {
				const requestId = generateRequestId();
				const timestamp = new Date();

				// Add authentication header
				config.headers = config.headers ?? {};
				config.headers['Authorization'] = `Bearer ${this.config.apiKey}`;

				// Add request ID for tracing
				config.headers['X-Request-ID'] = requestId;

				// Add correlation ID if provided in custom headers
				const correlationId = config.headers['X-Correlation-ID'] as string | undefined;

				// Store request metadata for response logging
				const metadata: RequestMetadata = {
					requestId,
					correlationId,
					timestamp,
					url: config.url ?? '',
					method: config.method?.toUpperCase() ?? 'GET',
				};

				this.requestMetadataMap.set(requestId, metadata);

				// Log request (can be extended with proper logger)
				this.logRequest(metadata, config);

				return config;
			},
			(error) => {
				return Promise.reject(transformAxiosError(error));
			}
		);
	}

	/**
	 * Setup response interceptor
	 * Logs response times, extracts rate limit headers, transforms errors
	 */
	private setupResponseInterceptor(): void {
		this.axios.interceptors.response.use(
			(response: AxiosResponse) => {
				const requestId = response.config.headers?.['X-Request-ID'] as string;
				const requestMetadata = this.requestMetadataMap.get(requestId);

				if (requestMetadata) {
					const duration = Date.now() - requestMetadata.timestamp.getTime();
					const rateLimit = extractRateLimitInfo(response.headers as Record<string, string>);

					const responseMetadata: ResponseMetadata = {
						...requestMetadata,
						status: response.status,
						duration,
						rateLimit,
					};

					// Log response
					this.logResponse(responseMetadata, response);

					// Cleanup metadata
					this.requestMetadataMap.delete(requestId);

					// Attach metadata to response for caller access
					(response as any).metadata = responseMetadata;
				}

				return response;
			},
			(error) => {
				const requestId = error.config?.headers?.['X-Request-ID'] as string;
				if (requestId) {
					this.requestMetadataMap.delete(requestId);
				}

				const transformedError = transformAxiosError(error);

				// Log error
				this.logError(transformedError);

				return Promise.reject(transformedError);
			}
		);
	}

	/**
	 * Make HTTP request
	 */
	public async request<T = unknown>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
		try {
			const axiosConfig: AxiosRequestConfig = {
				method: config.method,
				url: config.url,
				headers: config.headers,
				params: config.params,
				data: config.data,
				timeout: config.timeout ?? this.config.timeout,
				signal: config.signal,
			};

			const response = await this.axios.request<T>(axiosConfig);

			return {
				data: response.data,
				status: response.status,
				statusText: response.statusText,
				headers: response.headers as Record<string, string>,
				config,
				duration: (response as any).metadata?.duration ?? 0,
			};
		} catch (error) {
			throw transformAxiosError(error);
		}
	}

	/**
	 * Convenience method for GET requests
	 */
	public async get<T = unknown>(
		url: string,
		config?: Partial<HttpRequestConfig>
	): Promise<HttpResponse<T>> {
		return this.request<T>({
			method: 'GET',
			url,
			...config,
		});
	}

	/**
	 * Convenience method for POST requests
	 */
	public async post<T = unknown>(
		url: string,
		data?: unknown,
		config?: Partial<HttpRequestConfig>
	): Promise<HttpResponse<T>> {
		return this.request<T>({
			method: 'POST',
			url,
			data,
			...config,
		});
	}

	/**
	 * Convenience method for PUT requests
	 */
	public async put<T = unknown>(
		url: string,
		data?: unknown,
		config?: Partial<HttpRequestConfig>
	): Promise<HttpResponse<T>> {
		return this.request<T>({
			method: 'PUT',
			url,
			data,
			...config,
		});
	}

	/**
	 * Convenience method for DELETE requests
	 */
	public async delete<T = unknown>(
		url: string,
		config?: Partial<HttpRequestConfig>
	): Promise<HttpResponse<T>> {
		return this.request<T>({
			method: 'DELETE',
			url,
			...config,
		});
	}

	/**
	 * Log request (placeholder for proper logging implementation)
	 */
	private logRequest(metadata: RequestMetadata, _config: AxiosRequestConfig): void {
		if (process.env.NODE_ENV === 'development') {
			// Request logging removed
		}
	}

	/**
	 * Log response (placeholder for proper logging implementation)
	 */
	private logResponse(metadata: ResponseMetadata, _response: AxiosResponse): void {
		if (process.env.NODE_ENV === 'development') {
			// Response logging removed
		}
	}

	/**
	 * Log error (placeholder for proper logging implementation)
	 */
	private logError(error: HttpError): void {
		if (process.env.NODE_ENV === 'development') {
			// Error logging removed
		}
	}
}
