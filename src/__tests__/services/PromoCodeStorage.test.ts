/**
 * PromoCodeStorage tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PromoCodeStorage } from '../../services/licensing/PromoCodeStorage';
import {
  PromoCodeType,
  AppliedPromoCode,
} from '../../types/license';
import { Logger } from '../../services/Logger';
import type { Plugin } from 'obsidian';

describe('PromoCodeStorage', () => {
  let storage: PromoCodeStorage;
  let mockPlugin: Plugin;
  let mockLogger: Logger;
  let mockData: Record<string, any>;

  beforeEach(() => {
    mockData = {};

    mockPlugin = {
      loadData: vi.fn(async () => mockData),
      saveData: vi.fn(async (data: any) => {
        mockData = data;
      }),
    } as unknown as Plugin;

    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    storage = new PromoCodeStorage(mockPlugin, mockLogger);
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await storage.initialize();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Initializing PromoCodeStorage'
      );
    });

    it('should load existing data on init', async () => {
      const existingData = {
        'social-archiver-promo-codes': {
          version: 1,
          appliedCodes: [
            {
              code: 'TEST',
              licenseKey: 'test-key',
              email: 'test@example.com',
              appliedAt: new Date().toISOString(),
              benefit: {
                type: PromoCodeType.BONUS_CREDITS,
                amount: 50,
                description: '50 bonus credits',
              },
            },
          ],
          analytics: {},
          lastUpdated: Date.now(),
        },
      };

      mockData = existingData;

      await storage.initialize();

      const codes = storage.getAppliedCodes('test-key');
      expect(codes.length).toBe(1);
      expect(codes[0].code).toBe('TEST');
    });

    it('should handle missing data gracefully', async () => {
      mockData = {};

      await storage.initialize();

      const codes = storage.getAllAppliedCodes();
      expect(codes.length).toBe(0);
    });
  });

  describe('applied codes storage', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should store applied promo code', async () => {
      const appliedCode: AppliedPromoCode = {
        code: 'TESTCODE',
        licenseKey: 'test-license-123',
        email: 'user@example.com',
        appliedAt: new Date(),
        benefit: {
          type: PromoCodeType.BONUS_CREDITS,
          amount: 100,
          description: '100 bonus credits',
        },
      };

      await storage.storeAppliedCode(appliedCode);

      expect(mockPlugin.saveData).toHaveBeenCalled();
      expect(storage.isCodeApplied('TESTCODE', 'test-license-123')).toBe(true);
    });

    it('should check if code is applied', async () => {
      const appliedCode: AppliedPromoCode = {
        code: 'APPLIED',
        licenseKey: 'license-1',
        email: 'user@example.com',
        appliedAt: new Date(),
        benefit: {
          type: PromoCodeType.BONUS_CREDITS,
          amount: 50,
          description: '50 credits',
        },
      };

      await storage.storeAppliedCode(appliedCode);

      expect(storage.isCodeApplied('APPLIED', 'license-1')).toBe(true);
      expect(storage.isCodeApplied('APPLIED', 'license-2')).toBe(false);
      expect(storage.isCodeApplied('OTHER', 'license-1')).toBe(false);
    });

    it('should get applied codes for specific license', async () => {
      const code1: AppliedPromoCode = {
        code: 'CODE1',
        licenseKey: 'license-1',
        email: 'user1@example.com',
        appliedAt: new Date(),
        benefit: {
          type: PromoCodeType.BONUS_CREDITS,
          amount: 50,
          description: '50 credits',
        },
      };

      const code2: AppliedPromoCode = {
        code: 'CODE2',
        licenseKey: 'license-1',
        email: 'user1@example.com',
        appliedAt: new Date(),
        benefit: {
          type: PromoCodeType.EXTENDED_TRIAL,
          amount: 30,
          description: '30 days trial',
        },
      };

      const code3: AppliedPromoCode = {
        code: 'CODE3',
        licenseKey: 'license-2',
        email: 'user2@example.com',
        appliedAt: new Date(),
        benefit: {
          type: PromoCodeType.BONUS_CREDITS,
          amount: 25,
          description: '25 credits',
        },
      };

      await storage.storeAppliedCode(code1);
      await storage.storeAppliedCode(code2);
      await storage.storeAppliedCode(code3);

      const license1Codes = storage.getAppliedCodes('license-1');
      const license2Codes = storage.getAppliedCodes('license-2');

      expect(license1Codes.length).toBe(2);
      expect(license2Codes.length).toBe(1);
      expect(license1Codes[0].code).toBe('CODE1');
      expect(license1Codes[1].code).toBe('CODE2');
      expect(license2Codes[0].code).toBe('CODE3');
    });

    it('should get all applied codes', async () => {
      const code1: AppliedPromoCode = {
        code: 'CODE1',
        licenseKey: 'license-1',
        email: 'user1@example.com',
        appliedAt: new Date(),
        benefit: {
          type: PromoCodeType.BONUS_CREDITS,
          amount: 50,
          description: '50 credits',
        },
      };

      const code2: AppliedPromoCode = {
        code: 'CODE2',
        licenseKey: 'license-2',
        email: 'user2@example.com',
        appliedAt: new Date(),
        benefit: {
          type: PromoCodeType.BONUS_CREDITS,
          amount: 25,
          description: '25 credits',
        },
      };

      await storage.storeAppliedCode(code1);
      await storage.storeAppliedCode(code2);

      const allCodes = storage.getAllAppliedCodes();
      expect(allCodes.length).toBe(2);
    });
  });

  describe('analytics storage', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should update analytics', async () => {
      await storage.updateAnalytics('TESTCODE', {
        totalUses: 10,
        conversions: 5,
        revenue: 100,
      });

      const analytics = storage.getAnalytics('TESTCODE');
      expect(analytics).toBeDefined();
      expect(analytics?.totalUses).toBe(10);
      expect(analytics?.conversions).toBe(5);
      expect(analytics?.revenue).toBe(100);
    });

    it('should create analytics if not exists', async () => {
      await storage.updateAnalytics('NEWCODE', {
        totalUses: 1,
      });

      const analytics = storage.getAnalytics('NEWCODE');
      expect(analytics).toBeDefined();
      expect(analytics?.code).toBe('NEWCODE');
      expect(analytics?.totalUses).toBe(1);
    });

    it('should merge analytics updates', async () => {
      await storage.updateAnalytics('CODE', { totalUses: 10 });
      await storage.updateAnalytics('CODE', { conversions: 5 });

      const analytics = storage.getAnalytics('CODE');
      expect(analytics?.totalUses).toBe(10);
      expect(analytics?.conversions).toBe(5);
    });

    it('should get all analytics', async () => {
      await storage.updateAnalytics('CODE1', { totalUses: 10 });
      await storage.updateAnalytics('CODE2', { totalUses: 20 });

      const allAnalytics = storage.getAllAnalytics();
      expect(allAnalytics.length).toBe(2);
    });

    it('should return undefined for non-existent analytics', () => {
      const analytics = storage.getAnalytics('NONEXISTENT');
      expect(analytics).toBeUndefined();
    });
  });

  describe('data persistence', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should persist data on store', async () => {
      const appliedCode: AppliedPromoCode = {
        code: 'PERSIST',
        licenseKey: 'test-key',
        email: 'user@example.com',
        appliedAt: new Date(),
        benefit: {
          type: PromoCodeType.BONUS_CREDITS,
          amount: 50,
          description: '50 credits',
        },
      };

      await storage.storeAppliedCode(appliedCode);

      expect(mockPlugin.saveData).toHaveBeenCalled();

      // Verify saved data structure
      const savedData = mockData['social-archiver-promo-codes'];
      expect(savedData.version).toBe(1);
      expect(savedData.appliedCodes.length).toBe(1);
    });

    it('should handle save errors', async () => {
      vi.spyOn(mockPlugin, 'saveData').mockRejectedValueOnce(
        new Error('Save failed')
      );

      const appliedCode: AppliedPromoCode = {
        code: 'ERROR',
        licenseKey: 'test-key',
        email: 'user@example.com',
        appliedAt: new Date(),
        benefit: {
          type: PromoCodeType.BONUS_CREDITS,
          amount: 50,
          description: '50 credits',
        },
      };

      await expect(storage.storeAppliedCode(appliedCode)).rejects.toThrow(
        'Save failed'
      );
    });
  });

  describe('import/export', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should export data', async () => {
      const appliedCode: AppliedPromoCode = {
        code: 'EXPORT',
        licenseKey: 'test-key',
        email: 'user@example.com',
        appliedAt: new Date(),
        benefit: {
          type: PromoCodeType.BONUS_CREDITS,
          amount: 50,
          description: '50 credits',
        },
      };

      await storage.storeAppliedCode(appliedCode);
      await storage.updateAnalytics('EXPORT', { totalUses: 10 });

      const exported = storage.exportData();

      expect(exported.version).toBe(1);
      expect(exported.appliedCodes.length).toBe(1);
      expect(exported.analytics['EXPORT']).toBeDefined();
      expect(exported.lastUpdated).toBeDefined();
    });

    it('should import data', async () => {
      const importData = {
        version: 1,
        appliedCodes: [
          {
            code: 'IMPORT',
            licenseKey: 'test-key',
            email: 'user@example.com',
            appliedAt: new Date(),
            benefit: {
              type: PromoCodeType.BONUS_CREDITS,
              amount: 100,
              description: '100 credits',
            },
          },
        ],
        analytics: {
          IMPORT: {
            code: 'IMPORT',
            totalUses: 20,
            conversions: 10,
            revenue: 200,
          },
        },
        lastUpdated: Date.now(),
      };

      await storage.importData(importData);

      expect(storage.isCodeApplied('IMPORT', 'test-key')).toBe(true);
      expect(storage.getAnalytics('IMPORT')).toBeDefined();
    });

    it('should clear existing data on import', async () => {
      // Add some initial data
      const code1: AppliedPromoCode = {
        code: 'OLD',
        licenseKey: 'test-key',
        email: 'user@example.com',
        appliedAt: new Date(),
        benefit: {
          type: PromoCodeType.BONUS_CREDITS,
          amount: 50,
          description: '50 credits',
        },
      };

      await storage.storeAppliedCode(code1);

      // Import new data
      const importData = {
        version: 1,
        appliedCodes: [
          {
            code: 'NEW',
            licenseKey: 'test-key',
            email: 'user@example.com',
            appliedAt: new Date(),
            benefit: {
              type: PromoCodeType.BONUS_CREDITS,
              amount: 100,
              description: '100 credits',
            },
          },
        ],
        analytics: {},
        lastUpdated: Date.now(),
      };

      await storage.importData(importData);

      // Old code should be gone
      expect(storage.isCodeApplied('OLD', 'test-key')).toBe(false);
      // New code should exist
      expect(storage.isCodeApplied('NEW', 'test-key')).toBe(true);
    });
  });

  describe('clear all', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should clear all data', async () => {
      const appliedCode: AppliedPromoCode = {
        code: 'CLEAR',
        licenseKey: 'test-key',
        email: 'user@example.com',
        appliedAt: new Date(),
        benefit: {
          type: PromoCodeType.BONUS_CREDITS,
          amount: 50,
          description: '50 credits',
        },
      };

      await storage.storeAppliedCode(appliedCode);
      await storage.updateAnalytics('CLEAR', { totalUses: 10 });

      await storage.clearAll();

      expect(storage.getAllAppliedCodes().length).toBe(0);
      expect(storage.getAllAnalytics().length).toBe(0);
    });
  });

  describe('shutdown', () => {
    it('should save data on shutdown', async () => {
      await storage.initialize();

      const appliedCode: AppliedPromoCode = {
        code: 'SHUTDOWN',
        licenseKey: 'test-key',
        email: 'user@example.com',
        appliedAt: new Date(),
        benefit: {
          type: PromoCodeType.BONUS_CREDITS,
          amount: 50,
          description: '50 credits',
        },
      };

      await storage.storeAppliedCode(appliedCode);

      await storage.shutdown();

      expect(mockPlugin.saveData).toHaveBeenCalled();
    });
  });
});
