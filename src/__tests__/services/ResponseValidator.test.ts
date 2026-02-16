import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ResponseValidator, ValidationError, createResponseValidator } from '@/services/ResponseValidator';
import type { Logger } from '@/services/Logger';
import type { Platform } from '@/types/post';

describe('ResponseValidator', () => {
	let validator: ResponseValidator;
	let mockLogger: Logger;

	beforeEach(() => {
		mockLogger = {
			info: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
			debug: vi.fn(),
		} as unknown as Logger;

		validator = new ResponseValidator(mockLogger);
	});

	describe('Service lifecycle', () => {
		it('should initialize', async () => {
			await validator.initialize();
			expect(mockLogger.info).toHaveBeenCalledWith(
				'ResponseValidator initialized',
				expect.any(Object)
			);
		});

		it('should shutdown', async () => {
			await validator.shutdown();
			expect(mockLogger.info).toHaveBeenCalledWith('ResponseValidator shutdown');
		});
	});

	describe('Facebook validation', () => {
		const validFacebookData = {
			platform: 'facebook' as Platform,
			id: '123456789',
			url: 'https://www.facebook.com/user/posts/123456789',
			author: {
				id: 'user123',
				name: 'John Doe',
				url: 'https://www.facebook.com/user123',
			},
			text: 'Test post',
			timestamp: '2024-01-01T00:00:00Z',
			media: [],
			comments: [],
			likes: 100,
			shares: 50,
			reactions: {
				like: 50,
				love: 30,
				total: 100,
			},
		};

		it('should validate valid Facebook data', () => {
			const result = validator.validatePlatformData(validFacebookData, 'facebook');

			expect(result.platform).toBe('facebook');
			expect(result.id).toBe('123456789');
			expect(result.timestamp).toBeInstanceOf(Date);
		});

		it('should transform string dates to Date objects', () => {
			const result = validator.validatePlatformData(validFacebookData, 'facebook');

			expect(result.timestamp).toBeInstanceOf(Date);
			expect(result.timestamp.toISOString()).toBe('2024-01-01T00:00:00.000Z');
		});

		it('should transform string numbers to numbers', () => {
			const dataWithStringNumbers = {
				...validFacebookData,
				likes: '100',
				shares: '50',
			};

			const result = validator.validatePlatformData(dataWithStringNumbers, 'facebook');

			expect(typeof result.likes).toBe('number');
			expect(result.likes).toBe(100);
			expect(typeof result.shares).toBe('number');
			expect(result.shares).toBe(50);
		});

		it('should apply default values', () => {
			const minimalData = {
				platform: 'facebook' as Platform,
				id: '123',
				url: 'https://www.facebook.com/post/123',
				author: {
					id: 'user1',
					name: 'User',
					url: 'https://www.facebook.com/user1',
				},
				text: 'Post',
				timestamp: '2024-01-01T00:00:00Z',
			};

			const result = validator.validatePlatformData(minimalData, 'facebook');

			expect(result.media).toEqual([]);
			expect(result.comments).toEqual([]);
			expect(result.likes).toBe(0);
			expect(result.shares).toBe(0);
		});

		it('should reject invalid Facebook data', () => {
			const invalidData = {
				platform: 'facebook',
				// missing required fields
			};

			expect(() => validator.validatePlatformData(invalidData, 'facebook')).toThrow(
				ValidationError
			);
		});

		it('should validate Facebook reactions', () => {
			const result = validator.validatePlatformData(validFacebookData, 'facebook');

			expect(result.reactions).toBeDefined();
			expect(result.reactions?.like).toBe(50);
			expect(result.reactions?.total).toBe(100);
		});
	});

	describe('Instagram validation', () => {
		const validInstagramData = {
			platform: 'instagram' as Platform,
			id: 'ABC123XYZ',
			url: 'https://www.instagram.com/p/ABC123XYZ/',
			author: {
				id: 'user456',
				name: 'Jane Doe',
				username: 'janedoe',
				url: 'https://www.instagram.com/janedoe/',
			},
			text: 'Instagram caption',
			timestamp: '2024-01-02T00:00:00Z',
			media: [
				{
					type: 'photo',
					url: 'https://instagram.com/photo.jpg',
				},
			],
			comments: [],
			likes: 500,
			shares: 0,
			isCarousel: true,
			carouselItems: [
				{
					type: 'photo',
					url: 'https://instagram.com/photo1.jpg',
				},
				{
					type: 'photo',
					url: 'https://instagram.com/photo2.jpg',
				},
			],
		};

		it('should validate valid Instagram data', () => {
			const result = validator.validatePlatformData(validInstagramData, 'instagram');

			expect(result.platform).toBe('instagram');
			expect(result.isCarousel).toBe(true);
			expect(result.carouselItems).toHaveLength(2);
		});

		it('should validate carousel items', () => {
			const result = validator.validatePlatformData(validInstagramData, 'instagram');

			expect(result.carouselItems).toBeDefined();
			expect(result.carouselItems![0].type).toBe('photo');
			expect(result.carouselItems![0].url).toContain('instagram.com');
		});
	});

	describe('LinkedIn validation', () => {
		const validLinkedInData = {
			platform: 'linkedin' as Platform,
			id: 'urn:li:activity:7654321',
			url: 'https://www.linkedin.com/feed/update/urn:li:activity:7654321/',
			author: {
				id: 'company123',
				name: 'Tech Company',
				url: 'https://www.linkedin.com/company/tech-company/',
			},
			text: 'LinkedIn post',
			timestamp: '2024-01-03T00:00:00Z',
			media: [],
			comments: [],
			likes: 200,
			shares: 100,
			insights: {
				impressions: 5000,
				engagement: 300,
			},
		};

		it('should validate valid LinkedIn data', () => {
			const result = validator.validatePlatformData(validLinkedInData, 'linkedin');

			expect(result.platform).toBe('linkedin');
			expect(result.insights).toBeDefined();
			expect(result.insights?.impressions).toBe(5000);
		});
	});

	describe('TikTok validation', () => {
		const validTikTokData = {
			platform: 'tiktok' as Platform,
			id: '9876543210',
			url: 'https://www.tiktok.com/@user/video/9876543210',
			author: {
				id: 'user789',
				name: 'TikTok Creator',
				url: 'https://www.tiktok.com/@tiktokcreator',
			},
			text: 'TikTok description',
			timestamp: '2024-01-04T00:00:00Z',
			media: [
				{
					type: 'video',
					url: 'https://tiktok.com/video.mp4',
					duration: 30,
				},
			],
			comments: [],
			likes: 10000,
			shares: 500,
			soundName: 'Original Sound',
			duetEnabled: true,
		};

		it('should validate valid TikTok data', () => {
			const result = validator.validatePlatformData(validTikTokData, 'tiktok');

			expect(result.platform).toBe('tiktok');
			expect(result.soundName).toBe('Original Sound');
			expect(result.duetEnabled).toBe(true);
		});
	});

	describe('X (Twitter) validation', () => {
		const validXData = {
			platform: 'x' as Platform,
			id: '1234567890123456789',
			url: 'https://x.com/user/status/1234567890123456789',
			author: {
				id: 'user999',
				name: 'X User',
				url: 'https://x.com/xuser',
			},
			text: 'X post',
			timestamp: '2024-01-05T00:00:00Z',
			media: [],
			comments: [],
			likes: 1000,
			shares: 100,
			retweetCount: 100,
			quoteCount: 50,
		};

		it('should validate valid X data', () => {
			const result = validator.validatePlatformData(validXData, 'x');

			expect(result.platform).toBe('x');
			expect(result.retweetCount).toBe(100);
			expect(result.quoteCount).toBe(50);
		});

		it('should validate nested quoted posts', () => {
			const dataWithQuote = {
				...validXData,
				isQuoteTweet: true,
				quotedPost: {
					...validXData,
					id: 'quoted123',
				},
			};

			const result = validator.validatePlatformData(dataWithQuote, 'x');

			expect(result.isQuoteTweet).toBe(true);
			expect(result.quotedPost).toBeDefined();
			expect(result.quotedPost?.id).toBe('quoted123');
		});
	});

	describe('Threads validation', () => {
		const validThreadsData = {
			platform: 'threads' as Platform,
			id: 'CxYZ123ABC',
			url: 'https://www.threads.net/@user/post/CxYZ123ABC',
			author: {
				id: 'user111',
				name: 'Threads User',
				url: 'https://www.threads.net/@threadsuser',
			},
			text: 'Threads post',
			timestamp: '2024-01-06T00:00:00Z',
			media: [],
			comments: [],
			likes: 300,
			shares: 50,
			repostCount: 50,
		};

		it('should validate valid Threads data', () => {
			const result = validator.validatePlatformData(validThreadsData, 'threads');

			expect(result.platform).toBe('threads');
			expect(result.repostCount).toBe(50);
		});
	});

	describe('BrightData response validation', () => {
		const validResponse = {
			success: true,
			data: {
				platform: 'facebook' as Platform,
				id: '123',
				url: 'https://www.facebook.com/post/123',
				author: {
					id: 'user1',
					name: 'User',
					url: 'https://www.facebook.com/user1',
				},
				text: 'Post',
				timestamp: '2024-01-01T00:00:00Z',
				media: [],
				comments: [],
				likes: 0,
				shares: 0,
			},
			metadata: {
				requestId: 'req-123',
				timestamp: '2024-01-01T00:00:00Z',
				duration: 1500,
				creditsUsed: 1,
			},
		};

		it('should validate valid BrightData response', () => {
			const result = validator.validateResponse(validResponse);

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
			expect(result.metadata.requestId).toBe('req-123');
		});

		it('should validate error responses', () => {
			const errorResponse = {
				success: false,
				error: {
					code: 'RATE_LIMIT',
					message: 'Rate limit exceeded',
				},
				metadata: {
					requestId: 'req-456',
					timestamp: '2024-01-01T00:00:00Z',
					duration: 100,
					creditsUsed: 0,
				},
			};

			const result = validator.validateResponse(errorResponse);

			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
			expect(result.error?.code).toBe('RATE_LIMIT');
		});
	});

	describe('Partial validation', () => {
		it('should validate partial data', () => {
			const partialData = {
				likes: 150,
				shares: 75,
			};

			const result = validator.validatePartial(partialData, 'facebook');

			expect(result.likes).toBe(150);
			expect(result.shares).toBe(75);
		});

		it('should not require all fields for partial', () => {
			const partialData = {
				text: 'Updated text',
			};

			expect(() => validator.validatePartial(partialData, 'facebook')).not.toThrow();
		});
	});

	describe('Safe validation', () => {
		it('should return success for valid data', () => {
			const validData = {
				platform: 'facebook' as Platform,
				id: '123',
				url: 'https://www.facebook.com/post/123',
				author: {
					id: 'user1',
					name: 'User',
					url: 'https://www.facebook.com/user1',
				},
				text: 'Post',
				timestamp: '2024-01-01T00:00:00Z',
				media: [],
				comments: [],
				likes: 0,
				shares: 0,
			};

			const result = validator.safeValidate(validData, 'facebook');

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.platform).toBe('facebook');
			}
		});

		it('should return error for invalid data', () => {
			const invalidData = {
				platform: 'facebook',
				// missing required fields
			};

			const result = validator.safeValidate(invalidData, 'facebook');

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBeInstanceOf(ValidationError);
				expect(result.error.issues.length).toBeGreaterThan(0);
			}
		});
	});

	describe('Validation helpers', () => {
		it('should check if data is valid', () => {
			const validData = {
				platform: 'facebook' as Platform,
				id: '123',
				url: 'https://www.facebook.com/post/123',
				author: {
					id: 'user1',
					name: 'User',
					url: 'https://www.facebook.com/user1',
				},
				text: 'Post',
				timestamp: '2024-01-01T00:00:00Z',
				media: [],
				comments: [],
				likes: 0,
				shares: 0,
			};

			expect(validator.isValid(validData, 'facebook')).toBe(true);
		});

		it('should return validation errors', () => {
			const invalidData = {
				platform: 'facebook',
			};

			const errors = validator.getValidationErrors(invalidData, 'facebook');

			expect(errors).not.toBeNull();
			expect(errors!.length).toBeGreaterThan(0);
		});

		it('should return null for valid data', () => {
			const validData = {
				platform: 'facebook' as Platform,
				id: '123',
				url: 'https://www.facebook.com/post/123',
				author: {
					id: 'user1',
					name: 'User',
					url: 'https://www.facebook.com/user1',
				},
				text: 'Post',
				timestamp: '2024-01-01T00:00:00Z',
				media: [],
				comments: [],
				likes: 0,
				shares: 0,
			};

			const errors = validator.getValidationErrors(validData, 'facebook');

			expect(errors).toBeNull();
		});
	});

	describe('ValidationError', () => {
		it('should format detailed error message', () => {
			const issues = [
				{
					code: 'invalid_type' as const,
					path: ['author', 'name'],
					message: 'Expected string, received undefined',
					expected: 'string',
					received: 'undefined',
				},
				{
					code: 'invalid_type' as const,
					path: ['url'],
					message: 'Expected string, received undefined',
					expected: 'string',
					received: 'undefined',
				},
			];

			const error = new ValidationError('Validation failed', issues, 'facebook');
			const detailed = error.getDetailedMessage();

			expect(detailed).toContain('author.name');
			expect(detailed).toContain('url');
			expect(detailed).toContain('Validation failed');
		});
	});

	describe('Factory function', () => {
		it('should create validator instance', () => {
			const validator = createResponseValidator(mockLogger);

			expect(validator).toBeInstanceOf(ResponseValidator);
		});
	});
});
