<script lang="ts">
import { Notice } from 'obsidian';
import type SocialArchiverPlugin from '../main';
import {
  NewsletterConsentService,
  type MarketingConsentState,
} from '../services/NewsletterConsentService';

interface Props {
  plugin: SocialArchiverPlugin;
}

let { plugin }: Props = $props();

let consent = $state<MarketingConsentState | null>(null);
let isLoading = $state(true);
let isSaving = $state(false);
let loadError = $state('');

const service = new NewsletterConsentService(plugin.settings.workerUrl, plugin.manifest.version);

let isSuppressed = $derived(consent?.status === 'suppressed');
let optInChecked = $derived(consent?.optIn === true);
let toggleDisabled = $derived(isLoading || isSaving || isSuppressed || !plugin.settings.authToken);

$effect(() => {
  let cancelled = false;

  async function load(): Promise<void> {
    const token = plugin.settings.authToken;
    if (!token) {
      isLoading = false;
      return;
    }

    isLoading = true;
    loadError = '';
    const result = await service.getConsent(token);
    if (cancelled) return;

    if (result.success && result.data) {
      consent = result.data;
    } else {
      loadError = result.error?.message || 'Unable to load newsletter preference.';
    }
    isLoading = false;
  }

  void load();

  return () => {
    cancelled = true;
  };
});

async function handleToggle(event: Event): Promise<void> {
  const target = event.currentTarget as HTMLInputElement;
  const desired = target.checked;
  const token = plugin.settings.authToken;

  if (!token || isSaving) {
    target.checked = !desired;
    return;
  }

  isSaving = true;
  const result = await service.updateConsent(token, {
    optIn: desired,
    source: 'settings_toggle',
  });

  if (result.success) {
    if (result.data) {
      consent = result.data;
    } else if (consent) {
      consent = { ...consent, optIn: desired };
    }
    new Notice(desired ? 'Newsletter enabled.' : 'Newsletter disabled.');
  } else {
    target.checked = !desired;
    new Notice(result.error?.message || 'Failed to update newsletter preference.');
  }
  isSaving = false;
}
</script>

{#if plugin.settings.authToken}
  <div class="sa-newsletter-toggle-row">
    <div class="sa-newsletter-toggle-info">
      <div class="sa-newsletter-toggle-name">Newsletter</div>
      <div class="sa-newsletter-toggle-desc">
        {#if isSuppressed}
          Disabled due to delivery issue — contact support to re-enable.
        {:else}
          Receive occasional product updates and tips.
        {/if}
      </div>
      {#if loadError}
        <div class="sa-newsletter-toggle-error">{loadError}</div>
      {/if}
    </div>
    <div class="sa-newsletter-toggle-control">
      <label class="sa-newsletter-switch">
        <input
          type="checkbox"
          checked={optInChecked}
          disabled={toggleDisabled}
          onchange={handleToggle}
          aria-label="Newsletter opt-in"
        />
        <span class="sa-newsletter-switch-slider" aria-hidden="true"></span>
      </label>
    </div>
  </div>
{/if}

<style>
  .sa-newsletter-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 16px;
    background: var(--background-secondary);
    border-radius: 8px;
    margin-bottom: 20px;
  }

  .sa-newsletter-toggle-info {
    flex: 1;
    min-width: 0;
  }

  .sa-newsletter-toggle-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-normal);
    margin-bottom: 2px;
  }

  .sa-newsletter-toggle-desc {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .sa-newsletter-toggle-error {
    font-size: 11px;
    color: var(--text-error);
    margin-top: 4px;
  }

  .sa-newsletter-toggle-control {
    flex-shrink: 0;
  }

  /* Match Obsidian's native toggle dimensions via --toggle-* variables so
     the newsletter switch stays consistent with SyncSettingsTab's
     .toggle-slider and Obsidian's own checkbox-container across platforms. */
  .sa-newsletter-switch {
    position: relative;
    display: inline-block;
    width: var(--toggle-width, 38px);
    height: calc(var(--toggle-thumb-height, 16px) + 4px);
  }

  .sa-newsletter-switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .sa-newsletter-switch-slider {
    position: absolute;
    cursor: pointer;
    inset: 0;
    background: var(--background-modifier-border);
    border-radius: var(--toggle-radius, 22px);
    transition: background 0.2s ease;
  }

  .sa-newsletter-switch-slider::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 2px;
    height: var(--toggle-thumb-height, 16px);
    width: var(--toggle-thumb-width, 16px);
    background: var(--toggle-thumb-color, var(--background-primary));
    border-radius: var(--toggle-thumb-radius, 50%);
    transform: translateY(-50%);
    transition: transform 0.2s ease;
  }

  .sa-newsletter-switch input:checked + .sa-newsletter-switch-slider {
    background: var(--interactive-accent);
  }

  .sa-newsletter-switch input:checked + .sa-newsletter-switch-slider::before {
    transform: translate(calc(var(--toggle-width, 38px) - var(--toggle-thumb-width, 16px) - 4px), -50%);
  }

  .sa-newsletter-switch input:disabled + .sa-newsletter-switch-slider {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
