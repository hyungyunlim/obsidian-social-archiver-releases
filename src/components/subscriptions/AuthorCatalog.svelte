<script lang="ts">
/**
 * AuthorCatalog - Main Author Catalog List View
 *
 * Uses Svelte stores for reliable reactivity.
 * Integrates with SubscriptionManager for subscription status.
 */

import type { App } from 'obsidian';
import type { Platform } from '@/types/post';
import type {
  AuthorCatalogEntry,
  AuthorSubscribeOptions,
  AuthorSortOption,
  PlatformAuthorCounts,
} from '@/types/author-catalog';
import { AuthorVaultScanner } from '@/services/AuthorVaultScanner';
import { AuthorDeduplicator, generateAuthorKey, type SubscriptionMap } from '@/services/AuthorDeduplicator';
import {
  getAuthorCatalogStore,
  isAuthorLoadInProgress,
  startAuthorLoad,
  finishAuthorLoad,
  getAuthorLoadGeneration,
  type AuthorCatalogStoreAPI,
} from '@/services/AuthorCatalogStore';
import { get } from 'svelte/store';
import AuthorRow from './AuthorRow.svelte';

// ============================================================================
// Debug (opt-in)
// ============================================================================

const AUTHOR_CATALOG_DEBUG = (() => {
  try {
    const w = typeof window !== 'undefined' ? (window as any) : undefined;
    if (w?.SOCIAL_ARCHIVER_DEBUG_AUTHOR_CATALOG === true) return true;
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem('SOCIAL_ARCHIVER_DEBUG_AUTHOR_CATALOG');
      return v === '1' || v === 'true';
    }
  } catch {
    // ignore
  }
  return false;
})();

function debugLog(...args: unknown[]): void {
  if (!AUTHOR_CATALOG_DEBUG) return;
  console.log('[AuthorCatalog]', ...args);
}

function debugWarn(...args: unknown[]): void {
  if (!AUTHOR_CATALOG_DEBUG) return;
  console.warn('[AuthorCatalog]', ...args);
}

const AUTHOR_CATALOG_BUILD_ID = '2026-02-09.2';
debugLog('build', { id: AUTHOR_CATALOG_BUILD_ID });

const AUTHOR_CATALOG_MINIMAL_RENDER = (() => {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem('SOCIAL_ARCHIVER_DEBUG_AUTHOR_CATALOG_MINIMAL');
      return v === '1' || v === 'true';
    }
  } catch {
    // ignore
  }
  return false;
})();

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

// ============================================================================
// Schedule Formatting
// ============================================================================

/**
 * Format cron schedule for display
 * Handles both daily and weekly schedules
 */
function formatCronSchedule(schedule?: { cron?: string; localCron?: string; timezone?: string }): string {
  if (!schedule?.cron && !schedule?.localCron) {
    return 'No schedule';
  }

  const timezone = schedule.timezone || 'UTC';
  // Prefer localCron if available (user's original time)
  const cronParts = (schedule.localCron || schedule.cron || '').split(' ');

  if (cronParts.length < 5) {
    return 'Invalid schedule';
  }

  const hour = parseInt(cronParts[1]) || 0;
  const weekday = cronParts[4]; // 0-6 (Sun-Sat) or *
  const formattedHour = String(hour).padStart(2, '0') + ':00';

  // Check if it's a weekly schedule (specific weekday, not *)
  if (weekday !== '*') {
    const weekdayNum = parseInt(weekday);
    if (!isNaN(weekdayNum) && weekdayNum >= 0 && weekdayNum <= 6) {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dayName = dayNames[weekdayNum];
      return `Every ${dayName} at ${formattedHour}`;
    }
  }

  // Daily schedule
  // If using UTC cron (no localCron), try to convert to local timezone
  if (!schedule.localCron && schedule.cron) {
    try {
      const utcDate = new Date();
      utcDate.setUTCHours(hour, 0, 0, 0);
      const formatter = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: false,
        timeZone: timezone
      });
      const localTime = formatter.format(utcDate);
      return `Daily at ${localTime} (${timezone})`;
    } catch {
      return `Daily at ${formattedHour} (${timezone})`;
    }
  }

  return `Daily at ${formattedHour} (${timezone})`;
}

// ============================================================================
// Props
// ============================================================================

interface AuthorCatalogProps {
  app: App;
  archivePath?: string;
  fetchSubscriptions?: () => Promise<any[]>;
  onSubscribe?: (author: AuthorCatalogEntry, options: AuthorSubscribeOptions) => Promise<any>;
  onUpdateSubscription?: (author: AuthorCatalogEntry, options: AuthorSubscribeOptions) => Promise<void>;
  onUnsubscribe?: (author: AuthorCatalogEntry) => Promise<void>;
  onManualRun?: (author: AuthorCatalogEntry) => Promise<void>;
  onViewHistory?: (author: AuthorCatalogEntry) => void;
  onViewArchives?: (author: AuthorCatalogEntry) => void;
  hideHeader?: boolean;  // Hide the catalog header
  hideFilters?: boolean; // Hide the filter bar
  externalSearchQuery?: string; // Accept search query from parent
  externalPlatformFilter?: Platform[]; // Accept platform filter array from parent
  externalSortBy?: AuthorSortOption; // Accept sort from parent
  externalIncludeArchived?: boolean; // Whether to include timeline-archived posts/authors
  onPlatformCountsChange?: (counts: PlatformAuthorCounts) => void; // Callback when platform counts change
}

let {
  app,
  archivePath = 'Social Archives',
  fetchSubscriptions,
  onSubscribe,
  onUpdateSubscription,
  onUnsubscribe,
  onManualRun,
  onViewHistory,
  onViewArchives,
  hideHeader = false,
  hideFilters = false,
  externalSearchQuery = '',
  externalPlatformFilter = ['facebook', 'instagram', 'x', 'threads', 'linkedin', 'tiktok'] as Platform[],
  externalSortBy = 'lastRun',
  externalIncludeArchived = false,
  onPlatformCountsChange
}: AuthorCatalogProps = $props();

// ============================================================================
// Store
// ============================================================================

const store: AuthorCatalogStoreAPI = getAuthorCatalogStore();

// Subscribe to stores for reactivity
let authors: AuthorCatalogEntry[] = $state([]);
let filteredAuthors: AuthorCatalogEntry[] = $state([]);
let isLoading = $state(true);
let loadingMessage = $state('Scanning vault for authors...');
let error: Error | null = $state(null);
let platformCounts: PlatformAuthorCounts = $state({ all: 0 });
let subscriptionStats = $state({ total: 0, subscribed: 0 });
let isEmpty = $state(false);
let hasNoResults = $state(false);

// Progressive rendering to avoid long main-thread stalls when author list is large.
const INITIAL_RENDER_LIMIT = 30;
const RENDER_STEP = 30;
const AUTO_RENDER_MAX = 200;
let renderLimit = $state(0);
let displayedAuthors: AuthorCatalogEntry[] = $state([]);
let contentEl: HTMLDivElement | null = $state(null);
let isIncrementalRendering = $state(false);

let _renderPumpToken = 0;

function stopIncrementalRender(): void {
  _renderPumpToken++;
  isIncrementalRendering = false;
}

function yieldToUiFrame(): Promise<void> {
  return new Promise((resolve) => {
    // rAF can be paused in some Electron/Obsidian states; keep a timeout fallback to avoid deadlock.
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };

    const timeoutId = setTimeout(finish, 50);

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        clearTimeout(timeoutId);
        finish();
      });
      return;
    }

    // Timeout fallback already scheduled
  });
}

function startIncrementalRender(expectedGeneration: number): void {
  stopIncrementalRender();
  const token = _renderPumpToken;
  isIncrementalRendering = true;

  const run = async () => {
    try {
      // Let the "spinner -> list" transition paint first.
      await yieldToUiFrame();
      if (token !== _renderPumpToken) return;
      if (getAuthorLoadGeneration() !== expectedGeneration) return;

      const total = filteredAuthors.length;
      if (total <= 0) return;

      const initial = Math.min(INITIAL_RENDER_LIMIT, total);
      renderLimit = Math.max(renderLimit, initial);
      if (AUTHOR_CATALOG_DEBUG) {
        debugLog('incremental render init', { renderLimit, total, expectedGeneration });
      }

      // Auto-fill small lists; keep big lists scroll-driven to avoid long stalls.
      if (total <= AUTO_RENDER_MAX) {
        while (token === _renderPumpToken && renderLimit < total) {
          if (getAuthorLoadGeneration() !== expectedGeneration) return;
          await yieldToUiFrame();
          if (token !== _renderPumpToken) return;

          const next = Math.min(renderLimit + RENDER_STEP, total);
          renderLimit = next;
          if (AUTHOR_CATALOG_DEBUG) debugLog('incremental render step', { renderLimit: next, total });
        }
      }
    } finally {
      if (token === _renderPumpToken) {
        isIncrementalRendering = false;
      }
    }
  };

  void run();
}

// Filter state - use external props if provided, otherwise use internal state
let filterPlatform = $state<Platform[]>(externalPlatformFilter);
let filterSearchQuery = $state(externalSearchQuery);
let filterSortBy = $state<AuthorSortOption>(externalSortBy);
let filterIncludeArchived = $state<boolean>(externalIncludeArchived);

// Watch for external prop changes
$effect(() => {
  filterPlatform = externalPlatformFilter;
});

$effect(() => {
  filterSearchQuery = externalSearchQuery;
});

$effect(() => {
  filterSortBy = externalSortBy;
});

$effect(() => {
  filterIncludeArchived = externalIncludeArchived;
});

// Subscribe to store changes
$effect(() => {
  let prevLoading = true;
  let prevAuthorsLen = 0;

  const unsubState = store.state.subscribe(($state) => {
    authors = $state.authors;
    isLoading = $state.isLoading;
    error = $state.error;
    debugLog('store.state update', {
      isLoading: $state.isLoading,
      authors: $state.authors.length,
      hasVaultSnapshot: $state.hasVaultSnapshot,
      error: $state.error ? $state.error.message : null
    });

    // Keep initial paint cheap: render 0 rows until the first frame after loading completes.
    // Also applies when using cached authors on remount (store already has data).
    if ($state.isLoading) {
      prevLoading = true;
      prevAuthorsLen = $state.authors.length;
      stopIncrementalRender();
      return;
    }

    const becameReady = prevLoading || (prevAuthorsLen === 0 && $state.authors.length > 0);
    prevLoading = false;
    prevAuthorsLen = $state.authors.length;
    if (becameReady && $state.authors.length > 0) {
      renderLimit = 0;
      isIncrementalRendering = true;
      setTimeout(() => {
        // Guard: do nothing if a newer load started meanwhile.
        if (isAuthorLoadInProgress()) return;
        startIncrementalRender(getAuthorLoadGeneration());
      }, 0);
    }
  });

  const unsubPlatformCounts = store.platformCounts.subscribe(($counts) => {
    platformCounts = $counts;
    // Notify parent component of platform counts change
    if (onPlatformCountsChange) {
      onPlatformCountsChange($counts);
    }
  });

  const unsubStats = store.subscriptionStats.subscribe(($stats) => {
    subscriptionStats = $stats;
  });

  const unsubEmpty = store.isEmpty.subscribe(($isEmpty) => {
    isEmpty = $isEmpty;
  });

  return () => {
    unsubState();
    unsubPlatformCounts();
    unsubStats();
    unsubEmpty();
  };
});

// Platform filter groups - when filtering by one platform, include related platforms
const PLATFORM_FILTER_GROUPS: Record<string, string[]> = {
  'naver-webtoon': ['naver-webtoon', 'webtoons'],
};

// Apply filters locally since we need multi-platform support
$effect(() => {
  const t0 = AUTHOR_CATALOG_DEBUG ? nowMs() : 0;
  let result = [...authors];

  // When includeArchived is off, hide authors whose posts are all archived/hidden in the timeline
  // (frontmatter: `archive: true`), unless they're subscribed (subscription management should
  // always remain possible).
  if (!filterIncludeArchived) {
    result = result.filter((author) => {
      if (author.status === 'subscribed' || author.status === 'error') return true;
      const unarchived = author.unarchivedCount ?? author.archiveCount;
      return unarchived > 0;
    });
  }

  // Filter by platforms (multi-select)
  // If no platforms selected, show nothing
  if (filterPlatform.length === 0) {
    result = [];  // No platforms selected = show nothing
  } else {
    // Expand platform filter to include grouped platforms
    const expandedPlatforms = new Set<string>();
    for (const platform of filterPlatform) {
      const group = PLATFORM_FILTER_GROUPS[platform];
      if (group) {
        group.forEach(p => expandedPlatforms.add(p));
      } else {
        expandedPlatforms.add(platform);
      }
    }
    result = result.filter(author => expandedPlatforms.has(author.platform));
  }

  // Search by name or handle (only if there are results to filter)
  if (result.length > 0) {
    const query = filterSearchQuery.toLowerCase().trim();
    if (query) {
      result = result.filter(author =>
        (author.authorName || '').toLowerCase().includes(query) ||
        (author.handle || '').toLowerCase().includes(query) ||
        (author.authorUrl || '').toLowerCase().includes(query)
      );
    }
  }

  // Sort: subscribed authors always first, then by selected criteria.
  // Precompute sort keys to avoid heavy work inside the comparator for large lists.
  const subscribedPriority = (a: AuthorCatalogEntry) => (a.status === 'subscribed' ? 0 : 1);
  const toTime = (value: unknown): number => {
    if (!value) return 0;
    if (value instanceof Date) return value.getTime();
    const t = new Date(value as any).getTime();
    return Number.isFinite(t) ? t : 0;
  };

  if (filterSortBy === 'nameAsc' || filterSortBy === 'nameDesc') {
    const dir = filterSortBy === 'nameAsc' ? 1 : -1;
    const withKeys = result.map((author) => ({
      author,
      sub: subscribedPriority(author),
      name: author.authorName || '',
    }));
    withKeys.sort((a, b) => {
      const subDiff = a.sub - b.sub;
      if (subDiff !== 0) return subDiff;
      return a.name.localeCompare(b.name) * dir;
    });
    result = withKeys.map((x) => x.author);
  } else if (filterSortBy === 'archiveCount' || filterSortBy === 'archiveCountAsc') {
    const isAsc = filterSortBy === 'archiveCountAsc';
    const withKeys = result.map((author) => ({
      author,
      sub: subscribedPriority(author),
      count: author.archiveCount,
    }));
    withKeys.sort((a, b) => {
      const subDiff = a.sub - b.sub;
      if (subDiff !== 0) return subDiff;
      return isAsc ? a.count - b.count : b.count - a.count;
    });
    result = withKeys.map((x) => x.author);
  } else {
    // Time sorts (lastRun / lastSeen)
    const isAsc = filterSortBy === 'lastRunAsc' || filterSortBy === 'lastSeenAsc';
    const useLastSeen = filterSortBy === 'lastSeen' || filterSortBy === 'lastSeenAsc';
    const withKeys = result.map((author) => ({
      author,
      sub: subscribedPriority(author),
      time: useLastSeen
        ? toTime(author.lastSeenAt)
        : toTime(author.lastRunAt ?? author.lastSeenAt),
    }));
    withKeys.sort((a, b) => {
      const subDiff = a.sub - b.sub;
      if (subDiff !== 0) return subDiff;
      return isAsc ? a.time - b.time : b.time - a.time;
    });
    result = withKeys.map((x) => x.author);
  }

  filteredAuthors = result;
  hasNoResults = result.length === 0 && authors.length > 0;

  if (AUTHOR_CATALOG_DEBUG) {
    debugLog('filter/sort applied', {
      durationMs: Math.round(nowMs() - t0),
      authors: authors.length,
      filtered: result.length,
      sortBy: filterSortBy,
      platforms: filterPlatform.length,
      query: filterSearchQuery ? filterSearchQuery.length : 0,
      includeArchived: filterIncludeArchived,
    });
  }
});

// Reset pagination when filter criteria changes.
let _didInitPagination = false;
$effect(() => {
  // Track dependencies explicitly.
  filterSearchQuery;
  filterSortBy;
  filterPlatform;
  filterIncludeArchived;

  if (!_didInitPagination) {
    _didInitPagination = true;
    return;
  }

  // Avoid a big synchronous re-render when filters change: reset to 0 and let the incremental
  // renderer repopulate on the next tick.
  renderLimit = 0;
  isIncrementalRendering = true;
  if (contentEl) {
    contentEl.scrollTop = 0;
  }

  setTimeout(() => {
    // Guard: if a new load started, don't fight it.
    if (isAuthorLoadInProgress()) return;
    startIncrementalRender(getAuthorLoadGeneration());
  }, 0);
});

// Keep displayedAuthors in sync with filteredAuthors + renderLimit.
$effect(() => {
  const nextDisplayed = filteredAuthors.slice(0, renderLimit);
  displayedAuthors = nextDisplayed;
  if (AUTHOR_CATALOG_DEBUG) {
    debugLog('displayedAuthors updated', {
      displayed: nextDisplayed.length,
      filtered: filteredAuthors.length,
      renderLimit,
    });
  }
});

function handleScroll(): void {
  if (!contentEl) return;
  if (isLoading) return;
  if (renderLimit >= filteredAuthors.length) return;

  const thresholdPx = 200;
  const nearBottom =
    contentEl.scrollTop + contentEl.clientHeight >= contentEl.scrollHeight - thresholdPx;

  if (nearBottom) {
    renderLimit = Math.min(renderLimit + RENDER_STEP, filteredAuthors.length);
  }
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Find existing avatar file for a platform/handle combination
 * Uses the same file naming convention as AuthorAvatarService
 */
async function findExistingAvatar(platform: string, handle: string): Promise<string | null> {
  if (!handle) return null;

  // Sanitize handle (same as AuthorAvatarService)
  const sanitizedHandle = handle
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '_')
    .trim()
    .slice(0, 50);

  // Default media path + authors subfolder
  const basePath = 'attachments/social-archives/authors';
  const extensions = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic'];

  for (const ext of extensions) {
    const path = `${basePath}/${platform}-${sanitizedHandle}.${ext}`;
    // Use Obsidian's in-memory vault index to avoid potentially blocking filesystem calls.
    // This is much faster and avoids rare deadlocks/hangs some adapters can trigger.
    const file = app.vault.getAbstractFileByPath(path);
    if (file) return path;
  }

  return null;
}

/**
 * Build subscription map from API response
 */
function buildSubscriptionMapFromApi(subscriptions: any[]): SubscriptionMap {
  const map: SubscriptionMap = new Map();

  for (const sub of subscriptions) {
    if (!sub.enabled) continue;

    // Handle can come from root level or nested in target (API response varies)
    const handle = sub.handle || sub.target?.handle || sub.name;

    // Build platform-specific URL
    // For YouTube: ALWAYS regenerate URL from handle to ensure correct format
    // (stored profileUrl might be incorrect from older subscriptions)
    let authorUrl = '';

    if (sub.platform === 'youtube') {
      // YouTube: ALWAYS use handle-based URL (ignore stored profileUrl)
      const cleanHandle = (handle || '').replace(/^@/, '');
      if (cleanHandle.toUpperCase().startsWith('UC') && cleanHandle.length === 24) {
        authorUrl = `https://www.youtube.com/channel/${cleanHandle}`;
      } else if (cleanHandle) {
        authorUrl = `https://www.youtube.com/@${cleanHandle}`;
      }
    } else if (sub.platform === 'linkedin') {
      // LinkedIn: ALWAYS regenerate URL from handle to ensure consistent format
      // (stored profileUrl might be /company/ or /in/ format)
      if (handle) {
        authorUrl = `https://www.linkedin.com/in/${handle}/`;
      }
    } else {
      // Other platforms: use stored profileUrl if available
      authorUrl = sub.profileUrl || sub.target?.profileUrl || '';
    }

    // Generate URL from handle if not available
    if (!authorUrl) {
      if (sub.platform === 'x') {
        authorUrl = `https://x.com/${handle}`;
      } else if (sub.platform === 'facebook') {
        authorUrl = `https://www.facebook.com/${handle}/`;
      } else if (sub.platform === 'reddit') {
        authorUrl = `https://www.reddit.com/r/${handle}/`;
      } else if (sub.platform === 'instagram') {
        authorUrl = `https://www.instagram.com/${handle}/`;
      } else if (sub.platform === 'tiktok') {
        authorUrl = `https://www.tiktok.com/@${handle}`;
      } else if (sub.platform === 'linkedin') {
        authorUrl = `https://www.linkedin.com/in/${handle}/`;
      } else if (sub.platform === 'pinterest') {
        authorUrl = `https://www.pinterest.com/${handle}/`;
      } else if (sub.platform === 'bluesky') {
        authorUrl = `https://bsky.app/profile/${handle}`;
      } else if (sub.platform === 'mastodon') {
        if (handle && handle.includes('@')) {
          const [username, instance] = handle.split('@');
          if (username && instance) {
            authorUrl = `https://${instance}/@${username}`;
          }
        }
      } else if (sub.platform === 'substack') {
        // Substack: handle is subdomain
        authorUrl = `https://${handle}.substack.com`;
      } else if (sub.platform === 'tumblr') {
        // Tumblr: handle is subdomain
        authorUrl = `https://${handle}.tumblr.com`;
      } else if (sub.platform === 'naver-webtoon') {
        // Naver Webtoon: handle is titleId
        const titleId = sub.naverWebtoonOptions?.titleId || handle;
        authorUrl = `https://comic.naver.com/webtoon/list?titleId=${titleId}`;
      } else if (sub.platform === 'webtoons') {
        // WEBTOON Global: handle is title_no
        const titleNo = sub.naverWebtoonOptions?.titleId || handle;
        // Use generic URL format since we don't know the language/genre path
        authorUrl = sub.target?.profileUrl || `https://www.webtoons.com/episodeList?titleNo=${titleNo}`;
      }
    }

    // Generate key - try multiple formats to ensure matching
    const key = generateAuthorKey(authorUrl, sub.name, sub.platform as Platform);

    // Parse lastRunAt date
    const lastRunAt = sub.stats?.lastRunAt ? new Date(sub.stats.lastRunAt) : null;

    // Format schedule from cron expression
    let schedule = formatCronSchedule(sub.schedule);

    // Extract maxPostsPerRun and redditOptions from subscription
    const maxPostsPerRun = sub.options?.maxPostsPerRun;
    const redditOptions = sub.redditOptions ? {
      sortBy: sub.redditOptions.sortBy || 'New',
      sortByTime: sub.redditOptions.sortByTime || '',
      keyword: sub.redditOptions.keyword
    } : undefined;

    // For Naver subscriptions (both blog and cafe member)
    const isNaverSubscription = sub.platform === 'naver';
    const isNaverCafeMember = isNaverSubscription && handle?.startsWith('cafe:');

    // Parse display name and cafe name from sub.name if in format "Nickname (CafeName)"
    let naverDisplayName = sub.name || handle;
    let naverCafeName = sub.naverOptions?.cafeName || '';
    if (isNaverCafeMember && sub.name) {
      const match = sub.name.match(/^(.+?)\s*\((.+)\)$/);
      if (match) {
        naverDisplayName = match[1].trim(); // Extract nickname
        if (!naverCafeName) {
          naverCafeName = match[2].trim(); // Extract cafe name from parentheses
        }
      }
    }

    const displayAuthorName = isNaverCafeMember ? naverDisplayName : (handle || sub.name);
    // For Naver cafe members, show cafe name as handle (or hide raw handle)
    const displayHandle = isNaverCafeMember ? naverCafeName : handle;

    // Extract Naver options for all Naver subscriptions (blog and cafe member)
    // Defaults: 3 posts per run, 30 days backfill (last month)
    const naverCafeOptions = isNaverSubscription ? {
      maxPostsPerRun: sub.options?.maxPostsPerRun ?? 3,
      backfillDays: sub.options?.backfillDays ?? 30,
      keyword: sub.naverOptions?.keyword
    } : undefined;

    // Determine fetch mode:
    // - 'local' for Naver Cafe with localFetchRequired or naver-webtoon
    // - 'hybrid' for Brunch and Naver Blog (Worker detects via RSS, Plugin fetches content)
    // - 'cloud' for everything else
    const isNaverCafe = isNaverSubscription && (
      handle?.startsWith('cafe:') ||
      sub.naverOptions?.subscriptionType === 'cafe-member'
    );
    const isNaverBlog = isNaverSubscription && sub.naverOptions?.subscriptionType === 'blog';

    const fetchMode: 'local' | 'cloud' | 'hybrid' =
      // Naver Cafe (requires cookies) = local mode
      (isNaverCafe && sub.naverOptions?.localFetchRequired)
        ? 'local'
        // Naver Blog = hybrid mode (Worker detects via RSS, Plugin fetches content)
        : isNaverBlog
          ? 'hybrid'
          // Brunch = hybrid mode
          : sub.platform === 'brunch'
            ? 'hybrid'
            // Naver Webtoon = cloud mode (Worker API handles everything)
            : 'cloud';

    // For Naver Webtoon / WEBTOON Global subscriptions
    const isNaverWebtoon = sub.platform === 'naver-webtoon';
    const isWebtoonsGlobal = sub.platform === 'webtoons';
    const isWebtoonPlatform = isNaverWebtoon || isWebtoonsGlobal;

    // Build webtoonInfo from appropriate options based on platform
    let webtoonInfo: AuthorData['webtoonInfo'] | undefined;
    if (isNaverWebtoon && sub.naverWebtoonOptions) {
      webtoonInfo = {
        titleId: sub.naverWebtoonOptions.titleId || handle,
        titleName: sub.naverWebtoonOptions.titleName || sub.name || '',
        publishDay: sub.naverWebtoonOptions.publishDay || '',
        publishDayCode: sub.naverWebtoonOptions.publishDayCode,
        finished: sub.naverWebtoonOptions.finished || false,
        thumbnailUrl: sub.naverWebtoonOptions.thumbnailUrl,
        genre: sub.naverWebtoonOptions.genre,
        totalEpisodes: sub.naverWebtoonOptions.totalEpisodes,
        archivedEpisodes: sub.naverWebtoonOptions.archivedEpisodes,
      };
    } else if (isWebtoonsGlobal && sub.webtoonsOptions) {
      // WEBTOON Global uses webtoonsOptions with different field names
      webtoonInfo = {
        titleId: sub.webtoonsOptions.titleNo || handle,
        titleName: sub.webtoonsOptions.seriesTitle || sub.name || '',
        publishDay: sub.webtoonsOptions.updateDay || '', // e.g., "SATURDAY"
        publishDayCode: sub.webtoonsOptions.updateDay?.toLowerCase().slice(0, 3), // e.g., "sat"
        finished: false, // Not available in webtoonsOptions
        thumbnailUrl: sub.webtoonsOptions.thumbnailUrl,
        genre: sub.webtoonsOptions.genre ? [sub.webtoonsOptions.genre] : undefined,
        totalEpisodes: undefined,
        archivedEpisodes: undefined,
      };
    } else if (isWebtoonPlatform) {
      // Fallback for webtoon platforms without specific options
      webtoonInfo = {
        titleId: handle,
        titleName: sub.name || '',
        publishDay: '',
        publishDayCode: undefined,
        finished: false,
        thumbnailUrl: undefined,
        genre: undefined,
        totalEpisodes: undefined,
        archivedEpisodes: undefined,
      };
    }

    map.set(key, {
      subscriptionId: sub.id,
      status: 'subscribed',
      lastRunAt,
      schedule,
      maxPostsPerRun,
      redditOptions,
      naverCafeOptions,
      fetchMode,
      // Author info for subscription-only entries
      authorName: displayAuthorName,
      authorUrl,
      handle: displayHandle,
      platform: sub.platform as Platform,
      // Include Naver cafe member avatar if available
      ...(isNaverCafeMember && sub.naverOptions?.memberAvatar && {
        authorAvatar: sub.naverOptions.memberAvatar
      }),
      // Include X (Twitter) avatar and bio from xMetadata if available
      ...(sub.platform === 'x' && sub.xMetadata?.avatar && {
        authorAvatar: sub.xMetadata.avatar
      }),
      ...(sub.platform === 'x' && sub.xMetadata?.bio && {
        bio: sub.xMetadata.bio
      }),
      // Include webtoon-specific info for naver-webtoon / webtoons subscriptions
      ...(isWebtoonPlatform && webtoonInfo && {
        isWebtoon: true,
        webtoonInfo,
        // Use webtoon thumbnail as avatar
        ...(webtoonInfo.thumbnailUrl && { authorAvatar: webtoonInfo.thumbnailUrl })
      })
    });

    // Also add key with just handle-based URL for better matching (platform-specific)
    let handleBasedUrl: string;
    if (sub.platform === 'x') {
      handleBasedUrl = `https://x.com/${handle}`;
    } else if (sub.platform === 'facebook') {
      handleBasedUrl = `https://www.facebook.com/${handle}/`;
    } else if (sub.platform === 'reddit') {
      handleBasedUrl = `https://www.reddit.com/r/${handle}/`;
    } else if (sub.platform === 'tiktok') {
      handleBasedUrl = `https://www.tiktok.com/@${handle}`;
    } else if (sub.platform === 'pinterest') {
      handleBasedUrl = `https://www.pinterest.com/${handle}/`;
    } else if (sub.platform === 'bluesky') {
      handleBasedUrl = `https://bsky.app/profile/${handle}`;
    } else if (sub.platform === 'mastodon') {
      // Mastodon: use profileUrl or construct from federated handle
      if (sub.profileUrl) {
        handleBasedUrl = sub.profileUrl;
      } else if (handle && handle.includes('@')) {
        const [username, instance] = handle.split('@');
        handleBasedUrl = username && instance ? `https://${instance}/@${username}` : '';
      } else {
        handleBasedUrl = '';
      }
    } else if (sub.platform === 'youtube') {
      // YouTube: use same logic as authorUrl (handle-based or channel ID)
      const cleanHandle = (handle || '').replace(/^@/, '');
      if (cleanHandle.toUpperCase().startsWith('UC') && cleanHandle.length === 24) {
        handleBasedUrl = `https://www.youtube.com/channel/${cleanHandle}`;
      } else if (cleanHandle) {
        handleBasedUrl = `https://www.youtube.com/@${cleanHandle}`;
      } else {
        handleBasedUrl = '';
      }
    } else if (sub.platform === 'linkedin') {
      handleBasedUrl = `https://www.linkedin.com/in/${handle}/`;
    } else if (sub.platform === 'instagram') {
      handleBasedUrl = `https://www.instagram.com/${handle}/`;
    } else if (sub.platform === 'substack') {
      handleBasedUrl = `https://${handle}.substack.com`;
    } else if (sub.platform === 'tumblr') {
      handleBasedUrl = `https://${handle}.tumblr.com`;
    } else if (sub.platform === 'naver-webtoon') {
      // Naver Webtoon: handle is titleId
      handleBasedUrl = `https://comic.naver.com/webtoon/list?titleId=${handle}`;
    } else if (sub.platform === 'webtoons') {
      // WEBTOON Global: handle is title_no
      handleBasedUrl = sub.target?.profileUrl || `https://www.webtoons.com/episodeList?titleNo=${handle}`;
    } else {
      // Unknown platform - skip secondary key
      handleBasedUrl = '';
    }
    const handleKey = generateAuthorKey(handleBasedUrl, sub.name, sub.platform as Platform);
    if (handleKey !== key) {
      map.set(handleKey, {
        subscriptionId: sub.id,
        status: 'subscribed',
        lastRunAt,
        schedule,
        maxPostsPerRun,
        redditOptions,
        naverCafeOptions,
        fetchMode,
        // Author info for subscription-only entries
        authorName: handle || sub.name,
        authorUrl: handleBasedUrl,
        handle,
        platform: sub.platform as Platform,
        // Include Naver cafe member avatar if available
        ...(isNaverCafeMember && sub.naverOptions?.memberAvatar && {
          authorAvatar: sub.naverOptions.memberAvatar
        }),
        // Include X (Twitter) avatar and bio from xMetadata if available
        ...(sub.platform === 'x' && sub.xMetadata?.avatar && {
          authorAvatar: sub.xMetadata.avatar
        }),
        ...(sub.platform === 'x' && sub.xMetadata?.bio && {
          bio: sub.xMetadata.bio
        }),
        // Include webtoon-specific info for naver-webtoon subscriptions
        ...(isNaverWebtoon && {
          isWebtoon: true,
          webtoonInfo
        })
      });
    }

  }

  return map;
}

/**
 * Load authors from vault with subscription status
 * Performance optimization: Skip full reload if cached data exists and file count unchanged
 *
 * @param forceRefresh - Force reload from vault, ignoring cache
 */
async function loadAuthors(forceRefresh = false): Promise<void> {
  const loadStart = nowMs();
  let stage = 'init';
  let watchdogIntervalId: ReturnType<typeof setInterval> | null = null;
  let watchdogTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Concurrent guard — prevents duplicate scans when TimelineContainer remounts AuthorCatalog rapidly
  if (isAuthorLoadInProgress()) {
    debugWarn('loadAuthors skipped (concurrent load in progress)', { forceRefresh });
    const cached = get(store.state);
    if (cached.hasVaultSnapshot) {
      store.setLoading(false);
    }
    return;
  }

  const cachedState = get(store.state);

  // Performance optimization: If we already have authors cached, don't rescan on remount.
  // TimelineContainer currently remounts AuthorCatalog on search/filter changes, and any synchronous
  // work here (like file counting) can look like an app freeze in large vaults.
  if (cachedState.hasVaultSnapshot && !forceRefresh) {
    debugLog('loadAuthors using cache', {
      cachedAuthors: cachedState.authors.length,
      hasVaultSnapshot: cachedState.hasVaultSnapshot
    });
    store.setLoading(false);
    return;
  }

  const myGeneration = startAuthorLoad();
  stage = 'scan:init';
  debugLog('loadAuthors start', {
    generation: myGeneration,
    forceRefresh,
    archivePath,
    cachedAuthors: cachedState.authors.length,
    hasVaultSnapshot: cachedState.hasVaultSnapshot,
  });

  if (AUTHOR_CATALOG_DEBUG) {
    watchdogIntervalId = setInterval(() => {
      debugLog('watchdog', {
        stage,
        elapsedMs: Math.round(nowMs() - loadStart),
        generation: myGeneration,
        inProgress: isAuthorLoadInProgress(),
      });
    }, 5000);
    watchdogTimeoutId = setTimeout(() => {
      debugWarn('watchdog timeout (still running)', {
        stage,
        elapsedMs: Math.round(nowMs() - loadStart),
        generation: myGeneration,
        inProgress: isAuthorLoadInProgress(),
      });
    }, 60000);
  }

  loadingMessage = 'Scanning vault for authors...';
  store.setLoading(true);

  try {
    const scanStart = nowMs();
    stage = 'scan:running';
    const scanner = new AuthorVaultScanner({
      app,
      archivePath,
      includeEmbeddedArchives: true, // Extract authors from embedded archives in user posts
      // Keep Obsidian responsive during large scans.
      yieldToUi: true,
      batchSize: 20
    });

    // Performance optimization: Run vault scan and API fetch in parallel (API: 15s timeout)
    stage = 'scan:await+subscriptions';
    const fetchWithTimeout = fetchSubscriptions
      ? Promise.race([
          fetchSubscriptions(),
          new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 15000))
        ])
      : Promise.resolve([]);

    const [scanResult, subscriptions] = await Promise.all([scanner.scanVault(), fetchWithTimeout]);
    stage = 'scan:done';
    debugLog('scanVault complete', {
      durationMs: Math.round(nowMs() - scanStart),
      rawAuthors: scanResult.authors.length,
      errors: scanResult.errors.length,
      subscriptions: Array.isArray(subscriptions) ? subscriptions.length : 0
    });

    // Stale check — don't overwrite newer results if a newer scan started
    if (isAuthorLoadInProgress() && myGeneration !== getAuthorLoadGeneration()) {
      console.log(
        '[AuthorCatalog] loadAuthors STALE — discarding results (generation',
        myGeneration,
        'superseded by',
        getAuthorLoadGeneration(),
        ')'
      );
      return;
    }

    const meaningfulErrors = scanResult.errors.filter(
      (e) => e.type !== 'missing_frontmatter' && e.type !== 'invalid_platform'
    );

    if (meaningfulErrors.length > 0) {
      console.warn('[AuthorCatalog] Scan errors', {
        total: meaningfulErrors.length,
        sample: meaningfulErrors.slice(0, 3)
      });
    }

    // Build subscription map from API response
    stage = 'subscriptions:map';
    let subscriptionMap: SubscriptionMap = new Map();
    try {
      subscriptionMap = buildSubscriptionMapFromApi(subscriptions);
    } catch (err) {
      console.warn('[AuthorCatalog] Failed to build subscription map:', err);
    }
    debugLog('subscriptionMap built', { size: subscriptionMap.size });

    // Deduplicate authors with subscription info
    const deduplicator = new AuthorDeduplicator();
    stage = 'dedupe:start';
    loadingMessage = 'Building author index...';
    const dedupeStart = nowMs();
    const dedupeResult = await deduplicator.deduplicateAsync(scanResult.authors, subscriptionMap, {
      yieldToUi: true,
      chunkSize: 2000,
      skipFinalSort: true,
      onStage: (dedupeStage) => {
        stage = `dedupe:${dedupeStage}`;
        debugLog('dedupe stage', { stage: dedupeStage });
        switch (dedupeStage) {
          case 'accumulate':
            loadingMessage = 'Building author index...';
            break;
          case 'finalize':
            loadingMessage = 'Finalizing author index...';
            break;
          case 'subscriptions':
            loadingMessage = 'Merging subscriptions...';
            break;
          case 'merge':
            loadingMessage = 'Merging author entries...';
            break;
          case 'sort':
            loadingMessage = 'Sorting authors...';
            break;
          default:
            loadingMessage = 'Building author index...';
        }
      },
      onProgress: (processed, total) => {
        // Keep the UI informative during large scans.
        // Update only at chunk boundaries (controlled by chunkSize).
        loadingMessage = `Building author index... (${processed}/${total})`;
        debugLog('dedupe progress', { processed, total });
      }
    });
    stage = 'dedupe:done';
    debugLog('dedupe complete', {
      durationMs: Math.round(nowMs() - dedupeStart),
      resultAuthors: dedupeResult.authors.length,
      duplicatesMerged: dedupeResult.duplicatesMerged,
      totalProcessed: dedupeResult.totalProcessed,
    });

    // Render first, then do any optional slow enrichments in the background
    stage = 'store:setAuthors';
    store.setAuthorsFromVault(dedupeResult.authors);
    stage = 'store:setLoading(false)';
    store.setLoading(false);
    stage = 'done';
    debugLog('loadAuthors done', { durationMs: Math.round(nowMs() - loadStart) });

    if (AUTHOR_CATALOG_DEBUG) {
      // If the app "freezes" on the spinner, these timers won't fire.
      queueMicrotask(() => {
        debugLog('post-load microtask', {
          isLoading,
          authors: authors.length,
          filtered: filteredAuthors.length,
          displayed: displayedAuthors.length
        });
      });
      setTimeout(() => {
        debugLog('post-load timeout(0)', {
          isLoading,
          authors: authors.length,
          filtered: filteredAuthors.length,
          displayed: displayedAuthors.length
        });
      }, 0);
      setTimeout(() => {
        debugLog('post-load timeout(200ms)', {
          isLoading,
          authors: authors.length,
          filtered: filteredAuthors.length,
          displayed: displayedAuthors.length
        });
      }, 200);
    }

    // Optional: subscription-only orphan avatar recovery (can be expensive in large subscription lists).
    // Run in background with a hard cap and time budget so the UI never gets stuck on the spinner.
    // Schedule on a later tick so the DOM can paint the author list first.
    setTimeout(() => void (async () => {
      const AVATAR_BATCH_SIZE = 10;
      const MAX_CANDIDATES = 200;
      const TIME_BUDGET_MS = 1500;
      const start = Date.now();

      const baseAuthors = dedupeResult.authors;
      const avatarCandidates = baseAuthors
        .map((author, index) => ({ author, index }))
        .filter(({ author }) => author.archiveCount === 0 && !author.localAvatar && author.handle)
        .slice(0, MAX_CANDIDATES);

      if (avatarCandidates.length === 0) return;
      debugLog('orphan avatar recovery start', { candidates: avatarCandidates.length });

      const updated = [...baseAuthors];
      let didUpdate = false;

      for (let i = 0; i < avatarCandidates.length; i += AVATAR_BATCH_SIZE) {
        // Abort if a newer load started (force refresh).
        if (getAuthorLoadGeneration() !== myGeneration) return;
        if (Date.now() - start > TIME_BUDGET_MS) return;

        const batch = avatarCandidates.slice(i, i + AVATAR_BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async ({ author, index }) => {
            const avatarPath = await findExistingAvatar(author.platform, author.handle!);
            return { index, avatarPath };
          })
        );

        for (const { index, avatarPath } of results) {
          if (avatarPath && updated[index]) {
            updated[index] = { ...updated[index]!, localAvatar: avatarPath };
            didUpdate = true;
          }
        }

        // Yield to UI between batches.
        await new Promise<void>((resolve) => {
          // rAF can be paused in some Electron/Obsidian states; keep a timeout fallback to avoid deadlock.
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            resolve();
          };

          const timeoutId = setTimeout(finish, 50);

          if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => {
              clearTimeout(timeoutId);
              finish();
            });
            return;
          }

          // Timeout fallback already scheduled
        });
      }

      if (didUpdate) {
        store.setAuthors(updated);
        debugLog('orphan avatar recovery applied', { updated: true });
      }
      debugLog('orphan avatar recovery done', { didUpdate });
    })(), 0);
  } catch (err) {
    const error = err instanceof Error ? err : new Error('Failed to load authors');
    store.setError(error);
    console.error('[AuthorCatalog] Error loading authors:', err);
  } finally {
    if (watchdogIntervalId) clearInterval(watchdogIntervalId);
    if (watchdogTimeoutId) clearTimeout(watchdogTimeoutId);
    finishAuthorLoad(myGeneration);
  }
}

/**
 * Handle subscribe action
 */
async function handleSubscribe(author: AuthorCatalogEntry, options: AuthorSubscribeOptions): Promise<void> {
  if (!onSubscribe) return;

  try {
    const subscription = await onSubscribe(author, options);

    // Update store with new status and subscription ID
    const subscriptionId = subscription?.id || undefined;
    store.updateAuthorStatus(author.authorUrl, author.platform, 'subscribed', subscriptionId, author.authorName);

    // Parse schedule from API response
    let schedule = subscription?.schedule
      ? formatCronSchedule(subscription.schedule)
      : `Daily at ${String(options.startHour || 0).padStart(2, '0')}:00 (${options.timezone || 'UTC'})`;

    // Extract subscription options from API response
    const maxPostsPerRun = subscription?.options?.maxPostsPerRun || options.maxPostsPerRun;
    const redditOptions = subscription?.redditOptions || options.redditOptions;

    // Update the author object with new subscription ID and schedule
    if (subscription && subscription.id) {
      // Update the author in the authors array (source of truth)
      const updatedAuthors = authors.map(a => {
        if (a.platform === author.platform && a.authorUrl === author.authorUrl) {
          return {
            ...a,
            subscriptionId: subscription.id,
            status: 'subscribed' as const,
            schedule,
            maxPostsPerRun,
            redditOptions
          };
        }
        return a;
      });

      // Update the store with the new authors array
      store.setAuthors(updatedAuthors);

      // Also update the passed author object for immediate UI updates
      author.subscriptionId = subscription.id;
      author.status = 'subscribed';
      author.schedule = schedule;
      author.maxPostsPerRun = maxPostsPerRun;
      author.redditOptions = redditOptions;
    }
  } catch (err) {
    store.updateAuthorStatus(author.authorUrl, author.platform, 'error');
    // Re-throw so AuthorRow can show proper error notice
    throw err;
  }
}

/**
 * Handle unsubscribe action
 */
async function handleUnsubscribe(author: AuthorCatalogEntry): Promise<void> {
  if (!onUnsubscribe) return;

  try {
    await onUnsubscribe(author);

    // Update store with new status
    store.updateAuthorStatus(author.authorUrl, author.platform, 'not_subscribed', undefined);

    // Update the author in the authors array (source of truth)
    const updatedAuthors = authors.map(a => {
      if (a.platform === author.platform && a.authorUrl === author.authorUrl) {
        return { ...a, subscriptionId: undefined, status: 'not_subscribed' as const };
      }
      return a;
    });

    // Update the store with the new authors array
    store.setAuthors(updatedAuthors);

    // Clear the subscription ID from the passed author object
    author.subscriptionId = undefined;
    author.status = 'not_subscribed';
  } catch (err) {
    // Re-throw so AuthorRow can show proper error notice
    throw err;
  }
}

/**
 * Handle view archives action
 */
function handleViewArchives(author: AuthorCatalogEntry): void {
  if (onViewArchives) {
    onViewArchives(author);
  }
}

/**
 * Refresh catalog (force reload from vault)
 */
async function refresh(): Promise<void> {
  await loadAuthors(true); // Force refresh
}

/**
 * Clear all filters
 */
function clearFilters(): void {
  filterPlatform = ['facebook', 'instagram', 'x', 'threads', 'linkedin', 'tiktok'] as Platform[];
  filterSearchQuery = '';
  filterSortBy = 'lastRun'; // Default to descending
}

// ============================================================================
// Lifecycle
// ============================================================================

// Track if component has been initialized
let isInitialized = $state(false);

// Load authors only on first mount
// Note: We don't reset the store on cleanup to preserve cache for fast UI transitions
$effect(() => {
  if (!isInitialized) {
    isInitialized = true;
    loadAuthors();
  }

  // Intentionally not resetting store on cleanup to preserve cache
  // This allows instant re-display when switching between Timeline and Author Catalog
  return () => {
    // store.reset() removed for performance - cache is preserved
  };
});

// ============================================================================
// Constants
// ============================================================================

const platformNames: Partial<Record<Platform | 'all', string>> = {
  all: 'All Platforms',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  x: 'X (Twitter)',
  threads: 'Threads',
  youtube: 'YouTube',
  reddit: 'Reddit',
  pinterest: 'Pinterest',
  substack: 'Substack',
  tumblr: 'Tumblr',
  mastodon: 'Mastodon',
  bluesky: 'Bluesky',
  googlemaps: 'Google Maps',
  velog: 'Velog',
  podcast: 'Podcast',
  blog: 'Blog',
  medium: 'Medium',
  naver: 'Naver',
  'naver-webtoon': 'Webtoon',
  webtoons: 'Webtoon',
  brunch: 'Brunch',
  post: 'Posts',
};
</script>

<div class="author-catalog">
  <!-- Header - Only show if not hidden -->
  {#if !hideHeader}
    <div class="catalog-header">
      <div class="header-title">
        <h3>Subscriptions</h3>
        <span class="stats">
          {subscriptionStats.total} authors
          {#if subscriptionStats.subscribed > 0}
            <span class="subscribed-badge">{subscriptionStats.subscribed} subscribed</span>
          {/if}
        </span>
      </div>
      {#if !isLoading && platformCounts.all > 0}
        <div class="scan-meta">
          <span class="meta-pill">{platformCounts.all} found</span>
          {#if error}
            <span class="meta-pill error-pill">scan error</span>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Filter Bar - Only show if not hidden -->
  {#if !hideFilters}
    <div class="filter-bar">
      <!-- Platform Filter -->
      <select
        class="platform-filter"
        bind:value={filterPlatform}
        aria-label="Filter by platform"
      >
        {#each Object.entries(platformCounts) as [platform, count]}
          {#if count > 0 || platform === 'all'}
            <option value={platform}>
              {platformNames[platform as Platform | 'all'] ?? platform} ({count})
            </option>
          {/if}
        {/each}
      </select>

      <!-- Search Input -->
      <div class="search-wrapper">
        <input
          type="text"
          class="search-input"
          placeholder="Search by name or handle..."
          bind:value={filterSearchQuery}
          aria-label="Search authors"
        />
        {#if filterSearchQuery}
          <button
            class="clear-search"
            onclick={() => filterSearchQuery = ''}
            aria-label="Clear search"
          >
            &times;
          </button>
        {/if}
      </div>

      <!-- Sort Dropdown -->
      <select
        class="sort-filter"
        bind:value={filterSortBy}
        aria-label="Sort by"
      >
        <option value="lastSeen">Latest Seen</option>
        <option value="nameAsc">Name A→Z</option>
        <option value="nameDesc">Name Z→A</option>
        <option value="archiveCount">Most Archives</option>
      </select>
    </div>
  {/if}

  <!-- Content Area -->
  <div class="catalog-content" bind:this={contentEl} onscroll={handleScroll}>
    {#if isLoading}
      <div class="loading-state">
        <div class="spinner"></div>
        <p>{loadingMessage}</p>
      </div>
    {:else if error}
      <div class="error-state">
        <p class="error-message">{error.message}</p>
        <button class="retry-btn" onclick={refresh}>Retry</button>
      </div>
    {:else if isEmpty}
      <div class="empty-state">
        <p>No archived posts found.</p>
        <p class="hint">Archive some social media posts first to see authors here.</p>
      </div>
    {:else if hasNoResults}
      <div class="no-results">
        <p>No authors match your filters.</p>
        <button class="clear-filters-btn" onclick={clearFilters}>Clear Filters</button>
      </div>
    {:else}
      {#if isIncrementalRendering && displayedAuthors.length === 0 && filteredAuthors.length > 0}
        <div class="loading-state">
          <div class="spinner"></div>
          <p>Rendering authors...</p>
        </div>
      {:else}
        <div class="author-list">
          {#each displayedAuthors as author (generateAuthorKey(author.authorUrl, author.authorName, author.platform) + ':' + author.status)}
            {#if AUTHOR_CATALOG_MINIMAL_RENDER}
              <div class="author-row-minimal">
                <div class="author-row-minimal__name">{author.authorName}</div>
                <div class="author-row-minimal__meta">
                  <span class="pill">{author.platform}</span>
                  {#if author.handle}
                    <span class="pill">{author.handle}</span>
                  {/if}
                  <span class="pill">{author.archiveCount} archives</span>
                  <span class="pill">{author.status}</span>
                </div>
              </div>
            {:else}
              <AuthorRow
                {app}
                {author}
                onSubscribe={handleSubscribe}
                {onUpdateSubscription}
                onUnsubscribe={handleUnsubscribe}
                {onManualRun}
                {onViewHistory}
                onViewArchives={handleViewArchives}
              />
            {/if}
          {/each}

          {#if displayedAuthors.length < filteredAuthors.length}
            <div class="load-more-hint">
              Showing {displayedAuthors.length} of {filteredAuthors.length}. Scroll to load more.
            </div>
          {/if}
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .author-catalog {
    display: flex;
    flex-direction: column;
    /* height: 100% removed - was causing element to overlap header */
    background: var(--background-primary);
    color: var(--text-normal);
  }

  .catalog-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .header-title {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .header-title h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .author-row-minimal {
    padding: 12px 12px;
    border-bottom: 1px solid var(--background-modifier-border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .author-row-minimal__name {
    font-weight: 600;
    color: var(--text-normal);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .author-row-minimal__meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .author-row-minimal__meta .pill {
    font-size: 11px;
    color: var(--text-muted);
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 999px;
    padding: 2px 8px;
  }

  .stats {
    font-size: 12px;
    color: var(--text-muted);
  }

  .subscribed-badge {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    padding: 2px 6px;
    border-radius: 10px;
    font-size: 11px;
    margin-left: 6px;
  }

  .scan-meta {
    display: flex;
    gap: 6px;
  }

  .meta-pill {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--background-modifier-border);
    color: var(--text-muted);
  }

  .error-pill {
    background: var(--background-modifier-error);
    color: var(--text-error);
  }

  .filter-bar {
    display: flex;
    gap: 8px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--background-modifier-border);
    flex-wrap: wrap;
  }

  .platform-filter,
  .sort-filter {
    padding: 6px 10px;
    min-width: 170px;
    border-radius: 6px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
    color: var(--text-normal);
    font-size: 13px;
    cursor: pointer;
    flex: 0 0 auto;
    appearance: none;
    background-image: linear-gradient(45deg, transparent 50%, var(--text-muted) 50%), linear-gradient(135deg, var(--text-muted) 50%, transparent 50%);
    background-position: calc(100% - 12px) calc(50% - 3px), calc(100% - 7px) calc(50% - 3px);
    background-size: 5px 5px, 5px 5px;
    background-repeat: no-repeat;
  }

  .platform-filter option,
  .sort-filter option {
    color: var(--text-normal);
    background: var(--background-primary);
  }

  .search-wrapper {
    flex: 1;
    min-width: 150px;
    position: relative;
  }

  .search-input {
    width: 100%;
    padding: 6px 28px 6px 10px;
    border-radius: 4px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 13px;
  }

  .search-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .clear-search {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 2px 4px;
  }

  .clear-search:hover {
    color: var(--text-normal);
  }

  .catalog-content {
    flex: 1;
    overflow-y: auto;
  }

  .loading-state,
  .error-state,
  .empty-state,
  .no-results {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    text-align: center;
    color: var(--text-muted);
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--background-modifier-border);
    border-top-color: var(--interactive-accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 12px;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .error-message {
    color: var(--text-error);
    margin-bottom: 12px;
  }

  .retry-btn,
  .clear-filters-btn {
    padding: 6px 16px;
    border-radius: 4px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
    color: var(--text-normal);
    cursor: pointer;
    font-size: 13px;
  }

  .retry-btn:hover,
  .clear-filters-btn:hover {
    background: var(--background-modifier-hover);
  }

  .hint {
    font-size: 12px;
    margin-top: 8px;
  }

  .author-list {
    padding: 8px 0;
  }

  .load-more-hint {
    padding: 12px 16px;
    text-align: center;
    color: var(--text-muted);
    font-size: 12px;
  }
</style>
