/**
 * Tests for CreditResetScheduler
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CreditResetScheduler, CreditResetSchedulerConfig } from '../../services/CreditResetScheduler';
import { CreditManager } from '../../services/CreditManager';
import { CloudflareAPI } from '../../services/CloudflareAPI';
import { CostTracker } from '../../services/CostTracker';
import { Logger } from '../../services/Logger';
import { Plugin } from 'obsidian';
import { CreditThreshold } from '../../types/credit';

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

// Mock CloudflareAPI
class MockCloudflareAPI extends CloudflareAPI {
  private mockBalance = 100;

  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  async validateLicense(): Promise<any> {
    return {
      valid: true,
      plan: 'pro',
      creditsRemaining: this.mockBalance,
      creditLimit: 500,
      resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      features: ['ai_analysis'],
    };
  }

  async useCredits(): Promise<any> {
    this.mockBalance -= 1;
    return {
      creditsUsed: 1,
      creditsRemaining: this.mockBalance,
      transactionId: 'tx-1',
    };
  }

  async refundCredits(): Promise<any> {
    return {};
  }

  async getBalance(): Promise<number> {
    return this.mockBalance;
  }

  setMockBalance(balance: number): void {
    this.mockBalance = balance;
  }
}

describe('CreditResetScheduler', () => {
  let scheduler: CreditResetScheduler;
  let creditManager: CreditManager;
  let mockPlugin: MockPlugin;
  let api: MockCloudflareAPI;
  let tracker: CostTracker;
  let logger: Logger;

  beforeEach(async () => {
    mockPlugin = new MockPlugin();
    logger = new Logger({ level: 'error', enableConsole: false });
    await logger.initialize();

    api = new MockCloudflareAPI(
      { endpoint: 'https://test.api', licenseKey: 'TEST-KEY' },
      logger
    );

    tracker = new CostTracker(
      { maxTransactions: 100, enableAnalytics: false },
      logger
    );

    creditManager = new CreditManager(
      {
        licenseKey: 'TEST-KEY',
        alerts: {
          enabled: false,
          thresholds: [CreditThreshold.CRITICAL],
          showNotifications: false,
          logToConsole: false,
        },
        reservationTimeout: 5000,
        autoRefund: false,
      },
      api,
      tracker,
      logger
    );

    await creditManager.initialize();

    const config: CreditResetSchedulerConfig = {
      plugin: mockPlugin as unknown as Plugin,
      creditManager,
      checkInterval: 100, // Fast interval for testing
      showNotifications: false,
      resetDayOfMonth: 1,
      resetHour: 0,
    };

    scheduler = new CreditResetScheduler(config, logger);
  });

  afterEach(async () => {
    if (scheduler) {
      await scheduler.shutdown();
    }
    if (creditManager) {
      await creditManager.shutdown();
    }
    if (tracker) {
      await tracker.shutdown();
    }
    if (logger) {
      await logger.shutdown();
    }
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await expect(scheduler.initialize()).resolves.toBeUndefined();
    });

    it('should not initialize twice', async () => {
      await scheduler.initialize();
      const warnSpy = vi.spyOn(logger, 'warn');

      await scheduler.initialize();

      expect(warnSpy).toHaveBeenCalledWith('CreditResetScheduler already initialized');
    });

    it('should set activation date on first initialization', async () => {
      await scheduler.initialize();

      const activationDate = scheduler.getActivationDate();
      expect(activationDate).toBeDefined();
      expect(activationDate).toBeInstanceOf(Date);
    });

    it('should persist activation date across sessions', async () => {
      await scheduler.initialize();
      const firstActivation = scheduler.getActivationDate();
      await scheduler.shutdown();

      // Create new scheduler with same plugin
      const scheduler2 = new CreditResetScheduler(
        {
          plugin: mockPlugin as unknown as Plugin,
          creditManager,
          checkInterval: 100,
          showNotifications: false,
        },
        logger
      );

      await scheduler2.initialize();
      const secondActivation = scheduler2.getActivationDate();

      expect(secondActivation?.getTime()).toBe(firstActivation?.getTime());

      await scheduler2.shutdown();
    });
  });

  describe('checkAndResetCredits', () => {
    beforeEach(async () => {
      await scheduler.initialize();
    });

    it('should check if reset is needed', async () => {
      const result = await scheduler.checkAndResetCredits();
      expect(typeof result).toBe('boolean');
    });

    it('should update next reset date after reset', async () => {
      // Mock shouldResetCredits to return true
      vi.spyOn(creditManager, 'shouldResetCredits').mockReturnValue(true);

      await scheduler.checkAndResetCredits();

      const nextReset = scheduler.getNextResetDate();
      expect(nextReset).toBeDefined();
      expect(nextReset).toBeInstanceOf(Date);
    });

    it('should update last reset date after reset', async () => {
      vi.spyOn(creditManager, 'shouldResetCredits').mockReturnValue(true);

      const beforeReset = scheduler.getLastResetDate();

      await scheduler.checkAndResetCredits();

      const afterReset = scheduler.getLastResetDate();
      expect(afterReset).toBeDefined();

      if (beforeReset) {
        expect(afterReset!.getTime()).toBeGreaterThan(beforeReset.getTime());
      }
    });

    it('should not reset if not needed', async () => {
      vi.spyOn(creditManager, 'shouldResetCredits').mockReturnValue(false);

      const result = await scheduler.checkAndResetCredits();
      expect(result).toBe(false);
    });
  });

  describe('manualReset', () => {
    beforeEach(async () => {
      await scheduler.initialize();
    });

    it('should manually trigger reset', async () => {
      const beforeBalance = creditManager.getBalance();

      await scheduler.manualReset();

      const afterBalance = creditManager.getBalance();
      expect(afterBalance).toBeGreaterThanOrEqual(beforeBalance);
    });

    it('should update reset dates after manual reset', async () => {
      await scheduler.manualReset();

      const lastReset = scheduler.getLastResetDate();
      const nextReset = scheduler.getNextResetDate();

      expect(lastReset).toBeDefined();
      expect(nextReset).toBeDefined();
      expect(nextReset!.getTime()).toBeGreaterThan(lastReset!.getTime());
    });
  });

  describe('getNextResetDate', () => {
    beforeEach(async () => {
      await scheduler.initialize();
    });

    it('should return next reset date after initialization', async () => {
      // Trigger a check to calculate next reset
      await scheduler.checkAndResetCredits();

      const nextReset = scheduler.getNextResetDate();
      expect(nextReset).toBeDefined();
    });

    it('should return undefined if no reset has occurred', async () => {
      mockPlugin.clearData();

      const scheduler2 = new CreditResetScheduler(
        {
          plugin: mockPlugin as unknown as Plugin,
          creditManager,
          checkInterval: 100,
          showNotifications: false,
        },
        logger
      );

      const nextReset = scheduler2.getNextResetDate();
      expect(nextReset).toBeUndefined();
    });
  });

  describe('getDaysUntilReset', () => {
    beforeEach(async () => {
      await scheduler.initialize();
    });

    it('should calculate days until next reset', async () => {
      await scheduler.checkAndResetCredits();

      const days = scheduler.getDaysUntilReset();
      expect(typeof days).toBe('number');
      expect(days).toBeGreaterThanOrEqual(0);
    });

    it('should return 0 if no next reset date', () => {
      mockPlugin.clearData();

      const scheduler2 = new CreditResetScheduler(
        {
          plugin: mockPlugin as unknown as Plugin,
          creditManager,
          checkInterval: 100,
          showNotifications: false,
        },
        logger
      );

      const days = scheduler2.getDaysUntilReset();
      expect(days).toBe(0);
    });
  });

  describe('periodic check', () => {
    it('should perform periodic checks', async () => {
      const checkSpy = vi.spyOn(scheduler as any, 'checkAndResetCredits');

      await scheduler.initialize();

      // Wait for at least one check interval
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(checkSpy).toHaveBeenCalled();
    });

    it('should stop periodic checks on shutdown', async () => {
      await scheduler.initialize();

      const checkSpy = vi.spyOn(scheduler as any, 'checkAndResetCredits');

      await scheduler.shutdown();

      const callsBefore = checkSpy.mock.calls.length;

      // Wait and verify no new calls
      await new Promise((resolve) => setTimeout(resolve, 150));

      const callsAfter = checkSpy.mock.calls.length;
      expect(callsAfter).toBe(callsBefore);
    });
  });

  describe('data persistence', () => {
    it('should persist scheduler data', async () => {
      await scheduler.initialize();

      vi.spyOn(creditManager, 'shouldResetCredits').mockReturnValue(true);
      await scheduler.checkAndResetCredits();

      await scheduler.shutdown();

      const data = await mockPlugin.loadData();
      expect(data.creditResetScheduler).toBeDefined();
      expect(data.creditResetScheduler.lastResetDate).toBeDefined();
      expect(data.creditResetScheduler.activationDate).toBeDefined();
    });

    it('should load persisted data on next initialization', async () => {
      await scheduler.initialize();

      vi.spyOn(creditManager, 'shouldResetCredits').mockReturnValue(true);
      await scheduler.checkAndResetCredits();

      const firstLastReset = scheduler.getLastResetDate();
      await scheduler.shutdown();

      // Create new scheduler
      const scheduler2 = new CreditResetScheduler(
        {
          plugin: mockPlugin as unknown as Plugin,
          creditManager,
          checkInterval: 100,
          showNotifications: false,
        },
        logger
      );

      await scheduler2.initialize();
      const secondLastReset = scheduler2.getLastResetDate();

      expect(secondLastReset?.getTime()).toBe(firstLastReset?.getTime());

      await scheduler2.shutdown();
    });
  });

  describe('timezone handling', () => {
    it('should calculate next reset in UTC', async () => {
      await scheduler.initialize();

      vi.spyOn(creditManager, 'shouldResetCredits').mockReturnValue(true);
      await scheduler.checkAndResetCredits();

      const nextReset = scheduler.getNextResetDate();
      expect(nextReset).toBeDefined();

      // Verify it's set to configured hour in UTC
      expect(nextReset!.getUTCHours()).toBe(0);
      expect(nextReset!.getUTCMinutes()).toBe(0);
      expect(nextReset!.getUTCSeconds()).toBe(0);
    });

    it('should handle configured reset day of month', async () => {
      const customScheduler = new CreditResetScheduler(
        {
          plugin: mockPlugin as unknown as Plugin,
          creditManager,
          checkInterval: 100,
          showNotifications: false,
          resetDayOfMonth: 15,
          resetHour: 12,
        },
        logger
      );

      await customScheduler.initialize();

      vi.spyOn(creditManager, 'shouldResetCredits').mockReturnValue(true);
      await customScheduler.checkAndResetCredits();

      const nextReset = customScheduler.getNextResetDate();
      expect(nextReset).toBeDefined();
      expect(nextReset!.getUTCDate()).toBe(15);
      expect(nextReset!.getUTCHours()).toBe(12);

      await customScheduler.shutdown();
    });
  });
});
