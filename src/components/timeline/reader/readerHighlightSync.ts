/**
 * readerHighlightSync
 *
 * Single Responsibility: push ONE reader-mode highlight edit to the server
 * without touching any other highlight on the archive.
 *
 * `PATCH /api/user/archives/:id` replaces `userHighlights` wholesale, while
 * reader mode only knows the highlights it can rebuild from the note's
 * `==marks==` (fresh ids, yellow, no note). Sending that list wiped every
 * highlight's id, color and note. So the payload is always the server's
 * current array with just this one change applied.
 */

import type { TextHighlight } from '@/types/annotations';
import type { WorkersAPIClient } from '@/services/WorkersAPIClient';

export type ReaderHighlightChange =
  | { readonly type: 'add'; readonly highlight: TextHighlight }
  | { readonly type: 'remove'; readonly highlight: TextHighlight };

type ReaderHighlightSyncClient = Pick<WorkersAPIClient, 'getUserArchive' | 'updateArchiveActions'>;

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * Index of the server highlight a reader-side highlight stands for.
 *
 * Highlights made in this reader session carry the server id. Ones rebuilt
 * from `==marks==` don't, so they match on the mark text (marks hold the
 * trimmed highlight text), using `contextBefore` to pick between repeats.
 * ponytail: a mark whose markdown differs from the server's plain text
 * (e.g. `**bold**` inside it) doesn't match, so the server keeps that
 * highlight. That is the safe direction; seed reader mode from the server
 * if it ever matters.
 */
function findServerIndex(server: readonly TextHighlight[], target: TextHighlight): number {
  const byId = server.findIndex((h) => h.id === target.id);
  if (byId >= 0) return byId;

  const text = normalize(target.text);
  if (!text) return -1;
  const candidates = server
    .map((h, index) => ({ h, index }))
    .filter(({ h }) => normalize(h.text) === text);
  if (candidates.length <= 1) return candidates[0]?.index ?? -1;

  const tail = (context?: string): string => normalize(context ?? '').slice(-10);
  const targetTail = tail(target.contextBefore);
  const byContext = candidates.find(({ h }) => {
    const serverTail = tail(h.contextBefore);
    return !!targetTail && !!serverTail && (targetTail.endsWith(serverTail) || serverTail.endsWith(targetTail));
  });
  return (byContext ?? candidates[0])?.index ?? -1;
}

/**
 * Apply one reader edit to the server's highlight array. Returns the input
 * array itself when nothing changes, so callers can skip the PATCH.
 */
export function applyReaderHighlightChange(
  server: TextHighlight[],
  change: ReaderHighlightChange
): TextHighlight[] {
  if (change.type === 'add') {
    return server.some((h) => h.id === change.highlight.id) ? server : [...server, change.highlight];
  }
  const index = findServerIndex(server, change.highlight);
  return index < 0 ? server : server.filter((_, i) => i !== index);
}

/**
 * Read the archive's current highlights, apply `change`, and PATCH the result.
 * Throws on network failure — never falls back to sending a local list.
 */
export async function syncReaderHighlightChange(
  client: ReaderHighlightSyncClient,
  archiveId: string,
  change: ReaderHighlightChange
): Promise<void> {
  const { archive } = await client.getUserArchive(archiveId);
  const current = archive.userHighlights ?? [];
  const next = applyReaderHighlightChange(current, change);
  if (next === current) return;
  await client.updateArchiveActions(archiveId, { userHighlights: next });
}
