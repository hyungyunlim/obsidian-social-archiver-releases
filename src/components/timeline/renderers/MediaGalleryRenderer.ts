import { setIcon } from 'obsidian';
import type { Media, PostData } from '../../../types/post';
import { isVideoUrl, isAudioUrl } from '../../../utils/mediaType';
import { TranscriptRenderer } from './TranscriptRenderer';
import type { TranscriptionSegment } from '../../../types/transcription';

/**
 * MediaGalleryRenderer - Renders media carousel with thumbnails
 * Single Responsibility: Media gallery UI rendering
 */
export class MediaGalleryRenderer {
  /** Track transcript renderers for cleanup */
  private transcriptRenderers: TranscriptRenderer[] = [];

  /**
   * Static set to track all active audio elements across all instances
   * Used to pause other audio when a new one starts playing
   */
  private static activeAudioElements: Set<HTMLAudioElement> = new Set();

  constructor(
    private getResourcePath: (path: string) => string
  ) {}

  /**
   * Pause all other audio elements when one starts playing
   */
  private static pauseOtherAudio(currentAudio: HTMLAudioElement): void {
    for (const audio of MediaGalleryRenderer.activeAudioElements) {
      if (audio !== currentAudio && !audio.paused) {
        audio.pause();
      }
    }
  }

  /**
   * Register an audio element for exclusive playback management
   */
  private registerAudioElement(audio: HTMLAudioElement): void {
    // Add to tracking set
    MediaGalleryRenderer.activeAudioElements.add(audio);

    // Pause others when this one starts playing
    const playHandler = () => {
      MediaGalleryRenderer.pauseOtherAudio(audio);
    };
    audio.addEventListener('play', playHandler);

    // Remove from set when audio element is removed from DOM
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.removedNodes) {
          if (node === audio || (node instanceof Element && node.contains(audio))) {
            MediaGalleryRenderer.activeAudioElements.delete(audio);
            audio.removeEventListener('play', playHandler);
            observer.disconnect();
            return;
          }
        }
      }
    });

    // Observe parent for removal
    if (audio.parentElement) {
      observer.observe(audio.parentElement.parentElement || document.body, {
        childList: true,
        subtree: true
      });
    }
  }

  /**
   * Format time in MM:SS or HH:MM:SS format
   */
  private formatTime(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) return '0:00';

    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Render custom minimal audio player with metadata
   * Returns object containing the wrapper element and audio element
   */
  private renderAudioPlayer(
    container: HTMLElement,
    audioSrc: string,
    post?: PostData
  ): { wrapper: HTMLElement; audio: HTMLAudioElement } {
    // Detect mobile for responsive sizing
    const isMobile = document.body.classList.contains('is-mobile');

    const playerWrapper = container.createDiv();
    playerWrapper.addClass('social-audio-player');
    playerWrapper.addClass('sa-w-full');
    playerWrapper.addClass('sa-bg-secondary');
    playerWrapper.addClass('sa-border');
    playerWrapper.addClass('sa-flex-col');
    if (isMobile) {
      playerWrapper.addClass('sa-p-12');
      playerWrapper.addClass('sa-gap-14');
      playerWrapper.addClass('mgr-player-mobile');
    } else {
      playerWrapper.addClass('sa-p-14');
      playerWrapper.addClass('sa-gap-16');
      playerWrapper.addClass('sa-rounded-12');
    }

    // Hidden audio element
    const audio = playerWrapper.createEl('audio', {
      attr: {
        src: audioSrc,
        preload: 'metadata'
      }
    });
    audio.addClass('sa-hidden');

    // Register for exclusive playback (pause others when this plays)
    this.registerAudioElement(audio);

    // Top row: Cover art + info + play button
    const topRow = playerWrapper.createDiv();
    topRow.addClass('sa-flex-row');
    if (isMobile) {
      topRow.addClass('sa-gap-10');
    } else {
      topRow.addClass('sa-gap-12');
    }

    // Cover art / podcast icon (desktop: 48px, mobile: 40px)
    const coverSize = isMobile ? 40 : 48;
    const coverArt = topRow.createDiv();
    coverArt.addClass('audio-player-cover');
    coverArt.addClass('sa-flex-center');
    coverArt.addClass('sa-flex-shrink-0');
    coverArt.addClass('sa-overflow-hidden');
    coverArt.addClass('sa-border');
    coverArt.addClass('sa-dynamic-width');
    coverArt.addClass('sa-dynamic-height');
    coverArt.addClass('mgr-cover-art');
    coverArt.setCssProps({ '--sa-width': `${coverSize}px`, '--sa-height': `${coverSize}px` });
    if (isMobile) {
      coverArt.addClass('mgr-cover-art-mobile');
    } else {
      coverArt.addClass('mgr-cover-art-desktop');
    }

    // Try to use author avatar as cover
    const avatarUrl = post?.author?.avatar || post?.author?.localAvatar;
    const iconSize = isMobile ? 18 : 22;
    if (avatarUrl) {
      const coverImg = coverArt.createEl('img', {
        attr: {
          src: avatarUrl.startsWith('http') ? avatarUrl : this.getResourcePath(avatarUrl),
          alt: 'Cover'
        }
      });
      coverImg.addClass('sa-cover');
      coverImg.addEventListener('error', () => {
        coverImg.remove();
        // Neutral gradient for fallback (distinct from accent-colored play button)
        coverArt.removeClass('mgr-cover-art');
        coverArt.addClass('mgr-cover-art-fallback');
        const iconWrapper = coverArt.createDiv();
        iconWrapper.addClass('sa-flex-center');
        iconWrapper.addClass('sa-text-muted');
        iconWrapper.addClass('sa-dynamic-width');
        iconWrapper.addClass('sa-dynamic-height');
        iconWrapper.setCssProps({ '--sa-width': `${iconSize}px`, '--sa-height': `${iconSize}px` });
        setIcon(iconWrapper, 'podcast');
      });
    } else {
      // Neutral gradient for podcast icon (distinct from accent-colored play button)
      coverArt.removeClass('mgr-cover-art');
      coverArt.addClass('mgr-cover-art-fallback');
      const iconWrapper = coverArt.createDiv();
      iconWrapper.addClass('sa-flex-center');
      iconWrapper.addClass('sa-text-muted');
      iconWrapper.addClass('sa-dynamic-width');
      iconWrapper.addClass('sa-dynamic-height');
      iconWrapper.setCssProps({ '--sa-width': `${iconSize}px`, '--sa-height': `${iconSize}px` });
      setIcon(iconWrapper, 'podcast');
    }

    // Info section (title + author)
    const infoSection = topRow.createDiv();
    infoSection.addClass('sa-flex-1');
    infoSection.addClass('sa-overflow-hidden');

    const titleEl = infoSection.createDiv();
    titleEl.addClass('sa-font-semibold');
    titleEl.addClass('sa-text-normal');
    titleEl.addClass('sa-truncate');
    titleEl.addClass('sa-leading-tight');
    if (isMobile) {
      titleEl.addClass('sa-text-base');
    } else {
      titleEl.addClass('sa-text-md');
    }
    titleEl.setText(post?.title || 'Audio');

    const authorEl = infoSection.createDiv();
    authorEl.addClass('sa-text-muted');
    authorEl.addClass('sa-truncate');
    authorEl.addClass('sa-leading-tight');
    authorEl.addClass('sa-mt-2');
    if (isMobile) {
      authorEl.addClass('sa-text-xs');
    } else {
      authorEl.addClass('sa-text-sm');
    }
    authorEl.setText(post?.author?.name || '');

    // Play/Pause button (desktop: 40px, mobile: 36px)
    const btnSize = isMobile ? 36 : 40;
    const playIconSize = isMobile ? 18 : 20;
    const playBtn = topRow.createDiv();
    playBtn.addClass('audio-player-btn');
    playBtn.addClass('sa-flex-center');
    playBtn.addClass('sa-rounded-full');
    playBtn.addClass('sa-bg-accent');
    playBtn.addClass('sa-clickable');
    playBtn.addClass('sa-flex-shrink-0');
    playBtn.addClass('sa-transition');
    playBtn.addClass('sa-dynamic-width');
    playBtn.addClass('sa-dynamic-height');
    playBtn.addClass('mgr-play-btn');
    playBtn.setCssProps({ '--sa-width': `${btnSize}px`, '--sa-height': `${btnSize}px` });

    const playIcon = playBtn.createDiv();
    playIcon.addClass('sa-flex-center');
    playIcon.addClass('sa-dynamic-width');
    playIcon.addClass('sa-dynamic-height');
    playIcon.addClass('mgr-play-icon');
    playIcon.addClass('mgr-play-icon-offset');
    playIcon.setCssProps({ '--sa-width': `${playIconSize}px`, '--sa-height': `${playIconSize}px` });
    setIcon(playIcon, 'play');

    let isPlaying = false;

    const updatePlayButton = () => {
      playIcon.empty();
      // Play icon needs slight offset, pause icon is centered
      if (isPlaying) {
        playIcon.removeClass('mgr-play-icon-offset');
        playIcon.addClass('mgr-play-icon-center');
      } else {
        playIcon.removeClass('mgr-play-icon-center');
        playIcon.addClass('mgr-play-icon-offset');
      }
      setIcon(playIcon, isPlaying ? 'pause' : 'play');
    };

    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (audio.paused) {
        audio.play();
      } else {
        audio.pause();
      }
    });

    // Bottom row: Progress bar + time
    const bottomRow = playerWrapper.createDiv();
    bottomRow.addClass('sa-flex-row');
    if (isMobile) {
      bottomRow.addClass('sa-gap-8');
    } else {
      bottomRow.addClass('sa-gap-10');
    }

    // Current time
    const currentTimeEl = bottomRow.createDiv();
    currentTimeEl.addClass('audio-current-time');
    currentTimeEl.addClass('sa-text-muted');
    currentTimeEl.addClass('sa-text-right');
    currentTimeEl.addClass('sa-transition-color');
    currentTimeEl.addClass('sa-dynamic-width');
    currentTimeEl.addClass('mgr-time-display');
    if (isMobile) {
      currentTimeEl.addClass('mgr-time-mobile');
      currentTimeEl.setCssProps({ '--sa-width': '32px' });
    } else {
      currentTimeEl.addClass('sa-text-xs');
      currentTimeEl.setCssProps({ '--sa-width': '38px' });
    }
    currentTimeEl.setText('0:00');

    // Progress bar wrapper (for larger touch/click area)
    const progressWrapper = bottomRow.createDiv();
    progressWrapper.addClass('sa-flex-1');
    progressWrapper.addClass('sa-flex-row');
    progressWrapper.addClass('sa-clickable');
    progressWrapper.addClass('sa-relative');
    progressWrapper.addClass('sa-dynamic-height');
    progressWrapper.setCssProps({ '--sa-height': '20px' });

    // Progress bar container (the visible track)
    const progressContainer = progressWrapper.createDiv();
    progressContainer.addClass('sa-w-full');
    progressContainer.addClass('sa-relative');
    progressContainer.addClass('sa-dynamic-height');
    progressContainer.addClass('mgr-progress-track');
    progressContainer.setCssProps({ '--sa-height': '4px' });

    // Buffered indicator (rendered first, behind progress)
    const bufferedFill = progressContainer.createDiv();
    bufferedFill.addClass('sa-absolute');
    bufferedFill.addClass('sa-top-0');
    bufferedFill.addClass('sa-left-0');
    bufferedFill.addClass('sa-h-full');
    bufferedFill.addClass('sa-dynamic-width');
    bufferedFill.addClass('mgr-buffered-fill');
    bufferedFill.setCssProps({ '--sa-width': '0%' });

    // Progress fill (on top of buffered)
    const progressFill = progressContainer.createDiv();
    progressFill.addClass('sa-absolute');
    progressFill.addClass('sa-top-0');
    progressFill.addClass('sa-left-0');
    progressFill.addClass('sa-h-full');
    progressFill.addClass('sa-dynamic-width');
    progressFill.addClass('mgr-progress-fill');
    progressFill.setCssProps({ '--sa-width': '0%' });

    // Thumb indicator
    const thumbSize = isMobile ? 12 : 14;
    const thumb = progressContainer.createDiv();
    thumb.addClass('sa-absolute');
    thumb.addClass('sa-rounded-full');
    thumb.addClass('sa-bg-accent');
    thumb.addClass('sa-opacity-0');
    thumb.addClass('sa-pointer-none');
    thumb.addClass('sa-dynamic-width');
    thumb.addClass('sa-dynamic-height');
    thumb.addClass('mgr-thumb');
    thumb.setCssProps({ '--sa-width': `${thumbSize}px`, '--sa-height': `${thumbSize}px` });

    // Hover effects for progress bar
    let isHoveringProgress = false;
    progressWrapper.addEventListener('mouseenter', () => {
      isHoveringProgress = true;
      progressContainer.setCssProps({ '--sa-height': '6px' });
      thumb.removeClass('sa-opacity-0');
      thumb.addClass('sa-opacity-100');
    });
    progressWrapper.addEventListener('mouseleave', () => {
      isHoveringProgress = false;
      progressContainer.setCssProps({ '--sa-height': '4px' });
      if (!isPlaying) {
        thumb.removeClass('sa-opacity-100');
        thumb.addClass('sa-opacity-0');
      }
    });

    // Duration
    const durationEl = bottomRow.createDiv();
    durationEl.addClass('sa-text-faint');
    durationEl.addClass('sa-dynamic-width');
    durationEl.addClass('mgr-time-display');
    if (isMobile) {
      durationEl.addClass('mgr-time-mobile');
      durationEl.setCssProps({ '--sa-width': '32px' });
    } else {
      durationEl.addClass('sa-text-xs');
      durationEl.setCssProps({ '--sa-width': '38px' });
    }
    durationEl.setText('--:--');

    // Playback speed button
    const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    let currentSpeedIndex = 2; // Default: 1x

    const speedBtn = bottomRow.createDiv();
    speedBtn.addClass('audio-speed-btn');
    speedBtn.addClass('sa-rounded-4');
    speedBtn.addClass('sa-clickable');
    speedBtn.addClass('sa-no-select');
    speedBtn.addClass('sa-transition');
    speedBtn.addClass('sa-font-medium');
    speedBtn.addClass('sa-text-center');
    speedBtn.addClass('sa-dynamic-width');
    speedBtn.addClass('mgr-speed-btn');
    speedBtn.addClass('mgr-speed-default');
    if (isMobile) {
      speedBtn.addClass('mgr-time-mobile');
      speedBtn.setCssProps({ '--sa-width': '32px' });
    } else {
      speedBtn.addClass('sa-text-xs');
      speedBtn.setCssProps({ '--sa-width': '36px' });
    }
    speedBtn.setText('1x');

    speedBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      currentSpeedIndex = (currentSpeedIndex + 1) % speedOptions.length;
      const newSpeed = speedOptions[currentSpeedIndex];
      if (newSpeed !== undefined) {
        audio.playbackRate = newSpeed;
        speedBtn.setText(newSpeed === 1 ? '1x' : `${newSpeed}x`);
        // Highlight when not 1x
        if (newSpeed === 1) {
          speedBtn.removeClass('mgr-speed-active');
          speedBtn.addClass('mgr-speed-default');
        } else {
          speedBtn.removeClass('mgr-speed-default');
          speedBtn.addClass('mgr-speed-active');
        }
      }
    });

    speedBtn.addEventListener('mouseenter', () => {
      speedBtn.addClass('mgr-speed-active');
    });
    speedBtn.addEventListener('mouseleave', () => {
      const currentSpeed = speedOptions[currentSpeedIndex];
      if (currentSpeed === 1) {
        speedBtn.removeClass('mgr-speed-active');
        speedBtn.addClass('mgr-speed-default');
      }
    });

    // Progress bar click handler
    progressWrapper.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = progressContainer.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      if (audio.duration && isFinite(audio.duration)) {
        audio.currentTime = percent * audio.duration;
      }
    });

    // Update thumb position
    const updateThumbPosition = (percent: number) => {
      thumb.setCssStyles({ left: `${percent}%` });
    };

    // Audio event listeners
    audio.addEventListener('loadedmetadata', () => {
      if (audio.duration && isFinite(audio.duration)) {
        durationEl.setText(this.formatTime(audio.duration));
      }
    });

    audio.addEventListener('timeupdate', () => {
      if (audio.duration && isFinite(audio.duration)) {
        const percent = (audio.currentTime / audio.duration) * 100;
        progressFill.setCssProps({ '--sa-width': `${percent}%` });
        updateThumbPosition(percent);
        currentTimeEl.setText(this.formatTime(audio.currentTime));
      }
    });

    audio.addEventListener('progress', () => {
      if (audio.buffered.length > 0 && audio.duration && isFinite(audio.duration)) {
        const bufferedEnd = audio.buffered.end(audio.buffered.length - 1);
        const percent = (bufferedEnd / audio.duration) * 100;
        bufferedFill.setCssProps({ '--sa-width': `${percent}%` });
      }
    });

    audio.addEventListener('play', () => {
      isPlaying = true;
      updatePlayButton();
      // Show thumb and highlight current time when playing
      thumb.removeClass('sa-opacity-0');
      thumb.addClass('sa-opacity-100');
      currentTimeEl.removeClass('sa-text-muted');
      currentTimeEl.addClass('sa-text-accent');
    });

    audio.addEventListener('pause', () => {
      isPlaying = false;
      updatePlayButton();
      // Hide thumb unless hovering, reset current time color
      if (!isHoveringProgress) {
        thumb.removeClass('sa-opacity-100');
        thumb.addClass('sa-opacity-0');
      }
      currentTimeEl.removeClass('sa-text-accent');
      currentTimeEl.addClass('sa-text-muted');
    });

    audio.addEventListener('ended', () => {
      isPlaying = false;
      updatePlayButton();
      audio.currentTime = 0;
      // Reset UI state
      progressFill.setCssProps({ '--sa-width': '0%' });
      updateThumbPosition(0);
      if (!isHoveringProgress) {
        thumb.removeClass('sa-opacity-100');
        thumb.addClass('sa-opacity-0');
      }
      currentTimeEl.removeClass('sa-text-accent');
      currentTimeEl.addClass('sa-text-muted');
      currentTimeEl.setText('0:00');
    });

    audio.addEventListener('error', () => {
      titleEl.setText('Error loading audio');
      titleEl.removeClass('sa-text-normal');
      titleEl.addClass('sa-text-error');
      playBtn.addClass('sa-opacity-50');
      playBtn.addClass('mgr-disabled');
      playBtn.addClass('sa-pointer-none');
    });

    return { wrapper: playerWrapper, audio };
  }

  /**
   * Render media carousel with Instagram-style thumbnails
   * Returns the audio element if an audio player was rendered, null otherwise
   */
  render(container: HTMLElement, media: Media[], post?: PostData): HTMLAudioElement | null {
    // Track the audio element if one is created
    let renderedAudioElement: HTMLAudioElement | null = null;
    const carouselContainer = container.createDiv({
      cls: 'relative mt-2 rounded-lg overflow-hidden'
    });

    // Extract links from post content if available
    let extractedLink: string | null = null;
    if (post && media.length === 1) {
      const content = post.content.text;
      // Extract all URLs (markdown links and plain URLs)
      const markdownLinks = [...content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map(m => m[2]);
      const plainUrls = [...content.matchAll(/(https?:\/\/[^\s]+)/g)].map(m => m[1]);
      const allLinks = [...markdownLinks, ...plainUrls];

      // If exactly one link exists, use it for the image click
      if (allLinks.length === 1 && allLinks[0]) {
        extractedLink = allLinks[0];
      }
    }

    // Media container - will be sized based on currently visible content
    // Check if all media is audio for reduced min-height
    const isAudioOnly = media.every(m => m.type === 'audio' || isAudioUrl(m.url));
    const mediaContainer = carouselContainer.createDiv();
    mediaContainer.addClass('sa-relative');
    mediaContainer.addClass('sa-w-full');
    mediaContainer.addClass('sa-flex-center');
    mediaContainer.addClass('sa-bg-transparent');
    mediaContainer.addClass('mgr-media-container');
    if (isAudioOnly) {
      mediaContainer.addClass('mgr-media-container-audio');
    }

    let currentIndex = 0;
    let maxRenderedHeight = 0;

    const updateContainerHeight = (element?: HTMLElement) => {
      if (!element) return;
      requestAnimationFrame(() => {
        const renderedHeight = element.clientHeight || element.offsetHeight;
        if (renderedHeight > 0) {
          maxRenderedHeight = Math.max(maxRenderedHeight, renderedHeight);
          mediaContainer.setCssStyles({ height: `${maxRenderedHeight}px` });
        }
      });
    };

    // Create media elements lazily - only the first item is created immediately,
    // subsequent items are created on-demand when navigated to (saves CPU/memory/network)
    const mediaElements: (HTMLElement | null)[] = new Array(media.length).fill(null);

    const createMediaElement = (i: number): HTMLElement | null => {
      const mediaItem = media[i];
      if (!mediaItem) return null;

      const resourcePath = this.getResourcePath(mediaItem.url);
      const isVideo = mediaItem.type === 'video' || isVideoUrl(mediaItem.url);
      const isAudioMedia = mediaItem.type === 'audio' || isAudioUrl(mediaItem.url);

      let element: HTMLElement;

      if (isAudioMedia) {
        const { wrapper: audioWrapper, audio } = this.renderAudioPlayer(mediaContainer, resourcePath, post);
        if (i === currentIndex) {
          audioWrapper.addClass('sa-flex');
        } else {
          audioWrapper.addClass('sa-hidden');
        }

        if (i === 0) {
          renderedAudioElement = audio;
        }

        requestAnimationFrame(() => {
          updateContainerHeight(audioWrapper);
        });

        element = audioWrapper;
      } else if (isVideo) {
        const video = mediaContainer.createEl('video', {
          attr: {
            src: resourcePath,
            controls: true,
            preload: 'metadata',
            loading: 'lazy',
            playsinline: 'true',
            'webkit-playsinline': 'true'
          }
        });

        video.addClass('sa-max-w-full');
        video.addClass('sa-object-contain');
        video.addClass('mgr-media-item');
        if (i === currentIndex) {
          video.addClass('sa-block');
        } else {
          video.addClass('sa-hidden');
        }

        video.addEventListener('error', () => {
          video.remove();
        });

        video.addEventListener('loadedmetadata', () => {
          updateContainerHeight(video);
        });

        if (video.readyState >= 1) {
          updateContainerHeight(video);
        }

        element = video;
      } else {
        const img = mediaContainer.createEl('img', {
          attr: {
            src: resourcePath,
            alt: mediaItem.altText || `Image ${i + 1}`,
            loading: 'lazy'
          }
        });

        img.addClass('sa-max-w-full');
        img.addClass('sa-object-contain');
        img.addClass('mgr-media-item');
        if (i === currentIndex) {
          img.addClass('sa-block');
        } else {
          img.addClass('sa-hidden');
        }

        img.addEventListener('error', () => {
          img.remove();
        });

        img.addEventListener('load', () => {
          updateContainerHeight(img);
        });

        if (img.complete) {
          updateContainerHeight(img);
        }

        if (extractedLink && media.length === 1) {
          img.addClass('sa-clickable');
          img.setAttribute('title', `Open link: ${extractedLink}`);
          img.addEventListener('click', (e) => {
            e.stopPropagation();
            window.open(extractedLink, '_blank');
          });
        }

        element = img;
      }

      mediaElements[i] = element;
      return element;
    };

    // Only create the first (visible) media element immediately
    createMediaElement(0);

    // Navigation functions (defined outside to be accessible everywhere)
    const showMedia = (index: number) => {
      // Lazily create the target element if it hasn't been created yet
      if (!mediaElements[index]) {
        createMediaElement(index);
      }

      for (let i = 0; i < mediaElements.length; i++) {
        const element = mediaElements[i];
        if (!element) continue; // Skip uncreated elements (not in DOM)

        // Audio player uses flex display, others use block
        const isAudioPlayer = element.classList.contains('social-audio-player');
        if (i === index) {
          element.removeClass('sa-hidden');
          if (isAudioPlayer) {
            element.addClass('sa-flex');
          } else {
            element.addClass('sa-block');
          }
        } else {
          element.removeClass('sa-flex');
          element.removeClass('sa-block');
          element.addClass('sa-hidden');
        }
        // Pause videos and audio when hidden
        if (element instanceof HTMLVideoElement) {
          if (i !== index) {
            element.pause();
          }
        }
        // Handle audio inside wrapper div
        const audioEl = element.querySelector('audio');
        if (audioEl instanceof HTMLAudioElement && i !== index) {
          audioEl.pause();
        }
      }

      currentIndex = index;

      // Update container height based on current element
      const currentElement = mediaElements[index];
      if (currentElement) {
        updateContainerHeight(currentElement);
      }

      // Update counter if it exists
      if (media.length > 1) {
        const counter = carouselContainer.querySelector('.media-counter') as HTMLElement;
        if (counter) {
          counter.setText(`${index + 1}/${media.length}`);
        }

        // Update thumbnail active state if they exist
        const thumbnails = carouselContainer.querySelectorAll('.media-thumbnail');
        thumbnails.forEach((thumb, i) => {
          const thumbEl = thumb as HTMLElement;
          thumbEl.toggleClass('mgr-thumbnail-active', i === index);
        });
      }
    };

    // Navigation buttons (always shown on hover if multiple media)
    if (media.length > 1) {
      // Left navigation button (subtle, hover-only)
      const leftBtn = mediaContainer.createDiv();
      leftBtn.addClass('sa-absolute');
      leftBtn.addClass('sa-flex-center');
      leftBtn.addClass('sa-rounded-full');
      leftBtn.addClass('sa-clickable');
      leftBtn.addClass('sa-z-10');
      leftBtn.addClass('sa-opacity-0');
      leftBtn.addClass('sa-transition');
      leftBtn.addClass('mgr-nav-btn');
      leftBtn.addClass('mgr-nav-btn-left');
      const leftIcon = leftBtn.createDiv();
      leftIcon.addClass('sa-icon-16');
      leftIcon.addClass('mgr-nav-icon');
      setIcon(leftIcon, 'chevron-left');

      leftBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newIndex = currentIndex > 0 ? currentIndex - 1 : media.length - 1;
        showMedia(newIndex);
      });

      // Right navigation button (subtle, hover-only)
      const rightBtn = mediaContainer.createDiv();
      rightBtn.addClass('sa-absolute');
      rightBtn.addClass('sa-flex-center');
      rightBtn.addClass('sa-rounded-full');
      rightBtn.addClass('sa-clickable');
      rightBtn.addClass('sa-z-10');
      rightBtn.addClass('sa-opacity-0');
      rightBtn.addClass('sa-transition');
      rightBtn.addClass('mgr-nav-btn');
      rightBtn.addClass('mgr-nav-btn-right');
      const rightIcon = rightBtn.createDiv();
      rightIcon.addClass('sa-icon-16');
      rightIcon.addClass('mgr-nav-icon');
      setIcon(rightIcon, 'chevron-right');

      rightBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newIndex = currentIndex < media.length - 1 ? currentIndex + 1 : 0;
        showMedia(newIndex);
      });

      // Show buttons on media container hover
      mediaContainer.addEventListener('mouseenter', () => {
        leftBtn.removeClass('sa-opacity-0');
        leftBtn.addClass('sa-opacity-100');
        rightBtn.removeClass('sa-opacity-0');
        rightBtn.addClass('sa-opacity-100');
      });

      mediaContainer.addEventListener('mouseleave', () => {
        leftBtn.removeClass('sa-opacity-100');
        leftBtn.addClass('sa-opacity-0');
        rightBtn.removeClass('sa-opacity-100');
        rightBtn.addClass('sa-opacity-0');
      });

      // Keyboard navigation
      mediaContainer.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') {
          e.stopPropagation();
          const newIndex = currentIndex > 0 ? currentIndex - 1 : media.length - 1;
          showMedia(newIndex);
        } else if (e.key === 'ArrowRight') {
          e.stopPropagation();
          const newIndex = currentIndex < media.length - 1 ? currentIndex + 1 : 0;
          showMedia(newIndex);
        }
      });
    }

    // Thumbnail navigation (Instagram style)
    if (media.length > 1) {
      // Thumbnails container
      const thumbnailsContainer = carouselContainer.createDiv();
      thumbnailsContainer.addClass('sa-flex');
      thumbnailsContainer.addClass('sa-gap-8');
      thumbnailsContainer.addClass('sa-p-12');
      thumbnailsContainer.addClass('sa-scrollbar-thin');
      thumbnailsContainer.addClass('mgr-thumbnails-container');

      // Add webkit scrollbar styles
      thumbnailsContainer.addClass('media-thumbnails-scroll');

      // Convert vertical wheel scroll to horizontal scroll (only when content overflows)
      thumbnailsContainer.addEventListener('wheel', (e) => {
        if (thumbnailsContainer.scrollWidth > thumbnailsContainer.clientWidth) {
          e.preventDefault();
          thumbnailsContainer.scrollLeft += e.deltaY;
        }
      }, { passive: false });

      // Create thumbnails
      for (let i = 0; i < media.length; i++) {
        const mediaItem = media[i];
        if (!mediaItem) continue; // Skip if undefined

        const resourcePath = this.getResourcePath(mediaItem.url);
        const isVideo = mediaItem.type === 'video' || mediaItem.url.endsWith('.mp4');

        const thumbnail = thumbnailsContainer.createDiv();
        thumbnail.addClass('media-thumbnail');
        thumbnail.addClass('sa-relative');
        thumbnail.addClass('sa-flex-shrink-0');
        thumbnail.addClass('sa-rounded-4');
        thumbnail.addClass('sa-overflow-hidden');
        thumbnail.addClass('sa-clickable');
        thumbnail.addClass('sa-transition');
        thumbnail.addClass('mgr-thumbnail');

        if (isVideo) {
          // Video thumbnail - show play icon overlay
          const videoThumb = thumbnail.createEl('video', {
            attr: {
              src: resourcePath,
              preload: 'metadata'
            }
          });
          videoThumb.addClass('sa-cover');

          // Minimal play icon overlay
          const playOverlay = thumbnail.createDiv();
          playOverlay.addClass('video-play-overlay');
          playOverlay.addClass('sa-absolute');
          playOverlay.addClass('sa-flex-center');
          playOverlay.addClass('sa-rounded-full');
          playOverlay.addClass('sa-clickable');
          playOverlay.addClass('sa-transition');
          playOverlay.addClass('mgr-video-overlay');

          // Play icon (smaller, more subtle)
          const playIcon = playOverlay.createDiv();
          playIcon.addClass('sa-icon-16');
          playIcon.addClass('mgr-video-overlay-icon');
          setIcon(playIcon, 'play');
        } else {
          // Image thumbnail
          const imgThumb = thumbnail.createEl('img', {
            attr: {
              src: resourcePath,
              alt: `Thumbnail ${i + 1}`,
              loading: 'lazy'
            }
          });
          imgThumb.addClass('sa-cover');
        }

        // Click to navigate
        thumbnail.addEventListener('click', (e) => {
          e.stopPropagation();
          showMedia(i);
        });

        // Active state
        if (i === 0) {
          thumbnail.addClass('mgr-thumbnail-active');
        }
      }

      // Counter indicator (bottom-right, above thumbnails)
      const counter = carouselContainer.createDiv();
      counter.addClass('media-counter');
      counter.addClass('sa-absolute');
      counter.addClass('sa-z-10');
      counter.addClass('sa-rounded-4');
      counter.addClass('sa-text-xs');
      counter.addClass('sa-font-medium');
      counter.addClass('mgr-counter');
      counter.setText(`1/${media.length}`);
    }

    return renderedAudioElement;
  }

  /**
   * Render media gallery with optional transcript section
   * Use this for podcast posts that may have Whisper transcripts
   */
  renderWithTranscript(
    container: HTMLElement,
    media: Media[],
    post: PostData
  ): void {
    // Render media gallery first and capture the audio element locally
    // This prevents issues when multiple posts render simultaneously
    const audioElement = this.render(container, media, post);

    // Check if post has Whisper transcript
    const whisperTranscript = post.whisperTranscript;
    if (whisperTranscript?.segments && whisperTranscript.segments.length > 0) {
      // Create transcript container below media
      const transcriptContainer = container.createDiv({ cls: 'podcast-transcript-container' });
      transcriptContainer.addClass('sa-mt-8');

      // Create new transcript renderer for this post (each post gets its own instance)
      const transcriptRenderer = new TranscriptRenderer();
      this.transcriptRenderers.push(transcriptRenderer);

      transcriptRenderer.render(transcriptContainer, {
        segments: whisperTranscript.segments as TranscriptionSegment[],
        language: whisperTranscript.language,
        audioElement: audioElement,
        startCollapsed: true,
        // Note: TranscriptRenderer handles seek/play via audioElement directly
        // No need for onTimestampClick callback to avoid duplicate play()
      });
    }
  }

  /**
   * Cleanup all transcript renderer resources
   */
  destroyTranscript(): void {
    for (const renderer of this.transcriptRenderers) {
      renderer.destroy();
    }
    this.transcriptRenderers = [];
  }
}
