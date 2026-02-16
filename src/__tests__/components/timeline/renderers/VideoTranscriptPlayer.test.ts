import { describe, it, expect } from 'vitest';

/**
 * VideoTranscriptPlayer tests
 *
 * Since VideoTranscriptPlayer depends on Obsidian App API (container.createDiv, etc.)
 * which cannot be mocked without a DOM environment, we test the pure logic functions
 * that can be extracted: transcript segment unification.
 */

// Test the transcript unification logic directly
// This mirrors VideoTranscriptPlayer.unifyTranscriptSegments()

function unifyTranscriptSegments(post: {
  whisperTranscript?: { segments: Array<{ id: number; start: number; end: number; text: string }>; language: string };
  transcript?: { formatted?: Array<{ start_time: number; end_time: number; text: string }> };
}): Array<{ id: number; start: number; end: number; text: string }> {
  if (post.whisperTranscript?.segments?.length) {
    return post.whisperTranscript.segments;
  }
  if (post.transcript?.formatted?.length) {
    return post.transcript.formatted.map((entry, i) => ({
      id: i,
      start: entry.start_time / 1000,
      end: entry.end_time ? entry.end_time / 1000 : (entry.start_time / 1000) + 8,
      text: entry.text,
    }));
  }
  return [];
}

describe('unifyTranscriptSegments', () => {
  it('should return empty array when no transcript data', () => {
    expect(unifyTranscriptSegments({})).toEqual([]);
  });

  it('should prefer whisperTranscript over formatted transcript', () => {
    const post = {
      whisperTranscript: {
        segments: [{ id: 0, start: 1.0, end: 5.0, text: 'whisper text' }],
        language: 'en',
      },
      transcript: {
        formatted: [{ start_time: 2000, end_time: 6000, text: 'yt text' }],
      },
    };
    const result = unifyTranscriptSegments(post);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('whisper text');
    expect(result[0].start).toBe(1.0);
  });

  it('should convert YouTube formatted transcript from ms to seconds', () => {
    const post = {
      transcript: {
        formatted: [
          { start_time: 1500, end_time: 5200, text: 'Hello world' },
          { start_time: 5200, end_time: 10000, text: 'Second segment' },
        ],
      },
    };
    const result = unifyTranscriptSegments(post);
    expect(result).toHaveLength(2);
    expect(result[0].start).toBe(1.5);
    expect(result[0].end).toBe(5.2);
    expect(result[1].start).toBe(5.2);
    expect(result[1].end).toBe(10);
  });

  it('should use 8s fallback when end_time is missing', () => {
    const post = {
      transcript: {
        formatted: [{ start_time: 3000, end_time: 0, text: 'No end time' }],
      },
    };
    const result = unifyTranscriptSegments(post);
    expect(result[0].end).toBe(11); // 3 + 8
  });

  it('should assign sequential IDs to YouTube formatted segments', () => {
    const post = {
      transcript: {
        formatted: [
          { start_time: 0, end_time: 1000, text: 'A' },
          { start_time: 1000, end_time: 2000, text: 'B' },
          { start_time: 2000, end_time: 3000, text: 'C' },
        ],
      },
    };
    const result = unifyTranscriptSegments(post);
    expect(result.map((s) => s.id)).toEqual([0, 1, 2]);
  });
});
