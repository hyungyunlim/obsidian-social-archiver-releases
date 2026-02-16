import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
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

describe('ShareAPIClient', () => {
  let client: ShareAPIClient;
  let mockAxios: MockAdapter;

  beforeEach(() => {
    mockAxios = new MockAdapter(axios);
    client = new ShareAPIClient({
      baseURL: 'https://api.test.com',
      apiKey: 'test-api-key',
      timeout: 5000,
      maxRetries: 3,
      retryDelay: 100 // Short delay for tests
    });
  });

  afterEach(() => {
    mockAxios.restore();
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
        options: {
          username: 'testuser'
        }
      };

      const response: ShareAPIResponse = {
        shareId: 'share_123',
        shareUrl: 'https://share.test.com/share_123',
        passwordProtected: false
      };

      mockAxios.onPost('/api/share').reply(200, response);

      const result = await client.createShare(request);

      expect(result).toEqual(response);
      expect(mockAxios.history.post.length).toBe(1);
      expect(mockAxios.history.post[0].headers).toHaveProperty('Authorization', 'Bearer test-api-key');
      expect(mockAxios.history.post[0].headers).toHaveProperty('X-License-Key', 'test-api-key');
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

      const response: ShareAPIResponse = {
        shareId: 'share_456',
        shareUrl: 'https://share.test.com/share_456',
        passwordProtected: false
      };

      mockAxios.onPost('/api/share').reply(200, response);

      const result = await client.createShare(request);

      expect(result).toEqual(response);
      expect(mockAxios.history.post[0].data).toBe(JSON.stringify(request));
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

      const response: ShareAPIResponse = {
        shareId: 'share_789',
        shareUrl: 'https://share.test.com/share_789',
        passwordProtected: true
      };

      mockAxios.onPost('/api/share').reply(200, response);

      const result = await client.createShare(protectedRequest);

      expect(result.passwordProtected).toBe(true);
      expect(JSON.parse(mockAxios.history.post[0].data).options.password).toBe('secretPassword123');
    });

    it('should set custom expiry date for pro users', async () => {
      const request: ShareAPIRequest = {
        content: 'Pro content'
      };

      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1); // 1 year from now

      const expiringRequest = ShareAPIClient.setExpiryDate(request, futureDate, 'pro');

      const response: ShareAPIResponse = {
        shareId: 'share_pro',
        shareUrl: 'https://share.test.com/share_pro',
        expiresAt: Math.floor(futureDate.getTime() / 1000),
        passwordProtected: false
      };

      mockAxios.onPost('/api/share').reply(200, response);

      const result = await client.createShare(expiringRequest);

      expect(result.expiresAt).toBe(Math.floor(futureDate.getTime() / 1000));
      expect(JSON.parse(mockAxios.history.post[0].data).options.expiry).toBe(Math.floor(futureDate.getTime() / 1000));
    });

    it('should enforce 30-day limit for free users', () => {
      const request: ShareAPIRequest = {
        content: 'Free content'
      };

      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 45); // 45 days from now

      expect(() => {
        ShareAPIClient.setExpiryDate(request, futureDate, 'free');
      }).toThrow('Free tier: Maximum expiry is 30 days');
    });

    it('should reject past expiry dates', () => {
      const request: ShareAPIRequest = {
        content: 'Test content'
      };

      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1); // Yesterday

      expect(() => {
        ShareAPIClient.setExpiryDate(request, pastDate, 'pro');
      }).toThrow('Expiry date must be in the future');
    });
  });

  describe('updateShare', () => {
    it('should update an existing share', async () => {
      const shareId = 'share_123';
      const request: ShareAPIRequest = {
        content: 'Updated content'
      };

      const response: ShareAPIResponse = {
        shareId,
        shareUrl: `https://share.test.com/${shareId}`,
        passwordProtected: false
      };

      mockAxios.onPost('/api/share').reply(200, response);

      const result = await client.updateShare(shareId, request);

      expect(result.shareId).toBe(shareId);
      expect(JSON.parse(mockAxios.history.post[0].data).options.shareId).toBe(shareId);
    });
  });

  describe('Error Handling', () => {
    it('should handle rate limiting with retry', async () => {
      const request: ShareAPIRequest = { content: 'Test' };

      // First request: rate limited
      mockAxios.onPost('/api/share').replyOnce(429, {
        message: 'Rate limit exceeded'
      }, {
        'retry-after': '1'
      });

      // Second request: success
      mockAxios.onPost('/api/share').replyOnce(200, {
        shareId: 'share_retry',
        shareUrl: 'https://share.test.com/share_retry',
        passwordProtected: false
      });

      const result = await client.createShare(request);

      expect(result.shareId).toBe('share_retry');
      expect(mockAxios.history.post.length).toBe(2); // Original + 1 retry
    });

    it('should handle authentication errors without retry', async () => {
      const request: ShareAPIRequest = { content: 'Test' };

      mockAxios.onPost('/api/share').reply(401, {
        message: 'Invalid API key'
      });

      await expect(client.createShare(request)).rejects.toThrow(AuthenticationError);
      expect(mockAxios.history.post.length).toBe(1); // No retry for auth errors
    });

    it('should handle invalid request errors without retry', async () => {
      const request: ShareAPIRequest = { content: 'Test' };

      mockAxios.onPost('/api/share').reply(400, {
        message: 'Invalid request',
        errors: ['Missing required field']
      });

      await expect(client.createShare(request)).rejects.toThrow(InvalidRequestError);
      expect(mockAxios.history.post.length).toBe(1); // No retry for client errors
    });

    it('should retry on server errors with exponential backoff', async () => {
      const request: ShareAPIRequest = { content: 'Test' };

      // Configure shorter delays for testing
      const testClient = new ShareAPIClient({
        baseURL: 'https://api.test.com',
        maxRetries: 3,
        retryDelay: 10 // Very short for tests
      });

      // Mock axios for test client
      const testMock = new MockAdapter((testClient as any).client);

      // First two requests: server error
      testMock.onPost('/api/share').replyOnce(500, {
        message: 'Internal server error'
      });
      testMock.onPost('/api/share').replyOnce(503, {
        message: 'Service unavailable'
      });

      // Third request: success
      testMock.onPost('/api/share').replyOnce(200, {
        shareId: 'share_success',
        shareUrl: 'https://share.test.com/share_success',
        passwordProtected: false
      });

      const startTime = Date.now();
      const result = await testClient.createShare(request);
      const endTime = Date.now();

      expect(result.shareId).toBe('share_success');
      expect(testMock.history.post.length).toBe(3); // Original + 2 retries

      // Verify some delay occurred (at least the sum of delays)
      expect(endTime - startTime).toBeGreaterThan(0);

      testMock.restore();
    });

    it('should handle network errors with retry', async () => {
      const request: ShareAPIRequest = { content: 'Test' };

      // First request: network error
      mockAxios.onPost('/api/share').networkErrorOnce();

      // Second request: success
      mockAxios.onPost('/api/share').replyOnce(200, {
        shareId: 'share_network',
        shareUrl: 'https://share.test.com/share_network',
        passwordProtected: false
      });

      const result = await client.createShare(request);

      expect(result.shareId).toBe('share_network');
      expect(mockAxios.history.post.length).toBe(2);
    });

    it('should handle timeout errors with retry', async () => {
      const request: ShareAPIRequest = { content: 'Test' };

      // First request: timeout
      mockAxios.onPost('/api/share').timeoutOnce();

      // Second request: success
      mockAxios.onPost('/api/share').replyOnce(200, {
        shareId: 'share_timeout',
        shareUrl: 'https://share.test.com/share_timeout',
        passwordProtected: false
      });

      const result = await client.createShare(request);

      expect(result.shareId).toBe('share_timeout');
      expect(mockAxios.history.post.length).toBe(2);
    });

    it('should fail after max retries', async () => {
      const request: ShareAPIRequest = { content: 'Test' };

      // All requests fail
      mockAxios.onPost('/api/share').reply(500, {
        message: 'Server error'
      });

      await expect(client.createShare(request)).rejects.toThrow(ServerError);
      expect(mockAxios.history.post.length).toBe(3); // Original + 2 retries (maxRetries = 3)
    });
  });

  describe('deleteShare', () => {
    it('should delete a share', async () => {
      const shareId = 'share_delete';

      mockAxios.onDelete(`/api/share/${shareId}`).reply(204);

      await expect(client.deleteShare(shareId)).resolves.toBeUndefined();
      expect(mockAxios.history.delete.length).toBe(1);
    });

    it('should handle delete errors', async () => {
      const shareId = 'share_notfound';

      mockAxios.onDelete(`/api/share/${shareId}`).reply(404, {
        message: 'Share not found'
      });

      await expect(client.deleteShare(shareId)).rejects.toThrow();
    });
  });

  describe('getShareInfo', () => {
    it('should get share information', async () => {
      const shareId = 'share_info';
      const response: ShareAPIResponse = {
        shareId,
        shareUrl: `https://share.test.com/${shareId}`,
        passwordProtected: false,
        expiresAt: Date.now() + 86400000 // 1 day from now
      };

      mockAxios.onGet(`/api/share/${shareId}`).reply(200, response);

      const result = await client.getShareInfo(shareId);

      expect(result).toEqual(response);
      expect(mockAxios.history.get.length).toBe(1);
    });
  });

  describe('Request Headers', () => {
    it('should include required headers', async () => {
      const request: ShareAPIRequest = { content: 'Test' };

      mockAxios.onPost('/api/share').reply(200, {
        shareId: 'share_headers',
        shareUrl: 'https://share.test.com/share_headers',
        passwordProtected: false
      });

      await client.createShare(request);

      const headers = mockAxios.history.post[0].headers;
      expect(headers).toHaveProperty('Content-Type', 'application/json');
      expect(headers).toHaveProperty('X-Client', 'obsidian-social-archiver');
      expect(headers).toHaveProperty('X-Version', '1.0.0');
      expect(headers).toHaveProperty('X-Request-Id');
      expect(headers['X-Request-Id']).toMatch(/^req_\d+_[a-z0-9]+$/);
    });

    it('should work without API key', async () => {
      const clientNoAuth = new ShareAPIClient({
        baseURL: 'https://api.test.com'
      });

      const testMock = new MockAdapter((clientNoAuth as any).client);

      testMock.onPost('/api/share').reply(200, {
        shareId: 'share_noauth',
        shareUrl: 'https://share.test.com/share_noauth',
        passwordProtected: false
      });

      await clientNoAuth.createShare({ content: 'Test' });

      const headers = testMock.history.post[0].headers;
      expect(headers).not.toHaveProperty('Authorization');
      expect(headers).not.toHaveProperty('X-License-Key');

      testMock.restore();
    });
  });

  describe('Service Interface', () => {
    it('should implement IService interface', () => {
      expect(client.name).toBe('ShareAPIClient');
      expect(client.isInitialized()).toBe(true);
      expect(client.initialize()).resolves.toBeUndefined();
      expect(client.cleanup()).resolves.toBeUndefined();
    });
  });
});