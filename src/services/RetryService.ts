/**
 * RetryService - Intelligent retry logic with exponential backoff and circuit breaker
 *
 * Features:
 * - Exponential backoff with jitter
 * - Circuit breaker pattern to prevent cascading failures
 * - Configurable retry strategies
 * - Type-safe operation retry
 * - Integration with error notification system
 */

import type { IService } from './base/IService';
import {
  RateLimitError,
  AuthenticationError,
  InvalidRequestError
} from '@/types/errors/http-errors';

/**
 * Retry configuration options
 */
export interface RetryConfig {
  maxAttempts?: number;
  baseDelay?: number;
  maxDelay?: number;
  jitterFactor?: number;
  shouldRetry?: (error: Error) => boolean;
  onRetry?: (attempt: number, error: Error, delay: number) => void;
}

/**
 * Circuit breaker states
 */
export enum CircuitState {
  CLOSED = 'closed',     // Normal operation
  OPEN = 'open',         // Failures exceeded threshold, reject requests
  HALF_OPEN = 'half_open' // Testing if service recovered
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number;
  monitoringPeriod?: number;
}

/**
 * Circuit breaker statistics
 */
interface CircuitStats {
  failures: number;
  successes: number;
  lastFailureTime: number | null;
  state: CircuitState;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxAttempts: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 32000, // 32 seconds
  jitterFactor: 0.3,
  shouldRetry: (error: Error) => {
    // Don't retry authentication or validation errors
    if (error instanceof AuthenticationError || error instanceof InvalidRequestError) {
      return false;
    }
    return true;
  },
  onRetry: () => {
    // Default: do nothing
  }
};

/**
 * Default circuit breaker configuration
 */
const DEFAULT_CIRCUIT_CONFIG: Required<CircuitBreakerConfig> = {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000, // 1 minute
  monitoringPeriod: 10000 // 10 seconds
};

/**
 * RetryService - Manages retry logic and circuit breaker
 */
export class RetryService implements IService {
  public readonly name = 'RetryService';
  private isInitialized = false;
  private circuits: Map<string, CircuitStats> = new Map();
  private readonly circuitConfig: Required<CircuitBreakerConfig>;

  constructor(circuitConfig?: CircuitBreakerConfig) {
    this.circuitConfig = {
      ...DEFAULT_CIRCUIT_CONFIG,
      ...circuitConfig
    };
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    this.isInitialized = true;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.circuits.clear();
    this.isInitialized = false;
  }

  /**
   * Check if service is initialized
   */
  isServiceInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Execute an operation with retry logic
   * @param operation - Function to execute
   * @param config - Retry configuration
   * @param circuitKey - Optional circuit breaker key
   * @returns Promise with operation result
   */
  async execute<T>(
    operation: () => Promise<T>,
    config?: RetryConfig,
    circuitKey?: string
  ): Promise<T> {
    const retryConfig = {
      ...DEFAULT_RETRY_CONFIG,
      ...config
    };

    // Check circuit breaker if key provided
    if (circuitKey) {
      this.checkCircuit(circuitKey);
    }

    let lastError: Error;
    let attempt = 0;

    while (attempt < retryConfig.maxAttempts) {
      try {
        const result = await operation();

        // Record success if using circuit breaker
        if (circuitKey) {
          this.recordSuccess(circuitKey);
        }

        return result;
      } catch (error) {
        lastError = error as Error;
        attempt++;

        // Record failure if using circuit breaker
        if (circuitKey) {
          this.recordFailure(circuitKey);
        }

        // Don't retry if it's the last attempt
        if (attempt >= retryConfig.maxAttempts) {
          break;
        }

        // Check if error is retryable
        if (!retryConfig.shouldRetry(lastError)) {
          throw lastError;
        }

        // Calculate delay with exponential backoff and jitter
        const delay = this.calculateDelay(
          attempt,
          retryConfig.baseDelay,
          retryConfig.maxDelay,
          retryConfig.jitterFactor
        );

        // Notify about retry
        retryConfig.onRetry(attempt, lastError, delay);

        // Wait before retrying
        await this.sleep(delay);
      }
    }

    // All retries failed
    throw lastError!;
  }

  /**
   * Execute with rate limit handling
   * @param operation - Function to execute
   * @param config - Retry configuration
   * @returns Promise with operation result
   */
  async executeWithRateLimit<T>(
    operation: () => Promise<T>,
    config?: RetryConfig
  ): Promise<T> {
    const rateLimitConfig: RetryConfig = {
      ...config,
      shouldRetry: (error: Error) => {
        // Always retry rate limit errors
        if (error instanceof RateLimitError) {
          return true;
        }
        // Use default retry logic for other errors
        return config?.shouldRetry?.(error) ?? DEFAULT_RETRY_CONFIG.shouldRetry(error);
      },
      onRetry: (attempt: number, error: Error, delay: number) => {
        config?.onRetry?.(attempt, error, delay);
      }
    };

    return this.execute(operation, rateLimitConfig);
  }

  /**
   * Calculate delay with exponential backoff and jitter
   * @param attempt - Current attempt number (0-indexed)
   * @param baseDelay - Base delay in milliseconds
   * @param maxDelay - Maximum delay in milliseconds
   * @param jitterFactor - Jitter factor (0-1)
   * @returns Delay in milliseconds
   */
  private calculateDelay(
    attempt: number,
    baseDelay: number,
    maxDelay: number,
    jitterFactor: number
  ): number {
    // Exponential backoff: baseDelay * 2^attempt
    const exponentialDelay = baseDelay * Math.pow(2, attempt);

    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, maxDelay);

    // Add jitter: random value between (1 - jitterFactor) and (1 + jitterFactor)
    const jitter = 1 + (Math.random() * 2 - 1) * jitterFactor;
    const delayWithJitter = cappedDelay * jitter;

    return Math.floor(delayWithJitter);
  }

  /**
   * Sleep for specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check circuit breaker state
   * @param key - Circuit key
   * @throws Error if circuit is open
   */
  private checkCircuit(key: string): void {
    const circuit = this.getCircuit(key);

    if (circuit.state === CircuitState.OPEN) {
      // Check if timeout has passed
      if (
        circuit.lastFailureTime &&
        Date.now() - circuit.lastFailureTime >= this.circuitConfig.timeout
      ) {
        // Transition to half-open state
        circuit.state = CircuitState.HALF_OPEN;
        circuit.successes = 0;
      } else {
        throw new Error(`Circuit breaker is OPEN for: ${key}. Service temporarily unavailable.`);
      }
    }
  }

  /**
   * Record a successful operation
   * @param key - Circuit key
   */
  private recordSuccess(key: string): void {
    const circuit = this.getCircuit(key);

    circuit.successes++;
    circuit.failures = 0;

    // If in half-open state and reached success threshold, close circuit
    if (
      circuit.state === CircuitState.HALF_OPEN &&
      circuit.successes >= this.circuitConfig.successThreshold
    ) {
      circuit.state = CircuitState.CLOSED;
      circuit.successes = 0;
    }
  }

  /**
   * Record a failed operation
   * @param key - Circuit key
   */
  private recordFailure(key: string): void {
    const circuit = this.getCircuit(key);

    circuit.failures++;
    circuit.lastFailureTime = Date.now();

    // If in half-open state, reopen circuit immediately
    if (circuit.state === CircuitState.HALF_OPEN) {
      circuit.state = CircuitState.OPEN;
      circuit.successes = 0;
      return;
    }

    // If failures exceed threshold, open circuit
    if (
      circuit.state === CircuitState.CLOSED &&
      circuit.failures >= this.circuitConfig.failureThreshold
    ) {
      circuit.state = CircuitState.OPEN;
    }
  }

  /**
   * Get or create circuit stats
   * @param key - Circuit key
   * @returns Circuit stats
   */
  private getCircuit(key: string): CircuitStats {
    if (!this.circuits.has(key)) {
      this.circuits.set(key, {
        failures: 0,
        successes: 0,
        lastFailureTime: null,
        state: CircuitState.CLOSED
      });
    }
    return this.circuits.get(key)!;
  }

  /**
   * Get circuit state
   * @param key - Circuit key
   * @returns Circuit state
   */
  getCircuitState(key: string): CircuitState {
    return this.getCircuit(key).state;
  }

  /**
   * Reset circuit to closed state
   * @param key - Circuit key
   */
  resetCircuit(key: string): void {
    const circuit = this.getCircuit(key);
    circuit.state = CircuitState.CLOSED;
    circuit.failures = 0;
    circuit.successes = 0;
    circuit.lastFailureTime = null;
  }

  /**
   * Get all circuit states
   * @returns Map of circuit keys to states
   */
  getAllCircuits(): Map<string, CircuitState> {
    const states = new Map<string, CircuitState>();
    for (const [key, stats] of this.circuits.entries()) {
      states.set(key, stats.state);
    }
    return states;
  }
}
