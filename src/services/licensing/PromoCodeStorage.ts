/**
 * PromoCodeStorage - Persistent storage for applied promo codes and analytics
 */

import { Plugin } from 'obsidian';
import {
  AppliedPromoCode,
  PromoCodeAnalytics,
} from '../../types/license';
import { IService } from '../base/IService';
import { Logger } from '../Logger';

/**
 * Stored promo code data structure
 */
interface StoredPromoData {
  /** Version for migration */
  version: number;
  /** Applied promo codes */
  appliedCodes: AppliedPromoCode[];
  /** Analytics data */
  analytics: Record<string, PromoCodeAnalytics>;
  /** Last updated timestamp */
  lastUpdated: number;
}

/**
 * PromoCodeStorage service
 */
export class PromoCodeStorage implements IService {
  private plugin: Plugin;
  private logger?: Logger;
  private initialized = false;

  // Storage key
  private readonly STORAGE_KEY = 'social-archiver-promo-codes';

  // Current data version
  private readonly DATA_VERSION = 1;

  // In-memory cache
  private appliedCodes: Map<string, AppliedPromoCode> = new Map();
  private analytics: Map<string, PromoCodeAnalytics> = new Map();

  constructor(plugin: Plugin, logger?: Logger) {
    this.plugin = plugin;
    this.logger = logger;
  }

  /**
   * Initialize the storage
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger?.warn('PromoCodeStorage already initialized');
      return;
    }

    this.logger?.info('Initializing PromoCodeStorage');

    // Load existing data
    await this.loadData();

    this.initialized = true;
    this.logger?.info('PromoCodeStorage initialized successfully', {
      appliedCodesCount: this.appliedCodes.size,
      analyticsCount: this.analytics.size,
    });
  }

  /**
   * Shutdown the storage
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.logger?.info('Shutting down PromoCodeStorage');

    // Save current state
    await this.saveData();

    // Clear caches
    this.appliedCodes.clear();
    this.analytics.clear();

    this.initialized = false;
  }

  /**
   * Store an applied promo code
   */
  async storeAppliedCode(appliedCode: AppliedPromoCode): Promise<void> {
    this.ensureInitialized();

    const key = `${appliedCode.code}-${appliedCode.licenseKey}`;

    this.logger?.debug('Storing applied promo code', {
      code: appliedCode.code,
      licenseKey: this.maskLicenseKey(appliedCode.licenseKey),
    });

    this.appliedCodes.set(key, appliedCode);

    await this.saveData();
  }

  /**
   * Check if a code has been applied to a license
   */
  isCodeApplied(code: string, licenseKey: string): boolean {
    this.ensureInitialized();

    const key = `${code}-${licenseKey}`;
    return this.appliedCodes.has(key);
  }

  /**
   * Get all applied codes for a license
   */
  getAppliedCodes(licenseKey: string): AppliedPromoCode[] {
    this.ensureInitialized();

    const applied: AppliedPromoCode[] = [];

    this.appliedCodes.forEach((value) => {
      if (value.licenseKey === licenseKey) {
        applied.push(value);
      }
    });

    return applied;
  }

  /**
   * Get all applied codes
   */
  getAllAppliedCodes(): AppliedPromoCode[] {
    this.ensureInitialized();

    return Array.from(this.appliedCodes.values());
  }

  /**
   * Update analytics for a promo code
   */
  async updateAnalytics(code: string, updates: Partial<PromoCodeAnalytics>): Promise<void> {
    this.ensureInitialized();

    this.logger?.debug('Updating promo code analytics', { code });

    const existing = this.analytics.get(code);

    if (existing) {
      this.analytics.set(code, {
        ...existing,
        ...updates,
      });
    } else {
      this.analytics.set(code, {
        code,
        totalUses: 0,
        conversions: 0,
        revenue: 0,
        ...updates,
      });
    }

    await this.saveData();
  }

  /**
   * Get analytics for a specific code
   */
  getAnalytics(code: string): PromoCodeAnalytics | undefined {
    this.ensureInitialized();

    return this.analytics.get(code);
  }

  /**
   * Get all analytics
   */
  getAllAnalytics(): PromoCodeAnalytics[] {
    this.ensureInitialized();

    return Array.from(this.analytics.values());
  }

  /**
   * Get analytics by partner ID
   */
  getPartnerAnalytics(partnerId: string): PromoCodeAnalytics[] {
    this.ensureInitialized();

    return Array.from(this.analytics.values()).filter(
      (analytics) => {
        // Find applied codes with this partner ID
        const appliedCode = Array.from(this.appliedCodes.values()).find(
          (ac) => ac.code === analytics.code && ac.partnerId === partnerId
        );
        return !!appliedCode;
      }
    );
  }

  /**
   * Clear all stored data (for testing or reset)
   */
  async clearAll(): Promise<void> {
    this.ensureInitialized();

    this.logger?.warn('Clearing all promo code data');

    this.appliedCodes.clear();
    this.analytics.clear();

    await this.saveData();
  }

  /**
   * Export data for backup
   */
  exportData(): StoredPromoData {
    this.ensureInitialized();

    return {
      version: this.DATA_VERSION,
      appliedCodes: Array.from(this.appliedCodes.values()),
      analytics: Object.fromEntries(this.analytics.entries()),
      lastUpdated: Date.now(),
    };
  }

  /**
   * Import data from backup
   */
  async importData(data: StoredPromoData): Promise<void> {
    this.ensureInitialized();

    this.logger?.info('Importing promo code data', {
      version: data.version,
      appliedCodesCount: data.appliedCodes.length,
      analyticsCount: Object.keys(data.analytics).length,
    });

    // Clear existing data
    this.appliedCodes.clear();
    this.analytics.clear();

    // Import applied codes
    data.appliedCodes.forEach((appliedCode) => {
      const key = `${appliedCode.code}-${appliedCode.licenseKey}`;
      this.appliedCodes.set(key, {
        ...appliedCode,
        appliedAt: new Date(appliedCode.appliedAt),
      });
    });

    // Import analytics
    Object.entries(data.analytics).forEach(([code, analytics]) => {
      this.analytics.set(code, {
        ...analytics,
        firstUsedAt: analytics.firstUsedAt ? new Date(analytics.firstUsedAt) : undefined,
        lastUsedAt: analytics.lastUsedAt ? new Date(analytics.lastUsedAt) : undefined,
      });
    });

    await this.saveData();

    this.logger?.info('Promo code data imported successfully');
  }

  // Private helper methods

  /**
   * Load data from Obsidian storage
   */
  private async loadData(): Promise<void> {
    try {
      const data = await this.plugin.loadData();
      const storedData = data?.[this.STORAGE_KEY] as StoredPromoData | undefined;

      if (!storedData) {
        this.logger?.debug('No existing promo code data found');
        return;
      }

      this.logger?.debug('Loading promo code data', {
        version: storedData.version,
        appliedCodesCount: storedData.appliedCodes.length,
      });

      // Migrate if needed
      const migratedData = this.migrateData(storedData);

      // Load applied codes
      migratedData.appliedCodes.forEach((appliedCode) => {
        const key = `${appliedCode.code}-${appliedCode.licenseKey}`;
        this.appliedCodes.set(key, {
          ...appliedCode,
          appliedAt: new Date(appliedCode.appliedAt),
        });
      });

      // Load analytics
      Object.entries(migratedData.analytics).forEach(([code, analytics]) => {
        this.analytics.set(code, {
          ...analytics,
          firstUsedAt: analytics.firstUsedAt ? new Date(analytics.firstUsedAt) : undefined,
          lastUsedAt: analytics.lastUsedAt ? new Date(analytics.lastUsedAt) : undefined,
        });
      });

      this.logger?.info('Promo code data loaded successfully');
    } catch (error) {
      this.logger?.error('Failed to load promo code data', error instanceof Error ? error : undefined);
      // Continue with empty data
    }
  }

  /**
   * Save data to Obsidian storage
   */
  private async saveData(): Promise<void> {
    try {
      const storedData: StoredPromoData = {
        version: this.DATA_VERSION,
        appliedCodes: Array.from(this.appliedCodes.values()),
        analytics: Object.fromEntries(this.analytics.entries()),
        lastUpdated: Date.now(),
      };

      // Load existing plugin data
      const data = (await this.plugin.loadData()) || {};

      // Update promo code data
      data[this.STORAGE_KEY] = storedData;

      // Save back
      await this.plugin.saveData(data);

      this.logger?.debug('Promo code data saved successfully');
    } catch (error) {
      this.logger?.error('Failed to save promo code data', error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Migrate data from older versions
   */
  private migrateData(data: StoredPromoData): StoredPromoData {
    if (data.version === this.DATA_VERSION) {
      return data;
    }

    this.logger?.info('Migrating promo code data', {
      from: data.version,
      to: this.DATA_VERSION,
    });

    // Add migration logic here when needed
    // For now, just update version
    return {
      ...data,
      version: this.DATA_VERSION,
    };
  }

  /**
   * Mask license key for logging
   */
  private maskLicenseKey(key: string): string {
    if (key.length <= 8) {
      return '****';
    }
    return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
  }

  /**
   * Ensure storage is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('PromoCodeStorage not initialized. Call initialize() first.');
    }
  }
}
