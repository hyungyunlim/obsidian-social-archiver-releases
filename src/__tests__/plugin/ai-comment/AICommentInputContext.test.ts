import { describe, expect, it } from 'vitest';
import { buildAIActionInputContent, buildAICommentInputContent } from '../../../plugin/ai-comment/AICommentInputContext';

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

  it('limits Threads translation input to the post body and self-thread continuation', () => {
    const markdown = [
      '---',
      'platform: threads',
      '---',
      '> **My Note:**',
      '> private note',
      '',
      '---',
      '',
      'Main post body',
      '',
      '---',
      '',
      'Self-thread continuation',
      '',
      '---',
      '',
      `## ${String.fromCodePoint(0x1f4ac)} Comments`,
      '',
      '**@other_user**',
      'Comment that should not be translated',
      '',
      '---',
      '',
      '**Platform:** Threads | **Author:** [Author](https://www.threads.com/@author)',
      '',
      '**Original URL:** https://www.threads.com/@author/post/abc',
    ].join('\n');

    const result = buildAIActionInputContent(markdown, {
      archive: { platform: 'threads' },
    }, 'content.translate_variant');

    expect(result).toBe('Main post body\n\n---\n\nSelf-thread continuation');
    expect(result).not.toContain('private note');
    expect(result).not.toContain('Comment that should not be translated');
    expect(result).not.toContain('Platform:');
  });

  it('keeps non-translation AI action input unchanged', () => {
    const markdown = `Main post body\n\n---\n\n## ${String.fromCodePoint(0x1f4ac)} Comments\n\nComment body`;

    expect(buildAIActionInputContent(markdown, {
      archive: { platform: 'threads' },
    }, 'tags.suggest_apply')).toBe(markdown);
  });
});
