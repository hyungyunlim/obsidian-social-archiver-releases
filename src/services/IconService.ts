/**
 * IconService - Centralized icon management for all platforms
 *
 * Single Responsibility: Provide unified access to platform icons
 * - SimpleIcon SVG data (from platform-icons.ts)
 * - Lucide icon names (for Obsidian setIcon API)
 * - Emoji icons (for text display)
 *
 * This service eliminates duplication across:
 * - PostCardRenderer.ts
 * - CompactPostCardRenderer.ts
 * - AuthorRow.svelte
 * - ArchiveStatusIndicator.svelte
 * - ArchiveModal.ts
 * - SubscriptionRow.svelte
 */

import {
  siFacebook,
  siInstagram,
  siLinkedin,
  siTiktok,
  siX,
  siThreads,
  siYoutube,
  siReddit,
  siPinterest,
  siSubstack,
  siTumblr,
  siMastodon,
  siBluesky,
  siGooglemaps,
  siMedium,
  siVelog,
  siPodcast,
  siNaver,
  siNaverWebtoon,
  siBrunch,
  siRss,
  type PlatformIcon,
} from '@/constants/platform-icons';
import type { Platform } from '@/types/post';

// ============================================================================
// Types
// ============================================================================

export type { PlatformIcon };

/**
 * Result of icon lookup with type information
 */
export interface IconResult {
  type: 'simple' | 'lucide';
  simpleIcon?: PlatformIcon;
  lucideIcon?: string;
}

// ============================================================================
// Icon Mappings (Single Source of Truth)
// ============================================================================

/**
 * SimpleIcon mapping for all platforms
 * null means use Lucide fallback
 */
const SIMPLE_ICON_MAP: Record<string, PlatformIcon | null> = {
  facebook: siFacebook,
  instagram: siInstagram,
  linkedin: siLinkedin, // Has SimpleIcon now
  x: siX,
  twitter: siX, // Alias
  tiktok: siTiktok,
  threads: siThreads,
  youtube: siYoutube,
  reddit: siReddit,
  pinterest: siPinterest,
  substack: siSubstack,
  tumblr: siTumblr,
  mastodon: siMastodon,
  bluesky: siBluesky,
  googlemaps: siGooglemaps,
  medium: siMedium,
  velog: siVelog,
  podcast: siPodcast,
  naver: siNaver, // Naver Blog/Cafe/News
  'naver-webtoon': siNaverWebtoon, // Naver Webtoon
  webtoons: siNaverWebtoon, // WEBTOON Global (same icon as Naver Webtoon)
  brunch: siBrunch, // Brunch (Kakao publishing platform)
  blog: siRss,
  post: null, // User posts use Lucide
};

/**
 * Lucide icon fallbacks for platforms without SimpleIcon
 * or when SimpleIcon is not desired
 */
const LUCIDE_ICON_MAP: Record<string, string> = {
  linkedin: 'linkedin',
  googlemaps: 'map-pin',
  post: 'user',
  blog: 'rss',
  default: 'share-2',
};

/**
 * Emoji icons for text display
 */
const EMOJI_MAP: Record<string, string> = {
  facebook: '📘',
  instagram: '📷',
  linkedin: '💼',
  x: '🐦',
  twitter: '🐦',
  tiktok: '🎵',
  threads: '🧵',
  youtube: '▶️',
  reddit: '🔶',
  pinterest: '📌',
  substack: '📰',
  tumblr: '📗',
  mastodon: '🐘',
  bluesky: '🦋',
  googlemaps: '📍',
  medium: '📖',
  velog: '🌱',
  podcast: '🎙️',
  naver: '🟢',
  'naver-webtoon': '📚',
  webtoons: '📚', // WEBTOON Global (same icon as Naver Webtoon)
  brunch: '☕',
  blog: '📝',
  post: '📝',
  default: '🌐',
};

// ============================================================================
// Platform Detection from URL
// ============================================================================

/**
 * Detect specific platform from blog/RSS URL
 * Used when platform is 'blog' but URL indicates Medium or Velog
 */
export function detectPlatformFromBlogUrl(authorUrl: string | undefined): Platform | null {
  if (!authorUrl) return null;

  try {
    const url = new URL(authorUrl);
    const hostname = url.hostname.toLowerCase();

    // Medium: medium.com or *.medium.com
    if (hostname === 'medium.com' || hostname === 'www.medium.com' || hostname.endsWith('.medium.com')) {
      return 'medium';
    }

    // Velog: velog.io
    if (hostname === 'velog.io' || hostname === 'www.velog.io') {
      return 'velog';
    }

    // Substack: *.substack.com
    if (hostname.endsWith('.substack.com')) {
      return 'substack';
    }

    // Tumblr: *.tumblr.com
    if (hostname.endsWith('.tumblr.com')) {
      return 'tumblr';
    }
  } catch {
    // Invalid URL, return null
  }

  return null;
}

// ============================================================================
// Icon Lookup Functions
// ============================================================================

/**
 * Get SimpleIcon SVG data for a platform
 *
 * @param platform - Platform identifier
 * @param authorUrl - Optional author URL for blog platform detection
 * @returns PlatformIcon or null if not available
 *
 * @example
 * const icon = getPlatformSimpleIcon('facebook');
 * if (icon) {
 *   element.innerHTML = `<svg viewBox="0 0 24 24"><path d="${icon.path}"/></svg>`;
 * }
 */
export function getPlatformSimpleIcon(
  platform: string,
  authorUrl?: string
): PlatformIcon | null {
  const key = platform.toLowerCase();

  // For 'blog' platform, check if it's actually Medium, Velog, etc.
  if (key === 'blog' && authorUrl) {
    const detectedPlatform = detectPlatformFromBlogUrl(authorUrl);
    if (detectedPlatform && detectedPlatform in SIMPLE_ICON_MAP) {
      return SIMPLE_ICON_MAP[detectedPlatform] ?? null;
    }
  }

  // Check if key exists in map
  if (key in SIMPLE_ICON_MAP) {
    return SIMPLE_ICON_MAP[key] ?? null;
  }

  // Default fallback
  return siX;
}

/**
 * Get Lucide icon name for a platform
 * Used with Obsidian's setIcon() API
 *
 * @param platform - Platform identifier
 * @returns Lucide icon name string
 *
 * @example
 * import { setIcon } from 'obsidian';
 * const iconName = getPlatformLucideIcon('linkedin');
 * setIcon(element, iconName);
 */
export function getPlatformLucideIcon(platform: string): string {
  const key = platform.toLowerCase();
  return LUCIDE_ICON_MAP[key] ?? LUCIDE_ICON_MAP.default ?? 'share-2';
}

/**
 * Get emoji icon for a platform
 * Used for text display and fallbacks
 *
 * @param platform - Platform identifier
 * @returns Emoji string
 *
 * @example
 * const emoji = getPlatformEmoji('youtube');
 * // Returns '▶️'
 */
export function getPlatformEmoji(platform: string): string {
  const key = platform.toLowerCase();
  return EMOJI_MAP[key] ?? EMOJI_MAP.default ?? '🌐';
}

/**
 * Get the best available icon for a platform
 * Returns both SimpleIcon and Lucide fallback info
 *
 * @param platform - Platform identifier
 * @param authorUrl - Optional author URL for blog platform detection
 * @returns IconResult with type and icon data
 *
 * @example
 * const result = getPlatformIcon('linkedin');
 * if (result.type === 'simple' && result.simpleIcon) {
 *   // Render SVG
 * } else if (result.lucideIcon) {
 *   setIcon(element, result.lucideIcon);
 * }
 */
export function getPlatformIcon(
  platform: string,
  authorUrl?: string
): IconResult {
  const simpleIcon = getPlatformSimpleIcon(platform, authorUrl);

  if (simpleIcon) {
    return {
      type: 'simple',
      simpleIcon,
    };
  }

  return {
    type: 'lucide',
    lucideIcon: getPlatformLucideIcon(platform),
  };
}

/**
 * Check if a platform has a SimpleIcon available
 *
 * @param platform - Platform identifier
 * @returns true if SimpleIcon exists
 */
export function hasSimpleIcon(platform: string): boolean {
  const key = platform.toLowerCase();
  return key in SIMPLE_ICON_MAP && SIMPLE_ICON_MAP[key] !== null;
}

// ============================================================================
// SVG Rendering Helpers
// ============================================================================

/**
 * Generate SVG HTML string for a platform icon
 *
 * @param platform - Platform identifier
 * @param authorUrl - Optional author URL for blog detection
 * @param options - Styling options
 * @returns SVG HTML string or empty string if no icon
 *
 * @example
 * element.innerHTML = renderPlatformIconSVG('facebook', undefined, {
 *   fill: 'var(--text-accent)',
 *   size: '16px'
 * });
 */
export function renderPlatformIconSVG(
  platform: string,
  authorUrl?: string,
  options: {
    fill?: string;
    size?: string;
    className?: string;
  } = {}
): string {
  const icon = getPlatformSimpleIcon(platform, authorUrl);
  if (!icon) return '';

  const fill = options.fill || 'currentColor';
  const size = options.size || '100%';
  const className = options.className ? ` class="${options.className}"` : '';

  return `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"${className} style="fill: ${fill}; width: ${size}; height: ${size};">
    <title>${icon.title}</title>
    <path d="${icon.path}"/>
  </svg>`;
}

/**
 * Get platform brand color (hex)
 *
 * @param platform - Platform identifier
 * @param authorUrl - Optional author URL for blog detection
 * @returns Hex color string without # prefix, or undefined
 */
export function getPlatformColor(
  platform: string,
  authorUrl?: string
): string | undefined {
  const icon = getPlatformSimpleIcon(platform, authorUrl);
  return icon?.hex;
}
