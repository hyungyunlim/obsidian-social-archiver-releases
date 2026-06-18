/**
 * ArchiverCliHost — the host-agnostic capability contract that cli-core
 * handlers call instead of reaching into a specific app (Obsidian plugin /
 * Tauri desktop). Each client provides an adapter:
 *   - ObsidianCliHost  (wraps the plugin services; future PR-1 refactor)
 *   - DesktopCliHost   (wraps DesktopApiClient / sync / repositories)
 *   - MockArchiverCliHost (tests)
 *
 * Per docs/specs/desktop-cli-agent-skill-prd.md §6.2. The method set below is
 * the PR-1/PR-3 vertical slice (status, archive, jobs, sync, tags) plus the
 * server-backed desktop follow-ups (subscribe, post, share, author-notes).
 * Remaining commands are gated through `supports()` until their host methods
 * land.
 */

import type { PathResolver } from './params';

// -----------------------------------------------------------------------------
// Result shapes
// -----------------------------------------------------------------------------

export interface HostStatus {
  /** Client identifier, e.g. "desktop-cli", "obsidian-plugin". */
  client: string;
  version: string;
  authenticated: boolean;
  username?: string;
  /** Human-readable store/workspace name (vault name, DB path basename, …). */
  store?: string;
  /** Capability map: which feature areas this host can serve headlessly. */
  features: Record<string, boolean>;
}

export type ArchiveMode = 'queue' | 'sync' | 'fetch';
export type MediaMode = 'all' | 'images' | 'none';

export interface ArchiveCliOptions {
  mode: ArchiveMode;
  mediaMode: MediaMode;
  includeComments?: boolean;
  includeTranscript?: boolean;
  includeFormattedTranscript?: boolean;
  tags?: string[];
  comment?: string;
  /** Block until terminal state (sync/fetch only). */
  wait?: boolean;
}

export interface ArchiveCliResult {
  url: string;
  /** Present for async (queue) submissions. */
  jobId?: string;
  status: string;
  platform?: string;
  /** Present once the note has been written (sync/fetch, or completed queue). */
  filePath?: string;
  /** Non-fatal notices (e.g. flags accepted but not honored by this host). */
  warnings?: string[];
}

export interface SubscribeCliOptions {
  url: string;
  hour?: number;
  folder?: string;
  naverCookie?: string;
  naverSubscriptionType?: 'blog' | 'cafe-member';
}

export interface SubscribeCliResult {
  subscriptionId: string;
  platform: string;
  handle: string | null;
  cron?: string;
  folder?: string;
  naverCookieApplied?: boolean;
  warnings?: string[];
}

export interface NoteTargetOptions {
  path?: string;
  active: boolean;
}

export interface PostNoteResult {
  path: string;
  postId: string;
  archiveId: string;
  postedAt: string;
  mediaCount: number;
}

export interface ShareNoteResult {
  path: string;
  shareId: string;
  shareUrl: string;
  archiveId: string;
  shareUrlCopied: boolean;
}

export interface AuthorNotesResult {
  created: number;
  skipped: number;
  failed: number;
  paths: string[];
}

export type JobSource = 'local' | 'server' | 'auto';

export interface JobStatusInfo {
  jobId: string;
  status: string;
  platform?: string;
  url?: string;
  filePath?: string;
  error?: string;
  /** Progress 0..100 when the host/server reports it. */
  progress?: number;
}

export type SyncTarget = 'subscriptions' | 'library' | 'pending' | 'all';

export interface SyncResult {
  target: SyncTarget;
  ran: string[];
  pulled?: number;
  pushed?: number;
}

export interface TagInfo {
  name: string;
  color?: string;
  count?: number;
}

export interface TagApplyResult {
  path: string;
  tag: string;
  action: 'add' | 'remove' | 'toggle';
  /** Whether the tag is present on the note after the operation. */
  applied: boolean;
  /** True when the operation changed nothing (idempotent no-op). */
  noop: boolean;
}

export type SearchMatchField = 'content' | 'title' | 'author' | 'url';

export interface SearchCliOptions {
  /** Search text (host/server validate length). */
  q: string;
  /** Max results; host clamps to the server limit (≤50). */
  limit?: number;
  platform?: string;
  platforms?: string[];
  /** ISO timestamp lower bound (inclusive) on the archived date. */
  since?: string;
  /** ISO timestamp upper bound (exclusive) on the archived date. */
  until?: string;
  /** Fields to match; defaults to content+title+author. */
  match?: string[];
  /** Opaque pagination cursor from a previous result. */
  cursor?: string;
}

export interface SearchCliMatch {
  archiveId: string;
  platform: string;
  url: string;
  title: string | null;
  author: { name: string | null; handle: string | null };
  thumbnailUrl?: string | null;
  archivedAt: string;
  /** Short highlighted excerpt — never the full body. */
  snippet: string;
  matchedField: string;
}

export interface SearchCliResult {
  query: string;
  results: SearchCliMatch[];
  hasMore: boolean;
  /** Opaque cursor for the next page, or null. */
  nextCursor: string | null;
  /** True when the candidate window was capped before exhausting matches. */
  truncated: boolean;
}

export interface BookmarkCliOptions {
  /** Archive IDs to update (host enforces the ≤200/request server cap). */
  archiveIds: string[];
  /** true = bookmark (Archive / out of Inbox); false = un-bookmark (back to Inbox). */
  bookmarked: boolean;
}

export interface BookmarkCliResult {
  bookmarked: boolean;
  requested: number;
  /** IDs that actually changed state. */
  updatedIds: string[];
  /** Per-archive failures (not-found / no-change / update-failed). */
  failed: Array<{ archiveId: string; code: string; message: string }>;
}

// -----------------------------------------------------------------------------
// Host error
// -----------------------------------------------------------------------------

/**
 * Hosts throw `HostError` with one of `ErrorCode.*` so cli-core can map it to a
 * structured error envelope without knowing host internals. Billing codes
 * (`INSUFFICIENT_CREDITS`, `PAYWALL_REQUIRED`) trigger the shared billing
 * fallback message in the handler layer.
 */
export class HostError extends Error {
  readonly code: string;
  readonly retryable?: boolean;
  readonly details?: Record<string, unknown>;
  constructor(
    code: string,
    message: string,
    opts: { retryable?: boolean; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'HostError';
    this.code = code;
    this.retryable = opts.retryable;
    this.details = opts.details;
  }
}

// -----------------------------------------------------------------------------
// Host contract
// -----------------------------------------------------------------------------

export interface ArchiverCliHost {
  /** Stable client id surfaced in `status` and the X-Client header. */
  readonly client: string;

  /** Optional resolver for workspace-path existence checks (tag-apply etc.). */
  readonly pathResolver?: PathResolver;

  /** True if this host implements the given command id (capability gate). */
  supports(command: string): boolean;

  collectStatus(): HostStatus | Promise<HostStatus>;

  archive(url: string, opts: ArchiveCliOptions): Promise<ArchiveCliResult>;
  subscribe(opts: SubscribeCliOptions): Promise<SubscribeCliResult>;
  postNote(opts: NoteTargetOptions): Promise<PostNoteResult>;
  shareNote(opts: NoteTargetOptions & { reader: boolean }): Promise<ShareNoteResult>;
  authorNotes(opts: { dryRun: boolean; limit?: number }): Promise<AuthorNotesResult>;
  getJob(id: string, source: JobSource): Promise<JobStatusInfo>;
  listJobs(opts: { status?: string; limit: number }): Promise<JobStatusInfo[]>;
  checkJobs(opts: { syncServer: boolean }): Promise<{ checked: number; updated: number }>;
  sync(opts: { target: SyncTarget; syncServer: boolean }): Promise<SyncResult>;

  listTags(opts: { counts: boolean }): Promise<TagInfo[]>;
  createTag(opts: { name: string; color?: string }): Promise<TagInfo>;
  applyTag(opts: { path: string; tag: string; action: 'add' | 'remove' | 'toggle' }): Promise<TagApplyResult>;

  /** Server-side per-user archive search (snippet results). */
  search(opts: SearchCliOptions): Promise<SearchCliResult>;

  /** Bulk bookmark/un-bookmark archives (the Inbox ↔ Archived state). */
  bookmark(opts: BookmarkCliOptions): Promise<BookmarkCliResult>;
}
