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
 * @param plugin - The plugin instance
 */
export async function clearAuthentication(plugin: SocialArchiverPlugin): Promise<void> {
  plugin.settings.authToken = '';
  plugin.settings.username = '';
  plugin.settings.email = '';
  plugin.settings.isVerified = false;
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
