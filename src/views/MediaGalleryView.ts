import { BasesView, QueryController, Keymap, HoverPopover, HoverParent, TFile, setIcon } from 'obsidian';
import type { App } from 'obsidian';
import { PLATFORMS } from '@/shared/platforms/types';

/**
 * Unique identifier for the Media Gallery View
 */
export const VIEW_TYPE_MEDIA_GALLERY = 'social-archiver-media-gallery';

/**
 * Known platforms for media gallery detection
 * Derived from centralized PLATFORMS constant, excluding 'post' (user-created)
 * Includes 'twitter' as legacy alias for 'x'
 */
const KNOWN_PLATFORMS = [...PLATFORMS.filter(p => p !== 'post'), 'twitter'] as const;

/**
 * MediaGalleryView - Custom Bases view for displaying media in a gallery format
 *
 * Features:
 * - Grid/Masonry layout options
 * - Filter by media type (images/videos/all)
 * - Platform badges
 * - Lightbox preview
 * - Responsive columns
 */
export class MediaGalleryView extends BasesView implements HoverParent {
  readonly type = VIEW_TYPE_MEDIA_GALLERY;
  hoverPopover: HoverPopover | null = null;

  private containerEl: HTMLElement;
  private galleryEl: HTMLElement | null = null;
  private allMediaItems: MediaItem[] = []; // Store all media for lightbox navigation

  constructor(controller: QueryController, parentEl: HTMLElement) {
    super(controller);
    this.containerEl = parentEl.createDiv('bases-media-gallery-container');
  }

  /**
   * Called when data is updated. Re-render the media gallery.
   */
  public onDataUpdated(): void {
    this.render();
  }

  /**
   * Called when config is updated. Re-render the media gallery.
   */
  public onConfigUpdated(): void {
    this.render();
  }

  /**
   * Render the media gallery
   */
  private render(): void {
    const { app } = this;

    // Get user configuration
    const mediaType = String(this.config.get('mediaType') || 'all');
    const layout = String(this.config.get('layout') || 'grid');
    const columns = Number(this.config.get('columns')) || 3;

    // Clear previous content
    this.containerEl.empty();

    // Create gallery container with layout class
    this.galleryEl = this.containerEl.createDiv({
      cls: `media-gallery media-gallery-${layout} media-gallery-cols-${columns}`
    });

    // Show loading state with spinner
    const loadingEl = this.galleryEl.createDiv('media-gallery-loading');
    loadingEl.createDiv('media-gallery-spinner');
    const loadingText = loadingEl.createDiv('media-gallery-loading-text');
    loadingText.setText('Loading media...');

    // Load media asynchronously
    void this.loadMedia(app, mediaType, loadingEl);
  }

  /**
   * Load media asynchronously with batching
   */
  private async loadMedia(app: App, mediaType: string, loadingEl: HTMLElement): Promise<void> {
    let mediaCount = 0;

    // Reset allMediaItems for new load
    this.allMediaItems = [];

    try {
      // Collect all entries first
      const allEntries: any[] = [];
      for (const group of this.data.groupedData) {
        for (const entry of group.entries) {
          allEntries.push(entry);
        }
      }

      // Process entries in parallel batches of 10
      const BATCH_SIZE = 10;

      for (let i = 0; i < allEntries.length; i += BATCH_SIZE) {
        const batch = allEntries.slice(i, i + BATCH_SIZE);

        // Process batch in parallel
        const mediaArrays = await Promise.all(
          batch.map(async (entry) => {
            return await this.extractMediaFromEntry(entry, app);
          })
        );

        // Render all media from this batch
        for (let j = 0; j < batch.length; j++) {
          const entry = batch[j];
          const media = mediaArrays[j];
          if (!media) continue;

          const filteredMedia = this.filterMedia(media, mediaType);

          for (const mediaItem of filteredMedia) {
            this.allMediaItems.push(mediaItem); // Store for lightbox navigation
            this.renderMediaCard(mediaItem, entry, app);
            mediaCount++;
          }
        }

        // Update loading text with progress
        const processed = Math.min(i + BATCH_SIZE, allEntries.length);
        const loadingText = loadingEl.querySelector('.media-gallery-loading-text') as HTMLElement;
        if (loadingText) {
          loadingText.setText(`Loading media... ${processed}/${allEntries.length}`);
        }
      }

      // Remove loading state
      loadingEl.remove();

      // Show empty state if no media found
      if (mediaCount === 0) {
        this.renderEmptyState(mediaType);
      }
    } catch {
      loadingEl.setText('Error loading media');
    }
  }

  /**
   * Extract media files from a BasesEntry using PostDataParser
   *
   * Note: Uses a simple cache to avoid re-parsing the same files
   */
  private static parseCache = new Map<string, any>();

  private async extractMediaFromEntry(entry: any, app: App): Promise<MediaItem[]> {
    const media: MediaItem[] = [];
    if (!(entry.file instanceof TFile)) return [];
    const file = entry.file;

    try {
      // Check if this is a media file itself (not a markdown file)
      const mediaExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov', '.avi', '.mkv'];
      const isMediaFile = mediaExtensions.some(ext => file.path.toLowerCase().endsWith(ext));

      if (isMediaFile) {
        // Direct media file - don't parse, just return as MediaItem
        const isVideo = ['.mp4', '.mov', '.avi', '.mkv'].some(ext => file.path.toLowerCase().endsWith(ext));

        // Extract platform from file path
        // Example: attachments/social-archives/youtube/video.mp4 -> youtube
        // Example: attachments/social-archives/2025-11-08-threads-dqv2iubizlv/1.jpg -> threads
        let platform = 'unknown';
        const pathParts = file.path.toLowerCase().split('/');
        const platformIndex = pathParts.indexOf('social-archives');
        if (platformIndex >= 0 && platformIndex < pathParts.length - 1) {
          const folderName = pathParts[platformIndex + 1];
          if (folderName) {
            // Try to extract platform from folder name
            // Folder name format: YYYY-MM-DD-platform-id or just platform
            for (const knownPlatform of KNOWN_PLATFORMS) {
              if (folderName.includes(knownPlatform)) {
                platform = knownPlatform;
                break;
              }
            }

            // If no known platform found, use the folder name as-is (backward compatibility)
            if (platform === 'unknown') {
              platform = folderName;
            }
          }
        }

        media.push({
          file: file,
          url: file.path,
          sourceFile: file,
          type: isVideo ? 'video' : 'image',
          platform: platform,
          author: 'Unknown',
          publishDate: new Date(file.stat.mtime).toISOString()
        });

        return media;
      }

      // This is a markdown file - parse it to extract media
      const cacheKey = `${file.path}::${file.stat.mtime}`;
      let postData = MediaGalleryView.parseCache.get(cacheKey);

      if (!postData) {
        // Cache miss - need to parse
        // Dynamically import PostDataParser to avoid circular dependencies
        const { PostDataParser } = await import('../components/timeline/parsers/PostDataParser');
        const parser = new PostDataParser(app.vault, app);

        // Parse the post data (this extracts media URLs from markdown)
        postData = await parser.parseFile(file);

        // Cache the result
        MediaGalleryView.parseCache.set(cacheKey, postData);

        // Limit cache size to 200 entries
        if (MediaGalleryView.parseCache.size > 200) {
          const firstKey = MediaGalleryView.parseCache.keys().next().value;
          if (firstKey) {
            MediaGalleryView.parseCache.delete(firstKey);
          }
        }
      }
      // Cache hit - use cached data

      if (!postData || !postData.media || postData.media.length === 0) {
        return media;
      }

      // Convert PostData media to MediaItem format
      for (const mediaItem of postData.media) {
        if (!mediaItem.url) continue;

        // Skip unsupported formats
        const urlStr = typeof mediaItem.url === 'string' ? mediaItem.url : '';
        const unsupportedFormats = ['.heic', '.heif', '.tiff', '.tif'];
        if (unsupportedFormats.some(ext => urlStr.toLowerCase().endsWith(ext))) {
          continue;
        }

        // Check if URL is a local file path
        let resolvedFile: TFile | null = null;
        if (typeof mediaItem.url === 'string' && !mediaItem.url.startsWith('http')) {
          // Try to resolve as vault path
          const abstractFile = app.vault.getAbstractFileByPath(mediaItem.url);
          if (abstractFile instanceof TFile) {
            resolvedFile = abstractFile;
          }

          // If not found, try relative to the source file
          if (!resolvedFile) {
            const resolvedPath = app.metadataCache.getFirstLinkpathDest(mediaItem.url, file.path);
            if (resolvedPath) {
              resolvedFile = resolvedPath;
            }
          }
        }

        // Extract platform from media file path if postData.platform is generic or invalid
        let platform = postData.platform;
        if (!platform || platform === 'post' || platform === 'unknown') {
          const mediaPath = resolvedFile?.path || (typeof mediaItem.url === 'string' ? mediaItem.url : '');
          const pathParts = mediaPath.toLowerCase().split('/');
          const platformIndex = pathParts.indexOf('social-archives');

          if (platformIndex >= 0 && platformIndex < pathParts.length - 1) {
            const folderName = pathParts[platformIndex + 1];

            for (const knownPlatform of KNOWN_PLATFORMS) {
              if (folderName.includes(knownPlatform)) {
                platform = knownPlatform;
                break;
              }
            }
          }
        }

        media.push({
          file: resolvedFile,
          url: typeof mediaItem.url === 'string' ? mediaItem.url : '',
          sourceFile: file,
          type: mediaItem.type,
          platform: platform,
          author: postData.author?.name || 'Unknown',
          publishDate: postData.metadata?.timestamp
            ? (typeof postData.metadata.timestamp === 'string'
              ? postData.metadata.timestamp
              : postData.metadata.timestamp.toISOString())
            : ''
        });
      }

    } catch (error) {
      console.error('[Media Gallery] Failed to parse post:', file.path, error);
    }

    return media;
  }

  /**
   * Filter media by type
   */
  private filterMedia(media: MediaItem[], filter: string): MediaItem[] {
    if (filter === 'all') return media;
    if (filter === 'images') return media.filter(m => m.type === 'image');
    if (filter === 'videos') return media.filter(m => m.type === 'video');
    return media;
  }

  /**
   * Render a single media card
   */
  private renderMediaCard(mediaItem: MediaItem, entry: any, app: App): void {
    if (!this.galleryEl) return;

    const card = this.galleryEl.createDiv('media-card');

    // Add platform badge
    const badge = card.createDiv({
      cls: `platform-badge platform-${mediaItem.platform.toLowerCase()}`
    });
    badge.setText(mediaItem.platform);

    // Create media container
    const mediaContainer = card.createDiv('media-container');

    // Get media source (either vault resource or direct URL)
    let mediaSrc: string;

    if (mediaItem.file) {
      // Local file in vault - check if it exists
      if (!app.vault.getAbstractFileByPath(mediaItem.file.path)) {
        console.warn('[Media Gallery] File not found:', mediaItem.file.path);
        return; // Skip this media item
      }
      mediaSrc = app.vault.getResourcePath(mediaItem.file);
    } else if (mediaItem.url.startsWith('http')) {
      // External URL
      mediaSrc = mediaItem.url;
    } else {
      // Local path - try to resolve
      const resolvedFile = app.vault.getAbstractFileByPath(mediaItem.url);
      if (resolvedFile instanceof TFile) {
        mediaSrc = app.vault.getResourcePath(resolvedFile);
      } else {
        console.warn('[Media Gallery] File not found:', mediaItem.url);
        return; // Skip this media item
      }
    }

    if (mediaItem.type === 'image') {
      const img = mediaContainer.createEl('img', {
        cls: 'media-image',
        attr: {
          src: mediaSrc,
          alt: mediaItem.file?.basename || 'Image'
        }
      });

      // Check aspect ratio when image loads
      img.addEventListener('load', () => {
        const aspectRatio = img.naturalWidth / img.naturalHeight;

        // Portrait orientation (taller than wide)
        if (aspectRatio < 0.8) {
          card.addClass('media-card-portrait');
        }
        // Wide (includes 4:3, 3:2, 16:10, 16:9, 21:9, etc - aspect ratio > 1.3)
        else if (aspectRatio > 1.3) {
          card.addClass('media-card-wide');
        }
      });

      // Add click handler for lightbox
      img.addEventListener('click', (evt) => {
        this.openLightbox(mediaItem, app);
      });
    } else {
      const video = mediaContainer.createEl('video', {
        cls: 'media-video',
        attr: {
          src: mediaSrc,
          loop: 'true',
          playsinline: 'true'
        }
      });

      // Set muted property directly (boolean attribute)
      video.muted = true;

      // Check aspect ratio for videos
      video.addEventListener('loadedmetadata', () => {
        const aspectRatio = video.videoWidth / video.videoHeight;

        // Portrait orientation (9:16 etc)
        if (aspectRatio < 0.8) {
          card.addClass('media-card-portrait');
        }
        // Wide (includes 4:3, 3:2, 16:10, 16:9, 21:9, etc - aspect ratio > 1.3)
        else if (aspectRatio > 1.3) {
          card.addClass('media-card-wide');
        }
      });

      // Auto-play on hover and show controls
      video.addEventListener('mouseenter', () => {
        video.setAttribute('controls', 'true');
        void video.play();
      });

      // Pause, reset, and hide controls on mouse leave
      video.addEventListener('mouseleave', () => {
        video.pause();
        video.currentTime = 0;
        video.removeAttribute('controls');
      });

      // Add click handler for lightbox
      video.addEventListener('click', (evt) => {
        this.openLightbox(mediaItem, app);
      });
    }

    // Add metadata overlay
    const metadata = card.createDiv('media-metadata');

    const authorEl = metadata.createDiv('media-author');
    authorEl.setText(mediaItem.author);

    if (mediaItem.publishDate) {
      const dateEl = metadata.createDiv('media-date');
      dateEl.setText(this.formatDate(mediaItem.publishDate));
    }

    // Add click handler to open source file
    card.addEventListener('click', (evt) => {
      if (!(evt.target as HTMLElement).closest('.media-container')) {
        // Click on metadata area - open source file
        const modEvent = Keymap.isModEvent(evt);
        void app.workspace.openLinkText(mediaItem.sourceFile.path, '', modEvent);
      }
    });

    // Add hover preview for source file
    card.addEventListener('mouseover', (evt) => {
      app.workspace.trigger('hover-link', {
        event: evt,
        source: 'media-gallery',
        hoverParent: this,
        targetEl: card,
        linktext: mediaItem.sourceFile.path,
      });
    });
  }

  /**
   * Open lightbox for full-size media view with navigation
   */
  private openLightbox(initialMediaItem: MediaItem, app: App): void {
    // Find current index in allMediaItems
    let currentIndex = this.allMediaItems.findIndex(m =>
      m.url === initialMediaItem.url && m.sourceFile === initialMediaItem.sourceFile
    );

    if (currentIndex === -1) currentIndex = 0;

    const modal = document.createElement('div');
    modal.addClass('media-lightbox');

    // Create backdrop
    const backdrop = modal.createDiv('lightbox-backdrop');
    backdrop.addEventListener('click', () => {
      cleanup();
    });

    // Create content container
    const content = modal.createDiv('lightbox-content');

    // Function to render media
    const renderMedia = (index: number) => {
      if (index < 0 || index >= this.allMediaItems.length) return;

      const mediaItem = this.allMediaItems[index];
      if (!mediaItem) return;

      content.empty();

      // Get media source
      let mediaSrc: string;
      if (mediaItem.file) {
        mediaSrc = app.vault.getResourcePath(mediaItem.file);
      } else if (mediaItem.url.startsWith('http')) {
        mediaSrc = mediaItem.url;
      } else {
        const resolvedFile = app.vault.getAbstractFileByPath(mediaItem.url);
        if (resolvedFile instanceof TFile) {
          mediaSrc = app.vault.getResourcePath(resolvedFile);
        } else {
          mediaSrc = mediaItem.url;
        }
      }

      if (mediaItem.type === 'image') {
        content.createEl('img', {
          attr: {
            src: mediaSrc,
            alt: mediaItem.file?.basename || 'Image'
          }
        });
      } else {
        content.createEl('video', {
          attr: {
            src: mediaSrc,
            controls: 'true',
            autoplay: 'true'
          }
        });
      }

      // Add navigation buttons
      if (this.allMediaItems.length > 1) {
        // Previous button
        if (index > 0) {
          const prevBtn = content.createDiv('lightbox-nav lightbox-prev');
          setIcon(prevBtn, 'chevron-left');
          prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            currentIndex--;
            renderMedia(currentIndex);
          });
        }

        // Next button
        if (index < this.allMediaItems.length - 1) {
          const nextBtn = content.createDiv('lightbox-nav lightbox-next');
          setIcon(nextBtn, 'chevron-right');
          nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            currentIndex++;
            renderMedia(currentIndex);
          });
        }

        // Counter
        const counter = content.createDiv('lightbox-counter');
        counter.setText(`${index + 1} / ${this.allMediaItems.length}`);
      }

      // Close button
      const closeBtn = content.createDiv('lightbox-close');
      closeBtn.setText('×');
      closeBtn.addEventListener('click', () => {
        cleanup();
      });
    };

    // Keyboard navigation
    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.key === 'Escape') {
        cleanup();
      } else if (evt.key === 'ArrowLeft' && currentIndex > 0) {
        currentIndex--;
        renderMedia(currentIndex);
      } else if (evt.key === 'ArrowRight' && currentIndex < this.allMediaItems.length - 1) {
        currentIndex++;
        renderMedia(currentIndex);
      }
    };

    const cleanup = () => {
      modal.remove();
      document.removeEventListener('keydown', onKeyDown);
    };

    document.addEventListener('keydown', onKeyDown);

    // Add to body and render initial media
    document.body.appendChild(modal);
    try {
      renderMedia(currentIndex);
    } catch (err) {
      cleanup();
      throw err;
    }
  }

  /**
   * Render empty state
   */
  private renderEmptyState(mediaType: string): void {
    const empty = this.containerEl.createDiv('media-gallery-empty');

    const icon = empty.createDiv('empty-icon');
    icon.setText('🖼️');

    const message = empty.createDiv('empty-message');
    const typeText = mediaType === 'all' ? 'media' : mediaType;
    message.setText(`No ${typeText} found in your archived posts`);

    const hint = empty.createDiv('empty-hint');
    hint.setText('Try archiving posts with images or videos, or adjust your filters');
  }

  /**
   * Format date string for display
   */
  private formatDate(dateStr: string): string {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return dateStr;
    }
  }
}

/**
 * Media item interface
 */
interface MediaItem {
  file: TFile | null; // Can be null if media is external URL
  url: string; // URL or path to media
  sourceFile: TFile;
  type: 'image' | 'video';
  platform: string;
  author: string;
  publishDate: string;
}
