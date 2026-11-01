/**
 * Link-only bookmark stubs (bookmark batch import): server archives holding a
 * page excerpt and a link, with post id `bm-` + the first 16 hex chars of
 * SHA-256(url). Archiving that URL for real later fills the stub's server row
 * in place — same archive id, real post id — and the vault note made from the
 * stub has to be rewritten in place with it.
 *
 * Notes record no post id, so a stub note carries its own as `postId` in
 * frontmatter (written only for stubs). A rewrite from a real archive drops it.
 */
const BOOKMARK_STUB_POST_ID = /^bm-[0-9a-f]{16}$/;

export function isBookmarkStubPostId(id: unknown): boolean {
  return typeof id === 'string' && BOOKMARK_STUB_POST_ID.test(id);
}

export function isBookmarkStubNote(frontmatter: Record<string, unknown> | null | undefined): boolean {
  return isBookmarkStubPostId(frontmatter?.postId);
}
