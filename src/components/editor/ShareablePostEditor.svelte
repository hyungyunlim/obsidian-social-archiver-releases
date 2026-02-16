<script lang="ts">
/**
 * ShareablePostEditor - Example integration of ShareOptions with existing systems
 *
 * Demonstrates how to integrate:
 * - ShareOptions component with share settings
 * - CreditManager for credit tracking
 * - LicenseManager for tier verification
 * - ShareManager for creating shareable links
 */

import { Notice } from 'obsidian';
import type { App } from 'obsidian';
import ShareOptions from './ShareOptions.svelte';
import MarkdownEditor from './MarkdownEditor.svelte';
import type { ShareOptions as ShareOptionsType, ShareInfo } from '@/services/ShareManager';
import { ShareManager } from '@/services/ShareManager';
import { CreditManager } from '@/services/CreditManager';
import { LicenseManager } from '@/services/licensing/LicenseManager';
import type { LicenseInfo } from '@/types/license';
import type { CreditBalance } from '@/types/credit';

/**
 * Component props
 */
interface ShareablePostEditorProps {
  app: App;
  initialContent?: string;
  onSave?: (content: string, shareInfo?: ShareInfo) => void;
}

let {
  app,
  initialContent = '',
  onSave
}: ShareablePostEditorProps = $props();

/**
 * Component state
 */
let content = $state(initialContent);
let shareOptions = $state<ShareOptionsType>({ tier: 'free' });
let isShareEnabled = $state(false);
let isProcessing = $state(false);
let shareUrl = $state<string | null>(null);

/**
 * Services
 */
let creditManager: CreditManager | null = null;
let licenseManager: LicenseManager | null = null;
let shareManager: ShareManager | null = null;

/**
 * License and credit state
 */
let licenseInfo = $state<LicenseInfo | undefined>();
let creditBalance = $state<CreditBalance | undefined>();
let userTier = $state<'free' | 'pro'>('free');

/**
 * Credits required for sharing
 */
const SHARE_CREDITS = $derived(() => {
  if (!isShareEnabled) return 0;
  if (shareOptions.password) return 2; // Extra credit for password protection
  return 1;
});

/**
 * Initialize services
 */
async function initializeServices() {
  try {
    // Initialize managers
    creditManager = new CreditManager();
    licenseManager = new LicenseManager();
    shareManager = new ShareManager();

    // Load license info
    const license = await licenseManager.getLicenseInfo();
    if (license) {
      licenseInfo = license;
      userTier = license.provider === 'gumroad' ? 'pro' : 'free';
    }

    // Load credit balance
    creditBalance = await creditManager.getBalance();

    // Watch for credit changes
    creditManager.on('creditsUpdated', (balance) => {
      creditBalance = balance;
    });

    // Watch for license changes
    licenseManager.on('licenseUpdated', (license) => {
      licenseInfo = license;
      userTier = license?.provider === 'gumroad' ? 'pro' : 'free';

      // Update share options tier
      shareOptions = {
        ...shareOptions,
        tier: userTier
      };
    });
  } catch (error) {
    new Notice('Failed to initialize sharing services');
  }
}

/**
 * Handle share toggle
 */
function handleShareToggle(enabled: boolean) {
  isShareEnabled = enabled;

  if (enabled) {
    // Check credits
    const required = SHARE_CREDITS();
    if (creditBalance && creditBalance.remaining < required) {
      new Notice(`Not enough credits. Need ${required}, have ${creditBalance.remaining}`);
      isShareEnabled = false;
      return;
    }
  } else {
    // Clear share URL when disabling
    shareUrl = null;
  }
}

/**
 * Handle share options change
 */
function handleShareOptionsChange(options: ShareOptionsType) {
  shareOptions = options;

  // Add tier based on license
  shareOptions.tier = userTier;
}

/**
 * Handle save with optional sharing
 */
async function handleSave() {
  if (isProcessing) return;

  try {
    isProcessing = true;
    let shareInfo: ShareInfo | undefined;

    // Create share if enabled
    if (isShareEnabled && shareManager && creditManager) {
      // Check and consume credits
      const required = SHARE_CREDITS();
      const hasCredits = await creditManager.canConsume(required);

      if (!hasCredits) {
        throw new Error(`Insufficient credits. Need ${required} credits to share.`);
      }

      // Create mock file for sharing
      const mockFile = {
        path: 'temp-post.md',
        basename: 'temp-post',
        vault: app.vault
      } as any;

      // Create share with options
      shareInfo = await shareManager.createShare(mockFile, content, shareOptions);

      // Consume credits after successful share creation
      await creditManager.consume(required, {
        action: 'share_post',
        withPassword: !!shareOptions.password,
        tier: userTier
      });

      // Generate share URL
      shareUrl = shareManager.getShareUrl(shareInfo.id);

      new Notice(`Post shared! Credits used: ${required}`);
    }

    // Call parent save handler
    if (onSave) {
      onSave(content, shareInfo);
    }

    if (shareUrl) {
      // Copy share URL to clipboard
      await navigator.clipboard.writeText(shareUrl);
      new Notice('Share link copied to clipboard!');
    }
  } catch (error) {
    new Notice(error instanceof Error ? error.message : 'Failed to save post');
  } finally {
    isProcessing = false;
  }
}

/**
 * Lifecycle
 */
$effect(() => {
  initializeServices();

  return () => {
    // Cleanup event listeners
    if (creditManager) {
      creditManager.removeAllListeners();
    }
    if (licenseManager) {
      licenseManager.removeAllListeners();
    }
  };
});
</script>

<div class="shareable-post-editor">
  <!-- Editor Section -->
  <div class="editor-section">
    <MarkdownEditor
      bind:content={content}
      placeholder="What's on your mind?"
      showToolbar={true}
      minHeight={200}
    />
  </div>

  <!-- Share Options Section -->
  <div class="share-section">
    <ShareOptions
      options={shareOptions}
      license={licenseInfo}
      tier={userTier}
      creditsRequired={SHARE_CREDITS()}
      onChange={handleShareOptionsChange}
      onShareToggle={handleShareToggle}
    />
  </div>

  <!-- Credits Display -->
  {#if creditBalance}
    <div class="credits-display">
      <span class="credits-label">Credits:</span>
      <span class="credits-value">{creditBalance.remaining} / {creditBalance.total}</span>
      {#if isShareEnabled}
        <span class="credits-cost">
          (Will use {SHARE_CREDITS()} credit{SHARE_CREDITS() !== 1 ? 's' : ''})
        </span>
      {/if}
    </div>
  {/if}

  <!-- Share URL Display -->
  {#if shareUrl}
    <div class="share-url-display">
      <div class="url-label">Share Link:</div>
      <div class="url-container">
        <input
          type="text"
          value={shareUrl}
          readonly
          class="url-input"
          onclick={(e) => (e.target as HTMLInputElement).select()}
        />
        <button
          class="copy-button"
          onclick={async () => {
            await navigator.clipboard.writeText(shareUrl);
            new Notice('Link copied!');
          }}
        >
          Copy
        </button>
      </div>
    </div>
  {/if}

  <!-- Action Buttons -->
  <div class="action-buttons">
    <button
      class="btn-secondary"
      onclick={() => {
        content = initialContent;
        shareUrl = null;
        isShareEnabled = false;
      }}
    >
      Cancel
    </button>
    <button
      class="btn-primary"
      onclick={handleSave}
      disabled={isProcessing || !content.trim()}
    >
      {#if isProcessing}
        Saving...
      {:else if isShareEnabled}
        Save & Share
      {:else}
        Save
      {/if}
    </button>
  </div>

  <!-- Error Display -->
  {#if !licenseInfo && isShareEnabled}
    <div class="warning-message">
      <span class="warning-icon">⚠️</span>
      <span>No license detected. Using free tier limits (30-day expiry).</span>
    </div>
  {/if}
</div>

<style>
  .shareable-post-editor {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 800px;
    margin: 0 auto;
  }

  .editor-section {
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    overflow: hidden;
  }

  .share-section {
    margin-top: 0.5rem;
  }

  /* Credits Display */
  .credits-display {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: var(--background-secondary);
    border-radius: 6px;
    font-size: 14px;
  }

  .credits-label {
    color: var(--text-muted);
  }

  .credits-value {
    font-weight: 600;
    color: var(--text-normal);
  }

  .credits-cost {
    color: var(--text-accent);
    font-style: italic;
  }

  /* Share URL Display */
  .share-url-display {
    padding: 1rem;
    background: var(--background-secondary);
    border-radius: 8px;
    border: 1px solid var(--interactive-accent);
  }

  .url-label {
    font-weight: 500;
    margin-bottom: 0.5rem;
    color: var(--text-normal);
  }

  .url-container {
    display: flex;
    gap: 0.5rem;
  }

  .url-input {
    flex: 1;
    padding: 0.5rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-family: monospace;
    font-size: 13px;
  }

  .url-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .copy-button {
    padding: 0.5rem 1rem;
    background: var(--interactive-accent);
    color: white;
    border: none;
    border-radius: 4px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
  }

  .copy-button:hover {
    background: var(--interactive-accent-hover);
  }

  /* Action Buttons */
  .action-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--background-modifier-border);
  }

  .btn-secondary,
  .btn-primary {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
    min-height: 36px;
  }

  .btn-secondary {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .btn-secondary:hover {
    background: var(--background-modifier-border);
  }

  .btn-primary {
    background: var(--interactive-accent);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--interactive-accent-hover);
  }

  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Warning Message */
  .warning-message {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: var(--background-modifier-warning);
    border-radius: 6px;
    font-size: 13px;
    color: var(--text-warning);
  }

  .warning-icon {
    font-size: 16px;
  }

  /* Mobile Responsive */
  @media (max-width: 480px) {
    .shareable-post-editor {
      gap: 0.75rem;
    }

    .url-container {
      flex-direction: column;
    }

    .copy-button {
      width: 100%;
    }

    .action-buttons {
      flex-direction: column;
    }

    .btn-secondary,
    .btn-primary {
      width: 100%;
      min-height: 44px; /* iOS HIG minimum touch target */
    }
  }
</style>