<script lang="ts">
/**
 * SubscriptionActions - Action Buttons for Subscription Row
 *
 * Provides action buttons for managing a subscription:
 * - View history (crawl history panel)
 * - Pause/Resume toggle
 * - Manual run (retry for errors)
 * - Edit settings
 * - Delete subscription
 *
 * Single Responsibility: Render and dispatch subscription action events
 */

import type { SubscriptionDisplay } from './MySubscriptionsList.svelte';

/**
 * Component props
 */
interface SubscriptionActionsProps {
  subscription: SubscriptionDisplay;
  compact?: boolean;
  onTogglePause?: (subscription: SubscriptionDisplay) => void;
  onManualRun?: (subscription: SubscriptionDisplay) => void;
  onViewHistory?: (subscription: SubscriptionDisplay) => void;
  onEdit?: (subscription: SubscriptionDisplay) => void;
  onDelete?: (subscription: SubscriptionDisplay) => void;
}

let {
  subscription,
  compact = false,
  onTogglePause,
  onManualRun,
  onViewHistory,
  onEdit,
  onDelete
}: SubscriptionActionsProps = $props();

/**
 * Derived state for conditional button display
 */
const showRetry = $derived(subscription.status === 'error');
const isPaused = $derived(!subscription.enabled);
const isCrawling = $derived(subscription.status === 'crawling');
</script>

<div class="subscription-actions" class:compact>
  <!-- View History -->
  <button
    class="action-btn history"
    onclick={() => onViewHistory?.(subscription)}
    title="View crawl history"
    aria-label="View crawl history"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 3v5h5"/>
      <path d="M21 12A9 9 0 0 0 6 5.3L3 8"/>
      <path d="M21 12A9 9 0 0 1 12 21c-4.97 0-9-4.03-9-9"/>
      <path d="M12 7v5l3 3"/>
    </svg>
    {#if !compact}
      <span>History</span>
    {/if}
  </button>

  <!-- Pause/Resume Toggle -->
  <button
    class="action-btn toggle"
    class:paused={isPaused}
    onclick={() => onTogglePause?.(subscription)}
    title={isPaused ? 'Resume subscription' : 'Pause subscription'}
    aria-label={isPaused ? 'Resume subscription' : 'Pause subscription'}
    disabled={isCrawling}
  >
    {#if isPaused}
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
      {#if !compact}
        <span>Resume</span>
      {/if}
    {:else}
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
        <rect x="6" y="4" width="4" height="16"/>
        <rect x="14" y="4" width="4" height="16"/>
      </svg>
      {#if !compact}
        <span>Pause</span>
      {/if}
    {/if}
  </button>

  <!-- Manual Run / Retry (shown for errors or on-demand) -->
  {#if showRetry || !compact}
    <button
      class="action-btn run"
      class:retry={showRetry}
      onclick={() => onManualRun?.(subscription)}
      title={showRetry ? 'Retry now' : 'Run now'}
      aria-label={showRetry ? 'Retry now' : 'Run now'}
      disabled={isCrawling}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
        <path d="M21 3v5h-5"/>
      </svg>
      {#if !compact}
        <span>{showRetry ? 'Retry' : 'Run'}</span>
      {/if}
    </button>
  {/if}

  <!-- Edit Settings -->
  <button
    class="action-btn edit"
    onclick={() => onEdit?.(subscription)}
    title="Edit subscription"
    aria-label="Edit subscription"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
      <path d="m15 5 4 4"/>
    </svg>
    {#if !compact}
      <span>Edit</span>
    {/if}
  </button>

  <!-- Delete -->
  <button
    class="action-btn delete"
    onclick={() => onDelete?.(subscription)}
    title="Delete subscription"
    aria-label="Delete subscription"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 6h18"/>
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
      <line x1="10" x2="10" y1="11" y2="17"/>
      <line x1="14" x2="14" y1="11" y2="17"/>
    </svg>
    {#if !compact}
      <span>Delete</span>
    {/if}
  </button>
</div>

<style>
  .subscription-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
  }

  .subscription-actions.compact {
    gap: 2px;
  }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 6px 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .compact .action-btn {
    padding: 4px;
    width: 28px;
    height: 28px;
  }

  .action-btn:hover:not(:disabled) {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-btn svg {
    flex-shrink: 0;
  }

  /* History button */
  .action-btn.history:hover {
    color: var(--color-blue, #60a5fa);
  }

  /* Toggle button (pause/resume) */
  .action-btn.toggle:hover {
    color: var(--color-yellow, #fbbf24);
  }

  .action-btn.toggle.paused:hover {
    color: var(--color-green, #4ade80);
  }

  /* Run/Retry button */
  .action-btn.run:hover {
    color: var(--color-blue, #60a5fa);
  }

  .action-btn.run.retry {
    color: var(--color-yellow, #fbbf24);
  }

  .action-btn.run.retry:hover {
    background: rgba(251, 191, 36, 0.1);
    color: var(--color-yellow, #fbbf24);
  }

  /* Edit button */
  .action-btn.edit:hover {
    color: var(--text-normal);
  }

  /* Delete button */
  .action-btn.delete:hover {
    background: rgba(var(--color-red-rgb), 0.1);
    color: var(--color-red, #f87171);
  }

  /* Mobile: always compact */
  @media (max-width: 600px) {
    .subscription-actions {
      gap: 2px;
    }

    .action-btn {
      padding: 4px;
      width: 32px;
      height: 32px;
    }

    .action-btn span {
      display: none;
    }
  }
</style>
