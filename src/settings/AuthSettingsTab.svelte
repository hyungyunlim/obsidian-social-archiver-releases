<script lang="ts">
import { Notice } from 'obsidian';
import QRCode from 'qrcode';
import type SocialArchiverPlugin from '../main';
import type { BillingUsageSummary, SocialArchiverSettings, PlatformTiming } from '../types/settings';
import { AuthService } from '../services/AuthService';
import {
  completeAuthentication,
  showAuthSuccess,
  showAuthError,
  requestEmailChange,
  refreshUserBillingUsage,
  refreshUserEmail,
} from '../utils/auth';
import { DEFAULT_BILLING_CAMPAIGN } from '../shared/billing/campaign';
import NewsletterConsentBanner from './NewsletterConsentBanner.svelte';
import NewsletterConsentToggle from './NewsletterConsentToggle.svelte';
import BillingEventsSection from '../components/billing/BillingEventsSection.svelte';

/**
 * Billing launch campaign copy (PRD §8.4).
 * Plugin is read-only on billing — purchases happen in the mobile app.
 */
const lifetimeOfferLabel = DEFAULT_BILLING_CAMPAIGN.plans.lifetime.label;

interface Props {
  plugin: SocialArchiverPlugin;
}

let { plugin }: Props = $props();

// Auth mode: 'signup' | 'login' | 'waiting'
let authMode = $state<'signup' | 'login' | 'waiting'>('signup');

// Form state
let email = $state('');
let username = $state('');
let isSubmitting = $state(false);

// Cross-device auth state
type CrossDeviceState = 'idle' | 'loading' | 'code-shown' | 'approved' | 'rejected' | 'expired' | 'error';
let crossDeviceState = $state<CrossDeviceState>('idle');
let crossDeviceDisplayCode = $state('');
let crossDeviceSessionId = $state('');
let crossDeviceSecondsLeft = $state(0);
let crossDeviceError = $state('');
let crossDevicePollIntervalMs = $state(3000);
let crossDeviceQrSvg = $state('');

// Internal cross-device timer/poll handles (not reactive, managed manually)
let _crossDeviceCountdownTimer: number | null = null;
let _crossDevicePollTimer: number | null = null;
let _crossDeviceActive = false;

function stopCrossDeviceTimers(): void {
  _crossDeviceActive = false;
  if (_crossDeviceCountdownTimer !== null) {
    window.clearInterval(_crossDeviceCountdownTimer);
    _crossDeviceCountdownTimer = null;
  }
  if (_crossDevicePollTimer !== null) {
    window.clearInterval(_crossDevicePollTimer);
    _crossDevicePollTimer = null;
  }
}

function startCrossDeviceTimers(sessionId: string, expiresAt: string, pollMs: number): void {
  stopCrossDeviceTimers();
  _crossDeviceActive = true;

  // Countdown timer — update every second
  const updateCountdown = (): void => {
    const remaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
    crossDeviceSecondsLeft = remaining;
    if (remaining === 0) {
      stopCrossDeviceTimers();
      if (crossDeviceState === 'code-shown') {
        crossDeviceState = 'expired';
      }
    }
  };
  updateCountdown();
  _crossDeviceCountdownTimer = window.setInterval(updateCountdown, 1000);

  // Poll timer
  const authService = new AuthService(plugin.settings.workerUrl, plugin.manifest.version);
  const poll = async (): Promise<void> => {
    if (!_crossDeviceActive) return;
    try {
      const result = await authService.pollCrossDeviceStatus(sessionId);
      if (!_crossDeviceActive) return;

      if (!result.success || !result.data) {
        // Non-fatal network hiccup; keep polling
        return;
      }

      const status = result.data.status;

      if (status === 'approved' || status === 'consumed') {
        stopCrossDeviceTimers();
        const authToken = result.data.authToken;
        if (!authToken) {
          crossDeviceState = 'error';
          crossDeviceError = 'Failed to receive auth token.';
          return;
        }
        // Complete authentication using existing utility
        const completion = await completeAuthentication(plugin, authToken);
        if (completion.success) {
          crossDeviceState = 'approved';
          isAuthenticated = true;
          settings = plugin.settings;
          showAuthSuccess(completion.username || '');

          // Auto-register sync client when logged in via mobile app.
          // The user clearly has the mobile app, so enable sync automatically.
          if (!plugin.settings.syncClientId) {
            plugin.registerSyncClient().catch(() => {
              // Best-effort: sync can be enabled manually later
            });
          }
        } else {
          crossDeviceState = 'error';
          crossDeviceError = completion.error || 'Authentication failed.';
          showAuthError(crossDeviceError);
        }
      } else if (status === 'rejected') {
        stopCrossDeviceTimers();
        crossDeviceState = 'rejected';
      } else if (status === 'expired') {
        stopCrossDeviceTimers();
        crossDeviceState = 'expired';
      }
      // 'pending' → keep polling
    } catch {
      // Silently ignore poll errors; keep polling
    }
  };

  _crossDevicePollTimer = window.setInterval(poll, pollMs);
}

/**
 * Start cross-device auth flow
 */
async function handleStartCrossDeviceAuth(): Promise<void> {
  crossDeviceState = 'loading';
  crossDeviceError = '';

  const authService = new AuthService(plugin.settings.workerUrl, plugin.manifest.version);
  const result = await authService.initCrossDeviceAuth();

  if (!result.success || !result.data) {
    crossDeviceState = 'error';
    crossDeviceError = result.error?.message || 'Unable to start session.';
    return;
  }

  const { displayCode, sessionId, expiresAt, pollIntervalMs, code } = result.data;
  crossDeviceDisplayCode = displayCode;
  crossDeviceSessionId = sessionId;
  crossDevicePollIntervalMs = pollIntervalMs;
  crossDeviceState = 'code-shown';
  startCrossDeviceTimers(sessionId, expiresAt, pollIntervalMs);

  // Generate QR code with deep link for mobile scanning
  const rawCode = code || displayCode.replace(/-/g, '');
  // Universal Link — iOS/Android intercept and open the app directly.
  // When app is NOT installed, browser opens the fallback page at social-archive.org.
  const deepLink = `https://social-archive.org/auth/approve-device?code=${rawCode}&source=obsidian`;
  try {
    crossDeviceQrSvg = await QRCode.toString(deepLink, {
      type: 'svg',
      margin: 2,
      width: 160,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch {
    crossDeviceQrSvg = '';
  }
}

/**
 * Cancel cross-device auth and return to initial login state
 */
function handleCancelCrossDevice(): void {
  stopCrossDeviceTimers();
  crossDeviceState = 'idle';
  crossDeviceDisplayCode = '';
  crossDeviceSessionId = '';
  crossDeviceError = '';
  crossDeviceQrSvg = '';
}

// Cleanup cross-device timers when the component is destroyed
$effect(() => {
  return () => {
    stopCrossDeviceTimers();
  };
});

// Local reactive state
let isAuthenticated = $state(plugin.settings.isVerified && plugin.settings.authToken !== '');
let settings = $state(plugin.settings);
let billingUsage = $state<BillingUsageSummary | undefined>(undefined);
let isBillingUsageLoading = $state(false);
let billingUsageError = $state('');

$effect(() => {
  const ref = plugin.events.on('settings-changed', () => {
    settings = plugin.settings;
    billingUsage = plugin.settings.billingUsage;
  });

  return () => {
    plugin.events.offref(ref);
  };
});

// Computed states
let archiveQuota = $derived(billingUsage?.archiveQuota ?? settings.billingUsage?.archiveQuota);
let rawBillingPlan = $derived(billingUsage?.plan ?? settings.billingUsage?.plan ?? settings.tier);
let billingPlanDisplay = $derived(formatBillingPlan(rawBillingPlan));
let betaFreeSunsetLine = $derived(getBetaFreeSunsetLine(rawBillingPlan, billingUsage?.policy ?? settings.billingUsage?.policy));
let archiveQuotaProgress = $derived(getArchiveQuotaProgress(archiveQuota));
let isLifetimePlan = $derived(rawBillingPlan === 'lifetime');
let archiveQuotaExhausted = $derived(
  !!archiveQuota &&
  archiveQuota.unlimited !== true &&
  archiveQuota.limit !== -1 &&
  archiveQuota.remaining <= 0
);

function formatBillingPlan(plan: string): string {
  if (!plan) return 'Free';
  if (plan === 'beta-free') return 'Beta Free';
  if (plan === 'free') return 'Free';
  if (plan === 'premium') return 'Premium';
  if (plan === 'lifetime') return 'Lifetime';
  if (plan === 'admin') return 'Admin';
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

function formatDate(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getBetaFreeSunsetLine(plan: string, policy?: BillingUsageSummary['policy']): string {
  if (plan !== 'beta-free') return '';

  const sunsetDate = formatDate(policy?.betaFreeSunsetAt);
  if (!sunsetDate) return '';

  if (policy?.betaFreeSunsetActive) {
    return 'Beta Free has ended. Free plan limits now apply.';
  }

  return `Beta Free ends ${sunsetDate}. Free plan limits apply after that.`;
}

function getArchiveQuotaProgress(quota: BillingUsageSummary['archiveQuota'] | undefined): number {
  if (!quota || quota.limit <= 0 || quota.limit === -1 || quota.unlimited) return 0;
  return Math.max(0, Math.min(100, (quota.used / quota.limit) * 100));
}

async function handleRefreshBillingUsage(showNotice = true): Promise<void> {
  if (!isAuthenticated || !plugin.settings.authToken) return;

  isBillingUsageLoading = true;
  billingUsageError = '';
  try {
    const refreshed = await refreshUserBillingUsage(plugin);
    if (!refreshed) {
      billingUsageError = 'Unable to refresh archive usage.';
      if (showNotice) new Notice('Unable to refresh archive usage');
      return;
    }

    settings = plugin.settings;
    billingUsage = plugin.settings.billingUsage;
    if (showNotice) new Notice('Archive usage refreshed');
  } catch {
    billingUsageError = 'Unable to refresh archive usage.';
    if (showNotice) new Notice('Unable to refresh archive usage');
  } finally {
    isBillingUsageLoading = false;
  }
}

/**
 * Validate email format
 */
function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate username format
 */
function validateUsername(username: string): boolean {
  if (username.length < 3 || username.length > 20) return false;
  const usernameRegex = /^[a-z0-9][a-z0-9_-]*[a-z0-9]$/;
  if (username.length === 3) {
    return /^[a-z0-9]{3}$/.test(username);
  }
  return usernameRegex.test(username);
}

/**
 * Handle account creation (signup)
 */
async function handleCreateAccount() {
  // Normalize inputs
  const normalizedEmail = email.toLowerCase().trim();
  const normalizedUsername = username.toLowerCase().trim();

  // Validate
  if (!validateEmail(normalizedEmail)) {
    new Notice('❌ Invalid email address');
    return;
  }

  if (!validateUsername(normalizedUsername)) {
    new Notice('❌ Username must be 3-20 characters (lowercase, numbers, hyphens, underscores)');
    return;
  }

  isSubmitting = true;

  try {
    // Call API to reserve username and send magic link
    const response = await fetch(`${plugin.settings.workerUrl}/api/auth/reserve-username`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: normalizedEmail,
        username: normalizedUsername,
        deviceId: plugin.settings.deviceId
      })
    });

    const data = await response.json();

    if (data.success) {
      // Switch to waiting mode
      authMode = 'waiting';
      new Notice(`✅ ${data.message}`);

      // Store pending authentication data
      plugin.settings.email = normalizedEmail;
      plugin.settings.username = normalizedUsername;
      await plugin.saveSettings();
    } else {
      new Notice(`❌ ${data.error?.message || 'Failed to create account'}`);
    }
  } catch (error) {
    new Notice('❌ Network error. Please try again.');
  } finally {
    isSubmitting = false;
  }
}

/**
 * Handle login (existing users)
 */
async function handleLogin() {
  // Normalize email
  const normalizedEmail = email.toLowerCase().trim();

  // Validate
  if (!validateEmail(normalizedEmail)) {
    new Notice('❌ Invalid email address');
    return;
  }

  isSubmitting = true;

  try {
    // Call API to send magic link
    const response = await fetch(`${plugin.settings.workerUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: normalizedEmail
      })
    });

    const data = await response.json();

    if (data.success) {
      // Switch to waiting mode
      authMode = 'waiting';
      new Notice(`✅ ${data.message}`);

      // Store pending email
      plugin.settings.email = normalizedEmail;
      await plugin.saveSettings();
    } else {
      new Notice(`❌ ${data.error?.message || 'Failed to send login link'}`);
    }
  } catch (error) {
    new Notice('❌ Network error. Please try again.');
  } finally {
    isSubmitting = false;
  }
}

/**
 * Handle resend magic link
 */
async function handleResend() {
  if (authMode === 'waiting') {
    // Reset to previous mode and resend
    const wasLogin = !plugin.settings.username;
    authMode = wasLogin ? 'login' : 'signup';
    email = plugin.settings.email;
    username = plugin.settings.username || '';

    if (wasLogin) {
      await handleLogin();
    } else {
      await handleCreateAccount();
    }
  }
}

/**
 * Cancel waiting and return to auth form
 */
function handleCancelWaiting() {
  stopCrossDeviceTimers();
  crossDeviceState = 'idle';
  authMode = 'signup';
  email = '';
  username = '';
}

/**
 * Handle sign out
 */
async function handleSignOut() {
  await plugin.signOut();
  isAuthenticated = false;
  settings = plugin.settings;
  new Notice('Signed out successfully');
}

/**
 * Format platform timing data for display
 */
function formatTiming(timing: PlatformTiming | undefined): string {
  if (!timing || timing.count === 0) return 'No data';

  const avgSeconds = (timing.avg / 1000).toFixed(1);
  return `${avgSeconds}s avg (${timing.success}/${timing.count} success)`;
}

/**
 * Get platform display name
 */
function getPlatformDisplayName(platform: string): string {
  const names: Record<string, string> = {
    facebook: 'Facebook',
    instagram: 'Instagram',
    linkedin: 'LinkedIn',
    tiktok: 'TikTok',
    x: 'X (Twitter)',
    threads: 'Threads',
    youtube: 'YouTube',
    reddit: 'Reddit',
    pinterest: 'Pinterest',
    substack: 'Substack',
    tumblr: 'Tumblr',
    mastodon: 'Mastodon',
    bluesky: 'Bluesky'
  };
  return names[platform] || platform;
}

// === Email Change State ===
let showEmailChangeForm = $state(false);
let newEmailInput = $state('');
let isRequestingEmailChange = $state(false);

/**
 * Map server error codes to user-friendly messages
 */
function getEmailChangeErrorMessage(code: string, fallback: string): string {
  const messages: Record<string, string> = {
    'SAME_EMAIL': "That's already your current email",
    'EMAIL_ALREADY_IN_USE': 'This email is already used by another account',
    'RATE_LIMITED': 'Email can only be changed once per 24 hours',
    'INVALID_EMAIL': 'Please enter a valid email address',
    'UNAUTHORIZED': 'Please sign in again to change your email',
  };
  return messages[code] || fallback;
}

/**
 * Handle email change request submission
 */
async function handleRequestEmailChange(): Promise<void> {
  const normalizedEmail = newEmailInput.toLowerCase().trim();

  if (!validateEmail(normalizedEmail)) {
    new Notice('Please enter a valid email address');
    return;
  }

  if (normalizedEmail === settings.email) {
    new Notice("That's already your current email");
    return;
  }

  isRequestingEmailChange = true;

  try {
    const result = await requestEmailChange(plugin, normalizedEmail);

    if (result.success && result.newEmailMasked) {
      new Notice(
        `Verification email sent to ${result.newEmailMasked}. Check your inbox.`,
        8000
      );
      // Reset form
      showEmailChangeForm = false;
      newEmailInput = '';
    } else {
      const message = getEmailChangeErrorMessage(
        result.errorCode || '',
        result.errorMessage || 'Failed to request email change'
      );
      new Notice(message, 5000);
    }
  } catch {
    new Notice('Network error. Please try again.', 5000);
  } finally {
    isRequestingEmailChange = false;
  }
}

/**
 * Cancel email change form and reset state
 */
function handleCancelEmailChange(): void {
  showEmailChangeForm = false;
  newEmailInput = '';
}

// Refresh canonical email from server when the component mounts (authenticated only)
$effect(() => {
  if (isAuthenticated) {
    billingUsage = plugin.settings.billingUsage;
    void handleRefreshBillingUsage(false);

    refreshUserEmail(plugin).then((serverEmail) => {
      if (serverEmail && serverEmail !== settings.email) {
        // Update local reactive state to reflect the refreshed email
        settings = plugin.settings;
      }
    }).catch(() => {
      // Silently ignore - email will be refreshed on next settings open
    });
  }
});
</script>

<div class="auth-settings-container">
  {#if !isAuthenticated}
    {#if authMode === 'waiting'}
      <!-- Waiting for Magic Link State -->
      <div class="auth-section">
        <div class="callout callout-info">
          <div class="callout-title">📧 Check Your Email</div>
          <div class="callout-content">
            <p>We've sent a magic link to <strong>{plugin.settings.email}</strong></p>
            <p>Click the link in your email to complete authentication.</p>
            <p class="text-muted">The link will expire in 5 minutes.</p>
            <p class="text-muted spam-notice">💡 <strong>Tip:</strong> If you don't see the email, please check your spam or junk folder.</p>
          </div>
        </div>

        <div class="waiting-actions">
          <button class="mod-cta" onclick={handleResend} disabled={isSubmitting}>
            {isSubmitting ? 'Resending...' : 'Resend Link'}
          </button>
          <button onclick={handleCancelWaiting}>
            Cancel
          </button>
        </div>
      </div>
    {:else}
      <!-- Unauthenticated State -->
      <div class="auth-section">
        <p class="auth-description">Authentication is required to archive social media posts. Magic link authentication - no password needed.</p>

        <!-- Email Field (always shown) -->
        <div class="setting-item">
          <div class="setting-item-info">
            <div class="setting-item-name">Email</div>
            <div class="setting-item-description">
              {#if authMode === 'signup'}
                We'll send you a magic link to verify your account
              {:else}
                We'll send you a magic link to log in
              {/if}
            </div>
          </div>
          <div class="setting-item-control">
            <input
              type="email"
              placeholder="you@example.com"
              bind:value={email}
              disabled={isSubmitting}
            />
          </div>
        </div>

        <!-- Username Field (only for signup) -->
        {#if authMode === 'signup'}
          <div class="setting-item">
            <div class="setting-item-info">
              <div class="setting-item-name">Username</div>
              <div class="setting-item-description">3-20 characters (lowercase, numbers, hyphens, underscores)</div>
            </div>
            <div class="setting-item-control">
              <input
                type="text"
                placeholder="your-username"
                bind:value={username}
                disabled={isSubmitting}
              />
            </div>
          </div>
        {/if}

        <!-- Action Buttons -->
        <div class="setting-item">
          <div class="setting-item-control">
            <div class="auth-buttons">
              {#if authMode === 'signup'}
                <button
                  class="mod-cta"
                  onclick={handleCreateAccount}
                  disabled={isSubmitting || !email || !username}
                >
                  {isSubmitting ? 'Creating Account...' : 'Create Account'}
                </button>
                <button
                  onclick={() => { authMode = 'login'; username = ''; }}
                  disabled={isSubmitting}
                >
                  Log In
                </button>
              {:else}
                <button
                  class="mod-cta"
                  onclick={handleLogin}
                  disabled={isSubmitting || !email}
                >
                  {isSubmitting ? 'Sending Link...' : 'Send Magic Link'}
                </button>
                <button
                  onclick={() => { authMode = 'signup'; }}
                  disabled={isSubmitting}
                >
                  Create Account
                </button>
              {/if}
            </div>
          </div>
        </div>

        <!-- Cross-Device Auth Divider -->
        <div class="xdev-divider">
          <span class="xdev-divider-text">or</span>
        </div>

        <!-- Cross-Device Auth Section -->
        {#if crossDeviceState === 'idle'}
          <div class="setting-item">
            <div class="setting-item-control" style="width: 100%;">
              <button
                class="xdev-start-button"
                onclick={handleStartCrossDeviceAuth}
                disabled={isSubmitting}
              >
                Log in with mobile app
              </button>
            </div>
          </div>
        {:else if crossDeviceState === 'loading'}
          <div class="xdev-section">
            <p class="xdev-hint">Starting session...</p>
          </div>
        {:else if crossDeviceState === 'code-shown'}
          <div class="xdev-section">
            {#if crossDeviceQrSvg}
              <div class="xdev-qr-container">
                {@html crossDeviceQrSvg}
              </div>
              <p class="xdev-instruction">Scan the QR code or enter the code in the mobile app</p>
            {:else}
              <p class="xdev-instruction">Enter this code in the mobile app</p>
            {/if}
            <div class="xdev-code-display">{crossDeviceDisplayCode}</div>
            <p class="xdev-timer">
              {#if crossDeviceSecondsLeft > 0}
                Expires in {Math.floor(crossDeviceSecondsLeft / 60)}:{String(crossDeviceSecondsLeft % 60).padStart(2, '0')}
              {:else}
                Expired
              {/if}
            </p>
            <div class="xdev-actions">
              <button onclick={handleCancelCrossDevice}>Cancel</button>
            </div>
          </div>
        {:else if crossDeviceState === 'approved'}
          <div class="xdev-section xdev-success">
            <p>Logged in with mobile app!</p>
          </div>
        {:else if crossDeviceState === 'rejected'}
          <div class="xdev-section xdev-error">
            <p>Rejected from mobile</p>
            <div class="xdev-actions">
              <button onclick={handleStartCrossDeviceAuth}>Try again</button>
              <button onclick={handleCancelCrossDevice}>Cancel</button>
            </div>
          </div>
        {:else if crossDeviceState === 'expired'}
          <div class="xdev-section xdev-error">
            <p>Code has expired</p>
            <div class="xdev-actions">
              <button onclick={handleStartCrossDeviceAuth}>Generate new code</button>
              <button onclick={handleCancelCrossDevice}>Cancel</button>
            </div>
          </div>
        {:else if crossDeviceState === 'error'}
          <div class="xdev-section xdev-error">
            <p>{crossDeviceError || 'An error occurred.'}</p>
            <div class="xdev-actions">
              <button onclick={handleStartCrossDeviceAuth}>Try again</button>
              <button onclick={handleCancelCrossDevice}>Cancel</button>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  {:else}
    <!-- Authenticated State -->
    <div class="auth-section">
      <!-- Newsletter Consent Banner (shown only when server says modalShouldShow) -->
      <NewsletterConsentBanner {plugin} />

      <!-- User Info - Simple and Clean -->
      <div class="user-info-minimal">
        <div class="user-avatar">
          {settings.username.substring(0, 2).toUpperCase()}
        </div>
        <div class="user-details">
          <div class="user-name">@{settings.username}</div>
          <div class="user-email-row">
            <span class="user-email">{settings.email}</span>
            {#if !showEmailChangeForm}
              <button
                class="email-change-trigger"
                onclick={() => { showEmailChangeForm = true; newEmailInput = ''; }}
              >Change</button>
            {/if}
          </div>
        </div>
        <div class="user-tier-info">
          <div class="user-tier-badge">
            {billingPlanDisplay}
          </div>
          {#if isLifetimePlan && lifetimeOfferLabel}
            <div class="user-tier-offer">{lifetimeOfferLabel}</div>
          {/if}
        </div>
      </div>

      <!-- Inline Email Change Form -->
      {#if showEmailChangeForm}
        <div class="email-change-form">
          <div class="email-change-input-row">
            <input
              type="email"
              class="email-change-input"
              placeholder="new@example.com"
              bind:value={newEmailInput}
              disabled={isRequestingEmailChange}
              onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') handleRequestEmailChange(); }}
            />
          </div>
          <div class="email-change-actions">
            <button
              class="mod-cta email-change-submit"
              onclick={handleRequestEmailChange}
              disabled={isRequestingEmailChange || !newEmailInput.trim()}
            >
              {isRequestingEmailChange ? 'Sending...' : 'Send Verification'}
            </button>
            <button
              class="email-change-cancel"
              onclick={handleCancelEmailChange}
              disabled={isRequestingEmailChange}
            >
              Cancel
            </button>
          </div>
          <p class="email-change-hint">A verification link will be sent to your new email address.</p>
        </div>
      {/if}

      <div class={`billing-usage-display${archiveQuotaExhausted ? ' quota-exhausted' : ''}`}>
        <div class="billing-usage-header">
          <div>
            <div class="billing-usage-label">Archive quota</div>
            <div class="billing-usage-plan">{billingPlanDisplay}</div>
          </div>
          <button
            class="billing-refresh-button"
            onclick={() => handleRefreshBillingUsage(true)}
            disabled={isBillingUsageLoading}
          >
            {isBillingUsageLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {#if betaFreeSunsetLine}
          <div class="billing-usage-reset beta-free-sunset">{betaFreeSunsetLine}</div>
        {/if}

        {#if archiveQuota}
          {#if archiveQuota.unlimited || archiveQuota.limit === -1}
            <div class="billing-usage-main">
              <span class="billing-usage-value">No monthly limit</span>
              <span class="billing-usage-muted">{archiveQuota.used} archived this month</span>
            </div>
          {:else}
            <div class="billing-usage-main">
              <span class="billing-usage-value">{archiveQuota.used}</span>
              <span class="billing-usage-separator">/</span>
              <span class="billing-usage-limit">{archiveQuota.limit}</span>
              <span class="billing-usage-muted">({archiveQuota.remaining} left)</span>
            </div>
            <div class="billing-progress-track" aria-hidden="true">
              <div class="billing-progress-bar" style={`width: ${archiveQuotaProgress}%`}></div>
            </div>
            {#if archiveQuota.resetAt}
              <div class="billing-usage-reset">Monthly quota resets {formatDate(archiveQuota.resetAt)}</div>
            {/if}
            {#if archiveQuotaExhausted}
              <div class="billing-usage-warning">Upgrade in the mobile app to archive more.</div>
            {/if}
          {/if}
        {:else if billingUsageError}
          <div class="billing-usage-error">{billingUsageError}</div>
        {:else}
          <div class="billing-usage-muted">Archive usage will appear after sync.</div>
        {/if}
      </div>

      <!-- Billing lifecycle events (server-driven; renders nothing when empty) -->
      <BillingEventsSection {plugin} />

      <!-- Platform Stats - Compact Grid -->
      {#if Object.keys(settings.byPlatform).length > 0}
        <div class="platform-minimal-header">Platform Activity</div>
        <div class="platform-minimal-grid">
          {#each Object.entries(settings.byPlatform).filter(([, count]) => count > 0) as [platform, count]}
            <div class="platform-minimal-item">
              <div class="platform-minimal-name">{getPlatformDisplayName(platform)}</div>
              <div class="platform-minimal-count">{count}</div>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Newsletter Settings Toggle -->
      <NewsletterConsentToggle {plugin} />

      <!-- Sign Out - Simple Button -->
      <div class="sign-out-section">
        <button
          class="sign-out-button"
          onclick={handleSignOut}
        >
          Sign Out
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
.auth-settings-container {
  margin-top: 1em;
}

.auth-section {
  margin-bottom: 1.5em;
}

.auth-description {
  color: var(--text-muted);
  font-size: 0.9em;
  margin: 0 0 1em 0;
  line-height: 1.5;
}

.callout {
  padding: 1em;
  margin: 1em 0;
  border-radius: 4px;
  background: var(--background-secondary);
  border-left: 4px solid var(--interactive-accent);
}

.callout-info {
  border-left-color: var(--color-blue);
}

.callout-title {
  font-weight: 600;
  margin-bottom: 0.5em;
}

.callout-content p {
  margin: 0.25em 0;
  font-size: 0.9em;
}

.callout-content .text-muted {
  color: var(--text-muted);
  font-size: 0.85em;
  margin-top: 0.5em;
}

.callout-content .spam-notice {
  margin-top: 0.75em;
  padding-top: 0.5em;
  border-top: 1px solid var(--background-modifier-border);
}

/* Auth Buttons */
.auth-buttons {
  display: flex;
  gap: 0.5em;
}

.auth-buttons button {
  flex: 1;
}

/* Waiting Actions */
.waiting-actions {
  display: flex;
  gap: 0.5em;
  margin-top: 1em;
}

.waiting-actions button {
  flex: 1;
}

/* Minimal Authenticated State Styles */
.user-info-minimal {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--background-secondary);
  border-radius: 8px;
  margin-bottom: 20px;
}

.user-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--interactive-accent);
  color: var(--text-on-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 0;
}

.user-details {
  flex: 1;
}

.user-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-normal);
  margin-bottom: 2px;
}

.user-email {
  font-size: 12px;
  color: var(--text-muted);
}

.user-tier-info {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.user-tier-badge {
  padding: 4px 10px;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
}

.user-tier-offer {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-faint);
  line-height: 1.3;
  text-align: right;
}

/* Billing Usage */
.billing-usage-display {
  padding: 14px 16px;
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  margin-bottom: 20px;
}

.billing-usage-display.quota-exhausted {
  border-color: var(--text-error);
}

.billing-usage-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.billing-usage-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
}

.billing-usage-plan {
  font-size: 12px;
  color: var(--text-faint);
  margin-top: 2px;
}

.billing-refresh-button {
  padding: 4px 10px;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.billing-refresh-button:hover:not(:disabled) {
  color: var(--text-normal);
  border-color: var(--text-muted);
}

.billing-refresh-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.billing-usage-main {
  display: flex;
  align-items: baseline;
  gap: 3px;
  margin-bottom: 8px;
  color: var(--text-normal);
}

.billing-usage-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--interactive-accent);
}

.billing-usage-separator,
.billing-usage-limit {
  font-size: 14px;
  color: var(--text-normal);
}

.billing-usage-muted,
.billing-usage-reset,
.billing-usage-error,
.billing-usage-warning {
  font-size: 12px;
  line-height: 1.4;
}

.billing-usage-muted,
.billing-usage-reset {
  color: var(--text-muted);
}

.beta-free-sunset {
  margin-bottom: 8px;
  color: var(--text-warning);
}

.billing-usage-error,
.billing-usage-warning {
  color: var(--text-error);
}

.billing-progress-track {
  width: 100%;
  height: 5px;
  overflow: hidden;
  background: var(--background-primary);
  border-radius: 999px;
  margin-bottom: 8px;
}

.billing-progress-bar {
  height: 100%;
  background: var(--interactive-accent);
  border-radius: inherit;
  transition: width 0.2s ease;
}

.quota-exhausted .billing-progress-bar {
  background: var(--text-error);
}

/* Platform Stats - Minimal Grid */
.platform-minimal-header {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.platform-minimal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
  margin-bottom: 24px;
}

.platform-minimal-item {
  padding: 10px;
  background: var(--background-secondary);
  border-radius: 6px;
  text-align: center;
}

.platform-minimal-name {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.platform-minimal-count {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-normal);
}

/* Sign Out Section */
.sign-out-section {
  padding-top: 16px;
  border-top: 1px solid var(--background-modifier-border);
}

.sign-out-button {
  width: 100%;
  padding: 10px;
  background: transparent;
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.sign-out-button:hover {
  background: var(--background-secondary);
  color: var(--text-normal);
  border-color: var(--text-faint);
}

/* Email Change Styles */
.user-email-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.email-change-trigger {
  padding: 1px 8px;
  font-size: 10px;
  font-weight: 500;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--background-modifier-border);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
  line-height: 1.4;
  white-space: nowrap;
  flex-shrink: 0;
}

.email-change-trigger:hover {
  color: var(--text-normal);
  border-color: var(--text-muted);
  background: var(--background-secondary);
}

.email-change-form {
  padding: 12px 16px;
  background: var(--background-secondary);
  border-radius: 8px;
  margin-bottom: 16px;
  border: 1px solid var(--background-modifier-border);
}

.email-change-input-row {
  margin-bottom: 8px;
}

.email-change-input {
  width: 100%;
  padding: 6px 10px;
  font-size: 13px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 4px;
  background: var(--background-primary);
  color: var(--text-normal);
  box-sizing: border-box;
}

.email-change-input:focus {
  border-color: var(--interactive-accent);
  outline: none;
}

.email-change-input:disabled {
  opacity: 0.5;
}

.email-change-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}

.email-change-submit {
  padding: 6px 14px;
  font-size: 12px;
}

.email-change-cancel {
  padding: 6px 14px;
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--background-modifier-border);
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s ease;
}

.email-change-cancel:hover:not(:disabled) {
  background: var(--background-primary);
  color: var(--text-normal);
}

.email-change-cancel:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.email-change-hint {
  font-size: 11px;
  color: var(--text-faint);
  margin: 0;
  line-height: 1.4;
}

/* Cross-Device Auth Styles */
.xdev-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px 0 8px;
  color: var(--text-faint);
  font-size: 12px;
}

.xdev-divider::before,
.xdev-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--background-modifier-border);
}

.xdev-divider-text {
  flex-shrink: 0;
}

.xdev-start-button {
  width: 100%;
  padding: 10px;
  background: transparent;
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.xdev-start-button:hover:not(:disabled) {
  background: var(--background-secondary);
  color: var(--text-normal);
  border-color: var(--interactive-accent);
}

.xdev-start-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.xdev-section {
  padding: 12px 0 4px;
  text-align: center;
}

.xdev-qr-container {
  display: flex;
  justify-content: center;
  margin: 0 auto 12px;
  padding: 12px;
  background: #ffffff;
  border-radius: 12px;
  width: fit-content;
}

.xdev-qr-container :global(svg) {
  width: 160px;
  height: 160px;
  display: block;
}

.xdev-instruction {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0 0 10px;
}

.xdev-code-display {
  font-family: var(--font-monospace);
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 4px;
  color: var(--text-normal);
  background: var(--background-secondary);
  padding: 12px 20px;
  border-radius: 8px;
  border: 2px solid var(--interactive-accent);
  display: inline-block;
  margin: 0 auto 10px;
  user-select: all;
}

.xdev-timer {
  font-size: 12px;
  color: var(--text-faint);
  margin: 0 0 12px;
}

.xdev-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
}

.xdev-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-top: 8px;
}

.xdev-actions button {
  padding: 6px 16px;
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--background-modifier-border);
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s ease;
}

.xdev-actions button:hover {
  background: var(--background-secondary);
  color: var(--text-normal);
}

.xdev-error p {
  color: var(--text-error);
  font-size: 13px;
  margin: 0 0 8px;
}

.xdev-success p {
  color: var(--color-green);
  font-size: 13px;
  margin: 0;
}
</style>
