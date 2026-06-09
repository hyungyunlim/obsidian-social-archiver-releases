/**
 * Comment-tree pure helpers (plugin copy).
 *
 * There is no shared package across surfaces, so each surface keeps its own
 * pure module (mobile `src/utils/comment-tree.ts`, share-web
 * `src/lib/utils/commentTree.ts`, plugin `src/utils/comments.ts`). These are
 * the NORMATIVE pinned-sort helpers all surfaces must agree on — see PRD R3
 * (`docs/specs/platform-comment-delete-and-pin-sync-prd.md`).
 *
 * The plugin is read-only for comment mutations in MVP (Non-Goal #4 / R10), so
 * this module only needs the read-side helpers: finding, sorting and timestamp
 * derivation. Delete/toggle mutation helpers live on the mobile/share-web
 * surfaces that own outbound mutations.
 *
 * Single Responsibility: pure comment-tree read transforms (no DOM, no I/O).
 */

import type { Comment } from '../types/post';

/**
 * Determine the most recent `pinnedAt` timestamp found ANYWHERE in a root
 * thread (the node itself or any descendant reply at any depth).
 *
 * Returns the ISO string of the newest pin, or `null` if no node in the thread
 * is pinned. Invalid / non-parseable `pinnedAt` values are ignored.
 *
 * This is the single source of truth for "is this root thread pinned, and how
 * recently" used by {@link sortPinnedCommentRoots}.
 */
export function getPinnedSortTimestamp(comment: Comment): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;

  const visit = (node: Comment): void => {
    if (node.pinnedAt) {
      const ms = Date.parse(node.pinnedAt);
      if (!Number.isNaN(ms) && ms > bestMs) {
        bestMs = ms;
        best = node.pinnedAt;
      }
    }
    if (node.replies && node.replies.length > 0) {
      for (const reply of node.replies) visit(reply);
    }
  };

  visit(comment);
  return best;
}

/**
 * Sort root comment threads so that:
 *   - Root threads containing at least one pinned node (at any depth) sort
 *     above unpinned root threads.
 *   - Pinned root threads sort by their most recent `pinnedAt` (descending).
 *   - Unpinned root threads keep their ORIGINAL relative order (stable).
 *   - Replies are never flattened or moved out of their parent thread (this
 *     only reorders the top level; nested replies are left untouched).
 *
 * Returns a NEW array; the input is not mutated.
 */
export function sortPinnedCommentRoots(comments: Comment[]): Comment[] {
  // Decorate with original index to guarantee a stable sort for ties / unpinned.
  const decorated = comments.map((comment, index) => ({
    comment,
    index,
    pinnedAt: getPinnedSortTimestamp(comment),
  }));

  decorated.sort((a, b) => {
    const aPinned = a.pinnedAt !== null;
    const bPinned = b.pinnedAt !== null;

    if (aPinned && bPinned) {
      // Both pinned — newest pin first, then stable on original order.
      const diff = Date.parse(b.pinnedAt as string) - Date.parse(a.pinnedAt as string);
      if (diff !== 0) return diff;
      return a.index - b.index;
    }

    if (aPinned) return -1; // a pinned, b not → a first
    if (bPinned) return 1; // b pinned, a not → b first

    // Neither pinned → preserve original order (stable).
    return a.index - b.index;
  });

  return decorated.map((d) => d.comment);
}

/**
 * Find a comment node by `id` anywhere in the tree (depth-first), or `null`.
 *
 * `id` is server-authoritative and immutable for the life of the archive row,
 * and is the SOLE pin/delete target key (PRD R1). No client regenerates it.
 */
export function findCommentById(comments: Comment[], commentId: string): Comment | null {
  for (const node of comments) {
    if (node.id === commentId) return node;
    if (node.replies && node.replies.length > 0) {
      const found = findCommentById(node.replies, commentId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Find the ancestor chain (root → … → target) for a comment id, or `null`.
 *
 * Used by surfaces that auto-expand the path to a pinned reply (R7). The plugin
 * renderer does not currently auto-expand collapsed branches, but the helper is
 * kept here as the shared source of truth so all surfaces derive the same path.
 */
export function findCommentPath(comments: Comment[], commentId: string): Comment[] | null {
  for (const node of comments) {
    if (node.id === commentId) return [node];
    if (node.replies && node.replies.length > 0) {
      const childPath = findCommentPath(node.replies, commentId);
      if (childPath) return [node, ...childPath];
    }
  }
  return null;
}
