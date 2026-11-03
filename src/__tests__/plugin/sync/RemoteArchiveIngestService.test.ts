import { describe, expect, it, vi } from 'vitest';
import type { TFile } from 'obsidian';
import { RemoteArchiveIngestService } from '../../../plugin/sync/RemoteArchiveIngestService';
import type { UserArchive, WorkersAPIClient } from '../../../services/WorkersAPIClient';
import type { ArchiveLookupService } from '../../../services/ArchiveLookupService';
import type { PostData } from '../../../types/post';

function makeArchive(overrides: Partial<UserArchive> = {}): UserArchive {
  return {
    id: 'archive-1',
    userId: 'user-1',
    platform: 'youtube',
    postId: 'video-1',
    originalUrl: 'https://www.youtube.com/watch?v=abc123',
    title: 'Example video',
    authorName: 'Creator',
    authorUrl: null,
    authorAvatarUrl: null,
    previewText: 'Preview',
    fullContent: 'Content',
    thumbnailUrl: null,
    thumbnailUrls: null,
    media: null,
    postedAt: null,
    archivedAt: '2026-05-19T00:00:00.000Z',
    likesCount: null,
    commentCount: null,
    sharesCount: null,
    viewsCount: null,
    metadata: null,
    isLiked: false,
    isBookmarked: true,
    isArchived: true,
    isShared: false,
    ...overrides,
  };
}

function makeFile(path: string): TFile {
  // Real TFiles carry their vault; the local-only guard reads note content
  // through it. Empty content = an ordinary note, not a local-only one.
  return {
    path,
    extension: 'md',
    vault: { cachedRead: vi.fn().mockResolvedValue('') },
  } as unknown as TFile;
}

describe('RemoteArchiveIngestService', () => {
  it('replaces an existing limited archive note when the fetched archive has rich content', async () => {
    const archive = makeArchive({
      title: 'Wikidocs article',
      originalUrl: 'https://wikidocs.net/blog/@jaehong/12725/',
      fullContent: '# Wikidocs article\n\nReal article body from the clipper.',
    });
    const file = makeFile('Social Archives/Web Article/wikidocs.md');
    const getUserArchive = vi.fn().mockResolvedValue({ archive });
    const replaceExistingLimitedArchive = vi.fn().mockResolvedValue({
      status: 'updated',
      file,
      path: file.path,
    });
    const archiveLookupService = {
      findBySourceArchiveId: vi.fn().mockReturnValue(file),
      findByOriginalUrl: vi.fn().mockReturnValue([]),
      backfillFileIdentity: vi.fn().mockResolvedValue(undefined),
      indexSavedFile: vi.fn(),
    };

    const service = new RemoteArchiveIngestService({
      apiClient: () => ({ getUserArchive }) as any,
      settings: () => ({ archivePath: 'Social Archives' }),
      hasRecentlyArchivedUrl: vi.fn().mockReturnValue(false),
      archiveLookupService: archiveLookupService as any,
      convertUserArchiveToPostData: vi.fn().mockReturnValue({
        platform: 'web',
        id: archive.postId,
        url: archive.originalUrl,
        author: { name: 'jaehong' },
        content: { text: 'Real article body from the clipper.' },
        media: [],
      }),
      saveSubscriptionPost: vi.fn(),
      saveSubscriptionPostDetailed: vi.fn(),
      isLimitedArchiveFile: vi.fn().mockResolvedValue(true),
      replaceExistingLimitedArchive,
      refreshTimelineView: vi.fn(),
    });

    await expect(service.ingestArchiveById(archive.id, 'archive_complete')).resolves.toBe('created');

    expect(getUserArchive).toHaveBeenCalledWith(archive.id);
    expect(replaceExistingLimitedArchive).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        post: expect.objectContaining({
          sourceArchiveId: archive.id,
          url: archive.originalUrl,
        }),
      }),
    );
    expect(archiveLookupService.backfillFileIdentity).toHaveBeenCalledWith(file, archive.id);
  });

  it('offers existing non-limited notes to the richer replacement path for media enrichment', async () => {
    const archive = makeArchive({
      platform: 'instagram',
      originalUrl: 'https://www.instagram.com/p/CPOST/',
      mediaPreservationStatus: 'completed',
      media: [
        { type: 'image', url: 'https://cdn.example.com/00.jpg' },
        { type: 'image', url: 'https://cdn.example.com/01.jpg' },
        { type: 'video', url: 'https://cdn.example.com/02.mp4' },
      ],
      mediaPreserved: [
        {
          originalUrl: 'https://cdn.example.com/02.mp4',
          r2Url: 'https://api.example/media/02.mp4',
          r2Key: 'archives/user/archive-1/media/2.mp4',
          type: 'video',
          size: 100,
          contentType: 'video/mp4',
          preservedAt: '2026-05-28T00:00:00.000Z',
        },
      ],
    });
    const file = makeFile('Social Archives/Instagram/post.md');
    const getUserArchive = vi.fn().mockResolvedValue({ archive });
    const replaceExistingLimitedArchive = vi.fn().mockResolvedValue({
      status: 'updated',
      file,
      path: file.path,
    });
    const archiveLookupService = {
      findBySourceArchiveId: vi.fn().mockReturnValue(file),
      findByOriginalUrl: vi.fn().mockReturnValue([]),
      backfillFileIdentity: vi.fn().mockResolvedValue(undefined),
      indexSavedFile: vi.fn(),
    };

    const service = new RemoteArchiveIngestService({
      apiClient: () => ({ getUserArchive }) as any,
      settings: () => ({ archivePath: 'Social Archives' }),
      hasRecentlyArchivedUrl: vi.fn().mockReturnValue(false),
      archiveLookupService: archiveLookupService as any,
      convertUserArchiveToPostData: vi.fn().mockReturnValue({
        platform: 'instagram',
        id: archive.postId,
        url: archive.originalUrl,
        author: { name: 'Yon' },
        content: { text: 'Caption' },
        mediaPreservationStatus: 'completed',
        media: [
          { type: 'image', url: 'https://cdn.example.com/00.jpg' },
          { type: 'image', url: 'https://cdn.example.com/01.jpg' },
          { type: 'video', url: 'https://cdn.example.com/02.mp4', r2Url: 'https://api.example/media/02.mp4' },
        ],
      }),
      saveSubscriptionPost: vi.fn(),
      saveSubscriptionPostDetailed: vi.fn(),
      isLimitedArchiveFile: vi.fn().mockResolvedValue(false),
      replaceExistingLimitedArchive,
      refreshTimelineView: vi.fn(),
    });

    await expect(service.ingestArchiveById(archive.id, 'archive_complete')).resolves.toBe('created');

    expect(getUserArchive).toHaveBeenCalledWith(archive.id);
    expect(replaceExistingLimitedArchive).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        post: expect.objectContaining({
          mediaPreservationStatus: 'completed',
          media: expect.arrayContaining([
            expect.objectContaining({ r2Url: 'https://api.example/media/02.mp4' }),
          ]),
        }),
      }),
    );
    expect(archiveLookupService.backfillFileIdentity).toHaveBeenCalledWith(file, archive.id);
  });

  it('binds a recent same-url local note instead of treating it as materialized without an archive id', async () => {
    const archive = makeArchive();
    const file = makeFile('Social Archives/youtube/example.md');
    const saveSubscriptionPostDetailed = vi.fn();
    const archiveLookupService = {
      findBySourceArchiveId: vi.fn().mockReturnValue(null),
      findByOriginalUrl: vi.fn().mockReturnValue([file]),
      backfillFileIdentity: vi.fn().mockResolvedValue(undefined),
      indexSavedFile: vi.fn(),
    };
    const service = new RemoteArchiveIngestService({
      apiClient: () => ({
        getUserArchive: vi.fn().mockResolvedValue({ archive }),
      }) as any,
      settings: () => ({ archivePath: 'Social Archives' }),
      hasRecentlyArchivedUrl: vi.fn().mockReturnValue(true),
      archiveLookupService: archiveLookupService as any,
      convertUserArchiveToPostData: vi.fn(),
      saveSubscriptionPost: vi.fn(),
      saveSubscriptionPostDetailed,
      refreshTimelineView: vi.fn(),
    });

    await expect(service.ingestArchiveById(archive.id, 'transcription_job')).resolves.toBe('existing');

    expect(saveSubscriptionPostDetailed).not.toHaveBeenCalled();
    expect(archiveLookupService.backfillFileIdentity).toHaveBeenCalledWith(file, archive.id);
    expect(archiveLookupService.indexSavedFile).toHaveBeenCalledWith(file, {
      sourceArchiveId: archive.id,
      originalUrl: archive.originalUrl,
    });
  });

  it('binds existing save results so job materialization can find the note by sourceArchiveId', async () => {
    const archive = makeArchive();
    const file = makeFile('Social Archives/youtube/example.md');
    const archiveLookupService = {
      findBySourceArchiveId: vi.fn().mockReturnValue(null),
      findByOriginalUrl: vi.fn().mockReturnValue([]),
      backfillFileIdentity: vi.fn().mockResolvedValue(undefined),
      indexSavedFile: vi.fn(),
    };
    const service = new RemoteArchiveIngestService({
      apiClient: () => ({
        getUserArchive: vi.fn().mockResolvedValue({ archive }),
      }) as any,
      settings: () => ({ archivePath: 'Social Archives' }),
      hasRecentlyArchivedUrl: vi.fn().mockReturnValue(false),
      archiveLookupService: archiveLookupService as any,
      convertUserArchiveToPostData: vi.fn().mockReturnValue({
        platform: 'youtube',
        id: archive.postId,
        url: archive.originalUrl,
        sourceArchiveId: archive.id,
        author: { name: 'Creator' },
        content: { text: 'Content' },
        media: [],
      }),
      saveSubscriptionPost: vi.fn(),
      saveSubscriptionPostDetailed: vi.fn().mockResolvedValue({
        status: 'existing',
        file,
        path: file.path,
      }),
      refreshTimelineView: vi.fn(),
    });

    await expect(service.ingestArchiveById(archive.id, 'transcription_job')).resolves.toBe('existing');

    expect(archiveLookupService.backfillFileIdentity).toHaveBeenCalledWith(file, archive.id);
    expect(archiveLookupService.indexSavedFile).toHaveBeenCalledWith(file, {
      sourceArchiveId: archive.id,
      originalUrl: archive.originalUrl,
    });
  });

  describe('inline body image reconcile (inline image PRD §6.3)', () => {
    const record = {
      originalUrl: 'https://cdn.example.com/chart.png',
      r2Url: 'https://social-archiver-api.social-archive.org/media/archives/u/a/inline/i-0123456789abcdef.png',
      r2Key: 'archives/u/a/inline/i-0123456789abcdef.png',
      type: 'image' as const,
      size: 10,
      contentType: 'image/png',
      preservedAt: '2026-11-03T00:00:00.000Z',
    };

    function makeIngest(archive: UserArchive, overrides: Partial<ConstructorParameters<typeof RemoteArchiveIngestService>[0]>) {
      const reconcileInlineImageState = vi.fn().mockResolvedValue(undefined);
      const service = new RemoteArchiveIngestService({
        apiClient: () => ({ getUserArchive: vi.fn().mockResolvedValue({ archive }) }) as unknown as WorkersAPIClient,
        settings: () => ({ archivePath: 'Social Archives' }),
        hasRecentlyArchivedUrl: vi.fn().mockReturnValue(false),
        archiveLookupService: {
          findBySourceArchiveId: vi.fn().mockReturnValue(null),
          findByOriginalUrl: vi.fn().mockReturnValue([]),
          backfillFileIdentity: vi.fn().mockResolvedValue(undefined),
          indexSavedFile: vi.fn(),
        } as unknown as ArchiveLookupService,
        convertUserArchiveToPostData: vi.fn().mockReturnValue({
          platform: 'web',
          id: archive.postId,
          url: archive.originalUrl,
          author: { name: 'Writer' },
          content: { text: 'body' },
          media: [],
        } as unknown as PostData),
        saveSubscriptionPost: vi.fn(),
        refreshTimelineView: vi.fn(),
        reconcileInlineImageState,
        ...overrides,
      });
      return { service, reconcileInlineImageState };
    }

    it('reconciles a freshly saved note', async () => {
      const archive = makeArchive({ platform: 'web', inlineMediaPreserved: [record] });
      const file = makeFile('Social Archives/web/story.md');
      const { service, reconcileInlineImageState } = makeIngest(archive, {
        saveSubscriptionPostDetailed: vi.fn().mockResolvedValue({ status: 'created', file, path: file.path }),
      });

      await expect(service.ingestArchiveById(archive.id, 'archive_complete')).resolves.toBe('created');

      expect(reconcileInlineImageState).toHaveBeenCalledWith(file, archive);
    });

    it('reconciles a note replaced through the limited-archive path', async () => {
      const archive = makeArchive({ platform: 'web', inlineMediaPreserved: [record] });
      const file = makeFile('Social Archives/web/story.md');
      const { service, reconcileInlineImageState } = makeIngest(archive, {
        archiveLookupService: {
          findBySourceArchiveId: vi.fn().mockReturnValue(file),
          findByOriginalUrl: vi.fn().mockReturnValue([]),
          backfillFileIdentity: vi.fn().mockResolvedValue(undefined),
          indexSavedFile: vi.fn(),
        } as unknown as ArchiveLookupService,
        replaceExistingLimitedArchive: vi.fn().mockResolvedValue({ status: 'updated', file, path: file.path }),
      });

      await expect(service.ingestArchiveById(archive.id, 'archive_complete')).resolves.toBe('created');

      expect(reconcileInlineImageState).toHaveBeenCalledWith(file, archive);
    });

    it('does not reconcile an existing note or an archive without records', async () => {
      const file = makeFile('Social Archives/web/story.md');
      const existing = makeIngest(makeArchive({ platform: 'web', inlineMediaPreserved: [record] }), {
        saveSubscriptionPostDetailed: vi.fn().mockResolvedValue({ status: 'existing', file, path: file.path }),
      });
      await existing.service.ingestArchiveById('archive-1', 'archive_complete');
      expect(existing.reconcileInlineImageState).not.toHaveBeenCalled();

      const withoutRecords = makeIngest(makeArchive({ platform: 'web' }), {
        saveSubscriptionPostDetailed: vi.fn().mockResolvedValue({ status: 'created', file, path: file.path }),
      });
      await withoutRecords.service.ingestArchiveById('archive-1', 'archive_complete');
      expect(withoutRecords.reconcileInlineImageState).not.toHaveBeenCalled();
    });
  });
});
