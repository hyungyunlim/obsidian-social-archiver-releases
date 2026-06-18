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

// -----------------------------------------------------------------------------
// Command IDs
// -----------------------------------------------------------------------------

export const COMMANDS = {
  DEFAULT: 'social-archiver',
  ARCHIVE: 'social-archiver:archive',
  JOB: 'social-archiver:job',
  JOBS: 'social-archiver:jobs',
  JOBS_CHECK: 'social-archiver:jobs:check',
  SYNC: 'social-archiver:sync',
  PROFILE_CRAWL: 'social-archiver:profile-crawl',
  SUBSCRIBE: 'social-archiver:subscribe',
  GOOGLEMAPS: 'social-archiver:googlemaps',
  IMPORT_INSTAGRAM: 'social-archiver:import-instagram',
  IMPORT_JOB: 'social-archiver:import-job',
  IMPORT_CONTROL: 'social-archiver:import-control',
  POST: 'social-archiver:post',
  SHARE: 'social-archiver:share',
  TAGS: 'social-archiver:tags',
  TAG_CREATE: 'social-archiver:tag-create',
  TAG_APPLY: 'social-archiver:tag-apply',
  TRANSCRIBE: 'social-archiver:transcribe',
  MEDIA: 'social-archiver:media',
  AUTHOR_NOTES: 'social-archiver:author-notes',
  AI_COMMENT: 'social-archiver:ai-comment',
  AI_COMMENTS: 'social-archiver:ai-comments',
  AI_PROVIDERS: 'social-archiver:ai-providers',
  SEARCH: 'social-archiver:search',
  BOOKMARK: 'social-archiver:bookmark',
} as const;

export type CommandId = (typeof COMMANDS)[keyof typeof COMMANDS];

// -----------------------------------------------------------------------------
// Shared flag fragments
// -----------------------------------------------------------------------------

const FORMAT_FLAG: CliFlags = {
  format: { description: 'Output format: json (default) or text.', value: '<json|text>' },
};

// -----------------------------------------------------------------------------
// P0 flags
// -----------------------------------------------------------------------------

export const DEFAULT_FLAGS: CliFlags = {
  ...FORMAT_FLAG,
};

export const ARCHIVE_FLAGS: CliFlags = {
  url: { description: 'URL of the social media post to archive.', value: '<url>', required: true },
  mode: { description: 'queue (default), sync, or fetch.', value: '<queue|sync|fetch>' },
  media: { description: 'Media handling: all (default), images, or none.', value: '<all|images|none>' },
  comments: { description: 'Include comments when supported.' },
  transcript: { description: 'Request transcription for video posts.' },
  formattedTranscript: { description: 'Request formatted transcript (markdown).' },
  tags: { description: 'Comma-separated tags to attach to the archive.', value: '<tag1,tag2>' },
  comment: { description: 'Inline comment to attach to the archive.', value: '<text>' },
  wait: { description: 'Block until terminal state (sync/fetch only).' },
  ...FORMAT_FLAG,
};

export const JOB_FLAGS: CliFlags = {
  id: { description: 'Job ID returned by archive submission.', value: '<job-id>', required: true },
  source: { description: 'local, server, or auto (default).', value: '<local|server|auto>' },
  ...FORMAT_FLAG,
};

export const JOBS_FLAGS: CliFlags = {
  status: {
    description: 'Filter by status: pending, processing, completed, failed, cancelled, all.',
    value: '<status>',
  },
  limit: { description: 'Maximum number of jobs to return (default 20).', value: '<n>' },
  ...FORMAT_FLAG,
};

export const JOBS_CHECK_FLAGS: CliFlags = {
  syncServer: { description: 'Also run server pending-job catch-up if enabled in settings.' },
  ...FORMAT_FLAG,
};

export const SYNC_FLAGS: CliFlags = {
  target: {
    description: 'subscriptions, library, pending, or all (default).',
    value: '<target>',
  },
  syncServer: { description: 'Include server pending-job catch-up if enabled.' },
  ...FORMAT_FLAG,
};

// -----------------------------------------------------------------------------
// P1 flags
// -----------------------------------------------------------------------------

export const PROFILE_CRAWL_FLAGS: CliFlags = {
  url: { description: 'Profile or RSS URL to crawl.', value: '<url>', required: true },
  count: { description: 'Maximum posts to fetch.', value: '<n>' },
  range: { description: 'Date range filter: all, 7d, 30d, 90d, or custom.', value: '<range>' },
  start: { description: 'Custom range start (YYYY-MM-DD).', value: '<YYYY-MM-DD>' },
  end: { description: 'Custom range end (YYYY-MM-DD).', value: '<YYYY-MM-DD>' },
  subscribe: { description: 'Create a subscription after the initial crawl.' },
  hour: { description: 'Local subscription hour (0-23).', value: '<0-23>' },
  redditSort: {
    description: 'Reddit sort mode: hot, new, top, rising.',
    value: '<hot|new|top|rising>',
  },
  redditTime: {
    description: 'Reddit time window: now, today, week, month, year, all.',
    value: '<now|today|week|month|year|all>',
  },
  keyword: { description: 'Optional keyword filter.', value: '<text>' },
  rss: { description: 'Force RSS interpretation when ambiguous.' },
  naverCookie: { description: 'Base64-encoded Naver session cookie.', value: '<base64>' },
  naverSubscriptionType: {
    description: 'Naver subscription type: blog or cafe-member.',
    value: '<blog|cafe-member>',
  },
  ...FORMAT_FLAG,
};

export const SUBSCRIBE_FLAGS: CliFlags = {
  url: { description: 'Profile or feed URL to subscribe to.', value: '<url>', required: true },
  hour: { description: 'Local subscription hour (0-23).', value: '<0-23>' },
  folder: { description: 'Workspace folder to receive archived notes.', value: '<workspace-path>' },
  naverCookie: { description: 'Base64-encoded Naver session cookie.', value: '<base64>' },
  naverSubscriptionType: {
    description: 'Naver subscription type: blog or cafe-member.',
    value: '<blog|cafe-member>',
  },
  ...FORMAT_FLAG,
};

export const GOOGLEMAPS_FLAGS: CliFlags = {
  path: { description: 'Workspace note path containing Google Maps links.', value: '<workspace-path>' },
  content: { description: 'Inline content with Google Maps links.', value: '<text>' },
  urls: { description: 'Comma-separated Google Maps URLs.', value: '<csv>' },
  yes: { description: 'Skip the interactive confirmation prompt.' },
  max: { description: 'Maximum number of links to archive in this batch.', value: '<n>' },
  ...FORMAT_FLAG,
};

export const IMPORT_INSTAGRAM_FLAGS: CliFlags = {
  files: { description: 'Comma-separated absolute paths to Instagram Saved ZIP files.', value: '<paths>' },
  destination: { description: 'Destination: inbox or archive.', value: '<inbox|archive>' },
  tags: { description: 'Comma-separated tags to attach to imported posts.', value: '<tag1,tag2>' },
  rate: { description: 'Optional items-per-second throttle.', value: '<n>' },
  preflight: { description: 'Run preflight only without starting a job.' },
  verbose: { description: 'Do not redact absolute file paths in the response.' },
  ...FORMAT_FLAG,
};

export const IMPORT_JOB_FLAGS: CliFlags = {
  id: { description: 'Import job ID.', value: '<job-id>', required: true },
  items: { description: 'Include per-item state in the response.' },
  ...FORMAT_FLAG,
};

export const IMPORT_CONTROL_FLAGS: CliFlags = {
  id: { description: 'Import job ID.', value: '<job-id>', required: true },
  action: { description: 'Action to perform: pause, resume, or cancel.', value: '<pause|resume|cancel>', required: true },
  ...FORMAT_FLAG,
};

// -----------------------------------------------------------------------------
// P2 flags
// -----------------------------------------------------------------------------

export const POST_FLAGS: CliFlags = {
  path: { description: 'Workspace path of the note to post.', value: '<workspace-path>' },
  active: { description: 'Use the currently active editor file (GUI only).' },
  ...FORMAT_FLAG,
};

export const SHARE_FLAGS: CliFlags = {
  path: { description: 'Workspace path of the note to share.', value: '<workspace-path>' },
  active: { description: 'Use the currently active editor file (GUI only).' },
  reader: { description: 'Include reader-mode share URL variant.' },
  ...FORMAT_FLAG,
};

export const TAGS_FLAGS: CliFlags = {
  counts: { description: 'Include per-tag note counts.' },
  ...FORMAT_FLAG,
};

export const TAG_CREATE_FLAGS: CliFlags = {
  name: { description: 'Tag name to create.', value: '<tag>', required: true },
  color: { description: 'Optional hex color (e.g. #f97316).', value: '<#hex>' },
  ...FORMAT_FLAG,
};

export const TAG_APPLY_FLAGS: CliFlags = {
  path: { description: 'Workspace note path.', value: '<workspace-path>', required: true },
  tag: { description: 'Tag name to apply.', value: '<tag>', required: true },
  action: { description: 'add, remove, or toggle.', value: '<add|remove|toggle>' },
  ...FORMAT_FLAG,
};

export const TRANSCRIBE_FLAGS: CliFlags = {
  mode: {
    description: 'transcribe-only or download-and-transcribe.',
    value: '<transcribe-only|download-and-transcribe>',
  },
  action: {
    description: 'start, pause, resume, cancel, or status.',
    value: '<start|pause|resume|cancel|status>',
  },
  ...FORMAT_FLAG,
};

export const MEDIA_FLAGS: CliFlags = {
  path: { description: 'Workspace note path.', value: '<workspace-path>' },
  active: { description: 'Use the active editor file (GUI only).' },
  action: {
    description: 'redownload-expired, detach, or redownload-detached.',
    value: '<redownload-expired|detach|redownload-detached>',
    required: true,
  },
  ...FORMAT_FLAG,
};

export const AUTHOR_NOTES_FLAGS: CliFlags = {
  dryRun: { description: 'Report what would change without writing notes.' },
  limit: { description: 'Maximum number of author notes to upsert.', value: '<n>' },
  ...FORMAT_FLAG,
};

export const AI_COMMENT_FLAGS: CliFlags = {
  path: { description: 'Workspace path of the note to generate an AI comment on.', value: '<workspace-path>', required: true },
  type: {
    description: 'Comment type. One of summary, factcheck, critique, keypoints, sentiment, connections, translation, translate-transcript, glossary, reformat, custom.',
    value: '<summary|factcheck|critique|keypoints|sentiment|connections|translation|translate-transcript|glossary|reformat|custom>',
    required: true,
  },
  provider: {
    description: 'AI CLI provider. One of claude, gemini, codex. Defaults to the first detected provider.',
    value: '<claude|gemini|codex>',
  },
  prompt: { description: 'Custom prompt template (required when type=custom).', value: '<text>' },
  language: { description: 'Target language code for translation/translate-transcript (e.g. ko, en, ja).', value: '<lang>' },
  outputLanguage: { description: 'Output language for AI response: auto, ko, en, ja, etc.', value: '<lang|auto>' },
  ...FORMAT_FLAG,
};

export const AI_COMMENTS_FLAGS: CliFlags = {
  path: { description: 'Workspace note path.', value: '<workspace-path>', required: true },
  ...FORMAT_FLAG,
};

export const AI_PROVIDERS_FLAGS: CliFlags = {
  ...FORMAT_FLAG,
};

export const SEARCH_FLAGS: CliFlags = {
  q: { description: 'Search text (2–128 chars). Substring match, recency-ordered.', value: '<text>', required: true },
  limit: { description: 'Maximum results (1–50, default 20).', value: '<n>' },
  platform: { description: 'Filter to a single platform.', value: '<platform>' },
  platforms: { description: 'Filter to multiple platforms (comma-separated).', value: '<p1,p2>' },
  since: { description: 'Only archives on/after this ISO timestamp (archived date).', value: '<ISO>' },
  until: { description: 'Only archives before this ISO timestamp (archived date).', value: '<ISO>' },
  match: {
    description: 'Fields to match: content,title,author,url (default content,title,author).',
    value: '<csv>',
  },
  cursor: { description: 'Pagination cursor from a previous response.', value: '<cursor>' },
  ...FORMAT_FLAG,
};

export const BOOKMARK_FLAGS: CliFlags = {
  ids: {
    description: 'Comma-separated archive IDs to bookmark (= the "Archive" state; moves out of Inbox). Max 200 per call.',
    value: '<id1,id2>',
    required: true,
  },
  off: { description: 'Un-bookmark instead (move back to Inbox).' },
  ...FORMAT_FLAG,
};

// -----------------------------------------------------------------------------
// Descriptions
// -----------------------------------------------------------------------------

export const COMMAND_DESCRIPTIONS: Readonly<Record<CommandId, string>> = Object.freeze({
  [COMMANDS.DEFAULT]: 'Print Social Archiver status, version, and capability info.',
  [COMMANDS.ARCHIVE]: 'Archive a single social media URL.',
  [COMMANDS.JOB]: 'Inspect a single archive job by ID.',
  [COMMANDS.JOBS]: 'List archive jobs filtered by status.',
  [COMMANDS.JOBS_CHECK]: 'Run pending-job catch-up once.',
  [COMMANDS.SYNC]: 'Run explicit sync tasks (subscriptions, library, pending).',
  [COMMANDS.PROFILE_CRAWL]: 'Crawl a profile/RSS source now, optionally subscribing.',
  [COMMANDS.SUBSCRIBE]: 'Create a subscription without an immediate crawl.',
  [COMMANDS.GOOGLEMAPS]: 'Batch archive Google Maps links from content or a note.',
  [COMMANDS.IMPORT_INSTAGRAM]: 'Start an Instagram Saved ZIP import.',
  [COMMANDS.IMPORT_JOB]: 'Inspect Instagram import job state.',
  [COMMANDS.IMPORT_CONTROL]: 'Pause, resume, or cancel an Instagram import job.',
  [COMMANDS.POST]: 'Post a workspace note into the local timeline.',
  [COMMANDS.SHARE]: 'Post a workspace note and create/copy a share URL.',
  [COMMANDS.TAGS]: 'List tag definitions.',
  [COMMANDS.TAG_CREATE]: 'Create a new tag definition.',
  [COMMANDS.TAG_APPLY]: 'Add, remove, or toggle a tag on a workspace note.',
  [COMMANDS.TRANSCRIBE]: 'Start or control batch transcription.',
  [COMMANDS.MEDIA]: 'Re-download expired/detached media or detach local media.',
  [COMMANDS.AUTHOR_NOTES]: 'Create or update author notes for existing authors.',
  [COMMANDS.AI_COMMENT]: 'Generate an AI comment (summary, factcheck, etc.) for a note. Fire-and-forget; result is appended to the note when complete.',
  [COMMANDS.AI_COMMENTS]: 'List AI comments stored on a note.',
  [COMMANDS.AI_PROVIDERS]: 'List installed AI CLI providers (claude, gemini, codex) and their auth status.',
  [COMMANDS.SEARCH]: 'Search your archives by text (server-side, snippet results). One-off lookups; use export+grep for repeated analysis.',
  [COMMANDS.BOOKMARK]: 'Bookmark/un-bookmark archives in bulk (the "Archive" state — moves posts in/out of the Inbox).',
});

/** Flag schema lookup by command id — used by the argv layer for help/validation. */
export const FLAGS_BY_COMMAND: Readonly<Record<CommandId, CliFlags>> = Object.freeze({
  [COMMANDS.DEFAULT]: DEFAULT_FLAGS,
  [COMMANDS.ARCHIVE]: ARCHIVE_FLAGS,
  [COMMANDS.JOB]: JOB_FLAGS,
  [COMMANDS.JOBS]: JOBS_FLAGS,
  [COMMANDS.JOBS_CHECK]: JOBS_CHECK_FLAGS,
  [COMMANDS.SYNC]: SYNC_FLAGS,
  [COMMANDS.PROFILE_CRAWL]: PROFILE_CRAWL_FLAGS,
  [COMMANDS.SUBSCRIBE]: SUBSCRIBE_FLAGS,
  [COMMANDS.GOOGLEMAPS]: GOOGLEMAPS_FLAGS,
  [COMMANDS.IMPORT_INSTAGRAM]: IMPORT_INSTAGRAM_FLAGS,
  [COMMANDS.IMPORT_JOB]: IMPORT_JOB_FLAGS,
  [COMMANDS.IMPORT_CONTROL]: IMPORT_CONTROL_FLAGS,
  [COMMANDS.POST]: POST_FLAGS,
  [COMMANDS.SHARE]: SHARE_FLAGS,
  [COMMANDS.TAGS]: TAGS_FLAGS,
  [COMMANDS.TAG_CREATE]: TAG_CREATE_FLAGS,
  [COMMANDS.TAG_APPLY]: TAG_APPLY_FLAGS,
  [COMMANDS.TRANSCRIBE]: TRANSCRIBE_FLAGS,
  [COMMANDS.MEDIA]: MEDIA_FLAGS,
  [COMMANDS.AUTHOR_NOTES]: AUTHOR_NOTES_FLAGS,
  [COMMANDS.AI_COMMENT]: AI_COMMENT_FLAGS,
  [COMMANDS.AI_COMMENTS]: AI_COMMENTS_FLAGS,
  [COMMANDS.AI_PROVIDERS]: AI_PROVIDERS_FLAGS,
  [COMMANDS.SEARCH]: SEARCH_FLAGS,
  [COMMANDS.BOOKMARK]: BOOKMARK_FLAGS,
});
