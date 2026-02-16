<script lang="ts">
/**
 * ArchiveStatusIndicator - Shows status of social media URL archiving
 *
 * Displays different UI based on archive state:
 * - 'prompt': Not shown (handled by ArchiveSuggestionModal)
 * - 'archiving': Loading indicator
 * - 'completed': Full PostCard with archived content
 * - 'skipped': Not shown (regular link preview)
 * - 'failed': Error message with fallback link
 */

import type { PostData, Platform } from '@/types/post';
import { setIcon } from 'obsidian';
import { getPlatformSimpleIcon } from '@/services/IconService';

/**
 * Archive state (passed from PostComposer)
 */
interface ArchiveState {
  url: string;
  platform: Platform;
  status: 'prompt' | 'archiving' | 'completed' | 'skipped' | 'failed';
  archivedData?: PostData;
  error?: string;
}

interface ArchiveStatusIndicatorProps {
  state: ArchiveState;
  getResourcePath: (path: string) => string;
  onRetryArchive?: (url: string) => void;
}

let { state, getResourcePath, onRetryArchive }: ArchiveStatusIndicatorProps = $props();

/**
 * Render platform icon as SVG string (for @html directive)
 */
function renderPlatformIconSVG(platform: Platform): string {
  // For user posts, render user initial avatar
  if (platform === 'post') {
    const userInitial = 'U';
    return `
      <div style="
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 600;
      ">${userInitial}</div>
    `;
  }

  // For social media posts, use Simple Icons SVG
  const icon = getPlatformSimpleIcon(platform);
  if (icon) {
    return `
      <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="fill: var(--text-accent); width: 20px; height: 20px;">
        <title>${icon.title}</title>
        <path d="${icon.path}"/>
      </svg>
    `;
  }

  return '';
}

/**
 * Get platform name
 */
function getPlatformName(platform: Platform): string {
  const names: Record<Platform, string> = {
    facebook: 'Facebook',
    instagram: 'Instagram',
    x: 'X (Twitter)',
    linkedin: 'LinkedIn',
    tiktok: 'TikTok',
    threads: 'Threads',
    youtube: 'YouTube',
    reddit: 'Reddit',
    pinterest: 'Pinterest',
    substack: 'Substack',
    mastodon: 'Mastodon',
    bluesky: 'Bluesky',
    post: 'Post'
  };
  return names[platform] || platform;
}

/**
 * Truncate URL for display
 */
function truncateUrl(url: string): string {
  const maxLength = 60;
  if (url.length <= maxLength) {
    return url;
  }
  return url.substring(0, maxLength - 3) + '...';
}
</script>

<!-- Only show for 'archiving', 'completed', 'failed' states -->
{#if state.status === 'archiving'}
  <!-- Archiving state: Loading indicator -->
  <div class="archive-status-container archiving">
    <div class="archive-status-header">
      <span class="platform-icon">{@html renderPlatformIconSVG(state.platform)}</span>
      <span class="platform-name">{getPlatformName(state.platform)} Post</span>
    </div>
    <div class="archive-status-body">
      <div class="loading-spinner">
        <div class="spinner"></div>
        <span class="loading-text">Archiving original content...</span>
      </div>
      <code class="archive-url">{truncateUrl(state.url)}</code>
    </div>
  </div>
{:else if state.status === 'completed' && state.archivedData}
  <!-- Completed state: Show archived post card -->
  <div class="archive-status-container completed">
    <div class="archive-status-header">
      <span class="archive-badge">📦</span>
      <span>Archived Original Content</span>
    </div>
    <div class="archive-status-body">
      <!-- Archived post content -->
      <div class="archived-post-card">
        <!-- Author info -->
        <div class="post-author">
          {#if state.archivedData.author.avatar}
            <img
              src={getResourcePath(state.archivedData.author.avatar)}
              alt={state.archivedData.author.name}
              class="author-avatar"
            />
          {/if}
          <div class="author-info">
            <div class="author-name">{state.archivedData.author.name}</div>
            {#if state.archivedData.author.handle}
              <div class="author-handle">{state.archivedData.author.handle}</div>
            {/if}
          </div>
        </div>

        <!-- Post content -->
        <div class="post-content">
          {state.archivedData.content.text}
        </div>

        <!-- Media preview (if exists) -->
        {#if state.archivedData.media && state.archivedData.media.length > 0}
          <div class="post-media-preview">
            {#if state.archivedData.media[0]?.type === 'image'}
              <img
                src={getResourcePath(state.archivedData.media[0].url)}
                alt={state.archivedData.media[0].altText || 'Media'}
                class="media-thumbnail"
              />
            {:else if state.archivedData.media[0]?.type === 'video'}
              <video
                src={getResourcePath(state.archivedData.media[0].url)}
                class="media-thumbnail"
                controls
              ></video>
            {/if}
            {#if state.archivedData.media.length > 1}
              <div class="media-count">+{state.archivedData.media.length - 1} more</div>
            {/if}
          </div>
        {/if}

        <!-- Metadata -->
        <div class="post-metadata">
          {#if state.archivedData.metadata.likes !== undefined}
            <span class="metadata-item">❤️ {state.archivedData.metadata.likes}</span>
          {/if}
          {#if state.archivedData.metadata.comments !== undefined}
            <span class="metadata-item">💬 {state.archivedData.metadata.comments}</span>
          {/if}
          {#if state.archivedData.metadata.shares !== undefined}
            <span class="metadata-item">🔄 {state.archivedData.metadata.shares}</span>
          {/if}
          {#if state.archivedData.metadata.timestamp}
            <span class="metadata-item metadata-timestamp">
              {new Date(state.archivedData.metadata.timestamp).toLocaleString()}
            </span>
          {/if}
        </div>

        <!-- Source link -->
        <a href={state.url} class="post-source-link" target="_blank" rel="noopener noreferrer">
          View original post →
        </a>
      </div>
    </div>
  </div>
{:else if state.status === 'failed'}
  <!-- Failed state: Error message with retry option -->
  <div class="archive-status-container failed">
    <div class="archive-status-header">
      <span class="error-icon">⚠️</span>
      <span>Archive Failed</span>
    </div>
    <div class="archive-status-body">
      <div class="error-details">
        <p class="error-message">{state.error || 'Failed to archive the post.'}</p>

        <div class="error-suggestions">
          <span>You can:</span>
          <ul class="suggestions-list">
            <li>Try archiving again using the Archive Modal</li>
            <li>Check your internet connection</li>
            <li>Verify the URL is still accessible</li>
          </ul>
        </div>

        <!-- Action buttons -->
        <div class="error-actions">
          {#if onRetryArchive}
            <button
              class="retry-archive-btn"
              onclick={() => onRetryArchive?.(state.url)}>
              📦 Archive this
            </button>
          {/if}

          <a href={state.url}
             target="_blank"
             rel="noopener noreferrer"
             class="view-original-link">
            → View Original Source
          </a>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
.archive-status-container {
  margin: 12px 0;
  border-radius: 8px;
  border: 1px solid var(--background-modifier-border);
  background: var(--background-secondary);
  overflow: hidden;
}

.archive-status-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--background-modifier-border);
  font-weight: 600;
  font-size: 0.95em;
}

/* Removed aggressive error styling */

.platform-icon,
.archive-badge,
.error-icon {
  font-size: 1.2em;
}

.archive-status-body {
  padding: 16px;
}

/* Archiving state */
.loading-spinner {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--background-modifier-border);
  border-top-color: var(--interactive-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-text {
  color: var(--text-muted);
  font-size: 0.9em;
}

.archive-url {
  display: block;
  padding: 8px;
  background: var(--background-primary);
  border-radius: 4px;
  font-size: 0.85em;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Completed state */
.archived-post-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.post-author {
  display: flex;
  align-items: center;
  gap: 12px;
}

.author-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
}

.author-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.author-name {
  font-weight: 600;
  font-size: 0.95em;
}

.author-handle {
  font-size: 0.85em;
  color: var(--text-muted);
}

.post-content {
  font-size: 0.95em;
  line-height: 1.5;
  white-space: pre-wrap;
}

.post-media-preview {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  background: var(--background-primary);
}

.media-thumbnail {
  width: 100%;
  max-height: 300px;
  object-fit: cover;
  display: block;
}

.media-count {
  position: absolute;
  bottom: 8px;
  right: 8px;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  border-radius: 4px;
  font-size: 0.85em;
  font-weight: 500;
}

.post-metadata {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 0.85em;
  color: var(--text-muted);
  padding-top: 8px;
  border-top: 1px solid var(--background-modifier-border);
}

.metadata-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.metadata-timestamp {
  margin-left: auto;
}

.post-source-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-accent);
  text-decoration: none;
  font-size: 0.9em;
  padding: 4px 0;
}

.post-source-link:hover {
  text-decoration: underline;
}

/* Failed state - Softer design */
.archive-status-container.failed {
  border-color: var(--text-warning);
  background: var(--background-secondary);
}

.archive-status-container.failed .archive-status-header {
  background: rgba(255, 152, 0, 0.1);
  border-bottom: 1px solid rgba(255, 152, 0, 0.2);
  color: var(--text-normal);
}

.error-icon {
  color: var(--text-warning, #ff9800);
}

.error-details {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.error-message {
  margin: 0;
  font-size: 0.95em;
  color: var(--text-normal);
  line-height: 1.4;
}

.error-suggestions {
  font-size: 0.9em;
  color: var(--text-muted);
}

.suggestions-list {
  margin: 4px 0 0 20px;
  padding: 0;
  list-style-type: disc;
}

.suggestions-list li {
  margin: 4px 0;
  line-height: 1.5;
}

.view-original-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-accent);
  text-decoration: none;
  font-size: 0.95em;
  font-weight: 500;
  padding: 8px 12px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 4px;
  background: var(--background-primary);
  transition: all 0.2s ease;
  align-self: flex-start;
}

.view-original-link:hover {
  background: var(--background-modifier-hover);
  text-decoration: none;
  border-color: var(--text-accent);
}
</style>
