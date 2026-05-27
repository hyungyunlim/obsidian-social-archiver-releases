import { describe, it, expect } from 'vitest';
import { isRssBasedPlatform } from '@/constants/rssPlatforms';
import { isSubstackNote } from '@/utils/substack';
import type { PostData } from '@/types/post';

/**
 * PRD §22.2: Carousel branch selection for Substack notes.
 *
 * The PostCardRenderer is a large DOM renderer with heavy Obsidian deps, so we
 * unit-test the load-bearing branch-selection predicate it uses to decide
 * between the media gallery/carousel path vs the stacked RSS/article inline path.
 *
 * Mirrors `PostCardRenderer.renderContent`:
 *   - `isSubstackNotePost = platform === 'substack' && isSubstackNote(postType, url)`
 *   - `isBlogWithInlineImages = isRssBasedPlatform && platform !== 'podcast'
 *        && !hasAudioMedia && !isSubstackNotePost && rawMarkdown`
 *   - gallery/carousel fires when:
 *        `media.length > 0 && !isBlogWithInlineImages` (plus other non-relevant guards)
 *
 * A Substack NOTE must take the carousel/gallery path (isBlogWithInlineImages
 * false); a Substack ARTICLE with rawMarkdown keeps the inline-article path.
 */

/** Re-implements the renderer's media-path decision (the parts that vary by post). */
function selectsMediaGallery(post: PostData): boolean {
  const hasAudioMedia = post.media.some((m) => m.type === 'audio');
  const rawMarkdown = post.content.rawMarkdown || '';
  const hasInlineImageMarkdown =
    /!\[\[[^\]]+\]\]/.test(rawMarkdown) ||
    /!\[[\s\S]*?\]\([^)]+\)/.test(rawMarkdown) ||
    /<img\b/i.test(rawMarkdown);

  const isThreadsInlineArchive =
    post.platform === 'threads' && !!post.content.rawMarkdown && hasInlineImageMarkdown;
  const isXArticleWithInline = post.platform === 'x' && !!post.content.rawMarkdown;
  const isWebArticleWithInlineImages =
    post.platform === 'web' && !!post.content.rawMarkdown && hasInlineImageMarkdown;

  const isSubstackNotePost =
    post.platform === 'substack' && isSubstackNote(post.postType, post.url);

  const isBlogWithInlineImages =
    (isRssBasedPlatform(post.platform) &&
      post.platform !== 'podcast' &&
      !hasAudioMedia &&
      !isSubstackNotePost &&
      !!post.content.rawMarkdown) ||
    isThreadsInlineArchive ||
    isXArticleWithInline ||
    isWebArticleWithInlineImages;

  // Renderer guards (embedded/reblog/video-embed) are not relevant to these cases.
  return post.media.length > 0 && !isBlogWithInlineImages;
}

function makeNote(media: PostData['media'], overrides: Partial<PostData> = {}): PostData {
  return {
    platform: 'substack',
    postType: 'note',
    id: 'c-1',
    url: 'https://substack.com/@h/note/c-1',
    author: { name: 'H', url: 'https://substack.com/@h' },
    content: { text: 'note body' },
    media,
    metadata: { timestamp: new Date('2026-04-28T00:00:00Z') },
    ...overrides,
  };
}

describe('PostCardRenderer — Substack note carousel branch (PRD §22.2)', () => {
  const img = (n: number) => ({
    type: 'image' as const,
    url: `https://substack-post-media.s3.amazonaws.com/${n}.png`,
  });

  it('routes a multi-image note to the media gallery/carousel', () => {
    const post = makeNote([img(1), img(2), img(3)]);
    expect(selectsMediaGallery(post)).toBe(true);
  });

  it('routes a single-image note to the media gallery (single image)', () => {
    const post = makeNote([img(1)]);
    expect(selectsMediaGallery(post)).toBe(true);
  });

  it('routes a note to the gallery even when it carries rawMarkdown', () => {
    const post = makeNote([img(1), img(2)], {
      content: { text: 'body', rawMarkdown: '![](https://x/1.png)\n\n![](https://x/2.png)' },
    });
    expect(selectsMediaGallery(post)).toBe(true);
  });

  it('uses url-derived note detection when postType is absent (older archives)', () => {
    const post = makeNote([img(1), img(2)], { postType: undefined });
    expect(selectsMediaGallery(post)).toBe(true);
  });

  it('does NOT route a Substack ARTICLE (with rawMarkdown) to the gallery', () => {
    const article = makeNote([img(1), img(2)], {
      postType: 'article',
      url: 'https://example.substack.com/p/slug',
      content: { text: 'body', rawMarkdown: '# Title\n\n![](https://x/1.png)' },
    });
    expect(selectsMediaGallery(article)).toBe(false);
  });
});
