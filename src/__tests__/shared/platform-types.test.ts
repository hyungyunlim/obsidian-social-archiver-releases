import { describe, it, expect } from 'vitest';
import {
	isPlatform,
	PLATFORMS,
	CRAWL_SUPPORTED_PLATFORMS,
	NEW_SUBSCRIPTION_PLATFORMS,
	SUBSCRIPTION_PLATFORMS,
	PREVIEW_SUPPORTED_PLATFORMS,
	RSS_BASED_PLATFORMS,
	getPlatformCategory,
} from '@/shared/platforms/types';

describe('Platform Types', () => {
	describe('isPlatform type guard', () => {
		it('should return true for all valid platforms', () => {
			const validPlatforms = [
				'facebook',
				'linkedin',
				'instagram',
				'tiktok',
				'x',
				'threads',
				'youtube',
				'reddit',
				'pinterest',
				'substack',
				'tumblr',
				'mastodon',
				'bluesky',
				'googlemaps',
				'navermap',
				'kakaomap',
				'velog',
				'podcast',
				'blog',
				'medium',
				'naver',
				'naver-webtoon',
				'brunch',
				'post',
			];

			validPlatforms.forEach((platform) => {
				expect(isPlatform(platform)).toBe(true);
			});
		});

		it('should return true for naver-webtoon specifically', () => {
			expect(isPlatform('naver-webtoon')).toBe(true);
		});

		it('should return false for invalid platform strings', () => {
			const invalidPlatforms = [
				'twitter', // Should be 'x'
				'webtoon', // Should be 'naver-webtoon'
				'naverwebtoon', // Wrong format
				'NAVER-WEBTOON', // Case sensitive
				'random',
				'',
				'undefined',
				'null',
			];

			invalidPlatforms.forEach((platform) => {
				expect(isPlatform(platform)).toBe(false);
			});
		});
	});

	describe('PLATFORMS constant', () => {
		it('should include naver-webtoon', () => {
			expect(PLATFORMS).toContain('naver-webtoon');
		});

		it('should include all expected platforms', () => {
			expect(PLATFORMS).toContain('facebook');
			expect(PLATFORMS).toContain('instagram');
			expect(PLATFORMS).toContain('x');
			expect(PLATFORMS).toContain('naver');
			expect(PLATFORMS).toContain('navermap');
			expect(PLATFORMS).toContain('kakaomap');
			expect(PLATFORMS).toContain('naver-webtoon');
			expect(PLATFORMS).toContain('brunch');
			expect(PLATFORMS).toContain('post');
		});

		it('should have correct length (27 platforms)', () => {
			expect(PLATFORMS).toHaveLength(27);
		});
	});

	describe('Subscription Platform Arrays', () => {
		describe('CRAWL_SUPPORTED_PLATFORMS', () => {
			it('should include naver-webtoon', () => {
				expect(CRAWL_SUPPORTED_PLATFORMS).toContain('naver-webtoon');
			});

			it('should include naver', () => {
				expect(CRAWL_SUPPORTED_PLATFORMS).toContain('naver');
			});

			it('should include threads for feature-flagged official API crawl', () => {
				expect(CRAWL_SUPPORTED_PLATFORMS).toContain('threads');
			});

			it('should NOT include post', () => {
				expect(CRAWL_SUPPORTED_PLATFORMS).not.toContain('post');
			});

			it('should NOT include googlemaps', () => {
				expect(CRAWL_SUPPORTED_PLATFORMS).not.toContain('googlemaps');
			});

			it('should NOT include Korean map place platforms', () => {
				expect(CRAWL_SUPPORTED_PLATFORMS).not.toContain('navermap');
				expect(CRAWL_SUPPORTED_PLATFORMS).not.toContain('kakaomap');
			});
		});

		describe('NEW_SUBSCRIPTION_PLATFORMS', () => {
			it('should include naver-webtoon', () => {
				expect(NEW_SUBSCRIPTION_PLATFORMS).toContain('naver-webtoon');
			});

			it('should include naver (via RSS_BASED_PLATFORMS)', () => {
				expect(NEW_SUBSCRIPTION_PLATFORMS).toContain('naver');
			});

			it('should include x (re-enabled via xcancel RSS)', () => {
				expect(NEW_SUBSCRIPTION_PLATFORMS).toContain('x');
			});

			it('should include threads for profile discovery subscription rollout', () => {
				expect(NEW_SUBSCRIPTION_PLATFORMS).toContain('threads');
			});

			it('should NOT include linkedin (disabled for new)', () => {
				expect(NEW_SUBSCRIPTION_PLATFORMS).not.toContain('linkedin');
			});

			it('should NOT include Korean map place platforms', () => {
				expect(NEW_SUBSCRIPTION_PLATFORMS).not.toContain('navermap');
				expect(NEW_SUBSCRIPTION_PLATFORMS).not.toContain('kakaomap');
			});
		});

		describe('SUBSCRIPTION_PLATFORMS', () => {
			it('should include naver-webtoon', () => {
				expect(SUBSCRIPTION_PLATFORMS).toContain('naver-webtoon');
			});

			it('should include x (for legacy subscriptions)', () => {
				expect(SUBSCRIPTION_PLATFORMS).toContain('x');
			});

			it('should include threads for feature-flagged API-created subscriptions', () => {
				expect(SUBSCRIPTION_PLATFORMS).toContain('threads');
			});

			it('should include linkedin (for legacy subscriptions)', () => {
				expect(SUBSCRIPTION_PLATFORMS).toContain('linkedin');
			});
		});

		describe('PREVIEW_SUPPORTED_PLATFORMS', () => {
			it('should include naver-webtoon', () => {
				expect(PREVIEW_SUPPORTED_PLATFORMS).toContain('naver-webtoon');
			});

			it('should include naver', () => {
				expect(PREVIEW_SUPPORTED_PLATFORMS).toContain('naver');
			});
		});

		describe('RSS_BASED_PLATFORMS', () => {
			it('should include naver', () => {
				expect(RSS_BASED_PLATFORMS).toContain('naver');
			});

			it('should NOT include naver-webtoon (uses direct API)', () => {
				expect(RSS_BASED_PLATFORMS).not.toContain('naver-webtoon');
			});
		});
	});

	describe('getPlatformCategory', () => {
		it('should return null for naver-webtoon (no AI comment category)', () => {
			// naver-webtoon is not in social media, blog/news, or video/audio categories
			expect(getPlatformCategory('naver-webtoon')).toBeNull();
		});

		it('should return blogNews for naver', () => {
			expect(getPlatformCategory('naver')).toBe('blogNews');
		});

		it('should return socialMedia for facebook', () => {
			expect(getPlatformCategory('facebook')).toBe('socialMedia');
		});

		it('should return videoAudio for youtube', () => {
			expect(getPlatformCategory('youtube')).toBe('videoAudio');
		});

		it('should return null for post', () => {
			expect(getPlatformCategory('post')).toBeNull();
		});

		it('should return null for googlemaps', () => {
			expect(getPlatformCategory('googlemaps')).toBeNull();
		});
	});
});
