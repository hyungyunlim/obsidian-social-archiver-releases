/**
 * Language constants for transcript translation
 *
 * Single source of truth for ISO code ↔ English display name mapping.
 * Used by TranscriptSectionManager, PostDataParser, TranscriptRenderer, etc.
 */

import { t } from '../i18n';
import { detectLanguage } from '../services/tts/LanguageDetector';
import { TRANSCRIPT_UNKNOWN_LANGUAGE } from '../types/transcript-languages';

/** ISO 639-1 code → English language name (used in ## Transcript (Language) headers) */
export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  ko: 'Korean',
  ja: 'Japanese',
  zh: 'Chinese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  ru: 'Russian',
  ar: 'Arabic',
  hi: 'Hindi',
  it: 'Italian',
  nl: 'Dutch',
  pl: 'Polish',
  sv: 'Swedish',
  tr: 'Turkish',
  vi: 'Vietnamese',
  th: 'Thai',
  id: 'Indonesian',
  uk: 'Ukrainian',
};

/** Reverse lookup: English name → ISO code */
const NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(LANGUAGE_NAMES).map(([code, name]) => [name.toLowerCase(), code])
);

/**
 * Convert ISO language code to English display name.
 * Returns the code itself (uppercased) if not found.
 */
export function languageCodeToName(code: string): string {
  return LANGUAGE_NAMES[code.toLowerCase()] ?? code.toUpperCase();
}

/**
 * Convert English language name to ISO code.
 * Returns undefined if no match found.
 */
export function languageNameToCode(name: string): string | undefined {
  return NAME_TO_CODE[name.toLowerCase()];
}

/**
 * Regex to match transcript section headers.
 * Supports both:
 * - `## Transcript` / `## 📄 Transcript` → original transcript (no capture group)
 * - `## Transcript (Korean)` / `## 📄 Transcript (Korean)` → translated transcript (captures "Korean")
 */
export const TRANSCRIPT_HEADER_REGEX = /^##\s*(?:📄\s*)?Transcript(?:\s*\(([^)]+)\))?\s*$/gm;

/** Lower-case BCP-47 tag, or null when the input is not a language tag. Identical in every package (contract C0). */
export function normalizeTranscriptLanguage(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const tag = input.trim().replace(/_/g, '-').toLowerCase();
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(tag) ? tag : null;
}

/** Normalized language, or undefined for non-strings, non-tags and `'und'`. */
export function knownTranscriptLanguage(input: unknown): string | undefined {
  const tag = normalizeTranscriptLanguage(typeof input === 'string' ? input : null);
  return tag && tag !== TRANSCRIPT_UNKNOWN_LANGUAGE ? tag : undefined;
}

/**
 * English display name for a transcript language: known table → Intl → upper-case code.
 * `'und'` reads "Unknown language".
 */
export function transcriptLanguageDisplayName(code: string): string {
  const tag = normalizeTranscriptLanguage(code) ?? code.toLowerCase();
  if (tag === TRANSCRIPT_UNKNOWN_LANGUAGE) return t('tlang.unknownLanguage');
  const known = LANGUAGE_NAMES[tag];
  if (known) return known;
  try {
    if (typeof Intl.DisplayNames === 'function') {
      const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(tag);
      if (name && name.toLowerCase() !== tag) return name;
    }
  } catch {
    // Invalid tag for Intl — fall through.
  }
  return tag.toUpperCase();
}

/**
 * Header label for a caption section. `TRANSCRIPT_HEADER_REGEX` cannot hold
 * parentheses inside `(…)`, so "Serbian (Latin)" becomes "Serbian Latin".
 */
export function captionHeaderName(code: string): string {
  return transcriptLanguageDisplayName(code).replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
}

const SCRIPT_LANGUAGES = new Set(['ko', 'ja', 'zh']);

/**
 * Korean / Japanese / Chinese by script (T10 step 3), else undefined.
 * Feed it segment TEXT only — timestamp URLs are Latin and skew the ratio.
 */
export function detectScriptLanguage(text: string): 'ko' | 'ja' | 'zh' | undefined {
  const base = detectLanguage(text)?.split('-')[0]?.toLowerCase();
  return base && SCRIPT_LANGUAGES.has(base) ? (base as 'ko' | 'ja' | 'zh') : undefined;
}
