<script lang="ts">
import { Notice } from 'obsidian';
import type SocialArchiverPlugin from '../main';

interface Props {
  plugin: SocialArchiverPlugin;
}

let { plugin }: Props = $props();

// Local reactive state
let settings = $state(plugin.settings);
let registering = $state(false);
let unregistering = $state(false);
let syncError = $state<string | null>(null);

// Computed states
let isConnected = $derived(!!settings.syncClientId);
let clientIdDisplay = $derived(
  settings.syncClientId ? settings.syncClientId.substring(0, 8) + '...' : ''
);

/**
 * Handle connecting (registering) this vault as a sync client
 */
async function handleConnect() {
  registering = true;
  syncError = null;

  try {
    const result = await plugin.registerSyncClient();

    if (result.success) {
      settings = plugin.settings;
      new Notice('Connected! This vault will receive archives from mobile.');
    } else {
      syncError = result.error || 'Registration failed';
      new Notice(`Connection failed: ${syncError}`);
    }
  } catch (e) {
    syncError = e instanceof Error ? e.message : 'Registration failed';
    new Notice(`Error: ${syncError}`);
  } finally {
    registering = false;
  }
}

/**
 * Handle disconnecting (unregistering) this vault
 */
async function handleDisconnect() {
  unregistering = true;
  syncError = null;

  try {
    await plugin.unregisterSyncClient();
    settings = plugin.settings;
    new Notice('Disconnected from mobile sync.');
  } catch (e) {
    syncError = e instanceof Error ? e.message : 'Disconnect failed';
    new Notice(`Error: ${syncError}`);
  } finally {
    unregistering = false;
  }
}

</script>

<div class="sync-settings-container">
  <p class="sync-description">
    Enable syncing archives from the mobile app to this vault automatically.
    When connected, archives saved on your phone will appear here.
  </p>

  {#if isConnected}
    <!-- Connected State -->
    <div class="sync-status-connected">
      <div class="status-indicator connected"></div>
      <div class="status-info">
        <div class="status-title">Sync Enabled</div>
        <div class="status-detail">Client ID: {clientIdDisplay}</div>
      </div>
      <button
        class="mod-warning disconnect-button"
        onclick={handleDisconnect}
        disabled={unregistering}
      >
        {unregistering ? 'Disconnecting...' : 'Disconnect'}
      </button>
    </div>
  {:else}
    <!-- Disconnected State -->
    <div class="sync-status-disconnected">
      <div class="status-indicator disconnected"></div>
      <div class="status-info">
        <div class="status-title">Not Connected</div>
        <div class="status-detail">Register this vault to receive archives from mobile.</div>
      </div>
      <button
        class="mod-cta connect-button"
        onclick={handleConnect}
        disabled={registering}
      >
        {registering ? 'Connecting...' : 'Connect'}
      </button>
    </div>

    {#if syncError}
      <div class="sync-error">
        {syncError}
      </div>
    {/if}
  {/if}

  <!-- Info Callout -->
  <div class="sync-info-callout">
    <strong>How Mobile Sync Works</strong>
    <ul>
      <li>Archives saved on your phone are queued for sync</li>
      <li>When Obsidian is open, archives sync automatically via WebSocket</li>
      <li>Offline? Archives will sync when you reconnect</li>
      <li>Each vault can be registered as a separate sync client</li>
    </ul>
  </div>
</div>

<style>
.sync-settings-container {
  margin-top: 0.5em;
}

.sync-description {
  color: var(--text-muted);
  font-size: 0.9em;
  margin: 0 0 1em 0;
  line-height: 1.5;
}

/* Status Display */
.sync-status-connected,
.sync-status-disconnected {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--background-secondary);
  border-radius: 8px;
  margin-bottom: 16px;
}

.status-indicator {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-indicator.connected {
  background: var(--text-success);
  box-shadow: 0 0 6px var(--text-success);
}

.status-indicator.disconnected {
  background: var(--text-muted);
}

.status-info {
  flex: 1;
}

.status-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-normal);
}

.status-detail {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 2px;
}

.connect-button,
.disconnect-button {
  flex-shrink: 0;
}

/* Error Display */
.sync-error {
  padding: 8px 12px;
  background: var(--background-modifier-error);
  color: var(--text-error);
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 16px;
}

/* Info Callout */
.sync-info-callout {
  padding: 12px;
  background: var(--background-secondary);
  border-radius: 8px;
  margin-top: 20px;
  font-size: 13px;
  color: var(--text-muted);
}

.sync-info-callout strong {
  color: var(--text-normal);
  display: block;
  margin-bottom: 8px;
}

.sync-info-callout ul {
  margin: 0;
  padding-left: 20px;
}

.sync-info-callout li {
  margin: 4px 0;
}
</style>
