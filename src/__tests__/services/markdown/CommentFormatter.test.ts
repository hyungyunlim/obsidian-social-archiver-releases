import { CommentFormatter } from '@/services/markdown/formatters/CommentFormatter';
import { DateNumberFormatter } from '@/services/markdown/formatters/DateNumberFormatter';
import { TextFormatter } from '@/services/markdown/formatters/TextFormatter';
import type { Comment, Media } from '@/types/post';

describe('CommentFormatter', () => {
  let formatter: CommentFormatter;

  beforeEach(() => {
    const dateFormatter = new DateNumberFormatter();
    const textFormatter = new TextFormatter();
    formatter = new CommentFormatter(dateFormatter, textFormatter);
  });

  describe('formatComments with media', () => {
    it('should render inline image in comment', () => {
      const comments: Comment[] = [
        {
          id: '1',
          author: { name: 'TestUser', url: 'https://threads.com/@testuser', handle: 'testuser' },
          content: 'Check this out!',
          likes: 5,
          media: [
            { type: 'image', url: 'https://example.com/photo.jpg', width: 800, height: 600 },
          ],
        },
      ];

      const result = formatter.formatComments(comments, 'threads');

      expect(result).toContain('Check this out!');
      expect(result).toContain('![image 1](https://example.com/photo.jpg)');
    });

    it('should render multiple media items in comment', () => {
      const media: Media[] = [
        { type: 'image', url: 'https://example.com/img1.jpg' },
        { type: 'image', url: 'https://example.com/img2.jpg' },
      ];
      const comments: Comment[] = [
        {
          id: '1',
          author: { name: 'User', url: 'https://threads.com/@user', handle: 'user' },
          content: 'Multiple images',
          media,
        },
      ];

      const result = formatter.formatComments(comments, 'threads');

      expect(result).toContain('![image 1](https://example.com/img1.jpg)');
      expect(result).toContain('![image 2](https://example.com/img2.jpg)');
    });

    it('should render video thumbnail in comment', () => {
      const comments: Comment[] = [
        {
          id: '1',
          author: { name: 'User', url: 'https://threads.com/@user', handle: 'user' },
          content: 'Video reply',
          media: [
            { type: 'video', url: 'https://example.com/video.mp4', thumbnail: 'https://example.com/thumb.jpg' },
          ],
        },
      ];

      const result = formatter.formatComments(comments, 'threads');

      expect(result).toContain('[🎥 Video](https://example.com/thumb.jpg)');
    });

    it('should render media in nested replies with indentation', () => {
      const comments: Comment[] = [
        {
          id: '1',
          author: { name: 'User', url: 'https://threads.com/@user', handle: 'user' },
          content: 'Parent comment',
          replies: [
            {
              id: '2',
              author: { name: 'Replier', url: 'https://threads.com/@replier', handle: 'replier' },
              content: 'Reply with image',
              media: [
                { type: 'image', url: 'https://example.com/reply-photo.jpg' },
              ],
            },
          ],
        },
      ];

      const result = formatter.formatComments(comments, 'threads');

      expect(result).toContain('↳ **@replier**');
      expect(result).toContain('Reply with image');
      // Reply media should be indented
      expect(result).toContain('  ![image 1](https://example.com/reply-photo.jpg)');
    });

    it('should not render media section when comment has no media', () => {
      const comments: Comment[] = [
        {
          id: '1',
          author: { name: 'User', url: 'https://threads.com/@user', handle: 'user' },
          content: 'No media here',
        },
      ];

      const result = formatter.formatComments(comments, 'threads');

      expect(result).toContain('No media here');
      expect(result).not.toContain('![');
    });

    it('should handle comment with both text and media correctly', () => {
      const comments: Comment[] = [
        {
          id: '1',
          author: { name: 'User', url: 'https://threads.com/@user', handle: 'user' },
          content: 'Look at this photo',
          likes: 10,
          media: [
            { type: 'image', url: 'https://example.com/photo.jpg', altText: 'Beautiful sunset' },
          ],
        },
      ];

      const result = formatter.formatComments(comments, 'threads');

      // Text should come before media
      const textIndex = result.indexOf('Look at this photo');
      const mediaIndex = result.indexOf('![Beautiful sunset]');
      expect(textIndex).toBeLessThan(mediaIndex);
    });
  });

  describe('formatComments recursion (depth N)', () => {
    it('depth 0 only: top-level comment has no prefix and no indent', () => {
      const comments: Comment[] = [
        {
          id: '1',
          author: { name: 'Alice', handle: 'alice', url: 'https://example.com/alice' },
          content: 'top-level body',
          likes: 42,
        },
      ];

      const result = formatter.formatComments(comments, 'threads');

      expect(result).toBe('**@alice** · 42 likes\ntop-level body');
      expect(result.startsWith('  ')).toBe(false);
      expect(result).not.toContain('↳');
    });

    it('depth 1 reply: byte-for-byte regression vs prior format', () => {
      const comments: Comment[] = [
        {
          id: '1',
          author: { name: 'Alice', handle: 'alice' },
          content: 'parent',
          likes: 42,
          replies: [
            {
              id: '2',
              author: { name: 'Bob', handle: 'bob' },
              content: 'reply to alice',
              likes: 12,
            },
          ],
        },
      ];

      const result = formatter.formatComments(comments, 'threads');

      // Parent: no prefix, no indent.
      // Reply: "  ↳ " prefix + two-space body indent. This matches the pre-refactor
      // format exactly, so shallow posts don't regress.
      expect(result).toBe(
        '**@alice** · 42 likes\nparent\n\n  ↳ **@bob** · 12 likes\n  reply to alice'
      );
    });

    it('depth 3 reply chain: each level gains one indent level with a single ↳ per line', () => {
      const comments: Comment[] = [
        {
          id: '1',
          author: { name: 'Alice', handle: 'alice' },
          content: 'top',
          replies: [
            {
              id: '2',
              author: { name: 'Bob', handle: 'bob' },
              content: 'd1',
              replies: [
                {
                  id: '3',
                  author: { name: 'Carol', handle: 'carol' },
                  content: 'd2',
                  replies: [
                    {
                      id: '4',
                      author: { name: 'Dave', handle: 'dave' },
                      content: 'd3',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ];

      const result = formatter.formatComments(comments, 'threads');

      expect(result).toBe(
        '**@alice**\ntop\n\n' +
          '  ↳ **@bob**\n  d1\n\n' +
          '    ↳ **@carol**\n    d2\n\n' +
          '      ↳ **@dave**\n      d3'
      );

      // Each reply line has exactly one ↳ glyph (singular per-reply rule).
      const arrowCount = (result.match(/↳/g) ?? []).length;
      expect(arrowCount).toBe(3);
    });

    it('deleted/removed placeholder does not break indentation of descendants', () => {
      const comments: Comment[] = [
        {
          id: '1',
          author: { name: 'Alice', handle: 'alice' },
          content: 'top',
          replies: [
            {
              id: '2',
              author: { name: '[deleted]', handle: undefined },
              content: '[removed]',
              replies: [
                {
                  id: '3',
                  author: { name: 'Carol', handle: 'carol' },
                  content: 'live grandchild',
                },
              ],
            },
          ],
        },
      ];

      const result = formatter.formatComments(comments, 'threads');

      // Placeholder renders with 2-space indent, grandchild with 4-space indent.
      expect(result).toContain('  ↳ **@[deleted]**\n  [removed]');
      expect(result).toContain('    ↳ **@carol**\n    live grandchild');
    });

    it('reddit platform: deep replies render with @handle links at every depth', () => {
      const comments: Comment[] = [
        {
          id: '1',
          author: { name: 'alice', username: 'alice', url: 'https://www.reddit.com/user/alice' },
          content: 'root',
          replies: [
            {
              id: '2',
              author: { name: 'bob', username: 'bob', url: 'https://www.reddit.com/user/bob' },
              content: 'depth 1',
              replies: [
                {
                  id: '3',
                  author: { name: 'carol', username: 'carol', url: 'https://www.reddit.com/user/carol' },
                  content: 'depth 2',
                },
              ],
            },
          ],
        },
      ];

      const result = formatter.formatComments(comments, 'reddit');

      expect(result).toContain('**[@alice](https://www.reddit.com/user/alice)**');
      expect(result).toContain('  ↳ **[@bob](https://www.reddit.com/user/bob)**');
      expect(result).toContain('    ↳ **[@carol](https://www.reddit.com/user/carol)**');
    });

    it('instagram platform: handle link format used at depth >= 2', () => {
      const comments: Comment[] = [
        {
          id: '1',
          author: { name: 'Alice', handle: 'alice' },
          content: 'top',
          replies: [
            {
              id: '2',
              author: { name: 'Bob', handle: 'bob' },
              content: 'd1',
              replies: [
                {
                  id: '3',
                  author: { name: 'Carol', handle: 'carol' },
                  content: 'd2',
                },
              ],
            },
          ],
        },
      ];

      const result = formatter.formatComments(comments, 'instagram');

      expect(result).toContain('**[@alice](https://instagram.com/alice)**');
      expect(result).toContain('  ↳ **[@bob](https://instagram.com/bob)**');
      expect(result).toContain('    ↳ **[@carol](https://instagram.com/carol)**');
    });

    it('x platform: handle link format used at depth >= 2', () => {
      const comments: Comment[] = [
        {
          id: '1',
          author: { name: 'Alice', handle: 'alice' },
          content: 'top',
          replies: [
            {
              id: '2',
              author: { name: 'Bob', handle: 'bob' },
              content: 'd1',
              replies: [
                {
                  id: '3',
                  author: { name: 'Carol', handle: 'carol' },
                  content: 'd2',
                },
              ],
            },
          ],
        },
      ];

      const result = formatter.formatComments(comments, 'x');

      expect(result).toContain('**[@alice](https://x.com/alice)**');
      expect(result).toContain('  ↳ **[@bob](https://x.com/bob)**');
      expect(result).toContain('    ↳ **[@carol](https://x.com/carol)**');
    });

    it('linkedin platform: name-link format preserved at depth >= 2', () => {
      const comments: Comment[] = [
        {
          id: '1',
          author: { name: 'Alice Smith', url: 'https://linkedin.com/in/alice' },
          content: 'top',
          replies: [
            {
              id: '2',
              author: { name: 'Bob Jones', url: 'https://linkedin.com/in/bob' },
              content: 'd1',
              replies: [
                {
                  id: '3',
                  author: { name: 'Carol Lee', url: 'https://linkedin.com/in/carol' },
                  content: 'd2',
                },
              ],
            },
          ],
        },
      ];

      const result = formatter.formatComments(comments, 'linkedin');

      expect(result).toContain('**[Alice Smith](https://linkedin.com/in/alice)**');
      expect(result).toContain('  ↳ **[Bob Jones](https://linkedin.com/in/bob)**');
      expect(result).toContain('    ↳ **[Carol Lee](https://linkedin.com/in/carol)**');
    });

    it('linkedin platform: preserves mention links inside comment content as markdown links', () => {
      const comments: Comment[] = [
        {
          id: '1',
          author: { name: 'Commenter', url: 'https://linkedin.com/in/commenter' },
          content: 'Thanks <a href="/in/main-author-123abc">Main Author</a> for the post',
        },
      ];

      const result = formatter.formatComments(comments, 'linkedin');

      expect(result).toContain(
        'Thanks [Main Author](https://www.linkedin.com/in/main-author-123abc) for the post'
      );
      expect(result).not.toContain('<a href=');
    });

    it('linkedin platform: preserves encoded mention links inside comment content', () => {
      const comments: Comment[] = [
        {
          id: '1',
          author: { name: 'Commenter', url: 'https://linkedin.com/in/commenter' },
          content:
            'Thanks &lt;a href=&quot;www.linkedin.com/in/main-author&quot;&gt;Main Author&lt;/a&gt;',
        },
      ];

      const result = formatter.formatComments(comments, 'linkedin');

      expect(result).toContain(
        'Thanks [Main Author](https://www.linkedin.com/in/main-author)'
      );
    });

    it('default platform branch: falls back to @handle or name at every depth', () => {
      const comments: Comment[] = [
        {
          id: '1',
          author: { name: 'Alice', handle: 'alice' },
          content: 'top',
          replies: [
            {
              id: '2',
              author: { name: 'Bob' }, // no handle → name fallback
              content: 'd1',
              replies: [
                {
                  id: '3',
                  author: { name: 'Carol', handle: 'carol' },
                  content: 'd2',
                },
              ],
            },
          ],
        },
      ];

      const result = formatter.formatComments(comments, 'facebook');

      expect(result).toContain('**@alice**');
      expect(result).toContain('  ↳ **Bob**');
      expect(result).toContain('    ↳ **@carol**');
    });

    it('--- separator only appears between top-level comments, never between nested replies', () => {
      const comments: Comment[] = [
        {
          id: '1',
          author: { name: 'Alice', handle: 'alice' },
          content: 'first top',
          replies: [
            {
              id: '2',
              author: { name: 'Bob', handle: 'bob' },
              content: 'r1',
              replies: [
                {
                  id: '3',
                  author: { name: 'Carol', handle: 'carol' },
                  content: 'r2',
                },
              ],
            },
          ],
        },
        {
          id: '4',
          author: { name: 'Eve', handle: 'eve' },
          content: 'second top',
        },
      ];

      const result = formatter.formatComments(comments, 'threads');

      // Exactly one --- separator (between the two top-level comments).
      const separatorCount = (result.match(/\n---\n/g) ?? []).length;
      expect(separatorCount).toBe(1);

      // The separator sits between "first top" subtree and "second top".
      const separatorIndex = result.indexOf('\n---\n');
      expect(result.indexOf('second top')).toBeGreaterThan(separatorIndex);
      expect(result.indexOf('r2')).toBeLessThan(separatorIndex);
    });

    it('reply media indents match parent reply depth', () => {
      const comments: Comment[] = [
        {
          id: '1',
          author: { name: 'Alice', handle: 'alice' },
          content: 'top',
          replies: [
            {
              id: '2',
              author: { name: 'Bob', handle: 'bob' },
              content: 'd1',
              replies: [
                {
                  id: '3',
                  author: { name: 'Carol', handle: 'carol' },
                  content: 'd2 with media',
                  media: [{ type: 'image', url: 'https://example.com/a.jpg' }],
                },
              ],
            },
          ],
        },
      ];

      const result = formatter.formatComments(comments, 'threads');

      // Depth-2 reply body is indented 4 spaces → media must match.
      expect(result).toContain('    ![image 1](https://example.com/a.jpg)');
      // No 2-space-only prefix variant on this media line.
      expect(result).not.toMatch(/\n {2}!\[image 1]\(https:\/\/example\.com\/a\.jpg\)/);
    });

    it('empty replies array produces no trailing newlines or artifacts', () => {
      const comments: Comment[] = [
        {
          id: '1',
          author: { name: 'Alice', handle: 'alice' },
          content: 'solo',
          replies: [],
        },
      ];

      const result = formatter.formatComments(comments, 'threads');

      expect(result).toBe('**@alice**\nsolo');
      expect(result.endsWith('\n')).toBe(false);
      expect(result).not.toContain('↳');
    });

    it('undefined replies array is handled identically to missing replies', () => {
      const comments: Comment[] = [
        {
          id: '1',
          author: { name: 'Alice', handle: 'alice' },
          content: 'solo',
        },
      ];

      const result = formatter.formatComments(comments, 'threads');

      expect(result).toBe('**@alice**\nsolo');
    });
  });
});
