import { describe, expect, it } from 'vitest';
import {
  buildManagedArchiveTag,
  getManagedArchiveTagCandidates,
  isManagedArchiveTagName,
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

  it('recognizes managed tags from every organization mode', () => {
    const rules = [{ tagRoot: 'veille', tagOrganization: 'hierarchical' as const }];

    // Whatever buildManagedArchiveTag emits must be recognized.
    expect(isManagedArchiveTagName('veille/linkedin/2026/06', rules)).toBe(true);
    expect(isManagedArchiveTagName('veille/x', rules)).toBe(true);
    expect(isManagedArchiveTagName('#Veille', rules)).toBe(true);

    // A user tag that merely starts with the same letters is not managed.
    expect(isManagedArchiveTagName('veilleur', rules)).toBe(false);
    expect(isManagedArchiveTagName('drone', rules)).toBe(false);
  });

  it('recognizes tags from a rule the user has since replaced', () => {
    const rules = [
      { tagRoot: 'archive', tagOrganization: 'flat' as const },
      { tagRoot: 'veille', tagOrganization: 'hierarchical' as const },
    ];

    expect(isManagedArchiveTagName('veille/linkedin/2026/06', rules)).toBe(true);
    expect(isManagedArchiveTagName('archive', rules)).toBe(true);
  });

  it('treats an empty root as matching nothing', () => {
    expect(isManagedArchiveTagName('drone', [{ tagRoot: '', tagOrganization: 'flat' }])).toBe(false);
    expect(isManagedArchiveTagName('', [{ tagRoot: 'veille', tagOrganization: 'flat' }])).toBe(false);
  });

  it('deduplicates remembered rules and keeps the most recent first', () => {
    const history = rememberManagedArchiveTagRule(
      [{ tagRoot: 'Older', tagOrganization: 'flat' }],
      { tagRoot: '#OLDER', tagOrganization: 'flat' },
    );
    expect(history).toEqual([{ tagRoot: 'OLDER', tagOrganization: 'flat' }]);
  });
});
