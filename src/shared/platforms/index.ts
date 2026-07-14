/**
 * AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
 *
 * Source: shared/platforms/index.ts
 * Generated: 2026-07-11T08:56:14.733Z
 *
 * To modify, edit the source file in shared/platforms/ and run:
 *   npm run sync:shared
 */

/**
 * Shared Platform Definitions
 *
 * Single Source of Truth for platform detection and configuration.
 * This module is synced to both src/ and workers/src/ at build time.
 *
 * Usage:
 *   import { detectPlatform, getPlatformName } from '@/shared/platforms';
 *   import type { Platform } from '@/shared/platforms';
 */

// Types
export type { Platform } from './types';
export { PLATFORMS, isPlatform } from './types';

export type {
  KoreanMapPlatform,
  VerifiedMapPlaceSource,
  MapPlaceProvider,
  MapPlaceTarget,
  MapProviderWebLink,
} from './map-places';
export type { MapPlaceCountryEvidence } from './map-place-policy';
export {
  VERIFIED_MAP_PLACE_SOURCES,
  MAP_PLACE_NAME_MAX_LENGTH,
  NAVER_MAP_URL_PATTERN,
  KAKAO_MAP_URL_PATTERN,
  isNaverMapShortUrl,
  isKakaoMapShortUrl,
  extractKoreanMapPlaceId,
  isKoreanMapPlaceUrl,
  isKoreanMapUrlCandidate,
  canonicalizeKoreanMapPlaceUrl,
  getMapPlaceProvider,
  isMapPlaceCardEligible,
  buildExactMapPlaceUrl,
  getMapProviderWebLink,
  encodeMapPlaceQuery,
} from './map-places';
export {
  getMapPlaceProviderPriority,
  isConservativelySouthKoreanPlace,
} from './map-place-policy';
export { getMapProviderWebLinks } from './map-place-links';

// Subscription platform constants (Single Source of Truth)
export type {
  RSSBasedPlatform,
  CrawlSupportedPlatform,
  NewSubscriptionPlatform,
  SubscriptionPlatform,
  PreviewSupportedPlatform,
} from './types';
export {
  RSS_BASED_PLATFORMS,
  CRAWL_SUPPORTED_PLATFORMS,
  NEW_SUBSCRIPTION_PLATFORMS,
  SUBSCRIPTION_PLATFORMS,
  PREVIEW_SUPPORTED_PLATFORMS,
} from './types';

// Definitions
export type {
  PlatformDefinition,
  PlatformFeatures,
  PlatformRateLimit,
} from './definitions';
export {
  PLATFORM_DEFINITIONS,
  getPlatformDefinition,
  getAllPlatformDefinitions,
  isPodcastDomain,
  isPodcastFeedUrl,
} from './definitions';

// Detection utilities
export {
  detectPlatform,
  getPlatformName,
  getPlatformEmoji,
  getBrightDataDataset,
  isSupportedPlatform,
  getPlatformByDomain,
  getPlatformConfig,
  platformSupportsFeature,
  platformAllowsCustomDomains,
  getPlatformMaxMediaSize,
  getPlatformRateLimit,
} from './detection';
