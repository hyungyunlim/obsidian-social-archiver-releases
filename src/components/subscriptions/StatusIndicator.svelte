<script lang="ts">
/**
 * StatusIndicator - Animated Status Display
 *
 * Displays subscription status with visual indicators:
 * - Active: Green pulsing dot
 * - Paused: Yellow static dot
 * - Error: Red blinking dot
 * - Crawling: Blue spinning loader
 *
 * Single Responsibility: Render animated status indicator
 */

import type { SubscriptionStatus } from './MySubscriptionsList.svelte';

/**
 * Component props
 */
interface StatusIndicatorProps {
  status: SubscriptionStatus;
  size?: 'small' | 'medium' | 'large';
  showLabel?: boolean;
}

let {
  status,
  size = 'medium',
  showLabel = false
}: StatusIndicatorProps = $props();

/**
 * Get status label text
 */
function getStatusLabel(status: SubscriptionStatus): string {
  switch (status) {
    case 'active': return 'Active';
    case 'paused': return 'Paused';
    case 'error': return 'Error';
    case 'crawling': return 'Crawling';
    default: return 'Unknown';
  }
}

/**
 * Get size in pixels
 */
function getSizeValue(size: 'small' | 'medium' | 'large'): number {
  switch (size) {
    case 'small': return 8;
    case 'medium': return 12;
    case 'large': return 16;
    default: return 12;
  }
}

const sizeValue = $derived(getSizeValue(size));
</script>

<div
  class="status-indicator"
  class:active={status === 'active'}
  class:paused={status === 'paused'}
  class:error={status === 'error'}
  class:crawling={status === 'crawling'}
  class:small={size === 'small'}
  class:medium={size === 'medium'}
  class:large={size === 'large'}
  title={getStatusLabel(status)}
  role="status"
  aria-label={`Status: ${getStatusLabel(status)}`}
>
  {#if status === 'crawling'}
    <!-- Spinning loader for crawling state -->
    <svg
      class="spinner"
      viewBox="0 0 24 24"
      width={sizeValue}
      height={sizeValue}
    >
      <circle
        class="spinner-track"
        cx="12"
        cy="12"
        r="10"
        fill="none"
        stroke-width="2"
      />
      <circle
        class="spinner-progress"
        cx="12"
        cy="12"
        r="10"
        fill="none"
        stroke-width="2"
        stroke-linecap="round"
      />
    </svg>
  {:else}
    <!-- Dot for other states -->
    <span class="dot"></span>
  {/if}

  {#if showLabel}
    <span class="label">{getStatusLabel(status)}</span>
  {/if}
</div>

<style>
  .status-indicator {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  /* Dot base styles */
  .dot {
    border-radius: 50%;
    display: block;
  }

  /* Size variations */
  .small .dot {
    width: 8px;
    height: 8px;
  }

  .medium .dot {
    width: 12px;
    height: 12px;
  }

  .large .dot {
    width: 16px;
    height: 16px;
  }

  /* Active state - green with pulse */
  .active .dot {
    background: var(--color-green, #4ade80);
    box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.4);
    animation: pulse-green 2s ease-in-out infinite;
  }

  @keyframes pulse-green {
    0%, 100% {
      box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.4);
    }
    50% {
      box-shadow: 0 0 0 4px rgba(74, 222, 128, 0);
    }
  }

  /* Paused state - yellow/amber, no animation */
  .paused .dot {
    background: var(--color-yellow, #fbbf24);
    opacity: 0.8;
  }

  /* Error state - red with blink */
  .error .dot {
    background: var(--color-red, #f87171);
    animation: blink-red 1s ease-in-out infinite;
  }

  @keyframes blink-red {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }

  /* Crawling state - blue spinner */
  .spinner {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .spinner-track {
    stroke: var(--background-modifier-border);
  }

  .spinner-progress {
    stroke: var(--color-blue, #60a5fa);
    stroke-dasharray: 45 62;
  }

  /* Label styles */
  .label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-muted);
  }

  .active .label {
    color: var(--color-green, #4ade80);
  }

  .paused .label {
    color: var(--color-yellow, #fbbf24);
  }

  .error .label {
    color: var(--color-red, #f87171);
  }

  .crawling .label {
    color: var(--color-blue, #60a5fa);
  }

  /* Reduce motion preference */
  @media (prefers-reduced-motion: reduce) {
    .active .dot {
      animation: none;
    }

    .error .dot {
      animation: none;
      opacity: 1;
    }

    .spinner {
      animation: none;
    }
  }
</style>
