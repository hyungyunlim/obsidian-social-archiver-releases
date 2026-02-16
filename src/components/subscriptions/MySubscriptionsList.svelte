<script lang="ts">
/**
 * @deprecated This component is deprecated as of Task 157.
 * Use AuthorCatalog instead, which provides a unified view for
 * browsing authors and managing subscriptions.
 *
 * MySubscriptionsList - Active Subscriptions List View (DEPRECATED)
 *
 * Displays the user's active profile subscriptions with:
 * - Status indicators (active, paused, error, crawling)
 * - Platform icons and handle/name
 * - Schedule and last crawl information
 * - Management actions (pause, resume, delete, etc.)
 *
 * Single Responsibility: Display and manage active subscriptions
 */

import type { App } from 'obsidian';
import { Notice } from 'obsidian';
import type { SubscriptionDisplay, SubscriptionStatus } from '@/types/subscription-ui';
import SubscriptionRow from './SubscriptionRow.svelte';
import CrawlHistoryPanel from './CrawlHistoryPanel.svelte';
import { showConfirmModal } from '@/utils/confirm-modal';

/**
 * Subscription display status for UI
 */
// Types now sourced from src/types/subscription-ui.ts

/**
 * Component props
 */
interface MySubscriptionsListProps {
  app: App;
  onAddNew?: () => void;
  onViewHistory?: (subscription: SubscriptionDisplay) => void;
  onEdit?: (subscription: SubscriptionDisplay) => void;
  onDelete?: (subscription: SubscriptionDisplay) => void;
  fetchSubscriptions?: () => Promise<SubscriptionDisplay[]>;
  updateSubscription?: (subscriptionId: string, updates: Partial<SubscriptionDisplay>) => Promise<void>;
  triggerManualRun?: (subscriptionId: string) => Promise<void>;
  deleteSubscription?: (subscriptionId: string) => Promise<void>;
}

let {
  app,
  onAddNew,
  onViewHistory,
  onEdit,
  onDelete,
  fetchSubscriptions,
  updateSubscription,
  triggerManualRun,
  deleteSubscription
}: MySubscriptionsListProps = $props();

/**
 * Component state
 */
let subscriptions = $state<SubscriptionDisplay[]>([]);
let isLoading = $state(true);
let error = $state<Error | null>(null);

/**
 * History panel state
 */
let isHistoryPanelOpen = $state(false);
let selectedSubscription = $state<SubscriptionDisplay | null>(null);


/**
 * Open history panel for a subscription
 */
function openHistoryPanel(subscription: SubscriptionDisplay): void {
  selectedSubscription = subscription;
  isHistoryPanelOpen = true;
  if (onViewHistory) {
    onViewHistory(subscription);
  }
}

/**
 * Close history panel
 */
function closeHistoryPanel(): void {
  isHistoryPanelOpen = false;
  selectedSubscription = null;
}

/**
 * Derived: subscription counts
 */
const stats = $derived(() => {
  const active = subscriptions.filter(s => s.status === 'active').length;
  const paused = subscriptions.filter(s => s.status === 'paused').length;
  const errors = subscriptions.filter(s => s.status === 'error').length;
  return { total: subscriptions.length, active, paused, errors };
});

/**
 * Derived: empty state detection
 */
const isEmpty = $derived(subscriptions.length === 0 && !isLoading);

/**
 * Load subscriptions from SubscriptionManager
 * TODO: Integrate with Task 153 (SubscriptionManager)
 */
async function loadSubscriptions(): Promise<void> {
  isLoading = true;
  error = null;

  try {
    if (fetchSubscriptions) {
      subscriptions = await fetchSubscriptions();
    } else {
      // Placeholder: empty state if no fetch provided
      subscriptions = [];
    }
  } catch (err) {
    error = err instanceof Error ? err : new Error('Failed to load subscriptions');
    console.error('[MySubscriptionsList] Error loading subscriptions:', err);
  } finally {
    isLoading = false;
  }
}

/**
 * Handle pause/resume toggle
 */
async function handleTogglePause(subscription: SubscriptionDisplay): Promise<void> {
  const newEnabled = !subscription.enabled;

  try {
    if (updateSubscription) {
      await updateSubscription(subscription.id, { enabled: newEnabled, status: newEnabled ? 'active' : 'paused' });
    }

    // Optimistic update
    const idx = subscriptions.findIndex(s => s.id === subscription.id);
    if (idx !== -1) {
      subscriptions[idx] = {
        ...subscriptions[idx],
        enabled: newEnabled,
        status: newEnabled ? 'active' : 'paused'
      };
    }

    new Notice(newEnabled ? 'Subscription resumed' : 'Subscription paused');
  } catch (err) {
    console.error('[MySubscriptionsList] Failed to toggle pause:', err);
    new Notice('Failed to update subscription');
  }
}

/**
 * Handle manual run trigger
 */
async function handleManualRun(subscription: SubscriptionDisplay): Promise<void> {
  // Optimistic update - set to crawling immediately
  const idx = subscriptions.findIndex(s => s.id === subscription.id);
  const originalStatus = subscription.status;
  if (idx !== -1) {
    subscriptions[idx] = {
      ...subscriptions[idx],
      status: 'crawling'
    };
  }
  new Notice('Starting manual crawl...');

  // Call API in background
  if (triggerManualRun) {
    try {
      await triggerManualRun(subscription.id);
    } catch (err) {
      // Rollback on failure
      console.error('[MySubscriptionsList] Failed to trigger manual run:', err);
      if (idx !== -1) {
        subscriptions[idx] = {
          ...subscriptions[idx],
          status: originalStatus
        };
      }
      new Notice('Failed to start crawl');
    }
  }
}

/**
 * Handle delete with Obsidian Modal confirmation
 */
async function handleDelete(subscription: SubscriptionDisplay): Promise<void> {
  const confirmed = await showConfirmModal(app, {
    title: 'Delete Subscription',
    message: `Are you sure you want to delete the subscription for @${subscription.handle}?\n\nThis action cannot be undone.`,
    confirmText: 'Delete',
    cancelText: 'Cancel',
    confirmClass: 'danger'
  });

  if (!confirmed) return;

  // Optimistic update: remove from UI immediately
  const originalSubscriptions = [...subscriptions];
  subscriptions = subscriptions.filter(s => s.id !== subscription.id);
  new Notice('Subscription deleted');

  if (onDelete) {
    onDelete(subscription);
  }

  // Call API in background
  if (deleteSubscription) {
    try {
      await deleteSubscription(subscription.id);
    } catch (err) {
      // Rollback on failure
      console.error('[MySubscriptionsList] Failed to delete, rolling back:', err);
      subscriptions = originalSubscriptions;
      new Notice('Failed to delete subscription. Restored.');
    }
  }
}

// Load subscriptions on mount
$effect(() => {
  loadSubscriptions();
});
</script>

<div class="subscriptions-list">
  <!-- Header -->
  <div class="list-header">
    <div class="header-title">
      <h3>My Subscriptions</h3>
      {#if stats.total > 0}
        <span class="count-badge">{stats.total}</span>
        {#if stats.errors > 0}
          <span class="error-badge" title="{stats.errors} subscriptions with errors">
            {stats.errors} errors
          </span>
        {/if}
      {/if}
    </div>
    <button
      class="add-button"
      onclick={() => onAddNew?.()}
      aria-label="Add subscription"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 5v14M5 12h14"/>
      </svg>
      <span>Add</span>
    </button>
  </div>

  <!-- Content -->
  <div class="list-content">
    {#if isLoading}
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading subscriptions...</p>
      </div>
    {:else if error}
      <div class="error-state">
        <p class="error-message">{error.message}</p>
        <button class="retry-btn" onclick={loadSubscriptions}>Retry</button>
      </div>
    {:else if isEmpty}
      <div class="empty-state">
        <div class="empty-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 11a9 9 0 0 1 9 9"/>
            <path d="M4 4a16 16 0 0 1 16 16"/>
            <circle cx="5" cy="19" r="1"/>
          </svg>
        </div>
        <h4>No active subscriptions</h4>
        <p>Subscribe to profiles from the Catalog tab to automatically archive their new posts.</p>
        <button class="add-first-btn" onclick={() => onAddNew?.()}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Add First Subscription
        </button>
      </div>
    {:else}
      <div class="subscription-rows">
        {#each subscriptions as subscription (subscription.id)}
          <SubscriptionRow
            {subscription}
            onTogglePause={handleTogglePause}
            onManualRun={handleManualRun}
            onViewHistory={openHistoryPanel}
            onEdit={onEdit}
            onDelete={handleDelete}
          />
        {/each}
      </div>
    {/if}
  </div>

  <!-- Crawl History Panel -->
  {#if selectedSubscription}
    <CrawlHistoryPanel
      subscription={selectedSubscription}
      isOpen={isHistoryPanelOpen}
      onClose={closeHistoryPanel}
    />
  {/if}

</div>

<style>
  .subscriptions-list {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--background-primary);
  }

  .list-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .header-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .header-title h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .count-badge {
    background: var(--background-modifier-hover);
    color: var(--text-muted);
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 500;
  }

  .error-badge {
    background: var(--background-modifier-error);
    color: var(--text-error);
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 500;
  }

  .add-button {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: none;
    border-radius: 6px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .add-button:hover {
    opacity: 0.9;
  }

  .list-content {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  /* Loading, Error, Empty states */
  .loading-state,
  .error-state,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    text-align: center;
    color: var(--text-muted);
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--background-modifier-border);
    border-top-color: var(--interactive-accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 12px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error-message {
    color: var(--text-error);
    margin-bottom: 12px;
  }

  .retry-btn {
    padding: 6px 16px;
    border-radius: 6px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
    color: var(--text-normal);
    cursor: pointer;
  }

  .empty-icon {
    margin-bottom: 16px;
    opacity: 0.5;
  }

  .empty-state h4 {
    margin: 0 0 8px;
    font-size: 16px;
    color: var(--text-normal);
  }

  .empty-state p {
    margin: 0 0 16px;
    font-size: 14px;
    max-width: 280px;
  }

  .add-first-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border: none;
    border-radius: 6px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
  }

  /* Subscription Rows Container */
  .subscription-rows {
    display: flex;
    flex-direction: column;
  }

  /* Mobile responsive */
  @media (max-width: 600px) {
    .add-button span {
      display: none;
    }
  }
</style>
