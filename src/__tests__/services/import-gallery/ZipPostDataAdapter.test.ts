/**
 * Unit tests for the ZipPostDataAdapter (Layer-2 of the Instagram Import
 * Review Gallery, PRD §9.3).
 *
 * The adapter is a pure ZIP → preview function. Tests build small in-memory
 * ZIPs using jszip directly (deliberately bypassing ImportZipReader so we
 * exercise the adapter end-to-end against the real zip parser).
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  loadGallery,
  extractMediaBytes,
} from '@/services/import-gallery/ZipPostDataAdapter';
import { ImportZipReader } from '@/services/import/ImportZipReader';
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

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

type MakePartOptions = {
  exportId?: string;
  partNumber?: number;
  totalParts?: number;
  collectionId?: string;
  collectionName?: string;
  collectionScope?: 'named' | 'all_saved_posts';
  /** Posts to encode into posts.jsonl. */
  posts: Array<Partial<PostData> & { id: string; shortcode?: string }>;
  /**
   * Inline media files to bundle. Map of relative path → bytes. The test
   * builder does NOT auto-derive this from posts because the adapter is
   * media-agnostic — it only emits relative paths from posts.jsonl.
   */
  mediaFiles?: Record<string, Uint8Array>;
  /** Override counts; defaults are derived from posts.length. */
  countsOverride?: Partial<Record<
    | 'postsInPart'
    | 'postsInExport'
    | 'readyToImport'
    | 'partialMedia'
    | 'failedPosts'
    | 'mediaDownloaded'
    | 'mediaFailed',
    number
  >>;
  /** When true, write a `_checksums.txt` line for posts.jsonl that DOES NOT match. */
  corruptChecksum?: boolean;
  /** When true, omit manifest.json entirely (forces validator failure). */
  omitManifest?: boolean;
  /** When true, write a manifest with bogus shape. */
  invalidManifest?: boolean;
  /** When true, omit posts.jsonl. */
  omitPostsJsonl?: boolean;
};

function makePost(
  id: string,
  shortcode: string,
  mediaPath: string | null,
): PostData {
  return {
    platform: 'instagram',
    id,
    url: `https://www.instagram.com/p/${shortcode}/`,
    author: { name: 'tester', url: 'https://x', avatar: './media/avatar.jpg' },
    content: { text: `post ${id}` },
    media: mediaPath
      ? [{ type: 'image', url: mediaPath, thumbnail: mediaPath }]
      : [],
    metadata: { timestamp: new Date('2026-04-01T00:00:00.000Z') },
    raw: { code: shortcode },
  } as PostData;
}

async function makePartZip(opts: MakePartOptions): Promise<Blob> {
  const zip = new JSZip();
  const exportId = opts.exportId ?? 'export-1';
  const partNumber = opts.partNumber ?? 1;
  const totalParts = opts.totalParts ?? 1;
  const collection = {
    id: opts.collectionId ?? 'col-1',
    name: opts.collectionName ?? 'Saved',
    scope: (opts.collectionScope ?? 'named') as 'named' | 'all_saved_posts',
  };

  // posts.jsonl
  const jsonlLines = opts.posts.map((p) =>
    JSON.stringify(
      makePost(
        p.id,
        p.shortcode ?? p.id,
        Array.isArray(p.media) && p.media.length > 0
          ? (p.media[0]!.url as string)
          : `./media/${p.shortcode ?? p.id}/00-image.jpg`,
      ),
    ),
  );
  const jsonlContent = jsonlLines.join('\n') + '\n';
  if (!opts.omitPostsJsonl) {
    zip.file('posts.jsonl', jsonlContent);
  }

  // manifest.json
  if (!opts.omitManifest) {
    if (opts.invalidManifest) {
      zip.file('manifest.json', JSON.stringify({ schemaVersion: 1, garbage: true }));
    } else {
      const counts = {
        postsInPart: opts.posts.length,
        postsInExport: opts.posts.length,
        readyToImport: opts.posts.length,
        partialMedia: 0,
        failedPosts: 0,
        mediaDownloaded: opts.posts.length,
        mediaFailed: 0,
        ...opts.countsOverride,
      };
      const manifest = {
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
      };
      zip.file('manifest.json', JSON.stringify(manifest));
    }
  }

  // Media files
  if (opts.mediaFiles) {
    for (const [relPath, bytes] of Object.entries(opts.mediaFiles)) {
      const normalized = relPath.replace(/^\.\//, '');
      zip.file(normalized, bytes);
    }
  }

  // _checksums.txt
  if (!opts.omitManifest && !opts.invalidManifest) {
    const enc = new TextEncoder();
    const checksums: string[] = [];
    if (!opts.omitPostsJsonl) {
      const hash = opts.corruptChecksum
        ? '0'.repeat(64)
        : await ImportZipReader.sha256Hex(enc.encode(jsonlContent));
      checksums.push(`${hash}  posts.jsonl`);
    }
    zip.file('_checksums.txt', checksums.join('\n') + '\n');
  }

  const buf = await zip.generateAsync({ type: 'arraybuffer' });
  return new Blob([buf], { type: 'application/zip' });
}

// ---------------------------------------------------------------------------
// loadGallery — happy path
// ---------------------------------------------------------------------------

describe('loadGallery', () => {
  it('parses a single ZIP part into ImportPostPreview rows', async () => {
    const blob = await makePartZip({
      exportId: 'exp-A',
      partNumber: 1,
      totalParts: 1,
      collectionId: 'design-inspo',
      collectionName: 'Design Inspo',
      posts: [
        { id: '111', shortcode: 'AAA' },
        { id: '222', shortcode: 'BBB' },
        { id: '333', shortcode: 'CCC' },
      ],
    });

    const result = await loadGallery({
      files: [{ name: 'export-A-part-1.zip', blob }],
      duplicatePostIds: new Set(),
    });

    expect(result.errors).toEqual([]);
    expect(result.parts).toHaveLength(1);
    const part = result.parts[0]!;
    expect(part.filename).toBe('export-A-part-1.zip');
    expect(part.exportId).toBe('exp-A');
    expect(part.partNumber).toBe(1);
    expect(part.totalParts).toBe(1);
    expect(part.collection.id).toBe('design-inspo');
    expect(part.collection.scope).toBe('named');
    expect(part.posts.map((p) => p.postId)).toEqual(['111', '222', '333']);
    expect(part.posts.map((p) => p.shortcode)).toEqual(['AAA', 'BBB', 'CCC']);
    expect(part.posts.every((p) => p.collectionId === 'design-inspo')).toBe(true);
    expect(part.posts.every((p) => p.partFilename === 'export-A-part-1.zip')).toBe(true);
    expect(part.posts.every((p) => p.isDuplicate === false)).toBe(true);
    expect(part.integrityOk).toBe(true);
    expect(result.totalReady).toBe(3);
  });

  it('marks posts duplicate from the supplied set', async () => {
    const blob = await makePartZip({
      posts: [
        { id: '111', shortcode: 'AAA' },
        { id: '222', shortcode: 'BBB' },
        { id: '333', shortcode: 'CCC' },
      ],
    });

    const result = await loadGallery({
      files: [{ name: 'p.zip', blob }],
      duplicatePostIds: new Set(['222']),
    });

    expect(result.errors).toEqual([]);
    const part = result.parts[0]!;
    const byId = new Map(part.posts.map((p) => [p.postId, p]));
    expect(byId.get('111')!.isDuplicate).toBe(false);
    expect(byId.get('222')!.isDuplicate).toBe(true);
    expect(byId.get('333')!.isDuplicate).toBe(false);
    // totalReady excludes duplicates.
    expect(result.totalReady).toBe(2);
  });

  it('aggregates totalReady across multiple parts and excludes duplicates', async () => {
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
      posts: [
        { id: '3', shortcode: 'c' },
        { id: '4', shortcode: 'd' },
        { id: '5', shortcode: 'e' },
      ],
    });

    const result = await loadGallery({
      files: [
        { name: 'p1.zip', blob: part1 },
        { name: 'p2.zip', blob: part2 },
      ],
      duplicatePostIds: new Set(['2', '5']),
    });

    expect(result.parts).toHaveLength(2);
    expect(result.parts[0]!.posts).toHaveLength(2);
    expect(result.parts[1]!.posts).toHaveLength(3);
    // 5 posts total, 2 dupes → 3 ready.
    expect(result.totalReady).toBe(3);
  });

  it('lazy contract — postData media URLs remain ZIP-relative (no blob: rewrite)', async () => {
    const blob = await makePartZip({
      posts: [{ id: '999', shortcode: 'ZZZ' }],
    });
    const result = await loadGallery({
      files: [{ name: 'p.zip', blob }],
      duplicatePostIds: new Set(),
    });
    const post = result.parts[0]!.posts[0]!;
    // Built fixture uses './media/{shortcode}/00-image.jpg' as both url + thumbnail.
    expect(post.postData.media[0]!.url).toBe('./media/ZZZ/00-image.jpg');
    expect(post.postData.media[0]!.thumbnail).toBe('./media/ZZZ/00-image.jpg');
    expect(post.postData.author.avatar).toBe('./media/avatar.jpg');
    // Belt-and-suspenders: nothing rewritten to blob:.
    expect(post.postData.media[0]!.url.startsWith('blob:')).toBe(false);
    expect(post.postData.author.avatar!.startsWith('blob:')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Error / edge-case paths
  // -------------------------------------------------------------------------

  it('records an error for an invalid manifest and skips the part', async () => {
    const bad = await makePartZip({
      posts: [{ id: '1', shortcode: 'a' }],
      invalidManifest: true,
    });

    const result = await loadGallery({
      files: [{ name: 'broken.zip', blob: bad }],
      duplicatePostIds: new Set(),
    });

    expect(result.parts).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.filename).toBe('broken.zip');
    expect(result.errors[0]!.message).toMatch(/manifest invalid/i);
    expect(result.totalReady).toBe(0);
  });

  it('records an error when manifest.json is missing', async () => {
    const bad = await makePartZip({
      posts: [{ id: '1', shortcode: 'a' }],
      omitManifest: true,
    });

    const result = await loadGallery({
      files: [{ name: 'no-manifest.zip', blob: bad }],
      duplicatePostIds: new Set(),
    });

    expect(result.parts).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });

  it('continues processing other parts when one fails', async () => {
    const goodBlob = await makePartZip({
      posts: [{ id: 'g1', shortcode: 'good1' }],
    });
    const badBlob = await makePartZip({
      posts: [{ id: 'b1', shortcode: 'bad1' }],
      invalidManifest: true,
    });

    const result = await loadGallery({
      files: [
        { name: 'bad.zip', blob: badBlob },
        { name: 'good.zip', blob: goodBlob },
      ],
      duplicatePostIds: new Set(),
    });

    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]!.filename).toBe('good.zip');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.filename).toBe('bad.zip');
    expect(result.totalReady).toBe(1);
  });

  it('surfaces checksum mismatch as a warning and integrityOk=false', async () => {
    const blob = await makePartZip({
      posts: [{ id: '1', shortcode: 'a' }],
      corruptChecksum: true,
    });

    const result = await loadGallery({
      files: [{ name: 'p.zip', blob }],
      duplicatePostIds: new Set(),
    });

    expect(result.parts).toHaveLength(1);
    const part = result.parts[0]!;
    expect(part.integrityOk).toBe(false);
    expect(part.warnings.some((w) => w.includes('posts.jsonl checksum mismatch'))).toBe(true);
    // Posts still surface — checksum is advisory, not blocking.
    expect(part.posts).toHaveLength(1);
  });

  it('does not mutate the input.files array', async () => {
    const blob = await makePartZip({ posts: [{ id: '1', shortcode: 'a' }] });
    const files = [{ name: 'p.zip', blob }];
    const snapshot = [...files];
    await loadGallery({ files, duplicatePostIds: new Set() });
    expect(files).toEqual(snapshot);
    expect(files[0]!.blob).toBe(blob);
  });

  it('falls back to id when raw.code is missing', async () => {
    // Build a posts.jsonl line WITHOUT raw.code by post-processing the ZIP.
    const zip = new JSZip();
    const post = {
      platform: 'instagram',
      id: 'NO_CODE_ID',
      url: 'https://www.instagram.com/p/x/',
      author: { name: 'a', url: 'https://x' },
      content: { text: '' },
      media: [{ type: 'image', url: './media/x/00.jpg' }],
      metadata: { timestamp: '2026-04-01T00:00:00.000Z' },
      // raw is intentionally undefined
    };
    const jsonl = JSON.stringify(post) + '\n';
    zip.file('posts.jsonl', jsonl);
    zip.file(
      'manifest.json',
      JSON.stringify({
        $schema: 'social-archiver/instagram-saved-export-v2',
        schemaVersion: 2,
        exportId: 'e',
        partNumber: 1,
        totalParts: 1,
        exportedAt: '2026-04-18T00:00:00.000Z',
        platform: 'instagram',
        source: 'saved-posts',
        instagramUserId: '42',
        instagramUsername: 't',
        collection: { id: 'c', name: 'C', scope: 'named' },
        app: { name: 'x', version: '1' },
        filters: { collectionIds: [], dateFrom: null, dateTo: null },
        counts: {
          postsInPart: 1,
          postsInExport: 1,
          readyToImport: 1,
          partialMedia: 0,
          failedPosts: 0,
          mediaDownloaded: 1,
          mediaFailed: 0,
        },
        integrity: { algorithm: 'sha256', checksumsFile: '_checksums.txt' },
      }),
    );
    zip.file('_checksums.txt', '');
    const blob = new Blob([await zip.generateAsync({ type: 'arraybuffer' })], {
      type: 'application/zip',
    });

    const result = await loadGallery({
      files: [{ name: 'p.zip', blob }],
      duplicatePostIds: new Set(),
    });
    expect(result.parts[0]!.posts[0]!.shortcode).toBe('NO_CODE_ID');
  });

  it('warns and skips lines with malformed JSON or missing id/media', async () => {
    const zip = new JSZip();
    const goodLine = JSON.stringify(makePost('OK1', 'ok1', './media/ok1/0.jpg'));
    const malformedLine = '{not valid json';
    const noIdLine = JSON.stringify({ media: [], content: { text: '' } });
    const noMediaLine = JSON.stringify({ id: 'BADM', content: { text: '' } });
    zip.file(
      'posts.jsonl',
      [goodLine, malformedLine, noIdLine, noMediaLine].join('\n') + '\n',
    );
    zip.file(
      'manifest.json',
      JSON.stringify({
        $schema: 'social-archiver/instagram-saved-export-v2',
        schemaVersion: 2,
        exportId: 'e',
        partNumber: 1,
        totalParts: 1,
        exportedAt: '2026-04-18T00:00:00.000Z',
        platform: 'instagram',
        source: 'saved-posts',
        instagramUserId: '42',
        instagramUsername: 't',
        collection: { id: 'c', name: 'C', scope: 'named' },
        app: { name: 'x', version: '1' },
        filters: { collectionIds: [], dateFrom: null, dateTo: null },
        counts: {
          postsInPart: 4,
          postsInExport: 4,
          readyToImport: 1,
          partialMedia: 0,
          failedPosts: 3,
          mediaDownloaded: 1,
          mediaFailed: 0,
        },
        integrity: { algorithm: 'sha256', checksumsFile: '_checksums.txt' },
      }),
    );
    zip.file('_checksums.txt', '');
    const blob = new Blob([await zip.generateAsync({ type: 'arraybuffer' })], {
      type: 'application/zip',
    });

    const result = await loadGallery({
      files: [{ name: 'mixed.zip', blob }],
      duplicatePostIds: new Set(),
    });

    expect(result.parts).toHaveLength(1);
    const part = result.parts[0]!;
    // Only the well-formed line surfaces as a preview.
    expect(part.posts).toHaveLength(1);
    expect(part.posts[0]!.postId).toBe('OK1');
    // All three malformed lines produce warnings.
    expect(part.warnings.some((w) => w.includes('parse error'))).toBe(true);
    expect(part.warnings.some((w) => w.includes('missing id/media'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractMediaBytes
// ---------------------------------------------------------------------------

describe('extractMediaBytes', () => {
  it('returns the bytes for a known relative path', async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const blob = await makePartZip({
      posts: [{ id: '1', shortcode: 'aaa' }],
      mediaFiles: { 'media/aaa/00-image.jpg': payload },
    });

    const bytes = await extractMediaBytes(blob, './media/aaa/00-image.jpg');
    expect(bytes).not.toBeNull();
    const view = new Uint8Array(bytes!);
    expect(Array.from(view)).toEqual(Array.from(payload));
  });

  it('accepts paths without the leading ./ prefix', async () => {
    const payload = new Uint8Array([42]);
    const blob = await makePartZip({
      posts: [{ id: '1', shortcode: 'aaa' }],
      mediaFiles: { 'media/aaa/00-image.jpg': payload },
    });
    const bytes = await extractMediaBytes(blob, 'media/aaa/00-image.jpg');
    expect(bytes).not.toBeNull();
    expect(new Uint8Array(bytes!)[0]).toBe(42);
  });

  it('returns null for a missing path', async () => {
    const blob = await makePartZip({ posts: [{ id: '1', shortcode: 'aaa' }] });
    const bytes = await extractMediaBytes(blob, './media/does-not-exist.jpg');
    expect(bytes).toBeNull();
  });
});
