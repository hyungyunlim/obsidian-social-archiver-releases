import { describe, it, expect } from 'vitest';
import { maybeProxyCdnUrl } from '../../utils/cdnProxy';

describe('maybeProxyCdnUrl', () => {
  it('should proxy Instagram CDN URLs', () => {
    const cdnUrl = 'https://scontent-ssn1-1.cdninstagram.com/v/t51.2885-19/12345_n.jpg?stp=dst-jpg&_nc=123';
    const result = maybeProxyCdnUrl(cdnUrl);
    expect(result).toContain('/api/proxy-media?url=');
    expect(result).toContain(encodeURIComponent(cdnUrl));
  });

  it('should proxy Facebook CDN URLs (fbcdn.net)', () => {
    const cdnUrl = 'https://scontent.fbcdn.net/v/t1.6435/12345.jpg';
    const result = maybeProxyCdnUrl(cdnUrl);
    expect(result).toContain('/api/proxy-media?url=');
    expect(result).toContain(encodeURIComponent(cdnUrl));
  });

  it('should proxy TikTok CDN URLs', () => {
    const cdnUrl = 'https://p16-sign-sg.tiktokcdn.com/aweme/100x100/tos-alisg-avt-0068/12345.jpeg';
    const result = maybeProxyCdnUrl(cdnUrl);
    expect(result).toContain('/api/proxy-media?url=');
    expect(result).toContain(encodeURIComponent(cdnUrl));
  });

  it('should NOT proxy non-CDN URLs', () => {
    const normalUrl = 'https://example.com/avatar.jpg';
    expect(maybeProxyCdnUrl(normalUrl)).toBe(normalUrl);
  });

  it('should NOT proxy YouTube URLs', () => {
    const ytUrl = 'https://yt3.ggpht.com/a/default-user=s88-c-k-c0x00ffffff-no-rj';
    expect(maybeProxyCdnUrl(ytUrl)).toBe(ytUrl);
  });

  it('should NOT proxy Bluesky CDN URLs', () => {
    const bskyUrl = 'https://cdn.bsky.app/img/avatar_thumbnail/plain/did:plc:12345/bafkreiabc@jpeg';
    expect(maybeProxyCdnUrl(bskyUrl)).toBe(bskyUrl);
  });

  it('should return invalid URLs as-is', () => {
    expect(maybeProxyCdnUrl('not-a-url')).toBe('not-a-url');
    expect(maybeProxyCdnUrl('')).toBe('');
  });

  it('should handle subdomain variations of Instagram CDN', () => {
    const url1 = 'https://instagram.fkix5-1.fna.fbcdn.net/v/t51.2885-19/s150x150/12345.jpg';
    const url2 = 'https://scontent.cdninstagram.com/v/12345.jpg';
    expect(maybeProxyCdnUrl(url1)).toContain('/api/proxy-media?url=');
    expect(maybeProxyCdnUrl(url2)).toContain('/api/proxy-media?url=');
  });
});
