import { App, Modal, Platform, setIcon } from 'obsidian';
import { t } from '../../../i18n';
import type { LocalCollection } from '../../../types/collections';
import { COLLECTION_LIMITS } from '../../../types/collections';
import { VISIBILITY_ICON } from './collectionVisuals';
import {
  canOfferCreate,
  filterCollections,
  membershipChanges,
  toggleMembership,
  type MembershipState,
} from './collectionPickerModel';

/**
 * "Add to collection" (prd-collections-obsidian-plugin §4.2): search or
 * create, check several, Done applies. Same keyboard model as TagModal
 * (↑↓ move, ↵ toggle) plus Mod+↵ for Done. Collections the user can only
 * view are never listed (the caller passes writable ones).
 */

export interface CollectionPickerOptions {
  collections: LocalCollection[];
  /** Collections the user owns — names they can't reuse when creating. */
  ownedCollections: LocalCollection[];
  initialState: Map<string, MembershipState>;
  create: (name: string) => LocalCollection | null;
  apply: (changes: Array<{ collectionId: string; include: boolean }>) => void;
}

export class CollectionPickerModal extends Modal {
  private readonly state: Map<string, MembershipState>;
  private collections: LocalCollection[];
  private searchInput: HTMLInputElement | null = null;
  private listEl: HTMLElement | null = null;
  private highlighted = -1;
  private rowCount = 0;

  constructor(app: App, private readonly options: CollectionPickerOptions) {
    super(app);
    this.state = new Map(options.initialState);
    this.collections = [...options.collections];
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    modalEl.addClass('sa-collection-picker');
    if (Platform.isMobile) modalEl.addClass('sa-collection-modal-mobile');
    this.setTitle(t('col.picker.title'));

    this.searchInput = contentEl.createEl('input', {
      type: 'text',
      placeholder: t('col.picker.search'),
      cls: 'sa-collection-search',
    });
    this.searchInput.maxLength = COLLECTION_LIMITS.nameMaxLength;
    this.searchInput.setAttribute('aria-label', t('col.picker.search'));
    this.searchInput.addEventListener('input', () => {
      this.highlighted = -1;
      this.renderList();
    });

    this.listEl = contentEl.createDiv({ cls: 'sa-collection-picker-list', attr: { role: 'listbox', 'aria-multiselectable': 'true' } });

    const footer = contentEl.createDiv({ cls: 'sa-collection-modal-footer' });
    const done = footer.createEl('button', { text: t('col.picker.done'), cls: 'mod-cta' });
    done.addEventListener('click', () => this.finish());

    this.scope.register([], 'ArrowDown', () => this.move(1));
    this.scope.register([], 'ArrowUp', () => this.move(-1));
    this.scope.register([], 'Enter', () => this.activateHighlighted());
    this.scope.register(['Mod'], 'Enter', () => {
      this.finish();
      return false;
    });

    this.renderList();
    window.setTimeout(() => this.searchInput?.focus(), 10);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private finish(): void {
    const changes = membershipChanges(this.options.initialState, this.state);
    this.close();
    if (changes.length > 0) this.options.apply(changes);
  }

  private renderList(): void {
    const list = this.listEl;
    if (!list) return;
    list.empty();
    const query = this.searchInput?.value ?? '';
    const visible = filterCollections(this.collections, query);

    for (const collection of visible) {
      const state = this.state.get(collection.id) ?? 'none';
      const row = list.createDiv({
        cls: 'sa-collection-row',
        attr: {
          role: 'option',
          'aria-selected': String(state === 'all'),
          'aria-checked': state === 'some' ? 'mixed' : String(state === 'all'),
        },
      });
      const check = row.createSpan({ cls: 'sa-collection-row-check' });
      setIcon(check, state === 'all' ? 'check-square' : state === 'some' ? 'minus-square' : 'square');
      const icon = row.createSpan({ cls: 'sa-collection-row-icon' });
      setIcon(icon, VISIBILITY_ICON[collection.visibility]);
      const text = row.createDiv({ cls: 'sa-collection-row-text' });
      text.createDiv({ cls: 'sa-collection-row-name', text: collection.name });
      if (state === 'some') text.createDiv({ cls: 'sa-collection-row-meta', text: t('col.picker.partial') });
      else if (collection.collaborative && collection.ownerUsername && (collection.role ?? 'owner') !== 'owner') {
        text.createDiv({ cls: 'sa-collection-row-meta', text: `${t('col.collaborative')} · ${t('col.byOwner', { owner: collection.ownerUsername })}` });
      }
      row.addEventListener('click', () => {
        this.state.set(collection.id, toggleMembership(state));
        this.renderList();
      });
    }

    const offerCreate = canOfferCreate(this.options.ownedCollections, query);
    if (offerCreate) {
      const name = query.trim();
      const row = list.createDiv({ cls: 'sa-collection-row sa-collection-row-create', attr: { role: 'option' } });
      const icon = row.createSpan({ cls: 'sa-collection-row-icon' });
      setIcon(icon, 'plus');
      row.createDiv({ cls: 'sa-collection-row-name', text: t('col.picker.createNamed', { name }) });
      row.addEventListener('click', () => {
        const created = this.options.create(name);
        if (!created) return;
        if (!this.collections.some((c) => c.id === created.id)) this.collections = [created, ...this.collections];
        this.state.set(created.id, 'all');
        if (this.searchInput) this.searchInput.value = '';
        this.highlighted = -1;
        this.renderList();
      });
    }

    if (visible.length === 0 && !offerCreate) {
      list.createDiv({ cls: 'sa-collection-empty', text: this.collections.length === 0 ? t('col.emptyHint') : t('col.picker.noneWritable') });
    }

    this.rowCount = visible.length + (offerCreate ? 1 : 0);
    this.paintHighlight();
  }

  private move(delta: number): boolean {
    if (this.rowCount === 0) return false;
    this.highlighted = Math.max(-1, Math.min(this.rowCount - 1, this.highlighted + delta));
    this.paintHighlight();
    if (this.highlighted === -1) this.searchInput?.focus();
    return false;
  }

  private activateHighlighted(): boolean {
    const rows = this.listEl?.querySelectorAll<HTMLElement>('.sa-collection-row');
    if (!rows || rows.length === 0) return true;
    // No highlight: Enter creates when "Create …" is the only sensible action.
    const target = this.highlighted >= 0 ? rows[this.highlighted] : rows.length === 1 ? rows[0] : undefined;
    if (!target) return true;
    target.click();
    return false;
  }

  private paintHighlight(): void {
    const rows = this.listEl?.querySelectorAll<HTMLElement>('.sa-collection-row');
    rows?.forEach((row, index) => {
      row.toggleClass('is-selected', index === this.highlighted);
      if (index === this.highlighted) row.scrollIntoView({ block: 'nearest' });
    });
  }
}
