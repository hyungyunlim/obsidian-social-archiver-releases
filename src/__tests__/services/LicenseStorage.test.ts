/**
 * Tests for LicenseStorage
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LicenseStorage, LicenseStorageConfig } from '../../services/LicenseStorage';
import { LicenseInfo } from '../../types/license';
import { Logger } from '../../services/Logger';
import { Plugin } from 'obsidian';

// Mock Plugin
class MockPlugin {
  private data: any = {};

  async loadData(): Promise<any> {
    return this.data;
  }

  async saveData(data: any): Promise<void> {
    this.data = data;
  }

  clearData(): void {
    this.data = {};
  }
}

describe('LicenseStorage', () => {
  let config: LicenseStorageConfig;
  let mockPlugin: MockPlugin;
  let logger: Logger;
  let storage: LicenseStorage;

  beforeEach(() => {
    mockPlugin = new MockPlugin();
    logger = new Logger({ level: 'error' });

    config = {
      plugin: mockPlugin as unknown as Plugin,
      licenseConfig: {
        cacheDuration: 24 * 60 * 60 * 1000,
        maxDevices: 5,
        gracePeriodDays: 3,
        offlineGracePeriodDays: 7,
        productId: 'test-product',
      },
    };

    storage = new LicenseStorage(config, logger);
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await expect(storage.initialize()).resolves.toBeUndefined();

      const deviceId = await storage.getDeviceId();
      expect(deviceId).toBeDefined();
      expect(deviceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should not initialize twice', async () => {
      await storage.initialize();
      const warnSpy = vi.spyOn(logger, 'warn');

      await storage.initialize();

      expect(warnSpy).toHaveBeenCalledWith('LicenseStorage already initialized');
    });

    it('should generate device ID if not exists', async () => {
      await storage.initialize();

      const deviceId = await storage.getDeviceId();
      expect(deviceId).toBeDefined();
      expect(typeof deviceId).toBe('string');
      expect(deviceId.length).toBeGreaterThan(0);
    });

    it('should load existing device ID', async () => {
      // First initialization
      await storage.initialize();
      const deviceId1 = await storage.getDeviceId();
      await storage.shutdown();

      // Second initialization with same plugin (persistent data)
      const storage2 = new LicenseStorage(config, logger);
      await storage2.initialize();
      const deviceId2 = await storage2.getDeviceId();

      expect(deviceId1).toBe(deviceId2);
    });
  });

  describe('storeLicense and retrieveLicense', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should store and retrieve license', async () => {
      const licenseKey = 'TEST-LICENSE-KEY-123';
      const licenseInfo: LicenseInfo = {
        licenseKey,
        provider: 'gumroad',
        productId: 'prod123',
        email: 'test@example.com',
        purchaseDate: new Date('2024-01-15'),
        expiresAt: null,
        devices: [],
        isActive: true,
      };

      await storage.storeLicense(licenseKey, licenseInfo);

      const retrieved = await storage.retrieveLicense();
      expect(retrieved).toBeDefined();
      expect(retrieved?.licenseKey).toBe(licenseKey);
      expect(retrieved?.email).toBe('test@example.com');
      expect(retrieved?.productId).toBe('prod123');
    });

    it('should encrypt license key', async () => {
      const licenseKey = 'SENSITIVE-KEY';
      const licenseInfo: LicenseInfo = {
        licenseKey,
        provider: 'gumroad',
        productId: 'prod123',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: null,
        devices: [],
        isActive: true,
      };

      await storage.storeLicense(licenseKey, licenseInfo);

      // Check that stored data is encrypted
      const cachedInfo = storage.getCachedInfo();
      expect(cachedInfo).toBeDefined();
      expect(cachedInfo?.encryptedKey).not.toBe(licenseKey);
      expect(cachedInfo?.iv).toBeDefined();
      expect(cachedInfo?.integrityHash).toBeDefined();
    });

    it('should return null when no license stored', async () => {
      const retrieved = await storage.retrieveLicense();
      expect(retrieved).toBeNull();
    });

    it('should include integrity hash in stored data', async () => {
      const licenseKey = 'TEST-KEY';
      const licenseInfo: LicenseInfo = {
        licenseKey,
        provider: 'gumroad',
        productId: 'prod123',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: null,
        devices: [],
        isActive: true,
      };

      await storage.storeLicense(licenseKey, licenseInfo);

      const cachedInfo = storage.getCachedInfo();
      expect(cachedInfo?.integrityHash).toBeDefined();
      expect(typeof cachedInfo?.integrityHash).toBe('string');
      expect(cachedInfo?.integrityHash?.length).toBeGreaterThan(0);
    });

    it('should detect tampered data', async () => {
      const licenseKey = 'TEST-KEY';
      const licenseInfo: LicenseInfo = {
        licenseKey,
        provider: 'gumroad',
        productId: 'prod123',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: null,
        devices: [],
        isActive: true,
      };

      await storage.storeLicense(licenseKey, licenseInfo);

      // Tamper with stored data
      const data = await mockPlugin.loadData();
      data.licenseStorage.license.encryptedKey = 'TAMPERED-DATA';

      await mockPlugin.saveData(data);

      // Should fail integrity check
      await expect(storage.retrieveLicense()).rejects.toThrow('corrupted or tampered');
    });

    it('should persist across sessions', async () => {
      const licenseKey = 'PERSISTENT-KEY';
      const licenseInfo: LicenseInfo = {
        licenseKey,
        provider: 'gumroad',
        productId: 'prod123',
        email: 'persistent@example.com',
        purchaseDate: new Date(),
        expiresAt: null,
        devices: [],
        isActive: true,
      };

      await storage.storeLicense(licenseKey, licenseInfo);
      await storage.shutdown();

      // Create new storage instance with same plugin
      const storage2 = new LicenseStorage(config, logger);
      await storage2.initialize();

      const retrieved = await storage2.retrieveLicense();
      expect(retrieved?.email).toBe('persistent@example.com');
    });
  });

  describe('clearLicense', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should clear stored license', async () => {
      const licenseKey = 'TEST-KEY';
      const licenseInfo: LicenseInfo = {
        licenseKey,
        provider: 'gumroad',
        productId: 'prod123',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: null,
        devices: [],
        isActive: true,
      };

      await storage.storeLicense(licenseKey, licenseInfo);
      expect(await storage.retrieveLicense()).not.toBeNull();

      await storage.clearLicense();
      expect(await storage.retrieveLicense()).toBeNull();
    });

    it('should preserve device ID after clearing license', async () => {
      const deviceId = await storage.getDeviceId();

      const licenseKey = 'TEST-KEY';
      const licenseInfo: LicenseInfo = {
        licenseKey,
        provider: 'gumroad',
        productId: 'prod123',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: null,
        devices: [],
        isActive: true,
      };

      await storage.storeLicense(licenseKey, licenseInfo);
      await storage.clearLicense();

      const deviceIdAfter = await storage.getDeviceId();
      expect(deviceIdAfter).toBe(deviceId);
    });
  });

  describe('createBackup and restoreBackup', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should create and restore backup', async () => {
      const licenseKey = 'BACKUP-TEST-KEY';
      const licenseInfo: LicenseInfo = {
        licenseKey,
        provider: 'gumroad',
        productId: 'prod123',
        email: 'backup@example.com',
        purchaseDate: new Date('2024-01-15'),
        expiresAt: null,
        devices: [],
        isActive: true,
      };

      await storage.storeLicense(licenseKey, licenseInfo);

      const backup = await storage.createBackup();
      expect(backup).toBeDefined();
      expect(typeof backup).toBe('string');

      // Clear and restore
      await storage.clearLicense();
      expect(await storage.retrieveLicense()).toBeNull();

      await storage.restoreBackup(backup);

      const restored = await storage.retrieveLicense();
      expect(restored?.email).toBe('backup@example.com');
      expect(restored?.licenseKey).toBe(licenseKey);
    });

    it('should throw error when creating backup with no license', async () => {
      await expect(storage.createBackup()).rejects.toThrow('No license data to backup');
    });

    it('should throw error when restoring invalid backup', async () => {
      await expect(storage.restoreBackup('invalid-backup-data')).rejects.toThrow();
    });

    it('should reject backup from different device', async () => {
      const licenseKey = 'DEVICE-TEST-KEY';
      const licenseInfo: LicenseInfo = {
        licenseKey,
        provider: 'gumroad',
        productId: 'prod123',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: null,
        devices: [],
        isActive: true,
      };

      await storage.storeLicense(licenseKey, licenseInfo);

      const backup = await storage.createBackup();

      // Tamper with backup to change device ID
      const backupObj = JSON.parse(atob(backup));
      backupObj.deviceId = 'different-device-id';
      const tamperedBackup = btoa(JSON.stringify(backupObj));

      await expect(storage.restoreBackup(tamperedBackup)).rejects.toThrow('different device');
    });

    it('should reject backup with newer version', async () => {
      const licenseKey = 'VERSION-TEST-KEY';
      const licenseInfo: LicenseInfo = {
        licenseKey,
        provider: 'gumroad',
        productId: 'prod123',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: null,
        devices: [],
        isActive: true,
      };

      await storage.storeLicense(licenseKey, licenseInfo);

      const backup = await storage.createBackup();

      // Tamper with backup to increase version
      const backupObj = JSON.parse(atob(backup));
      backupObj.version = 999;
      const tamperedBackup = btoa(JSON.stringify(backupObj));

      await expect(storage.restoreBackup(tamperedBackup)).rejects.toThrow('newer than current version');
    });

    it('should verify integrity after restore', async () => {
      const licenseKey = 'INTEGRITY-TEST-KEY';
      const licenseInfo: LicenseInfo = {
        licenseKey,
        provider: 'gumroad',
        productId: 'prod123',
        email: 'test@example.com',
        purchaseDate: new Date(),
        expiresAt: null,
        devices: [],
        isActive: true,
      };

      await storage.storeLicense(licenseKey, licenseInfo);

      const backup = await storage.createBackup();

      // Tamper with license data in backup
      const backupObj = JSON.parse(atob(backup));
      backupObj.license.encryptedKey = 'TAMPERED';
      const tamperedBackup = btoa(JSON.stringify(backupObj));

      await expect(storage.restoreBackup(tamperedBackup)).rejects.toThrow('integrity check');
    });
  });

  describe('getCachedInfo', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should return cached info without decrypting', async () => {
      const licenseKey = 'TEST-KEY';
      const licenseInfo: LicenseInfo = {
        licenseKey,
        provider: 'gumroad',
        productId: 'prod123',
        email: 'cached@example.com',
        purchaseDate: new Date(),
        expiresAt: null,
        devices: [],
        isActive: true,
      };

      await storage.storeLicense(licenseKey, licenseInfo);

      const cachedInfo = storage.getCachedInfo();
      expect(cachedInfo).toBeDefined();
      expect(cachedInfo?.encryptedKey).toBeDefined();
      expect(cachedInfo?.iv).toBeDefined();
      expect(cachedInfo?.cachedInfo?.email).toBe('cached@example.com');
    });

    it('should return null when no license cached', async () => {
      const cachedInfo = storage.getCachedInfo();
      expect(cachedInfo).toBeNull();
    });
  });

  describe('migrate', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should migrate storage version', async () => {
      // Set old version
      const data = await mockPlugin.loadData();
      data.licenseStorage.version = 0;
      await mockPlugin.saveData(data);

      await storage.migrate(0);

      const updatedData = await mockPlugin.loadData();
      expect(updatedData.licenseStorage.version).toBe(1);
    });
  });
});
