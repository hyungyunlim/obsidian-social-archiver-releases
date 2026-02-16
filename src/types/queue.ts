/**
 * Request Queue Types
 */

/**
 * Queue priority levels
 */
export enum QueuePriority {
	IMMEDIATE = 0,
	HIGH = 1,
	NORMAL = 2,
	LOW = 3,
}

/**
 * Queue metrics for monitoring
 */
export interface QueueMetrics {
	pending: number;
	active: number;
	completed: number;
	failed: number;
	totalProcessed: number;
	averageProcessingTime: number;
	queueDepth: number;
	throughput: number; // requests per second
}

/**
 * Queued request metadata
 */
export interface QueuedRequest<T = unknown> {
	id: string;
	priority: QueuePriority;
	addedAt: Date;
	startedAt?: Date;
	completedAt?: Date;
	timeout?: number;
	data: T;
}

/**
 * Queue event types
 */
export type QueueEventType = 'add' | 'next' | 'active' | 'idle' | 'completed' | 'error' | 'timeout';

/**
 * Queue event data
 */
export interface QueueEvent<T = unknown> {
	type: QueueEventType;
	request?: QueuedRequest<T>;
	error?: Error;
	timestamp: Date;
}

/**
 * Queue event handler
 */
export type QueueEventHandler<T = unknown> = (event: QueueEvent<T>) => void;

/**
 * Queue configuration
 */
export interface QueueConfig {
	concurrency: number;
	maxSize: number;
	timeout: number;
	autoStart: boolean;
	throwOnTimeout: boolean;
}

/**
 * Request deduplication key generator
 */
export type DeduplicationKeyFn<T> = (request: T) => string;
