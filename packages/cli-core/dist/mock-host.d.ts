/**
 * MockArchiverCliHost — in-memory host for tests and `--host=mock` demo runs.
 * Lets the full argv → dispatch → envelope chain be exercised without a backend.
 */
import type { PathResolver } from './core/params.js';
import { type ArchiveCliOptions, type ArchiveCliResult, type ArchiverCliHost, type AuthorNotesResult, type HostStatus, type JobSource, type JobStatusInfo, type BookmarkCliOptions, type BookmarkCliResult, type NoteTargetOptions, type PostNoteResult, type SearchCliOptions, type SearchCliResult, type ShareNoteResult, type SubscribeCliOptions, type SubscribeCliResult, type SyncResult, type SyncTarget, type TagApplyResult, type TagInfo } from './core/host.js';
export interface MockHostOptions {
    authenticated?: boolean;
    username?: string;
    version?: string;
    /** Paths the mock resolver should report as existing. */
    existingPaths?: string[];
}
export declare class MockArchiverCliHost implements ArchiverCliHost {
    readonly client = "mock";
    readonly pathResolver: PathResolver;
    private readonly authenticated;
    private readonly username;
    private readonly version;
    private readonly jobs;
    private readonly tags;
    private readonly noteTags;
    private archiveSeq;
    constructor(opts?: MockHostOptions);
    supports(command: string): boolean;
    collectStatus(): HostStatus;
    archive(url: string, opts: ArchiveCliOptions): Promise<ArchiveCliResult>;
    getJob(id: string, _source: JobSource): Promise<JobStatusInfo>;
    subscribe(opts: SubscribeCliOptions): Promise<SubscribeCliResult>;
    postNote(opts: NoteTargetOptions): Promise<PostNoteResult>;
    shareNote(opts: NoteTargetOptions & {
        reader: boolean;
    }): Promise<ShareNoteResult>;
    authorNotes(opts: {
        dryRun: boolean;
        limit?: number;
    }): Promise<AuthorNotesResult>;
    listJobs(opts: {
        status?: string;
        limit: number;
    }): Promise<JobStatusInfo[]>;
    checkJobs(_opts: {
        syncServer: boolean;
    }): Promise<{
        checked: number;
        updated: number;
    }>;
    sync(opts: {
        target: SyncTarget;
        syncServer: boolean;
    }): Promise<SyncResult>;
    listTags(opts: {
        counts: boolean;
    }): Promise<TagInfo[]>;
    createTag(opts: {
        name: string;
        color?: string;
    }): Promise<TagInfo>;
    applyTag(opts: {
        path: string;
        tag: string;
        action: 'add' | 'remove' | 'toggle';
    }): Promise<TagApplyResult>;
    search(opts: SearchCliOptions): Promise<SearchCliResult>;
    bookmark(opts: BookmarkCliOptions): Promise<BookmarkCliResult>;
}
//# sourceMappingURL=mock-host.d.ts.map