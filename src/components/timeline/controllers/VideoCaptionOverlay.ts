import type { TranscriptionSegment } from '../../../types/transcription';

/**
 * VideoCaptionOverlay - Injects native TextTrack captions into an HTMLVideoElement.
 * Single Responsibility: Map TranscriptionSegment[] to VTTCue[] on a native TextTrack.
 *
 * Uses the browser's built-in TextTrack API so captions survive fullscreen
 * (including iOS native player) without any custom overlay DOM.
 */
export class VideoCaptionOverlay {
  private track: TextTrack | null = null;
  private videoElement: HTMLVideoElement | null = null;

  /**
   * Attach captions to a video element.
   * Creates a TextTrack, populates it with VTTCue instances, and shows it.
   */
  attach(
    videoElement: HTMLVideoElement,
    segments: TranscriptionSegment[],
    options?: { language?: string; label?: string }
  ): void {
    this.videoElement = videoElement;

    // Reuse existing track if already attached (e.g., after replaceAdapter)
    const existingTrack = this.findExistingTrack(videoElement, options?.label);
    if (existingTrack) {
      this.track = existingTrack;
      this.clearCues();
    } else {
      this.track = videoElement.addTextTrack(
        'captions',
        options?.label ?? 'Transcription',
        options?.language ?? 'en'
      );
    }

    this.populateCues(segments);
    this.track.mode = 'showing';
  }

  /**
   * Toggle captions on/off. Returns the new visibility state.
   */
  toggle(): boolean {
    if (!this.track) return false;
    const showNow = this.track.mode !== 'showing';
    this.track.mode = showNow ? 'showing' : 'hidden';
    return showNow;
  }

  /**
   * Check if captions are currently visible.
   */
  get isVisible(): boolean {
    return this.track?.mode === 'showing';
  }

  /**
   * Replace all cues (e.g., when segments change).
   */
  replaceCues(segments: TranscriptionSegment[]): void {
    if (!this.track) return;
    this.clearCues();
    this.populateCues(segments);
  }

  /**
   * Cleanup: hide track and clear cues.
   * Note: TextTrack created via addTextTrack() cannot be removed from the video,
   * but we can disable it and clear all cues.
   */
  destroy(): void {
    if (this.track) {
      this.track.mode = 'disabled';
      this.clearCues();
    }
    this.track = null;
    this.videoElement = null;
  }

  // ─── Private ──────────────────────────────────────────────

  private findExistingTrack(
    video: HTMLVideoElement,
    label?: string
  ): TextTrack | null {
    const targetLabel = label ?? 'Transcription';
    for (let i = 0; i < video.textTracks.length; i++) {
      const t = video.textTracks[i];
      if (t && t.label === targetLabel) {
        return t;
      }
    }
    return null;
  }

  private populateCues(segments: TranscriptionSegment[]): void {
    if (!this.track) return;

    for (const seg of segments) {
      // Guard: VTTCue requires start < end and non-negative times
      const start = Math.max(0, seg.start);
      const end = Math.max(start + 0.1, seg.end);

      const cue = new VTTCue(start, end, seg.text);
      cue.snapToLines = false;
      cue.line = 82; // percentage from top (finer control than integer lines)
      cue.size = 100; // full width cue box
      cue.align = 'center'; // text centered within the box
      this.track.addCue(cue);
    }
  }

  private clearCues(): void {
    if (!this.track?.cues) return;
    // Must remove from front; cues is a live collection
    while (this.track.cues.length > 0) {
      const cue = this.track.cues[0];
      if (!cue) break;
      this.track.removeCue(cue);
    }
  }
}
