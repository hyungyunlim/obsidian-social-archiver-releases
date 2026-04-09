/**
 * AuthorDetailService - Data lookup, matching, and filtering for Author Detail View
 *
 * Single Responsibility: Retrieve author data from AuthorCatalogStore,
 * match posts from PostIndexService, and provide sort/filter/search operations.
 *
 * No network requests. No vault re-parsing. All methods use cached data only.
 */

import type { AuthorCatalogEntry } from '@/types/author-catalog';
import type { Platform } from '@/types/post';
import type { AuthorCatalogStoreAPI } from '@/services/AuthorCatalogStore';
import type { PostIndexService, PostIndexEntry } from '@/services/PostIndexService';
import { get } from 'svelte/store';

// ============================================================================
// Types
// ============================================================================

/** Sort options for author detail post list */
export type AuthorDetailSortOption = 'newest' | 'oldest' | 'title';

/** Filter options for author detail post list */
export interface AuthorDetailFilter {
  /** Filter by tag name (empty string = no tag filter) */
  tag: string;
  /** Show only liked/bookmarked posts */
  likedOnly: boolean;
  /** Text search query (matched against searchText field) */
  searchQuery: string;
}

export const DEFAULT_AUTHOR_DETAIL_FILTER: AuthorDetailFilter = {
  tag: '',
  likedOnly: false,
  searchQuery: '',
};

// ============================================================================
// AuthorDetailService
// ============================================================================

export class AuthorDetailService {
  constructor(
    private readonly store: AuthorCatalogStoreAPI,
    private readonly postIndexService: PostIndexService
  ) {}

  // --------------------------------------------------------------------------
  // Author Lookup
  // --------------------------------------------------------------------------

  /**
   * Find an author by authorUrl + platform from the store.
   *
   * Uses the canonical key (authorUrl, platform) as defined in the PRD.
   * Returns undefined if the author is not found in the current store state.
   */
  findAuthor(authorUrl: string, platform: Platform): AuthorCatalogEntry | undefined {
    const state = get(this.store.state);
    return state.authors.find(
      (a) => a.authorUrl === authorUrl && a.platform === platform
    );
  }

  // --------------------------------------------------------------------------
  // Post Matching
  // --------------------------------------------------------------------------

  /**
   * Get all PostIndexEntry items that belong to the given author.
   *
   * Matching order (as specified in PRD FR3):
   * 1. Primary: author.filePaths[] -> PostIndexEntry.filePath direct match
   * 2. Fallback: authorName + platform match (when filePaths is empty or incomplete)
   *
   * The fallback is susceptible to author rename / display-name drift,
   * which is why this logic is centralized here.
   */
  getPostsForAuthor(author: AuthorCatalogEntry): PostIndexEntry[] {
    const allEntries = this.postIndexService.getEntriesArray();
    const filePaths = author.filePaths;

    // Primary matching: filePaths direct lookup
    if (filePaths && filePaths.length > 0) {
      const filePathSet = new Set(filePaths);
      const matched = allEntries.filter((entry) => filePathSet.has(entry.filePath));

      // If we got a reasonable number of matches, return them.
      // Fall through to fallback only if filePaths produced zero matches
      // (could happen if index is stale or files were renamed).
      if (matched.length > 0) {
        return matched;
      }
    }

    // Fallback matching: authorName + platform
    return allEntries.filter(
      (entry) =>
        entry.platform === author.platform &&
        entry.authorName === author.authorName
    );
  }

  // --------------------------------------------------------------------------
  // Sorting
  // --------------------------------------------------------------------------

  /**
   * Sort posts according to the given sort option.
   * Returns a new sorted array (does not mutate the input).
   */
  sortPosts(posts: PostIndexEntry[], sortBy: AuthorDetailSortOption): PostIndexEntry[] {
    const sorted = [...posts];

    switch (sortBy) {
      case 'newest':
        sorted.sort((a, b) => {
          const aDate = a.publishedDate ?? a.archivedDate ?? 0;
          const bDate = b.publishedDate ?? b.archivedDate ?? 0;
          return bDate - aDate;
        });
        break;

      case 'oldest':
        sorted.sort((a, b) => {
          const aDate = a.publishedDate ?? a.archivedDate ?? 0;
          const bDate = b.publishedDate ?? b.archivedDate ?? 0;
          return aDate - bDate;
        });
        break;

      case 'title':
        sorted.sort((a, b) => {
          const aTitle = (a.title ?? '').toLowerCase();
          const bTitle = (b.title ?? '').toLowerCase();
          return aTitle.localeCompare(bTitle);
        });
        break;
    }

    return sorted;
  }

  // --------------------------------------------------------------------------
  // Filtering
  // --------------------------------------------------------------------------

  /**
   * Apply filters to a post list.
   * Returns a new filtered array (does not mutate the input).
   */
  filterPosts(posts: PostIndexEntry[], filter: AuthorDetailFilter): PostIndexEntry[] {
    let result = posts;

    // Tag filter
    if (filter.tag) {
      const tagLower = filter.tag.toLowerCase();
      result = result.filter((entry) =>
        entry.tags.some((t) => t.toLowerCase() === tagLower)
      );
    }

    // Liked/bookmarked filter
    if (filter.likedOnly) {
      result = result.filter((entry) => entry.like);
    }

    // Text search (uses pre-joined searchText for fast substring matching)
    if (filter.searchQuery) {
      const queryLower = filter.searchQuery.toLowerCase();
      result = result.filter((entry) =>
        entry.searchText.includes(queryLower)
      );
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // Combined: match + filter + sort
  // --------------------------------------------------------------------------

  /**
   * Convenience method that runs the full pipeline:
   * 1. Match posts for author
   * 2. Apply filters
   * 3. Sort results
   *
   * Returns an empty array if the author has no matching posts.
   */
  getFilteredSortedPosts(
    author: AuthorCatalogEntry,
    filter: AuthorDetailFilter,
    sortBy: AuthorDetailSortOption
  ): PostIndexEntry[] {
    const matched = this.getPostsForAuthor(author);
    const filtered = this.filterPosts(matched, filter);
    return this.sortPosts(filtered, sortBy);
  }

  // --------------------------------------------------------------------------
  // Utility: extract unique tags from matched posts
  // --------------------------------------------------------------------------

  /**
   * Collect all unique tags from the given posts.
   * Useful for populating the tag filter dropdown.
   */
  getUniqueTags(posts: PostIndexEntry[]): string[] {
    const tagSet = new Set<string>();
    for (const entry of posts) {
      for (const tag of entry.tags) {
        tagSet.add(tag);
      }
    }
    return [...tagSet].sort((a, b) => a.localeCompare(b));
  }
}
