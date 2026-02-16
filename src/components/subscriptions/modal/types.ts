/**
 * Add Subscription Modal Types
 *
 * @deprecated These types are deprecated and will be removed in the next major version.
 * Use types from `@/types/profile-crawl` instead:
 * - ProfileCrawlOptions for crawl configuration
 * - ProfileSubscribeOptions for subscription settings
 * - CrawlError for error handling
 *
 * Defines types for the multi-step wizard modal
 */

import type { ValidationResult, ProfileMetadata, PostSummary } from '@/services/ProfileValidationPoller';
import type { Subscription, SubscriptionManager } from '@/services/SubscriptionManager';
import { DEFAULT_ARCHIVE_PATH } from '@/shared/constants';

// ============================================================================
// Wizard Types
// ============================================================================

/** Wizard step states */
export type WizardStep = 'url-input' | 'validating' | 'profile-preview' | 'error';

/** Error information for display */
export interface WizardError {
  code: string;
  title: string;
  message: string;
  suggestion?: string;
  canRetry: boolean;
  retryDelay?: number;
}

/** Schedule configuration */
export interface ScheduleConfig {
  frequency: 'daily'; // MVP: daily only
  time: string; // HH:MM format
  timezone: string;
}

/** Destination configuration */
export interface DestinationConfig {
  folder: string;
  templateId?: string;
}

/** Wizard data shared across steps */
export interface WizardData {
  url: string;
  platform: 'instagram' | 'x' | null;
  username: string | null;
  validationResult: ValidationResult | null;
  scheduleConfig: ScheduleConfig;
  destinationConfig: DestinationConfig;
  error: WizardError | null;
}

/** Default wizard data */
export const DEFAULT_WIZARD_DATA: WizardData = {
  url: '',
  platform: null,
  username: null,
  validationResult: null,
  scheduleConfig: {
    frequency: 'daily',
    time: '09:00',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  },
  destinationConfig: {
    folder: DEFAULT_ARCHIVE_PATH,
  },
  error: null,
};

// ============================================================================
// Component Props
// ============================================================================

/** Main modal props */
export interface AddSubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubscriptionCreated: (subscription: Subscription) => void;
  apiBaseUrl: string;
  authToken?: string;
  licenseKey?: string;
  subscriptionManager?: SubscriptionManager;
}

/** URL Input step props */
export interface URLInputStepProps {
  initialUrl: string;
  onValidate: (url: string, platform: 'instagram' | 'x', username: string) => void;
  onCancel: () => void;
}

/** Validating step props */
export interface ValidatingStepProps {
  profileUrl: string;
  onComplete: (result: ValidationResult) => void;
  onError: (error: WizardError) => void;
  onCancel: () => void;
  apiBaseUrl: string;
  authToken?: string;
}

/** Profile preview step props */
export interface ProfilePreviewStepProps {
  validationResult: ValidationResult;
  scheduleConfig: ScheduleConfig;
  destinationConfig: DestinationConfig;
  onScheduleChange: (config: ScheduleConfig) => void;
  onDestinationChange: (config: DestinationConfig) => void;
  onSubscribe: () => void;
  onBack: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

/** Error step props */
export interface ErrorStepProps {
  error: WizardError;
  originalUrl: string;
  onRetry: () => void;
  onBack: () => void;
  onClose: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

/** Format follower count (1234 -> 1.2K) */
export function formatFollowerCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return count.toString();
}

/** Build cron expression from time (HH:MM -> cron) */
export function buildCronFromTime(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  return `${minutes} ${hours} * * *`; // At HH:MM every day
}

/**
 * Validate Instagram URL and extract username
 *
 * @deprecated Use `parseInstagramUrl` from `@/utils/urlAnalysis` instead.
 * This function is kept for backward compatibility and will be removed in the next major version.
 */
export { parseInstagramUrl, parseXUrl, parseProfileUrl } from '@/utils/urlAnalysis';
