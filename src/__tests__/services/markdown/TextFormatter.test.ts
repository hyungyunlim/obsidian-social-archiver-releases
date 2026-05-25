import { describe, expect, it } from 'vitest';
import { TextFormatter } from '@/services/markdown/formatters/TextFormatter';

describe('TextFormatter', () => {
  describe('linkifyRedditReferences', () => {
    it('converts subreddit and user references to markdown links', () => {
      const formatter = new TextFormatter();

      const result = formatter.linkifyRedditReferences(
        'Discussed in r/mildlyinfuriating with /u/example_user and /r/ObsidianMD.',
      );

      expect(result).toBe(
        'Discussed in [r/mildlyinfuriating](https://www.reddit.com/r/mildlyinfuriating/) with [/u/example_user](https://www.reddit.com/user/example_user/) and [/r/ObsidianMD](https://www.reddit.com/r/ObsidianMD/).',
      );
    });

    it('does not rewrite existing markdown links, inline code, or URLs', () => {
      const formatter = new TextFormatter();

      const result = formatter.linkifyRedditReferences(
        'Already [r/cycling](https://www.reddit.com/r/cycling/) and `r/code` plus https://www.reddit.com/r/plain/.',
      );

      expect(result).toBe(
        'Already [r/cycling](https://www.reddit.com/r/cycling/) and `r/code` plus https://www.reddit.com/r/plain/.',
      );
    });
  });
});
