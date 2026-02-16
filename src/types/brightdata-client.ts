/**
 * BrightData Client Types
 */

import type { Platform } from './post';

/**
 * Scraping options for selective data extraction
 */
export interface ScrapingOptions {
	includeComments?: boolean;
	includeMedia?: boolean;
	includeMetadata?: boolean;
	maxComments?: number;
	includeReactions?: boolean; // Facebook-specific
	includeInsights?: boolean; // LinkedIn-specific
}

/**
 * Author information
 */
export interface Author {
	id: string;
	name: string;
	username?: string;
	url: string;
	avatarUrl?: string;
	verified?: boolean;
	followerCount?: number;
}

/**
 * Media item
 */
export interface Media {
	type: 'photo' | 'video' | 'carousel' | 'audio';
	url: string;
	cdnUrl?: string; // CDN URL for proxy-based downloads (TikTok)
	thumbnailUrl?: string;
	width?: number;
	height?: number;
	duration?: number; // For videos/audio in seconds
	altText?: string;
}

/**
 * Comment data
 */
export interface Comment {
	id: string;
	author: Author;
	text: string;
	timestamp: Date;
	likes?: number;
	replies?: Comment[];
}

/**
 * Reaction counts (Facebook-specific)
 */
export interface Reactions {
	like?: number;
	love?: number;
	haha?: number;
	wow?: number;
	sad?: number;
	angry?: number;
	care?: number;
	total: number;
}

/**
 * Post insights (LinkedIn-specific)
 */
export interface PostInsights {
	impressions?: number;
	clicks?: number;
	engagement?: number;
	shares?: number;
	comments?: number;
	reactions?: number;
}

/**
 * Base scraped post data
 */
export interface ScrapedPostData {
	platform: Platform;
	id: string;
	url: string;
	author: Author;
	text: string;
	timestamp: Date;
	media: Media[];
	comments: Comment[];
	likes: number;
	shares: number;
	views?: number;
	hashtags?: string[];
	mentions?: string[];
	location?: {
		name: string;
		latitude?: number;
		longitude?: number;
	};
	isSponsored?: boolean;
	language?: string;
}

/**
 * Facebook-specific post data
 */
export interface FacebookPostData extends ScrapedPostData {
	platform: 'facebook';
	reactions?: Reactions;
	postType?: 'status' | 'photo' | 'video' | 'link' | 'live' | 'album';
	feeling?: string;
	groupId?: string;
	groupName?: string;
}

/**
 * Instagram-specific post data
 */
export interface InstagramPostData extends ScrapedPostData {
	platform: 'instagram';
	isCarousel?: boolean;
	carouselItems?: Media[];
	caption?: string;
	aspectRatio?: string;
	filterUsed?: string;
}

/**
 * LinkedIn-specific post data
 */
export interface LinkedInPostData extends ScrapedPostData {
	platform: 'linkedin';
	insights?: PostInsights;
	articleUrl?: string;
	articleTitle?: string;
	companyId?: string;
	companyName?: string;
}

/**
 * TikTok-specific post data
 */
export interface TikTokPostData extends ScrapedPostData {
	platform: 'tiktok';
	soundName?: string;
	soundUrl?: string;
	soundAuthor?: string;
	duetEnabled?: boolean;
	stitchEnabled?: boolean;
	challengeName?: string;
	challengeId?: string;
	effects?: string[];
}

/**
 * X (Twitter) specific post data
 */
export interface XPostData extends ScrapedPostData {
	platform: 'x';
	retweetCount?: number;
	quoteCount?: number;
	bookmarkCount?: number;
	inReplyToId?: string;
	inReplyToUsername?: string;
	isRetweet?: boolean;
	isQuoteTweet?: boolean;
	quotedPost?: XPostData;
	retweetedPost?: XPostData;
}

/**
 * Threads-specific post data
 */
export interface ThreadsPostData extends ScrapedPostData {
	platform: 'threads';
	repostCount?: number;
	quoteCount?: number;
	inReplyToId?: string;
}

/**
 * Union type for all platform post data
 */
export type PlatformPostData =
	| FacebookPostData
	| InstagramPostData
	| LinkedInPostData
	| TikTokPostData
	| XPostData
	| ThreadsPostData;

/**
 * BrightData API response wrapper
 */
export interface BrightDataResponse<T = unknown> {
	success: boolean;
	data?: T;
	error?: {
		code: string;
		message: string;
		details?: unknown;
	};
	metadata: {
		requestId: string;
		timestamp: Date;
		duration: number;
		creditsUsed: number;
		cached?: boolean;
	};
}

/**
 * URL canonicalization result
 */
export interface CanonicalizedUrl {
	original: string;
	canonical: string;
	platform: Platform;
	postId: string;
}
