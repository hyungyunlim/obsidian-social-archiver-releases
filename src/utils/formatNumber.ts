/**
 * Number Formatting Utilities
 *
 * Functions for formatting large numbers into human-readable abbreviated forms
 * for UI display (e.g., follower counts, post counts).
 */

/**
 * Format large numbers into human-readable abbreviated form
 *
 * @param num - Number to format
 * @param precision - Decimal places (default: 1)
 * @returns Formatted string (e.g., "1.2K", "3.5M", "2B")
 *
 * @example
 * formatNumber(999)        // "999"
 * formatNumber(1234)       // "1.2K"
 * formatNumber(1000)       // "1K"
 * formatNumber(1_234_567)  // "1.2M"
 * formatNumber(null)       // "—"
 * formatNumber(-1234)      // "-1.2K"
 */
export function formatNumber(num: number | null | undefined, precision = 1): string {
  if (num === null || num === undefined) {
    return '—';
  }

  // Handle zero explicitly
  if (num === 0) {
    return '0';
  }

  const absNum = Math.abs(num);
  const sign = num < 0 ? '-' : '';

  // Less than 1K - return as is
  if (absNum < 1000) {
    return num.toString();
  }

  // Thousands (1K - 999.9K)
  if (absNum < 1_000_000) {
    const k = absNum / 1000;
    const formatted = k.toFixed(precision);
    // Remove trailing zeros: "1.0K" -> "1K"
    return sign + formatted.replace(/\.0+$/, '') + 'K';
  }

  // Millions (1M - 999.9M)
  if (absNum < 1_000_000_000) {
    const m = absNum / 1_000_000;
    const formatted = m.toFixed(precision);
    return sign + formatted.replace(/\.0+$/, '') + 'M';
  }

  // Billions (1B+)
  const b = absNum / 1_000_000_000;
  const formatted = b.toFixed(precision);
  return sign + formatted.replace(/\.0+$/, '') + 'B';
}

/**
 * Format number with locale-specific thousands separators
 *
 * @param num - Number to format
 * @returns Formatted string with commas (e.g., "1,234,567")
 *
 * @example
 * formatNumberWithCommas(1234567)  // "1,234,567"
 * formatNumberWithCommas(999)      // "999"
 * formatNumberWithCommas(null)     // "—"
 */
export function formatNumberWithCommas(num: number | null | undefined): string {
  if (num === null || num === undefined) {
    return '—';
  }

  return num.toLocaleString();
}

/**
 * Format count with optional abbreviated tooltip
 * Returns both the abbreviated display value and the full value for tooltip
 *
 * @param num - Number to format
 * @returns Object with display (abbreviated) and full (with commas) values
 *
 * @example
 * formatCountWithTooltip(1234567)
 * // { display: "1.2M", full: "1,234,567" }
 */
export function formatCountWithTooltip(num: number | null | undefined): {
  display: string;
  full: string;
} {
  return {
    display: formatNumber(num),
    full: formatNumberWithCommas(num),
  };
}
