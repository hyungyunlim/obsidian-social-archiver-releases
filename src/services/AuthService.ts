import { Platform, requestUrl } from 'obsidian';
import type { SocialArchiverSettings } from '../types/settings';

/**
 * Response from token validation API
 */
interface ValidateTokenResponse {
  success: boolean;
  data?: {
    username: string;
    email: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Response from cross-device auth init API
 */
export interface CrossDeviceInitResponse {
  success: boolean;
  data?: {
    code: string;
    displayCode: string;
    sessionId: string;
    expiresAt: string;
    pollIntervalMs: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Response from cross-device auth status poll API
 */
export interface CrossDeviceStatusResponse {
  success: boolean;
  data?: {
    status: 'pending' | 'approved' | 'rejected' | 'expired' | 'consumed';
    authToken?: string;
    username?: string;
    expiresAt?: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Service for authentication-related API calls
 */
export class AuthService {
  private readonly workerUrl: string;
  private readonly pluginVersion: string;

  constructor(workerUrl: string, pluginVersion?: string) {
    this.workerUrl = workerUrl;
    this.pluginVersion = pluginVersion || '0.0.0';
  }

  /**
   * Get platform identifier for X-Platform header
   */
  private getPlatformIdentifier(): string {
    if (Platform.isDesktop) {
      if (Platform.isMacOS) return 'macos';
      if (Platform.isWin) return 'windows';
      return 'linux';
    }
    return Platform.isIosApp ? 'ios' : 'android';
  }

  /**
   * Validate an auth token with the backend
   */
  async validateToken(token: string): Promise<ValidateTokenResponse> {
    try {
      const response = await requestUrl({
        url: `${this.workerUrl}/api/auth/validate-token`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client': 'obsidian-plugin',
          'X-Client-Version': this.pluginVersion,
          'X-Platform': this.getPlatformIdentifier()
        },
        body: JSON.stringify({ token }),
        throw: false
      });

      const data = response.json as Record<string, unknown>;

      if (response.status !== 200) {
        const dataError = data['error'] as { code: string; message: string } | undefined;
        return {
          success: false,
          error: dataError ?? {
            code: 'VALIDATION_FAILED',
            message: 'Token validation failed'
          }
        };
      }

      return data as unknown as ValidateTokenResponse;
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network error'
        }
      };
    }
  }

  /**
   * Initialize a cross-device authentication session
   *
   * Calls POST /api/auth/cross-device/init with source='obsidian'.
   * Returns a pairing code and sessionId for polling.
   */
  async initCrossDeviceAuth(): Promise<CrossDeviceInitResponse> {
    try {
      const response = await requestUrl({
        url: `${this.workerUrl}/api/auth/cross-device/init`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client': 'obsidian-plugin',
          'X-Client-Version': this.pluginVersion,
          'X-Platform': this.getPlatformIdentifier()
        },
        body: JSON.stringify({ source: 'obsidian' }),
        throw: false
      });

      const data = response.json as Record<string, unknown>;

      if (response.status !== 200) {
        const dataError = data['error'] as { code: string; message: string } | undefined;
        return {
          success: false,
          error: dataError ?? {
            code: 'INIT_FAILED',
            message: 'Failed to initialize cross-device auth session'
          }
        };
      }

      return data as unknown as CrossDeviceInitResponse;
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network error'
        }
      };
    }
  }

  /**
   * Poll the status of a cross-device auth session
   *
   * Calls POST /api/auth/cross-device/status with the sessionId.
   * Returns the current status and, on approval, the authToken.
   */
  async pollCrossDeviceStatus(sessionId: string): Promise<CrossDeviceStatusResponse> {
    try {
      const response = await requestUrl({
        url: `${this.workerUrl}/api/auth/cross-device/status`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client': 'obsidian-plugin',
          'X-Client-Version': this.pluginVersion,
          'X-Platform': this.getPlatformIdentifier()
        },
        body: JSON.stringify({ sessionId }),
        throw: false
      });

      const data = response.json as Record<string, unknown>;

      if (response.status !== 200) {
        const dataError = data['error'] as { code: string; message: string } | undefined;
        return {
          success: false,
          error: dataError ?? {
            code: 'POLL_FAILED',
            message: 'Failed to poll cross-device auth status'
          }
        };
      }

      return data as unknown as CrossDeviceStatusResponse;
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network error'
        }
      };
    }
  }

  /**
   * Fetch user credits and usage statistics
   */
  async getUserCredits(token: string): Promise<{
    success: boolean;
    data?: SocialArchiverSettings;
    error?: { code: string; message: string };
  }> {
    try {
      const response = await requestUrl({
        url: `${this.workerUrl}/api/user/credits`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Client': 'obsidian-plugin',
          'X-Client-Version': this.pluginVersion,
          'X-Platform': this.getPlatformIdentifier()
        },
        throw: false
      });

      const data = response.json as Record<string, unknown>;

      if (response.status !== 200) {
        const dataError = data['error'] as { code: string; message: string } | undefined;
        return {
          success: false,
          error: dataError ?? {
            code: 'FETCH_FAILED',
            message: 'Failed to fetch user credits'
          }
        };
      }

      return data as unknown as { success: boolean; data?: SocialArchiverSettings; error?: { code: string; message: string } };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network error'
        }
      };
    }
  }
}
