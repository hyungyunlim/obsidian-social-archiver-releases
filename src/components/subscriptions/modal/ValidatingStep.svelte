<script lang="ts">
/**
 * ValidatingStep - Progress Indicator During Profile Validation
 *
 * @deprecated This component is deprecated and will be removed in the next major version.
 * Use ArchiveModal instead which handles validation states internally.
 *
 * Features:
 * - Animated spinner and progress bar
 * - Dynamic status messages
 * - Cancel functionality with AbortController
 */

import type { ValidatingStepProps, WizardError } from './types';
import { ProfileValidationPoller, ProfileValidationError } from '@/services/ProfileValidationPoller';
import { getValidationErrorMessage } from '@/types/validation-errors';

let {
  profileUrl,
  onComplete,
  onError,
  onCancel,
  apiBaseUrl,
  authToken,
}: ValidatingStepProps = $props();

let progress = $state(0);
let statusMessage = $state('Initializing...');
let poller: ProfileValidationPoller | null = null;
let triggerController: AbortController | null = null;

/**
 * Status messages based on progress
 */
function getStatusMessage(p: number): string {
  if (p < 20) return 'Connecting to Instagram...';
  if (p < 50) return 'Fetching profile information...';
  if (p < 80) return 'Loading recent posts...';
  return 'Finalizing...';
}

/**
 * Start validation
 */
async function startValidation(): Promise<void> {
  progress = 0;
  statusMessage = getStatusMessage(0);

  try {
    // Step 1: Trigger validation via API
    progress = 10;
    statusMessage = getStatusMessage(10);

    triggerController = new AbortController();

    const triggerResponse = await fetch(`${apiBaseUrl}/api/subscriptions/validate-profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ profileUrl }),
      signal: triggerController.signal,
    });

    if (!triggerResponse.ok) {
      const errorData = await triggerResponse.json().catch(() => ({}));
      throw new ProfileValidationError(
        errorData.error?.code || 'CRAWL_FAILED',
        errorData.error?.message || `HTTP ${triggerResponse.status}`
      );
    }

    const triggerData = await triggerResponse.json();

    if (!triggerData.success || !triggerData.data?.snapshotId) {
      throw new ProfileValidationError(
        triggerData.error?.code || 'INVALID_RESPONSE',
        triggerData.error?.message || 'Failed to start validation'
      );
    }

    // Step 2: Poll for completion
    progress = 20;
    statusMessage = getStatusMessage(20);

    poller = new ProfileValidationPoller({
      apiBaseUrl,
      authToken: authToken || '',
      pollingInterval: 2000,
      timeout: 60000, // 60 seconds
      onProgress: (status, elapsed) => {
        // Update progress based on status and elapsed time
        const maxTime = 60000;
        const elapsedProgress = Math.min(80, 20 + (elapsed / maxTime) * 60);
        progress = elapsedProgress;
        statusMessage = getStatusMessage(progress);

        if (status === 'processing') {
          statusMessage = 'Processing profile data...';
        }
      },
    });

    const result = await poller.poll(triggerData.data.snapshotId);

    // Success
    progress = 100;
    statusMessage = 'Complete!';

    setTimeout(() => {
      onComplete(result);
    }, 300);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return;
    }
    console.error('[ValidatingStep] Validation failed:', error);

    if (error instanceof ProfileValidationError) {
      const errorMessage = getValidationErrorMessage(error.code);
      onError({
        code: error.code,
        title: errorMessage.title,
        message: errorMessage.message,
        suggestion: errorMessage.suggestion,
        canRetry: errorMessage.canRetry,
        retryDelay: errorMessage.retryDelay,
      });
    } else {
      onError({
        code: 'UNKNOWN_ERROR',
        title: 'Validation Failed',
        message: (error as Error).message || 'An unexpected error occurred',
        suggestion: 'Please try again. If the problem persists, contact support.',
        canRetry: true,
      });
    }
  }
}

/**
 * Handle cancel
 */
function handleCancel(): void {
  if (triggerController) {
    triggerController.abort();
    triggerController = null;
  }
  if (poller) {
    poller.abort();
    poller = null;
  }
  onCancel();
}

// Start validation on mount
$effect(() => {
  startValidation();

  return () => {
    if (poller) {
      poller.abort();
      poller = null;
    }
    if (triggerController) {
      triggerController.abort();
      triggerController = null;
    }
  };
});
</script>

<div class="validating-step">
  <div class="step-content">
    <!-- Spinner -->
    <div class="spinner-container">
      <div class="spinner">
        <div class="spinner-ring"></div>
        <div class="spinner-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
            <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
            <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
          </svg>
        </div>
      </div>
    </div>

    <!-- Status Message -->
    <h3 class="status-title">{statusMessage}</h3>

    <!-- Progress Bar -->
    <div class="progress-container">
      <div class="progress-bar">
        <div class="progress-fill" style="width: {progress}%"></div>
      </div>
      <span class="progress-text">{Math.round(progress)}%</span>
    </div>

    <!-- Time Estimate -->
    <p class="time-estimate">This may take 10-30 seconds</p>
  </div>

  <!-- Footer -->
  <div class="step-footer">
    <button class="btn btn-secondary" onclick={handleCancel}>
      Cancel
    </button>
  </div>
</div>

<style>
  .validating-step {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 300px;
  }

  .step-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    text-align: center;
  }

  .spinner-container {
    margin-bottom: 24px;
  }

  .spinner {
    position: relative;
    width: 80px;
    height: 80px;
  }

  .spinner-ring {
    position: absolute;
    inset: 0;
    border: 3px solid var(--background-modifier-border);
    border-top-color: var(--interactive-accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .spinner-icon {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .status-title {
    margin: 0 0 20px 0;
    font-size: 16px;
    font-weight: 500;
    color: var(--text-normal);
  }

  .progress-container {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    max-width: 300px;
    margin-bottom: 12px;
  }

  .progress-bar {
    flex: 1;
    height: 6px;
    background: var(--background-modifier-border);
    border-radius: 3px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--interactive-accent);
    border-radius: 3px;
    transition: width 0.3s ease;
  }

  .progress-text {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-muted);
    min-width: 40px;
  }

  .time-estimate {
    margin: 0;
    font-size: 13px;
    color: var(--text-muted);
  }

  .step-footer {
    display: flex;
    justify-content: center;
    padding: 16px 20px;
    border-top: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 18px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    border: none;
  }

  .btn-secondary {
    background: var(--background-modifier-border);
    color: var(--text-normal);
  }

  .btn-secondary:hover {
    background: var(--background-modifier-hover);
  }
</style>
