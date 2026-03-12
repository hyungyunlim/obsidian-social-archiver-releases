/**
 * AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
 *
 * Source: shared/constants/index.ts
 * Generated: 2026-03-12T14:38:02.705Z
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

/**
 * Feature flag: Reader Mode TTS (Text-to-Speech)
 * When false, TTS controller is not initialized and UI elements are hidden.
 */
export const FEATURE_READER_TTS_ENABLED = true;

/**
 * Feature flag: Editor TTS (Text-to-Speech for any Markdown document)
 * When false, editor TTS commands and status bar player are not registered.
 */
export const FEATURE_EDITOR_TTS_ENABLED = true;

/**
 * Feature flag: Cross-posting to external platforms (Threads, X, etc.)
 * When false, the Cross-posting settings section and PostComposer toggle are hidden.
 */
export const FEATURE_CROSSPOST_ENABLED = true;
