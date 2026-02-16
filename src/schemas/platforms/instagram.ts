import { z } from 'zod';

/**
 * Instagram URL validation schema
 * Validates Instagram post, reel, IGTV, and story URLs
 */

// Instagram domain validation
const instagramDomainSchema = z
	.string()
	.regex(
		/^(https?:\/\/)?(www\.)?(instagram\.com|instagr\.am)/i,
		{
			message: 'URL must be from a valid Instagram domain (instagram.com, instagr.am)',
		}
	);

// Post ID (shortcode) validation
export const InstagramPostIdSchema = z
	.string()
	.regex(/^[A-Za-z0-9_-]+$/, {
		message: 'Instagram post ID (shortcode) must contain only alphanumeric characters, underscores, and hyphens',
	})
	.min(1, { message: 'Post ID cannot be empty' })
	.max(20, { message: 'Post ID is too long' });

// Post URL: instagram.com/p/{shortcode}
const instagramPostUrlSchema = z
	.string()
	.regex(/instagram\.com\/p\/[A-Za-z0-9_-]+/i, {
		message: 'Invalid Instagram post URL format (expected: /p/{shortcode})',
	});

// Reel URL: instagram.com/reel/{shortcode} or instagram.com/reels/{shortcode}
const instagramReelUrlSchema = z
	.string()
	.regex(/instagram\.com\/reels?\/[A-Za-z0-9_-]+/i, {
		message: 'Invalid Instagram reel URL format (expected: /reel/{shortcode} or /reels/{shortcode})',
	});

// TV/IGTV URL: instagram.com/tv/{shortcode}
const instagramTvUrlSchema = z
	.string()
	.regex(/instagram\.com\/tv\/[A-Za-z0-9_-]+/i, {
		message: 'Invalid Instagram TV URL format (expected: /tv/{shortcode})',
	});

// Story URL: instagram.com/stories/{username}/{storyId}
const instagramStoryUrlSchema = z
	.string()
	.regex(/instagram\.com\/stories\/[^/]+\/\d+/i, {
		message: 'Invalid Instagram story URL format (expected: /stories/{username}/{storyId})',
	});

// Shortened URL: instagr.am/p/{shortcode}
const instagramShortenedUrlSchema = z
	.string()
	.regex(/instagr\.am\/p\/[A-Za-z0-9_-]+/i, {
		message: 'Invalid Instagram shortened URL format',
	});

/**
 * Comprehensive Instagram URL schema
 * Accepts any valid Instagram post/content URL format
 */
export const InstagramURLSchema = z
	.string()
	.trim()
	.min(1, { message: 'URL cannot be empty' })
	.url({ message: 'Invalid URL format' })
	.refine(
		(url) => instagramDomainSchema.safeParse(url).success,
		{
			message: 'URL must be from a valid Instagram domain',
		}
	)
	.refine(
		(url) => {
			// Check if URL matches any of the valid Instagram URL patterns
			const patterns = [
				instagramPostUrlSchema,
				instagramReelUrlSchema,
				instagramTvUrlSchema,
				instagramStoryUrlSchema,
				instagramShortenedUrlSchema,
			];

			return patterns.some((schema) => schema.safeParse(url).success);
		},
		{
			message: 'URL must be a valid Instagram post, reel, TV, or story URL',
		}
	);

/**
 * Instagram URL with shortcode extraction
 * Validates and ensures shortcode is extractable from URL
 */
export const InstagramURLWithShortcodeSchema = InstagramURLSchema.refine(
	(url) => {
		try {
			const urlObj = new URL(url);
			const pathname = urlObj.pathname;

			// Check if shortcode can be extracted from path
			const shortcodeMatch = pathname.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);

			return shortcodeMatch !== null && shortcodeMatch[2] !== undefined;
		} catch {
			return false;
		}
	},
	{
		message: 'Instagram URL must contain extractable shortcode',
	}
);

/**
 * Type inference from schemas
 */
export type InstagramURL = z.infer<typeof InstagramURLSchema>;
export type InstagramPostId = z.infer<typeof InstagramPostIdSchema>;
