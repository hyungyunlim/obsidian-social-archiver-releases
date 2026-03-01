/**
 * LanguageDetector
 *
 * Detects the dominant language of a text sample for TTS voice selection.
 * Extracted from mobile-app TTSEngine.detectLanguage() as an independent module (SRP).
 *
 * Strategy:
 *  - Sample the first 2000 characters for performance
 *  - Count Korean, Japanese, Chinese, and Latin characters
 *  - For Latin-script text, run a secondary pass using diacritical markers
 *    and common stop-words to distinguish European languages
 *  - Return BCP-47 tag based on thresholds:
 *      Korean    >= 20% -> 'ko-KR'
 *      Japanese  >= 20% -> 'ja-JP'  (Hiragana/Katakana specific)
 *      Chinese   >= 20% -> 'zh-CN'  (CJK ideographs without Japanese kana)
 *      Arabic    >= 20% -> 'ar-SA'
 *      Devanagari>= 20% -> 'hi-IN'
 *      Thai      >= 20% -> 'th-TH'
 *      Latin     >= 70% -> detectLatinLanguage() (de/fr/es/pt/it/ru/vi/tr or en-US)
 *      Otherwise         -> undefined (use system/provider default)
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum characters to sample for language detection. */
const SAMPLE_LENGTH = 2000;

/** Minimum ratio of Korean characters to trigger Korean language. */
const KOREAN_THRESHOLD = 0.2;

/** Minimum ratio of Japanese characters to trigger Japanese language. */
const JAPANESE_THRESHOLD = 0.2;

/** Minimum ratio of Chinese characters to trigger Chinese language. */
const CHINESE_THRESHOLD = 0.2;

/** Minimum ratio of Latin characters to trigger Latin-script language detection. */
const LATIN_THRESHOLD = 0.7;

/** Minimum ratio of Cyrillic characters to trigger Russian. */
const CYRILLIC_THRESHOLD = 0.2;

/** Minimum ratio of Arabic characters to trigger Arabic. */
const ARABIC_THRESHOLD = 0.2;

/** Minimum ratio of Devanagari characters to trigger Hindi. */
const DEVANAGARI_THRESHOLD = 0.2;

/** Minimum ratio of Thai characters to trigger Thai. */
const THAI_THRESHOLD = 0.2;

/** Minimum ratio of Vietnamese diacritical characters to trigger Vietnamese. */
const VIETNAMESE_THRESHOLD = 0.03;

/** Minimum ratio of language-specific diacritical characters to trigger a language. */
const DIACRITIC_THRESHOLD = 0.02;

// ---------------------------------------------------------------------------
// Character classification
// ---------------------------------------------------------------------------

function isKorean(code: number): boolean {
  // Hangul Jamo: U+1100–U+11FF
  if (code >= 0x1100 && code <= 0x11ff) return true;
  // Hangul Compatibility Jamo: U+3131–U+3163
  if (code >= 0x3131 && code <= 0x3163) return true;
  // Hangul Syllables: U+AC00–U+D7A3
  if (code >= 0xac00 && code <= 0xd7a3) return true;
  return false;
}

function isJapanese(code: number): boolean {
  // Hiragana: U+3040–U+309F
  if (code >= 0x3040 && code <= 0x309f) return true;
  // Katakana: U+30A0–U+30FF
  if (code >= 0x30a0 && code <= 0x30ff) return true;
  return false;
}

function isChinese(code: number): boolean {
  // CJK Unified Ideographs: U+4E00–U+9FFF
  if (code >= 0x4e00 && code <= 0x9fff) return true;
  // CJK Extension A: U+3400–U+4DBF
  if (code >= 0x3400 && code <= 0x4dbf) return true;
  return false;
}

function isLatin(code: number): boolean {
  // ASCII letters: A-Z, a-z
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function isCyrillic(code: number): boolean {
  // Cyrillic: U+0400–U+04FF
  return code >= 0x0400 && code <= 0x04ff;
}

function isArabic(code: number): boolean {
  // Arabic: U+0600–U+06FF
  if (code >= 0x0600 && code <= 0x06ff) return true;
  // Arabic Supplement: U+0750–U+077F
  if (code >= 0x0750 && code <= 0x077f) return true;
  // Arabic Extended-A: U+08A0–U+08FF
  if (code >= 0x08a0 && code <= 0x08ff) return true;
  return false;
}

function isDevanagari(code: number): boolean {
  // Devanagari: U+0900–U+097F
  if (code >= 0x0900 && code <= 0x097f) return true;
  // Devanagari Extended: U+A8E0–U+A8FF
  if (code >= 0xa8e0 && code <= 0xa8ff) return true;
  return false;
}

function isThai(code: number): boolean {
  // Thai: U+0E00–U+0E7F
  return code >= 0x0e00 && code <= 0x0e7f;
}

// ---------------------------------------------------------------------------
// Latin-script language detection via diacritical markers
// ---------------------------------------------------------------------------

/** Characters unique or strongly indicative of German. */
const GERMAN_CHARS = new Set([
  0x00c4, // Ä
  0x00d6, // Ö
  0x00dc, // Ü
  0x00e4, // ä
  0x00f6, // ö
  0x00fc, // ü
  0x00df, // ß
]);

/** Characters strongly indicative of French. */
const FRENCH_CHARS = new Set([
  0x00e0, // à
  0x00e2, // â
  0x00e7, // ç
  0x00e8, // è
  0x00e9, // é
  0x00ea, // ê
  0x00eb, // ë
  0x00ee, // î
  0x00ef, // ï
  0x00f4, // ô
  0x00f9, // ù
  0x00fb, // û
  0x0153, // œ
  0x00c0, // À
  0x00c9, // É
  0x00c8, // È
  0x00ca, // Ê
  0x00cb, // Ë
  0x00ce, // Î
  0x00cf, // Ï
  0x00d4, // Ô
  0x00d9, // Ù
  0x00db, // Û
  0x0152, // Œ
]);

/** Characters strongly indicative of Spanish. */
const SPANISH_CHARS = new Set([
  0x00f1, // ñ
  0x00d1, // Ñ
  0x00bf, // ¿
  0x00a1, // ¡
]);

/** Characters strongly indicative of Portuguese. */
const PORTUGUESE_CHARS = new Set([
  0x00e3, // ã
  0x00f5, // õ
  0x00c3, // Ã
  0x00d5, // Õ
]);

/** Characters strongly indicative of Turkish. */
const TURKISH_CHARS = new Set([
  0x011e, // Ğ
  0x011f, // ğ
  0x0130, // İ
  0x0131, // ı
  0x015e, // Ş
  0x015f, // ş
]);

/**
 * Vietnamese-specific diacritical marks and precomposed characters.
 * Vietnamese uses a high density of stacked diacritics (ắ, ề, ổ, ử, etc.)
 * that are unique across Latin-script languages.
 */
const VIETNAMESE_CHARS = new Set([
  // Unique Vietnamese vowels with horn/breve
  0x01a0, 0x01a1, // Ơ ơ
  0x01af, 0x01b0, // Ư ư
  0x0102, 0x0103, // Ă ă
  0x0110, 0x0111, // Đ đ
  // Precomposed with tone marks (most distinctive)
  0x1ea0, 0x1ea1, 0x1ea2, 0x1ea3, 0x1ea4, 0x1ea5, 0x1ea6, 0x1ea7, // Ạ–ầ
  0x1ea8, 0x1ea9, 0x1eaa, 0x1eab, 0x1eac, 0x1ead, 0x1eae, 0x1eaf, // Ẩ–ắ
  0x1eb0, 0x1eb1, 0x1eb2, 0x1eb3, 0x1eb4, 0x1eb5, 0x1eb6, 0x1eb7, // Ằ–ặ
  0x1eb8, 0x1eb9, 0x1eba, 0x1ebb, 0x1ebc, 0x1ebd, 0x1ebe, 0x1ebf, // Ẹ–ế
  0x1ec0, 0x1ec1, 0x1ec2, 0x1ec3, 0x1ec4, 0x1ec5, 0x1ec6, 0x1ec7, // Ề–ệ
  0x1ec8, 0x1ec9, 0x1eca, 0x1ecb, // Ỉ–ị
  0x1ecc, 0x1ecd, 0x1ece, 0x1ecf, 0x1ed0, 0x1ed1, 0x1ed2, 0x1ed3, // Ọ–ồ
  0x1ed4, 0x1ed5, 0x1ed6, 0x1ed7, 0x1ed8, 0x1ed9, 0x1eda, 0x1edb, // Ổ–ớ
  0x1edc, 0x1edd, 0x1ede, 0x1edf, 0x1ee0, 0x1ee1, 0x1ee2, 0x1ee3, // Ờ–ợ
  0x1ee4, 0x1ee5, 0x1ee6, 0x1ee7, 0x1ee8, 0x1ee9, 0x1eea, 0x1eeb, // Ụ–ừ
  0x1eec, 0x1eed, 0x1eee, 0x1eef, 0x1ef0, 0x1ef1, // Ử–ự
  0x1ef2, 0x1ef3, 0x1ef4, 0x1ef5, 0x1ef6, 0x1ef7, 0x1ef8, 0x1ef9, // Ỳ–ỹ
]);

/** Common stop-words per language for secondary confirmation. */
const STOP_WORDS: Record<string, Set<string>> = {
  de: new Set(['der', 'die', 'das', 'und', 'ist', 'ein', 'eine', 'nicht', 'ich', 'auf', 'mit', 'den', 'für', 'von', 'sind', 'sich', 'des', 'dem', 'dass', 'auch', 'als', 'aber', 'nach', 'wie', 'noch', 'war', 'werden', 'wenn', 'wird']),
  fr: new Set(['les', 'des', 'une', 'est', 'pas', 'que', 'pour', 'qui', 'dans', 'sur', 'sont', 'avec', 'par', 'mais', 'cette', 'ont', 'aux', 'ses', 'tout', 'nous', 'vous', 'leur', 'aussi', 'comme', 'ces', 'fait', 'peut', 'entre', 'deux']),
  es: new Set(['los', 'las', 'una', 'por', 'del', 'con', 'para', 'que', 'son', 'fue', 'como', 'pero', 'sus', 'más', 'sobre', 'hay', 'entre', 'todos', 'esta', 'desde', 'muy', 'tiene', 'también', 'otro', 'ella', 'nos', 'han', 'sin', 'este']),
  pt: new Set(['uma', 'dos', 'das', 'por', 'com', 'para', 'que', 'são', 'foi', 'como', 'mas', 'seus', 'mais', 'sobre', 'entre', 'tem', 'esta', 'desde', 'muito', 'também', 'outro', 'ela', 'nos', 'sem', 'este', 'pelo', 'pela', 'isso', 'ainda']),
  it: new Set(['gli', 'uno', 'una', 'per', 'del', 'con', 'che', 'sono', 'non', 'come', 'anche', 'suo', 'dei', 'della', 'sul', 'nel', 'dal', 'alla', 'tra', 'cui', 'questo', 'quello', 'questa', 'molto', 'più', 'stato', 'essere', 'hanno', 'fatto']),
  tr: new Set(['bir', 'bir', 'ile', 'için', 'olan', 'gibi', 'daha', 'çok', 'ama', 'var', 'kadar', 'sonra', 'olarak', 'ancak', 'onun', 'bunu', 'üzerinde', 'tarafından', 'oldu', 'olan', 'arasında']),
};

interface DiacriticCounts {
  german: number;
  french: number;
  spanish: number;
  portuguese: number;
  turkish: number;
  vietnamese: number;
}

/**
 * Detect which Latin-script language the text belongs to.
 * Uses diacritical character frequency + stop-word matching.
 */
function detectLatinLanguage(sample: string, total: number): string {
  const counts: DiacriticCounts = {
    german: 0,
    french: 0,
    spanish: 0,
    portuguese: 0,
    turkish: 0,
    vietnamese: 0,
  };

  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (GERMAN_CHARS.has(code)) counts.german++;
    if (FRENCH_CHARS.has(code)) counts.french++;
    if (SPANISH_CHARS.has(code)) counts.spanish++;
    if (PORTUGUESE_CHARS.has(code)) counts.portuguese++;
    if (TURKISH_CHARS.has(code)) counts.turkish++;
    if (VIETNAMESE_CHARS.has(code)) counts.vietnamese++;
  }

  // Vietnamese has very high diacritical density — check first
  if (counts.vietnamese / total >= VIETNAMESE_THRESHOLD) return 'vi-VN';

  // Turkish unique chars (ğ, ı, ş, İ) are highly distinctive
  if (counts.turkish / total >= DIACRITIC_THRESHOLD) return 'tr-TR';

  // German ß/ü/ö/ä are distinctive; shared ö/ü with Turkish already handled
  if (counts.german / total >= DIACRITIC_THRESHOLD) return 'de-DE';

  // Portuguese ã/õ are unique vs Spanish/French
  if (counts.portuguese / total >= DIACRITIC_THRESHOLD) return 'pt-BR';

  // Spanish ñ/¿/¡ are unique
  if (counts.spanish / total >= DIACRITIC_THRESHOLD) return 'es-ES';

  // French has many accent types but shares some with others; check after above
  if (counts.french / total >= DIACRITIC_THRESHOLD) return 'fr-FR';

  // No diacritical markers found — try stop-word matching
  return detectByStopWords(sample);
}

/**
 * Fallback: count stop-word hits to distinguish languages that may lack diacritics
 * (e.g., informal text, social media, or borrowed words).
 */
function detectByStopWords(sample: string): string {
  const lower = sample.toLowerCase();
  // Split on whitespace and common punctuation
  const words = new Set(lower.split(/[\s,.;:!?'"()\[\]{}<>\/\\|]+/).filter(Boolean));

  let bestLang = 'en-US';
  let bestScore = 0;

  for (const [lang, stopWords] of Object.entries(STOP_WORDS)) {
    let score = 0;
    for (const word of stopWords) {
      if (words.has(word)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestLang = langCodeToBCP47(lang);
    }
  }

  // Require at least 3 stop-word matches to override English default
  return bestScore >= 3 ? bestLang : 'en-US';
}

function langCodeToBCP47(lang: string): string {
  switch (lang) {
    case 'de': return 'de-DE';
    case 'fr': return 'fr-FR';
    case 'es': return 'es-ES';
    case 'pt': return 'pt-BR';
    case 'it': return 'it-IT';
    case 'tr': return 'tr-TR';
    default: return 'en-US';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect the dominant language of a text string.
 *
 * @param text - Input text to analyze.
 * @returns BCP-47 language tag or `undefined` if no clear detection.
 */
export function detectLanguage(text: string): string | undefined {
  if (!text || text.trim().length === 0) return undefined;

  const sample = text.slice(0, SAMPLE_LENGTH);
  let korean = 0;
  let japanese = 0; // Hiragana + Katakana only (Japanese-specific)
  let chinese = 0;  // CJK Ideographs (shared by Chinese/Japanese)
  let latin = 0;
  let cyrillic = 0;
  let arabic = 0;
  let devanagari = 0;
  let thai = 0;
  let total = 0;

  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);

    // Skip whitespace and punctuation for ratio calculation
    if (code <= 0x20) continue; // control chars + space
    if (code >= 0x21 && code <= 0x2f) continue; // !"#$%&'()*+,-./
    if (code >= 0x3a && code <= 0x40) continue; // :;<=>?@
    if (code >= 0x5b && code <= 0x60) continue; // [\]^_`
    if (code >= 0x7b && code <= 0x7e) continue; // {|}~

    total++;

    if (isKorean(code)) {
      korean++;
    } else if (isJapanese(code)) {
      japanese++;
    } else if (isChinese(code)) {
      chinese++;
    } else if (isCyrillic(code)) {
      cyrillic++;
    } else if (isArabic(code)) {
      arabic++;
    } else if (isDevanagari(code)) {
      devanagari++;
    } else if (isThai(code)) {
      thai++;
    } else if (isLatin(code)) {
      latin++;
    }
  }

  if (total === 0) return undefined;

  const koreanRatio = korean / total;
  const japaneseRatio = japanese / total;
  const chineseRatio = chinese / total;
  const cyrillicRatio = cyrillic / total;
  const arabicRatio = arabic / total;
  const devanagariRatio = devanagari / total;
  const thaiRatio = thai / total;
  const latinRatio = latin / total;

  // Korean: Hangul is unambiguous
  if (koreanRatio >= KOREAN_THRESHOLD) return 'ko-KR';
  // Japanese: if Hiragana/Katakana present, it's Japanese (even with Kanji)
  if (japaneseRatio >= JAPANESE_THRESHOLD) return 'ja-JP';
  // Chinese: CJK ideographs without Japanese kana → Chinese
  if (chineseRatio >= CHINESE_THRESHOLD) return 'zh-CN';
  // Russian: Cyrillic script
  if (cyrillicRatio >= CYRILLIC_THRESHOLD) return 'ru-RU';
  // Arabic: Arabic script
  if (arabicRatio >= ARABIC_THRESHOLD) return 'ar-SA';
  // Hindi: Devanagari script
  if (devanagariRatio >= DEVANAGARI_THRESHOLD) return 'hi-IN';
  // Thai: Thai script
  if (thaiRatio >= THAI_THRESHOLD) return 'th-TH';
  // Latin-script languages: run secondary detection
  if (latinRatio >= LATIN_THRESHOLD) return detectLatinLanguage(sample, total);

  return undefined;
}
