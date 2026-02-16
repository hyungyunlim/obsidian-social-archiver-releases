/**
 * GracePeriodManager - Manage feature restrictions during grace period
 */

import { LicenseInfo } from '../../types/license';
import { IService } from '../base/IService';
import { Logger } from '../Logger';

/**
 * Feature restrictions during grace period
 */
export interface FeatureRestrictions {
  /** Can perform basic archive operations */
  canArchive: boolean;
  /** Can use AI features */
  canUseAI: boolean;
  /** Can perform deep research */
  canUseDeepResearch: boolean;
  /** Can create public shares */
  canShare: boolean;
  /** Can use custom domain */
  canUseCustomDomain: boolean;
  /** Maximum archives per day during grace period */
  maxArchivesPerDay: number;
  /** Descriptive message about restrictions */
  restrictionMessage: string;
}

/**
 * Grace period status
 */
export interface GracePeriodStatus {
  /** Whether license is in grace period */
  isInGracePeriod: boolean;
  /** Days remaining in grace period */
  daysRemaining: number;
  /** Grace period end date */
  gracePeriodEndsAt?: Date;
  /** Feature restrictions */
  restrictions: FeatureRestrictions;
  /** License expiration date */
  expiresAt?: Date;
}

/**
 * GracePeriodManager configuration
 */
export interface GracePeriodManagerConfig {
  /** Grace period duration in days (default: 3) */
  gracePeriodDays?: number;
  /** Max archives per day during grace period (default: 5) */
  maxArchivesPerDay?: number;
  /** Allow AI features during grace period (default: false) */
  allowAIFeatures?: boolean;
  /** Allow sharing during grace period (default: false) */
  allowSharing?: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<GracePeriodManagerConfig> = {
  gracePeriodDays: 3,
  maxArchivesPerDay: 5,
  allowAIFeatures: false,
  allowSharing: false,
};

/**
 * Grace period manager service
 */
export class GracePeriodManager implements IService {
  private config: Required<GracePeriodManagerConfig>;
  private logger?: Logger;
  private initialized = false;

  // Current license
  private currentLicense?: LicenseInfo;

  // Daily usage tracking
  private dailyArchiveCount: Map<string, number> = new Map();
  private lastResetDate?: Date;

  constructor(config: GracePeriodManagerConfig = {}, logger?: Logger) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    this.logger = logger;
  }

  /**
   * Initialize the manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger?.warn('GracePeriodManager already initialized');
      return;
    }

    this.logger?.info('Initializing GracePeriodManager', {
      gracePeriodDays: this.config.gracePeriodDays,
      maxArchivesPerDay: this.config.maxArchivesPerDay,
    });

    this.lastResetDate = new Date();

    this.initialized = true;
    this.logger?.info('GracePeriodManager initialized successfully');
  }

  /**
   * Shutdown the manager
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.logger?.info('Shutting down GracePeriodManager');

    this.dailyArchiveCount.clear();

    this.initialized = false;
  }

  /**
   * Set license to monitor
   */
  setLicense(license: LicenseInfo | undefined): void {
    this.ensureInitialized();

    this.currentLicense = license;

    if (license) {
      this.logger?.debug('License set for grace period management', {
        email: license.email,
        expiresAt: license.expiresAt,
        inGracePeriod: license.inGracePeriod,
      });
    }
  }

  /**
   * Get grace period status
   */
  getGracePeriodStatus(): GracePeriodStatus {
    this.ensureInitialized();

    if (!this.currentLicense) {
      return this.createDefaultStatus();
    }

    const isInGracePeriod = this.currentLicense.inGracePeriod || false;

    if (!isInGracePeriod) {
      return {
        isInGracePeriod: false,
        daysRemaining: 0,
        restrictions: this.getNoRestrictions(),
        expiresAt: this.currentLicense.expiresAt || undefined,
      };
    }

    const gracePeriodEndsAt = this.currentLicense.gracePeriodEndsAt
      ? new Date(this.currentLicense.gracePeriodEndsAt)
      : undefined;

    const daysRemaining = gracePeriodEndsAt
      ? this.calculateDaysRemaining(gracePeriodEndsAt)
      : 0;

    return {
      isInGracePeriod: true,
      daysRemaining,
      gracePeriodEndsAt,
      restrictions: this.getRestrictions(),
      expiresAt: this.currentLicense.expiresAt || undefined,
    };
  }

  /**
   * Check if feature is allowed
   */
  isFeatureAllowed(feature: keyof FeatureRestrictions): boolean {
    const status = this.getGracePeriodStatus();

    if (!status.isInGracePeriod) {
      return true;
    }

    return status.restrictions[feature] === true;
  }

  /**
   * Check if can perform archive operation
   */
  canArchive(): boolean {
    const status = this.getGracePeriodStatus();

    if (!status.isInGracePeriod) {
      return true;
    }

    // Check daily limit
    this.checkDailyReset();

    const today = this.getTodayKey();
    const count = this.dailyArchiveCount.get(today) || 0;

    return count < this.config.maxArchivesPerDay;
  }

  /**
   * Record archive operation
   */
  recordArchive(): void {
    this.ensureInitialized();
    this.checkDailyReset();

    const today = this.getTodayKey();
    const count = this.dailyArchiveCount.get(today) || 0;

    this.dailyArchiveCount.set(today, count + 1);

    this.logger?.debug('Archive recorded', {
      today,
      count: count + 1,
      limit: this.config.maxArchivesPerDay,
    });
  }

  /**
   * Get remaining archives for today
   */
  getRemainingArchives(): number {
    const status = this.getGracePeriodStatus();

    if (!status.isInGracePeriod) {
      return Infinity;
    }

    this.checkDailyReset();

    const today = this.getTodayKey();
    const count = this.dailyArchiveCount.get(today) || 0;

    return Math.max(0, this.config.maxArchivesPerDay - count);
  }

  /**
   * Get archives used today
   */
  getArchivesUsedToday(): number {
    this.checkDailyReset();

    const today = this.getTodayKey();
    return this.dailyArchiveCount.get(today) || 0;
  }

  // Private methods

  /**
   * Get feature restrictions for grace period
   */
  private getRestrictions(): FeatureRestrictions {
    return {
      canArchive: true, // Basic archiving allowed
      canUseAI: this.config.allowAIFeatures,
      canUseDeepResearch: false, // Deep research always disabled
      canShare: this.config.allowSharing,
      canUseCustomDomain: false,
      maxArchivesPerDay: this.config.maxArchivesPerDay,
      restrictionMessage: this.getRestrictionMessage(),
    };
  }

  /**
   * Get no restrictions (normal operation)
   */
  private getNoRestrictions(): FeatureRestrictions {
    return {
      canArchive: true,
      canUseAI: true,
      canUseDeepResearch: true,
      canShare: true,
      canUseCustomDomain: true,
      maxArchivesPerDay: Infinity,
      restrictionMessage: '',
    };
  }

  /**
   * Get restriction message
   */
  private getRestrictionMessage(): string {
    const parts = [
      'Your license has expired. You are in a grace period with limited features:',
      `• Basic archiving: ${this.config.maxArchivesPerDay} per day`,
    ];

    if (this.config.allowAIFeatures) {
      parts.push('• AI features: Available');
    } else {
      parts.push('• AI features: Disabled');
    }

    parts.push('• Deep research: Disabled');

    if (this.config.allowSharing) {
      parts.push('• Public sharing: Available');
    } else {
      parts.push('• Public sharing: Disabled');
    }

    parts.push('\nPlease renew your license to restore full functionality.');

    return parts.join('\n');
  }

  /**
   * Create default status (no license)
   */
  private createDefaultStatus(): GracePeriodStatus {
    return {
      isInGracePeriod: false,
      daysRemaining: 0,
      restrictions: this.getNoRestrictions(),
    };
  }

  /**
   * Calculate days remaining until grace period end
   */
  private calculateDaysRemaining(gracePeriodEndsAt: Date): number {
    const now = new Date();
    const diff = gracePeriodEndsAt.getTime() - now.getTime();
    const days = diff / (1000 * 60 * 60 * 24);

    return Math.max(0, Math.ceil(days));
  }

  /**
   * Check if daily count needs to be reset
   */
  private checkDailyReset(): void {
    if (!this.lastResetDate) {
      this.lastResetDate = new Date();
      return;
    }

    const now = new Date();
    const lastReset = this.lastResetDate;

    // Check if it's a new day
    if (
      now.getFullYear() !== lastReset.getFullYear() ||
      now.getMonth() !== lastReset.getMonth() ||
      now.getDate() !== lastReset.getDate()
    ) {
      this.logger?.debug('Resetting daily archive count');
      this.dailyArchiveCount.clear();
      this.lastResetDate = now;
    }
  }

  /**
   * Get today's key for tracking
   */
  private getTodayKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  }

  /**
   * Ensure manager is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('GracePeriodManager not initialized. Call initialize() first.');
    }
  }
}
