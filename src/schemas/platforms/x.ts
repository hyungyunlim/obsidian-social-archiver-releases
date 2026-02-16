import { z } from 'zod';

/**
 * X (Twitter) URL validation schema
 * Validates X/Twitter post (tweet), moment, and spaces URLs
 */

// X domain validation (includes both x.com and twitter.com)
const xDomainSchema = z
	.string()
	.regex(
		/^(https?:\/\/)?(www\.)?(x\.com|twitter\.com|t\.co|mobile\.x\.com|mobile\.twitter\.com)/i,
		{
			message: 'URL must be from a valid X/Twitter domain (x.com, twitter.com, t.co, mobile versions)',
		}
	);

// Tweet ID validation
export const XTweetIdSchema = z
	.string()
	.regex(/^\d+$/, {
		message: 'X/Twitter tweet ID must be numeric',
	})
	.min(1, { message: 'Tweet ID cannot be empty' });

// Moment ID validation
export const XMomentIdSchema = z
	.string()
	.regex(/^\d+$/, {
		message: 'X/Twitter moment ID must be numeric',
	})
	.min(1, { message: 'Moment ID cannot be empty' });

// Space ID validation
export const XSpaceIdSchema = z
	.string()
	.regex(/^[A-Za-z0-9]+$/, {
		message: 'X/Twitter space ID must contain only alphanumeric characters',
	})
	.min(1, { message: 'Space ID cannot be empty' });

// Standard tweet URL: x.com/{username}/status/{tweetId} or twitter.com/{username}/status/{tweetId}
const xTweetUrlSchema = z
	.string()
	.regex(/(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/i, {
		message: 'Invalid X/Twitter tweet URL format (expected: /{username}/status/{tweetId})',
	});

// Tweet with photo: x.com/{username}/status/{tweetId}/photo/{photoNum}
const xTweetPhotoUrlSchema = z
	.string()
	.regex(/(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+\/photo\/\d+/i, {
		message: 'Invalid X/Twitter tweet photo URL format',
	});

// Tweet with video: x.com/{username}/status/{tweetId}/video/{videoNum}
const xTweetVideoUrlSchema = z
	.string()
	.regex(/(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+\/video\/\d+/i, {
		message: 'Invalid X/Twitter tweet video URL format',
	});

// Mobile URLs: mobile.x.com/{username}/status/{tweetId}
const xMobileTweetUrlSchema = z
	.string()
	.regex(/mobile\.(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/i, {
		message: 'Invalid X/Twitter mobile tweet URL format',
	});

// Shortened URL: t.co/{shortCode}
const xShortenedUrlSchema = z
	.string()
	.regex(/t\.co\/[A-Za-z0-9]+/i, {
		message: 'Invalid X/Twitter shortened URL format (t.co)',
	});

// Moments: x.com/i/moments/{momentId}
const xMomentUrlSchema = z
	.string()
	.regex(/(?:x\.com|twitter\.com)\/i\/moments\/\d+/i, {
		message: 'Invalid X/Twitter moment URL format (expected: /i/moments/{momentId})',
	});

// Spaces (audio rooms): x.com/i/spaces/{spaceId}
const xSpaceUrlSchema = z
	.string()
	.regex(/(?:x\.com|twitter\.com)\/i\/spaces\/[A-Za-z0-9]+/i, {
		message: 'Invalid X/Twitter space URL format (expected: /i/spaces/{spaceId})',
	});

/**
 * Comprehensive X (Twitter) URL schema
 * Accepts any valid X/Twitter tweet/content URL format
 */
export const XURLSchema = z
	.string()
	.trim()
	.min(1, { message: 'URL cannot be empty' })
	.url({ message: 'Invalid URL format' })
	.refine(
		(url) => xDomainSchema.safeParse(url).success,
		{
			message: 'URL must be from a valid X/Twitter domain',
		}
	)
	.refine(
		(url) => {
			// Check if URL matches any of the valid X URL patterns
			const patterns = [
				xTweetUrlSchema,
				xTweetPhotoUrlSchema,
				xTweetVideoUrlSchema,
				xMobileTweetUrlSchema,
				xShortenedUrlSchema,
				xMomentUrlSchema,
				xSpaceUrlSchema,
			];

			return patterns.some((schema) => schema.safeParse(url).success);
		},
		{
			message: 'URL must be a valid X/Twitter tweet, moment, or space URL',
		}
	);

/**
 * X URL with tweet ID extraction
 * Validates and ensures tweet ID is extractable (for non-shortened URLs)
 */
export const XURLWithTweetIdSchema = XURLSchema.refine(
	(url) => {
		try {
			const urlObj = new URL(url);

			// Shortened URLs need to be expanded first
			if (urlObj.hostname === 't.co') {
				return true; // Will be expanded by URLExpander
			}

			// Spaces and moments don't have tweet IDs
			if (urlObj.pathname.includes('/i/moments/') || urlObj.pathname.includes('/i/spaces/')) {
				return true; // Valid X content without tweet ID
			}

			// Check if tweet ID can be extracted from path
			const tweetIdMatch = urlObj.pathname.match(/\/status\/(\d+)/i);

			return tweetIdMatch !== null && tweetIdMatch[1] !== undefined;
		} catch {
			return false;
		}
	},
	{
		message: 'X/Twitter URL must contain extractable tweet ID or be a valid shortened/special URL',
	}
);

/**
 * X URL with domain normalization preference
 * Validates URL and checks if it should be normalized to x.com
 */
export const XURLNormalizedSchema = XURLSchema.refine(
	(url) => {
		try {
			const urlObj = new URL(url);

			// Accept all valid X domains
			return (
				urlObj.hostname.includes('x.com') ||
				urlObj.hostname.includes('twitter.com') ||
				urlObj.hostname === 't.co'
			);
		} catch {
			return false;
		}
	},
	{
		message: 'URL must be from x.com, twitter.com, or t.co domains',
	}
);

/**
 * Type inference from schemas
 */
export type XURL = z.infer<typeof XURLSchema>;
export type XTweetId = z.infer<typeof XTweetIdSchema>;
export type XMomentId = z.infer<typeof XMomentIdSchema>;
export type XSpaceId = z.infer<typeof XSpaceIdSchema>;
