/**
 * DateNumberFormatter - Format dates and numbers for markdown
 * Single Responsibility: Date and number formatting utilities
 */
export class DateNumberFormatter {
  private customDateFormat?: (date: Date) => string;

  /**
   * Set custom date formatter
   */
  setDateFormat(formatter: (date: Date) => string): void {
    this.customDateFormat = formatter;
  }

  /**
   * Format number with thousand separators
   */
  formatNumber(num: number): string {
    return num.toLocaleString('en-US');
  }

  /**
   * Format date using custom formatter or default
   * Handles both Date objects and ISO string timestamps
   */
  formatDate(date: Date | string | undefined): string {
    // Return empty string if no date provided
    if (!date) {
      return '';
    }

    // Convert to Date object if it's a string
    const dateObj = typeof date === 'string' ? new Date(date) : date;

    // Check if date is valid
    if (isNaN(dateObj.getTime())) {
      return '';
    }

    if (this.customDateFormat) {
      return this.customDateFormat(dateObj);
    }

    // Default format: YYYY-MM-DD HH:mm (in local timezone)
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }

  /**
   * Format duration in seconds to human-readable format (e.g., "1:23" or "12:34:56")
   */
  formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
}
