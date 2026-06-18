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
/** Minimum ratio of Cyrillic characters to trigger Cyrillic language detection. */
const CYRILLIC_THRESHOLD = 0.2;
/** Minimum ratio of Greek characters to trigger Greek. */
const GREEK_THRESHOLD = 0.2;
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
function isKorean(code) {
    // Hangul Jamo: U+1100–U+11FF
    if (code >= 0x1100 && code <= 0x11ff)
        return true;
    // Hangul Compatibility Jamo: U+3131–U+3163
    if (code >= 0x3131 && code <= 0x3163)
        return true;
    // Hangul Syllables: U+AC00–U+D7A3
    if (code >= 0xac00 && code <= 0xd7a3)
        return true;
    return false;
}
function isJapanese(code) {
    // Hiragana: U+3040–U+309F
    if (code >= 0x3040 && code <= 0x309f)
        return true;
    // Katakana: U+30A0–U+30FF
    if (code >= 0x30a0 && code <= 0x30ff)
        return true;
    return false;
}
function isChinese(code) {
    // CJK Unified Ideographs: U+4E00–U+9FFF
    if (code >= 0x4e00 && code <= 0x9fff)
        return true;
    // CJK Extension A: U+3400–U+4DBF
    if (code >= 0x3400 && code <= 0x4dbf)
        return true;
    return false;
}
function isLatin(code) {
    // ASCII letters: A-Z, a-z
    return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}
function isCyrillic(code) {
    // Cyrillic: U+0400–U+04FF
    return code >= 0x0400 && code <= 0x04ff;
}
function isGreek(code) {
    // Greek and Coptic: U+0370–U+03FF
    if (code >= 0x0370 && code <= 0x03ff)
        return true;
    // Greek Extended: U+1F00–U+1FFF
    if (code >= 0x1f00 && code <= 0x1fff)
        return true;
    return false;
}
function isArabic(code) {
    // Arabic: U+0600–U+06FF
    if (code >= 0x0600 && code <= 0x06ff)
        return true;
    // Arabic Supplement: U+0750–U+077F
    if (code >= 0x0750 && code <= 0x077f)
        return true;
    // Arabic Extended-A: U+08A0–U+08FF
    if (code >= 0x08a0 && code <= 0x08ff)
        return true;
    return false;
}
function isDevanagari(code) {
    // Devanagari: U+0900–U+097F
    if (code >= 0x0900 && code <= 0x097f)
        return true;
    // Devanagari Extended: U+A8E0–U+A8FF
    if (code >= 0xa8e0 && code <= 0xa8ff)
        return true;
    return false;
}
function isThai(code) {
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
/** Characters strongly indicative of Polish. */
const POLISH_CHARS = new Set([
    0x0104, 0x0105, // Ą ą
    0x0106, 0x0107, // Ć ć
    0x0118, 0x0119, // Ę ę
    0x0141, 0x0142, // Ł ł
    0x0143, 0x0144, // Ń ń
    0x015a, 0x015b, // Ś ś
    0x0179, 0x017a, // Ź ź
    0x017b, 0x017c, // Ż ż
]);
/** Characters strongly indicative of Czech. */
const CZECH_CHARS = new Set([
    0x010c, 0x010d, // Č č
    0x010e, 0x010f, // Ď ď
    0x011a, 0x011b, // Ě ě
    0x0147, 0x0148, // Ň ň
    0x0158, 0x0159, // Ř ř
    0x0160, 0x0161, // Š š
    0x0164, 0x0165, // Ť ť
    0x016e, 0x016f, // Ů ů
    0x017d, 0x017e, // Ž ž
]);
/** Characters strongly indicative of Slovak. */
const SLOVAK_CHARS = new Set([
    0x0139, 0x013a, // Ĺ ĺ
    0x013d, 0x013e, // Ľ ľ
    0x0147, 0x0148, // Ň ň
    0x0154, 0x0155, // Ŕ ŕ
    0x00d4, 0x00f4, // Ô ô
]);
/** Characters strongly indicative of Danish. */
const DANISH_CHARS = new Set([
    0x00c6, 0x00e6, // Æ æ
    0x00d8, 0x00f8, // Ø ø
]);
/** Characters strongly indicative of Hungarian. */
const HUNGARIAN_CHARS = new Set([
    0x0150, 0x0151, // Ő ő
    0x0170, 0x0171, // Ű ű
]);
/** Characters strongly indicative of Romanian. */
const ROMANIAN_CHARS = new Set([
    0x0102, 0x0103, // Ă ă
    0x00c2, 0x00e2, // Â â
    0x00ce, 0x00ee, // Î î
    0x0218, 0x0219, // Ș ș
    0x021a, 0x021b, // Ț ț
    0x0162, 0x0163, // Ţ ţ
]);
/** Characters strongly indicative of Lithuanian. */
const LITHUANIAN_CHARS = new Set([
    0x0116, 0x0117, // Ė ė
    0x012e, 0x012f, // Į į
    0x0172, 0x0173, // Ų ų
]);
/** Characters strongly indicative of Latvian. */
const LATVIAN_CHARS = new Set([
    0x0122, 0x0123, // Ģ ģ
    0x0136, 0x0137, // Ķ ķ
    0x013b, 0x013c, // Ļ ļ
    0x0145, 0x0146, // Ņ ņ
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
const STOP_WORDS = {
    bg: new Set(['това', 'този', 'тази', 'тези', 'съм', 'са', 'е', 'сме', 'ще', 'че', 'като', 'за', 'от', 'на', 'със', 'има', 'беше', 'много', 'който', 'която', 'които', 'но', 'или']),
    cs: new Set(['jsem', 'jsou', 'byl', 'byla', 'bude', 'není', 'jako', 'pro', 'který', 'která', 'které', 'tento', 'tato', 'protože', 'ale', 'také', 'když', 'mezi', 'podle', 'při', 'jeho', 'její']),
    da: new Set(['og', 'det', 'er', 'ikke', 'jeg', 'du', 'på', 'med', 'en', 'et', 'der', 'for', 'til', 'som', 'har', 'var', 'kan', 'skal', 'eller', 'men', 'den', 'de', 'af', 'om']),
    de: new Set(['der', 'die', 'das', 'und', 'ist', 'ein', 'eine', 'nicht', 'ich', 'auf', 'mit', 'den', 'für', 'von', 'sind', 'sich', 'des', 'dem', 'dass', 'auch', 'als', 'aber', 'nach', 'wie', 'noch', 'war', 'werden', 'wenn', 'wird']),
    et: new Set(['ja', 'on', 'ei', 'see', 'mis', 'et', 'kui', 'aga', 'ole', 'oli', 'ning', 'või', 'selle', 'siis', 'nagu', 'oma', 'veel', 'kõik', 'üle', 'läbi', 'saab']),
    fi: new Set(['ja', 'on', 'ei', 'se', 'että', 'kun', 'mutta', 'oli', 'ovat', 'joka', 'myös', 'tai', 'sekä', 'tämä', 'sillä', 'kuten', 'jos', 'vain', 'voi', 'tulee', 'olla']),
    fr: new Set(['les', 'des', 'une', 'est', 'pas', 'que', 'pour', 'qui', 'dans', 'sur', 'sont', 'avec', 'par', 'mais', 'cette', 'ont', 'aux', 'ses', 'tout', 'nous', 'vous', 'leur', 'aussi', 'comme', 'ces', 'fait', 'peut', 'entre', 'deux']),
    hr: new Set(['što', 'koji', 'koja', 'koje', 'nije', 'jesu', 'bilo', 'bila', 'kao', 'zbog', 'prema', 'kada', 'samo', 'može', 'vrlo', 'također', 'između', 'nakon', 'prije', 'dok', 'ako']),
    hu: new Set(['hogy', 'nem', 'egy', 'és', 'van', 'volt', 'mint', 'mert', 'vagy', 'az', 'meg', 'már', 'csak', 'szerint', 'kell', 'lehet', 'amikor', 'között', 'után', 'előtt', 'minden']),
    id: new Set(['yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'dengan', 'ini', 'itu', 'tidak', 'adalah', 'sebagai', 'pada', 'karena', 'akan', 'lebih', 'saya', 'kami', 'mereka', 'dalam', 'juga', 'atau']),
    es: new Set(['los', 'las', 'una', 'por', 'del', 'con', 'para', 'que', 'son', 'fue', 'como', 'pero', 'sus', 'más', 'sobre', 'hay', 'entre', 'todos', 'esta', 'desde', 'muy', 'tiene', 'también', 'otro', 'ella', 'nos', 'han', 'sin', 'este']),
    pt: new Set(['uma', 'dos', 'das', 'por', 'com', 'para', 'que', 'são', 'foi', 'como', 'mas', 'seus', 'mais', 'sobre', 'entre', 'tem', 'esta', 'desde', 'muito', 'também', 'outro', 'ela', 'nos', 'sem', 'este', 'pelo', 'pela', 'isso', 'ainda']),
    it: new Set(['gli', 'uno', 'una', 'per', 'del', 'con', 'che', 'sono', 'non', 'come', 'anche', 'suo', 'dei', 'della', 'sul', 'nel', 'dal', 'alla', 'tra', 'cui', 'questo', 'quello', 'questa', 'molto', 'più', 'stato', 'essere', 'hanno', 'fatto']),
    lt: new Set(['yra', 'ir', 'kad', 'ne', 'su', 'kaip', 'tai', 'už', 'nuo', 'bet', 'apie', 'gali', 'buvo', 'bus', 'kuris', 'kuri', 'labai', 'tarp', 'po', 'prieš', 'todėl']),
    lv: new Set(['un', 'ir', 'ka', 'ar', 'par', 'tas', 'tā', 'lai', 'nav', 'bet', 'no', 'bija', 'jau', 'var', 'kā', 'ļoti', 'starp', 'pēc', 'pirms', 'tāpēc', 'kurš']),
    nl: new Set(['de', 'het', 'een', 'en', 'is', 'niet', 'op', 'met', 'van', 'voor', 'dat', 'die', 'als', 'maar', 'zijn', 'wordt', 'ook', 'aan', 'door', 'naar', 'over', 'bij', 'uit']),
    pl: new Set(['nie', 'jest', 'oraz', 'który', 'która', 'które', 'się', 'dla', 'jak', 'ale', 'przez', 'może', 'był', 'była', 'między', 'poza', 'ponieważ', 'także', 'jego', 'jej']),
    ro: new Set(['este', 'sunt', 'nu', 'și', 'pentru', 'care', 'din', 'cu', 'în', 'pe', 'dar', 'această', 'acest', 'foarte', 'după', 'înainte', 'poate', 'mai', 'între', 'sau', 'fost']),
    ru: new Set(['это', 'что', 'как', 'для', 'из', 'или', 'но', 'они', 'был', 'была', 'его', 'она', 'все', 'так', 'если', 'между', 'после', 'перед', 'может', 'очень', 'который']),
    sk: new Set(['som', 'sú', 'bol', 'bola', 'nie', 'ako', 'pre', 'ktorý', 'ktorá', 'ktoré', 'tento', 'táto', 'pretože', 'ale', 'tiež', 'keď', 'medzi', 'podľa', 'pri', 'jeho', 'jej']),
    sl: new Set(['je', 'in', 'ni', 'kot', 'zato', 'zaradi', 'lahko', 'bilo', 'bila', 'kateri', 'katera', 'ki', 'med', 'po', 'pred', 'zelo', 'tudi', 'če', 'ampak', 'samo', 'skozi']),
    sv: new Set(['och', 'det', 'är', 'inte', 'jag', 'du', 'på', 'med', 'en', 'ett', 'som', 'har', 'var', 'för', 'till', 'kan', 'ska', 'eller', 'men', 'den', 'de', 'av', 'om']),
    tr: new Set(['bir', 'bir', 'ile', 'için', 'olan', 'gibi', 'daha', 'çok', 'ama', 'var', 'kadar', 'sonra', 'olarak', 'ancak', 'onun', 'bunu', 'üzerinde', 'tarafından', 'oldu', 'olan', 'arasında']),
    uk: new Set(['це', 'що', 'для', 'як', 'не', 'та', 'але', 'вони', 'був', 'була', 'його', 'вона', 'між', 'після', 'перед', 'може', 'дуже', 'який', 'яка', 'які', 'тому']),
    vi: new Set(['và', 'là', 'của', 'trong', 'không', 'cho', 'một', 'những', 'với', 'để', 'này', 'đó', 'khi', 'nhưng', 'cũng', 'được', 'người', 'tôi', 'chúng', 'rất']),
};
const DIACRITIC_LANGUAGE_MARKERS = [
    { lang: 'vi', chars: VIETNAMESE_CHARS, threshold: VIETNAMESE_THRESHOLD },
    { lang: 'tr', chars: TURKISH_CHARS, threshold: DIACRITIC_THRESHOLD },
    { lang: 'pl', chars: POLISH_CHARS, threshold: DIACRITIC_THRESHOLD },
    { lang: 'ro', chars: ROMANIAN_CHARS, threshold: DIACRITIC_THRESHOLD },
    { lang: 'hu', chars: HUNGARIAN_CHARS, threshold: DIACRITIC_THRESHOLD },
    { lang: 'cs', chars: CZECH_CHARS, threshold: DIACRITIC_THRESHOLD },
    { lang: 'sk', chars: SLOVAK_CHARS, threshold: DIACRITIC_THRESHOLD },
    { lang: 'da', chars: DANISH_CHARS, threshold: DIACRITIC_THRESHOLD },
    { lang: 'lv', chars: LATVIAN_CHARS, threshold: DIACRITIC_THRESHOLD },
    { lang: 'lt', chars: LITHUANIAN_CHARS, threshold: DIACRITIC_THRESHOLD },
    { lang: 'pt', chars: PORTUGUESE_CHARS, threshold: DIACRITIC_THRESHOLD },
    { lang: 'es', chars: SPANISH_CHARS, threshold: DIACRITIC_THRESHOLD },
    { lang: 'fr', chars: FRENCH_CHARS, threshold: DIACRITIC_THRESHOLD },
    { lang: 'de', chars: GERMAN_CHARS, threshold: DIACRITIC_THRESHOLD },
];
/**
 * Detect which Latin-script language the text belongs to.
 * Uses diacritical character frequency + stop-word matching.
 */
function detectLatinLanguage(sample, total) {
    const stopWordMatch = detectByStopWords(sample);
    if (stopWordMatch)
        return stopWordMatch;
    const markerMatch = detectByDiacriticalMarkers(sample, total);
    if (markerMatch)
        return markerMatch;
    return 'en-US';
}
/**
 * Fallback: count stop-word hits to distinguish languages that may lack diacritics
 * (e.g., informal text, social media, or borrowed words).
 */
function detectByStopWords(sample) {
    const lower = sample.toLowerCase();
    // Split on whitespace and common punctuation
    const words = new Set(lower.split(/[\s,.;:!?'"()[\]{}<>/\\|]+/).filter(Boolean));
    let bestLang;
    let bestScore = 0;
    for (const [lang, stopWords] of Object.entries(STOP_WORDS)) {
        let score = 0;
        for (const word of stopWords) {
            if (words.has(word))
                score++;
        }
        if (score > bestScore) {
            bestScore = score;
            bestLang = langCodeToBCP47(lang);
        }
    }
    // Require at least 3 stop-word matches to override English default
    return bestScore >= 3 ? bestLang : undefined;
}
function detectByDiacriticalMarkers(sample, total) {
    for (const marker of DIACRITIC_LANGUAGE_MARKERS) {
        let count = 0;
        for (let i = 0; i < sample.length; i++) {
            if (marker.chars.has(sample.charCodeAt(i)))
                count++;
        }
        if (count / total >= marker.threshold) {
            return langCodeToBCP47(marker.lang);
        }
    }
    return undefined;
}
function detectCyrillicLanguage(sample) {
    if (hasUkrainianSpecificChars(sample))
        return 'uk-UA';
    const stopWordMatch = detectByStopWords(sample);
    if (stopWordMatch === 'bg-BG' || stopWordMatch === 'uk-UA' || stopWordMatch === 'ru-RU') {
        return stopWordMatch;
    }
    return 'ru-RU';
}
function hasUkrainianSpecificChars(sample) {
    for (let i = 0; i < sample.length; i++) {
        const code = sample.charCodeAt(i);
        if (code === 0x0404 || code === 0x0454 || // Є є
            code === 0x0406 || code === 0x0456 || // І і
            code === 0x0407 || code === 0x0457 || // Ї ї
            code === 0x0490 || code === 0x0491 // Ґ ґ
        ) {
            return true;
        }
    }
    return false;
}
function langCodeToBCP47(lang) {
    switch (lang) {
        case 'bg': return 'bg-BG';
        case 'cs': return 'cs-CZ';
        case 'da': return 'da-DK';
        case 'de': return 'de-DE';
        case 'et': return 'et-EE';
        case 'fi': return 'fi-FI';
        case 'fr': return 'fr-FR';
        case 'hr': return 'hr-HR';
        case 'hu': return 'hu-HU';
        case 'id': return 'id-ID';
        case 'es': return 'es-ES';
        case 'pt': return 'pt-BR';
        case 'it': return 'it-IT';
        case 'lt': return 'lt-LT';
        case 'lv': return 'lv-LV';
        case 'nl': return 'nl-NL';
        case 'pl': return 'pl-PL';
        case 'ro': return 'ro-RO';
        case 'ru': return 'ru-RU';
        case 'sk': return 'sk-SK';
        case 'sl': return 'sl-SI';
        case 'sv': return 'sv-SE';
        case 'tr': return 'tr-TR';
        case 'uk': return 'uk-UA';
        case 'vi': return 'vi-VN';
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
export function detectLanguage(text) {
    if (!text || text.trim().length === 0)
        return undefined;
    const sample = text.slice(0, SAMPLE_LENGTH);
    let korean = 0;
    let japanese = 0; // Hiragana + Katakana only (Japanese-specific)
    let chinese = 0; // CJK Ideographs (shared by Chinese/Japanese)
    let latin = 0;
    let cyrillic = 0;
    let greek = 0;
    let arabic = 0;
    let devanagari = 0;
    let thai = 0;
    let total = 0;
    for (let i = 0; i < sample.length; i++) {
        const code = sample.charCodeAt(i);
        // Skip whitespace and punctuation for ratio calculation
        if (code <= 0x20)
            continue; // control chars + space
        if (code >= 0x21 && code <= 0x2f)
            continue; // !"#$%&'()*+,-./
        if (code >= 0x3a && code <= 0x40)
            continue; // :;<=>?@
        if (code >= 0x5b && code <= 0x60)
            continue; // [\]^_`
        if (code >= 0x7b && code <= 0x7e)
            continue; // {|}~
        total++;
        if (isKorean(code)) {
            korean++;
        }
        else if (isJapanese(code)) {
            japanese++;
        }
        else if (isChinese(code)) {
            chinese++;
        }
        else if (isCyrillic(code)) {
            cyrillic++;
        }
        else if (isGreek(code)) {
            greek++;
        }
        else if (isArabic(code)) {
            arabic++;
        }
        else if (isDevanagari(code)) {
            devanagari++;
        }
        else if (isThai(code)) {
            thai++;
        }
        else if (isLatin(code)) {
            latin++;
        }
    }
    if (total === 0)
        return undefined;
    const koreanRatio = korean / total;
    const japaneseRatio = japanese / total;
    const chineseRatio = chinese / total;
    const cyrillicRatio = cyrillic / total;
    const greekRatio = greek / total;
    const arabicRatio = arabic / total;
    const devanagariRatio = devanagari / total;
    const thaiRatio = thai / total;
    const latinRatio = latin / total;
    // Korean: Hangul is unambiguous
    if (koreanRatio >= KOREAN_THRESHOLD)
        return 'ko-KR';
    // Japanese: if Hiragana/Katakana present, it's Japanese (even with Kanji)
    if (japaneseRatio >= JAPANESE_THRESHOLD)
        return 'ja-JP';
    // Chinese: CJK ideographs without Japanese kana → Chinese
    if (chineseRatio >= CHINESE_THRESHOLD)
        return 'zh-CN';
    // Greek: Greek script is unambiguous for Supertonic v3.
    if (greekRatio >= GREEK_THRESHOLD)
        return 'el-GR';
    // Cyrillic: distinguish Bulgarian/Ukrainian where possible; default to Russian.
    if (cyrillicRatio >= CYRILLIC_THRESHOLD)
        return detectCyrillicLanguage(sample);
    // Arabic: Arabic script
    if (arabicRatio >= ARABIC_THRESHOLD)
        return 'ar-SA';
    // Hindi: Devanagari script
    if (devanagariRatio >= DEVANAGARI_THRESHOLD)
        return 'hi-IN';
    // Thai: Thai script
    if (thaiRatio >= THAI_THRESHOLD)
        return 'th-TH';
    // Latin-script languages: run secondary detection
    if (latinRatio >= LATIN_THRESHOLD)
        return detectLatinLanguage(sample, total);
    return undefined;
}
//# sourceMappingURL=LanguageDetector.js.map