<script lang="ts">
/**
 * URLInputStep - URL Input with Platform Auto-detection
 *
 * @deprecated This component is deprecated and will be removed in the next major version.
 * Use ArchiveModal instead which handles URL input and validation.
 *
 * Features:
 * - Real-time platform detection
 * - Instagram and X URL validation
 * - Helpful error messages
 */

import type { URLInputStepProps } from './types';
import { parseProfileUrl } from './types';

let {
  initialUrl,
  onValidate,
  onCancel,
}: URLInputStepProps = $props();

let profileUrl = $state(initialUrl);
let isTouched = $state(false);

/**
 * Derived: Validation state
 */
const validation = $derived(() => {
  if (!profileUrl.trim()) {
    return { valid: false, username: null, error: null, platform: null as 'instagram' | 'x' | null };
  }

  const result = parseProfileUrl(profileUrl);

  if (result.valid && result.platform) {
    return {
      valid: true,
      username: result.username,
      error: null,
      platform: result.platform,
    };
  }

  return {
    valid: false,
    username: null,
    error: result.error,
    platform: null as 'instagram' | 'x' | null,
  };
});

/**
 * Derived: Can submit
 */
const canSubmit = $derived(validation.valid && validation.username);

/**
 * Derived: Show error
 */
const showError = $derived(isTouched && !validation.valid && validation.error);

/**
 * Handle input change
 */
function handleInput(): void {
  isTouched = true;
}

/**
 * Handle form submission
 */
function handleSubmit(event: Event): void {
  event.preventDefault();

  if (canSubmit && validation.username && validation.platform) {
    onValidate(profileUrl, validation.platform, validation.username);
  }
}

/**
 * Handle paste
 */
function handlePaste(): void {
  // Mark as touched after paste
  setTimeout(() => {
    isTouched = true;
  }, 0);
}
</script>

<form class="url-input-step" onsubmit={handleSubmit}>
  <div class="step-content">
    <!-- Input Field -->
    <div class="input-group">
      <label for="profile-url" class="input-label">Profile URL</label>
      <div class="input-wrapper">
        <input
          type="text"
          id="profile-url"
          class="url-input"
          class:has-error={showError}
          class:is-valid={validation.valid}
          placeholder="https://instagram.com/username or https://x.com/username"
          bind:value={profileUrl}
          oninput={handleInput}
          onpaste={handlePaste}
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        />
        {#if validation.valid && validation.platform === 'instagram'}
          <span class="platform-badge instagram">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
              <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
              <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
            </svg>
            Instagram
          </span>
        {:else if validation.valid && validation.platform === 'x'}
          <span class="platform-badge x">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
            X
          </span>
        {/if}
      </div>

      <!-- Validation Feedback -->
      {#if showError}
        <p class="error-message" role="alert">{validation.error}</p>
      {:else if validation.valid && validation.username}
        <p class="success-message">Profile: @{validation.username}</p>
      {:else}
        <p class="hint">Example: instagram.com/username or x.com/username</p>
      {/if}
    </div>

    <!-- Info Box -->
    <div class="info-box">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="16" x2="12" y2="12"></line>
        <line x1="12" y1="8" x2="12.01" y2="8"></line>
      </svg>
      <span>Only public profiles can be subscribed. Private profiles are not supported.</span>
    </div>
  </div>

  <!-- Footer Buttons -->
  <div class="step-footer">
    <button type="button" class="btn btn-secondary" onclick={onCancel}>
      Cancel
    </button>
    <button type="submit" class="btn btn-primary" disabled={!canSubmit}>
      Validate
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="5" y1="12" x2="19" y2="12"></line>
        <polyline points="12 5 19 12 12 19"></polyline>
      </svg>
    </button>
  </div>
</form>

<style>
  .url-input-step {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .step-content {
    padding: 20px;
    flex: 1;
  }

  .input-group {
    margin-bottom: 20px;
  }

  .input-label {
    display: block;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-normal);
    margin-bottom: 8px;
  }

  .input-wrapper {
    position: relative;
  }

  .url-input {
    width: 100%;
    padding: 12px 14px;
    padding-right: 120px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 14px;
    transition: border-color 0.15s ease;
  }

  .url-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .url-input.has-error {
    border-color: var(--text-error);
  }

  .url-input.is-valid {
    border-color: var(--text-success, #4caf50);
  }

  .platform-badge {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
  }

  .platform-badge.instagram {
    background: linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888);
    color: white;
  }

  .platform-badge.x {
    background: #000000;
    color: white;
  }

  .error-message {
    color: var(--text-error);
    font-size: 12px;
    margin-top: 6px;
    margin-bottom: 0;
  }

  .success-message {
    color: var(--text-success, #4caf50);
    font-size: 12px;
    margin-top: 6px;
    margin-bottom: 0;
  }

  .hint {
    color: var(--text-muted);
    font-size: 12px;
    margin-top: 6px;
    margin-bottom: 0;
  }

  .info-box {
    display: flex;
    gap: 10px;
    padding: 12px;
    background: var(--background-secondary);
    border-radius: 8px;
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .info-box svg {
    flex-shrink: 0;
    margin-top: 2px;
  }

  .step-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 16px 20px;
    border-top: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 18px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    border: none;
  }

  .btn-secondary {
    background: var(--background-modifier-border);
    color: var(--text-normal);
  }

  .btn-secondary:hover {
    background: var(--background-modifier-hover);
  }

  .btn-primary {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  .btn-primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
