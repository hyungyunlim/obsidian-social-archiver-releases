import { __setRequestUrlHandler } from 'obsidian';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkersAPIClient } from '@/services/WorkersAPIClient';

interface CapturedRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

afterEach(() => __setRequestUrlHandler(null));

function createClient(): WorkersAPIClient {
  const client = new WorkersAPIClient({
    endpoint: 'https://worker.example',
    authToken: 'user-token',
    clientId: 'obsidian-client',
  });
  client.initialize();
  return client;
}

/** Capture the outgoing request and reply with a fixed success envelope. */
function captureRequest(reply: unknown): { calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  __setRequestUrlHandler(async (params: CapturedRequest) => {
    calls.push({ url: params.url, method: params.method, headers: params.headers, body: params.body });
    return { status: 200, headers: {}, text: '', json: reply, arrayBuffer: new ArrayBuffer(0) };
  });
  return { calls };
}

describe('WorkersAPIClient sync-queue v2 capabilities', () => {
  it('requests a v2 page with protocolVersion, cursor, limit, and the capability header', async () => {
    const { calls } = captureRequest({
      success: true,
      data: { items: [{ queueId: 'q1', archiveId: 'a1', versionToken: 'v1' }], nextCursor: 'c2', hasMore: true },
    });

    const page = await createClient().getSyncQueueV2('client-1', { cursor: 'c1', limit: 50 });

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe('c2');
    expect(page.hasMore).toBe(true);

    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/api/sync/queue');
    expect(url.searchParams.get('clientId')).toBe('client-1');
    expect(url.searchParams.get('protocolVersion')).toBe('2');
    expect(url.searchParams.get('cursor')).toBe('c1');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(calls[0].headers?.['X-Sync-Queue-Capabilities']).toContain('version-token-v1');
    expect(calls[0].headers?.['X-Sync-Queue-Capabilities']).toContain('mutation-id-v1');
  });

  it('omits the cursor for a first-page v2 request', async () => {
    const { calls } = captureRequest({ success: true, data: { items: [], nextCursor: null, hasMore: false } });

    await createClient().getSyncQueueV2('client-1');

    expect(new URL(calls[0].url).searchParams.has('cursor')).toBe(false);
  });

  it('echoes the per-item version token and a stable mutation id when acking', async () => {
    const { calls } = captureRequest({ success: true, data: { versionToken: 'v-next' } });

    const result = await createClient().ackSyncItemV2('q1', 'client-1', 'v-current', 'mut-1');

    expect(result.versionToken).toBe('v-next');
    const ack = calls[0];
    expect(new URL(ack.url).pathname).toBe('/api/sync/queue/ack');
    expect(ack.method).toBe('POST');
    expect(ack.headers?.['X-Sync-Version-Token']).toBe('v-current');
    expect(ack.headers?.['X-Sync-Mutation-Id']).toBe('mut-1');
    expect(JSON.parse(ack.body ?? '{}')).toMatchObject({ queueId: 'q1', clientId: 'client-1' });
  });

  it('replays a lost ack with the SAME mutation id (server returns the same version token)', async () => {
    // Server behaviour: a replayed mutation id yields the identical version token.
    __setRequestUrlHandler(async (params: CapturedRequest) => {
      const mutationId = params.headers?.['X-Sync-Mutation-Id'];
      return {
        status: 200,
        headers: {},
        text: '',
        json: { success: true, data: { versionToken: `token-for-${mutationId}` } },
        arrayBuffer: new ArrayBuffer(0),
      };
    });

    const client = createClient();
    const first = await client.ackSyncItemV2('q1', 'client-1', 'v-current', 'mut-stable');
    const replay = await client.ackSyncItemV2('q1', 'client-1', 'v-current', 'mut-stable');

    expect(replay.versionToken).toBe(first.versionToken);
  });

  it('advertises sync-queue v2 + unified-v1 registry capabilities and an idempotency key on registration', async () => {
    const { calls } = captureRequest({
      success: true,
      data: { clientId: 'client-1', clientType: 'obsidian', clientName: 'Vault' },
    });

    await createClient().registerSyncClientWithIdempotency(
      { clientType: 'obsidian', clientName: 'Vault' },
      'install-key-42',
    );

    const register = calls[0];
    expect(new URL(register.url).pathname).toBe('/api/sync/clients');
    expect(register.headers?.['X-Idempotency-Key']).toBe('install-key-42');
    const body = JSON.parse(register.body ?? '{}');
    expect(body.idempotencyKey).toBe('install-key-42');
    const capabilities = body.settings?.capabilities ?? {};
    expect(capabilities.syncQueue).toEqual(expect.arrayContaining(['version-token-v1', 'mutation-id-v1', 'v2-pagination-v1']));
    expect(capabilities.executor).toContain('unified-v1');
  });
});
