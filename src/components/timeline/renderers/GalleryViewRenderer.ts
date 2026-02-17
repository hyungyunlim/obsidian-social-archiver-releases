import { type App, type Vault, type TFile, setIcon, prepareSimpleSearch } from 'obsidian';

/**
 * Media item data structure for gallery view
 */
export interface MediaItemData {
  sourceFile: TFile;
  mediaPath: string;
  type: 'image' | 'video';
  author?: string;
  platform?: string;
  title?: string;
  content?: string; // For search
}

/**
 * GalleryViewRenderer - Handles rendering Pinterest-style media gallery
 * Single Responsibility: Gallery view rendering with masonry layout
 *
 * Features:
 * - Pinterest-style masonry layout
 * - Video preview on hover (muted)
 * - Lightbox for full-size viewing
 * - Responsive column count
 * - Platform badges
 * - Metadata (author, title)
 */
export class GalleryViewRenderer {
  private app: App;
  private vault: Vault;
  private archivePath: string;

  constructor(app: App, vault: Vault, archivePath: string) {
    this.app = app;
    this.vault = vault;
    this.archivePath = archivePath;
  }

  /**
   * Extract media items from all markdown files in archive path
   */
  async extractMediaItems(
    platformFilter?: Set<string>,
    searchQuery?: string,
    specificFiles?: TFile[]
  ): Promise<MediaItemData[]> {
    // Use specific files if provided, otherwise get all files from archive path
    const files = specificFiles || this.vault.getMarkdownFiles()
      .filter(file => file.path.startsWith(this.archivePath));

    const mediaItems: MediaItemData[] = [];
    const seenMedia = new Set<string>(); // Prevent duplicates

    for (const file of files) {
      const content = await this.vault.read(file);

      // Extract frontmatter metadata
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      let author = '';
      let platform = '';

      if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];
        const authorMatch = frontmatter?.match(/author:\s*(.+)/);
        const platformMatch = frontmatter?.match(/platform:\s*(.+)/);

        if (authorMatch?.[1]) author = authorMatch[1].trim();
        if (platformMatch?.[1]) platform = platformMatch[1].trim();
      }

      // Get title from filename (remove date prefix)
      const title = file.basename.replace(/^\d{4}-\d{2}-\d{2}\s*-\s*/, '');

      // Apply platform filter early if provided
      if (platformFilter && platformFilter.size > 0 && !platformFilter.has(platform)) {
        continue; // Skip files that don't match platform filter
      }

      // Helper function to extract platform and author from embedded archive metadata
      const extractEmbeddedMetadata = (content: string, mediaPath: string): { platform: string; author?: string } => {
        // Find the section containing this media
        const sections = content.split(/---\n\n## Referenced Social Media Posts\n\n/);

        for (let i = 1; i < sections.length; i++) {
          const section = sections[i];
          if (section?.includes(mediaPath)) {
            let embeddedPlatform = platform;
            let embeddedAuthor: string | undefined;

            // Extract platform from "### Platform - Author" header
            const platformMatch = section?.match(/^### ([A-Za-z]+)/m);
            if (platformMatch?.[1]) {
              embeddedPlatform = platformMatch[1].toLowerCase();
            }

            // Fallback: Extract from "**Platform:** Platform |" line
            const platformLineMatch = section?.match(/\*\*Platform:\*\*\s+([A-Za-z]+)/);
            if (platformLineMatch?.[1]) {
              embeddedPlatform = platformLineMatch[1].toLowerCase();
            }

            // Extract author from "**Author:** [@username](url)" or plain text
            const authorMatch = section?.match(/\*\*Author:\*\*\s+(?:\[([^\]]+)\]|([^\n|]+))/);
            if (authorMatch) {
              embeddedAuthor = (authorMatch[1] || authorMatch[2])?.trim();
            }

            return { platform: embeddedPlatform, author: embeddedAuthor };
          }
        }

        return { platform, author: undefined }; // Fallback to frontmatter
      };

      // Extract images and videos: ![alt](path)
      const imageRegex = /!\[.*?\]\((.*?)\)/g;
      let match;
      while ((match = imageRegex.exec(content)) !== null) {
        let mediaPath = match[1];
        if (mediaPath && !mediaPath.startsWith('http')) {
          const linkedFile = this.app.metadataCache.getFirstLinkpathDest(mediaPath, file.path);
          if (linkedFile && !seenMedia.has(linkedFile.path)) {
            seenMedia.add(linkedFile.path);

            // Check if it's a video by extension
            const isVideo = /\.(mp4|mov|webm|avi)$/i.test(linkedFile.path);
            const type = isVideo ? 'video' : 'image';

            // Extract platform and author from embedded archive if available
            const embeddedMetadata = extractEmbeddedMetadata(content, mediaPath);

            mediaItems.push({
              sourceFile: file,
              mediaPath: linkedFile.path,
              type,
              author: embeddedMetadata.author || author, // Use embedded author if available
              platform: embeddedMetadata.platform,
              title,
              content // Include content for search
            });
          }
        }
      }

      // Extract videos: <video src="path">
      const videoRegex = /<video[^>]+src=["']([^"']+)["']/g;
      while ((match = videoRegex.exec(content)) !== null) {
        let mediaPath = match[1];
        if (mediaPath && !mediaPath.startsWith('http')) {
          const linkedFile = this.app.metadataCache.getFirstLinkpathDest(mediaPath, file.path);
          if (linkedFile && !seenMedia.has(linkedFile.path)) {
            seenMedia.add(linkedFile.path);
            const embeddedMetadata = extractEmbeddedMetadata(content, mediaPath);
            mediaItems.push({
              sourceFile: file,
              mediaPath: linkedFile.path,
              type: 'video',
              author: embeddedMetadata.author || author, // Use embedded author if available
              platform: embeddedMetadata.platform,
              title,
              content
            });
          }
        }
      }

      // Extract wiki-link videos: ![[file.mp4]]
      const wikiVideoRegex = /!\[\[([^\]]+\.(?:mp4|mov|webm|avi))\]\]/g;
      while ((match = wikiVideoRegex.exec(content)) !== null) {
        const mediaPath = match[1];
        if (mediaPath) {
          const linkedFile = this.app.metadataCache.getFirstLinkpathDest(mediaPath, file.path);
          if (linkedFile && !seenMedia.has(linkedFile.path)) {
            seenMedia.add(linkedFile.path);
            const embeddedMetadata = extractEmbeddedMetadata(content, mediaPath);
            mediaItems.push({
              sourceFile: file,
              mediaPath: linkedFile.path,
              type: 'video',
              author: embeddedMetadata.author || author, // Use embedded author if available
              platform: embeddedMetadata.platform,
              title,
              content
            });
          }
        }
      }
    }

    // Apply search filter if provided
    if (searchQuery && searchQuery.trim().length > 0) {
      const preparedSearch = prepareSimpleSearch(searchQuery);
      return mediaItems.filter(item => {
        // Search in title, author, platform, and content
        const searchableText = [
          item.title || '',
          item.author || '',
          item.platform || '',
          item.content || ''
        ].join(' ').toLowerCase();

        return preparedSearch(searchableText);
      });
    }

    return mediaItems;
  }

  /**
   * Render Pinterest-style masonry gallery with lazy loading
   */
  renderGallery(container: HTMLElement, mediaItems: MediaItemData[], groupBy: 'none' | 'author' | 'post' | 'author-post' = 'none'): void {
    // Group items if requested
    if (groupBy === 'author') {
      this.renderGroupedGallery(container, mediaItems, 'author');
      return;
    } else if (groupBy === 'post') {
      this.renderGroupedGallery(container, mediaItems, 'post');
      return;
    } else if (groupBy === 'author-post') {
      this.renderNestedGroupedGallery(container, mediaItems);
      return;
    }

    // Default: ungrouped gallery
    this.renderUngroupedGallery(container, mediaItems);
  }

  /**
   * Render nested grouped gallery (Author > Post)
   */
  private renderNestedGroupedGallery(container: HTMLElement, mediaItems: MediaItemData[]): void {
    // First group by author
    const authorGroups = new Map<string, MediaItemData[]>();

    for (const item of mediaItems) {
      const author = item.author || 'Unknown Author';
      if (!authorGroups.has(author)) {
        authorGroups.set(author, []);
      }
      authorGroups.get(author)!.push(item);
    }

    // Filter out empty groups (maintain insertion order from mediaItems)
    const sortedAuthors = Array.from(authorGroups.entries())
      .filter(([_, items]) => items.length > 0);

    // If no authors have items, show empty state
    if (sortedAuthors.length === 0) {
      const emptyDiv = container.createDiv('gallery-empty-state sa-text-center sa-text-muted');
      emptyDiv.addClass('gvr-empty-state');
      emptyDiv.createEl('p', { text: 'No media items found' });
      return;
    }

    // Create wrapper for all author groups
    const allAuthorsWrapper = container.createDiv('gallery-all-authors sa-w-full sa-relative');

    // Render each author group
    for (const [authorName, authorItems] of sortedAuthors) {
      // Author section
      const authorSection = allAuthorsWrapper.createDiv('gallery-author-section gvr-author-section');

      // Author header (larger, more prominent)
      const authorHeader = authorSection.createDiv('gallery-author-header sa-bg-secondary sa-rounded-6 sa-text-normal sa-font-semibold sa-mb-16 gvr-author-header');

      const authorNameSpan = authorHeader.createSpan({ text: authorName });
      authorNameSpan.addClass('gvr-author-header-name');

      const authorCountSpan = authorHeader.createSpan({ text: ` (${authorItems.length})` });
      authorCountSpan.addClass('sa-text-sm', 'sa-text-faint', 'sa-opacity-80', 'gvr-author-header-count');

      // Now group this author's items by post
      const postGroups = new Map<string, { items: MediaItemData[], file?: TFile }>();

      for (const item of authorItems) {
        const postKey = item.title || item.sourceFile.basename;
        if (!postGroups.has(postKey)) {
          postGroups.set(postKey, { items: [], file: item.sourceFile });
        }
        postGroups.get(postKey)!.items.push(item);
      }

      // Filter posts (maintain insertion order from authorItems)
      const sortedPosts = Array.from(postGroups.entries())
        .filter(([_, data]) => data.items.length > 0);

      // Render each post under this author
      for (const [postName, postData] of sortedPosts) {
        // Post subsection
        const postSection = authorSection.createDiv('gallery-post-subsection sa-mb-16 gvr-post-subsection');

        // Post header (smaller, indented)
        const postHeader = postSection.createDiv('gallery-post-subheader sa-flex-between sa-bg-transparent sa-clickable sa-rounded-4 sa-text-sm sa-font-medium sa-text-muted sa-mb-8 gvr-post-subheader');

        const postHeaderLeft = postHeader.createDiv('sa-flex-row sa-gap-6');

        // Trim long post names (show first 60 chars + ellipsis)
        const displayName = postName.length > 60 ? postName.substring(0, 60) + '...' : postName;

        const postNameSpan = postHeaderLeft.createSpan({
          text: displayName,
          attr: { title: postName }
        });
        postNameSpan.addClass('sa-text-normal', 'gvr-post-name');

        // Add external link icon
        if (postData.file) {
          postHeader.addEventListener('click', () => {
            this.app.workspace.getLeaf().openFile(postData.file!);
          });

          // Hover effect handled by CSS .gvr-post-subheader:hover

          const linkIconWrapper = postHeaderLeft.createSpan('sa-inline-flex gvr-link-icon');
          setIcon(linkIconWrapper, 'external-link');

          const svgEl = linkIconWrapper.querySelector('svg');
          if (svgEl) {
            svgEl.setAttribute('width', '12');
            svgEl.setAttribute('height', '12');
          }
        }

        const postCountSpan = postHeader.createSpan({ text: `${postData.items.length}` });
        postCountSpan.addClass('sa-text-xs', 'sa-text-faint', 'sa-opacity-80', 'gvr-count-text');

        // Render post's media items
        this.renderUngroupedGallery(postSection, postData.items);
      }
    }
  }

  /**
   * Render grouped gallery with section headers
   */
  private renderGroupedGallery(container: HTMLElement, mediaItems: MediaItemData[], groupBy: 'author' | 'post'): void {
    // Group items with file reference
    const groups = new Map<string, { items: MediaItemData[], file?: TFile }>();

    for (const item of mediaItems) {
      const key = groupBy === 'author'
        ? (item.author || 'Unknown Author')
        : (item.title || item.sourceFile.basename);

      if (!groups.has(key)) {
        groups.set(key, { items: [], file: groupBy === 'post' ? item.sourceFile : undefined });
      }
      groups.get(key)!.items.push(item);
    }

    // Filter out empty groups (maintain insertion order from mediaItems)
    const sortedGroups = Array.from(groups.entries())
      .filter(([_, data]) => data.items.length > 0); // Skip empty groups

    // If no groups have items after filtering, show empty state
    if (sortedGroups.length === 0) {
      const emptyDiv = container.createDiv('gallery-empty-state sa-text-center sa-text-muted');
      emptyDiv.addClass('gvr-empty-state');
      emptyDiv.createEl('p', { text: 'No media items found' });
      return;
    }

    // Create wrapper for all groups
    const allGroupsWrapper = container.createDiv('gallery-all-groups sa-w-full sa-relative');

    // Render each group
    for (const [groupName, groupData] of sortedGroups) {
      // Group section
      const groupSection = allGroupsWrapper.createDiv('gallery-group-section gvr-group-section');

      // Group header (simple, no sticky)
      const groupHeader = groupSection.createDiv('gallery-group-header sa-flex-between sa-bg-transparent sa-text-base sa-font-medium sa-text-muted sa-mb-8 gvr-group-header');
      if (groupBy === 'post') {
        groupHeader.addClass('sa-clickable', 'sa-rounded-6', 'gvr-group-header--clickable');
      }

      const headerLeft = groupHeader.createDiv('sa-flex-row sa-gap-6');

      // Trim long group names for posts (show first 60 chars + ellipsis)
      const displayName = groupBy === 'post' && groupName.length > 60
        ? groupName.substring(0, 60) + '...'
        : groupName;

      const headerText = headerLeft.createSpan({
        text: displayName,
        attr: { title: groupName } // Full title on hover
      });
      headerText.addClass('sa-text-normal', 'gvr-header-text');

      // Make post titles clickable with Lucide icon
      if (groupBy === 'post' && groupData.file) {
        // Hover effect handled by CSS .gvr-group-header--clickable:hover

        groupHeader.addEventListener('click', () => {
          this.app.workspace.getLeaf().openFile(groupData.file!);
        });

        // Add Lucide external-link icon (smaller and more subtle)
        const linkIconWrapper = headerLeft.createSpan('sa-inline-flex sa-transition-opacity gvr-link-icon');
        setIcon(linkIconWrapper, 'external-link');

        // Resize icon to be smaller
        const svgEl = linkIconWrapper.querySelector('svg');
        if (svgEl) {
          svgEl.setAttribute('width', '12');
          svgEl.setAttribute('height', '12');
        }

        // Hover icon opacity handled by CSS .gvr-group-header--clickable:hover .gvr-link-icon
      }

      const headerCount = groupHeader.createSpan({ text: `${groupData.items.length}` });
      headerCount.addClass('sa-text-xs', 'sa-text-faint', 'sa-opacity-80', 'gvr-count-text');

      // Group grid
      this.renderUngroupedGallery(groupSection, groupData.items);
    }
  }

  /**
   * Render ungrouped gallery (default masonry layout)
   */
  private renderUngroupedGallery(container: HTMLElement, mediaItems: MediaItemData[]): void {
    // If no items after filtering, show empty state
    if (mediaItems.length === 0) {
      const emptyDiv = container.createDiv('gallery-empty-state sa-text-center sa-text-muted');
      emptyDiv.addClass('gvr-empty-state');
      emptyDiv.createEl('p', { text: 'No media items found' });
      return;
    }

    // Create Pinterest-style masonry grid with better alignment
    const gridEl = container.createDiv('media-gallery-masonry sa-p-16 gvr-masonry-grid');

    // Responsive column count with proper cleanup
    const updateColumns = () => {
      const width = gridEl.clientWidth;
      let columnCount = '4';
      if (width < 600) {
        columnCount = '1';
      } else if (width < 900) {
        columnCount = '2';
      } else if (width < 1200) {
        columnCount = '3';
      } else if (width < 1600) {
        columnCount = '4';
      } else if (width < 2000) {
        columnCount = '5';
      } else {
        columnCount = '6';
      }
      gridEl.setCssProps({ '--gvr-columns': columnCount });
    };

    // Initial update
    updateColumns();

    // Use ResizeObserver for better performance
    const resizeObserver = new ResizeObserver(() => {
      updateColumns();
    });
    resizeObserver.observe(gridEl);

    // IntersectionObserver for lazy loading images/videos
    const lazyLoadObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const card = entry.target as HTMLElement;
            const img = card.querySelector('img[data-src]') as HTMLImageElement;
            const video = card.querySelector('video[data-src]') as HTMLVideoElement;

            // Load image
            if (img) {
              img.src = img.dataset.src || '';
              img.removeAttribute('data-src');
              img.classList.add('loaded');
            }

            // Load video
            if (video) {
              video.src = video.dataset.src || '';
              video.removeAttribute('data-src');
              video.classList.add('loaded');
            }

            // Stop observing once loaded
            lazyLoadObserver.unobserve(card);
          }
        });
      },
      {
        root: container,
        rootMargin: '400px', // Increased: Load 400px before entering viewport (more aggressive)
        threshold: 0.01
      }
    );

    // Store cleanup function
    (gridEl as any).__cleanup = () => {
      resizeObserver.disconnect();
      lazyLoadObserver.disconnect();
    };

    // Render all cards at once (no staggered animation)
    // Store all media items on the grid for filter updates
    (gridEl as any).__allMediaItems = mediaItems;
    (gridEl as any).__lazyLoadObserver = lazyLoadObserver;

    for (const item of mediaItems) {
      this.renderMediaCard(gridEl, item, mediaItems);
    }
  }

  /**
   * Update visibility of cards based on filter without re-rendering
   * Much faster than full re-render
   */
  applyFilters(container: HTMLElement, platformFilter?: Set<string>, searchQuery?: string): void {
    const gridEl = container.querySelector('.media-gallery-masonry') as HTMLElement;
    if (!gridEl) return;

    const allMediaItems = (gridEl as any).__allMediaItems as MediaItemData[];
    if (!allMediaItems) return;

    const lazyLoadObserver = (gridEl as any).__lazyLoadObserver as IntersectionObserver;
    const cards = Array.from(gridEl.querySelectorAll('.media-card')) as HTMLElement[];

    cards.forEach((card, index) => {
      const item = allMediaItems[index];
      if (!item) {
        card.addClass('sa-hidden');
        return;
      }

      let visible = true;

      // Platform filter
      if (platformFilter && platformFilter.size > 0) {
        visible = visible && platformFilter.has(item.platform || '');
      }

      // Search filter
      if (searchQuery && searchQuery.trim().length > 0) {
        const searchLower = searchQuery.toLowerCase();
        const searchableText = [
          item.title || '',
          item.author || '',
          item.platform || '',
          item.content || ''
        ].join(' ').toLowerCase();

        visible = visible && searchableText.includes(searchLower);
      }

      const wasVisible = !card.hasClass('sa-hidden');

      // Show/hide with CSS (instant, no re-render)
      if (visible) {
        card.removeClass('sa-hidden');
        card.addClass('sa-inline-block');
      } else {
        card.addClass('sa-hidden');
      }

      // Re-observe cards that become visible for lazy loading
      if (visible && !wasVisible && lazyLoadObserver) {
        lazyLoadObserver.observe(card);
      }
    });
  }

  /**
   * Render a single media card
   */
  private renderMediaCard(parent: HTMLElement, item: MediaItemData, allMediaItems: MediaItemData[]): HTMLElement {
    const cardEl = parent.createDiv('media-card sa-relative sa-rounded-8 sa-overflow-hidden sa-clickable sa-bg-primary sa-mb-16 sa-inline-block sa-w-full gvr-media-card');

    // Media container
    const mediaContainer = cardEl.createDiv('media-container sa-relative sa-w-full sa-overflow-hidden sa-bg-secondary');

    // Get media file
    const mediaFile = this.app.vault.getAbstractFileByPath(item.mediaPath);

    if (item.type === 'image' && mediaFile) {
      this.renderImage(mediaContainer, item, allMediaItems);
    } else if (item.type === 'video' && mediaFile) {
      this.renderVideo(mediaContainer, item, allMediaItems);
    } else {
      this.renderMediaNotFound(mediaContainer);
    }

    // Platform badge (hover only)
    if (item.platform) {
      const platformBadge = mediaContainer.createDiv('platform-badge gvr-platform-badge sa-absolute sa-rounded-4 sa-opacity-0 sa-transition-opacity sa-z-1 sa-text-xs sa-font-medium');
      platformBadge.textContent = item.platform;
    }

    // Metadata footer - click to open source file
    this.renderMetadata(cardEl, item);

    // Hover effects handled by CSS .gvr-media-card:hover

    return cardEl;
  }

  /**
   * Render image element with lazy loading
   */
  private renderImage(container: HTMLElement, item: MediaItemData, allMediaItems: MediaItemData[]): void {
    const imgEl = container.createEl('img', {
      attr: {
        'data-src': this.app.vault.adapter.getResourcePath(item.mediaPath), // Lazy load
        alt: item.title || 'Media'
      }
    });

    // More subtle placeholder with aspect ratio preservation
    imgEl.addClass('sa-w-full', 'sa-block', 'sa-bg-secondary', 'sa-opacity-0', 'gvr-media-loading');

    imgEl.onerror = () => {
      imgEl.addClass('sa-hidden');
      container.addClass('gvr-media-error-container');
      this.renderMediaNotFound(container);
    };

    imgEl.onload = () => {
      imgEl.setCssStyles({ minHeight: 'auto' });
      imgEl.removeClass('sa-opacity-0');
      imgEl.addClass('sa-opacity-100');
    };

    // Click handler for lightbox
    container.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openLightbox(allMediaItems, allMediaItems.indexOf(item));
    });

    // Observe for lazy loading
    const card = container.closest('.media-card') as HTMLElement;
    if (card) {
      const gridEl = card.parentElement;
      const observer = (gridEl as any).__lazyLoadObserver as IntersectionObserver;
      if (observer) {
        observer.observe(card);
      }
    }
  }

  /**
   * Render video element with lazy loading and hover preview
   */
  private renderVideo(container: HTMLElement, item: MediaItemData, allMediaItems: MediaItemData[]): void {
    // Add play icon overlay to indicate it's a video
    const playIconOverlay = container.createDiv('video-play-icon gvr-play-icon sa-absolute sa-flex-center sa-rounded-full sa-pointer-none sa-z-1 sa-opacity-80');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'white');
    svg.setAttribute('stroke-width', '2');
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('points', '5 3 19 12 5 21 5 3');
    svg.appendChild(polygon);
    playIconOverlay.appendChild(svg);

    const videoEl = container.createEl('video', {
      attr: {
        'data-src': this.app.vault.adapter.getResourcePath(item.mediaPath), // Lazy load
        loop: 'true',
        playsinline: 'true',
        preload: 'metadata' // Load metadata and first frame (fast thumbnail)
      }
    });
    videoEl.addClass('sa-w-full', 'sa-block', 'sa-bg-secondary', 'sa-opacity-0', 'gvr-media-loading');
    videoEl.muted = true; // Set muted as boolean

    // Hide controls by default
    videoEl.removeAttribute('controls');

    // Hover to play preview (only after loaded)
    container.addEventListener('mouseenter', () => {
      if (videoEl.src) { // Only play if loaded
        void videoEl.play();
        playIconOverlay.removeClass('sa-opacity-80');
        playIconOverlay.addClass('sa-opacity-0');
      }
    });

    container.addEventListener('mouseleave', () => {
      videoEl.pause();
      videoEl.currentTime = 0;
      playIconOverlay.removeClass('sa-opacity-0');
      playIconOverlay.addClass('sa-opacity-80');
    });

    videoEl.onerror = () => {
      videoEl.addClass('sa-hidden');
      playIconOverlay.remove();
      container.addClass('gvr-media-error-container');
      this.renderMediaNotFound(container);
    };

    videoEl.onloadeddata = () => {
      videoEl.setCssStyles({ minHeight: 'auto' });
      videoEl.removeClass('sa-opacity-0');
      videoEl.addClass('sa-opacity-100');
    };

    // Click handler for lightbox
    container.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openLightbox(allMediaItems, allMediaItems.indexOf(item));
    });

    // Observe for lazy loading
    const card = container.closest('.media-card') as HTMLElement;
    if (card) {
      const gridEl = card.parentElement;
      const observer = (gridEl as any).__lazyLoadObserver as IntersectionObserver;
      if (observer) {
        observer.observe(card);
      }
    }
  }

  /**
   * Render media not found placeholder
   */
  private renderMediaNotFound(container: HTMLElement): void {
    container.addClass('gvr-media-error-container');
    const errorEl = container.createDiv({
      text: '� Media not found',
      cls: 'flex items-center justify-center h-full text-[var(--text-muted)]'
    });
    errorEl.addClass('sa-absolute');
    errorEl.addClass('sa-inset-0');
    errorEl.addClass('sa-flex-center');
  }

  /**
   * Render metadata footer with author and title (hover-only visibility)
   */
  private renderMetadata(card: HTMLElement, item: MediaItemData): void {
    const metadataEl = card.createDiv('media-metadata gvr-metadata sa-absolute sa-bottom-0 sa-left-0 sa-right-0 sa-p-12 sa-clickable');

    if (item.author) {
      const authorEl = metadataEl.createDiv('media-author');
      authorEl.textContent = item.author;
    }

    if (item.title) {
      const titleEl = metadataEl.createDiv('media-date');
      titleEl.textContent = item.title;
    }

    // Metadata click to open source file
    metadataEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.app.workspace.getLeaf().openFile(item.sourceFile);
    });
  }

  /**
   * Open lightbox for media preview with Lucide icons and keyboard navigation
   */
  private openLightbox(mediaItems: MediaItemData[], startIndex: number): void {
    let currentIndex = startIndex;

    // Create modal
    const modal = document.createElement('div');
    modal.className = 'sa-fixed sa-inset-0 sa-flex-center gvr-lightbox';

    // Close on backdrop click
    modal.addEventListener('click', () => {
      cleanup();
    });

    // Content container
    const content = modal.createDiv('lightbox-content sa-relative sa-flex-center gvr-lightbox-content');
    content.addEventListener('click', (e) => e.stopPropagation());

    // Render current media
    const renderMedia = () => {
      const item = mediaItems[currentIndex];
      if (!item) return;

      content.empty();

      const mediaFile = this.app.vault.getAbstractFileByPath(item.mediaPath);
      if (!mediaFile) return;

      const mediaSrc = this.app.vault.adapter.getResourcePath(item.mediaPath);

      if (item.type === 'image') {
        const img = content.createEl('img', { cls: 'sa-object-contain gvr-lightbox-media' });
        img.src = mediaSrc;
      } else {
        const video = content.createEl('video', { cls: 'sa-object-contain gvr-lightbox-media' });
        video.src = mediaSrc;
        video.controls = true;
        video.autoplay = true;
      }

      // Add navigation buttons (only if multiple items)
      if (mediaItems.length > 1) {
        // Previous button
        if (currentIndex > 0) {
          const prevBtn = content.createDiv('lightbox-nav lightbox-prev');
          setIcon(prevBtn, 'chevron-left');
          prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            currentIndex--;
            renderMedia();
          });
        }

        // Next button
        if (currentIndex < mediaItems.length - 1) {
          const nextBtn = content.createDiv('lightbox-nav lightbox-next');
          setIcon(nextBtn, 'chevron-right');
          nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            currentIndex++;
            renderMedia();
          });
        }

        // Counter
        const counter = content.createDiv('lightbox-counter');
        counter.setText(`${currentIndex + 1} / ${mediaItems.length}`);
      }
    };

    // Keyboard navigation
    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.key === 'Escape') {
        cleanup();
      } else if (evt.key === 'ArrowLeft' && currentIndex > 0) {
        currentIndex--;
        renderMedia();
      } else if (evt.key === 'ArrowRight' && currentIndex < mediaItems.length - 1) {
        currentIndex++;
        renderMedia();
      }
    };

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      modal.remove();
      document.removeEventListener('keydown', onKeyDown);
    };

    // Also cleanup if modal is removed from DOM externally
    const observer = new MutationObserver(() => {
      if (!document.body.contains(modal)) {
        observer.disconnect();
        cleanup();
      }
    });
    observer.observe(document.body, { childList: true });

    document.addEventListener('keydown', onKeyDown);
    document.body.appendChild(modal);
    renderMedia();
  }
}
