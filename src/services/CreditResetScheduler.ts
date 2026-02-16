/**
 * CreditResetScheduler - Automated monthly credit reset system
 */

import { Notice, Plugin } from 'obsidian';
import { IService } from './base/IService';
import { CreditManager } from './CreditManager';
import { Logger } from './Logger';

/**
 * Reset scheduler configuration
 */
export interface CreditResetSchedulerConfig {
  /** Plugin instance for data persistence */
  plugin: Plugin;
  /** Credit manager instance */
  creditManager: CreditManager;
  /** Check interval in milliseconds (default: 1 hour) */
  checkInterval?: number;
  /** Whether to show notifications on reset */
  showNotifications?: boolean;
  /** Reset day of month (1-31, default: 1) */
  resetDayOfMonth?: number;
  /** Reset hour in UTC (0-23, default: 0) */
  resetHour?: number;
}

/**
 * Scheduler data stored in plugin
 */
interface SchedulerData {
  /** Last reset timestamp */
  lastResetDate?: number;
  /** Next scheduled reset timestamp */
  nextResetDate?: number;
  /** Initial activation date (for billing cycle) */
  activationDate?: number;
  /** Reset configuration version */
  version: number;
}

/**
 * Current scheduler version
 */
const SCHEDULER_VERSION = 1;

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  checkInterval: 60 * 60 * 1000, // 1 hour
  showNotifications: true,
  resetDayOfMonth: 1,
  resetHour: 0,
};

/**
 * Credit reset scheduler service
 */
export class CreditResetScheduler implements IService {
  private config: Required<CreditResetSchedulerConfig>;
  private logger?: Logger;
  private initialized = false;

  // Scheduler state
  private schedulerData?: SchedulerData;
  private checkInterval?: NodeJS.Timeout;

  constructor(config: CreditResetSchedulerConfig, logger?: Logger) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    } as Required<CreditResetSchedulerConfig>;
    this.logger = logger;
  }

  /**
   * Initialize the scheduler
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger?.warn('CreditResetScheduler already initialized');
      return;
    }

    this.logger?.info('Initializing CreditResetScheduler', {
      checkInterval: this.config.checkInterval,
      resetDayOfMonth: this.config.resetDayOfMonth,
    });

    // Load scheduler data
    await this.loadSchedulerData();

    // Check and reset on initialization
    await this.checkAndResetCredits();

    // Start periodic check
    this.startPeriodicCheck();

    this.initialized = true;
    this.logger?.info('CreditResetScheduler initialized successfully');
  }

  /**
   * Shutdown the scheduler
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.logger?.info('Shutting down CreditResetScheduler');

    // Stop periodic check
    this.stopPeriodicCheck();

    // Save scheduler data
    await this.saveSchedulerData();

    this.initialized = false;
  }

  /**
   * Check and reset credits if needed
   */
  async checkAndResetCredits(): Promise<boolean> {
    this.ensureInitialized();

    this.logger?.debug('Checking if credits need reset');

    const now = new Date();

    // Initialize activation date if not set
    if (!this.schedulerData?.activationDate) {
      this.schedulerData = {
        ...this.schedulerData,
        activationDate: now.getTime(),
        version: SCHEDULER_VERSION,
      };
      await this.saveSchedulerData();
      this.logger?.info('Activation date initialized', {
        activationDate: new Date(this.schedulerData.activationDate || Date.now()).toISOString(),
      });
    }

    // Check if reset is needed
    if (this.shouldReset(now)) {
      this.logger?.info('Credits reset needed', {
        lastReset: this.schedulerData?.lastResetDate
          ? new Date(this.schedulerData.lastResetDate).toISOString()
          : 'never',
        now: now.toISOString(),
      });

      try {
        // Perform reset
        await this.config.creditManager.resetMonthlyCredits();

        // Update scheduler data
        this.schedulerData = {
          ...this.schedulerData!,
          lastResetDate: now.getTime(),
          nextResetDate: this.calculateNextResetDate(now).getTime(),
        };

        await this.saveSchedulerData();

        // Show notification
        if (this.config.showNotifications) {
          this.showResetNotification();
        }

        this.logger?.info('Credits reset successfully', {
          nextReset: new Date(this.schedulerData.nextResetDate || Date.now()).toISOString(),
        });

        return true;
      } catch (error) {
        this.logger?.error('Failed to reset credits', error instanceof Error ? error : undefined);
        return false;
      }
    }

    this.logger?.debug('No reset needed');
    return false;
  }

  /**
   * Manually trigger credit reset (for admin/debugging)
   */
  async manualReset(): Promise<void> {
    this.ensureInitialized();

    this.logger?.warn('Manual credit reset triggered');

    const now = new Date();

    await this.config.creditManager.resetMonthlyCredits();

    this.schedulerData = {
      ...this.schedulerData!,
      lastResetDate: now.getTime(),
      nextResetDate: this.calculateNextResetDate(now).getTime(),
    };

    await this.saveSchedulerData();

    if (this.config.showNotifications) {
      new Notice('Credits manually reset!');
    }

    this.logger?.info('Manual reset completed');
  }

  /**
   * Get next scheduled reset date
   */
  getNextResetDate(): Date | undefined {
    if (!this.schedulerData?.nextResetDate) {
      return undefined;
    }

    return new Date(this.schedulerData.nextResetDate);
  }

  /**
   * Get last reset date
   */
  getLastResetDate(): Date | undefined {
    if (!this.schedulerData?.lastResetDate) {
      return undefined;
    }

    return new Date(this.schedulerData.lastResetDate);
  }

  /**
   * Get activation date
   */
  getActivationDate(): Date | undefined {
    if (!this.schedulerData?.activationDate) {
      return undefined;
    }

    return new Date(this.schedulerData.activationDate);
  }

  /**
   * Get days until next reset
   */
  getDaysUntilReset(): number {
    const nextReset = this.getNextResetDate();
    if (!nextReset) {
      return 0;
    }

    const now = new Date();
    const diffMs = nextReset.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }

  // Private helper methods

  /**
   * Check if reset is needed
   */
  private shouldReset(now: Date): boolean {
    // Use CreditManager's logic if available
    if (this.config.creditManager.shouldResetCredits()) {
      return true;
    }

    // Fallback to next reset date
    if (this.schedulerData?.nextResetDate) {
      return now.getTime() >= this.schedulerData.nextResetDate;
    }

    // No last reset, should reset now
    if (!this.schedulerData?.lastResetDate) {
      return true;
    }

    return false;
  }

  /**
   * Calculate next reset date based on billing cycle
   */
  private calculateNextResetDate(from: Date): Date {
    const next = new Date(from);

    // Set to configured reset day of month
    next.setUTCDate(this.config.resetDayOfMonth);
    next.setUTCHours(this.config.resetHour, 0, 0, 0);

    // If the reset date is in the past or today, move to next month
    if (next.getTime() <= from.getTime()) {
      next.setUTCMonth(next.getUTCMonth() + 1);
    }

    // Handle edge case: if day doesn't exist in month (e.g., Feb 31)
    if (next.getUTCDate() !== this.config.resetDayOfMonth) {
      // Go to last day of previous month
      next.setUTCDate(0);
    }

    return next;
  }

  /**
   * Start periodic check
   */
  private startPeriodicCheck(): void {
    this.stopPeriodicCheck();

    this.checkInterval = setInterval(async () => {
      try {
        await this.checkAndResetCredits();
      } catch (error) {
        this.logger?.error('Periodic reset check failed', error instanceof Error ? error : undefined);
      }
    }, this.config.checkInterval);

    this.logger?.debug('Periodic reset check started', {
      intervalMs: this.config.checkInterval,
    });
  }

  /**
   * Stop periodic check
   */
  private stopPeriodicCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
      this.logger?.debug('Periodic reset check stopped');
    }
  }

  /**
   * Load scheduler data from plugin
   */
  private async loadSchedulerData(): Promise<void> {
    try {
      const data = await this.config.plugin.loadData();

      if (data && data.creditResetScheduler) {
        this.schedulerData = data.creditResetScheduler;

        this.logger?.debug('Scheduler data loaded', {
          lastReset: this.schedulerData?.lastResetDate
            ? new Date(this.schedulerData.lastResetDate).toISOString()
            : 'never',
          nextReset: this.schedulerData?.nextResetDate
            ? new Date(this.schedulerData.nextResetDate).toISOString()
            : 'not set',
        });
      } else {
        // Initialize empty data
        this.schedulerData = {
          version: SCHEDULER_VERSION,
        };

        this.logger?.debug('Initialized empty scheduler data');
      }
    } catch (error) {
      this.logger?.error('Failed to load scheduler data', error instanceof Error ? error : undefined);

      // Initialize empty data on error
      this.schedulerData = {
        version: SCHEDULER_VERSION,
      };
    }
  }

  /**
   * Save scheduler data to plugin
   */
  private async saveSchedulerData(): Promise<void> {
    try {
      const existingData = await this.config.plugin.loadData() || {};

      existingData.creditResetScheduler = this.schedulerData;

      await this.config.plugin.saveData(existingData);

      this.logger?.debug('Scheduler data saved');
    } catch (error) {
      this.logger?.error('Failed to save scheduler data', error instanceof Error ? error : undefined);
    }
  }

  /**
   * Show reset notification to user
   */
  private showResetNotification(): void {
    const balance = this.config.creditManager.getBalance();
    const rollover = this.config.creditManager.getRolloverCredits();
    const allowance = this.config.creditManager.getMonthlyAllowance();

    let message = `🎉 Monthly credits reset! You now have ${balance} credits.`;

    if (rollover > 0) {
      message += ` (${allowance} new + ${rollover} rolled over)`;
    }

    new Notice(message, 8000);

    this.logger?.info('Reset notification shown', {
      balance,
      rollover,
      allowance,
    });
  }

  /**
   * Ensure scheduler is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('CreditResetScheduler not initialized. Call initialize() first.');
    }
  }
}
