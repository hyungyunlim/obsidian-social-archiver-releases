import { App, Menu, Notice } from 'obsidian';
import { t } from '../../i18n';
import { showConfirmModal } from '../../utils/confirm-modal';
import { shareIdFromUrl } from '../../utils/shareUrl';
import type { CollectionStore } from '../../services/collections/CollectionStore';
import type { CollectionService, OnlineFailure } from '../../services/collections/CollectionService';
import type { CollectionDisplayMode, CollectionSummary, LocalCollection } from '../../types/collections';
import { canContribute, canEditDetails, canManage } from '../../types/collections';
import { CollectionPickerModal } from '../../components/timeline/collections/CollectionPickerModal';
import { CollectionSwitcherModal, type SwitcherChoice } from '../../components/timeline/collections/CollectionSwitcherModal';
import { CollectionEditModal, type CollectionEditError } from '../../components/timeline/collections/CollectionEditModal';
import { CollectionShareSettingsModal } from '../../components/timeline/collections/CollectionShareSettingsModal';
import { CollectionMembersModal } from '../../components/timeline/collections/CollectionMembersModal';
import { PostShareSettingsModal } from '../../components/timeline/collections/PostShareSettingsModal';
import { computeMembership } from '../../components/timeline/collections/collectionPickerModel';

/**
 * Every collection action the UI offers, in one place (prd-collections-obsidian-plugin §4.2):
 * the timeline's Collections button and collection bar, post cards, the bulk
 * bar, commands, the file menu and activity notices all call these, so the
 * flows (confirmations, the Preview-vs-full warning, failure notices) are
 * written once.
 */

export interface CollectionUiDeps {
  app: App;
  service: CollectionService;
  store: CollectionStore;
  isSignedIn: () => boolean;
  username: () => string | null;
  /** The share page's first view, from the timeline's current view. */
  currentDisplayMode: () => CollectionDisplayMode;
  openCollection: (collectionId: string) => void;
  /** Phase 3: "Create base from collection"; absent = not offered. */
  createBase?: (collectionId: string) => Promise<void>;
}

/** A post the picker can act on: only notes linked to an archive on the server. */
export interface CollectablePost {
  sourceArchiveId?: string;
  isLocalOnly?: boolean;
}

export class CollectionUiActions {
  constructor(private readonly deps: CollectionUiDeps) {}

  // ---------------------------------------------------------------------------
  // Adding posts
  // ---------------------------------------------------------------------------

  /** Picker for one or more posts. Local-only notes are skipped with a hint. */
  openPickerForPosts(posts: readonly CollectablePost[], onApplied?: () => void): void {
    if (!this.requireSignIn()) return;
    const archiveIds = [...new Set(posts.map((post) => post.sourceArchiveId).filter((id): id is string => Boolean(id)))];
    if (archiveIds.length === 0) {
      new Notice(posts.some((post) => post.isLocalOnly) ? t('col.localOnly') : t('col.notArchive'));
      return;
    }
    this.openPickerForArchives(archiveIds, onApplied);
  }

  openPickerForArchives(archiveIds: readonly string[], onApplied?: () => void): void {
    if (!this.requireSignIn() || archiveIds.length === 0) return;
    const { service, store } = this.deps;
    const writable = service.getWritableCollections();
    const owned = store.getCollections().filter((collection) => (collection.role ?? 'owner') === 'owner');
    const initialState = computeMembership(writable.map((c) => c.id), archiveIds, (archiveId) => store.getCollectionIdsForArchive(archiveId));
    new CollectionPickerModal(this.deps.app, {
      collections: writable,
      ownedCollections: owned,
      initialState,
      create: (name) => {
        const result = service.create(name);
        if (result.ok) return result.collection;
        new Notice(result.reason === 'limit' ? t('col.limitReached') : t('col.failed'));
        return null;
      },
      apply: (changes) => {
        service.applyMembership(archiveIds, changes);
        new Notice(this.describeChanges(changes));
        onApplied?.();
      },
    }).open();
  }

  removeFromCollection(collectionId: string, archiveIds: readonly string[]): void {
    const collection = this.deps.store.getCollection(collectionId);
    if (!collection || !canContribute(collection.role ?? 'owner')) {
      new Notice(t('col.toast.forbidden'));
      return;
    }
    this.deps.service.applyMembership(archiveIds, [{ collectionId: collection.id, include: false }]);
    new Notice(t('col.toast.removed', { name: collection.name }));
  }

  private describeChanges(changes: ReadonlyArray<{ collectionId: string; include: boolean }>): string {
    const added = changes.filter((change) => change.include);
    const removed = changes.filter((change) => !change.include);
    const nameOf = (id: string): string => this.deps.store.getCollection(id)?.name ?? '';
    const [firstAdded] = added;
    const [firstRemoved] = removed;
    if (removed.length === 0 && added.length === 1 && firstAdded) return t('col.toast.addedOne', { name: nameOf(firstAdded.collectionId) });
    if (removed.length === 0 && added.length > 1) return t('col.toast.addedMany', { count: added.length });
    if (added.length === 0 && removed.length === 1 && firstRemoved) return t('col.toast.removed', { name: nameOf(firstRemoved.collectionId) });
    return t('col.toast.updated');
  }

  // ---------------------------------------------------------------------------
  // Choosing, creating, editing
  // ---------------------------------------------------------------------------

  /** The collection list. Default action: open the chosen collection in the timeline. */
  openSwitcher(options: {
    offerAllPosts?: boolean;
    allowCreate?: boolean;
    placeholder?: string;
    /** Limit the list (e.g. collections this note is in, or ones I own). */
    filter?: (collection: CollectionSummary) => boolean;
    onChoose?: (choice: SwitcherChoice) => void;
  } = {}): void {
    if (!this.requireSignIn()) return;
    const all = this.deps.store.getCollections();
    const collections = options.filter ? all.filter(options.filter) : all;
    new CollectionSwitcherModal(this.deps.app, {
      collections,
      ownedNames: all.filter((collection) => (collection.role ?? 'owner') === 'owner'),
      offerAllPosts: options.offerAllPosts ?? false,
      allowCreate: options.allowCreate ?? true,
      placeholder: options.placeholder,
      onChoose: options.onChoose ?? ((choice) => this.handleSwitcherChoice(choice)),
    }).open();
  }

  private handleSwitcherChoice(choice: SwitcherChoice): void {
    if (choice.kind === 'collection') this.deps.openCollection(choice.collection.id);
    else if (choice.kind === 'create') {
      const result = this.deps.service.create(choice.name);
      if (result.ok) this.deps.openCollection(result.collection.id);
      else new Notice(result.reason === 'limit' ? t('col.limitReached') : t('col.failed'));
    }
  }

  openCreate(onCreated?: (collection: LocalCollection) => void): void {
    if (!this.requireSignIn()) return;
    new CollectionEditModal(this.deps.app, {
      submit: ({ name, description }): CollectionEditError => {
        const result = this.deps.service.create(name, description);
        if (!result.ok) return result.reason;
        if (result.existed) return 'name-taken';
        onCreated?.(result.collection);
        return null;
      },
    }).open();
  }

  openEdit(collectionId: string): void {
    const collection = this.deps.store.getCollection(collectionId);
    if (!collection || !canEditDetails(collection.role ?? 'owner')) return;
    new CollectionEditModal(this.deps.app, {
      collection,
      submit: ({ name, description }): CollectionEditError => {
        if (this.deps.store.hasNameConflict(name, collection.id) && (collection.role ?? 'owner') === 'owner') return 'name-taken';
        return this.deps.service.update(collection.id, { name, description }) ? null : 'invalid-name';
      },
      onDelete: canManage(collection.role ?? 'owner') ? () => void this.confirmDelete(collection.id) : undefined,
    }).open();
  }

  async confirmDelete(collectionId: string): Promise<boolean> {
    const collection = this.deps.store.getCollection(collectionId);
    if (!collection || !canManage(collection.role ?? 'owner')) return false;
    const confirmed = await showConfirmModal(this.deps.app, {
      title: t('col.deleteConfirmTitle', { name: collection.name }),
      message: collection.collaborative ? t('col.deleteConfirmBodyShared') : t('col.deleteConfirmBody'),
      confirmText: t('col.delete'),
      cancelText: t('col.edit.cancel'),
      confirmClass: 'danger',
    });
    if (!confirmed) return false;
    if (this.deps.service.delete(collection.id)) new Notice(t('col.deleted'));
    return true;
  }

  async confirmLeave(collectionId: string): Promise<boolean> {
    const collection = this.deps.store.getCollection(collectionId);
    if (!collection || (collection.role ?? 'owner') === 'owner') return false;
    const confirmed = await showConfirmModal(this.deps.app, {
      title: t('col.leaveConfirmTitle', { name: collection.name }),
      message: t('col.leaveConfirmBody'),
      confirmText: t('col.leave'),
      cancelText: t('col.edit.cancel'),
      confirmClass: 'danger',
    });
    if (!confirmed) return false;
    const result = await this.deps.service.leave(collection.id);
    if (result.ok) new Notice(t('col.left', { name: collection.name }));
    else this.reportFailure(result.reason, t('col.members.updateFailed'));
    return result.ok;
  }

  // ---------------------------------------------------------------------------
  // Sharing
  // ---------------------------------------------------------------------------

  /** One-tap share for owners: asks before a private collection goes public-ish, then copies the link. */
  async copyLink(collectionId: string): Promise<void> {
    const collection = this.deps.store.getCollection(collectionId);
    if (!collection || !canManage(collection.role ?? 'owner')) return;
    if (collection.visibility === 'private' && !(await this.confirmLeavingPrivate())) return;
    const result = await this.deps.service.shareForLink(collection.id, this.deps.currentDisplayMode());
    if (!result.ok || !result.value.shareUrl) {
      this.reportFailure(result.ok ? 'failed' : result.reason, t('col.toast.shareFailed'));
      return;
    }
    await this.copyText(result.value.shareUrl, t('col.toast.linkCopied'));
  }

  openShareSettings(collectionId: string): void {
    const collection = this.deps.store.getCollection(collectionId);
    if (!collection || !canManage(collection.role ?? 'owner')) return;
    const { service } = this.deps;
    new CollectionShareSettingsModal(this.deps.app, {
      collection,
      load: () => service.getShareState(collection.id),
      update: (update) => service.updateShare(collection.id, update),
      rotate: () => service.rotateLink(collection.id),
      confirmLeavingPrivate: () => this.confirmLeavingPrivate(),
      confirm: (options) => showConfirmModal(this.deps.app, { ...options, cancelText: t('col.edit.cancel'), confirmClass: 'danger' }),
      copy: (url) => this.copyText(url, t('col.toast.linkCopied')),
      reportFailure: (reason, action) => this.reportFailure(reason, action === 'load' ? t('col.share.loadFailed') : t('col.share.updateFailed')),
    }).open();
  }

  /** Share settings of one shared post; the share id is the last segment of its URL. */
  openPostShareSettings(shareUrl: string): void {
    if (!this.requireSignIn()) return;
    const shareId = shareIdFromUrl(shareUrl);
    if (!shareId) return;
    const { service } = this.deps;
    new PostShareSettingsModal(this.deps.app, {
      load: () => service.getPostShareSettings(shareId),
      update: (patch) => service.updatePostShareSettings(shareId, patch),
      copy: (url) => this.copyText(url, t('col.toast.linkCopied')),
      reportFailure: (reason, action) => {
        if (reason === 'lost') new Notice(t('col.share.gone'));
        else this.reportFailure(reason, action === 'load' ? t('col.share.loadFailed') : t('col.share.updateFailed'));
      },
    }).open();
  }

  /** O8: the plugin's Preview mode doesn't reach collections, so say so before one is shared. */
  confirmLeavingPrivate(): Promise<boolean> {
    return showConfirmModal(this.deps.app, {
      title: t('col.share.fullContentTitle'),
      message: t('col.share.fullContentBody'),
      confirmText: t('col.share.fullContentConfirm'),
      cancelText: t('col.edit.cancel'),
      confirmClass: 'warning',
    });
  }

  // ---------------------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------------------

  openMembers(collectionId: string): void {
    const collection = this.deps.store.getCollection(collectionId);
    if (!collection) return;
    const { service } = this.deps;
    const id = collection.id;
    new CollectionMembersModal(this.deps.app, {
      collection,
      username: this.deps.username(),
      getMembers: () => service.getMembers(id),
      listInvites: () => service.listInvites(id),
      createInvite: (role, days) => service.createInvite(id, role, days),
      revokeInvite: (token) => service.revokeInvite(id, token),
      changeRole: (username, role) => service.changeMemberRole(id, username, role),
      removeMember: (username) => service.removeMember(id, username),
      setMyAnnotations: (include) => service.setMyAnnotations(id, include),
      leave: () => void this.confirmLeave(id),
      copy: (url, message) => this.copyText(url, message),
      confirm: (options) => showConfirmModal(this.deps.app, { ...options, cancelText: t('col.edit.cancel'), confirmClass: 'danger' }),
      notify: (message) => new Notice(message),
      reportFailure: (reason, fallback) => this.reportFailure(reason, fallback),
    }).open();
  }

  // ---------------------------------------------------------------------------
  // Menus
  // ---------------------------------------------------------------------------

  /** The collection's actions, by role (the apps' sidebar menu). */
  fillCollectionMenu(menu: Menu, collectionId: string): void {
    const collection = this.deps.store.getCollection(collectionId);
    if (!collection) return;
    const role = collection.role ?? 'owner';
    if (canManage(role)) {
      menu.addItem((item) => item.setIcon('link').setTitle(t('col.action.copyLink')).onClick(() => void this.copyLink(collection.id)));
      menu.addItem((item) => item.setIcon('share-2').setTitle(t('col.action.shareSettings')).onClick(() => this.openShareSettings(collection.id)));
    }
    menu.addItem((item) => item.setIcon('users').setTitle(t('col.action.members')).onClick(() => this.openMembers(collection.id)));
    if (canEditDetails(role)) {
      menu.addItem((item) => item.setIcon('pencil').setTitle(t('col.action.edit')).onClick(() => this.openEdit(collection.id)));
    }
    if (this.deps.createBase) {
      const createBase = this.deps.createBase;
      menu.addItem((item) => item.setIcon('database').setTitle(t('col.action.createBase')).onClick(() => void createBase(collection.id)));
    }
    menu.addSeparator();
    if (canManage(role)) {
      menu.addItem((item) => item.setIcon('trash-2').setTitle(t('col.delete')).setWarning(true).onClick(() => void this.confirmDelete(collection.id)));
    } else {
      menu.addItem((item) => item.setIcon('log-out').setTitle(t('col.leave')).setWarning(true).onClick(() => void this.confirmLeave(collection.id)));
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  reportFailure(reason: OnlineFailure, fallback: string): void {
    if (reason === 'offline') new Notice(t('col.offline'));
    else if (reason === 'lost') new Notice(t('col.accessLost'));
    else new Notice(fallback);
  }

  async copyText(text: string, message: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      new Notice(message);
    } catch {
      // Clipboard can be unavailable (permissions); show the link instead of failing silently.
      new Notice(text, 10_000);
    }
  }

  private requireSignIn(): boolean {
    if (this.deps.isSignedIn()) return true;
    new Notice(t('col.signedOut'));
    return false;
  }
}

