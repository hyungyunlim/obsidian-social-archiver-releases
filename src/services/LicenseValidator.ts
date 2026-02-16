/**
 * LicenseValidator - License validation and management service
 */

import {
  LicenseInfo,
  LicenseValidationResult,
  DeviceInfo,
  LicenseConfig,
  DEFAULT_LICENSE_CONFIG,
} from '../types/license';
import { IService } from './base/IService';
import { GumroadClient } from './GumroadClient';
import { LicenseStorage } from './LicenseStorage';
import { Logger } from './Logger';
import { generateDeviceId } from '../utils/encryption';

/**
 * License validator configuration
 */
export interface LicenseValidatorConfig {
  /** License configuration */
  licenseConfig?: Partial<LicenseConfig>;
  /** Whether to enable offline mode */
  enableOfflineMode?: boolean;
  /** Auto-refresh interval in milliseconds (default: 24 hours) */
  autoRefreshInterval?: number;
}

/**
 * Default configuration
 */
const DEFAULT_VALIDATOR_CONFIG: Required<LicenseValidatorConfig> = {
  licenseConfig: DEFAULT_LICENSE_CONFIG,
  enableOfflineMode: true,
  autoRefreshInterval: 24 * 60 * 60 * 1000, // 24 hours
};

/**
 * License validator service
 */
export class LicenseValidator implements IService {
  private config: Required<LicenseValidatorConfig>;
  private gumroadClient: GumroadClient;
  private storage: LicenseStorage;
  private logger?: Logger;
  private initialized = false;

  // Current license state
  private currentLicense?: LicenseInfo;
  private currentDeviceInfo?: DeviceInfo;

  // Auto-refresh timer
  private refreshTimer?: NodeJS.Timeout;

  constructor(
    config: LicenseValidatorConfig,
    gumroadClient: GumroadClient,
    storage: LicenseStorage,
    logger?: Logger
  ) {
    this.config = {
      ...DEFAULT_VALIDATOR_CONFIG,
      ...config,
      licenseConfig: { ...DEFAULT_LICENSE_CONFIG, ...config.licenseConfig },
    };

    this.gumroadClient = gumroadClient;
    this.storage = storage;
    this.logger = logger;
  }

  /**
   * Initialize the license validator
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger?.warn('LicenseValidator already initialized');
      return;
    }

    this.logger?.info('Initializing LicenseValidator');

    // Initialize dependencies
    await this.gumroadClient.initialize();
    await this.storage.initialize();

    // Load device info
    await this.loadDeviceInfo();

    // Load cached license if available
    try {
      const cached = await this.storage.retrieveLicense();
      if (cached) {
        this.currentLicense = cached;
        this.logger?.info('Loaded cached license', {
          email: cached.email,
          productId: cached.productId,
        });
      }
    } catch (error) {
      this.logger?.warn('Failed to load cached license', { error });
    }

    this.initialized = true;

    // Start auto-refresh if license is loaded
    if (this.currentLicense) {
      this.startAutoRefresh();
    }

    this.logger?.info('LicenseValidator initialized successfully');
  }

  /**
   * Shutdown the validator
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.logger?.info('Shutting down LicenseValidator');

    // Stop auto-refresh
    this.stopAutoRefresh();

    // Shutdown dependencies
    await this.storage.shutdown();
    await this.gumroadClient.shutdown();

    this.initialized = false;
  }

  /**
   * Validate and activate license key
   */
  async validateLicense(licenseKey: string, forceOnline: boolean = false): Promise<LicenseInfo> {
    this.ensureInitialized();

    this.logger?.info('Validating license', {
      forceOnline,
      hasCache: !!this.currentLicense,
    });

    // Try online validation first if forced or no cache
    if (forceOnline || !this.currentLicense) {
      try {
        const result = await this.validateOnline(licenseKey);

        if (result.valid && result.license) {
          // Store license
          await this.storage.storeLicense(licenseKey, result.license);
          this.currentLicense = result.license;

          // Start auto-refresh
          this.startAutoRefresh();

          this.logger?.info('License validated and stored', {
            email: result.license.email,
            productId: result.license.productId,
          });

          return result.license;
        } else {
          throw new Error(result.error || 'License validation failed');
        }
      } catch (error) {
        // If online validation fails and offline mode is enabled, try cache
        if (this.config.enableOfflineMode && this.currentLicense) {
          this.logger?.warn('Online validation failed, using cached license', { error });

          // Check if cache is still valid
          if (this.isCacheValid()) {
            return this.currentLicense;
          } else {
            throw new Error('Cached license expired and cannot validate online');
          }
        }

        throw error;
      }
    }

    // Use cached license
    if (this.currentLicense) {
      if (this.isCacheValid()) {
        this.logger?.debug('Using cached license');
        return this.currentLicense;
      } else {
        this.logger?.warn('Cached license expired, attempting online validation');

        try {
          return await this.validateLicense(licenseKey, true);
        } catch (error) {
          throw new Error('Cached license expired and cannot validate online');
        }
      }
    }

    throw new Error('No license available');
  }

  /**
   * Get current license
   */
  getLicense(): LicenseInfo | undefined {
    return this.currentLicense;
  }

  /**
   * Check if license is valid
   */
  isLicenseValid(): boolean {
    if (!this.currentLicense) {
      return false;
    }

    // Check if active
    if (!this.currentLicense.isActive) {
      return this.currentLicense.inGracePeriod || false;
    }

    // Check expiration
    if (this.currentLicense.expiresAt) {
      const now = new Date();
      if (now > this.currentLicense.expiresAt) {
        return this.currentLicense.inGracePeriod || false;
      }
    }

    // Check offline grace period if in offline mode
    if (this.config.enableOfflineMode) {
      return this.isCacheValid();
    }

    return true;
  }

  /**
   * Refresh license from server
   */
  async refreshLicense(): Promise<LicenseInfo> {
    this.ensureInitialized();

    if (!this.currentLicense) {
      throw new Error('No license to refresh');
    }

    this.logger?.info('Refreshing license');

    return await this.validateLicense(this.currentLicense.licenseKey, true);
  }

  /**
   * Clear license (logout)
   */
  async clearLicense(): Promise<void> {
    this.ensureInitialized();

    this.logger?.info('Clearing license');

    // Stop auto-refresh
    this.stopAutoRefresh();

    // Clear storage
    await this.storage.clearLicense();

    // Clear current license
    this.currentLicense = undefined;

    this.logger?.info('License cleared');
  }

  /**
   * Get device info
   */
  getDeviceInfo(): DeviceInfo | undefined {
    return this.currentDeviceInfo;
  }

  // Private helper methods

  /**
   * Validate license online
   */
  private async validateOnline(licenseKey: string): Promise<LicenseValidationResult> {
    this.logger?.debug('Performing online license validation');

    return await this.gumroadClient.verifyLicense(licenseKey, this.currentDeviceInfo);
  }

  /**
   * Check if cached license is valid
   */
  private isCacheValid(): boolean {
    if (!this.currentLicense) {
      return false;
    }

    const cached = this.storage.getCachedInfo();
    if (!cached) {
      return false;
    }

    const cacheAge = Date.now() - (cached.cachedAt || 0);
    const offlineGracePeriod = this.config.licenseConfig.offlineGracePeriodDays! * 24 * 60 * 60 * 1000;

    return cacheAge < offlineGracePeriod;
  }

  /**
   * Load or create device info
   */
  private async loadDeviceInfo(): Promise<void> {
    let deviceId = await this.storage.getDeviceId();

    if (!deviceId) {
      deviceId = generateDeviceId();
      await this.storage.storeDeviceId(deviceId);
      this.logger?.info('Generated new device ID', { deviceId });
    }

    this.currentDeviceInfo = {
      id: deviceId,
      name: this.getDeviceName(),
      platform: process.platform,
      activatedAt: new Date(),
      lastSeenAt: new Date(),
    };

    this.logger?.debug('Device info loaded', this.currentDeviceInfo as unknown as Record<string, unknown>);
  }

  /**
   * Get device name
   */
  private getDeviceName(): string {
    // Try to get hostname or fallback to platform
    if (typeof navigator !== 'undefined' && navigator.userAgent) {
      return navigator.userAgent;
    }

    return `${process.platform}-device`;
  }

  /**
   * Start auto-refresh timer
   */
  private startAutoRefresh(): void {
    this.stopAutoRefresh();

    this.refreshTimer = setInterval(async () => {
      try {
        this.logger?.debug('Auto-refreshing license');
        await this.refreshLicense();
      } catch (error) {
        this.logger?.error('Auto-refresh failed', error instanceof Error ? error : undefined);
      }
    }, this.config.autoRefreshInterval);

    this.logger?.debug('Auto-refresh timer started', {
      interval: this.config.autoRefreshInterval,
    });
  }

  /**
   * Stop auto-refresh timer
   */
  private stopAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
      this.logger?.debug('Auto-refresh timer stopped');
    }
  }

  /**
   * Ensure validator is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('LicenseValidator not initialized. Call initialize() first.');
    }
  }
}
