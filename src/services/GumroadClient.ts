/**
 * GumroadClient - Gumroad API integration service
 */

import {
  LicenseInfo,
  LicenseValidationResult,
  LicenseErrorCode,
  GumroadLicenseResponse,
  GumroadErrorResponse,
  DeviceInfo,
  LicenseConfig,
  DEFAULT_LICENSE_CONFIG,
} from '../types/license';
import { IService } from './base/IService';
import { Logger } from './Logger';

/**
 * Gumroad API configuration
 */
export interface GumroadClientConfig {
  /** Gumroad product permalink */
  productPermalink: string;
  /** License configuration */
  licenseConfig?: Partial<LicenseConfig>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Maximum retry attempts */
  maxRetries?: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<Omit<GumroadClientConfig, 'productPermalink' | 'licenseConfig'>> = {
  timeout: 10000, // 10 seconds
  maxRetries: 3,
};

/**
 * Gumroad API client service
 */
export class GumroadClient implements IService {
  private config: Required<GumroadClientConfig>;
  private licenseConfig: LicenseConfig;
  private logger?: Logger;
  private initialized = false;

  // API endpoint
  private readonly API_BASE_URL = 'https://api.gumroad.com/v2';

  constructor(config: GumroadClientConfig, logger?: Logger) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      licenseConfig: { ...DEFAULT_LICENSE_CONFIG, ...config.licenseConfig },
    } as Required<GumroadClientConfig>;

    this.licenseConfig = {
      ...DEFAULT_LICENSE_CONFIG,
      ...config.licenseConfig,
    };

    this.logger = logger;
  }

  /**
   * Initialize the Gumroad client
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger?.warn('GumroadClient already initialized');
      return;
    }

    this.logger?.info('Initializing GumroadClient', {
      productPermalink: this.config.productPermalink,
      timeout: this.config.timeout,
      maxRetries: this.config.maxRetries,
    });

    // Validate configuration
    if (!this.config.productPermalink) {
      throw new Error('Product permalink is required');
    }

    this.initialized = true;
    this.logger?.info('GumroadClient initialized successfully');
  }

  /**
   * Shutdown the client
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.logger?.info('Shutting down GumroadClient');
    this.initialized = false;
  }

  /**
   * Verify license key with Gumroad API
   */
  async verifyLicense(
    licenseKey: string,
    deviceInfo?: DeviceInfo
  ): Promise<LicenseValidationResult> {
    this.ensureInitialized();

    this.logger?.info('Verifying license', {
      licenseKey: this.maskLicenseKey(licenseKey),
      deviceId: deviceInfo?.id,
    });

    try {
      const response = await this.makeRequest<GumroadLicenseResponse>(
        '/licenses/verify',
        {
          product_permalink: this.config.productPermalink,
          license_key: licenseKey,
          increment_uses_count: deviceInfo ? 'true' : 'false',
        }
      );

      if (!response.success) {
        return this.handleVerificationError(response as unknown as GumroadErrorResponse);
      }

      // Parse license info
      const licenseInfo = this.parseLicenseResponse(response, licenseKey, deviceInfo);

      // Check if license is valid
      const validationResult = this.validateLicenseInfo(licenseInfo);

      this.logger?.info('License verification completed', {
        valid: validationResult.valid,
        email: licenseInfo.email,
        productId: licenseInfo.productId,
      });

      return validationResult;
    } catch (error) {
      this.logger?.error('License verification failed', error instanceof Error ? error : undefined);

      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: LicenseErrorCode.NETWORK_ERROR,
      };
    }
  }

  /**
   * Test API connectivity
   */
  async testConnection(): Promise<boolean> {
    this.ensureInitialized();

    this.logger?.debug('Testing Gumroad API connection');

    try {
      // Try to verify with a dummy key to test connectivity
      await this.makeRequest<GumroadLicenseResponse>(
        '/licenses/verify',
        {
          product_permalink: this.config.productPermalink,
          license_key: 'test-key-connection-check',
          increment_uses_count: 'false',
        }
      );

      // If we get here without throwing, connection is working
      this.logger?.info('Gumroad API connection test successful');
      return true;
    } catch (error) {
      this.logger?.error('Gumroad API connection test failed', error instanceof Error ? error : undefined);
      return false;
    }
  }

  /**
   * Get license configuration
   */
  getLicenseConfig(): LicenseConfig {
    return { ...this.licenseConfig };
  }

  /**
   * Update license configuration
   */
  updateLicenseConfig(config: Partial<LicenseConfig>): void {
    this.licenseConfig = { ...this.licenseConfig, ...config };
    this.logger?.debug('License configuration updated', config);
  }

  // Private helper methods

  /**
   * Make HTTP request to Gumroad API with retry logic
   */
  private async makeRequest<T>(
    endpoint: string,
    params: Record<string, string>,
    attempt: number = 1
  ): Promise<T> {
    const url = new URL(`${this.API_BASE_URL}${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });

    this.logger?.debug(`Making Gumroad API request (attempt ${attempt})`, {
      endpoint,
      params: this.sanitizeParams(params),
    });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data as T;
    } catch (error) {
      this.logger?.warn(`Gumroad API request failed (attempt ${attempt})`, { error });

      // Retry with exponential backoff
      if (attempt < this.config.maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        this.logger?.debug(`Retrying after ${delay}ms`);

        await this.sleep(delay);
        return this.makeRequest<T>(endpoint, params, attempt + 1);
      }

      throw error;
    }
  }

  /**
   * Parse Gumroad license response
   */
  private parseLicenseResponse(
    response: GumroadLicenseResponse,
    licenseKey: string,
    deviceInfo?: DeviceInfo
  ): LicenseInfo {
    const purchase = response.purchase;

    // Parse devices
    const devices: DeviceInfo[] = [];
    if (deviceInfo) {
      devices.push({
        ...deviceInfo,
        isCurrent: true,
      });
    }

    // Determine license type from custom fields or product variants
    let licenseType = 'subscription'; // Default to subscription
    let initialCredits: number | undefined;
    let creditsResetMonthly = true;

    if (purchase.custom_fields) {
      // Check for license_type custom field
      const typeField = purchase.custom_fields['license_type'];
      if (typeField === 'credit_pack' || typeField === 'CREDIT_PACK') {
        licenseType = 'credit_pack';
        creditsResetMonthly = false;
      } else if (typeField === 'free_tier' || typeField === 'FREE_TIER') {
        licenseType = 'free_tier';
      }

      // Check for initial_credits custom field
      const creditsField = purchase.custom_fields['initial_credits'];
      if (creditsField) {
        initialCredits = parseInt(creditsField, 10);
      }
    }

    // Parse variants for credit pack info (e.g., "100 Credits", "500 Credits")
    if (purchase.variants && !initialCredits) {
      const variantMatch = purchase.variants.match(/(\d+)\s*credits?/i);
      if (variantMatch) {
        initialCredits = parseInt(variantMatch[1]!, 10);
        if (licenseType === 'subscription' && initialCredits) {
          // If credits found in variant but no explicit type, treat as credit pack
          licenseType = 'credit_pack';
          creditsResetMonthly = false;
        }
      }
    }

    // Determine expiration
    let expiresAt: Date | null = null;
    let inGracePeriod = false;
    let gracePeriodEndsAt: Date | null = null;

    if (purchase.subscription_ended_at) {
      expiresAt = new Date(purchase.subscription_ended_at);

      // Check if in grace period
      const now = new Date();
      const gracePeriodEnd = new Date(
        expiresAt.getTime() + this.licenseConfig.gracePeriodDays * 24 * 60 * 60 * 1000
      );

      if (now >= expiresAt && now < gracePeriodEnd) {
        inGracePeriod = true;
        gracePeriodEndsAt = gracePeriodEnd;
      }
    } else if (licenseType === 'credit_pack') {
      // For credit packs without subscription, set expiration (e.g., 1 year from purchase)
      const purchaseDate = new Date(purchase.sale_timestamp);
      expiresAt = new Date(purchaseDate.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year

      // Check if in grace period
      const now = new Date();
      const gracePeriodEnd = new Date(
        expiresAt.getTime() + this.licenseConfig.gracePeriodDays * 24 * 60 * 60 * 1000
      );

      if (now >= expiresAt && now < gracePeriodEnd) {
        inGracePeriod = true;
        gracePeriodEndsAt = gracePeriodEnd;
      }
    }

    return {
      licenseKey,
      provider: 'gumroad',
      licenseType: licenseType as any,
      productId: purchase.product_id,
      email: purchase.email,
      purchaseDate: new Date(purchase.sale_timestamp),
      expiresAt,
      devices,
      isActive: !purchase.refunded && !purchase.disputed && !purchase.chargebacked,
      inGracePeriod,
      gracePeriodEndsAt: gracePeriodEndsAt || undefined,
      initialCredits,
      creditsResetMonthly,
    };
  }

  /**
   * Validate license info
   */
  private validateLicenseInfo(licenseInfo: LicenseInfo): LicenseValidationResult {
    // Check if active
    if (!licenseInfo.isActive) {
      if (licenseInfo.inGracePeriod) {
        return {
          valid: true,
          license: licenseInfo,
        };
      }

      return {
        valid: false,
        error: 'License is inactive',
        errorCode: LicenseErrorCode.INVALID_KEY,
      };
    }

    // Check expiration
    if (licenseInfo.expiresAt) {
      const now = new Date();
      if (now > licenseInfo.expiresAt) {
        if (licenseInfo.inGracePeriod) {
          return {
            valid: true,
            license: licenseInfo,
          };
        }

        return {
          valid: false,
          error: 'License has expired',
          errorCode: LicenseErrorCode.EXPIRED,
        };
      }
    }

    // Check device limit
    if (licenseInfo.devices.length > this.licenseConfig.maxDevices) {
      return {
        valid: false,
        error: `Device limit exceeded (${licenseInfo.devices.length}/${this.licenseConfig.maxDevices})`,
        errorCode: LicenseErrorCode.DEVICE_LIMIT_EXCEEDED,
      };
    }

    return {
      valid: true,
      license: licenseInfo,
    };
  }

  /**
   * Handle verification error
   */
  private handleVerificationError(response: GumroadErrorResponse): LicenseValidationResult {
    const message = response.message || 'Unknown error';

    this.logger?.warn('License verification failed', { message });

    let errorCode = LicenseErrorCode.UNKNOWN_ERROR;

    if (message.toLowerCase().includes('license') || message.toLowerCase().includes('invalid')) {
      errorCode = LicenseErrorCode.INVALID_KEY;
    } else if (message.toLowerCase().includes('refund')) {
      errorCode = LicenseErrorCode.REFUNDED;
    } else if (message.toLowerCase().includes('dispute')) {
      errorCode = LicenseErrorCode.DISPUTED;
    } else if (message.toLowerCase().includes('chargeback')) {
      errorCode = LicenseErrorCode.CHARGEBACKED;
    }

    return {
      valid: false,
      error: message,
      errorCode,
    };
  }

  /**
   * Ensure client is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('GumroadClient not initialized. Call initialize() first.');
    }
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
   * Sanitize params for logging (mask license key)
   */
  private sanitizeParams(params: Record<string, string>): Record<string, string> {
    const sanitized = { ...params };
    if (sanitized.license_key) {
      sanitized.license_key = this.maskLicenseKey(sanitized.license_key);
    }
    return sanitized;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
