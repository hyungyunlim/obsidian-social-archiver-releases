/**
 * CliFlags — central definitions of every Social Archiver CLI command and its
 * flag schema. Ported verbatim from `src/plugin/cli/CliFlags.ts`; the only
 * change is a local `CliFlag`/`CliFlags` structural type instead of importing
 * the Obsidian host's `CliFlags` type, so cli-core has no Obsidian dependency.
 */
/** Structural shape of a single flag definition (matches the host CliFlag). */
export interface CliFlag {
    description: string;
    value?: string;
    required?: boolean;
}
export type CliFlags = Record<string, CliFlag>;
export declare const COMMANDS: {
    readonly DEFAULT: "social-archiver";
    readonly ARCHIVE: "social-archiver:archive";
    readonly JOB: "social-archiver:job";
    readonly JOBS: "social-archiver:jobs";
    readonly JOBS_CHECK: "social-archiver:jobs:check";
    readonly SYNC: "social-archiver:sync";
    readonly PROFILE_CRAWL: "social-archiver:profile-crawl";
    readonly SUBSCRIBE: "social-archiver:subscribe";
    readonly GOOGLEMAPS: "social-archiver:googlemaps";
    readonly IMPORT_INSTAGRAM: "social-archiver:import-instagram";
    readonly IMPORT_JOB: "social-archiver:import-job";
    readonly IMPORT_CONTROL: "social-archiver:import-control";
    readonly POST: "social-archiver:post";
    readonly SHARE: "social-archiver:share";
    readonly TAGS: "social-archiver:tags";
    readonly TAG_CREATE: "social-archiver:tag-create";
    readonly TAG_APPLY: "social-archiver:tag-apply";
    readonly TRANSCRIBE: "social-archiver:transcribe";
    readonly MEDIA: "social-archiver:media";
    readonly AUTHOR_NOTES: "social-archiver:author-notes";
    readonly AI_COMMENT: "social-archiver:ai-comment";
    readonly AI_COMMENTS: "social-archiver:ai-comments";
    readonly AI_PROVIDERS: "social-archiver:ai-providers";
    readonly SEARCH: "social-archiver:search";
    readonly BOOKMARK: "social-archiver:bookmark";
};
export type CommandId = (typeof COMMANDS)[keyof typeof COMMANDS];
export declare const DEFAULT_FLAGS: CliFlags;
export declare const ARCHIVE_FLAGS: CliFlags;
export declare const JOB_FLAGS: CliFlags;
export declare const JOBS_FLAGS: CliFlags;
export declare const JOBS_CHECK_FLAGS: CliFlags;
export declare const SYNC_FLAGS: CliFlags;
export declare const PROFILE_CRAWL_FLAGS: CliFlags;
export declare const SUBSCRIBE_FLAGS: CliFlags;
export declare const GOOGLEMAPS_FLAGS: CliFlags;
export declare const IMPORT_INSTAGRAM_FLAGS: CliFlags;
export declare const IMPORT_JOB_FLAGS: CliFlags;
export declare const IMPORT_CONTROL_FLAGS: CliFlags;
export declare const POST_FLAGS: CliFlags;
export declare const SHARE_FLAGS: CliFlags;
export declare const TAGS_FLAGS: CliFlags;
export declare const TAG_CREATE_FLAGS: CliFlags;
export declare const TAG_APPLY_FLAGS: CliFlags;
export declare const TRANSCRIBE_FLAGS: CliFlags;
export declare const MEDIA_FLAGS: CliFlags;
export declare const AUTHOR_NOTES_FLAGS: CliFlags;
export declare const AI_COMMENT_FLAGS: CliFlags;
export declare const AI_COMMENTS_FLAGS: CliFlags;
export declare const AI_PROVIDERS_FLAGS: CliFlags;
export declare const SEARCH_FLAGS: CliFlags;
export declare const BOOKMARK_FLAGS: CliFlags;
export declare const COMMAND_DESCRIPTIONS: Readonly<Record<CommandId, string>>;
/** Flag schema lookup by command id — used by the argv layer for help/validation. */
export declare const FLAGS_BY_COMMAND: Readonly<Record<CommandId, CliFlags>>;
//# sourceMappingURL=flags.d.ts.map