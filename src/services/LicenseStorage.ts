/**
 * LicenseStorage - Encrypted license storage service using Obsidian's data API
 */

import { Plugin } from 'obsidian';
import {
  LicenseInfo,
  StoredLicenseData,
  LicenseConfig,
  DEFAULT_LICENSE_CONFIG,
} from '../types/license';
import { IService } from './base/IService';
import { Logger } from './Logger';
import {
  deriveEncryptionKey,
  encrypt,
  decrypt,
  generateDeviceId,
  sha256Hash,
} from '../utils/encryption';

/**
 * License storage configuration
 */
export interface LicenseStorageConfig {
  /** Plugin instance for data persistence */
  plugin: Plugin;
  /** License configuration */
  licenseConfig?: Partial<LicenseConfig>;
}

/**
 * Storage data structure
 */
interface LicenseStorageData {
  /** Stored license data */
  license?: StoredLicenseData;
  /** Device ID */
  deviceId?: string;
  /** Storage version for migrations */
  version: number;
}

/**
 * Current storage version
 */
const STORAGE_VERSION = 1;

/**
 * License storage service
 */
export class LicenseStorage implements IService {
  private config: LicenseStorageConfig;
  private licenseConfig: LicenseConfig;
  private logger?: Logger;
  private initialized = false;

  // Cached data
  private cachedData?: LicenseStorageData;
  private encryptionKey?: CryptoKey;

  constructor(config: LicenseStorageConfig, logger?: Logger) {
    this.config = config;
    this.licenseConfig = {
      ...DEFAULT_LICENSE_CONFIG,
      ...config.licenseConfig,
    };
    this.logger = logger;
  }

  /**
   * Initialize the license storage
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger?.warn('LicenseStorage already initialized');
      return;
    }

    this.logger?.info('Initializing LicenseStorage');

    // Load existing data
    await this.loadData();

    // Initialize device ID if not exists
    if (!this.cachedData?.deviceId) {
      const deviceId = generateDeviceId();
      await this.storeDeviceId(deviceId);
    }

    // Derive encryption key
    this.encryptionKey = await deriveEncryptionKey(this.cachedData!.deviceId!);

    this.initialized = true;
    this.logger?.info('LicenseStorage initialized successfully');
  }

  /**
   * Shutdown the storage
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.logger?.info('Shutting down LicenseStorage');

    // Save any pending data
    await this.saveData();

    this.initialized = false;
  }

  /**
   * Store license securely
   */
  async storeLicense(licenseKey: string, info: LicenseInfo): Promise<void> {
    this.ensureInitialized();

    this.logger?.info('Storing license', {
      email: info.email,
      productId: info.productId,
    });

    // Encrypt license key
    const { encrypted, iv } = await encrypt(licenseKey, this.encryptionKey!);

    // Compute integrity hash
    const dataToHash = `${encrypted}:${iv}:${this.cachedData!.deviceId!}`;
    const integrityHash = await sha256Hash(dataToHash);

    // Create stored data
    const storedData: StoredLicenseData = {
      encryptedKey: encrypted,
      iv,
      cachedInfo: info,
      cachedAt: Date.now(),
      deviceId: this.cachedData!.deviceId!,
      integrityHash,
    };

    // Update cache
    this.cachedData!.license = storedData;

    // Save to disk
    await this.saveData();

    this.logger?.info('License stored successfully');
  }

  /**
   * Retrieve license
   */
  async retrieveLicense(): Promise<LicenseInfo | null> {
    this.ensureInitialized();

    if (!this.cachedData?.license) {
      this.logger?.debug('No license stored');
      return null;
    }

    const stored = this.cachedData.license;

    // Check if cache is expired
    if (stored.cachedAt) {
      const cacheAge = Date.now() - stored.cachedAt;
      if (cacheAge > this.licenseConfig.cacheDuration) {
        this.logger?.warn('Cached license expired', {
          cacheAge: Math.round(cacheAge / 1000 / 60),
          cacheDurationMinutes: Math.round(this.licenseConfig.cacheDuration / 1000 / 60),
        });
      }
    }

    // Decrypt license key
    try {
      const licenseKey = await decrypt(
        stored.encryptedKey,
        stored.iv,
        this.encryptionKey!
      );

      // Verify integrity
      const isValid = await this.verifyIntegrity(stored);
      if (!isValid) {
        this.logger?.error('License data integrity check failed');
        throw new Error('License data may be corrupted or tampered with');
      }

      if (stored.cachedInfo) {
        // Update license key in cached info
        stored.cachedInfo.licenseKey = licenseKey;
        return stored.cachedInfo;
      }

      return null;
    } catch (error) {
      this.logger?.error('Failed to retrieve license', error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Clear license
   */
  async clearLicense(): Promise<void> {
    this.ensureInitialized();

    this.logger?.info('Clearing license');

    if (this.cachedData) {
      this.cachedData.license = undefined;
      await this.saveData();
    }

    this.logger?.info('License cleared');
  }

  /**
   * Store device ID
   */
  async storeDeviceId(deviceId: string): Promise<void> {
    this.ensureInitialized();

    this.logger?.debug('Storing device ID', { deviceId });

    if (!this.cachedData) {
      this.cachedData = {
        version: STORAGE_VERSION,
      };
    }

    this.cachedData.deviceId = deviceId;
    await this.saveData();
  }

  /**
   * Get device ID
   */
  async getDeviceId(): Promise<string | null> {
    this.ensureInitialized();

    return this.cachedData?.deviceId || null;
  }

  /**
   * Get cached license info (without decrypting key)
   */
  getCachedInfo(): StoredLicenseData | null {
    return this.cachedData?.license || null;
  }

  /**
   * Create backup of license data
   */
  async createBackup(): Promise<string> {
    this.ensureInitialized();

    if (!this.cachedData?.license) {
      throw new Error('No license data to backup');
    }

    this.logger?.info('Creating license backup');

    // Create backup object with metadata
    const backup = {
      version: STORAGE_VERSION,
      createdAt: Date.now(),
      deviceId: this.cachedData.deviceId,
      license: this.cachedData.license,
    };

    // Serialize and encode backup
    const backupJson = JSON.stringify(backup);
    const encoded = btoa(backupJson);

    this.logger?.info('License backup created');

    return encoded;
  }

  /**
   * Restore license data from backup
   */
  async restoreBackup(backupData: string): Promise<void> {
    this.ensureInitialized();

    this.logger?.info('Restoring license from backup');

    try {
      // Decode backup
      const backupJson = atob(backupData);
      const backup = JSON.parse(backupJson);

      // Validate backup structure
      if (!backup.version || !backup.license || !backup.deviceId) {
        throw new Error('Invalid backup format');
      }

      // Check if backup is from same device
      if (backup.deviceId !== this.cachedData?.deviceId) {
        this.logger?.warn('Backup is from different device', {
          backupDevice: backup.deviceId,
          currentDevice: this.cachedData?.deviceId,
        });

        throw new Error(
          'Backup is from a different device. License keys are device-specific and cannot be transferred.'
        );
      }

      // Check version compatibility
      if (backup.version > STORAGE_VERSION) {
        throw new Error(
          `Backup version ${backup.version} is newer than current version ${STORAGE_VERSION}`
        );
      }

      // Restore license data
      if (!this.cachedData) {
        this.cachedData = {
          version: STORAGE_VERSION,
          deviceId: backup.deviceId,
        };
      }

      this.cachedData.license = backup.license;

      // Verify integrity after restore
      if (!this.cachedData.license) {
        throw new Error('License data is missing after restore');
      }
      const isValid = await this.verifyIntegrity(this.cachedData.license);
      if (!isValid) {
        throw new Error('Restored license data failed integrity check');
      }

      // Save restored data
      await this.saveData();

      this.logger?.info('License restored from backup successfully');
    } catch (error) {
      this.logger?.error('Failed to restore license from backup', error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Migrate storage from older versions
   */
  async migrate(oldVersion: number): Promise<void> {
    this.ensureInitialized();

    this.logger?.info('Migrating license storage', {
      from: oldVersion,
      to: STORAGE_VERSION,
    });

    // Currently no migrations needed
    // Add migration logic here when storage format changes

    if (this.cachedData) {
      this.cachedData.version = STORAGE_VERSION;
      await this.saveData();
    }
  }

  // Private helper methods

  /**
   * Load data from Obsidian's data API
   */
  private async loadData(): Promise<void> {
    try {
      const data = await this.config.plugin.loadData();

      if (data && data.licenseStorage) {
        this.cachedData = data.licenseStorage;

        // Check version and migrate if needed
        if (this.cachedData?.version && this.cachedData.version < STORAGE_VERSION) {
          await this.migrate(this.cachedData.version);
        }

        this.logger?.debug('License storage data loaded', {
          hasLicense: !!this.cachedData?.license,
          hasDeviceId: !!this.cachedData?.deviceId,
        });
      } else {
        // Initialize empty data
        this.cachedData = {
          version: STORAGE_VERSION,
        };

        this.logger?.debug('Initialized empty license storage');
      }
    } catch (error) {
      this.logger?.error('Failed to load license storage data', error instanceof Error ? error : undefined);

      // Initialize empty data on error
      this.cachedData = {
        version: STORAGE_VERSION,
      };
    }
  }

  /**
   * Save data to Obsidian's data API
   */
  private async saveData(): Promise<void> {
    try {
      const existingData = await this.config.plugin.loadData() || {};

      existingData.licenseStorage = this.cachedData;

      await this.config.plugin.saveData(existingData);

      this.logger?.debug('License storage data saved');
    } catch (error) {
      this.logger?.error('Failed to save license storage data', error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Verify data integrity
   */
  private async verifyIntegrity(stored: StoredLicenseData): Promise<boolean> {
    try {
      // Compute hash of encrypted data + device ID
      const dataToHash = `${stored.encryptedKey}:${stored.iv}:${stored.deviceId}`;
      const computedHash = await sha256Hash(dataToHash);

      // If stored hash exists, verify against it
      if (stored.integrityHash) {
        if (computedHash !== stored.integrityHash) {
          this.logger?.error('Integrity hash mismatch - data may be tampered', undefined, {
            expected: stored.integrityHash.substring(0, 16) + '...',
            computed: computedHash.substring(0, 16) + '...',
          });
          return false;
        }
      } else {
        // Legacy data without hash - just verify we can compute it
        this.logger?.warn('License data has no integrity hash (legacy format)');
      }

      return true;
    } catch (error) {
      this.logger?.error('Integrity verification failed', error instanceof Error ? error : undefined);
      return false;
    }
  }

  /**
   * Ensure storage is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('LicenseStorage not initialized. Call initialize() first.');
    }
  }
}
