/**
 * Collections (prd-collections-obsidian-plugin). Server contract mirror.
 *
 * FROZEN CONTRACT: the literal arrays below are copied verbatim from
 * workers/src/types/share-settings.ts and collection-members.ts, like the
 * mobile, desktop and share-web mirrors, and pinned by
 * src/__tests__/types/collections.contract.test.ts. Change them only together
 * with every mirror.
 */

// =====================================================
// Vocabulary, limits, capability
// =====================================================

export const POST_SHARE_VISIBILITIES = ['public', 'unlisted'] as const;
export type PostShareVisibility = (typeof POST_SHARE_VISIBILITIES)[number];

export const POST_SHARE_DISPLAY_MODES = ['card', 'reader'] as const;
export type PostShareDisplayMode = (typeof POST_SHARE_DISPLAY_MODES)[number];

export const COLLECTION_VISIBILITIES = ['private', 'unlisted', 'public'] as const;
export type CollectionVisibility = (typeof COLLECTION_VISIBILITIES)[number];

export const COLLECTION_DISPLAY_MODES = ['timeline', 'list', 'media-only', 'mosaic', 'text-only', 'reader'] as const;
export type CollectionDisplayMode = (typeof COLLECTION_DISPLAY_MODES)[number];

export const COLLECTION_ROLES = ['owner', 'editor', 'viewer'] as const;
export type CollectionRole = (typeof COLLECTION_ROLES)[number];

export const COLLECTION_MEMBER_ROLES = ['editor', 'viewer'] as const;
export type CollectionMemberRole = (typeof COLLECTION_MEMBER_ROLES)[number];

export const COLLECTION_LIMITS = {
  maxCollectionsPerUser: 1000,
  maxItemsPerCollection: 5000,
  nameMaxLength: 60,
  descriptionMaxLength: 500,
  maxCollectionsPerUpsert: 100,
  maxPairsPerRequest: 500,
} as const;

export const COLLECTION_MEMBER_LIMITS = {
  maxMembersPerCollection: 50,
  maxActiveInvitesPerCollection: 20,
  inviteDefaultExpiryDays: 7,
  inviteMaxExpiryDays: 30,
  memberViewDefaultLimit: 30,
  memberViewMaxLimit: 50,
} as const;

export const COLLECTION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** Without it the server returns owned collections only, in the v1 shape. */
export const COLLECTIONS_SHARED_CAPABILITY = 'collections-shared-v1';

// Role rules (workers/src/types/collection-members.ts).
export const canContribute = (role: CollectionRole): boolean => role === 'owner' || role === 'editor';
export const canEditDetails = canContribute;
export const canManage = (role: CollectionRole): boolean => role === 'owner';

// =====================================================
// Owner API
// =====================================================

export interface UserCollectionDTO {
  id: string;
  name: string;
  description: string | null;
  visibility: CollectionVisibility;
  /** Owner only; kept while private so re-sharing revives the same link. */
  shareToken: string | null;
  displayMode: CollectionDisplayMode;
  includeAnnotations: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  // collections-shared-v1 only
  role?: CollectionRole;
  ownerUsername?: string;
  memberCount?: number;
  collaborative?: boolean;
  includeMyAnnotations?: boolean;
}

export interface CollectionItemPair {
  collectionId: string;
  archiveId: string;
}

export interface UserCollectionItemDTO extends CollectionItemPair {
  addedAt: string;
  updatedAt: string;
}

export interface CollectionUpsertInput {
  id: string;
  name: string;
  /** undefined keeps, null or blank clears. */
  description?: string | null;
  sortOrder?: number;
}

export type CollectionRejectCode =
  | 'COLLECTION_LIMIT_REACHED'
  | 'COLLECTION_DELETED'
  | 'COLLECTION_ID_CONFLICT'
  | 'COLLECTION_NAME_TAKEN'
  | 'COLLECTION_FORBIDDEN';

export interface ResolvedCollection {
  requestedId: string;
  canonicalCollection: UserCollectionDTO;
}

export interface RejectedCollection {
  id: string;
  code: CollectionRejectCode;
  serverCollection?: UserCollectionDTO;
}

export type CollectionItemSkipReason =
  | 'COLLECTION_NOT_FOUND'
  | 'COLLECTION_ITEM_LIMIT_REACHED'
  | 'COLLECTION_FORBIDDEN';

export interface SkippedCollectionItemPair extends CollectionItemPair {
  reason: CollectionItemSkipReason;
}

export interface CollectionShareState {
  collectionId: string;
  visibility: CollectionVisibility;
  shareToken: string | null;
  shareUrl: string | null;
  displayMode: CollectionDisplayMode;
  includeAnnotations: boolean;
  /** Items the shared page leaves out (not public on their platform, deleted, or unknown to the server). */
  hiddenItemCount: number;
  updatedAt: string;
}

export interface CollectionShareUpdate {
  visibility: CollectionVisibility;
  displayMode?: CollectionDisplayMode;
  includeAnnotations?: boolean;
}

export interface GetUserCollectionsResponse {
  collections: UserCollectionDTO[];
  deletedIds: string[];
  serverTime: string;
  /** Every collection the caller is an active non-owner member of, regardless of the cursor. */
  memberCollectionIds?: string[];
}

export interface UpsertCollectionsResponse {
  upserted: number;
  serverTime: string;
  resolvedCollections: ResolvedCollection[];
  rejected: RejectedCollection[];
}

export interface DeleteCollectionResponse {
  collectionId: string;
  deletedItemCount: number;
  serverTime: string;
}

export interface GetUserCollectionItemsResponse {
  items: UserCollectionItemDTO[];
  deletedPairs: CollectionItemPair[];
  serverTime: string;
}

export interface UpsertCollectionItemsResponse {
  upserted: number;
  serverTime: string;
  skippedPairs: SkippedCollectionItemPair[];
}

export interface DeleteCollectionItemsResponse {
  deleted: number;
  serverTime: string;
}

// =====================================================
// Members, invites, member view
// =====================================================

export interface CreateCollectionInviteBody {
  role: CollectionMemberRole;
  expiresInDays?: number;
}

export interface CollectionInvite {
  token: string;
  collectionId: string;
  role: CollectionMemberRole;
  inviteUrl: string;
  createdAt: string;
  expiresAt: string;
  maxUses: number | null;
  useCount: number;
}

export interface CollectionMember {
  username: string;
  role: CollectionMemberRole;
  joinedAt: string;
}

export interface CollectionMembersResponse {
  collectionId: string;
  ownerUsername: string;
  viewerRole: CollectionRole;
  members: CollectionMember[];
}

export interface CollectionMembershipSettings {
  collectionId: string;
  role: CollectionMemberRole;
  includeAnnotations: boolean;
  sortOrder: number;
  updatedAt: string;
}

export interface MemberCollectionHeader {
  id: string;
  name: string;
  description: string | null;
  ownerUsername: string;
  visibility: CollectionVisibility;
  displayMode: CollectionDisplayMode;
  role: CollectionRole;
  memberCount: number;
  shareUrl: string | null;
  updatedAt: string;
}

/** The subset of the server's PublicFeedPostV1 that the read-only card renders. */
export interface RemoteCollectionPost {
  platform?: string;
  url?: string;
  title?: string;
  previewText?: string;
  postedAt?: string;
  publishedDate?: string;
  archivedAt?: string;
  thumbnail?: string;
  canonicalUrl?: string | null;
  content?: { text?: string; markdown?: string };
  author?: { name?: string; username?: string; handle?: string; url?: string; avatar?: string } | null;
  media?: ReadonlyArray<{
    url?: string;
    cdnUrl?: string;
    r2Url?: string;
    thumbnail?: string;
    r2ThumbnailUrl?: string;
    type?: string;
  }>;
}

export interface MemberCollectionPostItem {
  kind: 'post';
  archiveId: string;
  addedAt: string;
  addedBy?: string;
  post: RemoteCollectionPost;
  /** Shared notes and highlights every member sees (CC8), oldest first. The feed shows the notes. */
  sharedAnnotations?: ReadonlyArray<CollectionSharedAnnotation>;
}

/** CC8, as far as this feed reads it. */
export interface CollectionSharedAnnotation {
  kind: 'note' | 'highlight';
  id: string;
  authorUsername: string;
  /** A note's text (a highlight's note is not shown here). */
  content?: string;
  createdAt: string;
  updatedAt: string;
}

/** An item not public on its platform, shown content-free to the owner and editors who didn't add it. */
export interface MemberCollectionHiddenItem {
  kind: 'hidden';
  archiveId: string;
  addedAt: string;
  addedBy?: string;
  reason: 'audience';
}

export type MemberCollectionItem = MemberCollectionPostItem | MemberCollectionHiddenItem;

export interface MemberCollectionViewPage {
  collection: MemberCollectionHeader;
  items: MemberCollectionItem[];
  nextCursor: string | null;
}

// =====================================================
// Post share settings, notification preference
// =====================================================

export interface PostShareSettings {
  visibility: PostShareVisibility;
  displayMode: PostShareDisplayMode;
  includeAnnotations: boolean;
}

export interface PostShareSettingsResponse {
  shareId: string;
  shareUrl: string;
  passwordProtected: boolean;
  settings: PostShareSettings;
}

// =====================================================
// Local model
// =====================================================

/** A collection as this device knows it. Server fields plus sync bookkeeping. */
export interface LocalCollection extends UserCollectionDTO {
  /** Local edits not yet accepted by the server. */
  isDirty: boolean;
  /** True once the server has acknowledged this id (items may only be pushed after). */
  synced: boolean;
}

export interface LocalCollectionItem extends CollectionItemPair {
  addedAt: string;
  isDirty: boolean;
}

/** A collection with the count of this user's own items in it. */
export interface CollectionSummary extends LocalCollection {
  itemCount: number;
}
