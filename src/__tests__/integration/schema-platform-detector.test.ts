import { describe, it, expect, beforeEach } from 'vitest';
import { PlatformDetector } from '@/services/PlatformDetector';
import {
	validateAndDetectPlatform,
	validatePlatformUrl,
	getPlatformSchema,
	isSupportedPlatformUrl,
} from '@/schemas/platforms';
import type { Platform } from '@/types/post';

/**
 * Integration tests for Zod schema validation with PlatformDetector
 * Ensures consistency between schema validation and platform detection
 */
describe('Schema + PlatformDetector Integration', () => {
	let detector: PlatformDetector;

	beforeEach(() => {
		detector = new PlatformDetector();
	});

		describe('Validation consistency with detection', () => {
			const testUrls: Array<[string, Platform]> = [
			// Facebook
			['https://facebook.com/user/posts/123456789', 'facebook'],
			['https://www.facebook.com/photo.php?fbid=789', 'facebook'],
			['https://fb.watch/abc123', 'facebook'],

			// LinkedIn
			['https://linkedin.com/posts/user_activity-abc123', 'linkedin'],
			['https://www.linkedin.com/feed/update/urn:li:activity:456', 'linkedin'],
			['https://lnkd.in/abc123', 'linkedin'],

			// Instagram
			['https://instagram.com/p/ABC123xyz', 'instagram'],
			['https://www.instagram.com/reel/XYZ789', 'instagram'],
			['https://instagr.am/p/DEF456', 'instagram'],

			// TikTok
			['https://tiktok.com/@user/video/123456789', 'tiktok'],
			['https://vm.tiktok.com/ABC123', 'tiktok'],
			['https://www.tiktok.com/@user/photo/456', 'tiktok'],

			// X (Twitter)
			['https://x.com/user/status/1234567890', 'x'],
			['https://twitter.com/user/status/9876543210', 'x'],
			['https://t.co/abc123', 'x'],

				// Threads
				['https://threads.net/@user/post/ABC123', 'threads'],
				['https://www.threads.net/t/XYZ789', 'threads'],

				// YouTube
				['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube'],
				['https://youtu.be/dQw4w9WgXcQ', 'youtube'],

				// Reddit
				['https://www.reddit.com/r/espresso/comments/abc123/my_favorite_shot/', 'reddit'],
				['https://www.reddit.com/r/espresso/s/zVi0Vdref6', 'reddit'],

			// Pinterest
			['https://www.pinterest.com/pin/428545720815525504/', 'pinterest'],
			['https://pin.it/AbC123', 'pinterest'],
			['https://fr.pinterest.com/66fd5c023f94f77eeed8517814d3c7/a-4/', 'pinterest'],

			// Substack
			['https://substack.com/@hannahbay/note/c-174236981', 'substack'],
			['https://newsletter.substack.com/p/a-new-post', 'substack'],

			// Tumblr
			['https://www.tumblr.com/samferd/799292732308865024/what', 'tumblr'],
			['https://samferd.tumblr.com/post/799292732308865024', 'tumblr'],
		];

		testUrls.forEach(([url, expectedPlatform]) => {
			it(`should have consistent validation and detection for ${expectedPlatform}: ${url}`, () => {
				// Test PlatformDetector
				const detectedPlatform = detector.detectPlatform(url);
				expect(detectedPlatform).toBe(expectedPlatform);

				// Test validateAndDetectPlatform
				const validationResult = validateAndDetectPlatform(url);
				expect(validationResult.valid).toBe(true);
				expect(validationResult.platform).toBe(expectedPlatform);
				expect(validationResult.errors).toEqual([]);

				// Test platform-specific schema
				const schema = getPlatformSchema(expectedPlatform);
				const schemaResult = schema.safeParse(url);
				expect(schemaResult.success).toBe(true);

				// Test validatePlatformUrl
				const platformValidation = validatePlatformUrl(url, expectedPlatform);
				expect(platformValidation.success).toBe(true);

				// Test isSupportedPlatformUrl
				expect(isSupportedPlatformUrl(url)).toBe(true);
			});
		});
	});

		describe('Invalid URL handling', () => {
			const invalidUrls = [
				'https://example.com/page',
				'https://unsupported.social.com/post/123',
				'not-a-url',
				'',
			];

		invalidUrls.forEach((url) => {
			it(`should consistently reject invalid URL: ${url}`, () => {
				// PlatformDetector should return null
				const detectedPlatform = detector.detectPlatform(url);
				expect(detectedPlatform).toBeNull();

				// validateAndDetectPlatform should return invalid
				const validationResult = validateAndDetectPlatform(url);
				expect(validationResult.valid).toBe(false);
				expect(validationResult.platform).toBeNull();

				// isSupportedPlatformUrl should return false
				expect(isSupportedPlatformUrl(url)).toBe(false);
			});
		});
	});

	describe('Platform mismatch detection', () => {
		const mismatchTests: Array<[string, Platform, Platform]> = [
			['https://facebook.com/user/posts/123', 'facebook', 'instagram'],
			['https://instagram.com/p/ABC123', 'instagram', 'facebook'],
			['https://x.com/user/status/123', 'x', 'threads'],
		];

		mismatchTests.forEach(([url, correctPlatform, wrongPlatform]) => {
			it(`should detect mismatch: ${correctPlatform} URL validated as ${wrongPlatform}`, () => {
				// Correct platform detection
				expect(detector.detectPlatform(url)).toBe(correctPlatform);
				expect(validatePlatformUrl(url, correctPlatform).success).toBe(true);

				// Wrong platform validation should fail
				expect(validatePlatformUrl(url, wrongPlatform).success).toBe(false);
			});
		});
	});

	describe('Canonicalized URL validation', () => {
		const urlsWithTracking = [
			{
				original: 'https://www.facebook.com/user/posts/123?utm_source=twitter&fbclid=abc',
				canonical: 'https://facebook.com/user/posts/123',
				platform: 'facebook' as Platform,
			},
			{
				original: 'https://www.instagram.com/p/ABC123/?utm_source=ig_web&igshid=xyz',
				canonical: 'https://instagram.com/p/ABC123',
				platform: 'instagram' as Platform,
			},
			{
				original: 'https://twitter.com/user/status/123?s=20&t=abc',
				canonical: 'https://x.com/user/status/123',
				platform: 'x' as Platform,
			},
		];

		urlsWithTracking.forEach(({ original, canonical, platform }) => {
			it(`should validate both original and canonical URLs: ${platform}`, () => {
				// Original URL validation
				const originalValidation = validatePlatformUrl(original, platform);
				expect(originalValidation.success).toBe(true);

				// Canonical URL from PlatformDetector
				const detectorCanonical = detector.canonicalizeUrl(original);

				// Canonical URL validation
				const canonicalValidation = validatePlatformUrl(detectorCanonical, platform);
				expect(canonicalValidation.success).toBe(true);

				// Both should be detected as same platform
				expect(detector.detectPlatform(original)).toBe(platform);
				expect(detector.detectPlatform(detectorCanonical)).toBe(platform);
			});
		});
	});

	describe('Post ID extraction with validation', () => {
		const postIdTests = [
			{ url: 'https://facebook.com/user/posts/123456', platform: 'facebook' as Platform, postId: '123456' },
			{ url: 'https://instagram.com/p/ABC123xyz', platform: 'instagram' as Platform, postId: 'ABC123xyz' },
			{ url: 'https://x.com/user/status/1234567890', platform: 'x' as Platform, postId: '1234567890' },
			{ url: 'https://tiktok.com/@user/video/9876543210', platform: 'tiktok' as Platform, postId: '9876543210' },
			{ url: 'https://threads.net/@user/post/XYZ789', platform: 'threads' as Platform, postId: 'XYZ789' },
			{ url: 'https://linkedin.com/posts/user_activity-abc123', platform: 'linkedin' as Platform, postId: 'activity-abc123' },
			{ url: 'https://www.pinterest.com/pin/428545720815525504/', platform: 'pinterest' as Platform, postId: '428545720815525504' },
			{ url: 'https://substack.com/@hannahbay/note/c-174236981', platform: 'substack' as Platform, postId: 'c-174236981' },
			{ url: 'https://www.tumblr.com/samferd/799292732308865024/what', platform: 'tumblr' as Platform, postId: '799292732308865024' },
		];

		postIdTests.forEach(({ url, platform, postId }) => {
			it(`should validate URL and extract post ID for ${platform}`, () => {
				// Schema validation
				const validationResult = validatePlatformUrl(url, platform);
				expect(validationResult.success).toBe(true);

				// Post ID extraction
				const extractedId = detector.extractPostId(url);
				expect(extractedId).toBe(postId);

				// Platform detection
				expect(detector.detectPlatform(url)).toBe(platform);
			});
		});
	});

	describe('Mobile URL validation', () => {
		const mobileUrls = [
			{ url: 'https://m.facebook.com/story.php?story_fbid=123', platform: 'facebook' as Platform },
			{ url: 'https://mobile.x.com/user/status/456', platform: 'x' as Platform },
			{ url: 'https://mobile.twitter.com/user/status/789', platform: 'x' as Platform },
		];

		mobileUrls.forEach(({ url, platform }) => {
			it(`should validate mobile URL for ${platform}`, () => {
				// Schema validation
				const schemaResult = validatePlatformUrl(url, platform);
				expect(schemaResult.success).toBe(true);

				// Platform detection
				expect(detector.detectPlatform(url)).toBe(platform);

				// Auto-detection
				const autoDetect = validateAndDetectPlatform(url);
				expect(autoDetect.valid).toBe(true);
				expect(autoDetect.platform).toBe(platform);
			});
		});
	});

	describe('Shortened URL validation', () => {
		const shortenedUrls = [
			{ url: 'https://fb.watch/abc123', platform: 'facebook' as Platform },
			{ url: 'https://instagr.am/p/XYZ789', platform: 'instagram' as Platform },
			{ url: 'https://vm.tiktok.com/ABC123', platform: 'tiktok' as Platform },
			{ url: 'https://vt.tiktok.com/DEF456', platform: 'tiktok' as Platform },
			{ url: 'https://t.co/ghi789', platform: 'x' as Platform },
			{ url: 'https://lnkd.in/jkl012', platform: 'linkedin' as Platform },
		];

		shortenedUrls.forEach(({ url, platform }) => {
			it(`should validate shortened URL for ${platform}`, () => {
				// Schema validation
				const schemaResult = validatePlatformUrl(url, platform);
				expect(schemaResult.success).toBe(true);

				// Platform detection
				expect(detector.detectPlatform(url)).toBe(platform);
			});
		});
	});

	describe('URL normalization consistency', () => {
		const normalizationTests = [
			{
				variants: [
					'https://www.facebook.com/user/posts/123',
					'https://facebook.com/user/posts/123',
					'http://facebook.com/user/posts/123',
					'facebook.com/user/posts/123',
				],
				platform: 'facebook' as Platform,
			},
			{
				variants: [
					'https://www.instagram.com/p/ABC123',
					'https://instagram.com/p/ABC123',
					'https://instagram.com/p/ABC123/',
					'https://instagr.am/p/ABC123',
				],
				platform: 'instagram' as Platform,
			},
			{
				variants: [
					'https://twitter.com/user/status/123',
					'https://x.com/user/status/123',
					'https://www.twitter.com/user/status/123',
					'https://www.x.com/user/status/123',
				],
				platform: 'x' as Platform,
			},
		];

		normalizationTests.forEach(({ variants, platform }) => {
			it(`should consistently detect ${platform} across URL variants`, () => {
				variants.forEach((url) => {
					// PlatformDetector should detect platform
					const detected = detector.detectPlatform(url);
					expect(detected).toBe(platform);

					// Auto-detection should work (except for URLs without protocol)
					if (url.startsWith('http')) {
						const autoDetect = validateAndDetectPlatform(url);
						expect(autoDetect.valid).toBe(true);
						expect(autoDetect.platform).toBe(platform);
					}
				});
			});
		});
	});

	describe('Error message quality', () => {
		it('should provide clear error messages for invalid URLs', () => {
			const invalidUrl = 'https://unsupported.social.com/pin/123';
			const result = validateAndDetectPlatform(invalidUrl);

			expect(result.valid).toBe(false);
			expect(result.errors).toBeDefined();
			expect(result.errors.length).toBeGreaterThan(0);
			// Should mention platforms attempted
			const errorString = result.errors.join(' ');
			expect(errorString).toContain('facebook' || 'linkedin' || 'instagram');
		});

		it('should provide clear error messages for malformed URLs', () => {
			const malformedUrl = 'not-a-valid-url';
			const result = validateAndDetectPlatform(malformedUrl);

			expect(result.valid).toBe(false);
			expect(result.errors).toBeDefined();
			expect(result.errors.length).toBeGreaterThan(0);
		});

		it('should provide clear error messages for empty URLs', () => {
			const emptyUrl = '';
			const result = validateAndDetectPlatform(emptyUrl);

			expect(result.valid).toBe(false);
			expect(result.errors).toBeDefined();
		});
	});

	describe('Confidence scoring integration', () => {
		it('should have high confidence for schema-validated URLs', () => {
			const url = 'https://facebook.com/user/posts/123';

			// Schema validation
			const schemaResult = validatePlatformUrl(url, 'facebook');
			expect(schemaResult.success).toBe(true);

			// Confidence scoring
			const confidenceResult = detector.detectWithConfidence(url);
			expect(confidenceResult).not.toBeNull();
			expect(confidenceResult?.platform).toBe('facebook');
			expect(confidenceResult?.confidence).toBeGreaterThanOrEqual(0.9);
		});

		it('should have lower confidence for domain-only detection', () => {
			const url = 'https://facebook.com/random-page';

			// Should still detect platform
			expect(detector.detectPlatform(url)).toBe('facebook');

			// But with lower confidence
			const confidenceResult = detector.detectWithConfidence(url);
			expect(confidenceResult).not.toBeNull();
			expect(confidenceResult?.platform).toBe('facebook');
			expect(confidenceResult?.confidence).toBeLessThan(0.9);
		});
	});

	describe('100% Platform Detection Accuracy', () => {
		/**
		 * This test ensures 100% accuracy: if a URL passes schema validation,
		 * PlatformDetector MUST detect the correct platform
		 */
	const platforms: Platform[] = ['facebook', 'linkedin', 'instagram', 'tiktok', 'x', 'threads', 'youtube', 'reddit', 'pinterest', 'substack', 'tumblr', 'mastodon', 'bluesky'];

		platforms.forEach((platform) => {
			it(`should have 100% detection accuracy for validated ${platform} URLs`, () => {
				// Get platform-specific test URLs from schema tests
				const testUrls = getTestUrlsForPlatform(platform);

				testUrls.forEach((url) => {
					// Schema validation
					const schemaResult = validatePlatformUrl(url, platform);

					if (schemaResult.success) {
						// If schema validates, PlatformDetector MUST detect correctly
						const detected = detector.detectPlatform(url);
						expect(detected).toBe(
							platform,
							`Failed to detect ${platform} for validated URL: ${url}`
						);

						// Auto-detection must also work
						const autoDetect = validateAndDetectPlatform(url);
						expect(autoDetect.valid).toBe(true);
						expect(autoDetect.platform).toBe(platform);
					}
				});
			});
		});
	});
});

/**
 * Helper function to get test URLs for each platform
 */
function getTestUrlsForPlatform(platform: Platform): string[] {
	const urlMap: Record<Platform, string[]> = {
		facebook: [
			'https://facebook.com/user/posts/123',
			'https://www.facebook.com/photo.php?fbid=456',
			'https://facebook.com/watch/?v=789',
			'https://fb.watch/abc',
			'https://m.facebook.com/story.php?story_fbid=123',
		],
		linkedin: [
			'https://linkedin.com/posts/user_activity-abc',
			'https://www.linkedin.com/feed/update/urn:li:activity:123',
			'https://linkedin.com/pulse/article',
			'https://lnkd.in/abc',
		],
		instagram: [
			'https://instagram.com/p/ABC123',
			'https://www.instagram.com/reel/XYZ789',
			'https://instagram.com/tv/DEF456',
			'https://instagr.am/p/GHI789',
		],
		tiktok: [
			'https://tiktok.com/@user/video/123',
			'https://vm.tiktok.com/ABC',
			'https://vt.tiktok.com/XYZ',
			'https://tiktok.com/@user/photo/456',
		],
		x: [
			'https://x.com/user/status/123',
			'https://twitter.com/user/status/456',
			'https://t.co/abc',
			'https://mobile.x.com/user/status/789',
		],
		threads: [
			'https://threads.net/@user/post/ABC',
			'https://www.threads.net/t/XYZ',
			'https://threads.net/DEF',
		],
		youtube: [
			'https://youtube.com/watch?v=abc123',
			'https://youtu.be/xyz789',
		],
		reddit: [
			'https://reddit.com/r/test/comments/abc123/title/',
			'https://redd.it/xyz789',
		],
		pinterest: [
			'https://pinterest.com/pin/123456789/',
			'https://pin.it/AbCdEf',
		],
		substack: [
			'https://substack.com/@writer/post/example-article',
			'https://newsletter.substack.com/p/update',
		],
		mastodon: [
			'https://mastodon.social/@example/1234567890',
			'https://fosstodon.org/@tester/9876543210',
		],
		bluesky: [
			'https://bsky.app/profile/example.com/post/3k5abcxyz',
			'https://bsky.app/profile/user.bsky.social/post/3abcdefghi/reposted-by',
		],
	};

	return urlMap[platform] || [];
}
