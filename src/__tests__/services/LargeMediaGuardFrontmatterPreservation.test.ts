/**
 * Large Media Guard - Frontmatter Preservation Tests
 *
 * Regression coverage for USER_CONTROLLED_FRONTMATTER_FIELDS. Ensures that
 * re-archive flows preserve user-controlled state (share/archive/like/comment/
 * mediaDetached/mediaPromptSuppressed/mediaSourceUrls/downloadedUrls/
 * transcribedUrls/shareId/shareUrl/sharePassword) on top of freshly generated
 * frontmatter, AND that fresh archives persist `mediaSourceUrls` from PostData
 * when no existing frontmatter is available.
 *
 * @see src/services/markdown/frontmatter/FrontmatterGenerator.ts
 * @see src/services/markdown/frontmatter/constants.ts
 * @see prd-large-media-guard.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FrontmatterGenerator } from '@/services/markdown/frontmatter/FrontmatterGenerator';
import { DateNumberFormatter } from '@/services/markdown/formatters/DateNumberFormatter';
import { TextFormatter } from '@/services/markdown/formatters/TextFormatter';
import { USER_CONTROLLED_FRONTMATTER_FIELDS } from '@/services/markdown/frontmatter/constants';
import type { PostData } from '@/types/post';

function createTestPostData(overrides: Partial<PostData> = {}): PostData {
  return {
    platform: 'x',
    id: 'test-123',
    url: 'https://twitter.com/testuser/status/123',
    author: {
      name: 'Test User',
      url: 'https://twitter.com/testuser',
    },
    content: {
      text: 'Test content',
      html: '',
      hashtags: [],
    },
    media: [],
    metadata: {
      timestamp: new Date('2026-04-17T10:30:00Z'),
    },
    linkPreviews: [],
    ...overrides,
  } as PostData;
}

describe('LargeMediaGuard: frontmatter preservation', () => {
  let generator: FrontmatterGenerator;

  beforeEach(() => {
    generator = new FrontmatterGenerator(new DateNumberFormatter(), new TextFormatter());
  });

  describe('USER_CONTROLLED_FRONTMATTER_FIELDS registry', () => {
    it('includes every Large Media Guard field', () => {
      // Spec: mediaDetached, mediaPromptSuppressed, mediaSourceUrls MUST be
      // in the preservation list so re-archive does not clobber user intent.
      expect(USER_CONTROLLED_FRONTMATTER_FIELDS).toContain('mediaDetached');
      expect(USER_CONTROLLED_FRONTMATTER_FIELDS).toContain('mediaPromptSuppressed');
      expect(USER_CONTROLLED_FRONTMATTER_FIELDS).toContain('mediaSourceUrls');
    });

    it('preserves share controls + user-curated + per-URL download flags', () => {
      const required = [
        'share',
        'shareId',
        'shareUrl',
        'sharePassword',
        'archive',
        'like',
        'comment',
        'downloadedUrls',
        'transcribedUrls',
      ];
      for (const field of required) {
        expect(USER_CONTROLLED_FRONTMATTER_FIELDS).toContain(field);
      }
    });
  });

  describe('generateFrontmatter with existingFrontmatter', () => {
    it('preserves all 12 USER_CONTROLLED fields when re-archiving', () => {
      const postData = createTestPostData();
      const existing: Record<string, unknown> = {
        share: true,
        shareId: 'abc-123',
        shareUrl: 'https://share.example.com/abc-123',
        sharePassword: 'secret',
        archive: true,
        like: true,
        comment: 'my personal note',
        downloadedUrls: [
          'downloaded:https://video.twimg.com/ext/v1.mp4',
          'declined:https://video.twimg.com/ext/v2.mp4',
        ],
        transcribedUrls: ['https://video.twimg.com/ext/v1.mp4'],
        mediaDetached: true,
        mediaPromptSuppressed: true,
        mediaSourceUrls: [
          'https://video.twimg.com/ext/v1.mp4',
          'https://video.twimg.com/ext/v2.mp4',
        ],
      };

      const frontmatter = generator.generateFrontmatter(postData, {
        existingFrontmatter: existing,
      });

      for (const field of USER_CONTROLLED_FRONTMATTER_FIELDS) {
        expect(
          frontmatter[field as keyof typeof frontmatter],
          `field "${field}" must be preserved`
        ).toEqual(existing[field]);
      }
    });

    it('preserves mediaDetached=true even when PostData omits it', () => {
      const postData = createTestPostData();
      // PostData does NOT carry mediaDetached — only existing frontmatter does.
      const frontmatter = generator.generateFrontmatter(postData, {
        existingFrontmatter: { mediaDetached: true, mediaSourceUrls: ['https://x.com/v.mp4'] },
      });
      expect(frontmatter.mediaDetached).toBe(true);
      expect(frontmatter.mediaSourceUrls).toEqual(['https://x.com/v.mp4']);
    });

    it('preserves mediaPromptSuppressed=true on re-archive even without PostData override', () => {
      const postData = createTestPostData();
      const frontmatter = generator.generateFrontmatter(postData, {
        existingFrontmatter: { mediaPromptSuppressed: true },
      });
      expect(frontmatter.mediaPromptSuppressed).toBe(true);
    });

    it('does not synthesize USER_CONTROLLED fields when existing frontmatter is empty', () => {
      const postData = createTestPostData();
      const frontmatter = generator.generateFrontmatter(postData, {
        existingFrontmatter: {},
      });
      expect(frontmatter.mediaDetached).toBeUndefined();
      expect(frontmatter.mediaPromptSuppressed).toBeUndefined();
      // `share` comes from fresh generation with default false, not preservation.
      expect(frontmatter.share).toBe(false);
    });
  });

  describe('generateFrontmatter without existingFrontmatter (fresh archive)', () => {
    it('writes mediaSourceUrls from top-level http(s) image/video media', () => {
      const postData = createTestPostData({
        media: [
          { type: 'image', url: 'https://pbs.twimg.com/media/img1.jpg' },
          { type: 'video', url: 'https://video.twimg.com/ext/v1.mp4' },
        ],
      });
      const frontmatter = generator.generateFrontmatter(postData);
      expect(frontmatter.mediaSourceUrls).toEqual([
        'https://pbs.twimg.com/media/img1.jpg',
        'https://video.twimg.com/ext/v1.mp4',
      ]);
    });

    it('filters out non-http(s) URLs (data URLs, local paths)', () => {
      const postData = createTestPostData({
        media: [
          { type: 'image', url: 'data:image/png;base64,AAAA' },
          { type: 'video', url: 'attachments/social-archives/local.mp4' },
          { type: 'image', url: 'https://pbs.twimg.com/media/ok.jpg' },
        ],
      });
      const frontmatter = generator.generateFrontmatter(postData);
      expect(frontmatter.mediaSourceUrls).toEqual(['https://pbs.twimg.com/media/ok.jpg']);
    });

    it('filters out non-image/video media types (e.g. audio, document)', () => {
      const postData = createTestPostData({
        media: [
          { type: 'audio', url: 'https://cdn.example.com/ep1.mp3' },
          { type: 'document', url: 'https://cdn.example.com/spec.pdf' },
          { type: 'image', url: 'https://pbs.twimg.com/media/img.jpg' },
        ],
      });
      const frontmatter = generator.generateFrontmatter(postData);
      expect(frontmatter.mediaSourceUrls).toEqual(['https://pbs.twimg.com/media/img.jpg']);
    });

    it('omits mediaSourceUrls when there are no eligible media items', () => {
      const postData = createTestPostData({ media: [] });
      const frontmatter = generator.generateFrontmatter(postData);
      expect(frontmatter.mediaSourceUrls).toBeUndefined();
    });

    it('deduplicates mediaSourceUrls while preserving insertion order', () => {
      const url = 'https://pbs.twimg.com/media/img.jpg';
      const postData = createTestPostData({
        media: [
          { type: 'image', url },
          { type: 'image', url },
        ],
      });
      const frontmatter = generator.generateFrontmatter(postData);
      expect(frontmatter.mediaSourceUrls).toEqual([url]);
    });
  });

  describe('PostData-level detach flags', () => {
    it('applies mediaDetached from PostData when set (fresh archive Flow A: detach)', () => {
      const postData = createTestPostData({
        mediaDetached: true,
        mediaPromptSuppressed: true,
      });
      const frontmatter = generator.generateFrontmatter(postData);
      expect(frontmatter.mediaDetached).toBe(true);
      expect(frontmatter.mediaPromptSuppressed).toBe(true);
    });

    it('merges PostData.downloadedUrls (declined + downloaded markers) into frontmatter', () => {
      const postData = createTestPostData({
        downloadedUrls: [
          'downloaded:https://pbs.twimg.com/media/img1.jpg',
          'declined:https://video.twimg.com/ext/v1.mp4',
        ],
      });
      const frontmatter = generator.generateFrontmatter(postData);
      expect(frontmatter.downloadedUrls).toEqual(
        expect.arrayContaining([
          'downloaded:https://pbs.twimg.com/media/img1.jpg',
          'declined:https://video.twimg.com/ext/v1.mp4',
        ])
      );
    });

    it('lets existing frontmatter win over PostData on re-archive (share state precedence)', () => {
      const postData = createTestPostData({ share: false } as Partial<PostData>);
      const frontmatter = generator.generateFrontmatter(postData, {
        existingFrontmatter: { share: true, shareUrl: 'https://share.example/x' },
      });
      expect(frontmatter.share).toBe(true);
      expect(frontmatter.shareUrl).toBe('https://share.example/x');
    });
  });
});
