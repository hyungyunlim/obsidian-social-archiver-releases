/**
 * LicenseExpirationNotifier - Notification system for license expiration warnings
 */

import { Notice } from 'obsidian';
import { LicenseInfo } from '../../types/license';
import { IService } from '../base/IService';
import { Logger } from '../Logger';

/**
 * Notification thresholds in days before expiration
 */
export enum NotificationThreshold {
  SEVEN_DAYS = 7,
  THREE_DAYS = 3,
  ONE_DAY = 1,
}

/**
 * Notification record
 */
interface NotificationRecord {
  threshold: NotificationThreshold;
  notifiedAt: Date;
  expiresAt: Date;
}

/**
 * LicenseExpirationNotifier configuration
 */
export interface LicenseExpirationNotifierConfig {
  /** Enable notifications */
  enabled?: boolean;
  /** Check interval in milliseconds (default: 1 hour) */
  checkInterval?: number;
  /** Notification thresholds */
  thresholds?: NotificationThreshold[];
  /** Show Obsidian Notice */
  showNotice?: boolean;
  /** Notice duration in milliseconds */
  noticeDuration?: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<LicenseExpirationNotifierConfig> = {
  enabled: true,
  checkInterval: 60 * 60 * 1000, // 1 hour
  thresholds: [
    NotificationThreshold.SEVEN_DAYS,
    NotificationThreshold.THREE_DAYS,
    NotificationThreshold.ONE_DAY,
  ],
  showNotice: true,
  noticeDuration: 10000, // 10 seconds
};

/**
 * License expiration notifier service
 */
export class LicenseExpirationNotifier implements IService {
  private config: Required<LicenseExpirationNotifierConfig>;
  private logger?: Logger;
  private initialized = false;

  // Check timer
  private checkTimer?: NodeJS.Timeout;

  // Notification history (to prevent duplicate notifications)
  private notificationHistory: Map<string, NotificationRecord> = new Map();

  // Current license being monitored
  private currentLicense?: LicenseInfo;

  constructor(config: LicenseExpirationNotifierConfig = {}, logger?: Logger) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    this.logger = logger;
  }

  /**
   * Initialize the notifier
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger?.warn('LicenseExpirationNotifier already initialized');
      return;
    }

    this.logger?.info('Initializing LicenseExpirationNotifier', {
      enabled: this.config.enabled,
      checkInterval: this.config.checkInterval,
      thresholds: this.config.thresholds,
    });

    if (this.config.enabled) {
      this.startChecking();
    }

    this.initialized = true;
    this.logger?.info('LicenseExpirationNotifier initialized successfully');
  }

  /**
   * Shutdown the notifier
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.logger?.info('Shutting down LicenseExpirationNotifier');

    this.stopChecking();
    this.notificationHistory.clear();

    this.initialized = false;
  }

  /**
   * Set license to monitor
   */
  setLicense(license: LicenseInfo | undefined): void {
    this.ensureInitialized();

    this.currentLicense = license;

    if (license) {
      this.logger?.debug('License set for monitoring', {
        email: license.email,
        expiresAt: license.expiresAt,
      });

      // Perform immediate check
      this.checkExpiration();
    } else {
      this.logger?.debug('License cleared from monitoring');
      this.notificationHistory.clear();
    }
  }

  /**
   * Enable notifications
   */
  enable(): void {
    this.ensureInitialized();

    if (this.config.enabled) {
      return;
    }

    this.config.enabled = true;
    this.startChecking();

    this.logger?.info('License expiration notifications enabled');
  }

  /**
   * Disable notifications
   */
  disable(): void {
    this.ensureInitialized();

    if (!this.config.enabled) {
      return;
    }

    this.config.enabled = false;
    this.stopChecking();

    this.logger?.info('License expiration notifications disabled');
  }

  /**
   * Check if notification was already sent for threshold
   */
  wasNotified(threshold: NotificationThreshold, expiresAt: Date): boolean {
    const key = this.getNotificationKey(threshold, expiresAt);
    return this.notificationHistory.has(key);
  }

  /**
   * Clear notification history
   */
  clearHistory(): void {
    this.notificationHistory.clear();
    this.logger?.debug('Notification history cleared');
  }

  /**
   * Get notification history
   */
  getHistory(): NotificationRecord[] {
    return Array.from(this.notificationHistory.values());
  }

  // Private methods

  /**
   * Start periodic checking
   */
  private startChecking(): void {
    this.stopChecking();

    this.checkTimer = setInterval(() => {
      this.checkExpiration();
    }, this.config.checkInterval);

    this.logger?.debug('Expiration checking started', {
      interval: this.config.checkInterval,
    });
  }

  /**
   * Stop periodic checking
   */
  private stopChecking(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
      this.logger?.debug('Expiration checking stopped');
    }
  }

  /**
   * Check license expiration and send notifications
   */
  private checkExpiration(): void {
    if (!this.config.enabled || !this.currentLicense) {
      return;
    }

    // Skip if license has no expiration date (lifetime)
    if (!this.currentLicense.expiresAt) {
      return;
    }

    const expiresAt = new Date(this.currentLicense.expiresAt);
    const daysUntilExpiration = this.getDaysUntilExpiration(expiresAt);

    this.logger?.debug('Checking expiration', {
      expiresAt,
      daysUntilExpiration,
    });

    // Already expired
    if (daysUntilExpiration < 0) {
      // Check if in grace period
      if (this.currentLicense.inGracePeriod) {
        const gracePeriodEnd = this.currentLicense.gracePeriodEndsAt;
        if (gracePeriodEnd) {
          const daysUntilGraceEnd = this.getDaysUntilExpiration(new Date(gracePeriodEnd));
          this.notifyGracePeriod(daysUntilGraceEnd);
        }
      }
      return;
    }

    // Check each threshold
    for (const threshold of this.config.thresholds) {
      if (daysUntilExpiration <= threshold && !this.wasNotified(threshold, expiresAt)) {
        this.sendNotification(threshold, expiresAt, daysUntilExpiration);
        this.recordNotification(threshold, expiresAt);
      }
    }
  }

  /**
   * Send expiration notification
   */
  private sendNotification(
    threshold: NotificationThreshold,
    expiresAt: Date,
    daysRemaining: number
  ): void {
    const message = this.getNotificationMessage(threshold, daysRemaining);

    this.logger?.info('Sending expiration notification', {
      threshold,
      daysRemaining,
      expiresAt,
    });

    if (this.config.showNotice) {
      new Notice(message, this.config.noticeDuration);
    }
  }

  /**
   * Notify about grace period
   */
  private notifyGracePeriod(daysRemaining: number): void {
    // Only notify once per day during grace period
    const key = `grace-${Math.floor(daysRemaining)}`;
    const lastNotification = this.notificationHistory.get(key);

    if (lastNotification) {
      const hoursSinceLastNotification =
        (Date.now() - lastNotification.notifiedAt.getTime()) / (1000 * 60 * 60);

      // Only notify every 24 hours
      if (hoursSinceLastNotification < 24) {
        return;
      }
    }

    const message = this.getGracePeriodMessage(daysRemaining);

    this.logger?.warn('Sending grace period notification', {
      daysRemaining,
    });

    if (this.config.showNotice) {
      new Notice(message, this.config.noticeDuration);
    }

    // Record notification
    this.notificationHistory.set(key, {
      threshold: NotificationThreshold.ONE_DAY, // Placeholder
      notifiedAt: new Date(),
      expiresAt: new Date(Date.now() + daysRemaining * 24 * 60 * 60 * 1000),
    });
  }

  /**
   * Get notification message
   */
  private getNotificationMessage(threshold: NotificationThreshold, daysRemaining: number): string {
    const dayText = daysRemaining === 1 ? 'day' : 'days';

    switch (threshold) {
      case NotificationThreshold.SEVEN_DAYS:
        return `⚠️ Your Social Archiver license will expire in ${daysRemaining} ${dayText}. Please renew to continue using all features.`;

      case NotificationThreshold.THREE_DAYS:
        return `⚠️ Important: Your Social Archiver license expires in ${daysRemaining} ${dayText}! Renew now to avoid service interruption.`;

      case NotificationThreshold.ONE_DAY:
        return `🚨 Urgent: Your Social Archiver license expires in ${daysRemaining} ${dayText}! Renew immediately to maintain access.`;

      default:
        return `⚠️ Your Social Archiver license will expire in ${daysRemaining} ${dayText}.`;
    }
  }

  /**
   * Get grace period message
   */
  private getGracePeriodMessage(daysRemaining: number): string {
    if (daysRemaining < 1) {
      return '🚨 Your license has expired! Your grace period ends today. Some features are restricted. Please renew immediately.';
    }

    const dayText = Math.ceil(daysRemaining) === 1 ? 'day' : 'days';

    return `🚨 Your license has expired! You have ${Math.ceil(daysRemaining)} ${dayText} remaining in your grace period. Some features are restricted. Please renew your license.`;
  }

  /**
   * Calculate days until expiration
   */
  private getDaysUntilExpiration(expiresAt: Date): number {
    const now = new Date();
    const diff = expiresAt.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  /**
   * Record notification
   */
  private recordNotification(threshold: NotificationThreshold, expiresAt: Date): void {
    const key = this.getNotificationKey(threshold, expiresAt);

    this.notificationHistory.set(key, {
      threshold,
      notifiedAt: new Date(),
      expiresAt,
    });

    this.logger?.debug('Notification recorded', {
      threshold,
      expiresAt,
    });
  }

  /**
   * Get notification key for deduplication
   */
  private getNotificationKey(threshold: NotificationThreshold, expiresAt: Date): string {
    // Use expiration date and threshold to create unique key
    const dateStr = expiresAt.toISOString().split('T')[0];
    return `${dateStr}-${threshold}`;
  }

  /**
   * Ensure notifier is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('LicenseExpirationNotifier not initialized. Call initialize() first.');
    }
  }
}
