/**
 * AzureSpeechProvider
 *
 * Cloud TTS provider that proxies through the Social Archiver backend.
 * The backend holds Azure credentials — the plugin never touches API keys.
 *
 * Flow (same as mobile app):
 *  1. POST /api/tts/synthesize { text, voice, rate, lang, format, responseMode }
 *  2. Backend calls Azure Speech API with server-side credentials
 *  3. Returns audio data (stream mode) or signed URL (url mode)
 *  4. Plugin decodes and plays via TTSAudioPlayer
 *
 * Requires user authentication (authToken from magic link login).
 */

import { requestUrl } from 'obsidian';
import type { PluginTTSProvider, TTSSynthesizeOptions, TTSVoice } from '../types';

// ============================================================================
// Constants
// ============================================================================

const REQUEST_TIMEOUT_MS = 30_000;
const AUDIO_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

/** Default voice catalogue — matches worker's HD voice mappings. */
const DEFAULT_VOICES: TTSVoice[] = [
  // Korean (HD + standard)
  { id: 'ko-KR-SunHi:DragonHDLatestNeural', name: 'SunHi HD', lang: 'ko-KR', gender: 'female', tier: 'hd', provider: 'azure' },
  { id: 'ko-KR-Hyunsu:DragonHDLatestNeural', name: 'Hyunsu HD', lang: 'ko-KR', gender: 'male', tier: 'hd', provider: 'azure' },
  { id: 'ko-KR-SunHiNeural', name: 'SunHi', lang: 'ko-KR', gender: 'female', tier: 'standard', provider: 'azure' },
  { id: 'ko-KR-InJoonNeural', name: 'InJoon', lang: 'ko-KR', gender: 'male', tier: 'standard', provider: 'azure' },
  // English US (HD + standard)
  { id: 'en-US-Ava:DragonHDLatestNeural', name: 'Ava HD', lang: 'en-US', gender: 'female', tier: 'hd', provider: 'azure' },
  { id: 'en-US-Andrew:DragonHDLatestNeural', name: 'Andrew HD', lang: 'en-US', gender: 'male', tier: 'hd', provider: 'azure' },
  { id: 'en-US-AriaNeural', name: 'Aria', lang: 'en-US', gender: 'female', tier: 'standard', provider: 'azure' },
  { id: 'en-US-GuyNeural', name: 'Guy', lang: 'en-US', gender: 'male', tier: 'standard', provider: 'azure' },
  // Japanese (HD + standard)
  { id: 'ja-JP-Nanami:DragonHDLatestNeural', name: 'Nanami HD', lang: 'ja-JP', gender: 'female', tier: 'hd', provider: 'azure' },
  { id: 'ja-JP-Masaru:DragonHDLatestNeural', name: 'Masaru HD', lang: 'ja-JP', gender: 'male', tier: 'hd', provider: 'azure' },
  { id: 'ja-JP-NanamiNeural', name: 'Nanami', lang: 'ja-JP', gender: 'female', tier: 'standard', provider: 'azure' },
  { id: 'ja-JP-KeitaNeural', name: 'Keita', lang: 'ja-JP', gender: 'male', tier: 'standard', provider: 'azure' },
  // Chinese Simplified (HD + standard)
  { id: 'zh-CN-Xiaochen:DragonHDLatestNeural', name: 'Xiaochen HD', lang: 'zh-CN', gender: 'female', tier: 'hd', provider: 'azure' },
  { id: 'zh-CN-Yunfan:DragonHDLatestNeural', name: 'Yunfan HD', lang: 'zh-CN', gender: 'male', tier: 'hd', provider: 'azure' },
  { id: 'zh-CN-XiaoxiaoNeural', name: 'Xiaoxiao', lang: 'zh-CN', gender: 'female', tier: 'standard', provider: 'azure' },
  { id: 'zh-CN-YunjianNeural', name: 'Yunjian', lang: 'zh-CN', gender: 'male', tier: 'standard', provider: 'azure' },
  // Chinese Traditional
  { id: 'zh-TW-HsiaoChenNeural', name: 'HsiaoChen', lang: 'zh-TW', gender: 'female', tier: 'standard', provider: 'azure' },
  { id: 'zh-TW-YunJheNeural', name: 'YunJhe', lang: 'zh-TW', gender: 'male', tier: 'standard', provider: 'azure' },
  // German (HD + standard)
  { id: 'de-DE-Amala:DragonHDLatestNeural', name: 'Amala HD', lang: 'de-DE', gender: 'female', tier: 'hd', provider: 'azure' },
  { id: 'de-DE-Florian:DragonHDLatestNeural', name: 'Florian HD', lang: 'de-DE', gender: 'male', tier: 'hd', provider: 'azure' },
  { id: 'de-DE-KatjaNeural', name: 'Katja', lang: 'de-DE', gender: 'female', tier: 'standard', provider: 'azure' },
  { id: 'de-DE-ConradNeural', name: 'Conrad', lang: 'de-DE', gender: 'male', tier: 'standard', provider: 'azure' },
  // French (HD + standard)
  { id: 'fr-FR-Denise:DragonHDLatestNeural', name: 'Denise HD', lang: 'fr-FR', gender: 'female', tier: 'hd', provider: 'azure' },
  { id: 'fr-FR-Remy:DragonHDLatestNeural', name: 'Rémy HD', lang: 'fr-FR', gender: 'male', tier: 'hd', provider: 'azure' },
  { id: 'fr-FR-DeniseNeural', name: 'Denise', lang: 'fr-FR', gender: 'female', tier: 'standard', provider: 'azure' },
  { id: 'fr-FR-HenriNeural', name: 'Henri', lang: 'fr-FR', gender: 'male', tier: 'standard', provider: 'azure' },
  // Spanish (HD + standard)
  { id: 'es-ES-Triana:DragonHDLatestNeural', name: 'Triana HD', lang: 'es-ES', gender: 'female', tier: 'hd', provider: 'azure' },
  { id: 'es-ES-Ximena:DragonHDLatestNeural', name: 'Ximena HD', lang: 'es-ES', gender: 'female', tier: 'hd', provider: 'azure' },
  { id: 'es-ES-ElviraNeural', name: 'Elvira', lang: 'es-ES', gender: 'female', tier: 'standard', provider: 'azure' },
  { id: 'es-ES-AlvaroNeural', name: 'Álvaro', lang: 'es-ES', gender: 'male', tier: 'standard', provider: 'azure' },
  // Spanish Mexico
  { id: 'es-MX-DaliaNeural', name: 'Dalia', lang: 'es-MX', gender: 'female', tier: 'standard', provider: 'azure' },
  { id: 'es-MX-JorgeNeural', name: 'Jorge', lang: 'es-MX', gender: 'male', tier: 'standard', provider: 'azure' },
  // Portuguese Brazil (HD + standard)
  { id: 'pt-BR-Thalita:DragonHDLatestNeural', name: 'Thalita HD', lang: 'pt-BR', gender: 'female', tier: 'hd', provider: 'azure' },
  { id: 'pt-BR-Antonio:DragonHDLatestNeural', name: 'Antonio HD', lang: 'pt-BR', gender: 'male', tier: 'hd', provider: 'azure' },
  { id: 'pt-BR-FranciscaNeural', name: 'Francisca', lang: 'pt-BR', gender: 'female', tier: 'standard', provider: 'azure' },
  { id: 'pt-BR-AntonioNeural', name: 'Antonio', lang: 'pt-BR', gender: 'male', tier: 'standard', provider: 'azure' },
  // Italian
  { id: 'it-IT-ElsaNeural', name: 'Elsa', lang: 'it-IT', gender: 'female', tier: 'standard', provider: 'azure' },
  { id: 'it-IT-DiegoNeural', name: 'Diego', lang: 'it-IT', gender: 'male', tier: 'standard', provider: 'azure' },
  // Russian
  { id: 'ru-RU-SvetlanaNeural', name: 'Svetlana', lang: 'ru-RU', gender: 'female', tier: 'standard', provider: 'azure' },
  { id: 'ru-RU-DmitryNeural', name: 'Dmitry', lang: 'ru-RU', gender: 'male', tier: 'standard', provider: 'azure' },
  // Hindi
  { id: 'hi-IN-SwaraNeural', name: 'Swara', lang: 'hi-IN', gender: 'female', tier: 'standard', provider: 'azure' },
  { id: 'hi-IN-MadhurNeural', name: 'Madhur', lang: 'hi-IN', gender: 'male', tier: 'standard', provider: 'azure' },
  // Arabic
  { id: 'ar-SA-ZariyahNeural', name: 'Zariyah', lang: 'ar-SA', gender: 'female', tier: 'standard', provider: 'azure' },
  { id: 'ar-SA-HamedNeural', name: 'Hamed', lang: 'ar-SA', gender: 'male', tier: 'standard', provider: 'azure' },
  // Vietnamese
  { id: 'vi-VN-HoaiMyNeural', name: 'HoaiMy', lang: 'vi-VN', gender: 'female', tier: 'standard', provider: 'azure' },
  { id: 'vi-VN-NamMinhNeural', name: 'NamMinh', lang: 'vi-VN', gender: 'male', tier: 'standard', provider: 'azure' },
  // Thai
  { id: 'th-TH-PremwadeeNeural', name: 'Premwadee', lang: 'th-TH', gender: 'female', tier: 'standard', provider: 'azure' },
  { id: 'th-TH-NiwatNeural', name: 'Niwat', lang: 'th-TH', gender: 'male', tier: 'standard', provider: 'azure' },
  // Indonesian
  { id: 'id-ID-GadisNeural', name: 'Gadis', lang: 'id-ID', gender: 'female', tier: 'standard', provider: 'azure' },
  { id: 'id-ID-ArdiNeural', name: 'Ardi', lang: 'id-ID', gender: 'male', tier: 'standard', provider: 'azure' },
  // Turkish
  { id: 'tr-TR-EmelNeural', name: 'Emel', lang: 'tr-TR', gender: 'female', tier: 'standard', provider: 'azure' },
  { id: 'tr-TR-AhmetNeural', name: 'Ahmet', lang: 'tr-TR', gender: 'male', tier: 'standard', provider: 'azure' },
];

/** Default voice per language (HD preferred when available). */
const DEFAULT_VOICE_BY_LANG: Record<string, string> = {
  'ko-KR': 'ko-KR-SunHi:DragonHDLatestNeural',
  'en-US': 'en-US-Ava:DragonHDLatestNeural',
  'ja-JP': 'ja-JP-Nanami:DragonHDLatestNeural',
  'zh-CN': 'zh-CN-Xiaochen:DragonHDLatestNeural',
  'zh-TW': 'zh-TW-HsiaoChenNeural',
  'de-DE': 'de-DE-Amala:DragonHDLatestNeural',
  'fr-FR': 'fr-FR-Denise:DragonHDLatestNeural',
  'es-ES': 'es-ES-Triana:DragonHDLatestNeural',
  'es-MX': 'es-MX-DaliaNeural',
  'pt-BR': 'pt-BR-Thalita:DragonHDLatestNeural',
  'it-IT': 'it-IT-ElsaNeural',
  'ru-RU': 'ru-RU-SvetlanaNeural',
  'hi-IN': 'hi-IN-SwaraNeural',
  'ar-SA': 'ar-SA-ZariyahNeural',
  'vi-VN': 'vi-VN-HoaiMyNeural',
  'th-TH': 'th-TH-PremwadeeNeural',
  'id-ID': 'id-ID-GadisNeural',
  'tr-TR': 'tr-TR-EmelNeural',
};

// ============================================================================
// Types
// ============================================================================

interface TTSSynthesizeResponse {
  success: boolean;
  data?: {
    audioUrl: string;
    expiresAt: string;
    cacheKey: string;
    cached: boolean;
  };
  error?: {
    code: string;
    message: string;
  };
}

// ============================================================================
// AzureSpeechProvider
// ============================================================================

export class AzureSpeechProvider implements PluginTTSProvider {
  readonly id = 'azure' as const;

  private apiEndpoint: string;
  private authToken: string;
  private pluginVersion: string;
  private cache: Map<string, ArrayBuffer> = new Map();

  constructor(apiEndpoint: string, authToken: string, pluginVersion?: string) {
    this.apiEndpoint = apiEndpoint;
    this.authToken = authToken;
    this.pluginVersion = pluginVersion ?? 'unknown';
  }

  /** Update auth token (e.g., on re-login). */
  updateAuthToken(token: string): void {
    this.authToken = token;
  }

  // ---------- PluginTTSProvider interface -----------------------------------

  supportsLanguage(lang: string): boolean {
    // Exact match or prefix match (e.g., 'en-AU' matches 'en-US')
    if (DEFAULT_VOICE_BY_LANG[lang]) return true;
    const prefix = lang.split('-')[0] ?? lang;
    return Object.keys(DEFAULT_VOICE_BY_LANG).some((k) => k.startsWith(prefix + '-'));
  }

  async synthesize(options: TTSSynthesizeOptions): Promise<ArrayBuffer> {
    if (!this.authToken) {
      throw new Error('Authentication required for cloud TTS. Please log in first.');
    }

    // Check local cache
    const cacheKey = this.buildCacheKey(options);
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const voiceId = options.voiceId || this.getDefaultVoice(options.lang);

    // Call backend: try URL mode first, fall back to stream
    const buffer = await this.synthesizeViaBackend({
      text: options.text,
      voice: voiceId,
      rate: options.rate ?? 1.0,
      lang: options.lang ?? 'en-US',
      format: AUDIO_FORMAT,
    });

    this.cache.set(cacheKey, buffer);
    return buffer;
  }

  async getVoices(lang?: string): Promise<TTSVoice[]> {
    if (lang) {
      const prefix = lang.split('-')[0] ?? lang;
      return DEFAULT_VOICES.filter((v) => v.lang.startsWith(prefix));
    }
    return [...DEFAULT_VOICES];
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.authToken);
  }

  async destroy(): Promise<void> {
    this.cache.clear();
  }

  // ---------- Backend communication ----------------------------------------

  private async synthesizeViaBackend(params: {
    text: string;
    voice: string;
    rate: number;
    lang: string;
    format: string;
  }): Promise<ArrayBuffer> {
    // Try URL mode (cached in R2, more efficient)
    try {
      return await this.requestUrlMode(params);
    } catch (urlError) {
      console.debug('[AzureSpeechProvider] URL mode failed, trying stream:', urlError);
    }

    // Fallback: stream mode (direct audio bytes)
    return this.requestStreamMode(params);
  }

  private async requestUrlMode(params: {
    text: string;
    voice: string;
    rate: number;
    lang: string;
    format: string;
  }): Promise<ArrayBuffer> {
    const url = `${this.apiEndpoint}/api/tts/synthesize`;

    const response = await requestUrl({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.authToken}`,
        'X-Client': 'obsidian-plugin',
        'X-Client-Version': this.pluginVersion,
      },
      body: JSON.stringify({
        text: params.text,
        voice: params.voice,
        rate: params.rate,
        lang: params.lang,
        format: params.format,
        responseMode: 'url',
      }),
      throw: false,
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error('Authentication failed. Please re-login in plugin settings.');
    }

    if (response.status === 402) {
      throw new Error('Insufficient credits for cloud TTS. Upgrade to Pro for more credits.');
    }

    if (response.status === 429) {
      throw new Error('TTS rate limit reached. Please wait a moment and try again.');
    }

    if (response.status === 503) {
      throw new Error('Cloud TTS service is temporarily unavailable.');
    }

    if (response.status !== 200) {
      throw new Error(`TTS request failed (${response.status})`);
    }

    const body = response.json as TTSSynthesizeResponse;
    if (!body.success || !body.data?.audioUrl) {
      throw new Error(body.error?.message ?? 'TTS synthesis failed');
    }

    // Fetch the audio from the signed URL
    const audioResponse = await requestUrl({
      url: body.data.audioUrl,
      method: 'GET',
      throw: false,
    });

    if (audioResponse.status !== 200 && audioResponse.status !== 206) {
      throw new Error(`Failed to fetch TTS audio (${audioResponse.status})`);
    }

    return audioResponse.arrayBuffer;
  }

  private async requestStreamMode(params: {
    text: string;
    voice: string;
    rate: number;
    lang: string;
    format: string;
  }): Promise<ArrayBuffer> {
    const url = `${this.apiEndpoint}/api/tts/synthesize`;

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`,
          'X-Client': 'obsidian-plugin',
          'X-Client-Version': this.pluginVersion,
        },
        body: JSON.stringify({
          text: params.text,
          voice: params.voice,
          rate: params.rate,
          lang: params.lang,
          format: params.format,
          responseMode: 'stream',
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Stream TTS failed (${response.status}): ${errorText.slice(0, 200)}`);
      }

      return await response.arrayBuffer();
    } finally {
      window.clearTimeout(timer);
    }
  }

  // ---------- Helpers -------------------------------------------------------

  private getDefaultVoice(lang?: string): string {
    if (lang && DEFAULT_VOICE_BY_LANG[lang]) {
      return DEFAULT_VOICE_BY_LANG[lang];
    }
    if (lang) {
      const prefix = lang.split('-')[0] ?? lang;
      const match = Object.entries(DEFAULT_VOICE_BY_LANG).find(([k]) => k.startsWith(prefix));
      if (match) return match[1];
    }
    return DEFAULT_VOICE_BY_LANG['en-US'] ?? 'en-US-JennyNeural';
  }

  private buildCacheKey(options: TTSSynthesizeOptions): string {
    return `${options.text}|${options.voiceId ?? ''}|${options.rate ?? 1}|${options.lang ?? ''}`;
  }
}
