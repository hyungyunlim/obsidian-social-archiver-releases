/**
 * CloudflareAPI - Client for Cloudflare Workers API
 */

import { requestUrl, RequestUrlParam } from 'obsidian';
import {
  CloudflareAPIResponse,
  LicenseValidationResponse,
  CreditUsageResponse,
  CreditRefundResponse,
  Platform,
} from '../types/credit';
import type { ProfileArchiveRequest, ProfileCrawlResponse } from '../types/profile-crawl';
import { IService } from '../types/services';
import { Logger } from './Logger';

/**
 * Cloudflare API configuration
 */
export interface CloudflareAPIConfig {
  /** API endpoint URL */
  endpoint: string;
  /** License key for authentication */
  licenseKey?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Number of retry attempts */
  retries?: number;
  /** Retry delay in milliseconds */
  retryDelay?: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Partial<CloudflareAPIConfig> = {
  timeout: 30000,
  retries: 3,
  retryDelay: 1000,
};

/**
 * Cloudflare API client for Workers backend
 */
export class CloudflareAPI implements IService {
  private config: CloudflareAPIConfig;
  private logger?: Logger;
  private initialized = false;

  constructor(config: CloudflareAPIConfig, logger?: Logger) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
  }

  /**
   * Initialize the API client
   */
  initialize(): void {
    if (this.initialized) {
      this.logger?.warn('CloudflareAPI already initialized');
      return;
    }

    this.logger?.info('Initializing CloudflareAPI', {
      endpoint: this.config.endpoint,
      hasLicenseKey: !!this.config.licenseKey,
    });

    // Validate endpoint
    if (!this.config.endpoint) {
      throw new Error('API endpoint is required');
    }

    try {
      new URL(this.config.endpoint);
    } catch (error) {
      throw new Error(`Invalid API endpoint: ${this.config.endpoint}`);
    }

    this.initialized = true;
    this.logger?.info('CloudflareAPI initialized successfully');
  }

  /**
   * Shutdown the API client
   */
  shutdown(): void {
    if (!this.initialized) {
      return;
    }

    this.logger?.info('Shutting down CloudflareAPI');
    this.initialized = false;
  }

  /**
   * Validate license key and get credit information
   */
  async validateLicense(licenseKey: string): Promise<LicenseValidationResponse> {
    this.ensureInitialized();

    this.logger?.debug('Validating license', { licenseKey: this.maskLicenseKey(licenseKey) });

    const response = await this.request<LicenseValidationResponse>('/api/license/validate', {
      method: 'POST',
      body: JSON.stringify({ licenseKey }),
    });

    this.logger?.info('License validated', {
      plan: response.plan,
      creditsRemaining: response.creditsRemaining,
    });

    return response;
  }

  /**
   * Deduct credits for a request
   */
  async useCredits(platform: Platform, credits?: number): Promise<CreditUsageResponse> {
    this.ensureInitialized();

    if (!this.config.licenseKey) {
      throw new Error('License key is required for credit operations');
    }

    const amount = credits ?? 1;

    this.logger?.debug('Using credits', { platform, amount });

    const url = `/api/license/use-credits?credits=${amount}`;
    const response = await this.request<CreditUsageResponse>(url, {
      method: 'POST',
      headers: {
        'X-License-Key': this.config.licenseKey,
      },
    });

    this.logger?.info('Credits used', {
      platform,
      creditsUsed: response.creditsUsed,
      creditsRemaining: response.creditsRemaining,
    });

    return response;
  }

  /**
   * Refund credits for a failed request
   */
  async refundCredits(platform: Platform, credits: number, reference?: string): Promise<CreditRefundResponse> {
    this.ensureInitialized();

    if (!this.config.licenseKey) {
      throw new Error('License key is required for credit operations');
    }

    this.logger?.debug('Refunding credits', { platform, credits, reference });

    const response = await this.request<CreditRefundResponse>('/api/license/refund-credits', {
      method: 'POST',
      headers: {
        'X-License-Key': this.config.licenseKey,
      },
      body: JSON.stringify({
        credits,
        platform,
        reference,
      }),
    });

    this.logger?.info('Credits refunded', {
      platform,
      creditsRefunded: response.creditsRefunded,
      creditsRemaining: response.creditsRemaining,
    });

    return response;
  }

  /**
   * Get current credit balance
   */
  async getBalance(): Promise<number> {
    this.ensureInitialized();

    if (!this.config.licenseKey) {
      throw new Error('License key is required for credit operations');
    }

    this.logger?.debug('Getting credit balance');

    const response = await this.validateLicense(this.config.licenseKey);
    return response.creditsRemaining;
  }

  /**
   * Submit a profile crawl request to the Worker API
   * @param request Profile archive request with crawl options
   * @returns ProfileCrawlResponse with job ID and metadata
   */
  async crawlProfile(request: ProfileArchiveRequest): Promise<ProfileCrawlResponse> {
    this.ensureInitialized();

    if (!this.config.licenseKey) {
      throw new Error('License key is required for profile crawl operations');
    }

    this.logger?.debug('Submitting profile crawl request', {
      platform: request.platform,
      handle: request.handle,
      mode: request.crawlOptions.mode,
    });

    const response = await this.request<ProfileCrawlResponse>('/api/profiles/crawl', {
      method: 'POST',
      headers: {
        'X-License-Key': this.config.licenseKey,
      },
      body: JSON.stringify(request),
    });

    this.logger?.info('Profile crawl submitted', {
      jobId: response.jobId,
      estimatedPosts: response.estimatedPosts,
      subscriptionId: response.subscriptionId,
    });

    return response;
  }

  /**
   * Update license key
   */
  setLicenseKey(licenseKey: string): void {
    this.config.licenseKey = licenseKey;
    this.logger?.debug('License key updated');
  }

  /**
   * Get license key (masked)
   */
  getLicenseKey(): string | undefined {
    return this.config.licenseKey;
  }

  // Private helper methods

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('CloudflareAPI not initialized. Call initialize() first.');
    }
  }

  private async request<T>(
    path: string,
    options: Partial<RequestUrlParam> = {}
  ): Promise<T> {
    const url = `${this.config.endpoint}${path}`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < (this.config.retries ?? 1); attempt++) {
      try {
        this.logger?.debug(`API request attempt ${attempt + 1}`, { url, method: options.method });

        const response = await requestUrl({
          url,
          method: options.method ?? 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...options.headers,
          },
          body: options.body,
          throw: false,
        });

        // Log response
        this.logger?.debug('API response received', {
          url,
          status: response.status,
        });

        // Parse response
        const data: CloudflareAPIResponse<T> = response.json;

        // Handle error responses
        if (!data.success) {
          const error = new Error(data.error?.message ?? 'Unknown API error');
          (error as any).code = data.error?.code;
          (error as any).details = data.error?.details;
          (error as any).status = response.status;
          throw error;
        }

        // Return successful data
        return data.data as T;

      } catch (error) {
        lastError = error as Error;
        this.logger?.warn(`API request failed (attempt ${attempt + 1})`, {
          url,
          error: error instanceof Error ? error.message : String(error),
        });

        // Don't retry on client errors (4xx)
        if ((error as any).status >= 400 && (error as any).status < 500) {
          throw error;
        }

        // Wait before retry
        if (attempt < (this.config.retries ?? 1) - 1) {
          await this.delay(this.config.retryDelay ?? 1000);
        }
      }
    }

    // All attempts failed
    this.logger?.error('API request failed after all retries', lastError instanceof Error ? lastError : undefined, { url });
    throw lastError;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private maskLicenseKey(key: string): string {
    if (key.length <= 8) {
      return '***';
    }
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  }
}
