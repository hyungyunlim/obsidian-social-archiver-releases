import { Platform, requestUrl } from 'obsidian';

/**
 * Newsletter consent state returned by the server.
 *
 * Mirrors the response of `GET /api/user/marketing-consent`
 * (see PRD §API Endpoints).
 */
export type MarketingConsentStatus =
  | 'not_asked'
  | 'prompt_dismissed'
  | 'opted_in'
  | 'opted_out'
  | 'legacy_soft_opt_in'
  | 'legacy_confirmed'
  | 'legacy_expired'
  | 'suppressed';

export type MarketingConsentSource =
  | 'unknown'
  | 'signup_seed'
  | 'signup_modal'
  | 'settings_toggle'
  | 'email_confirm'
  | 'email_unsubscribe'
  | 'backfill_2026_05'
  | 'legacy_expiry'
  | 'admin_override'
  | 'resend_webhook';

/**
 * Sources the plugin is allowed to send when mutating consent.
 *
 * - `signup_modal`: first explicit Yes/No from the inline banner
 * - `settings_toggle`: later grant or revoke via the settings toggle
 */
export type ConsentMutationSource = 'signup_modal' | 'settings_toggle';

export interface MarketingConsentState {
  optIn: boolean;
  status: MarketingConsentStatus;
  source: MarketingConsentSource;
  optInAt: string | null;
  optOutAt: string | null;
  modalShouldShow: boolean;
  modalDismissals: number;
  legacyPermissionExpiresAt: string | null;
}

interface ApiError {
  code: string;
  message: string;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface NewsletterConsentResult<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

/**
 * Service for newsletter marketing-consent API calls.
 *
 * Reuses the same `requestUrl` + Bearer-token pattern established by
 * `AuthService` so we don't introduce a new HTTP layer.
 */
export class NewsletterConsentService {
  private readonly workerUrl: string;
  private readonly pluginVersion: string;

  constructor(workerUrl: string, pluginVersion?: string) {
    this.workerUrl = workerUrl;
    this.pluginVersion = pluginVersion || '0.0.0';
  }

  private getPlatformIdentifier(): string {
    if (Platform.isDesktop) {
      if (Platform.isMacOS) return 'macos';
      if (Platform.isWin) return 'windows';
      return 'linux';
    }
    return Platform.isIosApp ? 'ios' : 'android';
  }

  private buildHeaders(token: string): Record<string, string> {
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Client': 'obsidian-plugin',
      'X-Client-Version': this.pluginVersion,
      'X-Platform': this.getPlatformIdentifier(),
    };
  }

  private parseEnvelope<T>(raw: unknown): ApiEnvelope<T> {
    if (raw && typeof raw === 'object') {
      return raw as ApiEnvelope<T>;
    }
    return { success: false };
  }

  /**
   * GET /api/user/marketing-consent
   */
  async getConsent(token: string): Promise<NewsletterConsentResult<MarketingConsentState>> {
    try {
      const response = await requestUrl({
        url: `${this.workerUrl}/api/user/marketing-consent`,
        method: 'GET',
        headers: this.buildHeaders(token),
        throw: false,
      });

      const envelope = this.parseEnvelope<MarketingConsentState>(response.json);

      if (response.status !== 200 || !envelope.success || !envelope.data) {
        return {
          success: false,
          error: envelope.error ?? {
            code: 'FETCH_FAILED',
            message: 'Failed to fetch newsletter consent state',
          },
        };
      }

      return { success: true, data: envelope.data };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network error',
        },
      };
    }
  }

  /**
   * POST /api/user/marketing-consent
   */
  async updateConsent(
    token: string,
    payload: { optIn: boolean; source: ConsentMutationSource }
  ): Promise<NewsletterConsentResult<MarketingConsentState>> {
    try {
      const response = await requestUrl({
        url: `${this.workerUrl}/api/user/marketing-consent`,
        method: 'POST',
        headers: this.buildHeaders(token),
        body: JSON.stringify(payload),
        throw: false,
      });

      const envelope = this.parseEnvelope<MarketingConsentState>(response.json);

      if (response.status !== 200 || !envelope.success) {
        return {
          success: false,
          error: envelope.error ?? {
            code: 'UPDATE_FAILED',
            message: 'Failed to update newsletter consent',
          },
        };
      }

      return { success: true, data: envelope.data };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network error',
        },
      };
    }
  }

  /**
   * POST /api/user/marketing-consent/dismiss
   */
  async dismiss(token: string): Promise<NewsletterConsentResult<void>> {
    try {
      const response = await requestUrl({
        url: `${this.workerUrl}/api/user/marketing-consent/dismiss`,
        method: 'POST',
        headers: this.buildHeaders(token),
        body: '{}',
        throw: false,
      });

      if (response.status !== 200) {
        const envelope = this.parseEnvelope<unknown>(response.json);
        return {
          success: false,
          error: envelope.error ?? {
            code: 'DISMISS_FAILED',
            message: 'Failed to dismiss newsletter prompt',
          },
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network error',
        },
      };
    }
  }
}
