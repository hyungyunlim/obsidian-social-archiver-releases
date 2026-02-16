/**
 * formatNumber Utility Tests
 *
 * Comprehensive tests for number formatting utilities
 */

import { describe, it, expect } from 'vitest';
import {
  formatNumber,
  formatNumberWithCommas,
  formatCountWithTooltip,
} from '../../utils/formatNumber';

describe('formatNumber', () => {
  describe('null and undefined handling', () => {
    it('should return "—" for null', () => {
      expect(formatNumber(null)).toBe('—');
    });

    it('should return "—" for undefined', () => {
      expect(formatNumber(undefined)).toBe('—');
    });
  });

  describe('zero and small numbers', () => {
    it('should return "0" for zero', () => {
      expect(formatNumber(0)).toBe('0');
    });

    it('should return number as-is for values under 1000', () => {
      expect(formatNumber(1)).toBe('1');
      expect(formatNumber(42)).toBe('42');
      expect(formatNumber(999)).toBe('999');
    });

    it('should handle single digit numbers', () => {
      expect(formatNumber(5)).toBe('5');
      expect(formatNumber(9)).toBe('9');
    });
  });

  describe('thousands (K)', () => {
    it('should format 1000 as "1K" (no decimal)', () => {
      expect(formatNumber(1000)).toBe('1K');
    });

    it('should format 1001 with decimal', () => {
      expect(formatNumber(1001)).toBe('1K');
    });

    it('should format 1234 as "1.2K"', () => {
      expect(formatNumber(1234)).toBe('1.2K');
    });

    it('should format 1500 as "1.5K"', () => {
      expect(formatNumber(1500)).toBe('1.5K');
    });

    it('should format 9999 as "10K"', () => {
      expect(formatNumber(9999)).toBe('10K');
    });

    it('should format 23100 as "23.1K"', () => {
      expect(formatNumber(23100)).toBe('23.1K');
    });

    it('should format 999999 as "1000K" (edge case before M)', () => {
      expect(formatNumber(999999)).toBe('1000K');
    });

    it('should remove trailing zeros', () => {
      expect(formatNumber(2000)).toBe('2K');
      expect(formatNumber(5000)).toBe('5K');
      expect(formatNumber(10000)).toBe('10K');
    });
  });

  describe('millions (M)', () => {
    it('should format 1_000_000 as "1M"', () => {
      expect(formatNumber(1_000_000)).toBe('1M');
    });

    it('should format 1_234_567 as "1.2M"', () => {
      expect(formatNumber(1_234_567)).toBe('1.2M');
    });

    it('should format 3_500_000 as "3.5M"', () => {
      expect(formatNumber(3_500_000)).toBe('3.5M');
    });

    it('should format 9_999_999 as "10M"', () => {
      expect(formatNumber(9_999_999)).toBe('10M');
    });

    it('should format 50_000_000 as "50M"', () => {
      expect(formatNumber(50_000_000)).toBe('50M');
    });

    it('should format 123_456_789 as "123.5M"', () => {
      expect(formatNumber(123_456_789)).toBe('123.5M');
    });
  });

  describe('billions (B)', () => {
    it('should format 1_000_000_000 as "1B"', () => {
      expect(formatNumber(1_000_000_000)).toBe('1B');
    });

    it('should format 1_234_567_890 as "1.2B"', () => {
      expect(formatNumber(1_234_567_890)).toBe('1.2B');
    });

    it('should format 2_500_000_000 as "2.5B"', () => {
      expect(formatNumber(2_500_000_000)).toBe('2.5B');
    });

    it('should handle very large numbers', () => {
      expect(formatNumber(10_000_000_000)).toBe('10B');
      expect(formatNumber(100_000_000_000)).toBe('100B');
    });
  });

  describe('negative numbers', () => {
    it('should handle negative small numbers', () => {
      expect(formatNumber(-42)).toBe('-42');
      expect(formatNumber(-999)).toBe('-999');
    });

    it('should handle negative thousands', () => {
      expect(formatNumber(-1234)).toBe('-1.2K');
      expect(formatNumber(-5000)).toBe('-5K');
    });

    it('should handle negative millions', () => {
      expect(formatNumber(-1_234_567)).toBe('-1.2M');
    });

    it('should handle negative billions', () => {
      expect(formatNumber(-1_234_567_890)).toBe('-1.2B');
    });
  });

  describe('precision parameter', () => {
    it('should use precision 0 for no decimals', () => {
      expect(formatNumber(1234, 0)).toBe('1K');
      expect(formatNumber(1567, 0)).toBe('2K');
      expect(formatNumber(1_234_567, 0)).toBe('1M');
    });

    it('should use precision 2 for more decimals', () => {
      expect(formatNumber(1234, 2)).toBe('1.23K');
      expect(formatNumber(1_234_567, 2)).toBe('1.23M');
    });

    it('should use precision 3', () => {
      expect(formatNumber(1234, 3)).toBe('1.234K');
    });

    it('should still remove trailing zeros with higher precision', () => {
      expect(formatNumber(1000, 2)).toBe('1K');
      expect(formatNumber(1_000_000, 3)).toBe('1M');
    });
  });

  describe('real-world social media scenarios', () => {
    it('should format typical follower counts', () => {
      expect(formatNumber(523)).toBe('523'); // Small account
      expect(formatNumber(2_345)).toBe('2.3K'); // Growing account
      expect(formatNumber(15_600)).toBe('15.6K'); // Popular account
      expect(formatNumber(234_567)).toBe('234.6K'); // Influencer
      expect(formatNumber(1_500_000)).toBe('1.5M'); // Celebrity
      expect(formatNumber(45_000_000)).toBe('45M'); // Major celebrity
    });

    it('should format typical post counts', () => {
      expect(formatNumber(26)).toBe('26');
      expect(formatNumber(156)).toBe('156');
      expect(formatNumber(1_234)).toBe('1.2K');
      expect(formatNumber(5_678)).toBe('5.7K');
    });
  });
});

describe('formatNumberWithCommas', () => {
  describe('null and undefined handling', () => {
    it('should return "—" for null', () => {
      expect(formatNumberWithCommas(null)).toBe('—');
    });

    it('should return "—" for undefined', () => {
      expect(formatNumberWithCommas(undefined)).toBe('—');
    });
  });

  describe('number formatting with commas', () => {
    it('should format numbers under 1000 without commas', () => {
      expect(formatNumberWithCommas(0)).toBe('0');
      expect(formatNumberWithCommas(999)).toBe('999');
    });

    it('should format thousands with commas', () => {
      expect(formatNumberWithCommas(1_000)).toBe('1,000');
      expect(formatNumberWithCommas(1_234)).toBe('1,234');
      expect(formatNumberWithCommas(12_345)).toBe('12,345');
      expect(formatNumberWithCommas(123_456)).toBe('123,456');
    });

    it('should format millions with commas', () => {
      expect(formatNumberWithCommas(1_000_000)).toBe('1,000,000');
      expect(formatNumberWithCommas(1_234_567)).toBe('1,234,567');
    });

    it('should format billions with commas', () => {
      expect(formatNumberWithCommas(1_000_000_000)).toBe('1,000,000,000');
      expect(formatNumberWithCommas(1_234_567_890)).toBe('1,234,567,890');
    });

    it('should handle negative numbers', () => {
      expect(formatNumberWithCommas(-1_234)).toBe('-1,234');
      expect(formatNumberWithCommas(-1_234_567)).toBe('-1,234,567');
    });
  });
});

describe('formatCountWithTooltip', () => {
  it('should return both display and full values', () => {
    const result = formatCountWithTooltip(1_234_567);
    expect(result.display).toBe('1.2M');
    expect(result.full).toBe('1,234,567');
  });

  it('should handle null', () => {
    const result = formatCountWithTooltip(null);
    expect(result.display).toBe('—');
    expect(result.full).toBe('—');
  });

  it('should handle undefined', () => {
    const result = formatCountWithTooltip(undefined);
    expect(result.display).toBe('—');
    expect(result.full).toBe('—');
  });

  it('should handle small numbers', () => {
    const result = formatCountWithTooltip(523);
    expect(result.display).toBe('523');
    expect(result.full).toBe('523');
  });

  it('should handle thousands', () => {
    const result = formatCountWithTooltip(23_456);
    expect(result.display).toBe('23.5K');
    expect(result.full).toBe('23,456');
  });
});
