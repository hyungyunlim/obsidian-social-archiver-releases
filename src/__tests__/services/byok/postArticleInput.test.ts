import { describe, expect, it } from 'vitest';
import { buildPostArticleInput } from '../../../services/byok/postArticleInput';
import type { PostData } from '../../../types/post';

const base = {
  platform: 'x',
  id: 'post-1',
  url: 'https://x.com/a/status/1',
  author: { name: 'Ada', url: '' },
  content: { text: 'Main text.' },
  media: [],
  metadata: { timestamp: '2026-11-04T00:00:00.000Z' },
} as unknown as PostData;

describe('buildPostArticleInput', () => {
  it('reads the body, quoted and embedded posts, transcript, image text and comments', () => {
    const input = buildPostArticleInput({
      ...base,
      title: 'A title',
      originalUrl: 'https://x.com/a/status/1?s=20',
      content: { text: 'Plain', rawMarkdown: 'Main **text**.' },
      quotedPost: { ...base, platform: 'x', author: { name: 'Bob', url: '' }, content: { text: 'Quoted text.' } },
      embeddedArchives: [{ ...base, platform: 'youtube', title: 'Talk', transcript: { raw: 'Video words.' }, content: { text: 'desc' } }],
      whisperTranscript: { segments: [{ id: 0, start: 0, end: 1, text: 'Hello' }, { id: 1, start: 1, end: 2, text: 'there' }], language: 'en' },
      userNotes: [
        { content: '📷 Extracted Text (Image 1)\n\nSALE 50%', createdAt: null },
        { content: 'Just a note', createdAt: null },
      ],
      comments: [{ id: 'c1', author: { name: 'Cy', url: '' }, content: 'Nice', replies: [{ id: 'c2', author: { name: 'Di', url: '' }, content: 'Agreed' }] }],
    } as unknown as PostData);

    expect(input).toMatchObject({
      title: 'A title',
      authorName: 'Ada',
      platform: 'x',
      url: 'https://x.com/a/status/1?s=20',
      transcript: 'Hello there',
      ocrText: 'SALE 50%',
      commentsText: '- Cy: Nice\n  - Di: Agreed',
    });
    expect(input.body).toBe('Main **text**.\n\n[Quoted x post by Bob]\nQuoted text.\n\n[Embedded youtube: Talk]\nVideo words.');
  });

  it('leaves out what the post does not have', () => {
    const input = buildPostArticleInput(base);
    expect(input.body).toBe('Main text.');
    expect(input.transcript).toBeFalsy();
    expect(input.ocrText).toBe('');
    expect(input.commentsText).toBeUndefined();
  });
});
