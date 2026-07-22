import type { AuthorCatalogEntry } from '@/types/author-catalog';
import type { AuthorNoteData } from '@/types/author-note';
import type { Platform, PostData } from '@/types/post';
import { getPlatformName } from '@/shared/platforms';
import { sanitizeWikilinkAlias } from '@/utils/note-mentions';

export const DEFAULT_AUTHOR_NOTE_LINK_ALIAS_FORMAT = '{author}';

export interface AuthorNoteLinkContext {
  author: string;
  displayName?: string;
  handle?: string;
  platform: Platform;
}

export function renderAuthorNoteLinkAlias(
  format: string,
  context: AuthorNoteLinkContext,
): string {
  const cleanHandle = String(context.handle ?? '').trim().replace(/^@+/, '');
  const values: Record<string, string> = {
    author: context.author.trim(),
    display_name: String(context.displayName || context.author).trim(),
    handle: cleanHandle,
    platform: getPlatformName(context.platform),
  };
  let alias = (String(format || '').trim() || DEFAULT_AUTHOR_NOTE_LINK_ALIAS_FORMAT)
    .replace(/\{(author|display_name|handle|platform)\}/g, (_match, token: string) => values[token] ?? '');
  alias = sanitizeWikilinkAlias(alias).replace(/\s+/g, ' ').trim();
  return alias || sanitizeWikilinkAlias(context.author) || 'Author';
}

export function buildAuthorNoteWikilink(filePath: string, alias: string): string {
  const target = filePath
    .replace(/\\/g, '/')
    .replace(/\.md$/i, '')
    .replace(/\[\[|\]\]|[|#^]/g, '')
    .trim();
  return target ? `[[${target}|${sanitizeWikilinkAlias(alias)}]]` : '';
}

export function buildAuthorNoteLinkForPost(
  postData: PostData,
  filePath: string,
  noteData: AuthorNoteData | null,
  aliasFormat: string,
): string {
  const alias = renderAuthorNoteLinkAlias(aliasFormat, {
    author: postData.author.name,
    displayName: noteData?.displayNameOverride,
    handle: postData.author.handle || postData.author.username,
    platform: postData.platform,
  });
  return buildAuthorNoteWikilink(filePath, alias);
}

export function buildAuthorNoteLinkForCatalogEntry(
  entry: AuthorCatalogEntry,
  filePath: string,
  noteData: AuthorNoteData | null,
  aliasFormat: string,
): string {
  const alias = renderAuthorNoteLinkAlias(aliasFormat, {
    author: entry.authorName,
    displayName: noteData?.displayNameOverride || entry.displayNameOverride,
    handle: entry.handle,
    platform: entry.platform,
  });
  return buildAuthorNoteWikilink(filePath, alias);
}
