import type { Platform } from './post';
import {
  PLATFORM_DEFINITIONS,
  type PlatformDefinition,
  type PlatformFeatures,
  type PlatformRateLimit,
} from '@shared/platforms/definitions';

/**
 * Platform-specific configuration
 *
 * This interface extends PlatformDefinition for backward compatibility.
 * New code should use PLATFORM_DEFINITIONS from @shared/platforms directly.
 */
export interface PlatformConfig {
  platform: Platform;
  displayName: string;
  domains: string[];
  allowCustomDomains?: boolean;
  supportsMedia: boolean;
  supportsAI: boolean;
  maxMediaSize?: number; // in bytes
  rateLimit?: {
    requestsPerHour: number;
    requestsPerDay: number;
  };
  features: {
    stories: boolean;
    live: boolean;
    reels: boolean;
    threads: boolean;
  };
}

// Re-export types from shared
export type { PlatformDefinition, PlatformFeatures, PlatformRateLimit };

/**
 * Platform-specific URL validation result
 */
export interface URLValidationResult {
  valid: boolean;
  platform: Platform;
  postId: string | null;
  errors: string[];
  warnings: string[];
}

/**
 * Platform configurations for all supported platforms
 *
 * Generated from PLATFORM_DEFINITIONS (Single Source of Truth).
 * This provides backward compatibility with existing code that uses PLATFORM_CONFIGS.
 */
function buildPlatformConfigs(): Record<Platform, PlatformConfig> {
  const configs = {} as Record<Platform, PlatformConfig>;

  for (const [id, def] of Object.entries(PLATFORM_DEFINITIONS)) {
    configs[id as Platform] = {
      platform: def.id,
      displayName: def.displayName,
      domains: def.domains,
      allowCustomDomains: def.allowCustomDomains,
      supportsMedia: def.supportsMedia,
      supportsAI: def.supportsAI,
      maxMediaSize: def.maxMediaSize,
      rateLimit: def.rateLimit,
      features: def.features,
    };
  }

  return configs;
}

export const PLATFORM_CONFIGS: Record<Platform, PlatformConfig> = buildPlatformConfigs();

/**
 * Get platform configuration
 */
export function getPlatformConfig(platform: Platform): PlatformConfig {
  return PLATFORM_CONFIGS[platform];
}

/**
 * Get all platform configurations
 */
export function getAllPlatformConfigs(): PlatformConfig[] {
  return Object.values(PLATFORM_CONFIGS);
}

/**
 * Check if platform supports a specific feature
 */
export function platformSupportsFeature(
  platform: Platform,
  feature: keyof PlatformConfig['features']
): boolean {
  return PLATFORM_CONFIGS[platform].features[feature];
}

// Re-export getPlatformByDomain from shared for backward compatibility
export { getPlatformByDomain } from '@shared/platforms/detection';
