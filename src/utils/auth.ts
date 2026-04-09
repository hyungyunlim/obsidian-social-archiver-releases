import { Notice } from 'obsidian';
import type SocialArchiverPlugin from '../main';
import { AuthService } from '../services/AuthService';

/**
 * Result of authentication completion
 */
interface AuthCompletionResult {
  success: boolean;
  username?: string;
  email?: string;
  error?: string;
}

/**
 * Complete authentication after magic link click
 *
 * @param plugin - The plugin instance
 * @param token - The JWT token from magic link
 * @returns Promise with completion result
 */
export async function completeAuthentication(
  plugin: SocialArchiverPlugin,
  token: string
): Promise<AuthCompletionResult> {
  const authService = new AuthService(plugin.settings.workerUrl, plugin.manifest.version);

  // Validate token with backend
  const validation = await authService.validateToken(token);

  if (!validation.success || !validation.data) {
    return {
      success: false,
      error: validation.error?.message || 'Token validation failed'
    };
  }

  const { username, email } = validation.data;

  // Update plugin settings with auth data
  plugin.settings.authToken = token;
  plugin.settings.username = username;
  plugin.settings.email = email;
  plugin.settings.isVerified = true;

  // Fetch initial credits/usage data
  const creditsResult = await authService.getUserCredits(token);
  if (creditsResult.success && creditsResult.data) {
    plugin.settings.tier = creditsResult.data.tier;
    plugin.settings.creditsUsed = creditsResult.data.creditsUsed;
    plugin.settings.byPlatform = creditsResult.data.byPlatform;
    plugin.settings.byCountry = creditsResult.data.byCountry;
    plugin.settings.timingByPlatform = creditsResult.data.timingByPlatform;
  }

  // Save settings
  await plugin.saveSettings();

  return {
    success: true,
    username,
    email
  };
}

/**
 * Clear authentication data (logout)
 *
 * @deprecated Use `plugin.signOut()` instead. `signOut()` additionally
 * unregisters the sync client from the server, disconnects the WebSocket,
 * clears `syncClientId`, resets Reddit state, and clears runtime sync
 * tracking sets — ensuring a full, consistent sign-out.
 *
 * `clearAuthentication` is kept for call-sites (e.g. handleDeleteAccount)
 * where the server-side auth cleanup has already been handled separately and
 * only local settings need to be wiped.
 *
 * @param plugin - The plugin instance
 */
export async function clearAuthentication(plugin: SocialArchiverPlugin): Promise<void> {
  plugin.settings.authToken = '';
  plugin.settings.username = '';
  plugin.settings.email = '';
  plugin.settings.isVerified = false;
  plugin.settings.syncClientId = '';
  plugin.settings.tier = 'free';
  plugin.settings.creditsUsed = 0;
  plugin.settings.byPlatform = {};
  plugin.settings.byCountry = {};
  plugin.settings.timingByPlatform = {};

  await plugin.saveSettings();
}

/**
 * Check if user is currently authenticated
 *
 * @param plugin - The plugin instance
 * @returns True if authenticated
 */
export function isAuthenticated(plugin: SocialArchiverPlugin): boolean {
  return plugin.settings.isVerified && plugin.settings.authToken !== '';
}

/**
 * Refresh user credits and usage statistics from backend
 *
 * @param plugin - The plugin instance
 * @returns Promise with success status
 */
export async function refreshUserCredits(plugin: SocialArchiverPlugin): Promise<boolean> {
  if (!isAuthenticated(plugin)) {
    return false;
  }

  const authService = new AuthService(plugin.settings.workerUrl, plugin.manifest.version);
  const creditsResult = await authService.getUserCredits(plugin.settings.authToken);

  if (!creditsResult.success || !creditsResult.data) {
    return false;
  }

  // Update settings with latest data (no reinitialize needed - just saving credits data)
  await plugin.saveSettingsPartial({
    tier: creditsResult.data.tier,
    creditsUsed: creditsResult.data.creditsUsed,
    byPlatform: creditsResult.data.byPlatform,
    byCountry: creditsResult.data.byCountry,
    timingByPlatform: creditsResult.data.timingByPlatform,
  });

  return true;
}

/**
 * Result of an email change request
 */
interface EmailChangeRequestResult {
  success: boolean;
  newEmailMasked?: string;
  expiresIn?: number;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Request an email change for the authenticated user.
 *
 * Calls POST /api/user/change-email/request with the new email.
 * On success the server sends a verification link to the new address.
 *
 * @param plugin - The plugin instance (provides authToken and workerUrl)
 * @param newEmail - The desired new email address
 * @returns Promise with masked email and expiry, or error details
 */
export async function requestEmailChange(
  plugin: SocialArchiverPlugin,
  newEmail: string
): Promise<EmailChangeRequestResult> {
  if (!isAuthenticated(plugin)) {
    return { success: false, errorCode: 'UNAUTHORIZED', errorMessage: 'Not authenticated' };
  }

  try {
    const response = await fetch(`${plugin.settings.workerUrl}/api/user/change-email/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${plugin.settings.authToken}`,
        'X-Client': 'obsidian-plugin',
        'X-Client-Version': plugin.manifest.version,
      },
      body: JSON.stringify({ newEmail }),
    });

    const data = await response.json() as {
      success: boolean;
      data?: { newEmailMasked: string; expiresIn: number };
      error?: { code: string; message: string };
    };

    if (!data.success || !data.data) {
      return {
        success: false,
        errorCode: data.error?.code || 'REQUEST_FAILED',
        errorMessage: data.error?.message || 'Failed to request email change',
      };
    }

    return {
      success: true,
      newEmailMasked: data.data.newEmailMasked,
      expiresIn: data.data.expiresIn,
    };
  } catch (error) {
    return {
      success: false,
      errorCode: 'NETWORK_ERROR',
      errorMessage: error instanceof Error ? error.message : 'Network error',
    };
  }
}

/**
 * Refresh the user's canonical email from the server.
 *
 * Calls validate-token which now returns the canonical email from KV
 * (not the stale JWT claim). If the server email differs from the
 * locally stored email, settings are updated and persisted.
 *
 * @param plugin - The plugin instance
 * @returns The latest canonical email, or null if refresh failed
 */
export async function refreshUserEmail(plugin: SocialArchiverPlugin): Promise<string | null> {
  if (!isAuthenticated(plugin)) {
    return null;
  }

  const authService = new AuthService(plugin.settings.workerUrl, plugin.manifest.version);
  const validation = await authService.validateToken(plugin.settings.authToken);

  if (!validation.success || !validation.data) {
    return null;
  }

  const serverEmail = validation.data.email;

  // Update local email if it changed (e.g. after email change completed in browser)
  if (serverEmail && serverEmail !== plugin.settings.email) {
    await plugin.saveSettingsPartial({ email: serverEmail });
  }

  return serverEmail;
}

/**
 * Display authentication error to user
 *
 * @param error - Error message
 */
export function showAuthError(error: string): void {
  new Notice(`❌ Authentication failed: ${error}`, 5000);
}

/**
 * Display authentication success to user
 *
 * @param username - Username of authenticated user
 */
export function showAuthSuccess(username: string): void {
  new Notice(`✅ Welcome, @${username}! Authentication successful.`, 5000);
}
