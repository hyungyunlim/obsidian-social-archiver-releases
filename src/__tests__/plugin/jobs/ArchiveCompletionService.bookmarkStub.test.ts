/**
 * The plugin's own archive of a URL that already sits in the vault as a
 * bookmark stub: the server fills the stub's row in place, so the completed
 * archive must overwrite the stub note (same path) rather than leave a second
 * note carrying the same archive id.
 */
import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { ArchiveCompletionService } from '@/plugin/jobs/ArchiveCompletionService';
import type { ArchiveCompletionServiceDeps } from '@/plugin/jobs/ArchiveCompletionService';
import type { PendingJob } from '@/services/PendingJobsManager';
import type { PostData } from '@/types/post';

const URL = 'https://www.instagram.com/p/DRPFtcOEvbl/';
const STUB_PATH = 'Social Archives/Web/2026/11/2026-11-01 - www.instagram.com - Bookmark (abcdef).md';
const PRELIMINARY_PATH = 'Social Archives/Instagram/2026/11/preliminary.md';

function makeHarness(stubFrontmatter: Record<string, unknown>) {
  const stubFile = new TFile(STUB_PATH);
  const preliminaryFile = new TFile(PRELIMINARY_PATH);
  const written = new Map<string, string>();

  const app = {
    vault: {
      getRoot: vi.fn(),
      getAbstractFileByPath: vi.fn((path: string) => (path === PRELIMINARY_PATH ? preliminaryFile : null)),
      getFileByPath: vi.fn().mockReturnValue(null),
      process: vi.fn(async (file: TFile, fn: (data: string) => string) => {
        written.set(file.path, fn(''));
      }),
      create: vi.fn(),
      createFolder: vi.fn(),
    },
    metadataCache: {
      getFileCache: vi.fn((file: TFile) => (file.path === STUB_PATH ? { frontmatter: stubFrontmatter } : null)),
    },
    fileManager: {
      trashFile: vi.fn(),
      renameFile: vi.fn(),
    },
  };
  const lookup = {
    findBySourceArchiveId: vi.fn((id: string) => (id === 'stub-archive-1' ? stubFile : null)),
    findByOriginalUrl: vi.fn((url: string) => (url === URL ? [stubFile] : [])),
  };

  const deps: ArchiveCompletionServiceDeps = {
    app: app as unknown as ArchiveCompletionServiceDeps['app'],
    settings: () => ({
      archivePath: 'Social Archives',
      archiveOrganization: 'platform-year-month',
      mediaPath: 'attachments/social-archives',
      downloadMedia: 'text-only',
      includeComments: false,
      includeHashtagsAsObsidianTags: false,
      mirrorArchiveTagsToObsidianTags: false,
      enableAuthorNotes: false,
      downloadAuthorAvatars: false,
      updateAuthorMetadata: false,
    }) as unknown as ReturnType<ArchiveCompletionServiceDeps['settings']>,
    pendingJobsManager: {
      getJob: vi.fn(),
      updateJob: vi.fn().mockResolvedValue(undefined),
      removeJob: vi.fn().mockResolvedValue(undefined),
    } as unknown as ArchiveCompletionServiceDeps['pendingJobsManager'],
    archiveJobTracker: {
      completeJob: vi.fn(),
      updateProgress: vi.fn(),
      failJob: vi.fn(),
      markRetrying: vi.fn(),
    } as unknown as ArchiveCompletionServiceDeps['archiveJobTracker'],
    apiClient: () => undefined,
    authorAvatarService: () => undefined,
    authorNoteService: () => undefined,
    tagStore: {
      getTagByName: vi.fn().mockReturnValue({ name: 'NewTag' }),
      createTag: vi.fn(),
    } as unknown as ArchiveCompletionServiceDeps['tagStore'],
    refreshTimelineView: vi.fn(),
    refreshCredits: vi.fn().mockResolvedValue(undefined),
    archiveLookupService: () => lookup as unknown as ReturnType<NonNullable<ArchiveCompletionServiceDeps['archiveLookupService']>>,
  };

  return { app, deps, written, preliminaryFile };
}

function makeJob(): PendingJob {
  return {
    id: 'job-1',
    url: URL,
    platform: 'instagram',
    status: 'processing',
    timestamp: 1,
    retryCount: 0,
    metadata: { filePath: PRELIMINARY_PATH, selectedTags: ['NewTag'] },
  };
}

function makePostData(): PostData {
  return {
    platform: 'instagram',
    id: 'DRPFtcOEvbl',
    url: URL,
    author: { name: 'Alice', url: 'https://www.instagram.com/alice', handle: '@alice' },
    content: { text: 'Full caption of the post' },
    media: [],
    metadata: { timestamp: new Date('2026-10-01T00:00:00.000Z') },
  } as PostData;
}

const STUB_FRONTMATTER = {
  platform: 'web',
  author: 'www.instagram.com',
  originalUrl: URL,
  sourceArchiveId: 'stub-archive-1',
  postId: 'bm-0123456789abcdef',
  archiveTags: ['Reading'],
  like: true,
};

describe('ArchiveCompletionService bookmark stub fill', () => {
  it.each([
    ['the archive id the server returned', 'stub-archive-1'],
    ['the URL when no archive id came back', undefined],
  ])('overwrites the stub note found by %s and trashes the preliminary note', async (_label, archiveId) => {
    const { app, deps, written, preliminaryFile } = makeHarness(STUB_FRONTMATTER);
    const service = new ArchiveCompletionService(deps);

    await service.processCompletedJob(makeJob(), { result: { postData: makePostData(), archiveId } });

    expect([...written.keys()]).toEqual([STUB_PATH]);
    const note = written.get(STUB_PATH) ?? '';
    expect(note).toContain('platform: instagram');
    expect(note).toContain('sourceArchiveId: stub-archive-1');
    expect(note).toContain('Full caption of the post');
    expect(note).not.toContain('postId:');
    // User-controlled fields survive, and selected tags join the stub's.
    expect(note).toContain('like: true');
    expect(note).toMatch(/archiveTags:\n {2}- Reading\n {2}- NewTag/);
    expect(app.fileManager.trashFile).toHaveBeenCalledWith(preliminaryFile);
    expect(app.fileManager.renameFile).not.toHaveBeenCalled();
    expect(deps.archiveJobTracker.failJob).not.toHaveBeenCalled();
  });

  it('leaves a non-stub note at that archive id alone', async () => {
    const { postId: _postId, ...notStub } = STUB_FRONTMATTER;
    const { app, deps, written } = makeHarness(notStub);
    const service = new ArchiveCompletionService(deps);

    await service.processCompletedJob(makeJob(), { result: { postData: makePostData(), archiveId: 'stub-archive-1' } });

    expect(written.has(STUB_PATH)).toBe(false);
    expect(app.fileManager.trashFile).not.toHaveBeenCalled();
    // The normal preliminary-note path runs instead.
    expect(app.fileManager.renameFile).toHaveBeenCalled();
  });
});
