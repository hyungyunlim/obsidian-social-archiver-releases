/**
 * GracePeriodManager tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GracePeriodManager } from '../../services/licensing/GracePeriodManager';
import { LicenseInfo } from '../../types/license';
import { Logger } from '../../services/Logger';

describe('GracePeriodManager', () => {
  let manager: GracePeriodManager;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    manager = new GracePeriodManager(
      {
        gracePeriodDays: 3,
        maxArchivesPerDay: 5,
        allowAIFeatures: false,
        allowSharing: false,
      },
      mockLogger
    );
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await manager.initialize();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Initializing GracePeriodManager',
        expect.any(Object)
      );
    });
  });

  describe('license management', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should set license for monitoring', () => {
      const license: LicenseInfo = {
        licenseKey: 'test-key',
        provider: 'gumroad',
        productId: 'test-product',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // Expired
        devices: [],
        isActive: true,
        inGracePeriod: true,
        gracePeriodEndsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      };

      manager.setLicense(license);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'License set for grace period management',
        expect.any(Object)
      );
    });
  });

  describe('grace period status', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should return not in grace period for active license', () => {
      const license: LicenseInfo = {
        licenseKey: 'test-key',
        provider: 'gumroad',
        productId: 'test-product',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Active
        devices: [],
        isActive: true,
      };

      manager.setLicense(license);

      const status = manager.getGracePeriodStatus();
      expect(status.isInGracePeriod).toBe(false);
      expect(status.daysRemaining).toBe(0);
    });

    it('should return grace period status for expired license', () => {
      const license: LicenseInfo = {
        licenseKey: 'test-key',
        provider: 'gumroad',
        productId: 'test-product',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // Expired
        devices: [],
        isActive: true,
        inGracePeriod: true,
        gracePeriodEndsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      };

      manager.setLicense(license);

      const status = manager.getGracePeriodStatus();
      expect(status.isInGracePeriod).toBe(true);
      expect(status.daysRemaining).toBeGreaterThan(0);
    });

    it('should calculate days remaining correctly', () => {
      const gracePeriodEndsAt = new Date(Date.now() + 2.5 * 24 * 60 * 60 * 1000);

      const license: LicenseInfo = {
        licenseKey: 'test-key',
        provider: 'gumroad',
        productId: 'test-product',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        devices: [],
        isActive: true,
        inGracePeriod: true,
        gracePeriodEndsAt,
      };

      manager.setLicense(license);

      const status = manager.getGracePeriodStatus();
      expect(status.daysRemaining).toBe(3); // Ceiling of 2.5
    });
  });

  describe('feature restrictions', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should allow all features for active license', () => {
      const license: LicenseInfo = {
        licenseKey: 'test-key',
        provider: 'gumroad',
        productId: 'test-product',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        devices: [],
        isActive: true,
      };

      manager.setLicense(license);

      expect(manager.isFeatureAllowed('canArchive')).toBe(true);
      expect(manager.isFeatureAllowed('canUseAI')).toBe(true);
      expect(manager.isFeatureAllowed('canUseDeepResearch')).toBe(true);
      expect(manager.isFeatureAllowed('canShare')).toBe(true);
    });

    it('should restrict features during grace period', () => {
      const license: LicenseInfo = {
        licenseKey: 'test-key',
        provider: 'gumroad',
        productId: 'test-product',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        devices: [],
        isActive: true,
        inGracePeriod: true,
        gracePeriodEndsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      };

      manager.setLicense(license);

      const status = manager.getGracePeriodStatus();

      expect(status.restrictions.canArchive).toBe(true); // Basic archiving allowed
      expect(status.restrictions.canUseAI).toBe(false); // AI disabled by default
      expect(status.restrictions.canUseDeepResearch).toBe(false); // Always disabled
      expect(status.restrictions.canShare).toBe(false); // Sharing disabled by default
      expect(status.restrictions.maxArchivesPerDay).toBe(5);
    });
  });

  describe('archive limits', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should allow unlimited archives for active license', () => {
      const license: LicenseInfo = {
        licenseKey: 'test-key',
        provider: 'gumroad',
        productId: 'test-product',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        devices: [],
        isActive: true,
      };

      manager.setLicense(license);

      expect(manager.canArchive()).toBe(true);
      expect(manager.getRemainingArchives()).toBe(Infinity);
    });

    it('should enforce daily limit during grace period', () => {
      const license: LicenseInfo = {
        licenseKey: 'test-key',
        provider: 'gumroad',
        productId: 'test-product',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        devices: [],
        isActive: true,
        inGracePeriod: true,
        gracePeriodEndsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      };

      manager.setLicense(license);

      // Should start with full allowance
      expect(manager.getRemainingArchives()).toBe(5);
      expect(manager.canArchive()).toBe(true);

      // Record archives
      for (let i = 0; i < 5; i++) {
        manager.recordArchive();
      }

      expect(manager.getArchivesUsedToday()).toBe(5);
      expect(manager.getRemainingArchives()).toBe(0);
      expect(manager.canArchive()).toBe(false);
    });

    it('should track archives used today', () => {
      const license: LicenseInfo = {
        licenseKey: 'test-key',
        provider: 'gumroad',
        productId: 'test-product',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        devices: [],
        isActive: true,
        inGracePeriod: true,
        gracePeriodEndsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      };

      manager.setLicense(license);

      expect(manager.getArchivesUsedToday()).toBe(0);

      manager.recordArchive();
      expect(manager.getArchivesUsedToday()).toBe(1);

      manager.recordArchive();
      manager.recordArchive();
      expect(manager.getArchivesUsedToday()).toBe(3);
    });
  });

  describe('shutdown', () => {
    it('should clean up on shutdown', async () => {
      await manager.initialize();
      await manager.shutdown();

      expect(mockLogger.info).toHaveBeenCalledWith('Shutting down GracePeriodManager');
    });
  });
});
