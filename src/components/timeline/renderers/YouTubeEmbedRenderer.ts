/**
 * YouTubeEmbedRenderer - Renders YouTube and TikTok embeds
 * Single Responsibility: Video embed rendering
 */
export class YouTubeEmbedRenderer {
  /** Active IntersectionObservers created for deferred iframe loading. */
  private activeObservers: IntersectionObserver[] = [];

  /**
   * Render YouTube embed iframe with playback control
   * @returns iframe element for YouTubePlayerController
   */
  renderYouTube(container: HTMLElement, videoId: string, _isEmbedded: boolean = false): HTMLIFrameElement {
    // Outer wrapper to constrain size
    const outerWrapper = container.createDiv({ cls: 'yte-outer-wrapper' });

    const embedContainer = outerWrapper.createDiv({ cls: 'yte-embed-container' });

    // IMPORTANT: enablejsapi=1 is required for postMessage control
    // Create iframe without src - defer loading until visible via IntersectionObserver
    const embedSrc = `https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1`;
    const iframe = embedContainer.createEl('iframe', {
      cls: 'yte-iframe-fill',
      attr: {
        frameborder: '0',
        allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
        allowfullscreen: 'true',
        referrerpolicy: 'strict-origin-when-cross-origin'
      }
    });

    // Remove width/height attributes that may override CSS
    iframe.removeAttribute('width');
    iframe.removeAttribute('height');

    // Defer iframe src loading until the embed is visible in viewport
    // This prevents off-screen YouTube iframes from consuming CPU/memory
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          iframe.setAttribute('src', embedSrc);
          observer.disconnect();
          this.removeObserver(observer);
          break;
        }
      }
    }, { rootMargin: '200px' }); // Load slightly before entering viewport
    observer.observe(embedContainer);
    this.activeObservers.push(observer);

    return iframe;
  }

  /**
   * Render TikTok embed iframe (direct method)
   */
  renderTikTok(container: HTMLElement, url: string, _videoId?: string): void {
    // Always extract video ID from URL (don't trust the passed videoId parameter)
    // URL patterns:
    // - https://www.tiktok.com/@username/video/1234567890
    // - https://vm.tiktok.com/ZMabcdefg/ (short URL - cannot extract ID)
    // - https://vt.tiktok.com/ZSyUa2Y4q/ (short URL - cannot extract ID)
    const videoIdMatch = url.match(/\/video\/(\d+)/);
    let finalVideoId = videoIdMatch ? videoIdMatch[1] : null;

    if (!finalVideoId) {
      // Fallback: show link
      const linkContainer = container.createDiv({ cls: 'yte-tiktok-fallback' });
      const link = linkContainer.createEl('a', {
        cls: 'yte-link-accent',
        text: 'View on TikTok',
        attr: {
          href: url,
          target: '_blank'
        }
      });
      return;
    }

    const embedContainer = container.createDiv({ cls: 'yte-tiktok-embed' });

    const tiktokSrc = `https://www.tiktok.com/embed/v2/${finalVideoId}`;
    const iframe = embedContainer.createEl('iframe', {
      cls: 'yte-iframe-full',
      attr: {
        width: '340',
        height: '700',
        frameborder: '0',
        allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
        allowfullscreen: 'true',
        referrerpolicy: 'strict-origin-when-cross-origin'
      }
    });

    // Defer iframe src loading until visible in viewport
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          iframe.setAttribute('src', tiktokSrc);
          observer.disconnect();
          this.removeObserver(observer);
          break;
        }
      }
    }, { rootMargin: '200px' });
    observer.observe(embedContainer);
    this.activeObservers.push(observer);
  }

  /**
   * Disconnect and remove all active IntersectionObservers.
   * Must be called before feed rebuild to prevent stale observers
   * from firing on detached DOM nodes.
   */
  disconnectAllObservers(): void {
    for (const observer of this.activeObservers) {
      observer.disconnect();
    }
    this.activeObservers = [];
  }

  private removeObserver(observer: IntersectionObserver): void {
    const idx = this.activeObservers.indexOf(observer);
    if (idx >= 0) {
      this.activeObservers.splice(idx, 1);
    }
  }
}
