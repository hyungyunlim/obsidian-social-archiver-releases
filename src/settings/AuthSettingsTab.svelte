<script lang="ts">
import { Notice } from 'obsidian';
import type SocialArchiverPlugin from '../main';
import type { SocialArchiverSettings, UserTier, PlatformTiming } from '../types/settings';

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

// Local reactive state
let isAuthenticated = $state(plugin.settings.isVerified && plugin.settings.authToken !== '');
let settings = $state(plugin.settings);

// Computed states
let tierDisplay = $derived(getTierDisplay(settings.tier));
let creditLimit = $derived(getCreditLimit(settings.tier));
let normalizedCreditsUsed = $derived(getSafeNumber(settings.creditsUsed));
let hasUnlimitedCredits = $derived(!Number.isFinite(creditLimit));
let creditsRemaining = $derived(
  hasUnlimitedCredits ? Infinity : Math.max(0, creditLimit - normalizedCreditsUsed)
);

/**
 * Convert unknown value to safe number for display/calculation
 */
function getSafeNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Get display name for user tier
 */
function getTierDisplay(tier: UserTier): string {
  const tierNames: Record<UserTier, string> = {
    'beta-free': 'Beta (Unlimited)',
    'free': 'Free (Beta Unlimited)',
    'pro': 'Pro',
    'admin': 'Admin (Unlimited)',
  };
  return tierNames[tier] || 'Beta (Unlimited)';
}

/**
 * Get credit limit for user tier
 */
function getCreditLimit(tier: UserTier): number {
  const limits: Record<UserTier, number> = {
    'beta-free': Infinity,
    'free': Infinity, // Beta phase: currently unlimited
    'pro': 500,
    'admin': Infinity,
  };
  return limits[tier] ?? Infinity;
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
  authMode = 'signup';
  email = '';
  username = '';
}

/**
 * Handle sign out
 */
async function handleSignOut() {
  plugin.settings.authToken = '';
  plugin.settings.username = '';
  plugin.settings.email = '';
  plugin.settings.isVerified = false;
  await plugin.saveSettings();

  // Update local state immediately
  isAuthenticated = false;
  settings = plugin.settings;

  // Refresh all open timeline views to update auth state
  await plugin.refreshAllTimelines();

  new Notice('👋 Signed out successfully');
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
      </div>
    {/if}
  {:else}
    <!-- Authenticated State -->
    <div class="auth-section">
      <!-- User Info - Simple and Clean -->
      <div class="user-info-minimal">
        <div class="user-avatar">
          {settings.username.substring(0, 2).toUpperCase()}
        </div>
        <div class="user-details">
          <div class="user-name">@{settings.username}</div>
          <div class="user-email">{settings.email}</div>
        </div>
        <div class="user-tier-badge">
          {tierDisplay}
        </div>
      </div>

      <!-- Credits Display - Minimal -->
      <div class="credits-display">
        <div class="credits-label">Credits</div>
        <div class="credits-info">
          {#if hasUnlimitedCredits}
            <span class="credits-unlimited">Unlimited</span>
            {#if settings.tier === 'beta-free'}
              <span class="credits-beta">Beta Period</span>
            {:else if settings.tier === 'admin'}
              <span class="credits-beta">Admin</span>
            {/if}
          {:else}
            <span class="credits-used">{normalizedCreditsUsed}</span>
            <span class="credits-separator">/</span>
            <span class="credits-limit">{creditLimit}</span>
            <span class="credits-remaining">({creditsRemaining} left)</span>
          {/if}
        </div>
      </div>

      <!-- Platform Stats - Compact Grid -->
      {#if Object.keys(settings.byPlatform).length > 0}
        <div class="platform-minimal-header">Platform Activity</div>
        <div class="platform-minimal-grid">
          {#each Object.entries(settings.byPlatform) as [platform, count]}
            <div class="platform-minimal-item">
              <div class="platform-minimal-name">{getPlatformDisplayName(platform)}</div>
              <div class="platform-minimal-count">{count}</div>
            </div>
          {/each}
        </div>
      {/if}

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

.user-tier-badge {
  padding: 4px 10px;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
}

/* Credits Display */
.credits-display {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--background-secondary);
  border-radius: 8px;
  margin-bottom: 20px;
}

.credits-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
}

.credits-info {
  font-size: 14px;
  color: var(--text-normal);
}

.credits-used {
  font-weight: 600;
  color: var(--interactive-accent);
}

.credits-separator {
  margin: 0 2px;
  color: var(--text-faint);
}

.credits-limit {
  font-weight: 500;
}

.credits-remaining {
  font-size: 12px;
  color: var(--text-muted);
  margin-left: 6px;
}

.credits-unlimited {
  font-weight: 600;
  color: var(--interactive-accent);
}

.credits-beta {
  font-size: 12px;
  color: var(--text-muted);
  margin-left: 8px;
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
</style>
