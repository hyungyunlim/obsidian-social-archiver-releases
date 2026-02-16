/**
 * Circuit Breaker Pattern Types
 */

/**
 * Circuit breaker states
 */
export enum CircuitBreakerState {
	/** Circuit is closed, requests flow normally */
	CLOSED = 'CLOSED',
	/** Circuit is open, requests are rejected immediately */
	OPEN = 'OPEN',
	/** Circuit is testing if service recovered, allowing limited requests */
	HALF_OPEN = 'HALF_OPEN',
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
	/** Name/identifier for the circuit breaker */
	name: string;
	/** Number of consecutive failures before opening circuit (default: 5) */
	failureThreshold: number;
	/** Number of consecutive successes to close from half-open (default: 3) */
	successThreshold: number;
	/** Time in ms to wait before attempting half-open state (default: 60000 = 60s) */
	timeout: number;
	/** Optional custom error filter to determine if error should count as failure */
	isErrorRetryable?: (error: Error) => boolean;
}

/**
 * Circuit breaker metrics
 */
export interface CircuitBreakerMetrics {
	/** Current state of the circuit */
	state: CircuitBreakerState;
	/** Total number of requests attempted */
	totalRequests: number;
	/** Number of successful requests */
	successfulRequests: number;
	/** Number of failed requests */
	failedRequests: number;
	/** Number of rejected requests (when circuit is open) */
	rejectedRequests: number;
	/** Current consecutive failures */
	consecutiveFailures: number;
	/** Current consecutive successes (in half-open state) */
	consecutiveSuccesses: number;
	/** Timestamp when circuit was last opened */
	lastOpenedAt?: Date;
	/** Timestamp when circuit was last closed */
	lastClosedAt?: Date;
	/** Timestamp of last state change */
	lastStateChangeAt: Date;
	/** Success rate (0-1) */
	successRate: number;
	/** Failure rate (0-1) */
	failureRate: number;
}

/**
 * Circuit breaker events
 */
export enum CircuitBreakerEvent {
	/** Circuit changed from CLOSED to OPEN */
	OPEN = 'open',
	/** Circuit changed from OPEN to HALF_OPEN */
	HALF_OPEN = 'halfOpen',
	/** Circuit changed from HALF_OPEN to CLOSED */
	CLOSE = 'close',
	/** Request succeeded */
	SUCCESS = 'success',
	/** Request failed */
	FAILURE = 'failure',
	/** Request rejected due to open circuit */
	REJECT = 'reject',
	/** Metrics updated */
	METRICS = 'metrics',
}

/**
 * Circuit breaker event data
 */
export interface CircuitBreakerEventData {
	name: string;
	event: CircuitBreakerEvent;
	previousState?: CircuitBreakerState;
	currentState: CircuitBreakerState;
	metrics: CircuitBreakerMetrics;
	error?: Error;
	timestamp: Date;
}

/**
 * Circuit breaker event listener
 */
export type CircuitBreakerEventListener = (data: CircuitBreakerEventData) => void;

/**
 * Circuit breaker error thrown when circuit is open
 */
export class CircuitBreakerOpenError extends Error {
	public readonly circuitBreakerName: string;
	public readonly nextAttemptAt: Date;

	constructor(name: string, nextAttemptAt: Date) {
		super(`Circuit breaker '${name}' is OPEN. Next attempt at ${nextAttemptAt.toISOString()}`);
		this.name = 'CircuitBreakerOpenError';
		this.circuitBreakerName = name;
		this.nextAttemptAt = nextAttemptAt;

		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, this.constructor);
		}
	}
}
