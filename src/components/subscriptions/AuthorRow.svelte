<script lang="ts">
/**
 * AuthorRow - Individual Author Row Component
 *
 * Displays a single author with avatar, details, and subscribe functionality.
 * Mobile-first design with 44px minimum touch targets.
 */

import type { App } from 'obsidian';
import { Notice, Platform as ObsidianPlatform } from 'obsidian';
import type { Platform } from '@/types/post';
import type {
  AuthorCatalogEntry,
  AuthorSubscribeOptions,
  RedditSubscriptionOptions,
  NaverCafeSubscriptionOptions,
  BrunchSubscriptionOptions
} from '@/types/author-catalog';
import { DEFAULT_ARCHIVE_PATH } from '@/shared/constants';
import { RedditSubscribeModal, type RedditSubscribeOptions as RedditModalOptions } from '@/modals/RedditSubscribeModal';
import { NaverSubscribeModal, type NaverSubscribeOptions as NaverModalOptions } from '@/modals/NaverSubscribeModal';
import { BrunchSubscribeModal, type BrunchSubscribeOptions as BrunchModalOptions } from '@/modals/BrunchSubscribeModal';
import {
  getPlatformSimpleIcon,
  type PlatformIcon
} from '@/services/IconService';
import { formatNumber, formatNumberWithCommas } from '@/utils/formatNumber';
import { MarkdownRenderer, Component } from 'obsidian';
import { isSubscriptionSupported as checkSubscriptionSupported } from '@/constants/rssPlatforms';
import { BrunchLocalService } from '@/services/BrunchLocalService';

/**
 * Component props
 */
interface AuthorRowProps {
  app: App;
  author: AuthorCatalogEntry;
  onSubscribe?: (author: AuthorCatalogEntry, options: AuthorSubscribeOptions) => Promise<void>;
  onUpdateSubscription?: (author: AuthorCatalogEntry, options: AuthorSubscribeOptions) => Promise<void>;
  onUnsubscribe?: (author: AuthorCatalogEntry) => Promise<void>;
  onManualRun?: (author: AuthorCatalogEntry) => Promise<void>;
  onViewHistory?: (author: AuthorCatalogEntry) => void;
  onViewArchives?: (author: AuthorCatalogEntry) => void;
}

let {
  app,
  author,
  onSubscribe,
  onUpdateSubscription,
  onUnsubscribe,
  onManualRun,
  onViewHistory,
  onViewArchives
}: AuthorRowProps = $props();

// Derived status for reliable reactivity in conditionals
const currentStatus = $derived(author.status);
const isSubscribed = $derived(currentStatus === 'subscribed');
const isError = $derived(currentStatus === 'error');
// X subscriptions disabled - BrightData returns non-chronological posts when not logged in
// Reddit: both subreddit and user profile subscriptions are supported
const isRedditSubreddit = $derived(
  author.platform === 'reddit' && author.authorUrl?.includes('/r/')
);
const isRedditUser = $derived(
  author.platform === 'reddit' && (author.authorUrl?.includes('/user/') || author.authorUrl?.includes('/u/'))
);
// Naver Cafe member detection (cafe.naver.com with /f-e/cafes/.../members/... path)
const isNaverCafe = $derived.by(() => {
  if (author.platform !== 'naver' || !author.authorUrl) return false;
  try {
    const url = new URL(author.authorUrl);
    if (url.hostname !== 'cafe.naver.com' && url.hostname !== 'm.cafe.naver.com') return false;
    return /\/(?:f-e|ca-fe)\/cafes\/\d+\/members\/[^/]+/.test(url.pathname);
  } catch {
    return false;
  }
});
// Naver Blog detection (blog.naver.com/blogId)
const isNaverBlog = $derived.by(() => {
  if (author.platform !== 'naver' || !author.authorUrl) return false;
  try {
    const url = new URL(author.authorUrl);
    return url.hostname === 'blog.naver.com' || url.hostname === 'm.blog.naver.com';
  } catch {
    return false;
  }
});
// Brunch author detection (brunch.co.kr/@username)
const isBrunch = $derived(author.platform === 'brunch');
// Naver Webtoon / WEBTOON Global detection
const isWebtoon = $derived(author.platform === 'naver-webtoon' || author.platform === 'webtoons' || author.isWebtoon === true);
// Show subscribe button for supported platforms
// Uses centralized SUBSCRIPTION_SUPPORTED_PLATFORMS from rssPlatforms.ts
const isSubscriptionSupported = $derived(checkSubscriptionSupported(author.platform));

// Mobile detection for disabling hover effects on touch devices
const isMobile = ObsidianPlatform.isMobile;

// ============================================================================
// Avatar Priority: localAvatar > avatar > initials
// ============================================================================

/**
 * Compute avatar source URL with priority:
 * 1. localAvatar (vault file) - use Obsidian's resource path
 * 2. avatar (external URL) - use directly
 * 3. null - show initials fallback
 */
const avatarSrc = $derived.by(() => {
  if (author.localAvatar) {
    // Use Obsidian's vault adapter to get resource path for local file
    return app.vault.adapter.getResourcePath(author.localAvatar);
  }
  return author.avatar || null;
});

const showInitials = $derived(!avatarSrc);

/**
 * Generate initials from author name (max 2 characters)
 */
const initials = $derived.by(() => {
  const name = author.authorName || '';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
});

// ============================================================================
// Statistics Formatting
// ============================================================================

const followersText = $derived(formatNumber(author.followers));
const followersTooltip = $derived(
  author.followers !== null && author.followers !== undefined
    ? `${formatNumberWithCommas(author.followers)} followers`
    : ''
);

const postsCountText = $derived(formatNumber(author.postsCount));
const postsCountTooltip = $derived(
  author.postsCount !== null && author.postsCount !== undefined
    ? `${formatNumberWithCommas(author.postsCount)} posts`
    : ''
);

// ============================================================================
// Bio Truncation
// ============================================================================

const bioTruncated = $derived.by(() => {
  if (!author.bio) return '';
  const maxLength = 80;
  if (author.bio.length <= maxLength) return author.bio;
  return author.bio.substring(0, maxLength).trim() + '...';
});

// ============================================================================
// Display Name - Remove handle from name if present
// ============================================================================

/**
 * Clean author name by removing embedded handle patterns like "Name (@handle)"
 * This prevents duplicate display when handle is shown separately
 */
const displayName = $derived.by(() => {
  const name = author.authorName || '';
  // Remove patterns like " (@handle)" or " @handle" at the end
  return name.replace(/\s*\(@?[^)]+\)\s*$/, '').replace(/\s+@\S+\s*$/, '').trim();
});


/**
 * Component state
 */
let isSubscribing = $state(false);
let isUnsubscribing = $state(false);
let isRunning = $state(false);
let showActionMenu = $state(false);
let isExpanded = $state(false);

// Reddit modal state (no longer needed - using Obsidian native modal)

/**
 * Format relative time
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

// Derived platform icon for reactivity (passes authorUrl for Medium detection)
const platformIcon = $derived(getPlatformSimpleIcon(author.platform, author.authorUrl));

/**
 * Close action menu when clicking outside
 */
$effect(() => {
  if (showActionMenu) {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // Check if click is outside the action menu and action button
      if (!target.closest('.action-menu') && !target.closest('.action-menu-btn')) {
        showActionMenu = false;
      }
    };

    // Add with slight delay to avoid immediate close
    setTimeout(() => {
      document.addEventListener('click', handleOutsideClick);
    }, 100);

    // Cleanup on unmount or when menu closes
    return () => {
      document.removeEventListener('click', handleOutsideClick);
    };
  }
});

/**
 * Handle subscribe click
 */
async function handleSubscribe(): Promise<void> {
  if (!onSubscribe || isSubscribing) return;

  // X subscriptions disabled - BrightData returns non-chronological posts when not logged in
  // RSS-based platforms derive feed URL from author URL
  if (!checkSubscriptionSupported(author.platform)) {
    new Notice('Subscriptions are available for Instagram, Facebook, LinkedIn, Reddit, TikTok, Pinterest, Bluesky, Mastodon, YouTube, and RSS-based platforms.');
    return;
  }

  // Reddit (subreddit or user profile) - show Obsidian modal for options
  if (isRedditSubreddit || isRedditUser) {
    const modal = new RedditSubscribeModal(
      app,
      author,
      async (modalOptions: RedditModalOptions) => {
        await handleRedditSubscribe(modalOptions, false);
      }
    );
    modal.open();
    return;
  }

  // Naver Cafe member - show Obsidian modal for options
  if (isNaverCafe) {
    const modal = new NaverSubscribeModal(
      app,
      author,
      async (modalOptions: NaverModalOptions) => {
        await handleNaverSubscribe(modalOptions, false, 'cafe-member');
      },
      'cafe-member'
    );
    modal.open();
    return;
  }

  // Naver Blog - show Obsidian modal for options
  if (isNaverBlog) {
    const modal = new NaverSubscribeModal(
      app,
      author,
      async (modalOptions: NaverModalOptions) => {
        await handleNaverSubscribe(modalOptions, false, 'blog');
      },
      'blog'
    );
    modal.open();
    return;
  }

  // Brunch - show Obsidian modal for options
  if (isBrunch) {
    const modal = new BrunchSubscribeModal(
      app,
      author,
      async (modalOptions: BrunchModalOptions) => {
        await handleBrunchSubscribe(modalOptions, false);
      }
    );
    modal.open();
    return;
  }

  // Non-Reddit/Non-NaverCafe platforms - use default options
  isSubscribing = true;
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const currentHour = new Date().getHours();
    const options: AuthorSubscribeOptions = {
      cadence: 'daily',
      destinationPath: DEFAULT_ARCHIVE_PATH,
      templateId: null,
      timezone,
      startHour: currentHour,
      maxPostsPerRun: 20,
      backfillDays: 3
    };

    await onSubscribe(author, options);
    new Notice(`Subscribed to ${author.authorName}! (Daily at ${currentHour}:00 ${timezone})`);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'Subscription failed';
    // Parse API error response if present
    const jsonMatch = rawMessage.match(/\{.*"message"\s*:\s*"([^"]+)"/);
    const message = jsonMatch ? jsonMatch[1] : rawMessage;
    new Notice(`Subscription failed: ${message}`);
  } finally {
    isSubscribing = false;
  }
}

/**
 * Handle unsubscribe click
 */
async function handleUnsubscribe(): Promise<void> {
  if (!onUnsubscribe || isUnsubscribing) return;

  isUnsubscribing = true;
  try {
    await onUnsubscribe(author);
    new Notice(`Unsubscribed from ${author.authorName}`);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'Unsubscribe failed';
    const jsonMatch = rawMessage.match(/\{.*"message"\s*:\s*"([^"]+)"/);
    const message = jsonMatch ? jsonMatch[1] : rawMessage;
    new Notice(`Unsubscribe failed: ${message}`);
  } finally {
    isUnsubscribing = false;
  }
}

/**
 * Handle Reddit modal subscribe (both new and edit)
 */
async function handleRedditSubscribe(modalOptions: RedditModalOptions, isEditMode: boolean): Promise<void> {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const currentHour = new Date().getHours();

  const options: AuthorSubscribeOptions = {
    cadence: 'daily',
    destinationPath: DEFAULT_ARCHIVE_PATH,
    templateId: null,
    timezone,
    startHour: currentHour,
    maxPostsPerRun: modalOptions.maxPostsPerRun,
    backfillDays: 3,
    redditOptions: {
      sortBy: modalOptions.sortBy,
      sortByTime: modalOptions.sortByTime,
      keyword: modalOptions.keyword || undefined,
      profileType: isRedditUser ? 'user' : 'subreddit',
    }
  };

  if (isEditMode && onUpdateSubscription) {
    await onUpdateSubscription(author, options);
    new Notice(`Updated subscription settings for ${author.authorName}`);
  } else if (onSubscribe) {
    await onSubscribe(author, options);
    new Notice(`Subscribed to ${author.authorName}!`);
  }
}

/**
 * Handle Naver modal subscribe (both cafe-member and blog, both new and edit)
 */
async function handleNaverSubscribe(
  modalOptions: NaverModalOptions,
  isEditMode: boolean,
  subscriptionType: 'blog' | 'cafe-member'
): Promise<void> {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const currentHour = new Date().getHours();

  const options: AuthorSubscribeOptions = {
    cadence: 'daily',
    destinationPath: DEFAULT_ARCHIVE_PATH,
    templateId: null,
    timezone,
    startHour: currentHour,
    maxPostsPerRun: modalOptions.maxPostsPerRun,
    backfillDays: modalOptions.backfillDays,
    naverCafeOptions: {
      subscriptionType,
      maxPostsPerRun: modalOptions.maxPostsPerRun,
      backfillDays: modalOptions.backfillDays,
      keyword: modalOptions.keyword || undefined,
    }
  };

  console.debug('[AuthorRow] handleNaverSubscribe options:', {
    modalOptions,
    builtOptions: options,
  });

  if (isEditMode && onUpdateSubscription) {
    await onUpdateSubscription(author, options);
    new Notice(`Updated subscription settings for ${author.authorName}`);
  } else if (onSubscribe) {
    await onSubscribe(author, options);
    new Notice(`Subscribed to ${author.authorName}!`);
  }
}

/**
 * Handle Brunch modal subscribe (both new and edit)
 */
async function handleBrunchSubscribe(
  modalOptions: BrunchModalOptions,
  isEditMode: boolean
): Promise<void> {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const currentHour = new Date().getHours();

  // Get username from author handle (format: "@username" or "username:userId")
  const handle = author.handle || author.authorName;
  const handleParts = handle.split(':');
  // Strip leading @ from username if present
  const username = handleParts[0].replace(/^@/, '');
  let userId = handleParts[1]; // May be undefined

  // For new subscriptions, discover userId if not already known
  // This is needed for Worker's hybrid mode to construct RSS URL
  if (!isEditMode && !userId) {
    try {
      const brunchService = new BrunchLocalService();
      userId = await brunchService.discoverUserId(username) || undefined;
      if (userId) {
        console.debug(`[AuthorRow] Discovered Brunch userId: ${userId} for @${username}`);
      } else {
        console.warn(`[AuthorRow] Could not discover Brunch userId for @${username}`);
      }
    } catch (error) {
      console.warn(`[AuthorRow] Error discovering Brunch userId:`, error);
    }
  }

  const options: AuthorSubscribeOptions = {
    cadence: 'daily',
    destinationPath: DEFAULT_ARCHIVE_PATH,
    templateId: null,
    timezone,
    startHour: currentHour,
    maxPostsPerRun: modalOptions.maxPostsPerRun,
    backfillDays: modalOptions.backfillDays,
    brunchOptions: {
      subscriptionType: 'author',
      username,
      userId, // Include discovered userId for Worker's hybrid mode
      localFetchRequired: true,
      maxPostsPerRun: modalOptions.maxPostsPerRun,
      backfillDays: modalOptions.backfillDays,
      keyword: modalOptions.keyword || undefined,
      includeComments: modalOptions.includeComments,
    }
  };

  console.debug('[AuthorRow] handleBrunchSubscribe options:', {
    modalOptions,
    builtOptions: options,
  });

  if (isEditMode && onUpdateSubscription) {
    await onUpdateSubscription(author, options);
    new Notice(`Updated subscription settings for ${author.authorName}`);
  } else if (onSubscribe) {
    await onSubscribe(author, options);
    new Notice(`Subscribed to ${author.authorName}!`);
  }
}

/**
 * Handle edit settings click for Reddit (subreddit or user profile)
 */
function handleEditRedditSettings(): void {
  showActionMenu = false;

  // Open Obsidian modal in edit mode with initial values
  const initialValues = {
    sortBy: (author.redditOptions?.sortBy as 'Hot' | 'New' | 'Top' | 'Rising') ?? 'New',
    sortByTime: (author.redditOptions?.sortByTime as RedditModalOptions['sortByTime']) ?? '',
    keyword: author.redditOptions?.keyword ?? '',
    maxPostsPerRun: author.maxPostsPerRun ?? 20,
  };

  const modal = new RedditSubscribeModal(
    app,
    author,
    async (modalOptions: RedditModalOptions) => {
      await handleRedditSubscribe(modalOptions, true);
    },
    true, // isEditMode
    initialValues
  );
  modal.open();
}

/**
 * Handle edit settings click for Naver (Cafe member or Blog)
 */
function handleEditNaverSettings(subscriptionType: 'blog' | 'cafe-member'): void {
  showActionMenu = false;

  // Open Obsidian modal in edit mode with initial values
  // Naver defaults: 3 posts per run, 30 days backfill (last month)
  const initialValues = {
    maxPostsPerRun: author.naverCafeOptions?.maxPostsPerRun ?? author.maxPostsPerRun ?? 3,
    backfillDays: author.naverCafeOptions?.backfillDays ?? 30,
    keyword: author.naverCafeOptions?.keyword ?? '',
  };

  const modal = new NaverSubscribeModal(
    app,
    author,
    async (modalOptions: NaverModalOptions) => {
      await handleNaverSubscribe(modalOptions, true, subscriptionType);
    },
    subscriptionType,
    true, // isEditMode
    initialValues
  );
  modal.open();
}

/**
 * Handle edit settings click for Brunch
 */
function handleEditBrunchSettings(): void {
  showActionMenu = false;

  // Open Obsidian modal in edit mode with initial values
  // Brunch defaults: 5 posts per run, 30 days backfill
  const initialValues = {
    maxPostsPerRun: author.brunchOptions?.maxPostsPerRun ?? author.maxPostsPerRun ?? 5,
    backfillDays: author.brunchOptions?.backfillDays ?? 30,
    keyword: author.brunchOptions?.keyword ?? '',
    includeComments: author.brunchOptions?.includeComments ?? false,
  };

  const modal = new BrunchSubscribeModal(
    app,
    author,
    async (modalOptions: BrunchModalOptions) => {
      await handleBrunchSubscribe(modalOptions, true);
    },
    true, // isEditMode
    initialValues
  );
  modal.open();
}

/**
 * Handle manual run click
 */
async function handleManualRun(): Promise<void> {
  if (!onManualRun || isRunning) return;

  isRunning = true;
  showActionMenu = false;
  try {
    await onManualRun(author);
    new Notice(`Running sync for ${author.authorName}...`);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'Manual run failed';
    const jsonMatch = rawMessage.match(/\{.*"message"\s*:\s*"([^"]+)"/);
    const message = jsonMatch ? jsonMatch[1] : rawMessage;
    new Notice(`Manual run failed: ${message}`);
  } finally {
    isRunning = false;
  }
}

/**
 * Handle view history click
 */
function handleViewHistory(): void {
  showActionMenu = false;
  if (onViewHistory) {
    onViewHistory(author);
  }
}

/**
 * Handle view archives click (triggered by author name)
 */
function handleViewArchives(event: MouseEvent): void {
  event.stopPropagation(); // Prevent row expansion
  if (onViewArchives) {
    onViewArchives(author);
  }
}

function handleViewArchivesKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    event.stopPropagation();
    if (onViewArchives) {
      onViewArchives(author);
    }
  }
}

/**
 * Toggle row expansion
 */
function toggleExpand(): void {
  isExpanded = !isExpanded;
}

function handleRowKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    toggleExpand();
  }
}

/**
 * Open author profile
 */
function openProfile(): void {
  if (author.authorUrl) {
    window.open(author.authorUrl, '_blank');
  }
}

/**
 * Svelte action to render bio with Obsidian's MarkdownRenderer
 * This handles hashtags as native Obsidian tags and URLs as clickable links
 */
function renderBio(node: HTMLElement, bio: string) {
  const component = new Component();
  component.load();

  async function render(text: string) {
    node.empty();
    if (!text) return;

    // Convert URLs to markdown links and hashtags to Obsidian tags
    let processedBio = text
      // Convert URLs to markdown links
      .replace(/(https?:\/\/[^\s]+)/g, '[$1]($1)')
      // Convert hashtags to Obsidian tag format (already recognized by MarkdownRenderer)
      .replace(/#(\w+)/g, '#$1');

    // Convert " · " separators to line breaks with bullet prefix for better readability
    // Common in Facebook/LinkedIn bios: "발행인/대표 at 커피팟 · Studied at 대학교 · Lives in 서울"
    // Result: "· 발행인/대표 at 커피팟\n· Studied at 대학교\n· Lives in 서울"
    if (processedBio.includes('·')) {
      const parts = processedBio.split(/\s*·\s*/);
      processedBio = parts.map(part => part.trim()).filter(Boolean).join('\n· ');
      // Add bullet to first item if there are multiple parts
      if (parts.length > 1) {
        processedBio = '· ' + processedBio;
      }
    }

    await MarkdownRenderer.render(app, processedBio, node, '', component);
  }

  render(bio);

  return {
    update(newBio: string) {
      render(newBio);
    },
    destroy() {
      component.unload();
    }
  };
}
</script>

<div
  class="author-row"
  class:subscribed={author.status === 'subscribed'}
  class:expanded={isExpanded}
  class:is-mobile={isMobile}
  onclick={toggleExpand}
  onkeydown={handleRowKeydown}
  role="button"
  tabindex="0"
>
  <!-- Avatar with priority: localAvatar > avatar > initials -->
  <button class="avatar-container" onclick={(e) => { e.stopPropagation(); openProfile(); }} title="Open profile">
    {#if showInitials}
      <div class="avatar-placeholder">
        {initials}
      </div>
    {:else}
      <img
        src={avatarSrc}
        alt={author.authorName}
        class="avatar"
        onerror={(e) => {
          // Fallback to placeholder on image load error
          const target = e.currentTarget as HTMLImageElement;
          target.style.display = 'none';
          const placeholder = target.nextElementSibling as HTMLElement;
          if (placeholder) placeholder.style.display = 'flex';
        }}
      />
      <div class="avatar-placeholder avatar-fallback" style="display: none;">
        {initials}
      </div>
    {/if}
    <span
      class="platform-badge"
      style="background: #{platformIcon?.hex || 'var(--text-muted)'}"
      title={author.platform}
    >
      {#if platformIcon}
        <svg
          role="img"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d={platformIcon.path}/>
        </svg>
      {/if}
    </span>
  </button>

  <!-- Author Info -->
  <div class="author-info" class:webtoon-info={isWebtoon}>
    {#if isWebtoon && author.webtoonInfo}
      <!-- Webtoon: Title (작품명) emphasized, author name secondary -->
      <div class="author-name-row">
        <button
          class="author-name-btn webtoon-title"
          onclick={handleViewArchives}
          onkeydown={handleViewArchivesKeydown}
          title="View archived episodes"
        >
          {author.webtoonInfo.titleName}
        </button>
        {#if platformIcon}
          <button
            class="platform-icon-btn"
            onclick={(e) => { e.stopPropagation(); openProfile(); }}
            title="Open on Naver Webtoon"
          >
            <svg
              class="platform-icon"
              role="img"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d={platformIcon.path}/>
            </svg>
          </button>
        {/if}
      </div>
      <!-- Author name (작가명) - smaller, secondary -->
      <div class="webtoon-author-name">{author.authorName}</div>
      <!-- Webtoon badges row -->
      <div class="webtoon-badges">
        <!-- Publish day badge -->
        <span class="badge publish-day" title="Publishes on {author.webtoonInfo.publishDay}">
          {author.webtoonInfo.publishDay}
        </span>
        <!-- Genre badges (max 2) -->
        {#each (author.webtoonInfo.genre || []).slice(0, 2) as genre}
          <span class="badge genre">{genre}</span>
        {/each}
        <!-- Ongoing/Completed status -->
        <span class="badge status" class:finished={author.webtoonInfo.finished}>
          {author.webtoonInfo.finished ? 'Completed' : 'Ongoing'}
        </span>
      </div>
      <!-- Episode progress -->
      {#if author.webtoonInfo.totalEpisodes || author.webtoonInfo.archivedEpisodes}
        <div class="webtoon-progress">
          <svg class="stat-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="21,8 21,21 3,21 3,8"/>
            <rect x="1" y="3" width="22" height="5"/>
            <line x1="10" y1="12" x2="14" y2="12"/>
          </svg>
          <span>{author.webtoonInfo.archivedEpisodes || 0} / {author.webtoonInfo.totalEpisodes || '?'} episodes</span>
        </div>
      {/if}
    {:else}
      <!-- Regular author: Standard rendering -->
      <div class="author-name-row">
        <button
          class="author-name-btn"
          onclick={handleViewArchives}
          onkeydown={handleViewArchivesKeydown}
          title="View archives in timeline"
        >
          {displayName}
        </button>
        {#if platformIcon}
          <button
            class="platform-icon-btn"
            onclick={(e) => { e.stopPropagation(); openProfile(); }}
            title="Open {platformIcon.title} profile"
          >
            <svg
              class="platform-icon"
              role="img"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d={platformIcon.path}/>
            </svg>
          </button>
        {/if}
      </div>
      {#if author.handle && author.handle.replace(/^@/, '').toLowerCase() !== 'unknown' && !(author.platform === 'youtube' && author.handle.replace(/^@/, '').startsWith('UC'))}
        <div class="author-handle">{author.handle}</div>
      {/if}
    {/if}

    <!-- Community info (Reddit subreddit or Naver cafe) -->
    {#if author.community}
      <a
        class="author-community"
        href={author.community.url}
        target="_blank"
        rel="noopener noreferrer"
        title={author.community.name}
        onclick={(e) => e.stopPropagation()}
      >
        {author.platform === 'reddit' ? `r/${author.community.name}` : author.community.name}
      </a>
    {/if}

    <!-- Statistics Row: followers, posts, archives -->
    <div class="author-stats">
      {#if author.followers !== null && author.followers !== undefined}
        <span class="stat" title={followersTooltip}>
          <svg class="stat-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          <span class="stat-value">{followersText}</span>
        </span>
      {/if}

      {#if author.postsCount !== null && author.postsCount !== undefined}
        <span class="stat" title={postsCountTooltip}>
          <svg class="stat-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14,2 14,8 20,8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          <span class="stat-value">{postsCountText}</span>
        </span>
      {/if}

      <span class="stat" title="{author.archiveCount} archived posts">
        <svg class="stat-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="21,8 21,21 3,21 3,8"/>
          <rect x="1" y="3" width="22" height="5"/>
          <line x1="10" y1="12" x2="14" y2="12"/>
        </svg>
        <span class="stat-value">{author.archiveCount}</span>
      </span>

      {#if author.lastRunAt}
        <span class="separator">&bull;</span>
        <span class="last-seen">{formatRelativeTime(author.lastRunAt)}</span>
      {/if}
    </div>

    <!-- Bio (truncated unless expanded) -->
    {#if author.bio}
      {#if isExpanded}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
        <div
          class="author-bio expanded"
          role="note"
          use:renderBio={author.bio}
          onclick={(e) => e.stopPropagation()}
        ></div>
      {:else}
        <div class="author-bio" title={author.bio.length > 500 ? author.bio.slice(0, 500) + '...' : author.bio}>
          {bioTruncated}
        </div>
      {/if}
    {/if}
  </div>

  <!-- Action Area -->
  <div class="action-area">
    <!-- Subscribed State - Toggle Button + Action Menu -->
    {#if isSubscribed}
      <div class="subscribed-wrapper">
        <div class="subscribed-actions">
          <button
            class="subscribed-btn"
            onclick={handleUnsubscribe}
            disabled={isUnsubscribing}
            title="Click to unsubscribe"
          >
            {#if isUnsubscribing}
              <span class="loading-spinner"></span>
            {:else}
              <span>Subscribed</span>
            {/if}
          </button>

          <!-- Action Menu Toggle (Chevron Down) -->
          <button
            class="action-menu-btn"
            onclick={() => showActionMenu = !showActionMenu}
            aria-label="More actions"
            disabled={isRunning}
          >
            {#if isRunning}
              <span class="loading-spinner small"></span>
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6,9 12,15 18,9"/>
              </svg>
            {/if}
          </button>

          <!-- Action Menu Dropdown -->
          {#if showActionMenu}
            <div class="action-menu">
            <button onclick={handleManualRun} disabled={isRunning}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="5,3 19,12 5,21 5,3"/>
              </svg>
              Run Now
            </button>
            {#if (isRedditSubreddit || isRedditUser) && onUpdateSubscription}
              <button onclick={handleEditRedditSettings}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
                Edit Settings
              </button>
            {/if}
            {#if isNaverCafe && onUpdateSubscription}
              <button onclick={() => handleEditNaverSettings('cafe-member')}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
                Edit Settings
              </button>
            {/if}
            {#if isNaverBlog && onUpdateSubscription}
              <button onclick={() => handleEditNaverSettings('blog')}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
                Edit Settings
              </button>
            {/if}
            {#if isBrunch && onUpdateSubscription}
              <button onclick={handleEditBrunchSettings}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
                Edit Settings
              </button>
            {/if}
            <button onclick={handleViewHistory}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12,6 12,12 16,14"/>
              </svg>
              View History
            </button>
            </div>
          {/if}
        </div>
        <!-- Schedule and Fetch Mode Info -->
        <div class="subscription-meta">
          {#if author.schedule}
            <span class="schedule-info">{author.schedule}</span>
          {:else}
            <span class="schedule-info">Daily at 00:00</span>
          {/if}
          {#if author.fetchMode}
            <span
              class="fetch-mode-badge"
              class:local={author.fetchMode === 'local'}
              class:cloud={author.fetchMode === 'cloud'}
              class:hybrid={author.fetchMode === 'hybrid'}
              title={author.fetchMode === 'local'
                ? 'Plugin fetches locally (faster, no credits)'
                : author.fetchMode === 'hybrid'
                  ? 'Worker detects new posts, Plugin fetches content (no credits)'
                  : 'Worker fetches in background'}
            >
              {#if author.fetchMode === 'local'}
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                  <polyline points="9 22 9 12 15 12 15 22"/>
                </svg>
                Local
              {:else if author.fetchMode === 'hybrid'}
                <!-- Hybrid icon: RSS/signal waves with house -->
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 11a9 9 0 0 1 9 9"/>
                  <path d="M4 4a16 16 0 0 1 16 16"/>
                  <circle cx="5" cy="19" r="1"/>
                </svg>
                Hybrid
              {:else}
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
                </svg>
                Cloud
              {/if}
            </span>
          {/if}
        </div>
        <!-- Last Poll Status for Local/Hybrid Fetch (content fetched when Obsidian opens) -->
        {#if (author.fetchMode === 'local' || author.fetchMode === 'hybrid') && author.lastRunAt}
          {@const hoursSinceRun = Math.floor((Date.now() - author.lastRunAt.getTime()) / (1000 * 60 * 60))}
          {#if hoursSinceRun >= 24}
            <div class="catch-up-hint" title="New posts may be available since Obsidian was last open">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              Catch-up available
            </div>
          {/if}
        {/if}
        <!-- Config Warning (e.g., missing cookie for Naver Cafe) -->
        {#if author.configWarning}
          <div class="config-warning" title={author.configWarning}>
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            {author.configWarning}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Error State -->
    <button class="retry-btn" class:show={isError} onclick={handleSubscribe} disabled={isSubscribing}>
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/>
      </svg>
      Retry
    </button>

    <!-- Subscribe State (only for supported platforms) -->
    <button
      class="subscribe-btn"
      class:show={!isSubscribed && !isError && isSubscriptionSupported}
      onclick={handleSubscribe}
      disabled={isSubscribing}
    >
      {#if isSubscribing}
        <span class="loading-spinner"></span>
      {:else}
        Subscribe
      {/if}
    </button>
  </div>
</div>


<style>
  .author-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--background-modifier-border);
    transition: background 0.15s ease;
    cursor: pointer;
  }

  /* Only apply hover on non-mobile devices */
  .author-row:not(.is-mobile):hover {
    background: var(--background-modifier-hover);
  }

  .author-row.subscribed {
    /* No special background for subscribed state */
  }

  .author-row.expanded {
    background: var(--background-secondary);
  }

  .avatar-container {
    position: relative;
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
    border-radius: 50%;
    align-self: center;
  }

  .avatar,
  .avatar-placeholder {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    object-fit: cover;
  }

  .avatar-placeholder {
    background: var(--background-modifier-border);
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 600;
  }

  .platform-badge {
    position: absolute;
    bottom: -2px;
    right: -2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid var(--background-primary);
  }

  .platform-badge svg {
    width: 10px;
    height: 10px;
    fill: white;
  }

  .author-info {
    flex: 1;
    min-width: 0;
  }

  .author-name-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .platform-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    border: none;
    background: none;
    outline: none;
    box-shadow: none;
    cursor: pointer;
    border-radius: 4px;
    transition: background 0.15s ease;
  }

  .platform-icon-btn:focus {
    outline: none;
    box-shadow: none;
  }

  .platform-icon-btn:hover {
    background: var(--background-modifier-hover);
  }

  .platform-icon-btn:hover .platform-icon {
    fill: var(--text-normal);
  }

  .platform-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    fill: var(--text-muted);
    transition: fill 0.15s ease;
  }

  .author-name-btn {
    display: block;
    font-weight: 500;
    font-size: 14px;
    color: var(--text-normal);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    background: transparent;
    border: 0;
    border-width: 0;
    border-style: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    text-align: left;
    box-shadow: none;
    outline: none;
    max-width: 180px;
  }

  .author-name-btn:hover {
    color: var(--text-accent);
    text-decoration: underline;
    background: transparent;
    border: 0;
    box-shadow: none;
  }

  .author-name-btn:focus,
  .author-name-btn:active {
    outline: none;
    box-shadow: none;
    border: 0;
    background: transparent;
  }

  .author-handle {
    font-size: 12px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .author-community {
    font-size: 11px;
    color: var(--text-muted);
    text-decoration: none;
    max-width: 300px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
    transition: color 0.2s;
  }

  .author-community:hover {
    color: var(--text-accent);
  }

  .author-stats {
    font-size: 11px;
    color: var(--text-faint);
    margin-top: 2px;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .stat {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    cursor: default;
  }

  .stat-icon {
    width: 12px;
    height: 12px;
    stroke: var(--text-muted);
    flex-shrink: 0;
  }

  .stat-value {
    font-size: 11px;
    color: var(--text-muted);
  }

  .separator {
    font-size: 8px;
    color: var(--text-faint);
  }

  .author-bio {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 4px;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: help;
  }

  .author-bio.expanded {
    white-space: normal;
    overflow: visible;
    cursor: default;
  }

  /* Styles for rendered markdown in bio */
  .author-bio.expanded :global(p) {
    margin: 0;
    font-size: 11px;
    line-height: 1.4;
    color: var(--text-muted);
  }

  .author-bio.expanded :global(a) {
    color: var(--text-accent);
    text-decoration: none;
  }

  .author-bio.expanded :global(a:hover) {
    text-decoration: underline;
  }

  .author-bio.expanded :global(a.tag) {
    color: var(--tag-color);
    background: var(--tag-background);
    padding: 1px 4px;
    border-radius: var(--tag-radius);
    font-size: 10px;
  }

  .author-bio.expanded :global(a.tag:hover) {
    background: var(--tag-background-hover);
    text-decoration: none;
  }

  /* Avatar fallback for image load errors */
  .avatar-fallback {
    position: absolute;
    top: 0;
    left: 0;
  }

  .action-area {
    flex-shrink: 0;
    position: relative;
    align-self: center;
  }

  /* Subscribed Wrapper - Contains button and schedule */
  .subscribed-wrapper {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }

  /* Subscription Meta - Contains schedule and fetch mode */
  .subscription-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  /* Schedule Info - Shows below subscribed button */
  .schedule-info {
    font-size: 11px;
    color: var(--text-muted);
    opacity: 0.7;
    white-space: nowrap;
  }

  /* Fetch Mode Badge - Shows Local/Cloud indicator */
  .fetch-mode-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    font-weight: 500;
    padding: 2px 6px;
    border-radius: 4px;
    white-space: nowrap;
  }

  .fetch-mode-badge.local {
    background: rgba(var(--color-green-rgb), 0.15);
    color: var(--color-green);
  }

  .fetch-mode-badge.local svg {
    stroke: var(--color-green);
  }

  .fetch-mode-badge.cloud {
    background: rgba(var(--color-blue-rgb), 0.15);
    color: var(--color-blue);
  }

  .fetch-mode-badge.cloud svg {
    stroke: var(--color-blue);
  }

  .fetch-mode-badge.hybrid {
    background: rgba(var(--color-purple-rgb), 0.15);
    color: var(--color-purple);
  }

  .fetch-mode-badge.hybrid svg {
    stroke: var(--color-purple);
  }

  /* Catch-up Hint - Shows when local fetch hasn't run in 24+ hours */
  .catch-up-hint {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    color: var(--color-yellow);
    opacity: 0.9;
    white-space: nowrap;
  }

  .catch-up-hint svg {
    stroke: var(--color-yellow);
  }

  /* Config Warning - Shows when subscription has configuration issues */
  .config-warning {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: var(--color-red);
    background: rgba(var(--color-red-rgb), 0.1);
    padding: 3px 6px;
    border-radius: 4px;
    white-space: nowrap;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .config-warning svg {
    stroke: var(--color-red);
    flex-shrink: 0;
  }

  /* Subscribed Actions Container - Split Button Style */
  .subscribed-actions {
    display: flex;
    align-items: stretch;
    position: relative;
  }

  .subscribed-btn {
    display: flex;
    align-items: center;
    padding: 6px 12px;
    border-radius: 4px 0 0 4px;
    border: 1px solid var(--color-green);
    border-right: none;
    background: rgba(var(--color-green-rgb), 0.1);
    color: var(--color-green);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    min-height: 32px;
    transition: background 0.15s ease;
  }

  .subscribed-btn:hover:not(:disabled) {
    background: rgba(var(--color-green-rgb), 0.2);
  }

  .subscribed-btn:focus {
    outline: none;
    box-shadow: none;
  }

  .subscribed-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }


  .subscribed-btn span {
    color: var(--color-green);
  }

  /* Action Menu Button (chevron) - Seamless with subscribed-btn */
  .action-menu-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px 6px;
    min-height: 32px;
    border-radius: 0 4px 4px 0;
    border: 1px solid var(--color-green);
    border-left: none;
    background: rgba(var(--color-green-rgb), 0.1);
    color: var(--color-green);
    cursor: pointer;
    transition: background 0.15s ease;
    position: relative;
  }

  /* 미묘한 내부 구분선 */
  .action-menu-btn::before {
    content: '';
    position: absolute;
    left: 0;
    top: 25%;
    height: 50%;
    width: 1px;
    background: rgba(var(--color-green-rgb), 0.3);
  }

  .action-menu-btn:hover:not(:disabled) {
    background: rgba(var(--color-green-rgb), 0.2);
  }

  .action-menu-btn:focus {
    outline: none;
    box-shadow: none;
  }

  .action-menu-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .action-menu-btn svg {
    stroke: var(--color-green);
  }

  /* Action Menu Dropdown */
  .action-menu {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 100;
    min-width: 140px;
    overflow: hidden;
  }

  .action-menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 10px 12px;
    border: none;
    background: none;
    color: var(--text-normal);
    font-size: 13px;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s ease;
  }

  .action-menu button:hover:not(:disabled) {
    background: var(--background-modifier-hover);
  }

  .action-menu button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-menu button svg {
    flex-shrink: 0;
    stroke: var(--text-muted);
  }

  /* Default: hide retry and subscribe */
  .retry-btn,
  .subscribe-btn {
    display: none;
  }

  .retry-btn.show {
    display: flex;
  }

  .subscribe-btn.show {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    border-radius: 4px;
    border: 1px solid var(--interactive-accent);
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    min-height: 32px;
  }

  .subscribe-btn.show:hover:not(:disabled) {
    background: var(--interactive-accent-hover);
  }

  .subscribe-btn.show:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  /* retry-btn base styles (display controlled by .show) */
  .retry-btn.show {
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    border-radius: 4px;
    border: 1px solid var(--text-error);
    background: transparent;
    color: var(--text-error);
    font-size: 12px;
    cursor: pointer;
  }

  .retry-btn.show:hover:not(:disabled) {
    background: var(--background-modifier-error);
  }

  .loading-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .loading-spinner.small {
    width: 14px;
    height: 14px;
    border: 2px solid var(--background-modifier-border);
    border-top-color: var(--text-muted);
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ============================================
   * Webtoon-specific styles
   * ============================================ */

  /* Webtoon title - emphasized, larger font */
  .author-name-btn.webtoon-title {
    font-size: 15px;
    font-weight: 600;
    max-width: 220px;
  }

  /* Webtoon author name - smaller, muted */
  .webtoon-author-name {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 2px;
  }

  /* Webtoon badges container */
  .webtoon-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }

  /* Badge base styles */
  .webtoon-badges .badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 500;
    white-space: nowrap;
  }

  /* Publish day badge - green accent */
  .webtoon-badges .badge.publish-day {
    background: rgba(var(--color-green-rgb), 0.15);
    color: var(--color-green);
  }

  /* Genre badge - neutral */
  .webtoon-badges .badge.genre {
    background: var(--background-modifier-border);
    color: var(--text-muted);
  }

  /* Status badge - ongoing (blue) */
  .webtoon-badges .badge.status {
    background: rgba(var(--color-blue-rgb), 0.15);
    color: var(--color-blue);
  }

  /* Status badge - completed (purple) */
  .webtoon-badges .badge.status.finished {
    background: rgba(var(--color-purple-rgb), 0.15);
    color: var(--color-purple);
  }

  /* Episode progress */
  .webtoon-progress {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 4px;
    font-size: 11px;
    color: var(--text-faint);
  }

  .webtoon-progress .stat-icon {
    width: 12px;
    height: 12px;
    stroke: var(--text-muted);
    flex-shrink: 0;
  }
</style>
