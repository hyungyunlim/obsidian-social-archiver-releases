/**
 * BrightData HTTP Client with interceptors and rate limiting
 * Uses Obsidian's requestUrl for all network requests (required for Obsidian plugin compatibility)
 */

import { requestUrl } from 'obsidian';
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
 * Build URL with query parameters
 */
function buildUrlWithParams(url: string, params?: Record<string, string | number | boolean>): string {
	if (!params || Object.keys(params).length === 0) {
		return url;
	}
	const searchParams = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		searchParams.append(key, String(value));
	}
	const separator = url.includes('?') ? '&' : '?';
	return `${url}${separator}${searchParams.toString()}`;
}

/**
 * Transform a raw HTTP error into a standardized HttpError
 */
function transformHttpError(
	status: number,
	headers: Record<string, string>,
	data: unknown,
	requestConfig?: HttpRequestConfig
): HttpError {
	const message = (data as Record<string, unknown>)?.['message'] as string || `HTTP ${status} error`;

	// Rate limit errors
	if (status === 429) {
		const rateLimitInfo = extractRateLimitInfo(headers);
		return new RateLimitError(
			message || 'Rate limit exceeded',
			{
				statusCode: status,
				request: requestConfig,
				retryAfter: rateLimitInfo?.retryAfter,
				limit: rateLimitInfo?.limit,
				remaining: rateLimitInfo?.remaining,
			}
		);
	}

	// Authentication errors
	if (status === 401 || status === 403) {
		return new AuthenticationError(
			message || 'Authentication failed',
			status,
			requestConfig
		);
	}

	// Invalid request errors
	if (status === 400 || status === 422) {
		return new InvalidRequestError(
			message || 'Invalid request',
			status,
			{
				request: requestConfig,
				validationErrors: (data as Record<string, unknown>)?.['errors'] as string[] | undefined,
			}
		);
	}

	// Server errors
	if (status >= 500 && status <= 599) {
		return new ServerError(
			message || 'Server error',
			status,
			requestConfig
		);
	}

	// Generic HTTP error
	return new HttpError(
		message || 'HTTP error',
		`HTTP_${status}`,
		{
			statusCode: status,
			request: requestConfig,
			isRetryable: status >= 500,
		}
	);
}

/**
 * BrightData HTTP Client
 * Provides HTTP communication with BrightData API including interceptors,
 * rate limiting, error handling, and request tracing.
 * Uses Obsidian's requestUrl API instead of axios for plugin compliance.
 */
export class BrightDataHttpClient implements IService {
	private readonly config: HttpClientConfig;
	private readonly requestMetadataMap: Map<string, RequestMetadata>;

	constructor(config: HttpClientConfig) {
		this.config = config;
		this.requestMetadataMap = new Map();
	}

	/**
	 * IService implementation
	 */
	public getName(): string {
		return 'BrightDataHttpClient';
	}

	public initialize(): void {
		// Verify API key is configured
		if (!this.config.apiKey) {
			throw new BrightDataError(
				'API key is required',
				'MISSING_API_KEY',
				{ isRetryable: false }
			);
		}
	}

	public shutdown(): void {
		// Clear any pending requests
		this.requestMetadataMap.clear();
	}

	/**
	 * Make HTTP request using Obsidian's requestUrl
	 */
	public async request<T = unknown>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
		const requestId = generateRequestId();
		const timestamp = new Date();

		// Check for abort signal
		if (config.signal?.aborted) {
			throw new Error('Request was aborted');
		}

		// Build full URL with base and query params
		const fullUrl = buildUrlWithParams(
			config.url.startsWith('http') ? config.url : `${this.config.baseURL}${config.url}`,
			config.params
		);

		// Build merged headers (base + auth + request-specific)
		const mergedHeaders: Record<string, string> = {
			'Content-Type': 'application/json',
			'User-Agent': 'ObsidianSocialArchiver/1.0',
			...this.config.headers,
			'Authorization': `Bearer ${this.config.apiKey}`,
			'X-Request-ID': requestId,
			...config.headers,
		};

		// Store request metadata for tracing
		const metadata: RequestMetadata = {
			requestId,
			correlationId: mergedHeaders['X-Correlation-ID'],
			timestamp,
			url: fullUrl,
			method: config.method,
		};
		this.requestMetadataMap.set(requestId, metadata);

		// Serialize body
		let body: string | undefined;
		if (config.data !== undefined && config.data !== null) {
			body = typeof config.data === 'string' ? config.data : JSON.stringify(config.data);
		}

		try {
			const response = await requestUrl({
				url: fullUrl,
				method: config.method,
				headers: mergedHeaders,
				body,
				throw: false,
			});

			// Calculate duration
			const duration = Date.now() - timestamp.getTime();
			const rateLimit = extractRateLimitInfo(response.headers);

			const responseMetadata: ResponseMetadata = {
				...metadata,
				status: response.status,
				duration,
				rateLimit,
			};

			this.requestMetadataMap.delete(requestId);

			// Handle HTTP error status codes
			if (response.status >= 400) {
				let data: unknown;
				try {
					data = response.json;
				} catch {
					data = { message: response.text };
				}
				throw transformHttpError(response.status, response.headers, data, config);
			}

			// Parse response data
			let data: T;
			try {
				data = response.json as T;
			} catch {
				data = response.text as unknown as T;
			}

			return {
				data,
				status: response.status,
				statusText: String(response.status),
				headers: response.headers,
				config,
				duration: responseMetadata.duration,
			};
		} catch (error) {
			this.requestMetadataMap.delete(requestId);

			// Re-throw HttpError subclasses as-is
			if (error instanceof HttpError) {
				throw error;
			}

			// Network/timeout errors
			if (error instanceof Error) {
				const message = error.message.toLowerCase();
				if (message.includes('timeout') || message.includes('etimedout') || message.includes('econnaborted')) {
					throw new TimeoutError(error.message, config);
				}
				if (
					message.includes('network') ||
					message.includes('enotfound') ||
					message.includes('econnrefused') ||
					message.includes('econnreset') ||
					message.includes('fetch')
				) {
					throw new NetworkError(error.message, config, error);
				}
				throw new NetworkError(error.message, config, error);
			}

			throw new HttpError(
				'An unknown error occurred',
				'UNKNOWN_ERROR',
				{ isRetryable: false }
			);
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
}
