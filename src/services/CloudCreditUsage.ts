import type { BillingUsageResponse, CloudCreditQuotaSummary } from './WorkersAPIClient';

export type CloudCreditCategoryUsage = {
  readonly used: number;
  readonly reserved: number;
};

export type CloudCreditBreakdown = {
  readonly ai: CloudCreditCategoryUsage;
  readonly googleMaps: CloudCreditCategoryUsage;
};

export function resolveCloudCreditQuota(
  usage: Pick<BillingUsageResponse, 'cloudCreditQuota' | 'aiActionQuota'> | null | undefined,
): CloudCreditQuotaSummary | undefined {
  return usage?.cloudCreditQuota ?? usage?.aiActionQuota;
}

export function getCloudCreditBreakdown(
  quota: CloudCreditQuotaSummary | null | undefined,
): CloudCreditBreakdown {
  const result = {
    ai: { used: 0, reserved: 0 },
    googleMaps: { used: 0, reserved: 0 },
  };
  for (const item of quota?.breakdown ?? []) {
    const category = item.actionType === 'maps.google_text_search' ? result.googleMaps : result.ai;
    category.used += item.used;
    category.reserved += item.reserved;
  }
  return result;
}
