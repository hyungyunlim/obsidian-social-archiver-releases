/**
 * AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
 *
 * Source: shared/constants/index.ts
 * Generated: 2026-02-18T13:14:22.262Z
 *
 * To modify, edit the source file in shared/constants/ and run:
 *   npm run sync:shared
 */

/**
 * Shared Constants - Single Source of Truth
 *
 * This file contains shared constants used across:
 * - Obsidian plugin (src/)
 * - Cloudflare Workers (workers/src/)
 *
 * To modify, edit this file and run:
 *   npm run sync:shared
 */

/**
 * Default archive path for saving posts
 * Used as the base folder for all archived content
 */
export const DEFAULT_ARCHIVE_PATH = 'Social Archives';

/**
 * @deprecated Use DEFAULT_ARCHIVE_PATH instead
 * Legacy path for subscription content - no longer used for new subscriptions
 */
export const LEGACY_SUBSCRIPTION_PATH = 'Social Archives/Subscriptions';
