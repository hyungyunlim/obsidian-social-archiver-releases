import { describe, expect, it } from 'vitest';
import { stripContentVariantMetadataFooter } from '../../utils/contentVariantMarkdown';

describe('stripContentVariantMetadataFooter', () => {
  it('removes Korean metadata footers and the echoed media block before them', () => {
    const markdown = [
      'Q: AI 에이전트가 코딩을 자동화하고 있음에도 왜 소프트웨어 엔지니어 채용 공고는 빠르게 증가하고 있는가?',
      '',
      'A: 관리해야 할 코드가 훨씬 많아졌기 때문이다.',
      '',
      '![Image 1](https://example.com/software-engineers.png)',
      '',
      '플랫폼: X (트위터) | 작성자: David Sacks | 게시일: 2026-05-25 02:51 | 좋아요: 8,922 | 리트윗: 1,451',
      '',
      '원본 URL: https://x.com/davidsacks/status/2058606722110107970',
    ].join('\n');

    expect(stripContentVariantMetadataFooter(markdown)).toBe([
      'Q: AI 에이전트가 코딩을 자동화하고 있음에도 왜 소프트웨어 엔지니어 채용 공고는 빠르게 증가하고 있는가?',
      '',
      'A: 관리해야 할 코드가 훨씬 많아졌기 때문이다.',
    ].join('\n'));
  });

  it('removes translated standalone media labels before a localized footer', () => {
    const markdown = [
      '본문만 남아야 한다.',
      '',
      '이미지 1',
      '',
      '작성자: Example',
      '원본 URL: https://example.com/post',
    ].join('\n');

    expect(stripContentVariantMetadataFooter(markdown)).toBe('본문만 남아야 한다.');
  });

  it('removes Japanese footer sections after a divider', () => {
    const markdown = [
      'Translated body.',
      '',
      '---',
      '',
      'プラットフォーム: X | 作者: Example | 投稿日: 2026-05-25 | いいね: 10',
      '元の URL: https://example.com/post',
    ].join('\n');

    expect(stripContentVariantMetadataFooter(markdown)).toBe('Translated body.');
  });
});
