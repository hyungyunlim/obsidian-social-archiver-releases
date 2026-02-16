import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetryableHttpClient } from '@/services/RetryableHttpClient';
import axios from 'axios';

// Mock axios
vi.mock('axios');

describe('RetryableHttpClient', () => {
	let client: RetryableHttpClient;
	let mockAxiosInstance: any;

	beforeEach(() => {
		mockAxiosInstance = {
			request: vi.fn(),
			interceptors: {
				request: {
					use: vi.fn(() => 0),
					eject: vi.fn(),
				},
				response: {
					use: vi.fn(() => 0),
					eject: vi.fn(),
				},
			},
		};

		vi.mocked(axios.create).mockReturnValue(mockAxiosInstance as any);
		vi.mocked(axios.isAxiosError).mockReturnValue(false);

		client = new RetryableHttpClient({
			baseURL: 'https://api.brightdata.com',
			timeout: 30000,
			apiKey: 'test-key',
			circuitBreaker: {
				failureThreshold: 5,
				successThreshold: 3,
				timeout: 60000,
			},
			retry: {
				maxAttempts: 3,
				baseDelay: 10, // Fast retries for tests
				maxDelay: 100,
				jitterRange: 5,
			},
		});
	});

	describe('Initialization', () => {
		it('should create retryable HTTP client', () => {
			expect(client.getName()).toBe('RetryableHttpClient');
		});

		it('should initialize successfully', async () => {
			await expect(client.initialize()).resolves.not.toThrow();
		});

		it('should have resilient client', () => {
			expect(client.getResilientClient()).toBeDefined();
		});

		it('should have backoff instance', () => {
			expect(client.getBackoff()).toBeDefined();
		});

		it('should have circuit breaker access', () => {
			expect(client.getCircuitBreaker()).toBeDefined();
		});
	});

	describe('Request Execution with Retries', () => {
		it('should succeed on first attempt', async () => {
			mockAxiosInstance.request.mockResolvedValue({
				data: { success: true },
				status: 200,
				statusText: 'OK',
				headers: {},
			});

			const response = await client.get('/test');

			expect(response.data).toEqual({ success: true });
			expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
		});

		it('should retry on failure and succeed', async () => {
			vi.mocked(axios.isAxiosError).mockReturnValue(true);

			const error = {
				isAxiosError: true,
				response: {
					status: 500,
					statusText: 'Internal Server Error',
					data: { error: 'Server error' },
					headers: {},
				},
				config: { url: '/test', method: 'GET' },
			};

			mockAxiosInstance.request
				.mockRejectedValueOnce(error)
				.mockRejectedValueOnce(error)
				.mockResolvedValue({
					data: { success: true },
					status: 200,
					statusText: 'OK',
					headers: {},
				});

			const response = await client.get('/test');

			expect(response.data).toEqual({ success: true });
			expect(mockAxiosInstance.request).toHaveBeenCalledTimes(3);
		});

		it('should fail after max retry attempts', async () => {
			vi.mocked(axios.isAxiosError).mockReturnValue(true);

			const error = {
				isAxiosError: true,
				response: {
					status: 500,
					statusText: 'Internal Server Error',
					data: { error: 'Server error' },
					headers: {},
				},
				config: { url: '/test', method: 'GET' },
			};

			mockAxiosInstance.request.mockRejectedValue(error);

			await expect(client.get('/test')).rejects.toThrow();
			expect(mockAxiosInstance.request).toHaveBeenCalledTimes(4); // Initial + 3 retries
		});
	});

	describe('HTTP Methods with Retries', () => {
		beforeEach(() => {
			mockAxiosInstance.request.mockResolvedValue({
				data: { success: true },
				status: 200,
				statusText: 'OK',
				headers: {},
			});
		});

		it('should execute GET request', async () => {
			const response = await client.get('/test');

			expect(response.data).toEqual({ success: true });
		});

		it('should execute POST request', async () => {
			const data = { key: 'value' };
			const response = await client.post('/test', data);

			expect(response.data).toEqual({ success: true });
		});

		it('should execute PUT request', async () => {
			const data = { key: 'updated' };
			const response = await client.put('/test', data);

			expect(response.data).toEqual({ success: true });
		});

		it('should execute DELETE request', async () => {
			const response = await client.delete('/test');

			expect(response.data).toEqual({ success: true });
		});
	});

	describe('Circuit Breaker Integration', () => {
		it('should not retry when circuit is open', async () => {
			vi.mocked(axios.isAxiosError).mockReturnValue(true);

			const error = {
				isAxiosError: true,
				response: {
					status: 500,
					statusText: 'Internal Server Error',
					data: { error: 'Server error' },
					headers: {},
				},
				config: { url: '/test', method: 'GET' },
			};

			mockAxiosInstance.request.mockRejectedValue(error);

			// Open circuit breaker (5 failures by default)
			for (let i = 0; i < 5; i++) {
				try {
					await client.get('/test');
				} catch (err) {
					// Expected
				}
			}

			// Circuit should be open now
			expect(client.isCircuitOpen()).toBe(true);

			const requestCountBefore = mockAxiosInstance.request.mock.calls.length;

			// Next request should be rejected immediately by circuit breaker
			try {
				await client.get('/test');
			} catch (err) {
				// Expected
			}

			// No additional HTTP requests should be made
			expect(mockAxiosInstance.request.mock.calls.length).toBe(requestCountBefore);
		});

		it('should provide circuit metrics', () => {
			const metrics = client.getCircuitMetrics();

			expect(metrics).toBeDefined();
			expect(metrics.state).toBeDefined();
			expect(metrics.totalRequests).toBeDefined();
		});

		it('should reset circuit', async () => {
			vi.mocked(axios.isAxiosError).mockReturnValue(true);

			const error = {
				isAxiosError: true,
				response: {
					status: 500,
					statusText: 'Internal Server Error',
					data: { error: 'Server error' },
					headers: {},
				},
				config: { url: '/test', method: 'GET' },
			};

			mockAxiosInstance.request.mockRejectedValue(error);

			// Open circuit
			for (let i = 0; i < 5; i++) {
				try {
					await client.get('/test');
				} catch (err) {
					// Expected
				}
			}

			expect(client.isCircuitOpen()).toBe(true);

			// Reset circuit
			client.resetCircuit();

			expect(client.isCircuitOpen()).toBe(false);
		});
	});

	describe('Abort Controller Support', () => {
		it('should support request cancellation', async () => {
			const controller = new AbortController();

			// Immediately abort
			controller.abort();

			mockAxiosInstance.request.mockResolvedValue({
				data: { success: true },
				status: 200,
				statusText: 'OK',
				headers: {},
			});

			await expect(
				client.get('/test', { signal: controller.signal })
			).rejects.toThrow('abort');
		});
	});

	describe('Service Lifecycle', () => {
		it('should shutdown cleanly', async () => {
			await expect(client.shutdown()).resolves.not.toThrow();
		});
	});

	describe('Retry with Non-Retryable Errors', () => {
		it('should not retry on authentication errors', async () => {
			vi.mocked(axios.isAxiosError).mockReturnValue(true);

			const error = {
				isAxiosError: true,
				response: {
					status: 401,
					statusText: 'Unauthorized',
					data: { error: 'Invalid API key' },
					headers: {},
				},
				config: { url: '/test', method: 'GET' },
			};

			mockAxiosInstance.request.mockRejectedValue(error);

			await expect(client.get('/test')).rejects.toThrow();

			// Should only attempt once (no retries for 401)
			expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
		});

		it('should not retry on bad request errors', async () => {
			vi.mocked(axios.isAxiosError).mockReturnValue(true);

			const error = {
				isAxiosError: true,
				response: {
					status: 400,
					statusText: 'Bad Request',
					data: { error: 'Invalid URL' },
					headers: {},
				},
				config: { url: '/test', method: 'GET' },
			};

			mockAxiosInstance.request.mockRejectedValue(error);

			await expect(client.get('/test')).rejects.toThrow();

			// Should only attempt once (no retries for 400)
			expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
		});
	});

	describe('Retry with Rate Limits', () => {
		it('should retry on rate limit errors', async () => {
			vi.mocked(axios.isAxiosError).mockReturnValue(true);

			const rateLimitError = {
				isAxiosError: true,
				response: {
					status: 429,
					statusText: 'Too Many Requests',
					data: { error: 'Rate limit exceeded' },
					headers: {
						'x-ratelimit-remaining': '0',
						'retry-after': '60',
					},
				},
				config: { url: '/test', method: 'GET' },
			};

			mockAxiosInstance.request
				.mockRejectedValueOnce(rateLimitError)
				.mockResolvedValue({
					data: { success: true },
					status: 200,
					statusText: 'OK',
					headers: {},
				});

			const response = await client.get('/test');

			expect(response.data).toEqual({ success: true });
			expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2);
		});
	});
});
