import type { WorkersAPIClient } from '../WorkersAPIClient';
import { normalizeCollectionName, type CollectionStore } from './CollectionStore';
import type { CollectionSyncService } from '../../plugin/sync/CollectionSyncService';
import {
  COLLECTION_LIMITS,
  canContribute,
  canEditDetails,
  canManage,
  type CollectionDisplayMode,
  type CollectionInvite,
  type CollectionMember,
  type CollectionMemberRole,
  type CollectionMembersResponse,
  type CollectionShareState,
  type CollectionShareUpdate,
  type LocalCollection,
  type MemberCollectionViewPage,
  type PostShareSettings,
  type PostShareSettingsResponse,
} from '../../types/collections';

/**
 * User-facing collection actions (prd-collections-obsidian-plugin §4.1).
 *
 * Edits are local-first: they land in the store at once and a debounced push
 * follows. Sharing and member management need the server, so those return a
 * result with a reason instead of throwing — callers turn it into a Notice.
 */

export type CollectionApi = Pick<
  WorkersAPIClient,
  | 'getCollectionShareState'
  | 'updateCollectionShare'
  | 'rotateCollectionLink'
  | 'listCollectionInvites'
  | 'createCollectionInvite'
  | 'revokeCollectionInvite'
  | 'getCollectionMembers'
  | 'updateCollectionMemberRole'
  | 'removeCollectionMember'
  | 'leaveCollection'
  | 'updateCollectionMembership'
  | 'getMemberCollectionView'
  | 'getShareSettings'
  | 'updateShareSettings'
  | 'deleteCollectionItems'
>;

export type OnlineFailure = 'offline' | 'lost' | 'forbidden' | 'limit' | 'failed';
export type OnlineResult<T> = { ok: true; value: T } | { ok: false; reason: OnlineFailure };

export type CreateCollectionResult =
  | { ok: true; collection: LocalCollection; existed: boolean }
  | { ok: false; reason: 'signed-out' | 'invalid-name' | 'invalid-description' | 'limit' };

export interface CollectionServiceDeps {
  store: CollectionStore;
  sync: Pick<CollectionSyncService, 'schedulePush' | 'pushNow'>;
  api: () => CollectionApi | null | undefined;
  isAuthenticated: () => boolean;
  username: () => string | null;
  generateId?: () => string;
}

/** A failure after a request: no HTTP status means the request never got an answer. */
export function classifyFailure(error: unknown): OnlineFailure {
  const status = error && typeof error === 'object' ? (error as { status?: number }).status : undefined;
  const code = error && typeof error === 'object' ? (error as { code?: string }).code : undefined;
  if (status === undefined) return 'offline';
  if (status === 404) return 'lost';
  if (status === 403) return 'forbidden';
  if (status === 409 && typeof code === 'string' && code.endsWith('_LIMIT')) return 'limit';
  return 'failed';
}

export function validateCollectionName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= COLLECTION_LIMITS.nameMaxLength ? trimmed : null;
}

function validDescription(description: string | null): boolean {
  return description === null || description.length <= COLLECTION_LIMITS.descriptionMaxLength;
}

function defaultGenerateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Matches the server's id pattern [A-Za-z0-9_-]{8,64}.
  return `col-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export class CollectionService {
  private readonly generateId: () => string;

  constructor(private readonly deps: CollectionServiceDeps) {
    this.generateId = deps.generateId ?? defaultGenerateId;
  }

  // ---------------------------------------------------------------------------
  // Local-first edits
  // ---------------------------------------------------------------------------

  /** Create a collection, or return the owned one that already has this name (the apps do the same). */
  create(name: string, description: string | null = null): CreateCollectionResult {
    if (!this.deps.isAuthenticated() || !this.deps.store.getUsername()) return { ok: false, reason: 'signed-out' };
    const trimmed = validateCollectionName(name);
    if (!trimmed) return { ok: false, reason: 'invalid-name' };
    const cleanDescription = description?.trim() ? description.trim() : null;
    if (!validDescription(cleanDescription)) return { ok: false, reason: 'invalid-description' };

    const owned = this.deps.store.getCollections().filter((collection) => (collection.role ?? 'owner') === 'owner');
    const key = normalizeCollectionName(trimmed);
    const existing = owned.find((collection) => normalizeCollectionName(collection.name) === key);
    if (existing) return { ok: true, collection: existing, existed: true };
    if (owned.length >= COLLECTION_LIMITS.maxCollectionsPerUser) return { ok: false, reason: 'limit' };

    const sortOrder = owned.reduce((max, collection) => Math.max(max, collection.sortOrder), -1) + 1;
    const username = this.deps.username();
    const collection = this.deps.store.createCollection({
      id: this.generateId(),
      name: trimmed,
      description: cleanDescription,
      sortOrder,
      ...(username ? { ownerUsername: username } : {}),
    });
    this.deps.sync.schedulePush();
    return { ok: true, collection, existed: false };
  }

  /** Rename / re-describe. False when invalid, taken by another of my collections, or my role can't edit. */
  update(id: string, changes: { name: string; description: string | null }): boolean {
    const collection = this.deps.store.getCollection(id);
    if (!collection || !canEditDetails(collection.role ?? 'owner')) return false;
    const name = validateCollectionName(changes.name);
    const description = changes.description?.trim() ? changes.description.trim() : null;
    if (!name || !validDescription(description)) return false;
    // Only my own collections share a name space; the server checks a shared one's owner.
    if ((collection.role ?? 'owner') === 'owner' && this.deps.store.hasNameConflict(name, collection.id)) return false;
    this.deps.store.updateCollectionDetails(collection.id, { name, description });
    this.deps.sync.schedulePush();
    return true;
  }

  /** Owner only. Members leave instead. */
  delete(id: string): boolean {
    const collection = this.deps.store.getCollection(id);
    if (!collection || !canManage(collection.role ?? 'owner')) return false;
    this.deps.store.deleteCollection(collection.id);
    this.deps.sync.schedulePush();
    return true;
  }

  /**
   * Server ids for collections chosen before an archive exists
   * (prd-archive-into-collections A8). One created on this device is pushed
   * first, following any remap; one that still hasn't reached the server is
   * left out — the server would only skip it.
   */
  async serverIdsFor(ids: readonly string[]): Promise<string[]> {
    const writable = (): LocalCollection[] => ids
      .map((id) => this.deps.store.getCollection(id))
      .filter((collection): collection is LocalCollection => Boolean(collection) && canContribute(collection?.role ?? 'owner'));
    if (writable().some((collection) => !collection.synced)) {
      try {
        await this.deps.sync.pushNow();
      } catch {
        // Offline: the archive request itself will report it.
      }
    }
    return [...new Set(writable().filter((collection) => collection.synced).map((collection) => collection.id))];
  }

  /** Collections a post can go into: mine, and shared ones where I'm an editor. */
  getWritableCollections(): LocalCollection[] {
    return this.deps.store.getCollections().filter((collection) => canContribute(collection.role ?? 'owner'));
  }

  /**
   * Apply a picker result: for each collection, include or exclude these
   * archives. Collections I can't contribute to are ignored.
   */
  applyMembership(archiveIds: readonly string[], changes: ReadonlyArray<{ collectionId: string; include: boolean }>): number {
    if (archiveIds.length === 0) return 0;
    let changed = 0;
    for (const { collectionId, include } of changes) {
      const collection = this.deps.store.getCollection(collectionId);
      if (!collection || !canContribute(collection.role ?? 'owner')) continue;
      changed += include
        ? this.deps.store.addItems(collection.id, archiveIds)
        : this.deps.store.removeItems(collection.id, archiveIds);
    }
    if (changed > 0) this.deps.sync.schedulePush();
    return changed;
  }

  // ---------------------------------------------------------------------------
  // Sharing (owner, online)
  // ---------------------------------------------------------------------------

  /**
   * One-tap share: a private collection becomes link-only, with the current
   * view and my notes on — unless it was shared before, which keeps its
   * earlier choices. Never makes a collection public on its own.
   */
  async shareForLink(id: string, currentDisplayMode: CollectionDisplayMode): Promise<OnlineResult<CollectionShareState>> {
    const current = await this.getShareState(id);
    if (!current.ok) return current;
    if (current.value.visibility !== 'private' && current.value.shareUrl) return current;
    const body: CollectionShareUpdate = current.value.shareToken
      ? { visibility: 'unlisted' }
      : { visibility: 'unlisted', displayMode: currentDisplayMode, includeAnnotations: true };
    return this.updateShare(current.value.collectionId, body);
  }

  getShareState(id: string): Promise<OnlineResult<CollectionShareState>> {
    return this.ownerShareCall(id, (api, collectionId) => api.getCollectionShareState(collectionId));
  }

  updateShare(id: string, update: CollectionShareUpdate): Promise<OnlineResult<CollectionShareState>> {
    return this.ownerShareCall(id, (api, collectionId) => api.updateCollectionShare(collectionId, update));
  }

  rotateLink(id: string): Promise<OnlineResult<CollectionShareState>> {
    return this.ownerShareCall(id, (api, collectionId) => api.rotateCollectionLink(collectionId));
  }

  stopSharing(id: string): Promise<OnlineResult<CollectionShareState>> {
    return this.updateShare(id, { visibility: 'private' });
  }

  private async ownerShareCall(
    id: string,
    call: (api: CollectionApi, collectionId: string) => Promise<CollectionShareState>,
  ): Promise<OnlineResult<CollectionShareState>> {
    const collection = this.deps.store.getCollection(id);
    if (!collection || !canManage(collection.role ?? 'owner')) return { ok: false, reason: 'forbidden' };
    const result = await this.onServer(collection.id, call);
    if (result.ok) this.deps.store.applyShareState(result.value.collectionId, result.value);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Members (online)
  // ---------------------------------------------------------------------------

  getMembers(id: string): Promise<OnlineResult<CollectionMembersResponse>> {
    return this.onServer(id, (api, collectionId) => api.getCollectionMembers(collectionId));
  }

  listInvites(id: string): Promise<OnlineResult<CollectionInvite[]>> {
    return this.onServer(id, (api, collectionId) => api.listCollectionInvites(collectionId));
  }

  createInvite(id: string, role: CollectionMemberRole, expiresInDays: number): Promise<OnlineResult<CollectionInvite>> {
    return this.onServer(id, (api, collectionId) => api.createCollectionInvite(collectionId, { role, expiresInDays }));
  }

  revokeInvite(id: string, token: string): Promise<OnlineResult<void>> {
    return this.onServer(id, (api, collectionId) => api.revokeCollectionInvite(collectionId, token));
  }

  changeMemberRole(id: string, username: string, role: CollectionMemberRole): Promise<OnlineResult<CollectionMember>> {
    return this.onServer(id, (api, collectionId) => api.updateCollectionMemberRole(collectionId, username, role));
  }

  removeMember(id: string, username: string): Promise<OnlineResult<void>> {
    return this.onServer(id, (api, collectionId) => api.removeCollectionMember(collectionId, username));
  }

  /** Editors and viewers: my notes on the posts I added, visible to the others. */
  async setMyAnnotations(id: string, include: boolean): Promise<OnlineResult<boolean>> {
    const result = await this.onServer(id, (api, collectionId) => api.updateCollectionMembership(collectionId, { includeAnnotations: include }));
    if (!result.ok) return result;
    this.deps.store.applyMembership(result.value.collectionId, result.value.includeAnnotations);
    return { ok: true, value: result.value.includeAnnotations };
  }

  /** Editors and viewers. My posts stay in the collection (the server keeps them). */
  async leave(id: string): Promise<OnlineResult<void>> {
    const collection = this.deps.store.getCollection(id);
    if (!collection || (collection.role ?? 'owner') === 'owner') return { ok: false, reason: 'forbidden' };
    const result = await this.onServer(collection.id, (api, collectionId) => api.leaveCollection(collectionId));
    if (result.ok) this.deps.store.deleteCollection(collection.id, { queueServerDelete: false });
    return result;
  }

  /**
   * Remove any contributor's post (owner or editor) from a collaborative
   * collection — online, since other members' rows never live on this device.
   * My own row goes through the store so the next sync doesn't bring it back.
   */
  async removeFromSharedCollection(id: string, archiveId: string): Promise<OnlineResult<void>> {
    const collection = this.deps.store.getCollection(id);
    if (!collection || !canContribute(collection.role ?? 'owner')) return { ok: false, reason: 'forbidden' };
    if (this.deps.store.getCollectionIdsForArchive(archiveId).includes(collection.id)) {
      this.deps.store.removeItems(collection.id, [archiveId]);
      await this.deps.sync.pushNow();
      return { ok: true, value: undefined };
    }
    const result = await this.onServer(collection.id, async (api, collectionId) => {
      await api.deleteCollectionItems([{ collectionId, archiveId }]);
    });
    return result;
  }

  /** One page of the server-rendered list (every contributor's posts). */
  getMemberView(id: string, cursor: string | null): Promise<OnlineResult<MemberCollectionViewPage>> {
    return this.onServer(id, (api, collectionId) => api.getMemberCollectionView(collectionId, { cursor }));
  }

  // ---------------------------------------------------------------------------
  // Post share settings (online)
  // ---------------------------------------------------------------------------

  async getPostShareSettings(shareId: string): Promise<OnlineResult<PostShareSettingsResponse>> {
    const api = this.deps.api();
    if (!api || !this.deps.isAuthenticated()) return { ok: false, reason: 'offline' };
    try {
      return { ok: true, value: await api.getShareSettings(shareId) };
    } catch (error) {
      return { ok: false, reason: classifyFailure(error) };
    }
  }

  async updatePostShareSettings(shareId: string, patch: Partial<PostShareSettings>): Promise<OnlineResult<PostShareSettingsResponse>> {
    const api = this.deps.api();
    if (!api || !this.deps.isAuthenticated()) return { ok: false, reason: 'offline' };
    try {
      return { ok: true, value: await api.updateShareSettings(shareId, patch) };
    } catch (error) {
      return { ok: false, reason: classifyFailure(error) };
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Run a call against the server's id for this collection. A collection made
   * on this device is pushed first, since the server can't act on an id it
   * hasn't seen. Losing access (404 on a collection I don't own) forgets it.
   */
  private async onServer<T>(id: string, call: (api: CollectionApi, collectionId: string) => Promise<T>): Promise<OnlineResult<T>> {
    const api = this.deps.api();
    if (!api || !this.deps.isAuthenticated()) return { ok: false, reason: 'offline' };
    let collection = this.deps.store.getCollection(id);
    if (!collection) return { ok: false, reason: 'lost' };
    if (!collection.synced) {
      await this.deps.sync.pushNow();
      collection = this.deps.store.getCollection(id);
      if (!collection?.synced) return { ok: false, reason: 'offline' };
    }
    try {
      return { ok: true, value: await call(api, collection.id) };
    } catch (error) {
      const reason = classifyFailure(error);
      if (reason === 'lost' && (collection.role ?? 'owner') !== 'owner') {
        this.deps.store.deleteCollection(collection.id, { queueServerDelete: false });
      }
      return { ok: false, reason };
    }
  }
}
