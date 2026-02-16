import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RequestQueueManager, QueueOverflowError, QueueTimeoutError } from '@/services/RequestQueueManager';
import type { Logger } from '@/services/Logger';
import { QueuePriority } from '@/types/queue';

// Helper to create delay
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('RequestQueueManager', () => {
	let queueManager: RequestQueueManager;
	let mockLogger: Logger;

	beforeEach(() => {
		mockLogger = {
			info: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
			debug: vi.fn(),
		} as unknown as Logger;

		queueManager = new RequestQueueManager(mockLogger, {
			concurrency: 2,
			maxSize: 5,
			timeout: 1000,
			autoStart: true,
		});
	});

	describe('Service lifecycle', () => {
		it('should initialize', async () => {
			await queueManager.initialize();
			expect(mockLogger.info).toHaveBeenCalledWith(
				'RequestQueueManager initialized',
				expect.any(Object)
			);
		});

		it('should shutdown gracefully', async () => {
			const task = vi.fn().mockResolvedValue('result');
			await queueManager.add(task);

			await queueManager.shutdown();

			expect(mockLogger.info).toHaveBeenCalledWith('RequestQueueManager shutdown complete');
		});
	});

	describe('Basic queue operations', () => {
		it('should add and execute tasks', async () => {
			const task = vi.fn().mockResolvedValue('result');

			const result = await queueManager.add(task);

			expect(result).toBe('result');
			expect(task).toHaveBeenCalledTimes(1);
		});

		it('should handle multiple tasks', async () => {
			const tasks = [
				vi.fn().mockResolvedValue('result1'),
				vi.fn().mockResolvedValue('result2'),
				vi.fn().mockResolvedValue('result3'),
			];

			const results = await Promise.all(tasks.map((task) => queueManager.add(task)));

			expect(results).toEqual(['result1', 'result2', 'result3']);
		});

		it('should respect concurrency limit', async () => {
			let activeCount = 0;
			let maxActive = 0;

			const createTask = () => async () => {
				activeCount++;
				maxActive = Math.max(maxActive, activeCount);
				await delay(50);
				activeCount--;
				return 'done';
			};

			const promises = Array.from({ length: 10 }, () => queueManager.add(createTask()));

			await Promise.all(promises);

			expect(maxActive).toBeLessThanOrEqual(2); // concurrency = 2
		});
	});

	describe('Priority handling', () => {
		it('should process higher priority tasks first', async () => {
			const executionOrder: number[] = [];

			// Fill queue with tasks
			const tasks = [
				queueManager.add(
					async () => {
						executionOrder.push(1);
						await delay(10);
					},
					{ priority: QueuePriority.LOW }
				),
				queueManager.add(
					async () => {
						executionOrder.push(2);
						await delay(10);
					},
					{ priority: QueuePriority.NORMAL }
				),
				queueManager.add(
					async () => {
						executionOrder.push(3);
						await delay(10);
					},
					{ priority: QueuePriority.HIGH }
				),
				queueManager.add(
					async () => {
						executionOrder.push(4);
						await delay(10);
					},
					{ priority: QueuePriority.IMMEDIATE }
				),
			];

			await Promise.all(tasks);

			// Higher priority (lower number) should execute first
			expect(executionOrder[0]).toBeLessThan(executionOrder[executionOrder.length - 1]);
		});
	});

	describe('Queue size and overflow', () => {
		it('should throw error when queue exceeds max size', async () => {
			// Fill queue to max size
			const longTask = () => delay(1000).then(() => 'done');

			// Add maxSize tasks
			const promises = Array.from({ length: 5 }, () => queueManager.add(longTask));

			// Try to add one more
			await expect(queueManager.add(longTask)).rejects.toThrow(QueueOverflowError);

			// Cleanup
			queueManager.clear();
			await Promise.allSettled(promises);
		});

		it('should track queue depth', async () => {
			const longTask = () => delay(100).then(() => 'done');

			queueManager.add(longTask);
			queueManager.add(longTask);
			queueManager.add(longTask);

			const metrics = queueManager.getMetrics();
			expect(metrics.queueDepth).toBeGreaterThan(0);

			await queueManager.drain();
		});
	});

	describe('Timeout handling', () => {
		it('should timeout long-running tasks', async () => {
			const longTask = () => delay(2000).then(() => 'done');

			await expect(queueManager.add(longTask, { timeout: 100 })).rejects.toThrow(
				QueueTimeoutError
			);
		});

		it('should not timeout fast tasks', async () => {
			const fastTask = () => delay(10).then(() => 'done');

			const result = await queueManager.add(fastTask, { timeout: 100 });

			expect(result).toBe('done');
		});
	});

	describe('Request deduplication', () => {
		it('should detect duplicate requests', async () => {
			queueManager.setDeduplicationKeyFn((data: any) => data.url);

			const task1 = queueManager.add(async () => delay(50).then(() => 'result'), {
				data: { url: 'https://example.com/post/123' },
			});

			// Try to add duplicate
			const task2 = queueManager.add(async () => 'duplicate', {
				data: { url: 'https://example.com/post/123' },
			});

			await expect(task2).rejects.toThrow('Duplicate request');

			await task1;
		});

		it('should allow requests after deduplication key is removed', async () => {
			queueManager.setDeduplicationKeyFn((data: any) => data.url);

			const task1 = await queueManager.add(async () => 'result1', {
				data: { url: 'https://example.com/post/123' },
			});

			// After first completes, same key should be allowed
			const task2 = await queueManager.add(async () => 'result2', {
				data: { url: 'https://example.com/post/123' },
			});

			expect(task1).toBe('result1');
			expect(task2).toBe('result2');
		});
	});

	describe('Queue control', () => {
		it('should pause and resume queue', async () => {
			let executed = false;

			queueManager.pause();

			queueManager.add(async () => {
				executed = true;
			});

			await delay(50);
			expect(executed).toBe(false);

			queueManager.start();
			await queueManager.drain();
			expect(executed).toBe(true);
		});

		it('should clear pending requests', async () => {
			const longTask = () => delay(1000).then(() => 'done');

			queueManager.pause();
			queueManager.add(longTask);
			queueManager.add(longTask);

			const metricsBefore = queueManager.getMetrics();
			expect(metricsBefore.pending).toBeGreaterThan(0);

			queueManager.clear();

			const metricsAfter = queueManager.getMetrics();
			expect(metricsAfter.pending).toBe(0);
		});

		it('should drain queue', async () => {
			const tasks = Array.from({ length: 5 }, () =>
				queueManager.add(async () => {
					await delay(10);
					return 'done';
				})
			);

			await queueManager.drain();

			const metrics = queueManager.getMetrics();
			expect(metrics.pending).toBe(0);
			expect(metrics.active).toBe(0);
		});
	});

	describe('Metrics tracking', () => {
		it('should track completed requests', async () => {
			await queueManager.add(async () => 'result1');
			await queueManager.add(async () => 'result2');
			await queueManager.add(async () => 'result3');

			const metrics = queueManager.getMetrics();

			expect(metrics.completed).toBe(3);
			expect(metrics.totalProcessed).toBe(3);
		});

		it('should track failed requests', async () => {
			const failingTask = async () => {
				throw new Error('Task failed');
			};

			await expect(queueManager.add(failingTask)).rejects.toThrow('Task failed');

			const metrics = queueManager.getMetrics();

			expect(metrics.failed).toBe(1);
			expect(metrics.totalProcessed).toBe(1);
		});

		it('should calculate average processing time', async () => {
			await queueManager.add(async () => {
				await delay(10);
				return 'done';
			});

			await queueManager.add(async () => {
				await delay(20);
				return 'done';
			});

			const metrics = queueManager.getMetrics();

			expect(metrics.averageProcessingTime).toBeGreaterThan(0);
			expect(metrics.averageProcessingTime).toBeLessThan(100);
		});

		it('should calculate throughput', async () => {
			await queueManager.add(async () => 'result1');
			await queueManager.add(async () => 'result2');
			await delay(100);

			const metrics = queueManager.getMetrics();

			expect(metrics.throughput).toBeGreaterThan(0);
		});

		it('should reset metrics', async () => {
			await queueManager.add(async () => 'result');

			queueManager.resetMetrics();

			const metrics = queueManager.getMetrics();

			expect(metrics.completed).toBe(0);
			expect(metrics.failed).toBe(0);
			expect(metrics.totalProcessed).toBe(0);
		});
	});

	describe('Event handling', () => {
		it('should emit add event', async () => {
			const handler = vi.fn();
			queueManager.on('add', handler);

			await queueManager.add(async () => 'result');

			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'add',
					request: expect.any(Object),
				})
			);
		});

		it('should emit completed event', async () => {
			const handler = vi.fn();
			queueManager.on('completed', handler);

			await queueManager.add(async () => 'result');

			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'completed',
					request: expect.any(Object),
				})
			);
		});

		it('should emit error event on failure', async () => {
			const handler = vi.fn();
			queueManager.on('error', handler);

			await expect(
				queueManager.add(async () => {
					throw new Error('Task failed');
				})
			).rejects.toThrow();

			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'error',
					error: expect.any(Error),
				})
			);
		});

		it('should emit idle event when queue is empty', async () => {
			const handler = vi.fn();
			queueManager.on('idle', handler);

			await queueManager.add(async () => 'result');
			await queueManager.drain();

			expect(handler).toHaveBeenCalled();
		});

		it('should unregister event handler', async () => {
			const handler = vi.fn();
			queueManager.on('add', handler);
			queueManager.off('add', handler);

			await queueManager.add(async () => 'result');

			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe('Queue state', () => {
		it('should report active state', () => {
			const state = queueManager.getState();

			expect(state.isActive).toBe(true);
			expect(state.isPaused).toBe(false);
		});

		it('should report paused state', () => {
			queueManager.pause();

			const state = queueManager.getState();

			expect(state.isActive).toBe(false);
			expect(state.isPaused).toBe(true);
		});

		it('should report pending and active counts', async () => {
			const longTask = () => delay(100).then(() => 'done');

			queueManager.add(longTask);
			queueManager.add(longTask);
			queueManager.add(longTask);

			const state = queueManager.getState();

			expect(state.pending + state.active).toBeGreaterThan(0);

			await queueManager.drain();
		});
	});
});
