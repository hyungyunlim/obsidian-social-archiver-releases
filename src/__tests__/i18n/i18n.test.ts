import { afterEach, describe, expect, it } from 'vitest';
import { t, __setLanguageForTests } from '../../i18n';
import { settingTabStrings } from '../../i18n/strings/settingTab';
import { authStrings } from '../../i18n/strings/auth';
import { syncTabStrings } from '../../i18n/strings/syncTab';
import { crossPostStrings } from '../../i18n/strings/crossPost';
import { dangerZoneStrings } from '../../i18n/strings/dangerZone';
import { newsletterStrings } from '../../i18n/strings/newsletter';

const ALL_MODULES = {
  settingTabStrings,
  authStrings,
  syncTabStrings,
  crossPostStrings,
  dangerZoneStrings,
  newsletterStrings,
};

describe('settings i18n', () => {
  afterEach(() => {
    __setLanguageForTests(null);
  });

  it('serves English by default and Korean when the UI language is ko', () => {
    const [key, entry] = Object.entries(syncTabStrings)[0]!;

    __setLanguageForTests('en');
    expect(t(key as never)).toBe(entry.en);

    __setLanguageForTests('ko');
    expect(t(key as never)).toBe(entry.ko ?? entry.en);
  });

  it('interpolates {name} placeholders and leaves unknown ones verbatim', () => {
    const withPlaceholder = Object.entries(ALL_MODULES)
      .flatMap(([, mod]) => Object.entries(mod))
      .find(([, entry]) => /\{\w+\}/.test(entry.en));
    expect(withPlaceholder).toBeDefined();

    const [key, entry] = withPlaceholder!;
    const name = /\{(\w+)\}/.exec(entry.en)![1]!;

    __setLanguageForTests('en');
    expect(t(key as never, { [name]: 'X' })).toBe(entry.en.replaceAll(`{${name}}`, 'X'));
    expect(t(key as never)).toBe(entry.en);
  });

  it('every entry has copy in at least one language, and ko invents no placeholders', () => {
    for (const [modName, mod] of Object.entries(ALL_MODULES)) {
      for (const [key, entry] of Object.entries(mod)) {
        // Word-order splits (.prefix/.suffix around an inline element) leave
        // one side legitimately empty per language — but never both.
        expect(entry.en.length + (entry.ko ?? '').length, `${modName}:${key} empty entry`).toBeGreaterThan(0);
        expect(entry.ko, `${modName}:${key} ko missing`).toBeDefined();
        // ko may legitimately DROP an en placeholder (e.g. English plural-word
        // helpers like {duplicateWord} have no Korean counterpart — counting
        // uses "N건"), but every ko placeholder must exist in en, else it is a
        // typo that renders verbatim.
        const enPlaceholders = new Set(
          [...entry.en.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
        );
        for (const [, name] of (entry.ko ?? '').matchAll(/\{(\w+)\}/g)) {
          expect(enPlaceholders.has(name!), `${modName}:${key} unknown ko placeholder {${name}}`).toBe(true);
        }
      }
    }
  });

  it('key prefixes are disjoint across modules (no merge collisions)', () => {
    const allKeys = Object.values(ALL_MODULES).flatMap((mod) => Object.keys(mod));
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });
});
