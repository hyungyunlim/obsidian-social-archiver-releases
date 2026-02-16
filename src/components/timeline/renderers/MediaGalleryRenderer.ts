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
    playerWrapper.style.cssText = `
      width: 100%;
      padding: ${isMobile ? '12px' : '14px'};
      background: var(--background-secondary);
      border: 1px solid var(--background-modifier-border);
      border-radius: ${isMobile ? '10px' : '12px'};
      display: flex;
      flex-direction: column;
      gap: ${isMobile ? '14px' : '16px'};
    `;

    // Hidden audio element
    const audio = playerWrapper.createEl('audio', {
      attr: {
        src: audioSrc,
        preload: 'metadata'
      }
    });
    audio.style.display = 'none';

    // Register for exclusive playback (pause others when this plays)
    this.registerAudioElement(audio);

    // Top row: Cover art + info + play button
    const topRow = playerWrapper.createDiv();
    topRow.style.cssText = `display: flex; align-items: center; gap: ${isMobile ? '10px' : '12px'};`;

    // Cover art / podcast icon (desktop: 48px, mobile: 40px)
    const coverSize = isMobile ? 40 : 48;
    const coverArt = topRow.createDiv();
    coverArt.addClass('audio-player-cover');
    coverArt.style.cssText = `
      width: ${coverSize}px;
      height: ${coverSize}px;
      border-radius: ${isMobile ? '8px' : '10px'};
      background: linear-gradient(135deg, var(--background-modifier-border) 0%, var(--background-primary) 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.05);
      border: 1px solid var(--background-modifier-border);
    `;

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
      coverImg.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
      coverImg.addEventListener('error', () => {
        coverImg.remove();
        // Neutral gradient for fallback (distinct from accent-colored play button)
        coverArt.style.background = 'linear-gradient(135deg, var(--background-modifier-border-hover) 0%, var(--background-modifier-border) 100%)';
        const iconWrapper = coverArt.createDiv();
        iconWrapper.style.cssText = `width: ${iconSize}px; height: ${iconSize}px; color: var(--text-muted); display: flex; align-items: center; justify-content: center;`;
        setIcon(iconWrapper, 'podcast');
      });
    } else {
      // Neutral gradient for podcast icon (distinct from accent-colored play button)
      coverArt.style.background = 'linear-gradient(135deg, var(--background-modifier-border-hover) 0%, var(--background-modifier-border) 100%)';
      const iconWrapper = coverArt.createDiv();
      iconWrapper.style.cssText = `width: ${iconSize}px; height: ${iconSize}px; color: var(--text-muted); display: flex; align-items: center; justify-content: center;`;
      setIcon(iconWrapper, 'podcast');
    }

    // Info section (title + author)
    const infoSection = topRow.createDiv();
    infoSection.style.cssText = 'flex: 1; min-width: 0; overflow: hidden;';

    const titleEl = infoSection.createDiv();
    titleEl.style.cssText = `
      font-size: ${isMobile ? '13px' : '14px'};
      font-weight: 600;
      color: var(--text-normal);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.3;
    `;
    titleEl.setText(post?.title || 'Audio');

    const authorEl = infoSection.createDiv();
    authorEl.style.cssText = `
      font-size: ${isMobile ? '11px' : '12px'};
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 2px;
      line-height: 1.3;
    `;
    authorEl.setText(post?.author?.name || '');

    // Play/Pause button (desktop: 40px, mobile: 36px)
    const btnSize = isMobile ? 36 : 40;
    const playIconSize = isMobile ? 18 : 20;
    const playBtn = topRow.createDiv();
    playBtn.addClass('audio-player-btn');
    playBtn.style.cssText = `
      width: ${btnSize}px;
      height: ${btnSize}px;
      border-radius: 50%;
      background: var(--interactive-accent);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      flex-shrink: 0;
      transition: all 0.2s ease;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    `;

    const playIcon = playBtn.createDiv();
    playIcon.style.cssText = `width: ${playIconSize}px; height: ${playIconSize}px; color: var(--text-on-accent); display: flex; align-items: center; justify-content: center;`;
    setIcon(playIcon, 'play');
    // Offset play icon slightly for optical centering (play triangles appear left-heavy)
    playIcon.style.transform = 'translateX(1px)';

    let isPlaying = false;

    const updatePlayButton = () => {
      playIcon.empty();
      // Play icon needs slight offset, pause icon is centered
      playIcon.style.transform = isPlaying ? 'translateX(0)' : 'translateX(1px)';
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

    playBtn.addEventListener('mouseenter', () => {
      playBtn.style.transform = 'scale(1.08)';
      playBtn.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
    });

    playBtn.addEventListener('mouseleave', () => {
      playBtn.style.transform = 'scale(1)';
      playBtn.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
    });

    // Bottom row: Progress bar + time
    const bottomRow = playerWrapper.createDiv();
    bottomRow.style.cssText = `display: flex; align-items: center; gap: ${isMobile ? '8px' : '10px'};`;

    // Current time
    const currentTimeEl = bottomRow.createDiv();
    currentTimeEl.addClass('audio-current-time');
    currentTimeEl.style.cssText = `font-size: ${isMobile ? '10px' : '11px'}; color: var(--text-muted); min-width: ${isMobile ? '32px' : '38px'}; text-align: right; font-variant-numeric: tabular-nums; transition: color 0.2s ease;`;
    currentTimeEl.setText('0:00');

    // Progress bar wrapper (for larger touch/click area)
    const progressWrapper = bottomRow.createDiv();
    progressWrapper.style.cssText = `
      flex: 1;
      height: 20px;
      display: flex;
      align-items: center;
      cursor: pointer;
      position: relative;
    `;

    // Progress bar container (the visible track)
    const progressContainer = progressWrapper.createDiv();
    progressContainer.style.cssText = `
      width: 100%;
      height: 4px;
      background: var(--background-modifier-border);
      border-radius: 2px;
      position: relative;
      overflow: visible;
      transition: height 0.15s ease;
    `;

    // Buffered indicator (rendered first, behind progress)
    const bufferedFill = progressContainer.createDiv();
    bufferedFill.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      width: 0%;
      background: var(--background-modifier-border-hover);
      border-radius: 2px;
    `;

    // Progress fill (on top of buffered)
    const progressFill = progressContainer.createDiv();
    progressFill.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      width: 0%;
      background: var(--interactive-accent);
      border-radius: 2px;
      transition: width 0.1s linear;
    `;

    // Thumb indicator
    const thumbSize = isMobile ? 12 : 14;
    const thumb = progressContainer.createDiv();
    thumb.style.cssText = `
      position: absolute;
      top: 50%;
      left: 0%;
      width: ${thumbSize}px;
      height: ${thumbSize}px;
      background: var(--interactive-accent);
      border: 2px solid var(--background-primary);
      border-radius: 50%;
      transform: translate(-50%, -50%);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
      opacity: 0;
      transition: opacity 0.15s ease, transform 0.15s ease;
      pointer-events: none;
    `;

    // Hover effects for progress bar
    let isHoveringProgress = false;
    progressWrapper.addEventListener('mouseenter', () => {
      isHoveringProgress = true;
      progressContainer.style.height = '6px';
      thumb.style.opacity = '1';
    });
    progressWrapper.addEventListener('mouseleave', () => {
      isHoveringProgress = false;
      progressContainer.style.height = '4px';
      if (!isPlaying) {
        thumb.style.opacity = '0';
      }
    });

    // Duration
    const durationEl = bottomRow.createDiv();
    durationEl.style.cssText = `font-size: ${isMobile ? '10px' : '11px'}; color: var(--text-faint); min-width: ${isMobile ? '32px' : '38px'}; font-variant-numeric: tabular-nums;`;
    durationEl.setText('--:--');

    // Playback speed button
    const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    let currentSpeedIndex = 2; // Default: 1x

    const speedBtn = bottomRow.createDiv();
    speedBtn.addClass('audio-speed-btn');
    speedBtn.style.cssText = `
      font-size: ${isMobile ? '10px' : '11px'};
      color: var(--text-muted);
      padding: 2px 6px;
      border-radius: 4px;
      cursor: pointer;
      user-select: none;
      transition: all 0.15s ease;
      background: transparent;
      font-weight: 500;
      min-width: ${isMobile ? '32px' : '36px'};
      text-align: center;
    `;
    speedBtn.setText('1x');

    speedBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      currentSpeedIndex = (currentSpeedIndex + 1) % speedOptions.length;
      const newSpeed = speedOptions[currentSpeedIndex];
      if (newSpeed !== undefined) {
        audio.playbackRate = newSpeed;
        speedBtn.setText(newSpeed === 1 ? '1x' : `${newSpeed}x`);
        // Highlight when not 1x
        speedBtn.style.color = newSpeed === 1 ? 'var(--text-muted)' : 'var(--interactive-accent)';
        speedBtn.style.background = newSpeed === 1 ? 'transparent' : 'var(--background-modifier-hover)';
      }
    });

    speedBtn.addEventListener('mouseenter', () => {
      speedBtn.style.background = 'var(--background-modifier-hover)';
    });
    speedBtn.addEventListener('mouseleave', () => {
      const currentSpeed = speedOptions[currentSpeedIndex];
      speedBtn.style.background = currentSpeed === 1 ? 'transparent' : 'var(--background-modifier-hover)';
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
      thumb.style.left = `${percent}%`;
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
        progressFill.style.width = `${percent}%`;
        updateThumbPosition(percent);
        currentTimeEl.setText(this.formatTime(audio.currentTime));
      }
    });

    audio.addEventListener('progress', () => {
      if (audio.buffered.length > 0 && audio.duration && isFinite(audio.duration)) {
        const bufferedEnd = audio.buffered.end(audio.buffered.length - 1);
        const percent = (bufferedEnd / audio.duration) * 100;
        bufferedFill.style.width = `${percent}%`;
      }
    });

    audio.addEventListener('play', () => {
      isPlaying = true;
      updatePlayButton();
      // Show thumb and highlight current time when playing
      thumb.style.opacity = '1';
      currentTimeEl.style.color = 'var(--interactive-accent)';
    });

    audio.addEventListener('pause', () => {
      isPlaying = false;
      updatePlayButton();
      // Hide thumb unless hovering, reset current time color
      if (!isHoveringProgress) {
        thumb.style.opacity = '0';
      }
      currentTimeEl.style.color = 'var(--text-muted)';
    });

    audio.addEventListener('ended', () => {
      isPlaying = false;
      updatePlayButton();
      audio.currentTime = 0;
      // Reset UI state
      progressFill.style.width = '0%';
      updateThumbPosition(0);
      if (!isHoveringProgress) {
        thumb.style.opacity = '0';
      }
      currentTimeEl.style.color = 'var(--text-muted)';
      currentTimeEl.setText('0:00');
    });

    audio.addEventListener('error', () => {
      titleEl.setText('Error loading audio');
      titleEl.style.color = 'var(--text-error)';
      playBtn.style.opacity = '0.5';
      playBtn.style.cursor = 'not-allowed';
      playBtn.style.pointerEvents = 'none';
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
    mediaContainer.style.cssText = `position: relative; width: 100%; min-height: ${isAudioOnly ? '80px' : '200px'}; max-height: 600px; display: flex; align-items: center; justify-content: center; background: transparent; transition: height 0.3s ease;`;

    let currentIndex = 0;
    let maxRenderedHeight = 0;

    const updateContainerHeight = (element?: HTMLElement) => {
      if (!element) return;
      requestAnimationFrame(() => {
        const renderedHeight = element.clientHeight || element.offsetHeight;
        if (renderedHeight > 0) {
          maxRenderedHeight = Math.max(maxRenderedHeight, renderedHeight);
          mediaContainer.style.height = `${maxRenderedHeight}px`;
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
        audioWrapper.style.display = i === currentIndex ? 'flex' : 'none';

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

        video.style.cssText = 'max-width: 100%; max-height: 600px; width: auto; height: auto; object-fit: contain;';
        video.style.display = i === currentIndex ? 'block' : 'none';

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

        img.style.cssText = 'max-width: 100%; max-height: 600px; width: auto; height: auto; object-fit: contain;';
        img.style.display = i === currentIndex ? 'block' : 'none';

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
          img.style.cursor = 'pointer';
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
          element.style.display = isAudioPlayer ? 'flex' : 'block';
        } else {
          element.style.display = 'none';
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
          (thumb as HTMLElement).style.borderColor = i === index ? 'var(--interactive-accent)' : 'transparent';
        });
      }
    };

    // Navigation buttons (always shown on hover if multiple media)
    if (media.length > 1) {
      // Left navigation button (subtle, hover-only)
      const leftBtn = mediaContainer.createDiv();
      leftBtn.style.cssText = 'position: absolute; left: 12px; top: 50%; transform: translateY(-50%); width: 32px; height: 32px; border-radius: 50%; background: rgba(0, 0, 0, 0.5); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 10; opacity: 0; transition: opacity 0.2s ease, background 0.2s ease;';
      const leftIcon = leftBtn.createDiv();
      leftIcon.style.cssText = 'width: 16px; height: 16px; color: white;';
      setIcon(leftIcon, 'chevron-left');

      leftBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newIndex = currentIndex > 0 ? currentIndex - 1 : media.length - 1;
        showMedia(newIndex);
      });

      leftBtn.addEventListener('mouseenter', () => {
        leftBtn.style.background = 'rgba(0, 0, 0, 0.6)';
      });

      leftBtn.addEventListener('mouseleave', () => {
        leftBtn.style.background = 'rgba(0, 0, 0, 0.4)';
      });

      // Right navigation button (subtle, hover-only)
      const rightBtn = mediaContainer.createDiv();
      rightBtn.style.cssText = 'position: absolute; right: 12px; top: 50%; transform: translateY(-50%); width: 32px; height: 32px; border-radius: 50%; background: rgba(0, 0, 0, 0.5); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 10; opacity: 0; transition: opacity 0.2s ease, background 0.2s ease;';
      const rightIcon = rightBtn.createDiv();
      rightIcon.style.cssText = 'width: 16px; height: 16px; color: white;';
      setIcon(rightIcon, 'chevron-right');

      rightBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newIndex = currentIndex < media.length - 1 ? currentIndex + 1 : 0;
        showMedia(newIndex);
      });

      rightBtn.addEventListener('mouseenter', () => {
        rightBtn.style.background = 'rgba(0, 0, 0, 0.6)';
      });

      rightBtn.addEventListener('mouseleave', () => {
        rightBtn.style.background = 'rgba(0, 0, 0, 0.4)';
      });

      // Show buttons on media container hover
      mediaContainer.addEventListener('mouseenter', () => {
        leftBtn.style.opacity = '1';
        rightBtn.style.opacity = '1';
      });

      mediaContainer.addEventListener('mouseleave', () => {
        leftBtn.style.opacity = '0';
        rightBtn.style.opacity = '0';
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
      thumbnailsContainer.style.cssText = 'display: flex; gap: 8px; padding: 12px; overflow-x: auto; background: rgba(0, 0, 0, 0.02); scrollbar-width: thin; scrollbar-color: var(--background-modifier-border) transparent;';

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
        thumbnail.style.cssText = 'position: relative; width: 60px; height: 60px; flex-shrink: 0; border-radius: 4px; overflow: hidden; cursor: pointer; border: 2px solid transparent; transition: all 0.2s;';

        if (isVideo) {
          // Video thumbnail - show play icon overlay
          const videoThumb = thumbnail.createEl('video', {
            attr: {
              src: resourcePath,
              preload: 'metadata'
            }
          });
          videoThumb.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';

          // Minimal play icon overlay
          const playOverlay = thumbnail.createDiv();
          playOverlay.classList.add('video-play-overlay');
          playOverlay.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 32px; height: 32px; background: rgba(0, 0, 0, 0.5); border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease; cursor: pointer;';

          // Play icon (smaller, more subtle)
          const playIcon = playOverlay.createDiv();
          playIcon.style.cssText = 'width: 16px; height: 16px; display: flex; align-items: center; justify-content: center;';
          setIcon(playIcon, 'play');
          playIcon.style.color = 'rgba(255, 255, 255, 0.95)';

          // Hover effect
          thumbnail.addEventListener('mouseenter', () => {
            playOverlay.style.background = 'rgba(0, 0, 0, 0.6)';
            playOverlay.style.transform = 'translate(-50%, -50%) scale(1.1)';
          });

          thumbnail.addEventListener('mouseleave', () => {
            playOverlay.style.background = 'rgba(0, 0, 0, 0.4)';
            playOverlay.style.transform = 'translate(-50%, -50%) scale(1)';
          });
        } else {
          // Image thumbnail
          const imgThumb = thumbnail.createEl('img', {
            attr: {
              src: resourcePath,
              alt: `Thumbnail ${i + 1}`,
              loading: 'lazy'
            }
          });
          imgThumb.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
        }

        // Click to navigate
        thumbnail.addEventListener('click', (e) => {
          e.stopPropagation();
          showMedia(i);
        });

        // Active state
        if (i === 0) {
          thumbnail.style.borderColor = 'var(--interactive-accent)';
        }
      }

      // Counter indicator (bottom-right, above thumbnails)
      const counter = carouselContainer.createDiv();
      counter.addClass('media-counter');
      // Position above thumbnails: thumbnail height (60px) + padding (12px * 2) + gap (12px) = ~96px
      counter.style.cssText = 'position: absolute; bottom: 96px; right: 12px; padding: 4px 8px; border-radius: 4px; background: rgba(0, 0, 0, 0.5); color: rgba(255, 255, 255, 0.85); font-size: 11px; font-weight: 500; z-index: 10;';
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
      transcriptContainer.style.cssText = 'margin-top: 8px;';

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
