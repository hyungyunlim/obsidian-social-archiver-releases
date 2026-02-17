import { ItemView, WorkspaceLeaf, TFile } from 'obsidian';
import type SocialArchiverPlugin from '../main';

/**
 * View type identifier for Media Gallery
 */
export const VIEW_TYPE_MEDIA_GALLERY_2 = 'social-archiver-media-gallery-2';

/**
 * Media Gallery View - Custom view for displaying media from archived posts
 * Shows images and videos in a responsive grid layout
 */
export class MediaGalleryView2 extends ItemView {
  private plugin: SocialArchiverPlugin;
  private contentContainer: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: SocialArchiverPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_MEDIA_GALLERY_2;
  }

  getDisplayText(): string {
    return 'Media Gallery';
  }

  getIcon(): string {
    return 'images';
  }

  async onOpen(): Promise<void> {
    // Add back to timeline button in header
    this.addAction('list', 'Back to Timeline', async () => {
      const currentLeaf = this.leaf;
      if (!currentLeaf) return;

      await currentLeaf.setViewState({
        type: 'social-archiver-timeline',
        active: true
      });
    });

    const container = this.containerEl;
    container.empty();
    container.addClass('social-archiver-media-gallery-view');

    // Enable scrolling
    container.addClass('mgv2-scroll-container');

    // Create content container
    this.contentContainer = container.createDiv('media-gallery-content');

    await this.loadMediaGallery();
  }

  async onClose(): Promise<void> {
    // Cleanup
    if (this.contentContainer) {
      this.contentContainer.empty();
      this.contentContainer = null;
    }
  }

  /**
   * Load and display media gallery
   */
  private async loadMediaGallery(): Promise<void> {
    if (!this.contentContainer) return;

    this.contentContainer.empty();

    // Loading state
    const loadingEl = this.contentContainer.createDiv({
      cls: 'media-gallery-loading',
      text: 'Loading media...'
    });

    try {
      // Get all files from archive path
      const archivePath = this.plugin.settings.archivePath || 'Social Archives';
      const files = this.app.vault.getMarkdownFiles()
        .filter(file => file.path.startsWith(archivePath));

      // Extract media from files
      const mediaItems: Array<{file: TFile, media: string, type: 'image' | 'video'}> = [];

      for (const file of files) {
        const content = await this.app.vault.read(file);
        
        // Extract images: ![alt](path)
        const imageRegex = /!\[.*?\]\((.*?)\)/g;
        let match;
        while ((match = imageRegex.exec(content)) !== null) {
          const mediaPath = match[1];
          if (mediaPath && !mediaPath.startsWith('http')) {
            mediaItems.push({
              file,
              media: mediaPath,
              type: 'image'
            });
          }
        }

        // Extract videos: <video src="path">
        const videoRegex = /<video[^>]+src=["']([^"']+)["']/g;
        while ((match = videoRegex.exec(content)) !== null) {
          const mediaPath = match[1];
          if (mediaPath && !mediaPath.startsWith('http')) {
            mediaItems.push({
              file,
              media: mediaPath,
              type: 'video'
            });
          }
        }
      }

      loadingEl.remove();

      if (mediaItems.length === 0) {
        this.contentContainer.createDiv({
          cls: 'media-gallery-empty',
          text: 'No media found in archived posts'
        });
        return;
      }

      // Create grid
      const gridEl = this.contentContainer.createDiv({ cls: 'media-gallery-grid mgv2-grid' });

      for (const item of mediaItems) {
        const cardEl = gridEl.createDiv({ cls: 'media-card mgv2-card' });

        // Get absolute path for media file
        const mediaFile = this.app.vault.getAbstractFileByPath(item.media);

        if (item.type === 'image' && mediaFile) {
          const imgEl = cardEl.createEl('img', {
            cls: 'mgv2-media-fill',
            attr: {
              src: this.app.vault.adapter.getResourcePath(item.media),
              alt: 'Media from ' + item.file.basename
            }
          });

          // Error handling
          imgEl.onerror = () => {
            imgEl.addClass('sa-hidden');
            cardEl.createDiv({
              text: '⚠️ Image not found',
              cls: 'media-error mgv2-error-placeholder'
            });
          };
        } else if (item.type === 'video' && mediaFile) {
          const videoEl = cardEl.createEl('video', {
            cls: 'mgv2-media-fill',
            attr: {
              src: this.app.vault.adapter.getResourcePath(item.media),
              controls: 'true'
            }
          });

          videoEl.onerror = () => {
            videoEl.addClass('sa-hidden');
            cardEl.createDiv({
              text: '⚠️ Video not found',
              cls: 'media-error mgv2-error-placeholder'
            });
          };
        } else {
          // File doesn't exist
          cardEl.createDiv({
            text: '⚠️ Media file not found',
            cls: 'media-error mgv2-error-placeholder'
          });
        }

        // Click to open source file
        cardEl.addEventListener('click', () => {
          this.app.workspace.getLeaf().openFile(item.file);
        });
      }

    } catch (error) {
      loadingEl.remove();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.contentContainer.createDiv({
        cls: 'media-gallery-error',
        text: 'Error loading media: ' + errorMessage
      });
      console.error('[Media Gallery] Error:', error);
    }
  }

  /**
   * Refresh the gallery
   */
  public async refresh(): Promise<void> {
    await this.loadMediaGallery();
  }
}
