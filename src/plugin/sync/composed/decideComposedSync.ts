/**
 * The two-way sync rule for one composed post (prd-plugin-my-posts-two-way-sync §3).
 *
 * | note changed | server changed | action   |
 * | no           | no             | none     |
 * | yes          | no             | push     |
 * | no           | yes            | pull     |
 * | yes          | yes            | conflict |
 */

export type ComposedSyncAction = 'none' | 'push' | 'pull' | 'conflict';

export function decideComposedSync(i: { noteChanged: boolean; serverRevision: number; syncedRevision: number }): ComposedSyncAction {
  const serverChanged = i.serverRevision > i.syncedRevision;
  if (i.noteChanged) return serverChanged ? 'conflict' : 'push';
  return serverChanged ? 'pull' : 'none';
}
