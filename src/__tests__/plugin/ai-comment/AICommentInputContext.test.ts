import { describe, expect, it } from 'vitest';
import { buildAICommentInputContent } from '../../../plugin/ai-comment/AICommentInputContext';

describe('buildAICommentInputContent', () => {
  it('prepends structured OCR context from the archive snapshot', () => {
    const result = buildAICommentInputContent('# Post\n\nBody text.', {
      archive: {
        imageText: [
          {
            imageIndex: 1,
            text: 'Screenshot text',
            source: 'ocr',
            confidence: 'unknown',
          },
        ],
      },
    });

    expect(result).toContain('## AI Context: Image OCR');
    expect(result).toContain('### Image 2');
    expect(result).toContain('Screenshot text');
    expect(result).toContain('not as a user-authored note');
    expect(result).toContain('# Post');
  });

  it('returns unchanged markdown when there is no image text', () => {
    const markdown = '# Post\n\nBody text.';

    expect(buildAICommentInputContent(markdown, { archive: {} })).toBe(markdown);
  });
});
