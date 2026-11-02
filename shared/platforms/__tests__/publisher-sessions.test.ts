import { describe, expect, it } from 'vitest';
import {
  PUBLISHER_SESSIONS,
  getPublisherSession,
  isPublisherGiftLink,
} from '../publisher-sessions';

const ARTICLE_PATH = '/2026/01/01/world/example.html';

describe('getPublisherSession', () => {
  it.each(['nytimes.com', 'www.nytimes.com', 'm.nytimes.com', 'cooking.nytimes.com', 'WWW.NYTIMES.COM'])(
    'matches %s',
    (host) => {
      expect(getPublisherSession(`https://${host}${ARTICLE_PATH}`)?.slug).toBe('nytimes');
    },
  );

  it.each([
    ['a lookalike host', `https://fakenytimes.com${ARTICLE_PATH}`],
    ['a suffix-appended host', `https://nytimes.com.evil.io${ARTICLE_PATH}`],
    ['plain http', `http://www.nytimes.com${ARTICLE_PATH}`],
    ['the front page', 'https://www.nytimes.com/'],
    ['an empty path', 'https://www.nytimes.com'],
    ['a slash-only path', 'https://www.nytimes.com//'],
    ['another site', `https://example.com${ARTICLE_PATH}`],
    ['garbage', 'not a url'],
  ])('rejects %s', (_label, url) => {
    expect(getPublisherSession(url)).toBeNull();
  });
});

describe('isPublisherGiftLink', () => {
  const nyt = PUBLISHER_SESSIONS.find((entry) => entry.slug === 'nytimes')!;
  const article = `https://www.nytimes.com${ARTICLE_PATH}`;

  it('detects a gift code', () => {
    expect(isPublisherGiftLink(`${article}?unlocked_article_code=abc&smid=url-share`, nyt)).toBe(true);
  });

  it('does not treat tracking parameters or an empty code as a gift', () => {
    expect(isPublisherGiftLink(`${article}?smid=url-share`, nyt)).toBe(false);
    expect(isPublisherGiftLink(`${article}?unlocked_article_code=`, nyt)).toBe(false);
    expect(isPublisherGiftLink(article, nyt)).toBe(false);
    expect(isPublisherGiftLink('not a url', nyt)).toBe(false);
  });
});

describe('PUBLISHER_SESSIONS', () => {
  it('gives every entry a domain and an https login page', () => {
    for (const entry of PUBLISHER_SESSIONS) {
      expect(entry.domain).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
      expect(new URL(entry.loginUrl).protocol).toBe('https:');
    }
  });
});

describe('Financial Times entry (measured 2026-11-02)', () => {
  it.each(['www.ft.com', 'ft.com', 'accounts.ft.com'])('matches %s', (host) => {
    expect(getPublisherSession(`https://${host}/content/0b3c1f0e-1111-2222-3333-444455556666`)?.slug).toBe('ft');
  });

  it('does not match a lookalike host', () => {
    expect(getPublisherSession('https://notft.com/content/abc')).toBeNull();
  });

  it('logs in on accounts.ft.com and lists no gift parameters yet', () => {
    const ft = PUBLISHER_SESSIONS.find((entry) => entry.slug === 'ft');
    expect(new URL(ft!.loginUrl).hostname).toBe('accounts.ft.com');
    expect(ft!.sessionCookie).toBe('FTSession_s');
    expect(isPublisherGiftLink('https://www.ft.com/content/abc?accessToken=x', ft!)).toBe(false);
  });
});
