/**
 * WebSocket Event Types for Obsidian Plugin
 *
 * Defines all event types received from TimelineRoom Durable Object.
 * These types should match the server-side definitions in workers/src/types/websocket.ts
 */

import type { Platform } from './post';
import type { ArchiveLinkRelation } from './link-relations';

// ============================================================================
// Client Sync Event (from mobile app sync)
// ============================================================================

/**
 * Archive preview data sent via WebSocket
 */
export interface ClientSyncArchivePreview {
  id: string;
  platform: string;
  title: string | null;
  authorName: string | null;
  previewText: string | null;
  thumbnailUrl: string | null;
  archivedAt: string;
}

/**
 * Sent when a new archive needs to be synced to this client
 * Used to receive real-time sync notifications from mobile app
 */
export interface ClientSyncEventData {
  /** Unique queue item ID for acknowledgement */
  queueId: string;
  /** Archive ID to sync */
  archiveId: string;
  /** Target client ID (should match settings.syncClientId) */
  clientId: string;
  /** Client type for filtering */
  clientType: 'obsidian' | 'self-hosted' | 'webhook' | 'notion' | 'apple-notes';
  /** Archive preview data */
  archive: ClientSyncArchivePreview | null;
}

export interface ClientSyncEvent {
  type: 'client_sync';
  data: ClientSyncEventData;
}

// ============================================================================
// Archive Complete Event
// ============================================================================

export interface ArchiveCompleteEventData {
  jobId: string;
  archiveId: string;
  platform: string;
  url: string;
  title: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  previewText: string | null;
  thumbnailUrl: string | null;
  status: 'completed' | 'failed';
  error?: string;
}

export interface ArchiveCompleteEvent {
  type: 'archive_complete';
  data: ArchiveCompleteEventData;
}

// ============================================================================
// Share Created Event
// ============================================================================

export interface ShareCreatedEventData {
  archiveId: string;
  shareUrl: string;
  shareId: string;
}

export interface ShareCreatedEvent {
  type: 'share_created';
  data: ShareCreatedEventData;
}

// ============================================================================
// Action Updated Event (private channel)
// ============================================================================

/**
 * Sent when a user updates archive actions (like, bookmark, share, annotations)
 */
export interface ActionUpdatedEventData {
  archiveId: string;
  sourceClientId?: string;
  changes: {
    isLiked?: boolean;
    isBookmarked?: boolean;
    shareUrl?: string | null;
    /** True when userNotes or userHighlights were modified on the archive */
    hasAnnotationUpdate?: boolean;
    /** True when AI-generated comments were explicitly cleared remotely */
    clearAIComments?: boolean;
    /** True when desktop-generated transcription was explicitly cleared remotely */
    clearTranscription?: boolean;
  };
  updatedAt: string;
  timestamp: number;
}

export interface ActionUpdatedEvent {
  type: 'action_updated';
  data: ActionUpdatedEventData;
}

// ============================================================================
// Share Deleted Event (private channel)
// ============================================================================

/**
 * Sent when a share link is deleted
 */
export interface ShareDeletedEventData {
  shareId: string;
  shareUrl: string;
  originalUrl?: string;
  updatedAt: string;
  timestamp: number;
}

export interface ShareDeletedEvent {
  type: 'share_deleted';
  data: ShareDeletedEventData;
}

// ============================================================================
// Archive Deleted Event (private channel)
// ============================================================================

/**
 * Sent when an archive is fully deleted
 */
export interface ArchiveDeletedEventData {
  archiveId: string;
  originalUrl?: string;
  sourceClientId?: string;
  updatedAt: string;
  timestamp: number;
}

export interface ArchiveDeletedEvent {
  type: 'archive_deleted';
  data: ArchiveDeletedEventData;
}

// ============================================================================
// Archive Tags Updated Event (private channel)
// ============================================================================

/**
 * Sent when archive-tag mappings are upserted or deleted via the tag API.
 * Allows the plugin to update frontmatter tags in real-time without a full sync.
 */
export interface ArchiveTagsUpdatedEventData {
  archiveId: string;
  /** Current tag NAMES (not IDs) after the change, ordered by sort_order then name */
  tags: string[];
  updatedAt: string;
  timestamp: number;
  /** The clientId that originated the tag change (for echo suppression) */
  sourceClientId?: string;
}

export interface ArchiveTagsUpdatedEvent {
  type: 'archive_tags_updated';
  data: ArchiveTagsUpdatedEventData;
}

// ============================================================================
// Content Variant Updated Event (private channel)
// ============================================================================

export interface ContentVariantUpdatedEventData {
  type: 'content_variant_updated';
  userId: string;
  archiveId: string;
  variantId: string;
  action: 'created' | 'updated' | 'hidden' | 'deleted' | 'activated' | 'stale';
  activeContentVariantId?: string;
  updatedAt: string;
}

export interface ContentVariantUpdatedEvent {
  type: 'content_variant_updated';
  data: ContentVariantUpdatedEventData;
}

// ============================================================================
// Author Profile Updated Event (private channel)
// ============================================================================

export interface AuthorProfileUpdatedEventData {
  profile: {
    authorKey: string;
    platform: Platform;
    authorName: string;
    authorUrl: string | null;
    authorHandle: string | null;
    displayNameOverride: string | null;
    bioOverride: string | null;
    fetchedBio?: string | null;
    fetchedBioUpdatedAt?: string | null;
    fetchedBioSource?: string | null;
    fetchedAvatarUrl?: string | null;
    fetchedAvatarR2Key?: string | null;
    fetchedAvatarUpdatedAt?: string | null;
    avatarPreservationStatus?: string | null;
    aliases: string[];
    updatedAt: string;
  };
  updatedAt: string;
  timestamp: number;
  sourceClientId?: string;
}

export interface AuthorProfileUpdatedEvent {
  type: 'author_profile_updated';
  data: AuthorProfileUpdatedEventData;
}

// ============================================================================
// Subscription Changed Event (private channel)
// ============================================================================

export interface SubscriptionChangedEventData {
  subscriptionId: string;
  action: 'created' | 'updated' | 'deleted' | 'paused' | 'resumed';
  subscription?: {
    id: string;
    platform: string;
    name: string;
    target: {
      handle: string;
      profileUrl?: string;
    };
    enabled: boolean;
    updatedAt: string;
  };
  updatedAt: string;
  timestamp: number;
  sourceClientId?: string;
}

export interface SubscriptionChangedEvent {
  type: 'subscription_changed';
  data: SubscriptionChangedEventData;
}

// ============================================================================
// Media Preserved Event (private channel)
// ============================================================================

/**
 * Sent when the server completes R2 media preservation for an archive.
 * The plugin should attempt to re-download media to replace placeholders.
 */
export interface MediaPreservedEventData {
  archiveId: string;
  status: 'completed' | 'partial' | 'failed';
}

export interface MediaPreservedEvent {
  type: 'media_preserved';
  data: MediaPreservedEventData;
}

// ============================================================================
// Transcription Job Events (private channel)
// ============================================================================

export interface TranscriptionRequestedEventData {
  jobId: string;
  targetClientId: string;
}

export interface TranscriptionRequestedEvent {
  type: 'transcription_requested';
  data: TranscriptionRequestedEventData;
}

export interface TranscriptionStatusUpdatedEventData {
  jobId: string;
  targetClientId?: string;
  status: string;
  uiStatus?: string;
  progressPercentage?: number;
  progressCode?: string;
  nextAttemptAt?: string;
  errorCode?: string;
  terminalReason?: string;
  localMediaPath?: string;
}

export interface TranscriptionStatusUpdatedEvent {
  type: 'transcription_status_updated';
  data: TranscriptionStatusUpdatedEventData;
}

export interface TranscriptionCancelledEventData {
  jobId: string;
  targetClientId: string;
}

export interface TranscriptionCancelledEvent {
  type: 'transcription_cancelled';
  data: TranscriptionCancelledEventData;
}

export interface TranscriptionUpdatedEventData {
  jobId: string;
  archiveId: string;
  mediaRefHash: string;
  transcriptResultId?: string;
}

export interface TranscriptionUpdatedEvent {
  type: 'transcription_updated';
  data: TranscriptionUpdatedEventData;
}

// ============================================================================
// Billing Status Updated Event (private channel)
// ============================================================================

/**
 * Sent when server-side billing status changes.
 * The plugin should refresh `/api/user/usage`; server remains source-of-truth.
 */
/**
 * Mirrored from `workers/src/types/websocket.ts`. Server is source of truth —
 * keep this union in lockstep when the worker broadcast taxonomy evolves.
 *
 * PRD: `.taskmaster/docs/prd-billing-lifecycle-notifications-plugin.md` §7.2.
 *
 * Optional fields (`source`, `plan`, `entitlementActive`, `expiresAt`) carry
 * the new winning materialization so the plugin can render the change
 * optimistically while `/api/user/usage` refresh is in flight. They are
 * STRICTLY NON-SENSITIVE — never include license keys, RC subscriber
 * attributes, payment amounts, or coupon plaintext.
 */
export interface BillingStatusUpdatedEventData {
  updatedAt: string;
  timestamp: number;
  reason:
    | 'revenuecat_webhook'
    | 'coupon_redeemed'
    | 'premium_trial_started'
    | 'premium_trial_expired'
    | 'premium_trial_expiring_24h'
    | 'premium_trial_converted'
    | 'admin_override'
    | 'entitlement_recomputed'
    | 'legacy_license_validated'
    | 'subscription_cancellation_pending'
    | 'billing_issue'
    | 'trial_expiring_soon'
    | 'plan_upgraded'
    | 'plan_revoked'
    | 'coupon_expired'
    | 'admin_grant_expired'
    | 'revenuecat_cancellation_pending'
    | 'revenuecat_billing_issue';
  /** Original RevenueCat event type for the webhook reason; back-compat. */
  eventType?: string;
  source?: string;
  plan?: string;
  entitlementActive?: boolean;
  expiresAt?: string | null;
}

export interface BillingStatusUpdatedEvent {
  type: 'billing_status_updated';
  data: BillingStatusUpdatedEventData;
}

// ============================================================================
// Archive Relation Updated Event (private channel)
// ============================================================================

/**
 * Sent when an archive_link_relations row is created/updated/soft-deleted.
 * Carries the FULL relation row (including `deletedAt` for soft-deletes) so the
 * plugin can re-render the affected `## Linked archives` sections without a
 * pull.
 *
 * Mirror of the server broadcast in `workers/src/utils/relation-broadcast.ts`
 * (`{ type: 'archive_relation_updated', data: { relation } }`).
 */
export interface ArchiveRelationUpdatedEventData {
  relation: ArchiveLinkRelation;
}

export interface ArchiveRelationUpdatedEvent {
  type: 'archive_relation_updated';
  data: ArchiveRelationUpdatedEventData;
}

// ============================================================================
// Ping/Pong Events
// ============================================================================

export interface PongEvent {
  type: 'pong';
  timestamp: number;
}

// ============================================================================
// Union Types
// ============================================================================

/**
 * All possible WebSocket events that can be received
 */
export type WebSocketEvent =
  | ClientSyncEvent
  | ArchiveCompleteEvent
  | ShareCreatedEvent
  | ActionUpdatedEvent
  | ShareDeletedEvent
  | ArchiveDeletedEvent
  | ArchiveTagsUpdatedEvent
  | AuthorProfileUpdatedEvent
  | SubscriptionChangedEvent
  | MediaPreservedEvent
  | BillingStatusUpdatedEvent
  | ArchiveRelationUpdatedEvent
  | PongEvent;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if event is a client sync event
 */
export function isClientSyncEvent(event: unknown): event is ClientSyncEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    (event as Record<string, unknown>).type === 'client_sync'
  );
}

/**
 * Check if event data is valid client sync data
 */
export function isClientSyncEventData(data: unknown): data is ClientSyncEventData {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const d = data as Record<string, unknown>;
  return (
    typeof d.queueId === 'string' &&
    typeof d.archiveId === 'string' &&
    typeof d.clientId === 'string' &&
    typeof d.clientType === 'string'
  );
}
