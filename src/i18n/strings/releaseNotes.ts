/**
 * "What's new" modal shown after a plugin update.
 * Key prefix "rn.". Every entry is { en, ko }.
 */
import type { LocaleText } from '../index';

export const releaseNotesStrings = {
  'rn.eyebrow': { en: 'What’s new', ko: '새로운 기능' },
  'rn.position': { en: '{index} / {total}', ko: '{index} / {total}' },
  'rn.important': { en: 'Important', ko: '중요' },
  'rn.releases': { en: 'Releases', ko: '릴리스' },
  'rn.previous': { en: 'Previous update', ko: '이전 업데이트' },
  'rn.next': { en: 'Next update', ko: '다음 업데이트' },
  'rn.openHub': { en: 'View in release notes', ko: '릴리스 노트에서 보기' },
  'rn.done': { en: 'Got it', ko: '확인' },
} satisfies Record<string, LocaleText>;
