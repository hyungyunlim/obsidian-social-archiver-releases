import type { App } from 'obsidian';
import { VideoTranscriptPlayer } from '@/components/timeline/renderers/VideoTranscriptPlayer';

describe('VideoTranscriptPlayer timestamp normalization', () => {
  const player = new VideoTranscriptPlayer({} as App);

  const unify = (post: unknown) => (
    (player as unknown as {
      unifyTranscriptSegments: (p: unknown) => Array<{ id: number; start: number; end: number; text: string }>;
    }).unifyTranscriptSegments(post)
  );

  it('returns empty array when no transcript data exists', () => {
    const segments = unify({});
    expect(segments).toEqual([]);
  });

  it('prefers whisper transcript over formatted transcript', () => {
    const segments = unify({
      whisperTranscript: {
        segments: [{ id: 0, start: 1, end: 5, text: 'Whisper segment' }],
        language: 'en',
      },
      transcript: {
        formatted: [{ start_time: 60, end_time: 64, duration: 4, text: 'Formatted segment' }],
      },
    });

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ id: 0, start: 1, end: 5, text: 'Whisper segment' });
  });

  it('keeps second-based formatted transcript timestamps as-is', () => {
    const segments = unify({
      metadata: { duration: 120 },
      transcript: {
        formatted: [
          { start_time: 60, end_time: 64, duration: 4, text: 'Second-based segment' },
        ],
      },
    });

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ id: 0, start: 60, end: 64, text: 'Second-based segment' });
  });

  it('converts millisecond-based formatted transcript timestamps to seconds', () => {
    const segments = unify({
      metadata: { duration: 120 },
      transcript: {
        formatted: [
          { start_time: 60000, end_time: 64000, duration: 4000, text: 'Millisecond segment' },
        ],
      },
    });

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ id: 0, start: 60, end: 64, text: 'Millisecond segment' });
  });

  it('uses 8-second fallback when end_time is missing', () => {
    const segments = unify({
      metadata: { duration: 120 },
      transcript: {
        formatted: [
          { start_time: 30, end_time: 0, duration: 0, text: 'No end time' },
        ],
      },
    });

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ start: 30, end: 38, text: 'No end time' });
  });

  it('assigns sequential ids for formatted transcript segments', () => {
    const segments = unify({
      metadata: { duration: 120 },
      transcript: {
        formatted: [
          { start_time: 0, end_time: 5, duration: 5, text: 'A' },
          { start_time: 5, end_time: 10, duration: 5, text: 'B' },
          { start_time: 10, end_time: 15, duration: 5, text: 'C' },
        ],
      },
    });

    expect(segments.map((s) => s.id)).toEqual([0, 1, 2]);
  });
});
