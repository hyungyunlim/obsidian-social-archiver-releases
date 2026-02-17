import { z } from 'zod';
import type { Platform } from '@/types/post';
import { PLATFORM_DETECTION_ORDER } from '@/shared/platforms/types';

// Import all platform schemas
import { FacebookURLSchema, FacebookPostIdSchema } from './facebook';
import { LinkedInURLSchema, LinkedInPostIdSchema, LinkedInActivityIdSchema } from './linkedin';
import { InstagramURLSchema, InstagramPostIdSchema } from './instagram';
import { TikTokURLSchema, TikTokVideoIdSchema, TikTokShortCodeSchema } from './tiktok';
import { XURLSchema, XTweetIdSchema, XMomentIdSchema, XSpaceIdSchema } from './x';
import { ThreadsURLSchema, ThreadsPostIdSchema } from './threads';
import { YouTubeURLSchema, YouTubeVideoIdSchema } from './youtube';
import { RedditURLSchema, RedditPostIdSchema } from './reddit';
import { PinterestURLSchema, PinterestPinIdSchema, isPinterestBoardUrl } from './pinterest';
import { SubstackURLSchema } from './substack';
import { MastodonURLSchema, MastodonPostIdSchema } from './mastodon';
import { BlueskyURLSchema, BlueskyPostIdSchema } from './bluesky';
import { TumblrURLSchema, TumblrPostIdSchema } from './tumblr';
import { GoogleMapsURLSchema, GoogleMapsPlaceIdSchema } from './googlemaps';
import { VelogURLSchema, extractVelogUsername } from './velog';
import { BlogURLSchema, isGitHubPagesBlogUrl } from './blog';
import { MediumURLSchema, isMediumLikeUrl } from './medium';
import { PodcastURLSchema, isPodcastLikeUrl, isKnownPodcastPlatformUrl } from './podcast';
import {
	NaverURLSchema,
	getNaverContentType,
	extractNaverIdentifier,
	isNaverBlogRSSUrl,
	extractNaverBlogInfo,
	extractNaverCafeInfo,
	extractNaverNewsInfo,
	getBlogRssUrl,
	isNaverBlogProfileUrl
} from './naver';
import {
	BrunchURLSchema,
	getBrunchContentType,
	extractBrunchPostInfo,
	extractBrunchProfileInfo,
	extractBrunchRssUserId,
	getBrunchRssUrl,
	getBrunchProfileUrl,
	isBrunchProfileUrl,
	isBrunchPostUrl,
	isBrunchRssUrl,
	canonicalizeBrunchUrl,
	extractBrunchBookId,
	extractBrunchKeyword
} from './brunch';

/**
 * Re-export all platform-specific schemas
 */
export {
	// Facebook
	FacebookURLSchema,
	FacebookPostIdSchema,
	// LinkedIn
	LinkedInURLSchema,
	LinkedInPostIdSchema,
	LinkedInActivityIdSchema,
	// Instagram
	InstagramURLSchema,
	InstagramPostIdSchema,
	// TikTok
	TikTokURLSchema,
	TikTokVideoIdSchema,
	TikTokShortCodeSchema,
	// X (Twitter)
	XURLSchema,
	XTweetIdSchema,
	XMomentIdSchema,
	XSpaceIdSchema,
	// Threads
	ThreadsURLSchema,
	ThreadsPostIdSchema,
	// YouTube
	YouTubeURLSchema,
	YouTubeVideoIdSchema,
	// Reddit
	RedditURLSchema,
	RedditPostIdSchema,
	// Pinterest
	PinterestURLSchema,
	PinterestPinIdSchema,
	isPinterestBoardUrl,
	// Substack
	SubstackURLSchema,
	// Mastodon
	MastodonURLSchema,
	MastodonPostIdSchema,
	// Bluesky
	BlueskyURLSchema,
	BlueskyPostIdSchema,
	// Tumblr
	TumblrURLSchema,
	TumblrPostIdSchema,
	// Google Maps
	GoogleMapsURLSchema,
	GoogleMapsPlaceIdSchema,
	// Velog
	VelogURLSchema,
	extractVelogUsername,
	// Blog (GitHub Pages)
	BlogURLSchema,
	isGitHubPagesBlogUrl,
	// Medium
	MediumURLSchema,
	isMediumLikeUrl,
	// Podcast
	PodcastURLSchema,
	isPodcastLikeUrl,
	isKnownPodcastPlatformUrl,
	// Naver
	NaverURLSchema,
	getNaverContentType,
	extractNaverIdentifier,
	isNaverBlogRSSUrl,
	extractNaverBlogInfo,
	extractNaverCafeInfo,
	extractNaverNewsInfo,
	getBlogRssUrl,
	isNaverBlogProfileUrl,
	// Brunch
	BrunchURLSchema,
	getBrunchContentType,
	extractBrunchPostInfo,
	extractBrunchProfileInfo,
	extractBrunchRssUserId,
	getBrunchRssUrl,
	getBrunchProfileUrl,
	isBrunchProfileUrl,
	isBrunchPostUrl,
	isBrunchRssUrl,
	canonicalizeBrunchUrl,
	extractBrunchBookId,
	extractBrunchKeyword,
	// Naver Webtoon (defined inline below)
	// NaverWebtoonURLSchema,
	// extractNaverWebtoonInfo,
};

/**
 * External platforms that require URL validation
 * 'post' is excluded as it's for user-created local posts
 */
type ExternalPlatform = Exclude<Platform, 'post'>;

/**
 * Naver Webtoon URL schema
 * Matches: comic.naver.com/webtoon/list?titleId=xxx or comic.naver.com/webtoon/detail?titleId=xxx&no=yyy
 */
export const NaverWebtoonURLSchema = z
	.string()
	.trim()
	.transform((url) => {
		// Normalize URL - handle mobile URLs and protocol
		const normalized = url.replace(/^(https?:)?\/\/(m\.)?/, 'https://');
		return normalized;
	})
	.refine(
		(url) => {
			try {
				const urlObj = new URL(url);
				// Must be comic.naver.com domain
				if (urlObj.hostname !== 'comic.naver.com') return false;
				// Must be webtoon list or detail page
				if (!urlObj.pathname.match(/^\/webtoon\/(list|detail)$/)) return false;
				// Must have titleId parameter
				if (!urlObj.searchParams.get('titleId')) return false;
				return true;
			} catch {
				return false;
			}
		},
		{ message: 'Invalid Naver Webtoon URL' }
	);

/**
 * Extract titleId and episodeNo from Naver Webtoon URL
 */
export function extractNaverWebtoonInfo(url: string): { titleId: string; episodeNo?: number; urlType: 'series' | 'episode' } | null {
	try {
		const urlObj = new URL(url.replace(/^(https?:)?\/\/(m\.)?/, 'https://'));
		if (urlObj.hostname !== 'comic.naver.com') return null;

		const titleId = urlObj.searchParams.get('titleId');
		if (!titleId) return null;

		if (urlObj.pathname === '/webtoon/detail') {
			const no = urlObj.searchParams.get('no');
			return {
				titleId,
				episodeNo: no ? parseInt(no, 10) : undefined,
				urlType: 'episode'
			};
		} else if (urlObj.pathname === '/webtoon/list') {
			return { titleId, urlType: 'series' };
		}

		return null;
	} catch {
		return null;
	}
}

/**
 * WEBTOON (Global) URL schema
 * Matches: webtoons.com/{lang}/{genre}/{series}/list?title_no=xxx
 * Or: webtoons.com/{lang}/{genre}/{series}/{episode}/viewer?title_no=xxx&episode_no=yyy
 * Also handles Canvas: webtoons.com/{lang}/canvas/{series}/list?title_no=xxx
 */
export const WebtoonsURLSchema = z
	.string()
	.trim()
	.transform((url) => {
		// Normalize URL - handle www prefix and protocol
		const normalized = url.replace(/^(https?:)?\/\/(www\.)?/, 'https://');
		return normalized;
	})
	.refine(
		(url) => {
			try {
				const urlObj = new URL(url);
				// Must be webtoons.com domain
				if (urlObj.hostname !== 'webtoons.com' && urlObj.hostname !== 'www.webtoons.com') return false;
				// Must have language code (2 letters)
				const pathParts = urlObj.pathname.split('/').filter(Boolean);
				if (pathParts.length < 3) return false;
				const langCode = pathParts[0];
				if (!langCode || !/^[a-z]{2}$/.test(langCode)) return false;
				// Must have title_no parameter
				if (!urlObj.searchParams.get('title_no')) return false;
				// Must end with /list or /viewer
				if (!urlObj.pathname.includes('/list') && !urlObj.pathname.includes('/viewer')) return false;
				return true;
			} catch {
				return false;
			}
		},
		{ message: 'Invalid WEBTOON URL' }
	);

/**
 * Extract titleNo, episodeNo, and language from WEBTOON URL
 */
export function extractWebtoonsInfo(url: string): {
	titleNo: string;
	episodeNo?: number;
	language: string;
	urlType: 'series' | 'episode';
	isCanvas: boolean;
} | null {
	try {
		const urlObj = new URL(url.replace(/^(https?:)?\/\/(www\.)?/, 'https://'));
		if (urlObj.hostname !== 'webtoons.com' && urlObj.hostname !== 'www.webtoons.com') return null;

		const titleNo = urlObj.searchParams.get('title_no');
		if (!titleNo) return null;

		const pathParts = urlObj.pathname.split('/').filter(Boolean);
		if (pathParts.length < 3) return null;

		const language = pathParts[0];
		const genreOrCanvas = pathParts[1];
		if (!language || !/^[a-z]{2}$/.test(language)) return null;

		const isCanvas = genreOrCanvas === 'canvas';

		if (urlObj.pathname.includes('/viewer')) {
			const episodeNo = urlObj.searchParams.get('episode_no');
			return {
				titleNo,
				episodeNo: episodeNo ? parseInt(episodeNo, 10) : undefined,
				language,
				urlType: 'episode',
				isCanvas
			};
		} else if (urlObj.pathname.includes('/list')) {
			return { titleNo, language, urlType: 'series', isCanvas };
		}

		return null;
	} catch {
		return null;
	}
}

/**
 * Platform to schema mapping
 * Used by getPlatformSchema to retrieve the correct schema for a platform
 * Note: 'post' platform does not have a URL schema as it's for local user-created posts
 */
const PLATFORM_SCHEMA_MAP = {
	facebook: FacebookURLSchema,
	linkedin: LinkedInURLSchema,
	instagram: InstagramURLSchema,
	tiktok: TikTokURLSchema,
	x: XURLSchema,
	threads: ThreadsURLSchema,
	youtube: YouTubeURLSchema,
	reddit: RedditURLSchema,
	pinterest: PinterestURLSchema,
	substack: SubstackURLSchema,
	tumblr: TumblrURLSchema,
	mastodon: MastodonURLSchema,
	bluesky: BlueskyURLSchema,
	googlemaps: GoogleMapsURLSchema,
	velog: VelogURLSchema,
	podcast: PodcastURLSchema,
	blog: BlogURLSchema,
	medium: MediumURLSchema,
	naver: NaverURLSchema,
	'naver-webtoon': NaverWebtoonURLSchema,
	webtoons: WebtoonsURLSchema,
	brunch: BrunchURLSchema,
} as const satisfies Record<ExternalPlatform, z.ZodType>;

/**
 * Get platform-specific URL validation schema
 *
 * @param platform - The platform to get the schema for (excluding 'post')
 * @returns Zod schema for validating URLs from the specified platform
 * @throws Error if platform is 'post' (user-created posts don't have URL schemas)
 *
 * @example
 * ```ts
 * const facebookSchema = getPlatformSchema('facebook');
 * const result = facebookSchema.safeParse('https://facebook.com/user/posts/123');
 * if (result.success) {
 * }
 * ```
 */
export function getPlatformSchema(platform: ExternalPlatform): z.ZodType {
	return PLATFORM_SCHEMA_MAP[platform];
}

/**
 * Composite schema that validates any supported social media URL
 * Tries each platform schema until one succeeds
 *
 * @example
 * ```ts
 * const result = AnySocialMediaURLSchema.safeParse('https://twitter.com/user/status/123');
 * if (result.success) {
 * }
 * ```
 */
export const AnySocialMediaURLSchema = z
	.string()
	.trim()
	.min(1, { message: 'URL cannot be empty' })
	.url({ message: 'Invalid URL format' })
	.refine(
		(url) => {
			const schemas = Object.values(PLATFORM_SCHEMA_MAP);
			return schemas.some((schema) => schema.safeParse(url).success);
		},
		{
			message: 'URL must be from a supported platform (Facebook, LinkedIn, Instagram, TikTok, X/Twitter, Threads, YouTube, Reddit, Pinterest, Substack, Tumblr, Mastodon, Bluesky, Google Maps, Velog, Naver, Naver Webtoon, Brunch, Blog)',
		}
	);

/**
 * Platform detection result with validation
 */
export interface PlatformSchemaValidationResult {
	valid: boolean;
	platform: Platform | null;
	url: string;
	errors: string[];
}

/**
 * Validate URL and detect platform in one operation
 * Returns validation result with detected platform
 *
 * @param url - The URL to validate and detect platform for
 * @returns Validation result with platform information
 *
 * @example
 * ```ts
 * const result = validateAndDetectPlatform('https://instagram.com/p/ABC123');
 * if (result.valid) {
 * } else {
 * }
 * ```
 */
export function validateAndDetectPlatform(url: string): PlatformSchemaValidationResult {
	const errors: string[] = [];

	// Use centralized platform detection order from shared/platforms/types.ts
	// Order is important: more specific platforms first, generic patterns last
	for (const platform of PLATFORM_DETECTION_ORDER) {
		const schema = getPlatformSchema(platform);
		const result = schema.safeParse(url);

		if (result.success) {
			return {
				valid: true,
				platform,
				url: result.data as string,
				errors: [],
			};
		}

		// Collect errors from each platform attempt
		if (result.error) {
			errors.push(`${platform}: ${result.error.errors.map((e) => e.message).join(', ')}`);
		}
	}

	// No platform matched
	return {
		valid: false,
		platform: null,
		url,
		errors: errors.length > 0 ? errors : ['URL is not from a supported social media platform'],
	};
}

/**
 * Validate URL for a specific platform
 * Returns detailed validation result
 *
 * @param url - The URL to validate
 * @param platform - The external platform to validate against (excluding 'post')
 * @returns Validation result
 *
 * @example
 * ```ts
 * const result = validatePlatformUrl('https://facebook.com/post/123', 'facebook');
 * if (result.success) {
 * } else {
 * }
 * ```
 */
export function validatePlatformUrl(url: string, platform: ExternalPlatform): z.SafeParseReturnType<string, string> {
	const schema = getPlatformSchema(platform);
	return schema.safeParse(url);
}

/**
 * Check if URL is from any supported platform (quick check)
 *
 * @param url - The URL to check
 * @returns true if URL is from a supported platform, false otherwise
 *
 * @example
 * ```ts
 * if (isSupportedPlatformUrl('https://twitter.com/user/status/123')) {
 * }
 * ```
 */
export function isSupportedPlatformUrl(url: string): boolean {
	return AnySocialMediaURLSchema.safeParse(url).success;
}

/**
 * Type inference from composite schema
 */
export type SocialMediaURL = z.infer<typeof AnySocialMediaURLSchema>;
