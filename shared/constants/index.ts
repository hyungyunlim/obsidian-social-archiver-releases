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

/**
 * Marker in the body of a publisher-API outlink note: the archive saved when a
 * paywalled article could not be read, holding the publisher's own headline
 * and summary plus a link (workers NytArticleSearchService).
 *
 * Clients key on it the way they key on "Limited archive". The plugin rewrites
 * a vault note that still carries it once the same archive arrives with the
 * full text (a subscriber clip or an app session capture upserts the row).
 * Every publisher outlink must put this phrase in its body. Kept to the prefix
 * both live outlinks share: NYT "…from the official New York Times API" and FT
 * "…from the Financial Times' public preview", so rows saved before the
 * constant existed still match.
 */
export const PUBLISHER_OUTLINK_MARKER = 'Headline and summary from the';
