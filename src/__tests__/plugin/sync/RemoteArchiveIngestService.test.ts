import { describe, expect, it, vi } from 'vitest';
import type { TFile } from 'obsidian';
import { RemoteArchiveIngestService } from '../../../plugin/sync/RemoteArchiveIngestService';
import type { UserArchive } from '../../../services/WorkersAPIClient';

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
  return { path, extension: 'md' } as unknown as TFile;
}

describe('RemoteArchiveIngestService', () => {
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
});
