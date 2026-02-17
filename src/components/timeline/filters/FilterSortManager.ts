import type { PostData } from '../../../types/post';
import { prepareSimpleSearch } from 'obsidian';
import { TIMELINE_PLATFORM_IDS } from '../../../constants/timelinePlatforms';
import type { PostIndexEntry } from '../../../services/PostIndexService';
import type { SearchIndexService } from '../../../services/SearchIndexService';

/**
 * Filter state interface
 */
export interface FilterState {
  platforms: Set<string>;
  selectedTags: Set<string>;  // Tag names to filter by (empty = show all)
  likedOnly: boolean;
  commentedOnly: boolean;
  sharedOnly: boolean;
  subscribedOnly: boolean;
  includeArchived: boolean;
  dateRange: { start: Date | null; end: Date | null };
  searchQuery: string;
}

/**
 * Sort state interface
 */
export interface SortState {
  by: 'published' | 'archived';
  order: 'newest' | 'oldest';
}

/**
 * Result of diffing two filtered lists
 */
export interface DiffResult {
  added: PostIndexEntry[];   // New posts to insert
  removed: string[];         // FilePaths to remove from DOM
  reorder: boolean;          // Whether sort order changed
  largeChange: boolean;      // >50% change → full re-render recommended
}

/**
 * FilterSortManager - Manages filtering and sorting logic
 * Single Responsibility: Apply filters and sorting to post data
 *
 * Supports both PostData[] (legacy) and PostIndexEntry[] (index-based) filtering.
 */
export class FilterSortManager {
  private filterState: FilterState;
  private sortState: SortState;
  private platformCounts: Record<string, number> = {};

  /** Previous filtered list (for incremental DOM diffing) */
  private previousFilteredFilePaths: string[] = [];

  /** Optional search index for O(1) token lookup */
  private searchIndex: SearchIndexService | null = null;

  constructor(
    initialFilterState?: Partial<FilterState>,
    initialSortState?: Partial<SortState>
  ) {
    // Initialize filter state with defaults
    this.filterState = this.buildFilterState(initialFilterState);

    // Initialize sort state with defaults
    this.sortState = {
      by: 'published',
      order: 'newest',
      ...initialSortState
    };
  }

  /**
   * Set the search index for fast token-based search.
   * When set, search queries use the inverted index instead of linear scan.
   */
  setSearchIndex(index: SearchIndexService): void {
    this.searchIndex = index;
  }

  // ---------------------------------------------------------------------------
  // PostData filtering (legacy — full PostData objects)
  // ---------------------------------------------------------------------------

  /**
   * Apply filters and sorting to posts
   */
  applyFiltersAndSort(posts: PostData[]): PostData[] {
    const filtered = this.applyFilters(posts);
    const sorted = this.applySort(filtered);
    return sorted;
  }

  /**
   * Apply filters to posts
   */
  private applyFilters(posts: PostData[]): PostData[] {
    let filtered = [...posts];

    // Filter by platform
    // Note: 'webtoons' platform is shown under 'naver-webtoon' filter (both are webtoon platforms)
    filtered = filtered.filter(post => {
      if (this.filterState.platforms.has(post.platform)) return true;
      // Show webtoons posts when naver-webtoon filter is selected
      if (post.platform === 'webtoons' && this.filterState.platforms.has('naver-webtoon')) return true;
      return false;
    });

    // Filter by tags (any match)
    if (this.filterState.selectedTags.size > 0) {
      filtered = filtered.filter(post => {
        if (!post.tags || post.tags.length === 0) return false;
        const postTagsLower = post.tags.map(t => t.toLowerCase());
        return Array.from(this.filterState.selectedTags).some(tag =>
          postTagsLower.includes(tag.toLowerCase())
        );
      });
    }

    // Filter by liked only
    if (this.filterState.likedOnly) {
      filtered = filtered.filter(post => post.like === true);
    }

    // Filter by commented only
    if (this.filterState.commentedOnly) {
      filtered = filtered.filter(post => post.comment && post.comment.trim().length > 0);
    }

    // Filter by shared only
    if (this.filterState.sharedOnly) {
      filtered = filtered.filter(post => post.shareUrl && post.shareUrl.trim().length > 0);
    }

    // Filter by subscribed only
    if (this.filterState.subscribedOnly) {
      filtered = filtered.filter(post => post.subscribed === true);
    }

    // Filter by archive status
    if (!this.filterState.includeArchived) {
      filtered = filtered.filter(post => post.archive !== true);
    }

    // Filter by date range
    if (this.filterState.dateRange.start || this.filterState.dateRange.end) {
      filtered = filtered.filter(post => {
        const dateToCheck = this.sortState.by === 'published' ? post.publishedDate : post.archivedDate;
        if (!dateToCheck) return true; // Keep if date doesn't exist

        const postTime = typeof dateToCheck === 'string' ? new Date(dateToCheck).getTime() : dateToCheck.getTime();
        const startTime = this.filterState.dateRange.start?.getTime();
        const endTime = this.filterState.dateRange.end?.getTime();

        if (startTime && postTime < startTime) {
          return false;
        }
        if (endTime && postTime > endTime) {
          return false;
        }
        return true;
      });
    }

    // Filter by search query using Obsidian's native simple search
    if (this.filterState.searchQuery && this.filterState.searchQuery.trim().length > 0) {
      const simpleSearch = prepareSimpleSearch(this.filterState.searchQuery);

      filtered = filtered.filter(post => {
        // Build searchable text from post data
        const searchableTexts = [
          post.author.name,
          post.content.text,
          post.comment || '',
          post.platform,
          ...(post.tags || []),
          ...(post.content.hashtags || [])
        ];

        // Include embedded archives content in search
        if (post.embeddedArchives && post.embeddedArchives.length > 0) {
          post.embeddedArchives.forEach(embedded => {
            if (embedded.author?.name) searchableTexts.push(embedded.author.name);
            if (embedded.content?.text) searchableTexts.push(embedded.content.text);
          });
        }

        const searchableText = searchableTexts.join(' ');

        // Use Obsidian's simple search (more precise than fuzzy search)
        const result = simpleSearch(searchableText);
        return result !== null;
      });
    }

    return filtered;
  }

  /**
   * Apply sorting to posts
   */
  private applySort(posts: PostData[]): PostData[] {
    return posts.sort((a, b) => {
      // Get date to sort by
      const getDateForSort = (post: PostData): number => {
        const timestamp = typeof post.metadata.timestamp === 'string'
          ? new Date(post.metadata.timestamp).getTime()
          : post.metadata.timestamp.getTime();

        if (this.sortState.by === 'published') {
          return post.publishedDate?.getTime() ?? timestamp;
        } else {
          return post.archivedDate?.getTime() ?? timestamp;
        }
      };

      const aTime = getDateForSort(a);
      const bTime = getDateForSort(b);

      return this.sortState.order === 'newest' ? bTime - aTime : aTime - bTime;
    });
  }

  // ---------------------------------------------------------------------------
  // PostIndexEntry filtering (index-based — lightweight)
  // ---------------------------------------------------------------------------

  /**
   * Apply filters and sorting to index entries (lightweight, no full PostData needed).
   * Returns sorted array of PostIndexEntry.
   */
  applyFiltersAndSortIndex(entries: PostIndexEntry[]): PostIndexEntry[] {
    const filtered = this.applyFiltersIndex(entries);
    const sorted = this.applySortIndex(filtered);

    // Caller should explicitly call updatePreviousFiltered() after computing diff
    return sorted;
  }

  /**
   * Apply filters to index entries.
   */
  private applyFiltersIndex(entries: PostIndexEntry[]): PostIndexEntry[] {
    let filtered = entries;

    // Filter by platform
    filtered = filtered.filter(entry => {
      if (this.filterState.platforms.has(entry.platform)) return true;
      if (entry.platform === 'webtoons' && this.filterState.platforms.has('naver-webtoon')) return true;
      return false;
    });

    // Filter by tags (any match)
    if (this.filterState.selectedTags.size > 0) {
      const selectedTagsLower = new Set(
        Array.from(this.filterState.selectedTags).map(t => t.toLowerCase())
      );
      filtered = filtered.filter(entry => {
        if (entry.tags.length === 0) return false;
        return entry.tags.some(t => selectedTagsLower.has(t.toLowerCase()));
      });
    }

    // Boolean filters
    if (this.filterState.likedOnly) {
      filtered = filtered.filter(e => e.like);
    }
    if (this.filterState.commentedOnly) {
      filtered = filtered.filter(e => e.comment && e.comment.trim().length > 0);
    }
    if (this.filterState.sharedOnly) {
      filtered = filtered.filter(e => e.shareUrl && e.shareUrl.trim().length > 0);
    }
    if (this.filterState.subscribedOnly) {
      filtered = filtered.filter(e => e.subscribed);
    }
    if (!this.filterState.includeArchived) {
      filtered = filtered.filter(e => !e.archive);
    }

    // Date range
    if (this.filterState.dateRange.start || this.filterState.dateRange.end) {
      const startTime = this.filterState.dateRange.start?.getTime();
      const endTime = this.filterState.dateRange.end?.getTime();

      filtered = filtered.filter(entry => {
        const dateToCheck = this.sortState.by === 'published'
          ? entry.publishedDate
          : entry.archivedDate;
        if (!dateToCheck) return true;

        if (startTime && dateToCheck < startTime) return false;
        if (endTime && dateToCheck > endTime) return false;
        return true;
      });
    }

    // Search query
    if (this.filterState.searchQuery && this.filterState.searchQuery.trim().length > 0) {
      const query = this.filterState.searchQuery.trim();

      // Try inverted index first (O(1) per token)
      if (this.searchIndex) {
        const matchingPaths = this.searchIndex.search(query);
        if (matchingPaths.size > 0 || query.length >= 2) {
          filtered = filtered.filter(e => matchingPaths.has(e.filePath));
        }
      } else {
        // Fallback: linear scan on searchText
        const queryLower = query.toLowerCase();
        filtered = filtered.filter(e => e.searchText.includes(queryLower));
      }
    }

    return filtered;
  }

  /**
   * Apply sorting to index entries.
   */
  private applySortIndex(entries: PostIndexEntry[]): PostIndexEntry[] {
    return [...entries].sort((a, b) => {
      const getDate = (entry: PostIndexEntry): number => {
        if (this.sortState.by === 'published') {
          return entry.publishedDate ?? entry.metadataTimestamp;
        } else {
          return entry.archivedDate ?? entry.metadataTimestamp;
        }
      };

      const aTime = getDate(a);
      const bTime = getDate(b);

      return this.sortState.order === 'newest' ? bTime - aTime : aTime - bTime;
    });
  }

  // ---------------------------------------------------------------------------
  // Incremental DOM diff
  // ---------------------------------------------------------------------------

  /**
   * Compute a diff between the previous filtered list and a new one.
   * Used for incremental DOM updates (Phase 3).
   */
  diffWithPrevious(newFilteredEntries: PostIndexEntry[]): DiffResult {
    const oldPathSet = new Set(this.previousFilteredFilePaths);
    const newPaths = newFilteredEntries.map(e => e.filePath);
    const newPathSet = new Set(newPaths);

    const added = newFilteredEntries.filter(e => !oldPathSet.has(e.filePath));
    const removed = this.previousFilteredFilePaths.filter(p => !newPathSet.has(p));

    // Check if ordering changed (beyond just additions/removals)
    let reorder = false;
    if (added.length === 0 && removed.length === 0) {
      // Same set — check if order changed
      reorder = !this.arraysEqual(this.previousFilteredFilePaths, newPaths);
    }

    // Large change threshold: if >50% posts changed, suggest full re-render
    const totalPosts = Math.max(this.previousFilteredFilePaths.length, newPaths.length);
    const changedCount = added.length + removed.length;
    const largeChange = totalPosts > 0 && (changedCount / totalPosts) > 0.5;

    return { added, removed, reorder, largeChange };
  }

  /**
   * Update the previous filtered paths tracking (call after applying diff).
   */
  updatePreviousFiltered(filePaths: string[]): void {
    this.previousFilteredFilePaths = filePaths;
  }

  private arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // State management
  // ---------------------------------------------------------------------------

  /**
   * Update filter state
   */
  updateFilter(filter: Partial<FilterState>): void {
    this.filterState = { ...this.filterState, ...filter };
  }

  /**
   * Reset filter state to defaults or provided overrides
   */
  resetFilters(initialFilterState?: Partial<FilterState>): void {
    this.filterState = this.buildFilterState(initialFilterState);
  }

  /**
   * Update sort state
   */
  updateSort(sort: Partial<SortState>): void {
    this.sortState = { ...this.sortState, ...sort };
  }

  /**
   * Get current filter state
   */
  getFilterState(): FilterState {
    return { ...this.filterState };
  }

  /**
   * Get current sort state
   */
  getSortState(): SortState {
    return { ...this.sortState };
  }

  /**
   * Set platform counts for active filter detection
   */
  setPlatformCounts(counts: Record<string, number>): void {
    this.platformCounts = counts;
  }

  /**
   * Check if any filter is active
   */
  hasActiveFilters(): boolean {
    // Only consider platforms that have data
    const activePlatforms = TIMELINE_PLATFORM_IDS.filter(id => (this.platformCounts[id] || 0) > 0);
    const allActivePlatformsSelected = activePlatforms.length === 0 ||
      activePlatforms.every(id => this.filterState.platforms.has(id));

    const hasActiveFilter = (
      !allActivePlatformsSelected ||
      this.filterState.selectedTags.size > 0 ||
      Boolean(this.filterState.likedOnly) ||
      Boolean(this.filterState.commentedOnly) ||
      Boolean(this.filterState.sharedOnly) ||
      Boolean(this.filterState.subscribedOnly) ||
      Boolean(this.filterState.includeArchived) ||
      this.filterState.dateRange.start !== null ||
      this.filterState.dateRange.end !== null
      // Search query removed - search and filter are now independent
    );
    return Boolean(hasActiveFilter);
  }

  private buildFilterState(initialFilterState?: Partial<FilterState>): FilterState {
    return {
      platforms: initialFilterState?.platforms
        ? new Set(initialFilterState.platforms)
        : new Set<string>(TIMELINE_PLATFORM_IDS),
      selectedTags: initialFilterState?.selectedTags
        ? new Set(initialFilterState.selectedTags)
        : new Set<string>(),
      likedOnly: initialFilterState?.likedOnly ?? false,
      commentedOnly: initialFilterState?.commentedOnly ?? false,
      sharedOnly: initialFilterState?.sharedOnly ?? false,
      subscribedOnly: initialFilterState?.subscribedOnly ?? false,
      includeArchived: initialFilterState?.includeArchived ?? false,
      dateRange: {
        start: initialFilterState?.dateRange?.start ?? null,
        end: initialFilterState?.dateRange?.end ?? null
      },
      searchQuery: initialFilterState?.searchQuery ?? ''
    };
  }
}
