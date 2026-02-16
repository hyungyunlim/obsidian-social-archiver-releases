<script lang="ts">
import { Notice, normalizePath } from 'obsidian';
import type SocialArchiverPlugin from '../main';
import { clearAuthentication, refreshUserCredits } from '../utils/auth';
import { showInputConfirmModal } from '../utils/confirm-modal';

interface Props {
  plugin: SocialArchiverPlugin;
}

let { plugin }: Props = $props();

// Reactive settings
let settings = $state(plugin.settings);

// Computed - only show if authenticated
let isAuthenticated = $derived(settings.isVerified && settings.authToken !== '');

/**
 * Handle delete account with Obsidian Modal
 */
async function handleDeleteAccount() {
  const confirmed = await showInputConfirmModal(plugin.app, {
    title: 'Delete Account',
    message: `This action cannot be undone. All your data will be permanently deleted:\n\n• All shared posts\n• All uploaded images and media\n• Your username and account`,
    confirmText: 'Delete My Account',
    cancelText: 'Cancel',
    confirmClass: 'danger',
    requiredInput: settings.username,
    inputLabel: `Type your username <strong style="color: var(--interactive-accent); font-family: monospace;">${settings.username}</strong> to confirm:`,
    inputPlaceholder: 'Enter your username'
  });

  if (!confirmed) return;

  if (!settings.authToken) {
    new Notice('❌ Authentication required. Please verify your account first.');
    return;
  }

  try {
    const response = await fetch(`${plugin.settings.workerUrl}/api/user/${settings.username}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.authToken}`
      }
    });

    const data = await response.json();

    if (data.success) {
      new Notice(`✅ Account deleted: ${data.data.deletedShares} posts and ${data.data.deletedMediaFiles} media files removed`);

      await clearAuthentication(plugin);
      settings = plugin.settings;
      await plugin.refreshAllTimelines();
    } else {
      new Notice(`❌ ${data.error?.message || 'Failed to delete account'}`);
    }
  } catch (error) {
    new Notice('❌ Network error. Please try again.');
  }
}

/**
 * Handle resetting all shared posts with Obsidian Modal
 */
async function handleResetSharedPosts() {
  const RESET_CONFIRM_TEXT = 'RESET';

  const confirmed = await showInputConfirmModal(plugin.app, {
    title: 'Remove All Shared Posts',
    message: `This action removes every published post from social-archive.org and clears any share information stored in your vault.\n\n• Deletes all share links from the cloud\n• Removes share URLs from your local markdown files\n• Stops anyone from accessing your current shared posts`,
    confirmText: 'Remove Shared Posts',
    cancelText: 'Cancel',
    confirmClass: 'warning',
    requiredInput: RESET_CONFIRM_TEXT,
    inputLabel: `Type <strong style="color: var(--interactive-accent); font-family: monospace;">${RESET_CONFIRM_TEXT}</strong> to confirm:`,
    inputPlaceholder: 'Type RESET to confirm'
  });

  if (!confirmed) return;

  if (!settings.authToken) {
    new Notice('❌ Authentication required. Please verify your account first.');
    return;
  }

  try {
    const response = await fetch(`${plugin.settings.workerUrl}/api/user/shares`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.authToken}`
      }
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error?.message || 'Failed to remove shared posts');
    }

    const updatedFiles = await clearShareMetadataFromVault();

    new Notice(
      `✅ Removed ${data.data?.deletedShares ?? 0} shared posts and cleared metadata from ${updatedFiles} notes`
    );

    await refreshUserCredits(plugin);
    await plugin.refreshAllTimelines();
  } catch (error) {
    console.error('[DangerZone] Failed to reset shared posts', error);
    new Notice(
      `❌ ${error instanceof Error ? error.message : 'Failed to remove shared posts. Please try again.'}`
    );
  }
}

async function clearShareMetadataFromVault(): Promise<number> {
  const vault = plugin.app.vault;
  const markdownFiles = vault.getMarkdownFiles();
  const archiveRoot = plugin.settings.archivePath ? normalizePath(plugin.settings.archivePath) : '';
  let updatedFiles = 0;

  for (const file of markdownFiles) {
    if (archiveRoot) {
      if (file.path !== archiveRoot && !file.path.startsWith(`${archiveRoot}/`)) {
        continue;
      }
    }

    const content = await vault.read(file);
    const { updated, output } = removeShareMetadata(content);
    if (updated) {
      await vault.modify(file, output);
      updatedFiles++;
    }
  }

  return updatedFiles;
}

function removeShareMetadata(content: string): { updated: boolean; output: string } {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
  const match = content.match(frontmatterRegex);

  if (!match || !match[1]) {
    return { updated: false, output: content };
  }

  const frontmatterContent = match[1];
  const restContent = content.slice(match[0].length);
  const lines = frontmatterContent.split('\n');
  const shareKeys = ['share', 'shareUrl', 'shareId', 'shareExpiry', 'sharePassword'];
  let updated = false;

  const filteredLines = lines.filter((line) => {
    const keyMatch = line.match(/^([\w-]+):/);
    if (keyMatch && shareKeys.includes(keyMatch[1])) {
      updated = true;
      return false;
    }
    return true;
  });

  if (!updated) {
    return { updated: false, output: content };
  }

  return {
    updated: true,
    output: `---\n${filteredLines.join('\n')}\n---\n${restContent}`
  };
}
</script>

{#if isAuthenticated}
  <div class="danger-zone-container">
    <!-- Danger Zone Header -->
    <h2 class="danger-zone-main-header">Danger Zone</h2>

    <!-- Reset Shared Posts Section -->
    <div class="setting-item">
      <div class="setting-item-info">
        <div class="setting-item-name">Remove All Shared Posts</div>
        <div class="setting-item-description">
          Delete every published post from social-archive.org and clear share metadata from your vault notes.
        </div>
      </div>
      <div class="setting-item-control">
        <button
          class="reset-shares-button"
          onclick={handleResetSharedPosts}
        >
          Remove Shared Posts
        </button>
      </div>
    </div>

    <!-- Delete Account Section - Standard Setting Style -->
    <div class="setting-item">
      <div class="setting-item-info">
        <div class="setting-item-name">Delete Account</div>
        <div class="setting-item-description">
          Permanently delete your account and all associated data
        </div>
      </div>
      <div class="setting-item-control">
        <button
          class="delete-account-button"
          onclick={handleDeleteAccount}
        >
          Delete Account
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
.danger-zone-container {
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid var(--background-modifier-border);
}

.danger-zone-main-header {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 12px 0;
  color: var(--text-error);
}

/* Use standard Obsidian setting-item styles */
.setting-item {
  display: flex;
  align-items: flex-start;
  padding: 18px 0;
  border-top: 1px solid var(--background-modifier-border);
}

.setting-item:first-of-type {
  border-top: none;
}

.setting-item-info {
  flex: 1 1 auto;
  padding-right: 16px;
}

.setting-item-name {
  font-weight: 600;
  color: var(--text-normal);
  margin-bottom: 4px;
}

.setting-item-description {
  font-size: 0.9em;
  color: var(--text-muted);
  line-height: 1.4;
}

.setting-item-control {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
}

.delete-account-button {
  padding: 6px 14px;
  background: transparent;
  border: 1px solid var(--text-error);
  border-radius: 4px;
  color: var(--text-error);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.delete-account-button:hover {
  background: var(--text-error);
  color: var(--text-on-accent);
}

.reset-shares-button {
  padding: 6px 14px;
  background: transparent;
  border: 1px solid var(--interactive-accent);
  border-radius: 4px;
  color: var(--interactive-accent);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.reset-shares-button:hover {
  background: var(--interactive-accent);
  color: var(--text-on-accent);
}

</style>
