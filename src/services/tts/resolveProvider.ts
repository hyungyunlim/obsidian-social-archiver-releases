/**
 * resolveTTSProvider
 *
 * Shared provider resolution logic used by both ReaderModeOverlay and
 * EditorTTSController. Extracted to avoid duplication.
 *
 * Fallback policy (FR-08):
 *  1. provider=supertonic, installed & running -> Supertonic
 *  2. provider=supertonic, failed + Azure credentials valid -> Azure fallback
 *  3. provider=supertonic, failed + Azure unconfigured -> null (TTS disabled)
 *  4. provider=azure -> Azure (requires auth)
 *  5. Smart default: prefer Azure if authenticated, else Supertonic if installed
 *
 * Language fallback:
 *  When the primary provider is Supertonic (en/ko/es/pt/fr only), a fallback
 *  Azure provider is returned so TTSService can switch providers for languages
 *  like ja-JP or zh-CN that Supertonic doesn't support.
 */

import type { PluginTTSProvider } from './types';
import type { SocialArchiverSettings } from '../../types/settings';
import { AzureSpeechProvider } from './providers/AzureSpeechProvider';
import { SupertonicProvider } from './providers/SupertonicProvider';

const DEFAULT_API_ENDPOINT = 'https://social-archiver-api.social-archive.org';

export interface ResolvedTTSProviders {
  primary: PluginTTSProvider;
  /** Fallback for languages unsupported by the primary provider. */
  fallback: PluginTTSProvider | null;
}

/**
 * Resolve the TTS provider based on current plugin settings.
 * @param settings Plugin settings
 * @param pluginVersion Plugin manifest version for analytics tracking
 * @returns Primary and optional fallback provider, or null if none available.
 */
export function resolveTTSProvider(settings: SocialArchiverSettings, pluginVersion?: string): ResolvedTTSProviders | null {
  const ttsSettings = settings.tts;
  if (!ttsSettings) return null;

  const authToken = settings.authToken;
  const apiEndpoint = settings.workerUrl || DEFAULT_API_ENDPOINT;

  if (ttsSettings.provider === 'azure') {
    if (!authToken) {
      console.warn('[resolveTTSProvider] Cloud TTS requires login');
      return null;
    }
    return { primary: new AzureSpeechProvider(apiEndpoint, authToken, pluginVersion), fallback: null };
  }

  if (ttsSettings.provider === 'supertonic') {
    const supertonic = new SupertonicProvider();

    if (ttsSettings.supertonicQuality) {
      supertonic.setQuality(ttsSettings.supertonicQuality);
    }

    if (supertonic.isInstalled()) {
      // Supertonic supports limited languages; provide Azure fallback if authenticated
      const fallback = authToken ? new AzureSpeechProvider(apiEndpoint, authToken, pluginVersion) : null;
      return { primary: supertonic, fallback };
    }

    // FR-08 §2: Fallback to Azure if credentials available
    if (authToken) {
      console.debug('[resolveTTSProvider] Supertonic not installed, falling back to Azure cloud');
      return { primary: new AzureSpeechProvider(apiEndpoint, authToken, pluginVersion), fallback: null };
    }

    // FR-08 §3: TTS disabled
    console.warn('[resolveTTSProvider] Supertonic not installed and not logged in. TTS disabled.');
    return null;
  }

  // Smart default: prefer Azure if authenticated, else try Supertonic
  if (authToken) {
    return { primary: new AzureSpeechProvider(apiEndpoint, authToken, pluginVersion), fallback: null };
  }

  const supertonic = new SupertonicProvider();
  if (supertonic.isInstalled()) return { primary: supertonic, fallback: null };

  return null;
}
