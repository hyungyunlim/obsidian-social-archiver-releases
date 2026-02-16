/**
 * Language constants for transcript translation
 *
 * Single source of truth for ISO code ↔ English display name mapping.
 * Used by TranscriptSectionManager, PostDataParser, TranscriptRenderer, etc.
 */

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
 * - `## Transcript` → original transcript (no capture group)
 * - `## Transcript (Korean)` → translated transcript (captures "Korean")
 */
export const TRANSCRIPT_HEADER_REGEX = /^## Transcript(?:\s*\(([^)]+)\))?\s*$/gm;
