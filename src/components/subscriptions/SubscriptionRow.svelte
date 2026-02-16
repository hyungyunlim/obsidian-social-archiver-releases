<script lang="ts">
/**
 * @deprecated This component is deprecated as of Task 157.
 * Use AuthorRow instead, which provides subscription toggle
 * and action menu within AuthorCatalog.
 *
 * SubscriptionRow - Individual Subscription Display Row (DEPRECATED)
 *
 * Displays a single subscription with:
 * - Status indicator with animation
 * - Platform icon and profile info
 * - Stats and schedule
 * - Action buttons
 * - Mobile swipe gestures (left=delete, right=pause)
 *
 * Single Responsibility: Render and handle actions for one subscription
 */

import type { SubscriptionDisplay, SubscriptionStatus } from './MySubscriptionsList.svelte';
import StatusIndicator from './StatusIndicator.svelte';
import SubscriptionActions from './SubscriptionActions.svelte';
import { swipeGesture, type SwipeDirection } from './useSwipeGesture';

/**
 * Component props
 */
interface SubscriptionRowProps {
  subscription: SubscriptionDisplay;
  onTogglePause?: (subscription: SubscriptionDisplay) => void;
  onManualRun?: (subscription: SubscriptionDisplay) => void;
  onViewHistory?: (subscription: SubscriptionDisplay) => void;
  onEdit?: (subscription: SubscriptionDisplay) => void;
  onDelete?: (subscription: SubscriptionDisplay) => void;
}

let {
  subscription,
  onTogglePause,
  onManualRun,
  onViewHistory,
  onEdit,
  onDelete
}: SubscriptionRowProps = $props();

/**
 * Swipe gesture state for mobile
 */
let swipeDirection = $state<SwipeDirection>('none');
let isSwipeRevealed = $state(false);

/**
 * Handle swipe left - reveal delete
 */
function handleSwipeLeft(): void {
  swipeDirection = 'left';
  isSwipeRevealed = true;
  // Auto-hide after 3 seconds
  setTimeout(() => {
    if (swipeDirection === 'left') {
      resetSwipe();
    }
  }, 3000);
}

/**
 * Handle swipe right - toggle pause
 */
function handleSwipeRight(): void {
  swipeDirection = 'right';
  onTogglePause?.(subscription);
  // Brief visual feedback
  setTimeout(() => {
    resetSwipe();
  }, 500);
}

/**
 * Reset swipe state
 */
function resetSwipe(): void {
  swipeDirection = 'none';
  isSwipeRevealed = false;
}

/**
 * Confirm delete from swipe action
 */
function confirmSwipeDelete(): void {
  onDelete?.(subscription);
  resetSwipe();
}

function handleRowKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    resetSwipe();
  }
}

/**
 * Swipe gesture config
 */
const swipeConfig = {
  threshold: 60,
  maxTime: 400,
  onSwipeLeft: handleSwipeLeft,
  onSwipeRight: handleSwipeRight
};

/**
 * Get platform icon emoji
 */
function getPlatformIcon(platform: string): string {
  switch (platform.toLowerCase()) {
    case 'instagram': return '📷';
    case 'x':
    case 'twitter': return '🐦';
    case 'threads': return '🧵';
    case 'mastodon': return '🐘';
    case 'facebook': return '📘';
    case 'pinterest': return '📌';
    case 'substack': return '📰';
    case 'linkedin': return '💼';
    case 'tiktok': return '🎵';
    case 'youtube': return '🎬';
    case 'bluesky': return '🦋';
    case 'blog': return '📝';
    default: return '🌐';
  }
}

/**
 * Format relative time from date string
 */
function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';

  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

/**
 * Format handle (ensure @ prefix)
 */
function formatHandle(handle: string): string {
  return handle.startsWith('@') ? handle : `@${handle}`;
}
</script>

<div
  class="subscription-row-wrapper"
  class:swiped-left={swipeDirection === 'left'}
  class:swiped-right={swipeDirection === 'right'}
>
  <!-- Swipe Action Backgrounds -->
  <div class="swipe-action swipe-action-left">
    <button class="swipe-delete-btn" onclick={confirmSwipeDelete}>
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h18"/>
        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
      </svg>
      <span>Delete</span>
    </button>
  </div>
  <div class="swipe-action swipe-action-right">
    <span class="swipe-pause-indicator">
      {subscription.enabled ? '⏸ Paused' : '▶ Resumed'}
    </span>
  </div>

  <!-- Main Row Content -->
  <div
    class="subscription-row"
    class:error={subscription.status === 'error'}
    class:crawling={subscription.status === 'crawling'}
    class:paused={subscription.status === 'paused'}
    use:swipeGesture={swipeConfig}
    onclick={resetSwipe}
    role="button"
    tabindex="0"
    onkeydown={handleRowKeydown}
  >
  <!-- Line 1: Status, Platform, Handle, Name, Actions -->
  <div class="row-main">
    <StatusIndicator status={subscription.status} />

    <span class="platform-icon" title={subscription.platform}>
      {getPlatformIcon(subscription.platform)}
    </span>

    <div class="profile-info">
      <span class="handle">{formatHandle(subscription.handle)}</span>
      <span class="name">{subscription.name}</span>
    </div>

    <SubscriptionActions
      {subscription}
      {onTogglePause}
      {onManualRun}
      {onViewHistory}
      {onEdit}
      {onDelete}
    />
  </div>

  <!-- Line 2: Stats and metadata -->
  <div class="row-meta">
    <span class="stat">
      <span class="stat-value">{subscription.stats.totalArchived}</span>
      <span class="stat-label">posts</span>
    </span>
    <span class="separator">•</span>
    <span class="schedule">{subscription.schedule.displayText}</span>
    <span class="separator">•</span>
    <span class="last-run">
      Last: {formatRelativeTime(subscription.stats.lastRunAt)}
    </span>
    {#if subscription.errorMessage}
      <span class="error-msg" title={subscription.errorMessage}>
        • {subscription.errorMessage}
      </span>
    {/if}
  </div>
  </div>
</div>

<style>
  .subscription-row {
    padding: 12px 16px;
    border-bottom: 1px solid var(--background-modifier-border);
    transition: background 0.15s ease;
  }

  .subscription-row:hover {
    background: var(--background-modifier-hover);
  }

  .subscription-row.error {
    background: rgba(var(--color-red-rgb), 0.05);
  }

  .subscription-row.error:hover {
    background: rgba(var(--color-red-rgb), 0.08);
  }

  .subscription-row.paused {
    opacity: 0.7;
  }

  .subscription-row.crawling {
    background: rgba(var(--color-blue-rgb), 0.05);
  }

  .row-main {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .platform-icon {
    font-size: 14px;
    flex-shrink: 0;
  }

  .profile-info {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .handle {
    font-weight: 600;
    color: var(--text-normal);
    font-size: 14px;
    flex-shrink: 0;
  }

  .name {
    color: var(--text-muted);
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-left: 52px; /* Align with profile info */
    font-size: 12px;
    color: var(--text-muted);
  }

  .stat {
    display: flex;
    gap: 3px;
  }

  .stat-value {
    font-weight: 500;
    color: var(--text-normal);
  }

  .stat-label {
    opacity: 0.8;
  }

  .separator {
    opacity: 0.4;
  }

  .schedule {
    opacity: 0.9;
  }

  .last-run {
    opacity: 0.8;
  }

  .error-msg {
    color: var(--text-error);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 150px;
  }

  /* Swipe Gesture Styles */
  .subscription-row-wrapper {
    position: relative;
    overflow: hidden;
  }

  .swipe-action {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.2s ease;
    pointer-events: none;
  }

  .swipe-action-left {
    right: 0;
    width: 80px;
    background: var(--color-red, #f87171);
  }

  .swipe-action-right {
    left: 0;
    width: 100px;
    background: var(--color-green, #4ade80);
  }

  .swiped-left .swipe-action-left {
    opacity: 1;
    pointer-events: auto;
  }

  .swiped-right .swipe-action-right {
    opacity: 1;
  }

  .swiped-left .subscription-row {
    transform: translateX(-80px);
    transition: transform 0.2s ease;
  }

  .swiped-right .subscription-row {
    transform: translateX(100px);
    transition: transform 0.2s ease;
  }

  .swipe-delete-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px;
    border: none;
    background: transparent;
    color: white;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
  }

  .swipe-pause-indicator {
    color: white;
    font-size: 13px;
    font-weight: 600;
  }

  /* Mobile responsive */
  @media (max-width: 600px) {
    .row-meta {
      flex-wrap: wrap;
      padding-left: 0;
      margin-top: 8px;
    }

    .name {
      display: none;
    }

    .row-main {
      gap: 6px;
    }
  }

  /* Disable swipe on desktop */
  @media (min-width: 601px) {
    .swipe-action {
      display: none;
    }

    .swiped-left .subscription-row,
    .swiped-right .subscription-row {
      transform: none;
    }
  }
</style>
