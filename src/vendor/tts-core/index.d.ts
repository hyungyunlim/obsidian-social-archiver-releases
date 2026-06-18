/**
 * @social-archiver/tts-core — Public API barrel
 *
 * Canonical, framework-agnostic TTS logic shared across the Obsidian plugin
 * (compiled vendor copy), desktop app (npm `file:` dep), and — over time —
 * mobile and share-web. Replaces the mobile→plugin→desktop triplication of the
 * same markdown-cleaning / sentence-parsing / language-detection code.
 *
 * MUST stay pure: no DOM, no Node, no Obsidian/Tauri/React Native imports.
 * Platform engines (Supertonic, Azure, Web Speech) and the TTSState DOM class
 * stay in each client behind a provider interface.
 *
 * Reference: .taskmaster/docs/prd-desktop-local-tts-supertonic.md §4.7
 */
export { MIN_SPEAKABLE_WORDS, extractTextFromMarkdown, extractText, buildOffsetMap, cleanTextForTTS, countWords, isSpeakable, } from './TTSTextProcessor';
export type { TextExtractionResult } from './TTSTextProcessor';
export { parseSentences, getSentenceAtOffset, getSentenceByIndex, } from './TTSSentenceParser';
export type { Sentence } from './TTSSentenceParser';
export { detectLanguage } from './LanguageDetector';
export { TTS_CHUNK_MAX_CHARS, extractSpeechText, chunkSpeechText, buildSpeechChunks, } from './speech-text';
export { SUPERTONIC_V3_LANGUAGE_OPTIONS, AZURE_FALLBACK_LANGUAGE_OPTIONS, TTS_LANGUAGE_OVERRIDE_OPTIONS, SUPERTONIC_V3_LANGUAGE_CODES, toShortLanguageCode, isSupertonicV3Language, } from './languages';
export type { TTSLanguageOption } from './languages';
export { VALID_TRANSITIONS } from './types';
export type { PluginTTSProviderId, TTSStatus, TTSStateChangeDetail, TTSSentenceChangeDetail, TTSErrorDetail, TTSNoticeDetail, TTSSynthesizeOptions, TTSVoice, PluginTTSProvider, } from './types';
//# sourceMappingURL=index.d.ts.map