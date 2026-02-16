<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { LicenseInfo, CreditBalance } from '../types/license';
  import type { UserPlan } from '../types/credit';
  import type { GracePeriodStatus } from '../services/licensing/GracePeriodManager';

  /**
   * Props
   */
  interface Props {
    license?: LicenseInfo;
    balance?: CreditBalance;
    gracePeriodStatus?: GracePeriodStatus;
    onUpgrade?: () => void;
    onRenew?: () => void;
    gumroadUrl?: string;
  }

  let {
    license = $bindable(),
    balance = $bindable(),
    gracePeriodStatus = $bindable(),
    onUpgrade,
    onRenew,
    gumroadUrl = 'https://hyungyunlim.gumroad.com/l/social-archiver-pro'
  }: Props = $props();

  /**
   * Reactive state using Svelte 5 runes
   */
  let expanded = $state(false);
  let timeUntilReset = $state('');
  let updateInterval: NodeJS.Timeout | undefined;

  /**
   * Computed values
   */
  const plan = $derived<UserPlan>(license?.provider === 'gumroad' ? 'pro' : 'free');
  const licenseType = $derived((license as any)?.licenseType || 'free_tier');
  const isCreditPack = $derived(licenseType === 'credit_pack');
  const isSubscription = $derived(licenseType === 'subscription');
  const creditsUsed = $derived(balance ? balance.used : 0);
  const creditsTotal = $derived(balance ? balance.total : 0);
  const creditsRemaining = $derived(balance ? balance.remaining : 0);
  const percentage = $derived(creditsTotal > 0 ? (creditsRemaining / creditsTotal) * 100 : 0);
  const isLowCredits = $derived(percentage <= 20);
  const isCriticalCredits = $derived(percentage === 0);
  const isInGracePeriod = $derived(gracePeriodStatus?.isInGracePeriod || false);
  const graceDaysRemaining = $derived(gracePeriodStatus?.daysRemaining || 0);

  /**
   * Plan display properties
   */
  const planBadge = $derived(plan === 'pro' ? {
    text: 'Pro',
    class: 'plan-badge-pro',
    icon: '✨'
  } : {
    text: 'Free',
    class: 'plan-badge-free',
    icon: '🆓'
  });

  /**
   * Progress bar color based on remaining credits
   */
  const progressColor = $derived(
    isCriticalCredits ? 'progress-critical' :
    isLowCredits ? 'progress-low' :
    'progress-normal'
  );

  /**
   * Calculate time until next reset
   */
  function updateTimeUntilReset() {
    if (!balance?.resetAt) {
      timeUntilReset = 'Unknown';
      return;
    }

    const now = new Date();
    const reset = new Date(balance.resetAt);
    const diff = reset.getTime() - now.getTime();

    if (diff <= 0) {
      timeUntilReset = 'Reset pending...';
      return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) {
      timeUntilReset = `${days}d ${hours}h`;
    } else if (hours > 0) {
      timeUntilReset = `${hours}h ${minutes}m`;
    } else {
      timeUntilReset = `${minutes}m`;
    }
  }

  /**
   * Handle upgrade button click
   */
  function handleUpgrade() {
    if (onUpgrade) {
      onUpgrade();
    } else {
      // Open Gumroad page in external browser
      window.open(gumroadUrl, '_blank');
    }
  }

  /**
   * Handle renew button click
   */
  function handleRenew() {
    if (onRenew) {
      onRenew();
    } else {
      // Open Gumroad page in external browser
      window.open(gumroadUrl, '_blank');
    }
  }

  /**
   * Toggle expanded state
   */
  function toggleExpanded() {
    expanded = !expanded;
  }

  /**
   * Lifecycle: Start timer on mount
   */
  onMount(() => {
    updateTimeUntilReset();
    updateInterval = setInterval(updateTimeUntilReset, 60000); // Update every minute
  });

  /**
   * Lifecycle: Clean up on destroy
   */
  onDestroy(() => {
    if (updateInterval) {
      clearInterval(updateInterval);
    }
  });
</script>

<div class="license-status-container">
  <!-- Grace Period Warning Banner -->
  {#if isInGracePeriod}
    <div class="grace-period-banner">
      <div class="grace-period-icon">🚨</div>
      <div class="grace-period-content">
        <div class="grace-period-title">
          License Expired - Grace Period Active
        </div>
        <div class="grace-period-message">
          {#if graceDaysRemaining > 0}
            You have {graceDaysRemaining} {graceDaysRemaining === 1 ? 'day' : 'days'} remaining with limited features.
          {:else}
            Your grace period ends today. Limited features active.
          {/if}
        </div>
        {#if gracePeriodStatus?.restrictions}
          <div class="grace-period-restrictions">
            • Archives per day: {gracePeriodStatus.restrictions.maxArchivesPerDay}
            {#if !gracePeriodStatus.restrictions.canUseAI}
              <br/>• AI features: Disabled
            {/if}
            {#if !gracePeriodStatus.restrictions.canShare}
              <br/>• Public sharing: Disabled
            {/if}
          </div>
        {/if}
      </div>
      <button
        class="btn-renew-urgent"
        onclick={handleRenew}
        type="button"
      >
        Renew Now
      </button>
    </div>
  {/if}

  <!-- Header Section -->
  <div class="license-header">
    <div class="plan-info">
      <span class="plan-badge {planBadge.class}">
        <span class="plan-icon">{planBadge.icon}</span>
        <span class="plan-text">{planBadge.text}</span>
      </span>
      {#if license?.email}
        <span class="license-email">{license.email}</span>
      {/if}
    </div>

    {#if plan === 'free'}
      <button
        class="btn-upgrade"
        onclick={handleUpgrade}
        type="button"
      >
        Upgrade to Pro
      </button>
    {/if}
  </div>

  <!-- Credits Display -->
  <div class="credits-section">
    <div class="credits-header">
      <span class="credits-label">Credits</span>
      <span class="credits-value">
        {creditsRemaining} / {creditsTotal}
      </span>
    </div>

    <!-- Progress Bar -->
    <div class="progress-container">
      <div
        class="progress-bar {progressColor}"
        style="width: {percentage}%"
      ></div>
    </div>

    {#if balance?.carryover && balance.carryover > 0}
      <div class="credits-note">
        +{balance.carryover} rolled over from last month
      </div>
    {/if}
  </div>

  <!-- Reset Timer (Subscription only) -->
  {#if balance?.resetAt && isSubscription}
    <div class="reset-timer">
      <span class="reset-label">Next reset:</span>
      <span class="reset-value">{timeUntilReset}</span>
    </div>
  {/if}

  <!-- Expiration Date (Credit Pack) -->
  {#if isCreditPack && balance?.expiresAt}
    <div class="reset-timer">
      <span class="reset-label">Credits valid until:</span>
      <span class="reset-value">
        {new Date(balance.expiresAt).toLocaleDateString()}
      </span>
    </div>
  {/if}

  <!-- Low Credits Warning -->
  {#if plan === 'free' && isLowCredits && !isCriticalCredits}
    <div class="alert alert-warning">
      ⚠️ Running low on credits! {isSubscription ? 'Upgrade to Pro for 500 credits/month.' : 'Purchase more credit packs.'}
    </div>
  {/if}

  {#if isCriticalCredits}
    <div class="alert alert-critical">
      ❌ No credits remaining!
      {#if isCreditPack}
        Purchase a new credit pack to continue archiving.
      {:else if plan === 'free'}
        Upgrade to Pro or wait for monthly reset.
      {:else}
        Wait for monthly reset.
      {/if}
    </div>
  {/if}

  <!-- Expandable Usage Statistics -->
  <div class="stats-section">
    <button
      class="stats-toggle"
      onclick={toggleExpanded}
      type="button"
      aria-expanded={expanded}
    >
      <span>Usage Details</span>
      <span class="toggle-icon">{expanded ? '▼' : '▶'}</span>
    </button>

    {#if expanded}
      <div class="stats-content">
        <div class="stat-row">
          <span class="stat-label">Credits used this month:</span>
          <span class="stat-value">{creditsUsed}</span>
        </div>

        <div class="stat-row">
          <span class="stat-label">
            {isCreditPack ? 'Purchased credits:' : 'Monthly allowance:'}
          </span>
          <span class="stat-value">{creditsTotal}</span>
        </div>

        {#if isSubscription && balance?.resetAt}
          <div class="stat-row">
            <span class="stat-label">Reset date:</span>
            <span class="stat-value">
              {new Date(balance.resetAt).toLocaleDateString()}
            </span>
          </div>
        {/if}

        {#if isCreditPack && balance?.expiresAt}
          <div class="stat-row">
            <span class="stat-label">Expiration date:</span>
            <span class="stat-value">
              {new Date(balance.expiresAt).toLocaleDateString()}
            </span>
          </div>
        {/if}

        {#if isCreditPack && (license as any)?.initialCredits}
          <div class="stat-row">
            <span class="stat-label">Initial credits:</span>
            <span class="stat-value">{(license as any).initialCredits}</span>
          </div>
        {/if}

        {#if license?.purchaseDate}
          <div class="stat-row">
            <span class="stat-label">Member since:</span>
            <span class="stat-value">
              {new Date(license.purchaseDate).toLocaleDateString()}
            </span>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .license-status-container {
    padding: 16px;
    background: var(--background-primary);
    border-radius: 8px;
    border: 1px solid var(--background-modifier-border);
  }

  /* Grace Period Banner */
  .grace-period-banner {
    display: flex;
    gap: 12px;
    padding: 16px;
    background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
    border: 2px solid #dc2626;
    border-radius: 8px;
    margin-bottom: 16px;
    animation: pulse-border 2s ease-in-out infinite;
  }

  @keyframes pulse-border {
    0%, 100% {
      border-color: #dc2626;
    }
    50% {
      border-color: #ef4444;
    }
  }

  .grace-period-icon {
    font-size: 32px;
    flex-shrink: 0;
    animation: shake 0.5s ease-in-out infinite;
  }

  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-2px); }
    75% { transform: translateX(2px); }
  }

  .grace-period-content {
    flex: 1;
  }

  .grace-period-title {
    font-size: 16px;
    font-weight: 700;
    color: #991b1b;
    margin-bottom: 6px;
  }

  .grace-period-message {
    font-size: 14px;
    color: #7f1d1d;
    margin-bottom: 8px;
    line-height: 1.4;
  }

  .grace-period-restrictions {
    font-size: 12px;
    color: #7f1d1d;
    background: rgba(255, 255, 255, 0.6);
    padding: 8px;
    border-radius: 4px;
    line-height: 1.6;
  }

  .btn-renew-urgent {
    padding: 12px 20px;
    background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    min-height: 44px;
    flex-shrink: 0;
    transition: all 0.2s;
    box-shadow: 0 4px 12px rgba(220, 38, 38, 0.3);
  }

  .btn-renew-urgent:hover {
    background: linear-gradient(135deg, #991b1b 0%, #7f1d1d 100%);
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(220, 38, 38, 0.4);
  }

  .btn-renew-urgent:active {
    transform: translateY(0);
  }

  /* Header Section */
  .license-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    gap: 12px;
    flex-wrap: wrap;
  }

  .plan-info {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .plan-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 600;
  }

  .plan-badge-pro {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }

  .plan-badge-free {
    background: var(--background-secondary);
    color: var(--text-normal);
    border: 1px solid var(--background-modifier-border);
  }

  .plan-icon {
    font-size: 16px;
  }

  .license-email {
    font-size: 12px;
    color: var(--text-muted);
  }

  .btn-upgrade {
    padding: 8px 16px;
    background: var(--interactive-accent);
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    min-height: 44px; /* iOS touch target */
    transition: all 0.2s;
  }

  .btn-upgrade:hover {
    background: var(--interactive-accent-hover);
    transform: translateY(-1px);
  }

  .btn-upgrade:active {
    transform: translateY(0);
  }

  /* Credits Section */
  .credits-section {
    margin-bottom: 12px;
  }

  .credits-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .credits-label {
    font-size: 14px;
    color: var(--text-muted);
  }

  .credits-value {
    font-size: 18px;
    font-weight: 700;
    color: var(--text-normal);
  }

  .progress-container {
    width: 100%;
    height: 8px;
    background: var(--background-secondary);
    border-radius: 4px;
    overflow: hidden;
  }

  .progress-bar {
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s ease;
  }

  .progress-normal {
    background: linear-gradient(90deg, #10b981 0%, #059669 100%);
  }

  .progress-low {
    background: linear-gradient(90deg, #f59e0b 0%, #d97706 100%);
  }

  .progress-critical {
    background: linear-gradient(90deg, #ef4444 0%, #dc2626 100%);
  }

  .credits-note {
    margin-top: 6px;
    font-size: 12px;
    color: var(--text-muted);
    font-style: italic;
  }

  /* Reset Timer */
  .reset-timer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-top: 1px solid var(--background-modifier-border);
    border-bottom: 1px solid var(--background-modifier-border);
    margin-bottom: 12px;
  }

  .reset-label {
    font-size: 13px;
    color: var(--text-muted);
  }

  .reset-value {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-normal);
  }

  /* Alerts */
  .alert {
    padding: 12px;
    border-radius: 6px;
    font-size: 13px;
    margin-bottom: 12px;
    line-height: 1.4;
  }

  .alert-warning {
    background: var(--background-modifier-error-hover);
    color: var(--text-warning);
    border: 1px solid var(--text-warning);
  }

  .alert-critical {
    background: var(--background-modifier-error);
    color: var(--text-error);
    border: 1px solid var(--text-error);
    font-weight: 600;
  }

  /* Stats Section */
  .stats-section {
    margin-top: 12px;
  }

  .stats-toggle {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px;
    background: var(--background-secondary);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-normal);
    min-height: 44px; /* iOS touch target */
    transition: background 0.2s;
  }

  .stats-toggle:hover {
    background: var(--background-modifier-hover);
  }

  .toggle-icon {
    font-size: 10px;
    color: var(--text-muted);
  }

  .stats-content {
    margin-top: 8px;
    padding: 12px;
    background: var(--background-secondary);
    border-radius: 6px;
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
  }

  .stat-row:not(:last-child) {
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .stat-label {
    font-size: 13px;
    color: var(--text-muted);
  }

  .stat-value {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-normal);
  }

  /* Mobile Responsive */
  @media (max-width: 768px) {
    .license-status-container {
      padding: 12px;
    }

    .license-header {
      flex-direction: column;
      align-items: stretch;
    }

    .btn-upgrade {
      width: 100%;
    }
  }
</style>
