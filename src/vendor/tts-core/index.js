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
// ===========================================================================
// Text extraction + cleaning (plugin canonical — ported from mobile)
// ===========================================================================
export { MIN_SPEAKABLE_WORDS, extractTextFromMarkdown, extractText, buildOffsetMap, cleanTextForTTS, countWords, isSpeakable, } from './TTSTextProcessor';
// ===========================================================================
// Sentence parsing (abbreviation/decimal/CJK aware, offset-preserving)
// ===========================================================================
export { parseSentences, getSentenceAtOffset, getSentenceByIndex, } from './TTSSentenceParser';
// ===========================================================================
// Language detection (script ranges + diacritic/stopword tables, zero deps)
// ===========================================================================
export { detectLanguage } from './LanguageDetector';
// ===========================================================================
// Web-speech text API (markdown→plaintext + <=N-char chunking, CJK aware)
// Desktop's read-aloud surface re-exports these verbatim.
// ===========================================================================
export { TTS_CHUNK_MAX_CHARS, extractSpeechText, chunkSpeechText, buildSpeechChunks, } from './speech-text';
// ===========================================================================
// Supported-language catalogues + helpers
// ===========================================================================
export { SUPERTONIC_V3_LANGUAGE_OPTIONS, AZURE_FALLBACK_LANGUAGE_OPTIONS, TTS_LANGUAGE_OVERRIDE_OPTIONS, SUPERTONIC_V3_LANGUAGE_CODES, toShortLanguageCode, isSupertonicV3Language, } from './languages';
// ===========================================================================
// State-machine types + transition table (the TTSState CLASS stays per-client;
// it depends on DOM CustomEvent/EventTarget — desktop uses a Svelte store).
// ===========================================================================
export { VALID_TRANSITIONS } from './types';
//# sourceMappingURL=index.js.map