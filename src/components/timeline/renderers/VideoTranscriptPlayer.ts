import type { App } from 'obsidian';
import type { PostData } from '../../../types/post';
import type { TranscriptionSegment } from '../../../types/transcription';
import type { PlaybackAdapter } from '../controllers/PlaybackAdapter';
import { HtmlMediaPlaybackAdapter, YouTubeIframePlaybackAdapter } from '../controllers/PlaybackAdapter';
import { VideoCaptionOverlay } from '../controllers/VideoCaptionOverlay';
import type { YouTubePlayerController } from '../controllers/YouTubePlayerController';
import { TranscriptRenderer } from './TranscriptRenderer';

/**
 * Context for video media elements available in the post card
 */
export interface VideoMediaContext {
  videoElement?: HTMLVideoElement;
  iframeElement?: HTMLIFrameElement;
  youtubeController?: YouTubePlayerController;
}

/**
 * VideoTranscriptPlayer - Composition component for video + transcript sync
 * Single Responsibility: Bridge video playback with TranscriptRenderer
 *
 * Creates the appropriate PlaybackAdapter from the available media context,
 * unifies transcript data from different sources (YouTube API / Whisper),
 * delegates rendering to TranscriptRenderer, and optionally injects native
 * TextTrack captions for local video (survives fullscreen on all platforms).
 */
export class VideoTranscriptPlayer {
  private transcriptRenderer: TranscriptRenderer;
  private adapter: PlaybackAdapter | null = null;
  private captionOverlay: VideoCaptionOverlay | null = null;
  private multilangSegments: Map<string, TranscriptionSegment[]> = new Map();
  private currentLanguage: string = '';

  constructor(private readonly app: App) {
    this.transcriptRenderer = new TranscriptRenderer();
  }

  /**
   * Render transcript section below video in the post card.
   * Returns true if transcript was rendered, false if no transcript data available.
   */
  render(
    container: HTMLElement,
    post: PostData,
    mediaContext: VideoMediaContext
  ): boolean {
    // 1. Unify transcript data from different sources
    const segments = this.unifyTranscriptSegments(post);
    if (segments.length === 0) return false;

    // 2. Create PlaybackAdapter from available media
    this.adapter = this.createAdapter(mediaContext, post);

    // 3. Build multilang data if available
    let languages: string[] = [];
    this.multilangSegments.clear();
    this.currentLanguage = this.getLanguage(post) || 'en';

    if (post.multilangTranscript && Object.keys(post.multilangTranscript.byLanguage).length >= 2) {
      languages = Object.keys(post.multilangTranscript.byLanguage);
      this.currentLanguage = post.multilangTranscript.defaultLanguage;

      // Build Map of language → segments
      for (const [langCode, segs] of Object.entries(post.multilangTranscript.byLanguage)) {
        this.multilangSegments.set(langCode, segs);
      }
    }

    // 4. Inject native TextTrack captions for local video
    if (mediaContext.videoElement) {
      this.captionOverlay = new VideoCaptionOverlay();
      this.captionOverlay.attach(mediaContext.videoElement, segments, {
        language: this.currentLanguage,
        label: 'Transcription'
      });
    }

    // 5. Create transcript container
    const transcriptContainer = container.createDiv({
      cls: 'video-transcript-section'
    });

    // 6. Delegate to TranscriptRenderer
    this.transcriptRenderer.render(transcriptContainer, {
      segments,
      adapter: this.adapter,
      language: this.currentLanguage,
      startCollapsed: true,
      showSpeakerDividers: true,
      onCaptionToggle: this.captionOverlay
        ? () => this.toggleCaptions()
        : undefined,
      captionActive: this.captionOverlay?.isVisible ?? false,
      // Multilang support
      languages: languages.length >= 2 ? languages : undefined,
      multilangSegments: this.multilangSegments.size >= 2 ? this.multilangSegments : undefined,
      onLanguageChange: languages.length >= 2 ? (langCode) => this.handleLanguageChange(langCode) : undefined
    });

    return true;
  }

  /**
   * Toggle native TextTrack captions on/off.
   * Returns the new visibility state.
   */
  toggleCaptions(): boolean {
    if (!this.captionOverlay) return false;
    return this.captionOverlay.toggle();
  }

  /**
   * Handle language tab change.
   * Updates caption overlay and transcript renderer with new language segments.
   */
  private handleLanguageChange(languageCode: string): void {
    this.currentLanguage = languageCode;

    // Get segments for the new language
    const newSegments = this.multilangSegments.get(languageCode);
    if (!newSegments || newSegments.length === 0) return;

    // Update caption overlay with new language segments
    if (this.captionOverlay) {
      this.captionOverlay.replaceCues(newSegments);
    }

    // TranscriptRenderer.switchLanguage will be called by TranscriptRenderer itself
  }

  /**
   * Replace the current adapter (e.g., after local video fallback to iframe)
   */
  replaceAdapter(mediaContext: VideoMediaContext, post: PostData): void {
    // Destroy old adapter + caption overlay
    this.adapter?.destroy();
    this.captionOverlay?.destroy();
    this.captionOverlay = null;

    // Create new adapter
    this.adapter = this.createAdapter(mediaContext, post);

    // Re-attach captions if new context has a local video
    if (mediaContext.videoElement) {
      const segments = this.unifyTranscriptSegments(post);
      if (segments.length > 0) {
        this.captionOverlay = new VideoCaptionOverlay();
        this.captionOverlay.attach(mediaContext.videoElement, segments, {
          language: this.getLanguage(post),
          label: 'Transcription'
        });
      }
    }

    // Update TranscriptRenderer
    this.transcriptRenderer.setAdapter(this.adapter);
  }

  /**
   * Unify transcript segments from different data sources.
   * Priority: whisperTranscript > transcript.formatted > (none)
   */
  private unifyTranscriptSegments(post: PostData): TranscriptionSegment[] {
    // Priority 1: Whisper transcript (already in seconds, most accurate)
    if (post.whisperTranscript?.segments?.length) {
      return post.whisperTranscript.segments;
    }

    // Priority 2: YouTube formatted transcript (BrightData, timestamps in ms)
    if (post.transcript?.formatted?.length) {
      return post.transcript.formatted.map((entry, i) => ({
        id: i,
        start: entry.start_time / 1000, // ms → seconds
        end: entry.end_time
          ? entry.end_time / 1000
          : (entry.start_time / 1000) + 8, // fallback: 8 seconds
        text: entry.text
      }));
    }

    return [];
  }

  /**
   * Create the appropriate PlaybackAdapter from available media context.
   * Returns null if no media element is available (transcript-only mode).
   */
  private createAdapter(
    ctx: VideoMediaContext,
    post: PostData
  ): PlaybackAdapter | null {
    // Prefer local video (native HTMLMediaElement API = best sync)
    if (ctx.videoElement) {
      return new HtmlMediaPlaybackAdapter(ctx.videoElement);
    }

    // YouTube iframe via controller
    if (ctx.youtubeController) {
      const duration = (post.metadata as any)?.duration ?? 0;
      return new YouTubeIframePlaybackAdapter(ctx.youtubeController, duration);
    }

    // No adapter available — transcript will render in read-only mode
    return null;
  }

  /**
   * Get transcript language from post data
   */
  private getLanguage(post: PostData): string | undefined {
    if (post.whisperTranscript?.language) {
      return post.whisperTranscript.language;
    }
    // Check frontmatter-based transcription language
    if ((post as any).transcriptionLanguage) {
      return (post as any).transcriptionLanguage as string;
    }
    return undefined;
  }

  /**
   * Cleanup adapter, caption overlay, and renderer
   */
  destroy(): void {
    this.adapter?.destroy();
    this.adapter = null;
    this.captionOverlay?.destroy();
    this.captionOverlay = null;
    this.transcriptRenderer.destroy();
  }
}
