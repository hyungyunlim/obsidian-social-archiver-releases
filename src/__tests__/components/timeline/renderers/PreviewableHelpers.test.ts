import { describe, it, expect } from 'vitest';
import {
  formatRelativeTime,
  formatNumber,
  computeInitials,
  formatDuration,
  extractYouTubeVideoId,
  normalizeUrlForComparison,
  parseGoogleMapsBusinessData,
  formatBusinessHours,
  buildGoogleMapsDirectionsUrl,
} from '@/components/timeline/renderers/PreviewableHelpers';
import type { PostData } from '@/types/post';

describe('PreviewableHelpers', () => {
  describe('formatRelativeTime', () => {
    it('returns empty string for falsy input', () => {
      expect(formatRelativeTime(undefined)).toBe('');
      expect(formatRelativeTime(null)).toBe('');
      expect(formatRelativeTime('')).toBe('');
    });

    it('returns "Just now" for timestamps under a minute ago', () => {
      const recent = new Date(Date.now() - 30 * 1000);
      expect(formatRelativeTime(recent)).toBe('Just now');
    });

    it('returns "Xm ago" for timestamps under an hour ago', () => {
      const past = new Date(Date.now() - 15 * 60 * 1000);
      expect(formatRelativeTime(past)).toBe('15m ago');
    });

    it('returns "Xh ago" for timestamps under a day ago', () => {
      const past = new Date(Date.now() - 3 * 60 * 60 * 1000);
      expect(formatRelativeTime(past)).toBe('3h ago');
    });

    it('returns "Yesterday" for ~24 hours ago', () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      expect(formatRelativeTime(yesterday)).toBe('Yesterday');
    });

    it('returns "Xd ago" for 2-6 days ago', () => {
      const past = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
      expect(formatRelativeTime(past)).toBe('4d ago');
    });

    it('accepts Date / ISO string / timestamp', () => {
      const date = new Date('2025-01-01T12:00:00Z');
      expect(formatRelativeTime(date)).toBeTruthy();
      expect(formatRelativeTime(date.toISOString())).toBeTruthy();
      expect(formatRelativeTime(date.getTime())).toBeTruthy();
    });

    it('returns empty string for invalid input', () => {
      expect(formatRelativeTime('not-a-date')).toBe('');
    });
  });

  describe('formatNumber', () => {
    it('renders plain integers', () => {
      expect(formatNumber(0)).toBe('0');
      expect(formatNumber(42)).toBe('42');
      expect(formatNumber(999)).toBe('999');
    });

    it('renders thousands with K', () => {
      expect(formatNumber(1000)).toBe('1K');
      expect(formatNumber(1500)).toBe('1.5K');
      expect(formatNumber(12000)).toBe('12K');
    });

    it('renders millions with M', () => {
      expect(formatNumber(1_000_000)).toBe('1M');
      expect(formatNumber(1_500_000)).toBe('1.5M');
    });

    it('handles non-finite input gracefully', () => {
      expect(formatNumber(NaN)).toBe('0');
      expect(formatNumber(Infinity)).toBe('0');
    });
  });

  describe('computeInitials', () => {
    it('takes first and last initials for multi-word names', () => {
      expect(computeInitials('John Doe')).toBe('JD');
      expect(computeInitials('Alice Bob Charlie')).toBe('AC');
    });

    it('takes the first two letters for single-word names', () => {
      expect(computeInitials('Elon')).toBe('EL');
      expect(computeInitials('Madonna')).toBe('MA');
    });

    it('returns "?" for empty / nullish input', () => {
      expect(computeInitials('')).toBe('?');
      expect(computeInitials(undefined)).toBe('?');
      expect(computeInitials(null)).toBe('?');
    });

    it('uppercases the result', () => {
      expect(computeInitials('john doe')).toBe('JD');
      expect(computeInitials('alice')).toBe('AL');
    });
  });

  describe('formatDuration', () => {
    it('renders M:SS under one hour', () => {
      expect(formatDuration(30)).toBe('0:30');
      expect(formatDuration(65)).toBe('1:05');
      expect(formatDuration(0)).toBe('0:00');
    });

    it('renders H:MM:SS at one hour or more', () => {
      expect(formatDuration(3665)).toBe('1:01:05');
      expect(formatDuration(7325)).toBe('2:02:05');
    });

    it('handles negative or non-finite input', () => {
      expect(formatDuration(-1)).toBe('0:00');
      expect(formatDuration(NaN)).toBe('0:00');
    });
  });

  describe('extractYouTubeVideoId', () => {
    it('extracts from youtube.com/watch?v=', () => {
      expect(
        extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
      ).toBe('dQw4w9WgXcQ');
    });

    it('extracts from youtu.be/', () => {
      expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe(
        'dQw4w9WgXcQ',
      );
    });

    it('extracts from youtube.com/embed/', () => {
      expect(
        extractYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ'),
      ).toBe('dQw4w9WgXcQ');
    });

    it('treats bare 11-char IDs as valid', () => {
      expect(extractYouTubeVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('returns null for non-YouTube URLs', () => {
      expect(extractYouTubeVideoId('https://google.com')).toBeNull();
      expect(extractYouTubeVideoId('')).toBeNull();
      expect(extractYouTubeVideoId(undefined)).toBeNull();
    });
  });

  describe('normalizeUrlForComparison', () => {
    it('lowercases and strips trailing slashes', () => {
      expect(normalizeUrlForComparison('HTTPS://Example.COM/')).toBe(
        'https://example.com',
      );
      expect(normalizeUrlForComparison('https://example.com///')).toBe(
        'https://example.com',
      );
    });

    it('returns "" for nullish input', () => {
      expect(normalizeUrlForComparison('')).toBe('');
      expect(normalizeUrlForComparison(undefined)).toBe('');
      expect(normalizeUrlForComparison(null)).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // Google Maps helpers (Round 3 dedupe — moved from PostCardRenderer +
  // PreviewableContentRenderer's private statics)
  // -------------------------------------------------------------------------

  describe('parseGoogleMapsBusinessData', () => {
    function makePost(overrides: Partial<PostData> = {}): PostData {
      return {
        platform: 'googlemaps',
        id: 'gm-1',
        url: 'https://maps.google.com/?cid=1',
        author: { name: 'Pho 24', url: 'https://maps.google.com/?cid=1' },
        content: { text: '' },
        media: [],
        metadata: { timestamp: new Date(), location: '123 Main St, Hanoi' },
        ...overrides,
      } as PostData;
    }

    it('prefers raw fields over content scanning', () => {
      const post = makePost({
        raw: {
          rating: 4.7,
          phone_number: '+84-123-456',
          open_website: 'https://example.com',
          all_categories: ['Restaurant', 'Vietnamese'],
        } as PostData['raw'],
      });

      const data = parseGoogleMapsBusinessData(post);
      expect(data.rating).toBe(4.7);
      expect(data.phone).toBe('+84-123-456');
      expect(data.website).toBe('https://example.com');
      expect(data.categories).toEqual(['Restaurant', 'Vietnamese']);
      expect(data.address).toBe('123 Main St, Hanoi');
      expect(data.name).toBe('Pho 24');
    });

    it('falls back to content text scan when raw is missing', () => {
      const post = makePost({
        content: {
          text: '⭐⭐⭐⭐⭐ 4.5/5 (100 reviews)\nCategories: Cafe\n📞 +1 555-0123\n🌐 https://cafe.example.com',
        },
      });

      const data = parseGoogleMapsBusinessData(post);
      expect(data.rating).toBe(4.5);
      expect(data.categories).toEqual(['Cafe']);
      expect(data.phone).toBe('+1 555-0123');
      expect(data.website).toBe('https://cafe.example.com');
    });

    it('derives rating from metadata.likes (rating * 20 convention)', () => {
      const post = makePost({
        metadata: { timestamp: new Date(), likes: 96 },
      });
      const data = parseGoogleMapsBusinessData(post);
      expect(data.rating).toBe(4.8);
    });
  });

  describe('formatBusinessHours', () => {
    it('produces an "Open daily" summary when every day has the same hours', () => {
      const result = formatBusinessHours({
        Monday: '9 AM-5 PM', Tuesday: '9 AM-5 PM', Wednesday: '9 AM-5 PM',
        Thursday: '9 AM-5 PM', Friday: '9 AM-5 PM', Saturday: '9 AM-5 PM', Sunday: '9 AM-5 PM',
      });
      expect(result.summary).toBe('Open daily 9 AM-5 PM');
      expect(result.detailed).toHaveLength(7);
    });

    it('detects weekday/weekend split when weekdays match and weekends differ', () => {
      const result = formatBusinessHours({
        Monday: '9 AM-5 PM', Tuesday: '9 AM-5 PM', Wednesday: '9 AM-5 PM',
        Thursday: '9 AM-5 PM', Friday: '9 AM-5 PM',
        Saturday: '10 AM-2 PM', Sunday: '10 AM-2 PM',
      });
      expect(result.summary).toBe('Mon-Fri 9 AM-5 PM, Sat-Sun 10 AM-2 PM');
    });

    it('marks today in the detailed array', () => {
      const result = formatBusinessHours({
        Monday: '9 AM-5 PM', Tuesday: '9 AM-5 PM',
      });
      const todays = result.detailed.filter((d) => d.isToday);
      expect(todays.length).toBe(1);
    });
  });

  describe('buildGoogleMapsDirectionsUrl', () => {
    it('uses lat/lng when both are provided', () => {
      const url = buildGoogleMapsDirectionsUrl(10.5, 106.7);
      expect(url).toContain('destination=10.5%2C106.7');
    });

    it('uses address when lat/lng are missing', () => {
      const url = buildGoogleMapsDirectionsUrl(undefined, undefined, '123 Main St');
      expect(url).toContain(encodeURIComponent('123 Main St'));
    });

    it('falls back to bare maps URL when no inputs are supplied', () => {
      expect(buildGoogleMapsDirectionsUrl()).toBe('https://www.google.com/maps');
    });

    it('falls back to place name when only that is provided', () => {
      const url = buildGoogleMapsDirectionsUrl(undefined, undefined, undefined, 'Pho 24');
      expect(url).toContain('destination=Pho%2024');
    });
  });
});
