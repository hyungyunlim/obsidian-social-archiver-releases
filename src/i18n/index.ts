/**
 * Lightweight settings-surface i18n.
 *
 * Obsidian restarts when its UI language changes, so the language is read once
 * via the official `getLanguage()` API — no reactive signal, no i18next.
 * Every string lives next to its translation ({ en, ko }) in a per-surface
 * module under ./strings; missing translations fall back to English.
 *
 * Usage:
 *   t('sync.connect.name')
 *   t('danger.resetResult', { count: 3 })   // "{count}" placeholder
 *
 * Scope: settings UI only (Phase 1). Notices/modals outside settings and the
 * timeline UI are Phase 2.
 */

import { getLanguage } from 'obsidian';
import { settingTabStrings } from './strings/settingTab';
import { authStrings } from './strings/auth';
import { syncTabStrings } from './strings/syncTab';
import { crossPostStrings } from './strings/crossPost';
import { dangerZoneStrings } from './strings/dangerZone';
import { newsletterStrings } from './strings/newsletter';

/** One translatable string. `ja` can be added later without touching callers. */
export interface LocaleText {
  en: string;
  ko?: string;
}

const strings = {
  ...settingTabStrings,
  ...authStrings,
  ...syncTabStrings,
  ...crossPostStrings,
  ...dangerZoneStrings,
  ...newsletterStrings,
} satisfies Record<string, LocaleText>;

export type TranslationKey = keyof typeof strings;

let cachedLang: string | null = null;

function currentLang(): string {
  if (cachedLang === null) {
    try {
      // Guarded: the test mock/older Obsidian may not provide getLanguage.
      cachedLang = typeof getLanguage === 'function' ? getLanguage().toLowerCase() : 'en';
    } catch {
      cachedLang = 'en';
    }
  }
  return cachedLang;
}

/** Test seam: force a language (pass null to re-detect). */
export function __setLanguageForTests(lang: string | null): void {
  cachedLang = lang;
}

/**
 * Translate a key, with optional `{name}` placeholder interpolation.
 * Unknown placeholders are left verbatim.
 */
export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  const entry: LocaleText = strings[key];
  const text = currentLang().startsWith('ko') && entry.ko !== undefined ? entry.ko : entry.en;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}
