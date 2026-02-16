import { describe, it, expect } from 'vitest';
import { TranscriptFormatter } from '@/services/markdown/formatters/TranscriptFormatter';
import type { TranscriptEntry } from '@/types/post';
import type { TranscriptionSegment } from '@/types/transcription';

describe('TranscriptFormatter', () => {
  const formatter = new TranscriptFormatter();

  // ─── formatTimestampDisplay ────────────────────────────

  describe('formatTimestampDisplay', () => {
    it('formats 0 seconds as 00:00', () => {
      expect(formatter.formatTimestampDisplay(0)).toBe('00:00');
    });

    it('formats fractional seconds (floors to integer)', () => {
      expect(formatter.formatTimestampDisplay(4.713)).toBe('00:04');
    });

    it('formats seconds under a minute', () => {
      expect(formatter.formatTimestampDisplay(9.884)).toBe('00:09');
      expect(formatter.formatTimestampDisplay(59)).toBe('00:59');
    });

    it('formats minutes + seconds', () => {
      expect(formatter.formatTimestampDisplay(65.5)).toBe('01:05');
      expect(formatter.formatTimestampDisplay(123)).toBe('02:03');
    });

    it('formats hours when >= 3600', () => {
      expect(formatter.formatTimestampDisplay(3661)).toBe('1:01:01');
      expect(formatter.formatTimestampDisplay(7200)).toBe('2:00:00');
    });

    it('handles negative input without crashing', () => {
      const result = formatter.formatTimestampDisplay(-1);
      expect(typeof result).toBe('string');
    });
  });

  // ─── formatBrightDataTranscript ────────────────────────

  describe('formatBrightDataTranscript', () => {
    const sampleEntries: TranscriptEntry[] = [
      { start_time: 4.713, end_time: 7.716, duration: 3.003, text: 'How do I communicate better?' },
      { start_time: 9.884, end_time: 11.302, duration: 1.418, text: 'Great question.' },
      { start_time: 65.5, end_time: 70, duration: 4.5, text: 'One minute in.' },
    ];

    it('returns empty string for empty entries', () => {
      expect(formatter.formatBrightDataTranscript([])).toBe('');
    });

    it('returns empty string for null/undefined', () => {
      expect(formatter.formatBrightDataTranscript(null as any)).toBe('');
      expect(formatter.formatBrightDataTranscript(undefined as any)).toBe('');
    });

    it('formats with YouTube deep links when videoId is provided', () => {
      const result = formatter.formatBrightDataTranscript(sampleEntries, 'ABC123');

      expect(result).toContain('[00:04](https://www.youtube.com/watch?v=ABC123&t=4s) How do I communicate better?');
      expect(result).toContain('[00:09](https://www.youtube.com/watch?v=ABC123&t=9s) Great question.');
      expect(result).toContain('[01:05](https://www.youtube.com/watch?v=ABC123&t=65s) One minute in.');
    });

    it('formats with plain timestamps when videoId is missing', () => {
      const result = formatter.formatBrightDataTranscript(sampleEntries);

      expect(result).toContain('[00:04] How do I communicate better?');
      expect(result).toContain('[00:09] Great question.');
      expect(result).not.toContain('youtube.com');
    });

    it('replaces newlines in entry text with spaces', () => {
      const entries: TranscriptEntry[] = [
        { start_time: 0, end_time: 3, duration: 3, text: 'Line one\nLine two' },
      ];
      const result = formatter.formatBrightDataTranscript(entries, 'VID');
      expect(result).toContain('Line one Line two');
      expect(result).not.toContain('\nLine two');
    });

    it('does not include a heading (callers add headings)', () => {
      const result = formatter.formatBrightDataTranscript(sampleEntries);
      expect(result).not.toContain('## Transcript');
      expect(result.startsWith('[')).toBe(true);
    });

    it('separates segments with blank lines', () => {
      const result = formatter.formatBrightDataTranscript(sampleEntries);
      const parts = result.split('\n\n');
      expect(parts).toHaveLength(3);
    });
  });

  // ─── formatWhisperTranscript ───────────────────────────

  describe('formatWhisperTranscript', () => {
    const sampleSegments: TranscriptionSegment[] = [
      { id: 0, start: 0, end: 5, text: ' Hello world ' },
      { id: 1, start: 5.2, end: 12, text: 'Second segment' },
      { id: 2, start: 3661, end: 3670, text: 'Over an hour in' },
    ];

    it('returns empty string for empty segments', () => {
      expect(formatter.formatWhisperTranscript([])).toBe('');
    });

    it('returns empty string for null/undefined', () => {
      expect(formatter.formatWhisperTranscript(null as any)).toBe('');
      expect(formatter.formatWhisperTranscript(undefined as any)).toBe('');
    });

    it('formats segments with plain timestamps', () => {
      const result = formatter.formatWhisperTranscript(sampleSegments);

      expect(result).toContain('[00:00] Hello world');
      expect(result).toContain('[00:05] Second segment');
      expect(result).toContain('[1:01:01] Over an hour in');
    });

    it('trims whitespace from segment text', () => {
      const result = formatter.formatWhisperTranscript(sampleSegments);
      expect(result).toContain('[00:00] Hello world');
      expect(result).not.toContain(' Hello world ');
    });

    it('does not include YouTube links', () => {
      const result = formatter.formatWhisperTranscript(sampleSegments);
      expect(result).not.toContain('youtube.com');
      expect(result).not.toContain('(http');
    });

    it('does not include a heading (callers add headings)', () => {
      const result = formatter.formatWhisperTranscript(sampleSegments);
      expect(result).not.toContain('## Transcript');
      expect(result.startsWith('[')).toBe(true);
    });
  });
});
