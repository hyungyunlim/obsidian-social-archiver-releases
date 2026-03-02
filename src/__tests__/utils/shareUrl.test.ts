import { describe, expect, it } from 'vitest';
import { getShareUrlForClipboard, toReaderModeShareUrl } from '@/utils/shareUrl';

describe('shareUrl', () => {
  it('should append #reader when converting a normal share URL', () => {
    expect(toReaderModeShareUrl('https://social-archive.org/user/abc123'))
      .toBe('https://social-archive.org/user/abc123#reader');
  });

  it('should replace existing hash with #reader', () => {
    expect(toReaderModeShareUrl('https://social-archive.org/user/abc123#old'))
      .toBe('https://social-archive.org/user/abc123#reader');
  });

  it('should return reader URL when copyReaderModeLink is true', () => {
    expect(getShareUrlForClipboard('https://social-archive.org/user/abc123', true))
      .toBe('https://social-archive.org/user/abc123#reader');
  });

  it('should return original URL when copyReaderModeLink is false', () => {
    expect(getShareUrlForClipboard('https://social-archive.org/user/abc123', false))
      .toBe('https://social-archive.org/user/abc123');
  });
});
