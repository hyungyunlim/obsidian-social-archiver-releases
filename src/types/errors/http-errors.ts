/**
 * HTTP and BrightData-specific error types
 */

import type { HttpRequestConfig, HttpResponse } from '../brightdata';

/**
 * Base HTTP error class
 */
export class HttpError extends Error {
	public readonly code: string;
	public readonly statusCode?: number;
	public readonly request?: HttpRequestConfig;
	public readonly response?: HttpResponse;
	public readonly isRetryable: boolean;

	constructor(
		message: string,
		code: string,
		options: {
			statusCode?: number;
			request?: HttpRequestConfig;
			response?: HttpResponse;
			isRetryable?: boolean;
			cause?: Error;
		} = {}
	) {
		super(message);
		this.name = 'HttpError';
		this.code = code;
		this.statusCode = options.statusCode;
		this.request = options.request;
		this.response = options.response;
		this.isRetryable = options.isRetryable ?? false;

		if (options.cause) {
			this.cause = options.cause;
		}

		// Maintains proper stack trace for where error was thrown (V8 only)
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, this.constructor);
		}
	}

	toJSON(): Record<string, any> {
		return {
			name: this.name,
			message: this.message,
			code: this.code,
			statusCode: this.statusCode,
			isRetryable: this.isRetryable,
		};
	}
}

/**
 * Network-related errors (connection, DNS, etc.)
 */
export class NetworkError extends HttpError {
	constructor(message: string, request?: HttpRequestConfig, cause?: Error) {
		super(message, 'NETWORK_ERROR', {
			request,
			isRetryable: true,
			cause,
		});
		this.name = 'NetworkError';
	}
}

/**
 * Request timeout error
 */
export class TimeoutError extends HttpError {
	constructor(message: string, request?: HttpRequestConfig) {
		super(message, 'TIMEOUT_ERROR', {
			request,
			isRetryable: true,
		});
		this.name = 'TimeoutError';
	}
}

/**
 * Rate limit exceeded error (429)
 */
export class RateLimitError extends HttpError {
	public readonly retryAfter?: number;
	public readonly limit?: number;
	public readonly remaining?: number;

	constructor(
		message: string,
		options: {
			statusCode?: number;
			request?: HttpRequestConfig;
			response?: HttpResponse;
			retryAfter?: number;
			limit?: number;
			remaining?: number;
		}
	) {
		super(message, 'RATE_LIMIT_ERROR', {
			statusCode: options.statusCode ?? 429,
			request: options.request,
			response: options.response,
			isRetryable: true,
		});
		this.name = 'RateLimitError';
		this.retryAfter = options.retryAfter;
		this.limit = options.limit;
		this.remaining = options.remaining;
	}

	override toJSON(): Record<string, any> {
		return {
			...super.toJSON(),
			retryAfter: this.retryAfter,
			limit: this.limit,
			remaining: this.remaining,
		};
	}
}

/**
 * Authentication/Authorization errors (401, 403)
 */
export class AuthenticationError extends HttpError {
	constructor(
		message: string,
		statusCode: number,
		request?: HttpRequestConfig,
		response?: HttpResponse
	) {
		super(message, 'AUTHENTICATION_ERROR', {
			statusCode,
			request,
			response,
			isRetryable: false,
		});
		this.name = 'AuthenticationError';
	}
}

/**
 * Invalid request errors (400, 422)
 */
export class InvalidRequestError extends HttpError {
	public readonly validationErrors?: string[];

	constructor(
		message: string,
		statusCode: number,
		options: {
			request?: HttpRequestConfig;
			response?: HttpResponse;
			validationErrors?: string[];
		}
	) {
		super(message, 'INVALID_REQUEST_ERROR', {
			statusCode,
			request: options.request,
			response: options.response,
			isRetryable: false,
		});
		this.name = 'InvalidRequestError';
		this.validationErrors = options.validationErrors;
	}

	override toJSON(): Record<string, any> {
		return {
			...super.toJSON(),
			validationErrors: this.validationErrors,
		};
	}
}

/**
 * Server errors (500, 502, 503, 504)
 */
export class ServerError extends HttpError {
	constructor(
		message: string,
		statusCode: number,
		request?: HttpRequestConfig,
		response?: HttpResponse
	) {
		super(message, 'SERVER_ERROR', {
			statusCode,
			request,
			response,
			isRetryable: true,
		});
		this.name = 'ServerError';
	}
}

/**
 * BrightData-specific errors
 */
export class BrightDataError extends HttpError {
	public readonly platform?: string;
	public readonly userMessage: string;
	public recoverySuggestions: RecoverySuggestion[];

	constructor(
		message: string,
		code: string,
		options: {
			statusCode?: number;
			request?: HttpRequestConfig;
			response?: HttpResponse;
			isRetryable?: boolean;
			platform?: string;
			userMessage?: string;
			recoverySuggestions?: RecoverySuggestion[];
		}
	) {
		super(message, `BRIGHTDATA_${code}`, {
			...options,
		});
		this.name = 'BrightDataError';
		this.platform = options.platform;
		this.userMessage = options.userMessage || message;
		this.recoverySuggestions = options.recoverySuggestions || [];
	}

	override toJSON(): Record<string, any> {
		return {
			...super.toJSON(),
			platform: this.platform,
			userMessage: this.userMessage,
			recoverySuggestions: this.recoverySuggestions,
		};
	}

	/**
	 * Get user-friendly error message with recovery suggestions
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
 * Recovery suggestion for error handling
 */
export interface RecoverySuggestion {
	action: string;
	description: string;
	autoRecoverable: boolean;
}

/**
 * Platform-specific errors for social media platforms
 */

/**
 * Facebook-specific errors
 */
export class FacebookError extends BrightDataError {
	constructor(
		message: string,
		options: {
			statusCode?: number;
			request?: HttpRequestConfig;
			response?: HttpResponse;
			isRetryable?: boolean;
			userMessage?: string;
		}
	) {
		super(message, 'FACEBOOK_ERROR', {
			...options,
			platform: 'facebook',
		});
		this.name = 'FacebookError';
	}
}

/**
 * Facebook login required error
 */
export class FacebookLoginRequiredError extends FacebookError {
	constructor(request?: HttpRequestConfig, response?: HttpResponse) {
		super('Facebook login is required to access this content', {
			statusCode: 401,
			request,
			response,
			isRetryable: false,
			userMessage: 'This Facebook post requires you to be logged in. Please ensure the content is publicly accessible.',
		});
		this.name = 'FacebookLoginRequiredError';
		this.recoverySuggestions = [
			{
				action: 'check_privacy',
				description: 'Verify the post is set to "Public" privacy',
				autoRecoverable: false,
			},
			{
				action: 'use_direct_link',
				description: 'Try using the direct post link instead of a shared link',
				autoRecoverable: false,
			},
		];
	}
}

/**
 * Instagram-specific errors
 */
export class InstagramError extends BrightDataError {
	constructor(
		message: string,
		options: {
			statusCode?: number;
			request?: HttpRequestConfig;
			response?: HttpResponse;
			isRetryable?: boolean;
			userMessage?: string;
		}
	) {
		super(message, 'INSTAGRAM_ERROR', {
			...options,
			platform: 'instagram',
		});
		this.name = 'InstagramError';
	}
}

/**
 * Instagram private profile error
 */
export class InstagramPrivateProfileError extends InstagramError {
	constructor(request?: HttpRequestConfig, response?: HttpResponse) {
		super('Cannot access private Instagram profile', {
			statusCode: 403,
			request,
			response,
			isRetryable: false,
			userMessage: 'This Instagram account is private. Only public posts can be archived.',
		});
		this.name = 'InstagramPrivateProfileError';
		this.recoverySuggestions = [
			{
				action: 'request_access',
				description: 'Follow the account to request access',
				autoRecoverable: false,
			},
			{
				action: 'use_public_post',
				description: 'Archive posts from public accounts instead',
				autoRecoverable: false,
			},
		];
	}
}

/**
 * Instagram rate limit error
 */
export class InstagramRateLimitError extends InstagramError {
	public readonly retryAfter?: number;

	constructor(
		retryAfter?: number,
		request?: HttpRequestConfig,
		response?: HttpResponse
	) {
		const retryMessage = retryAfter
			? ` Please try again in ${Math.ceil(retryAfter / 1000)} seconds.`
			: ' Please try again later.';

		super(`Instagram rate limit exceeded.${retryMessage}`, {
			statusCode: 429,
			request,
			response,
			isRetryable: true,
			userMessage: `Instagram has rate limited your requests.${retryMessage}`,
		});
		this.name = 'InstagramRateLimitError';
		this.retryAfter = retryAfter;
		this.recoverySuggestions = [
			{
				action: 'wait',
				description: `Wait ${retryAfter ? Math.ceil(retryAfter / 1000) : 60} seconds before retrying`,
				autoRecoverable: true,
			},
			{
				action: 'reduce_frequency',
				description: 'Reduce the frequency of archive requests',
				autoRecoverable: false,
			},
		];
	}
}

/**
 * LinkedIn-specific errors
 */
export class LinkedInError extends BrightDataError {
	constructor(
		message: string,
		options: {
			statusCode?: number;
			request?: HttpRequestConfig;
			response?: HttpResponse;
			isRetryable?: boolean;
			userMessage?: string;
		}
	) {
		super(message, 'LINKEDIN_ERROR', {
			...options,
			platform: 'linkedin',
		});
		this.name = 'LinkedInError';
	}
}

/**
 * LinkedIn premium content error
 */
export class LinkedInPremiumContentError extends LinkedInError {
	constructor(request?: HttpRequestConfig, response?: HttpResponse) {
		super('LinkedIn premium content requires authentication', {
			statusCode: 403,
			request,
			response,
			isRetryable: false,
			userMessage: 'This LinkedIn content is only accessible to premium members or requires login.',
		});
		this.name = 'LinkedInPremiumContentError';
		this.recoverySuggestions = [
			{
				action: 'check_access',
				description: 'Verify you have access to view this content',
				autoRecoverable: false,
			},
			{
				action: 'use_public_post',
				description: 'Archive publicly accessible posts instead',
				autoRecoverable: false,
			},
		];
	}
}

/**
 * TikTok-specific errors
 */
export class TikTokError extends BrightDataError {
	constructor(
		message: string,
		options: {
			statusCode?: number;
			request?: HttpRequestConfig;
			response?: HttpResponse;
			isRetryable?: boolean;
			userMessage?: string;
		}
	) {
		super(message, 'TIKTOK_ERROR', {
			...options,
			platform: 'tiktok',
		});
		this.name = 'TikTokError';
	}
}

/**
 * TikTok video unavailable error
 */
export class TikTokVideoUnavailableError extends TikTokError {
	constructor(request?: HttpRequestConfig, response?: HttpResponse) {
		super('TikTok video is unavailable', {
			statusCode: 404,
			request,
			response,
			isRetryable: false,
			userMessage: 'This TikTok video has been removed, made private, or is unavailable in your region.',
		});
		this.name = 'TikTokVideoUnavailableError';
		this.recoverySuggestions = [
			{
				action: 'check_availability',
				description: 'Verify the video is still available on TikTok',
				autoRecoverable: false,
			},
			{
				action: 'check_region',
				description: 'The video may be region-locked',
				autoRecoverable: false,
			},
		];
	}
}

/**
 * X (Twitter) specific errors
 */
export class XError extends BrightDataError {
	constructor(
		message: string,
		options: {
			statusCode?: number;
			request?: HttpRequestConfig;
			response?: HttpResponse;
			isRetryable?: boolean;
			userMessage?: string;
		}
	) {
		super(message, 'X_ERROR', {
			...options,
			platform: 'x',
		});
		this.name = 'XError';
	}
}

/**
 * X (Twitter) protected account error
 */
export class XProtectedAccountError extends XError {
	constructor(request?: HttpRequestConfig, response?: HttpResponse) {
		super('X account is protected', {
			statusCode: 403,
			request,
			response,
			isRetryable: false,
			userMessage: 'This X (Twitter) account is protected. Only approved followers can view the content.',
		});
		this.name = 'XProtectedAccountError';
		this.recoverySuggestions = [
			{
				action: 'request_follow',
				description: 'Follow the account and request approval',
				autoRecoverable: false,
			},
			{
				action: 'use_public_post',
				description: 'Archive posts from public accounts instead',
				autoRecoverable: false,
			},
		];
	}
}

/**
 * Threads-specific errors
 */
export class ThreadsError extends BrightDataError {
	constructor(
		message: string,
		options: {
			statusCode?: number;
			request?: HttpRequestConfig;
			response?: HttpResponse;
			isRetryable?: boolean;
			userMessage?: string;
		}
	) {
		super(message, 'THREADS_ERROR', {
			...options,
			platform: 'threads',
		});
		this.name = 'ThreadsError';
	}
}

/**
 * Service unavailable error (502, 503, 504)
 */
export class ServiceUnavailableError extends BrightDataError {
	constructor(
		statusCode: number,
		platform?: string,
		request?: HttpRequestConfig,
		response?: HttpResponse
	) {
		const platformName = platform || 'The service';
		const statusMessage =
			statusCode === 502
				? 'Bad Gateway'
				: statusCode === 503
					? 'Service Unavailable'
					: 'Gateway Timeout';

		super(`${platformName} is temporarily unavailable (${statusMessage})`, 'SERVICE_UNAVAILABLE', {
			statusCode,
			request,
			response,
			isRetryable: true,
			platform,
			userMessage: `${platformName} is temporarily unavailable. This is usually a temporary issue.`,
		});
		this.name = 'ServiceUnavailableError';
		this.recoverySuggestions = [
			{
				action: 'retry',
				description: 'Retry the request after a short delay',
				autoRecoverable: true,
			},
			{
				action: 'check_status',
				description: 'Check if the service is experiencing downtime',
				autoRecoverable: false,
			},
			{
				action: 'try_later',
				description: 'Try again in a few minutes',
				autoRecoverable: false,
			},
		];
	}
}

/**
 * Invalid URL error
 */
export class InvalidURLError extends BrightDataError {
	constructor(url: string, request?: HttpRequestConfig) {
		super(`Invalid or malformed URL: ${url}`, 'INVALID_URL', {
			statusCode: 400,
			request,
			isRetryable: false,
			userMessage: 'The provided URL is invalid or not supported.',
		});
		this.name = 'InvalidURLError';
		this.recoverySuggestions = [
			{
				action: 'verify_url',
				description: 'Verify the URL is correctly formatted',
				autoRecoverable: false,
			},
			{
				action: 'check_platform',
				description: 'Ensure the URL is from a supported platform (Facebook, Instagram, LinkedIn, TikTok, X, Threads)',
				autoRecoverable: false,
			},
			{
				action: 'use_direct_link',
				description: 'Use the direct link to the post, not a shortened or redirect URL',
				autoRecoverable: false,
			},
		];
	}
}

/**
 * Helper function to check if error is retryable
 */
export function isRetryableError(error: unknown): boolean {
	if (error instanceof HttpError) {
		return error.isRetryable;
	}

	// Network errors are generally retryable
	if (error instanceof Error) {
		const message = error.message.toLowerCase();
		return (
			message.includes('network') ||
			message.includes('timeout') ||
			message.includes('econnreset') ||
			message.includes('enotfound') ||
			message.includes('etimedout')
		);
	}

	return false;
}

/**
 * Helper function to extract status code from error
 */
export function getErrorStatusCode(error: unknown): number | undefined {
	if (error instanceof HttpError) {
		return error.statusCode;
	}
	return undefined;
}

/**
 * Map HTTP status code to appropriate error class
 */
export function mapHttpStatusToError(
	statusCode: number,
	message: string,
	options: {
		request?: HttpRequestConfig;
		response?: HttpResponse;
		platform?: string;
		retryAfter?: number;
	} = {}
): HttpError {
	const { request, response, platform, retryAfter } = options;

	// 4xx Client Errors
	if (statusCode >= 400 && statusCode < 500) {
		switch (statusCode) {
			case 400:
				return new InvalidRequestError(message, statusCode, {
					request,
					response,
				});

			case 401:
				// Platform-specific authentication errors
				if (platform === 'facebook') {
					return new FacebookLoginRequiredError(request, response);
				}
				return new AuthenticationError(message, statusCode, request, response);

			case 403:
				// Platform-specific forbidden errors
				if (platform === 'instagram') {
					return new InstagramPrivateProfileError(request, response);
				}
				if (platform === 'linkedin') {
					return new LinkedInPremiumContentError(request, response);
				}
				if (platform === 'x') {
					return new XProtectedAccountError(request, response);
				}
				return new AuthenticationError(message, statusCode, request, response);

			case 404:
				// Platform-specific not found errors
				if (platform === 'tiktok') {
					return new TikTokVideoUnavailableError(request, response);
				}
				return new InvalidRequestError(message, statusCode, {
					request,
					response,
				});

			case 422:
				return new InvalidRequestError(message, statusCode, {
					request,
					response,
				});

			case 429:
				// Platform-specific rate limit errors
				if (platform === 'instagram') {
					return new InstagramRateLimitError(retryAfter, request, response);
				}
				return new RateLimitError(message, {
					statusCode,
					request,
					response,
					retryAfter,
				});

			default:
				return new HttpError(message, 'CLIENT_ERROR', {
					statusCode,
					request,
					response,
					isRetryable: false,
				});
		}
	}

	// 5xx Server Errors
	if (statusCode >= 500 && statusCode < 600) {
		switch (statusCode) {
			case 502:
			case 503:
			case 504:
				return new ServiceUnavailableError(statusCode, platform, request, response);

			default:
				return new ServerError(message, statusCode, request, response);
		}
	}

	// Other status codes
	return new HttpError(message, 'HTTP_ERROR', {
		statusCode,
		request,
		response,
		isRetryable: false,
	});
}

/**
 * Detect platform-specific error from response
 */
export function detectPlatformError(
	response: HttpResponse,
	platform?: string
): BrightDataError | null {
	const { status, data } = response;

	// Try to extract error details from response body
	const errorMessage = typeof data === 'object' && data !== null
		? (data as any).error?.message || (data as any).message || 'Unknown error'
		: 'Unknown error';

	// Check for platform-specific error patterns in the response
	if (typeof data === 'object' && data !== null) {
		const errorData = data as any;

		// Facebook-specific patterns
		if (platform === 'facebook' || errorData.error?.type === 'OAuthException') {
			if (errorData.error?.code === 190 || errorMessage.includes('login')) {
				return new FacebookLoginRequiredError();
			}
		}

		// Instagram-specific patterns
		if (platform === 'instagram') {
			if (errorMessage.includes('private') || errorMessage.includes('not authorized')) {
				return new InstagramPrivateProfileError();
			}
			if (status === 429) {
				const retryAfter = response.headers?.['retry-after']
					? parseInt(response.headers['retry-after'], 10) * 1000
					: undefined;
				return new InstagramRateLimitError(retryAfter);
			}
		}

		// LinkedIn-specific patterns
		if (platform === 'linkedin') {
			if (
				errorMessage.includes('premium') ||
				errorMessage.includes('subscription') ||
				errorMessage.includes('access denied')
			) {
				return new LinkedInPremiumContentError();
			}
		}

		// TikTok-specific patterns
		if (platform === 'tiktok') {
			if (
				status === 404 ||
				errorMessage.includes('unavailable') ||
				errorMessage.includes('removed') ||
				errorMessage.includes('private')
			) {
				return new TikTokVideoUnavailableError();
			}
		}

		// X (Twitter) specific patterns
		if (platform === 'x' || platform === 'twitter') {
			if (errorMessage.includes('protected') || errorMessage.includes('not authorized')) {
				return new XProtectedAccountError();
			}
		}
	}

	return null;
}

/**
 * Create appropriate error from HTTP response
 */
export function createErrorFromResponse(
	response: HttpResponse,
	request?: HttpRequestConfig,
	platform?: string
): HttpError {
	// First, try to detect platform-specific errors
	const platformError = detectPlatformError(response, platform);
	if (platformError) {
		return platformError;
	}

	// Extract error message from response
	const errorMessage =
		typeof response.data === 'object' && response.data !== null
			? (response.data as any).error?.message ||
			  (response.data as any).message ||
			  `HTTP ${response.status} error`
			: `HTTP ${response.status} error`;

	// Extract retry-after header if present
	const retryAfter = response.headers?.['retry-after']
		? parseInt(response.headers['retry-after'], 10) * 1000
		: response.headers?.['x-ratelimit-reset']
			? new Date(response.headers['x-ratelimit-reset']).getTime() - Date.now()
			: undefined;

	// Map status code to error
	return mapHttpStatusToError(response.status, errorMessage, {
		request,
		response,
		platform,
		retryAfter,
	});
}

/**
 * Helper to get user-friendly error message
 */
export function getUserFriendlyErrorMessage(error: unknown): string {
	if (error instanceof BrightDataError) {
		return error.getUserFriendlyMessage();
	}

	if (error instanceof HttpError) {
		return error.message;
	}

	if (error instanceof Error) {
		return error.message;
	}

	return 'An unexpected error occurred. Please try again.';
}

/**
 * Helper to check if error has recovery suggestions
 */
export function hasRecoverySuggestions(error: unknown): error is BrightDataError {
	return error instanceof BrightDataError && error.recoverySuggestions.length > 0;
}

/**
 * Helper to get recovery suggestions from error
 */
export function getRecoverySuggestions(error: unknown): RecoverySuggestion[] {
	if (error instanceof BrightDataError) {
		return error.recoverySuggestions;
	}
	return [];
}

/**
 * Helper to check if error can be auto-recovered
 */
export function canAutoRecover(error: unknown): boolean {
	if (error instanceof BrightDataError) {
		return error.recoverySuggestions.some((s) => s.autoRecoverable);
	}
	return false;
}
