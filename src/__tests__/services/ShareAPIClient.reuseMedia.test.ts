/**
 * Tests for ShareAPIClient.updateShareWithMedia() archive-media reuse path.
 *
 * Covers PRD §6.4 / §8 acceptance criteria:
 *   - all main-post media resolved → 0 upload calls, 0 local reads
 *   - partial resolve → only unresolved items uploaded
 *   - resolve map empty / undefined → existing upload flow unchanged
 *   - delete pass never touches archive-origin R2 objects
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ShareAPIClient } from '@/services/ShareAPIClient';
import type { PostData } from '@/types/post';
import type { ResolvedShareMediaItem } from '@/types/share';
import { __setRequestUrlHandler, TFile, type Vault } from 'obsidian';

// ─── Request capture helpers ───────────────────────────────────────────

interface CapturedRequest {
  url: string;
  method: string;
  body?: unknown;
}

function installHandler(
  captured: CapturedRequest[],
  router: (req: CapturedRequest) => { status: number; body: unknown } | undefined
) {
  __setRequestUrlHandler(async (params) => {
    const method = (params.method ?? 'GET').toUpperCase();
    const parsedBody = params.body ? safeParseJson(params.body) : undefined;
    const entry: CapturedRequest = { url: params.url, method, body: parsedBody };
    captured.push(entry);

    const routed = router(entry);
    const status = routed?.status ?? 200;
    const body = routed?.body ?? { success: true };
    return {
      status,
      headers: {},
      json: body,
      text: JSON.stringify(body),
      arrayBuffer: new ArrayBuffer(0),
    };
  });
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// ─── Minimal Vault stub that always yields a 4-byte buffer ─────────────

function makeVault(): Vault {
  const file = new TFile('attachments/social-archives/x/img.jpg');
  const vault = {
    getAbstractFileByPath: (_path: string) => file,
    readBinary: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  } as unknown as Vault;
  return vault;
}

// ─── Post data factory ────────────────────────────────────────────────

function makePostData(opts: { mediaCount: number }): PostData {
  return {
    platform: 'post' as PostData['platform'],
    id: 'note-1',
    url: '',
    title: 'n',
    author: { name: 'u', url: '' },
    content: { text: 'body', hashtags: [] },
    media: Array.from({ length: opts.mediaCount }, (_, i) => ({
      type: 'image' as const,
      url: `attachments/social-archives/x/img-${i}.jpg`,
    })),
    metadata: { timestamp: new Date('2026-04-17T00:00:00Z'), likes: 0, comments: 0, shares: 0 },
  };
}

function makeResolved(index: number, archiveId: string): ResolvedShareMediaItem {
  return {
    sourceIndex: index,
    variant: 'primary',
    url: `https://r2.example.com/archives/u/${archiveId}/media/${index}-primary.jpg`,
    r2Key: `archives/u/${archiveId}/media/${index}-primary.jpg`,
    contentType: 'image/jpeg',
    size: 1234,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('ShareAPIClient.updateShareWithMedia — archive media reuse', () => {
  let client: ShareAPIClient;
  let captured: CapturedRequest[];
  const shareId = 'share_1';
  const archiveId = 'arc_1';

  beforeEach(() => {
    captured = [];
    client = new ShareAPIClient({
      baseURL: 'https://api.test.com',
      apiKey: 'test-api-key',
      vault: makeVault(),
      maxRetries: 1,
      retryDelay: 1,
    });
  });

  afterEach(() => {
    __setRequestUrlHandler(null);
  });

  it('uploads zero media when every top-level item is resolved to archive R2', async () => {
    const postData = makePostData({ mediaCount: 2 });
    const resolvedMap = new Map<number, ResolvedShareMediaItem>([
      [0, makeResolved(0, archiveId)],
      [1, makeResolved(1, archiveId)],
    ]);

    installHandler(captured, (req) => {
      if (req.method === 'GET' && req.url.endsWith(`/api/share/${shareId}`)) {
        // existing share has no media yet
        return { status: 200, body: { success: true, data: { shareId, media: [] } } };
      }
      if (req.method === 'POST' && req.url.endsWith('/api/share')) {
        return { status: 200, body: { success: true, data: { shareId, shareUrl: 'u', passwordProtected: false } } };
      }
      return { status: 200, body: { success: true } };
    });

    const result = await client.updateShareWithMedia(shareId, postData, { sourceArchiveId: archiveId }, undefined, resolvedMap);

    const uploadCalls = captured.filter(c => c.method === 'POST' && c.url.includes('/api/upload-share-media'));
    expect(uploadCalls).toHaveLength(0);

    // Final update payload should carry archive URLs with mediaOrigin='archive'.
    const updateCall = captured.find(c => c.method === 'POST' && c.url.endsWith('/api/share'));
    expect(updateCall).toBeDefined();
    const body = updateCall!.body as { postData: { media: any[] }; options: { sourceArchiveId?: string; shareId?: string } };
    expect(body.options.sourceArchiveId).toBe(archiveId);
    expect(body.options.shareId).toBe(shareId);
    expect(body.postData.media).toHaveLength(2);
    for (const m of body.postData.media) {
      expect(m.mediaOrigin).toBe('archive');
      expect(m.url.startsWith('https://r2.example.com/archives/')).toBe(true);
      expect(m.r2Key.startsWith('archives/')).toBe(true);
    }

    expect(result.mediaStats).toEqual({
      totalCount: 2,
      uploadedCount: 0,
      reusedCount: 2,
      keptCount: 0,
      skippedCount: 0,
    });
  });

  it('only uploads unresolved items in a partial-resolve scenario', async () => {
    const postData = makePostData({ mediaCount: 3 });
    const resolvedMap = new Map<number, ResolvedShareMediaItem>([
      [0, makeResolved(0, archiveId)],
      [2, makeResolved(2, archiveId)],
    ]);

    installHandler(captured, (req) => {
      if (req.method === 'GET' && req.url.endsWith(`/api/share/${shareId}`)) {
        return { status: 200, body: { success: true, data: { shareId, media: [] } } };
      }
      if (req.method === 'POST' && req.url.endsWith('/api/upload-share-media')) {
        return { status: 200, body: { success: true, data: { url: 'https://r2.example.com/shares/share_1/media/img-1.jpg' } } };
      }
      if (req.method === 'POST' && req.url.endsWith('/api/share')) {
        return { status: 200, body: { success: true, data: { shareId, shareUrl: 'u', passwordProtected: false } } };
      }
      return { status: 200, body: { success: true } };
    });

    const result = await client.updateShareWithMedia(shareId, postData, { sourceArchiveId: archiveId }, undefined, resolvedMap);

    const uploadCalls = captured.filter(c => c.method === 'POST' && c.url.endsWith('/api/upload-share-media'));
    expect(uploadCalls).toHaveLength(1);
    const uploadBody = uploadCalls[0]?.body as { filename: string };
    expect(uploadBody.filename).toBe('img-1.jpg');

    const updateCall = captured.find(c => c.method === 'POST' && c.url.endsWith('/api/share'));
    const body = updateCall!.body as { postData: { media: any[] } };
    // Two archive-origin, one share-origin
    const origins = body.postData.media.map(m => m.mediaOrigin).sort();
    expect(origins).toEqual(['archive', 'archive', 'share']);

    expect(result.mediaStats).toEqual({
      totalCount: 3,
      uploadedCount: 1,
      reusedCount: 2,
      keptCount: 0,
      skippedCount: 0,
    });
  });

  it('falls back to legacy upload flow when resolvedMediaMap is undefined', async () => {
    const postData = makePostData({ mediaCount: 2 });

    installHandler(captured, (req) => {
      if (req.method === 'GET' && req.url.endsWith(`/api/share/${shareId}`)) {
        return { status: 200, body: { success: true, data: { shareId, media: [] } } };
      }
      if (req.method === 'POST' && req.url.endsWith('/api/upload-share-media')) {
        return { status: 200, body: { success: true, data: { url: 'https://r2.example.com/shares/share_1/media/x.jpg' } } };
      }
      if (req.method === 'POST' && req.url.endsWith('/api/share')) {
        return { status: 200, body: { success: true, data: { shareId, shareUrl: 'u', passwordProtected: false } } };
      }
      return { status: 200, body: { success: true } };
    });

    const result = await client.updateShareWithMedia(shareId, postData, {}, undefined, undefined);

    const uploadCalls = captured.filter(c => c.method === 'POST' && c.url.endsWith('/api/upload-share-media'));
    expect(uploadCalls).toHaveLength(2);

    const updateCall = captured.find(c => c.method === 'POST' && c.url.endsWith('/api/share'));
    const body = updateCall!.body as { postData: { media: any[] } };
    // All items should be share-origin
    for (const m of body.postData.media) {
      expect(m.mediaOrigin).toBe('share');
    }

    expect(result.mediaStats).toEqual({
      totalCount: 2,
      uploadedCount: 2,
      reusedCount: 0,
      keptCount: 0,
      skippedCount: 0,
    });
  });

  it('never sends a DELETE for existing archive-origin media items', async () => {
    // Existing share already stores two archive-origin entries that the
    // plugin is "re-confirming" via resolvedMediaMap. No new media locally.
    const postData = makePostData({ mediaCount: 2 });
    const resolvedMap = new Map<number, ResolvedShareMediaItem>([
      [0, makeResolved(0, archiveId)],
      [1, makeResolved(1, archiveId)],
    ]);

    installHandler(captured, (req) => {
      if (req.method === 'GET' && req.url.endsWith(`/api/share/${shareId}`)) {
        return {
          status: 200,
          body: {
            success: true,
            data: {
              shareId,
              media: [
                {
                  url: 'https://r2.example.com/archives/u/arc_1/media/legacy.jpg',
                  r2Key: 'archives/u/arc_1/media/legacy.jpg',
                  mediaOrigin: 'archive',
                },
              ],
            },
          },
        };
      }
      if (req.method === 'POST' && req.url.endsWith('/api/share')) {
        return { status: 200, body: { success: true, data: { shareId, shareUrl: 'u', passwordProtected: false } } };
      }
      return { status: 200, body: { success: true } };
    });

    await client.updateShareWithMedia(shareId, postData, { sourceArchiveId: archiveId }, undefined, resolvedMap);

    const deleteCalls = captured.filter(c => c.method === 'DELETE');
    expect(deleteCalls).toHaveLength(0);
  });
});

// ─── Auto-resolve (no pre-built resolvedMediaMap) ─────────────────────

describe('ShareAPIClient.updateShareWithMedia — auto-resolve gate', () => {
  let client: ShareAPIClient;
  let captured: CapturedRequest[];
  const shareId = 'share_auto';
  const archiveId = 'arc_auto';

  beforeEach(() => {
    captured = [];
    client = new ShareAPIClient({
      baseURL: 'https://api.test.com',
      apiKey: 'test-api-key',
      vault: makeVault(),
      maxRetries: 1,
      retryDelay: 1,
    });
  });

  afterEach(() => {
    __setRequestUrlHandler(null);
  });

  it('auto-resolves via /api/share/resolve-media when caller passes sourceArchiveId only', async () => {
    const postData = makePostData({ mediaCount: 2 });

    installHandler(captured, (req) => {
      if (req.method === 'GET' && req.url.endsWith(`/api/share/${shareId}`)) {
        return { status: 200, body: { success: true, data: { shareId, media: [] } } };
      }
      if (req.method === 'POST' && req.url.endsWith('/api/share/resolve-media')) {
        return {
          status: 200,
          body: {
            success: true,
            data: {
              archiveId,
              preservationStatus: 'completed',
              resolvedCount: 2,
              totalCount: 2,
              resolved: [makeResolved(0, archiveId), makeResolved(1, archiveId)],
            },
          },
        };
      }
      if (req.method === 'POST' && req.url.endsWith('/api/share')) {
        return { status: 200, body: { success: true, data: { shareId, shareUrl: 'u', passwordProtected: false } } };
      }
      return { status: 200, body: { success: true } };
    });

    const result = await client.updateShareWithMedia(shareId, postData, {
      sourceArchiveId: archiveId,
      mediaSourceUrls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
    });

    // resolve-media was called exactly once
    const resolveCalls = captured.filter(c => c.url.endsWith('/api/share/resolve-media'));
    expect(resolveCalls).toHaveLength(1);
    const resolveBody = resolveCalls[0]?.body as { archiveId: string; items: Array<{ originalUrl?: string; sourceIndex?: number }> };
    expect(resolveBody.archiveId).toBe(archiveId);
    expect(resolveBody.items).toHaveLength(2);
    expect(resolveBody.items[0]?.originalUrl).toBe('https://cdn.example.com/a.jpg');

    // zero uploads because both items resolved to archive R2
    const uploadCalls = captured.filter(c => c.method === 'POST' && c.url.endsWith('/api/upload-share-media'));
    expect(uploadCalls).toHaveLength(0);

    // Final update payload has archive-origin mediaOrigin
    const updateCall = captured.find(c => c.method === 'POST' && c.url.endsWith('/api/share'));
    const body = updateCall!.body as { postData: { media: any[] } };
    for (const m of body.postData.media) {
      expect(m.mediaOrigin).toBe('archive');
    }

    // Stats reflect "all reused, zero uploads"
    expect(result.mediaStats).toEqual({
      totalCount: 2,
      uploadedCount: 0,
      reusedCount: 2,
      keptCount: 0,
      skippedCount: 0,
    });
  });

  it('prefers postData.sourceArchiveId when options.sourceArchiveId is missing', async () => {
    const postData = { ...makePostData({ mediaCount: 1 }), sourceArchiveId: archiveId } as PostData;

    installHandler(captured, (req) => {
      if (req.method === 'GET' && req.url.endsWith(`/api/share/${shareId}`)) {
        return { status: 200, body: { success: true, data: { shareId, media: [] } } };
      }
      if (req.method === 'POST' && req.url.endsWith('/api/share/resolve-media')) {
        return {
          status: 200,
          body: {
            success: true,
            data: {
              archiveId,
              preservationStatus: 'completed',
              resolvedCount: 1,
              totalCount: 1,
              resolved: [makeResolved(0, archiveId)],
            },
          },
        };
      }
      if (req.method === 'POST' && req.url.endsWith('/api/share')) {
        return { status: 200, body: { success: true, data: { shareId, shareUrl: 'u', passwordProtected: false } } };
      }
      return { status: 200, body: { success: true } };
    });

    const result = await client.updateShareWithMedia(shareId, postData, {});

    const resolveCalls = captured.filter(c => c.url.endsWith('/api/share/resolve-media'));
    expect(resolveCalls).toHaveLength(1);
    const uploadCalls = captured.filter(c => c.method === 'POST' && c.url.endsWith('/api/upload-share-media'));
    expect(uploadCalls).toHaveLength(0);

    expect(result.mediaStats).toEqual({
      totalCount: 1,
      uploadedCount: 0,
      reusedCount: 1,
      keptCount: 0,
      skippedCount: 0,
    });
  });

  it('skips auto-resolve when caller already provided resolvedMediaMap', async () => {
    const postData = makePostData({ mediaCount: 1 });
    const resolvedMap = new Map<number, ResolvedShareMediaItem>([[0, makeResolved(0, archiveId)]]);

    installHandler(captured, (req) => {
      if (req.method === 'GET' && req.url.endsWith(`/api/share/${shareId}`)) {
        return { status: 200, body: { success: true, data: { shareId, media: [] } } };
      }
      if (req.method === 'POST' && req.url.endsWith('/api/share')) {
        return { status: 200, body: { success: true, data: { shareId, shareUrl: 'u', passwordProtected: false } } };
      }
      return { status: 200, body: { success: true } };
    });

    await client.updateShareWithMedia(
      shareId,
      postData,
      { sourceArchiveId: archiveId, mediaSourceUrls: ['https://cdn.example.com/a.jpg'] },
      undefined,
      resolvedMap
    );

    // auto-resolve MUST NOT call the endpoint when caller did the work already
    const resolveCalls = captured.filter(c => c.url.endsWith('/api/share/resolve-media'));
    expect(resolveCalls).toHaveLength(0);
  });

  it('does not auto-resolve when no sourceArchiveId is available anywhere', async () => {
    const postData = makePostData({ mediaCount: 1 });

    installHandler(captured, (req) => {
      if (req.method === 'GET' && req.url.endsWith(`/api/share/${shareId}`)) {
        return { status: 200, body: { success: true, data: { shareId, media: [] } } };
      }
      if (req.method === 'POST' && req.url.endsWith('/api/upload-share-media')) {
        return { status: 200, body: { success: true, data: { url: 'https://r2.example.com/shares/share_auto/media/x.jpg' } } };
      }
      if (req.method === 'POST' && req.url.endsWith('/api/share')) {
        return { status: 200, body: { success: true, data: { shareId, shareUrl: 'u', passwordProtected: false } } };
      }
      return { status: 200, body: { success: true } };
    });

    const result = await client.updateShareWithMedia(shareId, postData, {});

    const resolveCalls = captured.filter(c => c.url.endsWith('/api/share/resolve-media'));
    expect(resolveCalls).toHaveLength(0);
    const uploadCalls = captured.filter(c => c.method === 'POST' && c.url.endsWith('/api/upload-share-media'));
    expect(uploadCalls).toHaveLength(1);

    expect(result.mediaStats).toEqual({
      totalCount: 1,
      uploadedCount: 1,
      reusedCount: 0,
      keptCount: 0,
      skippedCount: 0,
    });
  });

  it('falls back to legacy upload when resolve-media endpoint errors (fail-open)', async () => {
    const postData = makePostData({ mediaCount: 1 });

    installHandler(captured, (req) => {
      if (req.method === 'GET' && req.url.endsWith(`/api/share/${shareId}`)) {
        return { status: 200, body: { success: true, data: { shareId, media: [] } } };
      }
      if (req.method === 'POST' && req.url.endsWith('/api/share/resolve-media')) {
        return { status: 500, body: { message: 'upstream boom' } };
      }
      if (req.method === 'POST' && req.url.endsWith('/api/upload-share-media')) {
        return { status: 200, body: { success: true, data: { url: 'https://r2.example.com/shares/share_auto/media/x.jpg' } } };
      }
      if (req.method === 'POST' && req.url.endsWith('/api/share')) {
        return { status: 200, body: { success: true, data: { shareId, shareUrl: 'u', passwordProtected: false } } };
      }
      return { status: 200, body: { success: true } };
    });

    const result = await client.updateShareWithMedia(shareId, postData, {
      sourceArchiveId: archiveId,
      mediaSourceUrls: ['https://cdn.example.com/a.jpg'],
    });

    // One resolve attempt → failed → one legacy upload happened
    expect(captured.filter(c => c.url.endsWith('/api/share/resolve-media')).length).toBeGreaterThanOrEqual(1);
    const uploadCalls = captured.filter(c => c.method === 'POST' && c.url.endsWith('/api/upload-share-media'));
    expect(uploadCalls).toHaveLength(1);

    // Fail-open stats: resolve returned nothing, so reusedCount stays 0 and
    // the item was uploaded normally.
    expect(result.mediaStats).toEqual({
      totalCount: 1,
      uploadedCount: 1,
      reusedCount: 0,
      keptCount: 0,
      skippedCount: 0,
    });
  });
});
