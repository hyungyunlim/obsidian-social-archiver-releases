/**
 * Author Note Types
 *
 * Types for the vault-native Author Notes feature.
 * An author note is an independent markdown file that stores
 * author profile metadata + user-authored notes as a first-class entity.
 *
 * Identity model:
 *   - authorKey (frontmatter) is the canonical identity, NOT the filename.
 *   - authorKey = "{platform}:url:{normalizedAuthorUrl}" (preferred)
 *   - authorKey = "{platform}:name:{normalizedAuthorName}" (legacy fallback)
 *
 * Ownership rules:
 *   - Plugin-managed fields: updated automatically on archive upsert
 *   - User-owned fields: NEVER overwritten by the plugin after creation
 *   - Body (markdown below frontmatter): NEVER auto-modified after creation
 */

import type { Platform } from './post';

// ============================================================================
// Constants
// ============================================================================

/** Frontmatter `type` discriminator for author notes */
export const AUTHOR_NOTE_TYPE = 'social-archiver-author' as const;

/** Current frontmatter schema version */
export const AUTHOR_NOTE_VERSION = 1;

// ============================================================================
// Author Note Data
// ============================================================================

/**
 * Full author note data as stored in YAML frontmatter.
 *
 * Split into plugin-managed fields (auto-updated on archive)
 * and user-owned fields (never overwritten by the plugin).
 */
export interface AuthorNoteData {
  // ── Discriminator ──────────────────────────────────────────────────
  /** Must be 'social-archiver-author' */
  type: typeof AUTHOR_NOTE_TYPE;
  /** Schema version for future migrations */
  noteVersion: number;

  // ── Identity (plugin-managed) ──────────────────────────────────────
  /** Canonical identity key (e.g. "facebook:url:https://...") */
  authorKey: string;
  /** Previous keys kept after key promotion (URL replaces name key) */
  legacyKeys: string[];
  /** Source platform */
  platform: Platform;

  // ── Profile (plugin-managed) ───────────────────────────────────────
  /** Display name from platform API */
  authorName: string;
  /** Profile URL */
  authorUrl?: string;
  /** Platform handle (e.g. @johndoe) */
  authorHandle?: string;
  /** External avatar URL */
  avatar?: string;
  /** Vault-local avatar path (plugin-local only, not synced) */
  localAvatar?: string;
  /** Follower count */
  followers?: number;
  /** Total posts count on platform */
  postsCount?: number;
  /** Author bio/description */
  bio?: string;
  /** Verified status on platform */
  verified?: boolean;

  // ── Statistics (plugin-managed) ────────────────────────────────────
  /** Number of archived posts in vault */
  archiveCount: number;
  /** Timestamp of most recent archive */
  lastSeenAt?: string;
  /** Timestamp of last metadata write */
  lastMetadataUpdate?: string;

  // ── User-owned fields (NEVER overwritten by plugin) ────────────────
  /** User's custom display name override */
  displayNameOverride?: string;
  /** User's custom bio override / correction */
  bioOverride?: string;
  /** User-defined aliases */
  aliases?: string[];
}

// ============================================================================
// Field ownership classification
// ============================================================================

/**
 * Fields the plugin may auto-update during upsert.
 * User-owned fields are explicitly excluded.
 */
export const PLUGIN_MANAGED_FIELDS: ReadonlySet<keyof AuthorNoteData> = new Set([
  'type',
  'noteVersion',
  'authorKey',
  'legacyKeys',
  'platform',
  'authorName',
  'authorUrl',
  'authorHandle',
  'avatar',
  'localAvatar',
  'followers',
  'postsCount',
  'bio',
  'verified',
  'archiveCount',
  'lastSeenAt',
  'lastMetadataUpdate',
]);

/**
 * Fields owned by the user — the plugin must NEVER overwrite these.
 */
export const USER_OWNED_FIELDS: ReadonlySet<keyof AuthorNoteData> = new Set([
  'displayNameOverride',
  'bioOverride',
  'aliases',
]);
