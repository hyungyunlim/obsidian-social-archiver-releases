<script lang="ts">
import { Notice } from 'obsidian';
import { onMount, onDestroy } from 'svelte';
import type SocialArchiverPlugin from '../main';
import { CrossPostAPIClient } from '../services/CrossPostAPIClient';
import { AuthenticationError } from '@/types/errors/http-errors';
import type { ThreadsConnectionStatus, ThreadsReplyControl } from '../types/crosspost';

interface Props {
  plugin: SocialArchiverPlugin;
}

let { plugin }: Props = $props();

// ============================================================================
// State
// ============================================================================

let isConnected = $state(false);
let isConnecting = $state(false);
let isDisconnecting = $state(false);
let isRefreshingToken = $state(false);
let username = $state('');
let tokenStatus = $state<'valid' | 'expiring_soon' | 'expired' | 'error'>('valid');
let tokenExpiresAt = $state<number | null>(null);
let isPolling = $state(false);
let isLoadingStatus = $state(true);
let error = $state('');

// Polling handles
let pollingInterval: ReturnType<typeof setInterval> | null = null;
let pollingTimeout: ReturnType<typeof setTimeout> | null = null;

// ============================================================================
// Derived
// ============================================================================

let tokenExpiryDisplay = $derived(formatTokenExpiry(tokenExpiresAt));
let tokenExpiryWarning = $derived(getTokenExpiryWarning(tokenExpiresAt, tokenStatus));
let statusDotClass = $derived(getStatusDotClass(isConnected, tokenStatus));

// ============================================================================
// API client factory
// ============================================================================

function getClient(): CrossPostAPIClient {
  const endpoint =
    plugin.settings.workerUrl ||
    'https://social-archiver-api.social-archive.org';

  const client = new CrossPostAPIClient({
    endpoint,
    authToken: plugin.settings.authToken,
    pluginVersion: plugin.manifest?.version,
  });
  client.initialize();
  return client;
}

// ============================================================================
// Helpers
// ============================================================================

function formatTokenExpiry(expiresAt: number | null): string {
  if (!expiresAt) return '';
  const expiresDate = new Date(expiresAt * 1000);
  const now = Date.now();
  const daysRemaining = Math.ceil((expiresAt * 1000 - now) / (1000 * 60 * 60 * 24));
  const dateStr = expiresDate.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  if (daysRemaining <= 0) return `${dateStr} (expired)`;
  if (daysRemaining === 1) return `${dateStr} (1 day remaining)`;
  return `${dateStr} (${daysRemaining} days remaining)`;
}

function getTokenExpiryWarning(expiresAt: number | null, status: typeof tokenStatus): boolean {
  if (!expiresAt) return false;
  if (status === 'expired' || status === 'error') return true;
  const daysRemaining = Math.ceil((expiresAt * 1000 - Date.now()) / (1000 * 60 * 60 * 24));
  return daysRemaining <= 7;
}

function getStatusDotClass(connected: boolean, status: typeof tokenStatus): string {
  if (!connected) return 'status-dot disconnected';
  if (status === 'expired' || status === 'error') return 'status-dot error';
  if (status === 'expiring_soon') return 'status-dot warning';
  return 'status-dot connected';
}

function applyStatusToState(status: ThreadsConnectionStatus): void {
  isConnected = status.connected;
  username = status.username ?? '';
  tokenStatus = status.tokenStatus ?? 'valid';
  tokenExpiresAt = status.tokenExpiresAt ?? null;
}

// ============================================================================
// API calls
// ============================================================================

async function checkConnectionStatus(): Promise<ThreadsConnectionStatus> {
  try {
    const client = getClient();
    const status = await client.getConnectionStatus();
    applyStatusToState(status);
    return status;
  } catch (err) {
    console.error('[CrossPostSettingsTab] Failed to check connection status:', err);
    // Don't surface transient network errors as persistent UI error on initial load
    return { connected: false };
  }
}

async function handleConnect(): Promise<void> {
  if (isConnecting || isPolling) return;
  error = '';

  // Pre-check: user must be logged in (have an auth token)
  if (!plugin.settings.authToken) {
    const msg = 'Please log in to Social Archiver first. Go to the Authentication section above to sign in.';
    error = msg;
    new Notice(msg);
    return;
  }

  isConnecting = true;

  try {
    const client = getClient();
    const initResult = await client.initOAuth();

    if (!initResult.authUrl) {
      error = 'Failed to start authentication. Please try again.';
      new Notice('Failed to start Threads authentication.');
      return;
    }

    // Open system browser for OAuth
    window.open(initResult.authUrl, '_blank');
    new Notice('Opening Threads authorization in your browser...');

    // Start polling for connection confirmation
    startPolling();
  } catch (err) {
    if (err instanceof AuthenticationError) {
      const msg = 'Please log in to Social Archiver first. Go to the Authentication section above to sign in.';
      error = msg;
      new Notice(msg);
    } else {
      const message = err instanceof Error ? err.message : 'Unknown error';
      error = `Failed to start authentication: ${message}`;
      new Notice(`Threads connection failed: ${message}`);
    }
  } finally {
    isConnecting = false;
  }
}

async function handleDisconnect(): Promise<void> {
  if (isDisconnecting) return;

  // Confirmation check via Obsidian notice pattern
  const confirmed = await confirmDisconnect();
  if (!confirmed) return;

  error = '';
  isDisconnecting = true;

  try {
    const client = getClient();
    await client.disconnect();

    isConnected = false;
    username = '';
    tokenStatus = 'valid';
    tokenExpiresAt = null;

    // Disable cross-post toggle and notify other components
    await plugin.saveSettingsPartial({ crossPostThreadsEnabled: false });
    plugin.app.workspace.trigger('social-archiver:threads-connection-changed');

    new Notice('Threads account disconnected.');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    error = `Failed to disconnect: ${message}`;
    new Notice(`Disconnect failed: ${message}`);
  } finally {
    isDisconnecting = false;
  }
}

async function handleRefreshToken(): Promise<void> {
  if (isRefreshingToken) return;
  error = '';
  isRefreshingToken = true;

  try {
    const client = getClient();
    const result = await client.refreshToken();

    tokenExpiresAt = result.tokenExpiresAt;
    tokenStatus = 'valid';

    new Notice('Threads token refreshed successfully.');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    error = `Failed to refresh token: ${message}`;
    new Notice(`Token refresh failed: ${message}`);
  } finally {
    isRefreshingToken = false;
  }
}

// ============================================================================
// Confirmation helper (browser-native modal, minimal)
// ============================================================================

function confirmDisconnect(): Promise<boolean> {
  return Promise.resolve(
    window.confirm('Disconnect your Threads account? You will need to re-authorize to cross-post again.')
  );
}

// ============================================================================
// Polling
// ============================================================================

function startPolling(): void {
  isPolling = true;

  pollingInterval = setInterval(async () => {
    const status = await checkConnectionStatus();
    if (status.connected) {
      stopPolling();
      plugin.app.workspace.trigger('social-archiver:threads-connection-changed');
      new Notice('Threads account connected successfully!');
    }
  }, 3000); // poll every 3 seconds

  pollingTimeout = setTimeout(() => {
    if (isPolling) {
      stopPolling();
      error = 'Connection timed out. Please try again.';
      new Notice('Threads connection timed out. Please try again.');
    }
  }, 5 * 60 * 1000); // 5-minute timeout
}

function stopPolling(): void {
  if (pollingInterval !== null) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  if (pollingTimeout !== null) {
    clearTimeout(pollingTimeout);
    pollingTimeout = null;
  }
  isPolling = false;
}

// ============================================================================
// Lifecycle
// ============================================================================

onMount(async () => {
  isLoadingStatus = true;
  await checkConnectionStatus();
  isLoadingStatus = false;
});

onDestroy(() => {
  stopPolling();
});
</script>

<div class="crosspost-settings-container">
  <!-- ================================================================
       Threads Section
  ================================================================ -->
  <div class="crosspost-platform-section">
    <div class="crosspost-platform-header">
      <div class="crosspost-platform-icon threads-icon">
        <!-- Threads icon (simplified T mark) -->
        <svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg" fill="currentColor" width="18" height="18" aria-hidden="true">
          <path d="M141.537 88.988a66.667 66.667 0 0 0-2.518-1.143c-1.482-27.307-16.403-42.94-41.457-43.1h-.34c-14.986 0-27.449 6.396-35.12 18.036l13.779 9.452c5.73-8.695 14.724-10.548 21.348-10.548h.229c8.249.053 14.474 2.452 18.503 7.129 2.932 3.405 4.894 8.111 5.864 14.05-7.314-1.243-15.224-1.626-23.68-1.14-23.82 1.371-39.134 15.264-38.105 34.568.522 9.792 5.4 18.216 13.735 23.719 7.047 4.652 16.124 6.927 25.557 6.41 12.458-.683 22.231-5.436 29.049-14.127 5.178-6.6 8.453-15.153 9.899-25.93 5.937 3.583 10.337 8.298 12.767 13.966 4.132 9.635 4.373 25.468-8.546 38.376-11.319 11.308-24.925 16.2-45.488 16.351-22.809-.169-40.06-7.484-51.273-21.742-10.537-13.396-15.955-32.702-16.119-57.379.164-24.677 5.582-43.983 16.119-57.379 11.213-14.258 28.464-21.573 51.273-21.742 22.976.17 40.526 7.521 52.171 21.855 5.71 7.017 10.015 15.86 12.853 26.325l16.206-4.325c-3.44-12.68-8.853-23.606-16.219-32.668C130.768 17.792 110.008 8.57 83.4 8.402h-.483C56.412 8.57 35.896 17.836 21.863 35.903 9.576 52.15 3.266 75.237 3.043 103.659v.483c.223 28.422 6.533 51.509 18.82 67.756 14.033 18.067 34.549 27.333 60.994 27.501h.483c23.367-.149 39.415-6.29 52.664-19.528 17.629-17.613 17.029-39.338 11.247-52.855-4.144-9.657-12.034-17.517-25.714-22.028Z"/>
          <path d="M96.45 130.483c-10.226.574-20.893-4.006-21.45-13.876-.408-7.292 5.19-15.481 22.378-16.461 1.956-.113 3.882-.168 5.773-.168 6.14 0 11.918.605 17.255 1.767-1.963 24.501-13.543 28.218-23.956 28.738Z"/>
        </svg>
      </div>
      <span class="crosspost-platform-name">Threads</span>
    </div>

    {#if isLoadingStatus}
      <div class="crosspost-status-row">
        <span class="crosspost-loading-text">Checking connection status...</span>
      </div>
    {:else if isConnected}
      <!-- Connected state -->
      <div class="crosspost-connected-info">
        <div class="crosspost-status-row">
          <span class="{statusDotClass}" aria-hidden="true"></span>
          <span class="crosspost-username">@{username}</span>
          <span class="crosspost-status-label connected-label">Connected</span>
        </div>

        {#if tokenExpiresAt}
          <div
            class="crosspost-token-expiry"
            class:expiry-warning={tokenExpiryWarning}
          >
            <span class="expiry-label">Token expires:</span>
            <span class="expiry-value">{tokenExpiryDisplay}</span>
          </div>
        {/if}

        {#if tokenStatus === 'expired' || tokenStatus === 'error'}
          <div class="crosspost-token-expired-notice">
            Token has expired or is invalid. Refresh to continue posting.
          </div>
        {/if}

        <div class="crosspost-action-row">
          {#if tokenExpiryWarning}
            <button
              class="mod-cta crosspost-btn"
              onclick={handleRefreshToken}
              disabled={isRefreshingToken}
              aria-label="Refresh Threads token"
            >
              {isRefreshingToken ? 'Refreshing...' : 'Refresh Token'}
            </button>
          {/if}
          <button
            class="mod-warning crosspost-btn"
            onclick={handleDisconnect}
            disabled={isDisconnecting}
            aria-label="Disconnect Threads account"
          >
            {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
          </button>
        </div>
      </div>
    {:else}
      <!-- Disconnected state -->
      <div class="crosspost-disconnected-info">
        <div class="crosspost-status-row">
          <span class="status-dot disconnected" aria-hidden="true"></span>
          <span class="crosspost-not-connected-label">Not connected</span>
        </div>

        {#if isPolling}
          <div class="crosspost-polling-notice">
            Waiting for authorization in your browser...
            <button
              class="crosspost-btn-link"
              onclick={stopPolling}
              aria-label="Cancel Threads authorization"
            >
              Cancel
            </button>
          </div>
        {:else}
          <button
            class="mod-cta crosspost-btn crosspost-connect-btn"
            onclick={handleConnect}
            disabled={isConnecting}
            aria-label="Connect Threads account"
          >
            {isConnecting ? 'Starting...' : 'Connect Threads Account'}
          </button>
        {/if}
      </div>
    {/if}

    {#if error}
      <div class="crosspost-error" role="alert">
        {error}
      </div>
    {/if}
  </div>

  <!-- ================================================================
       X (Twitter) — Phase 2
  ================================================================ -->
  <div class="crosspost-platform-section crosspost-platform-disabled">
    <div class="crosspost-platform-header">
      <div class="crosspost-platform-icon x-icon">
        <!-- X/Twitter logo mark -->
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor" width="16" height="16" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.259 5.633 5.905-5.633Zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
      </div>
      <span class="crosspost-platform-name">X (Twitter)</span>
      <span class="crosspost-coming-soon-badge">Coming soon</span>
    </div>
    <p class="crosspost-coming-soon-text">X (Twitter) cross-posting will be available in a future update.</p>
  </div>
</div>

<style>
.crosspost-settings-container {
  margin-top: 0.5em;
  display: flex;
  flex-direction: column;
  gap: 1em;
}

/* ---- Platform section card ---- */
.crosspost-platform-section {
  padding: 14px 16px;
  background: var(--background-secondary);
  border-radius: 8px;
  border: 1px solid var(--background-modifier-border);
}

.crosspost-platform-section.crosspost-platform-disabled {
  opacity: 0.55;
}

/* ---- Header row ---- */
.crosspost-platform-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.crosspost-platform-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  flex-shrink: 0;
}

.threads-icon {
  background: #000;
  color: #fff;
}

.x-icon {
  background: #000;
  color: #fff;
}

.crosspost-platform-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-normal);
}

.crosspost-coming-soon-badge {
  margin-left: auto;
  padding: 2px 8px;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 10px;
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 500;
}

.crosspost-coming-soon-text {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
}

/* ---- Status row ---- */
.crosspost-status-row {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 8px;
}

/* ---- Status dot ---- */
.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.connected {
  background: var(--color-green, #22c55e);
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.2);
}

.status-dot.disconnected {
  background: var(--text-faint, #888);
}

.status-dot.warning {
  background: var(--color-yellow, #f59e0b);
  box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.2);
}

.status-dot.error {
  background: var(--color-red, #ef4444);
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
}

/* ---- Username & labels ---- */
.crosspost-username {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-normal);
}

.crosspost-status-label {
  font-size: 12px;
  color: var(--text-muted);
}

.connected-label {
  color: var(--color-green, #22c55e);
}

.crosspost-not-connected-label {
  font-size: 13px;
  color: var(--text-muted);
}

.crosspost-loading-text {
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
}

/* ---- Token expiry ---- */
.crosspost-token-expiry {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 10px;
}

.crosspost-token-expiry.expiry-warning .expiry-value {
  color: var(--color-yellow, #f59e0b);
  font-weight: 500;
}

.expiry-label {
  color: var(--text-faint);
}

.crosspost-token-expired-notice {
  padding: 6px 10px;
  background: var(--background-modifier-error, rgba(239, 68, 68, 0.1));
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-error, var(--color-red, #ef4444));
  margin-bottom: 10px;
  border-left: 3px solid var(--color-red, #ef4444);
}

/* ---- Action row ---- */
.crosspost-action-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* ---- Buttons ---- */
.crosspost-btn {
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 5px;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.crosspost-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.crosspost-connect-btn {
  width: 100%;
  padding: 8px 14px;
  font-size: 13px;
  margin-top: 4px;
}

.crosspost-btn-link {
  background: none;
  border: none;
  padding: 0;
  margin-left: 4px;
  font-size: 12px;
  color: var(--text-accent, var(--interactive-accent));
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.crosspost-btn-link:hover {
  opacity: 0.8;
}

/* ---- Polling notice ---- */
.crosspost-polling-notice {
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}

/* ---- Error ---- */
.crosspost-error {
  margin-top: 10px;
  padding: 7px 10px;
  background: rgba(239, 68, 68, 0.08);
  border-left: 3px solid var(--text-error, #ef4444);
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-error, #ef4444);
}

/* ---- Connected / disconnected info blocks ---- */
.crosspost-connected-info,
.crosspost-disconnected-info {
  display: flex;
  flex-direction: column;
}
</style>
