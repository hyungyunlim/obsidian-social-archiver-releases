/**
 * ArchiveTagBackfillService — Unit Tests
 *
 * Covers the inbound catch-up pass for archive→tag mappings:
 * - server tags missing locally are written into `archiveTags`
 * - local-only tags survive (additive, never replacement)
 * - notes already carrying every server tag are not rewritten
 * - native `tags` is only touched when mirroring is enabled
 * - the outbound service is suppressed + primed so nothing is echoed back
 */

import { describe, it, expect, vi } from 'vitest';
import { ArchiveTagBackfillService } from '../../plugin/sync/ArchiveTagBackfillService';
import type { TFile } from 'obsidian';

// ─── Mock factories ───────────────────────────────────────

function makeFile(path: string): TFile {
  return { path, extension: 'md' } as unknown as TFile;
}

/** App whose frontmatter records are mutated in place by processFrontMatter. */
function makeApp(fmByPath: Map<string, Record<string, unknown>>) {
  return {
    metadataCache: {
      getFileCache: vi.fn((file: TFile) => {
        const fm = fmByPath.get(file.path);
        return fm ? { frontmatter: fm } : null;
      }),
    },
    fileManager: {
      processFrontMatter: vi.fn(async (file: TFile, fn: (fm: Record<string, unknown>) => void) => {
        const fm = fmByPath.get(file.path) ?? {};
        fn(fm);
        fmByPath.set(file.path, fm);
      }),
    },
  };
}

function makeDeps(options: {
  fmByPath: Map<string, Record<string, unknown>>;
  filesByArchiveId: Map<string, TFile>;
  archiveTags: Array<{ archiveId: string; tagId: string; createdAt: string }>;
  definitions?: Array<{ id: string; name: string }>;
  mirror?: boolean;
  enabled?: boolean;
}) {
  const app = makeApp(options.fmByPath);

  const apiClient = {
    getArchiveTags: vi.fn().mockResolvedValue({
      archiveTags: options.archiveTags,
      deletedPairs: [],
      serverTime: '2026-08-13T00:00:00.000Z',
    }),
  };

  const outbound = {
    addSuppression: vi.fn(),
    primeSnapshot: vi.fn(),
  };

  const deps = {
    app: app as never,
    apiClient: () => apiClient as never,
    archiveLookup: {
      findBySourceArchiveId: (id: string) => options.filesByArchiveId.get(id) ?? null,
    } as never,
    tagStore: {
      getTagDefinitions: () => options.definitions ?? [{ id: 'tag-1', name: 'travel' }],
    } as never,
    getSettings: () => ({
      enableMobileAnnotationSync: options.enabled ?? true,
      mirrorArchiveTagsToObsidianTags: options.mirror ?? false,
    }) as never,
    archiveTagOutbound: () => outbound as never,
  };

  return { deps, app, apiClient, outbound };
}

// ─── Tests ───────────────────────────────────────────────

describe('ArchiveTagBackfillService', () => {
  it('writes server tags into a note that has none', async () => {
    const file = makeFile('Social Archives/post.md');
    const fmByPath = new Map<string, Record<string, unknown>>([
      [file.path, { sourceArchiveId: 'archive-1' }],
    ]);

    const { deps, outbound } = makeDeps({
      fmByPath,
      filesByArchiveId: new Map([['archive-1', file]]),
      archiveTags: [{ archiveId: 'archive-1', tagId: 'tag-1', createdAt: '2026-08-13T00:00:00.000Z' }],
    });

    const result = await new ArchiveTagBackfillService(deps).reconcileFromServer();

    expect(fmByPath.get(file.path)?.archiveTags).toEqual(['travel']);
    expect(result.updatedCount).toBe(1);
    // Suppressed + primed, otherwise our own write bounces back to the server.
    expect(outbound.addSuppression).toHaveBeenCalledWith('archive-1');
    expect(outbound.primeSnapshot).toHaveBeenCalledWith(file.path, ['travel']);
  });

  it('keeps local-only tags instead of replacing them', async () => {
    const file = makeFile('Social Archives/post.md');
    const fmByPath = new Map<string, Record<string, unknown>>([
      [file.path, { sourceArchiveId: 'archive-1', archiveTags: ['local-only'] }],
    ]);

    const { deps } = makeDeps({
      fmByPath,
      filesByArchiveId: new Map([['archive-1', file]]),
      archiveTags: [{ archiveId: 'archive-1', tagId: 'tag-1', createdAt: '2026-08-13T00:00:00.000Z' }],
    });

    await new ArchiveTagBackfillService(deps).reconcileFromServer();

    expect(fmByPath.get(file.path)?.archiveTags).toEqual(['local-only', 'travel']);
  });

  it('does not rewrite a note that already carries every server tag', async () => {
    const file = makeFile('Social Archives/post.md');
    const fmByPath = new Map<string, Record<string, unknown>>([
      [file.path, { sourceArchiveId: 'archive-1', archiveTags: ['Travel'] }],
    ]);

    const { deps, app } = makeDeps({
      fmByPath,
      filesByArchiveId: new Map([['archive-1', file]]),
      archiveTags: [{ archiveId: 'archive-1', tagId: 'tag-1', createdAt: '2026-08-13T00:00:00.000Z' }],
    });

    const result = await new ArchiveTagBackfillService(deps).reconcileFromServer();

    expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
    expect(result.alreadySyncedCount).toBe(1);
    expect(result.updatedCount).toBe(0);
  });

  it('mirrors into native tags only when the setting is on', async () => {
    const file = makeFile('Social Archives/post.md');
    const base = () => new Map<string, Record<string, unknown>>([
      [file.path, { sourceArchiveId: 'archive-1', tags: ['note'] }],
    ]);
    const mapping = [{ archiveId: 'archive-1', tagId: 'tag-1', createdAt: '2026-08-13T00:00:00.000Z' }];

    const off = base();
    await new ArchiveTagBackfillService(
      makeDeps({ fmByPath: off, filesByArchiveId: new Map([['archive-1', file]]), archiveTags: mapping }).deps,
    ).reconcileFromServer();
    expect(off.get(file.path)?.tags).toEqual(['note']);

    const on = base();
    await new ArchiveTagBackfillService(
      makeDeps({ fmByPath: on, filesByArchiveId: new Map([['archive-1', file]]), archiveTags: mapping, mirror: true }).deps,
    ).reconcileFromServer();
    expect(on.get(file.path)?.tags).toEqual(['note', 'travel']);
  });

  it('keeps hand-written inline tags when mirroring (Obsidian allows `tags: a, b`)', async () => {
    const file = makeFile('Social Archives/post.md');
    const fmByPath = new Map<string, Record<string, unknown>>([
      [file.path, { sourceArchiveId: 'archive-1', tags: 'work, reading' }],
    ]);

    const { deps } = makeDeps({
      fmByPath,
      filesByArchiveId: new Map([['archive-1', file]]),
      archiveTags: [{ archiveId: 'archive-1', tagId: 'tag-1', createdAt: '2026-08-13T00:00:00.000Z' }],
      mirror: true,
    });

    await new ArchiveTagBackfillService(deps).reconcileFromServer();

    expect(fmByPath.get(file.path)?.tags).toEqual(['work', 'reading', 'travel']);
  });

  it('counts mappings with no vault note and no local definition instead of throwing', async () => {
    const file = makeFile('Social Archives/post.md');
    const fmByPath = new Map<string, Record<string, unknown>>([
      [file.path, { sourceArchiveId: 'archive-1' }],
    ]);

    const { deps } = makeDeps({
      fmByPath,
      filesByArchiveId: new Map([['archive-1', file]]),
      archiveTags: [
        { archiveId: 'archive-1', tagId: 'tag-1', createdAt: '2026-08-13T00:00:00.000Z' },
        { archiveId: 'archive-missing', tagId: 'tag-1', createdAt: '2026-08-13T00:00:00.000Z' },
        { archiveId: 'archive-1', tagId: 'tag-unknown', createdAt: '2026-08-13T00:00:00.000Z' },
      ],
    });

    const result = await new ArchiveTagBackfillService(deps).reconcileFromServer();

    expect(result.serverMappings).toBe(3);
    expect(result.unknownTagIds).toBe(1);
    expect(result.missingFiles).toBe(1);
    expect(result.updatedCount).toBe(1);
  });

  it('does nothing when mobile annotation sync is disabled', async () => {
    const file = makeFile('Social Archives/post.md');
    const fmByPath = new Map<string, Record<string, unknown>>([
      [file.path, { sourceArchiveId: 'archive-1' }],
    ]);

    const { deps, apiClient } = makeDeps({
      fmByPath,
      filesByArchiveId: new Map([['archive-1', file]]),
      archiveTags: [{ archiveId: 'archive-1', tagId: 'tag-1', createdAt: '2026-08-13T00:00:00.000Z' }],
      enabled: false,
    });

    const result = await new ArchiveTagBackfillService(deps).reconcileFromServer();

    expect(apiClient.getArchiveTags).not.toHaveBeenCalled();
    expect(result.serverMappings).toBe(0);
  });
});
