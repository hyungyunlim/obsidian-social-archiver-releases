/**
 * Which vault notes are composed posts (prd-plugin-my-posts-two-way-sync §5.1).
 *
 * `postOrigin: composer` alone is not enough: the vault writer stamps it on
 * every platform `post` save, meeting and audio notes included. Every check
 * goes through `isComposedPostNote`, which also rules those out by
 * `contentType`.
 */

type Frontmatter = Readonly<Record<string, unknown>> | null | undefined;

/** Platform `post` notes that are recordings, never composed posts. */
export const COMPOSED_MEDIA_NOTE_TYPES: ReadonlySet<string> = new Set(['meeting-note', 'audio-note']);

/** §5.1: a composed post note — postOrigin composer and not a meeting/audio note. Local-only (not yet created) posts count. */
export function isComposedPostNote(fm: Frontmatter): boolean {
  if (fm?.postOrigin !== 'composer') return false;
  const contentType = fm.contentType;
  return !(typeof contentType === 'string' && COMPOSED_MEDIA_NOTE_TYPES.has(contentType));
}

/** frontmatter coAuthors as clean strings; [] when absent/malformed. */
export function readCoAuthors(fm: Frontmatter): string[] {
  const value = fm?.coAuthors;
  if (!Array.isArray(value)) return [];
  return value
    .filter((name): name is string => typeof name === 'string')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/**
 * §5.1-§5.2: a composed note that takes part in two-way sync: it has a
 * baseline revision and is not waiting on the user (diverged). Every push and
 * pull goes through this gate.
 */
export function isComposedSyncParticipant(fm: Frontmatter): boolean {
  return isComposedPostNote(fm)
    && typeof fm?.syncedContentRevision === 'number'
    && fm.syncState !== 'diverged';
}
