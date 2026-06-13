import { describe, it, expect, vi } from 'vitest';
import { ClipBatchInbox, type ClipInboxAdapter } from '@/services/clip/ClipBatchInbox';
import { ClipBatchService } from '@/services/clip/ClipBatchService';
import { ClipPayloadCodec } from '@/services/clip/ClipPayloadCodec';
import { ClipBatchError } from '@/types/clip-batch';
import type { ClipBatchReceiptV1 } from '@/types/clip-batch';
import type { ArchiveOrchestrator } from '@/services/ArchiveOrchestrator';
import type { ArchiveLookupService } from '@/services/ArchiveLookupService';
import { TFile } from 'obsidian';

const MEDIA_PATH = 'attachments/social-archives';
const INBOX = `${MEDIA_PATH}/clips/.inbox`;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * In-memory DataAdapter stand-in. Inbox files are written externally by the
 * extension, so the production code talks to the adapter directly — the fake
 * mirrors the list/read/remove/rmdir surface ClipBatchInbox relies on.
 */
class FakeVaultAdapter implements ClipInboxAdapter {
  private files = new Map<string, string>();
  private folders = new Set<string>();
  private mtimes = new Map<string, number>();

  writeSync(path: string, content: string, mtime: number = Date.now()): void {
    this.files.set(path, content);
    this.mtimes.set(path, mtime);
    this.ensureParents(path);
  }

  mkdirSync(path: string, mtime: number = Date.now()): void {
    this.folders.add(path);
    this.mtimes.set(path, mtime);
    this.ensureParents(path);
  }

  setMtime(path: string, mtime: number): void {
    this.mtimes.set(path, mtime);
  }

  hasFile(path: string): boolean {
    return this.files.has(path);
  }

  hasFolder(path: string): boolean {
    return this.folders.has(path);
  }

  fileContent(path: string): string | undefined {
    return this.files.get(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async stat(path: string): Promise<{
    type: 'file' | 'folder';
    ctime: number;
    mtime: number;
    size: number;
  } | null> {
    const mtime = this.mtimes.get(path) ?? 0;
    if (this.files.has(path)) {
      return { type: 'file', ctime: mtime, mtime, size: (this.files.get(path) ?? '').length };
    }
    if (this.folders.has(path)) {
      return { type: 'folder', ctime: mtime, mtime, size: 0 };
    }
    return null;
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    if (!this.folders.has(path)) {
      throw new Error(`ENOENT: ${path}`);
    }
    const parentOf = (p: string): string => p.split('/').slice(0, -1).join('/');
    return {
      files: [...this.files.keys()].filter((p) => parentOf(p) === path).sort(),
      folders: [...this.folders].filter((p) => parentOf(p) === path).sort(),
    };
  }

  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`ENOENT: ${path}`);
    }
    return content;
  }

  async write(path: string, data: string): Promise<void> {
    this.writeSync(path, data);
  }

  async remove(path: string): Promise<void> {
    if (!this.files.delete(path)) {
      throw new Error(`ENOENT: ${path}`);
    }
    this.mtimes.delete(path);
  }

  async rmdir(path: string, _recursive: boolean): Promise<void> {
    if (!this.folders.has(path)) {
      throw new Error(`ENOENT: ${path}`);
    }
    const prefix = `${path}/`;
    for (const file of [...this.files.keys()]) {
      if (file.startsWith(prefix)) this.files.delete(file);
    }
    for (const folder of [...this.folders]) {
      if (folder === path || folder.startsWith(prefix)) this.folders.delete(folder);
    }
  }

  private ensureParents(path: string): void {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      this.folders.add(parts.slice(0, i).join('/'));
    }
  }
}

/** Uncompressed ClipEnvelopeV1 JSON as the extension batch writer emits it. */
function makeEnvelope(
  id: string,
  envelopeOverrides: Record<string, unknown> = {},
  postDataOverrides: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    v: 1,
    source: 'chrome-extension',
    sourceVersion: '1.7.0',
    clippedAt: '2026-06-10T09:00:00.000Z',
    postData: {
      platform: 'reddit',
      id,
      url: `https://www.reddit.com/r/demo/comments/${id}/post/`,
      author: { name: 'Demo User', url: 'https://www.reddit.com/user/demo/' },
      content: { text: `Post ${id}` },
      media: [],
      metadata: { timestamp: '2026-06-01T12:00:00.000Z' },
      ...postDataOverrides,
    },
    ...envelopeOverrides,
  });
}

function makeManifest(
  batchId: string,
  postCount: number,
  overrides: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    v: 1,
    batchId,
    source: 'reddit-saved-import',
    senderVersion: '1.7.0',
    createdAt: '2026-06-12T00:00:00.000Z',
    postCount,
    ...overrides,
  });
}

function seedBatch(
  adapter: FakeVaultAdapter,
  batchId: string,
  posts: Array<{ name: string; content: string }>,
  opts: { committed?: boolean; manifest?: string } = {}
): void {
  const dir = `${INBOX}/${batchId}`;
  adapter.mkdirSync(dir);
  adapter.mkdirSync(`${dir}/posts`);
  for (const post of posts) {
    adapter.writeSync(`${dir}/posts/${post.name}`, post.content);
  }
  if (opts.committed !== false) {
    adapter.writeSync(`${dir}/batch.json`, opts.manifest ?? makeManifest(batchId, posts.length));
  }
}

interface Harness {
  service: ClipBatchService;
  inbox: ClipBatchInbox;
  orchestrate: ReturnType<typeof vi.fn>;
  findByOriginalUrl: ReturnType<typeof vi.fn>;
  getClientPostIdSet: ReturnType<typeof vi.fn>;
  indexSavedFile: ReturnType<typeof vi.fn>;
  getVaultFileByPath: ReturnType<typeof vi.fn>;
}

function makeHarness(
  adapter: FakeVaultAdapter,
  overrides: {
    orchestrator?: ArchiveOrchestrator | undefined;
    lookup?: ArchiveLookupService | undefined;
  } = {}
): Harness {
  const orchestrate = vi.fn().mockResolvedValue({
    success: true,
    filePath: 'Social Archives/Reddit/2026/06/note.md',
    creditsUsed: 0,
  });
  const findByOriginalUrl = vi.fn().mockReturnValue([]);
  const getClientPostIdSet = vi.fn().mockReturnValue(new Set<string>());
  const indexSavedFile = vi.fn();
  const getVaultFileByPath = vi.fn((path: string): TFile | null => new TFile(path));

  const orchestrator =
    'orchestrator' in overrides
      ? overrides.orchestrator
      : ({ orchestrateFromPostData: orchestrate } as unknown as ArchiveOrchestrator);
  const lookup =
    'lookup' in overrides
      ? overrides.lookup
      : ({
          findByOriginalUrl,
          getClientPostIdSet,
          indexSavedFile,
        } as unknown as ArchiveLookupService);

  const inbox = new ClipBatchInbox({ adapter, getMediaPath: (): string => MEDIA_PATH });
  const service = new ClipBatchService({
    inbox,
    codec: new ClipPayloadCodec(),
    getOrchestrator: (): ArchiveOrchestrator | undefined => orchestrator,
    getArchiveLookup: (): ArchiveLookupService | undefined => lookup,
    getVaultFileByPath: (path: string): TFile | null => getVaultFileByPath(path),
  });

  return {
    service,
    inbox,
    orchestrate,
    findByOriginalUrl,
    getClientPostIdSet,
    indexSavedFile,
    getVaultFileByPath,
  };
}

async function expectClipBatchError(
  promise: Promise<unknown>,
  reason: ClipBatchError['reason']
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ClipBatchError);
    expect((error as ClipBatchError).reason).toBe(reason);
    return;
  }
  throw new Error('Expected ClipBatchError to be thrown');
}

describe('ClipBatchService', () => {
  describe('processBatch — happy drain', () => {
    it('imports every post in filename order, deletes post files, and removes posts/', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-1', [
        { name: '0002-bbb.json', content: makeEnvelope('bbb') },
        { name: '0001-aaa.json', content: makeEnvelope('aaa') },
        { name: '0003-ccc.json', content: makeEnvelope('ccc') },
      ]);
      const { service, orchestrate } = makeHarness(adapter);

      const receipt = await service.processBatch('rsi-1');

      expect(receipt).toMatchObject({ v: 1, batchId: 'rsi-1', imported: 3, duplicates: 0, failed: [] });
      expect(orchestrate).toHaveBeenCalledTimes(3);
      // Filename (seq) order, not seed order
      const ids = orchestrate.mock.calls.map((call) => call[0].id);
      expect(ids).toEqual(['aaa', 'bbb', 'ccc']);
      // Drained: posts/ removed, batch.json + result.json kept (locked Q2)
      expect(adapter.hasFolder(`${INBOX}/rsi-1/posts`)).toBe(false);
      expect(adapter.hasFile(`${INBOX}/rsi-1/batch.json`)).toBe(true);
      expect(adapter.hasFile(`${INBOX}/rsi-1/result.json`)).toBe(true);
    });

    it('writes a parseable receipt with an ISO finishedAt', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-receipt', [{ name: '0001-a.json', content: makeEnvelope('a') }]);
      const { service } = makeHarness(adapter);

      await service.processBatch('rsi-receipt');

      const receipt = JSON.parse(
        adapter.fileContent(`${INBOX}/rsi-receipt/result.json`) ?? ''
      ) as ClipBatchReceiptV1;
      expect(receipt.v).toBe(1);
      expect(receipt.batchId).toBe('rsi-receipt');
      expect(receipt.imported).toBe(1);
      expect(Number.isNaN(new Date(receipt.finishedAt).getTime())).toBe(false);
    });

    it('reports progress once up front and again after each post file', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-progress', [
        { name: '0001-a.json', content: makeEnvelope('a') },
        { name: '0002-b.json', content: makeEnvelope('b') },
      ]);
      const { service } = makeHarness(adapter);
      const onProgress = vi.fn();

      await service.processBatch('rsi-progress', { onProgress });

      expect(onProgress).toHaveBeenCalledTimes(3);
      // Initial 0/N emit before the first post — lets the UI distinguish a
      // slow/stalled first post from a run that never started.
      expect(onProgress.mock.calls[0]?.[0]).toMatchObject({
        batchId: 'rsi-progress',
        processed: 0,
        total: 2,
        imported: 0,
      });
      expect(onProgress.mock.calls[1]?.[0]).toMatchObject({
        batchId: 'rsi-progress',
        processed: 1,
        total: 2,
        imported: 1,
      });
      expect(onProgress.mock.calls[2]?.[0]).toMatchObject({ processed: 2, total: 2, imported: 2 });
    });

    it('marks batch provenance with the manifest source (not browser-clip:*)', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-prov', [
        {
          name: '0001-a.json',
          content: makeEnvelope('a', {}, { sourceArchiveId: 'should-be-removed' }),
        },
      ]);
      const { service, orchestrate } = makeHarness(adapter);

      await service.processBatch('rsi-prov');

      const postData = orchestrate.mock.calls[0]?.[0];
      expect(postData.metadata.socialArchiverImportMode).toBe('local-only');
      expect(postData.metadata.socialArchiverImportSource).toBe('reddit-saved-import');
      expect(postData.metadata.socialArchiverServerArchiveId).toBe('none');
      expect(postData.sourceArchiveId).toBeUndefined();
      // archivedDate from envelope clippedAt
      expect(postData.archivedDate?.toISOString()).toBe('2026-06-10T09:00:00.000Z');
    });

    it('passes background-safe, credit-free options and honors per-post mediaDelivery', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-media', [
        { name: '0001-remote.json', content: makeEnvelope('remote') },
        { name: '0002-local.json', content: makeEnvelope('local', { mediaDelivery: 'local' }) },
      ]);
      const { service, orchestrate } = makeHarness(adapter);

      await service.processBatch('rsi-media');

      expect(orchestrate.mock.calls[0]?.[1]).toMatchObject({
        enableAI: false,
        deepResearch: false,
        generateShareLink: false,
        removeTracking: true,
        downloadMedia: true,
        // Locked Q5: quoted media stays remote in local mode.
        skipQuotedMediaDownload: true,
        isForeground: false,
      });
      expect(orchestrate.mock.calls[1]?.[1]).toMatchObject({
        downloadMedia: false,
        skipQuotedMediaDownload: true,
      });
    });

    it('registers each imported note in the lookup index for same-run dedup', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-index', [{ name: '0001-a.json', content: makeEnvelope('a') }]);
      const { service, indexSavedFile, getVaultFileByPath } = makeHarness(adapter);

      await service.processBatch('rsi-index');

      expect(getVaultFileByPath).toHaveBeenCalledWith('Social Archives/Reddit/2026/06/note.md');
      expect(indexSavedFile).toHaveBeenCalledTimes(1);
      const [file, identity] = indexSavedFile.mock.calls[0] as [TFile, Record<string, unknown>];
      expect(file.path).toBe('Social Archives/Reddit/2026/06/note.md');
      expect(identity).toEqual({
        originalUrl: 'https://www.reddit.com/r/demo/comments/a/post/',
      });
    });

    it('does not index notes for failed or duplicate posts', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-noindex', [
        { name: '0001-dup.json', content: makeEnvelope('dup') },
        { name: '0002-bad.json', content: makeEnvelope('bad') },
      ]);
      const { service, orchestrate, findByOriginalUrl, indexSavedFile } = makeHarness(adapter);
      findByOriginalUrl.mockImplementation((url: string) =>
        url.includes('/dup/') ? [new TFile('Social Archives/existing.md')] : []
      );
      orchestrate.mockResolvedValue({ success: false, error: 'boom', creditsUsed: 0 });

      await service.processBatch('rsi-noindex');

      expect(indexSavedFile).not.toHaveBeenCalled();
    });
  });

  describe('dedup', () => {
    it('skips URL duplicates, deletes their post files, and never calls the orchestrator', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-dup', [
        { name: '0001-dup.json', content: makeEnvelope('dup') },
        { name: '0002-new.json', content: makeEnvelope('new') },
      ]);
      const { service, orchestrate, findByOriginalUrl } = makeHarness(adapter);
      findByOriginalUrl.mockImplementation((url: string) =>
        url.includes('/dup/') ? [new TFile('Social Archives/existing.md')] : []
      );

      const receipt = await service.processBatch('rsi-dup');

      expect(receipt.imported).toBe(1);
      expect(receipt.duplicates).toBe(1);
      expect(orchestrate).toHaveBeenCalledTimes(1);
      expect(orchestrate.mock.calls[0]?.[0].id).toBe('new');
      // Duplicate file is deleted too — re-runs stay idempotent
      expect(adapter.hasFile(`${INBOX}/rsi-dup/posts/0001-dup.json`)).toBe(false);
      expect(adapter.hasFolder(`${INBOX}/rsi-dup/posts`)).toBe(false);
    });

    it('falls back to the clientPostId snapshot when the URL lookup misses', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-cpid', [{ name: '0001-a.json', content: makeEnvelope('a') }]);
      const { service, orchestrate, getClientPostIdSet } = makeHarness(adapter);
      getClientPostIdSet.mockReturnValue(new Set(['a']));

      const receipt = await service.processBatch('rsi-cpid');

      expect(getClientPostIdSet).toHaveBeenCalledTimes(1);
      expect(receipt.duplicates).toBe(1);
      expect(orchestrate).not.toHaveBeenCalled();
    });

    it('snapshots the clientPostId set ONCE per run, not per post (O(vault) memoization)', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-memo', [
        { name: '0001-a.json', content: makeEnvelope('a') },
        { name: '0002-b.json', content: makeEnvelope('b') },
        { name: '0003-c.json', content: makeEnvelope('c') },
      ]);
      const { service, orchestrate, getClientPostIdSet } = makeHarness(adapter);
      getClientPostIdSet.mockReturnValue(new Set(['b']));

      const receipt = await service.processBatch('rsi-memo');

      // One vault scan serves all three posts (built lazily on the first
      // post that survives the URL lookup, reused for the rest).
      expect(getClientPostIdSet).toHaveBeenCalledTimes(1);
      expect(receipt.imported).toBe(2);
      expect(receipt.duplicates).toBe(1);
      expect(orchestrate.mock.calls.map((call) => call[0].id)).toEqual(['a', 'c']);
    });

    it('never builds the clientPostId snapshot when every post is a URL duplicate', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-lazy', [
        { name: '0001-a.json', content: makeEnvelope('a') },
        { name: '0002-b.json', content: makeEnvelope('b') },
      ]);
      const { service, getClientPostIdSet, findByOriginalUrl } = makeHarness(adapter);
      findByOriginalUrl.mockReturnValue([new TFile('Social Archives/existing.md')]);

      const receipt = await service.processBatch('rsi-lazy');

      expect(receipt.duplicates).toBe(2);
      expect(getClientPostIdSet).not.toHaveBeenCalled();
    });

    it('fails open (imports) when the lookup service is unavailable', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-nolookup', [{ name: '0001-a.json', content: makeEnvelope('a') }]);
      const { service } = makeHarness(adapter, { lookup: undefined });

      const receipt = await service.processBatch('rsi-nolookup');

      expect(receipt.imported).toBe(1);
    });
  });

  describe('per-post failure isolation', () => {
    it('records bad JSON as a failure, keeps the file, and continues with the rest', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-badjson', [
        { name: '0001-bad.json', content: '{not json' },
        { name: '0002-good.json', content: makeEnvelope('good') },
      ]);
      const { service, orchestrate } = makeHarness(adapter);

      const receipt = await service.processBatch('rsi-badjson');

      expect(receipt.imported).toBe(1);
      expect(receipt.failed).toHaveLength(1);
      expect(receipt.failed[0]?.file).toBe(`${INBOX}/rsi-badjson/posts/0001-bad.json`);
      expect(orchestrate).toHaveBeenCalledTimes(1);
      // Failed file kept for retry; posts/ dir kept because failures remain
      expect(adapter.hasFile(`${INBOX}/rsi-badjson/posts/0001-bad.json`)).toBe(true);
      expect(adapter.hasFolder(`${INBOX}/rsi-badjson/posts`)).toBe(true);
    });

    it('records an invalid envelope (missing postData) as a failure', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-badenv', [
        { name: '0001-bad.json', content: JSON.stringify({ v: 1, source: 'chrome-extension' }) },
      ]);
      const { service, orchestrate } = makeHarness(adapter);

      const receipt = await service.processBatch('rsi-badenv');

      expect(receipt.failed).toHaveLength(1);
      expect(orchestrate).not.toHaveBeenCalled();
      expect(adapter.hasFile(`${INBOX}/rsi-badenv/posts/0001-bad.json`)).toBe(true);
    });

    it('isolates orchestrator throws to the failing post', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-throw', [
        { name: '0001-boom.json', content: makeEnvelope('boom') },
        { name: '0002-ok.json', content: makeEnvelope('ok') },
      ]);
      const { service, orchestrate } = makeHarness(adapter);
      orchestrate.mockImplementation((postData: { id: string }) => {
        if (postData.id === 'boom') return Promise.reject(new Error('pipeline exploded'));
        return Promise.resolve({ success: true, filePath: 'note.md', creditsUsed: 0 });
      });

      const receipt = await service.processBatch('rsi-throw');

      expect(receipt.imported).toBe(1);
      expect(receipt.failed).toHaveLength(1);
      expect(receipt.failed[0]?.error).toContain('pipeline exploded');
      expect(adapter.hasFile(`${INBOX}/rsi-throw/posts/0001-boom.json`)).toBe(true);
      expect(adapter.hasFile(`${INBOX}/rsi-throw/posts/0002-ok.json`)).toBe(false);
    });

    it('records orchestrator soft failures (success: false) with their error message', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-soft', [{ name: '0001-a.json', content: makeEnvelope('a') }]);
      const { service, orchestrate } = makeHarness(adapter);
      orchestrate.mockResolvedValue({ success: false, error: 'Disk full', creditsUsed: 0 });

      const receipt = await service.processBatch('rsi-soft');

      expect(receipt.failed).toEqual([
        { file: `${INBOX}/rsi-soft/posts/0001-a.json`, error: 'Disk full' },
      ]);
    });
  });

  describe('idempotent re-run', () => {
    it('retries only the remaining (failed) files on a second run', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-rerun', [
        { name: '0001-flaky.json', content: makeEnvelope('flaky') },
        { name: '0002-ok.json', content: makeEnvelope('ok') },
      ]);
      const { service, orchestrate } = makeHarness(adapter);
      orchestrate.mockImplementationOnce(() => Promise.reject(new Error('transient')));

      const first = await service.processBatch('rsi-rerun');
      expect(first.imported).toBe(1);
      expect(first.failed).toHaveLength(1);

      orchestrate.mockClear();
      const second = await service.processBatch('rsi-rerun');

      expect(orchestrate).toHaveBeenCalledTimes(1);
      expect(orchestrate.mock.calls[0]?.[0].id).toBe('flaky');
      expect(second).toMatchObject({ imported: 1, duplicates: 0, failed: [] });
      expect(adapter.hasFolder(`${INBOX}/rsi-rerun/posts`)).toBe(false);
    });

    it('returns the existing receipt for a fully drained batch without reprocessing', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-done', [{ name: '0001-a.json', content: makeEnvelope('a') }]);
      const { service, orchestrate } = makeHarness(adapter);

      const first = await service.processBatch('rsi-done');
      orchestrate.mockClear();

      const second = await service.processBatch('rsi-done');

      expect(orchestrate).not.toHaveBeenCalled();
      expect(second).toEqual(first);
    });
  });

  describe('batch-level guards', () => {
    it('throws batch_not_found for a half-written batch (no batch.json)', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-half', [{ name: '0001-a.json', content: makeEnvelope('a') }], {
        committed: false,
      });
      const { service, orchestrate } = makeHarness(adapter);

      await expectClipBatchError(service.processBatch('rsi-half'), 'batch_not_found');
      expect(orchestrate).not.toHaveBeenCalled();
      expect(adapter.hasFile(`${INBOX}/rsi-half/posts/0001-a.json`)).toBe(true);
    });

    it('refuses manifests over the 1000-post cap', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-huge', [{ name: '0001-a.json', content: makeEnvelope('a') }], {
        manifest: makeManifest('rsi-huge', 1001),
      });
      const { service, orchestrate } = makeHarness(adapter);

      await expectClipBatchError(service.processBatch('rsi-huge'), 'too_many_posts');
      expect(orchestrate).not.toHaveBeenCalled();
    });

    it('throws invalid_manifest for unparseable or malformed manifests', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-badman', [{ name: '0001-a.json', content: makeEnvelope('a') }], {
        manifest: '{broken',
      });
      seedBatch(adapter, 'rsi-noversion', [], {
        manifest: makeManifest('rsi-noversion', 0, { v: 99 }),
      });
      const { service } = makeHarness(adapter);

      await expectClipBatchError(service.processBatch('rsi-badman'), 'invalid_manifest');
      await expectClipBatchError(service.processBatch('rsi-noversion'), 'invalid_manifest');
    });

    it('rejects traversal-shaped batch ids before any filesystem access', async () => {
      const adapter = new FakeVaultAdapter();
      const { service } = makeHarness(adapter);

      await expectClipBatchError(service.processBatch('../../evil'), 'invalid_batch_id');
      await expectClipBatchError(service.processBatch('a/b'), 'invalid_batch_id');
      await expectClipBatchError(service.processBatch(''), 'invalid_batch_id');
      await expectClipBatchError(service.processBatch('x'.repeat(129)), 'invalid_batch_id');
    });

    it('throws (and leaves files untouched) when the orchestrator is not yet available', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-init', [{ name: '0001-a.json', content: makeEnvelope('a') }]);
      const { service } = makeHarness(adapter, { orchestrator: undefined });

      await expect(service.processBatch('rsi-init')).rejects.toThrow(/still initializing/);
      expect(adapter.hasFile(`${INBOX}/rsi-init/posts/0001-a.json`)).toBe(true);
    });
  });

  describe('sweepInbox', () => {
    it('processes committed pending batches and skips uncommitted and completed ones', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'batch-pending', [{ name: '0001-a.json', content: makeEnvelope('a') }]);
      seedBatch(adapter, 'batch-half', [{ name: '0001-b.json', content: makeEnvelope('b') }], {
        committed: false,
      });
      seedBatch(adapter, 'batch-done', []);
      adapter.writeSync(
        `${INBOX}/batch-done/result.json`,
        JSON.stringify({ v: 1, batchId: 'batch-done', imported: 5, duplicates: 0, failed: [], finishedAt: '2026-06-11T00:00:00.000Z' })
      );
      const { service, orchestrate } = makeHarness(adapter);

      const result = await service.sweepInbox();

      expect(result.receipts).toHaveLength(1);
      expect(result.receipts[0]?.batchId).toBe('batch-pending');
      expect(orchestrate).toHaveBeenCalledTimes(1);
      // Half-written batch untouched — its commit marker may still arrive
      expect(adapter.hasFile(`${INBOX}/batch-half/posts/0001-b.json`)).toBe(true);
    });

    it('retries failed post files of a receipted batch on the next sweep (PRD §5.1 retry contract)', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-retry', [
        { name: '0001-flaky.json', content: makeEnvelope('flaky') },
        { name: '0002-ok.json', content: makeEnvelope('ok') },
      ]);
      const { service, orchestrate } = makeHarness(adapter);
      orchestrate.mockImplementationOnce(() => Promise.reject(new Error('transient')));

      // First run: one failure → file kept, receipt written.
      const first = await service.processBatch('rsi-retry');
      expect(first.failed).toHaveLength(1);
      expect(adapter.hasFile(`${INBOX}/rsi-retry/posts/0001-flaky.json`)).toBe(true);

      // A later sweep (startup / 'Scan clip inbox') retries the kept file —
      // a receipt must not strand failed posts forever.
      orchestrate.mockClear();
      const sweep = await service.sweepInbox();

      expect(sweep.receipts).toHaveLength(1);
      expect(sweep.receipts[0]).toMatchObject({ batchId: 'rsi-retry', imported: 1, failed: [] });
      expect(orchestrate).toHaveBeenCalledTimes(1);
      expect(orchestrate.mock.calls[0]?.[0].id).toBe('flaky');
      expect(adapter.hasFolder(`${INBOX}/rsi-retry/posts`)).toBe(false);
      // GC in the same sweep must not touch the now-drained batch dir
      expect(adapter.hasFile(`${INBOX}/rsi-retry/result.json`)).toBe(true);
    });

    it('never garbage-collects a receipted batch while failed post files remain', async () => {
      const adapter = new FakeVaultAdapter();
      const now = Date.now();
      seedBatch(adapter, 'rsi-keep', [{ name: '0001-bad.json', content: '{not json' }]);
      const { service } = makeHarness(adapter);

      // First sweep records the per-post failure and keeps the file.
      await service.sweepInbox();
      expect(adapter.hasFile(`${INBOX}/rsi-keep/posts/0001-bad.json`)).toBe(true);

      // Even with an ancient receipt, retry files are protected from the 7d GC.
      adapter.setMtime(`${INBOX}/rsi-keep/result.json`, now - 8 * DAY_MS);
      const inboxOnly = makeHarness(adapter).inbox;
      const removed = await inboxOnly.collectGarbage(now);

      expect(removed).toEqual([]);
      expect(adapter.hasFile(`${INBOX}/rsi-keep/posts/0001-bad.json`)).toBe(true);
    });

    it('isolates batch-level failures so the remaining batches still drain', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'batch-bad', [{ name: '0001-a.json', content: makeEnvelope('a') }], {
        manifest: '{broken',
      });
      seedBatch(adapter, 'batch-good', [{ name: '0001-b.json', content: makeEnvelope('b') }]);
      const { service } = makeHarness(adapter);

      const result = await service.sweepInbox();

      expect(result.receipts).toHaveLength(1);
      expect(result.receipts[0]?.batchId).toBe('batch-good');
    });

    it('garbage-collects stale uncommitted batches but keeps fresh ones', async () => {
      const adapter = new FakeVaultAdapter();
      const now = Date.now();
      seedBatch(adapter, 'stale-uncommitted', [{ name: '0001-a.json', content: makeEnvelope('a') }], {
        committed: false,
      });
      adapter.setMtime(`${INBOX}/stale-uncommitted`, now - 25 * HOUR_MS);
      adapter.setMtime(`${INBOX}/stale-uncommitted/posts`, now - 25 * HOUR_MS);
      seedBatch(adapter, 'fresh-uncommitted', [{ name: '0001-b.json', content: makeEnvelope('b') }], {
        committed: false,
      });
      const { service } = makeHarness(adapter);

      const result = await service.sweepInbox();

      expect(result.garbageCollected).toEqual([`${INBOX}/stale-uncommitted`]);
      expect(adapter.hasFolder(`${INBOX}/stale-uncommitted`)).toBe(false);
      expect(adapter.hasFolder(`${INBOX}/fresh-uncommitted`)).toBe(true);
    });

    it('garbage-collects completed batches older than 7 days', async () => {
      const adapter = new FakeVaultAdapter();
      const now = Date.now();
      seedBatch(adapter, 'old-done', []);
      adapter.writeSync(
        `${INBOX}/old-done/result.json`,
        JSON.stringify({ v: 1, batchId: 'old-done', imported: 1, duplicates: 0, failed: [], finishedAt: '2026-06-01T00:00:00.000Z' }),
        now - 8 * DAY_MS
      );
      seedBatch(adapter, 'recent-done', []);
      adapter.writeSync(
        `${INBOX}/recent-done/result.json`,
        JSON.stringify({ v: 1, batchId: 'recent-done', imported: 1, duplicates: 0, failed: [], finishedAt: '2026-06-11T00:00:00.000Z' }),
        now - 1 * DAY_MS
      );
      const { service } = makeHarness(adapter);

      const result = await service.sweepInbox();

      expect(result.garbageCollected).toEqual([`${INBOX}/old-done`]);
      expect(adapter.hasFolder(`${INBOX}/recent-done`)).toBe(true);
    });
  });

  describe('sweepInbox — batch refusal receipts', () => {
    it('writes a refusal receipt for a stale unreadable manifest and retires the batch', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-stale-broken', [{ name: '0001-a.json', content: makeEnvelope('a') }], {
        manifest: '', // FSA sender crashed mid-commit: batch.json created empty
      });
      adapter.setMtime(`${INBOX}/rsi-stale-broken/batch.json`, Date.now() - 11 * MINUTE_MS);
      const { service, inbox, orchestrate } = makeHarness(adapter);

      const result = await service.sweepInbox();

      // A refused batch is not a processed batch — nothing in the sweep receipts
      expect(result.receipts).toEqual([]);
      expect(orchestrate).not.toHaveBeenCalled();

      const receipt = await inbox.readReceipt('rsi-stale-broken');
      expect(receipt).toMatchObject({
        v: 1,
        batchId: 'rsi-stale-broken',
        imported: 0,
        duplicates: 0,
        // Terminal marker: keeps the failed-post retry pass off refused batches
        refused: true,
      });
      expect(receipt?.failed).toHaveLength(1);
      expect(receipt?.failed[0]?.file).toBe('batch.json');
      expect(receipt?.failed[0]?.error).toContain('invalid_manifest');
      expect(Number.isNaN(new Date(receipt?.finishedAt ?? '').getTime())).toBe(false);

      // Receipted → completed: out of the pending list; files wait for the 7d GC
      expect(await inbox.listPendingBatchIds()).not.toContain('rsi-stale-broken');
      expect(adapter.hasFile(`${INBOX}/rsi-stale-broken/posts/0001-a.json`)).toBe(true);
    });

    it('does not write a refusal receipt while the broken manifest is fresh (commit may be in flight)', async () => {
      const adapter = new FakeVaultAdapter();
      // writeSync stamps mtime = now → inside the 10-minute grace window
      seedBatch(adapter, 'rsi-fresh-broken', [{ name: '0001-a.json', content: makeEnvelope('a') }], {
        manifest: '',
      });
      const { service, inbox } = makeHarness(adapter);

      const result = await service.sweepInbox();

      expect(result.receipts).toEqual([]);
      expect(adapter.hasFile(`${INBOX}/rsi-fresh-broken/result.json`)).toBe(false);
      // Still pending — the next sweep retries once the sender finishes (or the grace expires)
      expect(await inbox.listPendingBatchIds()).toContain('rsi-fresh-broken');
      expect(adapter.hasFile(`${INBOX}/rsi-fresh-broken/posts/0001-a.json`)).toBe(true);
    });

    it('writes a too_many_posts refusal receipt for a stale oversized manifest', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-stale-huge', [{ name: '0001-a.json', content: makeEnvelope('a') }], {
        manifest: makeManifest('rsi-stale-huge', 1001),
      });
      adapter.setMtime(`${INBOX}/rsi-stale-huge/batch.json`, Date.now() - 11 * MINUTE_MS);
      const { service, inbox, orchestrate } = makeHarness(adapter);

      await service.sweepInbox();

      const receipt = await inbox.readReceipt('rsi-stale-huge');
      expect(receipt).toMatchObject({
        v: 1,
        batchId: 'rsi-stale-huge',
        imported: 0,
        duplicates: 0,
        refused: true,
      });
      expect(receipt?.failed[0]?.file).toBe('batch.json');
      expect(receipt?.failed[0]?.error).toContain('too_many_posts');
      expect(orchestrate).not.toHaveBeenCalled();
      expect(await inbox.listPendingBatchIds()).not.toContain('rsi-stale-huge');
    });

    it('never receipts transient batch errors (orchestrator unavailable) — batch stays pending', async () => {
      const adapter = new FakeVaultAdapter();
      seedBatch(adapter, 'rsi-transient', [{ name: '0001-a.json', content: makeEnvelope('a') }]);
      // Stale manifest on purpose: the refusal gate is the error TYPE, not freshness
      adapter.setMtime(`${INBOX}/rsi-transient/batch.json`, Date.now() - 11 * MINUTE_MS);
      const { service, inbox } = makeHarness(adapter, { orchestrator: undefined });

      const result = await service.sweepInbox();

      expect(result.receipts).toEqual([]);
      expect(adapter.hasFile(`${INBOX}/rsi-transient/result.json`)).toBe(false);
      expect(await inbox.listPendingBatchIds()).toContain('rsi-transient');
      expect(adapter.hasFile(`${INBOX}/rsi-transient/posts/0001-a.json`)).toBe(true);
    });

    it('treats a refusal-receipted batch as completed — GCed after 7 days, not before', async () => {
      const adapter = new FakeVaultAdapter();
      const now = Date.now();
      seedBatch(adapter, 'rsi-refused', [{ name: '0001-a.json', content: makeEnvelope('a') }], {
        manifest: '',
      });
      adapter.setMtime(`${INBOX}/rsi-refused/batch.json`, now - 11 * MINUTE_MS);
      const { service } = makeHarness(adapter);

      // First sweep writes the refusal receipt (fresh — survives its own GC pass)
      await service.sweepInbox();
      expect(adapter.hasFile(`${INBOX}/rsi-refused/result.json`)).toBe(true);
      expect(adapter.hasFolder(`${INBOX}/rsi-refused`)).toBe(true);

      // Receipt younger than 7 days → kept (and no longer pending, so not reprocessed)
      adapter.setMtime(`${INBOX}/rsi-refused/result.json`, now - 6 * DAY_MS);
      const kept = await service.sweepInbox();
      expect(kept.receipts).toEqual([]);
      expect(kept.garbageCollected).toEqual([]);
      expect(adapter.hasFolder(`${INBOX}/rsi-refused`)).toBe(true);

      // Receipt older than 7 days → reclaimed like any completed batch
      adapter.setMtime(`${INBOX}/rsi-refused/result.json`, now - 8 * DAY_MS);
      const swept = await service.sweepInbox();
      expect(swept.garbageCollected).toEqual([`${INBOX}/rsi-refused`]);
      expect(adapter.hasFolder(`${INBOX}/rsi-refused`)).toBe(false);
    });
  });
});
