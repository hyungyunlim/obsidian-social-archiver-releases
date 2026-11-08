import { describe, expect, it } from 'vitest';
import { ContentTransformerClient } from '@/utils/ContentTransformerClient';

/** The composer escapes literal syntax characters (composerEscape); plain text shows them bare. */
describe('ContentTransformerClient.stripMarkdown — composer escapes', () => {
  it('turns escaped characters back into the characters the user typed', () => {
    expect(ContentTransformerClient.stripMarkdown('\\_기울임\\_ \\*별표\\* \\[괄호\\] \\~물결\\~ a\\\\b'))
      .toBe('_기울임_ *별표* [괄호] ~물결~ a\\b');
  });

  it('still strips real Markdown around escapes', () => {
    expect(ContentTransformerClient.stripMarkdown('**굵게** \\*아님\\* [링크](https://x.com) &lt;책&gt;'))
      .toBe('굵게 *아님* 링크 <책>');
  });
});
