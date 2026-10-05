/**
 * CollectionsCliService — adapter between the `social-archiver:collections`
 * flag bag and the plugin's collection store/service
 * (prd-collections-obsidian-plugin §4.2).
 *
 * Collections are local-first (O1–O2): membership lives in this device's
 * store and syncs in the background. So every action answers from the store,
 * synchronously — Obsidian's CLI drops a handler's output once it waits on the
 * network (still true on 1.13.7). Edits report `syncScheduled` and list rows
 * `pendingSync` until the server has them. Sharing needs the server: `share`
 * only schedules it, and `link` reads the result once it lands.
 *
 * Responsibilities (SRP):
 *   - Map `action=list|show|create|add|remove|link|share|open` + flags → store/service calls.
 *   - Resolve `collection=<id|name>` and refuse what the caller's role can't do.
 *   - Require `confirm=true` before sharing: it exposes the collection by link.
 *
 * Does NOT register CLI handlers — that wiring lives in `CliRegistry`.
 */

import {
  CliValidationError,
  parseBool,
  parseCsv,
  parseEnum,
  parseNumber,
  parseString,
  type CliParams,
} from './CliParams';
import { normalizeCollectionName, type CollectionStore } from '../../services/collections/CollectionStore';
import type { CollectionService } from '../../services/collections/CollectionService';
import {
  canContribute,
  canManage,
  type CollectionRole,
  type CollectionSummary,
  type CollectionVisibility,
} from '../../types/collections';

export const COLLECTIONS_ACTIONS = ['list', 'show', 'create', 'add', 'remove', 'link', 'share', 'open'] as const;
export type CollectionsCliAction = (typeof COLLECTIONS_ACTIONS)[number];

const MAX_ARCHIVE_IDS = 200;
const DEFAULT_SHOW_LIMIT = 200;
const MAX_SHOW_LIMIT = 5000;

/** Failures no flag can fix: signed out, or an account limit. */
export class CollectionsCliError extends Error {
  constructor(readonly code: 'AUTH_REQUIRED' | 'OPERATION_FAILED', message: string) {
    super(message);
    this.name = 'CollectionsCliError';
  }
}

/** A vault note as collections see it. */
export interface CollectionsCliNote {
  path: string;
  /** The server archive this note is linked to (frontmatter `sourceArchiveId`). */
  archiveId?: string;
  /** Imported "local only": an archive note that was never uploaded. */
  isLocalOnly: boolean;
}

export interface CollectionsCliDeps {
  /** Null when signed out — collections belong to the account. */
  username(): string | null;
  store: Pick<CollectionStore, 'getCollections' | 'getArchiveIds' | 'resolveId'>;
  service: Pick<CollectionService, 'create' | 'applyMembership' | 'shareForLink'>;
  /** `pathOrActive` is a validated vault path or the literal 'active'; throws when there's no such note. */
  noteFor(pathOrActive: string): CollectionsCliNote;
  /** Vault path of an archive's note, or null when it isn't in this vault. */
  pathForArchive(archiveId: string): string | null;
  /** Fire-and-forget: reveal the collection in the timeline. */
  openCollection(collectionId: string): void;
  shareWebUrl: string;
}

export interface CollectionCliSummary {
  collectionId: string;
  name: string;
  description: string | null;
  visibility: CollectionVisibility;
  role: CollectionRole;
  collaborative: boolean;
  owner: string | null;
  /** Your posts in it. Other members' posts aren't stored on this device. */
  myPostCount: number;
  /** Null while private, and for members: only the owner has the link. */
  shareUrl: string | null;
  /** A local change the server doesn't have yet. */
  pendingSync: boolean;
}

export interface CollectionsListCliResult {
  collections: CollectionCliSummary[];
  total: number;
}

export interface CollectionShowCliResult extends CollectionCliSummary {
  /** Your posts, newest first, up to `limit`; `path` is null when the note isn't in this vault. */
  posts: Array<{ archiveId: string; path: string | null }>;
  notInVault: number;
  hint?: string;
}

export interface CollectionCreateCliResult extends CollectionCliSummary {
  /** False when one of your collections already had this name; it's returned instead. */
  created: boolean;
}

export interface CollectionMembershipCliResult {
  collectionId: string;
  name: string;
  archiveIds: string[];
  added?: number;
  alreadyIn?: number;
  removed?: number;
  notIn?: number;
  /** Archive ids with no note in this vault — check them for typos. */
  notInVault: string[];
  syncScheduled: boolean;
}

export interface CollectionLinkCliResult {
  collectionId: string;
  name: string;
  visibility: CollectionVisibility;
  shareUrl: string | null;
  /** True when `share` sent the request; run `action=link` shortly to read the link. */
  scheduled?: boolean;
  hint?: string;
}

export interface CollectionOpenCliResult {
  collectionId: string;
  name: string;
  scheduled: true;
}

export type CollectionsCliResult =
  | CollectionsListCliResult
  | CollectionShowCliResult
  | CollectionCreateCliResult
  | CollectionMembershipCliResult
  | CollectionLinkCliResult
  | CollectionOpenCliResult;

export class CollectionsCliService {
  constructor(private readonly deps: CollectionsCliDeps) {}

  /** Drive the `social-archiver:collections` command. Synchronous on purpose (see the file comment). */
  run(params: CliParams): CollectionsCliResult {
    const action: CollectionsCliAction = parseEnum(params, 'action', COLLECTIONS_ACTIONS) ?? 'list';
    if (!this.deps.username()) {
      throw new CollectionsCliError('AUTH_REQUIRED', 'Sign in to Social Archiver to use collections.');
    }

    if (action === 'list') return this.list();
    if (action === 'create') return this.create(params);

    const collection = this.resolveCollection(params, action);
    if (action === 'show') return this.show(params, collection);
    if (action === 'add' || action === 'remove') return this.membership(params, collection, action);
    if (action === 'link') return this.link(collection);
    if (action === 'share') return this.share(params, collection);
    this.deps.openCollection(collection.id);
    return { collectionId: collection.id, name: collection.name, scheduled: true };
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  private list(): CollectionsListCliResult {
    const collections = this.deps.store.getCollections().map((collection) => this.summarize(collection));
    return { collections, total: collections.length };
  }

  private show(params: CliParams, collection: CollectionSummary): CollectionShowCliResult {
    const limit = parseNumber(params, 'limit', { integer: true, min: 1, max: MAX_SHOW_LIMIT }) ?? DEFAULT_SHOW_LIMIT;
    const archiveIds = this.deps.store.getArchiveIds(collection.id);
    const paths = archiveIds.map((archiveId) => this.deps.pathForArchive(archiveId));
    return {
      ...this.summarize(collection),
      posts: archiveIds.slice(0, limit).map((archiveId, index) => ({ archiveId, path: paths[index] ?? null })),
      notInVault: paths.filter((path) => path === null).length,
      ...(collection.collaborative
        ? { hint: "Only your own posts are listed: other members' posts aren't stored on this device." }
        : {}),
    };
  }

  private create(params: CliParams): CollectionCreateCliResult {
    const name = parseString(params, 'name', { required: true });
    const description = parseString(params, 'description') ?? null;
    const result = this.deps.service.create(name, description);
    if (!result.ok) {
      if (result.reason === 'invalid-name') throw new CliValidationError('name', 'Enter a name of up to 60 characters.');
      if (result.reason === 'invalid-description') {
        throw new CliValidationError('description', 'The description can be up to 500 characters.');
      }
      if (result.reason === 'limit') throw new CollectionsCliError('OPERATION_FAILED', 'You can have up to 1,000 collections.');
      throw new CollectionsCliError('AUTH_REQUIRED', 'Sign in to Social Archiver to use collections.');
    }
    return { ...this.summarize(this.summaryFor(result.collection.id)), created: !result.existed };
  }

  private membership(
    params: CliParams,
    collection: CollectionSummary,
    action: 'add' | 'remove',
  ): CollectionMembershipCliResult {
    if (!canContribute(collection.role ?? 'owner')) {
      throw new CliValidationError(
        'collection',
        `You're a viewer in '${collection.name}', so you can't ${action} posts. Ask the owner to make you an editor.`,
      );
    }
    const archiveIds = this.archiveIdsFrom(params);
    const changed = this.deps.service.applyMembership(archiveIds, [
      { collectionId: collection.id, include: action === 'add' },
    ]);
    const counts = action === 'add'
      ? { added: changed, alreadyIn: archiveIds.length - changed }
      : { removed: changed, notIn: archiveIds.length - changed };
    return {
      collectionId: collection.id,
      name: collection.name,
      archiveIds,
      ...counts,
      notInVault: archiveIds.filter((archiveId) => this.deps.pathForArchive(archiveId) === null),
      syncScheduled: changed > 0,
    };
  }

  private link(collection: CollectionSummary): CollectionLinkCliResult {
    const shareUrl = this.shareUrl(collection);
    const role = collection.role ?? 'owner';
    return {
      collectionId: collection.id,
      name: collection.name,
      visibility: collection.visibility,
      shareUrl,
      ...(shareUrl
        ? {}
        : {
          hint: !canManage(role)
            ? 'Only the owner has the link; ask them for it.'
            : collection.visibility === 'private'
              ? 'This collection is private. Run action=share confirm=true to share it with anyone who has the link.'
              : 'The link has not synced to this device yet; try again in a moment.',
        }),
    };
  }

  private share(params: CliParams, collection: CollectionSummary): CollectionLinkCliResult {
    if (!canManage(collection.role ?? 'owner')) {
      throw new CliValidationError('collection', `Only the owner can share '${collection.name}'.`);
    }
    const shareUrl = this.shareUrl(collection);
    if (shareUrl) return { collectionId: collection.id, name: collection.name, visibility: collection.visibility, shareUrl };
    if (!parseBool(params, 'confirm')) {
      throw new CliValidationError(
        'confirm',
        'share makes this collection viewable by anyone with the link, posts in full with photos and videos; pass confirm=true.',
      );
    }
    // The first share is link-only with the timeline view and your notes on,
    // like the apps' "Copy link". A failure here has no caller left to tell.
    void this.deps.service.shareForLink(collection.id, 'timeline')
      .then((result) => {
        if (!result.ok) console.warn('[Social Archiver] CLI collection share failed:', collection.id, result.reason);
      })
      .catch((error: unknown) => {
        console.warn('[Social Archiver] CLI collection share failed:', collection.id, error);
      });
    return {
      collectionId: collection.id,
      name: collection.name,
      visibility: 'unlisted',
      shareUrl: null,
      scheduled: true,
      hint: 'Run action=link in a few seconds to read the link.',
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** By id first (following id remaps), then by exact name; your own collection wins a name clash. */
  /**
   * `archive collection=…` (prd-archive-into-collections): the server ids to
   * send. Each must be one the server already knows and the caller can add to —
   * the server would only skip the rest.
   */
  resolveServerIds(refs: readonly string[]): string[] {
    if (!this.deps.username()) {
      throw new CollectionsCliError('AUTH_REQUIRED', 'Sign in to Social Archiver to use collections.');
    }
    const ids = refs.map((ref) => {
      const collection = this.resolveRef(ref);
      if (!canContribute(collection.role ?? 'owner')) {
        throw new CliValidationError('collection', `You're a viewer in '${collection.name}', so you can't add posts to it.`);
      }
      if (!collection.synced) {
        throw new CliValidationError('collection', `'${collection.name}' hasn't reached the server yet; try again in a moment.`);
      }
      return collection.id;
    });
    return [...new Set(ids)];
  }

  private resolveCollection(params: CliParams, action: CollectionsCliAction): CollectionSummary {
    const ref = parseString(params, 'collection');
    if (!ref) {
      throw new CliValidationError(
        'collection',
        `action='${action}' requires 'collection' (an id or exact name). Run \`social-archiver:collections\` to list them.`,
      );
    }
    return this.resolveRef(ref);
  }

  private resolveRef(ref: string): CollectionSummary {
    const collections = this.deps.store.getCollections();
    const canonicalId = this.deps.store.resolveId(ref);
    const byId = collections.find((collection) => collection.id === canonicalId);
    if (byId) return byId;

    const key = normalizeCollectionName(ref);
    const named = collections.filter((collection) => normalizeCollectionName(collection.name) === key);
    const owned = named.filter((collection) => (collection.role ?? 'owner') === 'owner');
    // Names are unique among your own collections, not across shared ones.
    const [ownedMatch] = owned;
    if (owned.length === 1 && ownedMatch) return ownedMatch;
    const [namedMatch] = named;
    if (named.length === 1 && namedMatch) return namedMatch;
    if (named.length > 1) {
      throw new CliValidationError(
        'collection',
        `${named.length} collections are named '${ref}'; pass an id instead: ${named.map((collection) => collection.id).join(', ')}.`,
      );
    }
    throw new CliValidationError(
      'collection',
      `No collection has the id or name '${ref}'. Run \`social-archiver:collections\` to list them.`,
    );
  }

  /** Exactly one of `path`, `active` or `archive`. */
  private archiveIdsFrom(params: CliParams): string[] {
    const path = parseString(params, 'path');
    const active = parseBool(params, 'active', false);
    const archiveIds = parseCsv(params, 'archive');
    const sources = [path !== undefined, active, archiveIds.length > 0].filter(Boolean).length;
    if (sources !== 1) {
      throw new CliValidationError('path', "Pass exactly one of 'path=<vault-path>', the bare 'active' flag, or 'archive=<id1,id2>'.");
    }
    if (archiveIds.length > 0) {
      const unique = [...new Set(archiveIds)];
      if (unique.length > MAX_ARCHIVE_IDS) {
        throw new CliValidationError('archive', `Up to ${MAX_ARCHIVE_IDS} archive ids per call.`);
      }
      return unique;
    }

    const note = this.deps.noteFor(path ?? 'active');
    if (note.archiveId) return [note.archiveId];
    throw new CliValidationError(
      active ? 'active' : 'path',
      note.isLocalOnly
        ? `'${note.path}' is only in this vault. Upload it to your account before adding it to a collection.`
        : `'${note.path}' isn't an archived post (it has no sourceArchiveId).`,
    );
  }

  private summaryFor(collectionId: string): CollectionSummary {
    const summary = this.deps.store.getCollections().find((collection) => collection.id === collectionId);
    if (!summary) throw new CollectionsCliError('OPERATION_FAILED', 'The collection disappeared while it was being read.');
    return summary;
  }

  private summarize(collection: CollectionSummary): CollectionCliSummary {
    return {
      collectionId: collection.id,
      name: collection.name,
      description: collection.description,
      visibility: collection.visibility,
      role: collection.role ?? 'owner',
      collaborative: collection.collaborative === true,
      owner: collection.ownerUsername ?? this.deps.username(),
      myPostCount: collection.itemCount,
      shareUrl: this.shareUrl(collection),
      pendingSync: collection.isDirty || !collection.synced,
    };
  }

  /** The server's own format (`${SHARE_WEB_URL}/${owner}/c/${token}`); the token reaches owners only. */
  private shareUrl(collection: CollectionSummary): string | null {
    if (collection.visibility === 'private' || !collection.shareToken) return null;
    const owner = collection.ownerUsername ?? this.deps.username();
    if (!owner) return null;
    return `${this.deps.shareWebUrl}/${encodeURIComponent(owner)}/c/${encodeURIComponent(collection.shareToken)}`;
  }
}
