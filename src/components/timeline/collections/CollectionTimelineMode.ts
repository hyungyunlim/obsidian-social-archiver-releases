import { Menu, type EventRef, type Events } from 'obsidian';
import { t } from '../../../i18n';
import type { CollectionStore } from '../../../services/collections/CollectionStore';
import type { CollectionService } from '../../../services/collections/CollectionService';
import type { CollectionUiActions } from '../../../plugin/collections/CollectionUiActions';
import { canContribute, canManage } from '../../../types/collections';
import { renderCollectionModeBar } from './CollectionModeBar';
import { MemberCollectionFeed } from './MemberCollectionFeed';

/**
 * "A collection is open" for one timeline (prd-collections-obsidian-plugin O5).
 *
 * - Own collections: the timeline keeps its own cards and filters, narrowed to
 *   the notes of this user's items (a path set, like the Places filter).
 * - Collaborative collections: every contributor's posts come from the member
 *   view, so the timeline shows that feed instead of vault cards.
 *
 * The timeline stays the owner of rendering; this object only answers what
 * to filter by and draws the bar and the member feed when asked.
 */

export interface CollectionTimelineHost {
  /** Narrow (or stop narrowing) the timeline and refresh its feed. */
  applyCollectionFilter(paths: ReadonlySet<string> | null): void;
  /** Re-render the whole timeline (switching in or out of a collection). */
  rerender(): void;
}

export interface CollectionTimelineModeDeps {
  store: CollectionStore;
  service: CollectionService;
  ui: CollectionUiActions;
  events: Events;
  resolveFilePath: (archiveId: string) => string | null;
  openFile: (path: string) => void;
  openUrl: (url: string) => void;
  host: CollectionTimelineHost;
}

/** Coalesce a burst of store changes (a sync pass writes several times). */
const STORE_CHANGE_DEBOUNCE_MS = 250;

export class CollectionTimelineMode {
  private activeId: string | null = null;
  private filterPaths: ReadonlySet<string> | null = null;
  private notInVault = 0;
  private barHost: HTMLElement | null = null;
  private memberFeed: MemberCollectionFeed | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private remoteRef: EventRef | null = null;
  private storeTimer: number | null = null;

  constructor(private readonly deps: CollectionTimelineModeDeps) {
    this.unsubscribeStore = deps.store.onChange(() => this.scheduleStoreRefresh());
    this.remoteRef = deps.events.on('collections:remote-change', (ids: unknown) => {
      const active = this.activeCollection();
      if (!active?.collaborative) return;
      if (!Array.isArray(ids) || ids.includes(active.id)) void this.memberFeed?.reload();
    });
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  getFilterPaths(): ReadonlySet<string> | null {
    return this.filterPaths;
  }

  isCollaborativeActive(): boolean {
    return this.activeCollection()?.collaborative === true;
  }

  /** Open a collection (null = all posts). */
  open(collectionId: string | null): void {
    const resolved = collectionId ? this.deps.store.resolveId(collectionId) : null;
    if (resolved && !this.deps.store.getCollection(resolved)) return;
    this.activeId = resolved;
    this.recomputePaths();
    this.deps.host.applyCollectionFilter(this.filterPaths);
    this.deps.host.rerender();
  }

  /**
   * Take a collection before the timeline's first render, without asking for
   * one: that render draws the bar and the narrowed feed itself.
   */
  preset(collectionId: string): ReadonlySet<string> | null {
    const resolved = this.deps.store.resolveId(collectionId);
    if (!this.deps.store.getCollection(resolved)) return this.filterPaths;
    this.activeId = resolved;
    this.recomputePaths();
    return this.filterPaths;
  }

  /** Draw the bar for the open collection (called by the timeline right after its header). */
  renderBar(parent: HTMLElement): void {
    this.barHost = parent.createDiv({ cls: 'sa-collection-bar-host' });
    // Notes can appear after the collection opened (vault index still building
    // at startup, a library sync landing): re-narrow once this render is done.
    const before = this.filterPaths;
    this.recomputePaths();
    if (this.activeId && !sameSet(before, this.filterPaths)) {
      window.setTimeout(() => this.deps.host.applyCollectionFilter(this.filterPaths), 0);
    }
    this.paintBar();
  }

  /** Draw the collaborative feed in place of the vault cards. */
  renderMemberFeed(parent: HTMLElement): void {
    this.memberFeed?.destroy();
    const collection = this.activeCollection();
    if (!collection) return;
    const id = collection.id;
    this.memberFeed = new MemberCollectionFeed({
      loadPage: (cursor) => this.deps.service.getMemberView(id, cursor),
      resolveFilePath: this.deps.resolveFilePath,
      openFile: this.deps.openFile,
      openUrl: this.deps.openUrl,
      canRemove: canContribute(collection.role ?? 'owner'),
      remove: async (archiveId) => {
        const result = await this.deps.service.removeFromSharedCollection(id, archiveId);
        if (!result.ok) this.deps.ui.reportFailure(result.reason, t('col.feed.removeFailed'));
        return result.ok;
      },
    });
    this.memberFeed.mount(parent);
  }

  destroy(): void {
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    if (this.remoteRef) this.deps.events.offref(this.remoteRef);
    this.remoteRef = null;
    if (this.storeTimer !== null) window.clearTimeout(this.storeTimer);
    this.memberFeed?.destroy();
    this.memberFeed = null;
  }

  private activeCollection() {
    return this.activeId ? this.deps.store.getCollection(this.activeId) : undefined;
  }

  private recomputePaths(): void {
    const collection = this.activeCollection();
    if (!collection) {
      this.filterPaths = null;
      this.notInVault = 0;
      return;
    }
    const archiveIds = this.deps.store.getArchiveIds(collection.id);
    const paths = new Set<string>();
    for (const archiveId of archiveIds) {
      const path = this.deps.resolveFilePath(archiveId);
      if (path) paths.add(path);
    }
    this.filterPaths = paths;
    this.notInVault = archiveIds.length - paths.size;
  }

  private paintBar(): void {
    const host = this.barHost;
    if (!host?.isConnected) return;
    host.empty();
    const collection = this.activeCollection();
    if (!collection) return;
    const id = collection.id;
    renderCollectionModeBar(host, {
      collection,
      myItemCount: this.deps.store.getArchiveIds(id).length,
      notInVaultCount: this.notInVault,
      onBack: () => this.open(null),
      onCopyLink: canManage(collection.role ?? 'owner') ? () => void this.deps.ui.copyLink(id) : undefined,
      onMenu: (event) => {
        const menu = new Menu();
        this.deps.ui.fillCollectionMenu(menu, id);
        menu.showAtMouseEvent(event);
      },
    });
  }

  private scheduleStoreRefresh(): void {
    if (this.storeTimer !== null) window.clearTimeout(this.storeTimer);
    this.storeTimer = window.setTimeout(() => {
      this.storeTimer = null;
      this.onStoreChanged();
    }, STORE_CHANGE_DEBOUNCE_MS);
  }

  private onStoreChanged(): void {
    if (!this.activeId) return;
    const resolved = this.deps.store.resolveId(this.activeId);
    if (!this.deps.store.getCollection(resolved)) {
      // Deleted, left, or access lost: back to all posts.
      this.open(null);
      return;
    }
    const wasCollaborative = this.isCollaborativeActive();
    this.activeId = resolved;
    const before = this.filterPaths;
    this.recomputePaths();
    if (this.isCollaborativeActive() !== wasCollaborative) {
      this.deps.host.rerender();
      return;
    }
    if (!sameSet(before, this.filterPaths)) this.deps.host.applyCollectionFilter(this.filterPaths);
    this.paintBar();
  }
}

function sameSet(a: ReadonlySet<string> | null, b: ReadonlySet<string> | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}
