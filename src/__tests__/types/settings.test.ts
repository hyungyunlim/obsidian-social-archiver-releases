import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS,
  migrateSettings,
  createDefaultTimelineFilters,
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

    it('should derive activeTab "all" from legacy includeArchived true', () => {
      const legacy: Partial<SocialArchiverSettings> = {
        timelineFilters: {
          platforms: [],
          likedOnly: false,
          commentedOnly: false,
          sharedOnly: false,
          includeArchived: true,
          searchQuery: '',
          dateRange: { start: null, end: null },
        } as SocialArchiverSettings['timelineFilters'],
      };

      const migrated = migrateSettings(legacy);

      expect(migrated.timelineFilters.activeTab).toBe('all');
    });

    it('should derive activeTab "inbox" from legacy includeArchived false', () => {
      const legacy: Partial<SocialArchiverSettings> = {
        timelineFilters: {
          platforms: [],
          likedOnly: false,
          commentedOnly: false,
          sharedOnly: false,
          includeArchived: false,
          searchQuery: '',
          dateRange: { start: null, end: null },
        } as SocialArchiverSettings['timelineFilters'],
      };

      const migrated = migrateSettings(legacy);

      expect(migrated.timelineFilters.activeTab).toBe('inbox');
    });

    it('should preserve existing activeTab when already set', () => {
      const settings: Partial<SocialArchiverSettings> = {
        timelineFilters: {
          platforms: [],
          likedOnly: false,
          commentedOnly: false,
          sharedOnly: false,
          includeArchived: true,
          searchQuery: '',
          dateRange: { start: null, end: null },
          activeTab: 'archive',
        },
      };

      const migrated = migrateSettings(settings);

      expect(migrated.timelineFilters.activeTab).toBe('archive');
    });
  });

  describe('createDefaultTimelineFilters', () => {
    it('should include activeTab set to inbox', () => {
      const defaults = createDefaultTimelineFilters();

      expect(defaults.activeTab).toBe('inbox');
      expect(defaults.includeArchived).toBe(false);
    });
  });
});
