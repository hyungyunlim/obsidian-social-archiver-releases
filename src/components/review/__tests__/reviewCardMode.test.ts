import { describe, expect, it } from 'vitest';
import type { Media } from '../../../types/post';
import { coversAnswer, reviewCardMode } from '../reviewCardMode';

const image: Media = { type: 'image', url: 'attachments/a.jpg' };
const audio: Media = { type: 'audio', url: 'attachments/a.mp3' };

describe('reviewCardMode', () => {
  it('asks the recall question first, even with a picture', () => {
    expect(reviewCardMode({ kind: 'post', question: 'Why?' }, { media: [image] })).toBe('question');
  });

  it('turns a picture into the question when there is no recall question', () => {
    expect(reviewCardMode({ kind: 'post' }, { media: [image] })).toBe('image');
    expect(reviewCardMode({ kind: 'post' }, { media: [{ type: 'video', url: 'v.mp4' }] })).toBe('image');
  });

  it('shows a highlight as is, and a text-only post as is', () => {
    expect(reviewCardMode({ kind: 'highlight' }, { media: [image] })).toBe('highlight');
    expect(reviewCardMode({ kind: 'post' }, { media: [audio] })).toBe('open');
    expect(reviewCardMode({ kind: 'post' }, null)).toBe('open');
  });

  it('covers the answer only when there is something to ask', () => {
    expect(coversAnswer('question')).toBe(true);
    expect(coversAnswer('image')).toBe(true);
    expect(coversAnswer('highlight')).toBe(false);
    expect(coversAnswer('open')).toBe(false);
  });
});
