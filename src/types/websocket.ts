/**
 * WebSocket Event Types for Obsidian Plugin
 *
 * Defines all event types received from TimelineRoom Durable Object.
 * These types should match the server-side definitions in workers/src/types/websocket.ts
 */

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
