import type {
  ArchiveOrganizationMode,
  ManagedArchiveTagRule,
} from '@/types/settings';

export interface ArchiveTagSource {
  platform: unknown;
  published: unknown;
}

export function normalizeArchiveTagSegment(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/^#+/, '')
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, '-');
}

export function normalizeArchiveTagRoot(value: unknown): string {
  return String(value ?? '')
    .split('/')
    .map(normalizeArchiveTagSegment)
    .filter(Boolean)
    .join('/');
}

/**
 * True when a tag belongs to a managed archive-tag root.
 *
 * Every tag `buildManagedArchiveTag` emits is either the root itself (flat) or
 * sits under `root/`, so a prefix test covers all three organization modes
 * without needing the note's platform or date.
 *
 * Used to keep the plugin's own generated tags out of the user-facing tag
 * picker. They live in `tags` as an organizing scheme; offering them as
 * Social Archiver tags lets one get promoted into the cross-device tag system,
 * after which it is written onto every matching note and synced to mobile.
 *
 * @param name - A tag name discovered in frontmatter
 * @param rules - The current rule plus `archiveTagRuleHistory`
 */
export function isManagedArchiveTagName(name: string, rules: ManagedArchiveTagRule[]): boolean {
  const lower = String(name ?? '').trim().replace(/^#+/, '').toLowerCase();
  if (!lower) return false;

  return rules.some((rule) => {
    const root = normalizeArchiveTagRoot(rule.tagRoot).toLowerCase();
    if (!root) return false;
    return lower === root || lower.startsWith(`${root}/`);
  });
}

function getYearMonth(value: unknown): { year: string; month: string } | null {
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d{4})-(\d{2})/);
    if (match?.[1] && match[2]) {
      const month = Number(match[2]);
      if (month >= 1 && month <= 12) {
        return { year: match[1], month: match[2] };
      }
    }
  }

  const date = value instanceof Date ? value : new Date(value as string | number);
  if (Number.isNaN(date.getTime())) return null;
  return {
    year: String(date.getFullYear()),
    month: String(date.getMonth() + 1).padStart(2, '0'),
  };
}

export function buildManagedArchiveTag(
  rule: ManagedArchiveTagRule,
  source: ArchiveTagSource,
  options?: { strictYearMonth?: boolean },
): string | null {
  const root = normalizeArchiveTagRoot(rule.tagRoot);
  if (!root) return null;
  if (rule.tagOrganization === 'flat') return root;

  const platform = normalizeArchiveTagSegment(source.platform || 'unknown') || 'unknown';
  if (rule.tagOrganization === 'platform-only') {
    return `${root}/${platform}`;
  }

  const yearMonth = getYearMonth(source.published);
  if (!yearMonth) {
    return options?.strictYearMonth ? null : `${root}/${platform}`;
  }
  return `${root}/${platform}/${yearMonth.year}/${yearMonth.month}`;
}

export function getManagedArchiveTagCandidates(
  currentRule: ManagedArchiveTagRule,
  history: ManagedArchiveTagRule[],
  source: ArchiveTagSource,
): Set<string> {
  const roots = [currentRule, ...history]
    .map((rule) => normalizeArchiveTagRoot(rule.tagRoot))
    .filter(Boolean);
  const uniqueRoots = Array.from(new Set(roots.map((root) => root.toLowerCase())));
  const candidates = new Set<string>();
  const organizations: ArchiveOrganizationMode[] = [
    'flat',
    'platform-only',
    'platform-year-month',
  ];

  for (const root of uniqueRoots) {
    for (const tagOrganization of organizations) {
      const candidate = buildManagedArchiveTag(
        { tagRoot: root, tagOrganization },
        source,
      );
      if (candidate) candidates.add(candidate.toLowerCase());
    }
  }
  return candidates;
}

export function rememberManagedArchiveTagRule(
  history: ManagedArchiveTagRule[],
  rule: ManagedArchiveTagRule,
): ManagedArchiveTagRule[] {
  const root = normalizeArchiveTagRoot(rule.tagRoot);
  if (!root) return history.slice(0, 20);
  const key = `${root.toLowerCase()}\u0000${rule.tagOrganization}`;
  return [
    { tagRoot: root, tagOrganization: rule.tagOrganization },
    ...history.filter((item) => {
      const itemKey = `${normalizeArchiveTagRoot(item.tagRoot).toLowerCase()}\u0000${item.tagOrganization}`;
      return itemKey !== key;
    }),
  ].slice(0, 20);
}
