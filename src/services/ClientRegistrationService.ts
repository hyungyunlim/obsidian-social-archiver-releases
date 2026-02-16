/**
 * ClientRegistrationService - Manages sync client registration with the server
 *
 * Single Responsibility: Sync client registration and lifecycle management
 *
 * Features:
 * - Register Obsidian plugin as a sync client
 * - Store and retrieve clientId from settings
 * - Unregister when plugin is unloaded or user requests
 * - Auto-register on plugin load if authToken exists
 */

import type { App } from 'obsidian';
import type { IService } from './base/IService';
import type { SocialArchiverSettings } from '@/types/settings';
import type { WorkersAPIClient, RegisterSyncClientRequest } from './WorkersAPIClient';

/**
 * Result of client registration attempt
 */
export interface ClientRegistrationResult {
  success: boolean;
  clientId?: string;
  error?: string;
}

/**
 * ClientRegistrationService - Registers and manages Obsidian as a sync client
 */
export class ClientRegistrationService implements IService {
  private app: App;
  private apiClient: WorkersAPIClient;
  private settings: SocialArchiverSettings;
  private saveSettings: () => Promise<void>;
  private initialized = false;

  constructor(
    app: App,
    apiClient: WorkersAPIClient,
    settings: SocialArchiverSettings,
    saveSettings: () => Promise<void>
  ) {
    this.app = app;
    this.apiClient = apiClient;
    this.settings = settings;
    this.saveSettings = saveSettings;
  }

  /**
   * Initialize the service
   * Auto-registers if authenticated and not already registered
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Auto-register if authenticated but not registered
    if (this.settings.authToken && !this.settings.syncClientId) {
      try {
        console.log('[ClientRegistration] Auto-registering sync client...');
        await this.register();
      } catch (error) {
        // Non-fatal - continue without registration
        console.warn('[ClientRegistration] Auto-registration failed:', error);
      }
    }

    this.initialized = true;
  }

  /**
   * Dispose the service
   * Note: We don't unregister on dispose - the client stays registered
   */
  async dispose(): Promise<void> {
    this.initialized = false;
  }

  /**
   * Check if service is healthy
   */
  async isHealthy(): Promise<boolean> {
    return this.initialized && !!this.settings.syncClientId;
  }

  /**
   * Register this Obsidian plugin as a sync client
   *
   * @returns Registration result with clientId or error
   */
  async register(): Promise<ClientRegistrationResult> {
    // Check if already registered
    if (this.settings.syncClientId) {
      console.log('[ClientRegistration] Already registered:', this.settings.syncClientId);
      return { success: true, clientId: this.settings.syncClientId };
    }

    // Check if authenticated
    if (!this.settings.authToken) {
      return { success: false, error: 'Not authenticated. Please sign in first.' };
    }

    try {
      const request: RegisterSyncClientRequest = {
        clientType: 'obsidian',
        clientName: this.getClientName(),
        settings: {
          deviceId: this.settings.deviceId,
          vaultName: this.app.vault.getName(),
        },
      };

      const response = await this.apiClient.registerSyncClient(request);

      if (response.clientId) {
        // Store clientId in settings
        this.settings.syncClientId = response.clientId;
        await this.saveSettings();

        console.log('[ClientRegistration] Successfully registered:', response.clientId);

        return { success: true, clientId: response.clientId };
      }

      return { success: false, error: 'Registration response missing clientId' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[ClientRegistration] Registration failed:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Unregister this sync client from the server
   */
  async unregister(): Promise<void> {
    const clientId = this.settings.syncClientId;

    if (!clientId) {
      console.log('[ClientRegistration] No client ID to unregister');
      return;
    }

    try {
      await this.apiClient.deleteSyncClient(clientId);
      console.log('[ClientRegistration] Successfully unregistered:', clientId);
    } catch (error) {
      console.error('[ClientRegistration] Unregister failed:', error);
      // Continue even if server deletion fails
    }

    // Clear local clientId regardless of server response
    this.settings.syncClientId = '';
    await this.saveSettings();
  }

  /**
   * Check if client is registered
   */
  isRegistered(): boolean {
    return !!this.settings.syncClientId;
  }

  /**
   * Get the current client ID
   */
  getClientId(): string | null {
    return this.settings.syncClientId || null;
  }

  /**
   * Re-register with the server (useful after authentication changes)
   */
  async reregister(): Promise<ClientRegistrationResult> {
    // Clear existing registration first
    if (this.settings.syncClientId) {
      await this.unregister();
    }

    return this.register();
  }

  /**
   * Generate a descriptive client name
   * Format: "{Vault Name} (Obsidian Plugin)"
   */
  private getClientName(): string {
    const vaultName = this.app.vault.getName() || 'Obsidian';
    return `${vaultName} (Obsidian Plugin)`;
  }
}
