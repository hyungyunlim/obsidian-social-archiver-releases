<script lang="ts">
/**
 * SubscriptionManagementUI - Main Subscription Management Container
 *
 * Unified view for managing profile subscriptions using AuthorCatalog.
 * Single Responsibility: Orchestrate subscription management view
 */

import type { App } from 'obsidian';
import type {
  AuthorCatalogEntry,
  AuthorSubscribeOptions
} from '@/types/author-catalog';
import type { SubscriptionRun } from '@/services/SubscriptionManager';
import AuthorCatalog from './AuthorCatalog.svelte';
import CrawlHistoryPanel from './CrawlHistoryPanel.svelte';

/**
 * Component props
 */
interface SubscriptionManagementUIProps {
  app: App;
  archivePath?: string;
  onBack?: () => void;
  onSubscribe?: (author: AuthorCatalogEntry, options: AuthorSubscribeOptions) => Promise<void>;
  onViewArchives?: (author: AuthorCatalogEntry) => void;
  fetchSubscriptions?: () => Promise<any[]>;
  triggerManualRun?: (subscriptionId: string) => Promise<void>;
  deleteSubscription?: (subscriptionId: string) => Promise<void>;
  fetchRunHistory?: (subscriptionId: string) => Promise<SubscriptionRun[]>;
}

let {
  app,
  archivePath = 'Social Archives',
  onBack,
  onSubscribe,
  onViewArchives,
  fetchSubscriptions,
  triggerManualRun,
  deleteSubscription,
  fetchRunHistory
}: SubscriptionManagementUIProps = $props();

/**
 * History panel state
 */
let isHistoryPanelOpen = $state(false);
let selectedAuthor = $state<AuthorCatalogEntry | null>(null);

/**
 * Handle back navigation
 */
function handleBack(): void {
  if (onBack) {
    onBack();
  }
}

/**
 * Handle unsubscribe from AuthorCatalog
 */
async function handleUnsubscribe(author: AuthorCatalogEntry): Promise<void> {
  if (!deleteSubscription || !author.subscriptionId) {
    throw new Error('Cannot unsubscribe: missing subscription ID');
  }

  await deleteSubscription(author.subscriptionId);
}

/**
 * Handle manual run from AuthorCatalog
 */
async function handleManualRun(author: AuthorCatalogEntry): Promise<void> {
  if (!triggerManualRun || !author.subscriptionId) {
    throw new Error('Cannot run: missing subscription ID');
  }

  await triggerManualRun(author.subscriptionId);
}

/**
 * Handle view history from AuthorCatalog
 */
function handleViewHistory(author: AuthorCatalogEntry): void {
  selectedAuthor = author;
  isHistoryPanelOpen = true;
}

/**
 * Close history panel
 */
function closeHistoryPanel(): void {
  isHistoryPanelOpen = false;
  selectedAuthor = null;
}
</script>

<div class="subscription-management">
  <!-- Header with back button -->
  <div class="management-header">
    <button
      class="back-button"
      onclick={handleBack}
      aria-label="Back to timeline"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m15 18-6-6 6-6"/>
      </svg>
    </button>
    <h2 class="header-title">Subscriptions</h2>
  </div>

  <!-- Content -->
  <div class="content">
    <AuthorCatalog
      {app}
      {archivePath}
      {fetchSubscriptions}
      {onSubscribe}
      onUnsubscribe={handleUnsubscribe}
      onManualRun={handleManualRun}
      onViewHistory={handleViewHistory}
      {onViewArchives}
    />
  </div>

  <!-- Crawl History Panel -->
  <CrawlHistoryPanel
    author={selectedAuthor}
    isOpen={isHistoryPanelOpen}
    onClose={closeHistoryPanel}
    {fetchRunHistory}
  />
</div>

<style>
  .subscription-management {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--background-primary);
    color: var(--text-normal);
  }

  .management-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .back-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .back-button:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .back-button:focus {
    outline: none;
    box-shadow: none;
  }

  .header-title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-normal);
  }

  .content {
    flex: 1;
    overflow: hidden;
  }

  /* Mobile responsive */
  @media (max-width: 600px) {
    .management-header {
      padding: 10px 12px;
    }
  }
</style>
