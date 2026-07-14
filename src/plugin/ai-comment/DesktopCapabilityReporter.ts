import { Notice, Platform } from 'obsidian';
import type { SocialArchiverSettings } from '../../types/settings';
import type {
  AIActionExecutorCapabilityPayload,
  AICommentExecutorCapabilityPayload,
  AICommentProviderCapability,
  WorkersAPIClient,
} from '../../services/WorkersAPIClient';
import type { AICli, AICommentType } from '../../types/ai-comment';
import { AICliDetector } from '../../utils/ai-cli';

const SUPPORTED_TYPES: AICommentType[] = [
  'summary',
  'factcheck',
  'critique',
  'keypoints',
  'sentiment',
  'connections',
  'translation',
  'translate-transcript',
  'glossary',
  'reformat',
  'custom',
];
const PROVIDERS: AICli[] = ['claude', 'gemini', 'codex'];
const DEBOUNCE_MS = 1500;

export interface DesktopCapabilityReporterDeps {
  apiClient: () => WorkersAPIClient | undefined;
  settings: () => SocialArchiverSettings;
  pluginVersion: string;
  schedule: (callback: () => void, delay: number) => number;
  clearSchedule: (id: number) => void;
}

export class DesktopCapabilityReporter {
  private timer: number | null = null;
  private inFlight: Promise<void> | null = null;
  /** Last-notified "chosen->advertised" degradation, to notify only on change. */
  private lastDegradeKey: string | null = null;

  constructor(private readonly deps: DesktopCapabilityReporterDeps) {}

  dispose(): void {
    if (this.timer !== null) {
      this.deps.clearSchedule(this.timer);
      this.timer = null;
    }
  }

  refreshSoon(): void {
    if (this.timer !== null) {
      this.deps.clearSchedule(this.timer);
    }
    this.timer = this.deps.schedule(() => {
      this.timer = null;
      void this.refreshNow();
    }, DEBOUNCE_MS);
  }

  async refreshNow(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runRefresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  async buildCapabilityPayload(): Promise<AICommentExecutorCapabilityPayload | null> {
    const settings = this.deps.settings();
    if (Platform.isMobile) {
      return null;
    }

    const providers = await this.detectProviders();
    const readyProviders = providers.filter((provider) => provider.available && provider.authenticated);
    const defaultProvider = readyProviders.some((provider) => provider.id === settings.aiComment.defaultCli)
      ? settings.aiComment.defaultCli
      : readyProviders[0]?.id;

    let status: AICommentExecutorCapabilityPayload['status'] = 'ready';
    if (!settings.aiComment.enabled) status = 'settings_disabled';
    else if (providers.every((provider) => !provider.available)) status = 'provider_missing';
    else if (readyProviders.length === 0) status = 'provider_auth_required';

    return {
      enabled: settings.aiComment.enabled && status === 'ready',
      status,
      providers,
      ...(defaultProvider ? { defaultProvider } : {}),
      supportedTypes: SUPPORTED_TYPES,
      outputLanguage: settings.aiComment.outputLanguage,
      platformVisibilityHash: await hashPlatformVisibility(settings),
      pluginVersion: this.deps.pluginVersion,
      updatedAt: new Date().toISOString(),
    };
  }

  async buildAIActionCapabilityPayload(): Promise<AIActionExecutorCapabilityPayload | null> {
    const commentCapability = await this.buildCapabilityPayload();
    if (!commentCapability) return null;
    return {
      enabled: commentCapability.enabled,
      capabilities: ['ai-actions-v1', 'tag-patch-v1', 'content-variants-v1', 'content-translate-v1'],
      pluginVersion: this.deps.pluginVersion,
      updatedAt: commentCapability.updatedAt,
    };
  }

  private async runRefresh(): Promise<void> {
    // Mobile Obsidian can share plugin data with desktop vaults. Never let it
    // clear or replace the desktop AI executor capability for a synced clientId.
    if (Platform.isMobile) return;

    const settings = this.deps.settings();
    const clientId = settings.syncClientId;
    const apiClient = this.deps.apiClient();
    if (!apiClient || !settings.authToken || !clientId) return;

    const aiCommentExecutor = await this.buildCapabilityPayload();
    const aiActionExecutor = await this.buildAIActionCapabilityPayload();
    this.maybeNotifyProviderDegradation(settings, aiCommentExecutor);
    await apiClient.refreshSyncClientCapabilities(
      clientId,
      {
        aiCommentExecutor,
        aiActionExecutor,
      },
      'desktop',
    );
  }

  /**
   * Surface the silent capability degradation from lines 74-77: when the chosen
   * Default AI tool isn't installed/authenticated, we advertise a different
   * ready provider as the executor default. Without this, the user's setting says
   * one thing while every client (and this executor) runs another — the root of
   * "I set Codex but Claude runs". Deduped so periodic refreshes don't spam.
   */
  private maybeNotifyProviderDegradation(
    settings: SocialArchiverSettings,
    capability: AICommentExecutorCapabilityPayload | null,
  ): void {
    const chosen = settings.aiComment.defaultCli;
    const advertised = capability?.defaultProvider;
    // Only meaningful while a provider is actually advertised as the executor
    // default (some other provider IS ready). "No provider ready at all" is a
    // different state handled by the settings UI, not this notice.
    if (!settings.aiComment.enabled || !capability?.enabled || !advertised || advertised === chosen) {
      this.lastDegradeKey = null;
      return;
    }
    const key = `${chosen}->${advertised}`;
    if (key === this.lastDegradeKey) return;
    this.lastDegradeKey = key;
    new Notice(
      `Social Archiver: "${providerLabel(chosen)}" is set as your default AI tool but isn't installed/authenticated. ` +
        `AI actions will run on "${providerLabel(advertised)}" instead.`,
      8000,
    );
  }

  private async detectProviders(): Promise<AICommentProviderCapability[]> {
    const results = await Promise.all(
      PROVIDERS.map(async (provider) => {
        const detected = await AICliDetector.detect(provider);
        return {
          id: provider,
          available: detected.available,
          authenticated: detected.authenticated,
          ...(detected.version ? { version: detected.version } : {}),
          ...(!detected.available ? { errorCode: 'CLI_NOT_INSTALLED' } : {}),
          ...(detected.available && !detected.authenticated ? { errorCode: 'CLI_NOT_AUTHENTICATED' } : {}),
        };
      }),
    );
    return results;
  }
}

function providerLabel(provider: AICli): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

async function hashPlatformVisibility(settings: SocialArchiverSettings): Promise<string> {
  const payload = JSON.stringify({
    platformVisibility: settings.aiComment.platformVisibility,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
