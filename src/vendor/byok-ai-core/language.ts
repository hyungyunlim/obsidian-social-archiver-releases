/**
 * Internal copy of packages/selection-ai-core/src/language.ts (this package has
 * no dependencies, and re-exporting it would clash with cli-runtime's vendored
 * selection-ai-core). Not part of the public API.
 *
 * Language rules for selection prompts. Copied from the mobile on-device
 * builder (`appleOnDevicePrompts.ts`) and learning-core's script detector so
 * this package has no dependencies; the wording must stay absolute, because
 * the 3B on-device model ignores a soft "match the content" line.
 */

const LANGUAGE_NAMES: Record<string, string> = {
  ko: 'Korean',
  en: 'English',
  ja: 'Japanese',
  zh: 'Chinese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  it: 'Italian',
  vi: 'Vietnamese',
  ru: 'Russian',
  ar: 'Arabic',
  hi: 'Hindi',
};

const SCRIPT_DETECTION_RULES = [
  { languageName: 'Korean', pattern: /[ᄀ-ᇿ㄰-㆏가-힣]/g },
  { languageName: 'Japanese', pattern: /[぀-ヿ]/g },
  { languageName: 'Chinese', pattern: /[㐀-䶿一-鿿]/g },
  { languageName: 'Thai', pattern: /[฀-๿]/g },
  { languageName: 'Arabic', pattern: /[؀-ۿ]/g },
  { languageName: 'Hindi', pattern: /[ऀ-ॿ]/g },
  { languageName: 'Russian', pattern: /[Ѐ-ӿ]/g },
] as const;

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

/** The language a non-Latin script names, or null (Latin text, too little text). */
export function detectScriptLanguageName(value: string): string | null {
  const sample = value.slice(0, 30_000);
  const latinCount = countMatches(sample, /[A-Za-z]/g);
  const strongest = SCRIPT_DETECTION_RULES
    .map((rule) => ({ languageName: rule.languageName, count: countMatches(sample, rule.pattern) }))
    .sort((a, b) => b.count - a.count)[0];
  if (!strongest || strongest.count < 6) return null;
  if (latinCount > 0 && strongest.count < latinCount * 0.25) return null;
  return strongest.languageName;
}

/** 'en-US' and 'en' both name English. */
export function languageName(code: string | undefined): string | undefined {
  const primary = code?.toLowerCase().split(/[-_]/)[0];
  return primary ? LANGUAGE_NAMES[primary] : undefined;
}

export function languageInstruction(outputLanguage: string | undefined, content?: string): string {
  const named = languageName(outputLanguage);
  if (named) {
    return `IMPORTANT: Write the answer in ${named}. Write in ${named} even if the content is in a different language.`;
  }

  const detected = content ? detectScriptLanguageName(content) : null;
  if (detected) {
    return `IMPORTANT: Write the answer in ${detected}, the language of the content. Do not answer in any other language.`;
  }

  return 'IMPORTANT: Write the answer in the same language as the content. Do not answer in any other language.';
}

/** Verbatim from the desktop comment builder, so summary length matches across targets. */
export function summaryLengthGuideline(contentLength: number): string {
  if (contentLength < 500) return '1-2 sentence';
  if (contentLength < 2000) return '2-3 sentence';
  if (contentLength < 5000) return '3-5 sentence';
  return '5-8 sentence';
}
