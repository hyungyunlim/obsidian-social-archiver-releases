import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ShareAPIClient, type ShareAPIRequest, type ShareAPIResponse } from '@/services/ShareAPIClient';
import type { PostData } from '@/types/post';
import {
  RateLimitError,
  AuthenticationError,
  InvalidRequestError,
  ServerError,
  NetworkError,
  TimeoutError
} from '@/types/errors/http-errors';
import { __setRequestUrlHandler } from 'obsidian';

type RequestHandler = (params: any) => Promise<any>;

// Queue-based handler that processes responses in order
class MockQueue {
  private queue: RequestHandler[] = [];

  add(handler: RequestHandler) {
    this.queue.push(handler);
  }

  install() {
    __setRequestUrlHandler(async (params) => {
      const handler = this.queue.shift();
      if (handler) {
        return handler(params);
      }
      throw new Error('No more mock responses in queue');
    });
  }

  clear() {
    this.queue = [];
    __setRequestUrlHandler(null);
  }
}

function makeResponse(status: number, data: unknown, headers: Record<string, string> = {}) {
  return async () => ({
    status,
    headers,
    json: typeof data === 'object' ? data : {},
    text: typeof data === 'string' ? data : JSON.stringify(data),
    arrayBuffer: new ArrayBuffer(0),
  });
}

function wrap<T>(data: T): { success: boolean; data: T } {
  return { success: true, data };
}

describe('ShareAPIClient', () => {
  let client: ShareAPIClient;
  let mock: MockQueue;

  beforeEach(() => {
    mock = new MockQueue();
    mock.install();
    client = new ShareAPIClient({
      baseURL: 'https://api.test.com',
      apiKey: 'test-api-key',
      timeout: 5000,
      maxRetries: 3,
      retryDelay: 10 // Short delay for tests
    });
  });

  afterEach(() => {
    mock.clear();
  });

  describe('createShare', () => {
    it('should create a share successfully', async () => {
      const mockPostData: PostData = {
        platform: 'facebook',
        id: 'test-id',
        url: 'https://example.com/post',
        author: {
          name: 'Test User',
          url: 'https://example.com/user',
          handle: '@testuser'
        },
        content: {
          text: 'Test post content'
        },
        media: [],
        metadata: {
          timestamp: new Date(),
          likes: 10,
          comments: 5,
          shares: 2
        }
      };

      const request: ShareAPIRequest = {
        postData: mockPostData,
        options: { username: 'testuser' }
      };

      const responseData: ShareAPIResponse = {
        shareId: 'share_123',
        shareUrl: 'https://share.test.com/share_123',
        passwordProtected: false
      };

      const captured: any[] = [];
      mock.add(async (params) => {
        captured.push(params);
        return makeResponse(200, wrap(responseData))();
      });

      const result = await client.createShare(request);

      expect(result).toEqual(responseData);
      expect(captured[0].headers['Authorization']).toBe('Bearer test-api-key');
      expect(captured[0].headers['X-License-Key']).toBe('test-api-key');
    });

    it('should handle legacy format', async () => {
      const request: ShareAPIRequest = {
        content: 'Test content',
        metadata: {
          title: 'Test Post',
          platform: 'twitter',
          author: 'Test User',
          originalUrl: 'https://example.com/post',
          tags: ['test', 'demo']
        }
      };

      const responseData: ShareAPIResponse = {
        shareId: 'share_456',
        shareUrl: 'https://share.test.com/share_456',
        passwordProtected: false
      };

      const captured: any[] = [];
      mock.add(async (params) => {
        captured.push(params);
        return makeResponse(200, wrap(responseData))();
      });

      const result = await client.createShare(request);

      expect(result).toEqual(responseData);
      expect(captured[0].body).toBe(JSON.stringify(request));
    });

    it('should include password protection', async () => {
      const request: ShareAPIRequest = {
        content: 'Protected content',
        metadata: {
          title: 'Protected Post',
          platform: 'facebook',
          author: 'Test User',
          originalUrl: 'https://example.com/post'
        }
      };

      const protectedRequest = ShareAPIClient.addPasswordProtection(request, 'secretPassword123');

      const responseData: ShareAPIResponse = {
        shareId: 'share_789',
        shareUrl: 'https://share.test.com/share_789',
        passwordProtected: true
      };

      const captured: any[] = [];
      mock.add(async (params) => {
        captured.push(params);
        return makeResponse(200, wrap(responseData))();
      });

      const result = await client.createShare(protectedRequest);

      expect(result.passwordProtected).toBe(true);
      const body = JSON.parse(captured[0].body);
      expect(body.options.password).toBe('secretPassword123');
    });

    it('should set custom expiry date for pro users', async () => {
      const request: ShareAPIRequest = { content: 'Pro content' };

      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      const expiringRequest = ShareAPIClient.setExpiryDate(request, futureDate, 'pro');

      const expectedExpiry = Math.floor(futureDate.getTime() / 1000);
      const responseData: ShareAPIResponse = {
        shareId: 'share_pro',
        shareUrl: 'https://share.test.com/share_pro',
        expiresAt: expectedExpiry,
        passwordProtected: false
      };

      const captured: any[] = [];
      mock.add(async (params) => {
        captured.push(params);
        return makeResponse(200, wrap(responseData))();
      });

      const result = await client.createShare(expiringRequest);

      expect(result.expiresAt).toBe(expectedExpiry);
      const body = JSON.parse(captured[0].body);
      expect(body.options.expiry).toBe(expectedExpiry);
    });

    it('should enforce 30-day limit for free users', () => {
      const request: ShareAPIRequest = { content: 'Free content' };
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 45);

      expect(() => {
        ShareAPIClient.setExpiryDate(request, futureDate, 'free');
      }).toThrow('Free tier: Maximum expiry is 30 days');
    });

    it('should reject past expiry dates', () => {
      const request: ShareAPIRequest = { content: 'Test content' };
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      expect(() => {
        ShareAPIClient.setExpiryDate(request, pastDate, 'pro');
      }).toThrow('Expiry date must be in the future');
    });
  });

  describe('updateShare', () => {
    it('should update an existing share', async () => {
      const shareId = 'share_123';
      const request: ShareAPIRequest = { content: 'Updated content' };

      const responseData: ShareAPIResponse = {
        shareId,
        shareUrl: `https://share.test.com/${shareId}`,
        passwordProtected: false
      };

      const captured: any[] = [];
      mock.add(async (params) => {
        captured.push(params);
        return makeResponse(200, wrap(responseData))();
      });

      const result = await client.updateShare(shareId, request);

      expect(result.shareId).toBe(shareId);
      const body = JSON.parse(captured[0].body);
      expect(body.options.shareId).toBe(shareId);
    });
  });

  describe('Error Handling', () => {
    it('should handle rate limiting with retry', async () => {
      const request: ShareAPIRequest = { content: 'Test' };

      // First request: rate limited (0 retry-after for fast test)
      mock.add(makeResponse(429, { message: 'Rate limit exceeded' }, { 'retry-after': '0' }));

      // Second request: success
      mock.add(makeResponse(200, wrap({
        shareId: 'share_retry',
        shareUrl: 'https://share.test.com/share_retry',
        passwordProtected: false
      })));

      const callCount = { count: 0 };
      const originalQueue = mock;
      __setRequestUrlHandler(async (params) => {
        callCount.count++;
        const handler = (originalQueue as any).queue.shift();
        if (handler) return handler(params);
        throw new Error('No more mock responses');
      });

      const result = await client.createShare(request);

      expect(result.shareId).toBe('share_retry');
      expect(callCount.count).toBe(2); // Original + 1 retry
    });

    it('should handle authentication errors without retry', async () => {
      const request: ShareAPIRequest = { content: 'Test' };
      const callCount = { count: 0 };

      __setRequestUrlHandler(async () => {
        callCount.count++;
        return {
          status: 401,
          headers: {},
          json: { message: 'Invalid API key' },
          text: '{"message":"Invalid API key"}',
          arrayBuffer: new ArrayBuffer(0),
        };
      });

      await expect(client.createShare(request)).rejects.toThrow(AuthenticationError);
      expect(callCount.count).toBe(1); // No retry for auth errors
    });

    it('should handle invalid request errors without retry', async () => {
      const request: ShareAPIRequest = { content: 'Test' };
      const callCount = { count: 0 };

      __setRequestUrlHandler(async () => {
        callCount.count++;
        return {
          status: 400,
          headers: {},
          json: { message: 'Invalid request', errors: ['Missing required field'] },
          text: '{"message":"Invalid request"}',
          arrayBuffer: new ArrayBuffer(0),
        };
      });

      await expect(client.createShare(request)).rejects.toThrow(InvalidRequestError);
      expect(callCount.count).toBe(1); // No retry for client errors
    });

    it('should retry on server errors with exponential backoff', async () => {
      const testClient = new ShareAPIClient({
        baseURL: 'https://api.test.com',
        maxRetries: 3,
        retryDelay: 10
      });

      const callCount = { count: 0 };
      const responses = [
        makeResponse(500, { message: 'Internal server error' }),
        makeResponse(503, { message: 'Service unavailable' }),
        makeResponse(200, wrap({
          shareId: 'share_success',
          shareUrl: 'https://share.test.com/share_success',
          passwordProtected: false
        })),
      ];

      __setRequestUrlHandler(async (params) => {
        const handler = responses[callCount.count++];
        if (handler) return handler(params);
        throw new Error('No more responses');
      });

      const result = await testClient.createShare({ content: 'Test' });

      expect(result.shareId).toBe('share_success');
      expect(callCount.count).toBe(3); // Original + 2 retries
    });

    it('should handle network errors with retry', async () => {
      const request: ShareAPIRequest = { content: 'Test' };
      let callCount = 0;

      __setRequestUrlHandler(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('ENOTFOUND api.test.com');
        }
        return {
          status: 200,
          headers: {},
          json: wrap({ shareId: 'share_network', shareUrl: 'https://share.test.com/share_network', passwordProtected: false }),
          text: '',
          arrayBuffer: new ArrayBuffer(0),
        };
      });

      const result = await client.createShare(request);

      expect(result.shareId).toBe('share_network');
      expect(callCount).toBe(2);
    });

    it('should fail after max retries', async () => {
      const request: ShareAPIRequest = { content: 'Test' };
      let callCount = 0;

      __setRequestUrlHandler(async () => {
        callCount++;
        return {
          status: 500,
          headers: {},
          json: { message: 'Server error' },
          text: '{"message":"Server error"}',
          arrayBuffer: new ArrayBuffer(0),
        };
      });

      await expect(client.createShare(request)).rejects.toThrow(ServerError);
      expect(callCount).toBe(3); // Original + 2 retries (maxRetries = 3)
    });
  });

  describe('deleteShare', () => {
    it('should delete a share', async () => {
      const shareId = 'share_delete';
      const captured: any[] = [];

      __setRequestUrlHandler(async (params) => {
        captured.push(params);
        return {
          status: 204,
          headers: {},
          json: {},
          text: '',
          arrayBuffer: new ArrayBuffer(0),
        };
      });

      await expect(client.deleteShare(shareId)).resolves.toBeUndefined();
      expect(captured[0].method).toBe('DELETE');
      expect(captured[0].url).toBe(`https://api.test.com/api/share/${shareId}`);
    });

    it('should handle delete errors', async () => {
      const shareId = 'share_notfound';

      __setRequestUrlHandler(async () => ({
        status: 404,
        headers: {},
        json: { message: 'Share not found' },
        text: '{"message":"Share not found"}',
        arrayBuffer: new ArrayBuffer(0),
      }));

      await expect(client.deleteShare(shareId)).rejects.toThrow();
    });
  });

  describe('getShareInfo', () => {
    it('should get share information', async () => {
      const shareId = 'share_info';
      const responseData = {
        shareId,
        shareUrl: `https://share.test.com/${shareId}`,
        passwordProtected: false,
        expiresAt: Date.now() + 86400000
      };

      // Return direct (unwrapped) format to test that path
      __setRequestUrlHandler(async () => ({
        status: 200,
        headers: {},
        json: responseData,
        text: JSON.stringify(responseData),
        arrayBuffer: new ArrayBuffer(0),
      }));

      const result = await client.getShareInfo(shareId);

      expect(result.shareId).toBe(shareId);
      expect(result.shareUrl).toBe(responseData.shareUrl);
    });
  });

  describe('Request Headers', () => {
    it('should include required headers', async () => {
      const captured: any[] = [];
      __setRequestUrlHandler(async (params) => {
        captured.push(params);
        return {
          status: 200,
          headers: {},
          json: wrap({ shareId: 'share_headers', shareUrl: '', passwordProtected: false }),
          text: '',
          arrayBuffer: new ArrayBuffer(0),
        };
      });

      await client.createShare({ content: 'Test' });

      const headers = captured[0].headers as Record<string, string>;
      expect(headers).toHaveProperty('Content-Type', 'application/json');
      expect(headers).toHaveProperty('X-Client', 'obsidian-plugin');
      expect(headers).toHaveProperty('X-Request-Id');
      expect(headers['X-Request-Id']).toMatch(/^req_\d+_[a-z0-9]+$/);
    });

    it('should work without API key', async () => {
      const clientNoAuth = new ShareAPIClient({
        baseURL: 'https://api.test.com'
      });

      const captured: any[] = [];
      __setRequestUrlHandler(async (params) => {
        captured.push(params);
        return {
          status: 200,
          headers: {},
          json: wrap({ shareId: 'share_noauth', shareUrl: '', passwordProtected: false }),
          text: '',
          arrayBuffer: new ArrayBuffer(0),
        };
      });

      await clientNoAuth.createShare({ content: 'Test' });

      const headers = captured[0].headers as Record<string, string>;
      expect(headers).not.toHaveProperty('Authorization');
      expect(headers).not.toHaveProperty('X-License-Key');
    });
  });

  describe('Service Interface', () => {
    it('should implement IService interface', async () => {
      expect(client.name).toBe('ShareAPIClient');
      expect(client.isInitialized()).toBe(true);
      await expect(client.initialize()).resolves.toBeUndefined();
      await expect(client.cleanup()).resolves.toBeUndefined();
    });
  });
});
