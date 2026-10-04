import { setIcon } from 'obsidian';
import { t } from '../../../i18n';
import type { LocalCollection } from '../../../types/collections';
import { VISIBILITY_ICON, roleLabel, visibilityLabel } from './collectionVisuals';

/**
 * The bar above the timeline while a collection is open — the plugin's
 * counterpart of the apps' collection header: back to all posts, the name,
 * who can see it, and the collection's actions.
 */

export interface CollectionModeBarProps {
  collection: LocalCollection;
  /** This user's own posts in it. */
  myItemCount: number;
  /** Of those, how many have no note in this vault. */
  notInVaultCount: number;
  onBack: () => void;
  /** Owner: one-tap share (copy link). */
  onCopyLink?: () => void;
  onMenu: (event: MouseEvent) => void;
}

export function renderCollectionModeBar(parent: HTMLElement, props: CollectionModeBarProps): HTMLElement {
  const { collection } = props;
  const role = collection.role ?? 'owner';
  const bar = parent.createDiv({ cls: 'sa-collection-bar max-w-2xl mx-auto' });

  const top = bar.createDiv({ cls: 'sa-collection-bar-top' });
  const back = top.createEl('button', { cls: 'sa-collection-bar-back clickable-icon', attr: { 'aria-label': t('col.allPosts'), title: t('col.allPosts') } });
  setIcon(back, 'arrow-left');
  back.addEventListener('click', () => props.onBack());

  const titleWrap = top.createDiv({ cls: 'sa-collection-bar-title' });
  const icon = titleWrap.createSpan({ cls: 'sa-collection-bar-icon', attr: { title: visibilityLabel(collection.visibility) } });
  setIcon(icon, VISIBILITY_ICON[collection.visibility]);
  titleWrap.createEl('h3', { cls: 'sa-collection-bar-name', text: collection.name });

  const actions = top.createDiv({ cls: 'sa-collection-bar-actions' });
  if (props.onCopyLink) {
    const share = actions.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('col.action.copyLink'), title: t('col.action.copyLink') } });
    setIcon(share, 'link');
    share.addEventListener('click', () => props.onCopyLink?.());
  }
  const more = actions.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('col.action.more'), title: t('col.action.more') } });
  setIcon(more, 'more-horizontal');
  more.addEventListener('click', (event) => props.onMenu(event));

  const meta: string[] = [];
  if (!collection.collaborative) meta.push(t('col.itemCount', { count: props.myItemCount }));
  meta.push(visibilityLabel(collection.visibility));
  if (collection.collaborative) {
    meta.push(role === 'owner' || !collection.ownerUsername
      ? t('col.collaborative')
      : `${t('col.collaborative')} · ${t('col.byOwner', { owner: collection.ownerUsername })} · ${roleLabel(role)}`);
  }
  bar.createDiv({ cls: 'sa-collection-bar-meta', text: meta.join(' · ') });

  if (collection.description) bar.createDiv({ cls: 'sa-collection-bar-description', text: collection.description });

  if (props.notInVaultCount > 0 && !collection.collaborative) {
    bar.createDiv({ cls: 'sa-collection-bar-note', text: t('col.notInVault', { count: props.notInVaultCount }) });
  }
  return bar;
}
