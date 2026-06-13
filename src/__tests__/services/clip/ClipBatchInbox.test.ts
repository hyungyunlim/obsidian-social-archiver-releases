import { describe, it, expect } from 'vitest';
import { ClipBatchInbox, type ClipInboxAdapter } from '@/services/clip/ClipBatchInbox';
import { ClipBatchError } from '@/types/clip-batch';
import type { ClipBatchErrorReason, ClipBatchReceiptV1 } from '@/types/clip-batch';

const MEDIA_PATH = 'attachments/social-archives';
const INBOX = `${MEDIA_PATH}/clips/.inbox`;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** In-memory DataAdapter stand-in (same surface ClipBatchInbox consumes). */
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

  hasFolder(path: string): boolean {
    return this.folders.has(path);
  }

  hasFile(path: string): boolean {
    return this.files.has(path);
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

function makeInbox(adapter: ClipInboxAdapter, mediaPath: string = MEDIA_PATH): ClipBatchInbox {
  return new ClipBatchInbox({ adapter, getMediaPath: () => mediaPath });
}

function manifestJson(batchId: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1,
    batchId,
    source: 'reddit-saved-import',
    createdAt: '2026-06-12T00:00:00.000Z',
    postCount: 1,
    ...overrides,
  });
}

async function expectInboxError(
  promise: Promise<unknown>,
  reason: ClipBatchErrorReason
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

describe('ClipBatchInbox', () => {
  describe('getInboxRoot', () => {
    it('resolves under the configured media path', () => {
      expect(makeInbox(new FakeVaultAdapter(), 'custom/media').getInboxRoot()).toBe(
        'custom/media/clips/.inbox'
      );
    });

    it('falls back to the default media path when the setting is empty', () => {
      expect(makeInbox(new FakeVaultAdapter(), '').getInboxRoot()).toBe(
        'attachments/social-archives/clips/.inbox'
      );
    });

    it('rejects degenerate mediaPath settings and falls back like the extension sender', () => {
      // Mirror of the extension's sanitizeVaultRelativeParts: '.'/'..' or
      // whitespace-only segments → default path, so both sides resolve the
      // SAME inbox root for the same data.json value.
      for (const degenerate of ['.', '..', 'media/../escape', './media', '   ', ' / / ']) {
        expect(makeInbox(new FakeVaultAdapter(), degenerate).getInboxRoot()).toBe(
          'attachments/social-archives/clips/.inbox'
        );
      }
    });

    it('normalizes messy-but-valid mediaPath settings the way the sender does', () => {
      // Extension: split('/') → trim → filter(Boolean) → join — empty and
      // whitespace-padded segments collapse instead of forking the path.
      expect(makeInbox(new FakeVaultAdapter(), ' custom //media ').getInboxRoot()).toBe(
        'custom/media/clips/.inbox'
      );
    });
  });

  describe('batch listing', () => {
    it('lists only committed batches (batch.json present), sorted', async () => {
      const adapter = new FakeVaultAdapter();
      adapter.mkdirSync(`${INBOX}/b-two`);
      adapter.writeSync(`${INBOX}/b-two/batch.json`, manifestJson('b-two'));
      adapter.mkdirSync(`${INBOX}/a-one`);
      adapter.writeSync(`${INBOX}/a-one/batch.json`, manifestJson('a-one'));
      adapter.mkdirSync(`${INBOX}/half-written`); // no batch.json yet
      const inbox = makeInbox(adapter);

      expect(await inbox.listCommittedBatchIds()).toEqual(['a-one', 'b-two']);
    });

    it('ignores folders whose names are not valid batch ids', async () => {
      const adapter = new FakeVaultAdapter();
      adapter.mkdirSync(`${INBOX}/.hidden`);
      adapter.mkdirSync(`${INBOX}/has space`);
      adapter.writeSync(`${INBOX}/has space/batch.json`, manifestJson('x'));
      const inbox = makeInbox(adapter);

      expect(await inbox.listCommittedBatchIds()).toEqual([]);
    });

    it('returns [] when the inbox root does not exist', async () => {
      const inbox = makeInbox(new FakeVaultAdapter());
      expect(await inbox.listCommittedBatchIds()).toEqual([]);
      expect(await inbox.listPendingBatchIds()).toEqual([]);
    });

    it('excludes drained batches with a receipt from the pending list', async () => {
      const adapter = new FakeVaultAdapter();
      adapter.mkdirSync(`${INBOX}/pending-1`);
      adapter.writeSync(`${INBOX}/pending-1/batch.json`, manifestJson('pending-1'));
      adapter.mkdirSync(`${INBOX}/done-1`);
      adapter.writeSync(`${INBOX}/done-1/batch.json`, manifestJson('done-1'));
      adapter.writeSync(`${INBOX}/done-1/result.json`, '{"v":1,"batchId":"done-1"}');
      const inbox = makeInbox(adapter);

      expect(await inbox.listPendingBatchIds()).toEqual(['pending-1']);
    });

    it('keeps receipted batches with remaining post files pending (failed-post retry)', async () => {
      const adapter = new FakeVaultAdapter();
      adapter.mkdirSync(`${INBOX}/retry-1`);
      adapter.writeSync(`${INBOX}/retry-1/batch.json`, manifestJson('retry-1'));
      adapter.writeSync(`${INBOX}/retry-1/posts/0001-reddit-a.json`, '{"v":1}');
      adapter.writeSync(
        `${INBOX}/retry-1/result.json`,
        JSON.stringify({
          v: 1,
          batchId: 'retry-1',
          imported: 1,
          duplicates: 0,
          failed: [{ file: 'posts/0001-reddit-a.json', error: 'transient' }],
          finishedAt: '2026-06-12T00:05:00.000Z',
        })
      );
      const inbox = makeInbox(adapter);

      expect(await inbox.listPendingBatchIds()).toEqual(['retry-1']);
    });

    it('excludes refusal-receipted batches even when post files remain (terminal)', async () => {
      const adapter = new FakeVaultAdapter();
      adapter.mkdirSync(`${INBOX}/refused-1`);
      adapter.writeSync(`${INBOX}/refused-1/batch.json`, '');
      adapter.writeSync(`${INBOX}/refused-1/posts/0001-reddit-a.json`, '{"v":1}');
      adapter.writeSync(
        `${INBOX}/refused-1/result.json`,
        JSON.stringify({
          v: 1,
          batchId: 'refused-1',
          imported: 0,
          duplicates: 0,
          failed: [{ file: 'batch.json', error: 'invalid_manifest: broken' }],
          finishedAt: '2026-06-12T00:05:00.000Z',
          refused: true,
        })
      );
      const inbox = makeInbox(adapter);

      expect(await inbox.listPendingBatchIds()).toEqual([]);
    });
  });

  describe('readManifest', () => {
    it('round-trips a valid manifest (senderVersion optional)', async () => {
      const adapter = new FakeVaultAdapter();
      adapter.writeSync(
        `${INBOX}/rsi-1/batch.json`,
        manifestJson('rsi-1', { senderVersion: '1.7.0', postCount: 120 })
      );
      const inbox = makeInbox(adapter);

      const manifest = await inbox.readManifest('rsi-1');

      expect(manifest).toEqual({
        v: 1,
        batchId: 'rsi-1',
        source: 'reddit-saved-import',
        senderVersion: '1.7.0',
        createdAt: '2026-06-12T00:00:00.000Z',
        postCount: 120,
      });
    });

    it('throws batch_not_found when batch.json is missing', async () => {
      const adapter = new FakeVaultAdapter();
      adapter.mkdirSync(`${INBOX}/rsi-half`);
      const inbox = makeInbox(adapter);

      await expectInboxError(inbox.readManifest('rsi-half'), 'batch_not_found');
      await expectInboxError(inbox.readManifest('rsi-missing'), 'batch_not_found');
    });

    it('throws invalid_manifest for bad JSON and malformed shapes', async () => {
      const adapter = new FakeVaultAdapter();
      const cases: Array<[string, string]> = [
        ['bad-json', '{broken'],
        ['bad-version', manifestJson('bad-version', { v: 2 })],
        ['no-source', manifestJson('no-source', { source: '' })],
        ['no-created', manifestJson('no-created', { createdAt: 42 })],
        ['bad-count', manifestJson('bad-count', { postCount: 'lots' })],
        ['neg-count', manifestJson('neg-count', { postCount: -1 })],
        ['bad-id', manifestJson('../escape')],
      ];
      for (const [batchId, content] of cases) {
        adapter.writeSync(`${INBOX}/${batchId}/batch.json`, content);
      }
      const inbox = makeInbox(adapter);

      for (const [batchId] of cases) {
        await expectInboxError(inbox.readManifest(batchId), 'invalid_manifest');
      }
    });

    it('rejects traversal-shaped batch ids before any adapter access', async () => {
      const inbox = makeInbox(new FakeVaultAdapter());

      await expectInboxError(inbox.readManifest('../../evil'), 'invalid_batch_id');
      await expectInboxError(inbox.readManifest('a/b'), 'invalid_batch_id');
      await expectInboxError(inbox.readManifest('a\\b'), 'invalid_batch_id');
      await expectInboxError(inbox.readManifest('..'), 'invalid_batch_id');
    });
  });

  describe('manifestMtime', () => {
    it('returns the batch.json mtime when the manifest exists', async () => {
      const adapter = new FakeVaultAdapter();
      const mtime = Date.parse('2026-06-12T00:00:00.000Z');
      adapter.writeSync(`${INBOX}/rsi-1/batch.json`, manifestJson('rsi-1'), mtime);
      const inbox = makeInbox(adapter);

      expect(await inbox.manifestMtime('rsi-1')).toBe(mtime);
    });

    it('returns null when batch.json is missing (half-written or absent batch)', async () => {
      const adapter = new FakeVaultAdapter();
      adapter.mkdirSync(`${INBOX}/rsi-half`); // dir exists, no commit marker yet
      const inbox = makeInbox(adapter);

      expect(await inbox.manifestMtime('rsi-half')).toBeNull();
      expect(await inbox.manifestMtime('rsi-missing')).toBeNull();
    });

    it('rejects traversal-shaped batch ids before any adapter access', async () => {
      const inbox = makeInbox(new FakeVaultAdapter());

      await expectInboxError(inbox.manifestMtime('../../evil'), 'invalid_batch_id');
      await expectInboxError(inbox.manifestMtime('a/b'), 'invalid_batch_id');
    });
  });

  describe('listPostFiles', () => {
    it('returns .json files sorted by filename and skips other files', async () => {
      const adapter = new FakeVaultAdapter();
      adapter.writeSync(`${INBOX}/rsi-1/posts/0002-bbb.json`, '{}');
      adapter.writeSync(`${INBOX}/rsi-1/posts/0001-aaa.json`, '{}');
      adapter.writeSync(`${INBOX}/rsi-1/posts/notes.txt`, 'stray');
      const inbox = makeInbox(adapter);

      expect(await inbox.listPostFiles('rsi-1')).toEqual([
        `${INBOX}/rsi-1/posts/0001-aaa.json`,
        `${INBOX}/rsi-1/posts/0002-bbb.json`,
      ]);
    });

    it('returns [] when the posts dir is missing', async () => {
      const adapter = new FakeVaultAdapter();
      adapter.mkdirSync(`${INBOX}/rsi-1`);
      const inbox = makeInbox(adapter);

      expect(await inbox.listPostFiles('rsi-1')).toEqual([]);
    });
  });

  describe('receipts', () => {
    it('round-trips a receipt through write/read', async () => {
      const adapter = new FakeVaultAdapter();
      const inbox = makeInbox(adapter);
      const receipt: ClipBatchReceiptV1 = {
        v: 1,
        batchId: 'rsi-1',
        imported: 117,
        duplicates: 2,
        failed: [{ file: `${INBOX}/rsi-1/posts/0042-x.json`, error: 'boom' }],
        finishedAt: '2026-06-12T01:00:00.000Z',
      };

      await inbox.writeReceipt('rsi-1', receipt);

      expect(await inbox.hasReceipt('rsi-1')).toBe(true);
      expect(await inbox.readReceipt('rsi-1')).toEqual(receipt);
    });

    it('readReceipt returns null for missing or corrupt receipts', async () => {
      const adapter = new FakeVaultAdapter();
      adapter.writeSync(`${INBOX}/corrupt/result.json`, '{nope');
      adapter.writeSync(`${INBOX}/wrong-shape/result.json`, '[1,2]');
      const inbox = makeInbox(adapter);

      expect(await inbox.readReceipt('missing')).toBeNull();
      expect(await inbox.readReceipt('corrupt')).toBeNull();
      expect(await inbox.readReceipt('wrong-shape')).toBeNull();
    });
  });

  describe('cleanupDrainedPosts', () => {
    it('removes an empty posts dir', async () => {
      const adapter = new FakeVaultAdapter();
      adapter.mkdirSync(`${INBOX}/rsi-1/posts`);
      const inbox = makeInbox(adapter);

      await inbox.cleanupDrainedPosts('rsi-1');

      expect(adapter.hasFolder(`${INBOX}/rsi-1/posts`)).toBe(false);
    });

    it('keeps the posts dir when any file remains (failed posts, stray files)', async () => {
      const adapter = new FakeVaultAdapter();
      adapter.writeSync(`${INBOX}/rsi-1/posts/0001-failed.json`, '{}');
      const inbox = makeInbox(adapter);

      await inbox.cleanupDrainedPosts('rsi-1');

      expect(adapter.hasFolder(`${INBOX}/rsi-1/posts`)).toBe(true);
      expect(adapter.hasFile(`${INBOX}/rsi-1/posts/0001-failed.json`)).toBe(true);
    });

    it('is a no-op when the posts dir is already gone', async () => {
      const adapter = new FakeVaultAdapter();
      adapter.mkdirSync(`${INBOX}/rsi-1`);
      const inbox = makeInbox(adapter);

      await expect(inbox.cleanupDrainedPosts('rsi-1')).resolves.toBeUndefined();
    });
  });

  describe('collectGarbage', () => {
    it('removes completed batches older than 7 days, keeps fresh ones', async () => {
      const adapter = new FakeVaultAdapter();
      const now = Date.now();
      adapter.writeSync(`${INBOX}/old-done/batch.json`, manifestJson('old-done'));
      adapter.writeSync(`${INBOX}/old-done/result.json`, '{"v":1,"batchId":"old-done"}', now - 8 * DAY_MS);
      adapter.writeSync(`${INBOX}/new-done/batch.json`, manifestJson('new-done'));
      adapter.writeSync(`${INBOX}/new-done/result.json`, '{"v":1,"batchId":"new-done"}', now - 6 * DAY_MS);
      const inbox = makeInbox(adapter);

      const removed = await inbox.collectGarbage(now);

      expect(removed).toEqual([`${INBOX}/old-done`]);
      expect(adapter.hasFolder(`${INBOX}/old-done`)).toBe(false);
      expect(adapter.hasFolder(`${INBOX}/new-done`)).toBe(true);
    });

    it('removes uncommitted batches older than 24h, keeps fresh ones', async () => {
      const adapter = new FakeVaultAdapter();
      const now = Date.now();
      adapter.mkdirSync(`${INBOX}/stale-half`, now - 25 * HOUR_MS);
      adapter.mkdirSync(`${INBOX}/fresh-half`, now - 1 * HOUR_MS);
      const inbox = makeInbox(adapter);

      const removed = await inbox.collectGarbage(now);

      expect(removed).toEqual([`${INBOX}/stale-half`]);
      expect(adapter.hasFolder(`${INBOX}/fresh-half`)).toBe(true);
    });

    it('keeps an uncommitted batch whose posts/ dir is still being written', async () => {
      const adapter = new FakeVaultAdapter();
      const now = Date.now();
      // Batch dir is old, but the sender wrote into posts/ recently — the
      // newest mtime wins so in-flight exports are not swept away.
      adapter.mkdirSync(`${INBOX}/in-flight`, now - 25 * HOUR_MS);
      adapter.mkdirSync(`${INBOX}/in-flight/posts`, now - 1 * HOUR_MS);
      const inbox = makeInbox(adapter);

      expect(await inbox.collectGarbage(now)).toEqual([]);
      expect(adapter.hasFolder(`${INBOX}/in-flight`)).toBe(true);
    });

    it('never removes committed batches that have no receipt (pending work)', async () => {
      const adapter = new FakeVaultAdapter();
      const now = Date.now();
      adapter.mkdirSync(`${INBOX}/pending-old`, now - 30 * DAY_MS);
      adapter.writeSync(
        `${INBOX}/pending-old/batch.json`,
        manifestJson('pending-old'),
        now - 30 * DAY_MS
      );
      const inbox = makeInbox(adapter);

      expect(await inbox.collectGarbage(now)).toEqual([]);
      expect(adapter.hasFolder(`${INBOX}/pending-old`)).toBe(true);
    });

    it('leaves folders with unrecognized names alone', async () => {
      const adapter = new FakeVaultAdapter();
      const now = Date.now();
      adapter.mkdirSync(`${INBOX}/.DS_Store-like`, now - 30 * DAY_MS);
      adapter.mkdirSync(`${INBOX}/user data`, now - 30 * DAY_MS);
      const inbox = makeInbox(adapter);

      expect(await inbox.collectGarbage(now)).toEqual([]);
      expect(adapter.hasFolder(`${INBOX}/user data`)).toBe(true);
    });
  });
});
