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
export declare const SUPERTONIC_V3_LANGUAGE_OPTIONS: readonly TTSLanguageOption[];
export declare const AZURE_FALLBACK_LANGUAGE_OPTIONS: readonly TTSLanguageOption[];
export declare const TTS_LANGUAGE_OVERRIDE_OPTIONS: readonly TTSLanguageOption[];
export declare const SUPERTONIC_V3_LANGUAGE_CODES: Set<string>;
export declare function toShortLanguageCode(lang: string): string;
export declare function isSupertonicV3Language(lang: string): boolean;
//# sourceMappingURL=languages.d.ts.map