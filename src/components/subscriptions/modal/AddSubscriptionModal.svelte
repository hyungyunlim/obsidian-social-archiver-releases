<script lang="ts">
/**
 * AddSubscriptionModal - Multi-step Wizard for Adding Subscriptions
 *
 * @deprecated This component is deprecated and will be removed in the next major version.
 * Use ArchiveModal instead which provides unified profile archiving and subscription functionality.
 *
 * Migration guide:
 * - Replace AddSubscriptionModal with ArchiveModal
 * - Use ArchiveModal's subscribe options to create subscriptions
 * - Profile URL validation is handled automatically by ArchiveModal
 *
 * Steps:
 * 1. URL Input - Enter Instagram profile URL
 * 2. Validating - Progress indicator during validation
 * 3. Profile Preview - Confirm profile and configure schedule
 * 4. Error - Display errors with retry options
 */

import type { Subscription } from '@/services/SubscriptionManager';
import type { ValidationResult } from '@/services/ProfileValidationPoller';
import type {
  WizardStep,
  WizardData,
  WizardError,
  ScheduleConfig,
  DestinationConfig,
  AddSubscriptionModalProps,
} from './types';
import { DEFAULT_WIZARD_DATA, buildCronFromTime } from './types';
import URLInputStep from './URLInputStep.svelte';
import ValidatingStep from './ValidatingStep.svelte';
import ProfilePreviewStep from './ProfilePreviewStep.svelte';
import ErrorStep from './ErrorStep.svelte';

let {
  isOpen,
  onClose,
  onSubscriptionCreated,
  apiBaseUrl,
  authToken,
  licenseKey,
  subscriptionManager,
}: AddSubscriptionModalProps = $props();

/**
 * Wizard state
 */
let currentStep = $state<WizardStep>('url-input');
let wizardData = $state<WizardData>({ ...DEFAULT_WIZARD_DATA });
let isSubmitting = $state(false);

/**
 * Abort controller for canceling validation
 */
let abortController: AbortController | null = null;

/**
 * Step indicator text
 */
const stepIndicators: Record<WizardStep, string> = {
  'url-input': '1/3',
  'validating': '2/3',
  'profile-preview': '3/3',
  'error': '',
};

/**
 * Step title text
 */
const stepTitles: Record<WizardStep, string> = {
  'url-input': 'Add Subscription',
  'validating': 'Validating Profile',
  'profile-preview': 'Confirm Subscription',
  'error': 'Error',
};

/**
 * Reset wizard to initial state
 */
function reset(): void {
  currentStep = 'url-input';
  wizardData = { ...DEFAULT_WIZARD_DATA };
  isSubmitting = false;
  abortController?.abort();
  abortController = null;
}

/**
 * Handle modal close
 */
function handleClose(): void {
  reset();
  onClose();
}

/**
 * Handle URL validation submission
 */
function handleValidate(url: string, platform: 'instagram', username: string): void {
  wizardData = {
    ...wizardData,
    url,
    platform,
    username,
    destinationConfig: {
      ...wizardData.destinationConfig,
      folder: `Social Archives/Instagram/${username}`,
    },
  };
  currentStep = 'validating';
}

/**
 * Handle validation complete
 */
function handleValidationComplete(result: ValidationResult): void {
  wizardData = {
    ...wizardData,
    validationResult: result,
    error: null,
  };
  currentStep = 'profile-preview';
}

/**
 * Handle validation error
 */
function handleValidationError(error: WizardError): void {
  wizardData = {
    ...wizardData,
    error,
    validationResult: null,
  };
  currentStep = 'error';
}

/**
 * Handle cancel during validation
 */
function handleValidationCancel(): void {
  abortController?.abort();
  currentStep = 'url-input';
}

/**
 * Handle schedule config change
 */
function handleScheduleChange(config: ScheduleConfig): void {
  wizardData = { ...wizardData, scheduleConfig: config };
}

/**
 * Handle destination config change
 */
function handleDestinationChange(config: DestinationConfig): void {
  wizardData = { ...wizardData, destinationConfig: config };
}

/**
 * Handle subscription creation
 */
async function handleSubscribe(): Promise<void> {
  if (!wizardData.validationResult || !wizardData.username) {
    return;
  }

  isSubmitting = true;

  try {
    // Prefer injected manager to avoid redundant initialization
    const manager =
      subscriptionManager ||
      new (await import('@/services/SubscriptionManager')).SubscriptionManager({
        apiBaseUrl,
        authToken,
        licenseKey,
      });

    let shouldDispose = false;

    if (!subscriptionManager) {
      await manager.initialize();
      shouldDispose = true;
    }

    const subscription = await manager.addSubscription({
      name: wizardData.validationResult.profileMetadata.displayName || wizardData.username,
      platform: 'instagram',
      target: {
        handle: wizardData.username,
        profileUrl: `https://www.instagram.com/${wizardData.username}/`,
      },
      schedule: {
        cron: buildCronFromTime(wizardData.scheduleConfig.time),
        timezone: wizardData.scheduleConfig.timezone,
      },
        destination: {
          folder: wizardData.destinationConfig.folder,
          templateId: wizardData.destinationConfig.templateId,
        },
      });

    if (shouldDispose) {
      await manager.dispose();
    }

    onSubscriptionCreated(subscription);
    handleClose();
  } catch (error) {
    console.error('[AddSubscriptionModal] Failed to create subscription:', error);
    handleValidationError({
      code: 'CREATE_FAILED',
      title: 'Subscription Failed',
      message: (error as Error).message || 'Failed to create subscription',
      suggestion: 'Please try again. If the problem persists, check your connection.',
      canRetry: true,
    });
  } finally {
    isSubmitting = false;
  }
}

/**
 * Handle back navigation
 */
function handleBack(): void {
  if (currentStep === 'profile-preview' || currentStep === 'error') {
    currentStep = 'url-input';
    wizardData = { ...wizardData, error: null };
  }
}

/**
 * Handle retry
 */
function handleRetry(): void {
  if (wizardData.url) {
    currentStep = 'validating';
    wizardData = { ...wizardData, error: null };
  }
}

/**
 * Handle keyboard events
 */
function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    handleClose();
  }
}

/**
 * Handle backdrop click
 */
function handleBackdropClick(event: MouseEvent): void {
  if ((event.target as HTMLElement).classList.contains('modal-backdrop')) {
    handleClose();
  }
}

// Reset when modal opens
$effect(() => {
  if (isOpen) {
    reset();
  }
});
</script>

{#if isOpen}
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="modal-title"
    tabindex="-1"
    onclick={handleBackdropClick}
    onkeydown={handleKeydown}
  >
    <div class="modal-container">
      <!-- Header -->
      <div class="modal-header">
        <div class="header-left">
          {#if stepIndicators[currentStep]}
            <span class="step-indicator">{stepIndicators[currentStep]}</span>
          {/if}
          <h2 id="modal-title">{stepTitles[currentStep]}</h2>
        </div>
        <button
          class="close-btn"
          onclick={handleClose}
          aria-label="Close modal"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <!-- Content -->
      <div class="modal-content">
        {#if currentStep === 'url-input'}
          <URLInputStep
            initialUrl={wizardData.url}
            onValidate={handleValidate}
            onCancel={handleClose}
          />
        {:else if currentStep === 'validating'}
          <ValidatingStep
            profileUrl={wizardData.url}
            onComplete={handleValidationComplete}
            onError={handleValidationError}
            onCancel={handleValidationCancel}
            {apiBaseUrl}
            {authToken}
          />
        {:else if currentStep === 'profile-preview' && wizardData.validationResult}
          <ProfilePreviewStep
            validationResult={wizardData.validationResult}
            scheduleConfig={wizardData.scheduleConfig}
            destinationConfig={wizardData.destinationConfig}
            onScheduleChange={handleScheduleChange}
            onDestinationChange={handleDestinationChange}
            onSubscribe={handleSubscribe}
            onBack={handleBack}
            onCancel={handleClose}
            {isSubmitting}
          />
        {:else if currentStep === 'error' && wizardData.error}
          <ErrorStep
            error={wizardData.error}
            originalUrl={wizardData.url}
            onRetry={handleRetry}
            onBack={handleBack}
            onClose={handleClose}
          />
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
  }

  .modal-container {
    background: var(--background-primary);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    width: 100%;
    max-width: 480px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .step-indicator {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
  }

  .modal-header h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--text-normal);
  }

  .close-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-btn:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .modal-content {
    flex: 1;
    overflow-y: auto;
  }
</style>
