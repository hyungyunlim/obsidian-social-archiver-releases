import { describe, it, expect } from 'vitest';
import { encodePathForMarkdownLink } from '@/utils/url';

describe('encodePathForMarkdownLink', () => {
  it('should encode spaces as %20', () => {
    expect(encodePathForMarkdownLink('99 System/Attachments/social-archives/pinterest/123/image.jpg'))
      .toBe('99%20System/Attachments/social-archives/pinterest/123/image.jpg');
  });

  it('should encode multiple spaces in path', () => {
    expect(encodePathForMarkdownLink('My Vault/My Attachments/social archives/image.jpg'))
      .toBe('My%20Vault/My%20Attachments/social%20archives/image.jpg');
  });

  it('should encode closing parentheses to prevent markdown link breakage', () => {
    expect(encodePathForMarkdownLink('attachments/folder (copy)/image.jpg'))
      .toBe('attachments/folder%20(copy%29/image.jpg');
  });

  it('should encode existing percent signs to avoid double-encoding', () => {
    expect(encodePathForMarkdownLink('folder%name/image.jpg'))
      .toBe('folder%25name/image.jpg');
  });

  it('should not encode HTTP URLs', () => {
    const httpUrl = 'https://example.com/path with spaces/image.jpg';
    expect(encodePathForMarkdownLink(httpUrl)).toBe(httpUrl);
  });

  it('should not encode HTTPS URLs', () => {
    const httpsUrl = 'https://cdn.example.com/media/image.jpg';
    expect(encodePathForMarkdownLink(httpsUrl)).toBe(httpsUrl);
  });

  it('should return simple paths unchanged', () => {
    expect(encodePathForMarkdownLink('attachments/social-archives/facebook/123/image.jpg'))
      .toBe('attachments/social-archives/facebook/123/image.jpg');
  });

  it('should handle relative paths with ../../../../ prefix', () => {
    expect(encodePathForMarkdownLink('../../../../99 System/Attachments/social-archives/image.jpg'))
      .toBe('../../../../99%20System/Attachments/social-archives/image.jpg');
  });

  it('should handle empty string', () => {
    expect(encodePathForMarkdownLink('')).toBe('');
  });

  it('should handle path with only spaces', () => {
    expect(encodePathForMarkdownLink('   ')).toBe('%20%20%20');
  });
});
