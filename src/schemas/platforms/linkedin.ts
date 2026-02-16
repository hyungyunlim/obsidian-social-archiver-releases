import { z } from 'zod';

/**
 * LinkedIn URL validation schema
 * Validates LinkedIn post, activity, pulse article, video, and newsletter URLs
 */

// LinkedIn domain validation
const linkedInDomainSchema = z
	.string()
	.regex(
		/^(https?:\/\/)?(www\.)?(linkedin\.com|lnkd\.in)/i,
		{
			message: 'URL must be from a valid LinkedIn domain (linkedin.com, lnkd.in)',
		}
	);

// Post ID validation schemas
export const LinkedInPostIdSchema = z
	.string()
	.regex(/^[a-zA-Z0-9-]+$/, {
		message: 'LinkedIn post ID must contain only alphanumeric characters and hyphens',
	})
	.min(1, { message: 'Post ID cannot be empty' });

export const LinkedInActivityIdSchema = z
	.string()
	.regex(/^\d+$/, {
		message: 'LinkedIn activity ID must be numeric',
	})
	.min(1, { message: 'Activity ID cannot be empty' });

// Post URL: linkedin.com/posts/{username}_{activityId}
const linkedInPostUrlSchema = z
	.string()
	.regex(/linkedin\.com\/posts\/[^/]+_[a-zA-Z0-9-]+/i, {
		message: 'Invalid LinkedIn post URL format (expected: /posts/{username}_{activityId})',
	});

// Activity update URL: linkedin.com/feed/update/urn:li:activity:{id}
const linkedInActivityUpdateSchema = z
	.string()
	.regex(/linkedin\.com\/feed\/update\/urn:li:(activity|share):\d+/i, {
		message: 'Invalid LinkedIn activity update URL format',
	});

// Pulse article URL: linkedin.com/pulse/{slug}
const linkedInPulseUrlSchema = z
	.string()
	.regex(/linkedin\.com\/pulse\/[^/]+/i, {
		message: 'Invalid LinkedIn Pulse article URL format',
	});

// Video URL: linkedin.com/video/event/{eventId}
const linkedInVideoUrlSchema = z
	.string()
	.regex(/linkedin\.com\/video\/event\/[^/]+/i, {
		message: 'Invalid LinkedIn video URL format',
	});

// Events URL: linkedin.com/events/{eventId}
const linkedInEventsUrlSchema = z
	.string()
	.regex(/linkedin\.com\/events\/[^/]+/i, {
		message: 'Invalid LinkedIn events URL format',
	});

// Company posts URL: linkedin.com/company/{companyId}/posts
const linkedInCompanyPostsSchema = z
	.string()
	.regex(/linkedin\.com\/company\/[^/]+\/posts/i, {
		message: 'Invalid LinkedIn company posts URL format',
	});

// Newsletter URL: linkedin.com/newsletters/{newsletterId}
const linkedInNewsletterSchema = z
	.string()
	.regex(/linkedin\.com\/newsletters\/[^/]+/i, {
		message: 'Invalid LinkedIn newsletter URL format',
	});

// Shortened URL: lnkd.in/{shortCode}
const linkedInShortenedUrlSchema = z
	.string()
	.regex(/lnkd\.in\/[a-zA-Z0-9_-]+/i, {
		message: 'Invalid LinkedIn shortened URL format',
	});

/**
 * Comprehensive LinkedIn URL schema
 * Accepts any valid LinkedIn post/content URL format
 */
export const LinkedInURLSchema = z
	.string()
	.trim()
	.min(1, { message: 'URL cannot be empty' })
	.url({ message: 'Invalid URL format' })
	.refine(
		(url) => linkedInDomainSchema.safeParse(url).success,
		{
			message: 'URL must be from a valid LinkedIn domain',
		}
	)
	.refine(
		(url) => {
			// Check if URL matches any of the valid LinkedIn URL patterns
			const patterns = [
				linkedInPostUrlSchema,
				linkedInActivityUpdateSchema,
				linkedInPulseUrlSchema,
				linkedInVideoUrlSchema,
				linkedInEventsUrlSchema,
				linkedInCompanyPostsSchema,
				linkedInNewsletterSchema,
				linkedInShortenedUrlSchema,
			];

			return patterns.some((schema) => schema.safeParse(url).success);
		},
		{
			message: 'URL must be a valid LinkedIn post, activity, article, video, event, or newsletter URL',
		}
	);

/**
 * LinkedIn URL with optional parameters schema
 * Includes validation for common query parameters
 */
export const LinkedInURLWithParamsSchema = LinkedInURLSchema.refine(
	(url) => {
		try {
			const urlObj = new URL(url);

			// Shortened URLs don't need additional validation
			if (urlObj.hostname === 'lnkd.in') {
				return true;
			}

			// Check for essential LinkedIn identifiers in pathname
			const hasEssentialIdentifier =
				urlObj.pathname.includes('/posts/') ||
				urlObj.pathname.includes('/feed/update/') ||
				urlObj.pathname.includes('/pulse/') ||
				urlObj.pathname.includes('/video/') ||
				urlObj.pathname.includes('/events/') ||
				urlObj.pathname.includes('/newsletters/') ||
				urlObj.pathname.includes('/company/');

			return hasEssentialIdentifier;
		} catch {
			return false;
		}
	},
	{
		message: 'LinkedIn URL must contain valid content identifiers',
	}
);

/**
 * Type inference from schemas
 */
export type LinkedInURL = z.infer<typeof LinkedInURLSchema>;
export type LinkedInPostId = z.infer<typeof LinkedInPostIdSchema>;
export type LinkedInActivityId = z.infer<typeof LinkedInActivityIdSchema>;
