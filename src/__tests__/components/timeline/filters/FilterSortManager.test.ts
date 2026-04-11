import { describe, it, expect } from 'vitest';
import { FilterSortManager } from '@/components/timeline/filters/FilterSortManager';
import type { PostData } from '@/types/post';

function makePost(overrides: Partial<PostData> = {}): PostData {
  return {
    platform: 'x',
    filePath: `test/${Math.random()}.md`,
    title: 'Test Post',
    authorName: 'Test Author',
    authorUrl: 'https://example.com',
    publishedDate: new Date(),
    archivedDate: new Date(),
    metadata: { timestamp: new Date() },
    ...overrides,
  } as PostData;
}

describe('FilterSortManager', () => {
  describe('activeTab filtering', () => {
    const inboxPost = makePost({ archive: undefined as unknown as boolean, filePath: 'inbox.md' });
    const archivedPost = makePost({ archive: true, filePath: 'archived.md' });
    const posts = [inboxPost, archivedPost];

    it('inbox tab shows only unarchived posts', () => {
      const manager = new FilterSortManager({ activeTab: 'inbox' });
      const result = manager.applyFiltersAndSort(posts);
      expect(result.map(p => p.filePath)).toEqual(['inbox.md']);
    });

    it('archive tab shows only archived posts', () => {
      const manager = new FilterSortManager({ activeTab: 'archive' });
      const result = manager.applyFiltersAndSort(posts);
      expect(result.map(p => p.filePath)).toEqual(['archived.md']);
    });

    it('all tab shows every post', () => {
      const manager = new FilterSortManager({ activeTab: 'all' });
      const result = manager.applyFiltersAndSort(posts);
      expect(result).toHaveLength(2);
    });

    it('defaults to inbox when no activeTab specified', () => {
      const manager = new FilterSortManager();
      const result = manager.applyFiltersAndSort(posts);
      expect(result.map(p => p.filePath)).toEqual(['inbox.md']);
    });
  });

  describe('normalizeArchiveState via updateFilter', () => {
    it('setting activeTab derives includeArchived', () => {
      const manager = new FilterSortManager({ activeTab: 'inbox' });

      manager.updateFilter({ activeTab: 'archive' });
      const state1 = manager.getFilterState();
      expect(state1.activeTab).toBe('archive');
      expect(state1.includeArchived).toBe(true);

      manager.updateFilter({ activeTab: 'all' });
      const state2 = manager.getFilterState();
      expect(state2.activeTab).toBe('all');
      expect(state2.includeArchived).toBe(true);

      manager.updateFilter({ activeTab: 'inbox' });
      const state3 = manager.getFilterState();
      expect(state3.activeTab).toBe('inbox');
      expect(state3.includeArchived).toBe(false);
    });

    it('setting includeArchived derives activeTab', () => {
      const manager = new FilterSortManager({ activeTab: 'inbox' });

      manager.updateFilter({ includeArchived: true });
      const state1 = manager.getFilterState();
      expect(state1.activeTab).toBe('all');
      expect(state1.includeArchived).toBe(true);

      manager.updateFilter({ includeArchived: false });
      const state2 = manager.getFilterState();
      expect(state2.activeTab).toBe('inbox');
      expect(state2.includeArchived).toBe(false);
    });
  });

  describe('buildFilterState normalization', () => {
    it('normalizes includeArchived-only init to correct activeTab', () => {
      const manager = new FilterSortManager({ includeArchived: true });
      const state = manager.getFilterState();
      expect(state.activeTab).toBe('all');
      expect(state.includeArchived).toBe(true);
    });
  });

  describe('hasActiveFilters', () => {
    it('returns false for inbox (default)', () => {
      const manager = new FilterSortManager({ activeTab: 'inbox' });
      expect(manager.hasActiveFilters()).toBe(false);
    });

    it('returns true for archive tab', () => {
      const manager = new FilterSortManager({ activeTab: 'archive' });
      expect(manager.hasActiveFilters()).toBe(true);
    });

    it('returns true for all tab', () => {
      const manager = new FilterSortManager({ activeTab: 'all' });
      expect(manager.hasActiveFilters()).toBe(true);
    });
  });
});
