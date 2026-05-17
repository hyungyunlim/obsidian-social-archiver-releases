/**
 * CliFlags — central definitions of every Social Archiver CLI command and
 * its flag schema. `CliRegistry` consumes these definitions when calling
 * `plugin.registerCliHandler(...)`.
 *
 * Keeping definitions in one file means:
 *   - One place to audit when adding/removing flags.
 *   - Reusable references for the agent skill docs.
 *   - Easy diffing across P0/P1/P2 waves.
 */

import type { CliFlags } from '../../types/obsidian-cli';

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
  folder: { description: 'Vault folder to receive archived notes.', value: '<vault-path>' },
  naverCookie: { description: 'Base64-encoded Naver session cookie.', value: '<base64>' },
  naverSubscriptionType: {
    description: 'Naver subscription type: blog or cafe-member.',
    value: '<blog|cafe-member>',
  },
  ...FORMAT_FLAG,
};

export const GOOGLEMAPS_FLAGS: CliFlags = {
  path: { description: 'Vault note path containing Google Maps links.', value: '<vault-path>' },
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
  path: { description: 'Vault path of the note to post.', value: '<vault-path>' },
  active: { description: 'Use the currently active editor file.' },
  ...FORMAT_FLAG,
};

export const SHARE_FLAGS: CliFlags = {
  path: { description: 'Vault path of the note to share.', value: '<vault-path>' },
  active: { description: 'Use the currently active editor file.' },
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
  path: { description: 'Vault note path.', value: '<vault-path>', required: true },
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
  path: { description: 'Vault note path.', value: '<vault-path>' },
  active: { description: 'Use the active editor file.' },
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
  path: { description: 'Vault path of the note to generate an AI comment on.', value: '<vault-path>', required: true },
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
  path: { description: 'Vault note path.', value: '<vault-path>', required: true },
  ...FORMAT_FLAG,
};

export const AI_PROVIDERS_FLAGS: CliFlags = {
  ...FORMAT_FLAG,
};

// -----------------------------------------------------------------------------
// Descriptions used by `registerCliHandler` `description` arg
// -----------------------------------------------------------------------------

export const COMMAND_DESCRIPTIONS: Readonly<Record<CommandId, string>> = Object.freeze({
  [COMMANDS.DEFAULT]: 'Print Social Archiver plugin status, version, and capability info.',
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
  [COMMANDS.POST]: 'Post a vault note into the local timeline.',
  [COMMANDS.SHARE]: 'Post a vault note and create/copy a share URL.',
  [COMMANDS.TAGS]: 'List tag definitions.',
  [COMMANDS.TAG_CREATE]: 'Create a new tag definition.',
  [COMMANDS.TAG_APPLY]: 'Add, remove, or toggle a tag on a vault note.',
  [COMMANDS.TRANSCRIBE]: 'Start or control batch transcription.',
  [COMMANDS.MEDIA]: 'Re-download expired/detached media or detach local media.',
  [COMMANDS.AUTHOR_NOTES]: 'Create or update author notes for existing authors.',
  [COMMANDS.AI_COMMENT]: 'Generate an AI comment (summary, factcheck, etc.) for a note. Fire-and-forget; result is appended to the note when complete.',
  [COMMANDS.AI_COMMENTS]: 'List AI comments stored on a note.',
  [COMMANDS.AI_PROVIDERS]: 'List installed AI CLI providers (claude, gemini, codex) and their auth status.',
});
