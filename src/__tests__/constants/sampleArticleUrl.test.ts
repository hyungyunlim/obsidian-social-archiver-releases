import { describe, expect, it } from 'vitest';
import { sampleArticleUrl } from '../../constants';

describe('sampleArticleUrl', () => {
  it('uses the blog post in the UI language when it exists', () => {
    expect(sampleArticleUrl('ko')).toBe('https://blog.social-archive.org/ko/posts/save-less-read-more/');
    expect(sampleArticleUrl('ja')).toBe('https://blog.social-archive.org/ja/posts/save-less-read-more/');
    expect(sampleArticleUrl('en')).toBe('https://blog.social-archive.org/posts/save-less-read-more/');
  });

  it('falls back to English for other languages', () => {
    expect(sampleArticleUrl('zh-tw')).toBe('https://blog.social-archive.org/posts/save-less-read-more/');
    expect(sampleArticleUrl('')).toBe('https://blog.social-archive.org/posts/save-less-read-more/');
  });
});
