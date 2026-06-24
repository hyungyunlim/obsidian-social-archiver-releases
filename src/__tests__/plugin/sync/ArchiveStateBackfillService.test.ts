import { describe, expect, it, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import {
  ArchiveStateBackfillService,
  parseArchiveStateFrontmatterIdentity,
} from '../../../plugin/sync/ArchiveStateBackfillService';

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

describe('ArchiveStateBackfillService', () => {
  it('parses sourceArchiveId and archive frontmatter from markdown', () => {
    expect(parseArchiveStateFrontmatterIdentity(
      '---\nsourceArchiveId: abc123\narchive: true\n---\n\nBody',
    )).toEqual({
      sourceArchiveId: 'abc123',
      archive: true,
    });
  });

  it('treats missing archive frontmatter as false', () => {
    expect(parseArchiveStateFrontmatterIdentity(
      '---\nsourceArchiveId: abc123\n---\n\nBody',
    )).toEqual({
      sourceArchiveId: 'abc123',
      archive: false,
    });
  });

  it('reconciles a local archive:false file when the server isBookmarked state is true', async () => {
    const file = makeFile('Social Archives/Subscriptions/Facebook/post.md');
    const app = makeApp([
      {
        file,
        content: '---\nsourceArchiveId: archive-1\narchive: false\n---\n\nBody',
      },
    ]);
    const reconcileArchiveState = vi.fn(async () => {});
    const apiClient = {
      getUserArchives: vi.fn(async () => ({
        archives: [
          {
            id: 'archive-1',
            isBookmarked: true,
            isLiked: false,
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
        hasMore: false,
        serverTime: '2026-06-24T00:00:00.000Z',
      })),
    };

    const service = new ArchiveStateBackfillService({
      app,
      apiClient: () => apiClient as any,
      reconcileArchiveState,
    });

    const result = await service.reconcileFromServer();

    expect(apiClient.getUserArchives).toHaveBeenCalledWith({
      limit: 100,
      offset: 0,
      fields: 'sync_metadata',
    });
    expect(reconcileArchiveState).toHaveBeenCalledWith(file, 'archive-1', true);
    expect(result).toMatchObject({
      serverArchives: 1,
      scannedFiles: 1,
      matchedFiles: 1,
      updatedCount: 1,
      failedCount: 0,
    });
  });

  it('skips files that already match the server bookmark state', async () => {
    const file = makeFile('Social Archives/Facebook/post.md');
    const app = makeApp([
      {
        file,
        content: '---\nsourceArchiveId: archive-1\narchive: true\n---\n\nBody',
      },
    ]);
    const reconcileArchiveState = vi.fn(async () => {});
    const apiClient = {
      getUserArchives: vi.fn(async () => ({
        archives: [{ id: 'archive-1', isBookmarked: true }],
        total: 1,
        limit: 100,
        offset: 0,
        hasMore: false,
        serverTime: '2026-06-24T00:00:00.000Z',
      })),
    };

    const service = new ArchiveStateBackfillService({
      app,
      apiClient: () => apiClient as any,
      reconcileArchiveState,
    });

    const result = await service.reconcileFromServer();

    expect(reconcileArchiveState).not.toHaveBeenCalled();
    expect(result.alreadySyncedCount).toBe(1);
  });
});
