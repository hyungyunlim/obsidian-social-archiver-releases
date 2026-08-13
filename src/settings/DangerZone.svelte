<script lang="ts">
import { Notice, normalizePath } from 'obsidian';
import type SocialArchiverPlugin from '../main';
import { clearAuthentication, refreshUserCredits } from '../utils/auth';
import { showInputConfirmModal } from '../utils/confirm-modal';
import { t } from '../i18n';

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
    title: t('danger.deleteAccount.title'),
    message: t('danger.deleteAccount.message'),
    confirmText: t('danger.deleteAccount.confirm'),
    cancelText: t('danger.cancel'),
    confirmClass: 'danger',
    requiredInput: settings.username,
    inputLabel: createFragment((frag) => {
      frag.appendText(t('danger.deleteAccount.inputLabelPrefix'));
      frag.createEl('strong', { text: settings.username, cls: 'cm-confirm-token' });
      frag.appendText(t('danger.deleteAccount.inputLabelSuffix'));
    }),
    inputPlaceholder: t('danger.deleteAccount.inputPlaceholder')
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
    title: t('danger.reset.title'),
    message: t('danger.reset.message'),
    confirmText: t('danger.reset.confirm'),
    cancelText: t('danger.cancel'),
    confirmClass: 'warning',
    requiredInput: RESET_CONFIRM_TEXT,
    inputLabel: createFragment((frag) => {
      frag.appendText(t('danger.reset.inputLabelPrefix'));
      frag.createEl('strong', { text: RESET_CONFIRM_TEXT, cls: 'cm-confirm-token' });
      frag.appendText(t('danger.reset.inputLabelSuffix'));
    }),
    inputPlaceholder: t('danger.reset.inputPlaceholder')
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

    let wasUpdated = false;
    await vault.process(file, (content) => {
      const { updated, output } = removeShareMetadata(content);
      if (updated) {
        wasUpdated = true;
        return output;
      }
      return content;
    });
    if (wasUpdated) {
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
    <h2 class="danger-zone-main-header">{t('danger.header')}</h2>

    <!-- Reset Shared Posts Section -->
    <div class="setting-item">
      <div class="setting-item-info">
        <div class="setting-item-name">{t('danger.reset.title')}</div>
        <div class="setting-item-description">
          {t('danger.reset.desc')}
        </div>
      </div>
      <div class="setting-item-control">
        <button
          class="reset-shares-button sa-mobile-compact-btn"
          onclick={handleResetSharedPosts}
        >
          {t('danger.reset.confirm')}
        </button>
      </div>
    </div>

    <!-- Delete Account Section - Standard Setting Style -->
    <div class="setting-item">
      <div class="setting-item-info">
        <div class="setting-item-name">{t('danger.deleteAccount.title')}</div>
        <div class="setting-item-description">
          {t('danger.deleteAccount.desc')}
        </div>
      </div>
      <div class="setting-item-control">
        <button
          class="delete-account-button sa-mobile-compact-btn"
          onclick={handleDeleteAccount}
        >
          {t('danger.deleteAccount.title')}
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
  padding: 18px 16px;
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
