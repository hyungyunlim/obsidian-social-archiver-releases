import { describe, it, expect } from 'vitest';
import {
	FacebookURLSchema,
	LinkedInURLSchema,
	InstagramURLSchema,
	TikTokURLSchema,
	XURLSchema,
	ThreadsURLSchema,
	RedditURLSchema,
	PinterestURLSchema,
	SubstackURLSchema,
	TumblrURLSchema,
	NaverWebtoonURLSchema,
	extractNaverWebtoonInfo,
	AnySocialMediaURLSchema,
	getPlatformSchema,
	validateAndDetectPlatform,
	validatePlatformUrl,
	isSupportedPlatformUrl,
} from '@/schemas/platforms';

describe('Platform URL Schemas', () => {
	describe('FacebookURLSchema', () => {
		describe('Valid URLs', () => {
			const validUrls = [
				// Standard post URLs
				'https://facebook.com/johndoe/posts/123456789',
				'https://www.facebook.com/johndoe/posts/123456789',
				'http://facebook.com/johndoe/posts/123456789',
				'https://m.facebook.com/johndoe/posts/123456789',

				// Permalink URLs
				'https://facebook.com/permalink.php?story_fbid=123456789',
				'https://www.facebook.com/permalink.php?story_fbid=987654321',

				// Photo URLs
				'https://facebook.com/photo.php?fbid=123456789',
				'https://facebook.com/photo?fbid=123456789',

				// Watch/Video URLs
				'https://facebook.com/watch/?v=123456789',
				'https://facebook.com/johndoe/videos/123456789',
				'https://fb.watch/abc123',

				// Share URLs
				'https://facebook.com/share/abc123xyz',
				'https://facebook.com/share.php?id=123',

				// Story URLs
				'https://facebook.com/stories/123456789',

				// Group posts
				'https://facebook.com/groups/mygroup/posts/123456789',
				'https://facebook.com/groups/mygroup/permalink/123456789',

				// Mobile URLs
				'https://m.facebook.com/story.php?story_fbid=123456789',
				'https://m.facebook.com/photo.php?fbid=123456789',
			];

			validUrls.forEach((url) => {
				it(`should validate: ${url}`, () => {
					const result = FacebookURLSchema.safeParse(url);
					expect(result.success).toBe(true);
				});
			});
		});

		describe('Invalid URLs', () => {
			const invalidUrls = [
				'https://instagram.com/p/ABC123',
				'https://twitter.com/user/status/123',
				'https://facebook.com',
				'https://facebook.com/johndoe',
				'not a url',
				'',
				'https://fakebook.com/posts/123',
			];

			invalidUrls.forEach((url) => {
				it(`should reject: ${url}`, () => {
					const result = FacebookURLSchema.safeParse(url);
					expect(result.success).toBe(false);
				});
			});
		});
	});

	describe('LinkedInURLSchema', () => {
		describe('Valid URLs', () => {
			const validUrls = [
				// Post URLs
				'https://linkedin.com/posts/johndoe_activity-1234567890',
				'https://www.linkedin.com/posts/johndoe_abcdefg-1234567890',

				// Activity update URLs
				'https://linkedin.com/feed/update/urn:li:activity:1234567890',
				'https://linkedin.com/feed/update/urn:li:share:9876543210',

				// Pulse articles
				'https://linkedin.com/pulse/my-article-slug',
				'https://www.linkedin.com/pulse/another-article',

				// Video URLs
				'https://linkedin.com/video/event/abc123',

				// Events
				'https://linkedin.com/events/event-id-123',

				// Company posts
				'https://linkedin.com/company/mycompany/posts',

				// Newsletters
				'https://linkedin.com/newsletters/newsletter-slug',

				// Shortened URLs
				'https://lnkd.in/abc123',
			];

			validUrls.forEach((url) => {
				it(`should validate: ${url}`, () => {
					const result = LinkedInURLSchema.safeParse(url);
					expect(result.success).toBe(true);
				});
			});
		});

		describe('Invalid URLs', () => {
			const invalidUrls = [
				'https://facebook.com/posts/123',
				'https://linkedin.com',
				'https://linkedin.com/in/johndoe',
				'not a url',
				'',
			];

			invalidUrls.forEach((url) => {
				it(`should reject: ${url}`, () => {
					const result = LinkedInURLSchema.safeParse(url);
					expect(result.success).toBe(false);
				});
			});
		});
	});

	describe('InstagramURLSchema', () => {
		describe('Valid URLs', () => {
			const validUrls = [
				// Post URLs
				'https://instagram.com/p/ABC123xyz',
				'https://www.instagram.com/p/XYZ789abc',

				// Reel URLs
				'https://instagram.com/reel/ABC123',
				'https://instagram.com/reels/XYZ789',

				// TV/IGTV URLs
				'https://instagram.com/tv/ABC123',

				// Story URLs
				'https://instagram.com/stories/johndoe/123456789',

				// Shortened URLs
				'https://instagr.am/p/ABC123',
			];

			validUrls.forEach((url) => {
				it(`should validate: ${url}`, () => {
					const result = InstagramURLSchema.safeParse(url);
					expect(result.success).toBe(true);
				});
			});
		});

		describe('Invalid URLs', () => {
			const invalidUrls = [
				'https://facebook.com/posts/123',
				'https://instagram.com',
				'https://instagram.com/johndoe',
				'not a url',
				'',
			];

			invalidUrls.forEach((url) => {
				it(`should reject: ${url}`, () => {
					const result = InstagramURLSchema.safeParse(url);
					expect(result.success).toBe(false);
				});
			});
		});
	});

	describe('TikTokURLSchema', () => {
		describe('Valid URLs', () => {
			const validUrls = [
				// Standard video URLs
				'https://tiktok.com/@username/video/1234567890',
				'https://www.tiktok.com/@johndoe/video/9876543210',

				// Video without username
				'https://tiktok.com/video/1234567890',

				// Shortened URLs
				'https://vm.tiktok.com/abc123',
				'https://vt.tiktok.com/xyz789',

				// Live URLs
				'https://tiktok.com/@username/live',

				// Photo posts
				'https://tiktok.com/@username/photo/1234567890',
			];

			validUrls.forEach((url) => {
				it(`should validate: ${url}`, () => {
					const result = TikTokURLSchema.safeParse(url);
					expect(result.success).toBe(true);
				});
			});
		});

		describe('Invalid URLs', () => {
			const invalidUrls = [
				'https://facebook.com/posts/123',
				'https://tiktok.com',
				'https://tiktok.com/@username',
				'not a url',
				'',
			];

			invalidUrls.forEach((url) => {
				it(`should reject: ${url}`, () => {
					const result = TikTokURLSchema.safeParse(url);
					expect(result.success).toBe(false);
				});
			});
		});
	});

	describe('XURLSchema', () => {
		describe('Valid URLs', () => {
			const validUrls = [
				// X.com URLs
				'https://x.com/username/status/1234567890',
				'https://www.x.com/johndoe/status/9876543210',

				// Twitter.com URLs
				'https://twitter.com/username/status/1234567890',
				'https://www.twitter.com/johndoe/status/9876543210',

				// Tweet with photo
				'https://x.com/username/status/1234567890/photo/1',
				'https://twitter.com/username/status/1234567890/photo/2',

				// Tweet with video
				'https://x.com/username/status/1234567890/video/1',

				// Mobile URLs
				'https://mobile.x.com/username/status/1234567890',
				'https://mobile.twitter.com/username/status/1234567890',

				// Shortened URLs
				'https://t.co/abc123',

				// Moments
				'https://x.com/i/moments/1234567890',
				'https://twitter.com/i/moments/9876543210',

				// Spaces
				'https://x.com/i/spaces/abc123xyz',
				'https://twitter.com/i/spaces/xyz789abc',
			];

			validUrls.forEach((url) => {
				it(`should validate: ${url}`, () => {
					const result = XURLSchema.safeParse(url);
					expect(result.success).toBe(true);
				});
			});
		});

		describe('Invalid URLs', () => {
			const invalidUrls = [
				'https://facebook.com/posts/123',
				'https://x.com',
				'https://x.com/username',
				'not a url',
				'',
			];

			invalidUrls.forEach((url) => {
				it(`should reject: ${url}`, () => {
					const result = XURLSchema.safeParse(url);
					expect(result.success).toBe(false);
				});
			});
		});
	});

	describe('ThreadsURLSchema', () => {
		describe('Valid URLs', () => {
			const validUrls = [
				// Standard post URLs
				'https://threads.net/@username/post/ABC123xyz',
				'https://www.threads.net/@johndoe/post/XYZ789abc',

				// Thread URLs
				'https://threads.net/t/ABC123',
				'https://www.threads.net/t/XYZ789',

				// Direct post URLs
				'https://threads.net/ABC123xyz',
			];

			validUrls.forEach((url) => {
				it(`should validate: ${url}`, () => {
					const result = ThreadsURLSchema.safeParse(url);
					expect(result.success).toBe(true);
				});
			});
		});

		describe('Invalid URLs', () => {
			const invalidUrls = [
				'https://facebook.com/posts/123',
				'https://threads.net',
				'https://threads.net/@username',
				'not a url',
				'',
			];

			invalidUrls.forEach((url) => {
				it(`should reject: ${url}`, () => {
					const result = ThreadsURLSchema.safeParse(url);
					expect(result.success).toBe(false);
				});
			});
		});
	});

		describe('AnySocialMediaURLSchema', () => {
			it('should validate URLs from all supported platforms', () => {
			const validUrls = [
				'https://facebook.com/user/posts/123',
				'https://linkedin.com/posts/user_activity-123',
				'https://instagram.com/p/ABC123',
				'https://tiktok.com/@user/video/123',
				'https://x.com/user/status/123',
				'https://threads.net/@user/post/ABC123',
				'https://youtube.com/watch?v=abcdEFG1234',
				'https://reddit.com/r/test/comments/abc123/a-title',
				'https://pinterest.com/pin/428545720815525504/',
				'https://fr.pinterest.com/66fd5c023f94f77eeed8517814d3c7/a-4/',
			];

			validUrls.forEach((url) => {
				const result = AnySocialMediaURLSchema.safeParse(url);
				expect(result.success).toBe(true);
			});
		});

			it('should reject unsupported platform URLs', () => {
				const invalidUrls = [
					'https://pinterestboard.com/pin/123',
					'https://example.com/post/123',
					'not a url',
					'',
				];

			invalidUrls.forEach((url) => {
				const result = AnySocialMediaURLSchema.safeParse(url);
				expect(result.success).toBe(false);
			});
		});
	});

	describe('RedditURLSchema', () => {
		it('should validate standard comment URLs', () => {
			const url = 'https://www.reddit.com/r/espresso/comments/abc123/my_favorite_shot/';
			const result = RedditURLSchema.safeParse(url);
			expect(result.success).toBe(true);
		});

		it('should validate new share short links', () => {
			const url = 'https://reddit.com/r/espresso/s/zVi0Vdref6';
			const result = RedditURLSchema.safeParse(url);
			expect(result.success).toBe(true);
		});

		it('should reject malformed Reddit paths', () => {
			const url = 'https://reddit.com/r/espresso/comments/not-an-id';
			const result = RedditURLSchema.safeParse(url);
			expect(result.success).toBe(false);
		});
	});

describe('PinterestURLSchema', () => {
		describe('Valid URLs', () => {
			const validUrls = [
				'https://www.pinterest.com/pin/428545720815525504/',
				'https://pinterest.com/pin/428545720815525504',
				'https://pin.it/aBc123Xy',
				'https://fr.pinterest.com/66fd5c023f94f77eeed8517814d3c7/a-4/',
				'https://www.pinterest.com/acmeagency/brand-refresh/',
			];

			validUrls.forEach((url) => {
				it(`should validate: ${url}`, () => {
					const result = PinterestURLSchema.safeParse(url);
					expect(result.success).toBe(true);
				});
			});
		});

		describe('Invalid URLs', () => {
			const invalidUrls = [
				'https://pinterest.com/',
				'https://www.pinterest.com/pin/',
				'https://pin.it/',
				'https://pinimg.com/pin/123',
				'https://www.pinterest.com/ideas/',
				'not a url',
			];

			invalidUrls.forEach((url) => {
				it(`should reject: ${url}`, () => {
					const result = PinterestURLSchema.safeParse(url);
					expect(result.success).toBe(false);
				});
			});
		});
	});

	describe('TumblrURLSchema', () => {
		describe('Valid URLs', () => {
			const validUrls = [
				'https://www.tumblr.com/samferd/799292732308865024/what',
				'https://www.tumblr.com/venicebitch-7/798307628906364928',
				'https://samferd.tumblr.com/post/799292732308865024/what',
				'https://blog.tumblr.com/post/799292732308865024',
			];

			validUrls.forEach((url) => {
				it(`should validate: ${url}`, () => {
					const result = TumblrURLSchema.safeParse(url);
					expect(result.success).toBe(true);
				});
			});
		});

		describe('Invalid URLs', () => {
			const invalidUrls = [
				'https://www.tumblr.com',
				'https://tumblr.com/explore',
				'https://example.com/post/799292732308865024',
				'https://samferd.tumblr.com/',
				'not a url',
			];

			invalidUrls.forEach((url) => {
				it(`should reject: ${url}`, () => {
					const result = TumblrURLSchema.safeParse(url);
					expect(result.success).toBe(false);
				});
			});
		});
	});

		describe('getPlatformSchema', () => {
			it('should return correct schema for each platform', () => {
				expect(getPlatformSchema('facebook')).toBe(FacebookURLSchema);
				expect(getPlatformSchema('linkedin')).toBe(LinkedInURLSchema);
				expect(getPlatformSchema('instagram')).toBe(InstagramURLSchema);
				expect(getPlatformSchema('tiktok')).toBe(TikTokURLSchema);
				expect(getPlatformSchema('x')).toBe(XURLSchema);
				expect(getPlatformSchema('threads')).toBe(ThreadsURLSchema);
				expect(getPlatformSchema('reddit')).toBe(RedditURLSchema);
				expect(getPlatformSchema('pinterest')).toBe(PinterestURLSchema);
				expect(getPlatformSchema('substack')).toBe(SubstackURLSchema);
				expect(getPlatformSchema('tumblr')).toBe(TumblrURLSchema);
			});
		});

		describe('validateAndDetectPlatform', () => {
		it('should detect and validate Facebook URLs', () => {
			const result = validateAndDetectPlatform('https://facebook.com/user/posts/123');
			expect(result.valid).toBe(true);
			expect(result.platform).toBe('facebook');
			expect(result.errors).toEqual([]);
		});

		it('should detect and validate LinkedIn URLs', () => {
			const result = validateAndDetectPlatform('https://linkedin.com/posts/user_activity-123');
			expect(result.valid).toBe(true);
			expect(result.platform).toBe('linkedin');
			expect(result.errors).toEqual([]);
		});

		it('should detect and validate Instagram URLs', () => {
			const result = validateAndDetectPlatform('https://instagram.com/p/ABC123');
			expect(result.valid).toBe(true);
			expect(result.platform).toBe('instagram');
			expect(result.errors).toEqual([]);
		});

		it('should detect and validate TikTok URLs', () => {
			const result = validateAndDetectPlatform('https://tiktok.com/@user/video/123');
			expect(result.valid).toBe(true);
			expect(result.platform).toBe('tiktok');
			expect(result.errors).toEqual([]);
		});

		it('should detect and validate X URLs', () => {
			const result = validateAndDetectPlatform('https://x.com/user/status/123');
			expect(result.valid).toBe(true);
			expect(result.platform).toBe('x');
			expect(result.errors).toEqual([]);
		});

			it('should detect and validate Threads URLs', () => {
				const result = validateAndDetectPlatform('https://threads.net/@user/post/ABC123');
				expect(result.valid).toBe(true);
				expect(result.platform).toBe('threads');
				expect(result.errors).toEqual([]);
			});

			it('should detect and validate YouTube URLs', () => {
				const result = validateAndDetectPlatform('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
				expect(result.valid).toBe(true);
				expect(result.platform).toBe('youtube');
				expect(result.errors).toEqual([]);
			});

			it('should detect and validate Reddit share URLs', () => {
				const result = validateAndDetectPlatform('https://www.reddit.com/r/espresso/s/zVi0Vdref6');
				expect(result.valid).toBe(true);
				expect(result.platform).toBe('reddit');
				expect(result.errors).toEqual([]);
			});

		it('should detect and validate Pinterest URLs', () => {
			const result = validateAndDetectPlatform('https://www.pinterest.com/pin/428545720815525504/');
			expect(result.valid).toBe(true);
			expect(result.platform).toBe('pinterest');
			expect(result.errors).toEqual([]);
		});

		it('should detect and validate Substack URLs', () => {
			const result = validateAndDetectPlatform('https://substack.com/@hannahbay/note/c-174236981');
			expect(result.valid).toBe(true);
			expect(result.platform).toBe('substack');
			expect(result.errors).toEqual([]);
		});

		it('should detect and validate Tumblr URLs', () => {
			const result = validateAndDetectPlatform('https://www.tumblr.com/samferd/799292732308865024/what');
			expect(result.valid).toBe(true);
			expect(result.platform).toBe('tumblr');
			expect(result.errors).toEqual([]);
		});

		it('should detect and validate Mastodon URLs', () => {
			const result = validateAndDetectPlatform('https://mastodon.social/@example/123456789');
			expect(result.valid).toBe(true);
			expect(result.platform).toBe('mastodon');
			expect(result.errors).toEqual([]);
		});

		it('should detect and validate Bluesky URLs', () => {
			const result = validateAndDetectPlatform('https://bsky.app/profile/example.com/post/3k5abcxyz');
			expect(result.valid).toBe(true);
			expect(result.platform).toBe('bluesky');
			expect(result.errors).toEqual([]);
		});

			it('should return invalid for unsupported URLs', () => {
				const result = validateAndDetectPlatform('https://example.net/post/123');
				expect(result.valid).toBe(false);
				expect(result.platform).toBe(null);
				expect(result.errors.length).toBeGreaterThan(0);
			});
		});

	describe('validatePlatformUrl', () => {
		it('should validate URL for specific platform', () => {
			const result = validatePlatformUrl('https://facebook.com/user/posts/123', 'facebook');
			expect(result.success).toBe(true);
		});

		it('should reject URL from wrong platform', () => {
			const result = validatePlatformUrl('https://instagram.com/p/ABC123', 'facebook');
			expect(result.success).toBe(false);
		});

		it('should reject invalid URLs', () => {
			const result = validatePlatformUrl('not a url', 'facebook');
			expect(result.success).toBe(false);
		});

		it('should validate Pinterest pin URLs', () => {
			const result = validatePlatformUrl('https://pin.it/AbC123', 'pinterest');
			expect(result.success).toBe(true);
		});

		it('should validate Substack URLs', () => {
			const result = validatePlatformUrl('https://newsletter.substack.com/p/welcome', 'substack');
			expect(result.success).toBe(true);
		});

		it('should validate Tumblr URLs', () => {
			const result = validatePlatformUrl('https://www.tumblr.com/samferd/799292732308865024/what', 'tumblr');
			expect(result.success).toBe(true);
		});
	});

			describe('isSupportedPlatformUrl', () => {
				it('should return true for supported platform URLs', () => {
					expect(isSupportedPlatformUrl('https://facebook.com/user/posts/123')).toBe(true);
					expect(isSupportedPlatformUrl('https://instagram.com/p/ABC123')).toBe(true);
					expect(isSupportedPlatformUrl('https://x.com/user/status/123')).toBe(true);
					expect(isSupportedPlatformUrl('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
					expect(isSupportedPlatformUrl('https://reddit.com/r/test/comments/abc123/example')).toBe(true);
			expect(isSupportedPlatformUrl('https://www.pinterest.com/pin/428545720815525504/')).toBe(true);
			expect(isSupportedPlatformUrl('https://fr.pinterest.com/66fd5c023f94f77eeed8517814d3c7/a-4/')).toBe(true);
			expect(isSupportedPlatformUrl('https://substack.com/@creator/post/p-12345')).toBe(true);
			expect(isSupportedPlatformUrl('https://www.tumblr.com/samferd/799292732308865024/what')).toBe(true);
		});

			it('should return false for unsupported URLs', () => {
				expect(isSupportedPlatformUrl('https://example.com/pin/123')).toBe(false);
				expect(isSupportedPlatformUrl('not a url')).toBe(false);
				expect(isSupportedPlatformUrl('')).toBe(false);
			});
		});

	describe('Custom error messages', () => {
		it('should provide custom error messages for empty URLs', () => {
			const result = FacebookURLSchema.safeParse('');
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.errors[0].message).toContain('cannot be empty');
			}
		});

		it('should provide custom error messages for invalid URL format', () => {
			const result = FacebookURLSchema.safeParse('not a url');
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.errors[0].message).toContain('Invalid URL format');
			}
		});

		it('should provide custom error messages for wrong domain', () => {
			const result = FacebookURLSchema.safeParse('https://instagram.com/p/ABC123');
			expect(result.success).toBe(false);
			if (!result.success) {
				const errorMessage = result.error.errors[0].message;
				expect(errorMessage).toContain('Facebook');
			}
		});
	});

	describe('Edge cases', () => {
		it('should handle URLs with tracking parameters', () => {
			const url = 'https://facebook.com/user/posts/123?utm_source=test&fbclid=abc';
			const result = FacebookURLSchema.safeParse(url);
			expect(result.success).toBe(true);
		});

		it('should handle URLs with hash fragments', () => {
			const url = 'https://facebook.com/user/posts/123#comment';
			const result = FacebookURLSchema.safeParse(url);
			expect(result.success).toBe(true);
		});

		it('should handle URLs with www prefix', () => {
			const url = 'https://www.facebook.com/user/posts/123';
			const result = FacebookURLSchema.safeParse(url);
			expect(result.success).toBe(true);
		});

		it('should handle URLs without protocol', () => {
			const url = 'facebook.com/user/posts/123';
			const result = FacebookURLSchema.safeParse(url);
			// This should fail because Zod's url() validator requires protocol
			expect(result.success).toBe(false);
		});

		it('should handle URLs with trailing slashes', () => {
			const url = 'https://facebook.com/user/posts/123/';
			const result = FacebookURLSchema.safeParse(url);
			expect(result.success).toBe(true);
		});

		it('should trim whitespace from URLs', () => {
			const url = '  https://facebook.com/user/posts/123  ';
			const result = FacebookURLSchema.safeParse(url);
			expect(result.success).toBe(true);
		});
	});
});

describe('SubstackURLSchema', () => {
	describe('Valid URLs', () => {
		const validUrls = [
			'https://substack.com/@hannahbay/note/c-174236981',
			'https://substack.com/@creator/post/p-abc123',
			'https://newsletter.substack.com/p/my-latest-post',
		];

		validUrls.forEach((url) => {
			it(`should validate: ${url}`, () => {
				const result = SubstackURLSchema.safeParse(url);
				expect(result.success).toBe(true);
			});
		});
	});

	describe('Invalid URLs', () => {
		const invalidUrls = [
			'https://substack.com',
			'https://substack.com/@user',
			'https://example.com/@user/note/c-111',
			'https://news.substack.net',
		];

		invalidUrls.forEach((url) => {
			it(`should reject: ${url}`, () => {
				const result = SubstackURLSchema.safeParse(url);
				expect(result.success).toBe(false);
			});
		});
	});
});

describe('NaverWebtoonURLSchema', () => {
	describe('Valid URLs', () => {
		const validUrls = [
			// Series list pages
			'https://comic.naver.com/webtoon/list?titleId=650305',
			'https://comic.naver.com/webtoon/list?titleId=123456',
			'https://comic.naver.com/webtoon/list?titleId=650305&page=2',
			'https://comic.naver.com/webtoon/list?titleId=650305&weekday=mon',

			// Episode detail pages
			'https://comic.naver.com/webtoon/detail?titleId=650305&no=1',
			'https://comic.naver.com/webtoon/detail?titleId=650305&no=100',
			'https://comic.naver.com/webtoon/detail?titleId=123456&no=50',
			'https://comic.naver.com/webtoon/detail?titleId=650305&no=1&weekday=mon',
		];

		validUrls.forEach((url) => {
			it(`should validate: ${url}`, () => {
				const result = NaverWebtoonURLSchema.safeParse(url);
				expect(result.success).toBe(true);
			});
		});
	});

	describe('Mobile URL normalization', () => {
		it('should normalize mobile URLs to desktop', () => {
			const mobileUrl = 'https://m.comic.naver.com/webtoon/list?titleId=650305';
			const result = NaverWebtoonURLSchema.safeParse(mobileUrl);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toBe('https://comic.naver.com/webtoon/list?titleId=650305');
			}
		});

		it('should normalize mobile detail URLs', () => {
			const mobileUrl = 'https://m.comic.naver.com/webtoon/detail?titleId=650305&no=1';
			const result = NaverWebtoonURLSchema.safeParse(mobileUrl);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toBe('https://comic.naver.com/webtoon/detail?titleId=650305&no=1');
			}
		});
	});

	describe('Invalid URLs', () => {
		const invalidUrls = [
			// Missing titleId
			'https://comic.naver.com/webtoon/list',
			'https://comic.naver.com/webtoon/detail',

			// Wrong path
			'https://comic.naver.com/webtoon',
			'https://comic.naver.com/',
			'https://comic.naver.com/bestChallenge/list?titleId=123',
			'https://comic.naver.com/challenge/list?titleId=123',

			// Wrong domain
			'https://blog.naver.com/webtoon/list?titleId=123',
			'https://cafe.naver.com/webtoon/list?titleId=123',
			'https://example.com/webtoon/list?titleId=123',

			// Not a URL
			'not a url',
			'',

			// Other Naver URLs (should not match naver-webtoon)
			'https://blog.naver.com/username/123456',
			'https://cafe.naver.com/cafename/123456',
			'https://news.naver.com/article/123/456',
		];

		invalidUrls.forEach((url) => {
			it(`should reject: ${url}`, () => {
				const result = NaverWebtoonURLSchema.safeParse(url);
				expect(result.success).toBe(false);
			});
		});
	});
});

describe('extractNaverWebtoonInfo', () => {
	describe('Series URLs', () => {
		it('should extract titleId from series list URL', () => {
			const result = extractNaverWebtoonInfo('https://comic.naver.com/webtoon/list?titleId=650305');
			expect(result).not.toBeNull();
			expect(result?.titleId).toBe('650305');
			expect(result?.urlType).toBe('series');
			expect(result?.episodeNo).toBeUndefined();
		});

		it('should extract titleId from series URL with pagination', () => {
			const result = extractNaverWebtoonInfo('https://comic.naver.com/webtoon/list?titleId=123456&page=5');
			expect(result).not.toBeNull();
			expect(result?.titleId).toBe('123456');
			expect(result?.urlType).toBe('series');
		});

		it('should handle mobile series URLs', () => {
			const result = extractNaverWebtoonInfo('https://m.comic.naver.com/webtoon/list?titleId=650305');
			expect(result).not.toBeNull();
			expect(result?.titleId).toBe('650305');
			expect(result?.urlType).toBe('series');
		});
	});

	describe('Episode URLs', () => {
		it('should extract titleId and episodeNo from episode detail URL', () => {
			const result = extractNaverWebtoonInfo('https://comic.naver.com/webtoon/detail?titleId=650305&no=1');
			expect(result).not.toBeNull();
			expect(result?.titleId).toBe('650305');
			expect(result?.episodeNo).toBe(1);
			expect(result?.urlType).toBe('episode');
		});

		it('should extract large episode numbers', () => {
			const result = extractNaverWebtoonInfo('https://comic.naver.com/webtoon/detail?titleId=650305&no=999');
			expect(result).not.toBeNull();
			expect(result?.titleId).toBe('650305');
			expect(result?.episodeNo).toBe(999);
			expect(result?.urlType).toBe('episode');
		});

		it('should handle mobile episode URLs', () => {
			const result = extractNaverWebtoonInfo('https://m.comic.naver.com/webtoon/detail?titleId=650305&no=50');
			expect(result).not.toBeNull();
			expect(result?.titleId).toBe('650305');
			expect(result?.episodeNo).toBe(50);
			expect(result?.urlType).toBe('episode');
		});

		it('should handle episode URL without no parameter (treat as episode with undefined no)', () => {
			const result = extractNaverWebtoonInfo('https://comic.naver.com/webtoon/detail?titleId=650305');
			expect(result).not.toBeNull();
			expect(result?.titleId).toBe('650305');
			expect(result?.episodeNo).toBeUndefined();
			expect(result?.urlType).toBe('episode');
		});
	});

	describe('Invalid URLs', () => {
		it('should return null for non-webtoon URLs', () => {
			expect(extractNaverWebtoonInfo('https://blog.naver.com/user/123')).toBeNull();
			expect(extractNaverWebtoonInfo('https://cafe.naver.com/cafe/123')).toBeNull();
			expect(extractNaverWebtoonInfo('https://example.com/webtoon/list?titleId=123')).toBeNull();
		});

		it('should return null for URLs without titleId', () => {
			expect(extractNaverWebtoonInfo('https://comic.naver.com/webtoon/list')).toBeNull();
			expect(extractNaverWebtoonInfo('https://comic.naver.com/webtoon/detail')).toBeNull();
		});

		it('should return null for invalid URLs', () => {
			expect(extractNaverWebtoonInfo('not a url')).toBeNull();
			expect(extractNaverWebtoonInfo('')).toBeNull();
		});

		it('should return null for bestChallenge/challenge paths', () => {
			expect(extractNaverWebtoonInfo('https://comic.naver.com/bestChallenge/list?titleId=123')).toBeNull();
			expect(extractNaverWebtoonInfo('https://comic.naver.com/challenge/list?titleId=123')).toBeNull();
		});
	});
});

describe('validateAndDetectPlatform for Naver Webtoon', () => {
	it('should detect and validate Naver Webtoon series URLs', () => {
		const result = validateAndDetectPlatform('https://comic.naver.com/webtoon/list?titleId=650305');
		expect(result.valid).toBe(true);
		expect(result.platform).toBe('naver-webtoon');
		expect(result.errors).toEqual([]);
	});

	it('should detect and validate Naver Webtoon episode URLs', () => {
		const result = validateAndDetectPlatform('https://comic.naver.com/webtoon/detail?titleId=650305&no=1');
		expect(result.valid).toBe(true);
		expect(result.platform).toBe('naver-webtoon');
		expect(result.errors).toEqual([]);
	});

	it('should detect plain Naver URLs (blog, cafe) as naver, not naver-webtoon', () => {
		const blogResult = validateAndDetectPlatform('https://blog.naver.com/username/123456789');
		expect(blogResult.valid).toBe(true);
		expect(blogResult.platform).toBe('naver');

		const cafeResult = validateAndDetectPlatform('https://cafe.naver.com/cafename/123456');
		expect(cafeResult.valid).toBe(true);
		expect(cafeResult.platform).toBe('naver');
	});
});

describe('validatePlatformUrl for Naver Webtoon', () => {
	it('should validate Naver Webtoon series URL', () => {
		const result = validatePlatformUrl('https://comic.naver.com/webtoon/list?titleId=650305', 'naver-webtoon');
		expect(result.success).toBe(true);
	});

	it('should validate Naver Webtoon episode URL', () => {
		const result = validatePlatformUrl('https://comic.naver.com/webtoon/detail?titleId=650305&no=1', 'naver-webtoon');
		expect(result.success).toBe(true);
	});

	it('should reject Naver blog URL when validating as naver-webtoon', () => {
		const result = validatePlatformUrl('https://blog.naver.com/user/123', 'naver-webtoon');
		expect(result.success).toBe(false);
	});

	it('should reject non-webtoon comic.naver.com URLs', () => {
		const result = validatePlatformUrl('https://comic.naver.com/bestChallenge/list?titleId=123', 'naver-webtoon');
		expect(result.success).toBe(false);
	});
});

describe('isSupportedPlatformUrl for Naver Webtoon', () => {
	it('should return true for Naver Webtoon series URLs', () => {
		expect(isSupportedPlatformUrl('https://comic.naver.com/webtoon/list?titleId=650305')).toBe(true);
	});

	it('should return true for Naver Webtoon episode URLs', () => {
		expect(isSupportedPlatformUrl('https://comic.naver.com/webtoon/detail?titleId=650305&no=1')).toBe(true);
	});

	it('should return true for mobile Naver Webtoon URLs', () => {
		expect(isSupportedPlatformUrl('https://m.comic.naver.com/webtoon/list?titleId=650305')).toBe(true);
	});
});
