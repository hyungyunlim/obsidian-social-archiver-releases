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

      const data = response.json;

      if (response.status !== 200) {
        return {
          success: false,
          error: data.error || {
            code: 'VALIDATION_FAILED',
            message: 'Token validation failed'
          }
        };
      }

      return data;
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

      const data = response.json;

      if (response.status !== 200) {
        return {
          success: false,
          error: data.error || {
            code: 'FETCH_FAILED',
            message: 'Failed to fetch user credits'
          }
        };
      }

      return data;
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
