import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setRequestUrlHandler } from 'obsidian';
import { WorkersAPIClient } from '@/services/WorkersAPIClient';

function makeClient(): WorkersAPIClient {
  const client = new WorkersAPIClient({
    endpoint: 'https://api.test.com',
    authToken: 'test-token',
    pluginVersion: '4.7.2',
  });
  client.initialize();
  return client;
}

describe('WorkersAPIClient.proxyMedia', () => {
  beforeEach(() => __setRequestUrlHandler(null));
  afterEach(() => __setRequestUrlHandler(null));

  it('accepts a 206 body — the proxy adds its own Range header upstream', async () => {
    const body = new Uint8Array([1, 2, 3, 4]).buffer;
    __setRequestUrlHandler(async () => ({ status: 206, headers: {}, arrayBuffer: body, text: '' }));

    const result = await makeClient().proxyMedia('https://scontent.cdninstagram.com/v.mp4');

    expect(result.byteLength).toBe(4);
  });

  it('still rejects a non-2xx proxy answer', async () => {
    __setRequestUrlHandler(async () => ({ status: 403, headers: {}, arrayBuffer: new ArrayBuffer(0), text: 'blocked' }));

    await expect(makeClient().proxyMedia('https://scontent.cdninstagram.com/v.mp4'))
      .rejects.toThrow(/403/);
  });
});
