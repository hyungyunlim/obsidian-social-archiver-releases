<script lang="ts">
/**
 * ErrorStep - Error Display with Recovery Actions
 *
 * @deprecated This component is deprecated and will be removed in the next major version.
 * Use ArchiveModal instead which handles error display with CrawlError types.
 *
 * Features:
 * - Contextual error messages
 * - Helpful suggestions
 * - Retry and back navigation
 * - Rate limit countdown
 */

import type { ErrorStepProps } from './types';

let {
  error,
  originalUrl,
  onRetry,
  onBack,
  onClose,
}: ErrorStepProps = $props();

let retryCountdown = $state(error.retryDelay || 0);
let countdownInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Derived: Can retry now
 */
const canRetry = $derived(error.canRetry && retryCountdown <= 0);

/**
 * Get error icon based on error code
 */
function getErrorIcon(code: string): string {
  switch (code) {
    case 'PROFILE_NOT_FOUND':
      return 'user-x';
    case 'PRIVATE_PROFILE':
      return 'lock';
    case 'RATE_LIMITED':
      return 'clock';
    case 'NETWORK_ERROR':
      return 'wifi-off';
    default:
      return 'alert-triangle';
  }
}

/**
 * Start countdown for retry delay
 */
function startCountdown(): void {
  if (error.retryDelay && error.retryDelay > 0) {
    retryCountdown = error.retryDelay;
    countdownInterval = setInterval(() => {
      retryCountdown--;
      if (retryCountdown <= 0) {
        stopCountdown();
      }
    }, 1000);
  }
}

/**
 * Stop countdown
 */
function stopCountdown(): void {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

/**
 * Handle retry
 */
function handleRetry(): void {
  if (canRetry) {
    onRetry();
  }
}

// Start countdown on mount
$effect(() => {
  startCountdown();
  return () => stopCountdown();
});
</script>

<div class="error-step">
  <div class="step-content">
    <!-- Error Icon -->
    <div class="error-icon-container">
      {#if error.code === 'PROFILE_NOT_FOUND'}
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
          <circle cx="8.5" cy="7" r="4"></circle>
          <line x1="18" y1="8" x2="23" y2="13"></line>
          <line x1="23" y1="8" x2="18" y2="13"></line>
        </svg>
      {:else if error.code === 'PRIVATE_PROFILE'}
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
      {:else if error.code === 'RATE_LIMITED'}
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
      {:else if error.code === 'NETWORK_ERROR'}
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="1" y1="1" x2="23" y2="23"></line>
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
          <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
          <line x1="12" y1="20" x2="12.01" y2="20"></line>
        </svg>
      {:else}
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
      {/if}
    </div>

    <!-- Error Message -->
    <h3 class="error-title">{error.title}</h3>
    <p class="error-message">{error.message}</p>

    <!-- Suggestion -->
    {#if error.suggestion}
      <div class="suggestion-box">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
        <span>{error.suggestion}</span>
      </div>
    {/if}

    <!-- Original URL Reference -->
    <div class="url-reference">
      <span class="url-label">URL:</span>
      <span class="url-value">{originalUrl}</span>
    </div>

    <!-- Countdown Timer -->
    {#if error.canRetry && retryCountdown > 0}
      <div class="countdown">
        <span>You can retry in {retryCountdown} seconds</span>
      </div>
    {/if}
  </div>

  <!-- Footer -->
  <div class="step-footer">
    <button class="btn btn-tertiary" onclick={onClose}>
      Close
    </button>
    <button class="btn btn-secondary" onclick={onBack}>
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="19" y1="12" x2="5" y2="12"></line>
        <polyline points="12 19 5 12 12 5"></polyline>
      </svg>
      Back
    </button>
    {#if error.canRetry}
      <button class="btn btn-primary" onclick={handleRetry} disabled={!canRetry}>
        Try Again
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"></polyline>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
        </svg>
      </button>
    {/if}
  </div>
</div>

<style>
  .error-step {
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
    padding: 40px 20px;
    text-align: center;
  }

  .error-icon-container {
    width: 80px;
    height: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--background-modifier-error, rgba(255, 82, 82, 0.1));
    border-radius: 50%;
    margin-bottom: 20px;
    color: var(--text-error);
  }

  .error-title {
    margin: 0 0 8px 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--text-normal);
  }

  .error-message {
    margin: 0 0 20px 0;
    font-size: 14px;
    color: var(--text-muted);
    max-width: 320px;
    line-height: 1.5;
  }

  .suggestion-box {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 16px;
    background: var(--background-secondary);
    border-radius: 8px;
    margin-bottom: 20px;
    text-align: left;
    max-width: 320px;
  }

  .suggestion-box svg {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--text-accent);
  }

  .suggestion-box span {
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .url-reference {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--background-modifier-border);
    border-radius: 6px;
    font-size: 12px;
    margin-bottom: 16px;
    max-width: 100%;
    overflow: hidden;
  }

  .url-label {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .url-value {
    color: var(--text-normal);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .countdown {
    font-size: 13px;
    color: var(--text-muted);
    padding: 8px 16px;
    background: var(--background-secondary);
    border-radius: 6px;
  }

  /* Footer */
  .step-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
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

  .btn-tertiary {
    background: transparent;
    color: var(--text-muted);
  }

  .btn-tertiary:hover {
    color: var(--text-normal);
    background: var(--background-modifier-hover);
  }

  .btn-secondary {
    background: var(--background-modifier-border);
    color: var(--text-normal);
  }

  .btn-secondary:hover {
    background: var(--background-modifier-hover);
  }

  .btn-primary {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  .btn-primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
