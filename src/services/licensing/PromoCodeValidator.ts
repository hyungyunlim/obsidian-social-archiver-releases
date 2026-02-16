/**
 * PromoCodeValidator - Promotional code validation and management service
 */

import {
  PromoCodeInfo,
  PromoCodeValidationResult,
  PromoCodeErrorCode,
  PromoCodeType,
  GumroadCouponResponse,
  AppliedPromoCode,
  PromoCodeAnalytics,
} from '../../types/license';
import { IService } from '../base/IService';
import { Logger } from '../Logger';

/**
 * PromoCodeValidator configuration
 */
export interface PromoCodeValidatorConfig {
  /** Gumroad product permalink */
  productPermalink: string;
  /** Gumroad API access token (for coupon validation) */
  accessToken?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Enable analytics tracking */
  enableAnalytics?: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<Omit<PromoCodeValidatorConfig, 'productPermalink' | 'accessToken'>> = {
  timeout: 10000, // 10 seconds
  maxRetries: 3,
  enableAnalytics: true,
};

/**
 * Promo code validation service
 */
export class PromoCodeValidator implements IService {
  private config: Required<PromoCodeValidatorConfig>;
  private logger?: Logger;
  private initialized = false;

  // Gumroad API endpoint
  private readonly API_BASE_URL = 'https://api.gumroad.com/v2';

  // Storage for applied promo codes (to prevent reuse)
  private appliedCodes: Map<string, AppliedPromoCode> = new Map();

  // Analytics tracking
  private analytics: Map<string, PromoCodeAnalytics> = new Map();

  // Special promo code definitions (for bonus credits, trial extensions, etc.)
  private specialCodes: Map<string, PromoCodeInfo> = new Map();

  constructor(config: PromoCodeValidatorConfig, logger?: Logger) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      accessToken: config.accessToken || '',
    } as Required<PromoCodeValidatorConfig>;

    this.logger = logger;
  }

  /**
   * Initialize the promo code validator
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger?.warn('PromoCodeValidator already initialized');
      return;
    }

    this.logger?.info('Initializing PromoCodeValidator', {
      productPermalink: this.config.productPermalink,
      hasAccessToken: !!this.config.accessToken,
      analyticsEnabled: this.config.enableAnalytics,
    });

    // Validate configuration
    if (!this.config.productPermalink) {
      throw new Error('Product permalink is required');
    }

    // Initialize special codes (hardcoded promo codes that don't require Gumroad API)
    this.initializeSpecialCodes();

    this.initialized = true;
    this.logger?.info('PromoCodeValidator initialized successfully');
  }

  /**
   * Shutdown the validator
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.logger?.info('Shutting down PromoCodeValidator');

    // Clear caches
    this.appliedCodes.clear();
    this.analytics.clear();
    this.specialCodes.clear();

    this.initialized = false;
  }

  /**
   * Validate promotional code
   */
  async validatePromoCode(
    code: string,
    licenseKey?: string,
    email?: string
  ): Promise<PromoCodeValidationResult> {
    this.ensureInitialized();

    const normalizedCode = code.trim().toUpperCase();

    this.logger?.info('Validating promo code', {
      code: normalizedCode,
      hasLicenseKey: !!licenseKey,
      hasEmail: !!email,
    });

    try {
      // Check if already applied to this license
      if (licenseKey && this.isCodeApplied(normalizedCode, licenseKey)) {
        return {
          valid: false,
          error: 'This promotional code has already been used on this license',
          errorCode: PromoCodeErrorCode.ALREADY_USED,
        };
      }

      // Check special codes first (no API call needed)
      const specialCode = this.specialCodes.get(normalizedCode);
      if (specialCode) {
        const validationResult = this.validateSpecialCode(specialCode);
        if (!validationResult.valid) {
          return validationResult;
        }

        // Track analytics
        if (this.config.enableAnalytics) {
          this.trackCodeUsage(normalizedCode);
        }

        return {
          valid: true,
          promoCode: specialCode,
        };
      }

      // Validate with Gumroad API if access token is available
      if (this.config.accessToken) {
        const gumroadResult = await this.validateWithGumroad(normalizedCode);

        if (gumroadResult.valid && gumroadResult.promoCode) {
          // Track analytics
          if (this.config.enableAnalytics) {
            this.trackCodeUsage(normalizedCode);
          }
        }

        return gumroadResult;
      }

      // If no access token and not a special code, reject
      return {
        valid: false,
        error: 'Invalid promotional code',
        errorCode: PromoCodeErrorCode.INVALID_CODE,
      };
    } catch (error) {
      this.logger?.error('Promo code validation failed', error instanceof Error ? error : undefined, { code: normalizedCode });

      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: PromoCodeErrorCode.NETWORK_ERROR,
      };
    }
  }

  /**
   * Apply promotional code to license
   */
  async applyPromoCode(
    code: string,
    licenseKey: string,
    email: string
  ): Promise<AppliedPromoCode> {
    this.ensureInitialized();

    const normalizedCode = code.trim().toUpperCase();

    this.logger?.info('Applying promo code', {
      code: normalizedCode,
      email,
    });

    // Validate first
    const validation = await this.validatePromoCode(normalizedCode, licenseKey, email);

    if (!validation.valid || !validation.promoCode) {
      throw new Error(validation.error || 'Invalid promotional code');
    }

    // Create applied code record
    const appliedCode: AppliedPromoCode = {
      code: normalizedCode,
      licenseKey,
      email,
      appliedAt: new Date(),
      benefit: this.calculateBenefit(validation.promoCode),
      partnerId: validation.promoCode.partnerId,
    };

    // Store to prevent reuse
    const key = `${normalizedCode}-${licenseKey}`;
    this.appliedCodes.set(key, appliedCode);

    // Update analytics
    if (this.config.enableAnalytics) {
      this.trackConversion(normalizedCode);
    }

    this.logger?.info('Promo code applied successfully', {
      code: normalizedCode,
      benefit: appliedCode.benefit,
    });

    return appliedCode;
  }

  /**
   * Get promo code analytics
   */
  getAnalytics(code?: string): PromoCodeAnalytics | Map<string, PromoCodeAnalytics> {
    this.ensureInitialized();

    if (code) {
      const normalizedCode = code.trim().toUpperCase();
      const analytics = this.analytics.get(normalizedCode);

      if (!analytics) {
        return {
          code: normalizedCode,
          totalUses: 0,
          conversions: 0,
          revenue: 0,
        };
      }

      return analytics;
    }

    return this.analytics;
  }

  /**
   * Register a special promotional code
   */
  registerSpecialCode(promoCode: PromoCodeInfo): void {
    this.ensureInitialized();

    const normalizedCode = promoCode.code.trim().toUpperCase();

    this.logger?.info('Registering special promo code', {
      code: normalizedCode,
      type: promoCode.type,
    });

    this.specialCodes.set(normalizedCode, {
      ...promoCode,
      code: normalizedCode,
    });
  }

  /**
   * Remove a special promotional code
   */
  removeSpecialCode(code: string): void {
    this.ensureInitialized();

    const normalizedCode = code.trim().toUpperCase();
    this.specialCodes.delete(normalizedCode);

    this.logger?.info('Special promo code removed', { code: normalizedCode });
  }

  /**
   * Check if a code has been applied to a license
   */
  isCodeApplied(code: string, licenseKey: string): boolean {
    const normalizedCode = code.trim().toUpperCase();
    const key = `${normalizedCode}-${licenseKey}`;
    return this.appliedCodes.has(key);
  }

  /**
   * Get all applied codes for a license
   */
  getAppliedCodes(licenseKey: string): AppliedPromoCode[] {
    const applied: AppliedPromoCode[] = [];

    this.appliedCodes.forEach((value, _key) => {
      if (value.licenseKey === licenseKey) {
        applied.push(value);
      }
    });

    return applied;
  }

  // Private helper methods

  /**
   * Initialize special promotional codes
   */
  private initializeSpecialCodes(): void {
    // Example: Launch promo with bonus credits
    this.registerSpecialCode({
      code: 'LAUNCH50',
      type: PromoCodeType.BONUS_CREDITS,
      bonusCredits: 50,
      validFrom: new Date('2024-01-01'),
      validUntil: new Date('2024-12-31'),
      maxUses: null, // Unlimited
      usesCount: 0,
      isActive: true,
      description: 'Launch promotion: 50 bonus credits',
    });

    // Example: Partner code with extended trial
    this.registerSpecialCode({
      code: 'PARTNER30',
      type: PromoCodeType.EXTENDED_TRIAL,
      extendedDays: 30,
      validFrom: new Date('2024-01-01'),
      validUntil: new Date('2024-12-31'),
      maxUses: 100,
      usesCount: 0,
      isActive: true,
      partnerId: 'partner-001',
      partnerName: 'Example Partner',
      description: 'Partner promotion: 30-day extended trial',
    });
  }

  /**
   * Validate special code
   */
  private validateSpecialCode(promoCode: PromoCodeInfo): PromoCodeValidationResult {
    const now = new Date();

    // Check if active
    if (!promoCode.isActive) {
      return {
        valid: false,
        error: 'This promotional code is no longer active',
        errorCode: PromoCodeErrorCode.INACTIVE,
      };
    }

    // Check date validity
    if (now < promoCode.validFrom) {
      return {
        valid: false,
        error: 'This promotional code is not yet active',
        errorCode: PromoCodeErrorCode.NOT_YET_ACTIVE,
      };
    }

    if (now > promoCode.validUntil) {
      return {
        valid: false,
        error: 'This promotional code has expired',
        errorCode: PromoCodeErrorCode.EXPIRED,
      };
    }

    // Check usage limit
    if (promoCode.maxUses !== null && promoCode.usesCount >= promoCode.maxUses) {
      return {
        valid: false,
        error: 'This promotional code has reached its maximum usage limit',
        errorCode: PromoCodeErrorCode.MAX_USES_REACHED,
      };
    }

    return {
      valid: true,
      promoCode,
    };
  }

  /**
   * Validate with Gumroad API
   */
  private async validateWithGumroad(code: string): Promise<PromoCodeValidationResult> {
    if (!this.config.accessToken) {
      throw new Error('Gumroad access token not configured');
    }

    this.logger?.debug('Validating promo code with Gumroad API', { code });

    try {
      // Note: Gumroad API v2 doesn't have a direct coupon validation endpoint
      // This is a placeholder for when such an endpoint becomes available
      // For now, we'll need to validate coupons during the purchase flow

      // Simulate API call (replace with actual implementation when available)
      const response = await this.makeRequest<GumroadCouponResponse>(
        `/offer_codes/${code}`,
        this.config.accessToken
      );

      if (!response.success || !response.offer_code) {
        return {
          valid: false,
          error: response.message || 'Invalid promotional code',
          errorCode: PromoCodeErrorCode.INVALID_CODE,
        };
      }

      const offerCode = response.offer_code;

      // Parse Gumroad offer code to PromoCodeInfo
      const promoCode: PromoCodeInfo = {
        code,
        type: offerCode.offer_type === 'percentage'
          ? PromoCodeType.PERCENTAGE_DISCOUNT
          : PromoCodeType.FIXED_DISCOUNT,
        discountPercentage: offerCode.offer_type === 'percentage'
          ? offerCode.amount_cents / 100
          : undefined,
        fixedDiscount: offerCode.offer_type === 'fixed'
          ? offerCode.amount_cents / 100
          : undefined,
        validFrom: offerCode.start_date ? new Date(offerCode.start_date) : new Date(0),
        validUntil: offerCode.end_date ? new Date(offerCode.end_date) : new Date('2099-12-31'),
        maxUses: offerCode.max_purchase_count,
        usesCount: offerCode.purchase_count,
        isActive: offerCode.is_active,
        description: offerCode.name,
      };

      // Validate the parsed code
      return this.validateSpecialCode(promoCode);
    } catch (error) {
      this.logger?.error('Gumroad API validation failed', error instanceof Error ? error : undefined, { code });

      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Network error',
        errorCode: PromoCodeErrorCode.NETWORK_ERROR,
      };
    }
  }

  /**
   * Make HTTP request to Gumroad API
   */
  private async makeRequest<T>(
    endpoint: string,
    accessToken: string,
    attempt: number = 1
  ): Promise<T> {
    const url = `${this.API_BASE_URL}${endpoint}`;

    this.logger?.debug(`Making Gumroad API request (attempt ${attempt})`, { endpoint });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
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
        return this.makeRequest<T>(endpoint, accessToken, attempt + 1);
      }

      throw error;
    }
  }

  /**
   * Calculate benefit from promo code
   */
  private calculateBenefit(promoCode: PromoCodeInfo): AppliedPromoCode['benefit'] {
    switch (promoCode.type) {
      case PromoCodeType.PERCENTAGE_DISCOUNT:
        return {
          type: promoCode.type,
          amount: promoCode.discountPercentage || 0,
          description: `${promoCode.discountPercentage}% discount on purchase`,
        };

      case PromoCodeType.FIXED_DISCOUNT:
        return {
          type: promoCode.type,
          amount: promoCode.fixedDiscount || 0,
          description: `$${(promoCode.fixedDiscount || 0).toFixed(2)} discount on purchase`,
        };

      case PromoCodeType.EXTENDED_TRIAL:
        return {
          type: promoCode.type,
          amount: promoCode.extendedDays || 0,
          description: `${promoCode.extendedDays} extra trial days`,
        };

      case PromoCodeType.BONUS_CREDITS:
        return {
          type: promoCode.type,
          amount: promoCode.bonusCredits || 0,
          description: `${promoCode.bonusCredits} bonus credits`,
        };

      default:
        return {
          type: promoCode.type,
          amount: 0,
          description: 'Unknown benefit',
        };
    }
  }

  /**
   * Track promo code usage
   */
  private trackCodeUsage(code: string): void {
    if (!this.config.enableAnalytics) {
      return;
    }

    const existing = this.analytics.get(code);

    if (existing) {
      existing.totalUses++;
      existing.lastUsedAt = new Date();
    } else {
      this.analytics.set(code, {
        code,
        totalUses: 1,
        conversions: 0,
        revenue: 0,
        firstUsedAt: new Date(),
        lastUsedAt: new Date(),
      });
    }

    // Update special code use count
    const specialCode = this.specialCodes.get(code);
    if (specialCode) {
      specialCode.usesCount++;
    }
  }

  /**
   * Track successful conversion
   */
  private trackConversion(code: string): void {
    if (!this.config.enableAnalytics) {
      return;
    }

    const analytics = this.analytics.get(code);
    if (analytics) {
      analytics.conversions++;
    }
  }

  /**
   * Ensure validator is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('PromoCodeValidator not initialized. Call initialize() first.');
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
