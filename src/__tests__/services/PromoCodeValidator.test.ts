/**
 * PromoCodeValidator tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PromoCodeValidator } from '../../services/licensing/PromoCodeValidator';
import {
  PromoCodeType,
  PromoCodeErrorCode,
  PromoCodeInfo,
} from '../../types/license';
import { Logger } from '../../services/Logger';

describe('PromoCodeValidator', () => {
  let validator: PromoCodeValidator;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    validator = new PromoCodeValidator(
      {
        productPermalink: 'test-product',
      },
      mockLogger
    );
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await validator.initialize();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Initializing PromoCodeValidator',
        expect.any(Object)
      );
    });

    it('should throw error if product permalink is missing', async () => {
      const invalidValidator = new PromoCodeValidator({
        productPermalink: '',
      });

      await expect(invalidValidator.initialize()).rejects.toThrow(
        'Product permalink is required'
      );
    });

    it('should prevent double initialization', async () => {
      await validator.initialize();
      await validator.initialize();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'PromoCodeValidator already initialized'
      );
    });
  });

  describe('special promo codes', () => {
    beforeEach(async () => {
      await validator.initialize();
    });

    it('should validate LAUNCH50 bonus credits code', async () => {
      const result = await validator.validatePromoCode('LAUNCH50');

      expect(result.valid).toBe(true);
      expect(result.promoCode).toBeDefined();
      expect(result.promoCode?.type).toBe(PromoCodeType.BONUS_CREDITS);
      expect(result.promoCode?.bonusCredits).toBe(50);
    });

    it('should validate PARTNER30 extended trial code', async () => {
      const result = await validator.validatePromoCode('PARTNER30');

      expect(result.valid).toBe(true);
      expect(result.promoCode).toBeDefined();
      expect(result.promoCode?.type).toBe(PromoCodeType.EXTENDED_TRIAL);
      expect(result.promoCode?.extendedDays).toBe(30);
      expect(result.promoCode?.partnerId).toBe('partner-001');
    });

    it('should be case-insensitive', async () => {
      const upperResult = await validator.validatePromoCode('LAUNCH50');
      const lowerResult = await validator.validatePromoCode('launch50');
      const mixedResult = await validator.validatePromoCode('Launch50');

      expect(upperResult.valid).toBe(true);
      expect(lowerResult.valid).toBe(true);
      expect(mixedResult.valid).toBe(true);
    });

    it('should reject invalid special codes', async () => {
      const result = await validator.validatePromoCode('INVALID_CODE');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(PromoCodeErrorCode.INVALID_CODE);
    });
  });

  describe('custom promo codes', () => {
    beforeEach(async () => {
      await validator.initialize();
    });

    it('should register and validate custom promo codes', async () => {
      const customCode: PromoCodeInfo = {
        code: 'CUSTOM100',
        type: PromoCodeType.BONUS_CREDITS,
        bonusCredits: 100,
        validFrom: new Date('2024-01-01'),
        validUntil: new Date('2024-12-31'),
        maxUses: 50,
        usesCount: 0,
        isActive: true,
        description: 'Custom 100 credits',
      };

      validator.registerSpecialCode(customCode);

      const result = await validator.validatePromoCode('CUSTOM100');

      expect(result.valid).toBe(true);
      expect(result.promoCode?.bonusCredits).toBe(100);
    });

    it('should reject inactive promo codes', async () => {
      const inactiveCode: PromoCodeInfo = {
        code: 'INACTIVE',
        type: PromoCodeType.BONUS_CREDITS,
        bonusCredits: 50,
        validFrom: new Date('2024-01-01'),
        validUntil: new Date('2024-12-31'),
        maxUses: null,
        usesCount: 0,
        isActive: false,
      };

      validator.registerSpecialCode(inactiveCode);

      const result = await validator.validatePromoCode('INACTIVE');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(PromoCodeErrorCode.INACTIVE);
    });

    it('should reject expired promo codes', async () => {
      const expiredCode: PromoCodeInfo = {
        code: 'EXPIRED',
        type: PromoCodeType.BONUS_CREDITS,
        bonusCredits: 50,
        validFrom: new Date('2023-01-01'),
        validUntil: new Date('2023-12-31'),
        maxUses: null,
        usesCount: 0,
        isActive: true,
      };

      validator.registerSpecialCode(expiredCode);

      const result = await validator.validatePromoCode('EXPIRED');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(PromoCodeErrorCode.EXPIRED);
    });

    it('should reject not-yet-active promo codes', async () => {
      const futureCode: PromoCodeInfo = {
        code: 'FUTURE',
        type: PromoCodeType.BONUS_CREDITS,
        bonusCredits: 50,
        validFrom: new Date('2099-01-01'),
        validUntil: new Date('2099-12-31'),
        maxUses: null,
        usesCount: 0,
        isActive: true,
      };

      validator.registerSpecialCode(futureCode);

      const result = await validator.validatePromoCode('FUTURE');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(PromoCodeErrorCode.NOT_YET_ACTIVE);
    });

    it('should reject codes that exceeded max uses', async () => {
      const limitedCode: PromoCodeInfo = {
        code: 'LIMITED',
        type: PromoCodeType.BONUS_CREDITS,
        bonusCredits: 50,
        validFrom: new Date('2024-01-01'),
        validUntil: new Date('2024-12-31'),
        maxUses: 10,
        usesCount: 10,
        isActive: true,
      };

      validator.registerSpecialCode(limitedCode);

      const result = await validator.validatePromoCode('LIMITED');

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(PromoCodeErrorCode.MAX_USES_REACHED);
    });
  });

  describe('promo code application', () => {
    beforeEach(async () => {
      await validator.initialize();
    });

    it('should apply valid promo code', async () => {
      const appliedCode = await validator.applyPromoCode(
        'LAUNCH50',
        'test-license-key',
        'test@example.com'
      );

      expect(appliedCode.code).toBe('LAUNCH50');
      expect(appliedCode.licenseKey).toBe('test-license-key');
      expect(appliedCode.email).toBe('test@example.com');
      expect(appliedCode.benefit.type).toBe(PromoCodeType.BONUS_CREDITS);
      expect(appliedCode.benefit.amount).toBe(50);
      expect(appliedCode.appliedAt).toBeInstanceOf(Date);
    });

    it('should reject already applied promo code', async () => {
      // Apply once
      await validator.applyPromoCode(
        'LAUNCH50',
        'test-license-key',
        'test@example.com'
      );

      // Try to apply again
      await expect(
        validator.applyPromoCode(
          'LAUNCH50',
          'test-license-key',
          'test@example.com'
        )
      ).rejects.toThrow('already been used');
    });

    it('should allow same code on different licenses', async () => {
      // Apply to first license
      const first = await validator.applyPromoCode(
        'LAUNCH50',
        'license-1',
        'user1@example.com'
      );

      // Apply to second license
      const second = await validator.applyPromoCode(
        'LAUNCH50',
        'license-2',
        'user2@example.com'
      );

      expect(first.licenseKey).toBe('license-1');
      expect(second.licenseKey).toBe('license-2');
    });

    it('should increment use count on application', async () => {
      const testCode: PromoCodeInfo = {
        code: 'TESTCOUNT',
        type: PromoCodeType.BONUS_CREDITS,
        bonusCredits: 10,
        validFrom: new Date('2024-01-01'),
        validUntil: new Date('2024-12-31'),
        maxUses: 100,
        usesCount: 0,
        isActive: true,
      };

      validator.registerSpecialCode(testCode);

      // Apply the code
      await validator.applyPromoCode(
        'TESTCOUNT',
        'test-license',
        'test@example.com'
      );

      // Validate again - use count should have increased
      const result = await validator.validatePromoCode('TESTCOUNT');
      expect(result.promoCode?.usesCount).toBe(1);
    });
  });

  describe('analytics', () => {
    beforeEach(async () => {
      await validator.initialize();
    });

    it('should track promo code usage', async () => {
      await validator.validatePromoCode('LAUNCH50');

      const analytics = validator.getAnalytics('LAUNCH50');
      expect(analytics).toBeDefined();
      expect((analytics as any).totalUses).toBeGreaterThan(0);
    });

    it('should track conversions', async () => {
      await validator.applyPromoCode(
        'LAUNCH50',
        'test-license',
        'test@example.com'
      );

      const analytics = validator.getAnalytics('LAUNCH50');
      expect((analytics as any).conversions).toBe(1);
    });

    it('should return all analytics', () => {
      const allAnalytics = validator.getAnalytics();
      expect(allAnalytics).toBeInstanceOf(Map);
    });
  });

  describe('code management', () => {
    beforeEach(async () => {
      await validator.initialize();
    });

    it('should check if code is applied', () => {
      expect(validator.isCodeApplied('LAUNCH50', 'test-license')).toBe(false);
    });

    it('should get applied codes for license', () => {
      const codes = validator.getAppliedCodes('test-license');
      expect(codes).toBeInstanceOf(Array);
      expect(codes.length).toBe(0);
    });

    it('should remove special code', () => {
      validator.removeSpecialCode('LAUNCH50');

      // Code should no longer validate
      expect(
        validator.validatePromoCode('LAUNCH50')
      ).resolves.toMatchObject({
        valid: false,
        errorCode: PromoCodeErrorCode.INVALID_CODE,
      });
    });
  });

  describe('shutdown', () => {
    it('should clean up on shutdown', async () => {
      await validator.initialize();
      await validator.shutdown();

      // Should throw error when trying to use after shutdown
      expect(() => validator.isCodeApplied('TEST', 'license')).toThrow(
        'not initialized'
      );
    });
  });
});
