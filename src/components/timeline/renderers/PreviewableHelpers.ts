/**
 * Shared formatter and utility functions for post card rendering.
 *
 * Used by both `PostCardRenderer` (vault timeline) and the gallery sub-
 * renderers (`PreviewableHeaderRenderer`, `PreviewableContentRenderer`,
 * `PreviewableMediaRenderer`, `PreviewableInteractionsRenderer`) so the
 * formatting logic stays single-source-of-truth across both code paths.
 *
 * Every function here is a pure function — no `this`, no DOM access, no
 * side effects. Add new helpers here only if they have at least two
 * consumers and no `this.X` dependencies.
 */

import type { PostData } from '@/types/post';

/**
 * Format a timestamp into a human-readable relative time string.
 *
 * Examples: `"Just now"`, `"5m ago"`, `"2h ago"`, `"Yesterday"`,
 * `"3d ago"`, `"Jan 15, 2025"`.
 *
 * Mirrors `PostCardRenderer.getRelativeTime` and the previous
 * `PreviewableCardRenderer.formatRelativeTime` exactly so the vault
 * timeline and the gallery preview surface render identical strings.
 */
export function formatRelativeTime(
  timestamp: Date | string | number | undefined | null,
): string {
  if (timestamp === undefined || timestamp === null || timestamp === '') return '';
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

/**
 * Format a large number into a compact human-readable form.
 *
 * Examples: `1000 → "1K"`, `1500 → "1.5K"`, `1500000 → "1.5M"`,
 * `42 → "42"`.
 */
export function formatNumber(num: number): string {
  if (!Number.isFinite(num)) return '0';
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return String(num);
}

/**
 * Extract initials from an author name for the avatar fallback.
 *
 * Examples: `"John Doe" → "JD"`, `"Elon" → "EL"`, `"" → "?"`.
 *
 * Two-character output, always uppercase.
 */
export function computeInitials(name: string | undefined | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length >= 2) {
    const first = parts[0]?.[0] ?? '';
    const last = parts[parts.length - 1]?.[0] ?? '';
    return (first + last).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

/**
 * Format a duration in seconds into `M:SS` or `H:MM:SS`.
 *
 * Examples: `65 → "1:05"`, `3665 → "1:01:05"`, `30 → "0:30"`.
 * Negative or non-finite inputs render as `"0:00"`.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';

  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Normalize a URL for case-insensitive comparison or badge-cache keying.
 *
 * Lowercases and strips trailing slashes. Returns the empty string for
 * any falsy input.
 */
export function normalizeUrlForComparison(url: string | undefined | null): string {
  if (!url) return '';
  return url.toLowerCase().replace(/\/+$/, '');
}

/**
 * Extract a YouTube video ID from a URL or bare ID.
 *
 * Handles `youtube.com/watch?v=...`, `youtu.be/...`, `youtube.com/embed/...`,
 * and bare 11-12 char IDs. Returns `null` for inputs that do not look
 * like a YouTube reference.
 */
export function extractYouTubeVideoId(url: string | undefined | null): string | null {
  if (!url) return null;

  // Bare ID — 11 to 12 alphanumerics + `_` / `-`.
  if (/^[a-zA-Z0-9_-]{11,12}$/.test(url)) return url;

  let match = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11,12})/,
  );
  if (match) return match[1] ?? null;

  match = url.match(/[?&]v=([a-zA-Z0-9_-]{11,12})/);
  if (match) return match[1] ?? null;

  return null;
}

// ---------------------------------------------------------------------------
// Google Maps helpers (Round 3 dedupe)
//
// `PreviewableContentRenderer` (Round 2B) and `PostCardRenderer` (vault
// timeline) used to keep separate copies of these three pure parsers /
// formatters / URL builders. Round 3 moves them into this single canonical
// home — both consumers now import from here.
// ---------------------------------------------------------------------------

/** Shape returned by `parseGoogleMapsBusinessData`. */
export interface GoogleMapsBusinessData {
  name: string;
  rating?: number;
  reviewsCount?: number;
  categories?: string[];
  phone?: string;
  website?: string;
  address?: string;
  hours?: Record<string, string>;
  priceLevel?: string;
  isVerified?: boolean;
  lat?: number;
  lng?: number;
}

/** Shape returned by `formatBusinessHours`. */
export interface FormattedBusinessHours {
  summary: string;
  isOpen?: boolean;
  detailed: Array<{ day: string; hours: string; isToday: boolean }>;
}

/**
 * Parse Google Maps business data from a `PostData`. Tries `post.raw` first
 * (full BrightData / Google Places fields when archiving fresh) and falls
 * back to scanning `post.content.text` (when the post was reconstructed from
 * vault markdown — `raw` lost during persistence).
 *
 * Pure / side-effect free. Mirrors the historical behavior of both
 * `PostCardRenderer.parseGoogleMapsBusinessData` and the static copy that
 * lived inside `PreviewableContentRenderer`.
 */
export function parseGoogleMapsBusinessData(post: PostData): GoogleMapsBusinessData {
  const raw = post.raw as Record<string, unknown> | undefined;
  const contentText = post.content?.text || '';

  // Rating: raw.rating > metadata.likes (stored as rating * 20) > content scan.
  let rating: number | undefined;
  if (typeof raw?.rating === 'number') {
    rating = raw.rating as number;
  } else if (
    typeof post.metadata?.likes === 'number' &&
    post.metadata.likes > 0 &&
    post.metadata.likes <= 100
  ) {
    rating = post.metadata.likes / 20;
  } else {
    const ratingMatch = contentText.match(/(\d+\.?\d*)\/5/);
    if (ratingMatch?.[1]) rating = parseFloat(ratingMatch[1]);
  }

  // Hours: raw.open_hours object > content scan ("⏰ Hours:\n…").
  let hours: Record<string, string> | undefined;
  if (raw?.open_hours && typeof raw.open_hours === 'object') {
    hours = raw.open_hours as Record<string, string>;
  } else {
    const hoursMatch = contentText.match(/⏰ Hours:\n([\s\S]*?)(?:\n\n|$)/);
    if (hoursMatch?.[1]) {
      hours = {};
      const dayLines = hoursMatch[1].split('\n').filter((l) => l.trim());
      dayLines.forEach((line) => {
        const [day, time] = line.split(': ');
        if (day && time && hours) hours[day.trim()] = time.trim();
      });
    }
  }

  // Categories: raw.all_categories array > content scan.
  let categories: string[] | undefined;
  if (raw?.all_categories && Array.isArray(raw.all_categories)) {
    categories = raw.all_categories as string[];
  } else {
    const catMatch = contentText.match(/Categories: ([^\n]+)/);
    if (catMatch?.[1]) categories = catMatch[1].split(', ').map((c) => c.trim());
  }

  // Phone: raw.phone_number > content scan ("📞 +84946874615").
  let phone: string | undefined;
  if (typeof raw?.phone_number === 'string') {
    phone = raw.phone_number as string;
  } else {
    const phoneMatch = contentText.match(/📞\s*(\+?[\d\s-]+)/);
    if (phoneMatch?.[1]) phone = phoneMatch[1].trim();
  }

  // Website: raw.open_website > content scan ("🌐 https://…").
  let website: string | undefined;
  if (typeof raw?.open_website === 'string') {
    website = raw.open_website as string;
  } else {
    const webMatch = contentText.match(/🌐\s*(https?:\/\/[^\s\n]+)/);
    if (webMatch?.[1]) website = webMatch[1].trim();
  }

  return {
    name: post.author?.name || post.title || 'Unknown Place',
    rating,
    reviewsCount: post.metadata?.comments,
    categories,
    phone,
    website,
    address: post.metadata?.location,
    hours,
    priceLevel: typeof raw?.price_level === 'string' ? (raw.price_level as string) : undefined,
    isVerified: post.author?.verified,
    lat: post.metadata?.latitude,
    lng: post.metadata?.longitude,
  };
}

/**
 * Format business hours into a smart summary + per-day detail array.
 *
 * Examples of `summary`:
 *   - all-same         → `"Open daily 9 AM–5 PM"`
 *   - weekday/weekend  → `"Mon-Fri 9 AM–5 PM, Sat-Sun Closed"`
 *   - one closed day   → `"Sun closed, otherwise 9 AM–5 PM"`
 *   - mixed schedule   → `"Today: 9 AM–5 PM"` (fallback)
 *
 * Pure / side-effect free.
 */
export function formatBusinessHours(hours: Record<string, string>): FormattedBusinessHours {
  const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const shortDays: Record<string, string> = {
    Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed',
    Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
  };

  const today = dayOrder[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1];

  const normalizedHours: Record<string, string> = {};
  for (const [day, time] of Object.entries(hours)) {
    const normalizedDay = dayOrder.find((d) => d.toLowerCase() === day.toLowerCase()) || day;
    normalizedHours[normalizedDay] = time;
  }

  const detailed = dayOrder.map((day) => ({
    day: shortDays[day] || day,
    hours: normalizedHours[day] || 'Closed',
    isToday: day === today,
  }));

  const uniqueHours = new Set(Object.values(normalizedHours));
  const allSame = uniqueHours.size === 1 && dayOrder.every((d) => normalizedHours[d]);

  if (allSame) {
    const time = Object.values(normalizedHours)[0];
    return { summary: `Open daily ${time}`, detailed };
  }

  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const weekend = ['Saturday', 'Sunday'];
  const weekdayHours = weekdays.map((d) => normalizedHours[d]).filter(Boolean);
  const weekendHours = weekend.map((d) => normalizedHours[d]).filter(Boolean);

  const allWeekdaysSame = new Set(weekdayHours).size === 1 && weekdayHours.length === 5;
  const allWeekendSame = new Set(weekendHours).size <= 1;

  if (allWeekdaysSame && allWeekendSame && weekdayHours.length > 0) {
    const weekdayTime = weekdayHours[0];
    const weekendTime = weekendHours[0] || 'Closed';
    if (weekdayTime === weekendTime) {
      return { summary: `Open daily ${weekdayTime}`, detailed };
    }
    return {
      summary: `Mon-Fri ${weekdayTime}${
        weekendTime !== 'Closed' ? `, Sat-Sun ${weekendTime}` : ', Sat-Sun Closed'
      }`,
      detailed,
    };
  }

  const closedDays = dayOrder.filter(
    (d) => !normalizedHours[d] || normalizedHours[d].toLowerCase() === 'closed',
  );
  if (closedDays.length === 1 && closedDays[0]) {
    const closedDay = closedDays[0];
    const openHours = Object.values(normalizedHours).find(
      (h) => h && h.toLowerCase() !== 'closed',
    );
    return {
      summary: `${shortDays[closedDay] || closedDay} closed${openHours ? `, otherwise ${openHours}` : ''}`,
      detailed,
    };
  }

  const todayHours = (today && normalizedHours[today]) || 'Hours unavailable';
  return { summary: `Today: ${todayHours}`, detailed };
}

/**
 * Build a Google Maps directions URL for the given destination. Coordinates
 * win over address; address wins over place name. Returns the bare maps URL
 * when nothing is supplied.
 *
 * Pure / side-effect free.
 */
export function buildGoogleMapsDirectionsUrl(
  lat?: number,
  lng?: number,
  address?: string,
  placeName?: string,
): string {
  if (typeof lat === 'number' && typeof lng === 'number') {
    const destination = encodeURIComponent(`${lat},${lng}`);
    return `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
  }
  if (address) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
  }
  if (placeName) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(placeName)}`;
  }
  return 'https://www.google.com/maps';
}
