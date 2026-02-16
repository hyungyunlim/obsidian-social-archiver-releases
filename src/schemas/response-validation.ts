/**
 * Zod schemas for BrightData API response validation
 */

import { z } from 'zod';
import { PLATFORMS, type Platform } from '@shared/platforms/types';

/**
 * Zod-compatible platform enum derived from centralized PLATFORMS constant
 */
const platformEnum = z.enum(PLATFORMS as unknown as [Platform, ...Platform[]]);

/**
 * Transform string to Date
 */
const dateTransform = z
	.string()
	.or(z.date())
	.transform((val) => (typeof val === 'string' ? new Date(val) : val));

/**
 * Transform string number to number
 */
const numberTransform = z
	.string()
	.or(z.number())
	.transform((val) => (typeof val === 'string' ? Number(val) : val));

/**
 * Author schema
 */
export const AuthorSchema = z.object({
	id: z.string(),
	name: z.string(),
	username: z.string().optional(),
	url: z.string().url(),
	avatarUrl: z.string().url().optional(),
	verified: z.boolean().optional().default(false),
	followerCount: numberTransform.optional(),
	bio: z.string().optional(),
});

/**
 * Media schema
 */
export const MediaSchema = z.object({
	type: z.enum(['photo', 'video', 'carousel', 'audio']),
	url: z.string().url(),
	thumbnailUrl: z.string().url().optional(),
	width: z.number().positive().optional(),
	height: z.number().positive().optional(),
	duration: z.number().positive().optional(),
	altText: z.string().optional(),
});

/**
 * Comment schema (recursive)
 */
export const CommentSchema: z.ZodType<any> = z.lazy(() =>
	z.object({
		id: z.string(),
		author: AuthorSchema,
		text: z.string(),
		timestamp: dateTransform,
		likes: numberTransform.optional().default(0),
		replies: z.array(CommentSchema).optional().default([]),
	})
);

/**
 * Location schema
 */
export const LocationSchema = z.object({
	name: z.string(),
	latitude: z.number().optional(),
	longitude: z.number().optional(),
});

/**
 * Base scraped post data schema
 */
export const BaseScrapedPostDataSchema = z.object({
	platform: platformEnum,
	id: z.string(),
	url: z.string().url(),
	author: AuthorSchema,
	text: z.string(),
	timestamp: dateTransform,
	media: z.array(MediaSchema).default([]),
	comments: z.array(CommentSchema).default([]),
	likes: numberTransform.default(0),
	shares: numberTransform.default(0),
	views: numberTransform.optional(),
	hashtags: z.array(z.string()).optional().default([]),
	mentions: z.array(z.string()).optional().default([]),
	location: LocationSchema.optional(),
	isSponsored: z.boolean().optional().default(false),
	language: z.string().optional(),
});

/**
 * Facebook Reactions schema
 */
export const ReactionsSchema = z.object({
	like: numberTransform.optional().default(0),
	love: numberTransform.optional().default(0),
	haha: numberTransform.optional().default(0),
	wow: numberTransform.optional().default(0),
	sad: numberTransform.optional().default(0),
	angry: numberTransform.optional().default(0),
	care: numberTransform.optional().default(0),
	total: numberTransform.default(0),
});

/**
 * Facebook post data schema
 */
export const FacebookPostDataSchema = BaseScrapedPostDataSchema.extend({
	platform: z.literal('facebook'),
	reactions: ReactionsSchema.optional(),
	postType: z.enum(['status', 'photo', 'video', 'link', 'live', 'album']).optional(),
	feeling: z.string().optional(),
	groupId: z.string().optional(),
	groupName: z.string().optional(),
});

/**
 * Instagram post data schema
 */
export const InstagramPostDataSchema = BaseScrapedPostDataSchema.extend({
	platform: z.literal('instagram'),
	isCarousel: z.boolean().optional().default(false),
	carouselItems: z.array(MediaSchema).optional().default([]),
	caption: z.string().optional(),
	aspectRatio: z.string().optional(),
	filterUsed: z.string().optional(),
});

/**
 * LinkedIn post insights schema
 */
export const PostInsightsSchema = z.object({
	impressions: numberTransform.optional(),
	clicks: numberTransform.optional(),
	engagement: numberTransform.optional(),
	shares: numberTransform.optional(),
	comments: numberTransform.optional(),
	reactions: numberTransform.optional(),
});

/**
 * LinkedIn post data schema
 */
export const LinkedInPostDataSchema = BaseScrapedPostDataSchema.extend({
	platform: z.literal('linkedin'),
	insights: PostInsightsSchema.optional(),
	articleUrl: z.string().url().optional(),
	articleTitle: z.string().optional(),
	companyId: z.string().optional(),
	companyName: z.string().optional(),
});

/**
 * TikTok post data schema
 */
export const TikTokPostDataSchema = BaseScrapedPostDataSchema.extend({
	platform: z.literal('tiktok'),
	soundName: z.string().optional(),
	soundUrl: z.string().url().optional(),
	soundAuthor: z.string().optional(),
	duetEnabled: z.boolean().optional().default(false),
	stitchEnabled: z.boolean().optional().default(false),
	challengeName: z.string().optional(),
	challengeId: z.string().optional(),
	effects: z.array(z.string()).optional().default([]),
});

/**
 * X (Twitter) post data schema
 */
export const XPostDataSchema: z.ZodType<any> = z.lazy(() =>
	BaseScrapedPostDataSchema.extend({
		platform: z.literal('x'),
		retweetCount: numberTransform.optional().default(0),
		quoteCount: numberTransform.optional().default(0),
		bookmarkCount: numberTransform.optional().default(0),
		inReplyToId: z.string().optional(),
		inReplyToUsername: z.string().optional(),
		isRetweet: z.boolean().optional().default(false),
		isQuoteTweet: z.boolean().optional().default(false),
		quotedPost: XPostDataSchema.optional(),
		retweetedPost: XPostDataSchema.optional(),
	})
);

/**
 * Threads post data schema
 */
export const ThreadsPostDataSchema = BaseScrapedPostDataSchema.extend({
	platform: z.literal('threads'),
	repostCount: numberTransform.optional().default(0),
	quoteCount: numberTransform.optional().default(0),
	inReplyToId: z.string().optional(),
});

/**
 * Union schema for all platform responses
 */
export const PlatformPostDataSchema = z.union([
	FacebookPostDataSchema,
	InstagramPostDataSchema,
	LinkedInPostDataSchema,
	TikTokPostDataSchema,
	XPostDataSchema,
	ThreadsPostDataSchema,
]);

/**
 * BrightData response metadata schema
 */
export const BrightDataMetadataSchema = z.object({
	requestId: z.string(),
	timestamp: dateTransform,
	duration: z.number().positive(),
	creditsUsed: z.number().nonnegative().default(1),
	cached: z.boolean().optional().default(false),
});

/**
 * BrightData response wrapper schema
 */
export const BrightDataResponseSchema = z.object({
	success: z.boolean(),
	data: PlatformPostDataSchema.optional(),
	error: z
		.object({
			code: z.string(),
			message: z.string(),
			details: z.unknown().optional(),
		})
		.optional(),
	metadata: BrightDataMetadataSchema,
});

/**
 * Type exports
 */
export type Author = z.infer<typeof AuthorSchema>;
export type Media = z.infer<typeof MediaSchema>;
export type Comment = z.infer<typeof CommentSchema>;
export type Location = z.infer<typeof LocationSchema>;
export type Reactions = z.infer<typeof ReactionsSchema>;
export type PostInsights = z.infer<typeof PostInsightsSchema>;
export type FacebookPostData = z.infer<typeof FacebookPostDataSchema>;
export type InstagramPostData = z.infer<typeof InstagramPostDataSchema>;
export type LinkedInPostData = z.infer<typeof LinkedInPostDataSchema>;
export type TikTokPostData = z.infer<typeof TikTokPostDataSchema>;
export type XPostData = z.infer<typeof XPostDataSchema>;
export type ThreadsPostData = z.infer<typeof ThreadsPostDataSchema>;
export type PlatformPostData = z.infer<typeof PlatformPostDataSchema>;
export type BrightDataMetadata = z.infer<typeof BrightDataMetadataSchema>;
export type BrightDataResponse = z.infer<typeof BrightDataResponseSchema>;
