/**
 * Request Queue Manager with Concurrency Control
 */

import PQueue from 'p-queue';
import type { IService } from './base/IService';
import type { Logger } from './Logger';
import {
	QueuePriority,
	type QueueMetrics,
	type QueuedRequest,
	type QueueEvent,
	type QueueEventHandler,
	type QueueConfig,
	type DeduplicationKeyFn,
} from '@/types/queue';

/**
 * Queue overflow error
 */
export class QueueOverflowError extends Error {
	constructor(maxSize: number) {
		super(`Queue overflow: maximum size of ${maxSize} exceeded`);
		this.name = 'QueueOverflowError';
	}
}

/**
 * Queue timeout error
 */
export class QueueTimeoutError extends Error {
	constructor(timeout: number) {
		super(`Request timeout: exceeded ${timeout}ms wait time`);
		this.name = 'QueueTimeoutError';
	}
}

/**
 * Request Queue Manager
 */
export class RequestQueueManager<T = unknown> implements IService {
	private queue: PQueue;
	private logger: Logger;
	private config: Required<QueueConfig>;
	private eventHandlers: Map<string, QueueEventHandler<T>[]>;
	private pendingRequests: Map<string, QueuedRequest<T>>;
	private processingTimes: number[];
	private metrics: {
		completed: number;
		failed: number;
		totalProcessed: number;
	};
	private deduplicationKeys: Set<string>;
	private deduplicationKeyFn?: DeduplicationKeyFn<T>;
	private startTime: Date;

	constructor(logger: Logger, config: Partial<QueueConfig> = {}) {
		this.logger = logger;
		this.config = {
			concurrency: config.concurrency ?? 5,
			maxSize: config.maxSize ?? 100,
			timeout: config.timeout ?? 5 * 60 * 1000, // 5 minutes
			autoStart: config.autoStart ?? true,
			throwOnTimeout: config.throwOnTimeout ?? true,
		};

		this.queue = new PQueue({
			concurrency: this.config.concurrency,
			autoStart: this.config.autoStart,
		});

		this.eventHandlers = new Map();
		this.pendingRequests = new Map();
		this.processingTimes = [];
		this.metrics = {
			completed: 0,
			failed: 0,
			totalProcessed: 0,
		};
		this.deduplicationKeys = new Set();
		this.startTime = new Date();

		this.setupQueueEvents();
	}

	/**
	 * IService implementation
	 */
	async initialize(): Promise<void> {
		this.logger.info('RequestQueueManager initialized', {
			concurrency: this.config.concurrency,
			maxSize: this.config.maxSize,
		});
	}

	async shutdown(): Promise<void> {
		this.logger.info('RequestQueueManager shutting down', {
			pendingCount: this.queue.pending,
			activeCount: this.queue.size,
		});

		// Wait for active requests to complete
		await this.drain();

		// Clear all pending requests
		this.queue.clear();

		this.logger.info('RequestQueueManager shutdown complete');
	}

	/**
	 * Add request to queue with priority
	 */
	async add<R>(
		fn: () => Promise<R>,
		options: {
			priority?: QueuePriority;
			timeout?: number;
			data?: T;
			signal?: AbortSignal;
		} = {}
	): Promise<R> {
		const requestId = this.generateRequestId();
		const priority = options.priority ?? QueuePriority.NORMAL;
		const timeout = options.timeout ?? this.config.timeout;

		// Check queue size
		if (this.queue.pending >= this.config.maxSize) {
			this.logger.warn('Queue overflow', {
				pending: this.queue.pending,
				maxSize: this.config.maxSize,
			});
			throw new QueueOverflowError(this.config.maxSize);
		}

		// Check for duplicate request
		if (options.data && this.deduplicationKeyFn) {
			const dedupKey = this.deduplicationKeyFn(options.data);
			if (this.deduplicationKeys.has(dedupKey)) {
				this.logger.debug('Duplicate request detected', { dedupKey });
				throw new Error(`Duplicate request: ${dedupKey}`);
			}
			this.deduplicationKeys.add(dedupKey);
		}

		const queuedRequest: QueuedRequest<T> = {
			id: requestId,
			priority,
			addedAt: new Date(),
			timeout,
			data: options.data as T,
		};

		this.pendingRequests.set(requestId, queuedRequest);

		this.emit('add', { request: queuedRequest });

		// Wrap function with timeout and tracking
		const wrappedFn = async (): Promise<R> => {
			queuedRequest.startedAt = new Date();
			this.emit('active', { request: queuedRequest });

			const timeoutPromise = new Promise<never>((_, reject) => {
				setTimeout(() => {
					reject(new QueueTimeoutError(timeout));
				}, timeout);
			});

			try {
				const result = await Promise.race([fn(), timeoutPromise]);

				queuedRequest.completedAt = new Date();
				const processingTime = queuedRequest.completedAt.getTime() - queuedRequest.startedAt!.getTime();

				this.trackProcessingTime(processingTime);
				this.metrics.completed++;
				this.metrics.totalProcessed++;

				this.emit('completed', { request: queuedRequest });

				return result;
			} catch (error) {
				this.metrics.failed++;
				this.metrics.totalProcessed++;

				this.emit('error', { request: queuedRequest, error: error as Error });

				throw error;
			} finally {
				this.pendingRequests.delete(requestId);

				// Remove deduplication key
				if (options.data && this.deduplicationKeyFn) {
					const dedupKey = this.deduplicationKeyFn(options.data);
					this.deduplicationKeys.delete(dedupKey);
				}
			}
		};

		// Add to queue with priority
		return this.queue.add(wrappedFn, { priority }) as Promise<R>;
	}

	/**
	 * Set deduplication key function
	 */
	setDeduplicationKeyFn(fn: DeduplicationKeyFn<T>): void {
		this.deduplicationKeyFn = fn;
	}

	/**
	 * Start queue processing
	 */
	start(): void {
		this.queue.start();
		this.logger.info('Queue started');
	}

	/**
	 * Pause queue processing
	 */
	pause(): void {
		this.queue.pause();
		this.logger.info('Queue paused');
	}

	/**
	 * Clear all pending requests
	 */
	clear(): void {
		const clearedCount = this.queue.pending;
		this.queue.clear();
		this.pendingRequests.clear();
		this.deduplicationKeys.clear();

		this.logger.info('Queue cleared', { clearedCount });
	}

	/**
	 * Wait for all active and pending requests to complete
	 */
	async drain(): Promise<void> {
		await this.queue.onIdle();
		this.logger.info('Queue drained');
	}

	/**
	 * Get current queue metrics
	 */
	getMetrics(): QueueMetrics {
		const uptime = Date.now() - this.startTime.getTime();
		const uptimeSeconds = uptime / 1000;

		return {
			pending: this.queue.pending,
			active: this.queue.size,
			completed: this.metrics.completed,
			failed: this.metrics.failed,
			totalProcessed: this.metrics.totalProcessed,
			averageProcessingTime: this.calculateAverageProcessingTime(),
			queueDepth: this.queue.pending + this.queue.size,
			throughput: uptimeSeconds > 0 ? this.metrics.totalProcessed / uptimeSeconds : 0,
		};
	}

	/**
	 * Reset metrics
	 */
	resetMetrics(): void {
		this.metrics = {
			completed: 0,
			failed: 0,
			totalProcessed: 0,
		};
		this.processingTimes = [];
		this.startTime = new Date();

		this.logger.info('Metrics reset');
	}

	/**
	 * Register event handler
	 */
	on(event: string, handler: QueueEventHandler<T>): void {
		if (!this.eventHandlers.has(event)) {
			this.eventHandlers.set(event, []);
		}
		this.eventHandlers.get(event)!.push(handler);
	}

	/**
	 * Unregister event handler
	 */
	off(event: string, handler: QueueEventHandler<T>): void {
		const handlers = this.eventHandlers.get(event);
		if (handlers) {
			const index = handlers.indexOf(handler);
			if (index > -1) {
				handlers.splice(index, 1);
			}
		}
	}

	/**
	 * Get current queue state
	 */
	getState(): {
		isActive: boolean;
		isPaused: boolean;
		pending: number;
		active: number;
	} {
		return {
			isActive: !this.queue.isPaused,
			isPaused: this.queue.isPaused,
			pending: this.queue.pending,
			active: this.queue.size,
		};
	}

	/**
	 * Setup queue event listeners
	 */
	private setupQueueEvents(): void {
		this.queue.on('active', () => {
			this.emit('next', {});
		});

		this.queue.on('idle', () => {
			this.emit('idle', {});
		});
	}

	/**
	 * Emit event to handlers
	 */
	private emit(type: string, data: Partial<QueueEvent<T>>): void {
		const event: QueueEvent<T> = {
			type: type as any,
			timestamp: new Date(),
			...data,
		};

		const handlers = this.eventHandlers.get(type);
		if (handlers) {
			handlers.forEach((handler) => {
				try {
					handler(event);
				} catch (error) {
					this.logger.error('Event handler error', error as Error, {
						eventType: type,
					});
				}
			});
		}
	}

	/**
	 * Track processing time for metrics
	 */
	private trackProcessingTime(time: number): void {
		this.processingTimes.push(time);

		// Keep only last 1000 samples
		if (this.processingTimes.length > 1000) {
			this.processingTimes = this.processingTimes.slice(-1000);
		}
	}

	/**
	 * Calculate average processing time
	 */
	private calculateAverageProcessingTime(): number {
		if (this.processingTimes.length === 0) {
			return 0;
		}

		const sum = this.processingTimes.reduce((acc, time) => acc + time, 0);
		return sum / this.processingTimes.length;
	}

	/**
	 * Generate unique request ID
	 */
	private generateRequestId(): string {
		return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}
}
