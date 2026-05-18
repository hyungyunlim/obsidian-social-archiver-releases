export interface AIActionLanguageOption {
  code: string;
  shortLabel: string;
  menuLabel: string;
}

export interface MissingAIActionLanguageOptions {
  primary: AIActionLanguageOption[];
  more: AIActionLanguageOption[];
}

export const PRIMARY_TRANSLATION_LANGUAGE_OPTIONS: AIActionLanguageOption[] = [
  { code: 'ko', shortLabel: 'KO', menuLabel: 'Korean' },
  { code: 'en', shortLabel: 'EN', menuLabel: 'English' },
  { code: 'ja', shortLabel: 'JA', menuLabel: 'Japanese' },
];

export const MORE_TRANSLATION_LANGUAGE_OPTIONS: AIActionLanguageOption[] = [
  { code: 'zh', shortLabel: 'ZH', menuLabel: 'Chinese' },
  { code: 'es', shortLabel: 'ES', menuLabel: 'Spanish' },
  { code: 'fr', shortLabel: 'FR', menuLabel: 'French' },
  { code: 'de', shortLabel: 'DE', menuLabel: 'German' },
  { code: 'pt', shortLabel: 'PT', menuLabel: 'Portuguese' },
  { code: 'it', shortLabel: 'IT', menuLabel: 'Italian' },
  { code: 'vi', shortLabel: 'VI', menuLabel: 'Vietnamese' },
  { code: 'th', shortLabel: 'TH', menuLabel: 'Thai' },
  { code: 'id', shortLabel: 'ID', menuLabel: 'Indonesian' },
  { code: 'ru', shortLabel: 'RU', menuLabel: 'Russian' },
  { code: 'ar', shortLabel: 'AR', menuLabel: 'Arabic' },
  { code: 'hi', shortLabel: 'HI', menuLabel: 'Hindi' },
];

export const TRANSLATION_LANGUAGE_OPTIONS: AIActionLanguageOption[] = [
  ...PRIMARY_TRANSLATION_LANGUAGE_OPTIONS,
  ...MORE_TRANSLATION_LANGUAGE_OPTIONS,
];

const SUPPORTED_TRANSLATION_LANGUAGE_CODES = new Set(
  TRANSLATION_LANGUAGE_OPTIONS.map((option) => option.code),
);

export function isSupportedAIActionLanguageCode(code: string | undefined): boolean {
  return Boolean(code && SUPPORTED_TRANSLATION_LANGUAGE_CODES.has(code));
}

function normalizeLanguageCode(code: string | null | undefined): string | null {
  const normalized = code?.trim().toLowerCase().split(/[-_]/)[0];
  return normalized || null;
}

export function getMissingTranslationLanguageOptions(
  existingLanguageCodes: Iterable<string | null | undefined>,
): MissingAIActionLanguageOptions {
  const existing = new Set<string>();
  for (const code of existingLanguageCodes) {
    const normalized = normalizeLanguageCode(code);
    if (normalized) existing.add(normalized);
  }

  return {
    primary: PRIMARY_TRANSLATION_LANGUAGE_OPTIONS.filter((option) => !existing.has(option.code)),
    more: MORE_TRANSLATION_LANGUAGE_OPTIONS.filter((option) => !existing.has(option.code)),
  };
}
