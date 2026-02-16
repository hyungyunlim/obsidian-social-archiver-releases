/**
 * Add Subscription Modal Components
 *
 * @deprecated All components in this module are deprecated and will be removed in the next major version.
 * Use ArchiveModal from `@/modals/ArchiveModal` instead which provides unified profile archiving
 * and subscription functionality.
 *
 * Migration guide:
 * - AddSubscriptionModal → ArchiveModal
 * - URLInputStep → Handled internally by ArchiveModal
 * - ValidatingStep → Handled internally by ArchiveModal
 * - ProfilePreviewStep → Handled internally by ArchiveModal
 * - ErrorStep → Use CrawlError types from @/types/profile-crawl
 * - parseInstagramUrl → Use parseInstagramUrl from @/utils/urlAnalysis
 *
 * Multi-step wizard for adding new profile subscriptions
 */

// Main modal component
/** @deprecated Use ArchiveModal instead */
export { default as AddSubscriptionModal } from './AddSubscriptionModal.svelte';

// Step components
/** @deprecated Use ArchiveModal instead */
export { default as URLInputStep } from './URLInputStep.svelte';
/** @deprecated Use ArchiveModal instead */
export { default as ValidatingStep } from './ValidatingStep.svelte';
/** @deprecated Use ArchiveModal instead */
export { default as ProfilePreviewStep } from './ProfilePreviewStep.svelte';
/** @deprecated Use ArchiveModal instead - error handling uses CrawlError from @/types/profile-crawl */
export { default as ErrorStep } from './ErrorStep.svelte';

// Types
/** @deprecated Use types from @/types/profile-crawl instead */
export type {
  WizardStep,
  WizardError,
  WizardData,
  ScheduleConfig,
  DestinationConfig,
  AddSubscriptionModalProps,
  URLInputStepProps,
  ValidatingStepProps,
  ProfilePreviewStepProps,
  ErrorStepProps,
} from './types';

// Helpers
export {
  DEFAULT_WIZARD_DATA,
  formatFollowerCount,
  buildCronFromTime,
} from './types';

/**
 * @deprecated Use parseInstagramUrl from @/utils/urlAnalysis instead
 */
export { parseInstagramUrl } from '@/utils/urlAnalysis';
