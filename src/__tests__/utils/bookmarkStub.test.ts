import { describe, expect, it } from 'vitest';
import { isBookmarkStubNote, isBookmarkStubPostId } from '../../utils/bookmarkStub';

describe('isBookmarkStubPostId', () => {
  it('accepts bm- plus 16 lowercase hex chars', () => {
    expect(isBookmarkStubPostId('bm-0123456789abcdef')).toBe(true);
  });

  it.each([
    ['real post id', 'DRPFtcOEvbl'],
    ['web fallback id', 'web-fallback-lx2k9'],
    ['too short', 'bm-0123456789abcde'],
    ['too long', 'bm-0123456789abcdef0'],
    ['uppercase hex', 'bm-0123456789ABCDEF'],
    ['no prefix', '0123456789abcdef'],
    ['empty', ''],
    ['not a string', 42],
    ['undefined', undefined],
  ])('rejects %s', (_label, id) => {
    expect(isBookmarkStubPostId(id)).toBe(false);
  });
});

describe('isBookmarkStubNote', () => {
  it('reads the postId frontmatter key', () => {
    expect(isBookmarkStubNote({ platform: 'web', postId: 'bm-0123456789abcdef' })).toBe(true);
  });

  it('is false for notes without a stub postId', () => {
    expect(isBookmarkStubNote({ platform: 'web', sourceArchiveId: 'abc' })).toBe(false);
    expect(isBookmarkStubNote({ postId: 'DRPFtcOEvbl' })).toBe(false);
    expect(isBookmarkStubNote(null)).toBe(false);
    expect(isBookmarkStubNote(undefined)).toBe(false);
  });
});
