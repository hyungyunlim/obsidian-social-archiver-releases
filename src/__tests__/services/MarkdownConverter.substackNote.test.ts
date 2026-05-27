import { describe, it, expect, beforeEach } from 'vitest';
import { MarkdownConverter } from '@/services/MarkdownConverter';
import type { PostData, Platform } from '@/types/post';
import type { MediaResult } from '@/services/MediaHandler';
import type { TFile } from 'obsidian';

/**
 * PRD §22.3: Substack Note images must localize into the {{media}} section
 * (local attachment paths), NOT be left as remote S3 URLs — even though
 * Substack is an RSS-based platform (which normally renders inline-article
 * images remotely). Substack articles/blogs keep the RSS inline rendering.
 */

const REMOTE_IMG_1 =
  'https://substack-post-media.s3.amazonaws.com/public/images/one.png';
const REMOTE_IMG_2 =
  'https://substack-post-media.s3.amazonaws.com/public/images/two.png';

function makeMediaResult(sourceIndex: number, localPath: string, originalUrl: string): MediaResult {
  return {
    originalUrl,
    localPath,
    type: 'image',
    size: 1234,
    file: { path: localPath } as TFile,
    sourceIndex,
    fallbackKind: 'none',
  };
}

function makeSubstackNote(overrides: Partial<PostData> = {}): PostData {
  return {
    platform: 'substack' as Platform,
    postType: 'note',
    id: '250449025',
    url: 'https://substack.com/@oliverburkeman/note/c-250449025',
    author: {
      name: 'Oliver Burkeman',
      url: 'https://substack.com/@oliverburkeman',
      handle: '@oliverburkeman',
      username: 'oliverburkeman',
    },
    content: {
      text: 'A short note with two images.',
    },
    media: [
      { type: 'image', url: REMOTE_IMG_1 },
      { type: 'image', url: REMOTE_IMG_2 },
    ],
    metadata: {
      timestamp: new Date('2026-04-28T13:32:22.414Z'),
      likes: 928,
    },
    ...overrides,
  };
}

describe('MarkdownConverter — Substack Note media localization (PRD §22.3)', () => {
  let converter: MarkdownConverter;

  beforeEach(() => {
    converter = new MarkdownConverter();
    converter.initialize();
  });

  it('renders note images as LOCAL paths in the {{media}} section', () => {
    const post = makeSubstackNote();
    const mediaResults = [
      makeMediaResult(0, 'attachments/social-archives/substack/250449025/img-1.webp', REMOTE_IMG_1),
      makeMediaResult(1, 'attachments/social-archives/substack/250449025/img-2.webp', REMOTE_IMG_2),
    ];

    const result = converter.convert(post, undefined, mediaResults);

    // Local paths present
    expect(result.content).toContain('img-1.webp');
    expect(result.content).toContain('img-2.webp');
    // Remote S3 URLs must NOT appear in the rendered body
    expect(result.content).not.toContain(REMOTE_IMG_1);
    expect(result.content).not.toContain(REMOTE_IMG_2);
  });

  it('localizes a single-image note', () => {
    const post = makeSubstackNote({
      media: [{ type: 'image', url: REMOTE_IMG_1 }],
    });
    const mediaResults = [
      makeMediaResult(0, 'attachments/social-archives/substack/250449025/img-1.webp', REMOTE_IMG_1),
    ];

    const result = converter.convert(post, undefined, mediaResults);
    expect(result.content).toContain('img-1.webp');
    expect(result.content).not.toContain(REMOTE_IMG_1);
  });

  it('localizes a note even when content body contains an inline remote markdown image', () => {
    // Regression guard: an RSS-style body would normally flip blogMediaUsedInline
    // true and drop the localized {{media}} block, leaving the remote image.
    const post = makeSubstackNote({
      content: { text: `Body with ![inline](${REMOTE_IMG_1}) image.` },
    });
    const mediaResults = [
      makeMediaResult(0, 'attachments/social-archives/substack/250449025/img-1.webp', REMOTE_IMG_1),
      makeMediaResult(1, 'attachments/social-archives/substack/250449025/img-2.webp', REMOTE_IMG_2),
    ];

    const result = converter.convert(post, undefined, mediaResults);
    expect(result.content).toContain('img-1.webp');
    expect(result.content).toContain('img-2.webp');
  });

  it('uses url-derived note detection when postType is absent (older archives)', () => {
    const post = makeSubstackNote({ postType: undefined });
    const mediaResults = [
      makeMediaResult(0, 'attachments/social-archives/substack/250449025/img-1.webp', REMOTE_IMG_1),
      makeMediaResult(1, 'attachments/social-archives/substack/250449025/img-2.webp', REMOTE_IMG_2),
    ];

    const result = converter.convert(post, undefined, mediaResults);
    expect(result.content).toContain('img-1.webp');
    expect(result.content).not.toContain(REMOTE_IMG_1);
  });

  it('does NOT localize a Substack ARTICLE the same way (keeps inline RSS rendering)', () => {
    // An article with rawMarkdown inline images keeps the inline-article path:
    // blogMediaUsedInline stays true, so the bottom {{media}} block is dropped.
    const article = makeSubstackNote({
      postType: 'article',
      url: 'https://example.substack.com/p/my-post',
      content: {
        text: 'Article body',
        rawMarkdown: `# Title\n\n![inline](${REMOTE_IMG_1})\n\nMore text.`,
      },
    });
    const mediaResults = [
      makeMediaResult(0, 'attachments/social-archives/substack/250449025/img-1.webp', REMOTE_IMG_1),
    ];

    const result = converter.convert(article, undefined, mediaResults);
    // Article inline body is preserved (remote inline image remains in rawMarkdown body)
    expect(result.content).toContain(REMOTE_IMG_1);
  });
});
