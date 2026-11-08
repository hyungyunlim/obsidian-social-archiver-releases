import { describe, expect, it } from 'vitest';
import { TFile, type App, type Vault } from 'obsidian';
import { resolveQuotedPosts } from '@/components/timeline/renderers/composedQuotes';
import { splitArchiveRefLines } from '@/utils/note-mentions';

/** Quote cards of a composed post: the quoted note by sourceArchiveId, else the label. */

function fileAt(path: string): TFile {
  const file = new (TFile as unknown as new (p: string) => TFile)(path);
  file.stat = { ctime: 0, mtime: 0, size: 0 } as TFile['stat'];
  return file;
}

const QUOTED = fileAt('Social Archives/X/quoted.md');
const SELF = fileAt('Social Archives/Post/self.md');
const QUOTED_NOTE = '---\nplatform: x\n---\n\nThe original tweet\n\n---\n\n**Platform:** X\n';

const app = {
  vault: { cachedRead: async () => QUOTED_NOTE, getFiles: () => [] } as unknown as Vault,
  metadataCache: {
    getFileCache: () => ({ frontmatter: { platform: 'x', author: 'Someone', originalUrl: 'https://x.com/s/1' } }),
    getFirstLinkpathDest: () => null,
  },
} as unknown as App;

const lookup = (id: string): TFile | null => ({ abc: QUOTED, self: SELF } as Record<string, TFile>)[id] ?? null;

describe('resolveQuotedPosts', () => {
  it('parses the quoted note when the vault has it, keeps the label otherwise', async () => {
    const { refs } = splitArchiveRefLines(
      'Body\n\n[Tweet](socialarchiver://archive/abc)\n[Gone](socialarchiver://archive/zzz)\n[Me](socialarchiver://archive/self)',
    );
    const quotes = await resolveQuotedPosts(app, lookup, refs, SELF.path);

    expect(quotes.map((q) => q.ref.label)).toEqual(['Tweet', 'Gone', 'Me']);
    expect(quotes[0]?.post?.content.text).toContain('The original tweet');
    expect(quotes[1]?.post).toBeNull();
    // A ref to the post itself is never rendered as its own quote card
    expect(quotes[2]?.post).toBeNull();
  });

  it('shows labels when there is no lookup service yet', async () => {
    const quotes = await resolveQuotedPosts(app, undefined, [{ archiveId: 'abc', label: 'Tweet' }], undefined);
    expect(quotes).toEqual([{ ref: { archiveId: 'abc', label: 'Tweet' }, post: null }]);
  });
});
