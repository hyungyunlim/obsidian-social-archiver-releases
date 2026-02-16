import { z } from 'zod';
import { canonicalizeUrl } from '../../utils/url';

/**
 * Threads URL validation schema
 * Validates Meta's Threads platform post URLs
 * Automatically removes tracking parameters
 */

// Threads domain validation
const threadsDomainSchema = z
	.string()
	.regex(
		/^(https?:\/\/)?(www\.)?(threads\.net|threads\.com)/i,
		{
			message: 'URL must be from a valid Threads domain (threads.net or threads.com)',
		}
	);

// Post ID validation
export const ThreadsPostIdSchema = z
	.string()
	.regex(/^[A-Za-z0-9_-]+$/, {
		message: 'Threads post ID must contain only alphanumeric characters, underscores, and hyphens',
	})
	.min(1, { message: 'Post ID cannot be empty' });

// Standard post URL: threads.net/@{username}/post/{postId} or threads.com/@{username}/post/{postId}
const threadsPostUrlSchema = z
	.string()
	.regex(/(threads\.net|threads\.com)\/@[^/]+\/post\/[A-Za-z0-9_-]+/i, {
		message: 'Invalid Threads post URL format (expected: /@{username}/post/{postId})',
	});

// Thread URL using /t/ path: threads.net/t/{threadId} or threads.com/t/{threadId}
const threadsThreadUrlSchema = z
	.string()
	.regex(/(threads\.net|threads\.com)\/t\/[A-Za-z0-9_-]+/i, {
		message: 'Invalid Threads thread URL format (expected: /t/{threadId})',
	});

// Direct post link format: threads.net/{postId} or threads.com/{postId}
const threadsDirectUrlSchema = z
	.string()
	.regex(/(threads\.net|threads\.com)\/[A-Za-z0-9_-]+$/i, {
		message: 'Invalid Threads direct URL format (expected: /{postId})',
	});

/**
 * Comprehensive Threads URL schema
 * Accepts any valid Threads post/content URL format
 * Automatically sanitizes URLs by removing tracking parameters
 */
export const ThreadsURLSchema = z
	.string()
	.trim()
	.min(1, { message: 'URL cannot be empty' })
	.url({ message: 'Invalid URL format' })
	.transform((url) => canonicalizeUrl(url)) // Sanitize URL
	.refine(
		(url) => threadsDomainSchema.safeParse(url).success,
		{
			message: 'URL must be from a valid Threads domain',
		}
	)
	.refine(
		(url) => {
			// Check if URL matches any of the valid Threads URL patterns
			const patterns = [
				threadsPostUrlSchema,
				threadsThreadUrlSchema,
				threadsDirectUrlSchema,
			];

			return patterns.some((schema) => schema.safeParse(url).success);
		},
		{
			message: 'URL must be a valid Threads post or thread URL',
		}
	);

/**
 * Threads URL with post ID extraction
 * Validates and ensures post ID is extractable from URL
 */
export const ThreadsURLWithPostIdSchema = ThreadsURLSchema.refine(
	(url) => {
		try {
			const urlObj = new URL(url);
			const pathname = urlObj.pathname;

			// Check if post ID can be extracted from path
			const postIdMatch =
				pathname.match(/\/post\/([A-Za-z0-9_-]+)/i) ||
				pathname.match(/\/t\/([A-Za-z0-9_-]+)/i) ||
				pathname.match(/^\/([A-Za-z0-9_-]+)$/i);

			return postIdMatch !== null && postIdMatch[1] !== undefined;
		} catch {
			return false;
		}
	},
	{
		message: 'Threads URL must contain extractable post ID',
	}
);

/**
 * Type inference from schemas
 */
export type ThreadsURL = z.infer<typeof ThreadsURLSchema>;
export type ThreadsPostId = z.infer<typeof ThreadsPostIdSchema>;
