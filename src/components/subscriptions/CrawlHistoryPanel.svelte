<script lang="ts">
/**
 * CrawlHistoryPanel - Slide-in Crawl History View
 *
 * Displays the crawl history for a subscription:
 * - Recent crawl runs with status
 * - Posts archived per run
 * - Error details if failed
 * - Timeline view of history
 *
 * Single Responsibility: Display crawl history for a subscription
 */

import type { AuthorCatalogEntry } from '@/types/author-catalog';
import type { SubscriptionRun } from '@/services/SubscriptionManager';

/**
 * Crawl history entry (UI display format)
 */
export interface CrawlHistoryEntry {
  id: string;
  runAt: string;
  status: 'success' | 'failed' | 'partial';
  trigger: 'scheduled' | 'manual';
  postsArchived: number;
  postsSkipped: number;
  errorMessage?: string;
  durationMs: number;
}

/**
 * Component props
 */
interface CrawlHistoryPanelProps {
  author: AuthorCatalogEntry | null;
  isOpen: boolean;
  onClose?: () => void;
  onRunNow?: () => void;
  fetchRunHistory?: (subscriptionId: string) => Promise<SubscriptionRun[]>;
  /** Increment this to trigger a refresh of the history */
  refreshTrigger?: number;
}

let {
  author,
  isOpen,
  onClose = () => {},
  onRunNow,
  fetchRunHistory,
  refreshTrigger = 0
}: CrawlHistoryPanelProps = $props();

/**
 * Map SubscriptionRun to CrawlHistoryEntry
 */
function mapRunToEntry(run: SubscriptionRun): CrawlHistoryEntry {
  // Calculate duration
  let durationMs = 0;
  if (run.startedAt && run.completedAt) {
    durationMs = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
  }

  // Map status
  let status: CrawlHistoryEntry['status'] = 'partial';
  if (run.status === 'completed') {
    status = 'success';
  } else if (run.status === 'failed') {
    status = 'failed';
  }

  return {
    id: run.id,
    runAt: run.startedAt,
    status,
    trigger: run.trigger,
    postsArchived: run.postsArchived,
    postsSkipped: 0, // Not tracked in SubscriptionRun
    errorMessage: run.error,
    durationMs
  };
}

/**
 * Component state
 */
let history = $state<CrawlHistoryEntry[]>([]);
let isLoading = $state(true);
let isRunning = $state(false);
let error = $state<Error | null>(null);

/**
 * Load crawl history from API
 */
async function loadHistory(): Promise<void> {
  if (!author || !author.subscriptionId) return;

  isLoading = true;
  error = null;

  try {
    if (fetchRunHistory) {
      const runs = await fetchRunHistory(author.subscriptionId);
      history = runs.map(mapRunToEntry);
      console.debug('[CrawlHistoryPanel] Loaded history for:', author.subscriptionId, runs.length, 'runs');
    } else {
      // No fetch function provided - show empty state
      history = [];
      console.debug('[CrawlHistoryPanel] No fetchRunHistory provided');
    }
  } catch (err) {
    error = err instanceof Error ? err : new Error('Failed to load history');
    console.error('[CrawlHistoryPanel] Error loading history:', err);
  } finally {
    isLoading = false;
  }
}

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Format duration
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Format error message to be user-friendly
 */
function formatErrorMessage(message: string): string {
  // Parse backoff message: "Subscription is in backoff until 2025-11-26T05:42:09.102Z"
  const backoffMatch = message.match(/backoff until (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/i);
  if (backoffMatch) {
    const backoffUntil = new Date(backoffMatch[1]);
    const now = new Date();
    const diffMs = backoffUntil.getTime() - now.getTime();

    if (diffMs > 0) {
      // Calculate remaining time
      const minutes = Math.ceil(diffMs / 60000);
      if (minutes < 60) {
        return `Too many requests. Please wait ${minutes} minute${minutes > 1 ? 's' : ''} before retrying.`;
      } else {
        const hours = Math.ceil(minutes / 60);
        return `Too many requests. Please wait ${hours} hour${hours > 1 ? 's' : ''} before retrying.`;
      }
    } else {
      return 'Rate limit expired. You can retry now.';
    }
  }

  // Parse rate limit errors
  if (message.toLowerCase().includes('rate limit') || message.toLowerCase().includes('too many')) {
    return 'Too many requests. Please try again later.';
  }

  // Parse network errors
  if (message.toLowerCase().includes('network') || message.toLowerCase().includes('fetch')) {
    return 'Network error. Please check your connection.';
  }

  // Parse timeout errors
  if (message.toLowerCase().includes('timeout')) {
    return 'Request timed out. Please try again.';
  }

  // Parse authentication errors
  if (message.toLowerCase().includes('auth') || message.toLowerCase().includes('401') || message.toLowerCase().includes('403')) {
    return 'Authentication failed. Please check your credentials.';
  }

  // Default: return original but truncate if too long
  if (message.length > 100) {
    return message.substring(0, 97) + '...';
  }

  return message;
}

/**
 * Get status icon and color
 */
function getStatusInfo(status: CrawlHistoryEntry['status']): { icon: string; color: string } {
  switch (status) {
    case 'success':
      return { icon: '✓', color: 'var(--color-green, #4ade80)' };
    case 'partial':
      return { icon: '⚠', color: 'var(--color-yellow, #fbbf24)' };
    case 'failed':
      return { icon: '✕', color: 'var(--color-red, #f87171)' };
    default:
      return { icon: '?', color: 'var(--text-muted)' };
  }
}

/**
 * Handle keyboard escape
 */
function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && isOpen) {
    onClose();
  }
}

/**
 * Handle backdrop click
 */
function handleBackdropClick(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  // Only close if clicking backdrop itself
  if (target.classList.contains('panel-backdrop')) {
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }
}

/**
 * Stop propagation on panel click
 */
function handlePanelClick(event: MouseEvent): void {
  event.stopPropagation();
}

/**
 * Handle close button click
 */
function handleCloseClick(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
  onClose();
}

/**
 * Handle Run Now button click
 */
async function handleRunNow(): Promise<void> {
  if (onRunNow && !isRunning) {
    isRunning = true;
    try {
      await onRunNow();
      // Wait a moment then refresh history
      await new Promise(resolve => setTimeout(resolve, 1000));
      await loadHistory();
    } finally {
      isRunning = false;
    }
  }
}

/**
 * Get next scheduled time from schedule string
 */
function getNextScheduledTime(): string {
  if (!author?.schedule) return '';

  // Parse schedule like "Daily at 16:00 (Asia/Seoul)" or "Every Fri at 23:00"
  const dailyMatch = author.schedule.match(/Daily at (\d{1,2}):(\d{2})\s*\(/);
  const weeklyMatch = author.schedule.match(/Every (\w+) at (\d{1,2}):(\d{2})/);

  if (weeklyMatch) {
    const [, dayName, hour, minute] = weeklyMatch;
    const dayMap: Record<string, number> = {
      'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
    };
    const targetDay = dayMap[dayName];
    if (targetDay === undefined) return '';

    const nextRun = new Date();
    nextRun.setHours(parseInt(hour), parseInt(minute), 0, 0);

    // Calculate days until next occurrence
    const currentDay = nextRun.getDay();
    let daysUntil = targetDay - currentDay;
    if (daysUntil < 0 || (daysUntil === 0 && nextRun <= new Date())) {
      daysUntil += 7;
    }
    nextRun.setDate(nextRun.getDate() + daysUntil);

    const timeStr = nextRun.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    const dayStr = nextRun.toLocaleDateString(undefined, { weekday: 'short' });

    return `${dayStr} at ${timeStr}`;
  }

  if (dailyMatch) {
    const [, hour, minute] = dailyMatch;
    const nextRun = new Date();
    nextRun.setHours(parseInt(hour), parseInt(minute || '0'), 0, 0);

    // If it's already past today's scheduled time, move to tomorrow
    if (nextRun <= new Date()) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    // Format as "Tomorrow at 4:00 PM" or "Today at 4:00 PM"
    const isToday = nextRun.toDateString() === new Date().toDateString();
    const timeStr = nextRun.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    return `${isToday ? 'Today' : 'Tomorrow'} at ${timeStr}`;
  }

  return '';
}

// Load history when panel opens or refreshTrigger changes
$effect(() => {
  // Track refreshTrigger to re-run when it changes
  const _ = refreshTrigger;
  if (isOpen && author) {
    loadHistory();
  }
});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
  <!-- Container for both backdrop and panel -->
  <div class="panel-container">
    <!-- Backdrop -->
    <div
      class="panel-backdrop"
      onclick={handleBackdropClick}
      role="presentation"
    ></div>

    <!-- Panel (separate from backdrop) -->
    <div
      class="history-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-title"
      tabindex="0"
      onclick={handlePanelClick}
      onkeydown={(event) => event.stopPropagation()}
    >
      <!-- Header -->
      <div class="panel-header">
        <div class="header-info">
          <h3 id="history-title">Crawl History</h3>
          <span class="profile-badge">
            {author?.handle ? `@${author.handle}` : author?.authorName ?? ''}
          </span>
        </div>
        <div class="header-actions">
          {#if onRunNow}
            <button
              type="button"
              class="header-run-btn"
              onclick={handleRunNow}
              disabled={isRunning}
              aria-label="Run now"
              title="Run now"
            >
              {#if isRunning}
                <div class="btn-spinner"></div>
              {:else}
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
              {/if}
            </button>
          {/if}
          <button
            type="button"
            class="close-btn"
            onclick={(e) => handleCloseClick(e)}
            aria-label="Close panel"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Content -->
      <div class="panel-content">
        {#if isLoading}
          <div class="loading-state">
            <div class="spinner"></div>
            <p>Loading history...</p>
          </div>
        {:else if error}
          <div class="error-state">
            <p class="error-message">{error.message}</p>
            <button class="retry-btn" onclick={loadHistory}>Retry</button>
          </div>
        {:else if history.length === 0}
          <div class="empty-state">
            <div class="empty-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <h4>No crawl history yet</h4>
            <p class="empty-description">
              Your subscription is active and ready to archive posts.
            </p>
            {#if getNextScheduledTime()}
              <p class="next-schedule">
                Your next scheduled archive is <strong>{getNextScheduledTime()}</strong>
              </p>
            {/if}
            {#if onRunNow}
              <button class="run-now-btn" onclick={handleRunNow}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Run Now
              </button>
            {/if}
          </div>
        {:else}
          <!-- Stats Summary -->
          <div class="stats-summary">
            <div class="stat-card">
              <span class="stat-value">
                {history.filter(h => h.status === 'success').length}
              </span>
              <span class="stat-label">Successful</span>
            </div>
            <div class="stat-card">
              <span class="stat-value">
                {history.reduce((sum, h) => sum + h.postsArchived, 0)}
              </span>
              <span class="stat-label">Posts Archived</span>
            </div>
            <div class="stat-card">
              <span class="stat-value">
                {history.filter(h => h.status === 'failed').length}
              </span>
              <span class="stat-label">Failed</span>
            </div>
          </div>

          <!-- History Timeline -->
          <div class="history-timeline">
            {#each history as entry (entry.id)}
              {@const statusInfo = getStatusInfo(entry.status)}
              <div class="history-entry" class:failed={entry.status === 'failed'}>
                <div class="entry-indicator" style="--status-color: {statusInfo.color}">
                  <span class="status-icon">{statusInfo.icon}</span>
                </div>
                <div class="entry-content">
                  <div class="entry-header">
                    <div class="entry-date-row">
                      <span class="entry-date">{formatDate(entry.runAt)}</span>
                      <span class="trigger-badge" class:manual={entry.trigger === 'manual'}>
                        {entry.trigger === 'manual' ? 'Manual' : 'Scheduled'}
                      </span>
                    </div>
                    <span class="entry-duration">{formatDuration(entry.durationMs)}</span>
                  </div>
                  <div class="entry-stats">
                    <span class="posts-archived">
                      {entry.postsArchived} posts archived
                    </span>
                    {#if entry.postsSkipped > 0}
                      <span class="posts-skipped">
                        • {entry.postsSkipped} skipped
                      </span>
                    {/if}
                  </div>
                  {#if entry.errorMessage}
                    <div class="entry-error">
                      {formatErrorMessage(entry.errorMessage)}
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>

          <!-- Footer Run Now (visible when history exists) -->
          {#if onRunNow}
            <div class="footer-run-section">
              <button class="run-now-btn footer-run-btn" onclick={handleRunNow} disabled={isRunning}>
                {#if isRunning}
                  <div class="btn-spinner"></div>
                  Running...
                {:else}
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                  Run Now
                {/if}
              </button>
              {#if getNextScheduledTime()}
                <span class="next-schedule-inline">
                  Next: {getNextScheduledTime()}
                </span>
              {/if}
            </div>
          {/if}
        {/if}
      </div>
    </div>
  </div> <!-- End of panel-container -->
{/if}

<style>
  /* Main container that holds everything */
  .panel-container {
    position: fixed;
    inset: 0;
    z-index: 99999;
    pointer-events: all;
    display: flex;
    justify-content: flex-end;
    isolation: isolate;
    padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
  }

  /* Backdrop that covers the entire screen */
  .panel-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    animation: fade-in 0.2s ease;
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  /* The actual panel */
  .history-panel {
    position: relative;
    width: 100%;
    max-width: 400px;
    height: calc(100% - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
    margin-top: env(safe-area-inset-top, 0px);
    margin-bottom: env(safe-area-inset-bottom, 0px);
    background: var(--background-primary);
    box-shadow: -4px 0 24px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
    animation: slide-in 0.25s ease;
    z-index: 1;
    overflow: hidden;
  }

  @keyframes slide-in {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .header-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .header-info h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .profile-badge {
    font-size: 12px;
    color: var(--text-muted);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .header-run-btn,
  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: none !important;
    outline: none !important;
    box-shadow: none !important;
    border-radius: 8px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s;
    flex-shrink: 0;
    z-index: 10;
    -webkit-appearance: none;
    appearance: none;
  }

  .header-run-btn:hover,
  .close-btn:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
    border: none !important;
    outline: none !important;
    box-shadow: none !important;
  }

  .header-run-btn:focus,
  .close-btn:focus,
  .header-run-btn:active,
  .close-btn:active {
    border: none !important;
    outline: none !important;
    box-shadow: none !important;
  }

  .header-run-btn:focus-visible,
  .close-btn:focus-visible {
    outline: 2px solid var(--interactive-accent) !important;
    outline-offset: 2px;
  }

  .header-run-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .header-run-btn svg,
  .close-btn svg {
    pointer-events: none;
  }

  .btn-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--background-modifier-border);
    border-top-color: var(--interactive-accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .panel-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  /* States */
  .loading-state,
  .error-state,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
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

  /* Enhanced Empty State */
  .empty-icon {
    margin-bottom: 16px;
    opacity: 0.3;
  }

  .empty-state h4 {
    margin: 0 0 8px 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-normal);
  }

  .empty-description {
    margin: 0 0 16px 0;
    font-size: 13px;
    color: var(--text-muted);
    max-width: 280px;
  }

  .next-schedule {
    margin: 0 0 20px 0;
    font-size: 13px;
    color: var(--text-muted);
  }

  .next-schedule strong {
    color: var(--text-normal);
    font-weight: 500;
  }

  .run-now-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    background: var(--background-secondary);
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 400;
    cursor: pointer;
    transition: all 0.15s;
  }

  .run-now-btn:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
    border-color: var(--background-modifier-border-hover);
  }

  .run-now-btn svg {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
  }

  .run-now-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Footer Run Section */
  .footer-run-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid var(--background-modifier-border);
  }

  .footer-run-btn {
    min-width: 120px;
  }

  .next-schedule-inline {
    font-size: 12px;
    color: var(--text-muted);
  }

  /* Stats Summary */
  .stats-summary {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin-bottom: 20px;
  }

  .stat-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 12px 8px;
    background: var(--background-secondary);
    border-radius: 8px;
  }

  .stat-card .stat-value {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-normal);
  }

  .stat-card .stat-label {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 2px;
  }

  /* History Timeline */
  .history-timeline {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .history-entry {
    display: flex;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .history-entry:last-child {
    border-bottom: none;
  }

  .entry-indicator {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .status-icon {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--background-secondary);
    color: var(--status-color);
    font-size: 12px;
    font-weight: 600;
  }

  .entry-content {
    flex: 1;
    min-width: 0;
  }

  .entry-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }

  .entry-date-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .entry-date {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-normal);
  }

  .trigger-badge {
    font-size: 10px;
    font-weight: 500;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--background-modifier-border);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .trigger-badge.manual {
    background: rgba(var(--color-blue-rgb, 59, 130, 246), 0.15);
    color: var(--color-blue, #3b82f6);
  }

  .entry-duration {
    font-size: 11px;
    color: var(--text-muted);
  }

  .entry-stats {
    font-size: 12px;
    color: var(--text-muted);
  }

  .posts-archived {
    color: var(--color-green, #4ade80);
  }

  .posts-skipped {
    opacity: 0.7;
  }

  .entry-error {
    margin-top: 6px;
    padding: 6px 8px;
    background: rgba(var(--color-red-rgb), 0.1);
    border-radius: 4px;
    font-size: 12px;
    color: var(--text-error);
  }

  /* Mobile */
  @media (max-width: 600px) {
    .panel-container {
      align-items: stretch;
      justify-content: stretch;
      padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
    }

    .history-panel {
      max-width: 100%;
      width: 100%;
      height: calc(100vh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
      max-height: none;
      min-height: 100%;
      margin: 0;
      border-radius: 0;
      box-shadow: none;
      overflow: hidden;
    }

    .stats-summary {
      gap: 6px;
    }

    .stat-card {
      padding: 10px 6px;
    }
  }
</style>
