import { describe, it, expect } from 'vitest';
import { FilterSortManager } from '@/components/timeline/filters/FilterSortManager';
import type { PostData } from '@/types/post';
import type { PostIndexEntry } from '@/services/PostIndexService';

function makePost(filePath: string, productSource?: string): PostData {
  return {
    platform: 'web',
    filePath,
    title: 'Test Post',
    authorName: 'Test Author',
    authorUrl: 'https://example.com',
    publishedDate: new Date(),
    archivedDate: new Date(),
    metadata: { timestamp: new Date(), ...(productSource ? { productSource } : {}) },
  } as PostData;
}

function makeEntry(filePath: string, productSource?: string): PostIndexEntry {
  return {
    id: filePath,
    platform: 'web',
    filePath,
    fileModifiedTime: 0,
    authorName: 'Author',
    publishedDate: 0,
    archivedDate: 0,
    tags: [],
    hashtags: [],
    like: false,
    archive: false,
    isLocalOnly: false,
    subscribed: false,
    productSource,
    searchText: '',
    url: `https://example.com/${filePath}`,
    mediaCount: 0,
    commentCount: 0,
    metadataTimestamp: 0,
  };
}

/**
 * Shopping is a filter, not a screen, so these two paths ARE the feature. They
 * are asserted together on purpose: the timeline renders from the index and the
 * gallery from PostData, and a card that appears in one but not the other reads
 * as data loss rather than as a filter.
 */
describe('FilterSortManager — Shopping', () => {
  const paths = ['gym.md', 'ohora.md', 'plain.md'];

  const posts = [
    makePost('gym.md', 'gymshark.com'),
    makePost('ohora.md', 'ohora.kr'),
    makePost('plain.md'),
  ];
  const entries = [
    makeEntry('gym.md', 'gymshark.com'),
    makeEntry('ohora.md', 'ohora.kr'),
    makeEntry('plain.md'),
  ];

  it('is inert while off', () => {
    const manager = new FilterSortManager({ activeTab: 'all' });
    expect(manager.applyFiltersAndSort(posts).map(p => p.filePath).sort()).toEqual([...paths].sort());
    expect(manager.applyFiltersAndSortIndex(entries).map(e => e.filePath).sort()).toEqual([...paths].sort());
  });

  it('keeps only commerce archives when on', () => {
    const manager = new FilterSortManager({ activeTab: 'all', productsOnly: true });
    expect(manager.applyFiltersAndSort(posts).map(p => p.filePath).sort()).toEqual(['gym.md', 'ohora.md']);
    expect(manager.applyFiltersAndSortIndex(entries).map(e => e.filePath).sort()).toEqual(['gym.md', 'ohora.md']);
  });

  it('narrows to one store', () => {
    const manager = new FilterSortManager({
      activeTab: 'all',
      productsOnly: true,
      productSource: 'gymshark.com',
    });
    expect(manager.applyFiltersAndSort(posts).map(p => p.filePath)).toEqual(['gym.md']);
    expect(manager.applyFiltersAndSortIndex(entries).map(e => e.filePath)).toEqual(['gym.md']);
  });

  it('ignores a store selection while Shopping is off', () => {
    // The store chips only exist inside Shopping, so a selection that survived
    // the toggle must not silently shorten the ordinary timeline.
    const manager = new FilterSortManager({
      activeTab: 'all',
      productsOnly: false,
      productSource: 'gymshark.com',
    });
    expect(manager.applyFiltersAndSort(posts)).toHaveLength(3);
    expect(manager.applyFiltersAndSortIndex(entries)).toHaveLength(3);
  });

  it('composes with the other filters rather than replacing them', () => {
    const manager = new FilterSortManager({ activeTab: 'all', productsOnly: true });
    manager.updateFilter({ likedOnly: true });
    const liked = [makePost('gym.md', 'gymshark.com')];
    liked[0]!.like = true;
    expect(manager.applyFiltersAndSort([...liked, ...posts.slice(1)]).map(p => p.filePath)).toEqual(['gym.md']);
  });

  it('does not light the filter button — Shopping shows its own state', () => {
    const manager = new FilterSortManager({ activeTab: 'inbox', productsOnly: true, productSource: 'gymshark.com' });
    expect(manager.hasActiveFilters()).toBe(false);
  });
});
