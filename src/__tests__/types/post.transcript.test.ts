import { describe, expect, it } from 'vitest';
import { PostDataSchema } from '../../types/post';

describe('PostDataSchema transcript', () => {
  const post = (transcript: unknown) => ({
    platform: 'youtube',
    id: 'v1',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    author: { name: 'Channel', url: 'https://www.youtube.com/@channel' },
    content: { text: 'Description' },
    media: [],
    metadata: { timestamp: '2026-10-09T00:00:00.000Z' },
    transcript,
  });

  it('keeps the caption language and kind (stripped before T9)', () => {
    const parsed = PostDataSchema.parse(post({ raw: 'hi', language: 'pt-br', kind: 'asr' }));
    expect(parsed.transcript).toMatchObject({ language: 'pt-br', kind: 'asr' });
  });

  it('never fails the archive on an unexpected kind', () => {
    const parsed = PostDataSchema.parse(post({ raw: 'hi', language: 'ko', kind: 'translated' }));
    expect(parsed.transcript?.kind).toBeNull();
  });
});
