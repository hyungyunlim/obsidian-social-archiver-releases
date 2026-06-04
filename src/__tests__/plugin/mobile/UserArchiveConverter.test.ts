import { describe, expect, it } from 'vitest';
import { convertUserArchiveToPostData } from '@/plugin/mobile/UserArchiveConverter';
import type { UserArchive } from '@/services/WorkersAPIClient';

function makeArchive(overrides: Partial<UserArchive> = {}): UserArchive {
  return {
    id: 'archive-1',
    userId: 'user-1',
    platform: 'x',
    postId: '2056802098822685052',
    originalUrl: 'https://x.com/ihtesham2005/status/2056802098822685052',
    title: 'SHOCKING: AI can now generate a full research paper',
    authorName: 'Ihtesham Ali',
    authorUrl: 'https://x.com/ihtesham2005',
    authorHandle: 'ihtesham2005',
    authorAvatarUrl: null,
    previewText: null,
    fullContent: null,
    thumbnailUrl: null,
    thumbnailUrls: null,
    media: null,
    postedAt: '2026-05-20T03:20:00.000Z',
    archivedAt: '2026-05-22T03:11:00.000Z',
    likesCount: null,
    commentCount: null,
    sharesCount: null,
    viewsCount: null,
    metadata: null,
    isLiked: false,
    isBookmarked: false,
    isArchived: false,
    isShared: false,
    ...overrides,
  };
}

describe('convertUserArchiveToPostData', () => {
  it('does not duplicate X article body when articleMarkdown already contains the intro link block', () => {
    const articleMarkdown = [
      '## 1',
      '',
      'SHOCKING: AI can now generate a full research paper.',
      '',
      '---',
      '',
      '## 2',
      '',
      'Read it here:',
      '',
      'https://t.co/8lhjPfaYVF',
    ].join('\n');

    const archive = makeArchive({
      isArticle: true,
      articleMarkdown,
      fullContent: [
        'SHOCKING: AI can now generate a full research paper',
        '',
        'Read it here:',
        '',
        'https://t.co/8lhjPfaYVF',
        '',
        '---',
        '',
        articleMarkdown,
      ].join('\n'),
    });

    const postData = convertUserArchiveToPostData(archive);

    expect(postData.content.text).toBe('');
    expect(postData.content.html).toBe(articleMarkdown);
  });

  it('keeps a non-duplicated X article intro before articleMarkdown', () => {
    const articleMarkdown = '## Article body\n\nFull body text.';
    const archive = makeArchive({
      isArticle: true,
      articleMarkdown,
      fullContent: [
        'My note before the article',
        '',
        '---',
        '',
        articleMarkdown,
      ].join('\n'),
    });

    const postData = convertUserArchiveToPostData(archive);

    expect(postData.content.text).toBe('My note before the article');
    expect(postData.content.html).toBe(articleMarkdown);
  });

  it('maps Kidsnote daycare metadata without treating it as a social handle', () => {
    const archive = makeArchive({
      platform: 'kidsnote',
      postId: 'kidsnote:report:child-1:report-1',
      originalUrl: 'https://www.kidsnote.com/api/v1_2/reports/report-1/',
      title: 'Kidsnote report - 임도윤 - 2026-05-28',
      authorName: '개나리 교사',
      authorUrl: 'https://www.kidsnote.com',
      authorHandle: '해맑은 어린이집',
      fullContent: '오늘은 즐겁게 놀이했습니다.',
      metadata: { location: '개나리반' },
    });

    const postData = convertUserArchiveToPostData(archive);

    expect(postData.author.name).toBe('개나리 교사');
    expect(postData.author.handle).toBe('해맑은 어린이집');
    expect(postData.author.username).toBeUndefined();
    expect(postData.content.community).toEqual({
      name: '해맑은 어린이집',
      url: 'https://www.kidsnote.com/',
    });
    expect(postData.metadata.location).toBe('개나리반');
  });
});
