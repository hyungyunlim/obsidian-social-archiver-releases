/**
 * AuthorCatalogStore - Reactive State Management for Author Catalog
 *
 * Pure TypeScript store with explicit reactivity via Svelte writable stores.
 * Separates state management from UI components for reliable updates.
 */

import { writable, derived, get, type Writable, type Readable } from 'svelte/store';
import type { Platform } from '@/types/post';
import type {
  AuthorCatalogEntry,
  PlatformAuthorCounts,
} from '@/types/author-catalog';

// ============================================================================
// Types
// ============================================================================

export interface AuthorCatalogFilter {
  platform: Platform | 'all';
  searchQuery: string;
  sortBy: 'lastSeen' | 'nameAsc' | 'nameDesc' | 'archiveCount';
  statusFilter: 'all' | 'subscribed' | 'not_subscribed';
}

export interface AuthorCatalogState {
  authors: AuthorCatalogEntry[];
  isLoading: boolean;
  error: Error | null;
  /**
   * True when current authors were populated from a full vault scan.
   * Subscription-only optimistic updates should not flip this to true.
   */
  hasVaultSnapshot: boolean;
}

export interface SubscriptionStats {
  total: number;
  subscribed: number;
}

/**
 * Metadata update payload for updateAuthorMetadata
 */
export interface AuthorMetadataUpdate {
  authorName?: string;
  avatarUrl?: string | null;
  handle?: string | null;
  followers?: number | null;
  postsCount?: number | null;
  bio?: string | null;
  verified?: boolean;
}

// ============================================================================
// Default Values
// ============================================================================

const DEFAULT_FILTER: AuthorCatalogFilter = {
  platform: 'all',
  searchQuery: '',
  sortBy: 'lastSeen',
  statusFilter: 'all',
};

const DEFAULT_STATE: AuthorCatalogState = {
  authors: [],
  isLoading: true,
  error: null,
  hasVaultSnapshot: false,
};

// ============================================================================
// Store Factory
// ============================================================================

export interface AuthorCatalogStoreAPI {
  // State stores (subscribable)
  state: Writable<AuthorCatalogState>;
  filter: Writable<AuthorCatalogFilter>;

  // Derived stores (read-only, auto-updated)
  filteredAuthors: Readable<AuthorCatalogEntry[]>;
  platformCounts: Readable<PlatformAuthorCounts>;
  subscriptionStats: Readable<SubscriptionStats>;
  isEmpty: Readable<boolean>;
  hasNoResults: Readable<boolean>;

  // Actions
  setAuthors: (authors: AuthorCatalogEntry[]) => void;
  setAuthorsFromVault: (authors: AuthorCatalogEntry[]) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: Error | null) => void;
  updateAuthorStatus: (authorUrl: string, platform: Platform, status: AuthorCatalogEntry['status'], subscriptionId?: string, authorName?: string) => void;
  updateAuthorMetadata: (authorUrl: string, platform: Platform, metadata: AuthorMetadataUpdate, localAvatarPath?: string | null) => void;
  markVaultSnapshotStale: () => void;
  setFilter: (updates: Partial<AuthorCatalogFilter>) => void;
  clearFilters: () => void;
  reset: () => void;
}

/**
 * Creates an AuthorCatalog store instance
 */
export function createAuthorCatalogStore(): AuthorCatalogStoreAPI {
  // ========== Core Stores ==========
  const state = writable<AuthorCatalogState>({ ...DEFAULT_STATE });
  const filter = writable<AuthorCatalogFilter>({ ...DEFAULT_FILTER });

  // ========== Derived: Normalized Authors ==========
  const normalizedAuthors = derived(state, ($state) => {
    return $state.authors.map((a) => {
      const parsedDate = a.lastSeenAt instanceof Date ? a.lastSeenAt : new Date(a.lastSeenAt);
      const lastSeenAt = isNaN(parsedDate.getTime()) ? new Date(0) : parsedDate;
      return { ...a, lastSeenAt };
    });
  });

  // ========== Derived: Filtered & Sorted Authors ==========
  const filteredAuthors = derived(
    [normalizedAuthors, filter],
    ([$authors, $filter]) => {
      let result = [...$authors];

      // Filter by platform
      if ($filter.platform !== 'all') {
        result = result.filter((a) => a.platform === $filter.platform);
      }

      // Filter by subscription status
      if ($filter.statusFilter !== 'all') {
        if ($filter.statusFilter === 'subscribed') {
          result = result.filter((a) => a.status === 'subscribed');
        } else {
          result = result.filter((a) => a.status !== 'subscribed');
        }
      }

      // Search by name or handle
      const query = $filter.searchQuery.toLowerCase().trim();
      if (query) {
        result = result.filter(
          (a) =>
            (a.authorName || '').toLowerCase().includes(query) ||
            (a.handle || '').toLowerCase().includes(query) ||
            (a.authorUrl || '').toLowerCase().includes(query)
        );
      }

      // Sort: subscribed authors always first, then by selected criteria
      result.sort((a, b) => {
        // Primary sort: subscribed status (subscribed first)
        const aSubscribed = a.status === 'subscribed' ? 0 : 1;
        const bSubscribed = b.status === 'subscribed' ? 0 : 1;
        if (aSubscribed !== bSubscribed) {
          return aSubscribed - bSubscribed;
        }

        // Secondary sort: by selected criteria
        switch ($filter.sortBy) {
          case 'lastSeen':
            return b.lastSeenAt.getTime() - a.lastSeenAt.getTime();
          case 'nameAsc':
            return a.authorName.localeCompare(b.authorName);
          case 'nameDesc':
            return b.authorName.localeCompare(a.authorName);
          case 'archiveCount':
            return b.archiveCount - a.archiveCount;
          default:
            return 0;
        }
      });

      return result;
    }
  );

  // ========== Derived: Platform Counts ==========
  const platformCounts = derived(state, ($state) => {
    const counts: Partial<Record<Platform, number>> = {};
    let total = 0;

    for (const author of $state.authors) {
      counts[author.platform] = (counts[author.platform] || 0) + 1;
      total++;
    }

    return { ...counts, all: total } as PlatformAuthorCounts;
  });

  // ========== Derived: Subscription Stats ==========
  const subscriptionStats = derived(state, ($state) => {
    const subscribed = $state.authors.filter((a) => a.status === 'subscribed').length;
    return { total: $state.authors.length, subscribed };
  });

  // ========== Derived: Empty State ==========
  const isEmpty = derived(state, ($state) => $state.authors.length === 0 && !$state.isLoading);

  const hasNoResults = derived(
    [filteredAuthors, state],
    ([$filtered, $state]) => $filtered.length === 0 && $state.authors.length > 0
  );

  // ========== Actions ==========

  function setAuthors(authors: AuthorCatalogEntry[]): void {
    state.update((s) => ({ ...s, authors, error: null }));
  }

  function setAuthorsFromVault(authors: AuthorCatalogEntry[]): void {
    state.update((s) => ({ ...s, authors, error: null, hasVaultSnapshot: true }));
  }

  function setLoading(isLoading: boolean): void {
    state.update((s) => ({ ...s, isLoading }));
  }

  function setError(error: Error | null): void {
    state.update((s) => ({ ...s, error, isLoading: false }));
  }

  function updateAuthorStatus(
    authorUrl: string,
    platform: Platform,
    status: AuthorCatalogEntry['status'],
    subscriptionId?: string,
    authorName?: string
  ): void {
    state.update((s) => {
      // Check if author already exists
      const existingAuthor = s.authors.find(
        (a) => a.authorUrl === authorUrl && a.platform === platform
      );

      if (existingAuthor) {
        // Update existing author
        const updatedAuthors = s.authors.map((a) =>
          a.authorUrl === authorUrl && a.platform === platform
            ? { ...a, status, subscriptionId: subscriptionId ?? a.subscriptionId }
            : a
        );
        return { ...s, authors: updatedAuthors };
      } else if (status === 'subscribed' && subscriptionId) {
        // Add new subscription-only author entry
        const newAuthor: AuthorCatalogEntry = {
          authorName: authorName || extractHandleFromUrl(authorUrl, platform) || 'Unknown',
          authorUrl,
          platform,
          avatar: null,
          localAvatar: null,
          lastSeenAt: new Date(),
          lastRunAt: null,
          schedule: null,
          archiveCount: 0,
          unarchivedCount: 0,
          subscriptionId,
          status,
          handle: extractHandleFromUrl(authorUrl, platform) || undefined,
          filePaths: [],
          followers: null,
          postsCount: null,
          bio: null,
          lastMetadataUpdate: null,
          maxPostsPerRun: undefined,
          redditOptions: undefined
        };
        return { ...s, authors: [...s.authors, newAuthor] };
      }

      return s;
    });
  }

  /**
   * Extract handle from URL based on platform
   */
  function extractHandleFromUrl(url: string, platform: Platform): string | null {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;

      switch (platform) {
        case 'instagram':
        case 'tiktok':
        case 'youtube':
          // /@username or /username
          return pathname.replace(/^\/@?/, '').replace(/\/$/, '') || null;
        case 'x':
          // /username
          return pathname.replace(/^\//, '').replace(/\/$/, '') || null;
        case 'facebook':
        case 'linkedin':
        case 'pinterest':
          // /username or /in/username
          return pathname.replace(/^\/(in\/)?/, '').replace(/\/$/, '') || null;
        case 'reddit':
          // /r/subreddit or /user/username or /u/username
          const redditMatch = pathname.match(/\/(r|user|u)\/([^/]+)/);
          return redditMatch?.[2] ?? null;
        case 'bluesky':
          // /profile/handle
          return pathname.replace(/^\/profile\//, '').replace(/\/$/, '') || null;
        case 'mastodon':
          // /@username
          return pathname.replace(/^\/@/, '').replace(/\/$/, '') || null;
        default:
          // Generic: extract last path segment
          const segments = pathname.split('/').filter(Boolean);
          return segments[segments.length - 1] || null;
      }
    } catch {
      return null;
    }
  }

  /**
   * Update author metadata when new archives are created
   * Uses timestamp-based conflict resolution to prevent stale data overwrites
   *
   * @param authorUrl - Author profile URL (primary key)
   * @param platform - Platform the author is from
   * @param metadata - Metadata to update (partial, null values preserve existing)
   * @param localAvatarPath - Local avatar path (optional, null preserves existing)
   */
  function updateAuthorMetadata(
    authorUrl: string,
    platform: Platform,
    metadata: AuthorMetadataUpdate,
    localAvatarPath?: string | null
  ): void {
    state.update((s) => {
      const existingIndex = s.authors.findIndex(
        (a) => a.authorUrl === authorUrl && a.platform === platform
      );

      const now = new Date();

      const existing = existingIndex >= 0 ? s.authors[existingIndex] : null;

      if (!existing) {
        // New author - create entry with metadata
        const newEntry: AuthorCatalogEntry = {
          authorName: metadata.authorName || 'Unknown',
          authorUrl,
          platform,
          avatar: metadata.avatarUrl || null,
          localAvatar: localAvatarPath || null,
          followers: metadata.followers ?? null,
          postsCount: metadata.postsCount ?? null,
          bio: metadata.bio ?? null,
          lastSeenAt: now,
          lastMetadataUpdate: now,
          archiveCount: 1,
          unarchivedCount: 1,
          subscriptionId: null,
          status: 'not_subscribed',
          handle: metadata.handle || undefined,
        };

        return { ...s, authors: [...s.authors, newEntry] };
      }

      // Existing author - update with timestamp-based conflict resolution
      const existingUpdateTime = existing.lastMetadataUpdate instanceof Date
        ? existing.lastMetadataUpdate
        : existing.lastMetadataUpdate
          ? new Date(existing.lastMetadataUpdate)
          : null;

      // Determine if we should update metadata (newer timestamp wins)
      const shouldUpdateMetadata = !existingUpdateTime || now > existingUpdateTime;

      const updatedEntry: AuthorCatalogEntry = {
        ...existing,
        // Always update
        lastSeenAt: now,
        archiveCount: existing.archiveCount + 1,
        unarchivedCount: (existing.unarchivedCount ?? existing.archiveCount) + 1,
        // Conditionally update based on timestamp
        ...(shouldUpdateMetadata ? {
          authorName: metadata.authorName || existing.authorName,
          avatar: metadata.avatarUrl ?? existing.avatar,
          localAvatar: localAvatarPath ?? existing.localAvatar,
          followers: metadata.followers ?? existing.followers,
          postsCount: metadata.postsCount ?? existing.postsCount,
          bio: metadata.bio ?? existing.bio,
          handle: metadata.handle ?? existing.handle,
          lastMetadataUpdate: now,
        } : {}),
      };

      const updatedAuthors = [...s.authors];
      updatedAuthors[existingIndex] = updatedEntry;

      return { ...s, authors: updatedAuthors };
    });
  }

  function setFilter(updates: Partial<AuthorCatalogFilter>): void {
    filter.update((f) => ({ ...f, ...updates }));
  }

  function clearFilters(): void {
    filter.set({ ...DEFAULT_FILTER });
  }

  function markVaultSnapshotStale(): void {
    state.update((s) => ({ ...s, hasVaultSnapshot: false }));
  }

  function reset(): void {
    state.set({ ...DEFAULT_STATE });
    filter.set({ ...DEFAULT_FILTER });
  }

  return {
    // Stores
    state,
    filter,
    filteredAuthors,
    platformCounts,
    subscriptionStats,
    isEmpty,
    hasNoResults,

    // Actions
    setAuthors,
    setAuthorsFromVault,
    setLoading,
    setError,
    updateAuthorStatus,
    updateAuthorMetadata,
    markVaultSnapshotStale,
    setFilter,
    clearFilters,
    reset,
  };
}

// ============================================================================
// Singleton Instance (for simple usage)
// ============================================================================

let storeInstance: AuthorCatalogStoreAPI | null = null;

// Module-level cache for file count (persists across component mounts)
let lastKnownFileCount = 0;

// Module-level loading guard (shared across AuthorCatalog component instances)
// Prevents concurrent vault scans when phantom mounts create multiple instances.
let _isLoadingInProgress = false;
let _loadingGeneration = 0;

export function getAuthorCatalogStore(): AuthorCatalogStoreAPI {
  if (!storeInstance) {
    storeInstance = createAuthorCatalogStore();
  }
  return storeInstance;
}

export function resetAuthorCatalogStore(): void {
  if (storeInstance) {
    storeInstance.reset();
  }
  storeInstance = null;
  lastKnownFileCount = 0;
  _isLoadingInProgress = false;
  _loadingGeneration = 0;
}

/**
 * Get the last known vault file count for cache invalidation
 */
export function getLastKnownFileCount(): number {
  return lastKnownFileCount;
}

/**
 * Set the last known vault file count after scanning
 */
export function setLastKnownFileCount(count: number): void {
  lastKnownFileCount = count;
}

/**
 * Check if a vault scan is already in progress (module-level, shared across instances)
 */
export function isAuthorLoadInProgress(): boolean {
  return _isLoadingInProgress;
}

/**
 * Mark vault scan as started and return a generation ID.
 * The caller should check the generation after async work to detect if it was superseded.
 */
export function startAuthorLoad(): number {
  _isLoadingInProgress = true;
  _loadingGeneration++;
  return _loadingGeneration;
}

/**
 * Mark vault scan as finished for the given generation.
 * Only clears the flag if the generation matches (i.e., no newer load superseded it).
 */
export function finishAuthorLoad(generation: number): void {
  if (generation === _loadingGeneration) {
    _isLoadingInProgress = false;
  }
}

/**
 * Get current loading generation (for stale check after await)
 */
export function getAuthorLoadGeneration(): number {
  return _loadingGeneration;
}

/**
 * Invalidate the author catalog cache without destroying the store instance
 * This forces a reload on next mount while preserving subscriptions to stores
 * Called when vault changes (new posts archived, posts deleted, etc.)
 */
export function invalidateAuthorCatalogCache(): void {
  if (storeInstance) {
    storeInstance.markVaultSnapshotStale();
    // Clear authors to force reload, but keep store instance alive
    storeInstance.setAuthors([]);
  }
  // Also reset file count to force reload
  lastKnownFileCount = 0;
}
