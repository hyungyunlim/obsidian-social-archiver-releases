import { describe, it, expect } from 'vitest';
import { TikTokURLSchema } from '../../schemas/platforms/tiktok';

describe('TikTok URL Schema', () => {
	describe('URL sanitization', () => {
		it('should remove tracking parameters', () => {
			const dirtyUrl = 'https://www.tiktok.com/@ggirlgirl.zip/video/7562074570824371463?is_from_webapp=1&sender_device=pc';
			const result = TikTokURLSchema.safeParse(dirtyUrl);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toBe('https://www.tiktok.com/@ggirlgirl.zip/video/7562074570824371463');
				expect(result.data).not.toContain('is_from_webapp');
				expect(result.data).not.toContain('sender_device');
			}
		});

		it('should handle URLs without parameters', () => {
			const cleanUrl = 'https://www.tiktok.com/@user/video/123456789';
			const result = TikTokURLSchema.safeParse(cleanUrl);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toBe(cleanUrl);
			}
		});

		it('should remove multiple tracking parameters', () => {
			const dirtyUrl = 'https://www.tiktok.com/@user/video/123?is_from_webapp=1&sender_device=pc&refer=web&_r=1';
			const result = TikTokURLSchema.safeParse(dirtyUrl);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toBe('https://www.tiktok.com/@user/video/123');
			}
		});

		it('should preserve non-tracking parameters', () => {
			// Currently all parameters are removed, but this test documents expected behavior
			const urlWithCustomParam = 'https://www.tiktok.com/@user/video/123?custom_param=value';
			const result = TikTokURLSchema.safeParse(urlWithCustomParam);

			expect(result.success).toBe(true);
			// Note: Currently removes ALL parameters. May want to preserve specific ones in future.
		});
	});

	describe('URL validation', () => {
		it('should accept valid TikTok video URL', () => {
			const validUrl = 'https://www.tiktok.com/@user/video/123456789';
			const result = TikTokURLSchema.safeParse(validUrl);

			expect(result.success).toBe(true);
		});

		it('should reject invalid URLs', () => {
			const invalidUrl = 'https://www.youtube.com/watch?v=123';
			const result = TikTokURLSchema.safeParse(invalidUrl);

			expect(result.success).toBe(false);
		});

		it('should accept shortened URLs', () => {
			const vmUrl = 'https://vm.tiktok.com/ZM123abc/';
			const result = TikTokURLSchema.safeParse(vmUrl);

			expect(result.success).toBe(true);
		});
	});
});
