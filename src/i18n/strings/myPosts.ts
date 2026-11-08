/**
 * My Posts — the timeline filter, author bubbles and card labels.
 * Key prefix "myPosts.". Every entry is { en, ko }.
 */
import type { LocaleText } from '../index';

export const myPostsStrings = {
  'myPosts.filter': { en: 'My Posts', ko: '내 글' },
  'myPosts.back': { en: 'Back to timeline', ko: '타임라인으로' },
  'myPosts.authors.all': { en: 'All', ko: '전체' },
  'myPosts.authors.aria': { en: 'Filter My Posts by author', ko: '작성자로 내 글 거르기' },
  'myPosts.edit': { en: 'Edit post', ko: '글 수정' },
  'myPosts.quote.missing': {
    en: 'This quoted post is not in your vault yet',
    ko: '인용한 글이 아직 볼트에 없어요',
  },
} satisfies Record<string, LocaleText>;
