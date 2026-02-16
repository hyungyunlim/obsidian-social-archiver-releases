<script lang="ts">
/**
 * ShareOptions - Share settings UI component
 *
 * Features:
 * - Public sharing toggle
 * - Password protection
 * - Expiry date picker (free: 30 days max, pro: unlimited)
 * - License verification integration
 * - Credits usage display
 */

import { Notice } from 'obsidian';
import type { ShareOptions, ShareTier } from '@/services/ShareManager';
import type { LicenseInfo } from '@/types/license';

/**
 * Component props
 */
interface ShareOptionsProps {
  options: ShareOptions;
  license?: LicenseInfo;
  tier?: ShareTier;
  creditsRequired?: number;
  onChange?: (options: ShareOptions) => void;
  onShareToggle?: (enabled: boolean) => void;
}

let {
  options = $bindable({ tier: 'free' }),
  license = $bindable(),
  tier = $bindable('free'),
  creditsRequired = 1,
  onChange,
  onShareToggle
}: ShareOptionsProps = $props();

/**
 * Component state
 */
let isPublic = $state(false);
let password = $state('');
let showPassword = $state(false);
let usePassword = $state(false);
let customExpiry = $state<Date | null>(null);
let useCustomExpiry = $state(false);
let showExpiryPicker = $state(false);

/**
 * Validation state
 */
let passwordError = $state('');
let expiryError = $state('');

/**
 * Derived state
 */
const isPro = $derived(tier === 'pro' || license?.provider === 'gumroad');
const maxExpiryDays = $derived(isPro ? null : 30);
const defaultExpiry = $derived(() => {
  const date = new Date();
  if (isPro) {
    date.setFullYear(date.getFullYear() + 1); // 1 year default for pro
  } else {
    date.setDate(date.getDate() + 30); // 30 days for free
  }
  return date;
});

/**
 * Password validation
 */
const isPasswordValid = $derived(() => {
  if (!usePassword) return true;
  if (password.length === 0) return false;
  if (password.length < 8) return false;
  // Check for at least one letter and one number
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  return hasLetter && hasNumber;
});

/**
 * Expiry validation
 */
const isExpiryValid = $derived(() => {
  if (!useCustomExpiry || !customExpiry) return true;

  const now = new Date();
  const maxDate = new Date();

  if (!isPro) {
    maxDate.setDate(maxDate.getDate() + 30);
    if (customExpiry > maxDate) {
      return false;
    }
  }

  return customExpiry > now;
});

/**
 * Update share options when state changes
 */
$effect(() => {
  const newOptions: ShareOptions = {
    tier: tier || 'free'
  };

  if (usePassword && password && isPasswordValid()) {
    newOptions.password = password;
  }

  if (useCustomExpiry && customExpiry && isExpiryValid()) {
    newOptions.customExpiry = customExpiry;
  }

  if (onChange) {
    onChange(newOptions);
  }
});

/**
 * Handle public toggle
 */
function togglePublic() {
  isPublic = !isPublic;
  if (onShareToggle) {
    onShareToggle(isPublic);
  }

  if (!isPublic) {
    // Reset options when disabling sharing
    usePassword = false;
    useCustomExpiry = false;
    password = '';
    customExpiry = null;
  }
}

/**
 * Handle password validation
 */
function validatePassword() {
  if (!usePassword || !password) {
    passwordError = '';
    return;
  }

  if (password.length < 8) {
    passwordError = 'Password must be at least 8 characters';
  } else if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    passwordError = 'Password must contain letters and numbers';
  } else {
    passwordError = '';
  }
}

/**
 * Handle expiry validation
 */
function validateExpiry() {
  if (!useCustomExpiry || !customExpiry) {
    expiryError = '';
    return;
  }

  const now = new Date();
  if (customExpiry <= now) {
    expiryError = 'Expiry date must be in the future';
    return;
  }

  if (!isPro) {
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + 30);
    if (customExpiry > maxDate) {
      expiryError = 'Free plan: Maximum 30 days expiry';
      return;
    }
  }

  expiryError = '';
}

/**
 * Format date for input
 */
function formatDateForInput(date: Date | null): string {
  if (!date) {
    const defaultDate = defaultExpiry();
    return defaultDate.toISOString().split('T')[0];
  }
  return date.toISOString().split('T')[0];
}

/**
 * Handle date input change
 */
function handleDateChange(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.value) {
    customExpiry = new Date(input.value + 'T00:00:00');
    validateExpiry();
  }
}

/**
 * Get minimum and maximum dates for picker
 */
function getDateConstraints() {
  const now = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const max = new Date();
  if (isPro) {
    max.setFullYear(max.getFullYear() + 10); // 10 years max for pro
  } else {
    max.setDate(max.getDate() + 30); // 30 days max for free
  }

  return {
    min: tomorrow.toISOString().split('T')[0],
    max: max.toISOString().split('T')[0]
  };
}

const dateConstraints = $derived(getDateConstraints());
</script>

<div class="share-options-container">
  <!-- Public Sharing Toggle -->
  <div class="share-section">
    <div class="share-header">
      <button
        class="share-toggle"
        class:active={isPublic}
        onclick={togglePublic}
        aria-label="Toggle public sharing"
      >
        <span class="toggle-switch" class:on={isPublic}></span>
        <span class="toggle-label">
          {isPublic ? 'Sharing Enabled' : 'Enable Sharing'}
        </span>
      </button>

      {#if isPublic}
        <span class="credits-badge">
          {creditsRequired} credit{creditsRequired !== 1 ? 's' : ''}
        </span>
      {/if}
    </div>

    {#if isPublic}
      <p class="share-description">
        Your note will be publicly accessible via a shareable link
        {#if !isPro}
          <span class="tier-notice">(Free: 30-day expiry)</span>
        {/if}
      </p>
    {/if}
  </div>

  <!-- Share Options (when enabled) -->
  {#if isPublic}
    <div class="options-container">
      <!-- Password Protection -->
      <div class="option-group">
        <label class="option-label">
          <input
            type="checkbox"
            bind:checked={usePassword}
            class="option-checkbox"
          />
          <span>Password Protection</span>
        </label>

        {#if usePassword}
          <div class="password-input-group">
            <div class="password-field">
              <input
                type={showPassword ? 'text' : 'password'}
                bind:value={password}
                onblur={validatePassword}
                placeholder="Enter password"
                class="password-input"
                class:error={passwordError}
                minlength="8"
              />
              <button
                class="password-toggle"
                onclick={() => showPassword = !showPassword}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {#if showPassword}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                  </svg>
                {:else}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                {/if}
              </button>
            </div>
            {#if passwordError}
              <p class="error-message">{passwordError}</p>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Custom Expiry -->
      <div class="option-group">
        <label class="option-label">
          <input
            type="checkbox"
            bind:checked={useCustomExpiry}
            class="option-checkbox"
          />
          <span>Custom Expiry Date</span>
        </label>

        {#if useCustomExpiry}
          <div class="expiry-input-group">
            <input
              type="date"
              value={formatDateForInput(customExpiry)}
              onchange={handleDateChange}
              min={dateConstraints.min}
              max={dateConstraints.max}
              class="expiry-input"
              class:error={expiryError}
            />
            {#if expiryError}
              <p class="error-message">{expiryError}</p>
            {/if}
            {#if !isPro}
              <p class="help-text">
                Free plan: Links expire after 30 days
              </p>
            {:else}
              <p class="help-text pro">
                Pro plan: Set any expiry date or keep permanent
              </p>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Plan Badge -->
      <div class="plan-indicator">
        <span class="plan-badge" class:pro={isPro}>
          {isPro ? '✨ Pro' : '🆓 Free'}
        </span>
        {#if !isPro}
          <a
            href="https://hyungyunlim.gumroad.com/l/social-archiver-pro"
            class="upgrade-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            Upgrade for unlimited expiry
          </a>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .share-options-container {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    background: var(--background-secondary);
    border-radius: 8px;
    border: 1px solid var(--background-modifier-border);
  }

  .share-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .share-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  /* Toggle Button */
  .share-toggle {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem;
    background: none;
    border: none;
    cursor: pointer;
    min-height: 44px; /* iOS HIG minimum touch target */
  }

  .toggle-switch {
    position: relative;
    width: 48px;
    height: 24px;
    background: var(--background-modifier-border);
    border-radius: 12px;
    transition: background 0.3s;
  }

  .toggle-switch.on {
    background: var(--interactive-accent);
  }

  .toggle-switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    background: white;
    border-radius: 10px;
    transition: transform 0.3s;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }

  .toggle-switch.on::after {
    transform: translateX(24px);
  }

  .toggle-label {
    font-weight: 500;
    color: var(--text-normal);
  }

  .credits-badge {
    padding: 2px 8px;
    background: var(--interactive-accent);
    color: white;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
  }

  .share-description {
    font-size: 13px;
    color: var(--text-muted);
    margin: 0;
    padding-left: 0.5rem;
  }

  .tier-notice {
    color: var(--text-accent);
    font-weight: 500;
  }

  /* Options Container */
  .options-container {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    background: var(--background-primary);
    border-radius: 6px;
    border: 1px solid var(--background-modifier-border);
  }

  .option-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .option-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    min-height: 44px;
    font-size: 14px;
    font-weight: 500;
  }

  .option-checkbox {
    width: 18px;
    height: 18px;
    cursor: pointer;
  }

  /* Password Input */
  .password-input-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-left: 1.5rem;
  }

  .password-field {
    position: relative;
    display: flex;
  }

  .password-input {
    flex: 1;
    padding: 0.5rem;
    padding-right: 2.5rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 14px;
  }

  .password-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .password-input.error {
    border-color: var(--text-error);
  }

  .password-toggle {
    position: absolute;
    right: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .password-toggle:hover {
    color: var(--text-normal);
  }

  /* Expiry Input */
  .expiry-input-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-left: 1.5rem;
  }

  .expiry-input {
    padding: 0.5rem;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 14px;
  }

  .expiry-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .expiry-input.error {
    border-color: var(--text-error);
  }

  /* Messages */
  .error-message {
    color: var(--text-error);
    font-size: 12px;
    margin: 0;
  }

  .help-text {
    color: var(--text-muted);
    font-size: 12px;
    margin: 0;
  }

  .help-text.pro {
    color: var(--text-accent);
  }

  /* Plan Indicator */
  .plan-indicator {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 0.5rem;
    border-top: 1px solid var(--background-modifier-border);
  }

  .plan-badge {
    padding: 4px 8px;
    background: var(--background-modifier-hover);
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
  }

  .plan-badge.pro {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }

  .upgrade-link {
    font-size: 12px;
    color: var(--text-accent);
    text-decoration: none;
  }

  .upgrade-link:hover {
    text-decoration: underline;
  }

  /* Mobile Responsive */
  @media (max-width: 480px) {
    .share-options-container {
      padding: 0.75rem;
    }

    .options-container {
      padding: 0.75rem;
    }

    .password-input-group,
    .expiry-input-group {
      margin-left: 0;
    }
  }
</style>