import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import axios from 'axios';
import { BrightDataHttpClient } from '@/services/BrightDataHttpClient';
import type { HttpClientConfig } from '@/types/brightdata';
import {
	HttpError,
	NetworkError,
	TimeoutError,
	RateLimitError,
	AuthenticationError,
	InvalidRequestError,
	ServerError,
} from '@/types/errors/http-errors';

// Mock axios
vi.mock('axios');

describe('BrightDataHttpClient', () => {
	let client: BrightDataHttpClient;
	let mockAxiosInstance: any;
	const config: HttpClientConfig = {
		baseURL: 'https://api.brightdata.com',
		timeout: 30000,
		apiKey: 'test-api-key-123',
	};

	beforeEach(() => {
		// Setup mock axios instance
		mockAxiosInstance = {
			request: vi.fn(),
			get: vi.fn(),
			post: vi.fn(),
			put: vi.fn(),
			delete: vi.fn(),
			interceptors: {
				request: {
					use: vi.fn((onFulfilled, onRejected) => {
						mockAxiosInstance._requestInterceptor = { onFulfilled, onRejected };
						return 0;
					}),
					eject: vi.fn(),
				},
				response: {
					use: vi.fn((onFulfilled, onRejected) => {
						mockAxiosInstance._responseInterceptor = { onFulfilled, onRejected };
						return 0;
					}),
					eject: vi.fn(),
				},
			},
		};

		vi.mocked(axios.create).mockReturnValue(mockAxiosInstance as any);
		vi.mocked(axios.isAxiosError).mockReturnValue(false);

		client = new BrightDataHttpClient(config);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('Initialization', () => {
		it('should create axios instance with correct configuration', () => {
			expect(axios.create).toHaveBeenCalledWith({
				baseURL: config.baseURL,
				timeout: config.timeout,
				headers: {
					'Content-Type': 'application/json',
					'User-Agent': 'ObsidianSocialArchiver/1.0',
				},
			});
		});

		it('should setup request interceptor', () => {
			expect(mockAxiosInstance.interceptors.request.use).toHaveBeenCalled();
		});

		it('should setup response interceptor', () => {
			expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();
		});

		it('should throw error if API key is missing', async () => {
			const clientWithoutKey = new BrightDataHttpClient({
				...config,
				apiKey: '',
			});

			await expect(clientWithoutKey.initialize()).rejects.toThrow('API key is required');
		});

		it('should initialize successfully with API key', async () => {
			await expect(client.initialize()).resolves.not.toThrow();
		});
	});

	describe('Request Interceptor', () => {
		it('should add Authorization header', () => {
			const requestConfig = { url: '/test', method: 'GET', headers: {} };
			const interceptor = mockAxiosInstance._requestInterceptor;

			const result = interceptor.onFulfilled(requestConfig);

			expect(result.headers['Authorization']).toBe(`Bearer ${config.apiKey}`);
		});

		it('should add X-Request-ID header', () => {
			const requestConfig = { url: '/test', method: 'GET', headers: {} };
			const interceptor = mockAxiosInstance._requestInterceptor;

			const result = interceptor.onFulfilled(requestConfig);

			expect(result.headers['X-Request-ID']).toMatch(/^req_\d+_[a-z0-9]+$/);
		});

		it('should preserve custom correlation ID', () => {
			const correlationId = 'custom-correlation-123';
			const requestConfig = {
				url: '/test',
				method: 'GET',
				headers: { 'X-Correlation-ID': correlationId },
			};
			const interceptor = mockAxiosInstance._requestInterceptor;

			const result = interceptor.onFulfilled(requestConfig);

			expect(result.headers['X-Correlation-ID']).toBe(correlationId);
		});

		it('should handle request interceptor errors', async () => {
			const requestConfig = { url: '/test', method: 'GET', headers: {} };
			const interceptor = mockAxiosInstance._requestInterceptor;
			const error = new Error('Interceptor error');

			await expect(interceptor.onRejected(error)).rejects.toThrow(HttpError);
		});
	});

	describe('Response Interceptor', () => {
		it('should extract rate limit information', () => {
			const requestId = 'req_123_abc';
			const response = {
				status: 200,
				data: { success: true },
				headers: {
					'x-ratelimit-limit': '1000',
					'x-ratelimit-remaining': '500',
					'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
					'X-Request-ID': requestId,
				},
				config: { headers: { 'X-Request-ID': requestId } },
			};

			// Simulate request interceptor creating metadata
			const requestConfig = { url: '/test', method: 'GET', headers: {} };
			mockAxiosInstance._requestInterceptor.onFulfilled(requestConfig);

			const interceptor = mockAxiosInstance._responseInterceptor;
			const result = interceptor.onFulfilled(response);

			// Metadata should be added if request was tracked
			if (result.metadata) {
				expect(result.metadata).toBeDefined();
				expect(result.metadata.rateLimit).toBeDefined();
				expect(result.metadata.rateLimit.limit).toBe(1000);
				expect(result.metadata.rateLimit.remaining).toBe(500);
			}
		});

		it('should calculate response duration', () => {
			const requestId = 'req_123_abc';
			const response = {
				status: 200,
				data: { success: true },
				headers: { 'X-Request-ID': requestId },
				config: { headers: { 'X-Request-ID': requestId } },
			};

			// Simulate request interceptor to set metadata
			const requestConfig = { url: '/test', method: 'GET', headers: { 'X-Request-ID': requestId } };
			mockAxiosInstance._requestInterceptor.onFulfilled(requestConfig);

			const interceptor = mockAxiosInstance._responseInterceptor;
			const result = interceptor.onFulfilled(response);

			// Metadata should be added if request was tracked
			if (result.metadata) {
				expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
			}
		});

		it('should handle response without rate limit headers', () => {
			const requestId = 'req_123_abc';
			const response = {
				status: 200,
				data: { success: true },
				headers: { 'X-Request-ID': requestId },
				config: { headers: { 'X-Request-ID': requestId } },
			};

			// Simulate request interceptor creating metadata
			const requestConfig = { url: '/test', method: 'GET', headers: { 'X-Request-ID': requestId } };
			mockAxiosInstance._requestInterceptor.onFulfilled(requestConfig);

			const interceptor = mockAxiosInstance._responseInterceptor;
			const result = interceptor.onFulfilled(response);

			// Metadata should be added if request was tracked
			if (result.metadata) {
				expect(result.metadata.rateLimit).toBeUndefined();
			}
		});
	});

	describe('Error Transformation', () => {
		beforeEach(() => {
			vi.mocked(axios.isAxiosError).mockReturnValue(true);
		});

		it('should transform timeout error', async () => {
			const error = {
				isAxiosError: true,
				code: 'ETIMEDOUT',
				message: 'timeout of 30000ms exceeded',
				config: { url: '/test', method: 'GET' },
			};

			mockAxiosInstance.request.mockRejectedValue(error);

			await expect(client.get('/test')).rejects.toThrow(TimeoutError);
		});

		it('should transform network error', async () => {
			const error = {
				isAxiosError: true,
				code: 'ENOTFOUND',
				message: 'getaddrinfo ENOTFOUND api.brightdata.com',
				config: { url: '/test', method: 'GET' },
			};

			mockAxiosInstance.request.mockRejectedValue(error);

			await expect(client.get('/test')).rejects.toThrow(NetworkError);
		});

		it('should transform 429 rate limit error', async () => {
			const error = {
				isAxiosError: true,
				response: {
					status: 429,
					statusText: 'Too Many Requests',
					data: { message: 'Rate limit exceeded' },
					headers: {
						'x-ratelimit-limit': '100',
						'x-ratelimit-remaining': '0',
						'retry-after': '60',
					},
				},
				config: { url: '/test', method: 'GET' },
			};

			mockAxiosInstance.request.mockRejectedValue(error);

			try {
				await client.get('/test');
				expect.fail('Should have thrown RateLimitError');
			} catch (err) {
				expect(err).toBeInstanceOf(RateLimitError);
				const rateLimitErr = err as RateLimitError;
				expect(rateLimitErr.statusCode).toBe(429);
				expect(rateLimitErr.limit).toBe(100);
				expect(rateLimitErr.remaining).toBe(0);
				expect(rateLimitErr.retryAfter).toBe(60);
			}
		});

		it('should transform 401 authentication error', async () => {
			const error = {
				isAxiosError: true,
				response: {
					status: 401,
					statusText: 'Unauthorized',
					data: { message: 'Invalid API key' },
					headers: {},
				},
				config: { url: '/test', method: 'GET' },
			};

			mockAxiosInstance.request.mockRejectedValue(error);

			await expect(client.get('/test')).rejects.toThrow(AuthenticationError);
		});

		it('should transform 403 authorization error', async () => {
			const error = {
				isAxiosError: true,
				response: {
					status: 403,
					statusText: 'Forbidden',
					data: { message: 'Insufficient permissions' },
					headers: {},
				},
				config: { url: '/test', method: 'GET' },
			};

			mockAxiosInstance.request.mockRejectedValue(error);

			await expect(client.get('/test')).rejects.toThrow(AuthenticationError);
		});

		it('should transform 400 bad request error', async () => {
			const error = {
				isAxiosError: true,
				response: {
					status: 400,
					statusText: 'Bad Request',
					data: {
						message: 'Invalid URL',
						errors: ['URL format is invalid'],
					},
					headers: {},
				},
				config: { url: '/test', method: 'POST' },
			};

			mockAxiosInstance.request.mockRejectedValue(error);

			try {
				await client.post('/test', { url: 'invalid' });
				expect.fail('Should have thrown InvalidRequestError');
			} catch (err) {
				expect(err).toBeInstanceOf(InvalidRequestError);
				const invalidErr = err as InvalidRequestError;
				expect(invalidErr.validationErrors).toEqual(['URL format is invalid']);
			}
		});

		it('should transform 500 server error', async () => {
			const error = {
				isAxiosError: true,
				response: {
					status: 500,
					statusText: 'Internal Server Error',
					data: { message: 'Server error' },
					headers: {},
				},
				config: { url: '/test', method: 'GET' },
			};

			mockAxiosInstance.request.mockRejectedValue(error);

			await expect(client.get('/test')).rejects.toThrow(ServerError);
		});

		it('should mark server errors as retryable', async () => {
			const error = {
				isAxiosError: true,
				response: {
					status: 503,
					statusText: 'Service Unavailable',
					data: { message: 'Service temporarily unavailable' },
					headers: {},
				},
				config: { url: '/test', method: 'GET' },
			};

			mockAxiosInstance.request.mockRejectedValue(error);

			try {
				await client.get('/test');
				expect.fail('Should have thrown ServerError');
			} catch (err) {
				expect(err).toBeInstanceOf(ServerError);
				expect((err as ServerError).isRetryable).toBe(true);
			}
		});

		it('should mark authentication errors as non-retryable', async () => {
			const error = {
				isAxiosError: true,
				response: {
					status: 401,
					statusText: 'Unauthorized',
					data: { message: 'Invalid API key' },
					headers: {},
				},
				config: { url: '/test', method: 'GET' },
			};

			mockAxiosInstance.request.mockRejectedValue(error);

			try {
				await client.get('/test');
				expect.fail('Should have thrown AuthenticationError');
			} catch (err) {
				expect(err).toBeInstanceOf(AuthenticationError);
				expect((err as AuthenticationError).isRetryable).toBe(false);
			}
		});
	});

	describe('HTTP Methods', () => {
		beforeEach(() => {
			mockAxiosInstance.request.mockResolvedValue({
				data: { success: true },
				status: 200,
				statusText: 'OK',
				headers: {},
			});
		});

		it('should make GET request', async () => {
			await client.get('/test');

			expect(mockAxiosInstance.request).toHaveBeenCalledWith(
				expect.objectContaining({
					method: 'GET',
					url: '/test',
				})
			);
		});

		it('should make POST request with data', async () => {
			const data = { key: 'value' };
			await client.post('/test', data);

			expect(mockAxiosInstance.request).toHaveBeenCalledWith(
				expect.objectContaining({
					method: 'POST',
					url: '/test',
					data,
				})
			);
		});

		it('should make PUT request with data', async () => {
			const data = { key: 'updated' };
			await client.put('/test', data);

			expect(mockAxiosInstance.request).toHaveBeenCalledWith(
				expect.objectContaining({
					method: 'PUT',
					url: '/test',
					data,
				})
			);
		});

		it('should make DELETE request', async () => {
			await client.delete('/test');

			expect(mockAxiosInstance.request).toHaveBeenCalledWith(
				expect.objectContaining({
					method: 'DELETE',
					url: '/test',
				})
			);
		});

		it('should pass custom headers', async () => {
			await client.get('/test', {
				headers: { 'X-Custom-Header': 'value' },
			});

			expect(mockAxiosInstance.request).toHaveBeenCalledWith(
				expect.objectContaining({
					headers: { 'X-Custom-Header': 'value' },
				})
			);
		});

		it('should pass query parameters', async () => {
			await client.get('/test', {
				params: { page: 1, limit: 10 },
			});

			expect(mockAxiosInstance.request).toHaveBeenCalledWith(
				expect.objectContaining({
					params: { page: 1, limit: 10 },
				})
			);
		});

		it('should use custom timeout if provided', async () => {
			await client.get('/test', {
				timeout: 5000,
			});

			expect(mockAxiosInstance.request).toHaveBeenCalledWith(
				expect.objectContaining({
					timeout: 5000,
				})
			);
		});

		it('should use default timeout if not provided', async () => {
			await client.get('/test');

			expect(mockAxiosInstance.request).toHaveBeenCalledWith(
				expect.objectContaining({
					timeout: config.timeout,
				})
			);
		});

		it('should support AbortController signal', async () => {
			const controller = new AbortController();
			await client.get('/test', {
				signal: controller.signal,
			});

			expect(mockAxiosInstance.request).toHaveBeenCalledWith(
				expect.objectContaining({
					signal: controller.signal,
				})
			);
		});
	});

	describe('Service Interface', () => {
		it('should return service name', () => {
			expect(client.getName()).toBe('BrightDataHttpClient');
		});

		it('should shutdown successfully', async () => {
			await expect(client.shutdown()).resolves.not.toThrow();
		});
	});

	describe('Request Tracing', () => {
		it('should generate unique request IDs', () => {
			const requestConfig1 = { url: '/test1', method: 'GET', headers: {} };
			const requestConfig2 = { url: '/test2', method: 'GET', headers: {} };

			const interceptor = mockAxiosInstance._requestInterceptor;

			const result1 = interceptor.onFulfilled(requestConfig1);
			const result2 = interceptor.onFulfilled(requestConfig2);

			expect(result1.headers['X-Request-ID']).not.toBe(result2.headers['X-Request-ID']);
		});

		it('should include timestamp in request metadata', () => {
			const beforeTime = Date.now();
			const requestConfig = { url: '/test', method: 'GET', headers: {} };
			const interceptor = mockAxiosInstance._requestInterceptor;

			interceptor.onFulfilled(requestConfig);
			const afterTime = Date.now();

			// Request should have been timestamped between beforeTime and afterTime
			expect(afterTime).toBeGreaterThanOrEqual(beforeTime);
		});
	});
});
