import { Notice } from 'obsidian';
import { t } from '../../i18n';
import type { CollectionActivityReadyEventData } from '../../types/websocket';

/**
 * Collaborative-collection activity as an Obsidian Notice
 * (prd-collections-obsidian-plugin O10). The server sends it here only when
 * neither the phone nor the desktop app got it; the wording follows the
 * apps (prd-collections-collaboration §10.5). Clicking opens the collection
 * and reports the tap like the apps do.
 */

export interface CollectionActivityNotifierDeps {
  openCollection: (collectionId: string) => void;
  markOpened: (notificationId: string) => Promise<void>;
}

/** Longer than a plain notice: it carries an action. */
const NOTICE_DURATION_MS = 10_000;

export function formatCollectionActivity(data: Pick<CollectionActivityReadyEventData, 'kind' | 'actors' | 'actorCount' | 'count' | 'visibility'>): string {
  const actor = data.actors[0] ?? '';
  const others = Math.max(0, data.actorCount - 1);
  switch (data.kind) {
    case 'items_added':
      if (others === 0) {
        return data.count === 1
          ? t('col.activity.itemsAddedOne', { actor })
          : t('col.activity.itemsAddedMany', { actor, count: data.count });
      }
      return others === 1
        ? t('col.activity.itemsAddedOther', { actor, count: data.count })
        : t('col.activity.itemsAddedOthers', { actor, others, count: data.count });
    case 'member_joined':
      if (others === 0) return t('col.activity.memberJoined', { actor });
      return others === 1
        ? t('col.activity.memberJoinedOther', { actor })
        : t('col.activity.memberJoinedOthers', { actor, others });
    case 'collection_shared':
      return data.visibility === 'public'
        ? t('col.activity.sharedPublic', { actor })
        : t('col.activity.sharedUnlisted', { actor });
  }
}

export class CollectionActivityNotifier {
  constructor(private readonly deps: CollectionActivityNotifierDeps) {}

  show(data: CollectionActivityReadyEventData): void {
    const fragment = createFragment((root) => {
      root.createEl('strong', { text: data.collectionName.slice(0, 50) });
      root.createEl('br');
      root.createSpan({ text: formatCollectionActivity(data) });
    });
    const notice = new Notice(fragment, NOTICE_DURATION_MS);
    notice.containerEl.addClass('sa-collection-activity-notice');
    notice.containerEl.setAttribute('role', 'button');
    notice.containerEl.setAttribute('aria-label', `${t('col.activity.open')}: ${data.collectionName}`);
    notice.containerEl.addEventListener('click', () => {
      notice.hide();
      this.deps.openCollection(data.collectionId);
      void this.deps.markOpened(data.notificationId).catch((error) => {
        console.debug('[Social Archiver] Marking a collection notification opened failed:', error);
      });
    });
  }
}
