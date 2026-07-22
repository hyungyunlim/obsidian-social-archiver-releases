import { describe, expect, it } from 'vitest';
import {
  buildManagedArchiveTag,
  getManagedArchiveTagCandidates,
  normalizeArchiveTagRoot,
  rememberManagedArchiveTagRule,
} from '@/utils/archive-tag-rules';

describe('archive tag rules', () => {
  it('normalizes tag roots and generates each supported structure', () => {
    expect(normalizeArchiveTagRoot(' #My Archive / Saved ')).toBe('My-Archive/Saved');
    const source = { platform: 'instagram', published: '2025-07-03 12:00' };
    expect(buildManagedArchiveTag({ tagRoot: '#archive', tagOrganization: 'flat' }, source))
      .toBe('archive');
    expect(buildManagedArchiveTag({ tagRoot: '#archive', tagOrganization: 'platform-only' }, source))
      .toBe('archive/instagram');
    expect(buildManagedArchiveTag({ tagRoot: '#archive', tagOrganization: 'platform-year-month' }, source))
      .toBe('archive/instagram/2025/07');
  });

  it('does not invent a year/month tag when the published date is invalid', () => {
    expect(buildManagedArchiveTag(
      { tagRoot: 'archive', tagOrganization: 'platform-year-month' },
      { platform: 'x', published: 'not-a-date' },
      { strictYearMonth: true },
    )).toBeNull();
  });

  it('enumerates exact candidates for current and historical roots', () => {
    const candidates = getManagedArchiveTagCandidates(
      { tagRoot: 'new-root', tagOrganization: 'flat' },
      [{ tagRoot: 'old-root', tagOrganization: 'platform-only' }],
      { platform: 'x', published: '2024-03-15' },
    );

    expect(candidates).toContain('new-root');
    expect(candidates).toContain('new-root/x');
    expect(candidates).toContain('new-root/x/2024/03');
    expect(candidates).toContain('old-root/x/2024/03');
    expect(candidates).not.toContain('old-root/manual');
  });

  it('deduplicates remembered rules and keeps the most recent first', () => {
    const history = rememberManagedArchiveTagRule(
      [{ tagRoot: 'Older', tagOrganization: 'flat' }],
      { tagRoot: '#OLDER', tagOrganization: 'flat' },
    );
    expect(history).toEqual([{ tagRoot: 'OLDER', tagOrganization: 'flat' }]);
  });
});
