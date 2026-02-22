import { z } from 'zod';

/**
 * Facebook URL validation schema
 * Validates Facebook post, video, photo, story, and group post URLs
 */

// Facebook domain validation
const facebookDomainSchema = z
	.string()
	.regex(
		/^(https?:\/\/)?(www\.)?(facebook\.com|fb\.com|fb\.watch|m\.facebook\.com)/i,
		{
			message: 'URL must be from a valid Facebook domain (facebook.com, fb.com, fb.watch, m.facebook.com)',
		}
	);

// Post ID validation schemas
export const FacebookPostIdSchema = z
	.string()
	.regex(/^\d+$/, {
		message: 'Facebook post ID must be numeric',
	})
	.min(1, { message: 'Post ID cannot be empty' });

// Standard post URL: facebook.com/{username}/posts/{postId}
// Supports both numeric IDs and newer pfbid format
const facebookPostUrlSchema = z
	.string()
	.regex(/facebook\.com\/[^/]+\/posts\/((\d+)|(pfbid[a-zA-Z0-9]+))/i, {
		message: 'Invalid Facebook post URL format',
	});

// Permalink URL: facebook.com/permalink.php?story_fbid={id}
const facebookPermalinkSchema = z
	.string()
	.regex(/facebook\.com\/permalink\.php\?story_fbid=\d+/i, {
		message: 'Invalid Facebook permalink format',
	});

// Photo URL: facebook.com/photo.php?fbid={id} or facebook.com/photo?fbid={id}
const facebookPhotoUrlSchema = z
	.string()
	.regex(/facebook\.com\/photo(\.php)?\?fbid=\d+/i, {
		message: 'Invalid Facebook photo URL format',
	});

// Watch/Video URL: facebook.com/watch/?v={id} or facebook.com/{user}/videos/{id}
const facebookWatchUrlSchema = z
	.string()
	.regex(
		/(facebook\.com\/watch\/\?v=\d+|facebook\.com\/[^/]+\/videos\/\d+|fb\.watch\/[a-zA-Z0-9_-]+)/i,
		{
			message: 'Invalid Facebook watch/video URL format',
		}
	);

// Share URL: facebook.com/share/{shareId} or facebook.com/share.php
const facebookShareUrlSchema = z
	.string()
	.regex(/(facebook\.com\/share\/[a-zA-Z0-9]+|facebook\.com\/share\.php)/i, {
		message: 'Invalid Facebook share URL format',
	});

// Story URL: facebook.com/stories/{storyId} or story.php?story_fbid={id}
const facebookStoryUrlSchema = z
	.string()
	.regex(/facebook\.com\/(?:stories\/\d+|story\.php\?story_fbid=\d+)/i, {
		message: 'Invalid Facebook story URL format',
	});

// Group post URL: facebook.com/groups/{groupId}/posts/{postId} or permalink
const facebookGroupUrlSchema = z
	.string()
	.regex(
		/facebook\.com\/groups\/[^/]+\/(posts\/\d+|permalink\/\d+)/i,
		{
			message: 'Invalid Facebook group post URL format',
		}
	);

// Mobile URL: m.facebook.com with story.php or photo.php patterns
const facebookMobileUrlSchema = z
	.string()
	.regex(
		/m\.facebook\.com\/(story\.php\?story_fbid=\d+|photo\.php\?fbid=\d+)/i,
		{
			message: 'Invalid Facebook mobile URL format',
		}
	);

// Reel URL: facebook.com/reel/{id}
const facebookReelUrlSchema = z
	.string()
	.regex(/facebook\.com\/reel\/\d+/i, {
		message: 'Invalid Facebook reel URL format',
	});

/**
 * Comprehensive Facebook URL schema
 * Accepts any valid Facebook post/content URL format
 */
export const FacebookURLSchema = z
	.string()
	.trim()
	.min(1, { message: 'URL cannot be empty' })
	.url({ message: 'Invalid URL format' })
	.refine(
		(url) => facebookDomainSchema.safeParse(url).success,
		{
			message: 'URL must be from a valid Facebook domain',
		}
	)
	.refine(
		(url) => {
			// Check if URL matches any of the valid Facebook URL patterns
			const patterns = [
				facebookPostUrlSchema,
				facebookPermalinkSchema,
				facebookPhotoUrlSchema,
				facebookWatchUrlSchema,
				facebookShareUrlSchema,
				facebookStoryUrlSchema,
				facebookGroupUrlSchema,
				facebookMobileUrlSchema,
				facebookReelUrlSchema,
			];

			return patterns.some((schema) => schema.safeParse(url).success);
		},
		{
			message: 'URL must be a valid Facebook post, video, photo, story, or group post URL',
		}
	);

/**
 * Facebook URL with optional parameters schema
 * Includes validation for common query parameters
 */
export const FacebookURLWithParamsSchema = FacebookURLSchema.refine(
	(url) => {
		try {
			const urlObj = new URL(url);

			// Check for essential Facebook parameters
			const hasEssentialParam =
				urlObj.searchParams.has('story_fbid') ||
				urlObj.searchParams.has('fbid') ||
				urlObj.searchParams.has('v') ||
				urlObj.searchParams.has('id') ||
				urlObj.pathname.includes('/posts/') ||
				urlObj.pathname.includes('/videos/') ||
				urlObj.pathname.includes('/stories/');

			return hasEssentialParam;
		} catch {
			return false;
		}
	},
	{
		message: 'Facebook URL must contain valid post identifiers',
	}
);

/**
 * Type inference from schemas
 */
export type FacebookURL = z.infer<typeof FacebookURLSchema>;
export type FacebookPostId = z.infer<typeof FacebookPostIdSchema>;
