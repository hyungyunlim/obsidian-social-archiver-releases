/**
 * CliFlags — re-export shim.
 *
 * Command ids and flag schemas now live in the shared `@social-archiver/cli-core`
 * package (single source of truth shared with the desktop CLI). cli-core's
 * `CliFlag` is structurally identical to Obsidian's `CliFlag`
 * (`{ description: string; value?: string; required?: boolean }`), so the
 * re-exported `*_FLAGS` objects remain assignable where `registerCliHandler`
 * expects Obsidian's `CliFlags`.
 */

export {
  COMMANDS,
  COMMAND_DESCRIPTIONS,
  DEFAULT_FLAGS,
  ARCHIVE_FLAGS,
  JOB_FLAGS,
  JOBS_FLAGS,
  JOBS_CHECK_FLAGS,
  SYNC_FLAGS,
  PROFILE_CRAWL_FLAGS,
  SUBSCRIBE_FLAGS,
  GOOGLEMAPS_FLAGS,
  IMPORT_INSTAGRAM_FLAGS,
  IMPORT_JOB_FLAGS,
  IMPORT_CONTROL_FLAGS,
  POST_FLAGS,
  SHARE_FLAGS,
  TAGS_FLAGS,
  TAG_CREATE_FLAGS,
  TAG_APPLY_FLAGS,
  TRANSCRIBE_FLAGS,
  MEDIA_FLAGS,
  AUTHOR_NOTES_FLAGS,
  AI_COMMENT_FLAGS,
  AI_COMMENTS_FLAGS,
  AI_PROVIDERS_FLAGS,
} from '@social-archiver/cli-core';

export type { CommandId } from '@social-archiver/cli-core';
