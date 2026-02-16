/**
 * BrightData API Client for social media scraping
 */

import type { IService } from './base/IService';
import type { RetryableHttpClient } from './RetryableHttpClient';
import type { Logger } from './Logger';
import type { Platform } from '@/types/post';
import type {
	ScrapingOptions,
	FacebookPostData,
	InstagramPostData,
	LinkedInPostData,
	TikTokPostData,
	XPostData,
	ThreadsPostData,
	BrightDataResponse,
	CanonicalizedUrl,
} from '@/types/brightdata-client';
import type { HttpRequestConfig, HttpResponse } from '@/types/brightdata';
import {
	createErrorFromResponse,
	InvalidURLError,
} from '@/types/errors/http-errors';

/**
 * BrightData Client configuration
 */
export interface BrightDataClientConfig {
	apiKey: string;
	baseURL?: string;
	timeout?: number;
	defaultOptions?: ScrapingOptions;
}

/**
 * BrightData API Client
 */
export class BrightDataClient implements IService {
	private httpClient: RetryableHttpClient;
	private logger: Logger;
	private config: Required<BrightDataClientConfig>;

	constructor(
		httpClient: RetryableHttpClient,
		logger: Logger,
		config: BrightDataClientConfig
	) {
		this.httpClient = httpClient;
		this.logger = logger;
		this.config = {
			apiKey: config.apiKey,
			baseURL: config.baseURL ?? 'https://api.brightdata.com',
			timeout: config.timeout ?? 30000,
			defaultOptions: config.defaultOptions ?? {
				includeComments: true,
				includeMedia: true,
				includeMetadata: true,
				maxComments: 50,
			},
		};
	}

	/**
	 * IService implementation
	 */
	async initialize(): Promise<void> {
		this.logger.info('BrightDataClient initialized', {
			baseURL: this.config.baseURL,
		});
	}

	async shutdown(): Promise<void> {
		this.logger.info('BrightDataClient shutdown');
	}

	/**
	 * Scrape Facebook post
	 */
	async scrapeFacebook(
		url: string,
		options: ScrapingOptions = {}
	): Promise<BrightDataResponse<FacebookPostData>> {
		this.logger.info('Scraping Facebook post', { url });

		const canonicalUrl = this.canonicalizeFacebookUrl(url);
		const mergedOptions = { ...this.config.defaultOptions, ...options };

		const requestConfig: HttpRequestConfig = {
			method: 'POST',
			url: `${this.config.baseURL}/v1/facebook/post`,
			headers: {
				'Authorization': `Bearer ${this.config.apiKey}`,
				'Content-Type': 'application/json',
			},
			data: {
				url: canonicalUrl.canonical,
				postId: canonicalUrl.postId,
				includeComments: mergedOptions.includeComments,
				includeReactions: mergedOptions.includeReactions ?? true,
				maxComments: mergedOptions.maxComments,
			},
			timeout: this.config.timeout,
		};

		try {
			const response = await this.httpClient.post<FacebookPostData>(
				requestConfig.url,
				requestConfig.data,
				requestConfig
			);

			return this.wrapResponse(response, canonicalUrl.platform);
		} catch (error) {
			throw this.handleError(error, 'facebook', url);
		}
	}

	/**
	 * Scrape Instagram post
	 */
	async scrapeInstagram(
		url: string,
		options: ScrapingOptions = {}
	): Promise<BrightDataResponse<InstagramPostData>> {
		this.logger.info('Scraping Instagram post', { url });

		const canonicalUrl = this.canonicalizeInstagramUrl(url);
		const mergedOptions = { ...this.config.defaultOptions, ...options };

		const requestConfig: HttpRequestConfig = {
			method: 'POST',
			url: `${this.config.baseURL}/v1/instagram/post`,
			headers: {
				'Authorization': `Bearer ${this.config.apiKey}`,
				'Content-Type': 'application/json',
			},
			data: {
				url: canonicalUrl.canonical,
				shortcode: canonicalUrl.postId,
				includeComments: mergedOptions.includeComments,
				includeCarousel: true,
				maxComments: mergedOptions.maxComments,
			},
			timeout: this.config.timeout,
		};

		try {
			const response = await this.httpClient.post<InstagramPostData>(
				requestConfig.url,
				requestConfig.data,
				requestConfig
			);

			return this.wrapResponse(response, canonicalUrl.platform);
		} catch (error) {
			throw this.handleError(error, 'instagram', url);
		}
	}

	/**
	 * Scrape LinkedIn post
	 */
	async scrapeLinkedIn(
		url: string,
		options: ScrapingOptions = {}
	): Promise<BrightDataResponse<LinkedInPostData>> {
		this.logger.info('Scraping LinkedIn post', { url });

		const canonicalUrl = this.canonicalizeLinkedInUrl(url);
		const mergedOptions = { ...this.config.defaultOptions, ...options };

		const requestConfig: HttpRequestConfig = {
			method: 'POST',
			url: `${this.config.baseURL}/v1/linkedin/post`,
			headers: {
				'Authorization': `Bearer ${this.config.apiKey}`,
				'Content-Type': 'application/json',
			},
			data: {
				url: canonicalUrl.canonical,
				postId: canonicalUrl.postId,
				includeComments: mergedOptions.includeComments,
				includeInsights: mergedOptions.includeInsights ?? true,
				maxComments: mergedOptions.maxComments,
			},
			timeout: this.config.timeout,
		};

		try {
			const response = await this.httpClient.post<LinkedInPostData>(
				requestConfig.url,
				requestConfig.data,
				requestConfig
			);

			return this.wrapResponse(response, canonicalUrl.platform);
		} catch (error) {
			throw this.handleError(error, 'linkedin', url);
		}
	}

	/**
	 * Scrape TikTok video
	 */
	async scrapeTikTok(
		url: string,
		options: ScrapingOptions = {}
	): Promise<BrightDataResponse<TikTokPostData>> {
		this.logger.info('Scraping TikTok video', { url });

		const canonicalUrl = this.canonicalizeTikTokUrl(url);
		const mergedOptions = { ...this.config.defaultOptions, ...options };

		const requestConfig: HttpRequestConfig = {
			method: 'POST',
			url: `${this.config.baseURL}/v1/tiktok/video`,
			headers: {
				'Authorization': `Bearer ${this.config.apiKey}`,
				'Content-Type': 'application/json',
			},
			data: {
				url: canonicalUrl.canonical,
				videoId: canonicalUrl.postId,
				includeComments: mergedOptions.includeComments,
				maxComments: mergedOptions.maxComments,
			},
			timeout: this.config.timeout,
		};

		try {
			const response = await this.httpClient.post<TikTokPostData>(
				requestConfig.url,
				requestConfig.data,
				requestConfig
			);

			return this.wrapResponse(response, canonicalUrl.platform);
		} catch (error) {
			throw this.handleError(error, 'tiktok', url);
		}
	}

	/**
	 * Scrape X (Twitter) post
	 */
	async scrapeX(
		url: string,
		options: ScrapingOptions = {}
	): Promise<BrightDataResponse<XPostData>> {
		this.logger.info('Scraping X post', { url });

		const canonicalUrl = this.canonicalizeXUrl(url);
		const mergedOptions = { ...this.config.defaultOptions, ...options };

		const requestConfig: HttpRequestConfig = {
			method: 'POST',
			url: `${this.config.baseURL}/v1/twitter/tweet`,
			headers: {
				'Authorization': `Bearer ${this.config.apiKey}`,
				'Content-Type': 'application/json',
			},
			data: {
				url: canonicalUrl.canonical,
				tweetId: canonicalUrl.postId,
				includeReplies: mergedOptions.includeComments,
				maxReplies: mergedOptions.maxComments,
			},
			timeout: this.config.timeout,
		};

		try {
			const response = await this.httpClient.post<XPostData>(
				requestConfig.url,
				requestConfig.data,
				requestConfig
			);

			return this.wrapResponse(response, canonicalUrl.platform);
		} catch (error) {
			throw this.handleError(error, 'x', url);
		}
	}

	/**
	 * Scrape Threads post
	 */
	async scrapeThreads(
		url: string,
		options: ScrapingOptions = {}
	): Promise<BrightDataResponse<ThreadsPostData>> {
		this.logger.info('Scraping Threads post', { url });

		const canonicalUrl = this.canonicalizeThreadsUrl(url);
		const mergedOptions = { ...this.config.defaultOptions, ...options };

		const requestConfig: HttpRequestConfig = {
			method: 'POST',
			url: `${this.config.baseURL}/v1/threads/post`,
			headers: {
				'Authorization': `Bearer ${this.config.apiKey}`,
				'Content-Type': 'application/json',
			},
			data: {
				url: canonicalUrl.canonical,
				postId: canonicalUrl.postId,
				includeReplies: mergedOptions.includeComments,
				maxReplies: mergedOptions.maxComments,
			},
			timeout: this.config.timeout,
		};

		try {
			const response = await this.httpClient.post<ThreadsPostData>(
				requestConfig.url,
				requestConfig.data,
				requestConfig
			);

			return this.wrapResponse(response, canonicalUrl.platform);
		} catch (error) {
			throw this.handleError(error, 'threads', url);
		}
	}

	/**
	 * Canonicalize Facebook URL
	 */
	private canonicalizeFacebookUrl(url: string): CanonicalizedUrl {
		try {
			const urlObj = new URL(url);
			let postId = '';

			// Extract post ID from various Facebook URL formats
			if (urlObj.pathname.includes('/posts/')) {
				const match = urlObj.pathname.match(/\/posts\/(\d+)/);
				postId = match?.[1] ?? '';
			} else if (urlObj.searchParams.has('story_fbid')) {
				postId = urlObj.searchParams.get('story_fbid') ?? '';
			} else if (urlObj.searchParams.has('fbid')) {
				postId = urlObj.searchParams.get('fbid') ?? '';
			} else if (urlObj.searchParams.has('v')) {
				postId = urlObj.searchParams.get('v') ?? '';
			} else if (urlObj.pathname.includes('/videos/')) {
				const match = urlObj.pathname.match(/\/videos\/(\d+)/);
				postId = match?.[1] ?? '';
			}

			if (!postId) {
				throw new InvalidURLError(url);
			}

			return {
				original: url,
				canonical: `https://www.facebook.com/${postId}`,
				platform: 'facebook',
				postId,
			};
		} catch (error) {
			if (error instanceof InvalidURLError) {
				throw error;
			}
			throw new InvalidURLError(url);
		}
	}

	/**
	 * Canonicalize Instagram URL
	 */
	private canonicalizeInstagramUrl(url: string): CanonicalizedUrl {
		try {
			const urlObj = new URL(url);
			const match = urlObj.pathname.match(/\/p\/([a-zA-Z0-9_-]+)/);

			if (!match) {
				throw new InvalidURLError(url);
			}

			const shortcode = match[1]!;

			return {
				original: url,
				canonical: `https://www.instagram.com/p/${shortcode}/`,
				platform: 'instagram',
				postId: shortcode,
			};
		} catch (error) {
			if (error instanceof InvalidURLError) {
				throw error;
			}
			throw new InvalidURLError(url);
		}
	}

	/**
	 * Canonicalize LinkedIn URL
	 */
	private canonicalizeLinkedInUrl(url: string): CanonicalizedUrl {
		try {
			const urlObj = new URL(url);
			const match = urlObj.pathname.match(/\/feed\/update\/urn:li:activity:(\d+)/);

			if (!match) {
				throw new InvalidURLError(url);
			}

			const activityId = match[1]!;

			return {
				original: url,
				canonical: `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`,
				platform: 'linkedin',
				postId: activityId,
			};
		} catch (error) {
			if (error instanceof InvalidURLError) {
				throw error;
			}
			throw new InvalidURLError(url);
		}
	}

	/**
	 * Canonicalize TikTok URL
	 */
	private canonicalizeTikTokUrl(url: string): CanonicalizedUrl {
		try {
			const urlObj = new URL(url);
			const match = urlObj.pathname.match(/\/video\/(\d+)/);

			if (!match) {
				throw new InvalidURLError(url);
			}

			const videoId = match[1]!;

			return {
				original: url,
				canonical: `https://www.tiktok.com/@/video/${videoId}`,
				platform: 'tiktok',
				postId: videoId,
			};
		} catch (error) {
			if (error instanceof InvalidURLError) {
				throw error;
			}
			throw new InvalidURLError(url);
		}
	}

	/**
	 * Canonicalize X (Twitter) URL
	 */
	private canonicalizeXUrl(url: string): CanonicalizedUrl {
		try {
			const urlObj = new URL(url);
			const match = urlObj.pathname.match(/\/status\/(\d+)/);

			if (!match) {
				throw new InvalidURLError(url);
			}

			const tweetId = match[1]!;

			return {
				original: url,
				canonical: `https://x.com/i/status/${tweetId}`,
				platform: 'x',
				postId: tweetId,
			};
		} catch (error) {
			if (error instanceof InvalidURLError) {
				throw error;
			}
			throw new InvalidURLError(url);
		}
	}

	/**
	 * Canonicalize Threads URL
	 */
	private canonicalizeThreadsUrl(url: string): CanonicalizedUrl {
		try {
			const urlObj = new URL(url);
			const match = urlObj.pathname.match(/\/post\/([a-zA-Z0-9_-]+)/);

			if (!match) {
				throw new InvalidURLError(url);
			}

			const postId = match[1]!;

			return {
				original: url,
				canonical: `https://www.threads.net/@/post/${postId}`,
				platform: 'threads',
				postId,
			};
		} catch (error) {
			if (error instanceof InvalidURLError) {
				throw error;
			}
			throw new InvalidURLError(url);
		}
	}

	/**
	 * Wrap HTTP response in BrightData response format
	 */
	private wrapResponse<T>(
		response: HttpResponse<T>,
		_platform: Platform
	): BrightDataResponse<T> {
		const startTime = Date.now() - response.duration;

		return {
			success: true,
			data: response.data,
			metadata: {
				requestId: response.config?.headers?.['x-request-id'] ?? '',
				timestamp: new Date(startTime),
				duration: response.duration,
				creditsUsed: 1, // Default credit usage
				cached: false,
			},
		};
	}

	/**
	 * Handle errors with platform-specific context
	 */
	private handleError(error: unknown, platform: Platform, url: string): Error {
		this.logger.error('BrightData scraping failed', error as Error, {
			platform,
			url,
		});

		// If it's already an HttpError, return it
		if (error instanceof Error && 'statusCode' in error) {
			return error;
		}

		// Convert to appropriate error
		if (error instanceof Error) {
			return createErrorFromResponse(
				{
					status: 500,
					statusText: 'Internal Server Error',
					headers: {},
					data: { message: error.message },
				} as HttpResponse,
				undefined,
				platform
			);
		}

		return new Error('Unknown error occurred during scraping');
	}
}
