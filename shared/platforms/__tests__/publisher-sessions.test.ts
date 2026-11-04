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

describe('The Athletic, under the NYT entry (measured 2026-11-03)', () => {
  const article = 'https://www.nytimes.com/athletic/7729453/2026/10/28/synthetic-story/';

  it('is a NYT article with its own body and wall selectors', () => {
    const entry = getPublisherSession(article)!;
    expect(entry.slug).toBe('nytimes');
    expect(entry.contentSelector).toContain('.article-content-container');
    expect(entry.gatewaySelector).toContain('#athletic-gateway-container');
  });

  it('reads an Athletic gift link as a NYT gift link', () => {
    const nyt = getPublisherSession(article)!;
    expect(isPublisherGiftLink(`${article}?unlocked_article_code=1.abc&source=athletic_user_shared_gift_article_copylink`, nyt))
      .toBe(true);
    expect(isPublisherGiftLink(`${article}?source=athletic_user_shared_gift_article_copylink`, nyt)).toBe(false);
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

describe('The Economist entry (measured 2026-11-03)', () => {
  it.each(['www.economist.com', 'economist.com', 'myaccount.economist.com'])('matches %s', (host) => {
    expect(getPublisherSession(`https://${host}/china/2026/06/21/china-is-having-another-ai-moment`)?.slug)
      .toBe('theeconomist');
  });

  it('does not match a lookalike host', () => {
    expect(getPublisherSession('https://theeconomist.com.evil.io/china/2026/06/21/a')).toBeNull();
    expect(getPublisherSession('https://noteconomist.com/china/2026/06/21/a')).toBeNull();
  });

  it('logs in through www.economist.com, where the session cookie lands', () => {
    const economist = PUBLISHER_SESSIONS.find((entry) => entry.slug === 'theeconomist');
    expect(new URL(economist!.loginUrl).hostname).toBe('www.economist.com');
    expect(economist!.sessionCookie).toBe('fcx_refresh_token');
  });

  it('does not treat a gift link as readable without a session', () => {
    // Signed out, a gift link asks for a free account (measured 2026-11-03).
    const economist = PUBLISHER_SESSIONS.find((entry) => entry.slug === 'theeconomist')!;
    const article = 'https://www.economist.com/leaders/2026/10/29/synthetic-leader';
    expect(isPublisherGiftLink(`${article}?giftId=c3ludGhldGlj&utm_campaign=gifted_article`, economist)).toBe(false);
  });
});

describe('Bloomberg entry (measured 2026-11-03)', () => {
  const bloomberg = PUBLISHER_SESSIONS.find((entry) => entry.slug === 'bloomberg')!;
  const article = 'https://www.bloomberg.com/news/articles/2026-11-03/apple-sets-new-sales-highs-in-china';

  it('matches news and opinion articles, not the front page', () => {
    expect(getPublisherSession(article)?.slug).toBe('bloomberg');
    expect(getPublisherSession('https://www.bloomberg.com/opinion/articles/2026-11-02/a-test')?.slug).toBe('bloomberg');
    expect(getPublisherSession('https://www.bloomberg.com/')).toBeNull();
  });

  it('reads a gift link from accessToken', () => {
    expect(isPublisherGiftLink(`${article}?accessToken=eyJ0eXAiOi.x.y`, bloomberg)).toBe(true);
    expect(isPublisherGiftLink(`${article}?srnd=homepage-asia`, bloomberg)).toBe(false);
  });
});

describe('Wall Street Journal entry (measured 2026-11-03)', () => {
  const wsj = PUBLISHER_SESSIONS.find((entry) => entry.slug === 'wsj')!;
  const article = 'https://www.wsj.com/lifestyle/warren-buffett-youtube-watching-cb6bd1d4';

  it('matches articles, not the front page or a lookalike', () => {
    expect(getPublisherSession(article)?.slug).toBe('wsj');
    expect(getPublisherSession('https://www.wsj.com/opinion/the-ai-future-is-for-everyone-a0c24e20')?.slug).toBe('wsj');
    expect(getPublisherSession('https://www.wsj.com/')).toBeNull();
    expect(getPublisherSession('https://notwsj.com/articles/a')).toBeNull();
  });

  it('signs in through www.wsj.com and lists no gift parameters yet', () => {
    expect(new URL(wsj.loginUrl).hostname).toBe('www.wsj.com');
    expect(wsj.sessionCookie).toBe('ca_id');
    // Share links carry `mod` and `reflink`; neither unlocks the article.
    expect(isPublisherGiftLink(`${article}?mod=hp_lead_pos7&reflink=desktopwebshare_permalink`, wsj)).toBe(false);
  });
});

describe('롱블랙 entry (measured 2026-11-03)', () => {
  const longblack = PUBLISHER_SESSIONS.find((entry) => entry.slug === 'longblack')!;
  const note = 'https://longblack.co/note/2164';

  it('matches notes, not the front page or a lookalike', () => {
    expect(getPublisherSession(note)?.slug).toBe('longblack');
    expect(getPublisherSession('https://longblack.co/')).toBeNull();
    expect(getPublisherSession('https://notlongblack.co/note/2164')).toBeNull();
  });

  it("reads a member's 24-hour share link as a gift link", () => {
    expect(isPublisherGiftLink(`${note}?ticket=NT0000`, longblack)).toBe(true);
    expect(isPublisherGiftLink(`${note}?utm_source=share`, longblack)).toBe(false);
  });

  it('is listed in Settings for Korean only', () => {
    expect(longblack.locales).toEqual(['ko']);
    expect(PUBLISHER_SESSIONS.filter((entry) => entry.locales).map((entry) => entry.slug)).toEqual(['longblack', 'sisain']);
  });
});

describe('시사IN entry (measured 2026-11-04)', () => {
  const sisain = PUBLISHER_SESSIONS.find((entry) => entry.slug === 'sisain')!;
  const article = 'https://www.sisain.co.kr/news/articleView.html?idxno=58758';

  it('matches articles, not the front page or a lookalike', () => {
    expect(getPublisherSession(article)?.slug).toBe('sisain');
    expect(getPublisherSession('https://www.sisain.co.kr/')).toBeNull();
    expect(getPublisherSession('https://notsisain.co.kr/news/articleView.html?idxno=1')).toBeNull();
  });

  it("signs in through the site's own page: 자동로그인's token, else the session's cookie", () => {
    expect(new URL(sisain.loginUrl).hostname).toBe('www.sisain.co.kr');
    expect(sisain.sessionCookie).toEqual(['slt', 'pchrg']);
    expect(sisain.gatewaySelector).toBe('#newin-text');
    expect(sisain.giftLinkParams).toBeUndefined();
    expect(sisain.locales).toEqual(['ko']);
  });
});
