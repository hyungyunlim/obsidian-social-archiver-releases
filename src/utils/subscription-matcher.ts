/**
 * subscription-matcher.ts
 *
 * Shared utility for matching post authors against a subscription list.
 *
 * Single Responsibility: Subscription lookup key building and author matching.
 *
 * Used by:
 *   - PostCardRenderer (full card interactive badge)
 *   - CompactPostCardRenderer (compact card passive indicator)
 */

import type { Platform } from '../types/post';
import { normalizeAuthorUrl } from '../services/AuthorDeduplicator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubscriptionMatchInput {
  platform: string;
  /** Author profile URL (post.author.url) */
  authorUrl?: string | null;
  /** Author handle (post.author.handle) */
  handle?: string | null;
  /** Author display name (post.author.name) */
  name?: string | null;
}

export interface SubscriptionCacheEntry {
  subscriptionId: string;
  handle: string;
}

/**
 * Lookup map shape used by renderers.
 * Keys:
 *   - `${platform}:${normalizedUrl}`      → URL-based match
 *   - `${platform}:handle:${handle}`      → handle-based fallback
 */
export type SubscriptionLookupMap = Map<string, SubscriptionCacheEntry>;

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a handle: lowercase + strip leading @
 */
export function normalizeHandle(handle: string): string {
  return handle.toLowerCase().replace(/^@/, '');
}

/**
 * Normalize a URL for comparison: lowercase + strip trailing slashes.
 * Intentionally kept simple — full normalization is delegated to
 * normalizeAuthorUrl when building the lookup.
 */
export function normalizeUrlForComparison(url: string): string {
  if (!url) return '';
  return url.toLowerCase().replace(/\/+$/, '');
}

/**
 * Normalize a display name: trim + lowercase.
 */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Lookup construction
// ---------------------------------------------------------------------------

/**
 * Build a subscription lookup map from a flat list of subscription records.
 *
 * Each subscription contributes up to two keys:
 *   1. `${platform}:${normalizedProfileUrl}` — preferred, URL-based
 *   2. `${platform}:handle:${normalizedHandle}` — handle fallback
 *
 * This mirrors the logic previously inlined in PostCardRenderer.setSubscriptionsCache.
 */
export function buildSubscriptionLookup(
  subscriptions: Array<{
    id: string;
    platform: string;
    target: { handle: string; profileUrl?: string | null };
  }>
): SubscriptionLookupMap {
  const map: SubscriptionLookupMap = new Map();

  for (const sub of subscriptions) {
    const entry: SubscriptionCacheEntry = {
      subscriptionId: sub.id,
      handle: sub.target.handle,
    };

    if (sub.target.profileUrl) {
      const normalized = normalizeAuthorUrl(sub.target.profileUrl, sub.platform as Platform);
      const normalizedUrl = normalized.url || normalizeUrlForComparison(sub.target.profileUrl);
      map.set(`${sub.platform}:${normalizedUrl}`, entry);
    }

    if (sub.target.handle) {
      const h = normalizeHandle(sub.target.handle);
      map.set(`${sub.platform}:handle:${h}`, entry);
    }
  }

  return map;
}

/**
 * Add a single subscription entry to an existing lookup map.
 * Uses full URL normalization (via normalizeAuthorUrl) to match how
 * getSubscriptionFromCache resolves blog/Medium/Substack/Tumblr post URLs.
 */
export function addSubscriptionToLookup(
  map: SubscriptionLookupMap,
  subscription: {
    id: string;
    platform: string;
    target: { handle: string; profileUrl?: string | null };
  }
): void {
  const entry: SubscriptionCacheEntry = {
    subscriptionId: subscription.id,
    handle: subscription.target.handle,
  };

  if (subscription.target.profileUrl) {
    const normalized = normalizeAuthorUrl(subscription.target.profileUrl, subscription.platform as Platform);
    const normalizedUrl = normalized.url || normalizeUrlForComparison(subscription.target.profileUrl);
    map.set(`${subscription.platform}:${normalizedUrl}`, entry);
  }

  if (subscription.target.handle) {
    const h = normalizeHandle(subscription.target.handle);
    map.set(`${subscription.platform}:handle:${h}`, entry);
  }
}

/**
 * Remove all entries for a given subscriptionId from the lookup map.
 */
export function removeSubscriptionFromLookup(
  map: SubscriptionLookupMap,
  subscriptionId: string
): void {
  const keysToRemove: string[] = [];
  map.forEach((value, key) => {
    if (value.subscriptionId === subscriptionId) {
      keysToRemove.push(key);
    }
  });
  keysToRemove.forEach(key => map.delete(key));
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Look up a subscription for the given author input.
 *
 * Match priority (mirrors PostCardRenderer.getSubscriptionFromCache):
 *   1. Normalized profile URL (via normalizeAuthorUrl full normalization)
 *   2. Handle extracted from URL path
 *   3. Explicit handle field
 *
 * Returns the cache entry if found, null otherwise.
 */
export function findSubscriptionMatch(
  map: SubscriptionLookupMap,
  input: SubscriptionMatchInput
): SubscriptionCacheEntry | null {
  if (!input.authorUrl && !input.handle) return null;
  if (input.platform === 'post') return null;

  // 1. URL-based match (with full normalization)
  if (input.authorUrl) {
    const normalized = normalizeAuthorUrl(input.authorUrl, input.platform as Platform);
    const normalizedUrl = normalized.url || normalizeUrlForComparison(input.authorUrl);
    const urlKey = `${input.platform}:${normalizedUrl}`;
    if (map.has(urlKey)) {
      return map.get(urlKey) ?? null;
    }

    // 2. Handle extracted by normalizeAuthorUrl from URL
    const extractedHandle = normalized.handle || (() => {
      try {
        const url = new URL(input.authorUrl);
        const parts = url.pathname.split('/').filter(Boolean);
        return parts[parts.length - 1]?.toLowerCase().replace(/^@/, '') ?? null;
      } catch {
        return null;
      }
    })();

    if (extractedHandle) {
      const handleKey = `${input.platform}:handle:${extractedHandle}`;
      if (map.has(handleKey)) {
        return map.get(handleKey) ?? null;
      }
    }
  }

  // 3. Explicit handle field fallback
  if (input.handle) {
    const h = normalizeHandle(input.handle);
    const handleKey = `${input.platform}:handle:${h}`;
    if (map.has(handleKey)) {
      return map.get(handleKey) ?? null;
    }
  }

  return null;
}

/**
 * Convenience: returns true if the author has an active subscription in the lookup.
 */
export function isAuthorInLookup(
  map: SubscriptionLookupMap,
  input: SubscriptionMatchInput
): boolean {
  return findSubscriptionMatch(map, input) !== null;
}
