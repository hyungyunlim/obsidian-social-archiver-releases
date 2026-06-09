import { describe, it, expect } from 'vitest';
import { SentinelMediaRegionManager } from '@/plugin/realtime/SentinelMediaRegionManager';

/**
 * Ship 3, item 3: manage plugin-owned media regions
 * `<!-- sa:media:start id=ARCHIVEID -->` … `<!-- sa:media:end -->`.
 * replaceRegion must touch ONLY the body inside the region; missing region
 * returns null so the caller can append a review-needed callout.
 */
const ID = 'arch-123';

function buildNote(body: string): string {
  return [
    '# Title',
    '',
    'Some hand-written intro.',
    '',
    SentinelMediaRegionManager.wrap(ID, body),
    '',
    '## Notes',
    'My personal notes.',
  ].join('\n');
}

describe('SentinelMediaRegionManager.wrap', () => {
  it('wraps a body with start/end markers keyed by archive id', () => {
    const out = SentinelMediaRegionManager.wrap(ID, '![](x.png)');
    expect(out).toBe(
      `<!-- sa:media:start id=${ID} -->\n![](x.png)\n<!-- sa:media:end -->`,
    );
  });

  it('produces an empty (body-less) region for an empty body', () => {
    const out = SentinelMediaRegionManager.wrap(ID, '');
    expect(out).toBe(`<!-- sa:media:start id=${ID} -->\n<!-- sa:media:end -->`);
  });
});

describe('SentinelMediaRegionManager.findRegion', () => {
  it('finds the region and extracts its body', () => {
    const note = buildNote('![](a.png)\n\n![](b.png)');
    const region = SentinelMediaRegionManager.findRegion(note, ID);
    expect(region).not.toBeNull();
    expect(region?.body).toBe('![](a.png)\n\n![](b.png)');
    expect(note.slice(region!.start, region!.end)).toBe(region?.full);
  });

  it('returns null when no region for the id exists', () => {
    const note = buildNote('![](a.png)');
    expect(SentinelMediaRegionManager.findRegion(note, 'other-id')).toBeNull();
  });

  it('returns null when there is no region at all', () => {
    expect(SentinelMediaRegionManager.findRegion('# Just a note', ID)).toBeNull();
  });

  it('re-scans on each call (tolerates hand-edited surrounding content)', () => {
    const note = buildNote('![](a.png)');
    const edited = note.replace('My personal notes.', 'Edited notes!\nExtra line.');
    const region = SentinelMediaRegionManager.findRegion(edited, ID);
    expect(region?.body).toBe('![](a.png)');
  });
});

describe('SentinelMediaRegionManager.replaceRegion', () => {
  it('replaces ONLY the body inside the region', () => {
    const note = buildNote('![](old.png)');
    const updated = SentinelMediaRegionManager.replaceRegion(note, ID, '![](new.png)');
    expect(updated).not.toBeNull();
    expect(updated).toContain('![](new.png)');
    expect(updated).not.toContain('![](old.png)');
    // Surrounding content preserved.
    expect(updated).toContain('Some hand-written intro.');
    expect(updated).toContain('My personal notes.');
    expect(updated).toContain('# Title');
  });

  it('keeps the markers intact after replacement', () => {
    const note = buildNote('![](old.png)');
    const updated = SentinelMediaRegionManager.replaceRegion(note, ID, '![](new.png)')!;
    expect(updated).toContain(`<!-- sa:media:start id=${ID} -->`);
    expect(updated).toContain('<!-- sa:media:end -->');
    // Exactly one region remains.
    const matches = updated.match(SentinelMediaRegionManager.anyRegionPattern());
    expect(matches).toHaveLength(1);
  });

  it('returns null when the region is missing (no structural rewrite)', () => {
    const note = '# Note with no region';
    expect(SentinelMediaRegionManager.replaceRegion(note, ID, '![](x.png)')).toBeNull();
  });

  it('does not affect a region keyed by a different id', () => {
    const other = SentinelMediaRegionManager.wrap('other', '![](other.png)');
    const note = `${buildNote('![](mine.png)')}\n\n${other}`;
    const updated = SentinelMediaRegionManager.replaceRegion(note, ID, '![](mine2.png)')!;
    expect(updated).toContain('![](other.png)'); // untouched
    expect(updated).toContain('![](mine2.png)');
    expect(updated).not.toContain('![](mine.png)');
  });
});

describe('SentinelMediaRegionManager.hasRegion', () => {
  it('reflects findRegion presence', () => {
    const note = buildNote('![](a.png)');
    expect(SentinelMediaRegionManager.hasRegion(note, ID)).toBe(true);
    expect(SentinelMediaRegionManager.hasRegion(note, 'nope')).toBe(false);
  });
});
