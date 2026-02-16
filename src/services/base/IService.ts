/**
 * Base service interface with lifecycle management
 * All services should implement this interface for consistent behavior
 */
export interface IService {
  /**
   * Initialize the service
   * Called when the service is first created
   */
  initialize?(): Promise<void> | void;

  /**
   * Dispose of the service and clean up resources
   * Called when the service is no longer needed
   */
  dispose?(): Promise<void> | void;

  /**
   * Health check for the service
   * Returns true if the service is ready to use
   */
  isHealthy?(): Promise<boolean> | boolean;
}

/**
 * Configuration interface for services
 */
export interface ServiceConfig {
  [key: string]: unknown;
}

/**
 * Service factory function type
 */
export type ServiceFactory<T> = () => T | Promise<T>;

/**
 * Service lifecycle state
 */
export enum ServiceLifecycle {
  UNINITIALIZED = 'uninitialized',
  INITIALIZING = 'initializing',
  READY = 'ready',
  DISPOSING = 'disposing',
  DISPOSED = 'disposed',
  ERROR = 'error'
}

/**
 * Service metadata for tracking and debugging
 */
export interface ServiceMetadata {
  token: symbol;
  lifecycle: ServiceLifecycle;
  createdAt: Date;
  lastAccessed?: Date;
  errorCount: number;
  lastError?: Error;
}
