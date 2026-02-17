import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
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
import { requestUrl, __setRequestUrlHandler } from 'obsidian';

// Spy on requestUrl from the Obsidian mock
const requestUrlSpy = vi.spyOn({ requestUrl }, 'requestUrl');

describe('BrightDataHttpClient', () => {
	let client: BrightDataHttpClient;
	const config: HttpClientConfig = {
		baseURL: 'https://api.brightdata.com',
		timeout: 30000,
		apiKey: 'test-api-key-123',
	};

	beforeEach(() => {
		__setRequestUrlHandler(null);
		client = new BrightDataHttpClient(config);
	});

	afterEach(() => {
		__setRequestUrlHandler(null);
	});

	describe('Initialization', () => {
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

	describe('HTTP Methods', () => {
		it('should make GET request', async () => {
			const captured: any[] = [];
			__setRequestUrlHandler(async (params) => {
				captured.push(params);
				return {
					status: 200,
					headers: {},
					text: '{"success":true}',
					json: { success: true },
					arrayBuffer: new ArrayBuffer(0),
				};
			});

			await client.get('/test');

			expect(captured).toHaveLength(1);
			expect(captured[0].url).toBe('https://api.brightdata.com/test');
			expect(captured[0].method).toBe('GET');
		});

		it('should make POST request with data', async () => {
			const data = { key: 'value' };
			const captured: any[] = [];
			__setRequestUrlHandler(async (params) => {
				captured.push(params);
				return {
					status: 200,
					headers: {},
					text: '{"success":true}',
					json: { success: true },
					arrayBuffer: new ArrayBuffer(0),
				};
			});

			await client.post('/test', data);

			expect(captured[0].method).toBe('POST');
			expect(captured[0].body).toBe(JSON.stringify(data));
		});

		it('should make PUT request with data', async () => {
			const data = { key: 'updated' };
			const captured: any[] = [];
			__setRequestUrlHandler(async (params) => {
				captured.push(params);
				return {
					status: 200,
					headers: {},
					text: '{}',
					json: {},
					arrayBuffer: new ArrayBuffer(0),
				};
			});

			await client.put('/test', data);

			expect(captured[0].method).toBe('PUT');
			expect(captured[0].body).toBe(JSON.stringify(data));
		});

		it('should make DELETE request', async () => {
			const captured: any[] = [];
			__setRequestUrlHandler(async (params) => {
				captured.push(params);
				return {
					status: 200,
					headers: {},
					text: '{}',
					json: {},
					arrayBuffer: new ArrayBuffer(0),
				};
			});

			await client.delete('/test');

			expect(captured[0].method).toBe('DELETE');
		});

		it('should pass custom headers', async () => {
			const captured: any[] = [];
			__setRequestUrlHandler(async (params) => {
				captured.push(params);
				return {
					status: 200,
					headers: {},
					text: '{}',
					json: {},
					arrayBuffer: new ArrayBuffer(0),
				};
			});

			await client.get('/test', {
				headers: { 'X-Custom-Header': 'value' },
			});

			expect(captured[0].headers['X-Custom-Header']).toBe('value');
		});

		it('should append query parameters to URL', async () => {
			const captured: any[] = [];
			__setRequestUrlHandler(async (params) => {
				captured.push(params);
				return {
					status: 200,
					headers: {},
					text: '{}',
					json: {},
					arrayBuffer: new ArrayBuffer(0),
				};
			});

			await client.get('/test', {
				params: { page: 1, limit: 10 },
			});

			expect(captured[0].url).toContain('page=1');
			expect(captured[0].url).toContain('limit=10');
		});

		it('should add Authorization header with API key', async () => {
			const captured: any[] = [];
			__setRequestUrlHandler(async (params) => {
				captured.push(params);
				return {
					status: 200,
					headers: {},
					text: '{}',
					json: {},
					arrayBuffer: new ArrayBuffer(0),
				};
			});

			await client.get('/test');

			expect(captured[0].headers['Authorization']).toBe(`Bearer ${config.apiKey}`);
		});

		it('should add X-Request-ID header', async () => {
			const captured: any[] = [];
			__setRequestUrlHandler(async (params) => {
				captured.push(params);
				return {
					status: 200,
					headers: {},
					text: '{}',
					json: {},
					arrayBuffer: new ArrayBuffer(0),
				};
			});

			await client.get('/test');

			expect(captured[0].headers['X-Request-ID']).toMatch(/^req_\d+_[a-z0-9]+$/);
		});
	});

	describe('Error Transformation', () => {
		it('should transform 429 rate limit error', async () => {
			__setRequestUrlHandler(async () => ({
				status: 429,
				headers: {
					'x-ratelimit-limit': '100',
					'x-ratelimit-remaining': '0',
					'retry-after': '60',
				},
				text: '{"message":"Rate limit exceeded"}',
				json: { message: 'Rate limit exceeded' },
				arrayBuffer: new ArrayBuffer(0),
			}));

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
			__setRequestUrlHandler(async () => ({
				status: 401,
				headers: {},
				text: '{"message":"Invalid API key"}',
				json: { message: 'Invalid API key' },
				arrayBuffer: new ArrayBuffer(0),
			}));

			await expect(client.get('/test')).rejects.toThrow(AuthenticationError);
		});

		it('should transform 403 authorization error', async () => {
			__setRequestUrlHandler(async () => ({
				status: 403,
				headers: {},
				text: '{"message":"Insufficient permissions"}',
				json: { message: 'Insufficient permissions' },
				arrayBuffer: new ArrayBuffer(0),
			}));

			await expect(client.get('/test')).rejects.toThrow(AuthenticationError);
		});

		it('should transform 400 bad request error', async () => {
			__setRequestUrlHandler(async () => ({
				status: 400,
				headers: {},
				text: '{"message":"Invalid URL","errors":["URL format is invalid"]}',
				json: { message: 'Invalid URL', errors: ['URL format is invalid'] },
				arrayBuffer: new ArrayBuffer(0),
			}));

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
			__setRequestUrlHandler(async () => ({
				status: 500,
				headers: {},
				text: '{"message":"Server error"}',
				json: { message: 'Server error' },
				arrayBuffer: new ArrayBuffer(0),
			}));

			await expect(client.get('/test')).rejects.toThrow(ServerError);
		});

		it('should mark server errors as retryable', async () => {
			__setRequestUrlHandler(async () => ({
				status: 503,
				headers: {},
				text: '{"message":"Service temporarily unavailable"}',
				json: { message: 'Service temporarily unavailable' },
				arrayBuffer: new ArrayBuffer(0),
			}));

			try {
				await client.get('/test');
				expect.fail('Should have thrown ServerError');
			} catch (err) {
				expect(err).toBeInstanceOf(ServerError);
				expect((err as ServerError).isRetryable).toBe(true);
			}
		});

		it('should mark authentication errors as non-retryable', async () => {
			__setRequestUrlHandler(async () => ({
				status: 401,
				headers: {},
				text: '{"message":"Invalid API key"}',
				json: { message: 'Invalid API key' },
				arrayBuffer: new ArrayBuffer(0),
			}));

			try {
				await client.get('/test');
				expect.fail('Should have thrown AuthenticationError');
			} catch (err) {
				expect(err).toBeInstanceOf(AuthenticationError);
				expect((err as AuthenticationError).isRetryable).toBe(false);
			}
		});

		it('should transform network errors', async () => {
			__setRequestUrlHandler(async () => {
				throw new Error('ENOTFOUND api.brightdata.com');
			});

			await expect(client.get('/test')).rejects.toThrow(NetworkError);
		});

		it('should transform timeout errors', async () => {
			__setRequestUrlHandler(async () => {
				throw new Error('timeout exceeded');
			});

			await expect(client.get('/test')).rejects.toThrow(TimeoutError);
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
		it('should generate unique request IDs', async () => {
			const capturedIds: string[] = [];
			__setRequestUrlHandler(async (params) => {
				capturedIds.push(params.headers?.['X-Request-ID'] ?? '');
				return {
					status: 200,
					headers: {},
					text: '{}',
					json: {},
					arrayBuffer: new ArrayBuffer(0),
				};
			});

			await client.get('/test1');
			await client.get('/test2');

			expect(capturedIds).toHaveLength(2);
			expect(capturedIds[0]).not.toBe(capturedIds[1]);
		});
	});

	describe('Abort Signal Support', () => {
		it('should reject immediately if signal is already aborted', async () => {
			const controller = new AbortController();
			controller.abort();

			await expect(
				client.get('/test', { signal: controller.signal })
			).rejects.toThrow('aborted');
		});
	});
});
