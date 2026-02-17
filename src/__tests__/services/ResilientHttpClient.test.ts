import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ResilientHttpClient } from '@/services/ResilientHttpClient';
import { CircuitBreakerState, CircuitBreakerOpenError } from '@/types/circuit-breaker';
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

describe('ResilientHttpClient', () => {
	let client: ResilientHttpClient;

	beforeEach(() => {
		__setRequestUrlHandler(null);
		client = new ResilientHttpClient({
			baseURL: 'https://api.brightdata.com',
			timeout: 30000,
			apiKey: 'test-key',
			circuitBreaker: {
				failureThreshold: 3,
				successThreshold: 2,
				timeout: 100, // Fast timeout for tests
			},
		});
	});

	afterEach(() => {
		__setRequestUrlHandler(null);
	});

	describe('Initialization', () => {
		it('should create HTTP client and circuit breaker', () => {
			expect(client.getName()).toBe('ResilientHttpClient');
			expect(client.getCircuitBreaker()).toBeDefined();
			expect(client.getHttpClient()).toBeDefined();
		});

		it('should start with closed circuit', () => {
			const metrics = client.getCircuitMetrics();
			expect(metrics.state).toBe(CircuitBreakerState.CLOSED);
			expect(client.isCircuitOpen()).toBe(false);
		});
	});

	describe('Request Execution with Circuit Breaker', () => {
		it('should execute successful requests', async () => {
			__setRequestUrlHandler(async () => makeSuccessResponse({ success: true }));

			const response = await client.get('/test');

			expect(response.data).toEqual({ success: true });
			expect(response.status).toBe(200);
		});

		it('should track successful requests in metrics', async () => {
			__setRequestUrlHandler(async () => makeSuccessResponse({ success: true }));

			await client.get('/test');
			await client.get('/test');

			const metrics = client.getCircuitMetrics();
			expect(metrics.successfulRequests).toBe(2);
			expect(metrics.totalRequests).toBe(2);
		});

		it('should open circuit after failure threshold', async () => {
			__setRequestUrlHandler(async () => makeErrorResponse(500, 'Server error'));

			// Execute 3 failing requests (threshold = 3)
			for (let i = 0; i < 3; i++) {
				try {
					await client.get('/test');
				} catch (err) {
					// Expected
				}
			}

			expect(client.isCircuitOpen()).toBe(true);
		});

		it('should reject requests when circuit is open', async () => {
			__setRequestUrlHandler(async () => makeErrorResponse(500, 'Server error'));

			// Open circuit
			for (let i = 0; i < 3; i++) {
				try {
					await client.get('/test');
				} catch (err) {
					// Expected
				}
			}

			// Next request should be rejected immediately
			await expect(client.get('/test')).rejects.toThrow(CircuitBreakerOpenError);
		});

		it('should not invoke HTTP client when circuit is open', async () => {
			let callCount = 0;
			__setRequestUrlHandler(async () => {
				callCount++;
				return makeErrorResponse(500, 'Server error');
			});

			// Open circuit
			for (let i = 0; i < 3; i++) {
				try {
					await client.get('/test');
				} catch (err) {
					// Expected
				}
			}

			const countBeforeReject = callCount;

			// Try request with open circuit
			try {
				await client.get('/test');
			} catch (err) {
				// Expected
			}

			// Should not have called requestUrl again
			expect(callCount).toBe(countBeforeReject);
		});
	});

	describe('Circuit Recovery', () => {
		it('should transition to half-open after timeout', async () => {
			__setRequestUrlHandler(async () => makeErrorResponse(500, 'Server error'));

			// Open circuit
			for (let i = 0; i < 3; i++) {
				try {
					await client.get('/test');
				} catch (err) {
					// Expected
				}
			}

			expect(client.isCircuitOpen()).toBe(true);

			// Wait for timeout (100ms in config)
			await new Promise(resolve => setTimeout(resolve, 150));

			// Mock successful response for recovery
			__setRequestUrlHandler(async () => makeSuccessResponse({ success: true }));

			// This should trigger half-open transition
			await client.get('/test');

			const metrics = client.getCircuitMetrics();
			expect(metrics.state).toBe(CircuitBreakerState.HALF_OPEN);
		});

		it('should close circuit after success threshold in half-open', async () => {
			__setRequestUrlHandler(async () => makeErrorResponse(500, 'Server error'));

			// Open circuit
			for (let i = 0; i < 3; i++) {
				try {
					await client.get('/test');
				} catch (err) {
					// Expected
				}
			}

			// Wait for half-open
			await new Promise(resolve => setTimeout(resolve, 150));

			// Mock successful responses (need successThreshold = 2 successes)
			__setRequestUrlHandler(async () => makeSuccessResponse({ success: true }));

			await client.get('/test'); // half-open
			await client.get('/test'); // close

			const metrics = client.getCircuitMetrics();
			expect(metrics.state).toBe(CircuitBreakerState.CLOSED);
		});
	});

	describe('HTTP Methods with Circuit Breaker', () => {
		beforeEach(() => {
			__setRequestUrlHandler(async () => makeSuccessResponse({ success: true }));
		});

		it('should execute GET request', async () => {
			const captured: any[] = [];
			__setRequestUrlHandler(async (params) => {
				captured.push(params);
				return makeSuccessResponse({ success: true });
			});

			const response = await client.get('/test');

			expect(response.data).toEqual({ success: true });
			expect(captured[0].method).toBe('GET');
			expect(captured[0].url).toBe('https://api.brightdata.com/test');
		});

		it('should execute POST request', async () => {
			const data = { key: 'value' };
			const captured: any[] = [];
			__setRequestUrlHandler(async (params) => {
				captured.push(params);
				return makeSuccessResponse({ success: true });
			});

			await client.post('/test', data);

			expect(captured[0].method).toBe('POST');
			expect(captured[0].body).toBe(JSON.stringify(data));
		});

		it('should execute PUT request', async () => {
			const data = { key: 'updated' };
			const captured: any[] = [];
			__setRequestUrlHandler(async (params) => {
				captured.push(params);
				return makeSuccessResponse({ success: true });
			});

			await client.put('/test', data);

			expect(captured[0].method).toBe('PUT');
			expect(captured[0].body).toBe(JSON.stringify(data));
		});

		it('should execute DELETE request', async () => {
			const captured: any[] = [];
			__setRequestUrlHandler(async (params) => {
				captured.push(params);
				return makeSuccessResponse({ success: true });
			});

			await client.delete('/test');

			expect(captured[0].method).toBe('DELETE');
			expect(captured[0].url).toBe('https://api.brightdata.com/test');
		});
	});

	describe('Circuit Management', () => {
		it('should manually reset circuit', async () => {
			__setRequestUrlHandler(async () => makeErrorResponse(500, 'Server error'));

			// Open circuit
			for (let i = 0; i < 3; i++) {
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
			const metrics = client.getCircuitMetrics();
			expect(metrics.state).toBe(CircuitBreakerState.CLOSED);
			expect(metrics.totalRequests).toBe(0);
		});

		it('should provide circuit breaker metrics', async () => {
			__setRequestUrlHandler(async () => makeSuccessResponse({ success: true }));

			await client.get('/test');
			await client.get('/test');

			const metrics = client.getCircuitMetrics();

			expect(metrics.totalRequests).toBe(2);
			expect(metrics.successfulRequests).toBe(2);
			expect(metrics.failedRequests).toBe(0);
			expect(metrics.successRate).toBe(1);
		});
	});

	describe('Service Lifecycle', () => {
		it('should initialize successfully', async () => {
			await expect(client.initialize()).resolves.not.toThrow();
		});

		it('should shutdown cleanly', async () => {
			await expect(client.shutdown()).resolves.not.toThrow();
		});
	});
});
