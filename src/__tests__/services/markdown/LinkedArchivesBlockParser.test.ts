/**
 * LinkedArchivesBlockParser tests — reverse-parse of the managed
 * `## Linked archives` block into grouped rows for the timeline card.
 */

import { describe, it, expect } from 'vitest';
import { parseLinkedArchivesBlock } from '../../../services/markdown/LinkedArchivesBlockParser';

const block = (inner: string): string =>
  [
    '# Some Note',
    '',
    'Body text.',
    '',
    '**Platform:** Web',
    '',
    '<!-- social-archiver:linked-archives:start -->',
    '',
    '---',
    '',
    '## Linked archives',
    '',
    inner,
    '',
    '<!-- social-archiver:linked-archives:end -->',
  ].join('\n');

describe('parseLinkedArchivesBlock', () => {
  it('parses both groups with markdown rows preserved', () => {
    const doc = block(
      [
        '**Links to**',
        '',
        '- [[2026-06-07 - A - Target (abc123)|Target Title]]',
        '- [External Title](https://example.com/article)',
        '',
        '**Linked from**',
        '',
        '- [[2026-06-06 - B - Source (xyz789)|Source Title]]',
      ].join('\n'),
    );

    expect(parseLinkedArchivesBlock(doc)).toEqual({
      linksTo: [
        '[[2026-06-07 - A - Target (abc123)|Target Title]]',
        '[External Title](https://example.com/article)',
      ],
      linkedFrom: ['[[2026-06-06 - B - Source (xyz789)|Source Title]]'],
    });
  });

  it('parses a single-group block', () => {
    const doc = block(['**Linked from**', '', '- [[Note|Title]]'].join('\n'));
    expect(parseLinkedArchivesBlock(doc)).toEqual({
      linksTo: [],
      linkedFrom: ['[[Note|Title]]'],
    });
  });

  it('returns null when the document has no block', () => {
    expect(parseLinkedArchivesBlock('# Note\n\nNo block here.')).toBeNull();
  });

  it('returns null for a malformed block (start without end)', () => {
    const doc = '<!-- social-archiver:linked-archives:start -->\n**Links to**\n- [[A]]';
    expect(parseLinkedArchivesBlock(doc)).toBeNull();
  });

  it('returns null when the block has headings but no rows', () => {
    const doc = block('**Links to**');
    expect(parseLinkedArchivesBlock(doc)).toBeNull();
  });

  it('ignores rows outside any group heading', () => {
    const doc = block(['- [[Orphan]]', '', '**Links to**', '', '- [[Kept]]'].join('\n'));
    expect(parseLinkedArchivesBlock(doc)).toEqual({
      linksTo: ['[[Kept]]'],
      linkedFrom: [],
    });
  });
});
