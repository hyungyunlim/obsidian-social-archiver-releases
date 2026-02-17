import type { PostData, Platform } from '../../../types/post';
import {
  getPlatformSimpleIcon,
} from '../../../services/IconService';
import { App, setIcon, Platform as ObsidianPlatform, Component, TFile } from 'obsidian';
import type { LinkPreviewRenderer } from './LinkPreviewRenderer';
import { createSVGElement } from '../../../utils/dom-helpers';

/**
 * CompactPostCardRenderer - Renders simplified post cards for additional embedded archives
 *
 * Displays:
 * - Platform icon + Author name
 * - Content preview (truncated)
 * - Single thumbnail image (if available)
 * - Basic metadata (likes, comments, etc.)
 *
 * Suitable for displaying 2nd+ embedded archives in a space-efficient manner
 */
export class CompactPostCardRenderer extends Component {
  private onExpandCallback?: (post: PostData, expandedContainer: HTMLElement) => Promise<void>;
  private app?: App; // Obsidian App for resource path conversion
  private linkPreviewRenderer?: LinkPreviewRenderer;
  private parentPost?: PostData; // Parent post for self-boost avatar lookup

  /**
   * Extract plain text from markdown (remove link syntax but keep link text)
   * Example: [#girlblogger](url) -> #girlblogger
   */
  private extractPlainTextFromMarkdown(text: string): string {
    // Convert markdown links [text](url) to just text
    return text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  }

  /**
   * Set Obsidian app instance
   */
  public setApp(app: App): void {
    this.app = app;
  }

  /**
   * Set LinkPreviewRenderer for external link previews
   */
  public setLinkPreviewRenderer(renderer: LinkPreviewRenderer): void {
    this.linkPreviewRenderer = renderer;
  }

  /**
   * Set expand callback to render full post inline
   */
  public setOnExpandCallback(callback: (post: PostData, expandedContainer: HTMLElement) => Promise<void>): void {
    this.onExpandCallback = callback;
  }

  /**
   * Set parent post for self-boost avatar lookup
   */
  public setParentPost(parent: PostData): void {
    this.parentPost = parent;
  }

  /**
   * Render a compact post card with expandable full view
   */
  public render(container: HTMLElement, post: PostData): HTMLElement {
    // Wrapper for card + expanded content
    const wrapper = container.createDiv({ cls: 'compact-post-wrapper' });
    wrapper.addClass('sa-max-w-full', 'sa-overflow-hidden', 'cpcr-wrapper');

    // Check container width to determine initial state
    // Expand if: Desktop platform AND container width > 768px (not in narrow sidebars)
    // OR if platform is YouTube/TikTok (always expand for video content)
    const containerWidth = container.clientWidth || container.offsetWidth;
    const isWideEnough = containerWidth > 768;
    const isVideoEmbed = post.platform === 'youtube' || post.platform === 'tiktok';
    let isExpanded = (ObsidianPlatform.isDesktop && isWideEnough) || isVideoEmbed;

    const card = wrapper.createDiv({ cls: 'compact-post-card' });
    card.addClass('sa-relative', 'sa-flex', 'sa-rounded-8', 'sa-bg-primary', 'sa-border', 'sa-clickable', 'sa-transition', 'sa-overflow-hidden', 'cpcr-card');

    // Expanded content container (initially hidden)
    const expandedContent = wrapper.createDiv({ cls: 'compact-post-expanded' });
    expandedContent.addClass('sa-hidden', 'sa-relative', 'sa-rounded-8', 'sa-bg-primary', 'sa-border', 'sa-overflow-hidden', 'sa-max-w-full', 'cpcr-expanded');

    // Initial display state
    if (isExpanded) {
      card.addClass('sa-hidden');
      expandedContent.removeClass('sa-hidden');
      expandedContent.addClass('sa-block');
    } else {
      expandedContent.addClass('sa-hidden');
    }

    // If starting in expanded state, immediately render full content
    if (isExpanded && this.onExpandCallback && expandedContent.children.length === 0) {
      void this.onExpandCallback(post, expandedContent);
    }

    // Hover effect handled by CSS .cpcr-card:hover

    // Toggle function
    const toggleExpanded = async (e: MouseEvent) => {
      e.stopPropagation();

      // Don't toggle if user is selecting text
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) {
        return;
      }

      // Don't toggle if clicking on a link
      const target = e.target as HTMLElement;
      if (target.tagName === 'A' || target.closest('a')) {
        return;
      }

      // Don't toggle if clicking on callout fold button (transcript expand/collapse)
      if (target.closest('.callout-fold') || target.classList.contains('callout-fold')) {
        return;
      }

      // Don't toggle if clicking on platform icon
      if (target.closest('.platform-icon-badge') || target.classList.contains('platform-icon-badge')) {
        return;
      }

      isExpanded = !isExpanded;

      if (isExpanded) {
        // Expand - hide summary card, show full content
        card.addClass('sa-hidden');
        expandedContent.removeClass('sa-hidden');
        expandedContent.addClass('sa-block');

        // Render full post content if callback is set and content is empty
        if (this.onExpandCallback && expandedContent.children.length === 0) {
          await this.onExpandCallback(post, expandedContent);
        }
      } else {
        // Collapse - show summary card, hide full content
        card.removeClass('sa-hidden');
        expandedContent.addClass('sa-hidden');
        expandedContent.removeClass('sa-block');
      }
    };

    // Click summary card to expand
    card.addEventListener('click', (e) => { void toggleExpanded(e); });

    // Click expanded content to collapse
    expandedContent.addEventListener('click', (e) => { void toggleExpanded(e); });

    // Platform icon removed for embedded archives
    // Embedded archives don't need platform identification as context is clear

    // Thumbnail image (left side, if available)
    // For YouTube: use thumbnail field, for others: use first media image
    const showThumbnail = post.platform === 'youtube'
      ? !!post.thumbnail
      : (post.media.length > 0 && post.media[0] && post.media[0].type === 'image');

    if (showThumbnail) {
      const thumbnail = card.createDiv();
      thumbnail.addClass('sa-flex-shrink-0', 'sa-relative', 'sa-flex-center', 'sa-bg-secondary', 'cpcr-thumbnail');

      // For YouTube: use thumbnail URL, for others: use first media
      let imagePath = post.platform === 'youtube' ? post.thumbnail : post.media[0]?.url;

      if (imagePath) {
        // Convert relative paths (../../../../attachments/...) to vault paths
        if (imagePath.includes('../attachments/')) {
          imagePath = imagePath.replace(/^(\.\.\/)+/, '');
        }

        // Convert vault paths to resource paths (skip for external URLs like YouTube thumbnails)
        if (this.app && !imagePath.startsWith('http')) {
          const file = this.app.vault.getAbstractFileByPath(imagePath);
          if (file instanceof TFile) {
            imagePath = this.app.vault.getResourcePath(file);
          }
        }

        thumbnail.setCssStyles({ backgroundImage: `url("${imagePath}")` });
      }

      // For YouTube: show play icon overlay
      if (post.platform === 'youtube') {
        const playIcon = thumbnail.createDiv({ text: '▶' });
        playIcon.addClass('sa-absolute', 'sa-icon-40', 'sa-rounded-full', 'sa-text-md', 'cpcr-play-icon');
      }

      // Media count badge (if multiple) - for non-YouTube only
      if (post.platform !== 'youtube' && post.media.length > 1) {
        const badge = thumbnail.createDiv({ text: `+${post.media.length - 1}` });
        badge.addClass('sa-absolute', 'sa-rounded-4', 'sa-text-xs', 'sa-font-semibold', 'cpcr-media-badge');
      }
    }

    // External platform link/icon
    const externalUrl = this.getOriginalUrl(post);
    const platformIcon = card.createDiv({ cls: 'platform-icon-badge' });
    platformIcon.addClass('sa-absolute', 'sa-rounded-full', 'sa-bg-primary', 'sa-border', 'sa-flex-center', 'sa-z-10', 'cpcr-platform-icon');
    platformIcon.addClass(externalUrl ? 'cpcr-platform-icon--linkable' : 'cpcr-platform-icon--static');
    platformIcon.setAttribute('title', externalUrl ? `Open on ${post.platform}` : post.platform);
    platformIcon.addEventListener('click', (event) => {
      event.stopPropagation();
      if (externalUrl) {
        window.open(externalUrl, '_blank');
      }
    });
    const iconWrapper = platformIcon.createDiv();
    iconWrapper.addClass('sa-icon-14');
    const simpleIcon = getPlatformSimpleIcon(post.platform);
    if (simpleIcon) {
      const svg = createSVGElement(simpleIcon, {
        fill: 'var(--text-accent)',
        width: '100%',
        height: '100%'
      });
      iconWrapper.appendChild(svg);
    } else {
      setIcon(iconWrapper, 'external-link');
    }
    // Hover effects handled by CSS .cpcr-platform-icon--linkable:hover

    // Right section: Author + Content
    const leftSection = card.createDiv();
    leftSection.addClass('sa-flex-1', 'sa-min-w-0', 'sa-flex-col', 'sa-gap-8', 'sa-p-12', 'cpcr-content-section');

    // Author name row
    const headerRow = leftSection.createDiv();
    headerRow.addClass('sa-flex-row', 'sa-gap-8');

    // Author avatar (with platform badge)
    this.renderAuthorAvatar(headerRow, post);

    // Author name (platform name removed - shown in top-right icon instead)
    const authorName = headerRow.createSpan({ text: post.author.name });
    authorName.addClass('sa-font-semibold', 'sa-text-normal', 'sa-truncate');
    // Mobile: use smaller font size (11px) for author name
    authorName.addClass(ObsidianPlatform.isMobile ? 'cpcr-author-name--mobile' : 'cpcr-author-name--desktop');

    // Content preview
    // For YouTube: show title in bold + description preview
    // For others: show content text
    if (post.platform === 'youtube' && post.title) {
      // YouTube title (bold)
      const titlePreview = leftSection.createDiv();
      titlePreview.addClass('sa-text-md', 'sa-font-semibold', 'sa-text-normal', 'sa-leading-tight', 'sa-overflow-hidden', 'cpcr-line-clamp-2');
      titlePreview.textContent = post.title;

      // YouTube description (if exists)
      if (post.content.text) {
        const descriptionPreview = leftSection.createDiv();
        descriptionPreview.addClass('sa-text-sm', 'sa-text-muted', 'sa-overflow-hidden', 'cpcr-line-clamp-2', 'cpcr-description-preview');
        descriptionPreview.textContent = this.extractPlainTextFromMarkdown(post.content.text);
      }
    } else {
      // Non-YouTube: show content text (4 lines)
      const contentPreview = leftSection.createDiv();
      contentPreview.addClass('sa-text-base', 'sa-text-muted', 'sa-overflow-hidden', 'cpcr-line-clamp-4', 'cpcr-content-preview');
      contentPreview.textContent = this.extractPlainTextFromMarkdown(post.content.text);
    }

    // External link preview (if exists) - rich card style like LinkPreviewRenderer
    if (post.metadata.externalLink) {
      this.renderExternalLinkPreview(leftSection, post.metadata);
    }

    // Metadata row (likes, comments, views, duration, podcast episode)
    const hasMetadata =
      (post.metadata.likes !== undefined && post.metadata.likes > 0) ||
      (post.metadata.comments !== undefined && post.metadata.comments > 0) ||
      (post.metadata.shares !== undefined && post.metadata.shares > 0) ||
      (post.metadata.views !== undefined && post.metadata.views > 0) ||
      (post.metadata.duration !== undefined) ||
      (post.platform === 'podcast' && post.metadata.episode !== undefined);

    if (hasMetadata) {
      const metadataRow = leftSection.createDiv();
      metadataRow.addClass('sa-flex-row', 'sa-gap-12', 'sa-text-sm', 'sa-text-muted');

      // For YouTube: show views and duration
      if (post.platform === 'youtube') {
        if (post.metadata.views !== undefined && post.metadata.views > 0) {
          const viewsContainer = metadataRow.createSpan();
          viewsContainer.addClass('sa-flex-row', 'sa-gap-4');

          const iconContainer = viewsContainer.createDiv();
          iconContainer.addClass('sa-icon-12');
          setIcon(iconContainer, 'eye');

          viewsContainer.createSpan({ text: this.formatNumber(post.metadata.views) });
        }

        if (post.metadata.duration !== undefined) {
          const durationContainer = metadataRow.createSpan();
          durationContainer.addClass('sa-flex-row', 'sa-gap-4');

          const iconContainer = durationContainer.createDiv();
          iconContainer.addClass('sa-icon-12');
          setIcon(iconContainer, 'clock');

          durationContainer.createSpan({ text: this.formatDuration(post.metadata.duration) });
        }
      }

      // For Podcast: show episode number and duration
      if (post.platform === 'podcast') {
        // Episode/Season info
        if (post.metadata.episode !== undefined) {
          const episodeContainer = metadataRow.createSpan();
          episodeContainer.addClass('sa-flex-row', 'sa-gap-4');

          if (post.metadata.season !== undefined) {
            episodeContainer.createSpan({ text: `S${post.metadata.season}E${post.metadata.episode}` });
          } else {
            episodeContainer.createSpan({ text: `Ep ${post.metadata.episode}` });
          }
        }

        // Duration
        if (post.metadata.duration !== undefined) {
          const durationContainer = metadataRow.createSpan();
          durationContainer.addClass('sa-flex-row', 'sa-gap-4');

          const iconContainer = durationContainer.createDiv();
          iconContainer.addClass('sa-icon-12');
          setIcon(iconContainer, 'clock');

          durationContainer.createSpan({ text: this.formatDuration(post.metadata.duration) });
        }
      }

      // Standard metadata (likes, comments, shares)
      if (post.metadata.likes !== undefined && post.metadata.likes > 0) {
        const likesContainer = metadataRow.createSpan();
        likesContainer.addClass('sa-flex-row', 'sa-gap-4');

        const iconContainer = likesContainer.createDiv();
        iconContainer.addClass('sa-icon-12');
        setIcon(iconContainer, 'heart');

        likesContainer.createSpan({ text: this.formatNumber(post.metadata.likes) });
      }

      if (post.metadata.comments !== undefined && post.metadata.comments > 0) {
        const commentsContainer = metadataRow.createSpan();
        commentsContainer.addClass('sa-flex-row', 'sa-gap-4');

        const iconContainer = commentsContainer.createDiv();
        iconContainer.addClass('sa-icon-12');
        setIcon(iconContainer, 'message-circle');

        commentsContainer.createSpan({ text: this.formatNumber(post.metadata.comments) });
      }

      if (post.metadata.shares !== undefined && post.metadata.shares > 0) {
        const sharesContainer = metadataRow.createSpan();
        sharesContainer.addClass('sa-flex-row', 'sa-gap-4');

        const iconContainer = sharesContainer.createDiv();
        iconContainer.addClass('sa-icon-12');
        setIcon(iconContainer, 'repeat-2');

        sharesContainer.createSpan({ text: this.formatNumber(post.metadata.shares) });
      }
    }

    return wrapper;
  }

  /**
   * Render platform icon (Simple Icons SVG)
   * @unused - Reserved for future use
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for future platform icon rendering
   */
  private _renderPlatformIcon(container: HTMLElement, platform: Platform): void {
    // For user posts, render user initial avatar
    if (platform === 'post') {
      const userInitial = 'U';
      const avatar = container.createDiv();
      avatar.addClass('sa-icon-20', 'sa-rounded-full', 'sa-bg-accent', 'sa-text-sm', 'sa-font-semibold', 'cpcr-user-avatar');
      avatar.textContent = userInitial;
      return;
    }

    // For social media posts, use Simple Icons SVG
    const icon = getPlatformSimpleIcon(platform);
    if (icon) {
      const svg = createSVGElement(icon, {
        fill: 'var(--text-accent)',
        width: '100%',
        height: '100%'
      });
      container.appendChild(svg);
    }
  }

  private getOriginalUrl(post: PostData): string | null {
    const candidates: Array<string | undefined> = [
      post.url,
      post.originalUrl,
      (post.metadata as unknown as Record<string, unknown>)?.['originalUrl'] as string | undefined,
      post.shareUrl
    ];

    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'string' && candidate.trim().length > 0 && candidate.startsWith('http')) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Get platform name
   * @unused - Reserved for future use
   */
  private _getPlatformName(platform: Platform): string {
    const names: Record<Platform, string> = {
      facebook: 'Facebook',
      instagram: 'Instagram',
      x: 'X',
      linkedin: 'LinkedIn',
      tiktok: 'TikTok',
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
      'naver-webtoon': 'Naver Webtoon',
      webtoons: 'WEBTOON',
      brunch: 'Brunch',
      post: 'Post'
    };
    return names[platform] || platform;
  }

  /**
   * Format number with K/M suffix
   */
  private formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  /**
   * Format duration in seconds to MM:SS or HH:MM:SS
   */
  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Extract domain from URL for display
   */
  private extractDomain(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  /**
   * Truncate text to max length
   */
  private truncate(text: string, maxLength: number): string {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
  }

  /**
   * Render external link preview using LinkPreviewRenderer
   * Fetches metadata from Worker API for consistent display
   */
  private renderExternalLinkPreview(container: HTMLElement, metadata: PostData['metadata']): void {
    if (!metadata.externalLink || !this.linkPreviewRenderer) return;

    const linkPreviewContainer = container.createDiv();
    linkPreviewContainer.addClass('sa-mt-8');

    // Prevent card toggle when clicking link preview
    linkPreviewContainer.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Fire and forget - async rendering via LinkPreviewRenderer
    void this.linkPreviewRenderer.renderCompact(linkPreviewContainer, metadata.externalLink);
  }

  /**
   * Get avatar image source with priority: localAvatar > parentLocalAvatar (for self-boost) > avatar > null
   */
  private getAvatarSrc(post: PostData): string | null {
    // Priority 1: Local avatar (vault file)
    if (post.author.localAvatar && this.app) {
      // Use vault.adapter.getResourcePath with path string (same as AuthorRow)
      return this.app.vault.adapter.getResourcePath(post.author.localAvatar);
    }

    // Priority 2: For self-boost (same author as parent), use parent's local avatar
    if (this.parentPost?.author.localAvatar && this.app) {
      const isSameAuthor = this.isSameAuthor(post.author, this.parentPost.author);
      if (isSameAuthor) {
        return this.app.vault.adapter.getResourcePath(this.parentPost.author.localAvatar);
      }
    }

    // Priority 3: External avatar URL
    if (post.author.avatar) {
      return post.author.avatar;
    }
    return null;
  }

  /**
   * Check if two authors are the same person
   * Compares URL first (most reliable), then handle/username
   */
  private isSameAuthor(author1: PostData['author'], author2: PostData['author']): boolean {
    // Compare by URL first (most reliable - works even when handle formats differ)
    if (author1.url && author2.url) {
      // Normalize URLs for comparison (remove trailing slashes, lowercase)
      const normalizeUrl = (url: string) => url.toLowerCase().replace(/\/+$/, '');
      if (normalizeUrl(author1.url) === normalizeUrl(author2.url)) {
        return true;
      }
    }
    // Compare by handle (for federated platforms like Mastodon)
    if (author1.handle && author2.handle) {
      // Normalize handles (remove leading @, lowercase)
      const normalizeHandle = (h: string) => h.toLowerCase().replace(/^@/, '');
      if (normalizeHandle(author1.handle) === normalizeHandle(author2.handle)) {
        return true;
      }
    }
    // Compare by username
    if (author1.username && author2.username) {
      return author1.username.toLowerCase() === author2.username.toLowerCase();
    }
    return false;
  }

  /**
   * Get initials from author name
   * Strips emojis and special characters before extracting initials
   */
  private getAuthorInitials(name: string): string {
    if (!name) return '?';
    // Remove emojis and other non-letter characters (keep letters from all scripts)
    const cleanName = name
      .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '')
      .trim();
    if (!cleanName) return name.substring(0, 1) || '?';

    const parts = cleanName.split(/\s+/).filter(p => p.length > 0);
    if (parts.length >= 2) {
      const first = parts[0]?.[0] ?? '';
      const last = parts[parts.length - 1]?.[0] ?? '';
      return (first + last).toUpperCase();
    }
    return cleanName.substring(0, 2).toUpperCase();
  }

  /**
   * Render author avatar with platform badge
   */
  private renderAuthorAvatar(container: HTMLElement, post: PostData): void {
    const avatarContainer = container.createDiv();
    avatarContainer.addClass('sa-flex-shrink-0', 'sa-icon-32', 'sa-relative');

    const avatarSrc = this.getAvatarSrc(post);

    if (avatarSrc) {
      // Show actual avatar image
      const avatarImg = container.createEl('img');
      avatarImg.addClass('sa-icon-32', 'sa-rounded-full', 'sa-object-cover');
      avatarImg.src = avatarSrc;
      avatarImg.alt = post.author.name;

      // Fallback to initials on image error
      avatarImg.onerror = () => {
        avatarImg.addClass('sa-hidden');
        const fallback = avatarContainer.createDiv();
        fallback.addClass('sa-icon-32', 'sa-rounded-full', 'sa-flex-center', 'sa-text-sm', 'sa-font-semibold', 'sa-text-muted');
        fallback.addClass('cpcr-avatar-fallback');
        fallback.textContent = this.getAuthorInitials(post.author.name);
      };

      // Move avatar img into container for positioning
      avatarContainer.appendChild(avatarImg);
    } else {
      // No avatar: show initials
      const initialsAvatar = avatarContainer.createDiv();
      initialsAvatar.addClass('sa-icon-32', 'sa-rounded-full', 'sa-flex-center', 'sa-text-sm', 'sa-font-semibold', 'sa-text-muted');
      initialsAvatar.addClass('cpcr-avatar-fallback');
      initialsAvatar.textContent = this.getAuthorInitials(post.author.name);
    }

    // Platform badge removed - platform icon now shown in header via renderOriginalPostLink
  }
}
