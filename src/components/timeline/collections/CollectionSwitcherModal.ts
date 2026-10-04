import { App, SuggestModal, setIcon } from 'obsidian';
import { t } from '../../../i18n';
import type { CollectionSummary } from '../../../types/collections';
import { VISIBILITY_ICON, visibilityLabel } from './collectionVisuals';
import { canOfferCreate, filterCollections } from './collectionPickerModel';

/**
 * Collection list (prd-collections-obsidian-plugin §4.2) — the plugin's
 * stand-in for the apps' sidebar/drawer section. Used by the timeline's
 * Collections button and the "Open collection" / "Copy collection link"
 * commands; creating is offered inline like the picker.
 */

export type SwitcherChoice =
  | { kind: 'collection'; collection: CollectionSummary }
  | { kind: 'create'; name: string }
  | { kind: 'all' };

export interface CollectionSwitcherOptions {
  collections: CollectionSummary[];
  ownedNames: Array<{ name: string }>;
  /** Show "All posts" first (the timeline is inside a collection). */
  offerAllPosts: boolean;
  /** Offer "Create …" rows (off for commands that need an existing collection). */
  allowCreate: boolean;
  placeholder?: string;
  onChoose: (choice: SwitcherChoice) => void;
}

export class CollectionSwitcherModal extends SuggestModal<SwitcherChoice> {
  constructor(app: App, private readonly options: CollectionSwitcherOptions) {
    super(app);
    this.setPlaceholder(options.placeholder ?? t('col.cmd.chooseCollection'));
    this.emptyStateText = options.collections.length === 0 ? `${t('col.emptyTitle')}. ${t('col.emptyHint')}` : '';
    this.limit = 200;
    this.modalEl.addClass('sa-collection-switcher');
  }

  getSuggestions(query: string): SwitcherChoice[] {
    const choices: SwitcherChoice[] = [];
    if (this.options.offerAllPosts && !query.trim()) choices.push({ kind: 'all' });
    for (const collection of filterCollections(this.options.collections, query)) {
      choices.push({ kind: 'collection', collection });
    }
    if (this.options.allowCreate && canOfferCreate(this.options.ownedNames, query)) {
      choices.push({ kind: 'create', name: query.trim() });
    }
    return choices;
  }

  renderSuggestion(choice: SwitcherChoice, el: HTMLElement): void {
    el.addClass('sa-collection-suggestion');
    const icon = el.createSpan({ cls: 'sa-collection-row-icon' });
    if (choice.kind === 'all') {
      setIcon(icon, 'layout-list');
      el.createDiv({ cls: 'sa-collection-row-name', text: t('col.allPosts') });
      return;
    }
    if (choice.kind === 'create') {
      setIcon(icon, 'plus');
      el.createDiv({ cls: 'sa-collection-row-name', text: t('col.picker.createNamed', { name: choice.name }) });
      return;
    }
    const { collection } = choice;
    setIcon(icon, VISIBILITY_ICON[collection.visibility]);
    const text = el.createDiv({ cls: 'sa-collection-row-text' });
    text.createDiv({ cls: 'sa-collection-row-name', text: collection.name });
    const meta: string[] = [visibilityLabel(collection.visibility)];
    if ((collection.role ?? 'owner') === 'owner' || !collection.collaborative) {
      meta.unshift(t('col.itemCount', { count: collection.itemCount }));
    }
    if (collection.collaborative) {
      meta.push(collection.ownerUsername && (collection.role ?? 'owner') !== 'owner'
        ? `${t('col.collaborative')} · ${t('col.byOwner', { owner: collection.ownerUsername })}`
        : t('col.collaborative'));
    }
    text.createDiv({ cls: 'sa-collection-row-meta', text: meta.join(' · ') });
  }

  onChooseSuggestion(choice: SwitcherChoice): void {
    this.options.onChoose(choice);
  }
}
