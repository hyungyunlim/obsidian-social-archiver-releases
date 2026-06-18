/**
 * MockArchiverCliHost — in-memory host for tests and `--host=mock` demo runs.
 * Lets the full argv → dispatch → envelope chain be exercised without a backend.
 */

import type { PathResolver } from './core/params';
import {
  HostError,
  type ArchiveCliOptions,
  type ArchiveCliResult,
  type ArchiverCliHost,
  type AuthorNotesResult,
  type HostStatus,
  type JobSource,
  type JobStatusInfo,
  type BookmarkCliOptions,
  type BookmarkCliResult,
  type NoteTargetOptions,
  type PostNoteResult,
  type SearchCliOptions,
  type SearchCliResult,
  type ShareNoteResult,
  type SubscribeCliOptions,
  type SubscribeCliResult,
  type SyncResult,
  type SyncTarget,
  type TagApplyResult,
  type TagInfo,
} from './core/host';
import { ErrorCode } from './core/response';
import { COMMANDS } from './core/flags';

const SLICE_COMMANDS = new Set<string>([
  COMMANDS.DEFAULT,
  COMMANDS.ARCHIVE,
  COMMANDS.SUBSCRIBE,
  COMMANDS.POST,
  COMMANDS.SHARE,
  COMMANDS.JOB,
  COMMANDS.JOBS,
  COMMANDS.JOBS_CHECK,
  COMMANDS.SYNC,
  COMMANDS.TAGS,
  COMMANDS.TAG_CREATE,
  COMMANDS.TAG_APPLY,
  COMMANDS.AUTHOR_NOTES,
  COMMANDS.SEARCH,
  COMMANDS.BOOKMARK,
]);

/** Seeded archives for `search` / `--host=mock` demos. */
const MOCK_ARCHIVES = [
  {
    archiveId: 'mock-1',
    platform: 'x',
    url: 'https://x.com/u/status/1',
    title: 'React state management',
    author: { name: 'Dev', handle: 'dev' },
    archivedAt: '2026-03-15T00:00:00.000Z',
    body: 'A thread about the best react state management patterns in 2026.',
  },
  {
    archiveId: 'mock-2',
    platform: 'reddit',
    url: 'https://reddit.com/r/rust/comments/2',
    title: 'Rust ownership explained',
    author: { name: 'Rustacean', handle: 'rustacean' },
    archivedAt: '2026-03-10T00:00:00.000Z',
    body: 'Understanding ownership and borrowing in Rust.',
  },
];

export interface MockHostOptions {
  authenticated?: boolean;
  username?: string;
  version?: string;
  /** Paths the mock resolver should report as existing. */
  existingPaths?: string[];
}

export class MockArchiverCliHost implements ArchiverCliHost {
  readonly client = 'mock';
  readonly pathResolver: PathResolver;

  private readonly authenticated: boolean;
  private readonly username: string | undefined;
  private readonly version: string;
  private readonly jobs = new Map<string, JobStatusInfo>();
  private readonly tags = new Map<string, TagInfo>();
  private readonly noteTags = new Map<string, Set<string>>();
  private archiveSeq = 0;

  constructor(opts: MockHostOptions = {}) {
    this.authenticated = opts.authenticated ?? true;
    this.username = opts.username ?? (this.authenticated ? 'demo-user' : undefined);
    this.version = opts.version ?? '0.0.1';
    const existing = new Set(opts.existingPaths ?? []);
    this.pathResolver = { exists: (p) => existing.has(p) };
    // Seed a couple of tags for list/apply tests.
    this.tags.set('research', { name: 'research', color: '#0ea5e9' });
    this.tags.set('news', { name: 'news' });
  }

  supports(command: string): boolean {
    return SLICE_COMMANDS.has(command);
  }

  collectStatus(): HostStatus {
    return {
      client: this.client,
      version: this.version,
      authenticated: this.authenticated,
      username: this.authenticated ? this.username : undefined,
      store: 'mock-store',
      features: {
        archive: true,
        subscribe: true,
        post: true,
        share: true,
        authorNotes: true,
        sync: true,
        tags: true,
        executor: false,
        redditSession: false,
      },
    };
  }

  async archive(url: string, opts: ArchiveCliOptions): Promise<ArchiveCliResult> {
    if (url.includes('paywall')) {
      throw new HostError(ErrorCode.PAYWALL_REQUIRED, 'Paywall required for this content.');
    }
    if (url.includes('nocredits')) {
      throw new HostError(ErrorCode.INSUFFICIENT_CREDITS, 'Out of credits.');
    }
    const jobId = `mock-job-${++this.archiveSeq}`;
    const platform = url.includes('x.com') || url.includes('twitter') ? 'x' : 'unknown';
    if (opts.mode === 'queue') {
      this.jobs.set(jobId, { jobId, status: 'pending', platform, url });
      return { url, jobId, status: 'queued', platform };
    }
    // sync / fetch → terminal immediately in the mock
    this.jobs.set(jobId, { jobId, status: 'completed', platform, url, filePath: `Social Archives/${platform}/${jobId}.md` });
    return { url, jobId, status: 'completed', platform, filePath: `Social Archives/${platform}/${jobId}.md` };
  }

  async getJob(id: string, _source: JobSource): Promise<JobStatusInfo> {
    const job = this.jobs.get(id);
    if (!job) {
      throw new HostError(ErrorCode.JOB_NOT_FOUND, `No job with id '${id}'.`);
    }
    return job;
  }

  async subscribe(opts: SubscribeCliOptions): Promise<SubscribeCliResult> {
    return {
      subscriptionId: 'mock-sub-1',
      platform: opts.url.includes('youtube') ? 'youtube' : 'x',
      handle: 'mock',
      cron: typeof opts.hour === 'number' ? `0 ${opts.hour} * * *` : '0 */3 * * *',
      folder: opts.folder,
      naverCookieApplied: Boolean(opts.naverCookie),
    };
  }

  async postNote(opts: NoteTargetOptions): Promise<PostNoteResult> {
    const path = opts.path ?? 'active';
    return {
      path,
      postId: 'mock-post-1',
      archiveId: 'mock-archive-1',
      postedAt: new Date(0).toISOString(),
      mediaCount: 0,
    };
  }

  async shareNote(opts: NoteTargetOptions & { reader: boolean }): Promise<ShareNoteResult> {
    const path = opts.path ?? 'active';
    return {
      path,
      shareId: 'mock-share-1',
      shareUrl: `https://social-archive.org/demo/mock-share-1${opts.reader ? '#reader' : ''}`,
      archiveId: 'mock-archive-1',
      shareUrlCopied: false,
    };
  }

  async authorNotes(opts: { dryRun: boolean; limit?: number }): Promise<AuthorNotesResult> {
    const paths = ['x:url:https://x.com/mock'];
    return {
      created: opts.dryRun ? 0 : paths.length,
      skipped: 0,
      failed: 0,
      paths: typeof opts.limit === 'number' ? paths.slice(0, opts.limit) : paths,
    };
  }

  async listJobs(opts: { status?: string; limit: number }): Promise<JobStatusInfo[]> {
    let jobs = [...this.jobs.values()];
    if (opts.status && opts.status !== 'all') {
      jobs = jobs.filter((j) => j.status === opts.status);
    }
    return jobs.slice(0, opts.limit);
  }

  async checkJobs(_opts: { syncServer: boolean }): Promise<{ checked: number; updated: number }> {
    return { checked: this.jobs.size, updated: 0 };
  }

  async sync(opts: { target: SyncTarget; syncServer: boolean }): Promise<SyncResult> {
    const ran = opts.target === 'all' ? ['subscriptions', 'library', 'pending'] : [opts.target];
    return { target: opts.target, ran, pulled: 0, pushed: 0 };
  }

  async listTags(opts: { counts: boolean }): Promise<TagInfo[]> {
    return [...this.tags.values()].map((t) => (opts.counts ? { ...t, count: 0 } : t));
  }

  async createTag(opts: { name: string; color?: string }): Promise<TagInfo> {
    const tag: TagInfo = { name: opts.name, color: opts.color };
    this.tags.set(opts.name, tag);
    return tag;
  }

  async applyTag(opts: { path: string; tag: string; action: 'add' | 'remove' | 'toggle' }): Promise<TagApplyResult> {
    const set = this.noteTags.get(opts.path) ?? new Set<string>();
    const had = set.has(opts.tag);
    let applied: boolean;
    if (opts.action === 'add') applied = true;
    else if (opts.action === 'remove') applied = false;
    else applied = !had;
    if (applied) set.add(opts.tag);
    else set.delete(opts.tag);
    this.noteTags.set(opts.path, set);
    return { path: opts.path, tag: opts.tag, action: opts.action, applied, noop: applied === had };
  }

  async search(opts: SearchCliOptions): Promise<SearchCliResult> {
    const q = opts.q.toLowerCase();
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
    const matched = MOCK_ARCHIVES.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.body.toLowerCase().includes(q) ||
        a.author.name.toLowerCase().includes(q),
    );
    const page = matched.slice(0, limit);
    return {
      query: opts.q,
      results: page.map((a) => {
        const inTitle = a.title.toLowerCase().includes(q);
        const text = inTitle ? a.title : a.body;
        const idx = text.toLowerCase().indexOf(q);
        const snippet =
          idx >= 0
            ? `${text.slice(0, idx)}**${text.slice(idx, idx + opts.q.length)}**${text.slice(idx + opts.q.length)}`
            : text;
        return {
          archiveId: a.archiveId,
          platform: a.platform,
          url: a.url,
          title: a.title,
          author: { name: a.author.name, handle: a.author.handle },
          archivedAt: a.archivedAt,
          snippet,
          matchedField: inTitle ? 'title' : 'content',
        };
      }),
      hasMore: matched.length > limit,
      nextCursor: matched.length > limit ? 'mock-cursor' : null,
      truncated: false,
    };
  }

  async bookmark(opts: BookmarkCliOptions): Promise<BookmarkCliResult> {
    // Mock: 'missing' (any id containing "missing") fails NOT_FOUND; the rest update.
    const updatedIds: string[] = [];
    const failed: BookmarkCliResult['failed'] = [];
    for (const id of opts.archiveIds) {
      if (id.includes('missing')) {
        failed.push({ archiveId: id, code: 'NOT_FOUND', message: 'No archive with that id' });
      } else {
        updatedIds.push(id);
      }
    }
    return { bookmarked: opts.bookmarked, requested: opts.archiveIds.length, updatedIds, failed };
  }
}
