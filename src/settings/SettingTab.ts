import { App, getLanguage, Notice, PluginSettingTab, Setting, Platform, setIcon } from 'obsidian';
import type { SettingDefinitionItem, SettingDefinitionRender, SettingGroupItem } from 'obsidian';
import { renderSettingDefinitions } from './settingDefinitionRenderer';
import nodeRequire from '../utils/nodeRequire';
import type SocialArchiverPlugin from '../main';
import { FolderSuggest } from './FolderSuggest';
import type {
  ArchiveOrganizationMode,
  MediaDownloadMode,
  ShareMode,
  WhisperVariantType,
  FrontmatterFieldVisibility,
  CustomFrontmatterProperty,
  FrontmatterPropertyType,
  LocalImportLastResult,
  TimelineSortBy,
} from '../types/settings';
import {
  DEFAULT_FRONTMATTER_CUSTOMIZATION_SETTINGS,
  DEFAULT_FRONTMATTER_PROPERTY_ORDER,
  DEFAULT_SETTINGS,
  FRONTMATTER_CORE_LOCKED_FIELDS,
  isArchiveOrganizationMode,
  normalizeArchiveTagRuleHistory,
  normalizeFrontmatterFieldAliases,
  normalizeFrontmatterPropertyOrder,
} from '../types/settings';
import { mount, unmount } from 'svelte';
import AuthSettingsTab from './AuthSettingsTab.svelte';
import DangerZone from './DangerZone.svelte';
import SyncSettingsTab from './SyncSettingsTab.svelte';
import CrossPostSettingsTab from './CrossPostSettingsTab.svelte';
import type { AICli, AICliDetectionResult } from '../utils/ai-cli';
import { AICliDetector, AI_CLI_INFO } from '../utils/ai-cli';
import { COMMENT_TYPE_DISPLAY_NAMES, OUTPUT_LANGUAGE_NAMES } from '../types/ai-comment';
import { FEATURE_READER_TTS_ENABLED, FEATURE_CROSSPOST_ENABLED } from '../shared/constants';
import { DEFAULT_TTS_SETTINGS } from '../types/settings';
import type { PluginTTSProviderId } from '../services/tts/types';
import { TTS_LANGUAGE_OVERRIDE_OPTIONS } from '../services/tts/languages';
import { SupertonicInstaller } from '../services/tts/SupertonicInstaller';
import type { AICommentType, AIOutputLanguage } from '../types/ai-comment';
import {
  SOCIAL_MEDIA_PLATFORMS,
  BLOG_NEWS_PLATFORMS,
  VIDEO_AUDIO_PLATFORMS,
} from '../shared/platforms/types';
import type { Platform as SocialPlatform } from '../shared/platforms/types';
import { getPlatformDefinition } from '../shared/platforms/definitions';
import { isAuthenticated, isPaidPlan } from '../utils/auth';
import { getAccountRequiredMessage } from '../utils/accountGate';
import { LocalArchiveScanner } from '../services/import/local/LocalArchiveScanner';
import {
  MapSearchProviderPreferenceController,
  MapSearchProviderSaveError,
} from './MapSearchProviderPreferenceController';
import { isMapSearchProviderPreference } from '../shared/platforms/map-search-provider';
import { showConfirmModal } from '../utils/confirm-modal';
import { rememberManagedArchiveTagRule } from '../utils/archive-tag-rules';
import {
  DEFAULT_AUTHOR_NOTE_LINK_ALIAS_FORMAT,
  renderAuthorNoteLinkAlias,
} from '../utils/author-note-links';

const PERSONAL_GITHUB_URL = 'https://github.com/hyungyunlim';
const RELEASE_NOTES_URL = 'https://social-archive.org/release-notes?platform=obsidian&utm_source=obsidian-plugin&utm_medium=settings';

type SvelteComponentKey =
  | 'authComponent'
  | 'dangerZoneComponent'
  | 'syncSettingsComponent'
  | 'crossPostComponent';

export class SocialArchiverSettingTab extends PluginSettingTab {
  plugin: SocialArchiverPlugin;
  private authComponent: ReturnType<typeof mount> | null = null;
  private dangerZoneComponent: ReturnType<typeof mount> | null = null;
  private syncSettingsComponent: ReturnType<typeof mount> | null = null;
  private crossPostComponent: ReturnType<typeof mount> | null = null;
  private settingsDirty = false;

  constructor(app: App, plugin: SocialArchiverPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Mark settings as changed (will save on close)
   */
  private markDirty(): void {
    this.settingsDirty = true;
  }

  private createFrontmatterPropertyId(): string {
    return `fm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private normalizeFrontmatterPropertyType(type?: string): FrontmatterPropertyType {
    const allowedTypes: FrontmatterPropertyType[] = ['text', 'number', 'checkbox', 'date', 'date-time', 'list'];
    return allowedTypes.includes(type as FrontmatterPropertyType) ? type as FrontmatterPropertyType : 'text';
  }

  private arraysEqual(a: string[] = [], b: string[] = []): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  private ensureFrontmatterSettings(): void {
    const current = this.plugin.settings.frontmatter;
    const defaults = DEFAULT_FRONTMATTER_CUSTOMIZATION_SETTINGS;
    const customProperties = Array.isArray(current?.customProperties)
      ? current.customProperties.map((property) => ({
          id: property.id || this.createFrontmatterPropertyId(),
          key: typeof property.key === 'string' ? property.key : '',
          type: this.normalizeFrontmatterPropertyType(property.type),
          value: typeof property.value === 'string' ? property.value : '',
          template: typeof property.template === 'string' ? property.template : '',
          checked: property.checked === true,
          dateValue: typeof property.dateValue === 'string' ? property.dateValue : '',
          dateTimeValue: typeof property.dateTimeValue === 'string' ? property.dateTimeValue : '',
          enabled: property.enabled !== false,
        }))
      : [];

    this.plugin.settings.frontmatter = {
      ...defaults,
      ...(current || {}),
      fieldVisibility: {
        ...defaults.fieldVisibility,
        ...(current?.fieldVisibility || {}),
      },
      customProperties,
      fieldAliases: normalizeFrontmatterFieldAliases(current?.fieldAliases),
      propertyOrder: normalizeFrontmatterPropertyOrder(current?.propertyOrder, customProperties),
      tagRoot: typeof current?.tagRoot === 'string' ? current.tagRoot : defaults.tagRoot,
      tagOrganization: isArchiveOrganizationMode(current?.tagOrganization)
        ? current.tagOrganization
        : defaults.tagOrganization,
      archiveTagRuleHistory: normalizeArchiveTagRuleHistory(current?.archiveTagRuleHistory),
    };
  }

  private collectVaultFrontmatterKeys(): string[] {
    const keys = new Set<string>();
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter;
      if (!frontmatter || typeof frontmatter !== 'object') continue;

      for (const key of Object.keys(frontmatter)) {
        if (key) keys.add(key);
      }
    }

    return Array.from(keys).sort((a, b) => a.localeCompare(b));
  }

  /**
   * Build the composite naverCookie string from individual values
   */
  private updateNaverCookieString(): void {
    const parts: string[] = [];
    if (this.plugin.settings.nidAut) {
      parts.push(`NID_AUT=${this.plugin.settings.nidAut}`);
    }
    if (this.plugin.settings.nidSes) {
      parts.push(`NID_SES=${this.plugin.settings.nidSes}`);
    }
    this.plugin.settings.naverCookie = parts.join('; ');
  }

  /**
   * The whole settings tab, declaratively.
   *
   * Obsidian 1.13+ renders and search-indexes this directly and does not call
   * {@link display}. Older versions — minAppVersion is 1.10.0 — go through
   * display() below, which walks the same tree. One source of truth either way.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      ...this.tabDescriptionDefinitions(),
      ...this.accountSettingDefinitions(),
      // Mobile sync sits directly below Account.
      ...this.mobileSyncSettingDefinitions(),
      ...this.viewSettingDefinitions(),
      ...this.authorSettingDefinitions(),
      ...this.instagramImportSettingDefinitions(),
      ...this.archiveSettingDefinitions(),
      ...this.localArchivesSettingDefinitions(),
      ...this.frontmatterSettingDefinitions(),
      ...this.sharingSettingDefinitions(),
      // Explains the Obsidian scanner warning before the desktop-local features.
      ...this.localCommandExecutionNoticeDefinitions(),
      ...this.transcriptionSettingDefinitions(),
      ...this.ttsSettingDefinitions(),
      ...this.aiCommentSettingDefinitions(),
      ...this.naverSettingDefinitions(),
      // Reddit sync is parked until API approval.
      ...this.webtoonStreamingSettingDefinitions(),
      ...this.updateNotificationsSettingDefinitions(),
      ...(FEATURE_CROSSPOST_ENABLED ? this.crossPostSettingDefinitions() : []),
      ...this.dangerZoneSettingDefinitions(),
      ...this.supportSettingDefinitions(),
    ];
  }

  /**
   * Imperative fallback for Obsidian older than 1.13.0. Not called on 1.13+,
   * where getSettingDefinitions() drives rendering instead.
   */
  display(): void {
    // Svelte islands must come down before the container is emptied.
    this.cleanupComponents();
    const { containerEl } = this;
    containerEl.empty();
    try {
      renderSettingDefinitions(containerEl, this.getSettingDefinitions());
    } catch (err) {
      console.error('[Social Archiver] Settings display error:', err);
    }
  }

  /** Tab blurb, and the rule that separates Support from the danger zone. */
  private tabDescriptionDefinitions(): SettingDefinitionItem[] {
    return [{
      type: 'group',
      items: [this.blockRow('Social Archiver', (host) => {
        const descEl = host.createEl('p', {
          text: 'Archive and save social media posts to your Obsidian vault'
        });
        descEl.addClass('sa-settings-desc');
      })],
    }];
  }


  /**
   * Clean up Svelte components to prevent duplicates
   */
  private cleanupComponents(): void {
    this.unmountComponent('authComponent');
    this.unmountComponent('dangerZoneComponent');
    this.unmountComponent('syncSettingsComponent');
    this.unmountComponent('crossPostComponent');
  }

  /**
   * Tear down one Svelte island. Definition `render` callbacks return this as
   * their cleanup function so the declarative renderer unmounts on 1.13+;
   * `cleanupComponents()` covers the pre-1.13 path, where display() rebuilds
   * the whole tab.
   */
  private unmountComponent(key: SvelteComponentKey): void {
    const component = this[key];
    if (!component) return;
    try {
      void unmount(component);
    } catch {
      // Ignore unmount errors
    }
    this[key] = null;
  }

  /**
   * View section.
   *
   * Part of the migration to Obsidian 1.13's declarative settings API. Sections
   * live here as definitions so they are indexed by settings search on 1.13+;
   * `displayAsync` renders the same definitions through
   * {@link renderSettingDefinitions} for older versions. `getSettingDefinitions()`
   * is only overridden once every section has moved — returning a non-empty
   * array stops Obsidian from calling `display()` at all, so a partial tree
   * would silently drop the sections that have not been converted yet.
   */
  private viewSettingDefinitions(): SettingDefinitionItem[] {
    const locationOptions: Record<string, string> = {
      default: 'Use default',
      sidebar: 'Right sidebar',
      main: 'Main tab',
    };
    const overrideRow = (
      name: string,
      desc: string,
      get: () => 'default' | 'sidebar' | 'main',
      set: (value: 'default' | 'sidebar' | 'main') => void,
    ): SettingGroupItem => ({
      name,
      desc,
      render: (setting): void => {
        setting.addDropdown(dropdown => {
          dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
          for (const [value, label] of Object.entries(locationOptions)) {
            dropdown.addOption(value, label);
          }
          return dropdown
            .setValue(get())
            .onChange((value) => {
              set(value as 'default' | 'sidebar' | 'main');
              this.markDirty();
            });
        });
      },
    });

    return [{
      type: 'group',
      heading: 'View',
      items: [
        {
          name: 'Default view location',
          desc: 'Where views open by default. Individual views below can override this.',
          render: (setting): void => {
            setting.addDropdown(dropdown => {
              dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
              return dropdown
                .addOption('sidebar', 'Right sidebar')
                .addOption('main', 'Main tab')
                .setValue(this.plugin.settings.viewLocationDefault)
                .onChange((value) => {
                  this.plugin.settings.viewLocationDefault = value as 'sidebar' | 'main';
                  this.markDirty();
                });
            });
          },
        },
        overrideRow(
          'Timeline view',
          'Override the default location for the timeline view.',
          () => this.plugin.settings.timelineLocation,
          (value) => { this.plugin.settings.timelineLocation = value; },
        ),
        overrideRow(
          'Author detail',
          'Override the default location for the author detail view.',
          () => this.plugin.settings.authorDetailLocation,
          (value) => { this.plugin.settings.authorDetailLocation = value; },
        ),
        {
          name: 'Default timeline sort',
          desc: 'Choose whether new timeline views start from archive date or publish date.',
          render: (setting): void => {
            setting.addDropdown(dropdown => {
              dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
              return dropdown
                .addOption('archived', 'Archive date')
                .addOption('published', 'Publish date')
                .setValue(this.plugin.settings.defaultTimelineSortBy)
                .onChange((value) => {
                  const sortBy = value as TimelineSortBy;
                  this.plugin.settings.defaultTimelineSortBy = sortBy;
                  this.plugin.settings.timelineSortBy = sortBy;
                  this.markDirty();
                });
            });
          },
        },
      ],
    }];
  }

  /**
   * Instagram Saved Import section.
   *
   * Mobile gating (PRD §11 / F6.1): the section still renders on mobile for
   * transparency, but the toggle is disabled and the description is replaced
   * with the desktop-only explanation.
   */
  private instagramImportSettingDefinitions(): SettingDefinitionItem[] {
    return [{
      type: 'group',
      heading: 'Instagram Saved Import (Experimental)',
      items: [{
        name: 'Enable Instagram Saved import',
        desc: Platform.isMobile
          ? 'Desktop-only. Run the import on desktop, then sync to mobile.'
          : 'Import Instagram Saved Posts from a .zip file exported by the Social Archiver '
              + 'Chrome extension. Adds a ribbon icon and a Command Palette entry. '
              + 'Experimental — requires a compatible export package.',
        render: (setting): void => {
          setting.addToggle(toggle => {
            toggle
              .setValue(this.plugin.settings.instagramImportEnabled)
              .onChange((value) => {
                this.plugin.settings.instagramImportEnabled = value;
                this.markDirty();
              });
            if (Platform.isMobile) {
              toggle.setDisabled(true);
            }
          });
        },
      }],
    }];
  }

  /**
   * Archive section.
   *
   * The first two rows are account-bound: they read and write through
   * workersApiClient rather than plugin.settings, so they stay imperative
   * rather than becoming declarative `control` items. Their async callbacks
   * check `settingEl.isConnected` instead of the old display-generation
   * counter — the declarative renderer owns the render lifecycle on 1.13+, so
   * "is this row still on screen" is the version-agnostic form of the same
   * staleness guard.
   */
  private archiveSettingDefinitions(): SettingDefinitionItem[] {
    return [{
      type: 'group',
      heading: 'Archive',
      items: [
        {
          name: 'Keep failed archive attempts',
          desc: 'Save failed or limited archives with site metadata for later review.',
          render: (setting): void => {
            let loadedPreference = false;
            let retainFailedArchiveAttempts = false;

            setting.addToggle(toggle => {
              toggle.setDisabled(true);

              if (!this.plugin.settings.authToken) {
                setting.setDesc('Sign in to sync failed archive behavior across clients.');
                return toggle;
              }

              toggle.onChange(async (value) => {
                if (!loadedPreference) return;

                const previous = retainFailedArchiveAttempts;
                retainFailedArchiveAttempts = value;
                toggle.setDisabled(true);

                try {
                  const preferences = await this.plugin.workersApiClient.updateArchivePreferences({
                    retainFailedArchiveAttempts: value,
                  });
                  retainFailedArchiveAttempts = preferences.retainFailedArchiveAttempts;
                  toggle.setValue(retainFailedArchiveAttempts);
                  new Notice('Archive behavior settings saved.');
                } catch (error) {
                  retainFailedArchiveAttempts = previous;
                  toggle.setValue(previous);
                  new Notice(
                    error instanceof Error
                      ? `Failed to update archive behavior settings: ${error.message}`
                      : 'Failed to update archive behavior settings.'
                  );
                } finally {
                  toggle.setDisabled(false);
                }
              });

              void this.plugin.workersApiClient.getArchivePreferences()
                .then((preferences) => {
                  if (!setting.settingEl.isConnected) return;
                  retainFailedArchiveAttempts = preferences.retainFailedArchiveAttempts;
                  toggle.setValue(retainFailedArchiveAttempts);
                  loadedPreference = true;
                  toggle.setDisabled(false);
                })
                .catch((error) => {
                  if (!setting.settingEl.isConnected) return;
                  setting.setDesc(
                    error instanceof Error
                      ? `Failed to load archive behavior settings: ${error.message}`
                      : 'Failed to load archive behavior settings.'
                  );
                });

              return toggle;
            });
          },
        },
        {
          name: 'Default place search',
          desc: 'Auto uses Kakao for Korean and Google Maps for other app languages. This account setting syncs across clients.',
          render: (setting): void => {
            const controller = new MapSearchProviderPreferenceController(
              this.plugin.workersApiClient,
              () => getLanguage() || window.navigator.language,
            );

            setting.addDropdown(dropdown => {
              dropdown
                .addOption('auto', 'Auto (app language)')
                .addOption('kakaomap', 'Kakao Maps')
                .addOption('googlemaps', 'Google Maps')
                .setValue('auto')
                .setDisabled(true);

              if (!this.plugin.settings.authToken) {
                setting.setDesc('Sign in to sync the default place search provider across clients.');
                return dropdown;
              }

              dropdown.onChange(async value => {
                if (!isMapSearchProviderPreference(value)) {
                  dropdown.setValue(controller.current);
                  return;
                }
                const preference = value;
                dropdown.setDisabled(true);
                try {
                  const state = await controller.save(preference);
                  dropdown.setValue(state.preference);
                  new Notice('Default place search provider saved.');
                } catch (error) {
                  if (error instanceof MapSearchProviderSaveError) {
                    dropdown.setValue(error.previousPreference);
                  }
                  new Notice(
                    error instanceof Error
                      ? `Failed to update place search provider: ${error.message}`
                      : 'Failed to update place search provider.'
                  );
                } finally {
                  dropdown.setDisabled(false);
                }
              });

              void controller.load()
                .then(state => {
                  if (!setting.settingEl.isConnected) return;
                  dropdown.setValue(state.preference);
                  dropdown.setDisabled(false);
                })
                .catch(error => {
                  if (!setting.settingEl.isConnected) return;
                  setting.setDesc(
                    error instanceof Error
                      ? `Failed to load place search provider: ${error.message}`
                      : 'Failed to load place search provider.'
                  );
                });

              return dropdown;
            });
          },
        },
        {
          name: 'Archive folder',
          desc: 'Folder where archived posts will be saved',
          render: (setting): void => {
            setting.addText(text => {
              text
                .setPlaceholder('Social archives')
                .setValue(this.plugin.settings.archivePath)
                .onChange((value) => {
                  // Set to default if empty
                  this.plugin.settings.archivePath = value || 'Social Archives';
                  this.markDirty();
                });

              // Add folder suggestions
              new FolderSuggest(this.app, text.inputEl);
            });
          },
        },
        {
          name: 'Archive folder structure',
          desc: 'Choose how notes are organized under archive folder',
          render: (setting): void => {
            setting.addDropdown(dropdown => {
              dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
              return dropdown
                .addOption('platform-year-month', 'Archive folder/platform/year/month')
                .addOption('platform-only', 'Archive folder/platform')
                .addOption('flat', 'Archive folder only')
                .setValue(this.plugin.settings.archiveOrganization)
                .onChange((value: string) => {
                  this.plugin.settings.archiveOrganization = value as ArchiveOrganizationMode;
                  this.markDirty();
                });
            });
          },
        },
        {
          name: 'Media folder',
          desc: 'Folder where downloaded media files will be saved',
          render: (setting): void => {
            setting.addText(text => {
              text
                .setPlaceholder('Attachments/social-archives')
                .setValue(this.plugin.settings.mediaPath)
                .onChange((value) => {
                  // Set to default if empty
                  this.plugin.settings.mediaPath = value || 'attachments/social-archives';
                  this.markDirty();
                });

              // Add folder suggestions
              new FolderSuggest(this.app, text.inputEl);
            });
          },
        },
        {
          name: 'Filename format',
          desc: 'Template for archived note filenames. Click tokens to insert at cursor.',
          aliases: ['template', 'tokens', 'note title'],
          render: (setting): void => {
            // Force the block to wrap below the header row
            setting.settingEl.addClass('st-fn-header-setting');
            const blockEl = setting.settingEl.createDiv();
            blockEl.addClass('st-fn-block');

            // Input row: full-width input + reset button
            const inputRowEl = blockEl.createDiv();
            inputRowEl.addClass('st-fn-input-row');

            const inputEl = inputRowEl.createEl('input', { type: 'text' });
            inputEl.value = this.plugin.settings.fileNameFormat;
            inputEl.placeholder = DEFAULT_SETTINGS.fileNameFormat;
            inputEl.addClass('st-fn-input');
            inputEl.addEventListener('input', () => {
              this.plugin.settings.fileNameFormat = inputEl.value || DEFAULT_SETTINGS.fileNameFormat;
              this.markDirty();
              updateFilenamePreview(this.plugin.settings.fileNameFormat);
            });

            // Reset button next to input
            const resetBtn = inputRowEl.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': 'Reset to default' } });
            resetBtn.title = 'Reset to default';
            setIcon(resetBtn, 'rotate-ccw');
            resetBtn.addEventListener('click', (e) => {
              e.preventDefault();
              this.plugin.settings.fileNameFormat = DEFAULT_SETTINGS.fileNameFormat;
              this.markDirty();
              inputEl.value = DEFAULT_SETTINGS.fileNameFormat;
              updateFilenamePreview(DEFAULT_SETTINGS.fileNameFormat);
            });

            // Token chips row
            const chipsEl = blockEl.createDiv();
            chipsEl.addClass('st-fn-chips');

            const tokenDefs: { token: string; label: string }[] = [
              { token: 'published_date', label: 'Date' },
              { token: 'archived_date', label: 'Archived' },
              { token: 'platform', label: 'Platform' },
              { token: 'author', label: 'Author' },
              { token: 'title', label: 'Title' },
              { token: 'slug', label: 'Slug' },
              { token: 'post_id', label: 'Post ID' },
              { token: 'short_id', label: 'Short ID' },
            ];

            for (const { token, label } of tokenDefs) {
              const chip = chipsEl.createEl('button', { text: label });
              chip.addClass('st-fn-chip');
              chip.title = `Insert {${token}}`;
              chip.addEventListener('click', (e) => {
                e.preventDefault();
                const start = inputEl.selectionStart ?? inputEl.value.length;
                const end = inputEl.selectionEnd ?? start;
                const tokenStr = `{${token}}`;
                const before = inputEl.value.slice(0, start);
                const after = inputEl.value.slice(end);
                inputEl.value = before + tokenStr + after;
                this.plugin.settings.fileNameFormat = inputEl.value || DEFAULT_SETTINGS.fileNameFormat;
                this.markDirty();
                updateFilenamePreview(this.plugin.settings.fileNameFormat);
                const newPos = start + tokenStr.length;
                inputEl.setSelectionRange(newPos, newPos);
                inputEl.focus();
              });
            }

            // Preview line
            const previewEl = blockEl.createDiv();
            previewEl.addClass('st-fn-preview');

            const sampleTokens: Record<string, string> = {
              published_date: '2024-01-15',
              archived_date: new Date().toISOString().slice(0, 10),
              platform: 'Facebook',
              author: 'John Doe',
              title: 'My awesome post',
              slug: 'my-awesome-post',
              post_id: 'pfbid02ABC123',
              short_id: 'BC123',
              shortId: 'BC123',
            };

            const updateFilenamePreview = (format: string): void => {
              let preview = format;
              for (const [token, value] of Object.entries(sampleTokens)) {
                preview = preview.replace(new RegExp(`\\{${token}\\}`, 'g'), value);
              }
              previewEl.empty();
              const label = previewEl.createSpan({ text: 'Preview: ' });
              label.addClass('st-fn-preview-label');
              previewEl.createEl('code', { text: `${preview}.md` });
            };

            updateFilenamePreview(this.plugin.settings.fileNameFormat);
          },
        },
        {
          name: 'Download media',
          desc: 'Choose what media to download with posts. This setting serves as the default for the archive modal.',
          render: (setting): void => {
            setting.addDropdown(dropdown => {
              dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
              return dropdown
                .addOption('text-only', 'Text only')
                .addOption('images-only', 'Images only')
                .addOption('images-and-videos', 'Images and videos')
                .setValue(this.plugin.settings.downloadMedia)
                .onChange((value: string) => {
                  this.plugin.settings.downloadMedia = value as MediaDownloadMode;
                  this.markDirty();
                });
            });
          },
        },
        {
          // Large Media Guard — prompt before downloading oversized top-level
          // videos. See prd-large-media-guard.md (Flow A / Prevention).
          name: 'Large video prompt threshold (MB)',
          desc: 'Prompt before downloading videos larger than this size. Set to 0 to always download without prompting.',
          render: (setting): void => {
            setting.addText(text => text
              .setPlaceholder('100')
              .setValue(String(this.plugin.settings.largeVideoPromptThresholdMB ?? 100))
              .onChange((value) => {
                const parsed = Number.parseInt(value, 10);
                const normalized = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
                this.plugin.settings.largeVideoPromptThresholdMB = normalized;
                this.markDirty();
              }));
          },
        },
        {
          name: 'Include comments',
          desc: 'Include platform comments in archived notes. When disabled, only the post content and your personal notes are saved. This setting serves as the default for the archive modal.',
          render: (setting): void => {
            setting.addToggle(toggle => toggle
              .setValue(this.plugin.settings.includeComments)
              .onChange((value) => {
                this.plugin.settings.includeComments = value;
                this.markDirty();
              }));
          },
        },
        {
          name: 'Include hashtags as Obsidian tags',
          desc: 'When enabled, extracted hashtags are rendered as Obsidian tags. Disable this to keep hashtags visible without creating native tags in your vault.',
          render: (setting): void => {
            setting.addToggle(toggle => toggle
              .setValue(this.plugin.settings.includeHashtagsAsObsidianTags)
              .onChange((value) => {
                this.plugin.settings.includeHashtagsAsObsidianTags = value;
                this.markDirty();
              }));
          },
        },
      ],
    }];
  }

  /**
   * The "sign in to enable" row an account-bound section shows in place of its
   * controls. `visible` is evaluated on every render, so the section flips
   * between this and its real content without rebuilding the definition tree.
   */
  private signedOutRow(description: string): SettingGroupItem {
    return {
      name: 'Sign in to enable',
      desc: description,
      visible: () => !isAuthenticated(this.plugin),
      render: (setting): void => {
        setting.addButton(button => button
          .setButtonText('Sign in')
          .setCta()
          .onClick(() => {
            this.containerEl.scrollTo({ top: 0, behavior: 'smooth' });
          }));
      },
    };
  }

  /** Mobile sync section — account-bound (PRD S2.3), body is a Svelte island. */
  private mobileSyncSettingDefinitions(): SettingDefinitionItem[] {
    return [{
      type: 'group',
      heading: 'Mobile sync',
      items: [
        this.signedOutRow(getAccountRequiredMessage('sync')),
        this.svelteIslandRow('Mobile sync', 'syncSettingsComponent', (host) => {
          const syncContainer = host.createDiv({ cls: 'social-archiver-sync-section' });
          syncContainer.addClass('sa-settings-subsection');
          return mount(SyncSettingsTab, {
            target: syncContainer,
            props: { plugin: this.plugin },
          });
        }, () => isAuthenticated(this.plugin)),
      ],
    }];
  }

  /** Cross-posting section (Threads OAuth + future platforms) — account-bound. */
  private crossPostSettingDefinitions(): SettingDefinitionItem[] {
    return [{
      type: 'group',
      heading: 'Cross-posting',
      items: [
        this.signedOutRow(getAccountRequiredMessage('crosspost')),
        this.svelteIslandRow('Cross-posting', 'crossPostComponent', (host) => {
          const crossPostContainer = host.createDiv({ cls: 'social-archiver-crosspost-section' });
          return mount(CrossPostSettingsTab, {
            target: crossPostContainer,
            props: { plugin: this.plugin },
          });
        }, () => isAuthenticated(this.plugin)),
      ],
    }];
  }

  /** Update notifications section. */
  private updateNotificationsSettingDefinitions(): SettingDefinitionItem[] {
    return [{
      type: 'group',
      heading: 'Update notifications',
      items: [
        {
          name: 'Release notes',
          desc: 'Open the shared Social Archiver release notes hub',
          render: (setting): void => {
            setting.addButton(button => button
              .setButtonText('View release notes')
              .onClick(() => {
                window.open(RELEASE_NOTES_URL, '_blank');
              }));
          },
        },
        {
          name: 'Show release notes after updates',
          desc: 'Display a modal with new features and changes when the plugin updates',
          render: (setting): void => {
            setting.addToggle(toggle => toggle
              .setValue(this.plugin.settings.showReleaseNotes)
              .onChange(async (value) => {
                // saveSettingsPartial (not raw saveData) keeps per-device ids out of data.json
                await this.plugin.saveSettingsPartial(
                  { showReleaseNotes: value },
                  { reinitialize: false, notify: false }
                );
                this.markDirty();
              }));
          },
        },
      ],
    }];
  }

  /** Support section — sits at the very bottom, below the danger zone. */
  private supportSettingDefinitions(): SettingDefinitionItem[] {
    return [{
      type: 'group',
      heading: 'Support',
      items: [
      this.blockRow('Support divider', (host) => {
        const supportDivider = host.createDiv({ cls: 'social-archiver-support-divider' });
        supportDivider.addClass('st-sup-divider');
      }),
      {
        name: 'About the creator',
        desc: 'Hey, I’m Hyungyun Jun Lim. I’m a startup founder and builder, and I build Social Archiver as a solo side project. I created it for people like me who want local archives because posts get deleted, platforms change, and content disappears. Feel free to reach out on GitHub for feedback or business inquiries.',
        render: (setting): void => {
          setting.addButton((button) => {
            button.buttonEl.addClass('sa-mobile-compact-btn');
            return button
              .setIcon('github')
              .setButtonText('GitHub profile')
              .onClick(() => {
                window.open(PERSONAL_GITHUB_URL, '_blank');
              });
          });
        },
      }],
    }];
  }

  /**
   * A definition that contributes raw markup to the section body rather than a
   * setting row — info paragraphs, callouts, helper text. It drops its own row
   * and builds into the parent, so the markup sits between rows exactly where
   * the imperative code put it. Excluded from search: there is no setting here
   * for a query to match.
   */
  private blockRow(name: string, build: (host: HTMLElement) => void): SettingGroupItem {
    return {
      name,
      searchable: false,
      render: (setting): void => {
        const host = setting.settingEl.parentElement ?? this.containerEl;
        setting.settingEl.remove();
        build(host);
      },
    };
  }

  /** Naver section — cookies for private/member-only cafes. */
  private naverSettingDefinitions(): SettingDefinitionItem[] {
    const cookieRow = (
      name: 'NID_AUT' | 'NID_SES',
      get: () => string,
      set: (value: string) => void,
    ): SettingGroupItem => ({
      name,
      desc: `Copy the ${name} cookie value`,
      render: (setting): void => {
        setting.addText((text) => {
          text
            .setPlaceholder(`Paste ${name} value`)
            .setValue(get())
            .onChange((value) => {
              // Clean the value - remove "NID_AUT=" prefix if user pasted it
              set(value.replace(new RegExp(`^${name}\\s*=\\s*`, 'i'), '').trim());
              this.updateNaverCookieString();
              this.markDirty();
            });
          text.inputEl.addClass('sa-input-monospace');
        });
      },
    });

    return [{
      type: 'group',
      heading: 'Naver',
      items: [
        this.blockRow('Naver description', (host) => {
          const naverDesc = host.createEl('p', {
            text: 'Configure settings for archiving content from Naver blog, cafe, and news.'
          });
          naverDesc.addClass('sa-settings-info');
        }),
        {
          name: 'Cookie',
          desc: createFragment((frag) => {
            frag.appendText('For private/member-only cafes. ');
            frag.createEl('br');
            frag.appendText('Get from Chrome: F12 → Application → Cookies → naver.com');
            frag.createEl('br');
            frag.createEl('br');
            const link = frag.createEl('a', {
              text: 'How to get Naver cookies →',
              href: 'https://github.com/social-archive/obsidian-social-archiver/wiki/Naver-Cookie-Setup',
            });
            link.setAttr('target', '_blank');
          }),
          render: (): void => undefined,
        },
        cookieRow(
          'NID_AUT',
          () => this.plugin.settings.nidAut,
          (value) => { this.plugin.settings.nidAut = value; },
        ),
        cookieRow(
          'NID_SES',
          () => this.plugin.settings.nidSes,
          (value) => { this.plugin.settings.nidSes = value; },
        ),
        this.blockRow('Naver cookie tip', (host) => {
          const helperText = host.createDiv({ cls: 'setting-item-description' });
          helperText.addClass('sa-settings-helper');
          const small = helperText.createEl('small');
          small.addClass('sa-text-muted');
          small.textContent = '💡 ';
          small.createEl('strong', { text: 'Tip:' });
          small.appendChild(activeDocument.createTextNode(' Leave empty for public blogs and cafes. Only needed for private cafes that require login.'));
        }),
      ],
    }];
  }

  /** Webtoon streaming section. */
  private webtoonStreamingSettingDefinitions(): SettingDefinitionItem[] {
    // Every toggle here writes into the same optional settings object, so
    // materialize it once instead of repeating the four-field default literal
    // at each call site.
    const streaming = (): NonNullable<typeof this.plugin.settings.webtoonStreaming> => {
      this.plugin.settings.webtoonStreaming ??= {
        viewMode: 'stream-first',
        backgroundDownload: true,
        prefetchNextEpisode: true,
        mobileDataSaver: false,
      };
      return this.plugin.settings.webtoonStreaming;
    };

    // 44px touch target on mobile (iOS HIG compliance).
    const toggleRow = (
      name: string,
      desc: string,
      get: () => boolean,
      set: (value: boolean) => void,
    ): SettingGroupItem => ({
      name,
      desc,
      render: (setting): void => {
        setting.addToggle(toggle => toggle
          .setValue(get())
          .onChange((value) => {
            set(value);
            this.markDirty();
          }));
        if (Platform.isMobile) {
          setting.settingEl.addClass('st-mobile-touch');
        }
      },
    });

    return [{
      type: 'group',
      heading: 'Webtoon streaming',
      items: [
        this.blockRow('Streaming mode explainer', (host) => {
          const infoDiv = host.createDiv({ cls: 'setting-info' });
          infoDiv.addClass('sa-settings-info-box');
          infoDiv.createEl('strong', { text: 'Streaming mode' });
          infoDiv.appendChild(activeDocument.createTextNode(' loads webtoon episodes instantly without waiting for downloads.'));
          const ul = infoDiv.createEl('ul');
          ul.addClass('sa-settings-info-list');
          ul.createEl('li', { text: 'Images are proxied through our server to bypass CORS restrictions' });
          ul.createEl('li', { text: 'Background download saves episodes for offline reading' });
          ul.createEl('li', { text: 'Prefetch pre-loads the next episode for seamless transitions' });
        }),
        {
          name: 'Episode loading mode',
          desc: 'Stream-first: load immediately via proxy (faster). Download-first: wait for full download (offline ready).',
          render: (setting): void => {
            setting.addDropdown(dropdown => {
              dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
              return dropdown
                .addOption('stream-first', 'Stream first (recommended)')
                .addOption('download-first', 'Download first')
                .setValue(this.plugin.settings.webtoonStreaming?.viewMode || 'stream-first')
                .onChange((value) => {
                  streaming().viewMode = value as 'stream-first' | 'download-first';
                  this.markDirty();
                });
            });
          },
        },
        toggleRow(
          'Background download',
          'Automatically download streamed episodes to vault for offline access.',
          () => this.plugin.settings.webtoonStreaming?.backgroundDownload !== false,
          (value) => { streaming().backgroundDownload = value; },
        ),
        toggleRow(
          'Prefetch next episode',
          'Pre-load next episode data when reaching end of current episode for faster transitions.',
          () => this.plugin.settings.webtoonStreaming?.prefetchNextEpisode !== false,
          (value) => { streaming().prefetchNextEpisode = value; },
        ),
        {
          ...toggleRow(
            'Mobile data saver',
            'Load lower quality images to reduce data usage on mobile networks.',
            () => this.plugin.settings.webtoonStreaming?.mobileDataSaver ?? false,
            (value) => { streaming().mobileDataSaver = value; },
          ),
          visible: () => Platform.isMobile,
        },
      ],
    }];
  }

  /**
   * Local archives section (PRD S2.3, S5.2): count of local-only clip notes,
   * the import entry point when signed in, and the durable last-import summary
   * (S6.5).
   *
   * The vault is rescanned inside the callbacks rather than once when the tree
   * is built: on 1.13+ the definitions are constructed once and rendered many
   * times, so a count captured up front would go stale.
   */
  private localArchivesSettingDefinitions(): SettingDefinitionItem[] {
    const count = (): number => new LocalArchiveScanner(this.app).count();
    const countLabel = (): string => (count() === 1 ? '1 local archive' : `${count()} local archives`);

    return [{
      type: 'group',
      heading: 'Local archives',
      items: [
        {
          name: 'Local archives in this vault',
          visible: () => !isAuthenticated(this.plugin),
          render: (setting): void => {
            setting
              .setName(`${countLabel()} in this vault`)
              .setDesc(count() > 0
                ? 'Sign in to import them to your account.'
                : 'Browser clips are stored only in this vault.');
          },
        },
        {
          name: 'Import local archives',
          visible: () => isAuthenticated(this.plugin) && count() > 0,
          render: (setting): void => {
            setting.setName(`${countLabel()} not yet imported`);
            setting.addButton(button => button
              .setButtonText('Import local archives…')
              .setCta()
              .onClick(() => {
                void this.plugin.openLocalArchiveImport();
              }));
          },
        },
        this.autoUploadRow(),
        this.blockRow('Last local import summary', (host) => {
          const lastResult = this.plugin.settings.localImportLastResult;
          if (!lastResult || !isAuthenticated(this.plugin)) return;
          const summaryEl = host.createDiv({
            cls: 'setting-item-description',
            text: this.formatLocalImportSummary(lastResult),
          });
          summaryEl.addClass('sa-settings-info');
        }),
      ],
    }];
  }

  /**
   * Auto-upload-new-clips toggle (PRD Phase C). Paid plans only — each
   * upload consumes monthly archive quota, so the toggle renders disabled
   * for logged-out and free-plan users instead of silently spending quota.
   */
  private autoUploadRow(): SettingGroupItem {
    return {
      name: 'Auto-upload new clips',
      render: (setting): void => {
        const authenticated = isAuthenticated(this.plugin);
        const paid = isPaidPlan(this.plugin);

        setting.setDesc(
          !authenticated
            ? 'Sign in to enable. Uploads count against your monthly archive quota.'
            : paid
              ? 'Automatically upload new browser clips to your account. Each upload counts against your monthly archive quota.'
              : 'Available on paid plans. Each upload counts against your monthly archive quota.'
        );

        setting.addToggle(toggle => {
          toggle
            .setValue(paid && this.plugin.settings.autoUploadLocalClips)
            .setDisabled(!paid)
            .onChange(async (value) => {
              await this.plugin.saveSettingsPartial(
                { autoUploadLocalClips: value },
                { reinitialize: false, notify: true }
              );
            });
        });
      },
    };
  }

  /**
   * Sharing section. Account-bound (PRD S2.3): share links are hosted on
   * social-archive.org, so the signed-out state renders the sign-in CTA
   * instead of dead controls.
   */
  private sharingSettingDefinitions(): SettingDefinitionItem[] {
    // Preview length only applies in preview mode. The share-mode dropdown
    // toggles it live, so the two rows exchange the element rather than
    // relying on a re-render.
    let previewLengthEl: HTMLElement | null = null;
    const updatePreviewLengthVisibility = (): void => {
      previewLengthEl?.toggleClass('sa-hidden', this.plugin.settings.shareMode !== 'preview');
    };
    const signedIn = (): boolean => isAuthenticated(this.plugin);

    return [{
      type: 'group',
      heading: 'Sharing',
      items: [
        this.signedOutRow(getAccountRequiredMessage('share')),
        {
          name: 'Share mode',
          desc: 'Choose how shared posts appear on the web. "preview" mode protects copyright by showing only excerpts without media.',
          visible: signedIn,
          render: (setting): void => {
            setting.addDropdown(dropdown => {
              dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
              return dropdown
                .addOption('preview', 'Preview (copyright-safe)')
                .addOption('full', 'Full content (original)')
                .setValue(this.plugin.settings.shareMode)
                .onChange((value: string) => {
                  this.plugin.settings.shareMode = value as ShareMode;
                  this.markDirty();
                  updatePreviewLengthVisibility(); // Update visibility when mode changes
                });
            });
          },
        },
        {
          name: 'Copy reader mode link by default',
          desc: 'When creating a share link, copy the reader-mode URL (#reader). Disable to copy the normal post URL.',
          visible: signedIn,
          render: (setting): void => {
            setting.addToggle(toggle => toggle
              .setValue(this.plugin.settings.copyShareLinkAsReaderMode)
              .onChange((value) => {
                this.plugin.settings.copyShareLinkAsReaderMode = value;
                this.markDirty();
              }));
          },
        },
        {
          name: 'Preview length',
          desc: 'Maximum character count for text preview in "preview" mode. Platform link is always included in preview mode.',
          visible: signedIn,
          render: (setting): void => {
            setting.addText(text => text
              .setPlaceholder('280')
              .setValue(String(this.plugin.settings.sharePreviewLength))
              .onChange((value) => {
                const num = parseInt(value) || 280;
                this.plugin.settings.sharePreviewLength = Math.max(100, Math.min(1000, num));
                this.markDirty();
              }));
            previewLengthEl = setting.settingEl;
            updatePreviewLengthVisibility();
          },
        },
      ],
    }];
  }

  /**
   * A section body that is a Svelte island rather than setting rows.
   *
   * The island owns its own layout, so the wrapping row is dropped and the
   * component mounts into its parent. `SettingGroup.listEl` would be the
   * natural handle but it needs Obsidian 1.11.0 and minAppVersion is 1.10.0.
   * The returned cleanup thunk unmounts on 1.13+; `cleanupComponents()` covers
   * the pre-1.13 path, where display() rebuilds the whole tab.
   *
   * Not searchable: the island's contents are opaque to the definition tree,
   * so a query has nothing to match here.
   */
  private svelteIslandRow(
    name: string,
    key: SvelteComponentKey,
    mountInto: (host: HTMLElement) => ReturnType<typeof mount>,
    visible?: () => boolean,
  ): SettingGroupItem {
    return {
      name,
      searchable: false,
      ...(visible ? { visible } : {}),
      render: (setting): (() => void) => {
        const host = setting.settingEl.parentElement ?? this.containerEl;
        setting.settingEl.remove();
        this[key] = mountInto(host);
        return () => this.unmountComponent(key);
      },
    };
  }

  /** Account section — sign-in state and plan, rendered by AuthSettingsTab. */
  private accountSettingDefinitions(): SettingDefinitionItem[] {
    return [{
      type: 'group',
      heading: 'Account',
      items: [
        this.svelteIslandRow('Account', 'authComponent', (host) => {
          const authContainer = host.createDiv({ cls: 'social-archiver-auth-section' });
          authContainer.addClass('sa-settings-section');
          return mount(AuthSettingsTab, {
            target: authContainer,
            props: { plugin: this.plugin },
          });
        }),
      ],
    }];
  }

  /**
   * Danger zone — destructive account and vault actions. Deliberately has no
   * heading of its own: DangerZone.svelte renders its own framed header.
   */
  private dangerZoneSettingDefinitions(): SettingDefinitionItem[] {
    return [{
      type: 'group',
      items: [
        this.svelteIslandRow('Danger zone', 'dangerZoneComponent', (host) => {
          const dangerZoneContainer = host.createDiv({ cls: 'social-archiver-danger-zone' });
          return mount(DangerZone, {
            target: dangerZoneContainer,
            props: { plugin: this.plugin },
          });
        }),
      ],
    }];
  }

  /**
   * Explains the Shell Execution warning Obsidian shows for this plugin,
   * ahead of the desktop-local features that cause it.
   */
  private localCommandExecutionNoticeDefinitions(): SettingDefinitionItem[] {
    return [{
      type: 'group',
      items: [{
        name: 'Local command execution',
        desc: 'Obsidian may show a Shell Execution warning for Social Archiver. '
          + 'The plugin can run local command-line tools only for desktop features you enable or request: '
          + 'AI comments (Claude/Gemini/Codex CLI), Whisper transcription, video downloads (yt-dlp/ffmpeg), '
          + 'and optional Supertonic TTS. Mobile Obsidian does not run these local shell commands.',
        render: (setting): void => {
          setting.settingEl.addClass('sa-settings-info');
        },
      }],
    }];
  }

  /**
   * Text-to-Speech section (FR-07).
   *
   * Every predicate re-reads the installer rather than closing over a snapshot:
   * install and uninstall both call `display()`, and on 1.13+ the tree is built
   * once and rendered many times, so captured state would go stale.
   *
   * When Supertonic is selected but not yet installed the section shows only
   * the install affordance — the playback settings below it would have no
   * engine to apply to.
   */
  private ttsSettingDefinitions(): SettingDefinitionItem[] {
    if (!FEATURE_READER_TTS_ENABLED) return [];

    const tts = (): NonNullable<typeof this.plugin.settings.tts> => {
      this.plugin.settings.tts ??= { ...DEFAULT_TTS_SETTINGS };
      return this.plugin.settings.tts;
    };
    const isSupertonic = (): boolean => tts().provider === 'supertonic' && Platform.isDesktop;
    const installed = (): boolean => isSupertonic() && new SupertonicInstaller().isInstalled();
    const needsInstall = (): boolean => isSupertonic() && !installed();
    /** The playback settings are meaningless until an engine is available. */
    const engineReady = (): boolean => !needsInstall();

    const licenseNote = (host: HTMLElement): void => {
      const note = host.createDiv({ cls: 'setting-item-description' });
      note.textContent = 'Supertonic model license: OpenRAIL-M. Code: MIT.';
      note.addClass('sa-settings-info');
    };

    const toggleRow = (
      name: string,
      desc: string,
      get: () => boolean,
      set: (value: boolean) => void,
    ): SettingGroupItem => ({
      name,
      desc,
      visible: engineReady,
      render: (setting): void => {
        setting.addToggle((toggle) => {
          toggle
            .setValue(get())
            .onChange(async (value: boolean) => {
              set(value);
              await this.plugin.saveSettings();
            });
        });
      },
    });

    return [{
      type: 'group',
      heading: 'Text-to-Speech',
      items: [
        {
          name: 'TTS Provider',
          desc: 'Choose between cloud (Azure) or on-device (Supertonic) speech synthesis',
          render: (setting): void => {
            // Supertonic is desktop-only (FR-07 AC): fall back rather than
            // leaving a selected engine that can never run.
            if (!Platform.isDesktop && tts().provider === 'supertonic') {
              tts().provider = 'azure';
              void this.plugin.saveSettings();
            }
            setting.addDropdown((dropdown) => {
              dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
              dropdown
                .addOption('azure', 'Azure Cloud')
                .addOption('supertonic', 'Supertonic (on-device, desktop only)')
                .setValue(tts().provider)
                .onChange(async (value: string) => {
                  tts().provider = value as PluginTTSProviderId;
                  // Reset voiceId when switching providers
                  tts().voiceId = '';
                  await this.plugin.saveSettings();
                  this.display();
                });
            });
          },
        },
        {
          name: 'Supertonic engine',
          desc: 'Install the on-device speech engine.',
          visible: needsInstall,
          render: (setting): void => {
            const installer = new SupertonicInstaller();
            const installedVersion = installer.getInstalledVersion();
            const targetVersion = installer.getTargetVersion();
            const hasPreviousInstall = Boolean(installedVersion);
            const actionLabel = hasPreviousInstall ? `Update to v${targetVersion}` : 'Install';
            const runningLabel = hasPreviousInstall ? 'Updating...' : 'Installing...';
            const successLabel = hasPreviousInstall ? 'updated' : 'installed';

            setting.setDesc(
              hasPreviousInstall
                ? `Found Supertonic v${installedVersion}. Update to v${targetVersion} to enable Supertonic 3 support.`
                : `Not installed. Downloads ~415MB of models for on-device TTS (desktop only).`,
            );
            setting.addButton((button) => {
              button
                .setButtonText(actionLabel)
                .setCta()
                .onClick(async () => {
                  button.setDisabled(true);
                  button.setButtonText(runningLabel);
                  const progressEl = setting.descEl;

                  const abortController = new AbortController();

                  const result = await installer.install((progress) => {
                    progressEl.textContent = `${progress.message} (${progress.step}/${progress.totalSteps})`;
                  }, abortController.signal);

                  if (result.success) {
                    new Notice(`Supertonic ${successLabel} (v${result.version}).`);
                  } else {
                    new Notice(`Supertonic setup failed: ${result.error}`);
                  }
                  this.display();
                });
            });
          },
        },
        { ...this.blockRow('Supertonic license (pre-install)', licenseNote), visible: needsInstall },

        // --- Azure provider, or Supertonic installed ---
        {
          name: 'Speech speed',
          desc: 'Playback speed (0.5x to 2.0x)',
          visible: engineReady,
          render: (setting): void => {
            setting.addSlider((slider) => {
              slider
                .setLimits(0.5, 2.0, 0.25)
                .setValue(tts().speed)
                .setDynamicTooltip()
                .onChange(async (value: number) => {
                  tts().speed = value;
                  await this.plugin.saveSettings();
                });
            });
          },
        },
        toggleRow(
          'Highlight current sentence',
          'Highlight the sentence being spoken in Reader Mode',
          () => tts().highlightEnabled,
          (value) => { tts().highlightEnabled = value; },
        ),
        toggleRow(
          'Auto-scroll to sentence',
          'Automatically scroll to keep the current sentence visible',
          () => tts().scrollSyncEnabled,
          (value) => { tts().scrollSyncEnabled = value; },
        ),
        {
          ...this.blockRow('Azure cloud note', (host) => {
            const azureNote = host.createDiv({ cls: 'setting-item-description' });
            azureNote.textContent = 'Azure Speech uses your Social Archiver account. Login required.';
            azureNote.addClass('sa-settings-info');
          }),
          visible: () => engineReady() && tts().provider === 'azure',
        },
        {
          name: 'Supertonic engine',
          aliases: ['uninstall', 'update'],
          visible: installed,
          render: (setting): void => {
            const installer = new SupertonicInstaller();
            const installedVersion = installer.getInstalledVersion();
            const targetVersion = installer.getTargetVersion();
            const updateAvailable = installer.isUpdateAvailable();

            setting.setDesc(
              updateAvailable
                ? `Installed (v${installedVersion ?? 'unknown'}). Update to v${targetVersion} for Supertonic 3 support.`
                : `Installed (v${installedVersion ?? 'unknown'}). Runs locally on your machine.`,
            );

            if (updateAvailable) {
              setting.addButton((button) => {
                button
                  .setButtonText(`Update to v${targetVersion}`)
                  .setCta()
                  .onClick(async () => {
                    button.setDisabled(true);
                    button.setButtonText('Updating...');
                    const progressEl = setting.descEl;
                    const result = await installer.install((progress) => {
                      progressEl.textContent = `${progress.message} (${progress.step}/${progress.totalSteps})`;
                    });
                    if (result.success) {
                      new Notice(`Supertonic updated (v${result.version}).`);
                    } else {
                      new Notice(`Supertonic update failed: ${result.error}`);
                    }
                    this.display();
                  });
              });
            }

            setting.addButton((button) => {
              button
                .setButtonText('Uninstall')
                .setWarning()
                .onClick(async () => {
                  button.setDisabled(true);
                  button.setButtonText('Uninstalling...');
                  const result = await installer.uninstall();
                  if (result.success) {
                    new Notice('Supertonic uninstalled.');
                  } else {
                    new Notice(`Uninstall failed: ${result.error}`);
                  }
                  this.display();
                });
            });
          },
        },
        {
          // Quality selector (FR-07)
          name: 'Synthesis quality',
          desc: 'Higher quality = slower synthesis. "Balanced" is recommended.',
          visible: installed,
          render: (setting): void => {
            setting.addDropdown((dropdown) => {
              dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
              dropdown
                .addOption('fast', 'Fast (lower quality)')
                .addOption('balanced', 'Balanced (recommended)')
                .addOption('high', 'High (slower)')
                .setValue(tts().supertonicQuality)
                .onChange(async (value: string) => {
                  tts().supertonicQuality = value as 'fast' | 'balanced' | 'high';
                  await this.plugin.saveSettings();
                });
            });
          },
        },
        {
          ...this.blockRow('Supertonic license and install path', (host) => {
            licenseNote(host);
            const resourceNote = host.createDiv({ cls: 'setting-item-description' });
            resourceNote.textContent = `Install path: ${new SupertonicInstaller().getInstallPath()}`;
            resourceNote.addClass('sa-settings-info');
          }),
          visible: installed,
        },
        {
          name: 'Language',
          desc: 'Auto-detect or override the speech language',
          visible: engineReady,
          render: (setting): void => {
            setting.addDropdown((dropdown) => {
              dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
              dropdown.addOption('', 'Auto-detect');
              for (const option of TTS_LANGUAGE_OVERRIDE_OPTIONS) {
                dropdown.addOption(option.code, option.label);
              }
              dropdown
                .setValue(tts().language)
                .onChange(async (value: string) => {
                  tts().language = value;
                  await this.plugin.saveSettings();
                });
            });
          },
        },
      ],
    }];
  }

  /**
   * AI comments section. Account-bound (PRD S2.3) and desktop-only — it drives
   * local AI CLI tools.
   *
   * `render` is synchronous while CLI detection is not, so the rows that depend
   * on it paint immediately and fill in when the probe resolves, guarded on the
   * row still being on screen.
   *
   * Platform visibility and Vault context stay as imperative collapsibles: they
   * are self-contained widgets with their own headers and toggle their bodies
   * by class rather than by re-render.
   */
  private aiCommentSettingDefinitions(): SettingDefinitionItem[] {
    const settings = (): typeof this.plugin.settings.aiComment => this.plugin.settings.aiComment;
    const available = (): boolean => isAuthenticated(this.plugin) && !Platform.isMobile;

    const languageRow = (
      name: string,
      desc: string,
      get: () => AIOutputLanguage | undefined,
      set: (value: AIOutputLanguage) => void,
    ): SettingGroupItem => ({
      name,
      desc,
      visible: available,
      render: (setting): void => {
        setting.addDropdown(dropdown => {
          dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
          for (const [lang, displayName] of Object.entries(OUTPUT_LANGUAGE_NAMES)) {
            dropdown.addOption(lang, displayName);
          }
          dropdown.setValue(get() || 'auto');
          dropdown.onChange((value: string) => {
            set(value as AIOutputLanguage);
            this.markDirty();
          });
        });
      },
    });

    return [{
      type: 'group',
      heading: 'AI comments',
      items: [
        this.signedOutRow(getAccountRequiredMessage('ai-comments')),
        {
          ...this.blockRow('AI comments mobile notice', (host) => {
            const mobileNote = host.createDiv({ cls: 'setting-item-description' });
            mobileNote.textContent = 'AI comments are only available on desktop (requires local CLI tools)';
            mobileNote.addClass('sa-settings-info');
          }),
          visible: () => isAuthenticated(this.plugin) && Platform.isMobile,
        },
        {
          name: 'Enable AI comments',
          desc: 'Show AI comment suggestions on archived posts. Requires local AI CLI tools.',
          visible: available,
          render: (setting): void => {
            setting.addToggle(toggle => toggle
              .setValue(settings().enabled)
              .onChange(async (value) => {
                settings().enabled = value;
                await this.plugin.saveSettingsPartial(
                  { aiComment: this.plugin.settings.aiComment },
                  { reinitialize: false, notify: true },
                );
              }));
          },
        },
        {
          ...this.blockRow('AI tools status', (host) => {
            const aiToolsContainer = host.createDiv({ cls: 'ai-tools-status-container' });
            aiToolsContainer.addClass('sa-settings-subsection');
            void this.renderAIToolsStatus(aiToolsContainer);
          }),
          visible: available,
        },
        {
          name: 'Default AI tool',
          desc: 'Choose which AI CLI to use by default',
          visible: available,
          render: (setting): void => {
            const clis: AICli[] = ['claude', 'gemini', 'codex'];
            setting.addDropdown(dropdown => {
              dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
              for (const cli of clis) {
                dropdown.addOption(cli, AI_CLI_INFO[cli].displayName);
              }
              dropdown.setValue(settings().defaultCli);
              dropdown.onChange((value: string) => {
                settings().defaultCli = value as AICli;
                this.markDirty();
              });

              // Detection is async; annotate the options once it lands rather
              // than blocking the whole section on a subprocess probe.
              void this.getDetectedClis().then((detected) => {
                if (!setting.settingEl.isConnected) return;
                for (const option of Array.from(dropdown.selectEl.options)) {
                  const info = AI_CLI_INFO[option.value as AICli];
                  option.text = detected.has(option.value as AICli)
                    ? `${info.displayName} ✓`
                    : `${info.displayName} (not installed)`;
                }
              });
            });
          },
        },
        {
          name: 'Default comment type',
          desc: 'Type of analysis to generate by default',
          visible: available,
          render: (setting): void => {
            setting.addDropdown(dropdown => {
              dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
              const types: AICommentType[] = ['summary', 'factcheck', 'critique', 'keypoints', 'sentiment', 'connections', 'glossary'];
              for (const type of types) {
                dropdown.addOption(type, COMMENT_TYPE_DISPLAY_NAMES[type]);
              }
              dropdown.setValue(settings().defaultType);
              dropdown.onChange((value: string) => {
                settings().defaultType = value as AICommentType;
                this.markDirty();
              });
            });
          },
        },
        languageRow(
          'Output language',
          'Language for AI responses. "auto" matches the content language (e.g., Korean content → Korean summary)',
          () => settings().outputLanguage,
          (value) => { settings().outputLanguage = value; },
        ),
        languageRow(
          'Tag language',
          'Language for AI-suggested tags. "auto" matches the content language (e.g., Korean content → Korean tags)',
          () => settings().tagLanguage,
          (value) => { settings().tagLanguage = value; },
        ),
        {
          ...this.blockRow('Platform visibility', (host) => {
            this.renderPlatformVisibilitySettings(host);
          }),
          visible: available,
        },
        {
          ...this.blockRow('Vault context', (host) => {
            this.renderVaultContextSettings(host);
          }),
          visible: available,
        },
      ],
    }];
  }

  /**
   * Author section — avatar/metadata capture plus the author-notes feature.
   *
   * The author-notes rows are gated by two nested toggles. They render
   * unconditionally and are shown or hidden live by their parent toggle, rather
   * than via `visible` predicates: a `visible: false` row is never rendered at
   * all, so there would be no element left to reveal without a full re-render.
   * This matches what the imperative version did with its container divs.
   *
   * Row order differs from the imperative version, which created the
   * author-notes container before the toggle that controls it and so rendered
   * the dependent rows *above* "Enable author notes". Here each control
   * precedes what it gates.
   */
  private authorSettingDefinitions(): SettingDefinitionItem[] {
    const gated: { el: HTMLElement; when: () => boolean }[] = [];
    const refreshGated = (): void => {
      for (const { el, when } of gated) el.toggle(when());
    };
    const notesEnabled = (): boolean => this.plugin.settings.enableAuthorNotes;
    const linksEnabled = (): boolean =>
      notesEnabled() && this.plugin.settings.enableAuthorNoteLinks === true;

    /** Renders always; parent toggles reveal or hide it without a re-render. */
    const gate = (when: () => boolean, item: SettingDefinitionRender): SettingGroupItem => ({
      ...item,
      render: (setting, group): void => {
        item.render(setting, group);
        gated.push({ el: setting.settingEl, when });
        setting.settingEl.toggle(when());
      },
    });

    const avatarToggle = (
      name: string,
      desc: string,
      get: () => boolean,
      set: (value: boolean) => void,
    ): SettingGroupItem => ({
      name,
      desc,
      render: (setting): void => {
        setting.addToggle(toggle => toggle
          .setValue(get())
          .onChange((value) => {
            set(value);
            this.markDirty();
          }));
      },
    });

    return [{
      type: 'group',
      heading: 'Author',
      items: [
        avatarToggle(
          'Download author avatars',
          'Save author profile images locally for offline access. Avatars are stored in the media folder under "authors".',
          () => this.plugin.settings.downloadAuthorAvatars,
          (value) => { this.plugin.settings.downloadAuthorAvatars = value; },
        ),
        avatarToggle(
          'Update author metadata',
          'Track author statistics (followers, posts count, bio) on each archive. Useful for author catalog insights.',
          () => this.plugin.settings.updateAuthorMetadata,
          (value) => { this.plugin.settings.updateAuthorMetadata = value; },
        ),
        avatarToggle(
          'Overwrite existing avatars',
          'Replace local avatar file when a new URL is provided. When disabled, existing avatars are preserved.',
          () => this.plugin.settings.overwriteAuthorAvatar,
          (value) => { this.plugin.settings.overwriteAuthorAvatar = value; },
        ),
        {
          name: 'Enable author notes',
          desc: 'Create vault-native markdown files for each author with profile metadata and space for your notes. Experimental feature.',
          render: (setting): void => {
            setting.addToggle(toggle => toggle
              .setValue(this.plugin.settings.enableAuthorNotes)
              .onChange((value) => {
                this.plugin.settings.enableAuthorNotes = value;
                this.markDirty();
                refreshGated();
              }));
          },
        },
        gate(notesEnabled, {
          name: 'Author notes folder',
          desc: 'Folder where author note files will be created. Default: "Social Authors" (outside the archive folder to avoid scanner conflicts).',
          render: (setting): void => {
            setting.addText(text => {
              text
                .setPlaceholder('Social Authors')
                .setValue(this.plugin.settings.authorNotesPath)
                .onChange((value) => {
                  this.plugin.settings.authorNotesPath = value.trim() || 'Social Authors';
                  this.markDirty();
                });
              new FolderSuggest(this.app, text.inputEl);
            });
          },
        }),
        gate(notesEnabled, {
          name: 'Link archive notes to author notes',
          desc: 'Add an authorNote wikilink to new archive notes so Obsidian backlinks and graph connections are created automatically.',
          render: (setting): void => {
            setting.addToggle((toggle) => toggle
              .setValue(this.plugin.settings.enableAuthorNoteLinks === true)
              .onChange((value) => {
                this.plugin.settings.enableAuthorNoteLinks = value;
                this.markDirty();
                refreshGated();
              }));
          },
        }),
        gate(linksEnabled, {
          name: 'Author link alias',
          desc: 'Template used for the visible wikilink label. Click a token to insert it.',
          aliases: ['wikilink', 'template', 'token'],
          render: (setting): void => {
            setting.settingEl.addClass('st-fn-header-setting');
            const blockEl = setting.settingEl.createDiv();
            blockEl.addClass('st-fn-block');
            const inputRowEl = blockEl.createDiv();
            inputRowEl.addClass('st-fn-input-row');
            const inputEl = inputRowEl.createEl('input', { type: 'text' });
            inputEl.addClass('st-fn-input');
            inputEl.placeholder = DEFAULT_AUTHOR_NOTE_LINK_ALIAS_FORMAT;
            inputEl.value = this.plugin.settings.authorNoteLinkAliasFormat
              || DEFAULT_AUTHOR_NOTE_LINK_ALIAS_FORMAT;

            const previewEl = blockEl.createDiv();
            previewEl.addClass('st-fn-preview');
            const updatePreview = (): void => {
              const alias = renderAuthorNoteLinkAlias(inputEl.value, {
                author: 'Jane Doe',
                displayName: 'Jane',
                handle: '@janedoe',
                platform: 'instagram',
              });
              previewEl.empty();
              const label = previewEl.createSpan({ text: 'Preview: ' });
              label.addClass('st-fn-preview-label');
              previewEl.createEl('code', { text: `[[Social Authors/instagram-janedoe|${alias}]]` });
            };

            inputEl.addEventListener('input', () => {
              this.plugin.settings.authorNoteLinkAliasFormat = inputEl.value
                || DEFAULT_AUTHOR_NOTE_LINK_ALIAS_FORMAT;
              this.markDirty();
              updatePreview();
            });

            const resetBtn = inputRowEl.createDiv({
              cls: 'clickable-icon',
              attr: { 'aria-label': 'Reset to default' },
            });
            resetBtn.title = 'Reset to default';
            setIcon(resetBtn, 'rotate-ccw');
            resetBtn.addEventListener('click', (event) => {
              event.preventDefault();
              inputEl.value = DEFAULT_AUTHOR_NOTE_LINK_ALIAS_FORMAT;
              this.plugin.settings.authorNoteLinkAliasFormat = DEFAULT_AUTHOR_NOTE_LINK_ALIAS_FORMAT;
              this.markDirty();
              updatePreview();
            });

            const chipsEl = blockEl.createDiv();
            chipsEl.addClass('st-fn-chips');
            const tokens = [
              { token: 'author', label: 'Author' },
              { token: 'display_name', label: 'Display name' },
              { token: 'handle', label: 'Handle' },
              { token: 'platform', label: 'Platform' },
            ];
            for (const { token, label } of tokens) {
              const chip = chipsEl.createEl('button', { text: label });
              chip.addClass('st-fn-chip');
              chip.title = `Insert {${token}}`;
              chip.addEventListener('click', (event) => {
                event.preventDefault();
                const start = inputEl.selectionStart ?? inputEl.value.length;
                const end = inputEl.selectionEnd ?? start;
                const value = `{${token}}`;
                inputEl.value = inputEl.value.slice(0, start) + value + inputEl.value.slice(end);
                this.plugin.settings.authorNoteLinkAliasFormat = inputEl.value;
                this.markDirty();
                updatePreview();
                const nextPosition = start + value.length;
                inputEl.setSelectionRange(nextPosition, nextPosition);
                inputEl.focus();
              });
            }
            updatePreview();
          },
        }),
        gate(linksEnabled, {
          name: 'Apply author links to existing notes',
          desc: 'Preview and add or update authorNote links across the current archive folder. Other frontmatter and author note bodies are preserved.',
          render: (setting): void => {
            setting.addButton((button) => button
              .setButtonText('Preview & Apply')
              .onClick(async () => {
                button.setDisabled(true).setButtonText('Scanning...');
                try {
                  await this.plugin.saveSettings();
                  const { ArchiveNoteBackfillService } = await import('../services/ArchiveNoteBackfillService');
                  const { AuthorNoteService } = await import('../services/AuthorNoteService');
                  const backfill = new ArchiveNoteBackfillService(this.app, this.plugin.settings.archivePath);
                  const noteService = new AuthorNoteService({
                    app: this.app,
                    getAuthorNotesPath: () => this.plugin.settings.authorNotesPath || 'Social Authors',
                    isEnabled: () => true,
                  });
                  const preview = await backfill.previewAuthorLinks(noteService);
                  const confirmed = await showConfirmModal(this.app, {
                    title: 'Apply author links to existing notes?',
                    message: `Scanned ${preview.scanned} notes and found ${preview.authors} authors across ${preview.eligibleFiles} eligible notes. ${preview.missingAuthorNotes} author notes will be created if needed.`,
                    confirmText: 'Apply links',
                  });
                  if (!confirmed) return;
                  button.setButtonText('Applying...');
                  const result = await backfill.applyAuthorLinks(
                    noteService,
                    this.plugin.settings.authorNoteLinkAliasFormat || DEFAULT_AUTHOR_NOTE_LINK_ALIAS_FORMAT,
                  );
                  new Notice(`Author links: ${result.updated} updated, ${result.unchanged} unchanged, ${result.authorNotesCreated} author notes created, ${result.failed} failed.`);
                } catch (error) {
                  console.error('[Social Archiver] Author link backfill failed:', error);
                  new Notice('Failed to apply author links. Check console for details.');
                } finally {
                  button.setDisabled(false).setButtonText('Preview & Apply');
                }
              }));
          },
        }),
        gate(notesEnabled, {
          name: 'Generate author notes',
          desc: 'Scan your vault and create author note files for all discovered authors. Safe to run multiple times.',
          render: (setting): void => {
            setting.addButton((button) => {
              button.buttonEl.addClass('sa-mobile-compact-btn');
              return button
                .setButtonText('Scan & Generate')
                .setCta()
                .onClick(async () => {
                  button.setDisabled(true);
                  button.setButtonText('Scanning...');

                  try {
                    const { AuthorVaultScanner } = await import('../services/AuthorVaultScanner');
                    const { AuthorDeduplicator } = await import('../services/AuthorDeduplicator');
                    const { AuthorNoteService } = await import('../services/AuthorNoteService');

                    const noteService = new AuthorNoteService({
                      app: this.app,
                      getAuthorNotesPath: () => this.plugin.settings.authorNotesPath || 'Social Authors',
                      isEnabled: () => true,
                    });

                    const scanner = new AuthorVaultScanner({
                      app: this.app,
                      archivePath: this.plugin.settings.archivePath,
                      includeEmbeddedArchives: true,
                    });

                    button.setButtonText('Scanning vault...');
                    const scanResult = await scanner.scanVault();

                    button.setButtonText('Deduplicating...');
                    const deduplicator = new AuthorDeduplicator();
                    const dedupeResult = deduplicator.deduplicate(scanResult.authors, new Map());

                    const authors = dedupeResult.authors;
                    let created = 0;
                    let updated = 0;
                    const BATCH_SIZE = 50;

                    for (let i = 0; i < authors.length; i += BATCH_SIZE) {
                      button.setButtonText(`Processing ${i}/${authors.length}...`);
                      const batch = authors.slice(i, i + BATCH_SIZE);
                      for (const author of batch) {
                        const result = await noteService.upsertFromCatalogEntry(author);
                        if (result) {
                          const data = noteService.readNote(result);
                          if (data && data.archiveCount === author.archiveCount) {
                            created++;
                          } else {
                            updated++;
                          }
                        }
                      }
                      await new Promise<void>(resolve => window.setTimeout(resolve, 0));
                    }

                    new Notice(`Author notes: ${created} created, ${updated} updated (${authors.length} authors total)`);
                    setting.setDesc(`Last scan: ${created} created, ${updated} updated (${authors.length} authors). Safe to run again.`);
                  } catch (err) {
                    console.error('[Social Archiver] Author note generation failed:', err);
                    new Notice('Failed to generate author notes. Check console for details.');
                  } finally {
                    button.setButtonText('Scan & Generate');
                    button.setDisabled(false);
                  }
                });
            });
          },
        }),
      ],
    }];
  }

  /**
   * Transcription section — desktop only, driven by a locally installed
   * Whisper CLI.
   *
   * Several rows re-run detection and repaint the status panel, so the panel's
   * element is captured when its block renders and shared with them.
   */
  private transcriptionSettingDefinitions(): SettingDefinitionItem[] {
    const transcription = (): typeof this.plugin.settings.transcription =>
      this.plugin.settings.transcription;
    const desktop = (): boolean => !Platform.isMobile;

    let statusContainer: HTMLElement | null = null;
    const repaintStatus = async (resetCache: boolean): Promise<void> => {
      if (resetCache) {
        const { WhisperDetector } = await import('../utils/whisper');
        WhisperDetector.resetCache();
      }
      if (!statusContainer) return;
      statusContainer.empty();
      await this.renderWhisperStatus(statusContainer);
    };

    // whisper.cpp uses Metal on Apple Silicon, faster-whisper elsewhere; the
    // recommendation flips accordingly.
    const isAppleSilicon = (): boolean => {
      const os = nodeRequire('os') as typeof import('os');
      return Platform.isDesktop && os.platform() === 'darwin' && os.arch() === 'arm64';
    };

    const dropdownRow = (
      name: string,
      desc: string,
      options: Record<string, string>,
      get: () => string,
      set: (value: string) => void | Promise<void>,
    ): SettingGroupItem => ({
      name,
      desc,
      visible: desktop,
      render: (setting): void => {
        setting.addDropdown(dropdown => {
          dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
          for (const [value, label] of Object.entries(options)) {
            dropdown.addOption(value, label);
          }
          return dropdown
            .setValue(get())
            .onChange(async (value) => { await set(value); });
        });
      },
    });

    return [{
      type: 'group',
      heading: 'Transcription',
      items: [
        {
          ...this.blockRow('Transcription mobile notice', (host) => {
            const mobileNote = host.createDiv({ cls: 'setting-item-description' });
            mobileNote.textContent = 'Transcription is only available on desktop (requires local Whisper CLI)';
            mobileNote.addClass('sa-settings-info');
          }),
          visible: () => Platform.isMobile,
        },
        {
          ...this.blockRow('Whisper status', (host) => {
            statusContainer = host.createDiv({ cls: 'whisper-status-container' });
            statusContainer.addClass('sa-settings-subsection');
            void this.renderWhisperStatus(statusContainer);
          }),
          visible: desktop,
        },
        {
          name: 'Enable Whisper transcription',
          desc: 'Transcribe podcast audio using locally installed Whisper (desktop only)',
          visible: desktop,
          render: (setting): void => {
            setting.addToggle(toggle => toggle
              .setValue(transcription().enabled)
              .onChange((value) => {
                transcription().enabled = value;
                this.markDirty();
              }));
          },
        },
        {
          name: 'Preferred Whisper variant',
          visible: desktop,
          render: (setting): void => {
            const appleSilicon = isAppleSilicon();
            setting.setDesc(appleSilicon
              ? 'Choose which Whisper implementation to use. "Auto-detect" tries whisper.cpp first on Apple Silicon (Metal GPU).'
              : 'Choose which Whisper implementation to use. "Auto-detect" tries faster-whisper first.');
            setting.addDropdown(dropdown => {
              dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
              return dropdown
                .addOption('auto', 'Auto-detect')
                .addOption('faster-whisper', appleSilicon ? 'faster-whisper' : 'faster-whisper (recommended)')
                .addOption('openai-whisper', 'openai-whisper')
                .addOption('whisper.cpp', appleSilicon ? 'whisper.cpp (recommended)' : 'whisper.cpp')
                .setValue(transcription().preferredVariant || 'auto')
                .onChange(async (value) => {
                  transcription().preferredVariant = value as WhisperVariantType;
                  this.markDirty();
                  // Re-detect with new preference and update status display
                  await repaintStatus(false);
                });
            });
          },
        },
        dropdownRow(
          'Preferred model',
          'Larger models are more accurate but slower. Requires more VRAM.',
          {
            tiny: 'Tiny (~1GB VRAM, fastest)',
            base: 'Base (~1GB VRAM)',
            small: 'Small (~2GB VRAM) - recommended',
            medium: 'Medium (~5GB VRAM)',
            large: 'Large (~10GB VRAM, most accurate)',
          },
          () => transcription().preferredModel,
          (value) => {
            transcription().preferredModel = value as 'tiny' | 'base' | 'small' | 'medium' | 'large';
            this.markDirty();
          },
        ),
        dropdownRow(
          'Default language',
          'Auto-detect or select specific language for transcription',
          {
            auto: 'Auto-detect', en: 'English', es: 'Spanish', fr: 'French', de: 'German',
            it: 'Italian', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
            ru: 'Russian', ar: 'Arabic',
          },
          () => transcription().language,
          (value) => {
            transcription().language = value;
            this.markDirty();
          },
        ),
        {
          name: 'Custom Whisper path',
          desc: 'Override automatic detection with a custom binary path (optional)',
          visible: desktop,
          render: (setting): void => {
            setting.addText(text => text
              .setPlaceholder('/path/to/whisper or C:\\path\\to\\whisper.exe')
              .setValue(transcription().customWhisperPath || '')
              .onChange(async (value) => {
                transcription().customWhisperPath = value || undefined;
                this.markDirty();
                await repaintStatus(true);
              }));
          },
        },
        {
          // Force enable covers ARM64/Windows edge cases where detection fails.
          name: 'Force enable custom path',
          desc: 'Skip binary validation when using custom path. Use if detection fails on ARM64, Windows, or other systems.',
          visible: desktop,
          render: (setting): void => {
            setting.addToggle(toggle => toggle
              .setValue(transcription().forceEnableCustomPath ?? false)
              .onChange(async (value) => {
                transcription().forceEnableCustomPath = value;
                this.markDirty();
                await repaintStatus(true);
              }));
          },
        },
        dropdownRow(
          'Batch transcription mode',
          'Transcribe-only: transcribe existing local videos. Download-and-transcribe: also download videos from URLs before transcribing.',
          {
            'transcribe-only': 'Transcribe only',
            'download-and-transcribe': 'Download & transcribe',
          },
          () => transcription().batchMode || 'transcribe-only',
          async (value) => {
            transcription().batchMode = value as 'transcribe-only' | 'download-and-transcribe';
            await this.plugin.saveSettings();
          },
        ),
        {
          name: 'Batch transcribe videos in notes',
          desc: 'Scans notes in your archive folder and transcribes notes with local video attachments where videoTranscribed is not true.',
          visible: desktop,
          render: (setting): void => {
            // Buttons are state-driven: which ones exist depends on the
            // manager's status, so the control area is rebuilt rather than
            // toggled.
            const renderBatchButtons = (): void => {
              setting.controlEl.empty();
              const status = this.plugin.batchTranscriptionManager?.getStatus() ?? 'idle';

              if (status === 'idle' || status === 'completed' || status === 'cancelled') {
                setting.addButton((button) => button
                  .setButtonText('Start')
                  .setCta()
                  .onClick(async () => {
                    const mode = transcription().batchMode || 'transcribe-only';
                    await this.plugin.startBatchTranscription(mode);
                    renderBatchButtons();
                  }));
              } else if (status === 'running' || status === 'scanning') {
                setting.addButton((button) => button
                  .setButtonText('Pause')
                  .onClick(() => {
                    this.plugin.batchTranscriptionManager?.pause();
                    renderBatchButtons();
                  }));
                setting.addButton((button) => button
                  .setButtonText('Cancel')
                  .setWarning()
                  .onClick(() => {
                    this.plugin.batchTranscriptionManager?.cancel();
                    renderBatchButtons();
                  }));
              } else if (status === 'paused') {
                setting.addButton((button) => button
                  .setButtonText('Resume')
                  .setCta()
                  .onClick(async () => {
                    await this.plugin.batchTranscriptionManager?.resume();
                    renderBatchButtons();
                  }));
                setting.addButton((button) => button
                  .setButtonText('Cancel')
                  .setWarning()
                  .onClick(() => {
                    this.plugin.batchTranscriptionManager?.cancel();
                    renderBatchButtons();
                  }));
              }
            };

            renderBatchButtons();

            // Subscribe to manager progress to update buttons in real-time
            if (this.plugin.batchTranscriptionManager) {
              const unsubscribe = this.plugin.batchTranscriptionManager.onProgress(() => {
                renderBatchButtons();
              });
              // Clean up subscription when settings tab is closed
              this.plugin.register(() => unsubscribe());
            }
          },
        },
      ],
    }];
  }

  /**
   * Frontmatter section.
   *
   * The heading, blurb and master toggle live in the tree so they are indexed
   * by settings search; the body stays imperative behind a block — see
   * {@link renderFrontmatterSettings} for why.
   */
  private frontmatterSettingDefinitions(): SettingDefinitionItem[] {
    let refreshBody: (() => void) | null = null;

    return [{
      type: 'group',
      heading: 'Frontmatter',
      items: [
        this.blockRow('Frontmatter description', (host) => {
          const frontmatterDesc = host.createEl('p', {
            text: 'Choose built-in properties and add custom properties for all archived notes.'
          });
          frontmatterDesc.addClass('sa-settings-info');
          frontmatterDesc.setCssProps({ '--st-margin': '0 0 12px 0' });
          frontmatterDesc.addClass('st-margin-custom');
        }),
        {
          name: 'Enable frontmatter customization',
          desc: 'Apply visibility rules and custom properties to newly archived notes.',
          aliases: ['property order', 'custom properties', 'archive tags'],
          render: (setting): void => {
            this.ensureFrontmatterSettings();
            setting.addToggle((toggle) => toggle
              .setValue(this.plugin.settings.frontmatter.enabled)
              .onChange((value) => {
                this.plugin.settings.frontmatter.enabled = value;
                this.markDirty();
                refreshBody?.();
              }));
          },
        },
        this.blockRow('Frontmatter properties', (host) => {
          refreshBody = this.renderFrontmatterSettings(host);
        }),
      ],
    }];
  }

        /** Build the durable one-line last-import summary (PRD S4.8). */
  private formatLocalImportSummary(result: LocalImportLastResult): string {
    const stopReasonCopy: Record<LocalImportLastResult['stopReason'], string> = {
      completed: 'completed',
      quota: 'monthly quota reached',
      error: 'stopped on error',
    };
    return `Last import (${new Date(result.at).toLocaleString()}): `
      + `${result.imported} imported · ${result.duplicates} ${result.duplicates === 1 ? 'duplicate' : 'duplicates'} · `
      + `${result.partialMedia} partial media · ${result.remaining} remaining `
      + `(${stopReasonCopy[result.stopReason]})`;
  }

    /**
   * Render Frontmatter customization settings
   */
  /**
   * Frontmatter body — property order, custom properties and archive tag rules.
   *
   * Kept imperative: this is one stateful widget, not a list of independent
   * rows. It rebuilds its whole list on every reorder/add/delete and draws its
   * own 'Property order' and 'Archive tags' sub-headings inside a container it
   * shows and hides as a unit. Returns the visibility updater so the enable
   * toggle, which lives in the definition tree, can drive it.
   */
  private renderFrontmatterSettings(containerEl: HTMLElement): () => void {
    this.ensureFrontmatterSettings();
    const frontmatterSettings = this.plugin.settings.frontmatter;
    const archiveTagRuleAtOpen = {
      tagRoot: frontmatterSettings.tagRoot || '',
      tagOrganization: frontmatterSettings.tagOrganization || 'flat',
    };
    let archiveTagRuleRemembered = false;
    const rememberArchiveTagRuleAtOpen = (): void => {
      if (archiveTagRuleRemembered) return;
      frontmatterSettings.archiveTagRuleHistory = rememberManagedArchiveTagRule(
        normalizeArchiveTagRuleHistory(frontmatterSettings.archiveTagRuleHistory),
        archiveTagRuleAtOpen,
      );
      archiveTagRuleRemembered = true;
    };
    const syncPropertyOrder = (markAsDirty = false): void => {
      const normalizedOrder = normalizeFrontmatterPropertyOrder(
        frontmatterSettings.propertyOrder,
        frontmatterSettings.customProperties
      );
      if (!this.arraysEqual(frontmatterSettings.propertyOrder || [], normalizedOrder)) {
        frontmatterSettings.propertyOrder = normalizedOrder;
        if (markAsDirty) {
          this.markDirty();
        }
      }
    };
    syncPropertyOrder();

    const bodyContainer = containerEl.createDiv({ cls: 'social-archiver-frontmatter-body' });

    const defaultPropertiesHeaderSetting = new Setting(bodyContainer).setName('Property order').setHeading();
    defaultPropertiesHeaderSetting.settingEl.addClass('sa-text-md', 'sa-font-semibold', 'sa-text-normal', 'st-margin-custom');
    defaultPropertiesHeaderSetting.settingEl.setCssProps({ '--st-margin': '12px 0 8px 0' });
    const defaultPropertiesDesc = bodyContainer.createEl('p', {
      text: 'Reorder rows. Add new rows at the bottom and move them with ↑/↓.',
    });
    defaultPropertiesDesc.addClass('sa-settings-desc-small');

    const categoryDefinitions: Array<{
      key: keyof FrontmatterFieldVisibility;
      name: string;
      desc: string;
      fields: string[];
    }> = [
      {
        key: 'authorDetails',
        name: 'Author Details',
        desc: 'authorHandle, authorAvatar, followers, bio',
        fields: ['authorHandle', 'authorAvatar', 'authorFollowers', 'authorPostsCount', 'authorBio', 'authorVerified'],
      },
      {
        key: 'engagement',
        name: 'Engagement Metrics',
        desc: 'likes, comments, shares, views',
        fields: ['likes', 'comments', 'shares', 'views'],
      },
      {
        key: 'aiAnalysis',
        name: 'AI Analysis',
        desc: 'ai_summary, sentiment, topics',
        fields: ['ai_summary', 'sentiment', 'topics'],
      },
      {
        key: 'externalLinks',
        name: 'External Links',
        desc: 'link metadata and linkPreviews',
        fields: ['externalLink', 'externalLinkTitle', 'externalLinkDescription', 'externalLinkImage', 'linkPreviews'],
      },
      {
        key: 'location',
        name: 'Location',
        desc: 'latitude, longitude, coordinates, location',
        fields: ['latitude', 'longitude', 'coordinates', 'location'],
      },
      {
        key: 'subscription',
        name: 'Subscription Info',
        desc: 'subscribed, subscriptionId',
        fields: ['subscribed', 'subscriptionId'],
      },
      {
        key: 'seriesInfo',
        name: 'Series Info',
        desc: 'series, episode, genre, rating',
        fields: ['series', 'seriesUrl', 'seriesId', 'episode', 'totalEpisodes', 'starScore', 'genre', 'ageRating', 'finished', 'publishDay'],
      },
      {
        key: 'podcastInfo',
        name: 'Podcast Info',
        desc: 'audio fields, season, hosts, guests',
        fields: ['channelTitle', 'audioUrl', 'audioSize', 'audioType', 'season', 'subtitle', 'hosts', 'guests', 'explicit'],
      },
      {
        key: 'reblogInfo',
        name: 'Reblog/Repost',
        desc: 'original author and post references',
        fields: ['isReblog', 'originalAuthor', 'originalAuthorHandle', 'originalAuthorUrl', 'originalPostUrl', 'originalAuthorAvatar'],
      },
      {
        key: 'mediaMetadata',
        name: 'Media Metadata',
        desc: 'expired media and processed URLs',
        fields: ['media_expired', 'media_expired_urls', 'processedUrls'],
      },
      {
        key: 'workflow',
        name: 'Workflow Fields',
        desc: 'share/archive/video download+transcription status fields',
        fields: [
          'share',
          'archive',
          'originalUrl',
          'title',
          'videoId',
          'duration',
          'hasTranscript',
          'hasFormattedTranscript',
          'community',
          'communityUrl',
          'videoDownloaded',
          'videoDownloadFailed',
          'videoDownloadFailedCount',
          'videoDownloadFailedUrls',
          'videoTranscribed',
          'videoTranscriptionRequestedAt',
          'videoTranscriptionError',
          'videoTranscribedAt',
          'download_time',
          'archiveStatus',
          'errorMessage',
        ],
      },
    ];

    const defaultKeySet = new Set(DEFAULT_FRONTMATTER_PROPERTY_ORDER);
    const coreLockedKeySet = new Set<string>(FRONTMATTER_CORE_LOCKED_FIELDS);
    const categoryByField = new Map<string, keyof FrontmatterFieldVisibility>();
    const categoryByKey = new Map<keyof FrontmatterFieldVisibility, typeof categoryDefinitions[number]>();
    for (const category of categoryDefinitions) {
      categoryByKey.set(category.key, category);
      for (const field of category.fields) {
        categoryByField.set(field, category.key);
      }
    }

    const vaultFrontmatterKeys = this.collectVaultFrontmatterKeys();
    const customKeyOptionValue = '__custom__';
    type MixedOrderItem =
      | { kind: 'default'; categoryKey: keyof FrontmatterFieldVisibility }
      | { kind: 'custom'; propertyId: string };

    const buildMixedOrderItems = (): MixedOrderItem[] => {
      syncPropertyOrder();
      const currentOrder = frontmatterSettings.propertyOrder || [];
      const fallbackBase = currentOrder.length + 1000;

      const rankedDefaultItems = categoryDefinitions.map((category, index) => {
        const ranks = category.fields
          .map((field) => currentOrder.indexOf(field))
          .filter((idx) => idx >= 0);
        return {
          kind: 'default' as const,
          categoryKey: category.key,
          rank: ranks.length > 0 ? Math.min(...ranks) : fallbackBase + index,
        };
      });

      const rankedCustomItems = frontmatterSettings.customProperties.map((property, index) => {
        const customKey = String(property.key || '').trim();
        const keyRank = customKey ? currentOrder.indexOf(customKey) : -1;
        return {
          kind: 'custom' as const,
          propertyId: property.id,
          rank: keyRank >= 0 ? keyRank : fallbackBase + categoryDefinitions.length + index,
        };
      });

      return [...rankedDefaultItems, ...rankedCustomItems]
        .sort((a, b) => a.rank - b.rank)
        .map((item) => item.kind === 'default'
          ? { kind: 'default', categoryKey: item.categoryKey }
          : { kind: 'custom', propertyId: item.propertyId });
    };

    let mixedOrderItems: MixedOrderItem[] = buildMixedOrderItems();
    let expandedAliasCategory: keyof FrontmatterFieldVisibility | null = null;

    const syncCustomPropertiesArrayWithOrder = (): boolean => {
      const propertyById = new Map(frontmatterSettings.customProperties.map((property) => [property.id, property]));
      const orderedCustomIds = mixedOrderItems
        .filter((item): item is { kind: 'custom'; propertyId: string } => item.kind === 'custom')
        .map((item) => item.propertyId);

      const orderedCustomProperties = orderedCustomIds
        .map((propertyId) => propertyById.get(propertyId))
        .filter((property): property is CustomFrontmatterProperty => !!property);

      const missingProperties = frontmatterSettings.customProperties.filter(
        (property) => !orderedCustomIds.includes(property.id)
      );
      const nextCustomProperties = [...orderedCustomProperties, ...missingProperties];
      const currentIds = frontmatterSettings.customProperties.map((property) => property.id);
      const nextIds = nextCustomProperties.map((property) => property.id);

      if (this.arraysEqual(currentIds, nextIds)) {
        return false;
      }

      frontmatterSettings.customProperties = nextCustomProperties;
      return true;
    };

    const rebuildPropertyOrderFromMixedOrder = (markAsDirty = true): void => {
      syncPropertyOrder();
      const customOrderChanged = syncCustomPropertiesArrayWithOrder();

      const currentOrder = frontmatterSettings.propertyOrder || [];
      const defaultKeysInOrder = currentOrder.filter((key) => defaultKeySet.has(key));
      const groupedByCategory = new Map<keyof FrontmatterFieldVisibility, string[]>();
      for (const category of categoryDefinitions) {
        groupedByCategory.set(category.key, []);
      }
      const uncategorizedDefaultKeys: string[] = [];

      for (const key of defaultKeysInOrder) {
        const categoryKey = categoryByField.get(key);
        if (!categoryKey) {
          uncategorizedDefaultKeys.push(key);
          continue;
        }
        groupedByCategory.get(categoryKey)?.push(key);
      }

      const propertyById = new Map(frontmatterSettings.customProperties.map((property) => [property.id, property]));
      const orderedKeys: string[] = [...uncategorizedDefaultKeys];

      for (const item of mixedOrderItems) {
        if (item.kind === 'default') {
          orderedKeys.push(...(groupedByCategory.get(item.categoryKey) || []));
          continue;
        }

        const property = propertyById.get(item.propertyId);
        const customKey = String(property?.key || '').trim();
        if (customKey) {
          orderedKeys.push(customKey);
        }
      }

      const nextOrder = normalizeFrontmatterPropertyOrder(
        orderedKeys,
        frontmatterSettings.customProperties
      );

      const orderChanged = !this.arraysEqual(frontmatterSettings.propertyOrder || [], nextOrder);
      if (orderChanged) {
        frontmatterSettings.propertyOrder = nextOrder;
      }

      if (markAsDirty && (orderChanged || customOrderChanged)) {
        this.markDirty();
      }
    };

    const orderListContainer = bodyContainer.createDiv({ cls: 'social-archiver-frontmatter-order-list' });
    orderListContainer.setCssProps({ '--st-margin': '6px 0 10px 0' });
    orderListContainer.addClass('st-margin-custom');

    const styleOrderRow = (setting: Setting, variant: 'default' | 'custom' | 'add'): void => {
      setting.settingEl.addClass('sa-bg-secondary', 'st-order-row');

      if (variant === 'default') {
        setting.settingEl.addClass('st-order-row-default');
        return;
      }
      if (variant === 'custom') {
        setting.settingEl.addClass('st-order-row-custom');
        return;
      }
      setting.settingEl.addClass('st-order-row-add');
    };

    const styleCustomValueRow = (setting: Setting): void => {
      setting.settingEl.addClass('sa-bg-secondary', 'st-order-row-value');
    };

    const moveMixedItem = (fromIndex: number, toIndex: number): void => {
      if (toIndex < 0 || toIndex >= mixedOrderItems.length || fromIndex === toIndex) {
        return;
      }
      [mixedOrderItems[fromIndex], mixedOrderItems[toIndex]] = [mixedOrderItems[toIndex] as typeof mixedOrderItems[0], mixedOrderItems[fromIndex] as typeof mixedOrderItems[0]];
      rebuildPropertyOrderFromMixedOrder();
      renderMixedPropertyRows();
    };

    const renderCustomValueRow = (property: CustomFrontmatterProperty, propertyType: FrontmatterPropertyType): void => {
      if (propertyType === 'checkbox') {
        const valueSetting = new Setting(orderListContainer)
          .setName('Checkbox value')
          .setDesc('Template override has priority. If empty, checkbox value is used.')
          .addToggle((toggle) => toggle
            .setValue(property.checked === true)
            .onChange((value) => {
              property.checked = value;
              this.markDirty();
            }))
          .addText((text) => text
            .setPlaceholder('Optional template override, e.g. {{platform}}')
            .setValue(property.template || '')
            .onChange((value) => {
              property.template = value;
              this.markDirty();
            }));
        styleCustomValueRow(valueSetting);
        return;
      }

      if (propertyType === 'date') {
        const valueSetting = new Setting(orderListContainer)
          .setName('Date value')
          .setDesc('Template override has priority. If empty, date picker value is used.')
          .addText((text) => {
            text
              .setValue(property.dateValue || '')
              .onChange((value) => {
                property.dateValue = value;
                this.markDirty();
              });
            text.inputEl.type = 'date';
          })
          .addText((text) => text
            .setPlaceholder('Optional template override, e.g. {{dates.archived}}')
            .setValue(property.template || '')
            .onChange((value) => {
              property.template = value;
              this.markDirty();
            }));
        styleCustomValueRow(valueSetting);
        return;
      }

      if (propertyType === 'date-time') {
        const valueSetting = new Setting(orderListContainer)
          .setName('Date & time value')
          .setDesc('Template override has priority. If empty, date-time picker value is used.')
          .addText((text) => {
            text
              .setValue(property.dateTimeValue || '')
              .onChange((value) => {
                property.dateTimeValue = value;
                this.markDirty();
              });
            text.inputEl.type = 'datetime-local';
          })
          .addText((text) => text
            .setPlaceholder('Optional template override, e.g. {{dates.archived}}')
            .setValue(property.template || '')
            .onChange((value) => {
              property.template = value;
              this.markDirty();
            }));
        styleCustomValueRow(valueSetting);
        return;
      }

      if (propertyType === 'list') {
        const valueSetting = new Setting(orderListContainer)
          .setName('List value')
          .setDesc('One item per line. Template variables are supported in each line.')
          .addTextArea((text) => {
            text
              .setPlaceholder('first item\nsecond item\n{{platform}}')
              .setValue(property.value || '')
              .onChange((value) => {
                property.value = value;
                this.markDirty();
              });
            text.inputEl.rows = 4;
            text.inputEl.addClass('sa-w-100');
          });
        styleCustomValueRow(valueSetting);
        return;
      }

      const valueSetting = new Setting(orderListContainer)
        .setName(propertyType === 'number' ? 'Number Value' : 'Text Value')
        .setDesc('Template variables are supported.')
        .addText((text) => text
          .setPlaceholder(propertyType === 'number' ? '123 or {{post.id}}' : 'inbox or {{platform}}')
          .setValue(property.value || '')
          .onChange((value) => {
            property.value = value;
            this.markDirty();
          }));
      styleCustomValueRow(valueSetting);
    };

    const renderMixedPropertyRows = (): void => {
      orderListContainer.empty();

      mixedOrderItems = mixedOrderItems.filter((item) => {
        if (item.kind !== 'custom') return true;
        return frontmatterSettings.customProperties.some((property) => property.id === item.propertyId);
      });

      for (let index = 0; index < mixedOrderItems.length; index++) {
        const item = mixedOrderItems[index];
        if (!item) continue;

        if (item.kind === 'default') {
          const category = categoryByKey.get(item.categoryKey);
          if (!category) continue;
          const aliasableFields = category.fields.filter((field) => !coreLockedKeySet.has(field));
          const aliasCount = aliasableFields.filter((field) =>
            !!String(frontmatterSettings.fieldAliases?.[field] || '').trim()
          ).length;

          const defaultSetting = new Setting(orderListContainer)
            .setName(category.name)
            .setDesc(aliasCount > 0 ? `${category.desc} · Aliases: ${aliasCount}` : category.desc)
            .addToggle((toggle) => toggle
              .setValue(frontmatterSettings.fieldVisibility[category.key])
              .onChange((value) => {
                frontmatterSettings.fieldVisibility[category.key] = value;
                this.markDirty();
              }));

          if (aliasableFields.length > 0) {
            defaultSetting.addButton((button) => button
              .setButtonText(expandedAliasCategory === category.key ? `Aliases (${aliasCount})` : `Alias (${aliasCount})`)
              .setTooltip('Edit aliases for keys in this row')
              .onClick(() => {
                expandedAliasCategory = expandedAliasCategory === category.key ? null : category.key;
                renderMixedPropertyRows();
              }));
          }

          defaultSetting
            .addButton((button) => button
              .setButtonText('↑')
              .setDisabled(index === 0)
              .setTooltip('Move this row up')
              .onClick(() => moveMixedItem(index, index - 1)))
            .addButton((button) => button
              .setButtonText('↓')
              .setDisabled(index >= mixedOrderItems.length - 1)
              .setTooltip('Move this row down')
              .onClick(() => moveMixedItem(index, index + 1)));

          styleOrderRow(defaultSetting, 'default');

          if (expandedAliasCategory === category.key && aliasableFields.length > 0) {
            const aliasEditor = orderListContainer.createDiv({ cls: 'social-archiver-frontmatter-alias-editor' });
            aliasEditor.addClass('sa-settings-alias-editor', 'st-alias-editor-expanded');

            const aliasGuide = aliasEditor.createEl('p', {
              text: 'Rename default keys used by this row. Leave empty to keep the original key.',
            });
            aliasGuide.addClass('sa-settings-alias-guide');

            for (const field of aliasableFields) {
              const row = aliasEditor.createDiv();
              row.addClass('sa-settings-alias-row');

              const sourceEl = row.createEl('code', { text: field });
              sourceEl.addClass('sa-settings-alias-source');

              const arrowEl = row.createSpan({ text: '→' });
              arrowEl.addClass('sa-settings-alias-arrow');

              const inputEl = row.createEl('input', { type: 'text' });
              inputEl.value = String(frontmatterSettings.fieldAliases?.[field] || '');
              inputEl.placeholder = `alias for ${field}`;
              inputEl.addClass('sa-settings-alias-input');

              inputEl.addEventListener('change', () => {
                const nextAliases = {
                  ...(frontmatterSettings.fieldAliases || {}),
                };
                const nextValue = inputEl.value.trim();

                if (!nextValue) {
                  Reflect.deleteProperty(nextAliases, field);
                } else {
                  nextAliases[field] = nextValue;
                }

                frontmatterSettings.fieldAliases = normalizeFrontmatterFieldAliases(nextAliases);
                inputEl.value = String(frontmatterSettings.fieldAliases?.[field] || '');
                this.markDirty();
                renderMixedPropertyRows();
              });
            }
          }
          continue;
        }

        const property = frontmatterSettings.customProperties.find((candidate) => candidate.id === item.propertyId);
        if (!property) continue;

        const propertyType: FrontmatterPropertyType = this.normalizeFrontmatterPropertyType(property.type);
        property.type = propertyType;
        const isCustomKey = !vaultFrontmatterKeys.includes(property.key);
        const labelKey = String(property.key || '').trim() || 'Untitled';

        const propertySetting = new Setting(orderListContainer)
          .setName(labelKey)
          .addDropdown((dropdown) => {
            dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
            dropdown.addOption('', 'Select existing key...');
            dropdown.addOption(customKeyOptionValue, 'New key...');
            for (const key of vaultFrontmatterKeys) {
              dropdown.addOption(key, key);
            }
            dropdown.setValue(isCustomKey ? customKeyOptionValue : property.key);
            dropdown.onChange((value) => {
              if (value === customKeyOptionValue) {
                if (vaultFrontmatterKeys.includes(property.key)) {
                  property.key = '';
                }
              } else {
                property.key = value;
              }

              this.markDirty();
              rebuildPropertyOrderFromMixedOrder();
              renderMixedPropertyRows();
            });
          });

        if (isCustomKey) {
          propertySetting.addText((text) => {
            text
              .setPlaceholder('Status')
              .setValue(property.key)
              .onChange((value) => {
                property.key = value;
                propertySetting.setName(String(value || '').trim() || 'Untitled');
                this.markDirty();
                rebuildPropertyOrderFromMixedOrder();
              });
          });
        }

        propertySetting
          .addDropdown((dropdown) => {
            dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
            dropdown
              .addOption('text', 'Text')
              .addOption('number', 'Number')
              .addOption('checkbox', 'Checkbox')
              .addOption('date', 'Date')
              .addOption('date-time', 'Date & time')
              .addOption('list', 'List')
              .setValue(propertyType)
              .onChange((value) => {
                property.type = this.normalizeFrontmatterPropertyType(value);
                this.markDirty();
                renderMixedPropertyRows();
              });
          })
          .addToggle((toggle) => toggle
            .setValue(property.enabled)
            .onChange((value) => {
              property.enabled = value;
              this.markDirty();
            }))
          .addButton((button) => button
            .setButtonText('↑')
            .setDisabled(index === 0)
            .setTooltip('Move this row up')
            .onClick(() => moveMixedItem(index, index - 1)))
          .addButton((button) => button
            .setButtonText('↓')
            .setDisabled(index >= mixedOrderItems.length - 1)
            .setTooltip('Move this row down')
            .onClick(() => moveMixedItem(index, index + 1)))
          .addExtraButton((button) => button
            .setIcon('trash')
            .setTooltip('Remove property')
            .onClick(() => {
              frontmatterSettings.customProperties = frontmatterSettings.customProperties.filter(
                (candidate) => candidate.id !== property.id
              );
              mixedOrderItems = mixedOrderItems.filter(
                (candidate) => candidate.kind !== 'custom' || candidate.propertyId !== property.id
              );
              rebuildPropertyOrderFromMixedOrder();
              renderMixedPropertyRows();
            }));

        styleOrderRow(propertySetting, 'custom');
        renderCustomValueRow(property, propertyType);
      }

      const addRowSetting = new Setting(orderListContainer)
        .setName('Add row')
        .addButton((button) => button
          .setButtonText('+ add row')
          .setTooltip('Add row')
          .onClick(() => {
            const newProperty: CustomFrontmatterProperty = {
              id: this.createFrontmatterPropertyId(),
              key: '',
              type: 'text',
              value: '',
              template: '',
              checked: false,
              dateValue: '',
              dateTimeValue: '',
              enabled: true,
            };
            frontmatterSettings.customProperties.push(newProperty);
            mixedOrderItems.push({ kind: 'custom', propertyId: newProperty.id });
            rebuildPropertyOrderFromMixedOrder();
            renderMixedPropertyRows();
          }));
      styleOrderRow(addRowSetting, 'add');
    };

    rebuildPropertyOrderFromMixedOrder(false);
    renderMixedPropertyRows();

    const variablesNote = bodyContainer.createDiv({
      text: 'Custom property values support these template variables: '
        + '{{platform}}, {{author.name}}, {{author.handle}}, {{author.username}}, {{author.url}}, '
        + '{{post.id}}, {{post.url}}, {{dates.published}}, {{dates.archived}}, {{dates.lastModified}}. '
        + 'Use the dotted form exactly (e.g. {{post.url}}), not the property label. ',
    });
    variablesNote.addClass('sa-settings-desc-small', 'st-margin-custom');
    variablesNote.setCssProps({ '--st-margin': '8px 0 4px 0' });
    // Match the guide locale to Obsidian's UI language (docs exist for en/ko/ja only).
    const obsidianLang = getLanguage().toLowerCase();
    const docsLocale = obsidianLang.startsWith('ko') ? 'ko' : obsidianLang.startsWith('ja') ? 'ja' : 'en';
    const variablesGuideLink = variablesNote.createEl('a', {
      text: 'View guide',
      href: `https://docs.social-archive.org/${docsLocale}/guide/frontmatter-template-variables`,
    });
    variablesGuideLink.setAttr('target', '_blank');
    variablesGuideLink.setAttr('rel', 'noopener');

    const coreLockedNote = bodyContainer.createDiv({
      text: 'Core keys cannot be removed, renamed, or replaced by a custom property with the same name: platform, author, authorUrl, authorNote, published, archived, lastModified, tags, archiveTags.',
    });
    coreLockedNote.addClass('sa-settings-desc-small');
    coreLockedNote.setCssProps({ '--st-margin': '4px 0 12px 0' });
    coreLockedNote.addClass('st-margin-custom');

    const tagSettingsHeaderSetting = new Setting(bodyContainer).setName('Archive tags').setHeading();
    tagSettingsHeaderSetting.settingEl.addClass('sa-text-md', 'sa-font-semibold', 'sa-text-normal', 'st-margin-custom');
    tagSettingsHeaderSetting.settingEl.setCssProps({ '--st-margin': '14px 0 8px 0' });

    new Setting(bodyContainer)
      .setName('Main archive tag')
      .setDesc('Base tag for archived notes. Example: maintag or #maintag. Leave empty to disable auto tags.')
      .addText((text) => text
        .setPlaceholder('Maintag')
        .setValue(frontmatterSettings.tagRoot || '')
        .onChange((value) => {
          rememberArchiveTagRuleAtOpen();
          frontmatterSettings.tagRoot = value.trim();
          this.markDirty();
        }));

    new Setting(bodyContainer)
      .setName('Tag structure')
      .setDesc('Choose how the auto tag is generated from the main tag.')
      .addDropdown((dropdown) => {
        dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
        return dropdown
          .addOption('flat', '#maintag')
          .addOption('platform-only', '#maintag/socialnetwork')
          .addOption('platform-year-month', '#maintag/socialnetwork/year/month')
          .setValue(frontmatterSettings.tagOrganization || 'flat')
          .onChange((value: string) => {
            rememberArchiveTagRuleAtOpen();
            frontmatterSettings.tagOrganization = value as ArchiveOrganizationMode;
            this.markDirty();
          });
      });

    new Setting(bodyContainer)
      .setName('Apply main tag to existing notes')
      .setDesc('Preview and replace only known plugin-managed main tags in the current archive folder. Unrelated tags and archiveTags are preserved.')
      .addButton((button) => button
        .setButtonText('Preview & Apply')
        .onClick(async () => {
          button.setDisabled(true).setButtonText('Scanning...');
          try {
            await this.plugin.saveSettings();
            const { ArchiveNoteBackfillService } = await import('../services/ArchiveNoteBackfillService');
            const service = new ArchiveNoteBackfillService(this.app, this.plugin.settings.archivePath);
            const options = {
              currentRule: {
                tagRoot: frontmatterSettings.tagRoot || '',
                tagOrganization: frontmatterSettings.tagOrganization || 'flat',
              },
              history: normalizeArchiveTagRuleHistory(frontmatterSettings.archiveTagRuleHistory),
            };
            const preview = await service.previewMainTag(options);
            const confirmed = await showConfirmModal(this.app, {
              title: 'Apply main tag to existing notes?',
              message: `Scanned ${preview.scanned} notes. ${preview.updated} will change, ${preview.unchanged} are already current, and ${preview.skipped} will be skipped.`,
              confirmText: 'Apply tag rule',
            });
            if (!confirmed) return;
            button.setButtonText('Applying...');
            const result = await service.applyMainTag(options);
            new Notice(`Main tag: ${result.updated} updated, ${result.unchanged} unchanged, ${result.skipped} skipped, ${result.failed} failed.`);
          } catch (error) {
            console.error('[Social Archiver] Main tag backfill failed:', error);
            new Notice('Failed to apply the main tag. Check console for details.');
          } finally {
            button.setDisabled(false).setButtonText('Preview & Apply');
          }
        }));

    new Setting(bodyContainer)
      .setName('Mirror archive tags to Obsidian tags')
      .setDesc('Also write Social Archiver archive tags into the native frontmatter tags field. Existing Obsidian tags are preserved.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.mirrorArchiveTagsToObsidianTags)
        .onChange(async (value) => {
          this.plugin.settings.mirrorArchiveTagsToObsidianTags = value;
          await this.plugin.saveSettings();

          if (value) {
            const count = await this.plugin.tagStore?.mirrorArchiveTagsToObsidianTagsForAllPosts();
            new Notice(`Mirrored archive tags to Obsidian tags in ${count ?? 0} note${count === 1 ? '' : 's'}.`);
          }
        }));

    new Setting(bodyContainer)
      .setName('Reset frontmatter settings')
      .setDesc('Reset property order, custom rows, visibility toggles, and archive tag settings.')
      .addButton((button) => button
        .setButtonText('Reset all')
        .setWarning()
        .onClick(() => {
          rememberArchiveTagRuleAtOpen();
          this.plugin.settings.frontmatter = {
            ...DEFAULT_FRONTMATTER_CUSTOMIZATION_SETTINGS,
            fieldVisibility: { ...DEFAULT_FRONTMATTER_CUSTOMIZATION_SETTINGS.fieldVisibility },
            customProperties: [],
            fieldAliases: {},
            propertyOrder: [...DEFAULT_FRONTMATTER_PROPERTY_ORDER],
            tagRoot: '',
            tagOrganization: DEFAULT_FRONTMATTER_CUSTOMIZATION_SETTINGS.tagOrganization,
            archiveTagRuleHistory: frontmatterSettings.archiveTagRuleHistory || [],
          };
          this.markDirty();
          this.display();
        }));

    const updateVisibility = (): void => {
      if (frontmatterSettings.enabled) {
        bodyContainer.removeClass('sa-hidden');
      } else {
        bodyContainer.addClass('sa-hidden');
      }
    };
    updateVisibility();
    return updateVisibility;
  }

  /**
   * Render Whisper installation status
   */
  private async renderWhisperStatus(container: HTMLElement): Promise<void> {
    if (Platform.isMobile) {
      const mobileNote = container.createDiv({
        cls: 'setting-item-description'
      });
      mobileNote.textContent = 'ⓘ transcription is only available on desktop';
      mobileNote.addClass('sa-settings-info');
      return;
    }

    // Show loading state
    const loadingEl = container.createDiv({
      text: 'Detecting Whisper installation...',
      cls: 'setting-item-description'
    });
    loadingEl.addClass('sa-text-muted');

    try {
      const { WhisperDetector } = await import('../utils/whisper');
      const preferredVariant = this.plugin.settings.transcription?.preferredVariant || 'auto';
      const customPath = this.plugin.settings.transcription?.customWhisperPath;
      const forceEnable = this.plugin.settings.transcription?.forceEnableCustomPath ?? false;
      const detection = await WhisperDetector.detect(
        preferredVariant,
        customPath,
        forceEnable
      );

      // Clear container and show result
      container.empty();

      if (detection.available && detection.variant && detection.path) {
        const statusEl = container.createDiv({
          cls: 'setting-item-description'
        });
        // Indicate if using custom path
        const isUsingCustomPath = customPath && detection.path.includes(customPath.replace(/\//g, '\\').split('\\').pop() || '');
        statusEl.textContent = `✓ Detected: ${detection.variant}${isUsingCustomPath ? ' (custom path)' : ''}`;
        statusEl.addClass('sa-status-success');

        // Show path
        const pathEl = container.createDiv({
          cls: 'setting-item-description'
        });
        pathEl.textContent = `  Path: ${detection.path}`;
        pathEl.addClass('sa-status-path');

        // Show version if available
        if (detection.version && detection.version !== 'unknown') {
          const versionEl = container.createDiv({
            cls: 'setting-item-description'
          });
          versionEl.textContent = `  Version: ${detection.version}`;
          versionEl.addClass('sa-status-version');
        }

        // Show installed models
        if (detection.installedModels.length > 0) {
          const modelsEl = container.createDiv({
            cls: 'setting-item-description'
          });
          modelsEl.textContent = `  Models: ${detection.installedModels.join(', ')}`;
          modelsEl.addClass('sa-status-models');
        }
      } else {
        const statusEl = container.createDiv({
          cls: 'setting-item-description'
        });
        statusEl.textContent = '✗ Whisper not detected';
        statusEl.addClass('sa-status-error');

        // Show specific hint if custom path was set but failed
        if (customPath) {
          const customPathHintEl = container.createDiv({
            cls: 'setting-item-description'
          });
          customPathHintEl.textContent = `⚠ Custom path could not be validated: ${customPath}`;
          customPathHintEl.addClass('sa-status-warning', 'sa-text-sm', 'sa-mt-4');

          const checkHintEl = container.createDiv({
            cls: 'setting-item-description'
          });
          checkHintEl.textContent = 'Please verify the file exists and is a valid Whisper binary.';
          checkHintEl.addClass('sa-status-path');
        } else {
          const hintEl = container.createDiv({
            cls: 'setting-item-description'
          });
          hintEl.textContent = 'Install faster-whisper: pip install faster-whisper';
          hintEl.addClass('sa-settings-hint');
        }
      }
    } catch {
      container.empty();
      const errorEl = container.createDiv({
        cls: 'setting-item-description'
      });
      errorEl.textContent = '⚠ Could not detect Whisper';
      errorEl.addClass('sa-status-warning');
    }
  }

    /**
   * Render Reddit Sync Settings section
   */
  private renderRedditSettings(containerEl: HTMLElement): void {
    // Section Header with Reddit icon
    new Setting(containerEl).setName('Reddit sync').setHeading()
      .settingEl.addClass('sa-settings-section-header');

    // Description
    const redditDesc = containerEl.createEl('p', {
      text: 'Automatically sync your Reddit saved posts to your vault. Requires connecting your Reddit account.'
    });
    redditDesc.addClass('sa-settings-info');

    // Connection status display
    const statusContainer = containerEl.createDiv({ cls: 'reddit-status-container' });
    statusContainer.addClass('sa-settings-subsection');
    this.renderRedditConnectionStatus(statusContainer);

    // Connect/Disconnect button
    const connectSetting = new Setting(containerEl)
      .setName('Reddit account')
      .setDesc(this.plugin.settings.redditConnected
        ? `Connected as u/${this.plugin.settings.redditUsername}`
        : 'Connect your Reddit account to enable sync');

    if (this.plugin.settings.redditConnected) {
      connectSetting.addButton(button => {
        button.buttonEl.addClass('sa-mobile-compact-btn');
        return button
          .setButtonText('Disconnect')
          .setWarning()
          .onClick(async () => {
            await this.disconnectReddit();
            // Refresh the settings display
            this.display();
          });
      });
    } else {
      connectSetting.addButton(button => {
        button.buttonEl.addClass('sa-mobile-compact-btn');
        return button
          .setButtonText('Connect Reddit')
          .setCta()
          .onClick(async () => {
            await this.connectReddit();
          });
      });
    }

    // Sync settings (only shown when connected)
    if (this.plugin.settings.redditConnected) {
      // Enable sync toggle
      new Setting(containerEl)
        .setName('Enable automatic sync')
        .setDesc('Automatically sync saved posts on a schedule')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.redditSyncEnabled)
          .onChange((value) => {
            this.plugin.settings.redditSyncEnabled = value;
            this.markDirty();
          }));

      // Sync folder
      new Setting(containerEl)
        .setName('Sync folder')
        .setDesc('Folder where synced Reddit posts will be saved')
        .addText(text => {
          text
            .setPlaceholder('Social archives/Reddit saved')
            .setValue(this.plugin.settings.redditSyncFolder)
            .onChange((value) => {
              this.plugin.settings.redditSyncFolder = value || 'Social Archives/Reddit Saved';
              this.markDirty();
            });

          // Add folder suggestions
          new FolderSuggest(this.app, text.inputEl);
        });

      // Manual sync button
      new Setting(containerEl)
        .setName('Sync now')
        .setDesc('Manually trigger a sync of your Reddit saved posts')
        .addButton(button => {
          button.buttonEl.addClass('sa-mobile-compact-btn');
          return button
            .setButtonText('Sync now')
            .onClick(async () => {
              button.setDisabled(true);
              button.setButtonText('Syncing...');
              try {
                // TODO: Implement actual sync trigger when Reddit API is approved
                // For now, show a notice
                new Notice('Reddit sync coming soon! Waiting for API approval.');
              } catch (error) {
                new Notice(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
              } finally {
                button.setDisabled(false);
                button.setButtonText('Sync now');
              }
            });
        });
    }

    // Info callout
    const infoDiv = containerEl.createDiv({ cls: 'setting-info' });
    infoDiv.addClass('sa-settings-info-box', 'sa-mt-16');
    infoDiv.createEl('strong', { text: 'About Reddit sync' });
    const ul = infoDiv.createEl('ul');
    ul.addClass('sa-settings-info-list');
    ul.createEl('li', { text: 'Syncs posts you\'ve saved on Reddit' });
    ul.createEl('li', { text: 'Requires Reddit OAuth authentication' });
    ul.createEl('li', { text: 'Runs automatically once per day when enabled' });
    ul.createEl('li', { text: 'Only new saved posts are synced (deduplication)' });
  }

  /**
   * Render Reddit connection status
   */
  private renderRedditConnectionStatus(container: HTMLElement): void {
    const statusEl = container.createDiv({ cls: 'reddit-connection-status' });
    statusEl.addClass('sa-settings-status-item');

    if (this.plugin.settings.redditConnected) {
      // Connected status
      const iconEl = statusEl.createSpan({ text: '✓' });
      iconEl.addClass('sa-text-success', 'sa-font-semibold');

      const textEl = statusEl.createSpan();
      textEl.textContent = 'Connected as ';
      const strong = textEl.createEl('strong', { text: `u/${this.plugin.settings.redditUsername}` });
      strong.addClass('st-reddit-username');
    } else {
      // Not connected status
      const iconEl = statusEl.createSpan({ text: '○' });
      iconEl.addClass('sa-text-muted');

      const textEl = statusEl.createSpan({ text: 'Not connected' });
      textEl.addClass('sa-text-muted');
    }
  }

  /**
   * Connect Reddit account via OAuth
   */
  private async connectReddit(): Promise<void> {
    try {
      // Check if user is authenticated with Social Archiver
      if (!this.plugin.settings.authToken) {
        new Notice('Please sign in to Social Archiver first');
        return;
      }

      // TODO: Implement actual OAuth flow when Reddit API is approved
      // For now, show a notice that this is coming soon
      new Notice('Reddit OAuth coming soon! Waiting for API approval.');

      // When API is ready, the flow will be:
      // 1. Call /api/reddit/oauth/init to get authorization URL
      // 2. Open URL in browser (user authorizes on Reddit)
      // 3. Callback redirects to share-web success page
      // 4. Success page redirects back to Obsidian via deep link
      // 5. Plugin receives OAuth confirmation and updates settings

    } catch (error) {
      new Notice(`Failed to connect Reddit: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Disconnect Reddit account
   */
  private async disconnectReddit(): Promise<void> {
    try {
      // TODO: Call /api/reddit/oauth/disconnect when API is approved
      // For now, just clear local settings
      this.plugin.settings.redditConnected = false;
      this.plugin.settings.redditUsername = '';
      this.plugin.settings.redditSyncEnabled = false;
      await this.plugin.saveSettings();

      new Notice('Reddit account disconnected');
    } catch (error) {
      new Notice(`Failed to disconnect: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

      /**
   * Render AI Tools detection status
   */
  private async renderAIToolsStatus(container: HTMLElement): Promise<void> {
    const loadingEl = container.createDiv({
      text: 'Detecting AI tools...',
      cls: 'setting-item-description'
    });
    loadingEl.addClass('sa-text-muted');

    try {
      const detectedClis = await this.getDetectedClis();
      container.empty();

      const statusGrid = container.createDiv({ cls: 'ai-tools-grid' });
      statusGrid.addClass('sa-settings-status-grid');

      for (const cli of (['claude', 'gemini', 'codex'] as AICli[])) {
        const info = AI_CLI_INFO[cli];
        const result = detectedClis.get(cli);
        const isDetected = result?.available ?? false;

        const itemEl = statusGrid.createDiv({ cls: 'ai-tool-status-item' });
        itemEl.addClass('sa-settings-status-item');

        const icon = itemEl.createSpan();
        icon.textContent = isDetected ? '✓' : '✗';
        if (isDetected) {
          icon.addClass('sa-text-success', 'sa-font-semibold');
        } else {
          icon.addClass('sa-text-muted');
        }

        const nameEl = itemEl.createSpan({ text: info.displayName });
        if (isDetected) {
          nameEl.addClass('sa-text-normal');
        } else {
          nameEl.addClass('sa-text-muted');
        }

        if (isDetected && result?.version) {
          const versionEl = itemEl.createSpan({ text: `v${result.version}` });
          versionEl.addClass('sa-text-faint', 'sa-text-xs', 'sa-ml-auto');
        }

        if (!isDetected) {
          itemEl.addClass('sa-clickable');
          itemEl.title = `Click to learn how to install ${info.displayName}`;
          itemEl.onclick = () => window.open(info.installUrl, '_blank');
        }
      }

      // Refresh button
      const refreshBtn = container.createEl('button', { text: 'Refresh detection' });
      refreshBtn.addClass('sa-refresh-btn');
      refreshBtn.onclick = async () => {
        AICliDetector.resetCache();
        await this.renderAIToolsStatus(container);
      };
    } catch {
      container.empty();
      const errorEl = container.createDiv({
        cls: 'setting-item-description'
      });
      errorEl.textContent = '⚠ could not detect AI tools';
      errorEl.addClass('sa-status-warning');
    }
  }

  /**
   * Get detected AI CLIs
   */
  private async getDetectedClis(): Promise<Map<AICli, AICliDetectionResult>> {
    try {
      return await AICliDetector.detectAll();
    } catch {
      return new Map();
    }
  }

  /**
   * Render Platform Visibility settings (collapsible)
   */
  private renderPlatformVisibilitySettings(containerEl: HTMLElement): void {
    const settings = this.plugin.settings.aiComment;

    // Collapsible header
    const headerEl = containerEl.createDiv({ cls: 'setting-item' });
    headerEl.addClass('sa-settings-collapsible-header');

    const headerInfo = headerEl.createDiv({ cls: 'setting-item-info' });
    const headerName = headerInfo.createDiv({ cls: 'setting-item-name', text: '▶ Platform visibility' });
    headerInfo.createDiv({
      cls: 'setting-item-description',
      text: 'Choose which platform types show AI comment banners'
    });

    const contentEl = containerEl.createDiv({ cls: 'platform-visibility-content' });
    contentEl.addClass('sa-settings-collapsible-content');

    let isExpanded = false;
    headerEl.onclick = () => {
      isExpanded = !isExpanded;
      headerName.textContent = isExpanded ? '▼ Platform visibility' : '▶ Platform visibility';
      if (isExpanded) {
        contentEl.addClass('st-collapsible-visible');
        contentEl.removeClass('sa-hidden');
      } else {
        contentEl.addClass('sa-hidden');
      }
    };

    // Category toggles
    new Setting(contentEl)
      .setName('Social media')
      .setDesc('Facebook, Instagram, X, Threads, LinkedIn, TikTok, Bluesky, Mastodon, Reddit, Pinterest, Tumblr')
      .addToggle(toggle => toggle
        .setValue(settings.platformVisibility.socialMedia)
        .onChange((value) => {
          this.plugin.settings.aiComment.platformVisibility.socialMedia = value;
          this.markDirty();
        }));

    new Setting(contentEl)
      .setName('Blog & news')
      .setDesc('Blog, Substack, Medium, Velog')
      .addToggle(toggle => toggle
        .setValue(settings.platformVisibility.blogNews)
        .onChange((value) => {
          this.plugin.settings.aiComment.platformVisibility.blogNews = value;
          this.markDirty();
        }));

    new Setting(contentEl)
      .setName('Video & audio')
      .setDesc('YouTube, Podcast')
      .addToggle(toggle => toggle
        .setValue(settings.platformVisibility.videoAudio)
        .onChange((value) => {
          this.plugin.settings.aiComment.platformVisibility.videoAudio = value;
          this.markDirty();
        }));

    // Excluded platforms
    const excludedPlatforms = settings.platformVisibility.excludedPlatforms || [];
    const excludeEl = contentEl.createDiv({ cls: 'excluded-platforms' });
    excludeEl.addClass('sa-mt-12');

    const excludeHeader = excludeEl.createDiv({
      cls: 'setting-item-name',
      text: 'Excluded platforms'
    });
    excludeHeader.addClass('sa-mb-8');

    const allPlatforms = [
      ...SOCIAL_MEDIA_PLATFORMS,
      ...BLOG_NEWS_PLATFORMS,
      ...VIDEO_AUDIO_PLATFORMS,
    ] as SocialPlatform[];

    const platformGrid = excludeEl.createDiv();
    platformGrid.addClass('sa-settings-platform-grid');

    for (const platform of allPlatforms) {
      const isExcluded = excludedPlatforms.includes(platform);
      const label = platformGrid.createEl('label');
      label.addClass('sa-settings-platform-label');

      const checkbox = label.createEl('input', { type: 'checkbox' });
      checkbox.checked = isExcluded;
      checkbox.onchange = () => {
        const excluded = this.plugin.settings.aiComment.platformVisibility.excludedPlatforms;
        if (checkbox.checked) {
          if (!excluded.includes(platform)) {
            excluded.push(platform);
          }
        } else {
          const idx = excluded.indexOf(platform);
          if (idx !== -1) {
            excluded.splice(idx, 1);
          }
        }
        this.markDirty();
      };

      label.createSpan({ text: getPlatformDefinition(platform).displayName });
    }
  }

  /**
   * Render Vault Context settings (collapsible)
   */
  private renderVaultContextSettings(containerEl: HTMLElement): void {
    const settings = this.plugin.settings.aiComment;

    // Collapsible header
    const headerEl = containerEl.createDiv({ cls: 'setting-item' });
    headerEl.addClass('sa-settings-collapsible-header');

    const headerInfo = headerEl.createDiv({ cls: 'setting-item-info' });
    const headerName = headerInfo.createDiv({ cls: 'setting-item-name', text: '▶ Vault context (connections)' });
    headerInfo.createDiv({
      cls: 'setting-item-description',
      text: 'Configure how AI finds connections to your notes'
    });

    const contentEl = containerEl.createDiv({ cls: 'vault-context-content' });
    contentEl.addClass('sa-settings-collapsible-content');

    let isExpanded = false;
    headerEl.onclick = () => {
      isExpanded = !isExpanded;
      headerName.textContent = isExpanded ? '▼ Vault context (connections)' : '▶ Vault context (connections)';
      if (isExpanded) {
        contentEl.addClass('st-collapsible-visible');
        contentEl.removeClass('sa-hidden');
      } else {
        contentEl.addClass('sa-hidden');
      }
    };

    // Enable vault context
    new Setting(contentEl)
      .setName('Enable vault context')
      .setDesc('Allow AI to scan your vault for related notes when using "connections" comment type')
      .addToggle(toggle => toggle
        .setValue(settings.vaultContext.enabled)
        .onChange((value) => {
          this.plugin.settings.aiComment.vaultContext.enabled = value;
          this.markDirty();
        }));

    // Smart filtering
    new Setting(contentEl)
      .setName('Smart filtering')
      .setDesc('Use keyword matching to select only relevant notes for context')
      .addToggle(toggle => toggle
        .setValue(settings.vaultContext.smartFiltering)
        .onChange((value) => {
          this.plugin.settings.aiComment.vaultContext.smartFiltering = value;
          this.markDirty();
        }));

    // Max context notes
    new Setting(contentEl)
      .setName('Max context notes')
      .setDesc('Maximum number of notes to include in AI context')
      .addText(text => text
        .setPlaceholder('10')
        .setValue(String(settings.vaultContext.maxContextNotes || 10))
        .onChange((value) => {
          const num = parseInt(value) || 10;
          this.plugin.settings.aiComment.vaultContext.maxContextNotes = Math.max(1, Math.min(50, num));
          this.markDirty();
        }));

    // Exclude paths - with folder suggester
    const excludeSetting = new Setting(contentEl)
      .setName('Exclude folders')
      .setDesc('Select folders to exclude from context scanning');

    const inputEl = activeWindow.createEl('input');
    inputEl.type = 'text';
    inputEl.placeholder = 'Select folder...';
    inputEl.classList.add('sa-input-w-150');

    new FolderSuggest(this.app, inputEl);
    excludeSetting.controlEl.appendChild(inputEl);

    // Folder list below
    const folderListEl = contentEl.createDiv({ cls: 'exclude-folders-list' });
    folderListEl.classList.add('sa-settings-tag-list');

    const createFolderItem = (folderPath: string): HTMLElement => {
      const itemEl = activeWindow.createDiv();
      itemEl.className = 'exclude-folder-item';
      itemEl.classList.add('sa-settings-tag-item');

      const pathSpan = activeWindow.createSpan();
      pathSpan.textContent = folderPath;
      itemEl.appendChild(pathSpan);

      const removeBtn = activeWindow.createEl('button');
      removeBtn.textContent = '×';
      removeBtn.classList.add('sa-settings-tag-remove');
      removeBtn.onclick = () => {
        this.plugin.settings.aiComment.vaultContext.excludePaths =
          this.plugin.settings.aiComment.vaultContext.excludePaths.filter(p => p !== folderPath);
        itemEl.remove();
        this.markDirty();
      };
      itemEl.appendChild(removeBtn);

      return itemEl;
    };

    // Initial render
    const excludePaths = this.plugin.settings.aiComment.vaultContext.excludePaths || [];
    for (const folderPath of excludePaths) {
      folderListEl.appendChild(createFolderItem(folderPath));
    }

    // Auto-add when folder is selected from suggester
    inputEl.addEventListener('input', () => {
      const folderPath = inputEl.value.trim();
      const folder = this.app.vault.getAbstractFileByPath(folderPath);
      if (folder && 'children' in folder && !this.plugin.settings.aiComment.vaultContext.excludePaths.includes(folderPath)) {
        this.plugin.settings.aiComment.vaultContext.excludePaths.push(folderPath);
        folderListEl.appendChild(createFolderItem(folderPath));
        inputEl.value = '';
        this.markDirty();
      }
    });
  }

  // ---------- TTS Settings ----------

  hide(): void {
    // Save settings if changed
    if (this.settingsDirty) {
      void this.plugin.saveSettings();
      this.settingsDirty = false;
    }
    // Clean up Svelte components when settings are closed
    this.cleanupComponents();
  }
}
