/**
 * Billing Campaign Config - Single Source of Truth
 *
 * This file is copied to client targets at build time.
 * To modify, edit this source file and run: npm run sync:shared
 *
 * See PRD: .taskmaster/docs/prd-billing-launch-offer-copy.md
 */

export type BillingPlanKey = 'monthly' | 'annual' | 'lifetime';

export type LocalizedText = string | Partial<Record<'en' | 'ko', string>>;

export type BillingPlanCampaign = {
  label: string | null;
  shortDescription: string;
  detail: string | null;
  limitedAvailability: boolean;
  showCompareAtPrice: false;
  showDiscountPercent: false;
  showInventoryCount: false;
  endsAt: null;
  /**
   * Bytes a buyer of this plan gets in media storage. `null` means the value
   * is unknown / should be hidden in the UI; positive numbers render as
   * formatted byte strings (e.g. "50 GB"). The bundled default leaves this
   * `null` and the worker injects real values from
   * `StorageQuotaService.DEFAULT_STORAGE_POLICIES` at response time so the
   * client never hardcodes the policy.
   */
  mediaStorageLimitBytes: number | null;
};

export type BillingCampaignConfig = {
  campaignId: string;
  schemaVersion: 1;
  defaultLabel: string;
  priceDisclaimer: string;
  updatedAt: string;
  plans: {
    monthly: BillingPlanCampaign;
    annual: BillingPlanCampaign;
    lifetime: BillingPlanCampaign;
  };
};

export const DEFAULT_BILLING_CAMPAIGN: BillingCampaignConfig = {
  campaignId: 'launch-2026',
  schemaVersion: 1,
  defaultLabel: 'Launch price',
  priceDisclaimer:
    'Prices may vary by country, currency, store, and taxes. The final price is shown before purchase.',
  updatedAt: '2026-04-30T00:00:00Z',
  plans: {
    monthly: {
      label: 'Launch price',
      shortDescription: 'Flexible Premium access during launch.',
      detail: null,
      limitedAvailability: false,
      showCompareAtPrice: false,
      showDiscountPercent: false,
      showInventoryCount: false,
      endsAt: null,
      mediaStorageLimitBytes: null,
    },
    annual: {
      label: 'Launch price',
      shortDescription: 'Yearly Premium access at launch pricing.',
      detail: null,
      limitedAvailability: false,
      showCompareAtPrice: false,
      showDiscountPercent: false,
      showInventoryCount: false,
      endsAt: null,
      mediaStorageLimitBytes: null,
    },
    lifetime: {
      label: 'Limited founding offer',
      shortDescription: 'One-time Premium access while this launch offer is available.',
      detail:
        'Lifetime may be removed or repriced after launch. No monthly archive limit while your entitlement remains active.',
      limitedAvailability: true,
      showCompareAtPrice: false,
      showDiscountPercent: false,
      showInventoryCount: false,
      endsAt: null,
      mediaStorageLimitBytes: null,
    },
  },
};

const PLAN_KEYS: BillingPlanKey[] = ['monthly', 'annual', 'lifetime'];

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isStrictFalse(value: unknown): value is false {
  return value === false;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function validatePlan(value: unknown): BillingPlanCampaign | null {
  if (!value || typeof value !== 'object') return null;
  const plan = value as Record<string, unknown>;

  if (!isNullableString(plan.label)) return null;
  if (!isString(plan.shortDescription)) return null;
  if (!isNullableString(plan.detail)) return null;
  if (typeof plan.limitedAvailability !== 'boolean') return null;

  // V1 hard invariants — reject configs that try to enable forbidden surfaces.
  if (!isStrictFalse(plan.showCompareAtPrice)) return null;
  if (!isStrictFalse(plan.showDiscountPercent)) return null;
  if (!isStrictFalse(plan.showInventoryCount)) return null;
  if (plan.endsAt !== null) return null;

  // mediaStorageLimitBytes: null = hidden; positive finite number = bytes.
  // Reject negative / non-finite to keep the UI from rendering "-1 GB" or NaN.
  let mediaStorageLimitBytes: number | null = null;
  if (plan.mediaStorageLimitBytes !== undefined && plan.mediaStorageLimitBytes !== null) {
    if (typeof plan.mediaStorageLimitBytes !== 'number') return null;
    if (!Number.isFinite(plan.mediaStorageLimitBytes)) return null;
    if (plan.mediaStorageLimitBytes < 0) return null;
    mediaStorageLimitBytes = plan.mediaStorageLimitBytes;
  }

  return {
    label: plan.label,
    shortDescription: plan.shortDescription,
    detail: plan.detail,
    limitedAvailability: plan.limitedAvailability,
    showCompareAtPrice: false,
    showDiscountPercent: false,
    showInventoryCount: false,
    endsAt: null,
    mediaStorageLimitBytes,
  };
}

/**
 * Validate a billing campaign config from an untrusted source (server JSON, etc).
 * Returns the validated config, or null if any field is invalid OR if the config
 * tries to enable forbidden V1 features (inventory count, discount %, compare-at,
 * ends-at countdown). Callers MUST fall back to the bundled default on null.
 */
export function validateBillingCampaignConfig(
  input: unknown,
): BillingCampaignConfig | null {
  if (!input || typeof input !== 'object') return null;
  const config = input as Record<string, unknown>;

  if (!isString(config.campaignId) || config.campaignId.length === 0) return null;
  if (config.schemaVersion !== 1) return null;
  if (!isString(config.defaultLabel)) return null;
  if (!isString(config.priceDisclaimer)) return null;
  if (!isString(config.updatedAt)) return null;

  if (!config.plans || typeof config.plans !== 'object') return null;
  const plans = config.plans as Record<string, unknown>;

  const validated: Partial<Record<BillingPlanKey, BillingPlanCampaign>> = {};
  for (const key of PLAN_KEYS) {
    const validatedPlan = validatePlan(plans[key]);
    if (!validatedPlan) return null;
    validated[key] = validatedPlan;
  }

  return {
    campaignId: config.campaignId,
    schemaVersion: 1,
    defaultLabel: config.defaultLabel,
    priceDisclaimer: config.priceDisclaimer,
    updatedAt: config.updatedAt,
    plans: {
      monthly: validated.monthly!,
      annual: validated.annual!,
      lifetime: validated.lifetime!,
    },
  };
}

export function getCampaignForPlan(
  config: BillingCampaignConfig,
  plan: BillingPlanKey | null | undefined,
): BillingPlanCampaign | null {
  if (!plan) return null;
  return config.plans[plan] ?? null;
}
