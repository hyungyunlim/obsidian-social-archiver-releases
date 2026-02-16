/**
 * LicenseExpirationNotifier tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LicenseExpirationNotifier, NotificationThreshold } from '../../services/licensing/LicenseExpirationNotifier';
import { LicenseInfo } from '../../types/license';
import { Logger } from '../../services/Logger';

// Mock Obsidian Notice
vi.mock('obsidian', () => ({
  Notice: vi.fn((message: string, duration: number) => {
    // Mock implementation
  }),
}));

describe('LicenseExpirationNotifier', () => {
  let notifier: LicenseExpirationNotifier;
  let mockLogger: Logger;

  beforeEach(() => {
    vi.useFakeTimers();

    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    notifier = new LicenseExpirationNotifier(
      {
        enabled: true,
        checkInterval: 60000, // 1 minute for testing
      },
      mockLogger
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await notifier.initialize();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Initializing LicenseExpirationNotifier',
        expect.any(Object)
      );
    });

    it('should start checking when enabled', async () => {
      await notifier.initialize();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Expiration checking started',
        expect.any(Object)
      );
    });

    it('should not start checking when disabled', async () => {
      const disabledNotifier = new LicenseExpirationNotifier(
        { enabled: false },
        mockLogger
      );

      await disabledNotifier.initialize();

      expect(mockLogger.debug).not.toHaveBeenCalledWith(
        'Expiration checking started',
        expect.any(Object)
      );
    });
  });

  describe('license monitoring', () => {
    beforeEach(async () => {
      await notifier.initialize();
    });

    it('should set license for monitoring', () => {
      const license: LicenseInfo = {
        licenseKey: 'test-key',
        provider: 'gumroad',
        productId: 'test-product',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days
        devices: [],
        isActive: true,
      };

      notifier.setLicense(license);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'License set for monitoring',
        expect.any(Object)
      );
    });

    it('should clear notifications when license is cleared', () => {
      const license: LicenseInfo = {
        licenseKey: 'test-key',
        provider: 'gumroad',
        productId: 'test-product',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        devices: [],
        isActive: true,
      };

      notifier.setLicense(license);
      notifier.setLicense(undefined);

      expect(mockLogger.debug).toHaveBeenCalledWith('License cleared from monitoring');
    });
  });

  describe('expiration notifications', () => {
    beforeEach(async () => {
      await notifier.initialize();
    });

    it('should notify 7 days before expiration', () => {
      const license: LicenseInfo = {
        licenseKey: 'test-key',
        provider: 'gumroad',
        productId: 'test-product',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Exactly 7 days
        devices: [],
        isActive: true,
      };

      notifier.setLicense(license);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Sending expiration notification',
        expect.objectContaining({
          threshold: NotificationThreshold.SEVEN_DAYS,
        })
      );
    });

    it('should notify 3 days before expiration', () => {
      const license: LicenseInfo = {
        licenseKey: 'test-key',
        provider: 'gumroad',
        productId: 'test-product',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // Exactly 3 days
        devices: [],
        isActive: true,
      };

      notifier.setLicense(license);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Sending expiration notification',
        expect.objectContaining({
          threshold: NotificationThreshold.THREE_DAYS,
        })
      );
    });

    it('should notify 1 day before expiration', () => {
      const license: LicenseInfo = {
        licenseKey: 'test-key',
        provider: 'gumroad',
        productId: 'test-product',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000), // Exactly 1 day
        devices: [],
        isActive: true,
      };

      notifier.setLicense(license);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Sending expiration notification',
        expect.objectContaining({
          threshold: NotificationThreshold.ONE_DAY,
        })
      );
    });

    it('should not notify more than once for same threshold', () => {
      const license: LicenseInfo = {
        licenseKey: 'test-key',
        provider: 'gumroad',
        productId: 'test-product',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        devices: [],
        isActive: true,
      };

      notifier.setLicense(license);

      const firstCallCount = (mockLogger.info as any).mock.calls.length;

      // Trigger check again
      notifier.setLicense(license);

      // Should not have additional notification
      expect((mockLogger.info as any).mock.calls.length).toBe(firstCallCount + 1);
    });

    it('should not notify for licenses without expiration date', () => {
      const license: LicenseInfo = {
        licenseKey: 'test-key',
        provider: 'gumroad',
        productId: 'test-product',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: null, // Lifetime license
        devices: [],
        isActive: true,
      };

      notifier.setLicense(license);

      expect(mockLogger.info).not.toHaveBeenCalledWith(
        'Sending expiration notification',
        expect.any(Object)
      );
    });
  });

  describe('grace period notifications', () => {
    beforeEach(async () => {
      await notifier.initialize();
    });

    it('should notify during grace period', () => {
      const expiresAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // Expired 1 day ago
      const gracePeriodEndsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // 2 days remaining

      const license: LicenseInfo = {
        licenseKey: 'test-key',
        provider: 'gumroad',
        productId: 'test-product',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt,
        devices: [],
        isActive: true,
        inGracePeriod: true,
        gracePeriodEndsAt,
      };

      notifier.setLicense(license);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Sending grace period notification',
        expect.any(Object)
      );
    });

    it('should not spam grace period notifications', async () => {
      const expiresAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
      const gracePeriodEndsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

      const license: LicenseInfo = {
        licenseKey: 'test-key',
        provider: 'gumroad',
        productId: 'test-product',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt,
        devices: [],
        isActive: true,
        inGracePeriod: true,
        gracePeriodEndsAt,
      };

      notifier.setLicense(license);

      const firstCallCount = (mockLogger.warn as any).mock.calls.filter(
        (call: any) => call[0] === 'Sending grace period notification'
      ).length;

      // Trigger check again immediately
      notifier.setLicense(license);

      const secondCallCount = (mockLogger.warn as any).mock.calls.filter(
        (call: any) => call[0] === 'Sending grace period notification'
      ).length;

      // Should not have additional notification
      expect(secondCallCount).toBe(firstCallCount);
    });
  });

  describe('enable/disable', () => {
    beforeEach(async () => {
      await notifier.initialize();
    });

    it('should enable notifications', () => {
      notifier.disable();
      notifier.enable();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'License expiration notifications enabled'
      );
    });

    it('should disable notifications', () => {
      notifier.disable();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'License expiration notifications disabled'
      );
    });
  });

  describe('notification history', () => {
    beforeEach(async () => {
      await notifier.initialize();
    });

    it('should track notification history', () => {
      const license: LicenseInfo = {
        licenseKey: 'test-key',
        provider: 'gumroad',
        productId: 'test-product',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        devices: [],
        isActive: true,
      };

      notifier.setLicense(license);

      const history = notifier.getHistory();
      expect(history.length).toBeGreaterThan(0);
    });

    it('should clear notification history', () => {
      const license: LicenseInfo = {
        licenseKey: 'test-key',
        provider: 'gumroad',
        productId: 'test-product',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        devices: [],
        isActive: true,
      };

      notifier.setLicense(license);
      notifier.clearHistory();

      const history = notifier.getHistory();
      expect(history.length).toBe(0);
    });
  });

  describe('shutdown', () => {
    it('should clean up on shutdown', async () => {
      await notifier.initialize();
      await notifier.shutdown();

      expect(mockLogger.info).toHaveBeenCalledWith('Shutting down LicenseExpirationNotifier');
    });
  });
});
