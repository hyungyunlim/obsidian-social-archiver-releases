import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RetryableHttpClient } from '@/services/RetryableHttpClient';
import { __setRequestUrlHandler } from 'obsidian';

function makeSuccessResponse(data: unknown = { success: true }) {
	return {
		status: 200,
		headers: {},
		json: data,
		text: JSON.stringify(data),
		arrayBuffer: new ArrayBuffer(0),
	};
}

function makeErrorResponse(status: number, message = 'Error') {
	return {
		status,
		headers: {},
		json: { message },
		text: JSON.stringify({ message }),
		arrayBuffer: new ArrayBuffer(0),
	};
}

describe('RetryableHttpClient', () => {
	let client: RetryableHttpClient;

	beforeEach(() => {
		__setRequestUrlHandler(null);
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

	afterEach(() => {
		__setRequestUrlHandler(null);
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
			__setRequestUrlHandler(async () => makeSuccessResponse({ success: true }));

			const response = await client.get('/test');

			expect(response.data).toEqual({ success: true });
		});

		it('should retry on failure and succeed', async () => {
			let callCount = 0;
			__setRequestUrlHandler(async () => {
				callCount++;
				if (callCount < 3) {
					return makeErrorResponse(500, 'Server error');
				}
				return makeSuccessResponse({ success: true });
			});

			const response = await client.get('/test');

			expect(response.data).toEqual({ success: true });
			expect(callCount).toBe(3);
		});

		it('should fail after max retry attempts', async () => {
			let callCount = 0;
			__setRequestUrlHandler(async () => {
				callCount++;
				return makeErrorResponse(500, 'Server error');
			});

			await expect(client.get('/test')).rejects.toThrow();
			// initial + maxAttempts (3) = 4 total
			expect(callCount).toBe(4);
		});
	});

	describe('HTTP Methods with Retries', () => {
		beforeEach(() => {
			__setRequestUrlHandler(async () => makeSuccessResponse({ success: true }));
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
			let callCount = 0;
			__setRequestUrlHandler(async () => {
				callCount++;
				return makeErrorResponse(500, 'Server error');
			});

			// Open circuit breaker by exceeding failureThreshold (5 in config)
			// Each attempt may retry up to maxAttempts times, so we need to do 5 individual
			// "outer" call chains that each eventually fail
			for (let i = 0; i < 5; i++) {
				try {
					await client.get('/test');
				} catch (err) {
					// Expected
				}
			}

			// Circuit should be open now
			expect(client.isCircuitOpen()).toBe(true);

			const countBefore = callCount;

			// Next request should be rejected immediately by circuit breaker
			try {
				await client.get('/test');
			} catch (err) {
				// Expected
			}

			// No additional HTTP requests should be made
			expect(callCount).toBe(countBefore);
		});

		it('should provide circuit metrics', () => {
			const metrics = client.getCircuitMetrics();

			expect(metrics).toBeDefined();
			expect(metrics.state).toBeDefined();
			expect(metrics.totalRequests).toBeDefined();
		});

		it('should reset circuit', async () => {
			let callCount = 0;
			__setRequestUrlHandler(async () => {
				callCount++;
				return makeErrorResponse(500, 'Server error');
			});

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
			let callCount = 0;
			__setRequestUrlHandler(async () => {
				callCount++;
				return makeErrorResponse(401, 'Invalid API key');
			});

			await expect(client.get('/test')).rejects.toThrow();

			// Should only attempt once (no retries for 401)
			expect(callCount).toBe(1);
		});

		it('should not retry on bad request errors', async () => {
			let callCount = 0;
			__setRequestUrlHandler(async () => {
				callCount++;
				return makeErrorResponse(400, 'Invalid URL');
			});

			await expect(client.get('/test')).rejects.toThrow();

			// Should only attempt once (no retries for 400)
			expect(callCount).toBe(1);
		});
	});

	describe('Retry with Rate Limits', () => {
		it('should retry on rate limit errors', async () => {
			let callCount = 0;
			__setRequestUrlHandler(async () => {
				callCount++;
				if (callCount === 1) {
					return {
						status: 429,
						headers: {
							'x-ratelimit-remaining': '0',
							'retry-after': '0', // 0 seconds for fast test
						},
						json: { message: 'Rate limit exceeded' },
						text: '{"message":"Rate limit exceeded"}',
						arrayBuffer: new ArrayBuffer(0),
					};
				}
				return makeSuccessResponse({ success: true });
			});

			const response = await client.get('/test');

			expect(response.data).toEqual({ success: true });
			expect(callCount).toBe(2);
		});
	});
});
