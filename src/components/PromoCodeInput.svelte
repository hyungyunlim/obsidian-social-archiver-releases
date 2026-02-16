<script lang="ts">
  /**
   * PromoCodeInput - Promotional code entry component
   *
   * Mobile-first design with Obsidian theming
   */

  import { onMount } from 'svelte';
  import type {
    PromoCodeValidationResult,
    AppliedPromoCode,
    PromoCodeErrorCode
  } from '../types/license';

  // Props
  export let onApply: (code: string) => Promise<AppliedPromoCode>;
  export let onValidate: (code: string) => Promise<PromoCodeValidationResult>;
  export let disabled: boolean = false;
  export let placeholder: string = 'Enter promo code';
  export let appliedCodes: AppliedPromoCode[] = [];

  // State
  let code = $state('');
  let isValidating = $state(false);
  let isApplying = $state(false);
  let validationResult = $state<PromoCodeValidationResult | null>(null);
  let applyError = $state<string | null>(null);
  let successMessage = $state<string | null>(null);

  // Computed
  const isValid = $derived(validationResult?.valid === true);
  const hasError = $derived(validationResult?.valid === false || applyError !== null);
  const canApply = $derived(code.length > 0 && isValid && !isApplying && !disabled);
  const buttonDisabled = $derived(isApplying || isValidating || !canApply);

  /**
   * Validate promo code on input change
   */
  async function validateCode() {
    if (code.length === 0) {
      validationResult = null;
      return;
    }

    isValidating = true;
    applyError = null;
    successMessage = null;

    try {
      const result = await onValidate(code.trim());
      validationResult = result;
    } catch (error) {
      validationResult = {
        valid: false,
        error: error instanceof Error ? error.message : 'Validation failed',
      };
    } finally {
      isValidating = false;
    }
  }

  /**
   * Apply promo code
   */
  async function handleApply() {
    if (!canApply) return;

    isApplying = true;
    applyError = null;
    successMessage = null;

    try {
      const appliedCode = await onApply(code.trim());

      // Success!
      successMessage = `✓ ${appliedCode.benefit.description}`;

      // Clear input after success
      setTimeout(() => {
        code = '';
        validationResult = null;
        successMessage = null;
      }, 3000);
    } catch (error) {
      applyError = error instanceof Error ? error.message : 'Failed to apply code';
    } finally {
      isApplying = false;
    }
  }

  /**
   * Handle input change with debounce
   */
  let debounceTimer: NodeJS.Timeout;
  function handleInput(event: Event) {
    const target = event.target as HTMLInputElement;
    code = target.value.toUpperCase();

    // Clear previous timer
    clearTimeout(debounceTimer);

    // Debounce validation
    if (code.length > 0) {
      debounceTimer = setTimeout(() => {
        validateCode();
      }, 500);
    } else {
      validationResult = null;
    }
  }

  /**
   * Handle Enter key
   */
  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && canApply) {
      event.preventDefault();
      handleApply();
    }
  }

  /**
   * Get error message display
   */
  function getErrorMessage(): string {
    if (applyError) return applyError;
    if (validationResult?.error) return validationResult.error;
    return '';
  }

  /**
   * Get validation icon
   */
  function getValidationIcon(): string {
    if (isValidating) return '⏳';
    if (isValid) return '✓';
    if (hasError) return '✗';
    return '';
  }

  /**
   * Format benefit description
   */
  function formatBenefit(appliedCode: AppliedPromoCode): string {
    return appliedCode.benefit.description;
  }

  /**
   * Format applied date
   */
  function formatDate(date: Date): string {
    return new Date(date).toLocaleDateString();
  }
</script>

<div class="promo-code-input-container">
  <!-- Input Section -->
  <div class="promo-code-input-group">
    <label for="promo-code-input" class="promo-code-label">
      Promotional Code
    </label>

    <div class="promo-code-input-wrapper">
      <input
        id="promo-code-input"
        type="text"
        class="promo-code-input"
        class:is-valid={isValid}
        class:is-invalid={hasError}
        bind:value={code}
        oninput={handleInput}
        onkeydown={handleKeydown}
        placeholder={placeholder}
        disabled={disabled || isApplying}
        maxlength="50"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="characters"
        spellcheck="false"
      />

      {#if code.length > 0}
        <span class="promo-code-validation-icon" class:is-validating={isValidating}>
          {getValidationIcon()}
        </span>
      {/if}
    </div>

    <button
      type="button"
      class="promo-code-apply-button"
      class:is-loading={isApplying}
      disabled={buttonDisabled}
      onclick={handleApply}
    >
      {#if isApplying}
        <span class="spinner"></span>
        <span>Applying...</span>
      {:else}
        Apply Code
      {/if}
    </button>
  </div>

  <!-- Validation Messages -->
  {#if validationResult?.valid && validationResult.promoCode}
    <div class="promo-code-message promo-code-preview">
      <div class="promo-code-preview-icon">🎁</div>
      <div class="promo-code-preview-content">
        <strong>{validationResult.promoCode.description || 'Valid promotional code'}</strong>
        {#if validationResult.promoCode.partnerId}
          <span class="promo-code-partner">
            Partner: {validationResult.promoCode.partnerName || validationResult.promoCode.partnerId}
          </span>
        {/if}
      </div>
    </div>
  {/if}

  {#if hasError}
    <div class="promo-code-message promo-code-error">
      <span class="promo-code-error-icon">⚠️</span>
      <span>{getErrorMessage()}</span>
    </div>
  {/if}

  {#if successMessage}
    <div class="promo-code-message promo-code-success">
      <span>{successMessage}</span>
    </div>
  {/if}

  <!-- Applied Codes List -->
  {#if appliedCodes.length > 0}
    <div class="promo-code-applied-list">
      <h4 class="promo-code-applied-title">Applied Promotional Codes</h4>

      {#each appliedCodes as appliedCode}
        <div class="promo-code-applied-item">
          <div class="promo-code-applied-header">
            <span class="promo-code-applied-code">{appliedCode.code}</span>
            <span class="promo-code-applied-date">{formatDate(appliedCode.appliedAt)}</span>
          </div>
          <div class="promo-code-applied-benefit">
            {formatBenefit(appliedCode)}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .promo-code-input-container {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 100%;
  }

  .promo-code-input-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .promo-code-label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-muted);
    margin: 0;
  }

  .promo-code-input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .promo-code-input {
    flex: 1;
    padding: 0.75rem 2.5rem 0.75rem 1rem;
    font-size: 1rem;
    font-family: var(--font-monospace);
    border: 2px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    background-color: var(--background-primary);
    color: var(--text-normal);
    transition: all 0.2s;
    min-height: 44px; /* iOS minimum touch target */
    text-transform: uppercase;
  }

  .promo-code-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 3px var(--background-modifier-border-focus);
  }

  .promo-code-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .promo-code-input.is-valid {
    border-color: var(--color-green);
  }

  .promo-code-input.is-invalid {
    border-color: var(--color-red);
  }

  .promo-code-validation-icon {
    position: absolute;
    right: 1rem;
    font-size: 1.2rem;
    pointer-events: none;
  }

  .promo-code-validation-icon.is-validating {
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .promo-code-apply-button {
    padding: 0.75rem 1.5rem;
    font-size: 1rem;
    font-weight: 500;
    color: var(--text-on-accent);
    background-color: var(--interactive-accent);
    border: none;
    border-radius: var(--radius-m);
    cursor: pointer;
    transition: all 0.2s;
    min-height: 44px; /* iOS minimum touch target */
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .promo-code-apply-button:hover:not(:disabled) {
    background-color: var(--interactive-accent-hover);
  }

  .promo-code-apply-button:active:not(:disabled) {
    transform: scale(0.98);
  }

  .promo-code-apply-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .promo-code-apply-button.is-loading {
    opacity: 0.8;
  }

  .spinner {
    width: 1rem;
    height: 1rem;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .promo-code-message {
    padding: 0.75rem 1rem;
    border-radius: var(--radius-m);
    font-size: 0.875rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .promo-code-preview {
    background-color: var(--background-modifier-success);
    border: 1px solid var(--color-green);
    color: var(--text-normal);
  }

  .promo-code-preview-icon {
    font-size: 1.5rem;
  }

  .promo-code-preview-content {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .promo-code-partner {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .promo-code-error {
    background-color: var(--background-modifier-error);
    border: 1px solid var(--color-red);
    color: var(--text-error);
  }

  .promo-code-error-icon {
    font-size: 1rem;
  }

  .promo-code-success {
    background-color: var(--background-modifier-success);
    border: 1px solid var(--color-green);
    color: var(--text-success);
    animation: slideIn 0.3s ease-out;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .promo-code-applied-list {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--background-modifier-border);
  }

  .promo-code-applied-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-muted);
    margin: 0 0 0.75rem 0;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .promo-code-applied-item {
    padding: 0.75rem;
    background-color: var(--background-secondary);
    border-radius: var(--radius-m);
    margin-bottom: 0.5rem;
  }

  .promo-code-applied-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.25rem;
  }

  .promo-code-applied-code {
    font-family: var(--font-monospace);
    font-weight: 600;
    color: var(--text-normal);
  }

  .promo-code-applied-date {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .promo-code-applied-benefit {
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  /* Mobile optimization */
  @media (max-width: 768px) {
    .promo-code-input-group {
      gap: 0.75rem;
    }

    .promo-code-input,
    .promo-code-apply-button {
      font-size: 1rem; /* Prevent iOS zoom on focus */
      min-height: 48px; /* Larger touch target on mobile */
    }

    .promo-code-applied-item {
      padding: 1rem;
    }
  }

  /* Accessibility */
  @media (prefers-reduced-motion: reduce) {
    .promo-code-input,
    .promo-code-apply-button,
    .promo-code-message {
      transition: none;
    }

    .spinner,
    .promo-code-validation-icon.is-validating {
      animation: none;
    }
  }
</style>
