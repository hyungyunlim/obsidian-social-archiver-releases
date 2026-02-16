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
      const emptyDiv = container.createDiv('gallery-empty-state');
      emptyDiv.style.cssText = 'text-align: center; padding: 48px 16px; color: var(--text-muted);';
      emptyDiv.createEl('p', { text: 'No media items found' });
      return;
    }

    // Create wrapper for all author groups
    const allAuthorsWrapper = container.createDiv('gallery-all-authors');
    allAuthorsWrapper.style.cssText = 'width: 100%; position: relative;';

    // Render each author group
    for (const [authorName, authorItems] of sortedAuthors) {
      // Author section
      const authorSection = allAuthorsWrapper.createDiv('gallery-author-section');
      authorSection.style.cssText = 'margin-bottom: 40px;';

      // Author header (larger, more prominent)
      const authorHeader = authorSection.createDiv('gallery-author-header');
      authorHeader.style.cssText = `
        padding: 12px 16px;
        font-size: 15px;
        font-weight: 600;
        color: var(--text-normal);
        border: none;
        margin-bottom: 16px;
        background: var(--background-secondary);
        border-radius: 6px;
      `;

      const authorNameSpan = authorHeader.createSpan({ text: authorName });
      authorNameSpan.style.cssText = 'line-height: 1.2;';

      const authorCountSpan = authorHeader.createSpan({ text: ` (${authorItems.length})` });
      authorCountSpan.style.cssText = 'font-size: 12px; font-weight: 400; color: var(--text-faint); opacity: 0.7; margin-left: 6px;';

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
        const postSection = authorSection.createDiv('gallery-post-subsection');
        postSection.style.cssText = 'margin-bottom: 24px; margin-left: 16px;';

        // Post header (smaller, indented)
        const postHeader = postSection.createDiv('gallery-post-subheader');
        postHeader.style.cssText = `
          padding: 6px 12px;
          font-size: 12px;
          font-weight: 500;
          color: var(--text-muted);
          border: none;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: transparent;
          cursor: pointer;
          transition: all 0.15s ease;
          border-radius: 4px;
        `;

        const postHeaderLeft = postHeader.createDiv();
        postHeaderLeft.style.cssText = 'display: flex; align-items: center; gap: 6px;';

        // Trim long post names (show first 60 chars + ellipsis)
        const displayName = postName.length > 60 ? postName.substring(0, 60) + '...' : postName;

        const postNameSpan = postHeaderLeft.createSpan({
          text: displayName,
          attr: { title: postName }
        });
        postNameSpan.style.cssText = 'line-height: 1.2; color: var(--text-normal);';

        // Add external link icon
        if (postData.file) {
          postHeader.addEventListener('click', () => {
            this.app.workspace.getLeaf().openFile(postData.file!);
          });

          postHeader.addEventListener('mouseenter', () => {
            postHeader.style.background = 'var(--background-modifier-hover)';
          });

          postHeader.addEventListener('mouseleave', () => {
            postHeader.style.background = 'transparent';
          });

          const linkIconWrapper = postHeaderLeft.createSpan();
          linkIconWrapper.style.cssText = 'display: inline-flex; align-items: center; opacity: 0.3; line-height: 1; transition: opacity 0.15s;';
          setIcon(linkIconWrapper, 'external-link');

          const svgEl = linkIconWrapper.querySelector('svg');
          if (svgEl) {
            svgEl.setAttribute('width', '12');
            svgEl.setAttribute('height', '12');
          }
        }

        const postCountSpan = postHeader.createSpan({ text: `${postData.items.length}` });
        postCountSpan.style.cssText = 'font-size: 11px; font-weight: 400; color: var(--text-faint); opacity: 0.7;';

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
      const emptyDiv = container.createDiv('gallery-empty-state');
      emptyDiv.style.cssText = 'text-align: center; padding: 48px 16px; color: var(--text-muted);';
      emptyDiv.createEl('p', { text: 'No media items found' });
      return;
    }

    // Create wrapper for all groups
    const allGroupsWrapper = container.createDiv('gallery-all-groups');
    allGroupsWrapper.style.cssText = 'width: 100%; position: relative;';

    // Render each group
    for (const [groupName, groupData] of sortedGroups) {
      // Group section
      const groupSection = allGroupsWrapper.createDiv('gallery-group-section');
      groupSection.style.cssText = 'margin-bottom: 32px;';

      // Group header (simple, no sticky)
      const groupHeader = groupSection.createDiv('gallery-group-header');
      groupHeader.style.cssText = `
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 500;
        color: var(--text-muted);
        border: none;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: transparent;
        ${groupBy === 'post' ? 'cursor: pointer; transition: all 0.15s ease; border-radius: 6px;' : ''}
      `;

      const headerLeft = groupHeader.createDiv();
      headerLeft.style.cssText = 'display: flex; align-items: center; gap: 6px;';

      // Trim long group names for posts (show first 60 chars + ellipsis)
      const displayName = groupBy === 'post' && groupName.length > 60
        ? groupName.substring(0, 60) + '...'
        : groupName;

      const headerText = headerLeft.createSpan({
        text: displayName,
        attr: { title: groupName } // Full title on hover
      });
      headerText.style.cssText = 'line-height: 1.2; color: var(--text-normal);';

      // Make post titles clickable with Lucide icon
      if (groupBy === 'post' && groupData.file) {
        groupHeader.addEventListener('mouseenter', () => {
          groupHeader.style.background = 'var(--background-modifier-hover)';
          headerText.style.color = 'var(--text-normal)';
        });

        groupHeader.addEventListener('mouseleave', () => {
          groupHeader.style.background = 'transparent';
          headerText.style.color = 'var(--text-normal)';
        });

        groupHeader.addEventListener('click', () => {
          this.app.workspace.getLeaf().openFile(groupData.file!);
        });

        // Add Lucide external-link icon (smaller and more subtle)
        const linkIconWrapper = headerLeft.createSpan();
        linkIconWrapper.style.cssText = 'display: inline-flex; align-items: center; opacity: 0.3; line-height: 1; transition: opacity 0.15s;';
        setIcon(linkIconWrapper, 'external-link');

        // Resize icon to be smaller
        const svgEl = linkIconWrapper.querySelector('svg');
        if (svgEl) {
          svgEl.setAttribute('width', '12');
          svgEl.setAttribute('height', '12');
        }

        // Show icon more on hover
        groupHeader.addEventListener('mouseenter', () => {
          linkIconWrapper.style.opacity = '0.6';
        });

        groupHeader.addEventListener('mouseleave', () => {
          linkIconWrapper.style.opacity = '0.3';
        });
      }

      const headerCount = groupHeader.createSpan({ text: `${groupData.items.length}` });
      headerCount.style.cssText = 'font-size: 11px; font-weight: 400; color: var(--text-faint); opacity: 0.7;';

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
      const emptyDiv = container.createDiv('gallery-empty-state');
      emptyDiv.style.cssText = 'text-align: center; padding: 48px 16px; color: var(--text-muted);';
      emptyDiv.createEl('p', { text: 'No media items found' });
      return;
    }

    // Create Pinterest-style masonry grid with better alignment
    const gridEl = container.createDiv('media-gallery-masonry');
    gridEl.style.cssText = 'column-count: 4; column-gap: 16px; padding: 16px; column-fill: balance;';

    // Responsive column count with proper cleanup
    const updateColumns = () => {
      const width = gridEl.clientWidth;
      if (width < 600) {
        gridEl.style.columnCount = '1';
      } else if (width < 900) {
        gridEl.style.columnCount = '2';
      } else if (width < 1200) {
        gridEl.style.columnCount = '3';
      } else if (width < 1600) {
        gridEl.style.columnCount = '4';
      } else if (width < 2000) {
        gridEl.style.columnCount = '5';
      } else {
        gridEl.style.columnCount = '6';
      }
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
        card.style.display = 'none';
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

      const wasVisible = card.style.display !== 'none';

      // Show/hide with CSS (instant, no re-render)
      card.style.display = visible ? 'inline-block' : 'none';

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
    const cardEl = parent.createDiv('media-card');
    cardEl.style.cssText = 'position: relative; border: none; border-radius: 8px; overflow: hidden; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; background: var(--background-primary); margin-bottom: 16px; break-inside: avoid; display: inline-block; width: 100%; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);';

    // Media container
    const mediaContainer = cardEl.createDiv('media-container');
    mediaContainer.style.cssText = 'position: relative; width: 100%; overflow: hidden; background: var(--background-secondary);';

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
      const platformBadge = mediaContainer.createDiv('platform-badge');
      // More subtle blur: blur(2px) instead of blur(4px), lighter background
      platformBadge.style.cssText = 'position: absolute; top: 8px; left: 8px; padding: 4px 8px; border-radius: 4px; background: rgba(0, 0, 0, 0.5); color: white; font-size: 11px; font-weight: 500; opacity: 0; transition: opacity 0.2s; text-transform: capitalize; backdrop-filter: blur(2px); z-index: 1;';
      platformBadge.textContent = item.platform;
    }

    // Metadata footer - click to open source file
    this.renderMetadata(cardEl, item);

    // Hover effects
    this.attachHoverEffects(cardEl);

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
    imgEl.style.cssText = 'width: 100%; height: auto; display: block; min-height: 150px; background: var(--background-secondary); transition: opacity 0.2s ease-in;';
    imgEl.style.opacity = '0'; // Start invisible

    imgEl.onerror = () => {
      imgEl.style.display = 'none';
      container.style.minHeight = '200px';
      this.renderMediaNotFound(container);
    };

    imgEl.onload = () => {
      imgEl.style.minHeight = 'auto';
      imgEl.style.opacity = '1'; // Fade in when loaded
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
    const playIconOverlay = container.createDiv('video-play-icon');
    playIconOverlay.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 48px; height: 48px; background: rgba(0, 0, 0, 0.6); border-radius: 50%; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 1; opacity: 0.8;';
    playIconOverlay.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';

    const videoEl = container.createEl('video', {
      attr: {
        'data-src': this.app.vault.adapter.getResourcePath(item.mediaPath), // Lazy load
        loop: 'true',
        playsinline: 'true',
        preload: 'metadata' // Load metadata and first frame (fast thumbnail)
      }
    });
    videoEl.style.cssText = 'width: 100%; height: auto; display: block; min-height: 150px; background: var(--background-secondary); transition: opacity 0.2s ease-in;';
    videoEl.style.opacity = '0'; // Start invisible
    videoEl.muted = true; // Set muted as boolean

    // Hide controls by default
    videoEl.removeAttribute('controls');

    // Hover to play preview (only after loaded)
    container.addEventListener('mouseenter', () => {
      if (videoEl.src) { // Only play if loaded
        void videoEl.play();
        playIconOverlay.style.opacity = '0'; // Hide play icon on hover
      }
    });

    container.addEventListener('mouseleave', () => {
      videoEl.pause();
      videoEl.currentTime = 0;
      playIconOverlay.style.opacity = '0.8'; // Show play icon again
    });

    videoEl.onerror = () => {
      videoEl.style.display = 'none';
      playIconOverlay.remove();
      container.style.minHeight = '200px';
      this.renderMediaNotFound(container);
    };

    videoEl.onloadeddata = () => {
      videoEl.style.minHeight = 'auto';
      videoEl.style.opacity = '1'; // Fade in when loaded
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
    container.style.minHeight = '200px';
    const errorEl = container.createDiv({
      text: '� Media not found',
      cls: 'flex items-center justify-center h-full text-[var(--text-muted)]'
    });
    errorEl.style.cssText = 'position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center;';
  }

  /**
   * Render metadata footer with author and title (hover-only visibility)
   */
  private renderMetadata(card: HTMLElement, item: MediaItemData): void {
    const metadataEl = card.createDiv('media-metadata');
    // Don't override opacity - let CSS handle hover state
    // More subtle blur: blur(2px) instead of blur(4px)
    metadataEl.style.cssText = 'position: absolute; bottom: 0; left: 0; right: 0; padding: 12px; background: linear-gradient(to top, rgba(0, 0, 0, 0.6), transparent); backdrop-filter: blur(2px); cursor: pointer;';

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
   * Attach hover effects to card (subtle)
   */
  private attachHoverEffects(card: HTMLElement): void {
    card.addEventListener('mouseenter', () => {
      card.style.transform = 'translateY(-1px)';
      card.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.08)';
      const badge = card.querySelector('.platform-badge') as HTMLElement;
      if (badge) badge.style.opacity = '1';
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = 'translateY(0)';
      card.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.05)';
      const badge = card.querySelector('.platform-badge') as HTMLElement;
      if (badge) badge.style.opacity = '0';
    });
  }

  /**
   * Open lightbox for media preview with Lucide icons and keyboard navigation
   */
  private openLightbox(mediaItems: MediaItemData[], startIndex: number): void {
    let currentIndex = startIndex;

    // Create modal
    const modal = document.createElement('div');
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.9); z-index: 9999; display: flex; align-items: center; justify-content: center;';

    // Close on backdrop click
    modal.addEventListener('click', () => {
      cleanup();
    });

    // Content container
    const content = modal.createDiv('lightbox-content');
    content.style.cssText = 'position: relative; max-width: 90vw; max-height: 90vh; display: flex; align-items: center; justify-content: center;';
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
        const img = content.createEl('img');
        img.src = mediaSrc;
        img.style.cssText = 'max-width: 100%; max-height: 90vh; object-fit: contain;';
      } else {
        const video = content.createEl('video');
        video.src = mediaSrc;
        video.controls = true;
        video.autoplay = true;
        video.style.cssText = 'max-width: 100%; max-height: 90vh; object-fit: contain;';
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
