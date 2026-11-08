import type { App, TFile } from 'obsidian';
import type { PostData } from '../../../types/post';
import type { ArchiveRefLine } from '../../../utils/note-mentions';

/** One trailing archive ref of a composed post, with its vault note when the vault has it. */
export interface ResolvedQuote {
  ref: ArchiveRefLine;
  post: PostData | null;
}

/**
 * Finds each quoted original's note by `sourceArchiveId` and parses it, for
 * the card and the reader alike. A ref whose note is missing (or is the post
 * itself) comes back with `post: null` and is shown by its label.
 */
export async function resolveQuotedPosts(
  app: App,
  findBySourceArchiveId: ((archiveId: string) => TFile | null) | undefined,
  refs: readonly ArchiveRefLine[],
  selfPath: string | undefined,
): Promise<ResolvedQuote[]> {
  if (refs.length === 0) return [];
  // Dynamic import: the parser pulls in most of the timeline (same as PostCardRenderer.refreshPostCardFull).
  const { PostDataParser } = await import('../parsers/PostDataParser');
  const parser = new PostDataParser(app.vault, app);
  return Promise.all(refs.map(async (ref) => {
    const file = findBySourceArchiveId?.(ref.archiveId) ?? null;
    const post = file && file.path !== selfPath ? await parser.parseFile(file) : null;
    return { ref, post };
  }));
}
