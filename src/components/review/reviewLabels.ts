/**
 * Words for a review card: the byline and a post's name. The server counts
 * the saved age; this words it (English singulars get their own keys).
 */
import { t, type TranslationKey } from '../../i18n';
import type { ReviewArchiveLabel, ReviewCardUnit, SavedAgeUnit } from '../../services/learning/LearningReviewClient';

const AGE_KEYS: Record<SavedAgeUnit, TranslationKey> = {
  today: 'rv.age.today',
  yesterday: 'rv.age.yesterday',
  days: 'rv.age.days',
  weeks: 'rv.age.weeks',
  months: 'rv.age.months',
  years: 'rv.age.years',
};

const AGE_ONE_KEYS: Partial<Record<SavedAgeUnit, TranslationKey>> = {
  weeks: 'rv.age.weeks.one',
  months: 'rv.age.months.one',
  years: 'rv.age.years.one',
};

export function savedAgeLabel(label: ReviewArchiveLabel | undefined): string | null {
  const age = label?.savedAge;
  if (!age || !(age.unit in AGE_KEYS)) return null;
  const key = (age.count === 1 ? AGE_ONE_KEYS[age.unit] : undefined) ?? AGE_KEYS[age.unit];
  return t(key, { count: age.count });
}

/** "Author · Saved 8 months ago", with whichever half is known. */
export function bylineOf(label: ReviewArchiveLabel | undefined): string {
  return [label?.authorName?.trim(), savedAgeLabel(label)].filter(Boolean).join(' · ');
}

const NAME_MAX = 70;

/** A post's title, else its own opening line — never blank in a list. */
export function nameOf(unit: ReviewCardUnit, label: ReviewArchiveLabel | undefined): string {
  const title = label?.title?.trim();
  if (title) return title;
  const firstLine = unit.text.split('\n').find((line) => line.trim() !== '')?.trim() ?? '';
  if (!firstLine) return t('rv.untitled');
  return firstLine.length > NAME_MAX ? `${firstLine.slice(0, NAME_MAX - 1)}…` : firstLine;
}
