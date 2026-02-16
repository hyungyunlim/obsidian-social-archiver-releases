/**
 * CreditManager Credit Pack tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CreditManager } from '../../services/CreditManager';
import { CloudflareAPI } from '../../services/CloudflareAPI';
import { CostTracker } from '../../services/CostTracker';
import { Logger } from '../../services/Logger';
import { LicenseType } from '../../types/license';

describe('CreditManager - Credit Pack Support', () => {
  let creditManager: CreditManager;
  let mockAPI: CloudflareAPI;
  let mockTracker: CostTracker;
  let mockLogger: Logger;

  beforeEach(() => {
    mockAPI = {
      initialize: vi.fn(),
      shutdown: vi.fn(),
      validateLicense: vi.fn(),
      getBalance: vi.fn(),
      useCredits: vi.fn(),
      refundCredits: vi.fn(),
      setLicenseKey: vi.fn(),
    } as unknown as CloudflareAPI;

    mockTracker = {
      initialize: vi.fn(),
      shutdown: vi.fn(),
      getCost: vi.fn(() => 1),
      recordTransaction: vi.fn(),
      getTransaction: vi.fn(),
      estimateCost: vi.fn(),
    } as unknown as CostTracker;

    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    creditManager = new CreditManager(
      {
        licenseKey: 'test-key',
        alerts: {
          enabled: false,
          thresholds: [],
          showNotifications: false,
          logToConsole: false,
        },
        reservationTimeout: 300000,
        autoRefund: true,
      },
      mockAPI,
      mockTracker,
      mockLogger
    );
  });

  describe('Credit Pack License Type', () => {
    it('should detect credit pack license', async () => {
      await creditManager.initialize();

      (mockAPI.validateLicense as any).mockResolvedValue({
        plan: 'pro',
        creditsRemaining: 100,
        creditLimit: 100,
        resetDate: null,
        features: [],
      });

      const license = await creditManager.loadLicense('test-key');

      // Manually set license type for testing
      (license as any).licenseType = LicenseType.CREDIT_PACK;
      (license as any).initialCredits = 100;
      (license as any).creditsResetMonthly = false;

      expect(creditManager.isCreditPack()).toBe(true);
      expect(creditManager.getLicenseType()).toBe(LicenseType.CREDIT_PACK);
    });

    it('should not reset credits for credit pack', async () => {
      await creditManager.initialize();

      (mockAPI.validateLicense as any).mockResolvedValue({
        plan: 'pro',
        creditsRemaining: 50,
        creditLimit: 100,
        resetDate: null,
        features: [],
      });

      const license = await creditManager.loadLicense('test-key');
      (license as any).licenseType = LicenseType.CREDIT_PACK;
      (license as any).initialCredits = 100;
      (license as any).creditsResetMonthly = false;

      // Should not reset
      expect(creditManager.shouldResetCredits()).toBe(false);

      // Try to reset (should be skipped)
      const balanceBefore = creditManager.getBalance();
      await creditManager.resetMonthlyCredits();
      const balanceAfter = creditManager.getBalance();

      expect(balanceAfter).toBe(balanceBefore);
    });

    it('should deplete credits without reset', async () => {
      await creditManager.initialize();

      (mockAPI.validateLicense as any).mockResolvedValue({
        plan: 'pro',
        creditsRemaining: 100,
        creditLimit: 100,
        resetDate: null,
        features: [],
      });

      const license = await creditManager.loadLicense('test-key');
      (license as any).licenseType = LicenseType.CREDIT_PACK;
      (license as any).initialCredits = 100;
      (license as any).creditsResetMonthly = false;

      // Use credits
      (mockAPI.useCredits as any).mockResolvedValue({
        creditsRemaining: 99,
      });

      await creditManager.deductCredits('facebook', 1);

      expect(creditManager.getBalance()).toBe(99);

      // Credits should not reset even after time passes
      expect(creditManager.shouldResetCredits()).toBe(false);
    });
  });

  describe('Subscription License Type', () => {
    it('should detect subscription license', async () => {
      await creditManager.initialize();

      (mockAPI.validateLicense as any).mockResolvedValue({
        plan: 'pro',
        creditsRemaining: 500,
        creditLimit: 500,
        resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        features: [],
      });

      const license = await creditManager.loadLicense('test-key');
      (license as any).licenseType = LicenseType.SUBSCRIPTION;
      (license as any).creditsResetMonthly = true;

      expect(creditManager.isCreditPack()).toBe(false);
      expect(creditManager.getLicenseType()).toBe(LicenseType.SUBSCRIPTION);
    });

    it('should reset credits for subscription', async () => {
      await creditManager.initialize();

      (mockAPI.validateLicense as any).mockResolvedValue({
        plan: 'pro',
        creditsRemaining: 100,
        creditLimit: 500,
        resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        features: [],
      });

      const license = await creditManager.loadLicense('test-key');
      (license as any).licenseType = LicenseType.SUBSCRIPTION;
      (license as any).creditsResetMonthly = true;

      // Mock that we're in a new month
      const oldDate = new Date();
      oldDate.setMonth(oldDate.getMonth() - 1);
      (creditManager as any).lastResetDate = oldDate;

      expect(creditManager.shouldResetCredits()).toBe(true);

      // Reset should work
      await creditManager.resetMonthlyCredits();

      expect(creditManager.getBalance()).toBeGreaterThan(100);
    });
  });

  describe('Free Tier', () => {
    it('should detect free tier license', async () => {
      await creditManager.initialize();

      (mockAPI.validateLicense as any).mockResolvedValue({
        plan: 'free',
        creditsRemaining: 10,
        creditLimit: 10,
        resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        features: [],
      });

      const license = await creditManager.loadLicense('test-key');
      (license as any).licenseType = LicenseType.FREE_TIER;
      (license as any).creditsResetMonthly = true;

      expect(creditManager.isCreditPack()).toBe(false);
      expect(creditManager.getLicenseType()).toBe(LicenseType.FREE_TIER);
    });

    it('should reset credits for free tier', async () => {
      await creditManager.initialize();

      (mockAPI.validateLicense as any).mockResolvedValue({
        plan: 'free',
        creditsRemaining: 5,
        creditLimit: 10,
        resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        features: [],
      });

      const license = await creditManager.loadLicense('test-key');
      (license as any).licenseType = LicenseType.FREE_TIER;
      (license as any).creditsResetMonthly = true;

      // Mock that we're in a new month
      const oldDate = new Date();
      oldDate.setMonth(oldDate.getMonth() - 1);
      (creditManager as any).lastResetDate = oldDate;

      expect(creditManager.shouldResetCredits()).toBe(true);
    });
  });
});
