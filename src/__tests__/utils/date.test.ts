import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatDate,
  formatDateForBrightData,
  detectUserTimezone,
  isValidTimezone,
  localDateToUTC,
  getDateDaysAgo,
  validateDateRange,
  parseDateString,
  formatDateToYYYYMMDD,
  DEFAULT_MAX_DATE_RANGE_DAYS,
} from '@/utils/date';

describe('date utilities', () => {
  describe('formatDate', () => {
    it('should format date to ISO string', () => {
      const date = new Date('2024-03-15T10:30:00Z');
      expect(formatDate(date)).toBe('2024-03-15T10:30:00.000Z');
    });
  });

  describe('formatDateForBrightData', () => {
    it('should format date to MM-DD-YYYY format', () => {
      const date = new Date('2024-03-15T00:00:00Z');
      expect(formatDateForBrightData(date)).toBe('03-15-2024');
    });

    it('should pad single-digit months and days', () => {
      const date = new Date('2024-01-05T00:00:00Z');
      expect(formatDateForBrightData(date)).toBe('01-05-2024');
    });

    it('should handle December correctly', () => {
      const date = new Date('2024-12-25T00:00:00Z');
      expect(formatDateForBrightData(date)).toBe('12-25-2024');
    });

    it('should use UTC date components', () => {
      // This date in UTC is Dec 31, but could be Jan 1 in some timezones
      const date = new Date('2024-12-31T23:59:59Z');
      expect(formatDateForBrightData(date)).toBe('12-31-2024');
    });
  });

  describe('detectUserTimezone', () => {
    it('should return a valid IANA timezone string', () => {
      const timezone = detectUserTimezone();
      expect(typeof timezone).toBe('string');
      expect(timezone.length).toBeGreaterThan(0);
      // Should be valid timezone
      expect(isValidTimezone(timezone)).toBe(true);
    });
  });

  describe('isValidTimezone', () => {
    it('should return true for valid IANA timezones', () => {
      expect(isValidTimezone('UTC')).toBe(true);
      expect(isValidTimezone('America/New_York')).toBe(true);
      expect(isValidTimezone('America/Los_Angeles')).toBe(true);
      expect(isValidTimezone('Europe/London')).toBe(true);
      expect(isValidTimezone('Asia/Tokyo')).toBe(true);
      expect(isValidTimezone('Asia/Seoul')).toBe(true);
    });

    it('should return false for invalid timezones', () => {
      expect(isValidTimezone('')).toBe(false);
      expect(isValidTimezone('Invalid/Timezone')).toBe(false);
      expect(isValidTimezone('NotA/RealTimezone')).toBe(false);
      // Note: Some JS engines accept abbreviations like 'PST', 'EST' as valid
      // So we don't test those explicitly
    });
  });

  describe('localDateToUTC', () => {
    it('should convert local date to UTC for UTC timezone', () => {
      const localDate = new Date(2024, 2, 15); // March 15, 2024 local
      const utcDate = localDateToUTC(localDate, 'UTC');

      expect(utcDate.getUTCFullYear()).toBe(2024);
      expect(utcDate.getUTCMonth()).toBe(2); // March (0-indexed)
      expect(utcDate.getUTCDate()).toBe(15);
    });

    it('should handle invalid timezone gracefully', () => {
      const localDate = new Date(2024, 2, 15);
      const utcDate = localDateToUTC(localDate, 'Invalid/Timezone');

      // Should return a copy of the original date
      expect(utcDate).not.toBe(localDate);
      expect(utcDate.getTime()).toBe(localDate.getTime());
    });

    it('should handle various valid timezones', () => {
      const localDate = new Date(2024, 2, 15);

      // These should not throw
      expect(() => localDateToUTC(localDate, 'America/New_York')).not.toThrow();
      expect(() => localDateToUTC(localDate, 'Asia/Tokyo')).not.toThrow();
      expect(() => localDateToUTC(localDate, 'Europe/Paris')).not.toThrow();
    });
  });

  describe('getDateDaysAgo', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return today when days is 0', () => {
      const result = getDateDaysAgo(0, 'UTC');

      expect(result.getUTCFullYear()).toBe(2024);
      expect(result.getUTCMonth()).toBe(5); // June (0-indexed)
      expect(result.getUTCDate()).toBe(15);
    });

    it('should return correct date for 30 days ago', () => {
      const result = getDateDaysAgo(30, 'UTC');

      expect(result.getUTCFullYear()).toBe(2024);
      expect(result.getUTCMonth()).toBe(4); // May (0-indexed)
      expect(result.getUTCDate()).toBe(16);
    });

    it('should return correct date for 90 days ago', () => {
      const result = getDateDaysAgo(90, 'UTC');

      expect(result.getUTCFullYear()).toBe(2024);
      expect(result.getUTCMonth()).toBe(2); // March (0-indexed)
      expect(result.getUTCDate()).toBe(17);
    });

    it('should handle invalid timezone by falling back to UTC', () => {
      const result = getDateDaysAgo(30, 'Invalid/Timezone');

      // Should not throw and return a valid date
      expect(result).toBeInstanceOf(Date);
      expect(result.getUTCMonth()).toBe(4); // May
    });

    it('should handle year boundary correctly', () => {
      // Set time to January 15, 2024
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

      const result = getDateDaysAgo(30, 'UTC');

      expect(result.getUTCFullYear()).toBe(2023);
      expect(result.getUTCMonth()).toBe(11); // December (0-indexed)
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

    it('should validate a valid date range', () => {
      const startDate = new Date('2024-05-15T00:00:00Z');
      const endDate = new Date('2024-06-15T00:00:00Z');

      const result = validateDateRange(startDate, endDate);

      expect(result.valid).toBe(true);
      expect(result.dayCount).toBe(31);
      expect(result.error).toBeUndefined();
    });

    it('should reject date range exceeding max days', () => {
      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-06-15T00:00:00Z');

      const result = validateDateRange(startDate, endDate);

      expect(result.valid).toBe(false);
      expect(result.error).toContain(`${DEFAULT_MAX_DATE_RANGE_DAYS} days`);
    });

    it('should accept custom max days', () => {
      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-06-15T00:00:00Z');

      const result = validateDateRange(startDate, endDate, 365);

      expect(result.valid).toBe(true);
    });

    it('should reject future end date', () => {
      const startDate = new Date('2024-06-01T00:00:00Z');
      const futureDate = new Date('2024-07-01T00:00:00Z');

      const result = validateDateRange(startDate, futureDate);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('End date cannot be in the future');
    });

    it('should allow end date up to 1 minute in the future (clock skew)', () => {
      const startDate = new Date('2024-06-01T00:00:00Z');
      const endDate = new Date('2024-06-15T12:00:30Z'); // 30 seconds in future

      const result = validateDateRange(startDate, endDate);

      expect(result.valid).toBe(true);
    });

    it('should reject start date after end date', () => {
      const startDate = new Date('2024-06-15T00:00:00Z');
      const endDate = new Date('2024-06-01T00:00:00Z');

      const result = validateDateRange(startDate, endDate);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Start date must be before end date');
    });

    it('should warn about very short date range', () => {
      const startDate = new Date('2024-06-15T00:00:00Z');
      const endDate = new Date('2024-06-15T00:00:00Z'); // Same day

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

      expect(result.valid).toBe(true);
      expect(result.warnings?.some(w => w.includes('more than 1 year ago'))).toBe(true);
    });

    it('should accept boundary case: exactly 90 days', () => {
      const endDate = new Date('2024-06-15T00:00:00Z');
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 90);

      const result = validateDateRange(startDate, endDate);

      expect(result.valid).toBe(true);
      expect(result.dayCount).toBe(90);
    });

    it('should reject boundary case: 91 days', () => {
      const endDate = new Date('2024-06-15T00:00:00Z');
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 91);

      const result = validateDateRange(startDate, endDate);

      expect(result.valid).toBe(false);
    });
  });

  describe('parseDateString', () => {
    it('should parse valid YYYY-MM-DD date string', () => {
      const result = parseDateString('2024-03-15');

      expect(result).not.toBeNull();
      expect(result!.getUTCFullYear()).toBe(2024);
      expect(result!.getUTCMonth()).toBe(2); // March (0-indexed)
      expect(result!.getUTCDate()).toBe(15);
    });

    it('should return null for invalid format', () => {
      expect(parseDateString('03-15-2024')).toBeNull(); // MM-DD-YYYY
      expect(parseDateString('2024/03/15')).toBeNull(); // Wrong separator
      expect(parseDateString('2024-3-15')).toBeNull(); // Missing padding
      expect(parseDateString('2024-03-15T00:00:00Z')).toBeNull(); // ISO format
    });

    it('should return null for invalid dates', () => {
      expect(parseDateString('2024-02-30')).toBeNull(); // Feb 30 doesn't exist
      expect(parseDateString('2024-13-01')).toBeNull(); // Month 13
      expect(parseDateString('2024-00-15')).toBeNull(); // Month 0
      expect(parseDateString('2024-03-32')).toBeNull(); // Day 32
      expect(parseDateString('2024-03-00')).toBeNull(); // Day 0
    });

    it('should return null for empty or invalid input', () => {
      expect(parseDateString('')).toBeNull();
      expect(parseDateString(null as unknown as string)).toBeNull();
      expect(parseDateString(undefined as unknown as string)).toBeNull();
    });

    it('should return null for out of range years', () => {
      expect(parseDateString('1800-03-15')).toBeNull();
      expect(parseDateString('2200-03-15')).toBeNull();
    });

    it('should handle February 29 on leap years', () => {
      expect(parseDateString('2024-02-29')).not.toBeNull(); // 2024 is leap year
      expect(parseDateString('2023-02-29')).toBeNull(); // 2023 is not leap year
    });
  });

  describe('formatDateToYYYYMMDD', () => {
    it('should format date to YYYY-MM-DD', () => {
      const date = new Date('2024-03-15T10:30:00Z');
      expect(formatDateToYYYYMMDD(date)).toBe('2024-03-15');
    });

    it('should pad single-digit months and days', () => {
      const date = new Date('2024-01-05T00:00:00Z');
      expect(formatDateToYYYYMMDD(date)).toBe('2024-01-05');
    });

    it('should use UTC components', () => {
      // This date in UTC is Dec 31
      const date = new Date('2024-12-31T23:59:59Z');
      expect(formatDateToYYYYMMDD(date)).toBe('2024-12-31');
    });
  });
});
