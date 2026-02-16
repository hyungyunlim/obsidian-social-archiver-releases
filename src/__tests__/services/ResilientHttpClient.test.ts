import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ResilientHttpClient } from '@/services/ResilientHttpClient';
import { CircuitBreakerState, CircuitBreakerOpenError } from '@/types/circuit-breaker';
import axios from 'axios';

// Mock axios
vi.mock('axios');

describe('ResilientHttpClient', () => {
	let client: ResilientHttpClient;
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
			mockAxiosInstance.request.mockResolvedValue({
				data: { success: true },
				status: 200,
				statusText: 'OK',
				headers: {},
			});

			const response = await client.get('/test');

			expect(response.data).toEqual({ success: true });
			expect(response.status).toBe(200);
		});

		it('should track successful requests in metrics', async () => {
			mockAxiosInstance.request.mockResolvedValue({
				data: { success: true },
				status: 200,
				statusText: 'OK',
				headers: {},
			});

			await client.get('/test');
			await client.get('/test');

			const metrics = client.getCircuitMetrics();
			expect(metrics.successfulRequests).toBe(2);
			expect(metrics.totalRequests).toBe(2);
		});

		it('should open circuit after failure threshold', async () => {
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

			// Execute 3 failing requests (threshold)
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
			for (let i = 0; i < 3; i++) {
				try {
					await client.get('/test');
				} catch (err) {
					// Expected
				}
			}

			const callCountBeforeReject = mockAxiosInstance.request.mock.calls.length;

			// Try request with open circuit
			try {
				await client.get('/test');
			} catch (err) {
				// Expected
			}

			// Should not have called axios
			expect(mockAxiosInstance.request.mock.calls.length).toBe(callCountBeforeReject);
		});
	});

	describe('Circuit Recovery', () => {
		it('should transition to half-open after timeout', async () => {
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
			for (let i = 0; i < 3; i++) {
				try {
					await client.get('/test');
				} catch (err) {
					// Expected
				}
			}

			expect(client.isCircuitOpen()).toBe(true);

			// Wait for timeout
			await new Promise(resolve => setTimeout(resolve, 150));

			// Mock successful response for recovery
			mockAxiosInstance.request.mockResolvedValue({
				data: { success: true },
				status: 200,
				statusText: 'OK',
				headers: {},
			});

			// This should trigger half-open transition
			await client.get('/test');

			const metrics = client.getCircuitMetrics();
			expect(metrics.state).toBe(CircuitBreakerState.HALF_OPEN);
		});

		it('should close circuit after success threshold in half-open', async () => {
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
			for (let i = 0; i < 3; i++) {
				try {
					await client.get('/test');
				} catch (err) {
					// Expected
				}
			}

			// Wait for half-open
			await new Promise(resolve => setTimeout(resolve, 150));

			// Mock successful responses
			mockAxiosInstance.request.mockResolvedValue({
				data: { success: true },
				status: 200,
				statusText: 'OK',
				headers: {},
			});

			// Execute success threshold requests (2 in config)
			await client.get('/test'); // half-open
			await client.get('/test'); // close

			const metrics = client.getCircuitMetrics();
			expect(metrics.state).toBe(CircuitBreakerState.CLOSED);
		});
	});

	describe('HTTP Methods with Circuit Breaker', () => {
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
			expect(mockAxiosInstance.request).toHaveBeenCalledWith(
				expect.objectContaining({
					method: 'GET',
					url: '/test',
				})
			);
		});

		it('should execute POST request', async () => {
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

		it('should execute PUT request', async () => {
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

		it('should execute DELETE request', async () => {
			await client.delete('/test');

			expect(mockAxiosInstance.request).toHaveBeenCalledWith(
				expect.objectContaining({
					method: 'DELETE',
					url: '/test',
				})
			);
		});
	});

	describe('Circuit Management', () => {
		it('should manually reset circuit', async () => {
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
			mockAxiosInstance.request.mockResolvedValue({
				data: { success: true },
				status: 200,
				statusText: 'OK',
				headers: {},
			});

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
