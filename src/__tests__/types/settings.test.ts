import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS,
  migrateSettings,
} from '@/types/settings';
import type { SocialArchiverSettings } from '@/types/settings';

describe('settings', () => {
  describe('DEFAULT_SETTINGS', () => {
    it('should have includeHashtagsAsObsidianTags set to true', () => {
      expect(DEFAULT_SETTINGS.includeHashtagsAsObsidianTags).toBe(true);
    });
  });

  describe('migrateSettings', () => {
    it('should initialize includeHashtagsAsObsidianTags to true when missing', () => {
      // Simulate a settings object from an older version that does not have the field
      const legacySettings: Partial<SocialArchiverSettings> = {
        archiveFolder: 'Social Archives',
        downloadMedia: 'images-and-videos',
        // includeHashtagsAsObsidianTags is intentionally absent
      };

      const migrated = migrateSettings(legacySettings);

      expect(migrated.includeHashtagsAsObsidianTags).toBe(true);
    });

    it('should preserve includeHashtagsAsObsidianTags when already set to true', () => {
      const settingsWithTrue: Partial<SocialArchiverSettings> = {
        includeHashtagsAsObsidianTags: true,
      };

      const migrated = migrateSettings(settingsWithTrue);

      expect(migrated.includeHashtagsAsObsidianTags).toBe(true);
    });

    it('should preserve includeHashtagsAsObsidianTags when set to false', () => {
      const settingsWithFalse: Partial<SocialArchiverSettings> = {
        includeHashtagsAsObsidianTags: false,
      };

      const migrated = migrateSettings(settingsWithFalse);

      expect(migrated.includeHashtagsAsObsidianTags).toBe(false);
    });

    it('should treat undefined as migration case and set to true', () => {
      const settingsWithUndefined = {
        includeHashtagsAsObsidianTags: undefined,
      } as Partial<SocialArchiverSettings>;

      const migrated = migrateSettings(settingsWithUndefined);

      expect(migrated.includeHashtagsAsObsidianTags).toBe(true);
    });
  });
});
