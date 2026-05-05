<script lang="ts">
import { Notice } from 'obsidian';
import type SocialArchiverPlugin from '../main';
import {
  NewsletterConsentService,
  type MarketingConsentState,
} from '../services/NewsletterConsentService';

interface Props {
  plugin: SocialArchiverPlugin;
  /**
   * Called whenever the local consent state changes (grant or revoke)
   * so the parent toggle can re-render without an extra GET round-trip.
   */
  onConsentChange?: (state: MarketingConsentState) => void;
}

let { plugin, onConsentChange }: Props = $props();

let modalShouldShow = $state(false);
let dismissedThisRender = $state(false);
let isSubmitting = $state(false);

let visible = $derived(modalShouldShow && !dismissedThisRender);

const service = new NewsletterConsentService(plugin.settings.workerUrl, plugin.manifest.version);

$effect(() => {
  let cancelled = false;

  async function load(): Promise<void> {
    const token = plugin.settings.authToken;
    if (!token) {
      modalShouldShow = false;
      return;
    }

    const result = await service.getConsent(token);
    if (cancelled) return;

    if (result.success && result.data) {
      modalShouldShow = result.data.modalShouldShow === true;
    } else {
      // Fail-closed for the banner: if we can't determine state, don't nag.
      modalShouldShow = false;
    }
  }

  void load();

  return () => {
    cancelled = true;
  };
});

async function handleGrant(): Promise<void> {
  const token = plugin.settings.authToken;
  if (!token || isSubmitting) return;

  isSubmitting = true;
  try {
    const result = await service.updateConsent(token, {
      optIn: true,
      source: 'signup_modal',
    });
    if (result.success) {
      dismissedThisRender = true;
      new Notice('Subscribed to product updates.');
      if (result.data && onConsentChange) onConsentChange(result.data);
    } else {
      new Notice(result.error?.message || 'Failed to update newsletter preference.');
    }
  } finally {
    isSubmitting = false;
  }
}

async function handleRefuse(): Promise<void> {
  const token = plugin.settings.authToken;
  if (!token || isSubmitting) return;

  isSubmitting = true;
  try {
    const result = await service.updateConsent(token, {
      optIn: false,
      source: 'signup_modal',
    });
    if (result.success) {
      dismissedThisRender = true;
      if (result.data && onConsentChange) onConsentChange(result.data);
    } else {
      new Notice(result.error?.message || 'Failed to update newsletter preference.');
    }
  } finally {
    isSubmitting = false;
  }
}

async function handleDismiss(): Promise<void> {
  const token = plugin.settings.authToken;
  if (!token || isSubmitting) return;

  isSubmitting = true;
  try {
    const result = await service.dismiss(token);
    if (result.success) {
      dismissedThisRender = true;
    } else {
      new Notice(result.error?.message || 'Failed to dismiss newsletter prompt.');
    }
  } finally {
    isSubmitting = false;
  }
}
</script>

{#if visible}
  <div class="sa-newsletter-banner" role="region" aria-label="Newsletter consent">
    <div class="sa-newsletter-banner-icon" aria-hidden="true">📬</div>
    <div class="sa-newsletter-banner-body">
      <div class="sa-newsletter-banner-title">Stay in the loop?</div>
      <div class="sa-newsletter-banner-desc">Get occasional product updates and tips.</div>
      <div class="sa-newsletter-banner-actions">
        <button
          class="sa-newsletter-banner-primary"
          onclick={handleGrant}
          disabled={isSubmitting}
        >
          Yes, sign me up
        </button>
        <button
          class="sa-newsletter-banner-secondary"
          onclick={handleRefuse}
          disabled={isSubmitting}
        >
          No thanks
        </button>
        <button
          class="sa-newsletter-banner-tertiary"
          onclick={handleDismiss}
          disabled={isSubmitting}
        >
          Decide later
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .sa-newsletter-banner {
    display: flex;
    gap: 12px;
    padding: 14px 16px;
    margin-bottom: 16px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    align-items: flex-start;
  }

  .sa-newsletter-banner-icon {
    font-size: 20px;
    line-height: 1.2;
    flex-shrink: 0;
  }

  .sa-newsletter-banner-body {
    flex: 1;
    min-width: 0;
  }

  .sa-newsletter-banner-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-normal);
    margin-bottom: 2px;
  }

  .sa-newsletter-banner-desc {
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 10px;
    line-height: 1.4;
  }

  .sa-newsletter-banner-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .sa-newsletter-banner-actions button {
    padding: 5px 12px;
    font-size: 12px;
    font-weight: 500;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid var(--background-modifier-border);
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }

  .sa-newsletter-banner-actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .sa-newsletter-banner-primary {
    background: #6c31e3;
    border-color: #6c31e3;
    color: #ffffff;
  }

  .sa-newsletter-banner-primary:hover:not(:disabled) {
    background: #5b25c4;
    border-color: #5b25c4;
  }

  .sa-newsletter-banner-secondary {
    background: var(--background-primary);
    color: var(--text-normal);
  }

  .sa-newsletter-banner-secondary:hover:not(:disabled) {
    background: var(--background-modifier-hover);
    border-color: var(--text-muted);
  }

  .sa-newsletter-banner-tertiary {
    background: transparent;
    color: var(--text-muted);
    border-color: transparent;
  }

  .sa-newsletter-banner-tertiary:hover:not(:disabled) {
    color: var(--text-normal);
    background: var(--background-modifier-hover);
  }
</style>
