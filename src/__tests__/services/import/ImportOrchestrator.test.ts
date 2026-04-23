/**
 * Unit tests for ImportOrchestrator — gallery integration (Layer-2).
 *
 * Covers PRD `prd-instagram-import-gallery.md`:
 *   - §9.6: `loadGallery(files)` returns previews + duplicate join.
 *   - §9.4 / F4.1 / F4.2: `startImport({selection})` filters seeds.
 *   - F3.6 + §9.2: terminal events drop `gallerySelection` and clear
 *                  the MediaPreviewService cache for the job.
 *
 * The tests build small in-memory ZIPs with jszip directly (the same
 * pattern as ZipPostDataAdapter.test.ts) so the orchestrator runs against
 * the real ZIP reader rather than a stub.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import JSZip from 'jszip';
import type { Vault } from 'obsidian';

import { ImportJobStore } from '@/services/import/ImportJobStore';
import { ImportOrchestrator } from '@/services/import/ImportOrchestrator';
import { ImportZipReader } from '@/services/import/ImportZipReader';
import { MediaPreviewService } from '@/services/import-gallery/MediaPreviewService';
import type {
  ImportAPIClient,
  ImportLogger,
  ImportProgressEvent,
} from '@/types/import';
import type { PostData } from '@/types/post';

// jsdom does not implement Blob.prototype.arrayBuffer (used by JSZip in
// ImportZipReader). Polyfill once for this test file.
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function (): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

// jsdom doesn't implement URL.createObjectURL / revokeObjectURL — needed
// by MediaPreviewService.acquire / clearForJob. Install minimal fakes.
let urlCounter = 0;
const urlToBlob = new Map<string, Blob>();
if (typeof URL.createObjectURL !== 'function') {
  (global.URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (
    blob: Blob,
  ) => {
    const url = `blob:test://${++urlCounter}`;
    urlToBlob.set(url, blob);
    return url;
  };
}
if (typeof URL.revokeObjectURL !== 'function') {
  (global.URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (
    url: string,
  ) => {
    urlToBlob.delete(url);
  };
}

// ---------------------------------------------------------------------------
// Fakes / helpers
// ---------------------------------------------------------------------------

function fakeVault(): Vault {
  const m = new Map<string, string>();
  return {
    adapter: {
      read: vi.fn(async (path: string) => {
        const v = m.get(path);
        if (v === undefined) throw new Error('ENOENT');
        return v;
      }),
      write: vi.fn(async (path: string, content: string) => {
        m.set(path, content);
      }),
    },
  } as unknown as Vault;
}

function makeLogger(): ImportLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeAPI(overrides: Partial<ImportAPIClient> = {}): ImportAPIClient {
  return {
    preflight: vi.fn(async () => ({ duplicates: [], accepted: 0 })),
    createArchiveFromImport: vi.fn(async ({ clientPostData }) => ({
      archiveId: `arch-${clientPostData.id}`,
      skippedDuplicate: false,
    })),
    uploadArchiveMedia: vi.fn(async () => ({ uploaded: 0, failed: [] })),
    finalizeImportJob: vi.fn(async () => {}),
    ...overrides,
  };
}

function makePost(id: string, shortcode: string): PostData {
  return {
    platform: 'instagram',
    id,
    url: `https://www.instagram.com/p/${shortcode}/`,
    author: { name: 'tester', url: 'https://x', avatar: './media/avatar.jpg' },
    content: { text: `post ${id}` },
    media: [
      { type: 'image', url: `./media/${shortcode}/00.jpg`, thumbnail: `./media/${shortcode}/00.jpg` },
    ],
    metadata: { timestamp: new Date('2026-04-01T00:00:00.000Z') },
    raw: { code: shortcode },
  } as PostData;
}

async function makePartZip(args: {
  exportId?: string;
  partNumber?: number;
  totalParts?: number;
  collectionId?: string;
  posts: Array<{ id: string; shortcode: string }>;
}): Promise<Blob> {
  const zip = new JSZip();
  const exportId = args.exportId ?? 'exp-1';
  const partNumber = args.partNumber ?? 1;
  const totalParts = args.totalParts ?? 1;
  const collection = {
    id: args.collectionId ?? 'col-1',
    name: 'Saved',
    scope: 'named' as const,
  };

  const jsonl = args.posts
    .map((p) => JSON.stringify(makePost(p.id, p.shortcode)))
    .join('\n') + '\n';
  zip.file('posts.jsonl', jsonl);

  const counts = {
    postsInPart: args.posts.length,
    postsInExport: args.posts.length,
    readyToImport: args.posts.length,
    partialMedia: 0,
    failedPosts: 0,
    mediaDownloaded: args.posts.length,
    mediaFailed: 0,
  };
  zip.file(
    'manifest.json',
    JSON.stringify({
      $schema: 'social-archiver/instagram-saved-export-v2',
      schemaVersion: 2,
      exportId,
      partNumber,
      totalParts,
      exportedAt: '2026-04-18T00:00:00.000Z',
      platform: 'instagram',
      source: 'saved-posts',
      instagramUserId: '42',
      instagramUsername: 'tester',
      collection,
      app: { name: 'chrome-ext', version: '1.0.0' },
      filters: { collectionIds: [], dateFrom: null, dateTo: null },
      counts,
      integrity: { algorithm: 'sha256', checksumsFile: '_checksums.txt' },
    }),
  );

  const checksum = await ImportZipReader.sha256Hex(new TextEncoder().encode(jsonl));
  zip.file('_checksums.txt', `${checksum}  posts.jsonl\n`);

  const buf = await zip.generateAsync({ type: 'arraybuffer' });
  return new Blob([buf], { type: 'application/zip' });
}

async function freshOrchestrator(
  apiOverrides: Partial<ImportAPIClient> = {},
  withMediaPreview = true,
): Promise<{
  orchestrator: ImportOrchestrator;
  store: ImportJobStore;
  api: ImportAPIClient;
  logger: ImportLogger;
  events: ImportProgressEvent[];
  mediaPreviewService: MediaPreviewService | undefined;
}> {
  const store = new ImportJobStore(fakeVault(), '.obsidian/plugins/test');
  await store.load();
  const api = makeAPI(apiOverrides);
  const logger = makeLogger();
  const events: ImportProgressEvent[] = [];
  const mediaPreviewService = withMediaPreview ? new MediaPreviewService() : undefined;
  const orchestrator = new ImportOrchestrator({
    jobStore: store,
    apiClient: api,
    logger,
    mediaPreviewService,
    generateId: () => 'job-test',
  });
  orchestrator.onEvent((e) => events.push(e));
  return { orchestrator, store, api, logger, events, mediaPreviewService };
}

// ---------------------------------------------------------------------------
// loadGallery
// ---------------------------------------------------------------------------

describe('ImportOrchestrator.loadGallery', () => {
  it('returns previews populated on each part', async () => {
    const { orchestrator, api } = await freshOrchestrator();
    const blob = await makePartZip({
      posts: [
        { id: '1', shortcode: 'A' },
        { id: '2', shortcode: 'B' },
        { id: '3', shortcode: 'C' },
      ],
    });

    const result = await orchestrator.loadGallery([{ name: 'p1.zip', blob }]);

    expect(result.errors).toEqual([]);
    expect(result.parts).toHaveLength(1);
    const part = result.parts[0]!;
    expect(part.posts).toBeDefined();
    expect(part.posts!).toHaveLength(3);
    expect(part.posts!.map((p) => p.postId)).toEqual(['1', '2', '3']);
    expect(part.posts!.every((p) => p.isDuplicate === false)).toBe(true);
    expect(part.counts.readyToImport).toBe(3);

    // Server preflight was called once with the harvested ids.
    expect(api.preflight).toHaveBeenCalledTimes(1);
    const calledWith = (api.preflight as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(calledWith.map((c: { postId: string }) => c.postId)).toEqual(['1', '2', '3']);
  });

  it('joins server-reported duplicates into the previews', async () => {
    const api = makeAPI({
      preflight: vi.fn(async () => ({ duplicates: ['2'], accepted: 2 })),
    });
    const store = new ImportJobStore(fakeVault(), '.obsidian/plugins/test');
    await store.load();
    const orchestrator = new ImportOrchestrator({
      jobStore: store,
      apiClient: api,
      logger: makeLogger(),
    });

    const blob = await makePartZip({
      posts: [
        { id: '1', shortcode: 'A' },
        { id: '2', shortcode: 'B' },
        { id: '3', shortcode: 'C' },
      ],
    });

    const result = await orchestrator.loadGallery([{ name: 'p1.zip', blob }]);

    expect(result.duplicateCount).toBe(1);
    expect(Array.from(result.duplicatePostIds)).toEqual(['2']);
    const byId = new Map(result.parts[0]!.posts!.map((p) => [p.postId, p]));
    expect(byId.get('1')!.isDuplicate).toBe(false);
    expect(byId.get('2')!.isDuplicate).toBe(true);
    expect(byId.get('3')!.isDuplicate).toBe(false);
  });

  it('aggregates previews across multiple parts', async () => {
    const { orchestrator } = await freshOrchestrator();
    const part1 = await makePartZip({
      exportId: 'exp-X',
      partNumber: 1,
      totalParts: 2,
      posts: [
        { id: '1', shortcode: 'a' },
        { id: '2', shortcode: 'b' },
      ],
    });
    const part2 = await makePartZip({
      exportId: 'exp-X',
      partNumber: 2,
      totalParts: 2,
      posts: [{ id: '3', shortcode: 'c' }],
    });

    const result = await orchestrator.loadGallery([
      { name: 'p1.zip', blob: part1 },
      { name: 'p2.zip', blob: part2 },
    ]);

    expect(result.parts).toHaveLength(2);
    expect(result.parts[0]!.posts).toHaveLength(2);
    expect(result.parts[1]!.posts).toHaveLength(1);
    expect(result.totalPostsInSelection).toBe(3);
    expect(result.readyToImport).toBe(3);
  });

  it('fails open on preflight network error — every preview stays non-duplicate', async () => {
    const api = makeAPI({
      preflight: vi.fn(async () => {
        throw new Error('network down');
      }),
    });
    const store = new ImportJobStore(fakeVault(), '.obsidian/plugins/test');
    await store.load();
    const logger = makeLogger();
    const orchestrator = new ImportOrchestrator({
      jobStore: store,
      apiClient: api,
      logger,
    });

    const blob = await makePartZip({
      posts: [{ id: '1', shortcode: 'A' }],
    });
    const result = await orchestrator.loadGallery([{ name: 'p.zip', blob }]);

    expect(result.parts[0]!.posts![0]!.isDuplicate).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// startImport({ selection })
// ---------------------------------------------------------------------------

describe('ImportOrchestrator.startImport({ selection })', () => {
  it("'all-except' filters out the deselected ids", async () => {
    // Use a non-resolving createArchiveFromImport so the worker hangs after
    // dispatching the first item — we only want to inspect the seeded items.
    const api = makeAPI({
      createArchiveFromImport: vi.fn(
        () => new Promise(() => {}) as Promise<{ archiveId: string; skippedDuplicate: boolean }>,
      ),
    });
    const store = new ImportJobStore(fakeVault(), '.obsidian/plugins/test');
    await store.load();
    const orchestrator = new ImportOrchestrator({
      jobStore: store,
      apiClient: api,
      logger: makeLogger(),
      generateId: () => 'job-sel-1',
    });

    const blob = await makePartZip({
      posts: [
        { id: '1', shortcode: 'A' },
        { id: '2', shortcode: 'B' },
        { id: '3', shortcode: 'C' },
        { id: '4', shortcode: 'D' },
      ],
    });

    const { jobId } = await orchestrator.startImport({
      files: [{ name: 'p.zip', blob }],
      selection: { mode: 'all-except', ids: new Set(['2', '4']) },
    });

    const items = store.getItems(jobId);
    expect(items.map((i) => i.postId).sort()).toEqual(['1', '3']);
    const job = store.getJob(jobId)!;
    expect(job.totalItems).toBe(2);
    expect(job.gallerySelection?.mode).toBe('all-except');
    expect(Array.from(job.gallerySelection!.ids).sort()).toEqual(['2', '4']);

    await orchestrator.cancel(jobId);
  });

  it("'only' keeps just the selected ids", async () => {
    const api = makeAPI({
      createArchiveFromImport: vi.fn(
        () => new Promise(() => {}) as Promise<{ archiveId: string; skippedDuplicate: boolean }>,
      ),
    });
    const store = new ImportJobStore(fakeVault(), '.obsidian/plugins/test');
    await store.load();
    const orchestrator = new ImportOrchestrator({
      jobStore: store,
      apiClient: api,
      logger: makeLogger(),
      generateId: () => 'job-sel-2',
    });

    const blob = await makePartZip({
      posts: [
        { id: '1', shortcode: 'A' },
        { id: '2', shortcode: 'B' },
        { id: '3', shortcode: 'C' },
        { id: '4', shortcode: 'D' },
      ],
    });

    const { jobId } = await orchestrator.startImport({
      files: [{ name: 'p.zip', blob }],
      selection: { mode: 'only', ids: new Set(['2', '3']) },
    });

    const items = store.getItems(jobId);
    expect(items.map((i) => i.postId).sort()).toEqual(['2', '3']);
    expect(store.getJob(jobId)!.totalItems).toBe(2);

    await orchestrator.cancel(jobId);
  });

  it('without selection — every seeded item runs (legacy `Skip review` path)', async () => {
    const api = makeAPI({
      createArchiveFromImport: vi.fn(
        () => new Promise(() => {}) as Promise<{ archiveId: string; skippedDuplicate: boolean }>,
      ),
    });
    const store = new ImportJobStore(fakeVault(), '.obsidian/plugins/test');
    await store.load();
    const orchestrator = new ImportOrchestrator({
      jobStore: store,
      apiClient: api,
      logger: makeLogger(),
      generateId: () => 'job-skip',
    });

    const blob = await makePartZip({
      posts: [
        { id: '1', shortcode: 'A' },
        { id: '2', shortcode: 'B' },
      ],
    });

    const { jobId } = await orchestrator.startImport({
      files: [{ name: 'p.zip', blob }],
    });
    expect(store.getItems(jobId)).toHaveLength(2);
    expect(store.getJob(jobId)!.gallerySelection).toBeUndefined();

    await orchestrator.cancel(jobId);
  });

  it('selection ids set is defensively copied — caller mutation does not leak in', async () => {
    const api = makeAPI({
      createArchiveFromImport: vi.fn(
        () => new Promise(() => {}) as Promise<{ archiveId: string; skippedDuplicate: boolean }>,
      ),
    });
    const store = new ImportJobStore(fakeVault(), '.obsidian/plugins/test');
    await store.load();
    const orchestrator = new ImportOrchestrator({
      jobStore: store,
      apiClient: api,
      logger: makeLogger(),
      generateId: () => 'job-clone',
    });

    const blob = await makePartZip({
      posts: [
        { id: '1', shortcode: 'A' },
        { id: '2', shortcode: 'B' },
      ],
    });

    const callerSet = new Set(['1']);
    const { jobId } = await orchestrator.startImport({
      files: [{ name: 'p.zip', blob }],
      selection: { mode: 'all-except', ids: callerSet },
    });

    // Mutate the caller-owned set after handing it off.
    callerSet.add('2');

    const job = store.getJob(jobId)!;
    expect(Array.from(job.gallerySelection!.ids).sort()).toEqual(['1']);

    await orchestrator.cancel(jobId);
  });
});

// ---------------------------------------------------------------------------
// Terminal cleanup (PRD F3.6 + §9.2)
// ---------------------------------------------------------------------------

describe('ImportOrchestrator terminal cleanup', () => {
  it('drops gallerySelection + clears MediaPreviewService on job.completed', async () => {
    const { orchestrator, store, mediaPreviewService } = await freshOrchestrator();
    const blob = await makePartZip({ posts: [{ id: '1', shortcode: 'A' }] });
    const { jobId } = await orchestrator.startImport({
      files: [{ name: 'p.zip', blob }],
      selection: { mode: 'only', ids: new Set(['1']) },
    });

    // The job persisted the selection at creation time.
    expect(store.getJob(jobId)!.gallerySelection?.mode).toBe('only');

    // Pin a media preview entry for this job so we can assert it is cleared
    // when the terminal event fires.
    await mediaPreviewService!.acquire(
      jobId,
      'p.zip',
      'media/A/00.jpg',
      new Blob([new Uint8Array([1, 2, 3, 4])]),
    );
    expect(mediaPreviewService!.getStats().size).toBe(1);

    // Wait for the worker to drain. The default makeAPI() returns
    // immediately, so the single item completes quickly.
    await new Promise<void>((resolve) => {
      const off = orchestrator.onEvent((e) => {
        if (e.type === 'job.completed' && e.jobId === jobId) {
          off();
          resolve();
        }
      });
    });

    // Both side effects observed.
    expect(store.getJob(jobId)?.gallerySelection).toBeUndefined();
    expect(mediaPreviewService!.getStats().size).toBe(0);
  });

  it('drops gallerySelection on job.cancelled', async () => {
    const api = makeAPI({
      // Block forever so we can cancel mid-flight.
      createArchiveFromImport: vi.fn(
        () => new Promise(() => {}) as Promise<{ archiveId: string; skippedDuplicate: boolean }>,
      ),
    });
    const store = new ImportJobStore(fakeVault(), '.obsidian/plugins/test');
    await store.load();
    const orchestrator = new ImportOrchestrator({
      jobStore: store,
      apiClient: api,
      logger: makeLogger(),
      mediaPreviewService: new MediaPreviewService(),
      generateId: () => 'job-cancel',
    });

    const blob = await makePartZip({ posts: [{ id: '1', shortcode: 'A' }] });
    const { jobId } = await orchestrator.startImport({
      files: [{ name: 'p.zip', blob }],
      selection: { mode: 'all-except', ids: new Set() },
    });
    expect(store.getJob(jobId)!.gallerySelection).toBeDefined();

    await orchestrator.cancel(jobId);

    // Wait one microtask for the bus subscription to run.
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getJob(jobId)?.gallerySelection).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MediaPreviewService accessor
// ---------------------------------------------------------------------------

describe('ImportOrchestrator.getMediaPreviewService', () => {
  it('returns the wired instance', async () => {
    const { orchestrator, mediaPreviewService } = await freshOrchestrator();
    expect(orchestrator.getMediaPreviewService()).toBe(mediaPreviewService);
  });

  it('returns undefined when none was wired', async () => {
    const { orchestrator } = await freshOrchestrator({}, false);
    expect(orchestrator.getMediaPreviewService()).toBeUndefined();
  });
});
