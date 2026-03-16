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

      expect(result).toContain('![🎥 Video](https://example.com/thumb.jpg)');
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
});
