import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ShareAPIClient } from '@/services/ShareAPIClient';
import type {
  ResolveShareMediaResponse,
  ResolveShareMediaHint,
} from '@/types/share';
import { __setRequestUrlHandler } from 'obsidian';

// ─── Minimal queue-based request mock (mirrors ShareAPIClient.test.ts) ──

type RequestHandler = (params: any) => Promise<any>;

class MockQueue {
  private queue: RequestHandler[] = [];

  add(handler: RequestHandler) {
    this.queue.push(handler);
  }

  install() {
    __setRequestUrlHandler(async (params) => {
      const handler = this.queue.shift();
      if (handler) return handler(params);
      throw new Error('No more mock responses in queue');
    });
  }

  clear() {
    this.queue = [];
    __setRequestUrlHandler(null);
  }
}

function respond(status: number, data: unknown, headers: Record<string, string> = {}) {
  return async () => ({
    status,
    headers,
    json: typeof data === 'object' && data !== null ? data : {},
    text: typeof data === 'string' ? data : JSON.stringify(data),
    arrayBuffer: new ArrayBuffer(0),
  });
}

function wrap<T>(data: T): { success: boolean; data: T } {
  return { success: true, data };
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('ShareAPIClient.resolveShareMedia', () => {
  let client: ShareAPIClient;
  let mock: MockQueue;

  beforeEach(() => {
    mock = new MockQueue();
    mock.install();
    client = new ShareAPIClient({
      baseURL: 'https://api.test.com',
      apiKey: 'test-api-key',
      maxRetries: 1,
      retryDelay: 1,
    });
  });

  afterEach(() => {
    mock.clear();
  });

  it('returns parsed response when worker returns wrapped { success, data }', async () => {
    const hints: ResolveShareMediaHint[] = [
      { sourceIndex: 0, originalUrl: 'https://cdn.example.com/a.jpg', variant: 'primary' },
      { sourceIndex: 1, originalUrl: 'https://cdn.example.com/b.jpg', variant: 'primary' },
    ];

    const payload: ResolveShareMediaResponse = {
      archiveId: 'arc_1',
      preservationStatus: 'completed',
      resolvedCount: 2,
      totalCount: 2,
      resolved: [
        {
          sourceIndex: 0,
          variant: 'primary',
          url: 'https://r2.example.com/archives/u/arc_1/media/0.jpg',
          r2Key: 'archives/u/arc_1/media/0.jpg',
          contentType: 'image/jpeg',
          size: 123,
        },
        {
          sourceIndex: 1,
          variant: 'primary',
          url: 'https://r2.example.com/archives/u/arc_1/media/1.jpg',
          r2Key: 'archives/u/arc_1/media/1.jpg',
          contentType: 'image/jpeg',
        },
      ],
    };

    const captured: any[] = [];
    mock.add(async (params) => {
      captured.push(params);
      return respond(200, wrap(payload))();
    });

    const result = await client.resolveShareMedia('arc_1', hints);

    expect(result).toEqual(payload);
    expect(captured[0].method).toBe('POST');
    expect(captured[0].url).toBe('https://api.test.com/api/share/resolve-media');
    const body = JSON.parse(captured[0].body);
    expect(body.archiveId).toBe('arc_1');
    expect(body.items).toHaveLength(2);
    expect(body.items[0].originalUrl).toBe('https://cdn.example.com/a.jpg');
  });

  it('also accepts unwrapped response body', async () => {
    const payload: ResolveShareMediaResponse = {
      archiveId: 'arc_2',
      preservationStatus: 'partial',
      resolvedCount: 1,
      totalCount: 2,
      resolved: [
        {
          sourceIndex: 0,
          variant: 'primary',
          url: 'https://r2.example.com/archives/u/arc_2/media/0.jpg',
          r2Key: 'archives/u/arc_2/media/0.jpg',
          contentType: 'image/jpeg',
        },
        null,
      ],
    };

    mock.add(respond(200, payload));

    const result = await client.resolveShareMedia('arc_2', [
      { sourceIndex: 0, originalUrl: 'https://cdn.example.com/a.jpg' },
      { sourceIndex: 1, originalUrl: 'https://cdn.example.com/b.jpg' },
    ]);

    expect(result?.preservationStatus).toBe('partial');
    expect(result?.resolved[1]).toBeNull();
    expect(result?.resolved[0]?.r2Key).toBe('archives/u/arc_2/media/0.jpg');
  });

  it('returns null when archiveId is empty or items array is empty (no network call)', async () => {
    const r1 = await client.resolveShareMedia('', [{ sourceIndex: 0 }]);
    const r2 = await client.resolveShareMedia('arc_x', []);

    expect(r1).toBeNull();
    expect(r2).toBeNull();
  });

  it('returns null on HTTP error (fail-open)', async () => {
    mock.add(respond(500, { message: 'boom' }));

    const result = await client.resolveShareMedia('arc_3', [{ sourceIndex: 0 }]);

    expect(result).toBeNull();
  });

  it('returns null on 4xx error (fail-open, e.g. endpoint not yet deployed)', async () => {
    mock.add(respond(404, { message: 'not found' }));

    const result = await client.resolveShareMedia('arc_4', [{ sourceIndex: 0 }]);

    expect(result).toBeNull();
  });

  it('returns null when payload shape is malformed', async () => {
    // Missing required fields (archiveId string, resolved array, counts)
    mock.add(respond(200, wrap({ archiveId: 42, resolved: 'nope' })));

    const result = await client.resolveShareMedia('arc_5', [{ sourceIndex: 0 }]);

    expect(result).toBeNull();
  });

  it('returns null when response is null/empty body', async () => {
    mock.add(respond(200, wrap(null as unknown as ResolveShareMediaResponse)));

    const result = await client.resolveShareMedia('arc_6', [{ sourceIndex: 0 }]);

    expect(result).toBeNull();
  });
});
