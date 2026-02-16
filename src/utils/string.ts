/**
 * String utilities
 */

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  // Use single dash instead of '...' for better Windows compatibility
  return str.substring(0, length) + '-';
}

export function sanitize(str: string): string {
  return str
    // Remove invisible Unicode characters (Zero-Width Space, Non-Breaking Space, etc.)
    .replace(/[\u200B-\u200D\u2060\u00A0\uFEFF\u200E\u200F\u202A-\u202E]/g, '')
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    // Replace consecutive dashes with single dash
    .replace(/-{2,}/g, '-');
}
