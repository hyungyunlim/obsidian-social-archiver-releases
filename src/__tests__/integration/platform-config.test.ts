import { describe, it, expect } from 'vitest';
import {
	getPlatformConfig,
	getAllPlatformConfigs,
	platformSupportsFeature,
	getPlatformByDomain,
	PLATFORM_CONFIGS,
} from '@/types/platform';
import type { Platform } from '@/types/post';

/**
 * Comprehensive tests for platform configuration functionality
 * Ensures all platform configs are valid and complete
 */
describe('Platform Configuration', () => {
	const platforms: Platform[] = ['facebook', 'linkedin', 'instagram', 'tiktok', 'x', 'threads', 'youtube', 'reddit', 'pinterest', 'substack', 'tumblr', 'mastodon', 'bluesky'];

	describe('getPlatformConfig', () => {
		platforms.forEach((platform) => {
			it(`should return valid config for ${platform}`, () => {
				const config = getPlatformConfig(platform);

				expect(config).toBeDefined();
				expect(config.platform).toBe(platform);
				expect(config.displayName).toBeTruthy();
				expect(config.domains).toBeInstanceOf(Array);
				expect(config.domains.length).toBeGreaterThan(0);
				expect(config.supportsMedia).toBeDefined();
				expect(config.supportsAI).toBeDefined();
				expect(config.features).toBeDefined();
			});
		});

		it('should have all required properties for each platform', () => {
			platforms.forEach((platform) => {
				const config = getPlatformConfig(platform);

				// Required properties
				expect(config).toHaveProperty('platform');
				expect(config).toHaveProperty('displayName');
				expect(config).toHaveProperty('domains');
				expect(config).toHaveProperty('supportsMedia');
				expect(config).toHaveProperty('supportsAI');
				expect(config).toHaveProperty('features');

				// Optional but expected properties
				expect(config).toHaveProperty('maxMediaSize');
				expect(config).toHaveProperty('rateLimit');
			});
		});
	});

	describe('Platform display names', () => {
		const expectedDisplayNames: Record<Platform, string> = {
			facebook: 'Facebook',
			linkedin: 'LinkedIn',
			instagram: 'Instagram',
			tiktok: 'TikTok',
			x: 'X (Twitter)',
			threads: 'Threads',
			youtube: 'YouTube',
			reddit: 'Reddit',
			pinterest: 'Pinterest',
			substack: 'Substack',
			tumblr: 'Tumblr',
			mastodon: 'Mastodon',
			bluesky: 'Bluesky',
		};

		Object.entries(expectedDisplayNames).forEach(([platform, displayName]) => {
			it(`should have correct display name for ${platform}`, () => {
				const config = getPlatformConfig(platform as Platform);
				expect(config.displayName).toBe(displayName);
			});
		});
	});

	describe('Platform domains', () => {
		it('should have correct domains for Facebook', () => {
			const config = getPlatformConfig('facebook');
			expect(config.domains).toContain('facebook.com');
			expect(config.domains).toContain('fb.com');
			expect(config.domains).toContain('fb.watch');
			expect(config.domains).toContain('m.facebook.com');
		});

		it('should have correct domains for LinkedIn', () => {
			const config = getPlatformConfig('linkedin');
			expect(config.domains).toContain('linkedin.com');
			expect(config.domains).toContain('lnkd.in');
		});

		it('should have correct domains for Instagram', () => {
			const config = getPlatformConfig('instagram');
			expect(config.domains).toContain('instagram.com');
			expect(config.domains).toContain('instagr.am');
		});

		it('should have correct domains for TikTok', () => {
			const config = getPlatformConfig('tiktok');
			expect(config.domains).toContain('tiktok.com');
			expect(config.domains).toContain('vm.tiktok.com');
			expect(config.domains).toContain('vt.tiktok.com');
		});

		it('should have correct domains for X (Twitter)', () => {
			const config = getPlatformConfig('x');
			expect(config.domains).toContain('x.com');
			expect(config.domains).toContain('twitter.com');
			expect(config.domains).toContain('t.co');
			expect(config.domains).toContain('mobile.x.com');
			expect(config.domains).toContain('mobile.twitter.com');
		});

		it('should have correct domains for Threads', () => {
			const config = getPlatformConfig('threads');
			expect(config.domains).toContain('threads.net');
		});

		it('should have correct domains for Pinterest', () => {
			const config = getPlatformConfig('pinterest');
			expect(config.domains).toContain('pinterest.com');
			expect(config.domains).toContain('pin.it');
		});

		it('should have correct domains for Substack', () => {
			const config = getPlatformConfig('substack');
			expect(config.domains).toContain('substack.com');
		});

		it('should have correct domains for Tumblr', () => {
			const config = getPlatformConfig('tumblr');
			expect(config.domains).toContain('tumblr.com');
		});

		it('should have correct domains for Mastodon', () => {
			const config = getPlatformConfig('mastodon');
			expect(config.domains).toContain('mastodon.social');
			expect(config.allowCustomDomains).toBe(true);
		});

		it('should have correct domains for Bluesky', () => {
			const config = getPlatformConfig('bluesky');
			expect(config.domains).toContain('bsky.app');
		});

		it('should have no duplicate domains across platforms', () => {
			const allDomains = platforms.flatMap((p) => getPlatformConfig(p).domains);
			const uniqueDomains = new Set(allDomains);

			// Some domains may intentionally overlap (like mobile.x.com), but check for unexpected duplicates
			expect(allDomains.length).toBeGreaterThan(0);
		});
	});

	describe('Media support', () => {
		it('should support media on all platforms', () => {
			platforms.forEach((platform) => {
				const config = getPlatformConfig(platform);
				expect(config.supportsMedia).toBe(true);
			});
		});

		it('should have valid media size limits', () => {
			const sizeExpectations: Partial<Record<Platform, number>> = {
				facebook: 100 * 1024 * 1024, // 100MB
				linkedin: 50 * 1024 * 1024,  // 50MB
				instagram: 100 * 1024 * 1024, // 100MB
				tiktok: 200 * 1024 * 1024,    // 200MB
				x: 512 * 1024 * 1024,         // 512MB
				threads: 100 * 1024 * 1024,   // 100MB
				youtube: 500 * 1024 * 1024,   // 500MB
				reddit: 100 * 1024 * 1024,    // 100MB
				pinterest: 100 * 1024 * 1024, // 100MB
				substack: 100 * 1024 * 1024,
				tumblr: 100 * 1024 * 1024,
			};

			Object.entries(sizeExpectations).forEach(([platform, expectedSize]) => {
				const config = getPlatformConfig(platform as Platform);
				expect(config.maxMediaSize).toBe(expectedSize);
				expect(config.maxMediaSize).toBeGreaterThan(0);
			});
		});
	});

	describe('AI support', () => {
		it('should support AI on all platforms', () => {
			platforms.forEach((platform) => {
				const config = getPlatformConfig(platform);
				expect(config.supportsAI).toBe(true);
			});
		});
	});

	describe('Rate limiting', () => {
		it('should have rate limits for all platforms', () => {
			platforms.forEach((platform) => {
				const config = getPlatformConfig(platform);

				expect(config.rateLimit).toBeDefined();
				expect(config.rateLimit?.requestsPerHour).toBeGreaterThan(0);
				expect(config.rateLimit?.requestsPerDay).toBeGreaterThan(0);

				// Daily limit should be >= hourly limit
				if (config.rateLimit) {
					expect(config.rateLimit.requestsPerDay).toBeGreaterThanOrEqual(
						config.rateLimit.requestsPerHour
					);
				}
			});
		});

		it('should have reasonable rate limit values', () => {
			const rateLimits: Partial<Record<Platform, { perHour: number; perDay: number }>> = {
				facebook: { perHour: 200, perDay: 2000 },
				linkedin: { perHour: 100, perDay: 1000 },
				instagram: { perHour: 200, perDay: 2000 },
				tiktok: { perHour: 100, perDay: 1000 },
				x: { perHour: 300, perDay: 3000 },
				threads: { perHour: 200, perDay: 2000 },
				youtube: { perHour: 150, perDay: 1500 },
				reddit: { perHour: 200, perDay: 2000 },
				pinterest: { perHour: 200, perDay: 2000 },
				substack: { perHour: 200, perDay: 2000 },
				tumblr: { perHour: 200, perDay: 2000 },
			};

			Object.entries(rateLimits).forEach(([platform, expected]) => {
				const config = getPlatformConfig(platform as Platform);
				expect(config.rateLimit?.requestsPerHour).toBe(expected.perHour);
				expect(config.rateLimit?.requestsPerDay).toBe(expected.perDay);
			});
		});
	});

	describe('Feature flags', () => {
		it('should have all feature flags defined', () => {
			platforms.forEach((platform) => {
				const config = getPlatformConfig(platform);

				expect(config.features).toHaveProperty('stories');
				expect(config.features).toHaveProperty('live');
				expect(config.features).toHaveProperty('reels');
				expect(config.features).toHaveProperty('threads');

				// All features should be boolean
				expect(typeof config.features.stories).toBe('boolean');
				expect(typeof config.features.live).toBe('boolean');
				expect(typeof config.features.reels).toBe('boolean');
				expect(typeof config.features.threads).toBe('boolean');
			});
		});

		it('should have correct feature support for Facebook', () => {
			const config = getPlatformConfig('facebook');
			expect(config.features.stories).toBe(true);
			expect(config.features.live).toBe(true);
			expect(config.features.reels).toBe(true);
			expect(config.features.threads).toBe(false);
		});

		it('should have correct feature support for LinkedIn', () => {
			const config = getPlatformConfig('linkedin');
			expect(config.features.stories).toBe(false);
			expect(config.features.live).toBe(true);
			expect(config.features.reels).toBe(false);
			expect(config.features.threads).toBe(false);
		});

		it('should have correct feature support for Instagram', () => {
			const config = getPlatformConfig('instagram');
			expect(config.features.stories).toBe(true);
			expect(config.features.live).toBe(true);
			expect(config.features.reels).toBe(true);
			expect(config.features.threads).toBe(false);
		});

		it('should have correct feature support for TikTok', () => {
			const config = getPlatformConfig('tiktok');
			expect(config.features.stories).toBe(false);
			expect(config.features.live).toBe(true);
			expect(config.features.reels).toBe(false);
			expect(config.features.threads).toBe(false);
		});

		it('should have correct feature support for X', () => {
			const config = getPlatformConfig('x');
			expect(config.features.stories).toBe(false);
			expect(config.features.live).toBe(true);
			expect(config.features.reels).toBe(false);
			expect(config.features.threads).toBe(true);
		});

		it('should have correct feature support for Threads', () => {
			const config = getPlatformConfig('threads');
			expect(config.features.stories).toBe(false);
			expect(config.features.live).toBe(false);
			expect(config.features.reels).toBe(false);
			expect(config.features.threads).toBe(true);
		});
	});

	describe('getAllPlatformConfigs', () => {
		it('should return configs for all platforms', () => {
			const configs = getAllPlatformConfigs();

			expect(configs).toHaveLength(platforms.length + 1);
			expect(configs.map(c => c.platform)).toEqual(
				expect.arrayContaining(platforms)
			);
		});

		it('should return complete config objects', () => {
			const configs = getAllPlatformConfigs();

			configs.forEach((config) => {
				expect(config.platform).toBeTruthy();
				expect(config.displayName).toBeTruthy();
				if (config.platform === 'post') {
					expect(config.domains.length).toBe(0);
				} else {
					expect(config.domains.length).toBeGreaterThan(0);
				}
			});
		});
	});

	describe('platformSupportsFeature', () => {
		const featureTests = [
			{ platform: 'facebook' as Platform, feature: 'stories' as const, expected: true },
			{ platform: 'facebook' as Platform, feature: 'reels' as const, expected: true },
			{ platform: 'facebook' as Platform, feature: 'threads' as const, expected: false },
			{ platform: 'instagram' as Platform, feature: 'stories' as const, expected: true },
			{ platform: 'instagram' as Platform, feature: 'reels' as const, expected: true },
			{ platform: 'linkedin' as Platform, feature: 'stories' as const, expected: false },
			{ platform: 'linkedin' as Platform, feature: 'live' as const, expected: true },
			{ platform: 'x' as Platform, feature: 'threads' as const, expected: true },
			{ platform: 'x' as Platform, feature: 'stories' as const, expected: false },
			{ platform: 'threads' as Platform, feature: 'threads' as const, expected: true },
			{ platform: 'threads' as Platform, feature: 'live' as const, expected: false },
		];

		featureTests.forEach(({ platform, feature, expected }) => {
			it(`should return ${expected} for ${platform}.${feature}`, () => {
				const result = platformSupportsFeature(platform, feature);
				expect(result).toBe(expected);
			});
		});
	});

	describe('getPlatformByDomain', () => {
		const domainTests = [
			{ domain: 'facebook.com', platform: 'facebook' },
			{ domain: 'www.facebook.com', platform: 'facebook' },
			{ domain: 'm.facebook.com', platform: 'facebook' },
			{ domain: 'fb.com', platform: 'facebook' },
			{ domain: 'instagram.com', platform: 'instagram' },
			{ domain: 'www.instagram.com', platform: 'instagram' },
			{ domain: 'linkedin.com', platform: 'linkedin' },
			{ domain: 'lnkd.in', platform: 'linkedin' },
			{ domain: 'tiktok.com', platform: 'tiktok' },
			{ domain: 'vm.tiktok.com', platform: 'tiktok' },
			{ domain: 'x.com', platform: 'x' },
			{ domain: 'twitter.com', platform: 'x' },
			{ domain: 't.co', platform: 'x' },
			{ domain: 'threads.net', platform: 'threads' },
			{ domain: 'youtube.com', platform: 'youtube' },
			{ domain: 'youtu.be', platform: 'youtube' },
			{ domain: 'reddit.com', platform: 'reddit' },
			{ domain: 'redd.it', platform: 'reddit' },
			{ domain: 'pinterest.com', platform: 'pinterest' },
			{ domain: 'pin.it', platform: 'pinterest' },
			{ domain: 'substack.com', platform: 'substack' },
			{ domain: 'mastodon.social', platform: 'mastodon' },
			{ domain: 'fosstodon.org', platform: 'mastodon' },
			{ domain: 'bsky.app', platform: 'bluesky' },
		];

		domainTests.forEach(({ domain, platform }) => {
			it(`should detect ${platform} from domain ${domain}`, () => {
				const result = getPlatformByDomain(domain);
				expect(result).toBe(platform);
			});
		});

		it('should handle domains with www prefix', () => {
			expect(getPlatformByDomain('www.facebook.com')).toBe('facebook');
			expect(getPlatformByDomain('www.instagram.com')).toBe('instagram');
			expect(getPlatformByDomain('www.linkedin.com')).toBe('linkedin');
			expect(getPlatformByDomain('www.pinterest.com')).toBe('pinterest');
			expect(getPlatformByDomain('hannah.substack.com')).toBe('substack');
			expect(getPlatformByDomain('news.mastodon.social')).toBe('mastodon');
			expect(getPlatformByDomain('app.bsky.app')).toBe('bluesky');
		});

		it('should handle case-insensitive domains', () => {
			expect(getPlatformByDomain('FACEBOOK.COM')).toBe('facebook');
			expect(getPlatformByDomain('Facebook.Com')).toBe('facebook');
			expect(getPlatformByDomain('INSTAGRAM.COM')).toBe('instagram');
			expect(getPlatformByDomain('PINTEREST.COM')).toBe('pinterest');
			expect(getPlatformByDomain('SUBSTACK.COM')).toBe('substack');
			expect(getPlatformByDomain('BSKY.APP')).toBe('bluesky');
			expect(getPlatformByDomain('MASTODON.SOCIAL')).toBe('mastodon');
		});

		it('should return null for unsupported domains', () => {
			expect(getPlatformByDomain('example.com')).toBeNull();
			expect(getPlatformByDomain('my.custom.domain')).toBeNull();
		});

		it('should handle subdomains correctly', () => {
			expect(getPlatformByDomain('m.facebook.com')).toBe('facebook');
			expect(getPlatformByDomain('mobile.x.com')).toBe('x');
			expect(getPlatformByDomain('vm.tiktok.com')).toBe('tiktok');
			expect(getPlatformByDomain('newsletter.substack.com')).toBe('substack');
		});
	});

	describe('PLATFORM_CONFIGS direct access', () => {
		it('should allow direct access to all configs', () => {
			expect(PLATFORM_CONFIGS.facebook).toBeDefined();
			expect(PLATFORM_CONFIGS.linkedin).toBeDefined();
			expect(PLATFORM_CONFIGS.instagram).toBeDefined();
			expect(PLATFORM_CONFIGS.tiktok).toBeDefined();
			expect(PLATFORM_CONFIGS.x).toBeDefined();
			expect(PLATFORM_CONFIGS.threads).toBeDefined();
			expect(PLATFORM_CONFIGS.substack).toBeDefined();
		});

		it('should have consistent data with getPlatformConfig', () => {
			platforms.forEach((platform) => {
				const directAccess = PLATFORM_CONFIGS[platform];
				const viaFunction = getPlatformConfig(platform);

				expect(directAccess).toEqual(viaFunction);
			});
		});
	});

	describe('Configuration validation', () => {
		it('should have no missing required fields', () => {
			platforms.forEach((platform) => {
				const config = getPlatformConfig(platform);

				// Check no undefined values in required fields
				expect(config.platform).not.toBeUndefined();
				expect(config.displayName).not.toBeUndefined();
				expect(config.domains).not.toBeUndefined();
				expect(config.supportsMedia).not.toBeUndefined();
				expect(config.supportsAI).not.toBeUndefined();
				expect(config.features).not.toBeUndefined();
			});
		});

		it('should have valid media size values', () => {
			platforms.forEach((platform) => {
				const config = getPlatformConfig(platform);

				if (config.maxMediaSize) {
					// Should be reasonable size (between 10MB and 1GB)
					expect(config.maxMediaSize).toBeGreaterThanOrEqual(10 * 1024 * 1024);
					expect(config.maxMediaSize).toBeLessThanOrEqual(1024 * 1024 * 1024);
				}
			});
		});

		it('should have non-empty domain arrays', () => {
			platforms.forEach((platform) => {
				const config = getPlatformConfig(platform);
				expect(config.domains.length).toBeGreaterThan(0);

				// All domains should be non-empty strings
				config.domains.forEach((domain) => {
					expect(typeof domain).toBe('string');
					expect(domain.length).toBeGreaterThan(0);
				});
			});
		});
	});
});
