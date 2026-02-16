import { z } from 'zod';

/**
 * YouTube URL validation schema
 * Validates YouTube video, shorts, and live stream URLs
 */

// YouTube domain validation
const youtubeDomainSchema = z
	.string()
	.regex(
		/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)/i,
		{
			message: 'URL must be from a valid YouTube domain (youtube.com, youtu.be, m.youtube.com)',
		}
	);

// Video ID validation schema
export const YouTubeVideoIdSchema = z
	.string()
	.regex(/^[a-zA-Z0-9_-]{11}$/, {
		message: 'YouTube video ID must be 11 characters long and contain only alphanumeric characters, hyphens, and underscores',
	})
	.min(11, { message: 'Video ID must be 11 characters' })
	.max(11, { message: 'Video ID must be 11 characters' });

// Standard watch URL: youtube.com/watch?v={videoId}
const youtubeWatchUrlSchema = z
	.string()
	.regex(/youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}/i, {
		message: 'Invalid YouTube watch URL format',
	});

// Short URL: youtu.be/{videoId}
const youtubeShortUrlSchema = z
	.string()
	.regex(/youtu\.be\/[a-zA-Z0-9_-]{11}/i, {
		message: 'Invalid YouTube short URL format',
	});

// Shorts URL: youtube.com/shorts/{shortId}
const youtubeShortsUrlSchema = z
	.string()
	.regex(/youtube\.com\/shorts\/[a-zA-Z0-9_-]{11}/i, {
		message: 'Invalid YouTube Shorts URL format',
	});

// Live URL: youtube.com/live/{liveId}
const youtubeLiveUrlSchema = z
	.string()
	.regex(/youtube\.com\/live\/[a-zA-Z0-9_-]{11}/i, {
		message: 'Invalid YouTube Live URL format',
	});

// Embed URL: youtube.com/embed/{videoId}
const youtubeEmbedUrlSchema = z
	.string()
	.regex(/youtube\.com\/embed\/[a-zA-Z0-9_-]{11}/i, {
		message: 'Invalid YouTube embed URL format',
	});

// Mobile URL: m.youtube.com/watch?v={videoId}
const youtubeMobileUrlSchema = z
	.string()
	.regex(/m\.youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}/i, {
		message: 'Invalid YouTube mobile URL format',
	});

/**
 * Comprehensive YouTube URL schema
 * Accepts any valid YouTube video/content URL format
 */
export const YouTubeURLSchema = z
	.string()
	.trim()
	.min(1, { message: 'URL cannot be empty' })
	.url({ message: 'Invalid URL format' })
	.refine(
		(url) => youtubeDomainSchema.safeParse(url).success,
		{
			message: 'URL must be from a valid YouTube domain',
		}
	)
	.refine(
		(url) => {
			// Check if URL matches any of the valid YouTube URL patterns
			const patterns = [
				youtubeWatchUrlSchema,
				youtubeShortUrlSchema,
				youtubeShortsUrlSchema,
				youtubeLiveUrlSchema,
				youtubeEmbedUrlSchema,
				youtubeMobileUrlSchema,
			];

			return patterns.some((schema) => schema.safeParse(url).success);
		},
		{
			message: 'URL must be a valid YouTube video, shorts, or live stream URL',
		}
	);

/**
 * YouTube URL with optional parameters schema
 * Includes validation for common query parameters
 */
export const YouTubeURLWithParamsSchema = YouTubeURLSchema.refine(
	(url) => {
		try {
			const urlObj = new URL(url);

			// Check for essential YouTube parameters
			const hasEssentialParam =
				urlObj.searchParams.has('v') ||
				urlObj.pathname.includes('/watch') ||
				urlObj.pathname.includes('/shorts/') ||
				urlObj.pathname.includes('/live/') ||
				urlObj.pathname.includes('/embed/') ||
				/youtu\.be\/[a-zA-Z0-9_-]{11}/.test(url);

			return hasEssentialParam;
		} catch {
			return false;
		}
	},
	{
		message: 'YouTube URL must contain valid video identifiers',
	}
);

/**
 * Type inference from schemas
 */
export type YouTubeURL = z.infer<typeof YouTubeURLSchema>;
export type YouTubeVideoId = z.infer<typeof YouTubeVideoIdSchema>;
