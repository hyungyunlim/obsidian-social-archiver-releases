import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setRequestUrlHandler } from 'obsidian';
import { WorkersAPIClient } from '@/services/WorkersAPIClient';

function makeClient(): WorkersAPIClient {
  const client = new WorkersAPIClient({
    endpoint: 'https://api.test.com',
    authToken: 'test-token',
    pluginVersion: '4.1.7',
  });
  client.initialize();
  return client;
}

describe('WorkersAPIClient not-found logging', () => {
  beforeEach(() => {
    __setRequestUrlHandler(null);
  });

  afterEach(() => {
    __setRequestUrlHandler(null);
    vi.restoreAllMocks();
  });

  it('does not log expected ARCHIVE_NOT_FOUND responses as console errors', async () => {
    __setRequestUrlHandler(async () => ({
      status: 404,
      headers: {},
      json: {
        success: false,
        error: {
          code: 'ARCHIVE_NOT_FOUND',
          message: 'Archive not found',
        },
      },
      text: '',
      arrayBuffer: new ArrayBuffer(0),
    }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const client = makeClient();

    await expect(client.getUserArchive('missing-archive')).rejects.toMatchObject({
      code: 'ARCHIVE_NOT_FOUND',
      status: 404,
    });

    expect(errorSpy).not.toHaveBeenCalledWith('[WorkersAPIClient] Request failed:', expect.anything());
    expect(debugSpy).toHaveBeenCalledWith(
      '[WorkersAPIClient] Request failed:',
      expect.objectContaining({ code: 'ARCHIVE_NOT_FOUND', status: 404 }),
    );
  });
});
