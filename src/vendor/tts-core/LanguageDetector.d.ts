/**
 * LanguageDetector
 *
 * Detects the dominant language of a text sample for TTS voice selection.
 * Extracted from mobile-app TTSEngine.detectLanguage() as an independent module (SRP).
 *
 * Strategy:
 *  - Sample the first 2000 characters for performance
 *  - Count Korean, Japanese, Chinese, Greek, Cyrillic, and Latin characters
 *  - For Latin-script text, run a secondary pass using diacritical markers
 *    and common stop-words to distinguish European languages
 *  - Return BCP-47 tag based on thresholds:
 *      Korean    >= 20% -> 'ko-KR'
 *      Japanese  >= 20% -> 'ja-JP'  (Hiragana/Katakana specific)
 *      Chinese   >= 20% -> 'zh-CN'  (CJK ideographs without Japanese kana)
 *      Arabic    >= 20% -> 'ar-SA'
 *      Devanagari>= 20% -> 'hi-IN'
 *      Thai      >= 20% -> 'th-TH'
 *      Greek     >= 20% -> 'el-GR'
 *      Cyrillic  >= 20% -> detectCyrillicLanguage() (bg/ru/uk)
 *      Latin     >= 70% -> detectLatinLanguage() (Supertonic v3 Latin languages or en-US)
 *      Otherwise         -> undefined (use system/provider default)
 */
/**
 * Detect the dominant language of a text string.
 *
 * @param text - Input text to analyze.
 * @returns BCP-47 language tag or `undefined` if no clear detection.
 */
export declare function detectLanguage(text: string): string | undefined;
//# sourceMappingURL=LanguageDetector.d.ts.map