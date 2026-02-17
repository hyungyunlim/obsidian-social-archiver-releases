/**
 * AuthorCatalogController - Pure TypeScript orchestrator for Author Catalog
 *
 * Extracts all business logic from AuthorCatalog.svelte into a testable,
 * framework-agnostic controller. The Svelte component becomes a thin
 * presentation shell.
 *
 * Single Responsibility: Orchestrate author loading, subscription management,
 * and subscription map building.
 */

import type { App } from 'obsidian';
import type { Platform } from '@/types/post';
import type {
  AuthorCatalogEntry,
  AuthorSubscribeOptions,
} from '@/types/author-catalog';
import { AuthorVaultScanner } from '@/services/AuthorVaultScanner';
import { AuthorDeduplicator, generateAuthorKey, type SubscriptionMap } from '@/services/AuthorDeduplicator';
import {
  getLastKnownFileCount,
  setLastKnownFileCount,
  isAuthorLoadInProgress,
  startAuthorLoad,
  finishAuthorLoad,
  getAuthorLoadGeneration,
  type AuthorCatalogStoreAPI,
} from '@/services/AuthorCatalogStore';
import { get } from 'svelte/store';

// ============================================================================
// Types
// ============================================================================

/** Schedule input for formatCronSchedule */
export interface ScheduleInput {
  cron?: string;
  localCron?: string;
  timezone?: string;
}

export interface AuthorCatalogControllerConfig {
  app: App;
  archivePath: string;
  store: AuthorCatalogStoreAPI;
  fetchSubscriptions?: () => Promise<any[]>;
  onSubscribe?: (author: AuthorCatalogEntry, options: AuthorSubscribeOptions) => Promise<any>;
  onUnsubscribe?: (author: AuthorCatalogEntry) => Promise<void>;
}

// ============================================================================
// Pure Functions (exported for independent testing)
// ============================================================================

/**
 * Format cron schedule for display.
 * Handles both daily and weekly schedules, with UTC-to-local conversion.
 */
export function formatCronSchedule(schedule?: ScheduleInput): string {
  if (!schedule?.cron && !schedule?.localCron) {
    return 'No schedule';
  }

  const timezone = schedule.timezone || 'UTC';
  const cronParts = (schedule.localCron || schedule.cron || '').split(' ');

  if (cronParts.length < 5) {
    return 'Invalid schedule';
  }

  const hour = parseInt(cronParts[1]!) || 0;
  const weekday = cronParts[4]!;
  const formattedHour = String(hour).padStart(2, '0') + ':00';

  // Weekly schedule (specific weekday, not *)
  if (weekday !== '*') {
    const weekdayNum = parseInt(weekday);
    if (!isNaN(weekdayNum) && weekdayNum >= 0 && weekdayNum <= 6) {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dayName = dayNames[weekdayNum];
      return `Every ${dayName} at ${formattedHour}`;
    }
  }

  // Daily schedule — convert UTC cron to local timezone if no localCron
  if (!schedule.localCron && schedule.cron) {
    try {
      const utcDate = new Date();
      utcDate.setUTCHours(hour, 0, 0, 0);
      const formatter = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: false,
        timeZone: timezone,
      });
      const localTime = formatter.format(utcDate);
      return `Daily at ${localTime} (${timezone})`;
    } catch {
      return `Daily at ${formattedHour} (${timezone})`;
    }
  }

  return `Daily at ${formattedHour} (${timezone})`;
}

/**
 * Build subscription map from API response.
 *
 * Maps each subscription to one or two dedup keys (primary URL + handle-based URL)
 * so that AuthorDeduplicator can match them to vault-scanned authors.
 */
export function buildSubscriptionMapFromApi(subscriptions: any[]): SubscriptionMap {
  const map: SubscriptionMap = new Map();

  for (const sub of subscriptions) {
    if (!sub.enabled) continue;

    const handle = sub.handle || sub.target?.handle || sub.name;

    // --- Build platform-specific authorUrl ---
    let authorUrl = '';

    if (sub.platform === 'youtube') {
      const cleanHandle = (handle || '').replace(/^@/, '');
      if (cleanHandle.toUpperCase().startsWith('UC') && cleanHandle.length === 24) {
        authorUrl = `https://www.youtube.com/channel/${cleanHandle}`;
      } else if (cleanHandle) {
        authorUrl = `https://www.youtube.com/@${cleanHandle}`;
      }
    } else if (sub.platform === 'linkedin') {
      if (handle) {
        authorUrl = `https://www.linkedin.com/in/${handle}/`;
      }
    } else {
      authorUrl = sub.profileUrl || sub.target?.profileUrl || '';
    }

    // Generate URL from handle if not available
    if (!authorUrl) {
      authorUrl = buildAuthorUrlFromHandle(sub.platform, handle, sub);
    }

    const key = generateAuthorKey(authorUrl, sub.name, sub.platform as Platform);

    // Parse subscription metadata
    const lastRunAt = sub.stats?.lastRunAt ? new Date(sub.stats.lastRunAt) : null;
    const schedule = formatCronSchedule(sub.schedule);
    const maxPostsPerRun = sub.options?.maxPostsPerRun;
    const redditOptions = sub.redditOptions
      ? {
          sortBy: sub.redditOptions.sortBy || 'New',
          sortByTime: sub.redditOptions.sortByTime || '',
          keyword: sub.redditOptions.keyword,
        }
      : undefined;

    // Naver subscription detection
    const isNaverSubscription = sub.platform === 'naver';
    const isNaverCafeMember = isNaverSubscription && handle?.startsWith('cafe:');

    // Parse display name and cafe name
    let naverDisplayName = sub.name || handle;
    let naverCafeName = sub.naverOptions?.cafeName || '';
    if (isNaverCafeMember && sub.name) {
      const match = sub.name.match(/^(.+?)\s*\((.+)\)$/);
      if (match) {
        naverDisplayName = match[1].trim();
        if (!naverCafeName) {
          naverCafeName = match[2].trim();
        }
      }
    }

    const displayAuthorName = isNaverCafeMember ? naverDisplayName : (handle || sub.name);
    const displayHandle = isNaverCafeMember ? naverCafeName : handle;

    // Naver options (blog and cafe member)
    const naverCafeOptions = isNaverSubscription
      ? {
          maxPostsPerRun: sub.options?.maxPostsPerRun ?? 3,
          backfillDays: sub.options?.backfillDays ?? 30,
          keyword: sub.naverOptions?.keyword,
        }
      : undefined;

    // Determine fetch mode
    const fetchMode = determineFetchMode(sub, handle, isNaverSubscription);

    // Build webtoon info
    const webtoonInfo = buildWebtoonInfo(sub, handle);
    const isWebtoonPlatform = sub.platform === 'naver-webtoon' || sub.platform === 'webtoons';

    // Build the subscription entry
    const entry = buildSubscriptionEntry({
      sub,
      subscriptionId: sub.id,
      lastRunAt,
      schedule,
      maxPostsPerRun,
      redditOptions,
      naverCafeOptions,
      fetchMode,
      displayAuthorName,
      authorUrl,
      displayHandle,
      isNaverCafeMember,
      isWebtoonPlatform,
      webtoonInfo,
    });

    map.set(key, entry);

    // Add secondary key with handle-based URL for better matching
    const handleBasedUrl = buildHandleBasedUrl(sub.platform, handle, sub);
    if (handleBasedUrl) {
      const handleKey = generateAuthorKey(handleBasedUrl, sub.name, sub.platform as Platform);
      if (handleKey !== key) {
        const handleEntry = buildSubscriptionEntry({
          sub,
          subscriptionId: sub.id,
          lastRunAt,
          schedule,
          maxPostsPerRun,
          redditOptions,
          naverCafeOptions,
          fetchMode,
          displayAuthorName: handle || sub.name,
          authorUrl: handleBasedUrl,
          displayHandle: handle,
          isNaverCafeMember,
          isWebtoonPlatform: sub.platform === 'naver-webtoon',
          webtoonInfo,
        });
        map.set(handleKey, handleEntry);
      }
    }
  }

  return map;
}

// ============================================================================
// AuthorCatalogController Class
// ============================================================================

export class AuthorCatalogController {
  private config: AuthorCatalogControllerConfig;

  constructor(config: AuthorCatalogControllerConfig) {
    this.config = config;
  }

  /**
   * Update config (when props change at runtime).
   */
  updateConfig(partial: Partial<AuthorCatalogControllerConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /**
   * Count markdown files in the archive folder (fast check for cache invalidation).
   */
  countArchiveFiles(): number {
    const archiveFolder = this.config.app.vault.getFolderByPath(this.config.archivePath);
    if (!archiveFolder) return 0;

    let count = 0;
    const countFiles = (folder: any) => {
      for (const child of folder.children) {
        if (child.children) {
          countFiles(child);
        } else if (child.extension === 'md') {
          count++;
        }
      }
    };
    countFiles(archiveFolder);
    return count;
  }

  /**
   * Find existing avatar file for a platform/handle combination.
   * Uses the same file naming convention as AuthorAvatarService.
   */
  async findExistingAvatar(platform: string, handle: string): Promise<string | null> {
    if (!handle) return null;

    const sanitizedHandle = handle
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, '_')
      .trim()
      .slice(0, 50);

    const basePath = 'attachments/social-archives/authors';
    const extensions = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic'];

    for (const ext of extensions) {
      const path = `${basePath}/${platform}-${sanitizedHandle}.${ext}`;
      // Prefer Obsidian's in-memory vault index to avoid potentially blocking filesystem calls.
      const file = this.config.app.vault.getAbstractFileByPath(path);
      if (file) return path;
    }

    return null;
  }

  /**
   * Load authors from vault with subscription status.
   *
   * Performance optimization: Skip full reload if cached data exists and
   * file count unchanged.
   *
   * @returns The loaded authors array, or undefined if skipped/stale.
   */
  async loadAuthors(forceRefresh = false): Promise<AuthorCatalogEntry[] | undefined> {
    const { store } = this.config;

    // Concurrent guard — prevents duplicate vault scans across instances
    if (isAuthorLoadInProgress()) {
      console.debug('[AuthorCatalogController] loadAuthors SKIPPED (concurrent load in progress)');
      const cachedState = get(store.state);
      if (cachedState.hasVaultSnapshot) {
        return cachedState.authors;
      }
      return undefined;
    }

    const cachedState = get(store.state);

    // Smart cache invalidation
    const currentFileCount = this.countArchiveFiles();
    const lastFileCount = getLastKnownFileCount();
    const fileCountChanged = currentFileCount !== lastFileCount;

    // Cache hit — skip full reload
    if (cachedState.hasVaultSnapshot && !forceRefresh && !fileCountChanged) {
      store.setLoading(false);
      return cachedState.authors;
    }

    const myGeneration = startAuthorLoad();
    store.setLoading(true);

    try {
      const scanner = new AuthorVaultScanner({
        app: this.config.app,
        archivePath: this.config.archivePath,
        includeEmbeddedArchives: true,
      });

      // Run vault scan and API fetch in parallel (15s timeout on API)
      const fetchWithTimeout = this.config.fetchSubscriptions
        ? Promise.race([
            this.config.fetchSubscriptions(),
            new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 15000)),
          ])
        : Promise.resolve([]);

      const [scanResult, subscriptions] = await Promise.all([
        scanner.scanVault(),
        fetchWithTimeout,
      ]);

      // Stale check
      if (isAuthorLoadInProgress() && myGeneration !== getAuthorLoadGeneration()) {
        console.debug(
          '[AuthorCatalogController] loadAuthors STALE — discarding results (generation',
          myGeneration,
          'superseded by',
          getAuthorLoadGeneration(),
          ')'
        );
        return undefined;
      }

      setLastKnownFileCount(scanResult.totalFilesScanned);

      // Build subscription map
      let subscriptionMap: SubscriptionMap = new Map();
      try {
        subscriptionMap = buildSubscriptionMapFromApi(subscriptions);
      } catch (err) {
        console.warn('[AuthorCatalogController] Failed to build subscription map:', err);
      }

      // Deduplicate authors with subscription info
      const deduplicator = new AuthorDeduplicator();
      const dedupeResult = deduplicator.deduplicate(scanResult.authors, subscriptionMap);

      // Find orphaned avatar files for subscription-only authors (batched)
      const AVATAR_BATCH_SIZE = 10;
      const authorsWithAvatars = [...dedupeResult.authors];
      const avatarCandidates = authorsWithAvatars
        .map((author, index) => ({ author, index }))
        .filter(({ author }) => author.archiveCount === 0 && !author.localAvatar && author.handle);

      for (let i = 0; i < avatarCandidates.length; i += AVATAR_BATCH_SIZE) {
        const batch = avatarCandidates.slice(i, i + AVATAR_BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async ({ author, index }) => {
            const avatarPath = await this.findExistingAvatar(author.platform, author.handle!);
            return { index, avatarPath };
          })
        );
        for (const { index, avatarPath } of results) {
          if (avatarPath) {
            authorsWithAvatars[index] = { ...authorsWithAvatars[index]!, localAvatar: avatarPath };
          }
        }
      }

      store.setAuthorsFromVault(authorsWithAvatars);
      store.setLoading(false);
      return authorsWithAvatars;
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error('Failed to load authors');
      store.setError(errorObj);
      console.error('[AuthorCatalogController] Error loading authors:', err);
      throw errorObj;
    } finally {
      finishAuthorLoad(myGeneration);
    }
  }

  /**
   * Subscribe to an author.
   * Calls the onSubscribe callback, then updates the store.
   */
  async subscribe(author: AuthorCatalogEntry, options: AuthorSubscribeOptions): Promise<void> {
    const { store, onSubscribe } = this.config;
    if (!onSubscribe) return;

    try {
      const subscription = await onSubscribe(author, options);

      const subscriptionId = subscription?.id || undefined;
      store.updateAuthorStatus(author.authorUrl, author.platform, 'subscribed', subscriptionId, author.authorName);

      const schedule = subscription?.schedule
        ? formatCronSchedule(subscription.schedule)
        : `Daily at ${String(options.startHour || 0).padStart(2, '0')}:00 (${options.timezone || 'UTC'})`;

      const maxPostsPerRun = subscription?.options?.maxPostsPerRun || options.maxPostsPerRun;
      const redditOptions = subscription?.redditOptions || options.redditOptions;

      if (subscription && subscription.id) {
        const currentAuthors = get(store.state).authors;
        const updatedAuthors = currentAuthors.map((a) => {
          if (a.platform === author.platform && a.authorUrl === author.authorUrl) {
            return {
              ...a,
              subscriptionId: subscription.id as string,
              status: 'subscribed' as const,
              schedule,
              maxPostsPerRun,
              redditOptions,
            };
          }
          return a;
        });
        store.setAuthors(updatedAuthors);
      }
    } catch (err) {
      store.updateAuthorStatus(author.authorUrl, author.platform, 'error');
      throw err;
    }
  }

  /**
   * Unsubscribe from an author.
   * Calls the onUnsubscribe callback, then updates the store.
   */
  async unsubscribe(author: AuthorCatalogEntry): Promise<void> {
    const { store, onUnsubscribe } = this.config;
    if (!onUnsubscribe) return;

    try {
      await onUnsubscribe(author);

      store.updateAuthorStatus(author.authorUrl, author.platform, 'not_subscribed', undefined);

      const currentAuthors = get(store.state).authors;
      const updatedAuthors = currentAuthors.map((a) => {
        if (a.platform === author.platform && a.authorUrl === author.authorUrl) {
          return { ...a, subscriptionId: null, status: 'not_subscribed' as const };
        }
        return a;
      });
      store.setAuthors(updatedAuthors);
    } catch (err) {
      throw err;
    }
  }
}

// ============================================================================
// Internal Helper Functions
// ============================================================================

/**
 * Build an author URL from handle when profileUrl is unavailable.
 */
function buildAuthorUrlFromHandle(platform: string, handle: string, sub: any): string {
  switch (platform) {
    case 'x':
      return `https://x.com/${handle}`;
    case 'facebook':
      return `https://www.facebook.com/${handle}/`;
    case 'reddit':
      return `https://www.reddit.com/r/${handle}/`;
    case 'instagram':
      return `https://www.instagram.com/${handle}/`;
    case 'tiktok':
      return `https://www.tiktok.com/@${handle}`;
    case 'linkedin':
      return `https://www.linkedin.com/in/${handle}/`;
    case 'pinterest':
      return `https://www.pinterest.com/${handle}/`;
    case 'bluesky':
      return `https://bsky.app/profile/${handle}`;
    case 'mastodon':
      if (handle && handle.includes('@')) {
        const [username, instance] = handle.split('@');
        if (username && instance) {
          return `https://${instance}/@${username}`;
        }
      }
      return '';
    case 'substack':
      return `https://${handle}.substack.com`;
    case 'tumblr':
      return `https://${handle}.tumblr.com`;
    case 'naver-webtoon': {
      const titleId = sub.naverWebtoonOptions?.titleId || handle;
      return `https://comic.naver.com/webtoon/list?titleId=${titleId}`;
    }
    case 'webtoons': {
      const titleNo = sub.naverWebtoonOptions?.titleId || handle;
      return sub.target?.profileUrl || `https://www.webtoons.com/episodeList?titleNo=${titleNo}`;
    }
    default:
      return '';
  }
}

/**
 * Build a secondary handle-based URL for better matching.
 */
function buildHandleBasedUrl(platform: string, handle: string, sub: any): string {
  switch (platform) {
    case 'x':
      return `https://x.com/${handle}`;
    case 'facebook':
      return `https://www.facebook.com/${handle}/`;
    case 'reddit':
      return `https://www.reddit.com/r/${handle}/`;
    case 'tiktok':
      return `https://www.tiktok.com/@${handle}`;
    case 'pinterest':
      return `https://www.pinterest.com/${handle}/`;
    case 'bluesky':
      return `https://bsky.app/profile/${handle}`;
    case 'mastodon':
      if (sub.profileUrl) return sub.profileUrl;
      if (handle && handle.includes('@')) {
        const [username, instance] = handle.split('@');
        return username && instance ? `https://${instance}/@${username}` : '';
      }
      return '';
    case 'youtube': {
      const cleanHandle = (handle || '').replace(/^@/, '');
      if (cleanHandle.toUpperCase().startsWith('UC') && cleanHandle.length === 24) {
        return `https://www.youtube.com/channel/${cleanHandle}`;
      }
      return cleanHandle ? `https://www.youtube.com/@${cleanHandle}` : '';
    }
    case 'linkedin':
      return `https://www.linkedin.com/in/${handle}/`;
    case 'instagram':
      return `https://www.instagram.com/${handle}/`;
    case 'substack':
      return `https://${handle}.substack.com`;
    case 'tumblr':
      return `https://${handle}.tumblr.com`;
    case 'naver-webtoon':
      return `https://comic.naver.com/webtoon/list?titleId=${handle}`;
    case 'webtoons':
      return sub.target?.profileUrl || `https://www.webtoons.com/episodeList?titleNo=${handle}`;
    default:
      return '';
  }
}

/**
 * Determine fetch mode for a subscription.
 */
function determineFetchMode(
  sub: any,
  handle: string,
  isNaverSubscription: boolean
): 'local' | 'cloud' | 'hybrid' {
  const isNaverCafe =
    isNaverSubscription &&
    (handle?.startsWith('cafe:') || sub.naverOptions?.subscriptionType === 'cafe-member');
  const isNaverBlog = isNaverSubscription && sub.naverOptions?.subscriptionType === 'blog';

  if (isNaverCafe && sub.naverOptions?.localFetchRequired) return 'local';
  if (isNaverBlog) return 'hybrid';
  if (sub.platform === 'brunch') return 'hybrid';
  return 'cloud';
}

/**
 * Build webtoon info from subscription data.
 */
function buildWebtoonInfo(
  sub: any,
  handle: string
): AuthorCatalogEntry['webtoonInfo'] | undefined {
  if (sub.platform === 'naver-webtoon' && sub.naverWebtoonOptions) {
    return {
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
  }

  if (sub.platform === 'webtoons' && sub.webtoonsOptions) {
    return {
      titleId: sub.webtoonsOptions.titleNo || handle,
      titleName: sub.webtoonsOptions.seriesTitle || sub.name || '',
      publishDay: sub.webtoonsOptions.updateDay || '',
      publishDayCode: sub.webtoonsOptions.updateDay?.toLowerCase().slice(0, 3),
      finished: false,
      thumbnailUrl: sub.webtoonsOptions.thumbnailUrl,
      genre: sub.webtoonsOptions.genre ? [sub.webtoonsOptions.genre] : undefined,
      totalEpisodes: undefined,
      archivedEpisodes: undefined,
    };
  }

  const isWebtoonPlatform = sub.platform === 'naver-webtoon' || sub.platform === 'webtoons';
  if (isWebtoonPlatform) {
    return {
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

  return undefined;
}

/** Parameters for buildSubscriptionEntry */
interface SubscriptionEntryParams {
  sub: any;
  subscriptionId: string;
  lastRunAt: Date | null;
  schedule: string;
  maxPostsPerRun: number | undefined;
  redditOptions: any;
  naverCafeOptions: any;
  fetchMode: 'local' | 'cloud' | 'hybrid';
  displayAuthorName: string;
  authorUrl: string;
  displayHandle: string;
  isNaverCafeMember: boolean;
  isWebtoonPlatform: boolean;
  webtoonInfo: AuthorCatalogEntry['webtoonInfo'] | undefined;
}

/**
 * Build a single subscription map entry.
 */
function buildSubscriptionEntry(params: SubscriptionEntryParams) {
  const {
    sub,
    subscriptionId,
    lastRunAt,
    schedule,
    maxPostsPerRun,
    redditOptions,
    naverCafeOptions,
    fetchMode,
    displayAuthorName,
    authorUrl,
    displayHandle,
    isNaverCafeMember,
    isWebtoonPlatform,
    webtoonInfo,
  } = params;

  return {
    subscriptionId,
    status: 'subscribed' as const,
    lastRunAt,
    schedule,
    maxPostsPerRun,
    redditOptions,
    naverCafeOptions,
    fetchMode,
    authorName: displayAuthorName,
    authorUrl,
    handle: displayHandle,
    platform: sub.platform as Platform,
    // Naver cafe member avatar
    ...(isNaverCafeMember &&
      sub.naverOptions?.memberAvatar && {
        authorAvatar: sub.naverOptions.memberAvatar,
      }),
    // X (Twitter) avatar and bio
    ...(sub.platform === 'x' &&
      sub.xMetadata?.avatar && {
        authorAvatar: sub.xMetadata.avatar,
      }),
    ...(sub.platform === 'x' &&
      sub.xMetadata?.bio && {
        bio: sub.xMetadata.bio,
      }),
    // Webtoon info
    ...(isWebtoonPlatform &&
      webtoonInfo && {
        isWebtoon: true,
        webtoonInfo,
        ...(webtoonInfo.thumbnailUrl && { authorAvatar: webtoonInfo.thumbnailUrl }),
      }),
  };
}
