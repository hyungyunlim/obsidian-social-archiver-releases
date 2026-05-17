import { Platform } from 'obsidian';
import type { SocialArchiverSettings } from '../../types/settings';
import type { AICommentExecutorCapabilityPayload, AICommentProviderCapability, WorkersAPIClient } from '../../services/WorkersAPIClient';
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

  private async runRefresh(): Promise<void> {
    const settings = this.deps.settings();
    const clientId = settings.syncClientId;
    const apiClient = this.deps.apiClient();
    if (!apiClient || !settings.authToken || !clientId) return;

    const runtime = Platform.isMobile ? 'mobile' : 'desktop';
    const capability = await this.buildCapabilityPayload();
    await apiClient.refreshSyncClientCapability(clientId, capability, runtime);
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

async function hashPlatformVisibility(settings: SocialArchiverSettings): Promise<string> {
  const payload = JSON.stringify({
    platformVisibility: settings.aiComment.platformVisibility,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
