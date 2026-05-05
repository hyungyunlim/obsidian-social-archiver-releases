/**
 * AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
 *
 * Source: shared/billing/planMapping.ts
 * Generated: 2026-05-05T23:48:37.592Z
 *
 * To modify, edit the source file in shared/billing/ and run:
 *   npm run sync:shared
 */

/**
 * Plan Mapping Helpers - Single Source of Truth
 *
 * This file is copied to client targets at build time.
 * To modify, edit this source file and run: npm run sync:shared
 */

import type { BillingPlanKey } from './campaign';

const RC_PRESET_TO_PLAN: Record<string, BillingPlanKey> = {
  $rc_monthly: 'monthly',
  $rc_annual: 'annual',
  $rc_lifetime: 'lifetime',
  $rc_six_month: 'annual',
  $rc_three_month: 'annual',
  $rc_two_month: 'monthly',
  $rc_weekly: 'monthly',
};

/**
 * Map a RevenueCat package identifier (or product identifier / package type)
 * to a campaign plan key. Returns null when the package cannot be classified
 * (in which case callers should fall back to no campaign label).
 *
 * Matching is case-insensitive and substring-based to tolerate both the
 * RevenueCat preset identifiers ($rc_monthly, etc.) and custom store SKUs
 * (e.g. com.app.premium_lifetime).
 */
export function mapRevenueCatIdentifierToPlan(
  identifier: string,
  ...extraHints: Array<string | null | undefined>
): BillingPlanKey | null {
  const presetMatch = RC_PRESET_TO_PLAN[identifier];
  if (presetMatch) return presetMatch;

  const haystack = [identifier, ...extraHints]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();

  if (!haystack) return null;
  if (haystack.includes('lifetime')) return 'lifetime';
  if (haystack.includes('annual') || haystack.includes('yearly')) return 'annual';
  if (haystack.includes('monthly') || haystack.includes('month')) return 'monthly';
  return null;
}

/**
 * Map a server-side plan label (`free` / `premium` / `lifetime`) to a campaign
 * plan key. Returns null for `free` and for `premium` because the server cannot
 * distinguish monthly vs annual subscribers — callers should fall back to the
 * config's `defaultLabel`.
 */
export function mapServerPlanToCampaignPlan(
  plan: string | null | undefined,
): BillingPlanKey | null {
  if (!plan) return null;
  if (plan === 'lifetime') return 'lifetime';
  return null;
}

/**
 * UI-facing billing interval. `unknown` is used when no hint matches a known
 * pattern, so callers can render conservative copy.
 */
export type BillingInterval = 'monthly' | 'annual' | 'lifetime' | 'unknown';

/**
 * Map RevenueCat package/product identifiers to the UI billing interval.
 * Accepts multiple hints (package id, product id, store id, entitlement id);
 * the first hint that matches a known preset wins, otherwise we fall back to
 * a substring scan over the joined hints.
 *
 * Matching is case-insensitive. Lifetime takes precedence over annual,
 * which takes precedence over monthly, to avoid mis-classifying products
 * like `social_archiver_premium_monthly` because the string also contains
 * the substring `premium`.
 */
export function mapToBillingInterval(
  ...hints: Array<string | null | undefined>
): BillingInterval {
  // Preset shortcut: the first hint that maps to a BillingPlanKey wins.
  for (const hint of hints) {
    if (typeof hint !== 'string') continue;
    const trimmed = hint.trim();
    if (!trimmed) continue;
    const preset = RC_PRESET_TO_PLAN[trimmed];
    if (preset) return preset;
  }

  const haystack = hints
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();

  if (!haystack) return 'unknown';

  // Lifetime first — it must beat annual/monthly substring matches even when
  // the SKU bundles tokens like `lifetime_premium`.
  if (haystack.includes('lifetime') || haystack.includes('life_time') || haystack.includes('life-time')) {
    return 'lifetime';
  }

  if (
    haystack.includes('annual') ||
    haystack.includes('yearly') ||
    haystack.includes('six_month') ||
    haystack.includes('three_month')
  ) {
    return 'annual';
  }

  if (
    haystack.includes('monthly') ||
    haystack.includes('weekly') ||
    haystack.includes('two_month')
  ) {
    return 'monthly';
  }

  return 'unknown';
}

/**
 * Normalized store identifier for the server billing metadata column.
 * RevenueCat sends values like `APP_STORE`, `PLAY_STORE`, `STRIPE`,
 * `PROMOTIONAL`, etc. Anything we don't recognize becomes `unknown`.
 */
export type BillingStoreIdentifier =
  | 'app_store'
  | 'play_store'
  | 'stripe'
  | 'promotional'
  | 'unknown';

const STORE_IDENTIFIER_MAP: Record<string, BillingStoreIdentifier> = {
  app_store: 'app_store',
  appstore: 'app_store',
  ios: 'app_store',
  mac_app_store: 'app_store',
  play_store: 'play_store',
  playstore: 'play_store',
  google_play: 'play_store',
  android: 'play_store',
  stripe: 'stripe',
  promotional: 'promotional',
  promo: 'promotional',
};

export function mapStoreIdentifier(
  rcStoreField: string | null | undefined,
): BillingStoreIdentifier {
  if (typeof rcStoreField !== 'string') return 'unknown';
  const normalized = rcStoreField.trim().toLowerCase();
  if (!normalized) return 'unknown';
  return STORE_IDENTIFIER_MAP[normalized] ?? 'unknown';
}
