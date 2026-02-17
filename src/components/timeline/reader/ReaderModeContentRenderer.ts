/**
 * ReaderModeContentRenderer - Renders a single post in reader-optimized layout
 *
 * Extends Obsidian Component for lifecycle management with MarkdownRenderer.
 * Creates a distraction-free reading layout inside a given container:
 *   1. Header bar: close (X), position label, font controls, copy text
 *   2. Author section: avatar, name, handle, platform icon, timestamp
 *   3. Tags (if present)
 *   4. Title (for YouTube/RSS/Reddit posts)
 *   5. Full body text via MarkdownRenderer.render() (no truncation)
 *   6. Media gallery via existing MediaGalleryRenderer
 *   7. Original URL link
 *   8. Action bar: engagement metrics | star, share, tag, archive, open, edit, delete
 */

import { Component, MarkdownRenderer, setIcon, Notice, type App } from 'obsidian';
import type { PostData } from '../../../types/post';
import type SocialArchiverPlugin from '../../../main';
import { MediaGalleryRenderer } from '../renderers/MediaGalleryRenderer';
import { LinkPreviewRenderer } from '../renderers/LinkPreviewRenderer';
import {
  getPlatformSimpleIcon,
  getPlatformLucideIcon,
} from '../../../services/IconService';
import { getPlatformName } from '@/shared/platforms';
import { createCustomSVG } from '@/utils/dom-helpers';

export interface ReaderContentCallbacks {
  onClose: () => void;
  onFontSizeChange: (delta: number) => void;
  onArchive: () => void;
  onToggleLike: () => void;
  onShare: () => void;
  onTag: () => void;
  onOpenNote: () => void;
  onEdit: () => void;
  onDelete: () => void;
  currentFontSize: number;
  isArchived: boolean;
  isLiked: boolean;
  isShared: boolean;
  hasTags: boolean;
  showEdit: boolean;
  /** Subscription state for the current post's author */
  subscriptionStatus?: 'subscribed' | 'not-subscribed' | 'hidden';
  onSubscribe?: () => void;
  onUnsubscribe?: () => void;
  /** Comment/note on the post */
  hasComment: boolean;
  onComment: () => void;
}

export class ReaderModeContentRenderer extends Component {
  private app: App;
  private plugin: SocialArchiverPlugin;
  private mediaGalleryRenderer: MediaGalleryRenderer;
  private linkPreviewRenderer: LinkPreviewRenderer;

  constructor(app: App, plugin: SocialArchiverPlugin, mediaGalleryRenderer: MediaGalleryRenderer, linkPreviewRenderer: LinkPreviewRenderer) {
    super();
    this.app = app;
    this.plugin = plugin;
    this.mediaGalleryRenderer = mediaGalleryRenderer;
    this.linkPreviewRenderer = linkPreviewRenderer;
  }

  /**
   * Render full post content into the given container element
   */
  async render(
    container: HTMLElement,
    post: PostData,
    index: number,
    total: number,
    callbacks: ReaderContentCallbacks
  ): Promise<void> {
    container.empty();
    container.addClass('reader-mode-panel');

    // 1. Header bar (fixed, outside scroll area)
    const headerWrapper = container.createDiv({ cls: 'reader-mode-header-wrapper' });
    const headerContent = headerWrapper.createDiv({ cls: 'reader-mode-header-content' });
    this.renderHeader(headerContent, index, total, post, callbacks);

    // Scrollable inner wrapper (scrollbar hidden for cleaner reading experience)
    // Webkit: .reader-mode-scroll::-webkit-scrollbar{display:none} in misc-components.css
    const scrollArea = container.createDiv({ cls: 'reader-mode-scroll rmcr-scroll-hide' });

    // Centered content wrapper (max-width 680px)
    const content = scrollArea.createDiv({ cls: 'reader-mode-content' });

    // 2. Author section
    this.renderAuthor(content, post, callbacks);

    // 3. Tags
    if (post.tags && post.tags.length > 0) {
      this.renderTags(content, post.tags);
    }

    // 4. Title
    if (post.title) {
      this.renderTitle(content, post.title);
    }

    // 5. Body text
    await this.renderBody(content, post);

    // 5.5 External link preview
    if (post.metadata?.externalLink) {
      const linkContainer = content.createDiv({ cls: 'reader-mode-external-link' });
      linkContainer.addClass('sa-my-16');
      void this.linkPreviewRenderer.renderCompact(linkContainer, post.metadata.externalLink);
    }

    // 6. Quoted/Shared post
    if (post.quotedPost) {
      await this.renderQuotedPost(content, post.quotedPost, post.filePath || '');
    }

    // 7. Media gallery
    if (post.media && post.media.length > 0) {
      this.renderMedia(content, post);
    }

    // 8. Original URL link
    this.renderSourceLink(content, post);

    // 9. Action bar (engagement metrics + action buttons)
    this.renderActionBar(content, post, callbacks);
  }

  // ---------- Header ----------

  private renderHeader(
    parent: HTMLElement,
    index: number,
    total: number,
    post: PostData,
    callbacks: ReaderContentCallbacks,
  ): void {
    const header = parent.createDiv({ cls: 'reader-mode-header' });

    // Left group: close button
    const closeBtn = header.createDiv({ cls: 'reader-mode-header-btn' });
    closeBtn.setAttribute('title', 'Close reader (Esc)');
    setIcon(closeBtn, 'x');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onClose();
    });

    // Position label (center)
    const posLabel = header.createDiv({ cls: 'reader-mode-position' });
    posLabel.textContent = `${index + 1} / ${total}`;

    // Right group: font controls | copy
    const rightGroup = header.createDiv({ cls: 'reader-mode-header-right' });

    // Font size decrease
    const fontDecBtn = rightGroup.createDiv({ cls: 'reader-mode-header-btn' });
    fontDecBtn.setAttribute('title', 'Decrease font size');
    setIcon(fontDecBtn, 'minus');
    fontDecBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onFontSizeChange(-2);
    });

    // Font size increase
    const fontIncBtn = rightGroup.createDiv({ cls: 'reader-mode-header-btn' });
    fontIncBtn.setAttribute('title', 'Increase font size');
    setIcon(fontIncBtn, 'plus');
    fontIncBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onFontSizeChange(2);
    });

    // Copy text button
    const copyBtn = rightGroup.createDiv({ cls: 'reader-mode-header-btn' });
    copyBtn.setAttribute('title', 'Copy text');
    setIcon(copyBtn, 'copy');
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = post.content.text || post.content.markdown || '';
      void navigator.clipboard.writeText(text);
      new Notice('Text copied to clipboard');
    });
  }

  // ---------- Author ----------

  private renderAuthor(parent: HTMLElement, post: PostData, callbacks: ReaderContentCallbacks): void {
    const authorSection = parent.createDiv({ cls: 'reader-mode-author' });

    // Avatar (clickable if author URL exists)
    const avatarEl = authorSection.createDiv({ cls: 'reader-mode-avatar' });
    if (post.author.url) {
      avatarEl.addClass('sa-clickable');
      avatarEl.setAttribute('title', `Visit ${post.author.name}'s profile`);
      avatarEl.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open(post.author.url, '_blank');
      });
    }
    const avatarSrc = this.getAvatarSrc(post);
    if (avatarSrc) {
      const img = avatarEl.createEl('img');
      img.src = avatarSrc;
      img.alt = post.author.name;
      img.addClass('sa-wh-full');
      img.addClass('sa-rounded-full');
      img.addClass('sa-object-cover');
      img.onerror = () => {
        img.addClass('sa-hidden');
        this.renderInitialsAvatar(avatarEl, post.author.name);
      };
    } else {
      this.renderInitialsAvatar(avatarEl, post.author.name);
    }

    // Info column
    const info = authorSection.createDiv({ cls: 'reader-mode-author-info' });

    // Name row (name + platform icon + subscribe badge)
    const nameRow = info.createDiv({ cls: 'reader-mode-author-name-row' });

    // Author name (clickable if author URL exists)
    const authorNameEl = nameRow.createSpan({ text: post.author.name, cls: 'reader-mode-author-name' });
    if (post.author.url) {
      authorNameEl.addClass('sa-clickable');
      authorNameEl.addClass('sa-transition-color');
      authorNameEl.setAttribute('title', `Visit ${post.author.name}'s profile`);
      authorNameEl.addEventListener('mouseenter', () => {
        authorNameEl.setCssProps({ '--sa-color': 'var(--interactive-accent)' });
        authorNameEl.addClass('sa-dynamic-color');
      });
      authorNameEl.addEventListener('mouseleave', () => {
        authorNameEl.removeClass('sa-dynamic-color');
      });
      authorNameEl.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open(post.author.url, '_blank');
      });
    }

    // Platform icon (clickable — links to original post URL)
    const originalUrl = this.getPostOriginalUrl(post);
    const platformIcon = getPlatformSimpleIcon(post.platform);
    if (platformIcon) {
      const iconEl = nameRow.createDiv({ cls: 'reader-mode-platform-icon' });
      const svg = createCustomSVG('0 0 24 24', platformIcon.path);
      svg.addClass('rmcr-platform-svg');
      iconEl.appendChild(svg);
      if (originalUrl) {
        iconEl.addClass('sa-clickable');
        iconEl.addClass('sa-transition-opacity');
        iconEl.setAttribute('title', `Open on ${getPlatformName(post.platform)}`);
        iconEl.addEventListener('mouseenter', () => {
          iconEl.setCssProps({ '--sa-opacity': '0.6' });
          iconEl.addClass('sa-dynamic-opacity');
        });
        iconEl.addEventListener('mouseleave', () => {
          iconEl.removeClass('sa-dynamic-opacity');
        });
        iconEl.addEventListener('click', (e) => {
          e.stopPropagation();
          window.open(originalUrl, '_blank');
        });
      }
    } else {
      const lucideIcon = getPlatformLucideIcon(post.platform);
      if (lucideIcon) {
        const iconEl = nameRow.createDiv({ cls: 'reader-mode-platform-icon' });
        setIcon(iconEl, lucideIcon);
        if (originalUrl) {
          iconEl.addClass('sa-clickable');
          iconEl.addClass('sa-transition-opacity');
          iconEl.setAttribute('title', `Open on ${getPlatformName(post.platform)}`);
          iconEl.addEventListener('mouseenter', () => {
            iconEl.setCssProps({ '--sa-opacity': '0.6' });
            iconEl.addClass('sa-dynamic-opacity');
          });
          iconEl.addEventListener('mouseleave', () => {
            iconEl.removeClass('sa-dynamic-opacity');
          });
          iconEl.addEventListener('click', (e) => {
            e.stopPropagation();
            window.open(originalUrl, '_blank');
          });
        }
      }
    }

    // Subscription badge
    if (callbacks.subscriptionStatus && callbacks.subscriptionStatus !== 'hidden') {
      this.renderSubscriptionBadge(nameRow, callbacks);
    }

    // Handle + timestamp row
    const metaRow = info.createDiv({ cls: 'reader-mode-author-meta' });
    const handle = post.author.handle || post.author.username;
    if (handle) {
      metaRow.createSpan({ text: handle.startsWith('@') ? handle : `@${handle}` });
      metaRow.createSpan({ text: ' · ' });
    }

    const platformName = getPlatformName(post.platform);
    metaRow.createSpan({ text: platformName });
    metaRow.createSpan({ text: ' · ' });

    const timestamp = post.metadata.timestamp;
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    metaRow.createSpan({ text: this.formatDate(date) });
  }

  // ---------- Subscription Badge ----------

  private renderSubscriptionBadge(parent: HTMLElement, callbacks: ReaderContentCallbacks): void {
    const isSubscribed = callbacks.subscriptionStatus === 'subscribed';
    const badge = parent.createDiv();

    badge.addClass('sa-inline-flex');
    badge.addClass('sa-gap-2');
    badge.addClass('sa-px-6');
    badge.addClass('sa-py-4');
    badge.addClass('sa-rounded-12');
    badge.addClass('sa-text-xs');
    badge.addClass('sa-font-medium');
    badge.addClass('sa-clickable');
    badge.addClass('sa-transition');
    badge.addClass('sa-flex-shrink-0');

    if (isSubscribed) {
      badge.setCssProps({ '--sa-bg': 'rgba(var(--color-green-rgb), 0.15)', '--sa-color': 'var(--color-green)' });
      badge.addClass('sa-dynamic-bg');
      badge.addClass('sa-dynamic-color');
      badge.setAttribute('title', 'Subscribed — click to unsubscribe');

      const iconContainer = badge.createDiv();
      iconContainer.addClass('sa-icon-10');
      setIcon(iconContainer, 'bell');
      iconContainer.querySelector('svg')?.addClass('rmcr-badge-icon-subscribed');
      badge.createSpan({ text: 'Subscribed' });
    } else {
      badge.addClass('sa-bg-hover');
      badge.addClass('sa-text-muted');
      badge.setAttribute('title', 'Click to subscribe');

      const iconContainer = badge.createDiv();
      iconContainer.addClass('sa-icon-10');
      setIcon(iconContainer, 'bell-plus');
      iconContainer.querySelector('svg')?.addClass('rmcr-badge-icon-muted');
      badge.createSpan({ text: 'Subscribe' });
    }

    // Hover effects
    badge.addEventListener('mouseenter', () => {
      if (isSubscribed) {
        badge.setCssProps({ '--sa-bg': 'rgba(var(--color-green-rgb), 0.25)' });
      } else {
        badge.setCssProps({ '--sa-bg': 'var(--background-modifier-border)', '--sa-color': 'var(--text-normal)' });
        badge.addClass('sa-dynamic-bg');
        badge.addClass('sa-dynamic-color');
      }
    });
    badge.addEventListener('mouseleave', () => {
      if (isSubscribed) {
        badge.setCssProps({ '--sa-bg': 'rgba(var(--color-green-rgb), 0.15)' });
      } else {
        badge.removeClass('sa-dynamic-bg');
        badge.removeClass('sa-dynamic-color');
      }
    });

    // Click handler
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isSubscribed) {
        callbacks.onUnsubscribe?.();
      } else {
        callbacks.onSubscribe?.();
      }
    });
  }

  // ---------- Tags ----------

  private renderTags(parent: HTMLElement, tags: string[]): void {
    const tagContainer = parent.createDiv({ cls: 'reader-mode-tags' });

    const tagStore = this.plugin.tagStore;
    const definitions = tagStore ? tagStore.getTagDefinitions() : [];

    for (const tag of tags) {
      const chip = tagContainer.createDiv({ cls: 'reader-mode-tag' });

      // Color dot
      const def = definitions.find(d => d.name.toLowerCase() === tag.toLowerCase());
      const dot = chip.createDiv({ cls: 'reader-mode-tag-dot' });
      if (def?.color) {
        dot.setCssProps({ '--sa-bg': def.color });
        dot.addClass('sa-dynamic-bg');
      }

      chip.createSpan({ text: tag });
    }
  }

  // ---------- Title ----------

  private renderTitle(parent: HTMLElement, title: string): void {
    const titleEl = parent.createEl('h2', { cls: 'reader-mode-title' });
    titleEl.textContent = title;
  }

  // ---------- Body ----------

  private async renderBody(parent: HTMLElement, post: PostData): Promise<void> {
    const bodyEl = parent.createDiv({ cls: 'reader-mode-body' });

    // Use rawMarkdown first (for blog posts with inline images), then markdown, then text
    let source = post.content.rawMarkdown || post.content.markdown || post.content.text || '';
    if (!source.trim()) return;

    // Strip the "🔗 **Link:** ..." line when we have an external link preview card
    if (post.metadata?.externalLink) {
      source = source.replace(/\n*🔗\s*\*\*Link:\*\*\s*.*\n*/g, '\n');
    }

    // For social media text (not rawMarkdown), escape patterns that cause unwanted rendering
    if (!post.content.rawMarkdown) {
      // Escape Setext headings: standalone lines of - or = that make preceding text h1/h2
      source = source.replace(/^([-=]+)$/gm, '\\$1');
      // Escape ordered list patterns (e.g. "2025. 11. 6" parsed as nested lists)
      source = source.replace(/^(\s*)(\d+)\.(?=\s|$)/gm, '$1$2\\.');
      // Escape angle brackets to prevent HTML interpretation (e.g. <책 제목>)
      source = source.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    const sourcePath = post.filePath || '';
    await MarkdownRenderer.render(this.app, source, bodyEl, sourcePath, this);
  }

  // ---------- Quoted / Shared Post ----------

  private async renderQuotedPost(
    parent: HTMLElement,
    quoted: Omit<PostData, 'quotedPost' | 'embeddedArchives'>,
    sourcePath: string
  ): Promise<void> {
    const wrapper = parent.createDiv({ cls: 'reader-mode-quoted-post' });
    wrapper.addClass('sa-p-16');
    wrapper.addClass('sa-rounded-4');
    wrapper.addClass('sa-bg-secondary');
    wrapper.addClass('reader-mode-quoted-post');

    // Header: platform icon + author
    const header = wrapper.createDiv();
    header.addClass('sa-flex-row');
    header.addClass('sa-gap-8');
    header.addClass('sa-mb-8');

    const platformName = getPlatformName(quoted.platform);
    const platformIcon = getPlatformSimpleIcon(quoted.platform);
    if (platformIcon) {
      const iconEl = header.createDiv();
      iconEl.addClass('sa-icon-16');
      iconEl.addClass('sa-opacity-80');
      const quotedSvg = createCustomSVG('0 0 24 24', platformIcon.path);
      quotedSvg.addClass('rmcr-platform-svg-16');
      iconEl.appendChild(quotedSvg);
    }

    const authorName = quoted.author?.name || 'Unknown';
    const authorEl = header.createEl('span', { text: `${platformName} — ${authorName}` });
    authorEl.addClass('sa-text-sm');
    authorEl.addClass('sa-opacity-80');
    authorEl.addClass('sa-font-medium');

    // Body text — inherit reader font size via CSS variable (slightly smaller)
    const bodyText = quoted.content?.text || quoted.content?.markdown || '';
    if (bodyText.trim()) {
      const bodyEl = wrapper.createDiv({ cls: 'reader-mode-body rmcr-quoted-body' });
      const escaped = bodyText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      await MarkdownRenderer.render(this.app, escaped, bodyEl, sourcePath, this);
    }

    // Media
    if (quoted.media && quoted.media.length > 0) {
      const mediaContainer = wrapper.createDiv();
      mediaContainer.addClass('sa-mt-12');
      this.mediaGalleryRenderer.render(mediaContainer, quoted.media, quoted as PostData);
    }

    // Source link
    const url = quoted.url;
    if (url && !url.startsWith('/') && !url.startsWith('Social Archives')) {
      const linkEl = wrapper.createEl('a', {
        text: 'View original',
        href: url,
        cls: 'external-link',
      });
      linkEl.addClass('sa-inline-block');
      linkEl.addClass('sa-mt-8');
      linkEl.addClass('sa-text-sm');
      linkEl.addClass('sa-opacity-60');
    }
  }

  // ---------- Media ----------

  private renderMedia(parent: HTMLElement, post: PostData): void {
    const mediaContainer = parent.createDiv({ cls: 'reader-mode-media' });
    this.mediaGalleryRenderer.render(mediaContainer, post.media, post);
  }

  // ---------- Engagement Metric Helper ----------

  private renderMetric(parent: HTMLElement, icon: string, value: string): void {
    const item = parent.createDiv({ cls: 'reader-mode-metric' });
    const iconEl = item.createDiv({ cls: 'reader-mode-metric-icon' });
    setIcon(iconEl, icon);
    item.createSpan({ text: value });
  }

  // ---------- Source Link ----------

  private renderSourceLink(parent: HTMLElement, post: PostData): void {
    const url = post.url;
    if (!url || url.startsWith('/') || url.startsWith('Social Archives')) return;

    const linkContainer = parent.createDiv({ cls: 'reader-mode-source' });
    const link = linkContainer.createEl('a', {
      text: 'View original',
      href: url,
    });
    link.addClass('sa-text-muted');
    link.addClass('sa-text-base');
    link.addClass('rmcr-source-link');
    link.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(url, '_blank');
    });
  }

  // ---------- Action Bar ----------

  private renderActionBar(
    parent: HTMLElement,
    post: PostData,
    callbacks: ReaderContentCallbacks,
  ): void {
    const bar = parent.createDiv({ cls: 'reader-mode-action-bar' });

    // Left: engagement metrics (display-only)
    const metricsGroup = bar.createDiv({ cls: 'reader-mode-action-bar-metrics' });
    const m = post.metadata;
    if (m.likes) this.renderMetric(metricsGroup, 'heart', this.formatNumber(m.likes));
    if (m.comments) this.renderMetric(metricsGroup, 'message-circle', this.formatNumber(m.comments));
    if (m.shares) this.renderMetric(metricsGroup, 'repeat-2', this.formatNumber(m.shares));
    if (m.views) this.renderMetric(metricsGroup, 'eye', this.formatNumber(m.views));

    // Spacer
    bar.createDiv({ cls: 'reader-mode-action-bar-spacer' });

    // Right: action buttons
    const actionsGroup = bar.createDiv({ cls: 'reader-mode-action-bar-actions' });

    // 1. Star (personal like)
    this.renderActionBtn(actionsGroup, {
      icon: 'star',
      title: callbacks.isLiked ? 'Remove from favorites' : 'Add to favorites',
      active: callbacks.isLiked,
      filled: callbacks.isLiked,
      onClick: callbacks.onToggleLike,
    });

    // 2. Share
    this.renderActionBtn(actionsGroup, {
      icon: callbacks.isShared ? 'link' : 'share-2',
      title: callbacks.isShared ? 'Shared — click to unshare' : 'Share to the web',
      active: callbacks.isShared,
      onClick: callbacks.onShare,
    });

    // 3. Tag
    this.renderActionBtn(actionsGroup, {
      icon: 'tag',
      title: 'Manage tags',
      active: callbacks.hasTags,
      onClick: callbacks.onTag,
    });

    // 4. Comment / Note (C)
    this.renderActionBtn(actionsGroup, {
      icon: 'message-square-text',
      title: callbacks.hasComment ? 'Edit note (C)' : 'Add note (C)',
      active: callbacks.hasComment,
      onClick: callbacks.onComment,
    });

    // 5. Archive
    this.renderActionBtn(actionsGroup, {
      icon: 'archive',
      title: callbacks.isArchived ? 'Unarchive (A)' : 'Archive (A)',
      active: callbacks.isArchived,
      filled: callbacks.isArchived,
      filledStroke: true,
      onClick: callbacks.onArchive,
    });

    // 6. Open Note
    this.renderActionBtn(actionsGroup, {
      icon: 'external-link',
      title: 'Open note in Obsidian',
      onClick: callbacks.onOpenNote,
    });

    // 7. Edit (only if showEdit)
    if (callbacks.showEdit) {
      this.renderActionBtn(actionsGroup, {
        icon: 'pencil',
        title: 'Edit this post',
        onClick: callbacks.onEdit,
      });
    }

    // 8. Delete
    this.renderActionBtn(actionsGroup, {
      icon: 'trash-2',
      title: 'Delete this post',
      danger: true,
      onClick: callbacks.onDelete,
    });
  }

  private renderActionBtn(
    parent: HTMLElement,
    opts: {
      icon: string;
      title: string;
      active?: boolean;
      filled?: boolean;
      filledStroke?: boolean;
      danger?: boolean;
      onClick: () => void;
    },
  ): void {
    const btn = parent.createDiv({ cls: 'reader-mode-action-btn' });
    btn.setAttribute('title', opts.title);

    if (opts.active) {
      btn.addClass('sa-text-accent');
    }

    const iconEl = btn.createDiv();
    setIcon(iconEl, opts.icon);

    // Apply fill style for active icons (star, archive)
    if (opts.filled) {
      if (opts.filledStroke) {
        iconEl.addClass('rmcr-icon-filled-stroke');
      } else {
        iconEl.addClass('rmcr-icon-filled');
      }
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onClick();
    });
  }

  // ---------- Helpers ----------

  private getPostOriginalUrl(post: PostData): string | null {
    const candidates: Array<string | undefined> = [
      post.url,
      (post as PostData & { originalUrl?: string }).originalUrl,
      (post.metadata as unknown as Record<string, unknown>)?.['originalUrl'] as string | undefined,
      post.quotedPost?.url,
      (post.quotedPost as (PostData & { originalUrl?: string }) | undefined)?.originalUrl,
      post.shareUrl,
    ];
    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'string' && candidate.trim().length > 0 && candidate.startsWith('http')) {
        return candidate;
      }
    }
    return null;
  }

  private getAvatarSrc(post: PostData): string | null {
    if (post.author.localAvatar) {
      return this.app.vault.adapter.getResourcePath(post.author.localAvatar);
    }
    if (post.author.avatar) {
      return post.author.avatar;
    }
    return null;
  }

  private renderInitialsAvatar(container: HTMLElement, name: string): void {
    const initials = this.getAuthorInitials(name);
    const div = container.createDiv();
    div.addClass('sa-wh-full');
    div.addClass('sa-rounded-full');
    div.addClass('sa-bg-accent');
    div.addClass('sa-flex-center');
    div.addClass('sa-text-base');
    div.addClass('sa-font-semibold');
    div.addClass('rmcr-initials-text');
    div.textContent = initials;
  }

  private getAuthorInitials(name: string): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/).filter(p => p.length > 0);
    if (parts.length >= 2) {
      const first = parts[0]?.[0] ?? '';
      const last = parts[parts.length - 1]?.[0] ?? '';
      return (first + last).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  private formatDate(date: Date): string {
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  private formatNumber(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }
}
