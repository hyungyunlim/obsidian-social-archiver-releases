import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceContainer } from '@/services/base/ServiceContainer';
import { ServiceLifecycle, type IService } from '@/services/base/IService';

describe('ServiceContainer', () => {
  let container: ServiceContainer;

  beforeEach(() => {
    container = new ServiceContainer();
  });

  describe('register', () => {
    it('should register a service factory', () => {
      const token = Symbol('TestService');
      const factory = () => ({ value: 42 });

      container.register(token, factory);

      expect(container.has(token)).toBe(true);
    });

    it('should throw error when registering duplicate token', () => {
      const token = Symbol('TestService');
      const factory = () => ({ value: 42 });

      container.register(token, factory);

      expect(() => container.register(token, factory)).toThrow(
        /already registered/
      );
    });

    it('should initialize metadata for registered service', () => {
      const token = Symbol('TestService');
      const factory = () => ({ value: 42 });

      container.register(token, factory);

      const metadata = container.getMetadata(token);
      expect(metadata).toBeDefined();
      expect(metadata?.lifecycle).toBe(ServiceLifecycle.UNINITIALIZED);
      expect(metadata?.token).toBe(token);
      expect(metadata?.errorCount).toBe(0);
    });
  });

  describe('resolve', () => {
    it('should resolve a registered service', async () => {
      const token = Symbol('TestService');
      const expectedValue = { value: 42 };
      const factory = () => expectedValue;

      container.register(token, factory);
      const service = await container.resolve(token);

      expect(service).toBe(expectedValue);
    });

    it('should return same instance on multiple resolve calls (singleton)', async () => {
      const token = Symbol('TestService');
      const factory = () => ({ value: Math.random() });

      container.register(token, factory);

      const instance1 = await container.resolve(token);
      const instance2 = await container.resolve(token);

      expect(instance1).toBe(instance2);
    });

    it('should throw error for unregistered service', async () => {
      const token = Symbol('UnregisteredService');

      await expect(container.resolve(token)).rejects.toThrow(
        /not registered/
      );
    });

    it('should call initialize method if available', async () => {
      const token = Symbol('TestService');
      const initializeMock = vi.fn();
      const service: IService = {
        initialize: initializeMock,
      };
      const factory = () => service;

      container.register(token, factory);
      await container.resolve(token);

      expect(initializeMock).toHaveBeenCalledOnce();
    });

    it('should handle async initialization', async () => {
      const token = Symbol('TestService');
      const service: IService = {
        initialize: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
        },
      };
      const factory = () => service;

      container.register(token, factory);
      const resolved = await container.resolve(token);

      expect(resolved).toBe(service);
    });

    it('should update lifecycle state during resolution', async () => {
      const token = Symbol('TestService');
      const factory = () => ({ value: 42 });

      container.register(token, factory);

      const metadataBefore = container.getMetadata(token);
      expect(metadataBefore?.lifecycle).toBe(ServiceLifecycle.UNINITIALIZED);

      await container.resolve(token);

      const metadataAfter = container.getMetadata(token);
      expect(metadataAfter?.lifecycle).toBe(ServiceLifecycle.READY);
    });

    it('should detect circular dependencies', async () => {
      const token = Symbol('TestService');
      let resolving = false;

      const factory = async () => {
        if (!resolving) {
          resolving = true;
          // Try to resolve self - circular dependency
          await container.resolve(token);
        }
        return { value: 42 };
      };

      container.register(token, factory);

      await expect(container.resolve(token)).rejects.toThrow(
        /Circular dependency/
      );
    });

    it('should handle initialization errors', async () => {
      const token = Symbol('TestService');
      const error = new Error('Initialization failed');
      const service: IService = {
        initialize: () => {
          throw error;
        },
      };

      container.register(token, () => service);

      await expect(container.resolve(token)).rejects.toThrow(
        'Initialization failed'
      );

      const metadata = container.getMetadata(token);
      expect(metadata?.lifecycle).toBe(ServiceLifecycle.ERROR);
      expect(metadata?.errorCount).toBe(1);
      expect(metadata?.lastError).toBe(error);
    });

    it('should update lastAccessed timestamp', async () => {
      const token = Symbol('TestService');
      const factory = () => ({ value: 42 });

      container.register(token, factory);

      const metadataBefore = container.getMetadata(token);
      expect(metadataBefore?.lastAccessed).toBeUndefined();

      await container.resolve(token);

      const metadataAfter = container.getMetadata(token);
      expect(metadataAfter?.lastAccessed).toBeInstanceOf(Date);
    });
  });

  describe('resolveSync', () => {
    it('should return undefined for uninitialized service', () => {
      const token = Symbol('TestService');
      container.register(token, () => ({ value: 42 }));

      const service = container.resolveSync(token);

      expect(service).toBeUndefined();
    });

    it('should return service instance if already initialized', async () => {
      const token = Symbol('TestService');
      const expectedValue = { value: 42 };
      container.register(token, () => expectedValue);

      await container.resolve(token);
      const service = container.resolveSync(token);

      expect(service).toBe(expectedValue);
    });
  });

  describe('isInitialized', () => {
    it('should return false for uninitialized service', () => {
      const token = Symbol('TestService');
      container.register(token, () => ({ value: 42 }));

      expect(container.isInitialized(token)).toBe(false);
    });

    it('should return true for initialized service', async () => {
      const token = Symbol('TestService');
      container.register(token, () => ({ value: 42 }));

      await container.resolve(token);

      expect(container.isInitialized(token)).toBe(true);
    });
  });

  describe('disposeService', () => {
    it('should call dispose method if available', async () => {
      const token = Symbol('TestService');
      const disposeMock = vi.fn();
      const service: IService = {
        dispose: disposeMock,
      };

      container.register(token, () => service);
      await container.resolve(token);
      await container.disposeService(token);

      expect(disposeMock).toHaveBeenCalledOnce();
    });

    it('should remove service from container', async () => {
      const token = Symbol('TestService');
      container.register(token, () => ({ value: 42 }));

      await container.resolve(token);
      expect(container.isInitialized(token)).toBe(true);

      await container.disposeService(token);
      expect(container.isInitialized(token)).toBe(false);
    });

    it('should update lifecycle state', async () => {
      const token = Symbol('TestService');
      container.register(token, () => ({ value: 42 }));

      await container.resolve(token);
      await container.disposeService(token);

      const metadata = container.getMetadata(token);
      expect(metadata?.lifecycle).toBe(ServiceLifecycle.DISPOSED);
    });

    it('should handle dispose errors', async () => {
      const token = Symbol('TestService');
      const error = new Error('Dispose failed');
      const service: IService = {
        dispose: () => {
          throw error;
        },
      };

      container.register(token, () => service);
      await container.resolve(token);

      await expect(container.disposeService(token)).rejects.toThrow(
        'Dispose failed'
      );

      const metadata = container.getMetadata(token);
      expect(metadata?.lifecycle).toBe(ServiceLifecycle.ERROR);
    });
  });

  describe('disposeAll', () => {
    it('should dispose all initialized services', async () => {
      const token1 = Symbol('Service1');
      const token2 = Symbol('Service2');
      const dispose1 = vi.fn();
      const dispose2 = vi.fn();

      container.register(token1, () => ({ dispose: dispose1 }));
      container.register(token2, () => ({ dispose: dispose2 }));

      await container.resolve(token1);
      await container.resolve(token2);

      await container.disposeAll();

      expect(dispose1).toHaveBeenCalled();
      expect(dispose2).toHaveBeenCalled();
    });

    it('should not throw if some disposals fail', async () => {
      const token1 = Symbol('Service1');
      const token2 = Symbol('Service2');

      container.register(token1, () => ({
        dispose: () => {
          throw new Error('Disposal failed');
        },
      }));
      container.register(token2, () => ({ dispose: vi.fn() }));

      await container.resolve(token1);
      await container.resolve(token2);

      await expect(container.disposeAll()).resolves.not.toThrow();
    });
  });

  describe('clear', () => {
    it('should remove all registrations and instances', async () => {
      const token1 = Symbol('Service1');
      const token2 = Symbol('Service2');

      container.register(token1, () => ({ value: 1 }));
      container.register(token2, () => ({ value: 2 }));

      await container.resolve(token1);

      container.clear();

      expect(container.has(token1)).toBe(false);
      expect(container.has(token2)).toBe(false);
      expect(container.isInitialized(token1)).toBe(false);
    });
  });

  describe('getRegisteredTokens', () => {
    it('should return all registered tokens', () => {
      const token1 = Symbol('Service1');
      const token2 = Symbol('Service2');

      container.register(token1, () => ({ value: 1 }));
      container.register(token2, () => ({ value: 2 }));

      const tokens = container.getRegisteredTokens();

      expect(tokens).toHaveLength(2);
      expect(tokens).toContain(token1);
      expect(tokens).toContain(token2);
    });
  });

  describe('getInitializedTokens', () => {
    it('should return only initialized tokens', async () => {
      const token1 = Symbol('Service1');
      const token2 = Symbol('Service2');
      const token3 = Symbol('Service3');

      container.register(token1, () => ({ value: 1 }));
      container.register(token2, () => ({ value: 2 }));
      container.register(token3, () => ({ value: 3 }));

      await container.resolve(token1);
      await container.resolve(token3);

      const tokens = container.getInitializedTokens();

      expect(tokens).toHaveLength(2);
      expect(tokens).toContain(token1);
      expect(tokens).toContain(token3);
      expect(tokens).not.toContain(token2);
    });
  });
});
