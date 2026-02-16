import { z } from 'zod';
import { canonicalizeUrl } from '../../utils/url';

/**
 * TikTok URL validation schema
 * Validates TikTok video, live, and photo post URLs
 * Automatically removes tracking parameters
 */

// TikTok domain validation
const tiktokDomainSchema = z
	.string()
	.regex(
		/^(https?:\/\/)?(www\.)?(tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)/i,
		{
			message: 'URL must be from a valid TikTok domain (tiktok.com, vm.tiktok.com, vt.tiktok.com)',
		}
	);

// Video ID validation
export const TikTokVideoIdSchema = z
	.string()
	.regex(/^\d+$/, {
		message: 'TikTok video ID must be numeric',
	})
	.min(1, { message: 'Video ID cannot be empty' });

// Shortened URL code validation
export const TikTokShortCodeSchema = z
	.string()
	.regex(/^[A-Za-z0-9]+$/, {
		message: 'TikTok short code must contain only alphanumeric characters',
	})
	.min(1, { message: 'Short code cannot be empty' });

// Standard video URL: tiktok.com/@{username}/video/{videoId}
const tiktokVideoUrlSchema = z
	.string()
	.regex(/tiktok\.com\/@[^/]+\/video\/\d+/i, {
		message: 'Invalid TikTok video URL format (expected: /@{username}/video/{videoId})',
	});

// Video URL without username: tiktok.com/video/{videoId}
const tiktokVideoNoUsernameSchema = z
	.string()
	.regex(/tiktok\.com\/video\/\d+/i, {
		message: 'Invalid TikTok video URL format (expected: /video/{videoId})',
	});

// Shortened URL (vm): vm.tiktok.com/{shortCode}
const tiktokVmShortenedUrlSchema = z
	.string()
	.regex(/vm\.tiktok\.com\/[A-Za-z0-9]+/i, {
		message: 'Invalid TikTok shortened URL format (vm.tiktok.com)',
	});

// Shortened URL (vt): vt.tiktok.com/{shortCode}
const tiktokVtShortenedUrlSchema = z
	.string()
	.regex(/vt\.tiktok\.com\/[A-Za-z0-9]+/i, {
		message: 'Invalid TikTok shortened URL format (vt.tiktok.com)',
	});

// Live URL: tiktok.com/@{username}/live
const tiktokLiveUrlSchema = z
	.string()
	.regex(/tiktok\.com\/@[^/]+\/live/i, {
		message: 'Invalid TikTok live URL format (expected: /@{username}/live)',
	});

// Photo mode post: tiktok.com/@{username}/photo/{photoId}
const tiktokPhotoUrlSchema = z
	.string()
	.regex(/tiktok\.com\/@[^/]+\/photo\/\d+/i, {
		message: 'Invalid TikTok photo URL format (expected: /@{username}/photo/{photoId})',
	});

/**
 * Comprehensive TikTok URL schema
 * Accepts any valid TikTok video/content URL format
 * Automatically sanitizes URLs by removing tracking parameters
 */
export const TikTokURLSchema = z
	.string()
	.trim()
	.min(1, { message: 'URL cannot be empty' })
	.url({ message: 'Invalid URL format' })
	.transform((url) => canonicalizeUrl(url)) // Sanitize URL
	.refine(
		(url) => tiktokDomainSchema.safeParse(url).success,
		{
			message: 'URL must be from a valid TikTok domain',
		}
	)
	.refine(
		(url) => {
			// Check if URL matches any of the valid TikTok URL patterns
			const patterns = [
				tiktokVideoUrlSchema,
				tiktokVideoNoUsernameSchema,
				tiktokVmShortenedUrlSchema,
				tiktokVtShortenedUrlSchema,
				tiktokLiveUrlSchema,
				tiktokPhotoUrlSchema,
			];

			return patterns.some((schema) => schema.safeParse(url).success);
		},
		{
			message: 'URL must be a valid TikTok video, live, or photo URL',
		}
	);

/**
 * TikTok URL with video ID extraction
 * Validates and ensures video ID is extractable (for non-shortened URLs)
 */
export const TikTokURLWithVideoIdSchema = TikTokURLSchema.refine(
	(url) => {
		try {
			const urlObj = new URL(url);

			// Shortened URLs need to be expanded first
			if (
				urlObj.hostname === 'vm.tiktok.com' ||
				urlObj.hostname === 'vt.tiktok.com'
			) {
				return true; // Will be expanded by URLExpander
			}

			// Check if video ID can be extracted from path
			const videoIdMatch = urlObj.pathname.match(/\/(video|photo)\/(\d+)/i);

			return videoIdMatch !== null && videoIdMatch[2] !== undefined;
		} catch {
			return false;
		}
	},
	{
		message: 'TikTok URL must contain extractable video ID or be a valid shortened URL',
	}
);

/**
 * Type inference from schemas
 */
export type TikTokURL = z.infer<typeof TikTokURLSchema>;
export type TikTokVideoId = z.infer<typeof TikTokVideoIdSchema>;
export type TikTokShortCode = z.infer<typeof TikTokShortCodeSchema>;
