/**
 * Date utilities for Social Archiver
 *
 * Provides timezone-aware date operations for:
 * - Profile crawl date range configuration
 * - BrightData API date formatting
 * - User timezone detection
 */

// ============================================================================
// Basic Formatting
// ============================================================================

/**
 * Format date to ISO string
 */
export function formatDate(date: Date): string {
  return date.toISOString();
}

/**
 * Format date for BrightData API (MM-DD-YYYY format)
 * BrightData expects dates in American format
 *
 * @param date - Date to format (treated as UTC)
 * @returns Date string in MM-DD-YYYY format
 */
export function formatDateForBrightData(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${month}-${day}-${year}`;
}

// ============================================================================
// Timezone Operations
// ============================================================================

/**
 * Detect user's timezone using Intl API
 * Falls back to 'UTC' if detection fails
 *
 * @returns IANA timezone string (e.g., 'America/New_York', 'Asia/Tokyo')
 */
export function detectUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/**
 * Validate if a timezone string is valid IANA timezone
 *
 * @param timezone - Timezone string to validate
 * @returns true if valid, false otherwise
 */
export function isValidTimezone(timezone: string): boolean {
  if (!timezone) return false;

  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a local date to UTC considering the user's timezone
 *
 * When a user selects "2024-03-15" in their local timezone (e.g., PST),
 * this function returns the UTC Date that represents the start of that day
 * in the user's timezone.
 *
 * @param localDate - Date object representing local date
 * @param timezone - IANA timezone string (e.g., 'America/Los_Angeles')
 * @returns Date object in UTC
 */
export function localDateToUTC(localDate: Date, timezone: string): Date {
  // Validate timezone
  if (!isValidTimezone(timezone)) {
    console.warn(`[date] Invalid timezone "${timezone}", using UTC`);
    return new Date(localDate);
  }

  // Get the date components from the input date
  const year = localDate.getFullYear();
  const month = localDate.getMonth();
  const day = localDate.getDate();

  // Create a UTC date with the same year, month, day but at midnight UTC
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
}

/**
 * Get date N days ago from today in user's timezone
 *
 * @param days - Number of days to go back
 * @param timezone - IANA timezone string
 * @returns Date object representing the start of that day in UTC
 */
export function getDateDaysAgo(days: number, timezone: string): Date {
  const now = new Date();

  // Get current date in the target timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: isValidTimezone(timezone) ? timezone : 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const todayStr = formatter.format(now);
  const today = new Date(todayStr + 'T00:00:00Z');

  // Subtract days
  today.setUTCDate(today.getUTCDate() - days);

  return today;
}

// ============================================================================
// Date Range Validation
// ============================================================================

/**
 * Result of date range validation
 */
export interface DateRangeValidation {
  /** Whether the date range is valid */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
  /** Number of days in the range */
  dayCount?: number;
  /** Warning messages (non-blocking issues) */
  warnings?: string[];
}

/**
 * Default maximum days for date range
 */
export const DEFAULT_MAX_DATE_RANGE_DAYS = 90;

/**
 * Validate date range for crawl options
 *
 * Checks:
 * - startDate <= endDate
 * - endDate <= today (with 1 minute tolerance for clock skew)
 * - Range <= maxDays (default 90)
 *
 * @param startDate - Start of the date range
 * @param endDate - End of the date range
 * @param maxDays - Maximum allowed days (default: 90)
 * @returns Validation result with error message or day count
 */
export function validateDateRange(
  startDate: Date,
  endDate: Date,
  maxDays: number = DEFAULT_MAX_DATE_RANGE_DAYS
): DateRangeValidation {
  const warnings: string[] = [];
  const now = new Date();

  // Check if end date is in the future (with 1 minute tolerance)
  const futureThreshold = new Date(now.getTime() + 60 * 1000);
  if (endDate > futureThreshold) {
    return {
      valid: false,
      error: 'End date cannot be in the future',
    };
  }

  // Check if start date is after end date
  if (startDate > endDate) {
    return {
      valid: false,
      error: 'Start date must be before end date',
    };
  }

  // Calculate day count
  const msPerDay = 1000 * 60 * 60 * 24;
  const dayCount = Math.ceil((endDate.getTime() - startDate.getTime()) / msPerDay);

  // Check if range exceeds maximum
  if (dayCount > maxDays) {
    return {
      valid: false,
      error: `Date range cannot exceed ${maxDays} days (current: ${dayCount} days)`,
      dayCount,
    };
  }

  // Warning for very short range
  if (dayCount < 1) {
    warnings.push('Date range is less than 1 day');
  }

  // Warning for very old start date (more than 1 year ago)
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  if (startDate < oneYearAgo) {
    warnings.push('Start date is more than 1 year ago. Some posts may not be available.');
  }

  return {
    valid: true,
    dayCount,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// ============================================================================
// Date Parsing
// ============================================================================

/**
 * Parse a date string in YYYY-MM-DD format to a Date object
 * Returns null if the string is invalid
 *
 * @param dateStr - Date string in YYYY-MM-DD format
 * @returns Date object or null if invalid
 */
export function parseDateString(dateStr: string): Date | null {
  if (!dateStr || typeof dateStr !== 'string') {
    return null;
  }

  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, yearStr, monthStr, dayStr] = match;
  const year = parseInt(yearStr ?? '0', 10);
  const month = parseInt(monthStr ?? '0', 10) - 1; // 0-indexed
  const day = parseInt(dayStr ?? '0', 10);

  // Validate ranges
  if (year < 1900 || year > 2100) return null;
  if (month < 0 || month > 11) return null;
  if (day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month, day));

  // Verify the date is valid (e.g., not Feb 30)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

/**
 * Format a Date object to YYYY-MM-DD string
 *
 * @param date - Date to format
 * @returns Date string in YYYY-MM-DD format
 */
export function formatDateToYYYYMMDD(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
