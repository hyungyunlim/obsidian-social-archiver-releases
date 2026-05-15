import { describe, expect, it } from 'vitest';
import {
  extractTikTokVideoId,
  hasDirectTikTokVideoMedia,
  isDirectVideoMedia,
} from '@/components/timeline/renderers/tiktokMedia';

describe('tiktokMedia helpers', () => {
  it('extracts canonical TikTok ids and falls back to stored post ids', () => {
    expect(extractTikTokVideoId('https://www.tiktok.com/@creator/video/7614212125468232982')).toBe('7614212125468232982');
    expect(extractTikTokVideoId('https://vt.tiktok.com/ZSyUa2Y4q/', '7614212125468232982')).toBe('7614212125468232982');
    expect(extractTikTokVideoId('<blockquote data-video-id="7614212125468232982"></blockquote>')).toBe('7614212125468232982');
  });

  it('treats preserved local or remote video files as direct media', () => {
    expect(isDirectVideoMedia({ type: 'video', url: 'attachments/tiktok/ad.mp4' })).toBe(true);
    expect(isDirectVideoMedia({ type: 'video', url: 'https://media.social-archive.org/tiktok/ad.mp4?token=abc' })).toBe(true);
    expect(isDirectVideoMedia({ type: 'image', url: 'https://media.social-archive.org/tiktok/ad.mp4?token=abc' })).toBe(true);
  });

  it('does not mistake TikTok webpage URLs for direct media URLs', () => {
    expect(isDirectVideoMedia({ type: 'video', url: 'https://www.tiktok.com/@creator/video/7614212125468232982' })).toBe(false);
    expect(isDirectVideoMedia({ type: 'video', url: 'https://vt.tiktok.com/ZSyUa2Y4q/' })).toBe(false);
  });

  it('detects when a TikTok post has renderable direct video media', () => {
    expect(hasDirectTikTokVideoMedia([
      { type: 'image', url: 'attachments/tiktok/cover.webp' },
      { type: 'video', url: 'attachments/tiktok/video.mp4' },
    ])).toBe(true);

    expect(hasDirectTikTokVideoMedia([
      { type: 'video', url: 'https://www.tiktok.com/@creator/video/7614212125468232982' },
    ])).toBe(false);
  });
});
