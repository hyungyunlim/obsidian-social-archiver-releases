<script lang="ts">
/**
 * AuthorProfileHeader - Profile header for Author Detail View
 *
 * Displays author metadata, subscription status, and action buttons.
 * Adapted from AuthorRow.svelte patterns for consistency.
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
  BrunchCatalogOptions,
} from '@/types/author-catalog';
import { DEFAULT_ARCHIVE_PATH } from '@/shared/constants';
import { RedditSubscribeModal, type RedditSubscribeOptions as RedditModalOptions } from '@/modals/RedditSubscribeModal';
import { NaverSubscribeModal, type NaverSubscribeOptions as NaverModalOptions } from '@/modals/NaverSubscribeModal';
import { BrunchSubscribeModal, type BrunchSubscribeOptions as BrunchModalOptions } from '@/modals/BrunchSubscribeModal';
import {
  getPlatformSimpleIcon,
  type PlatformIcon,
} from '@/services/IconService';
import { formatNumber, formatNumberWithCommas } from '@/utils/formatNumber';
import { MarkdownRenderer, Component } from 'obsidian';
import { isSubscriptionSupported as checkSubscriptionSupported } from '@/constants/rssPlatforms';
import { BrunchLocalService } from '@/services/BrunchLocalService';

// ============================================================================
// Props
// ============================================================================

interface AuthorProfileHeaderProps {
  app: App;
  author: AuthorCatalogEntry;
  onSubscribe?: (author: AuthorCatalogEntry, options: AuthorSubscribeOptions) => Promise<void>;
  onUpdateSubscription?: (author: AuthorCatalogEntry, options: AuthorSubscribeOptions) => Promise<void>;
  onUnsubscribe?: (author: AuthorCatalogEntry) => Promise<void>;
  onManualRun?: (author: AuthorCatalogEntry) => Promise<void>;
  onEditSubscription?: (author: AuthorCatalogEntry) => void;
  onOpenProfile?: (author: AuthorCatalogEntry) => void;
  onGoBack?: () => void;
  onOpenNote?: (author: AuthorCatalogEntry) => void;
  onCreateNote?: (author: AuthorCatalogEntry) => void;
}

let {
  app,
  author,
  onSubscribe,
  onUpdateSubscription,
  onUnsubscribe,
  onManualRun,
  onEditSubscription,
  onOpenProfile,
  onGoBack,
  onOpenNote,
  onCreateNote,
}: AuthorProfileHeaderProps = $props();

// ============================================================================
// Derived — Subscription/Platform Detection
// ============================================================================

const currentStatus = $derived(author.status);
const isSubscribed = $derived(currentStatus === 'subscribed');
const isError = $derived(currentStatus === 'error');
const isNotSubscribed = $derived(currentStatus === 'not_subscribed');
const hasNote = $derived(!!author.hasNote);

const isRedditSubreddit = $derived(
  author.platform === 'reddit' && author.authorUrl?.includes('/r/')
);
const isRedditUser = $derived(
  author.platform === 'reddit' && (author.authorUrl?.includes('/user/') || author.authorUrl?.includes('/u/'))
);
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
const isNaverBlog = $derived.by(() => {
  if (author.platform !== 'naver' || !author.authorUrl) return false;
  try {
    const url = new URL(author.authorUrl);
    return url.hostname === 'blog.naver.com' || url.hostname === 'm.blog.naver.com';
  } catch {
    return false;
  }
});
const isBrunch = $derived(author.platform === 'brunch');
const isWebtoon = $derived(
  author.platform === 'naver-webtoon' || author.platform === 'webtoons' || author.isWebtoon === true
);
const isSubscriptionSupported = $derived(checkSubscriptionSupported(author.platform));

const isMobile = ObsidianPlatform.isMobile;

// ============================================================================
// Derived — Avatar
// ============================================================================

const avatarSrc = $derived.by(() => {
  if (author.localAvatar) {
    return app.vault.adapter.getResourcePath(author.localAvatar);
  }
  return author.avatar || null;
});

const showInitials = $derived(!avatarSrc);

const initials = $derived.by(() => {
  const name = author.authorName || '';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    const first = parts[0] ?? '';
    const last = parts[parts.length - 1] ?? '';
    return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
});

// ============================================================================
// Derived — Display Values
// ============================================================================

const platformIcon: PlatformIcon | null = $derived(getPlatformSimpleIcon(author.platform, author.authorUrl));

const displayName = $derived.by(() => {
  const name = author.authorName || '';
  return name.replace(/\s*\(@?[^)]+\)\s*$/, '').replace(/\s+@\S+\s*$/, '').trim();
});

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

const lastSeenText = $derived.by(() => {
  if (!author.lastSeenAt) return 'Never';
  return formatRelativeTime(author.lastSeenAt);
});

const lastRunText = $derived.by(() => {
  if (!author.lastRunAt) return null;
  return formatRelativeTime(author.lastRunAt);
});

// ============================================================================
// Derived — Platform Extras
// ============================================================================

const platformExtras = $derived.by((): Array<{ label: string; value: string }> => {
  const extras: Array<{ label: string; value: string }> = [];

  if (author.redditOptions) {
    if (author.redditOptions.sortBy) {
      extras.push({ label: 'Sort', value: author.redditOptions.sortBy });
    }
    if (author.redditOptions.keyword) {
      extras.push({ label: 'Keyword', value: author.redditOptions.keyword });
    }
  }

  if (author.naverCafeOptions) {
    if (author.naverCafeOptions.subscriptionType) {
      extras.push({ label: 'Type', value: author.naverCafeOptions.subscriptionType });
    }
    if (author.naverCafeOptions.keyword) {
      extras.push({ label: 'Keyword', value: author.naverCafeOptions.keyword });
    }
  }

  if (author.brunchOptions) {
    if (author.brunchOptions.subscriptionType) {
      extras.push({ label: 'Type', value: author.brunchOptions.subscriptionType });
    }
    if (author.brunchOptions.keyword) {
      extras.push({ label: 'Keyword', value: author.brunchOptions.keyword });
    }
  }

  if (author.fetchMode) {
    extras.push({ label: 'Fetch', value: author.fetchMode });
  }

  if (isWebtoon && author.webtoonInfo) {
    if (author.webtoonInfo.publishDay) {
      extras.push({ label: 'Publishes', value: author.webtoonInfo.publishDay });
    }
    if (author.webtoonInfo.genre && author.webtoonInfo.genre.length > 0) {
      extras.push({ label: 'Genre', value: author.webtoonInfo.genre.join(', ') });
    }
    if (author.webtoonInfo.totalEpisodes) {
      const archived = author.webtoonInfo.archivedEpisodes ?? 0;
      extras.push({ label: 'Episodes', value: `${archived}/${author.webtoonInfo.totalEpisodes}` });
    }
  }

  return extras;
});

// ============================================================================
// Local State
// ============================================================================

let isSubscribing = $state(false);
let isUnsubscribing = $state(false);
let isRunning = $state(false);
let showDropdown = $state(false);
let noteBody = $state('');

$effect(() => {
  // Try known noteFilePath first, then search by authorUrl
  const findAndReadNote = async () => {
    let file = author.noteFilePath ? app.vault.getFileByPath(author.noteFilePath) : null;

    // Fallback: scan authorNotesPath for matching note
    if (!file && author.authorUrl) {
      const { AuthorNoteService } = await import('../../services/AuthorNoteService');
      const notesPath = (app as any).plugins?.plugins?.['social-archiver']?.settings?.authorNotesPath || 'Social Authors';
      const noteService = new AuthorNoteService({
        app,
        getAuthorNotesPath: () => notesPath,
        isEnabled: () => true,
      });
      file = noteService.findNote(author.authorUrl, author.authorName, author.platform);
    }

    if (file) {
      const content = await app.vault.cachedRead(file);
      const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
      noteBody = body === '## Notes' ? '' : body;
    } else {
      noteBody = '';
    }
  };

  void findAndReadNote();
});

function toggleDropdown(): void {
  showDropdown = !showDropdown;
}

function closeDropdown(): void {
  showDropdown = false;
}

function handleClickOutside(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  if (!target.closest('.subscription-dropdown-wrapper')) {
    closeDropdown();
  }
}

// ============================================================================
// Helpers
// ============================================================================

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

// ============================================================================
// Action Handlers — Adapted from AuthorRow.svelte
// ============================================================================

function handleOpenProfile(): void {
  if (onOpenProfile) {
    onOpenProfile(author);
  } else if (author.authorUrl) {
    window.open(author.authorUrl, '_blank');
  }
}

async function handleSubscribe(): Promise<void> {
  if (!onSubscribe || isSubscribing) return;

  if (!checkSubscriptionSupported(author.platform)) {
    new Notice('Subscriptions are available for Instagram, Facebook, LinkedIn, Reddit, TikTok, Pinterest, Bluesky, Mastodon, YouTube, and RSS-based platforms.');
    return;
  }

  // Reddit (subreddit or user profile)
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

  // Naver Cafe member
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

  // Naver Blog
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

  // Brunch
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

  // Default platforms
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
      backfillDays: 3,
    };
    await onSubscribe(author, options);
    new Notice(`Subscribed to ${author.authorName}! (Daily at ${currentHour}:00 ${timezone})`);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : 'Subscription failed';
    const jsonMatch = rawMessage.match(/\{.*"message"\s*:\s*"([^"]+)"/);
    const message = jsonMatch ? jsonMatch[1] : rawMessage;
    new Notice(`Subscription failed: ${message}`);
  } finally {
    isSubscribing = false;
  }
}

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

async function handleManualRun(): Promise<void> {
  if (!onManualRun || isRunning) return;

  isRunning = true;
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

function handleEditSubscription(): void {
  // Delegate to platform-specific edit modal
  if (isRedditSubreddit || isRedditUser) {
    handleEditRedditSettings();
  } else if (isNaverCafe) {
    handleEditNaverSettings('cafe-member');
  } else if (isNaverBlog) {
    handleEditNaverSettings('blog');
  } else if (isBrunch) {
    handleEditBrunchSettings();
  } else if (onEditSubscription) {
    onEditSubscription(author);
  }
}

// ============================================================================
// Platform-Specific Subscribe/Edit Handlers
// ============================================================================

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
    },
  };

  if (isEditMode && onUpdateSubscription) {
    await onUpdateSubscription(author, options);
    new Notice(`Updated subscription settings for ${author.authorName}`);
  } else if (onSubscribe) {
    await onSubscribe(author, options);
    new Notice(`Subscribed to ${author.authorName}!`);
  }
}

async function handleNaverSubscribe(
  modalOptions: NaverModalOptions,
  isEditMode: boolean,
  subscriptionType: 'blog' | 'cafe-member',
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
    },
  };

  if (isEditMode && onUpdateSubscription) {
    await onUpdateSubscription(author, options);
    new Notice(`Updated subscription settings for ${author.authorName}`);
  } else if (onSubscribe) {
    await onSubscribe(author, options);
    new Notice(`Subscribed to ${author.authorName}!`);
  }
}

async function handleBrunchSubscribe(modalOptions: BrunchModalOptions, isEditMode: boolean): Promise<void> {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const currentHour = new Date().getHours();

  const handle = author.handle || author.authorName;
  const handleParts = handle.split(':');
  const username = (handleParts[0] ?? '').replace(/^@/, '');
  let userId: string | undefined = handleParts[1];

  if (!isEditMode && !userId) {
    try {
      const brunchService = new BrunchLocalService();
      userId = await brunchService.discoverUserId(username) || undefined;
    } catch {
      // userId discovery failed; proceed without it
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
      userId,
      localFetchRequired: true,
      maxPostsPerRun: modalOptions.maxPostsPerRun,
      backfillDays: modalOptions.backfillDays,
      keyword: modalOptions.keyword || undefined,
      includeComments: modalOptions.includeComments,
    },
  };

  if (isEditMode && onUpdateSubscription) {
    await onUpdateSubscription(author, options);
    new Notice(`Updated subscription settings for ${author.authorName}`);
  } else if (onSubscribe) {
    await onSubscribe(author, options);
    new Notice(`Subscribed to ${author.authorName}!`);
  }
}

function handleEditRedditSettings(): void {
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
    true,
    initialValues,
  );
  modal.open();
}

function handleEditNaverSettings(subscriptionType: 'blog' | 'cafe-member'): void {
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
    true,
    initialValues,
  );
  modal.open();
}

function handleEditBrunchSettings(): void {
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
    true,
    initialValues,
  );
  modal.open();
}

// ============================================================================
// Svelte Action: Render Bio with Obsidian MarkdownRenderer
// ============================================================================

function renderBio(node: HTMLElement, bio: string) {
  const component = new Component();
  component.load();

  async function render(text: string) {
    node.empty();
    if (!text) return;

    let processedBio = text
      .replace(/(https?:\/\/[^\s]+)/g, '[$1]($1)')
      .replace(/#(\w+)/g, '#$1');

    if (processedBio.includes('\u00b7')) {
      const parts = processedBio.split(/\s*\u00b7\s/);
      processedBio = parts.map(part => part.trim()).filter(Boolean).join('\n\u00b7 ');
      if (parts.length > 1) {
        processedBio = '\u00b7 ' + processedBio;
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
    },
  };
}

// ============================================================================
// Svelte Action: Render Note Content with Obsidian MarkdownRenderer
// ============================================================================

function renderNoteContent(node: HTMLElement, body: string) {
  const component = new Component();
  component.load();

  async function render(text: string) {
    node.empty();
    if (!text) return;
    await MarkdownRenderer.render(app, text, node, '', component);
  }

  render(body);

  return {
    update(newBody: string) {
      render(newBody);
    },
    destroy() {
      component.unload();
    },
  };
}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="author-profile-header" class:is-mobile={isMobile} onclick={handleClickOutside}>
  <!-- Close button (top-right) -->
  {#if onGoBack}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="close-btn" onclick={onGoBack} title="Close">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 6L6 18"/><path d="M6 6l12 12"/>
      </svg>
    </div>
  {/if}

  <!-- Avatar + Identity -->
  <div class="header-top">
    <!-- Avatar -->
    <div class="avatar-container">
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
    </div>

    <!-- Name + Platform icon + Handle + Meta stats -->
    <div class="header-identity">
      <div class="name-row">
        {#if isWebtoon && author.webtoonInfo}
          <span class="author-name webtoon-title">{author.webtoonInfo.titleName}</span>
        {:else}
          <span class="author-name">{displayName}</span>
        {/if}
        <!-- Platform icon (clickable → open profile, muted color for dark mode) -->
        {#if platformIcon}
          <button class="platform-icon-btn clickable-icon" onclick={handleOpenProfile} title="Open {author.platform} profile">
            <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d={platformIcon.path}/>
            </svg>
          </button>
        {/if}
        <!-- Subscription badge — uses exact same pcr-badge classes as timeline PostCardRenderer -->
        {#if isSubscribed}
          <div class="subscription-badge-wrapper">
            <div class="pcr-badge pcr-badge-subscribed" role="button" tabindex="0" title="Click to manage subscription" onclick={toggleDropdown} onkeydown={(e) => { if (e.key === 'Enter') toggleDropdown(); }}>
              <div class="pcr-badge-icon"><svg class="pcr-badge-svg-subscribed" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></div>
              <span>Subscribed</span>
            </div>
            {#if showDropdown}
              <div class="sub-dropdown-menu">
                {#if author.schedule}
                  <div class="sub-dropdown-info">{author.schedule}</div>
                {/if}
                {#if lastRunText}
                  <div class="sub-dropdown-info">Last run: {lastRunText}</div>
                {/if}
                <button class="sub-dropdown-item" onclick={() => { closeDropdown(); void handleManualRun(); }} disabled={isRunning}>Run Now</button>
                <button class="sub-dropdown-item" onclick={() => { closeDropdown(); handleEditSubscription(); }}>Edit Settings</button>
                <div class="sub-dropdown-divider"></div>
                <button class="sub-dropdown-item danger" onclick={() => { closeDropdown(); void handleUnsubscribe(); }} disabled={isUnsubscribing}>Unsubscribe</button>
              </div>
            {/if}
          </div>
        {:else if isError}
          <div class="subscription-badge-wrapper">
            <div class="pcr-badge pcr-badge-unsubscribed" role="button" tabindex="0" title="Subscription error — click to retry" onclick={toggleDropdown} onkeydown={(e) => { if (e.key === 'Enter') toggleDropdown(); }}>
              <span>Error</span>
            </div>
            {#if showDropdown}
              <div class="sub-dropdown-menu">
                <button class="sub-dropdown-item" onclick={() => { closeDropdown(); void handleManualRun(); }} disabled={isRunning}>Retry</button>
                <div class="sub-dropdown-divider"></div>
                <button class="sub-dropdown-item danger" onclick={() => { closeDropdown(); void handleUnsubscribe(); }} disabled={isUnsubscribing}>Unsubscribe</button>
              </div>
            {/if}
          </div>
        {:else if isNotSubscribed && isSubscriptionSupported}
          <div class="pcr-badge pcr-badge-unsubscribed" role="button" tabindex="0" title="Click to subscribe" onclick={handleSubscribe} onkeydown={(e) => { if (e.key === 'Enter') void handleSubscribe(); }}>
            <div class="pcr-badge-icon"><svg class="pcr-badge-svg-unsubscribed" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/><line x1="12" y1="2" x2="12" y2="5"/></svg></div>
            <span>Subscribe</span>
          </div>
        {/if}
        <!-- Note Button: Open Note / Create Note -->
        {#if hasNote && onOpenNote}
          <button
            class="note-btn has-note clickable-icon"
            onclick={() => onOpenNote?.(author)}
            title="Open author note"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14,2 14,8 20,8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <line x1="10" y1="9" x2="8" y2="9"/>
            </svg>
          </button>
        {:else if !hasNote && onCreateNote}
          <button
            class="note-btn create-note clickable-icon"
            onclick={() => onCreateNote?.(author)}
            title="Create author note"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14,2 14,8 20,8"/>
              <line x1="12" y1="18" x2="12" y2="12"/>
              <line x1="9" y1="15" x2="15" y2="15"/>
            </svg>
          </button>
        {/if}
      </div>

      {#if isWebtoon && author.webtoonInfo}
        <div class="author-handle">{author.authorName}</div>
      {/if}

      {#if author.handle && author.handle.replace(/^@/, '').toLowerCase() !== 'unknown' && !(author.platform === 'youtube' && author.handle.replace(/^@/, '').startsWith('UC'))}
        <div class="author-handle">{author.handle}</div>
      {/if}

      <!-- Statistics Row (same as AuthorRow in catalog) -->
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
        <span class="stat" title="{author.archiveCount} archived posts">
          <svg class="stat-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="21,8 21,21 3,21 3,8"/>
            <rect x="1" y="3" width="22" height="5"/>
            <line x1="10" y1="12" x2="14" y2="12"/>
          </svg>
          <span class="stat-value">{author.archiveCount}</span>
        </span>
        {#if author.community}
          <a class="stat community-link" href={author.community.url} target="_blank" rel="noopener noreferrer" onclick={(e) => e.stopPropagation()}>
            {author.platform === 'reddit' ? `r/${author.community.name}` : author.community.name}
          </a>
        {/if}
      </div>
    </div>
  </div>

  <!-- Bio -->
  {#if author.bio}
    <div
      class="author-bio"
      use:renderBio={author.bio}
    ></div>
  {/if}

  <!-- Author Note Body Preview -->
  {#if noteBody}
    <div class="author-note-body">
      <span use:renderNoteContent={noteBody}></span>
      {#if onOpenNote}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="author-note-open-icon" onclick={() => onOpenNote?.(author)} title="Open note">
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15,3 21,3 21,9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .author-profile-header {
    padding: 8px 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    position: relative;
  }

  /* Close button (top-right) */
  .close-btn {
    position: absolute;
    top: 8px;
    right: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-faint);
    cursor: pointer;
    z-index: 1;
  }
  .close-btn:focus { outline: none; box-shadow: none; }

  /* Avatar + Identity */
  .header-top { display: flex; align-items: flex-start; gap: 12px; }

  .avatar-container {
    position: relative;
    width: 48px;
    height: 48px;
    flex-shrink: 0;
  }
  .avatar, .avatar-placeholder {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    object-fit: cover;
  }
  .avatar-placeholder {
    background: var(--background-modifier-border);
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    font-weight: 600;
  }
  .avatar-fallback { position: absolute; top: 0; left: 0; }

  /* Identity */
  .header-identity {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding-right: 32px; /* space for close button */
  }
  .name-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .author-name {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-normal);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .author-name.webtoon-title { font-size: 16px; font-weight: 700; }

  /* Platform icon button (next to name) */
  .platform-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    background: none;
    box-shadow: none;
    cursor: pointer;
    border-radius: 3px;
    transition: opacity 0.15s;
    flex-shrink: 0;
  }
  .platform-icon-btn svg { width: 14px; height: 14px; fill: var(--text-muted); }
  .platform-icon-btn:hover svg { fill: var(--text-normal); }
  .platform-icon-btn:hover { background: none; }
  .platform-icon-btn:focus { outline: none; box-shadow: none; }

  /* Note Button (Open Note / Create Note) */
  .note-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    border-radius: 4px;
    color: var(--text-muted);
    transition: color 0.15s ease, background 0.15s ease;
  }
  .note-btn:hover { color: var(--text-normal); background: var(--background-modifier-hover); }
  .note-btn:focus { outline: none; box-shadow: none; }
  .note-btn.has-note { color: var(--text-accent); }
  .note-btn.has-note:hover { color: var(--text-accent); background: var(--background-modifier-hover); }
  .note-btn.create-note { color: var(--text-faint); }
  .note-btn.create-note:hover { color: var(--text-muted); }

  /* Author Note Body Preview */
  .author-note-body {
    padding: 8px 0 4px 10px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-muted);
    border-left: 2px solid var(--text-accent);
    margin: 4px 12px 4px 0;
  }
  .author-note-body :global(p) { margin: 4px 0; }
  .author-note-body :global(h1),
  .author-note-body :global(h2),
  .author-note-body :global(h3) { display: none; }
  .author-note-body :global(a) { color: var(--text-accent); }
  .author-note-open-icon {
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    color: var(--text-faint);
    margin-left: 4px;
    vertical-align: middle;
  }
  .author-note-open-icon:hover { color: var(--text-accent); }

  /* Subscription badge — uses pcr-badge classes from post-card.css (global) */
  .subscription-badge-wrapper { position: relative; }

  .author-handle {
    font-size: 12px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Statistics row (same pattern as AuthorRow.svelte) */
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
  .community-link {
    color: var(--text-muted);
    text-decoration: none;
    cursor: pointer;
  }
  .community-link:hover { color: var(--text-accent); }

  /* Bio */
  .author-bio { font-size: 13px; color: var(--text-muted); line-height: 1.5; }
  .author-bio :global(p) { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-muted); }
  .author-bio :global(a) { color: var(--text-accent); text-decoration: none; }
  .author-bio :global(a:hover) { text-decoration: underline; }
  .author-bio :global(a.tag) { color: var(--tag-color); background: var(--tag-background); padding: 1px 4px; border-radius: var(--tag-radius); font-size: 11px; }
  .author-bio :global(a.tag:hover) { background: var(--tag-background-hover); text-decoration: none; }

  /* Subscription dropdown menu */
  .sub-dropdown-menu {
    position: absolute;
    left: 0;
    top: calc(100% + 4px);
    min-width: 180px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 100;
    padding: 4px;
    display: flex;
    flex-direction: column;
  }
  .sub-dropdown-info { padding: 6px 10px; font-size: 11px; color: var(--text-faint); }
  .sub-dropdown-item {
    display: flex;
    align-items: center;
    padding: 6px 10px;
    font-size: 12px;
    color: var(--text-normal);
    border: none;
    background: none;
    cursor: pointer;
    border-radius: 4px;
    transition: background 0.1s;
    min-height: 30px;
  }
  .sub-dropdown-item:hover:not(:disabled) { background: var(--background-modifier-hover); }
  .sub-dropdown-item:focus { outline: none; box-shadow: none; }
  .sub-dropdown-item:disabled { opacity: 0.6; cursor: not-allowed; }
  .sub-dropdown-item.danger { color: var(--color-red); }
  .sub-dropdown-divider { height: 1px; background: var(--background-modifier-border); margin: 4px 0; }

  /* Author Note Body Preview */
  .author-note-body {
    padding: 8px 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-muted);
    border-left: 2px solid var(--text-accent);
    padding-left: 10px;
    margin: 4px 12px 4px 0;
  }
  .author-note-body :global(p) { margin: 4px 0; }
  .author-note-body :global(h1),
  .author-note-body :global(h2),
  .author-note-body :global(h3) { display: none; }
  .author-note-open-icon {
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    color: var(--text-faint);
    margin-left: 4px;
    vertical-align: middle;
  }
  .author-note-open-icon:hover { color: var(--text-accent); }
</style>
