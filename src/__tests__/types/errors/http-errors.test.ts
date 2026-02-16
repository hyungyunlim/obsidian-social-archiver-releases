import { describe, it, expect } from 'vitest';
import {
	HttpError,
	NetworkError,
	TimeoutError,
	RateLimitError,
	AuthenticationError,
	InvalidRequestError,
	ServerError,
	BrightDataError,
	FacebookError,
	FacebookLoginRequiredError,
	InstagramError,
	InstagramPrivateProfileError,
	InstagramRateLimitError,
	LinkedInError,
	LinkedInPremiumContentError,
	TikTokError,
	TikTokVideoUnavailableError,
	XError,
	XProtectedAccountError,
	ThreadsError,
	ServiceUnavailableError,
	InvalidURLError,
	mapHttpStatusToError,
	detectPlatformError,
	createErrorFromResponse,
	getUserFriendlyErrorMessage,
	hasRecoverySuggestions,
	getRecoverySuggestions,
	canAutoRecover,
	isRetryableError,
	getErrorStatusCode,
} from '@/types/errors/http-errors';
import type { HttpResponse } from '@/types/brightdata';

describe('HTTP Error Types', () => {
	describe('HttpError', () => {
		it('should create basic HTTP error', () => {
			const error = new HttpError('Test error', 'TEST_ERROR');

			expect(error).toBeInstanceOf(Error);
			expect(error.name).toBe('HttpError');
			expect(error.message).toBe('Test error');
			expect(error.code).toBe('TEST_ERROR');
			expect(error.isRetryable).toBe(false);
		});

		it('should support status code', () => {
			const error = new HttpError('Not found', 'NOT_FOUND', {
				statusCode: 404,
			});

			expect(error.statusCode).toBe(404);
		});

		it('should support retryable flag', () => {
			const error = new HttpError('Server error', 'SERVER_ERROR', {
				statusCode: 500,
				isRetryable: true,
			});

			expect(error.isRetryable).toBe(true);
		});

		it('should support error cause', () => {
			const cause = new Error('Original error');
			const error = new HttpError('Wrapped error', 'WRAPPED', {
				cause,
			});

			expect(error.cause).toBe(cause);
		});

		it('should capture stack trace', () => {
			const error = new HttpError('Test error', 'TEST_ERROR');

			expect(error.stack).toBeDefined();
			expect(error.stack).toContain('HttpError');
		});
	});

	describe('NetworkError', () => {
		it('should create network error', () => {
			const error = new NetworkError('Connection failed');

			expect(error).toBeInstanceOf(HttpError);
			expect(error.name).toBe('NetworkError');
			expect(error.code).toBe('NETWORK_ERROR');
			expect(error.isRetryable).toBe(true);
		});

		it('should support original error cause', () => {
			const cause = new Error('ECONNREFUSED');
			const error = new NetworkError('Connection refused', undefined, cause);

			expect(error.cause).toBe(cause);
		});
	});

	describe('TimeoutError', () => {
		it('should create timeout error', () => {
			const error = new TimeoutError('Request timeout');

			expect(error).toBeInstanceOf(HttpError);
			expect(error.name).toBe('TimeoutError');
			expect(error.code).toBe('TIMEOUT_ERROR');
			expect(error.isRetryable).toBe(true);
		});
	});

	describe('RateLimitError', () => {
		it('should create rate limit error with basic info', () => {
			const error = new RateLimitError('Rate limit exceeded', {
				statusCode: 429,
			});

			expect(error).toBeInstanceOf(HttpError);
			expect(error.name).toBe('RateLimitError');
			expect(error.code).toBe('RATE_LIMIT_ERROR');
			expect(error.statusCode).toBe(429);
			expect(error.isRetryable).toBe(true);
		});

		it('should include retry-after information', () => {
			const error = new RateLimitError('Rate limit exceeded', {
				retryAfter: 60,
				limit: 100,
				remaining: 0,
			});

			expect(error.retryAfter).toBe(60);
			expect(error.limit).toBe(100);
			expect(error.remaining).toBe(0);
		});

		it('should default status code to 429', () => {
			const error = new RateLimitError('Rate limit exceeded', {});

			expect(error.statusCode).toBe(429);
		});
	});

	describe('AuthenticationError', () => {
		it('should create 401 authentication error', () => {
			const error = new AuthenticationError('Unauthorized', 401);

			expect(error).toBeInstanceOf(HttpError);
			expect(error.name).toBe('AuthenticationError');
			expect(error.code).toBe('AUTHENTICATION_ERROR');
			expect(error.statusCode).toBe(401);
			expect(error.isRetryable).toBe(false);
		});

		it('should create 403 forbidden error', () => {
			const error = new AuthenticationError('Forbidden', 403);

			expect(error.statusCode).toBe(403);
			expect(error.isRetryable).toBe(false);
		});
	});

	describe('InvalidRequestError', () => {
		it('should create invalid request error', () => {
			const error = new InvalidRequestError('Bad request', 400, {});

			expect(error).toBeInstanceOf(HttpError);
			expect(error.name).toBe('InvalidRequestError');
			expect(error.code).toBe('INVALID_REQUEST_ERROR');
			expect(error.statusCode).toBe(400);
			expect(error.isRetryable).toBe(false);
		});

		it('should include validation errors', () => {
			const validationErrors = ['Field "email" is required', 'Field "age" must be a number'];
			const error = new InvalidRequestError('Validation failed', 422, {
				validationErrors,
			});

			expect(error.validationErrors).toEqual(validationErrors);
		});
	});

	describe('ServerError', () => {
		it('should create 500 server error', () => {
			const error = new ServerError('Internal server error', 500);

			expect(error).toBeInstanceOf(HttpError);
			expect(error.name).toBe('ServerError');
			expect(error.code).toBe('SERVER_ERROR');
			expect(error.statusCode).toBe(500);
			expect(error.isRetryable).toBe(true);
		});

		it('should create 502 bad gateway error', () => {
			const error = new ServerError('Bad gateway', 502);

			expect(error.statusCode).toBe(502);
			expect(error.isRetryable).toBe(true);
		});

		it('should create 503 service unavailable error', () => {
			const error = new ServerError('Service unavailable', 503);

			expect(error.statusCode).toBe(503);
			expect(error.isRetryable).toBe(true);
		});

		it('should create 504 gateway timeout error', () => {
			const error = new ServerError('Gateway timeout', 504);

			expect(error.statusCode).toBe(504);
			expect(error.isRetryable).toBe(true);
		});
	});

	describe('BrightDataError', () => {
		it('should create BrightData-specific error', () => {
			const error = new BrightDataError('API quota exceeded', 'QUOTA_EXCEEDED', {
				statusCode: 429,
				isRetryable: false,
			});

			expect(error).toBeInstanceOf(HttpError);
			expect(error.name).toBe('BrightDataError');
			expect(error.code).toBe('BRIGHTDATA_QUOTA_EXCEEDED');
			expect(error.statusCode).toBe(429);
			expect(error.isRetryable).toBe(false);
		});

		it('should prefix code with BRIGHTDATA_', () => {
			const error = new BrightDataError('Invalid credentials', 'INVALID_CREDENTIALS', {});

			expect(error.code).toBe('BRIGHTDATA_INVALID_CREDENTIALS');
		});
	});

	describe('isRetryableError', () => {
		it('should return true for retryable HTTP errors', () => {
			const networkError = new NetworkError('Connection failed');
			const timeoutError = new TimeoutError('Request timeout');
			const rateLimitError = new RateLimitError('Rate limit', {});
			const serverError = new ServerError('Server error', 500);

			expect(isRetryableError(networkError)).toBe(true);
			expect(isRetryableError(timeoutError)).toBe(true);
			expect(isRetryableError(rateLimitError)).toBe(true);
			expect(isRetryableError(serverError)).toBe(true);
		});

		it('should return false for non-retryable HTTP errors', () => {
			const authError = new AuthenticationError('Unauthorized', 401);
			const invalidError = new InvalidRequestError('Bad request', 400, {});

			expect(isRetryableError(authError)).toBe(false);
			expect(isRetryableError(invalidError)).toBe(false);
		});

		it('should detect retryable network errors from message', () => {
			const errors = [
				new Error('network timeout occurred'),
				new Error('ECONNRESET: Connection reset by peer'),
				new Error('ENOTFOUND: DNS lookup failed'),
				new Error('ETIMEDOUT: Operation timed out'),
			];

			errors.forEach((error) => {
				expect(isRetryableError(error)).toBe(true);
			});
		});

		it('should return false for generic errors', () => {
			const error = new Error('Some random error');

			expect(isRetryableError(error)).toBe(false);
		});

		it('should return false for non-error values', () => {
			expect(isRetryableError('string error')).toBe(false);
			expect(isRetryableError(null)).toBe(false);
			expect(isRetryableError(undefined)).toBe(false);
			expect(isRetryableError(123)).toBe(false);
		});
	});

	describe('getErrorStatusCode', () => {
		it('should extract status code from HTTP errors', () => {
			const errors = [
				{ error: new HttpError('Test', 'TEST', { statusCode: 404 }), expected: 404 },
				{ error: new AuthenticationError('Unauthorized', 401), expected: 401 },
				{ error: new RateLimitError('Rate limit', { statusCode: 429 }), expected: 429 },
				{ error: new ServerError('Server error', 500), expected: 500 },
			];

			errors.forEach(({ error, expected }) => {
				expect(getErrorStatusCode(error)).toBe(expected);
			});
		});

		it('should return undefined for errors without status code', () => {
			const networkError = new NetworkError('Connection failed');
			const timeoutError = new TimeoutError('Timeout');

			expect(getErrorStatusCode(networkError)).toBeUndefined();
			expect(getErrorStatusCode(timeoutError)).toBeUndefined();
		});

		it('should return undefined for non-HTTP errors', () => {
			const error = new Error('Generic error');

			expect(getErrorStatusCode(error)).toBeUndefined();
		});

		it('should return undefined for non-error values', () => {
			expect(getErrorStatusCode('string')).toBeUndefined();
			expect(getErrorStatusCode(null)).toBeUndefined();
			expect(getErrorStatusCode(undefined)).toBeUndefined();
		});
	});

	describe('Error inheritance', () => {
		it('should maintain prototype chain', () => {
			const error = new RateLimitError('Test', {});

			expect(error).toBeInstanceOf(RateLimitError);
			expect(error).toBeInstanceOf(HttpError);
			expect(error).toBeInstanceOf(Error);
		});

		it('should allow instanceof checks', () => {
			const errors = [
				new NetworkError('Network'),
				new TimeoutError('Timeout'),
				new RateLimitError('Rate limit', {}),
				new AuthenticationError('Auth', 401),
				new InvalidRequestError('Invalid', 400, {}),
				new ServerError('Server', 500),
				new BrightDataError('BrightData', 'ERROR', {}),
			];

			errors.forEach((error) => {
				expect(error).toBeInstanceOf(HttpError);
				expect(error).toBeInstanceOf(Error);
			});
		});
	});

	describe('Error serialization', () => {
		it('should serialize to JSON', () => {
			const error = new RateLimitError('Rate limit exceeded', {
				statusCode: 429,
				retryAfter: 60,
				limit: 100,
				remaining: 0,
			});

			const json = JSON.stringify(error);
			const parsed = JSON.parse(json);

			expect(parsed).toHaveProperty('message');
			expect(parsed).toHaveProperty('name');
			expect(parsed).toHaveProperty('code');
			expect(parsed).toHaveProperty('statusCode');
		});

		it('should include all custom properties', () => {
			const error = new InvalidRequestError('Validation failed', 422, {
				validationErrors: ['Error 1', 'Error 2'],
			});

			const serialized = JSON.parse(JSON.stringify(error));

			expect(serialized.validationErrors).toEqual(['Error 1', 'Error 2']);
		});
	});

	describe('BrightDataError with user messages and recovery', () => {
		it('should support platform property', () => {
			const error = new BrightDataError('Test error', 'TEST', {
				platform: 'facebook',
			});

			expect(error.platform).toBe('facebook');
		});

		it('should provide user-friendly message', () => {
			const error = new BrightDataError('Technical error', 'TEST', {
				userMessage: 'Something went wrong. Please try again.',
			});

			expect(error.userMessage).toBe('Something went wrong. Please try again.');
		});

		it('should default userMessage to technical message', () => {
			const error = new BrightDataError('Technical error', 'TEST', {});

			expect(error.userMessage).toBe('Technical error');
		});

		it('should include recovery suggestions', () => {
			const suggestions = [
				{
					action: 'retry',
					description: 'Try again',
					autoRecoverable: true,
				},
			];

			const error = new BrightDataError('Test error', 'TEST', {
				recoverySuggestions: suggestions,
			});

			expect(error.recoverySuggestions).toEqual(suggestions);
		});

		it('should format user-friendly message with suggestions', () => {
			const error = new BrightDataError('Test error', 'TEST', {
				userMessage: 'Operation failed',
				recoverySuggestions: [
					{
						action: 'retry',
						description: 'Try again later',
						autoRecoverable: true,
					},
					{
						action: 'contact_support',
						description: 'Contact support if issue persists',
						autoRecoverable: false,
					},
				],
			});

			const message = error.getUserFriendlyMessage();

			expect(message).toContain('Operation failed');
			expect(message).toContain('Suggestions:');
			expect(message).toContain('1. Try again later');
			expect(message).toContain('2. Contact support if issue persists');
		});
	});

	describe('Platform-specific errors', () => {
		describe('FacebookError', () => {
			it('should create Facebook error with platform', () => {
				const error = new FacebookError('Test error', {});

				expect(error).toBeInstanceOf(BrightDataError);
				expect(error.platform).toBe('facebook');
				expect(error.code).toBe('BRIGHTDATA_FACEBOOK_ERROR');
			});
		});

		describe('FacebookLoginRequiredError', () => {
			it('should create login required error', () => {
				const error = new FacebookLoginRequiredError();

				expect(error).toBeInstanceOf(FacebookError);
				expect(error.name).toBe('FacebookLoginRequiredError');
				expect(error.statusCode).toBe(401);
				expect(error.isRetryable).toBe(false);
				expect(error.platform).toBe('facebook');
			});

			it('should have user-friendly message', () => {
				const error = new FacebookLoginRequiredError();

				expect(error.userMessage).toContain('logged in');
				expect(error.userMessage).toContain('publicly accessible');
			});

			it('should have recovery suggestions', () => {
				const error = new FacebookLoginRequiredError();

				expect(error.recoverySuggestions).toHaveLength(2);
				expect(error.recoverySuggestions[0].action).toBe('check_privacy');
				expect(error.recoverySuggestions[1].action).toBe('use_direct_link');
			});
		});

		describe('InstagramPrivateProfileError', () => {
			it('should create private profile error', () => {
				const error = new InstagramPrivateProfileError();

				expect(error).toBeInstanceOf(InstagramError);
				expect(error.name).toBe('InstagramPrivateProfileError');
				expect(error.statusCode).toBe(403);
				expect(error.isRetryable).toBe(false);
				expect(error.platform).toBe('instagram');
			});

			it('should have actionable recovery suggestions', () => {
				const error = new InstagramPrivateProfileError();

				expect(error.recoverySuggestions).toHaveLength(2);
				expect(error.recoverySuggestions[0].action).toBe('request_access');
				expect(error.recoverySuggestions[1].action).toBe('use_public_post');
			});
		});

		describe('InstagramRateLimitError', () => {
			it('should create rate limit error with retry info', () => {
				const error = new InstagramRateLimitError(60000);

				expect(error).toBeInstanceOf(InstagramError);
				expect(error.name).toBe('InstagramRateLimitError');
				expect(error.statusCode).toBe(429);
				expect(error.isRetryable).toBe(true);
				expect(error.retryAfter).toBe(60000);
			});

			it('should include retry time in message', () => {
				const error = new InstagramRateLimitError(30000);

				expect(error.message).toContain('30 seconds');
				expect(error.userMessage).toContain('30 seconds');
			});

			it('should have auto-recoverable suggestion', () => {
				const error = new InstagramRateLimitError(60000);

				expect(error.recoverySuggestions.some((s) => s.autoRecoverable)).toBe(true);
			});
		});

		describe('LinkedInPremiumContentError', () => {
			it('should create premium content error', () => {
				const error = new LinkedInPremiumContentError();

				expect(error).toBeInstanceOf(LinkedInError);
				expect(error.statusCode).toBe(403);
				expect(error.platform).toBe('linkedin');
			});
		});

		describe('TikTokVideoUnavailableError', () => {
			it('should create video unavailable error', () => {
				const error = new TikTokVideoUnavailableError();

				expect(error).toBeInstanceOf(TikTokError);
				expect(error.statusCode).toBe(404);
				expect(error.platform).toBe('tiktok');
			});

			it('should mention multiple possible causes', () => {
				const error = new TikTokVideoUnavailableError();

				expect(error.userMessage).toContain('removed');
				expect(error.userMessage).toContain('private');
				expect(error.userMessage).toContain('region');
			});
		});

		describe('XProtectedAccountError', () => {
			it('should create protected account error', () => {
				const error = new XProtectedAccountError();

				expect(error).toBeInstanceOf(XError);
				expect(error.statusCode).toBe(403);
				expect(error.platform).toBe('x');
			});
		});

		describe('ServiceUnavailableError', () => {
			it('should create 502 bad gateway error', () => {
				const error = new ServiceUnavailableError(502, 'facebook');

				expect(error).toBeInstanceOf(BrightDataError);
				expect(error.statusCode).toBe(502);
				expect(error.isRetryable).toBe(true);
				expect(error.message).toContain('Bad Gateway');
			});

			it('should create 503 service unavailable error', () => {
				const error = new ServiceUnavailableError(503);

				expect(error.statusCode).toBe(503);
				expect(error.message).toContain('Service Unavailable');
			});

			it('should create 504 gateway timeout error', () => {
				const error = new ServiceUnavailableError(504, 'instagram');

				expect(error.statusCode).toBe(504);
				expect(error.message).toContain('Gateway Timeout');
				expect(error.platform).toBe('instagram');
			});

			it('should have auto-recoverable retry suggestion', () => {
				const error = new ServiceUnavailableError(503);

				const retrySuggestion = error.recoverySuggestions.find((s) => s.action === 'retry');
				expect(retrySuggestion).toBeDefined();
				expect(retrySuggestion?.autoRecoverable).toBe(true);
			});
		});

		describe('InvalidURLError', () => {
			it('should create invalid URL error', () => {
				const url = 'invalid-url';
				const error = new InvalidURLError(url);

				expect(error).toBeInstanceOf(BrightDataError);
				expect(error.statusCode).toBe(400);
				expect(error.isRetryable).toBe(false);
				expect(error.message).toContain(url);
			});

			it('should have helpful recovery suggestions', () => {
				const error = new InvalidURLError('bad-url');

				expect(error.recoverySuggestions).toHaveLength(3);
				expect(error.recoverySuggestions.some((s) => s.action === 'verify_url')).toBe(true);
				expect(error.recoverySuggestions.some((s) => s.action === 'check_platform')).toBe(true);
			});
		});
	});

	describe('Error mapping utilities', () => {
		describe('mapHttpStatusToError', () => {
			it('should map 400 to InvalidRequestError', () => {
				const error = mapHttpStatusToError(400, 'Bad request');

				expect(error).toBeInstanceOf(InvalidRequestError);
				expect(error.statusCode).toBe(400);
			});

			it('should map 401 to AuthenticationError', () => {
				const error = mapHttpStatusToError(401, 'Unauthorized');

				expect(error).toBeInstanceOf(AuthenticationError);
				expect(error.statusCode).toBe(401);
			});

			it('should map 401 with facebook platform to FacebookLoginRequiredError', () => {
				const error = mapHttpStatusToError(401, 'Login required', {
					platform: 'facebook',
				});

				expect(error).toBeInstanceOf(FacebookLoginRequiredError);
			});

			it('should map 403 with instagram platform to InstagramPrivateProfileError', () => {
				const error = mapHttpStatusToError(403, 'Private profile', {
					platform: 'instagram',
				});

				expect(error).toBeInstanceOf(InstagramPrivateProfileError);
			});

			it('should map 403 with linkedin platform to LinkedInPremiumContentError', () => {
				const error = mapHttpStatusToError(403, 'Premium content', {
					platform: 'linkedin',
				});

				expect(error).toBeInstanceOf(LinkedInPremiumContentError);
			});

			it('should map 403 with x platform to XProtectedAccountError', () => {
				const error = mapHttpStatusToError(403, 'Protected account', {
					platform: 'x',
				});

				expect(error).toBeInstanceOf(XProtectedAccountError);
			});

			it('should map 404 with tiktok platform to TikTokVideoUnavailableError', () => {
				const error = mapHttpStatusToError(404, 'Video not found', {
					platform: 'tiktok',
				});

				expect(error).toBeInstanceOf(TikTokVideoUnavailableError);
			});

			it('should map 429 to RateLimitError with retry-after', () => {
				const error = mapHttpStatusToError(429, 'Rate limit', {
					retryAfter: 60000,
				});

				expect(error).toBeInstanceOf(RateLimitError);
				expect(error.statusCode).toBe(429);
			});

			it('should map 429 with instagram platform to InstagramRateLimitError', () => {
				const error = mapHttpStatusToError(429, 'Rate limit', {
					platform: 'instagram',
					retryAfter: 30000,
				});

				expect(error).toBeInstanceOf(InstagramRateLimitError);
			});

			it('should map 502 to ServiceUnavailableError', () => {
				const error = mapHttpStatusToError(502, 'Bad gateway', {
					platform: 'facebook',
				});

				expect(error).toBeInstanceOf(ServiceUnavailableError);
				expect(error.statusCode).toBe(502);
			});

			it('should map 503 to ServiceUnavailableError', () => {
				const error = mapHttpStatusToError(503, 'Service unavailable');

				expect(error).toBeInstanceOf(ServiceUnavailableError);
			});

			it('should map 504 to ServiceUnavailableError', () => {
				const error = mapHttpStatusToError(504, 'Gateway timeout');

				expect(error).toBeInstanceOf(ServiceUnavailableError);
			});

			it('should map 500 to ServerError', () => {
				const error = mapHttpStatusToError(500, 'Internal server error');

				expect(error).toBeInstanceOf(ServerError);
				expect(error.isRetryable).toBe(true);
			});

			it('should map unknown status codes to generic HttpError', () => {
				const error = mapHttpStatusToError(418, "I'm a teapot");

				expect(error).toBeInstanceOf(HttpError);
				expect(error.statusCode).toBe(418);
			});
		});

		describe('detectPlatformError', () => {
			it('should detect Facebook login required from error code', () => {
				const response: HttpResponse = {
					status: 401,
					statusText: 'Unauthorized',
					headers: {},
					data: {
						error: {
							type: 'OAuthException',
							code: 190,
							message: 'User login required',
						},
					},
				};

				const error = detectPlatformError(response, 'facebook');

				expect(error).toBeInstanceOf(FacebookLoginRequiredError);
			});

			it('should detect Instagram private profile', () => {
				const response: HttpResponse = {
					status: 403,
					statusText: 'Forbidden',
					headers: {},
					data: {
						message: 'This account is private',
					},
				};

				const error = detectPlatformError(response, 'instagram');

				expect(error).toBeInstanceOf(InstagramPrivateProfileError);
			});

			it('should detect Instagram rate limit with retry-after', () => {
				const response: HttpResponse = {
					status: 429,
					statusText: 'Too Many Requests',
					headers: {
						'retry-after': '60',
					},
					data: {},
				};

				const error = detectPlatformError(response, 'instagram');

				expect(error).toBeInstanceOf(InstagramRateLimitError);
				if (error instanceof InstagramRateLimitError) {
					expect(error.retryAfter).toBe(60000);
				}
			});

			it('should detect LinkedIn premium content', () => {
				const response: HttpResponse = {
					status: 403,
					statusText: 'Forbidden',
					headers: {},
					data: {
						message: 'This content requires a premium subscription',
					},
				};

				const error = detectPlatformError(response, 'linkedin');

				expect(error).toBeInstanceOf(LinkedInPremiumContentError);
			});

			it('should detect TikTok video unavailable', () => {
				const response: HttpResponse = {
					status: 404,
					statusText: 'Not Found',
					headers: {},
					data: {
						message: 'Video has been removed',
					},
				};

				const error = detectPlatformError(response, 'tiktok');

				expect(error).toBeInstanceOf(TikTokVideoUnavailableError);
			});

			it('should detect X protected account', () => {
				const response: HttpResponse = {
					status: 403,
					statusText: 'Forbidden',
					headers: {},
					data: {
						message: 'This account is protected',
					},
				};

				const error = detectPlatformError(response, 'x');

				expect(error).toBeInstanceOf(XProtectedAccountError);
			});

			it('should return null for non-platform-specific errors', () => {
				const response: HttpResponse = {
					status: 500,
					statusText: 'Internal Server Error',
					headers: {},
					data: {},
				};

				const error = detectPlatformError(response);

				expect(error).toBeNull();
			});
		});

		describe('createErrorFromResponse', () => {
			it('should prioritize platform-specific errors', () => {
				const response: HttpResponse = {
					status: 401,
					statusText: 'Unauthorized',
					headers: {},
					data: {
						error: {
							type: 'OAuthException',
							code: 190,
						},
					},
				};

				const error = createErrorFromResponse(response, undefined, 'facebook');

				expect(error).toBeInstanceOf(FacebookLoginRequiredError);
			});

			it('should fall back to status code mapping', () => {
				const response: HttpResponse = {
					status: 400,
					statusText: 'Bad Request',
					headers: {},
					data: {
						message: 'Invalid parameters',
					},
				};

				const error = createErrorFromResponse(response);

				expect(error).toBeInstanceOf(InvalidRequestError);
			});

			it('should extract retry-after from headers', () => {
				const response: HttpResponse = {
					status: 429,
					statusText: 'Too Many Requests',
					headers: {
						'retry-after': '120',
					},
					data: {},
				};

				const error = createErrorFromResponse(response);

				expect(error).toBeInstanceOf(RateLimitError);
				if (error instanceof RateLimitError) {
					expect(error.retryAfter).toBe(120000);
				}
			});

			it('should extract retry-after from x-ratelimit-reset', () => {
				const futureTime = new Date(Date.now() + 60000).toISOString();
				const response: HttpResponse = {
					status: 429,
					statusText: 'Too Many Requests',
					headers: {
						'x-ratelimit-reset': futureTime,
					},
					data: {},
				};

				const error = createErrorFromResponse(response);

				expect(error).toBeInstanceOf(RateLimitError);
				if (error instanceof RateLimitError) {
					expect(error.retryAfter).toBeGreaterThan(0);
					expect(error.retryAfter).toBeLessThanOrEqual(60000);
				}
			});
		});

		describe('getUserFriendlyErrorMessage', () => {
			it('should get message from BrightDataError', () => {
				const error = new FacebookLoginRequiredError();
				const message = getUserFriendlyErrorMessage(error);

				expect(message).toContain('Suggestions:');
				expect(message).toContain('Public');
			});

			it('should get message from HttpError', () => {
				const error = new HttpError('Test error', 'TEST');
				const message = getUserFriendlyErrorMessage(error);

				expect(message).toBe('Test error');
			});

			it('should get message from generic Error', () => {
				const error = new Error('Generic error');
				const message = getUserFriendlyErrorMessage(error);

				expect(message).toBe('Generic error');
			});

			it('should return default message for unknown errors', () => {
				const message = getUserFriendlyErrorMessage('not an error');

				expect(message).toBe('An unexpected error occurred. Please try again.');
			});
		});

		describe('hasRecoverySuggestions', () => {
			it('should return true for errors with suggestions', () => {
				const error = new FacebookLoginRequiredError();

				expect(hasRecoverySuggestions(error)).toBe(true);
			});

			it('should return false for errors without suggestions', () => {
				const error = new BrightDataError('Test', 'TEST', {});

				expect(hasRecoverySuggestions(error)).toBe(false);
			});

			it('should return false for non-BrightData errors', () => {
				const error = new HttpError('Test', 'TEST');

				expect(hasRecoverySuggestions(error)).toBe(false);
			});
		});

		describe('getRecoverySuggestions', () => {
			it('should return suggestions from BrightDataError', () => {
				const error = new InstagramPrivateProfileError();
				const suggestions = getRecoverySuggestions(error);

				expect(suggestions).toHaveLength(2);
				expect(suggestions[0].action).toBe('request_access');
			});

			it('should return empty array for non-BrightData errors', () => {
				const error = new HttpError('Test', 'TEST');
				const suggestions = getRecoverySuggestions(error);

				expect(suggestions).toEqual([]);
			});
		});

		describe('canAutoRecover', () => {
			it('should return true for errors with auto-recoverable suggestions', () => {
				const error = new InstagramRateLimitError(60000);

				expect(canAutoRecover(error)).toBe(true);
			});

			it('should return false for errors without auto-recoverable suggestions', () => {
				const error = new FacebookLoginRequiredError();

				expect(canAutoRecover(error)).toBe(false);
			});

			it('should return false for non-BrightData errors', () => {
				const error = new HttpError('Test', 'TEST');

				expect(canAutoRecover(error)).toBe(false);
			});
		});
	});
});
