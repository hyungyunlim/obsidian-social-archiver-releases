import { TFile, type App } from 'obsidian';
import type { PostData } from '../../../types/post';

/**
 * Server archive id of a timeline post: `post.sourceArchiveId`, else the
 * note's current frontmatter (a note uploaded after the post was parsed).
 * Shared by the post card and reader so both resolve the same id.
 */
export function resolvePostArchiveId(app: App, post: Pick<PostData, 'sourceArchiveId' | 'filePath'>): string | null {
  if (post.sourceArchiveId) return post.sourceArchiveId;
  if (!post.filePath) return null;
  const file = app.vault.getAbstractFileByPath(post.filePath);
  if (!(file instanceof TFile)) return null;
  const frontmatter: unknown = app.metadataCache.getFileCache(file)?.frontmatter;
  const sourceArchiveId = frontmatter && typeof frontmatter === 'object'
    ? (frontmatter as Record<string, unknown>).sourceArchiveId
    : undefined;
  return typeof sourceArchiveId === 'string' && sourceArchiveId.length > 0 ? sourceArchiveId : null;
}
