/**
 * Main entry point for all validation schemas
 * Re-exports all platform schemas and utilities
 */

// Re-export everything from platforms
export * from './platforms';

// Convenience re-exports for common use cases
export {
	// Composite schemas
	AnySocialMediaURLSchema,

	// Utility functions
	getPlatformSchema,
	validateAndDetectPlatform,
	validatePlatformUrl,
	isSupportedPlatformUrl,

	// Platform-specific schemas (most commonly used)
	FacebookURLSchema,
	LinkedInURLSchema,
	InstagramURLSchema,
	TikTokURLSchema,
	XURLSchema,
	ThreadsURLSchema,
} from './platforms';

// Type exports
export type {
	SocialMediaURL,
	PlatformSchemaValidationResult,
} from './platforms';
