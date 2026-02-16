/**
 * Tests for GumroadClient
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GumroadClient, GumroadClientConfig } from '../../services/GumroadClient';
import { LicenseErrorCode } from '../../types/license';
import { Logger } from '../../services/Logger';

// Mock fetch
global.fetch = vi.fn();

describe('GumroadClient', () => {
  let config: GumroadClientConfig;
  let logger: Logger;
  let client: GumroadClient;

  beforeEach(() => {
    config = {
      productPermalink: 'social-archiver',
      timeout: 5000,
      maxRetries: 2,
    };

    logger = new Logger({ level: 'error' });
    client = new GumroadClient(config, logger);

    vi.clearAllMocks();
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await expect(client.initialize()).resolves.toBeUndefined();
    });

    it('should throw error if product permalink is missing', async () => {
      const invalidClient = new GumroadClient({ productPermalink: '' }, logger);

      await expect(invalidClient.initialize()).rejects.toThrow('Product permalink is required');
    });

    it('should not initialize twice', async () => {
      await client.initialize();
      const warnSpy = vi.spyOn(logger, 'warn');

      await client.initialize();

      expect(warnSpy).toHaveBeenCalledWith('GumroadClient already initialized');
    });
  });

  describe('verifyLicense', () => {
    beforeEach(async () => {
      await client.initialize();
    });

    it('should verify valid license successfully', async () => {
      const mockResponse = {
        success: true,
        uses: 1,
        purchase: {
          seller_id: 'seller123',
          product_id: 'prod123',
          product_name: 'Social Archiver Pro',
          permalink: 'social-archiver',
          product_permalink: 'social-archiver',
          email: 'user@example.com',
          price: 1999,
          gumroad_fee: 199,
          currency: 'USD',
          quantity: 1,
          discover_fee_charged: false,
          can_contact: true,
          referrer: '',
          order_number: 12345,
          sale_id: 'sale123',
          sale_timestamp: '2024-01-15T10:00:00Z',
          license_key: 'ABC123-DEF456-GHI789',
          ip_country: 'US',
          refunded: false,
          disputed: false,
          dispute_won: false,
          chargebacked: false,
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.verifyLicense('ABC123-DEF456-GHI789');

      expect(result.valid).toBe(true);
      expect(result.license).toBeDefined();
      expect(result.license?.email).toBe('user@example.com');
      expect(result.license?.productId).toBe('prod123');
      expect(result.license?.isActive).toBe(true);
    });

    it('should handle refunded license', async () => {
      const mockResponse = {
        success: true,
        uses: 1,
        purchase: {
          seller_id: 'seller123',
          product_id: 'prod123',
          product_name: 'Social Archiver Pro',
          permalink: 'social-archiver',
          product_permalink: 'social-archiver',
          email: 'user@example.com',
          price: 1999,
          gumroad_fee: 199,
          currency: 'USD',
          quantity: 1,
          discover_fee_charged: false,
          can_contact: true,
          referrer: '',
          order_number: 12345,
          sale_id: 'sale123',
          sale_timestamp: '2024-01-15T10:00:00Z',
          license_key: 'REFUNDED-KEY',
          ip_country: 'US',
          refunded: true,
          disputed: false,
          dispute_won: false,
          chargebacked: false,
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.verifyLicense('REFUNDED-KEY');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(LicenseErrorCode.INVALID_KEY);
    });

    it('should handle disputed license', async () => {
      const mockResponse = {
        success: true,
        uses: 1,
        purchase: {
          seller_id: 'seller123',
          product_id: 'prod123',
          product_name: 'Social Archiver Pro',
          permalink: 'social-archiver',
          product_permalink: 'social-archiver',
          email: 'user@example.com',
          price: 1999,
          gumroad_fee: 199,
          currency: 'USD',
          quantity: 1,
          discover_fee_charged: false,
          can_contact: true,
          referrer: '',
          order_number: 12345,
          sale_id: 'sale123',
          sale_timestamp: '2024-01-15T10:00:00Z',
          license_key: 'DISPUTED-KEY',
          ip_country: 'US',
          refunded: false,
          disputed: true,
          dispute_won: false,
          chargebacked: false,
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.verifyLicense('DISPUTED-KEY');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(LicenseErrorCode.INVALID_KEY);
    });

    it('should handle invalid license key', async () => {
      const mockResponse = {
        success: false,
        message: 'Invalid license key',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.verifyLicense('INVALID-KEY');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid license key');
      expect(result.errorCode).toBe(LicenseErrorCode.INVALID_KEY);
    });

    it('should handle network errors', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const result = await client.verifyLicense('SOME-KEY');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(LicenseErrorCode.NETWORK_ERROR);
    });

    it('should retry on failure', async () => {
      // First two calls fail, third succeeds
      (global.fetch as any)
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            uses: 1,
            purchase: {
              seller_id: 'seller123',
              product_id: 'prod123',
              product_name: 'Social Archiver Pro',
              permalink: 'social-archiver',
              product_permalink: 'social-archiver',
              email: 'user@example.com',
              price: 1999,
              gumroad_fee: 199,
              currency: 'USD',
              quantity: 1,
              discover_fee_charged: false,
              can_contact: true,
              referrer: '',
              order_number: 12345,
              sale_id: 'sale123',
              sale_timestamp: '2024-01-15T10:00:00Z',
              license_key: 'RETRY-KEY',
              ip_country: 'US',
              refunded: false,
              disputed: false,
              dispute_won: false,
              chargebacked: false,
            },
          }),
        });

      const result = await client.verifyLicense('RETRY-KEY');

      expect(result.valid).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('should handle expired subscription', async () => {
      const mockResponse = {
        success: true,
        uses: 1,
        purchase: {
          seller_id: 'seller123',
          product_id: 'prod123',
          product_name: 'Social Archiver Pro',
          permalink: 'social-archiver',
          product_permalink: 'social-archiver',
          email: 'user@example.com',
          price: 1999,
          gumroad_fee: 199,
          currency: 'USD',
          quantity: 1,
          discover_fee_charged: false,
          can_contact: true,
          referrer: '',
          order_number: 12345,
          sale_id: 'sale123',
          sale_timestamp: '2024-01-15T10:00:00Z',
          license_key: 'EXPIRED-KEY',
          ip_country: 'US',
          refunded: false,
          disputed: false,
          dispute_won: false,
          chargebacked: false,
          subscription_id: 'sub123',
          subscription_ended_at: '2024-01-01T00:00:00Z', // Expired
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.verifyLicense('EXPIRED-KEY');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(LicenseErrorCode.EXPIRED);
    });
  });

  describe('testConnection', () => {
    beforeEach(async () => {
      await client.initialize();
    });

    it('should return true on successful connection', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: false, message: 'Invalid key' }),
      });

      const result = await client.testConnection();
      expect(result).toBe(true);
    });

    it('should return false on connection failure', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      const result = await client.testConnection();
      expect(result).toBe(false);
    });
  });

  describe('getLicenseConfig', () => {
    it('should return license configuration', () => {
      const licenseConfig = client.getLicenseConfig();

      expect(licenseConfig).toBeDefined();
      expect(licenseConfig.maxDevices).toBe(5);
      expect(licenseConfig.gracePeriodDays).toBe(3);
    });
  });

  describe('updateLicenseConfig', () => {
    it('should update license configuration', () => {
      client.updateLicenseConfig({
        maxDevices: 10,
        gracePeriodDays: 7,
      });

      const config = client.getLicenseConfig();
      expect(config.maxDevices).toBe(10);
      expect(config.gracePeriodDays).toBe(7);
    });
  });
});
