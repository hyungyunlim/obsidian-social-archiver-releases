import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VideoCaptionOverlay } from '../../../../components/timeline/controllers/VideoCaptionOverlay';
import type { TranscriptionSegment } from '../../../../types/transcription';

// ─── Mock TextTrack & VTTCue ────────────────────────────────

function createMockCueList() {
  const cues: any[] = [];
  return new Proxy(cues, {
    get(target, prop) {
      if (prop === 'length') return target.length;
      if (typeof prop === 'string' && !isNaN(Number(prop))) {
        return target[Number(prop)];
      }
      if (prop === 'item') return (i: number) => target[i];
      return undefined;
    }
  }) as any;
}

class MockTextTrack {
  label: string;
  language: string;
  kind: string;
  mode: TextTrackMode = 'hidden';
  private _cues: any[];
  cues: any;

  constructor(kind: string, label: string, language: string) {
    this.kind = kind;
    this.label = label;
    this.language = language;
    this._cues = [];
    this.cues = new Proxy(this._cues, {
      get: (target, prop) => {
        if (prop === 'length') return target.length;
        if (typeof prop === 'string' && !isNaN(Number(prop))) {
          return target[Number(prop)];
        }
        return undefined;
      }
    });
  }

  addCue(cue: any) { this._cues.push(cue); }
  removeCue(cue: any) {
    const idx = this._cues.indexOf(cue);
    if (idx >= 0) this._cues.splice(idx, 1);
  }
}

// Mock VTTCue globally
class MockVTTCue {
  startTime: number;
  endTime: number;
  text: string;
  line: number = -1;
  align: string = 'center';
  size: number = 100;
  constructor(start: number, end: number, text: string) {
    this.startTime = start;
    this.endTime = end;
    this.text = text;
  }
}
(globalThis as any).VTTCue = MockVTTCue;

function createMockVideoElement(): HTMLVideoElement {
  const tracks: MockTextTrack[] = [];
  const el = {
    textTracks: new Proxy(tracks, {
      get(target, prop) {
        if (prop === 'length') return target.length;
        if (typeof prop === 'string' && !isNaN(Number(prop))) {
          return target[Number(prop)];
        }
        return undefined;
      }
    }),
    addTextTrack: vi.fn((kind: string, label: string, language: string) => {
      const track = new MockTextTrack(kind, label, language);
      tracks.push(track);
      return track;
    })
  };
  return el as unknown as HTMLVideoElement;
}

// ─── Test Data ──────────────────────────────────────────────

const segments: TranscriptionSegment[] = [
  { id: 0, start: 0, end: 3, text: 'Hello world' },
  { id: 1, start: 3, end: 6, text: 'Second segment' },
  { id: 2, start: 6, end: 10, text: 'Third segment' }
];

// ─── Tests ──────────────────────────────────────────────────

describe('VideoCaptionOverlay', () => {
  let overlay: VideoCaptionOverlay;
  let video: HTMLVideoElement;

  beforeEach(() => {
    overlay = new VideoCaptionOverlay();
    video = createMockVideoElement();
  });

  describe('attach', () => {
    it('creates a TextTrack and populates cues from segments', () => {
      overlay.attach(video, segments);
      expect(video.addTextTrack).toHaveBeenCalledWith('captions', 'Transcription', 'en');

      const track = (video.addTextTrack as any).mock.results[0].value as MockTextTrack;
      expect(track.mode).toBe('showing');
      expect(track.cues.length).toBe(3);
    });

    it('uses custom label and language', () => {
      overlay.attach(video, segments, { label: 'My Captions', language: 'ko' });
      expect(video.addTextTrack).toHaveBeenCalledWith('captions', 'My Captions', 'ko');
    });

    it('reuses existing track with same label', () => {
      overlay.attach(video, segments, { label: 'Test' });
      overlay.attach(video, segments, { label: 'Test' });
      // addTextTrack should only be called once (second attach reuses)
      expect(video.addTextTrack).toHaveBeenCalledTimes(1);
    });

    it('guards against invalid time ranges', () => {
      const badSegments: TranscriptionSegment[] = [
        { id: 0, start: -1, end: 0, text: 'Negative start' }
      ];
      overlay.attach(video, badSegments);
      const track = (video.addTextTrack as any).mock.results[0].value as MockTextTrack;
      expect(track.cues.length).toBe(1);
      const cue = (track.cues as any)[0] as MockVTTCue;
      expect(cue.startTime).toBe(0); // clamped to 0
      expect(cue.endTime).toBeGreaterThan(0); // at least start + 0.1
    });
  });

  describe('toggle', () => {
    it('toggles between showing and hidden', () => {
      overlay.attach(video, segments);
      expect(overlay.isVisible).toBe(true);

      const result = overlay.toggle();
      expect(result).toBe(false);
      expect(overlay.isVisible).toBe(false);

      const result2 = overlay.toggle();
      expect(result2).toBe(true);
      expect(overlay.isVisible).toBe(true);
    });

    it('returns false when no track attached', () => {
      expect(overlay.toggle()).toBe(false);
    });
  });

  describe('replaceCues', () => {
    it('clears old cues and adds new ones', () => {
      overlay.attach(video, segments);
      const track = (video.addTextTrack as any).mock.results[0].value as MockTextTrack;
      expect(track.cues.length).toBe(3);

      const newSegments: TranscriptionSegment[] = [
        { id: 0, start: 0, end: 5, text: 'Replaced' }
      ];
      overlay.replaceCues(newSegments);
      expect(track.cues.length).toBe(1);
    });
  });

  describe('destroy', () => {
    it('disables track and clears cues', () => {
      overlay.attach(video, segments);
      const track = (video.addTextTrack as any).mock.results[0].value as MockTextTrack;

      overlay.destroy();
      expect(track.mode).toBe('disabled');
      expect(track.cues.length).toBe(0);
      expect(overlay.isVisible).toBe(false);
    });

    it('is safe to call without attach', () => {
      expect(() => overlay.destroy()).not.toThrow();
    });
  });
});
