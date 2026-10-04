import { describe, expect, it } from 'vitest';
import { FilterSortManager } from '@/components/timeline/filters/FilterSortManager';
import type { PostData } from '@/types/post';
import type { PostIndexEntry } from '@/services/PostIndexService';

/**
 * An open collection (prd-collections-obsidian-plugin O5) narrows the feed to
 * its notes and, like the desktop app (D2-10), ignores the tab and the quick
 * filters while search, platform, tag and date still narrow it.
 */

function post(filePath: string, overrides: Partial<PostData> = {}): PostData {
  return {
    platform: 'x',
    filePath,
    title: filePath,
    authorName: 'Author',
    authorUrl: 'https://example.com',
    publishedDate: new Date('2026-10-01T00:00:00Z'),
    archivedDate: new Date('2026-10-01T00:00:00Z'),
    metadata: { timestamp: new Date('2026-10-01T00:00:00Z') },
    ...overrides,
  } as PostData;
}

function entry(filePath: string, overrides: Partial<PostIndexEntry> = {}): PostIndexEntry {
  return {
    id: filePath,
    platform: 'x',
    filePath,
    fileModifiedTime: 0,
    authorName: 'Author',
    publishedDate: Date.parse('2026-10-01T00:00:00Z'),
    archivedDate: Date.parse('2026-10-01T00:00:00Z'),
    tags: [],
    hashtags: [],
    like: false,
    archive: false,
    isLocalOnly: false,
    subscribed: false,
    searchText: '',
    url: `https://example.com/${filePath}`,
    mediaCount: 0,
    commentCount: 0,
    metadataTimestamp: Date.parse('2026-10-01T00:00:00Z'),
    ...overrides,
  } as PostIndexEntry;
}

describe('FilterSortManager — open collection', () => {
  it('keeps only the collection’s notes, archived ones included, on both paths', () => {
    const manager = new FilterSortManager({ activeTab: 'inbox', likedOnly: true });
    manager.updateFilter({ collectionFilePaths: new Set(['in.md', 'archived.md']) });

    const posts = [post('in.md'), post('archived.md', { archive: true }), post('out.md')];
    expect(manager.applyFiltersAndSort(posts).map((p) => p.filePath).sort()).toEqual(['archived.md', 'in.md']);

    const entries = [entry('in.md'), entry('archived.md', { archive: true }), entry('out.md')];
    expect(manager.applyFiltersAndSortIndex(entries).map((e) => e.filePath).sort()).toEqual(['archived.md', 'in.md']);
  });

  it('still narrows by tag inside the collection', () => {
    const manager = new FilterSortManager({ activeTab: 'all', selectedTags: new Set(['travel']) });
    manager.updateFilter({ collectionFilePaths: new Set(['a.md', 'b.md']) });
    const entries = [entry('a.md', { tags: ['travel'] }), entry('b.md', { tags: [] })];
    expect(manager.applyFiltersAndSortIndex(entries).map((e) => e.filePath)).toEqual(['a.md']);
  });

  it('applies the tab and quick filters again after leaving the collection', () => {
    const manager = new FilterSortManager({ activeTab: 'inbox' });
    manager.updateFilter({ collectionFilePaths: new Set(['archived.md']) });
    manager.updateFilter({ collectionFilePaths: null });
    expect(manager.applyFiltersAndSortIndex([entry('archived.md', { archive: true })])).toEqual([]);
  });

  it('does not count as an active filter (it has its own bar)', () => {
    const manager = new FilterSortManager({ activeTab: 'inbox' });
    manager.updateFilter({ collectionFilePaths: new Set(['a.md']) });
    expect(manager.hasActiveFilters()).toBe(false);
  });
});
