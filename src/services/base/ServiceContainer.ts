import type { IService, ServiceFactory, ServiceMetadata } from './IService';
import { ServiceLifecycle } from './IService';

/**
 * Lightweight dependency injection container
 * Manages service instances with singleton pattern and lazy initialization
 */
export class ServiceContainer {
  private services = new Map<symbol, unknown>();
  private factories = new Map<symbol, ServiceFactory<unknown>>();
  private metadata = new Map<symbol, ServiceMetadata>();
  private initializationPromises = new Map<symbol, Promise<void>>();

  /**
   * Register a service factory with the container
   * @param token Unique symbol identifying the service
   * @param factory Factory function that creates the service instance
   */
  register<T>(token: symbol, factory: ServiceFactory<T>): void {
    if (this.factories.has(token)) {
      throw new Error(
        `Service with token ${token.toString()} is already registered`
      );
    }

    this.factories.set(token, factory as ServiceFactory<unknown>);
    this.metadata.set(token, {
      token,
      lifecycle: ServiceLifecycle.UNINITIALIZED,
      createdAt: new Date(),
      errorCount: 0,
    });
  }

  /**
   * Resolve a service instance from the container
   * Creates the instance on first access (lazy initialization)
   * @param token Service token to resolve
   * @returns Service instance
   */
  async resolve<T>(token: symbol): Promise<T> {
    // Check if service is already instantiated
    if (this.services.has(token)) {
      this.updateLastAccessed(token);
      return this.services.get(token) as T;
    }

    // Check if service is registered
    const factory = this.factories.get(token);
    if (!factory) {
      throw new Error(
        `Service with token ${token.toString()} is not registered`
      );
    }

    // Check for circular dependency during initialization
    if (this.initializationPromises.has(token)) {
      throw new Error(
        `Circular dependency detected for service ${token.toString()}`
      );
    }

    // Create and initialize the service
    const meta = this.metadata.get(token)!;
    meta.lifecycle = ServiceLifecycle.INITIALIZING;

    const initPromise = this.initializeService(token, factory);
    this.initializationPromises.set(token, initPromise);

    try {
      await initPromise;
      meta.lifecycle = ServiceLifecycle.READY;
      this.updateLastAccessed(token);
      return this.services.get(token) as T;
    } catch (error) {
      meta.lifecycle = ServiceLifecycle.ERROR;
      meta.errorCount++;
      meta.lastError = error as Error;
      throw error;
    } finally {
      this.initializationPromises.delete(token);
    }
  }

  /**
   * Synchronously resolve a service (for already initialized services)
   * @param token Service token
   * @returns Service instance or undefined
   */
  resolveSync<T>(token: symbol): T | undefined {
    if (!this.services.has(token)) {
      return undefined;
    }
    this.updateLastAccessed(token);
    return this.services.get(token) as T;
  }

  /**
   * Check if a service is registered
   * @param token Service token
   */
  has(token: symbol): boolean {
    return this.factories.has(token);
  }

  /**
   * Check if a service is initialized
   * @param token Service token
   */
  isInitialized(token: symbol): boolean {
    return this.services.has(token);
  }

  /**
   * Get service metadata
   * @param token Service token
   */
  getMetadata(token: symbol): ServiceMetadata | undefined {
    return this.metadata.get(token);
  }

  /**
   * Dispose of a specific service
   * @param token Service token
   */
  async disposeService(token: symbol): Promise<void> {
    const service = this.services.get(token);
    if (!service) return;

    const meta = this.metadata.get(token);
    if (meta) {
      meta.lifecycle = ServiceLifecycle.DISPOSING;
    }

    try {
      // Call dispose if available
      if (this.isService(service) && service.dispose) {
        await service.dispose();
      }

      this.services.delete(token);
      if (meta) {
        meta.lifecycle = ServiceLifecycle.DISPOSED;
      }
    } catch (error) {
      if (meta) {
        meta.lifecycle = ServiceLifecycle.ERROR;
        meta.lastError = error as Error;
      }
      throw error;
    }
  }

  /**
   * Dispose of all services
   */
  async disposeAll(): Promise<void> {
    const disposePromises: Promise<void>[] = [];

    for (const token of this.services.keys()) {
      disposePromises.push(this.disposeService(token));
    }

    await Promise.allSettled(disposePromises);
  }

  /**
   * Clear all registrations and instances
   */
  clear(): void {
    this.services.clear();
    this.factories.clear();
    this.metadata.clear();
    this.initializationPromises.clear();
  }

  /**
   * Get all registered service tokens
   */
  getRegisteredTokens(): symbol[] {
    return Array.from(this.factories.keys());
  }

  /**
   * Get all initialized service tokens
   */
  getInitializedTokens(): symbol[] {
    return Array.from(this.services.keys());
  }

  /**
   * Initialize a service from its factory
   */
  private async initializeService(
    token: symbol,
    factory: ServiceFactory<unknown>
  ): Promise<void> {
    const instance = await factory();

    // Call initialize if available
    if (this.isService(instance) && instance.initialize) {
      await instance.initialize();
    }

    this.services.set(token, instance);
  }

  /**
   * Type guard to check if object implements IService
   */
  private isService(obj: unknown): obj is IService {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      ('initialize' in obj || 'dispose' in obj || 'isHealthy' in obj)
    );
  }

  /**
   * Update last accessed timestamp
   */
  private updateLastAccessed(token: symbol): void {
    const meta = this.metadata.get(token);
    if (meta) {
      meta.lastAccessed = new Date();
    }
  }
}

// Global singleton instance
export const container = new ServiceContainer();
