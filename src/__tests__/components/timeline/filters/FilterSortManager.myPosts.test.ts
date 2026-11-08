import { describe, it, expect } from 'vitest';
import { FilterSortManager } from '@/components/timeline/filters/FilterSortManager';
import { summarizePostAuthors } from '@/components/timeline/filters/PostAuthorChipBar';
import type { PostData } from '@/types/post';
import type { PostIndexEntry } from '@/services/PostIndexService';

/**
 * My Posts (prd-plugin-my-posts §6): composed posts only, narrowed to one
 * author (main or co-author). Both filter paths must agree.
 */

function makePost(filePath: string, overrides: Partial<PostData> = {}): PostData {
  return {
    platform: 'post',
    id: filePath,
    url: filePath,
    filePath,
    author: { name: 'Me', url: '' },
    content: { text: '' },
    media: [],
    metadata: { timestamp: new Date(0) },
    ...overrides,
  } as PostData;
}

function makeEntry(id: string, overrides: Partial<PostIndexEntry> = {}): PostIndexEntry {
  return {
    id,
    platform: 'post',
    filePath: `${id}.md`,
    fileModifiedTime: 0,
    authorName: 'Me',
    tags: [],
    hashtags: [],
    like: false,
    archive: false,
    isLocalOnly: false,
    subscribed: false,
    searchText: '',
    url: `${id}.md`,
    mediaCount: 0,
    commentCount: 0,
    metadataTimestamp: 0,
    ...overrides,
  };
}

describe('FilterSortManager — My Posts (PostData path)', () => {
  const posts = [
    makePost('mine.md', { isComposedPost: true }),
    makePost('coauthored.md', { isComposedPost: true, author: { name: 'Work', url: '' }, coAuthors: ['Me', 'Club'] }),
    makePost('work.md', { isComposedPost: true, author: { name: 'Work', url: '' } }),
    // platform post but not composed (meeting note / legacy) — never My Posts
    makePost('meeting.md', { contentType: 'meeting-note' }),
    makePost('tweet.md', { platform: 'x', author: { name: 'Me', url: '' } }),
  ];

  it('keeps only composed posts', () => {
    const manager = new FilterSortManager({ myPostsOnly: true });
    expect(manager.applyFiltersAndSort(posts).map((p) => p.filePath).sort())
      .toEqual(['coauthored.md', 'mine.md', 'work.md']);
  });

  it('narrows to an author by main author or co-author', () => {
    const manager = new FilterSortManager({ myPostsOnly: true, postAuthorName: 'Me' });
    expect(manager.applyFiltersAndSort(posts).map((p) => p.filePath).sort()).toEqual(['coauthored.md', 'mine.md']);

    manager.updateFilter({ postAuthorName: 'Club' });
    expect(manager.applyFiltersAndSort(posts).map((p) => p.filePath)).toEqual(['coauthored.md']);
  });

  it('lists archived posts too, whichever tab is on', () => {
    const withArchived = [...posts, makePost('archived.md', { isComposedPost: true, archive: true })];
    const manager = new FilterSortManager({ myPostsOnly: true, activeTab: 'inbox', includeArchived: false });
    expect(manager.applyFiltersAndSort(withArchived).map((p) => p.filePath)).toContain('archived.md');
    // Off again, the inbox hides it as before.
    manager.updateFilter({ myPostsOnly: false });
    expect(manager.applyFiltersAndSort(withArchived).map((p) => p.filePath)).not.toContain('archived.md');
  });

  it('is off by default and does not light the filter button', () => {
    const manager = new FilterSortManager();
    expect(manager.applyFiltersAndSort(posts)).toHaveLength(posts.length);
    manager.updateFilter({ myPostsOnly: true, postAuthorName: 'Me' });
    expect(manager.hasActiveFilters()).toBe(false);
  });
});

describe('FilterSortManager — My Posts (index path)', () => {
  const entries = [
    makeEntry('mine', { isComposedPost: true }),
    makeEntry('coauthored', { isComposedPost: true, authorName: 'Work', coAuthors: ['Me', 'Club'] }),
    makeEntry('work', { isComposedPost: true, authorName: 'Work' }),
    makeEntry('meeting'),
    makeEntry('tweet', { platform: 'x' }),
  ];

  it('agrees with the PostData path', () => {
    const manager = new FilterSortManager({ myPostsOnly: true });
    expect(manager.applyFiltersAndSortIndex(entries).map((e) => e.id).sort()).toEqual(['coauthored', 'mine', 'work']);

    manager.updateFilter({ postAuthorName: 'Me' });
    expect(manager.applyFiltersAndSortIndex(entries).map((e) => e.id).sort()).toEqual(['coauthored', 'mine']);
  });

  it('lists archived posts too, like the PostData path', () => {
    const manager = new FilterSortManager({ myPostsOnly: true, activeTab: 'inbox', includeArchived: false });
    const withArchived = [...entries, makeEntry('archived', { isComposedPost: true, archive: true })];
    expect(manager.applyFiltersAndSortIndex(withArchived).map((e) => e.id)).toContain('archived');
  });
});

describe('summarizePostAuthors', () => {
  it('counts each name once per post, most posts first', () => {
    expect(summarizePostAuthors([
      { authorName: 'Me' },
      { authorName: 'Work', coAuthors: ['Me', 'Club', 'Me'] },
      { authorName: 'Work' },
      { authorName: 'Me' },
    ])).toEqual([
      { name: 'Me', postCount: 3 },
      { name: 'Work', postCount: 2 },
      { name: 'Club', postCount: 1 },
    ]);
  });
});
