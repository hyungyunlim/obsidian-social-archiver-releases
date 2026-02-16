/**
 * Tests for CreditManager service
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CreditManager } from '../../services/CreditManager';
import { CloudflareAPI } from '../../services/CloudflareAPI';
import { CostTracker } from '../../services/CostTracker';
import { Logger } from '../../services/Logger';
import {
  Platform,
  PLATFORM_COSTS,
  CreditEventType,
  CreditThreshold,
  TransactionType,
  OperationType,
  OPERATION_COSTS,
} from '../../types/credit';

/**
 * Mock CloudflareAPI for testing
 */
class MockCloudflareAPI extends CloudflareAPI {
  private mockBalance = 100;

  async initialize(): Promise<void> {
    // Mock initialization
  }

  async shutdown(): Promise<void> {
    // Mock shutdown
  }

  async validateLicense(licenseKey: string): Promise<any> {
    return {
      valid: true,
      plan: 'pro',
      creditsRemaining: this.mockBalance,
      creditLimit: 500,
      resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      features: ['ai_analysis', 'deep_research'],
    };
  }

  async useCredits(platform: Platform, credits?: number): Promise<any> {
    const amount = credits ?? 1;
    this.mockBalance -= amount;
    return {
      creditsUsed: amount,
      creditsRemaining: this.mockBalance,
      transactionId: `tx-${Date.now()}`,
    };
  }

  async refundCredits(platform: Platform, credits: number): Promise<any> {
    this.mockBalance += credits;
    return {
      creditsRefunded: credits,
      creditsRemaining: this.mockBalance,
      transactionId: `refund-${Date.now()}`,
    };
  }

  async getBalance(): Promise<number> {
    return this.mockBalance;
  }

  setMockBalance(balance: number): void {
    this.mockBalance = balance;
  }
}

describe('CreditManager', () => {
  let creditManager: CreditManager;
  let api: MockCloudflareAPI;
  let tracker: CostTracker;
  let logger: Logger;

  beforeEach(async () => {
    logger = new Logger({ level: 'error', enableConsole: false });
    await logger.initialize();

    api = new MockCloudflareAPI(
      { endpoint: 'https://test.api', licenseKey: 'TEST-LICENSE-KEY' },
      logger
    );

    tracker = new CostTracker(
      { maxTransactions: 100, enableAnalytics: true },
      logger
    );

    creditManager = new CreditManager(
      {
        licenseKey: 'TEST-LICENSE-KEY',
        alerts: {
          enabled: true,
          thresholds: [CreditThreshold.CRITICAL, CreditThreshold.LOW, CreditThreshold.MEDIUM],
          showNotifications: false, // Disable for tests
          logToConsole: false,
        },
        reservationTimeout: 5000,
        autoRefund: true,
      },
      api,
      tracker,
      logger
    );

    await creditManager.initialize();
  });

  afterEach(async () => {
    await creditManager.shutdown();
    await logger.shutdown();
  });

  describe('Initialization', () => {
    it('should initialize successfully with license key', async () => {
      const license = creditManager.getLicense();
      expect(license).toBeDefined();
      expect(license?.plan).toBe('pro');
      expect(license?.creditsRemaining).toBe(100);
    });

    it('should get current balance', () => {
      const balance = creditManager.getBalance();
      expect(balance).toBe(100);
    });
  });

  describe('Credit Deduction', () => {
    it('should deduct credits for a request', async () => {
      const initialBalance = creditManager.getBalance();
      const cost = PLATFORM_COSTS.facebook;

      const transaction = await creditManager.deductCredits('facebook', cost, 'ref-1', true);

      expect(transaction.type).toBe(TransactionType.DEDUCT);
      expect(transaction.platform).toBe('facebook');
      expect(transaction.amount).toBe(cost);
      expect(transaction.success).toBe(true);
      expect(creditManager.getBalance()).toBe(initialBalance - cost);
    });

    it('should record failed transactions without deducting', async () => {
      const initialBalance = creditManager.getBalance();

      const transaction = await creditManager.deductCredits('facebook', 2, 'ref-2', false);

      expect(transaction.success).toBe(false);
      expect(creditManager.getBalance()).toBe(initialBalance); // No deduction
    });

    it('should handle different platform costs', async () => {
      // LinkedIn costs 3 credits
      const transaction = await creditManager.deductCredits('linkedin', 3, 'ref-3', true);
      expect(transaction.amount).toBe(3);
      expect(creditManager.getBalance()).toBe(97); // 100 - 3
    });
  });

  describe('Credit Reservations', () => {
    it('should reserve credits for a request', () => {
      const initialBalance = creditManager.getBalance();
      const cost = PLATFORM_COSTS.facebook;

      const reservationId = creditManager.reserveCredits('facebook', 'ref-1');

      expect(reservationId).toBeDefined();
      expect(creditManager.getAvailableBalance()).toBe(initialBalance - cost);
      expect(creditManager.getBalance()).toBe(initialBalance); // Actual balance unchanged
    });

    it('should commit reservation and deduct credits', async () => {
      const reservationId = creditManager.reserveCredits('facebook', 'ref-1');
      const transaction = await creditManager.commitReservation(reservationId, true);

      expect(transaction.type).toBe(TransactionType.DEDUCT);
      expect(transaction.success).toBe(true);
      expect(creditManager.getBalance()).toBe(98); // 100 - 2
    });

    it('should release reservation without committing', () => {
      const initialBalance = creditManager.getBalance();
      const reservationId = creditManager.reserveCredits('facebook', 'ref-1');

      expect(creditManager.getAvailableBalance()).toBe(initialBalance - 2);

      creditManager.releaseReservation(reservationId);

      expect(creditManager.getAvailableBalance()).toBe(initialBalance);
    });

    it('should throw error when reserving with insufficient credits', async () => {
      api.setMockBalance(1); // Only 1 credit
      await creditManager.refreshBalance();

      expect(() => {
        creditManager.reserveCredits('facebook', 'ref-1'); // Needs 2 credits
      }).toThrow('Insufficient credits');
    });

    it('should throw error when committing invalid reservation', async () => {
      await expect(async () => {
        await creditManager.commitReservation('invalid-id');
      }).rejects.toThrow('Invalid or expired reservation');
    });
  });

  describe('Credit Refunds', () => {
    it('should refund credits for failed request', async () => {
      // First deduct credits
      const deductTx = await creditManager.deductCredits('facebook', 2, 'ref-1', true);
      const balanceAfterDeduct = creditManager.getBalance();

      // Then refund
      const refundTx = await creditManager.refundCredits(deductTx.id);

      expect(refundTx.type).toBe(TransactionType.REFUND);
      expect(refundTx.amount).toBe(2);
      expect(creditManager.getBalance()).toBe(balanceAfterDeduct + 2);
    });

    it('should throw error when refunding non-existent transaction', async () => {
      await expect(async () => {
        await creditManager.refundCredits('invalid-tx-id');
      }).rejects.toThrow('Transaction not found');
    });
  });

  describe('Cost Estimation', () => {
    it('should estimate cost for single request', () => {
      const estimate = creditManager.estimateCost(['facebook']);

      expect(estimate.totalCredits).toBe(2);
      expect(estimate.requestCount).toBe(1);
      expect(estimate.breakdown.facebook).toBe(2);
      expect(estimate.affordable).toBe(true);
    });

    it('should estimate cost for batch requests', () => {
      const platforms: Platform[] = ['facebook', 'linkedin', 'instagram', 'x'];
      const estimate = creditManager.estimateCost(platforms);

      expect(estimate.totalCredits).toBe(2 + 3 + 2 + 1); // 8
      expect(estimate.requestCount).toBe(4);
      expect(estimate.affordable).toBe(true);
    });

    it('should indicate when batch is not affordable', async () => {
      api.setMockBalance(5);
      await creditManager.refreshBalance();

      const platforms: Platform[] = Array(10).fill('facebook'); // 20 credits needed
      const estimate = creditManager.estimateCost(platforms);

      expect(estimate.affordable).toBe(false);
      expect(estimate.creditsNeeded).toBe(15); // 20 - 5
    });
  });

  describe('Balance Management', () => {
    it('should refresh balance from server', async () => {
      api.setMockBalance(250);
      const newBalance = await creditManager.refreshBalance();

      expect(newBalance).toBe(250);
      expect(creditManager.getBalance()).toBe(250);
    });

    it('should check if has sufficient credits', () => {
      expect(creditManager.hasCredits(50)).toBe(true);
      expect(creditManager.hasCredits(150)).toBe(false);
    });

    it('should calculate available balance excluding reservations', () => {
      const initialBalance = creditManager.getBalance();

      creditManager.reserveCredits('facebook', 'ref-1'); // 2 credits
      creditManager.reserveCredits('linkedin', 'ref-2'); // 3 credits

      expect(creditManager.getAvailableBalance()).toBe(initialBalance - 5);
      expect(creditManager.getBalance()).toBe(initialBalance); // Actual balance unchanged
    });
  });

  describe('Credit Alerts', () => {
    it('should trigger alert when balance drops below threshold', async () => {
      const alerts: any[] = [];
      creditManager.on(CreditEventType.ALERT_TRIGGERED, (event) => {
        alerts.push(event);
      });

      // Set balance to 10% (50 credits out of 500 credit limit)
      api.setMockBalance(50);
      await creditManager.refreshBalance();

      expect(alerts.length).toBeGreaterThan(0);
      // 50/500 = 10%, so it should trigger LOW threshold
      expect(alerts[0].data.alert.threshold).toBe(CreditThreshold.LOW);
    });

    it('should trigger critical alert when balance is zero', async () => {
      const alerts: any[] = [];
      creditManager.on(CreditEventType.ALERT_TRIGGERED, (event) => {
        alerts.push(event);
      });

      api.setMockBalance(0);
      await creditManager.refreshBalance();

      const criticalAlert = alerts.find(
        (a) => a.data.alert.threshold === CreditThreshold.CRITICAL
      );
      expect(criticalAlert).toBeDefined();
    });

    it('should not trigger duplicate alerts for same threshold', async () => {
      const alerts: any[] = [];
      creditManager.on(CreditEventType.ALERT_TRIGGERED, (event) => {
        alerts.push(event);
      });

      api.setMockBalance(50);
      await creditManager.refreshBalance();
      const count1 = alerts.length;

      await creditManager.refreshBalance();
      const count2 = alerts.length;

      expect(count2).toBe(count1); // No new alerts
    });
  });

  describe('Event System', () => {
    it('should emit BALANCE_UPDATED event on deduction', async () => {
      const events: any[] = [];
      creditManager.on(CreditEventType.BALANCE_UPDATED, (event) => {
        events.push(event);
      });

      await creditManager.deductCredits('facebook', 2, 'ref-1', true);

      expect(events.length).toBeGreaterThan(0);
      expect(events[events.length - 1].data.balance).toBe(98);
    });

    it('should emit TRANSACTION_COMPLETED event', async () => {
      const events: any[] = [];
      creditManager.on(CreditEventType.TRANSACTION_COMPLETED, (event) => {
        events.push(event);
      });

      await creditManager.deductCredits('facebook', 2, 'ref-1', true);

      expect(events).toHaveLength(1);
      expect(events[0].data.transaction.type).toBe(TransactionType.DEDUCT);
    });

    it('should emit RESERVATION events', () => {
      const created: any[] = [];
      const released: any[] = [];

      creditManager.on(CreditEventType.RESERVATION_CREATED, (event) => {
        created.push(event);
      });
      creditManager.on(CreditEventType.RESERVATION_RELEASED, (event) => {
        released.push(event);
      });

      const reservationId = creditManager.reserveCredits('facebook', 'ref-1');
      expect(created).toHaveLength(1);

      creditManager.releaseReservation(reservationId);
      expect(released).toHaveLength(1);
    });

    it('should allow removing event listeners', async () => {
      const events: any[] = [];
      const listener = (event: any) => events.push(event);

      creditManager.on(CreditEventType.BALANCE_UPDATED, listener);
      await creditManager.deductCredits('facebook', 2, 'ref-1', true);
      expect(events).toHaveLength(1);

      creditManager.off(CreditEventType.BALANCE_UPDATED, listener);
      await creditManager.deductCredits('facebook', 2, 'ref-2', true);
      expect(events).toHaveLength(1); // No new events
    });
  });

  describe('Operation Type Management', () => {
    it('should check if can afford basic archive operation', () => {
      const canAfford = creditManager.canAffordOperation(OperationType.BASIC_ARCHIVE);
      expect(canAfford).toBe(true); // Balance is 100, cost is 1
    });

    it('should check if can afford AI operation', () => {
      const canAfford = creditManager.canAffordOperation(OperationType.WITH_AI);
      expect(canAfford).toBe(true); // Balance is 100, cost is 3
    });

    it('should check if can afford deep research operation', () => {
      const canAfford = creditManager.canAffordOperation(OperationType.DEEP_RESEARCH);
      expect(canAfford).toBe(true); // Balance is 100, cost is 5
    });

    it('should return false when cannot afford operation', async () => {
      api.setMockBalance(2);
      await creditManager.refreshBalance();

      const canAfford = creditManager.canAffordOperation(OperationType.DEEP_RESEARCH);
      expect(canAfford).toBe(false); // Balance is 2, cost is 5
    });

    it('should get operation cost', () => {
      expect(creditManager.getOperationCost(OperationType.BASIC_ARCHIVE)).toBe(1);
      expect(creditManager.getOperationCost(OperationType.WITH_AI)).toBe(3);
      expect(creditManager.getOperationCost(OperationType.DEEP_RESEARCH)).toBe(5);
    });
  });

  describe('Monthly Allowance and Reset', () => {
    it('should get monthly allowance for pro plan', () => {
      const allowance = creditManager.getMonthlyAllowance();
      expect(allowance).toBe(500); // Pro plan
    });

    it('should reset monthly credits', async () => {
      api.setMockBalance(0);
      await creditManager.refreshBalance();

      await creditManager.resetMonthlyCredits();

      const newBalance = creditManager.getBalance();
      expect(newBalance).toBe(500); // Pro allowance

      const lastReset = creditManager.getLastResetDate();
      expect(lastReset).toBeDefined();
    });

    it('should rollover credits for pro users (max 100)', async () => {
      // Deduct some credits to leave a balance
      await creditManager.deductCredits('facebook', 2, 'ref-1', true);
      await creditManager.deductCredits('facebook', 2, 'ref-2', true);
      expect(creditManager.getBalance()).toBe(96);

      await creditManager.resetMonthlyCredits();

      // Should get 500 new credits + 96 rollover (capped at 100)
      const rollover = creditManager.getRolloverCredits();
      expect(rollover).toBe(96);
      expect(creditManager.getBalance()).toBe(596); // 500 + 96
    });

    it('should cap rollover at 100 credits', async () => {
      // Set balance to 150 credits
      api.setMockBalance(150);
      await creditManager.refreshBalance();

      await creditManager.resetMonthlyCredits();

      // Should rollover max 100
      const rollover = creditManager.getRolloverCredits();
      expect(rollover).toBe(100);
      expect(creditManager.getBalance()).toBe(600); // 500 + 100
    });

    it('should not rollover credits for free users', async () => {
      // Create a new manager with free plan
      const freeApi = new MockCloudflareAPI(
        { endpoint: 'https://test.api', licenseKey: 'FREE-KEY' },
        logger
      );

      // Override validateLicense to return free plan
      freeApi.validateLicense = async () => ({
        valid: true,
        plan: 'free',
        creditsRemaining: 5,
        creditLimit: 10,
        resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        features: [],
      });

      const freeManager = new CreditManager(
        {
          licenseKey: 'FREE-KEY',
          alerts: {
            enabled: false,
            thresholds: [],
            showNotifications: false,
            logToConsole: false,
          },
          reservationTimeout: 5000,
          autoRefund: true,
        },
        freeApi,
        tracker,
        logger
      );

      await freeManager.initialize();

      await freeManager.resetMonthlyCredits();

      const rollover = freeManager.getRolloverCredits();
      expect(rollover).toBe(0); // Free plan doesn't rollover
      expect(freeManager.getBalance()).toBe(10); // Only monthly allowance

      await freeManager.shutdown();
    });

    it('should check if reset is needed', () => {
      // Just initialized, so reset might be needed
      const needsReset = creditManager.shouldResetCredits();
      // This depends on when the license was last reset
      expect(typeof needsReset).toBe('boolean');
    });
  });

  describe('Integration', () => {
    it('should track all transactions in CostTracker', async () => {
      await creditManager.deductCredits('facebook', 2, 'ref-1', true);
      await creditManager.deductCredits('linkedin', 3, 'ref-2', true);

      const transactions = tracker.getAllTransactions();
      expect(transactions).toHaveLength(2);
      expect(transactions[0].platform).toBe('facebook');
      expect(transactions[1].platform).toBe('linkedin');
    });

    it('should support full workflow: reserve -> commit -> refund', async () => {
      const initialBalance = creditManager.getBalance();

      // Reserve
      const reservationId = creditManager.reserveCredits('facebook', 'ref-1');
      expect(creditManager.getAvailableBalance()).toBe(initialBalance - 2);

      // Commit (simulate failure)
      const deductTx = await creditManager.commitReservation(reservationId, false);
      expect(deductTx.success).toBe(false);
      expect(creditManager.getBalance()).toBe(initialBalance);

      // Refund (should be no-op since deduction failed)
      const transactions = tracker.getAllTransactions();
      expect(transactions).toHaveLength(1);
      expect(transactions[0].success).toBe(false);
    });

    it('should emit event on monthly reset', async () => {
      const events: any[] = [];
      creditManager.on(CreditEventType.BALANCE_UPDATED, (event) => {
        events.push(event);
      });

      await creditManager.resetMonthlyCredits();

      const resetEvent = events.find((e) => e.data.resetDate);
      expect(resetEvent).toBeDefined();
      expect(resetEvent.data.monthlyAllowance).toBe(500);
    });
  });
});
