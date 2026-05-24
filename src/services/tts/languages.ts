/**
 * Shared TTS language metadata.
 *
 * Supertonic expects ISO 639-1 short language codes, while the plugin UI and
 * language detector use BCP-47 tags for compatibility with Azure and browser
 * conventions.
 */

export interface TTSLanguageOption {
  code: string;
  label: string;
}

export const SUPERTONIC_V3_LANGUAGE_OPTIONS: readonly TTSLanguageOption[] = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'ko-KR', label: 'Korean' },
  { code: 'ja-JP', label: 'Japanese' },
  { code: 'ar-SA', label: 'Arabic' },
  { code: 'bg-BG', label: 'Bulgarian' },
  { code: 'cs-CZ', label: 'Czech' },
  { code: 'da-DK', label: 'Danish' },
  { code: 'de-DE', label: 'German' },
  { code: 'el-GR', label: 'Greek' },
  { code: 'es-ES', label: 'Spanish (Spain)' },
  { code: 'es-MX', label: 'Spanish (Mexico)' },
  { code: 'et-EE', label: 'Estonian' },
  { code: 'fi-FI', label: 'Finnish' },
  { code: 'fr-FR', label: 'French' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'hr-HR', label: 'Croatian' },
  { code: 'hu-HU', label: 'Hungarian' },
  { code: 'id-ID', label: 'Indonesian' },
  { code: 'it-IT', label: 'Italian' },
  { code: 'lt-LT', label: 'Lithuanian' },
  { code: 'lv-LV', label: 'Latvian' },
  { code: 'nl-NL', label: 'Dutch' },
  { code: 'pl-PL', label: 'Polish' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)' },
  { code: 'ro-RO', label: 'Romanian' },
  { code: 'ru-RU', label: 'Russian' },
  { code: 'sk-SK', label: 'Slovak' },
  { code: 'sl-SI', label: 'Slovenian' },
  { code: 'sv-SE', label: 'Swedish' },
  { code: 'tr-TR', label: 'Turkish' },
  { code: 'uk-UA', label: 'Ukrainian' },
  { code: 'vi-VN', label: 'Vietnamese' },
];

export const AZURE_FALLBACK_LANGUAGE_OPTIONS: readonly TTSLanguageOption[] = [
  { code: 'zh-CN', label: 'Chinese (Simplified)' },
  { code: 'zh-TW', label: 'Chinese (Traditional)' },
  { code: 'th-TH', label: 'Thai' },
];

export const TTS_LANGUAGE_OVERRIDE_OPTIONS: readonly TTSLanguageOption[] = [
  ...SUPERTONIC_V3_LANGUAGE_OPTIONS,
  ...AZURE_FALLBACK_LANGUAGE_OPTIONS,
];

export const SUPERTONIC_V3_LANGUAGE_CODES = new Set([
  ...SUPERTONIC_V3_LANGUAGE_OPTIONS.map((option) => toShortLanguageCode(option.code)),
  'na',
]);

export function toShortLanguageCode(lang: string): string {
  return lang.split('-')[0] ?? lang;
}

export function isSupertonicV3Language(lang: string): boolean {
  return SUPERTONIC_V3_LANGUAGE_CODES.has(toShortLanguageCode(lang));
}
