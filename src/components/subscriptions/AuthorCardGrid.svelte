<script lang="ts">
/**
 * AuthorCardGrid - Masonry Card Grid for Author Catalog
 *
 * Displays authors as compact cards in a responsive masonry layout.
 * Read-only browse view: card click opens Author Detail View.
 * Mobile-first design with 44px minimum touch targets.
 */

import type { App } from 'obsidian';
import type { AuthorCatalogEntry } from '@/types/author-catalog';
import {
  getPlatformSimpleIcon,
  type PlatformIcon
} from '@/services/IconService';
import { formatNumber, formatNumberWithCommas } from '@/utils/formatNumber';
import { generateAuthorKey } from '@/services/AuthorDeduplicator';

// ============================================================================
// Props
// ============================================================================

interface AuthorCardGridProps {
  app: App;
  authors: AuthorCatalogEntry[];
  onViewDetail?: (author: AuthorCatalogEntry) => void;
  onOpenNote?: (author: AuthorCatalogEntry) => void;
}

let {
  app,
  authors,
  onViewDetail,
  onOpenNote
}: AuthorCardGridProps = $props();

// ============================================================================
// Helpers
// ============================================================================

/**
 * Compute avatar source URL with priority:
 * 1. localAvatar (vault file) - use Obsidian's resource path
 * 2. avatar (external URL) - use directly
 * 3. null - show initials fallback
 */
function getAvatarSrc(author: AuthorCatalogEntry): string | null {
  if (author.localAvatar) {
    return app.vault.adapter.getResourcePath(author.localAvatar);
  }
  return author.avatar || null;
}

/**
 * Generate initials from author name (max 2 characters)
 */
function getInitials(author: AuthorCatalogEntry): string {
  const name = author.authorName || '';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    const first = parts[0]?.[0] ?? '';
    const last = parts[parts.length - 1]?.[0] ?? '';
    return (first + last).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

/**
 * Clean author name by removing embedded handle patterns like "Name (@handle)"
 */
function getDisplayName(author: AuthorCatalogEntry): string {
  const name = author.displayNameOverride ?? author.authorName ?? '';
  return name.replace(/\s*\(@?[^)]+\)\s*$/, '').replace(/\s+@\S+\s*$/, '').trim();
}

/**
 * Truncate bio to 80 characters
 */
function truncateBio(bio: string | null | undefined): string {
  if (!bio) return '';
  const maxLength = 80;
  if (bio.length <= maxLength) return bio;
  return bio.substring(0, maxLength).trim() + '...';
}

/**
 * Format relative time from a Date
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  const weeks = Math.floor(diffDays / 7);
  if (diffDays < 30) return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
  const months = Math.floor(diffDays / 30);
  if (diffDays < 365) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  const years = Math.floor(diffDays / 365);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}

/**
 * Build activity text for a card
 */
function getActivityText(author: AuthorCatalogEntry): string | null {
  if (author.status === 'subscribed' && author.lastRunAt) {
    return `Last run ${formatRelativeTime(author.lastRunAt)}`;
  }
  if (author.lastSeenAt) {
    return `Seen ${formatRelativeTime(author.lastSeenAt)}`;
  }
  return null;
}

/**
 * Check if handle should be displayed (filter out invalid/unknown handles)
 */
function shouldShowHandle(author: AuthorCatalogEntry): boolean {
  if (!author.handle) return false;
  const cleanHandle = author.handle.replace(/^@/, '').toLowerCase();
  if (cleanHandle === 'unknown') return false;
  // Filter out YouTube channel IDs
  if (author.platform === 'youtube' && cleanHandle.startsWith('uc')) return false;
  return true;
}

/**
 * Handle card click
 */
function handleCardClick(author: AuthorCatalogEntry): void {
  onViewDetail?.(author);
}

/**
 * Handle card keyboard activation (Enter/Space)
 */
function handleCardKeydown(event: KeyboardEvent, author: AuthorCatalogEntry): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    onViewDetail?.(author);
  }
}

/**
 * Handle note icon click (stop propagation to avoid card click)
 */
function handleNoteClick(event: Event, author: AuthorCatalogEntry): void {
  event.stopPropagation();
  onOpenNote?.(author);
}

/**
 * Handle avatar image load error - hide img and show initials fallback
 */
function handleAvatarError(event: Event): void {
  const target = event.currentTarget as HTMLImageElement;
  target.style.display = 'none';
  const placeholder = target.nextElementSibling as HTMLElement;
  if (placeholder) placeholder.style.display = 'flex';
}
</script>

<div class="author-card-grid">
  {#each authors as author (generateAuthorKey(author.authorUrl, author.authorName, author.platform))}
    {@const avatarSrc = getAvatarSrc(author)}
    {@const initials = getInitials(author)}
    {@const displayName = getDisplayName(author)}
    {@const platformIcon = getPlatformSimpleIcon(author.platform, author.authorUrl)}
    {@const activityText = getActivityText(author)}
    {@const bio = truncateBio(author.bio)}

    <div
      class="author-card"
      role="button"
      tabindex="0"
      aria-label="{displayName} on {author.platform}"
      onclick={() => handleCardClick(author)}
      onkeydown={(e) => handleCardKeydown(e, author)}
    >
      <!-- Avatar (centered) -->
      <div class="card-avatar-wrap">
        <div class="card-avatar">
          {#if avatarSrc}
            <img
              src={avatarSrc}
              alt={author.authorName}
              class="card-avatar-img"
              onerror={handleAvatarError}
            />
            <div class="card-avatar-initials card-avatar-fallback" style="display: none;">
              {initials}
            </div>
          {:else}
            <div class="card-avatar-initials">
              {initials}
            </div>
          {/if}
        </div>
        <!-- Status dot overlay on avatar -->
        {#if author.status === 'subscribed'}
          <span class="card-avatar-status subscribed" title="Subscribed"></span>
        {:else if author.status === 'error'}
          <span class="card-avatar-status error" title="Error"></span>
        {/if}
      </div>

      <!-- Name + Handle (centered) -->
      <div class="card-name-block">
        <div class="card-name-row">
          <span class="card-name" title={author.authorName}>{displayName}</span>
          {#if author.hasNote && onOpenNote}
            <span
              class="card-note-icon"
              role="button"
              tabindex="0"
              onclick={(e) => handleNoteClick(e, author)}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); handleNoteClick(e, author); } }}
              title="Open author note"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14,2 14,8 20,8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            </span>
          {/if}
        </div>
        {#if shouldShowHandle(author)}
          <span class="card-handle">{author.handle}</span>
        {/if}
      </div>

      <!-- Platform icon (top-right corner) -->
      {#if platformIcon}
        <div class="card-platform-badge">
          <svg
            class="card-platform-icon"
            role="img"
            aria-label={platformIcon.title}
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d={platformIcon.path} fill="#{platformIcon.hex}"/>
          </svg>
        </div>
      {/if}

      <!-- Stats Row -->
      <div class="card-stats">
        <span class="card-stat" title="{author.archiveCount} archived posts">
          <svg class="card-stat-icon" xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="21,8 21,21 3,21 3,8"/>
            <rect x="1" y="3" width="22" height="5"/>
            <line x1="10" y1="12" x2="14" y2="12"/>
          </svg>
          <span class="card-stat-value">{author.archiveCount}</span>
        </span>

        {#if author.followers !== null && author.followers !== undefined}
          <span class="card-stat" title="{formatNumberWithCommas(author.followers)} followers">
            <svg class="card-stat-icon" xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            <span class="card-stat-value">{formatNumber(author.followers)}</span>
          </span>
        {/if}

        {#if author.postsCount !== null && author.postsCount !== undefined}
          <span class="card-stat" title="{formatNumberWithCommas(author.postsCount)} posts">
            <svg class="card-stat-icon" xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14,2 14,8 20,8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            <span class="card-stat-value">{formatNumber(author.postsCount)}</span>
          </span>
        {/if}
      </div>

      <!-- Bio (1 line truncated) -->
      {#if bio}
        <div class="card-bio" title={author.bio && author.bio.length > 80 ? author.bio : undefined}>
          {bio}
        </div>
      {/if}

      <!-- Activity Line -->
      {#if activityText}
        <div class="card-activity">
          {activityText}
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  /* ============================================================================
   * Masonry Grid Layout
   * ============================================================================ */

  .author-card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 12px;
    padding: 8px 0;
    width: 100%;
  }

  /* ============================================================================
   * Card Base
   * ============================================================================ */

  .author-card {
    padding: 24px 10px 18px;
    border-radius: 8px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    cursor: pointer;
    transition: background 0.15s, box-shadow 0.15s;
    text-align: center;
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow: hidden;
  }

  .author-card:hover {
    background: var(--background-modifier-hover);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }

  .author-card:focus-visible {
    outline: 2px solid var(--interactive-accent);
    outline-offset: -2px;
  }

  /* ============================================================================
   * Avatar (centered with status dot overlay)
   * ============================================================================ */

  .card-avatar-wrap {
    position: relative;
    display: inline-block;
    margin-bottom: 8px;
  }

  .card-avatar {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    overflow: hidden;
  }

  .card-avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
  }

  .card-avatar-initials {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    font-size: 16px;
    font-weight: 600;
    border-radius: 50%;
    user-select: none;
  }

  .card-avatar-fallback { display: none; }

  .card-avatar-status {
    position: absolute;
    bottom: 1px;
    right: 1px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid var(--background-secondary);
  }
  .card-avatar-status.subscribed { background: var(--color-green, #22c55e); }
  .card-avatar-status.error { background: var(--color-red, #ef4444); }

  /* ============================================================================
   * Name + Handle (centered)
   * ============================================================================ */

  .card-name-block {
    margin-bottom: 6px;
    width: 100%;
    overflow: hidden;
  }

  .card-name-row {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    max-width: 100%;
  }

  .card-name {
    font-weight: 600;
    font-size: 13px;
    color: var(--text-normal);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .card-note-icon {
    flex-shrink: 0;
    color: var(--text-faint);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
  }
  .card-note-icon:hover { color: var(--text-accent); }

  .card-handle {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
  }

  /* ============================================================================
   * Platform + Status
   * ============================================================================ */

  .card-platform-badge {
    position: absolute;
    top: 8px;
    right: 8px;
  }

  .card-platform-icon {
    width: 14px;
    height: 14px;
    opacity: 0.6;
  }

  /* ============================================================================
   * Stats Row
   * ============================================================================ */

  .card-stats {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 4px;
  }

  .card-stat {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--text-muted);
    font-size: 11px;
  }

  .card-stat-icon {
    flex-shrink: 0;
    opacity: 0.7;
  }

  .card-stat-value {
    white-space: nowrap;
  }

  /* ============================================================================
   * Bio
   * ============================================================================ */

  .card-bio {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.4;
    margin-bottom: 6px;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    width: 100%;
    word-break: break-word;
  }

  /* ============================================================================
   * Activity Line
   * ============================================================================ */

  .card-activity {
    font-size: 10px;
    color: var(--text-faint);
    margin-top: 2px;
  }

  /* ============================================================================
   * Screen Reader Only
   * ============================================================================ */

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }
</style>
