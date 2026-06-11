/**
 * Unit tests for LocalArchiveImportService — the local-only note graduation
 * run (prd-plugin-anonymous-local-mode.md S4/S6).
 *
 * No network / vault I/O — adapter, parser, and app surfaces are all fakes.
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import {
  LocalArchiveImportService,
  SERVER_ARCHIVE_ID_FRONTMATTER_KEY,
  deriveTransportPostId,
  type LocalArchiveImportServiceDeps,
  type LocalImportApi,
  type LocalImportProgress,
} from '@/services/import/local/LocalArchiveImportService';
import {
  IMPORT_MODE_FRONTMATTER_KEY,
  IMPORT_MODE_IMPORTED,
  type LocalOnlyNoteRef,
} from '@/services/import/local/LocalArchiveScanner';
import type { ImportLogger } from '@/types/import';
import type { LocalImportLastResult } from '@/types/settings';
import type { PostData, Platform } from '@/types/post';

type StartResult = Awaited<ReturnType<LocalImportApi['startImportSession']>>;
type BatchArgs = Parameters<LocalImportApi['createArchivesFromImportBatch']>[0];
type BatchResult = Awaited<ReturnType<LocalImportApi['createArchivesFromImportBatch']>>;
type UploadArgs = Parameters<LocalImportApi['uploadArchiveMedia']>[0];
type UploadResult = Awaited<ReturnType<LocalImportApi['uploadArchiveMedia']>>;
type FinalizeArgs = Parameters<LocalImportApi['finalizeImportJob']>[0];

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeLogger(): ImportLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makePostData(id: string, overrides: Partial<PostData> = {}): PostData {
  return {
    platform: 'x' as Platform,
    id,
    url: `https://x.com/u/status/${id}`,
    author: { name: 'Author', url: 'https://x.com/u' },
    content: { text: 'hello' },
    media: [],
    metadata: {
      timestamp: new Date('2026-01-01T00:00:00Z'),
      socialArchiverImportMode: 'local-only',
      socialArchiverImportSource: 'browser-clip:chrome-extension',
      socialArchiverServerArchiveId: 'none',
    },
    archivedDate: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  } as PostData;
}

/**
 * Transport id the service derives for makePostData fixtures: the parser's
 * basename id is replaced by the platform post id extracted from the URL,
 * falling back to a stable URL hash (here: the fixture ids are non-numeric,
 * so the x extractor never matches and the hash path is exercised).
 */
function tid(id: string): string {
  return deriveTransportPostId('x', `https://x.com/u/status/${id}`);
}

/** Happy-path API fake — tests override per-method via mockImplementation. */
function makeApi() {
  return {
    startImportSession: vi.fn(
      async (): Promise<StartResult> => ({ jobId: 'job', sessionId: 'sess', expiresAt: 0 }),
    ),
    createArchivesFromImportBatch: vi.fn(
      async (args: BatchArgs): Promise<BatchResult> => ({
        accepted: args.items.length,
        created: args.items.map((item) => ({
          postId: item.clientPostData.id,
          archiveId: `arch-${item.clientPostData.id}`,
        })),
        skippedDuplicates: [],
        failed: [],
      }),
    ),
    uploadArchiveMedia: vi.fn(
      async (args: UploadArgs): Promise<UploadResult> => ({
        uploaded: args.files.length,
        failed: [],
      }),
    ),
    finalizeImportJob: vi.fn(async (_args: FinalizeArgs): Promise<void> => {}),
  };
}

interface FakeAppHandles {
  app: App;
  /** Frontmatter store keyed by note path — mutated by processFrontMatter. */
  frontmatters: Map<string, Record<string, unknown>>;
}

function makeApp(mediaFiles: Array<{ path: string; size?: number }> = []): FakeAppHandles {
  const vaultFiles = new Map<string, TFile>();
  for (const spec of mediaFiles) {
    const file = new TFile(spec.path);
    file.stat.size = spec.size ?? 4;
    vaultFiles.set(spec.path, file);
  }
  const frontmatters = new Map<string, Record<string, unknown>>();
  const app = {
    vault: {
      getFileByPath: (path: string) => vaultFiles.get(path) ?? null,
      readBinary: async () => new ArrayBuffer(4),
    },
    fileManager: {
      processFrontMatter: async (file: TFile, fn: (fm: Record<string, unknown>) => void) => {
        const fm = frontmatters.get(file.path) ?? {};
        fn(fm);
        frontmatters.set(file.path, fm);
      },
    },
  } as unknown as App;
  return { app, frontmatters };
}

function makeNote(path: string, ctime = 0): LocalOnlyNoteRef {
  const file = new TFile(path);
  file.stat.ctime = ctime;
  return { file, importSource: 'browser-clip:chrome-extension' };
}

interface ServiceSetup {
  service: LocalArchiveImportService;
  api: ReturnType<typeof makeApi>;
  handles: FakeAppHandles;
  persistResult: Mock<[LocalImportLastResult], Promise<void>>;
}

function makeService(opts: {
  postDataByPath: Map<string, PostData | null>;
  mediaFiles?: Array<{ path: string; size?: number }>;
}): ServiceSetup {
  const api = makeApi();
  const handles = makeApp(opts.mediaFiles ?? []);
  const persistResult = vi.fn(async (_result: LocalImportLastResult): Promise<void> => {});
  const deps: LocalArchiveImportServiceDeps = {
    app: handles.app,
    api: api as unknown as LocalImportApi,
    parser: {
      parseFile: async (file: TFile) => {
        const data = opts.postDataByPath.get(file.path);
        // Mirror PostDataParser: clone per call so transport mutations in one
        // test never leak into the source map.
        return data ? structuredClone(data) : null;
      },
    },
    logger: makeLogger(),
    sourceClientId: 'client-1',
    persistResult,
  };
  return { service: new LocalArchiveImportService(deps), api, handles, persistResult };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LocalArchiveImportService', () => {
  it('imports created items, uploads media, backfills frontmatter, and persists the summary', async () => {
    const mediaPath = 'attachments/social-archives/x/p1/photo.jpg';
    const avatarPath = 'attachments/social-archives/authors/author.jpg';
    const postDataByPath = new Map<string, PostData | null>([
      [
        'Social Archives/X/p1.md',
        makePostData('p1', {
          media: [{ type: 'image', url: mediaPath }],
          author: { name: 'Author', url: 'https://x.com/u', localAvatar: avatarPath },
        }),
      ],
      ['Social Archives/X/p2.md', makePostData('p2')],
    ]);
    const { service, api, handles, persistResult } = makeService({
      postDataByPath,
      mediaFiles: [{ path: mediaPath }, { path: avatarPath }],
    });

    const notes = [makeNote('Social Archives/X/p1.md'), makeNote('Social Archives/X/p2.md')];
    const result = await service.run(notes);

    expect(result).toMatchObject({
      imported: 2,
      duplicates: 0,
      partialMedia: 0,
      failed: 0,
      remaining: 0,
      stopReason: 'completed',
    });
    expect(persistResult).toHaveBeenCalledWith(result);

    // Session + batch carry the new source.
    expect(api.startImportSession).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'obsidian-local-import', selectedCount: 2 }),
    );
    const batchArgs = api.createArchivesFromImportBatch.mock.calls[0]![0];
    expect(batchArgs.source).toBe('obsidian-local-import');
    // exportId must be non-empty (server requires 1–128 chars) — the job id
    // doubles as the export id for vault imports.
    expect(batchArgs.items[0]!.importContext).toMatchObject({
      source: 'obsidian-local-import',
      exportId: batchArgs.jobId,
      partNumber: 0,
    });
    expect(batchArgs.jobId.length).toBeGreaterThan(0);

    // The transport id is the derived platform post id, not the note basename.
    const submittedP1 = batchArgs.items.find((i) => i.clientPostData.id === tid('p1'))!
      .clientPostData;

    // Vault media + avatar were rewritten to localpath sentinels and the
    // local-only markers stripped from the transport payload.
    expect(submittedP1.media[0]!.url).toBe('localpath:01-photo.jpg');
    expect(submittedP1.author.avatar).toBe('localpath:02-author.jpg');
    expect(submittedP1.author.localAvatar).toBeUndefined();
    expect(submittedP1.metadata.socialArchiverImportMode).toBeUndefined();
    expect(submittedP1.metadata.socialArchiverImportSource).toBeUndefined();
    expect(submittedP1.metadata.socialArchiverServerArchiveId).toBeUndefined();
    expect(submittedP1.sourceArchiveId).toBeUndefined();

    // Media upload sends both files for p1's archive with sentinel filenames.
    expect(api.uploadArchiveMedia).toHaveBeenCalledTimes(1);
    const uploadArgs = api.uploadArchiveMedia.mock.calls[0]![0];
    expect(uploadArgs.archiveId).toBe(`arch-${tid('p1')}`);
    expect(uploadArgs.files.map((f) => f.filename)).toEqual(['01-photo.jpg', '02-author.jpg']);

    // Frontmatter backfill (S4.6).
    const fm = handles.frontmatters.get('Social Archives/X/p1.md')!;
    expect(fm['sourceArchiveId']).toBe(`arch-${tid('p1')}`);
    expect(fm[SERVER_ARCHIVE_ID_FRONTMATTER_KEY]).toBe(`arch-${tid('p1')}`);
    expect(fm[IMPORT_MODE_FRONTMATTER_KEY]).toBe(IMPORT_MODE_IMPORTED);

    expect(api.finalizeImportJob).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'obsidian-local-import',
        totalCount: 2,
        uploadedItemCount: 2,
        duplicateCount: 0,
      }),
    );
  });

  it('backfills frontmatter from the existing archive on duplicates without counting them imported', async () => {
    const postDataByPath = new Map<string, PostData | null>([
      ['Social Archives/X/p1.md', makePostData('p1')],
    ]);
    const { service, api, handles } = makeService({ postDataByPath });
    api.createArchivesFromImportBatch.mockImplementation(
      async (args: BatchArgs): Promise<BatchResult> => ({
        accepted: args.items.length,
        created: [],
        skippedDuplicates: args.items.map((item) => ({
          postId: item.clientPostData.id,
          archiveId: `existing-${item.clientPostData.id}`,
        })),
        failed: [],
      }),
    );

    const result = await service.run([makeNote('Social Archives/X/p1.md')]);

    expect(result).toMatchObject({
      imported: 0,
      duplicates: 1,
      remaining: 0,
      stopReason: 'completed',
    });
    expect(api.uploadArchiveMedia).not.toHaveBeenCalled();
    const fm = handles.frontmatters.get('Social Archives/X/p1.md')!;
    expect(fm['sourceArchiveId']).toBe(`existing-${tid('p1')}`);
    expect(fm[IMPORT_MODE_FRONTMATTER_KEY]).toBe(IMPORT_MODE_IMPORTED);
  });

  it('stops submitting after PAYWALL_REQUIRED and reports stopReason quota', async () => {
    // 101 notes → two batches of 100 + 1. The first batch creates 10 items
    // and rejects the rest for quota; the second batch must never be sent.
    const total = 101;
    const postDataByPath = new Map<string, PostData | null>();
    const notes: LocalOnlyNoteRef[] = [];
    for (let i = 0; i < total; i++) {
      const path = `Social Archives/X/p${String(i).padStart(3, '0')}.md`;
      postDataByPath.set(
        path,
        makePostData(`p${String(i).padStart(3, '0')}`, {
          archivedDate: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
        }),
      );
      notes.push(makeNote(path));
    }

    const { service, api } = makeService({ postDataByPath });
    api.createArchivesFromImportBatch.mockImplementation(
      async (args: BatchArgs): Promise<BatchResult> => ({
        accepted: args.items.length,
        created: args.items.slice(0, 10).map((item) => ({
          postId: item.clientPostData.id,
          archiveId: `arch-${item.clientPostData.id}`,
        })),
        skippedDuplicates: [],
        failed: args.items.slice(10).map((item) => ({
          postId: item.clientPostData.id,
          code: 'PAYWALL_REQUIRED',
          message: 'Monthly archive quota exhausted',
        })),
      }),
    );

    const result = await service.run(notes);

    expect(api.createArchivesFromImportBatch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      imported: 10,
      duplicates: 0,
      failed: 0,
      remaining: 91,
      stopReason: 'quota',
    });
    // Finalize still runs for the part that succeeded.
    expect(api.finalizeImportJob).toHaveBeenCalledTimes(1);
  });

  it('retries a failed batch once, then stops with stopReason error', async () => {
    const postDataByPath = new Map<string, PostData | null>([
      ['Social Archives/X/p1.md', makePostData('p1')],
    ]);
    const { service, api } = makeService({ postDataByPath });
    api.createArchivesFromImportBatch.mockRejectedValue(new Error('network down'));

    const result = await service.run([makeNote('Social Archives/X/p1.md')]);

    expect(api.createArchivesFromImportBatch).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ imported: 0, remaining: 1, stopReason: 'error' });
    // Session was started, so finalize is still attempted (best-effort).
    expect(api.finalizeImportJob).toHaveBeenCalledTimes(1);
  });

  it('recovers when the batch retry succeeds', async () => {
    const postDataByPath = new Map<string, PostData | null>([
      ['Social Archives/X/p1.md', makePostData('p1')],
    ]);
    const { service, api } = makeService({ postDataByPath });
    api.createArchivesFromImportBatch.mockRejectedValueOnce(new Error('flaky'));

    const result = await service.run([makeNote('Social Archives/X/p1.md')]);

    expect(api.createArchivesFromImportBatch).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ imported: 1, stopReason: 'completed' });
  });

  it('reports stopReason error when the import session cannot be started', async () => {
    const postDataByPath = new Map<string, PostData | null>([
      ['Social Archives/X/p1.md', makePostData('p1')],
    ]);
    const { service, api, persistResult } = makeService({ postDataByPath });
    api.startImportSession.mockRejectedValue(new Error('503'));

    const result = await service.run([makeNote('Social Archives/X/p1.md')]);

    expect(api.startImportSession).toHaveBeenCalledTimes(2); // one retry
    expect(api.createArchivesFromImportBatch).not.toHaveBeenCalled();
    expect(api.finalizeImportJob).not.toHaveBeenCalled();
    expect(result).toMatchObject({ imported: 0, remaining: 1, stopReason: 'error' });
    expect(persistResult).toHaveBeenCalledWith(result);
  });

  it('skips oversized files and counts the item as partial media', async () => {
    const bigPath = 'attachments/social-archives/x/p1/huge.mp4';
    const postDataByPath = new Map<string, PostData | null>([
      ['Social Archives/X/p1.md', makePostData('p1', { media: [{ type: 'video', url: bigPath }] })],
    ]);
    const { service, api } = makeService({
      postDataByPath,
      mediaFiles: [{ path: bigPath, size: 101 * 1024 * 1024 }],
    });

    const result = await service.run([makeNote('Social Archives/X/p1.md')]);

    expect(result).toMatchObject({ imported: 1, partialMedia: 1, stopReason: 'completed' });
    expect(api.uploadArchiveMedia).not.toHaveBeenCalled();
  });

  it('counts media missing from the vault as partial media', async () => {
    const postDataByPath = new Map<string, PostData | null>([
      [
        'Social Archives/X/p1.md',
        makePostData('p1', {
          media: [{ type: 'image', url: 'attachments/social-archives/x/p1/gone.jpg' }],
        }),
      ],
    ]);
    const { service, api } = makeService({ postDataByPath }); // no vault files

    const result = await service.run([makeNote('Social Archives/X/p1.md')]);

    expect(result).toMatchObject({ imported: 1, partialMedia: 1 });
    expect(api.uploadArchiveMedia).not.toHaveBeenCalled();
    // The sentinel is still submitted so the server records partial media.
    const submitted =
      api.createArchivesFromImportBatch.mock.calls[0]![0].items[0]!.clientPostData;
    expect(submitted.media[0]!.url).toBe('localpath:01-gone.jpg');
  });

  it('keeps https media URLs untouched', async () => {
    const postDataByPath = new Map<string, PostData | null>([
      [
        'Social Archives/X/p1.md',
        makePostData('p1', { media: [{ type: 'image', url: 'https://cdn.example.com/a.jpg' }] }),
      ],
    ]);
    const { service, api } = makeService({ postDataByPath });

    const result = await service.run([makeNote('Social Archives/X/p1.md')]);

    expect(result).toMatchObject({ imported: 1, partialMedia: 0 });
    const submitted =
      api.createArchivesFromImportBatch.mock.calls[0]![0].items[0]!.clientPostData;
    expect(submitted.media[0]!.url).toBe('https://cdn.example.com/a.jpg');
  });

  it('submits items oldest archived first regardless of input order', async () => {
    const postDataByPath = new Map<string, PostData | null>([
      [
        'Social Archives/X/newest.md',
        makePostData('newest', { archivedDate: new Date('2026-03-01T00:00:00Z') }),
      ],
      [
        'Social Archives/X/oldest.md',
        makePostData('oldest', { archivedDate: new Date('2026-01-01T00:00:00Z') }),
      ],
      [
        'Social Archives/X/middle.md',
        makePostData('middle', { archivedDate: new Date('2026-02-01T00:00:00Z') }),
      ],
    ]);
    const { service, api } = makeService({ postDataByPath });

    await service.run([
      makeNote('Social Archives/X/newest.md'),
      makeNote('Social Archives/X/oldest.md'),
      makeNote('Social Archives/X/middle.md'),
    ]);

    const submittedIds = api.createArchivesFromImportBatch.mock.calls[0]![0].items.map(
      (item) => item.clientPostData.id,
    );
    expect(submittedIds).toEqual([tid('oldest'), tid('middle'), tid('newest')]);
  });

  it('counts unparseable notes as failed and continues with the rest', async () => {
    const postDataByPath = new Map<string, PostData | null>([
      ['Social Archives/X/broken.md', null],
      ['Social Archives/X/p1.md', makePostData('p1')],
    ]);
    const { service, api } = makeService({ postDataByPath });

    const result = await service.run([
      makeNote('Social Archives/X/broken.md'),
      makeNote('Social Archives/X/p1.md'),
    ]);

    expect(result).toMatchObject({
      imported: 1,
      failed: 1,
      remaining: 1, // the broken note is still local-only
      stopReason: 'completed',
    });
    expect(api.createArchivesFromImportBatch.mock.calls[0]![0].items).toHaveLength(1);
  });

  it('does nothing server-side when no note is importable', async () => {
    const postDataByPath = new Map<string, PostData | null>([
      ['Social Archives/X/broken.md', null],
    ]);
    const { service, api, persistResult } = makeService({ postDataByPath });

    const result = await service.run([makeNote('Social Archives/X/broken.md')]);

    expect(api.startImportSession).not.toHaveBeenCalled();
    expect(api.finalizeImportJob).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      imported: 0,
      failed: 1,
      remaining: 1,
      stopReason: 'completed',
    });
    expect(persistResult).toHaveBeenCalledTimes(1);
  });

  it('counts non-quota per-item failures without stopping the run', async () => {
    const postDataByPath = new Map<string, PostData | null>([
      [
        'Social Archives/X/a.md',
        makePostData('a', { archivedDate: new Date('2026-01-01T00:00:00Z') }),
      ],
      [
        'Social Archives/X/b.md',
        makePostData('b', { archivedDate: new Date('2026-02-01T00:00:00Z') }),
      ],
    ]);
    const { service, api } = makeService({ postDataByPath });
    api.createArchivesFromImportBatch.mockImplementation(
      async (args: BatchArgs): Promise<BatchResult> => ({
        accepted: args.items.length,
        created: args.items.slice(1).map((item) => ({
          postId: item.clientPostData.id,
          archiveId: `arch-${item.clientPostData.id}`,
        })),
        skippedDuplicates: [],
        failed: [
          {
            postId: args.items[0]!.clientPostData.id,
            code: 'VALIDATION_FAILED',
            message: 'bad payload',
          },
        ],
      }),
    );

    const result = await service.run([
      makeNote('Social Archives/X/a.md'),
      makeNote('Social Archives/X/b.md'),
    ]);

    expect(result).toMatchObject({
      imported: 1,
      failed: 1,
      remaining: 1,
      stopReason: 'completed',
    });
  });

  it('rejects notes with an unparseable url as failed without sinking the batch', async () => {
    const postDataByPath = new Map<string, PostData | null>([
      ['Social Archives/X/bad.md', makePostData('bad', { url: 'not a url' })],
      ['Social Archives/X/p1.md', makePostData('p1')],
    ]);
    const { service, api } = makeService({ postDataByPath });

    const result = await service.run([
      makeNote('Social Archives/X/bad.md'),
      makeNote('Social Archives/X/p1.md'),
    ]);

    expect(result).toMatchObject({ imported: 1, failed: 1, stopReason: 'completed' });
    expect(api.createArchivesFromImportBatch.mock.calls[0]![0].items).toHaveLength(1);
  });

  it('repairs an invalid metadata timestamp instead of submitting null', async () => {
    const postDataByPath = new Map<string, PostData | null>([
      [
        'Social Archives/X/p1.md',
        makePostData('p1', {
          metadata: { timestamp: new Date('invalid') } as PostData['metadata'],
        }),
      ],
    ]);
    const { service, api } = makeService({ postDataByPath });

    await service.run([makeNote('Social Archives/X/p1.md')]);

    const submitted = api.createArchivesFromImportBatch.mock.calls[0]![0].items[0]!.clientPostData;
    const timestamp = submitted.metadata.timestamp as Date;
    expect(timestamp instanceof Date && Number.isFinite(timestamp.getTime())).toBe(true);
  });

  it('sanitizes media filenames to the server upload charset', async () => {
    // The media-upload handler reduces filenames to [A-Za-z0-9._-]; the
    // sentinel must be built from the same form or it never gets patched.
    const mediaPath = 'attachments/social-archives/x/p1/사진 모음 (1).jpg';
    const postDataByPath = new Map<string, PostData | null>([
      ['Social Archives/X/p1.md', makePostData('p1', { media: [{ type: 'image', url: mediaPath }] })],
    ]);
    const { service, api } = makeService({ postDataByPath, mediaFiles: [{ path: mediaPath }] });

    await service.run([makeNote('Social Archives/X/p1.md')]);

    const submitted = api.createArchivesFromImportBatch.mock.calls[0]![0].items[0]!.clientPostData;
    const sentinel = submitted.media[0]!.url;
    expect(sentinel).toMatch(/^localpath:01-[A-Za-z0-9._-]+\.jpg$/);
    const uploadArgs = api.uploadArchiveMedia.mock.calls[0]![0];
    expect(`localpath:${uploadArgs.files[0]!.filename}`).toBe(sentinel);
  });

  it('emits progress through all phases', async () => {
    const postDataByPath = new Map<string, PostData | null>([
      [
        'Social Archives/X/p1.md',
        makePostData('p1', {
          media: [{ type: 'image', url: 'attachments/social-archives/x/p1/a.jpg' }],
        }),
      ],
    ]);
    const { service } = makeService({
      postDataByPath,
      mediaFiles: [{ path: 'attachments/social-archives/x/p1/a.jpg' }],
    });

    const phases: Array<LocalImportProgress['phase']> = [];
    await service.run([makeNote('Social Archives/X/p1.md')], (p) => phases.push(p.phase));

    expect(phases).toContain('preparing');
    expect(phases).toContain('submitting');
    expect(phases).toContain('uploading-media');
    expect(phases[phases.length - 1]).toBe('finalizing');
  });
});

describe('deriveTransportPostId', () => {
  it('extracts the platform post id from a canonical URL', () => {
    expect(deriveTransportPostId('x', 'https://x.com/u/status/1234567890')).toBe('1234567890');
  });

  it('falls back to a stable, pattern-safe URL hash when no extractor matches', () => {
    const a = deriveTransportPostId('web', 'https://example.com/article?id=1');
    const b = deriveTransportPostId('web', 'https://example.com/article?id=1');
    const c = deriveTransportPostId('web', 'https://example.com/article?id=2');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^url\.[0-9a-f]{8}$/);
  });

  it('hash-falls back for unknown platforms', () => {
    expect(deriveTransportPostId('not-a-platform', 'https://example.com/x')).toMatch(
      /^url\.[0-9a-f]{8}$/,
    );
  });
});
