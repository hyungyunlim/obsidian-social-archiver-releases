<script lang="ts">
/**
 * ProfilePreviewStep - Profile Preview and Schedule Configuration
 *
 * @deprecated This component is deprecated and will be removed in the next major version.
 * Use ArchiveModal instead which provides subscribe options with schedule configuration.
 *
 * Features:
 * - Profile card with avatar, name, stats
 * - Schedule configuration (MVP: daily only)
 * - Destination folder selector
 * - Subscribe action
 */

import type { ProfilePreviewStepProps, ScheduleConfig, DestinationConfig } from './types';
import { formatFollowerCount } from './types';

let {
  validationResult,
  scheduleConfig,
  destinationConfig,
  onScheduleChange,
  onDestinationChange,
  onSubscribe,
  onBack,
  onCancel,
  isSubmitting,
}: ProfilePreviewStepProps = $props();

const { profileMetadata, initialPosts } = validationResult;

/**
 * Handle time change
 */
function handleTimeChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  onScheduleChange({ ...scheduleConfig, time: target.value });
}

/**
 * Handle folder change
 */
function handleFolderChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  onDestinationChange({ ...destinationConfig, folder: target.value });
}

/**
 * Get avatar fallback
 */
function getAvatarFallback(name: string): string {
  return name.charAt(0).toUpperCase();
}
</script>

<div class="profile-preview-step">
  <div class="step-content">
    <!-- Profile Card -->
    <div class="profile-card">
      <div class="profile-avatar">
        {#if profileMetadata.avatar}
          <img src={profileMetadata.avatar} alt={profileMetadata.displayName} />
        {:else}
          <span class="avatar-fallback">{getAvatarFallback(profileMetadata.displayName)}</span>
        {/if}
        {#if profileMetadata.isVerified}
          <div class="verified-badge" title="Verified">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
            </svg>
          </div>
        {/if}
      </div>

      <div class="profile-info">
        <h3 class="profile-name">{profileMetadata.displayName}</h3>
        <p class="profile-handle">@{profileMetadata.handle}</p>

        <div class="profile-stats">
          <span class="stat">
            <strong>{formatFollowerCount(profileMetadata.followersCount)}</strong> followers
          </span>
          <span class="stat">
            <strong>{profileMetadata.postsCount}</strong> posts
          </span>
        </div>

        {#if profileMetadata.bio}
          <p class="profile-bio">{profileMetadata.bio}</p>
        {/if}
      </div>
    </div>

    <!-- Posts Ready -->
    <div class="posts-ready">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="success-icon">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
      <span>{initialPosts.length} recent posts ready to archive</span>
    </div>

    <!-- Schedule Configuration -->
    <div class="config-section">
      <h4 class="config-title">Schedule</h4>

      <div class="config-row">
        <div class="config-label">
          <span>Frequency</span>
        </div>
        <div class="frequency-badge">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          Daily
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="check-icon">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
      </div>

      <div class="config-row">
        <label for="archive-time" class="config-label">
          <span>Time</span>
          <span class="label-hint">(optional)</span>
        </label>
        <input
          type="time"
          id="archive-time"
          class="time-input"
          value={scheduleConfig.time}
          onchange={handleTimeChange}
        />
      </div>
    </div>

    <!-- Destination Configuration -->
    <div class="config-section">
      <h4 class="config-title">Destination</h4>

      <div class="config-row">
        <label for="archive-folder" class="config-label">
          <span>Folder</span>
        </label>
        <input
          type="text"
          id="archive-folder"
          class="folder-input"
          value={destinationConfig.folder}
          onchange={handleFolderChange}
          placeholder="Social Archives/Instagram"
        />
      </div>
    </div>
  </div>

  <!-- Footer -->
  <div class="step-footer">
    <button class="btn btn-tertiary" onclick={onCancel}>
      Cancel
    </button>
    <button class="btn btn-secondary" onclick={onBack}>
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="19" y1="12" x2="5" y2="12"></line>
        <polyline points="12 19 5 12 12 5"></polyline>
      </svg>
      Back
    </button>
    <button class="btn btn-primary" onclick={onSubscribe} disabled={isSubmitting}>
      {#if isSubmitting}
        <span class="btn-spinner"></span>
        Creating...
      {:else}
        Subscribe
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="5" y1="12" x2="19" y2="12"></line>
          <polyline points="12 5 19 12 12 19"></polyline>
        </svg>
      {/if}
    </button>
  </div>
</div>

<style>
  .profile-preview-step {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .step-content {
    flex: 1;
    padding: 20px;
    overflow-y: auto;
  }

  /* Profile Card */
  .profile-card {
    display: flex;
    gap: 16px;
    padding: 16px;
    background: var(--background-secondary);
    border-radius: 12px;
    margin-bottom: 16px;
  }

  .profile-avatar {
    position: relative;
    flex-shrink: 0;
  }

  .profile-avatar img {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    object-fit: cover;
  }

  .avatar-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    font-size: 24px;
    font-weight: 600;
  }

  .verified-badge {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 20px;
    height: 20px;
    background: #1da1f2;
    border: 2px solid var(--background-secondary);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
  }

  .profile-info {
    flex: 1;
    min-width: 0;
  }

  .profile-name {
    margin: 0 0 2px 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-normal);
  }

  .profile-handle {
    margin: 0 0 8px 0;
    font-size: 13px;
    color: var(--text-muted);
  }

  .profile-stats {
    display: flex;
    gap: 16px;
    margin-bottom: 8px;
  }

  .stat {
    font-size: 12px;
    color: var(--text-muted);
  }

  .stat strong {
    color: var(--text-normal);
    font-weight: 600;
  }

  .profile-bio {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* Posts Ready */
  .posts-ready {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: var(--background-success, rgba(76, 175, 80, 0.1));
    border-radius: 8px;
    margin-bottom: 20px;
    font-size: 14px;
    color: var(--text-success, #4caf50);
  }

  .success-icon {
    flex-shrink: 0;
  }

  /* Config Sections */
  .config-section {
    margin-bottom: 20px;
  }

  .config-title {
    margin: 0 0 12px 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-normal);
  }

  .config-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }

  .config-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-normal);
  }

  .label-hint {
    color: var(--text-muted);
    font-size: 12px;
  }

  .frequency-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-radius: 20px;
    font-size: 13px;
    font-weight: 500;
  }

  .check-icon {
    margin-left: 2px;
  }

  .time-input {
    padding: 8px 12px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 13px;
  }

  .time-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .folder-input {
    flex: 1;
    padding: 8px 12px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 13px;
  }

  .folder-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  /* Footer */
  .step-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 16px 20px;
    border-top: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 18px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    border: none;
  }

  .btn-tertiary {
    background: transparent;
    color: var(--text-muted);
  }

  .btn-tertiary:hover {
    color: var(--text-normal);
    background: var(--background-modifier-hover);
  }

  .btn-secondary {
    background: var(--background-modifier-border);
    color: var(--text-normal);
  }

  .btn-secondary:hover {
    background: var(--background-modifier-hover);
  }

  .btn-primary {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  .btn-primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .btn-primary:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .btn-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
