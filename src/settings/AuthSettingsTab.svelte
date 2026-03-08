<script lang="ts">
import { Notice } from 'obsidian';
import QRCode from 'qrcode';
import type SocialArchiverPlugin from '../main';
import type { SocialArchiverSettings, UserTier, PlatformTiming } from '../types/settings';
import { AuthService } from '../services/AuthService';
import { completeAuthentication, showAuthSuccess, showAuthError } from '../utils/auth';

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
let _crossDeviceCountdownTimer: ReturnType<typeof setInterval> | null = null;
let _crossDevicePollTimer: ReturnType<typeof setInterval> | null = null;
let _crossDeviceActive = false;

function stopCrossDeviceTimers(): void {
  _crossDeviceActive = false;
  if (_crossDeviceCountdownTimer !== null) {
    clearInterval(_crossDeviceCountdownTimer);
    _crossDeviceCountdownTimer = null;
  }
  if (_crossDevicePollTimer !== null) {
    clearInterval(_crossDevicePollTimer);
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
  _crossDeviceCountdownTimer = setInterval(updateCountdown, 1000);

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
          crossDeviceError = '인증 토큰을 받지 못했습니다.';
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
          crossDeviceError = completion.error || '인증 완료에 실패했습니다.';
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

  _crossDevicePollTimer = setInterval(poll, pollMs);
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
    crossDeviceError = result.error?.message || '세션을 시작할 수 없습니다.';
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
          <span class="xdev-divider-text">또는</span>
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
                모바일 앱으로 로그인
              </button>
            </div>
          </div>
        {:else if crossDeviceState === 'loading'}
          <div class="xdev-section">
            <p class="xdev-hint">세션을 시작하는 중...</p>
          </div>
        {:else if crossDeviceState === 'code-shown'}
          <div class="xdev-section">
            {#if crossDeviceQrSvg}
              <div class="xdev-qr-container">
                {@html crossDeviceQrSvg}
              </div>
              <p class="xdev-instruction">모바일 앱에서 QR을 스캔하거나 코드를 입력하세요</p>
            {:else}
              <p class="xdev-instruction">모바일 앱에서 이 코드를 입력하세요</p>
            {/if}
            <div class="xdev-code-display">{crossDeviceDisplayCode}</div>
            <p class="xdev-timer">
              {#if crossDeviceSecondsLeft > 0}
                {Math.floor(crossDeviceSecondsLeft / 60)}:{String(crossDeviceSecondsLeft % 60).padStart(2, '0')} 후 만료
              {:else}
                만료됨
              {/if}
            </p>
            <div class="xdev-actions">
              <button onclick={handleCancelCrossDevice}>취소</button>
            </div>
          </div>
        {:else if crossDeviceState === 'approved'}
          <div class="xdev-section xdev-success">
            <p>모바일 앱으로 로그인 완료!</p>
          </div>
        {:else if crossDeviceState === 'rejected'}
          <div class="xdev-section xdev-error">
            <p>모바일에서 거부됨</p>
            <div class="xdev-actions">
              <button onclick={handleStartCrossDeviceAuth}>다시 시도</button>
              <button onclick={handleCancelCrossDevice}>취소</button>
            </div>
          </div>
        {:else if crossDeviceState === 'expired'}
          <div class="xdev-section xdev-error">
            <p>코드가 만료되었습니다</p>
            <div class="xdev-actions">
              <button onclick={handleStartCrossDeviceAuth}>새 코드 생성</button>
              <button onclick={handleCancelCrossDevice}>취소</button>
            </div>
          </div>
        {:else if crossDeviceState === 'error'}
          <div class="xdev-section xdev-error">
            <p>{crossDeviceError || '오류가 발생했습니다.'}</p>
            <div class="xdev-actions">
              <button onclick={handleStartCrossDeviceAuth}>다시 시도</button>
              <button onclick={handleCancelCrossDevice}>취소</button>
            </div>
          </div>
        {/if}
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
