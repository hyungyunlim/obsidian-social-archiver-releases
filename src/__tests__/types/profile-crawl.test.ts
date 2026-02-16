import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  CRAWL_LIMITS,
  validateCrawlOptions,
  validateDateRange,
  createDefaultCrawlOptions,
  createDefaultSubscribeOptions,
  createCrawlError,
  parseCrawlError,
  CRAWL_ERROR_MESSAGES,
  RETRYABLE_ERROR_CODES,
  type ProfileCrawlOptions,
  type CrawlMode,
  type CrawlErrorCode,
} from '@/types/profile-crawl';

describe('profile-crawl types', () => {
  describe('CRAWL_LIMITS', () => {
    it('should have correct constant values', () => {
      expect(CRAWL_LIMITS.MIN_POST_COUNT).toBe(10);
      expect(CRAWL_LIMITS.MAX_POST_COUNT).toBe(100);
      expect(CRAWL_LIMITS.DEFAULT_POST_COUNT).toBe(20);
      expect(CRAWL_LIMITS.MAX_DATE_RANGE_DAYS).toBe(90);
    });
  });

  describe('validateCrawlOptions', () => {
    describe('post_count mode', () => {
      it('should validate valid post_count options', () => {
        const options: ProfileCrawlOptions = {
          mode: 'post_count',
          postCount: 50,
          timezone: 'America/New_York',
          maxPosts: 100,
        };

        const result = validateCrawlOptions(options);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should accept minimum post count', () => {
        const options: ProfileCrawlOptions = {
          mode: 'post_count',
          postCount: CRAWL_LIMITS.MIN_POST_COUNT,
          timezone: 'UTC',
          maxPosts: 100,
        };

        const result = validateCrawlOptions(options);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should accept maximum post count', () => {
        const options: ProfileCrawlOptions = {
          mode: 'post_count',
          postCount: CRAWL_LIMITS.MAX_POST_COUNT,
          timezone: 'UTC',
          maxPosts: 100,
        };

        const result = validateCrawlOptions(options);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should reject post count below minimum', () => {
        const options: ProfileCrawlOptions = {
          mode: 'post_count',
          postCount: 5, // Below 10
          timezone: 'UTC',
          maxPosts: 100,
        };

        const result = validateCrawlOptions(options);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          `Post count must be at least ${CRAWL_LIMITS.MIN_POST_COUNT}`
        );
      });

      it('should reject post count above maximum', () => {
        const options: ProfileCrawlOptions = {
          mode: 'post_count',
          postCount: 150, // Above 100
          timezone: 'UTC',
          maxPosts: 100,
        };

        const result = validateCrawlOptions(options);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          `Post count cannot exceed ${CRAWL_LIMITS.MAX_POST_COUNT}`
        );
      });

      it('should use default post count when not specified', () => {
        const options: ProfileCrawlOptions = {
          mode: 'post_count',
          // postCount not specified
          timezone: 'UTC',
          maxPosts: 100,
        };

        const result = validateCrawlOptions(options);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe('date_range mode', () => {
      it('should validate valid date_range options', () => {
        const now = new Date();
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const options: ProfileCrawlOptions = {
          mode: 'date_range',
          startDate: thirtyDaysAgo,
          endDate: now,
          timezone: 'Europe/London',
          maxPosts: 100,
        };

        const result = validateCrawlOptions(options);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should require start date for date_range mode', () => {
        const options: ProfileCrawlOptions = {
          mode: 'date_range',
          // startDate not specified
          endDate: new Date(),
          timezone: 'UTC',
          maxPosts: 100,
        };

        const result = validateCrawlOptions(options);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Start date is required for date_range mode');
      });

      it('should use current date as default end date', () => {
        const now = new Date();
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const options: ProfileCrawlOptions = {
          mode: 'date_range',
          startDate: thirtyDaysAgo,
          // endDate not specified
          timezone: 'UTC',
          maxPosts: 100,
        };

        const result = validateCrawlOptions(options);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe('mode validation', () => {
      it('should reject invalid mode', () => {
        const options = {
          mode: 'invalid_mode' as CrawlMode,
          timezone: 'UTC',
          maxPosts: 100,
        };

        const result = validateCrawlOptions(options);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          'Invalid crawl mode. Must be "post_count" or "date_range"'
        );
      });

      it('should reject missing mode', () => {
        const options = {
          mode: undefined as unknown as CrawlMode,
          timezone: 'UTC',
          maxPosts: 100,
        };

        const result = validateCrawlOptions(options);

        expect(result.valid).toBe(false);
      });
    });

    describe('timezone validation', () => {
      it('should accept valid timezone', () => {
        const options: ProfileCrawlOptions = {
          mode: 'post_count',
          postCount: 20,
          timezone: 'Asia/Tokyo',
          maxPosts: 100,
        };

        const result = validateCrawlOptions(options);

        expect(result.valid).toBe(true);
      });

      it('should reject invalid timezone', () => {
        const options: ProfileCrawlOptions = {
          mode: 'post_count',
          postCount: 20,
          timezone: 'Invalid/Timezone',
          maxPosts: 100,
        };

        const result = validateCrawlOptions(options);

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Invalid timezone'))).toBe(true);
      });

      it('should reject missing timezone', () => {
        const options = {
          mode: 'post_count',
          postCount: 20,
          timezone: '',
          maxPosts: 100,
        } as ProfileCrawlOptions;

        const result = validateCrawlOptions(options);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Timezone is required');
      });
    });

    describe('maxPosts validation', () => {
      it('should reject maxPosts above limit', () => {
        const options: ProfileCrawlOptions = {
          mode: 'post_count',
          postCount: 20,
          timezone: 'UTC',
          maxPosts: 150, // Above 100
        };

        const result = validateCrawlOptions(options);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          `Maximum posts cannot exceed ${CRAWL_LIMITS.MAX_POST_COUNT}`
        );
      });
    });
  });

  describe('validateDateRange', () => {
    let mockNow: Date;

    beforeEach(() => {
      mockNow = new Date('2024-06-15T12:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(mockNow);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should validate valid date range', () => {
      const startDate = new Date('2024-05-15T00:00:00Z');
      const endDate = new Date('2024-06-15T00:00:00Z');

      const result = validateDateRange(startDate, endDate);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject date range exceeding 90 days', () => {
      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-06-15T00:00:00Z');

      const result = validateDateRange(startDate, endDate);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        `Date range cannot exceed ${CRAWL_LIMITS.MAX_DATE_RANGE_DAYS} days`
      );
    });

    it('should reject future end date', () => {
      const startDate = new Date('2024-06-01T00:00:00Z');
      const futureDate = new Date('2024-07-01T00:00:00Z');

      const result = validateDateRange(startDate, futureDate);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('End date cannot be in the future');
    });

    it('should reject start date after end date', () => {
      const startDate = new Date('2024-06-15T00:00:00Z');
      const endDate = new Date('2024-06-01T00:00:00Z');

      const result = validateDateRange(startDate, endDate);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Start date must be before end date');
    });

    it('should allow end date up to 1 minute in the future (clock skew tolerance)', () => {
      const startDate = new Date('2024-06-01T00:00:00Z');
      const endDate = new Date('2024-06-15T12:00:30Z'); // 30 seconds in future

      const result = validateDateRange(startDate, endDate);

      expect(result.valid).toBe(true);
    });

    it('should warn about very short date range', () => {
      // Use exact same timestamp - daysDiff will be 0
      const startDate = new Date('2024-06-15T10:00:00Z');
      const endDate = new Date('2024-06-15T10:00:00Z');

      const result = validateDateRange(startDate, endDate);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Date range is less than 1 day');
    });

    it('should warn about start date more than 1 year ago', () => {
      vi.useRealTimers();
      const now = new Date();
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const twoYearsAgo = new Date(now);
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

      const endDate = new Date(twoYearsAgo);
      endDate.setDate(endDate.getDate() + 30);

      const result = validateDateRange(twoYearsAgo, endDate);

      expect(result.warnings.some(w => w.includes('more than 1 year ago'))).toBe(true);
    });

    it('should accept boundary case: exactly 90 days', () => {
      const endDate = new Date('2024-06-15T00:00:00Z');
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 90);

      const result = validateDateRange(startDate, endDate);

      expect(result.valid).toBe(true);
    });

    it('should reject boundary case: 91 days', () => {
      const endDate = new Date('2024-06-15T00:00:00Z');
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 91);

      const result = validateDateRange(startDate, endDate);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        `Date range cannot exceed ${CRAWL_LIMITS.MAX_DATE_RANGE_DAYS} days`
      );
    });
  });

  describe('createDefaultCrawlOptions', () => {
    it('should create options with default values', () => {
      const options = createDefaultCrawlOptions();

      expect(options.mode).toBe('post_count');
      expect(options.postCount).toBe(CRAWL_LIMITS.DEFAULT_POST_COUNT);
      expect(options.maxPosts).toBe(CRAWL_LIMITS.MAX_POST_COUNT);
      expect(options.timezone).toBeDefined();
    });

    it('should use provided timezone', () => {
      const options = createDefaultCrawlOptions('Europe/Paris');

      expect(options.timezone).toBe('Europe/Paris');
    });

    it('should use system timezone when not provided', () => {
      const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const options = createDefaultCrawlOptions();

      expect(options.timezone).toBe(systemTimezone);
    });
  });

  describe('createDefaultSubscribeOptions', () => {
    it('should create options with default values', () => {
      const options = createDefaultSubscribeOptions();

      expect(options.enabled).toBe(false);
      expect(options.schedule.hour).toBe(8);
      expect(options.destinationFolder).toBe('Social Archives');
      expect(options.schedule.timezone).toBeDefined();
    });

    it('should use provided timezone', () => {
      const options = createDefaultSubscribeOptions('Asia/Seoul');

      expect(options.schedule.timezone).toBe('Asia/Seoul');
    });

    it('should use provided destination folder', () => {
      const options = createDefaultSubscribeOptions(undefined, 'Custom Folder');

      expect(options.destinationFolder).toBe('Custom Folder');
    });
  });

  describe('CrawlError handling', () => {
    describe('CRAWL_ERROR_MESSAGES', () => {
      it('should have user-friendly messages for all error codes', () => {
        const errorCodes: CrawlErrorCode[] = [
          'INVALID_URL',
          'UNSUPPORTED_PLATFORM',
          'CRAWL_RANGE_EXCEEDED',
          'RATE_LIMITED',
          'BRIGHTDATA_ERROR',
          'NETWORK_ERROR',
          'AUTH_REQUIRED',
          'CREDITS_INSUFFICIENT',
          'PROFILE_NOT_FOUND',
          'PROFILE_PRIVATE',
          'SERVER_ERROR',
          'TIMEOUT',
          'UNKNOWN_ERROR',
        ];

        errorCodes.forEach(code => {
          expect(CRAWL_ERROR_MESSAGES[code]).toBeDefined();
          expect(typeof CRAWL_ERROR_MESSAGES[code]).toBe('string');
          expect(CRAWL_ERROR_MESSAGES[code].length).toBeGreaterThan(0);
        });
      });
    });

    describe('RETRYABLE_ERROR_CODES', () => {
      it('should include network and server errors', () => {
        expect(RETRYABLE_ERROR_CODES).toContain('RATE_LIMITED');
        expect(RETRYABLE_ERROR_CODES).toContain('BRIGHTDATA_ERROR');
        expect(RETRYABLE_ERROR_CODES).toContain('NETWORK_ERROR');
        expect(RETRYABLE_ERROR_CODES).toContain('SERVER_ERROR');
        expect(RETRYABLE_ERROR_CODES).toContain('TIMEOUT');
      });

      it('should not include user errors', () => {
        expect(RETRYABLE_ERROR_CODES).not.toContain('INVALID_URL');
        expect(RETRYABLE_ERROR_CODES).not.toContain('AUTH_REQUIRED');
        expect(RETRYABLE_ERROR_CODES).not.toContain('PROFILE_PRIVATE');
      });
    });

    describe('createCrawlError', () => {
      it('should create error with correct code and message', () => {
        const error = createCrawlError('RATE_LIMITED');

        expect(error.code).toBe('RATE_LIMITED');
        expect(error.message).toBe(CRAWL_ERROR_MESSAGES['RATE_LIMITED']);
        expect(error.retryable).toBe(true);
      });

      it('should include details when provided', () => {
        const error = createCrawlError('NETWORK_ERROR', 'Connection refused');

        expect(error.details).toBe('Connection refused');
      });

      it('should mark non-retryable errors correctly', () => {
        const error = createCrawlError('AUTH_REQUIRED');

        expect(error.retryable).toBe(false);
      });

      it('should mark retryable errors correctly', () => {
        const error = createCrawlError('TIMEOUT');

        expect(error.retryable).toBe(true);
      });
    });

    describe('parseCrawlError', () => {
      it('should parse rate limit errors', () => {
        const error = new Error('Rate limit exceeded (429)');
        const result = parseCrawlError(error);

        expect(result.code).toBe('RATE_LIMITED');
        expect(result.retryable).toBe(true);
      });

      it('should parse network errors', () => {
        const error = new Error('Network request failed');
        const result = parseCrawlError(error);

        expect(result.code).toBe('NETWORK_ERROR');
        expect(result.retryable).toBe(true);
      });

      it('should parse timeout errors', () => {
        const error = new Error('Request timed out');
        const result = parseCrawlError(error);

        expect(result.code).toBe('TIMEOUT');
        expect(result.retryable).toBe(true);
      });

      it('should parse auth errors', () => {
        const error = new Error('Unauthorized (401)');
        const result = parseCrawlError(error);

        expect(result.code).toBe('AUTH_REQUIRED');
        expect(result.retryable).toBe(false);
      });

      it('should parse credit errors', () => {
        const error = new Error('Insufficient credits');
        const result = parseCrawlError(error);

        expect(result.code).toBe('CREDITS_INSUFFICIENT');
        expect(result.retryable).toBe(false);
      });

      it('should parse not found errors', () => {
        const error = new Error('Profile not found (404)');
        const result = parseCrawlError(error);

        expect(result.code).toBe('PROFILE_NOT_FOUND');
        expect(result.retryable).toBe(false);
      });

      it('should parse private profile errors', () => {
        const error = new Error('Profile is private (403)');
        const result = parseCrawlError(error);

        expect(result.code).toBe('PROFILE_PRIVATE');
        expect(result.retryable).toBe(false);
      });

      it('should parse server errors', () => {
        const error = new Error('Internal server error (500)');
        const result = parseCrawlError(error);

        expect(result.code).toBe('SERVER_ERROR');
        expect(result.retryable).toBe(true);
      });

      it('should parse BrightData errors', () => {
        const error = new Error('BrightData scraping failed');
        const result = parseCrawlError(error);

        expect(result.code).toBe('BRIGHTDATA_ERROR');
        expect(result.retryable).toBe(true);
      });

      it('should handle API response objects with code', () => {
        const errorObj = {
          code: 'RATE_LIMITED',
          message: 'Too many requests',
        };
        const result = parseCrawlError(errorObj);

        expect(result.code).toBe('RATE_LIMITED');
        expect(result.details).toBe('Too many requests');
      });

      it('should return UNKNOWN_ERROR for unrecognized errors', () => {
        const error = new Error('Something completely unexpected');
        const result = parseCrawlError(error);

        expect(result.code).toBe('UNKNOWN_ERROR');
        expect(result.details).toBe('Something completely unexpected');
      });

      it('should handle non-Error objects', () => {
        const result = parseCrawlError('string error');

        expect(result.code).toBe('UNKNOWN_ERROR');
        expect(result.details).toBe('string error');
      });

      it('should handle null/undefined', () => {
        const result = parseCrawlError(null);

        expect(result.code).toBe('UNKNOWN_ERROR');
      });
    });
  });
});
