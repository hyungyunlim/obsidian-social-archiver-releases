import { describe, expect, it, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import {
  ArchiveDeleteBackfillService,
  parseArchiveDeleteFrontmatterIdentity,
  parseSourceArchiveIdFromMarkdown,
} from '../../../plugin/sync/ArchiveDeleteBackfillService';

function makeFile(path: string): TFile {
  return { path, extension: 'md' } as unknown as TFile;
}

function makeApp(files: Array<{ file: TFile; content: string }>): App {
  const contentByPath = new Map(files.map(({ file, content }) => [file.path, content]));
  return {
    vault: {
      getMarkdownFiles: vi.fn(() => files.map(({ file }) => file)),
      cachedRead: vi.fn(async (file: TFile) => contentByPath.get(file.path) ?? ''),
    },
  } as unknown as App;
}

describe('ArchiveDeleteBackfillService', () => {
  it('parses sourceArchiveId from markdown frontmatter', () => {
    expect(parseSourceArchiveIdFromMarkdown(
      '---\nsourceArchiveId: XjsLkQ8FCi\narchive: false\n---\n\nBody',
    )).toBe('XjsLkQ8FCi');
  });

  it('returns null when markdown has no sourceArchiveId', () => {
    expect(parseSourceArchiveIdFromMarkdown('---\narchive: false\n---\n\nBody')).toBeNull();
  });

  it('parses originalUrl for legacy notes without sourceArchiveId', () => {
    expect(parseArchiveDeleteFrontmatterIdentity(
      '---\noriginalUrl: "https://example.com/post/1"\narchive: false\n---\n\nBody',
    )).toEqual({ originalUrl: 'https://example.com/post/1' });
  });

  it('trashes local files whose sourceArchiveId appears in server deletedIds', async () => {
    const deletedFile = makeFile('Social Archives/Naver/deleted.md');
    const activeFile = makeFile('Social Archives/Naver/active.md');
    const app = makeApp([
      {
        file: deletedFile,
        content: '---\nsourceArchiveId: deleted-1\narchive: false\n---\n\nBody',
      },
      {
        file: activeFile,
        content: '---\nsourceArchiveId: active-1\narchive: true\n---\n\nBody',
      },
    ]);
    const handleDeletedFile = vi.fn(async () => true);
    const apiClient = {
      getUserArchives: vi.fn(async () => ({
        archives: [],
        total: 0,
        limit: 1,
        offset: 0,
        hasMore: false,
        serverTime: '2026-06-24T00:00:00.000Z',
        deletedIds: ['deleted-1'],
      })),
    };

    const service = new ArchiveDeleteBackfillService({
      app,
      apiClient: () => apiClient as any,
      updatedAfter: '1970-01-01T00:00:00.000Z',
      handleDeletedFile,
    });

    const result = await service.reconcileFromServer();

    expect(apiClient.getUserArchives).toHaveBeenCalledWith({
      limit: 100,
      offset: 0,
      updatedAfter: '1970-01-01T00:00:00.000Z',
      includeDeleted: true,
      fields: 'sync_metadata',
    });
    expect(handleDeletedFile).toHaveBeenCalledWith(deletedFile, 'deleted-1');
    expect(handleDeletedFile).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      serverDeletedIds: 1,
      serverDeletedUrls: 0,
      serverActiveUrls: 0,
      scannedFiles: 2,
      matchedFiles: 1,
      matchedByUrlCount: 0,
      deletedCount: 1,
      failedCount: 0,
    });
  });

  it('trashes legacy files whose originalUrl appears only in server tombstones', async () => {
    const deletedFile = makeFile('Social Archives/LinkedIn/deleted.md');
    const activeFile = makeFile('Social Archives/Web/active.md');
    const app = makeApp([
      {
        file: deletedFile,
        content: '---\noriginalUrl: "https://example.com/deleted"\narchive: false\n---\n\nBody',
      },
      {
        file: activeFile,
        content: '---\noriginalUrl: "https://example.com/active"\narchive: false\n---\n\nBody',
      },
    ]);
    const handleDeletedFile = vi.fn(async () => true);
    const apiClient = {
      getUserArchives: vi.fn(async () => ({
        archives: [{ id: 'active-1', originalUrl: 'https://example.com/active' }],
        total: 1,
        limit: 100,
        offset: 0,
        hasMore: false,
        serverTime: '2026-06-24T00:00:00.000Z',
        deletedIds: ['deleted-1'],
        deletedArchives: [{
          id: 'deleted-1',
          originalUrl: 'https://example.com/deleted',
          platform: 'linkedin',
          postId: null,
          deletedAt: '2026-06-24T00:00:00.000Z',
        }],
      })),
    };

    const service = new ArchiveDeleteBackfillService({
      app,
      apiClient: () => apiClient as any,
      updatedAfter: '1970-01-01T00:00:00.000Z',
      handleDeletedFile,
    });

    const result = await service.reconcileFromServer();

    expect(handleDeletedFile).toHaveBeenCalledWith(deletedFile, 'deleted-1');
    expect(handleDeletedFile).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      serverDeletedIds: 1,
      serverDeletedUrls: 1,
      serverActiveUrls: 1,
      scannedFiles: 2,
      matchedFiles: 1,
      matchedByUrlCount: 1,
      deletedCount: 1,
      failedCount: 0,
    });
  });

  it('does not trash a legacy file when the same originalUrl is still active on the server', async () => {
    const file = makeFile('Social Archives/Web/still-active.md');
    const app = makeApp([
      {
        file,
        content: '---\noriginalUrl: "https://example.com/post"\narchive: false\n---\n\nBody',
      },
    ]);
    const handleDeletedFile = vi.fn(async () => true);
    const apiClient = {
      getUserArchives: vi.fn(async () => ({
        archives: [{ id: 'active-1', originalUrl: 'https://example.com/post' }],
        total: 1,
        limit: 100,
        offset: 0,
        hasMore: false,
        serverTime: '2026-06-24T00:00:00.000Z',
        deletedIds: ['deleted-1'],
        deletedArchives: [{
          id: 'deleted-1',
          originalUrl: 'https://example.com/post',
          platform: 'web',
          postId: null,
          deletedAt: '2026-06-24T00:00:00.000Z',
        }],
      })),
    };

    const service = new ArchiveDeleteBackfillService({
      app,
      apiClient: () => apiClient as any,
      updatedAfter: '1970-01-01T00:00:00.000Z',
      handleDeletedFile,
    });

    const result = await service.reconcileFromServer();

    expect(handleDeletedFile).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      serverDeletedIds: 1,
      serverDeletedUrls: 1,
      serverActiveUrls: 1,
      scannedFiles: 1,
      matchedFiles: 0,
      matchedByUrlCount: 0,
      deletedCount: 0,
      failedCount: 0,
    });
  });
});
