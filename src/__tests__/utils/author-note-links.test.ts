import { describe, expect, it } from 'vitest';
import {
  buildAuthorNoteWikilink,
  renderAuthorNoteLinkAlias,
} from '@/utils/author-note-links';

describe('author note links', () => {
  it('renders supported alias tokens and removes a leading handle @', () => {
    expect(renderAuthorNoteLinkAlias('{display_name} (@{handle}) · {platform}', {
      author: 'Jane Doe',
      displayName: 'Jane',
      handle: '@janedoe',
      platform: 'instagram',
    })).toBe('Jane (@janedoe) · Instagram');
  });

  it('sanitizes wikilink control characters and falls back to the author', () => {
    expect(renderAuthorNoteLinkAlias('{display_name}', {
      author: 'Jane|Doe',
      displayName: '[[Jane#Bio]]',
      platform: 'x',
    })).toBe('JaneBio');
    expect(renderAuthorNoteLinkAlias('{handle}', {
      author: 'Jane Doe',
      handle: '',
      platform: 'x',
    })).toBe('Jane Doe');
  });

  it('uses the actual vault path without the markdown extension', () => {
    expect(buildAuthorNoteWikilink('Social Authors/instagram-janedoe.md', 'Jane Doe'))
      .toBe('[[Social Authors/instagram-janedoe|Jane Doe]]');
  });
});
