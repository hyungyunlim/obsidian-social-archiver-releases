import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BrightDataClient } from '@/services/BrightDataClient';
import type { RetryableHttpClient } from '@/services/RetryableHttpClient';
import type { Logger } from '@/services/Logger';
import type { HttpResponse } from '@/types/brightdata';
import type {
	FacebookPostData,
	InstagramPostData,
	LinkedInPostData,
	TikTokPostData,
	XPostData,
	ThreadsPostData,
} from '@/types/brightdata-client';
import { InvalidURLError } from '@/types/errors/http-errors';

describe('BrightDataClient', () => {
	let client: BrightDataClient;
	let mockHttpClient: RetryableHttpClient;
	let mockLogger: Logger;

	beforeEach(() => {
		mockHttpClient = {
			post: vi.fn(),
			get: vi.fn(),
			put: vi.fn(),
			delete: vi.fn(),
			patch: vi.fn(),
		} as unknown as RetryableHttpClient;

		mockLogger = {
			info: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
			debug: vi.fn(),
		} as unknown as Logger;

		client = new BrightDataClient(mockHttpClient, mockLogger, {
			apiKey: 'test-api-key',
			baseURL: 'https://api.test.com',
		});
	});

	describe('Service lifecycle', () => {
		it('should initialize', async () => {
			await client.initialize();
			expect(mockLogger.info).toHaveBeenCalledWith(
				'BrightDataClient initialized',
				expect.any(Object)
			);
		});

		it('should shutdown', async () => {
			await client.shutdown();
			expect(mockLogger.info).toHaveBeenCalledWith('BrightDataClient shutdown');
		});
	});

	describe('scrapeFacebook', () => {
		const mockFacebookData: FacebookPostData = {
			platform: 'facebook',
			id: '123456789',
			url: 'https://www.facebook.com/user/posts/123456789',
			author: {
				id: 'user123',
				name: 'John Doe',
				url: 'https://www.facebook.com/user123',
			},
			text: 'Test post content',
			timestamp: new Date('2024-01-01'),
			media: [],
			comments: [],
			likes: 100,
			shares: 50,
			reactions: {
				like: 50,
				love: 30,
				total: 100,
			},
		};

		it('should scrape Facebook post successfully', async () => {
			const mockResponse: HttpResponse<FacebookPostData> = {
				data: mockFacebookData,
				status: 200,
				statusText: 'OK',
				headers: {},
				config: {} as any,
				duration: 1500,
			};

			vi.mocked(mockHttpClient.post).mockResolvedValue(mockResponse);

			const result = await client.scrapeFacebook(
				'https://www.facebook.com/user/posts/123456789'
			);

			expect(result.success).toBe(true);
			expect(result.data).toEqual(mockFacebookData);
			expect(result.metadata.duration).toBe(1500);
			expect(mockLogger.info).toHaveBeenCalledWith('Scraping Facebook post', expect.any(Object));
		});

		it('should canonicalize Facebook permalink URL', async () => {
			const mockResponse: HttpResponse<FacebookPostData> = {
				data: mockFacebookData,
				status: 200,
				statusText: 'OK',
				headers: {},
				config: {} as any,
				duration: 1000,
			};

			vi.mocked(mockHttpClient.post).mockResolvedValue(mockResponse);

			await client.scrapeFacebook('https://www.facebook.com/permalink.php?story_fbid=123456789');

			expect(mockHttpClient.post).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					postId: '123456789',
				}),
				expect.any(Object)
			);
		});

		it('should throw InvalidURLError for invalid Facebook URL', async () => {
			await expect(client.scrapeFacebook('https://www.facebook.com/invalid')).rejects.toThrow(
				InvalidURLError
			);
		});

		it('should include reactions when requested', async () => {
			const mockResponse: HttpResponse<FacebookPostData> = {
				data: mockFacebookData,
				status: 200,
				statusText: 'OK',
				headers: {},
				config: {} as any,
				duration: 1000,
			};

			vi.mocked(mockHttpClient.post).mockResolvedValue(mockResponse);

			await client.scrapeFacebook('https://www.facebook.com/user/posts/123456789', {
				includeReactions: true,
			});

			expect(mockHttpClient.post).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					includeReactions: true,
				}),
				expect.any(Object)
			);
		});
	});

	describe('scrapeInstagram', () => {
		const mockInstagramData: InstagramPostData = {
			platform: 'instagram',
			id: 'ABC123XYZ',
			url: 'https://www.instagram.com/p/ABC123XYZ/',
			author: {
				id: 'user456',
				name: 'Jane Doe',
				username: 'janedoe',
				url: 'https://www.instagram.com/janedoe/',
			},
			text: 'Instagram post caption',
			timestamp: new Date('2024-01-02'),
			media: [
				{
					type: 'photo',
					url: 'https://instagram.com/photo.jpg',
				},
			],
			comments: [],
			likes: 500,
			shares: 0,
			isCarousel: false,
		};

		it('should scrape Instagram post successfully', async () => {
			const mockResponse: HttpResponse<InstagramPostData> = {
				data: mockInstagramData,
				status: 200,
				statusText: 'OK',
				headers: {},
				config: {} as any,
				duration: 2000,
			};

			vi.mocked(mockHttpClient.post).mockResolvedValue(mockResponse);

			const result = await client.scrapeInstagram('https://www.instagram.com/p/ABC123XYZ/');

			expect(result.success).toBe(true);
			expect(result.data).toEqual(mockInstagramData);
			expect(mockLogger.info).toHaveBeenCalledWith(
				'Scraping Instagram post',
				expect.any(Object)
			);
		});

		it('should extract shortcode from Instagram URL', async () => {
			const mockResponse: HttpResponse<InstagramPostData> = {
				data: mockInstagramData,
				status: 200,
				statusText: 'OK',
				headers: {},
				config: {} as any,
				duration: 1000,
			};

			vi.mocked(mockHttpClient.post).mockResolvedValue(mockResponse);

			await client.scrapeInstagram('https://www.instagram.com/p/ABC123XYZ/');

			expect(mockHttpClient.post).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					shortcode: 'ABC123XYZ',
				}),
				expect.any(Object)
			);
		});

		it('should throw InvalidURLError for invalid Instagram URL', async () => {
			await expect(
				client.scrapeInstagram('https://www.instagram.com/invalid')
			).rejects.toThrow(InvalidURLError);
		});
	});

	describe('scrapeLinkedIn', () => {
		const mockLinkedInData: LinkedInPostData = {
			platform: 'linkedin',
			id: 'urn:li:activity:7654321',
			url: 'https://www.linkedin.com/feed/update/urn:li:activity:7654321/',
			author: {
				id: 'company123',
				name: 'Tech Company',
				url: 'https://www.linkedin.com/company/tech-company/',
			},
			text: 'LinkedIn post content',
			timestamp: new Date('2024-01-03'),
			media: [],
			comments: [],
			likes: 200,
			shares: 100,
			insights: {
				impressions: 5000,
				engagement: 300,
			},
		};

		it('should scrape LinkedIn post successfully', async () => {
			const mockResponse: HttpResponse<LinkedInPostData> = {
				data: mockLinkedInData,
				status: 200,
				statusText: 'OK',
				headers: {},
				config: {} as any,
				duration: 1800,
			};

			vi.mocked(mockHttpClient.post).mockResolvedValue(mockResponse);

			const result = await client.scrapeLinkedIn(
				'https://www.linkedin.com/feed/update/urn:li:activity:7654321/'
			);

			expect(result.success).toBe(true);
			expect(result.data).toEqual(mockLinkedInData);
		});

		it('should include insights when requested', async () => {
			const mockResponse: HttpResponse<LinkedInPostData> = {
				data: mockLinkedInData,
				status: 200,
				statusText: 'OK',
				headers: {},
				config: {} as any,
				duration: 1000,
			};

			vi.mocked(mockHttpClient.post).mockResolvedValue(mockResponse);

			await client.scrapeLinkedIn(
				'https://www.linkedin.com/feed/update/urn:li:activity:7654321/',
				{
					includeInsights: true,
				}
			);

			expect(mockHttpClient.post).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					includeInsights: true,
				}),
				expect.any(Object)
			);
		});
	});

	describe('scrapeTikTok', () => {
		const mockTikTokData: TikTokPostData = {
			platform: 'tiktok',
			id: '9876543210',
			url: 'https://www.tiktok.com/@user/video/9876543210',
			author: {
				id: 'user789',
				name: 'TikTok Creator',
				username: 'tiktokcreator',
				url: 'https://www.tiktok.com/@tiktokcreator',
			},
			text: 'TikTok video description',
			timestamp: new Date('2024-01-04'),
			media: [
				{
					type: 'video',
					url: 'https://tiktok.com/video.mp4',
					duration: 30,
				},
			],
			comments: [],
			likes: 10000,
			shares: 500,
			views: 100000,
			soundName: 'Original Sound',
		};

		it('should scrape TikTok video successfully', async () => {
			const mockResponse: HttpResponse<TikTokPostData> = {
				data: mockTikTokData,
				status: 200,
				statusText: 'OK',
				headers: {},
				config: {} as any,
				duration: 2500,
			};

			vi.mocked(mockHttpClient.post).mockResolvedValue(mockResponse);

			const result = await client.scrapeTikTok(
				'https://www.tiktok.com/@user/video/9876543210'
			);

			expect(result.success).toBe(true);
			expect(result.data).toEqual(mockTikTokData);
		});
	});

	describe('scrapeX', () => {
		const mockXData: XPostData = {
			platform: 'x',
			id: '1234567890123456789',
			url: 'https://x.com/user/status/1234567890123456789',
			author: {
				id: 'user999',
				name: 'X User',
				username: 'xuser',
				url: 'https://x.com/xuser',
			},
			text: 'X post content',
			timestamp: new Date('2024-01-05'),
			media: [],
			comments: [],
			likes: 1000,
			shares: 100,
			retweetCount: 100,
			quoteCount: 50,
		};

		it('should scrape X post successfully', async () => {
			const mockResponse: HttpResponse<XPostData> = {
				data: mockXData,
				status: 200,
				statusText: 'OK',
				headers: {},
				config: {} as any,
				duration: 1200,
			};

			vi.mocked(mockHttpClient.post).mockResolvedValue(mockResponse);

			const result = await client.scrapeX('https://x.com/user/status/1234567890123456789');

			expect(result.success).toBe(true);
			expect(result.data).toEqual(mockXData);
		});

		it('should extract tweet ID from X URL', async () => {
			const mockResponse: HttpResponse<XPostData> = {
				data: mockXData,
				status: 200,
				statusText: 'OK',
				headers: {},
				config: {} as any,
				duration: 1000,
			};

			vi.mocked(mockHttpClient.post).mockResolvedValue(mockResponse);

			await client.scrapeX('https://x.com/user/status/1234567890123456789');

			expect(mockHttpClient.post).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					tweetId: '1234567890123456789',
				}),
				expect.any(Object)
			);
		});
	});

	describe('scrapeThreads', () => {
		const mockThreadsData: ThreadsPostData = {
			platform: 'threads',
			id: 'CxYZ123ABC',
			url: 'https://www.threads.net/@user/post/CxYZ123ABC',
			author: {
				id: 'user111',
				name: 'Threads User',
				username: 'threadsuser',
				url: 'https://www.threads.net/@threadsuser',
			},
			text: 'Threads post content',
			timestamp: new Date('2024-01-06'),
			media: [],
			comments: [],
			likes: 300,
			shares: 50,
			repostCount: 50,
		};

		it('should scrape Threads post successfully', async () => {
			const mockResponse: HttpResponse<ThreadsPostData> = {
				data: mockThreadsData,
				status: 200,
				statusText: 'OK',
				headers: {},
				config: {} as any,
				duration: 1400,
			};

			vi.mocked(mockHttpClient.post).mockResolvedValue(mockResponse);

			const result = await client.scrapeThreads(
				'https://www.threads.net/@user/post/CxYZ123ABC'
			);

			expect(result.success).toBe(true);
			expect(result.data).toEqual(mockThreadsData);
		});
	});

	describe('Error handling', () => {
		it('should handle HTTP errors', async () => {
			const httpError = new Error('Network error');
			vi.mocked(mockHttpClient.post).mockRejectedValue(httpError);

			await expect(
				client.scrapeFacebook('https://www.facebook.com/user/posts/123')
			).rejects.toThrow();

			expect(mockLogger.error).toHaveBeenCalledWith(
				'BrightData scraping failed',
				expect.any(Error),
				expect.objectContaining({
					platform: 'facebook',
				})
			);
		});
	});

	describe('Options merging', () => {
		it('should merge default and custom options', async () => {
			const mockResponse: HttpResponse<FacebookPostData> = {
				data: {} as FacebookPostData,
				status: 200,
				statusText: 'OK',
				headers: {},
				config: {} as any,
				duration: 1000,
			};

			vi.mocked(mockHttpClient.post).mockResolvedValue(mockResponse);

			await client.scrapeFacebook('https://www.facebook.com/user/posts/123', {
				maxComments: 100,
			});

			expect(mockHttpClient.post).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					includeComments: true, // from default
					maxComments: 100, // from custom
				}),
				expect.any(Object)
			);
		});
	});
});
