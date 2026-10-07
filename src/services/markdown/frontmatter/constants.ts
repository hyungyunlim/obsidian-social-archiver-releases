/**
 * Frontmatter constants.
 *
 * Fields in {@link USER_CONTROLLED_FRONTMATTER_FIELDS} are owned by the user
 * (or by user-initiated flows) rather than by the archiver. They must be
 * preserved across re-archive / update operations so that user intent isn't
 * clobbered by a freshly regenerated frontmatter block.
 *
 * Adding a field to this list means both:
 * - `FrontmatterGenerator` will copy it from the existing frontmatter when
 *   provided, even if the fresh {@link YamlFrontmatter} would omit it.
 * - `VaultStorageService` will carry it forward on update.
 *
 * @see {@link file://../../types/archive.ts YamlFrontmatter}
 */
export const USER_CONTROLLED_FRONTMATTER_FIELDS = [
  // Share controls (user-controlled publish state)
  'share',
  'shareId',
  'shareUrl',
  'sharePassword',
  // User-curated state
  'archive',
  'like',
  'comment',
  'tags',
  'archiveTags',
  // Collections the note is in (prd-collections-obsidian-plugin O6; written only when mirroring is on)
  'archiveCollections',
  // Vault-local relationship to an author note
  'authorNote',
  // Per-URL download/transcription decisions
  'downloadedUrls',
  'transcribedUrls',
  // Large Media Guard (prd-large-media-guard.md)
  'mediaDetached',
  'mediaPromptSuppressed',
  'mediaSourceUrls',
] as const;

export type UserControlledFrontmatterField =
  typeof USER_CONTROLLED_FRONTMATTER_FIELDS[number];

/**
 * Set form for O(1) membership checks.
 */
export const USER_CONTROLLED_FRONTMATTER_FIELD_SET: ReadonlySet<string> =
  new Set<string>(USER_CONTROLLED_FRONTMATTER_FIELDS);

/**
 * Fields binding a composed note to its server row, written by
 * `ComposedPostSyncService`. Frontmatter rebuilt from an edit's `PostData`
 * lacks them, and without them the note detaches: later edits never sync, and
 * inbound sync can't match the server row, so it imports a duplicate note.
 * `syncedContentHash` (the post the server last accepted) is kept so an edit
 * that changes nothing the server stores doesn't send it again, and
 * `syncedMedia`/`syncedMediaNext` (its uploaded embeds, the next unused upload
 * index) so an edit uploads only the embeds it adds, under fresh URLs.
 */
export const COMPOSED_POST_SYNC_FRONTMATTER_FIELDS = [
  'postOrigin',
  'clientPostId',
  'sourceArchiveId',
  'syncState',
  'serverSyncedAt',
  'syncedContentHash',
  'syncedMedia',
  'syncedMediaNext',
] as const;
