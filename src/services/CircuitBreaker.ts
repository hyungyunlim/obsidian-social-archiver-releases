/**
 * Circuit Breaker Pattern Implementation
 * Prevents cascading failures by failing fast when a service is down
 */

import { EventEmitter } from 'events';
import type {
	CircuitBreakerState,
	CircuitBreakerConfig,
	CircuitBreakerMetrics,
	CircuitBreakerEvent,
	CircuitBreakerEventData,
	CircuitBreakerEventListener,
} from '@/types/circuit-breaker';
import { CircuitBreakerState as State, CircuitBreakerOpenError, CircuitBreakerEvent as Event } from '@/types/circuit-breaker';
import { isRetryableError } from '@/types/errors/http-errors';

/**
 * Default circuit breaker configuration
 */
const DEFAULT_CONFIG: Omit<CircuitBreakerConfig, 'name'> = {
	failureThreshold: 5,
	successThreshold: 3,
	timeout: 60000, // 60 seconds
	isErrorRetryable: isRetryableError,
};

/**
 * Circuit Breaker
 * Implements the circuit breaker pattern with three states: CLOSED, OPEN, HALF_OPEN
 */
export class CircuitBreaker extends EventEmitter {
	private readonly config: CircuitBreakerConfig;
	private state: CircuitBreakerState;
	private metrics: CircuitBreakerMetrics;
	private nextAttemptAt?: Date;
	private resetTimeout?: NodeJS.Timeout;

	constructor(config: Partial<CircuitBreakerConfig> & { name: string }) {
		super();
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.state = State.CLOSED;
		this.metrics = this.initializeMetrics();
	}

	/**
	 * Initialize metrics
	 */
	private initializeMetrics(): CircuitBreakerMetrics {
		return {
			state: State.CLOSED,
			totalRequests: 0,
			successfulRequests: 0,
			failedRequests: 0,
			rejectedRequests: 0,
			consecutiveFailures: 0,
			consecutiveSuccesses: 0,
			lastStateChangeAt: new Date(),
			successRate: 0,
			failureRate: 0,
		};
	}

	/**
	 * Execute a function with circuit breaker protection
	 */
	public async execute<T>(fn: () => Promise<T>): Promise<T> {
		// Check if circuit is open
		if (this.state === State.OPEN) {
			// Check if timeout has elapsed to transition to half-open
			if (this.nextAttemptAt && new Date() >= this.nextAttemptAt) {
				this.transitionToHalfOpen();
			} else {
				this.recordRejection();
				throw new CircuitBreakerOpenError(
					this.config.name,
					this.nextAttemptAt ?? new Date()
				);
			}
		}

		// Increment total requests
		this.metrics.totalRequests++;

		try {
			const result = await fn();
			this.recordSuccess();
			return result;
		} catch (error) {
			this.recordFailure(error as Error);
			throw error;
		}
	}

	/**
	 * Record successful request
	 */
	private recordSuccess(): void {
		this.metrics.successfulRequests++;
		this.metrics.consecutiveFailures = 0;

		// In half-open state, count consecutive successes
		if (this.state === State.HALF_OPEN) {
			this.metrics.consecutiveSuccesses++;

			// Close circuit if success threshold reached
			if (this.metrics.consecutiveSuccesses >= this.config.successThreshold) {
				this.transitionToClosed();
			}
		}

		this.updateRates();
		this.emitEvent(Event.SUCCESS);
	}

	/**
	 * Record failed request
	 */
	private recordFailure(error: Error): void {
		// Check if error should count as failure
		const shouldCount = this.config.isErrorRetryable?.(error) ?? true;

		if (!shouldCount) {
			return;
		}

		this.metrics.failedRequests++;
		this.metrics.consecutiveFailures++;
		this.metrics.consecutiveSuccesses = 0;

		// Transition to open if failure threshold exceeded
		if (this.metrics.consecutiveFailures >= this.config.failureThreshold) {
			this.transitionToOpen();
		}

		this.updateRates();
		this.emitEvent(Event.FAILURE, error);
	}

	/**
	 * Record rejected request (circuit is open)
	 */
	private recordRejection(): void {
		this.metrics.rejectedRequests++;
		this.emitEvent(Event.REJECT);
	}

	/**
	 * Transition to OPEN state
	 */
	private transitionToOpen(): void {
		if (this.state === State.OPEN) {
			return;
		}

		const previousState = this.state;
		this.state = State.OPEN;
		this.metrics.state = State.OPEN;
		this.metrics.lastOpenedAt = new Date();
		this.metrics.lastStateChangeAt = new Date();
		this.nextAttemptAt = new Date(Date.now() + this.config.timeout);

		// Schedule transition to half-open
		this.scheduleHalfOpen();

		this.emitStateChange(Event.OPEN, previousState);
	}

	/**
	 * Transition to HALF_OPEN state
	 */
	private transitionToHalfOpen(): void {
		if (this.state === State.HALF_OPEN) {
			return;
		}

		const previousState = this.state;
		this.state = State.HALF_OPEN;
		this.metrics.state = State.HALF_OPEN;
		this.metrics.consecutiveSuccesses = 0;
		this.metrics.lastStateChangeAt = new Date();
		this.nextAttemptAt = undefined;

		// Clear any existing timeout
		if (this.resetTimeout) {
			clearTimeout(this.resetTimeout);
			this.resetTimeout = undefined;
		}

		this.emitStateChange(Event.HALF_OPEN, previousState);
	}

	/**
	 * Transition to CLOSED state
	 */
	private transitionToClosed(): void {
		if (this.state === State.CLOSED) {
			return;
		}

		const previousState = this.state;
		this.state = State.CLOSED;
		this.metrics.state = State.CLOSED;
		this.metrics.consecutiveFailures = 0;
		this.metrics.consecutiveSuccesses = 0;
		this.metrics.lastClosedAt = new Date();
		this.metrics.lastStateChangeAt = new Date();
		this.nextAttemptAt = undefined;

		// Clear any existing timeout
		if (this.resetTimeout) {
			clearTimeout(this.resetTimeout);
			this.resetTimeout = undefined;
		}

		this.emitStateChange(Event.CLOSE, previousState);
	}

	/**
	 * Schedule transition to half-open state
	 */
	private scheduleHalfOpen(): void {
		// Clear any existing timeout
		if (this.resetTimeout) {
			clearTimeout(this.resetTimeout);
		}

		this.resetTimeout = setTimeout(() => {
			if (this.state === State.OPEN) {
				this.transitionToHalfOpen();
			}
		}, this.config.timeout);
	}

	/**
	 * Update success and failure rates
	 */
	private updateRates(): void {
		const totalCompleted = this.metrics.successfulRequests + this.metrics.failedRequests;

		if (totalCompleted > 0) {
			this.metrics.successRate = this.metrics.successfulRequests / totalCompleted;
			this.metrics.failureRate = this.metrics.failedRequests / totalCompleted;
		} else {
			this.metrics.successRate = 0;
			this.metrics.failureRate = 0;
		}
	}

	/**
	 * Emit event
	 */
	private emitEvent(event: CircuitBreakerEvent, error?: Error): void {
		const data: CircuitBreakerEventData = {
			name: this.config.name,
			event,
			currentState: this.state,
			metrics: this.getMetrics(),
			error,
			timestamp: new Date(),
		};

		this.emit(event, data);
		this.emit(Event.METRICS, data);
	}

	/**
	 * Emit state change event
	 */
	private emitStateChange(event: CircuitBreakerEvent, previousState: CircuitBreakerState): void {
		const data: CircuitBreakerEventData = {
			name: this.config.name,
			event,
			previousState,
			currentState: this.state,
			metrics: this.getMetrics(),
			timestamp: new Date(),
		};

		this.emit(event, data);
		this.emit(Event.METRICS, data);
	}

	/**
	 * Get current state
	 */
	public getState(): CircuitBreakerState {
		return this.state;
	}

	/**
	 * Get current metrics (immutable copy)
	 */
	public getMetrics(): CircuitBreakerMetrics {
		return { ...this.metrics };
	}

	/**
	 * Get circuit breaker name
	 */
	public getName(): string {
		return this.config.name;
	}

	/**
	 * Check if circuit is open
	 */
	public isOpen(): boolean {
		return this.state === State.OPEN;
	}

	/**
	 * Check if circuit is closed
	 */
	public isClosed(): boolean {
		return this.state === State.CLOSED;
	}

	/**
	 * Check if circuit is half-open
	 */
	public isHalfOpen(): boolean {
		return this.state === State.HALF_OPEN;
	}

	/**
	 * Manually open the circuit
	 */
	public open(): void {
		this.transitionToOpen();
	}

	/**
	 * Manually close the circuit
	 */
	public close(): void {
		this.transitionToClosed();
	}

	/**
	 * Reset circuit breaker (clear metrics and close circuit)
	 */
	public reset(): void {
		this.metrics = this.initializeMetrics();
		this.nextAttemptAt = undefined;

		if (this.resetTimeout) {
			clearTimeout(this.resetTimeout);
			this.resetTimeout = undefined;
		}

		this.transitionToClosed();
	}

	/**
	 * Add event listener
	 */
	public on(event: CircuitBreakerEvent, listener: CircuitBreakerEventListener): this {
		return super.on(event, listener);
	}

	/**
	 * Remove event listener
	 */
	public off(event: CircuitBreakerEvent, listener: CircuitBreakerEventListener): this {
		return super.off(event, listener);
	}

	/**
	 * Add one-time event listener
	 */
	public once(event: CircuitBreakerEvent, listener: CircuitBreakerEventListener): this {
		return super.once(event, listener);
	}

	/**
	 * Cleanup resources
	 */
	public destroy(): void {
		if (this.resetTimeout) {
			clearTimeout(this.resetTimeout);
			this.resetTimeout = undefined;
		}
		this.removeAllListeners();
	}
}
