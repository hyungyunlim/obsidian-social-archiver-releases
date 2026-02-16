/**
 * BrightData API Integration Types
 */

import type { Platform } from './post';

/**
 * HTTP request configuration
 */
export interface HttpRequestConfig {
	method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
	url: string;
	headers?: Record<string, string>;
	params?: Record<string, string | number | boolean>;
	data?: unknown;
	timeout?: number;
	signal?: AbortSignal;
}

/**
 * HTTP response structure
 */
export interface HttpResponse<T = unknown> {
	data: T;
	status: number;
	statusText: string;
	headers: Record<string, string>;
	config: HttpRequestConfig;
	duration: number;
}

/**
 * Rate limit information from response headers
 */
export interface RateLimitInfo {
	limit: number;
	remaining: number;
	reset: Date;
	retryAfter?: number;
}

/**
 * Request metadata for logging and tracing
 */
export interface RequestMetadata {
	requestId: string;
	correlationId?: string;
	timestamp: Date;
	platform?: Platform;
	url: string;
	method: string;
}

/**
 * Response metadata for logging and metrics
 */
export interface ResponseMetadata extends RequestMetadata {
	status: number;
	duration: number;
	cacheHit?: boolean;
	creditsConsumed?: number;
	rateLimit?: RateLimitInfo;
}

/**
 * HTTP client configuration
 */
export interface HttpClientConfig {
	baseURL: string;
	timeout: number;
	apiKey: string;
	headers?: Record<string, string>;
	maxRetries?: number;
	retryDelay?: number;
}

/**
 * Request interceptor function type
 */
export type RequestInterceptor = (
	config: HttpRequestConfig
) => HttpRequestConfig | Promise<HttpRequestConfig>;

/**
 * Response interceptor function type
 */
export type ResponseInterceptor = <T>(
	response: HttpResponse<T>
) => HttpResponse<T> | Promise<HttpResponse<T>>;

/**
 * Error interceptor function type
 */
export type ErrorInterceptor = (error: unknown) => Promise<never>;

/**
 * Interceptor manager
 */
export interface InterceptorManager {
	request: {
		use: (interceptor: RequestInterceptor) => number;
		eject: (id: number) => void;
	};
	response: {
		use: (
			onFulfilled?: ResponseInterceptor,
			onRejected?: ErrorInterceptor
		) => number;
		eject: (id: number) => void;
	};
}
