import type { TranscriptEntry } from '@/types/post';
import type { TranscriptionSegment } from '@/types/transcription';

/**
 * TranscriptFormatter - Unified transcript formatting for markdown
 *
 * Single Responsibility: Format transcript segments (from BrightData or Whisper)
 * into timestamped lines. Callers are responsible for adding section headings
 * (e.g. `## Transcript`) as appropriate for their context.
 */
export class TranscriptFormatter {
  /**
   * Format seconds to MM:SS or H:MM:SS display string.
   * Both BrightData and Whisper provide timestamps in seconds.
   */
  formatTimestampDisplay(seconds: number): string {
    const totalSeconds = Math.floor(seconds);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;

    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Format BrightData transcript entries into timestamped lines.
   *
   * @param entries - TranscriptEntry[] with start_time in seconds
   * @param videoId - YouTube video ID for deep links (optional)
   * @returns Timestamped lines separated by blank lines (no heading)
   */
  formatBrightDataTranscript(entries: TranscriptEntry[], videoId?: string): string {
    if (!entries || entries.length === 0) {
      return '';
    }

    const lines = entries.map((entry) => {
      const ts = this.formatTimestampDisplay(entry.start_time);
      const text = entry.text.replace(/\n/g, ' ').trim();
      if (videoId) {
        const urlSeconds = Math.floor(entry.start_time);
        const url = `https://www.youtube.com/watch?v=${videoId}&t=${urlSeconds}s`;
        return `[${ts}](${url}) ${text}`;
      }
      return `[${ts}] ${text}`;
    });

    return lines.join('\n\n');
  }

  /**
   * Format Whisper transcription segments into timestamped lines.
   *
   * @param segments - TranscriptionSegment[] with start in seconds
   * @returns Timestamped lines separated by blank lines (no heading)
   */
  formatWhisperTranscript(segments: TranscriptionSegment[]): string {
    if (!segments || segments.length === 0) {
      return '';
    }

    const lines = segments.map((segment) => {
      const ts = this.formatTimestampDisplay(segment.start);
      return `[${ts}] ${segment.text.trim()}`;
    });

    return lines.join('\n\n');
  }
}
