/**
 * Response Validation Service
 */

import { z } from 'zod';
import type { IService } from './base/IService';
import type { Logger } from './Logger';
import type { Platform } from '@/types/post';
import {
	FacebookPostDataSchema,
	InstagramPostDataSchema,
	LinkedInPostDataSchema,
	TikTokPostDataSchema,
	XPostDataSchema,
	ThreadsPostDataSchema,
	BrightDataResponseSchema,
	type PlatformPostData,
	type BrightDataResponse,
} from '@/schemas/response-validation';

/**
 * Validation error with details
 */
export class ValidationError extends Error {
	public readonly issues: z.ZodIssue[];
	public readonly platform?: Platform;

	constructor(message: string, issues: z.ZodIssue[], platform?: Platform) {
		super(message);
		this.name = 'ValidationError';
		this.issues = issues;
		this.platform = platform;
	}

	/**
	 * Get formatted error message with details
	 */
	getDetailedMessage(): string {
		const issueMessages = this.issues.map((issue) => {
			const path = issue.path.join('.');
			return `  - ${path}: ${issue.message}`;
		});

		return `${this.message}\n${issueMessages.join('\n')}`;
	}
}

/**
 * Response Validator Service
 */
export class ResponseValidator implements IService {
	private logger: Logger;
	private platformSchemas: Map<Platform, z.ZodType<any>>;

	constructor(logger: Logger) {
		this.logger = logger;
		this.platformSchemas = new Map([
			['facebook', FacebookPostDataSchema],
			['instagram', InstagramPostDataSchema],
			['linkedin', LinkedInPostDataSchema],
			['tiktok', TikTokPostDataSchema],
			['x', XPostDataSchema],
			['threads', ThreadsPostDataSchema],
		]);
	}

	/**
	 * IService implementation
	 */
	async initialize(): Promise<void> {
		this.logger.info('ResponseValidator initialized', {
			platformsSupported: Array.from(this.platformSchemas.keys()),
		});
	}

	async shutdown(): Promise<void> {
		this.logger.info('ResponseValidator shutdown');
	}

	/**
	 * Validate BrightData response
	 */
	validateResponse(data: unknown): BrightDataResponse {
		this.logger.debug('Validating BrightData response');

		try {
			const result = BrightDataResponseSchema.parse(data);
			this.logger.debug('Response validation successful');
			return result;
		} catch (error) {
			if (error instanceof z.ZodError) {
				this.logger.error('Response validation failed', error, {
					issueCount: error.issues.length,
				});

				throw new ValidationError(
					'BrightData response validation failed',
					error.issues
				);
			}
			throw error;
		}
	}

	/**
	 * Validate platform-specific post data
	 */
	validatePlatformData(data: unknown, platform: Platform): PlatformPostData {
		this.logger.debug('Validating platform data', { platform });

		const schema = this.platformSchemas.get(platform);
		if (!schema) {
			throw new Error(`No validation schema found for platform: ${platform}`);
		}

		try {
			const result = schema.parse(data);
			this.logger.debug('Platform data validation successful', { platform });
			return result;
		} catch (error) {
			if (error instanceof z.ZodError) {
				this.logger.error('Platform data validation failed', error, {
					platform,
					issueCount: error.issues.length,
				});

				throw new ValidationError(
					`${platform} post data validation failed`,
					error.issues,
					platform
				);
			}
			throw error;
		}
	}

	/**
	 * Validate partial data for incremental updates
	 */
	validatePartial(data: unknown, platform: Platform): Partial<PlatformPostData> {
		this.logger.debug('Validating partial platform data', { platform });

		const schema = this.platformSchemas.get(platform);
		if (!schema) {
			throw new Error(`No validation schema found for platform: ${platform}`);
		}

		try {
			// Use partial() to make all fields optional
			// Type assertion needed as ZodType doesn't have partial() method
			const partialSchema = (schema as any).partial();
			const result = partialSchema.parse(data);
			this.logger.debug('Partial validation successful', { platform });
			return result;
		} catch (error) {
			if (error instanceof z.ZodError) {
				this.logger.error('Partial validation failed', error, {
					platform,
					issueCount: error.issues.length,
				});

				throw new ValidationError(
					`${platform} partial data validation failed`,
					error.issues,
					platform
				);
			}
			throw error;
		}
	}

	/**
	 * Safe parse with error details
	 */
	safeValidate(
		data: unknown,
		platform?: Platform
	): { success: true; data: PlatformPostData | BrightDataResponse } | { success: false; error: ValidationError } {
		try {
			if (platform) {
				const validated = this.validatePlatformData(data, platform);
				return { success: true, data: validated };
			} else {
				const validated = this.validateResponse(data);
				return { success: true, data: validated };
			}
		} catch (error) {
			if (error instanceof ValidationError) {
				return { success: false, error };
			}
			throw error;
		}
	}

	/**
	 * Check if data conforms to schema without throwing
	 */
	isValid(data: unknown, platform?: Platform): boolean {
		const result = this.safeValidate(data, platform);
		return result.success;
	}

	/**
	 * Get validation errors without throwing
	 */
	getValidationErrors(data: unknown, platform?: Platform): z.ZodIssue[] | null {
		const result = this.safeValidate(data, platform);
		if (!result.success) {
			return result.error.issues;
		}
		return null;
	}

	/**
	 * Transform and validate data
	 */
	transformAndValidate(data: unknown, platform: Platform): PlatformPostData {
		this.logger.debug('Transforming and validating data', { platform });

		// Validation will apply transformations automatically
		return this.validatePlatformData(data, platform);
	}
}

/**
 * Create a response validator instance
 */
export function createResponseValidator(logger: Logger): ResponseValidator {
	return new ResponseValidator(logger);
}
