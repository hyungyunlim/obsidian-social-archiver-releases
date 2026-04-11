import { describe, expect, it } from 'vitest';
import {
  getBulkSelectionArchivableFilePaths,
  getBulkSelectionSelectableFilePaths,
  getBulkSelectionSummary,
  normalizeBulkSelection,
  type BulkSelectablePost,
} from './bulkSelection';

describe('bulkSelection', () => {
  const posts: BulkSelectablePost[] = [
    { filePath: 'Social Archives/a.md', archive: false },
    { filePath: 'Social Archives/b.md', archive: true },
    { filePath: 'Social Archives/c.md', archive: false },
    { filePath: undefined, archive: false },
  ];

  it('returns all posts with file paths as selectable', () => {
    expect(getBulkSelectionSelectableFilePaths(posts)).toEqual([
      'Social Archives/a.md',
      'Social Archives/b.md',
      'Social Archives/c.md',
    ]);
  });

  it('returns only unarchived posts with file paths as archivable', () => {
    expect(getBulkSelectionArchivableFilePaths(posts)).toEqual([
      'Social Archives/a.md',
      'Social Archives/c.md',
    ]);
  });

  it('drops stale selections and keeps archived ones selectable', () => {
    const normalized = normalizeBulkSelection(posts, [
      'Social Archives/a.md',
      'Social Archives/b.md',
      'Social Archives/missing.md',
    ]);

    expect(Array.from(normalized)).toEqual([
      'Social Archives/a.md',
      'Social Archives/b.md',
    ]);
  });

  it('summarizes selected and selectable counts', () => {
    expect(
      getBulkSelectionSummary(posts, [
        'Social Archives/a.md',
        'Social Archives/b.md',
        'Social Archives/c.md',
      ]),
    ).toEqual({
      selectableCount: 3,
      selectedCount: 3,
      allSelected: true,
    });
  });
});
