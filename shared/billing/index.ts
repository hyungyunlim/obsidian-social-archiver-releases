/**
 * Billing Shared - Barrel Export
 *
 * This file is copied to client targets at build time.
 * To modify, edit this source file and run: npm run sync:shared
 */

export type {
  BillingCampaignConfig,
  BillingPlanCampaign,
  BillingPlanKey,
  LocalizedText,
} from './campaign';
export {
  DEFAULT_BILLING_CAMPAIGN,
  getCampaignForPlan,
  validateBillingCampaignConfig,
} from './campaign';
export {
  mapRevenueCatIdentifierToPlan,
  mapServerPlanToCampaignPlan,
  mapToBillingInterval,
  mapStoreIdentifier,
} from './planMapping';
export type { BillingInterval, BillingStoreIdentifier } from './planMapping';
