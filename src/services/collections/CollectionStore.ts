import type {
  CollectionItemPair,
  CollectionSummary,
  LocalCollection,
  LocalCollectionItem,
  UserCollectionDTO,
  UserCollectionItemDTO,
} from '../../types/collections';

/**
 * Device-local collection state (prd-collections-obsidian-plugin O1/O2).
 *
 * The server is the source of truth; this store holds what this device knows,
 * the edits it hasn't pushed yet, and the sync cursors. It is persisted per
 * user through a key-value port backed by `app.saveLocalStorage` — never
 * `data.json`, which Obsidian Sync copies between devices and would make two
 * devices overwrite each other's cursors and queues.
 *
 * Only this user's OWN item rows live here (the server sends no others);
 * other members' posts in a collaborative collection come from the member view.
 */

export interface KeyValueStorage {
  load(key: string): unknown;
  save(key: string, value: unknown): void;
}

interface PersistedState {
  version: 1;
  collections: LocalCollection[];
  items: LocalCollectionItem[];
  pendingCollectionDeletes: string[];
  pendingItemDeletes: CollectionItemPair[];
  collectionCursor: string | null;
  itemCursor: string | null;
}

const STORAGE_KEY_PREFIX = 'social-archiver:collections:v1:';

/** Fields the server owns: a local edit never changes them, so a pull may always apply them. */
const SERVER_OWNED_FIELDS = [
  'visibility',
  'shareToken',
  'displayMode',
  'includeAnnotations',
  'role',
  'ownerUsername',
  'memberCount',
  'collaborative',
  'includeMyAnnotations',
  'createdAt',
  'updatedAt',
] as const satisfies ReadonlyArray<keyof UserCollectionDTO>;

const pairKey = (pair: CollectionItemPair): string => `${pair.collectionId}\u0000${pair.archiveId}`;

export class CollectionStore {
  private username: string | null = null;
  private collections = new Map<string, LocalCollection>();
  /** collectionId → archiveId → item */
  private items = new Map<string, Map<string, LocalCollectionItem>>();
  /** archiveId → collectionIds (reverse index for card membership and the picker) */
  private byArchive = new Map<string, Set<string>>();
  private pendingCollectionDeletes = new Set<string>();
  private pendingItemDeletes = new Map<string, CollectionItemPair>();
  private collectionCursor: string | null = null;
  private itemCursor: string | null = null;
  /** Bumped on every local edit of a collection; a push clears `isDirty` only if it didn't move. */
  private revisions = new Map<string, number>();
  /** Ids replaced by the server this session (a caller may still hold the old one). */
  private remaps = new Map<string, string>();
  private listeners = new Set<() => void>();

  constructor(private readonly storage: KeyValueStorage) {}

  // ---------------------------------------------------------------------------
  // Scope and persistence
  // ---------------------------------------------------------------------------

  /** Load the given user's state (null = signed out: empty, nothing persisted). */
  switchUser(username: string | null): void {
    if (username === this.username) return;
    this.resetMemory();
    this.username = username;
    if (username) this.restore(username);
    this.emit();
  }

  getUsername(): string | null {
    return this.username;
  }

  private resetMemory(): void {
    this.collections.clear();
    this.items.clear();
    this.byArchive.clear();
    this.pendingCollectionDeletes.clear();
    this.pendingItemDeletes.clear();
    this.collectionCursor = null;
    this.itemCursor = null;
    this.revisions.clear();
    this.remaps.clear();
  }

  private restore(username: string): void {
    let raw: unknown;
    try {
      raw = this.storage.load(STORAGE_KEY_PREFIX + username);
    } catch {
      return;
    }
    if (!isPersistedState(raw)) return;
    for (const collection of raw.collections) this.collections.set(collection.id, { ...collection });
    for (const item of raw.items) this.indexItem({ ...item });
    for (const id of raw.pendingCollectionDeletes) this.pendingCollectionDeletes.add(id);
    for (const pair of raw.pendingItemDeletes) this.pendingItemDeletes.set(pairKey(pair), pair);
    this.collectionCursor = raw.collectionCursor;
    this.itemCursor = raw.itemCursor;
  }

  private persist(): void {
    if (!this.username) return;
    const state: PersistedState = {
      version: 1,
      collections: [...this.collections.values()],
      items: this.allItems(),
      pendingCollectionDeletes: [...this.pendingCollectionDeletes],
      pendingItemDeletes: [...this.pendingItemDeletes.values()],
      collectionCursor: this.collectionCursor,
      itemCursor: this.itemCursor,
    };
    try {
      this.storage.save(STORAGE_KEY_PREFIX + this.username, state);
    } catch (error) {
      console.warn('[Social Archiver] Failed to persist collections:', error);
    }
  }

  /** Persist and notify listeners. Every mutation ends here. */
  private commit(): void {
    this.persist();
    this.emit();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.warn('[Social Archiver] Collection listener failed:', error);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /** Collections ordered like the apps' sidebar: sortOrder, then name. */
  getCollections(): CollectionSummary[] {
    return [...this.collections.values()]
      .map((collection) => ({ ...collection, itemCount: this.items.get(collection.id)?.size ?? 0 }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  getCollection(id: string): LocalCollection | undefined {
    return this.collections.get(this.resolveId(id));
  }

  /** The id the server knows this collection by (follows remaps made this session). */
  resolveId(id: string): string {
    let current = id;
    for (let hop = 0; hop < 8; hop++) {
      const next = this.remaps.get(current);
      if (!next) return current;
      current = next;
    }
    return current;
  }

  /** Archive ids of this user's own items in a collection, newest first. */
  getArchiveIds(collectionId: string): string[] {
    const items = this.items.get(this.resolveId(collectionId));
    if (!items) return [];
    return [...items.values()]
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
      .map((item) => item.archiveId);
  }

  getCollectionIdsForArchive(archiveId: string): string[] {
    return [...(this.byArchive.get(archiveId) ?? [])];
  }

  hasNameConflict(name: string, exceptId?: string): boolean {
    const wanted = normalizeCollectionName(name);
    for (const collection of this.collections.values()) {
      if (collection.id === exceptId) continue;
      // Names are unique per OWNER; a collaborative collection someone else owns never conflicts.
      if ((collection.role ?? 'owner') !== 'owner') continue;
      if (normalizeCollectionName(collection.name) === wanted) return true;
    }
    return false;
  }

  getCursors(): { collections: string | null; items: string | null } {
    return { collections: this.collectionCursor, items: this.itemCursor };
  }

  getPendingCollectionDeletes(): string[] {
    return [...this.pendingCollectionDeletes];
  }

  getPendingItemDeletes(): CollectionItemPair[] {
    return [...this.pendingItemDeletes.values()];
  }

  /** Dirty collections with the revision each was read at (for {@link markCollectionsSynced}). */
  getDirtyCollections(): Array<{ collection: LocalCollection; revision: number }> {
    return [...this.collections.values()]
      .filter((collection) => collection.isDirty)
      .map((collection) => ({ collection: { ...collection }, revision: this.revisions.get(collection.id) ?? 0 }));
  }

  /** Dirty items whose collection the server already knows (items may only be pushed after it). */
  getPushableItems(): LocalCollectionItem[] {
    return this.allItems().filter((item) => item.isDirty && this.collections.get(item.collectionId)?.synced === true);
  }

  hasLocalCollections(): boolean {
    return this.collections.size > 0;
  }

  hasLocalItems(): boolean {
    return this.byArchive.size > 0;
  }

  private allItems(): LocalCollectionItem[] {
    const all: LocalCollectionItem[] = [];
    for (const items of this.items.values()) all.push(...items.values());
    return all;
  }

  // ---------------------------------------------------------------------------
  // Local edits (user actions)
  // ---------------------------------------------------------------------------

  createCollection(input: { id: string; name: string; description: string | null; sortOrder: number; ownerUsername?: string }): LocalCollection {
    const now = new Date().toISOString();
    const collection: LocalCollection = {
      id: input.id,
      name: input.name,
      description: input.description,
      visibility: 'private',
      shareToken: null,
      displayMode: 'timeline',
      includeAnnotations: true,
      sortOrder: input.sortOrder,
      createdAt: now,
      updatedAt: now,
      role: 'owner',
      ...(input.ownerUsername ? { ownerUsername: input.ownerUsername } : {}),
      memberCount: 0,
      collaborative: false,
      isDirty: true,
      synced: false,
    };
    this.collections.set(collection.id, collection);
    this.bumpRevision(collection.id);
    this.commit();
    return { ...collection };
  }

  updateCollectionDetails(id: string, changes: { name?: string; description?: string | null }): void {
    const collection = this.collections.get(this.resolveId(id));
    if (!collection) return;
    if (changes.name !== undefined) collection.name = changes.name;
    if (changes.description !== undefined) collection.description = changes.description;
    collection.isDirty = true;
    collection.updatedAt = new Date().toISOString();
    this.bumpRevision(collection.id);
    this.commit();
  }

  /**
   * Delete locally. A collection the server knows is queued for deletion
   * (owner) — or just forgotten (`queueServerDelete: false`, e.g. after
   * leaving, where the server already dropped the membership).
   */
  deleteCollection(id: string, options: { queueServerDelete: boolean } = { queueServerDelete: true }): void {
    const resolved = this.resolveId(id);
    const collection = this.collections.get(resolved);
    if (!collection) return;
    if (options.queueServerDelete && collection.synced) this.pendingCollectionDeletes.add(resolved);
    this.dropCollection(resolved);
    // Pending item deletes inside it are moot: the collection delete removes them server-side.
    for (const [key, pair] of this.pendingItemDeletes) {
      if (pair.collectionId === resolved) this.pendingItemDeletes.delete(key);
    }
    this.commit();
  }

  /** Add this user's archives to a collection. Returns how many were new. */
  addItems(collectionId: string, archiveIds: readonly string[]): number {
    const resolved = this.resolveId(collectionId);
    if (!this.collections.has(resolved)) return 0;
    const now = new Date().toISOString();
    let added = 0;
    let changed = false;
    for (const archiveId of archiveIds) {
      const pair = { collectionId: resolved, archiveId };
      if (this.pendingItemDeletes.delete(pairKey(pair))) changed = true;
      if (this.items.get(resolved)?.has(archiveId)) continue;
      this.indexItem({ ...pair, addedAt: now, isDirty: true });
      added++;
      changed = true;
    }
    if (changed) this.commit();
    return added;
  }

  removeItems(collectionId: string, archiveIds: readonly string[]): number {
    const resolved = this.resolveId(collectionId);
    const collection = this.collections.get(resolved);
    let removed = 0;
    for (const archiveId of archiveIds) {
      if (this.unindexItem(resolved, archiveId)) removed++;
      // Queue even when we hold no row: the server ignores pairs it doesn't have,
      // and a pair added on another device must still go.
      if (collection?.synced) {
        const pair = { collectionId: resolved, archiveId };
        this.pendingItemDeletes.set(pairKey(pair), pair);
      }
    }
    this.commit();
    return removed;
  }

  // ---------------------------------------------------------------------------
  // Server results (sync)
  // ---------------------------------------------------------------------------

  /** Clear `isDirty` for pushed collections unless they were edited again meanwhile. */
  markCollectionsSynced(pushed: ReadonlyArray<{ id: string; revision: number }>): void {
    for (const { id, revision } of pushed) {
      const collection = this.collections.get(id);
      if (!collection) continue;
      collection.synced = true;
      if ((this.revisions.get(id) ?? 0) === revision) collection.isDirty = false;
    }
    this.commit();
  }

  /**
   * The server answered a new id with an existing collection of the same name:
   * move the local row (and its items) to the canonical id.
   */
  remapCollection(requestedId: string, canonical: UserCollectionDTO): void {
    const local = this.collections.get(requestedId);
    const targetExisting = this.collections.get(canonical.id);
    if (requestedId !== canonical.id) {
      const movedItems = [...(this.items.get(requestedId)?.values() ?? [])];
      this.dropCollection(requestedId);
      for (const item of movedItems) {
        if (this.items.get(canonical.id)?.has(item.archiveId)) continue;
        this.indexItem({ ...item, collectionId: canonical.id });
      }
      this.remaps.set(requestedId, canonical.id);
    }
    const base = targetExisting ?? local;
    this.collections.set(canonical.id, {
      ...(base ?? {}),
      ...canonical,
      isDirty: false,
      synced: true,
    });
    this.commit();
  }

  /** Overwrite with the server's version (rename refused) or forget the row (limit, deleted, foreign id). */
  applyRejected(id: string, serverCollection: UserCollectionDTO | undefined): void {
    if (serverCollection) {
      const existing = this.collections.get(id);
      this.collections.set(serverCollection.id, {
        ...(existing ?? {}),
        ...serverCollection,
        isDirty: false,
        synced: true,
      });
    } else {
      this.dropCollection(id);
      this.pendingCollectionDeletes.delete(id);
    }
    this.commit();
  }

  /**
   * Apply a pull. Local name/description edits not yet pushed win over the
   * pulled ones; server-owned fields always apply.
   */
  applyRemoteCollections(input: {
    collections: readonly UserCollectionDTO[];
    deletedIds: readonly string[];
    memberCollectionIds?: readonly string[];
    serverTime: string;
  }): void {
    for (const dto of input.collections) {
      if (this.pendingCollectionDeletes.has(dto.id)) continue;
      const local = this.collections.get(dto.id);
      if (local?.isDirty) {
        for (const field of SERVER_OWNED_FIELDS) {
          (local as unknown as Record<string, unknown>)[field] = dto[field];
        }
        local.synced = true;
      } else {
        this.collections.set(dto.id, { ...dto, isDirty: false, synced: true });
      }
    }
    for (const id of input.deletedIds) {
      this.dropCollection(id);
      this.pendingCollectionDeletes.delete(id);
    }
    if (input.memberCollectionIds) {
      // The list is complete regardless of the cursor: a non-owned row missing
      // from it means the membership ended (left, removed, or collection gone).
      const stillMember = new Set(input.memberCollectionIds);
      for (const collection of [...this.collections.values()]) {
        if ((collection.role ?? 'owner') !== 'owner' && !stillMember.has(collection.id)) {
          this.dropCollection(collection.id);
        }
      }
    }
    this.collectionCursor = input.serverTime;
    this.commit();
  }

  /**
   * Apply an item pull. Returns false when an item names a collection this
   * device doesn't have yet — the caller then keeps the old cursor so the next
   * pass sees the item again.
   */
  applyRemoteItems(input: {
    items: readonly UserCollectionItemDTO[];
    deletedPairs: readonly CollectionItemPair[];
    serverTime: string;
  }): boolean {
    let complete = true;
    for (const item of input.items) {
      if (this.pendingItemDeletes.has(pairKey(item))) continue;
      if (!this.collections.has(item.collectionId)) {
        complete = false;
        continue;
      }
      const existing = this.items.get(item.collectionId)?.get(item.archiveId);
      if (existing) {
        existing.addedAt = item.addedAt;
        existing.isDirty = false;
      } else {
        this.indexItem({ collectionId: item.collectionId, archiveId: item.archiveId, addedAt: item.addedAt, isDirty: false });
      }
    }
    for (const pair of input.deletedPairs) {
      const existing = this.items.get(pair.collectionId)?.get(pair.archiveId);
      // A local re-add not pushed yet wins over an older remote removal.
      if (existing && !existing.isDirty) this.unindexItem(pair.collectionId, pair.archiveId);
    }
    if (complete) this.itemCursor = input.serverTime;
    this.commit();
    return complete;
  }

  markItemsSynced(pairs: readonly CollectionItemPair[]): void {
    for (const pair of pairs) {
      const item = this.items.get(pair.collectionId)?.get(pair.archiveId);
      if (item) item.isDirty = false;
    }
    this.commit();
  }

  /** Items the server refused (viewer, limit, collection gone) leave this device too. */
  dropItems(pairs: readonly CollectionItemPair[]): void {
    for (const pair of pairs) this.unindexItem(pair.collectionId, pair.archiveId);
    this.commit();
  }

  completeCollectionDeletes(ids: readonly string[]): void {
    for (const id of ids) this.pendingCollectionDeletes.delete(id);
    this.commit();
  }

  completeItemDeletes(pairs: readonly CollectionItemPair[]): void {
    for (const pair of pairs) this.pendingItemDeletes.delete(pairKey(pair));
    this.commit();
  }

  /** Server share state after a share call (the local row mirrors it without a pull). */
  applyShareState(id: string, state: { visibility: LocalCollection['visibility']; shareToken: string | null; displayMode: LocalCollection['displayMode']; includeAnnotations: boolean }): void {
    const collection = this.collections.get(this.resolveId(id));
    if (!collection) return;
    collection.visibility = state.visibility;
    collection.shareToken = state.shareToken;
    collection.displayMode = state.displayMode;
    collection.includeAnnotations = state.includeAnnotations;
    this.commit();
  }

  /** Local copy of my notes opt-in after a membership PATCH. */
  applyMembership(id: string, includeMyAnnotations: boolean): void {
    const collection = this.collections.get(this.resolveId(id));
    if (!collection) return;
    collection.includeMyAnnotations = includeMyAnnotations;
    this.commit();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private bumpRevision(id: string): void {
    this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
  }

  private dropCollection(id: string): void {
    for (const archiveId of [...(this.items.get(id)?.keys() ?? [])]) this.unindexItem(id, archiveId);
    this.items.delete(id);
    this.collections.delete(id);
    this.revisions.delete(id);
  }

  private indexItem(item: LocalCollectionItem): void {
    let items = this.items.get(item.collectionId);
    if (!items) {
      items = new Map();
      this.items.set(item.collectionId, items);
    }
    items.set(item.archiveId, item);
    let collections = this.byArchive.get(item.archiveId);
    if (!collections) {
      collections = new Set();
      this.byArchive.set(item.archiveId, collections);
    }
    collections.add(item.collectionId);
  }

  private unindexItem(collectionId: string, archiveId: string): boolean {
    const items = this.items.get(collectionId);
    if (!items?.delete(archiveId)) return false;
    const collections = this.byArchive.get(archiveId);
    collections?.delete(collectionId);
    if (collections && collections.size === 0) this.byArchive.delete(archiveId);
    return true;
  }
}

/** Server rule: trim, then ASCII-only case folding (COLLATE NOCASE). */
export function normalizeCollectionName(name: string): string {
  return name.trim().replace(/[A-Z]/g, (char) => char.toLowerCase());
}

function isPersistedState(value: unknown): value is PersistedState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<PersistedState>;
  return state.version === 1
    && Array.isArray(state.collections)
    && Array.isArray(state.items)
    && Array.isArray(state.pendingCollectionDeletes)
    && Array.isArray(state.pendingItemDeletes);
}
