import { App, getLanguage, Notice, PluginSettingTab, Setting, Platform, setIcon } from 'obsidian';
import type { SettingDefinitionItem, SettingDefinitionRender, SettingGroupItem } from 'obsidian';
import { islandHost, renderSettingDefinitions } from './settingDefinitionRenderer';
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
import { t } from '../i18n';
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
import { ACCOUNT_SECTION_CLS, focusAccountSection } from '../utils/accountGate';
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
          text: t('st.tab.desc')
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
      default: t('st.view.useDefault'),
      sidebar: t('st.view.rightSidebar'),
      main: t('st.view.mainTab'),
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
      heading: t('st.view.heading'),
      items: [
        {
          name: t('st.view.defaultLocation.name'),
          desc: t('st.view.defaultLocation.desc'),
          render: (setting): void => {
            setting.addDropdown(dropdown => {
              dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
              return dropdown
                .addOption('sidebar', t('st.view.rightSidebar'))
                .addOption('main', t('st.view.mainTab'))
                .setValue(this.plugin.settings.viewLocationDefault)
                .onChange((value) => {
                  this.plugin.settings.viewLocationDefault = value as 'sidebar' | 'main';
                  this.markDirty();
                });
            });
          },
        },
        overrideRow(
          t('st.view.timeline.name'),
          t('st.view.timeline.desc'),
          () => this.plugin.settings.timelineLocation,
          (value) => { this.plugin.settings.timelineLocation = value; },
        ),
        overrideRow(
          t('st.view.authorDetail.name'),
          t('st.view.authorDetail.desc'),
          () => this.plugin.settings.authorDetailLocation,
          (value) => { this.plugin.settings.authorDetailLocation = value; },
        ),
        {
          name: t('st.view.defaultSort.name'),
          desc: t('st.view.defaultSort.desc'),
          render: (setting): void => {
            setting.addDropdown(dropdown => {
              dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
              return dropdown
                .addOption('archived', t('st.view.sortArchived'))
                .addOption('published', t('st.view.sortPublished'))
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
      heading: t('st.igImport.heading'),
      items: [{
        name: t('st.igImport.enable.name'),
        desc: Platform.isMobile
          ? t('st.igImport.enable.descMobile')
          : t('st.igImport.enable.descDesktop'),
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
      heading: t('st.archive.heading'),
      items: [
        {
          name: t('st.archive.keepFailed.name'),
          desc: t('st.archive.keepFailed.desc'),
          render: (setting): void => {
            let loadedPreference = false;
            let retainFailedArchiveAttempts = false;

            setting.addToggle(toggle => {
              toggle.setDisabled(true);

              if (!this.plugin.settings.authToken) {
                setting.setDesc(t('st.archive.keepFailed.signIn'));
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
                      ? t('st.archive.keepFailed.loadFailed', { message: error.message })
                      : t('st.archive.keepFailed.loadFailedGeneric')
                  );
                });

              return toggle;
            });
          },
        },
        {
          name: t('st.archive.placeSearch.name'),
          desc: t('st.archive.placeSearch.desc'),
          render: (setting): void => {
            const controller = new MapSearchProviderPreferenceController(
              this.plugin.workersApiClient,
              () => getLanguage() || window.navigator.language,
            );

            setting.addDropdown(dropdown => {
              dropdown
                .addOption('auto', t('st.archive.placeSearch.auto'))
                .addOption('kakaomap', 'Kakao Maps')
                .addOption('googlemaps', 'Google Maps')
                .setValue('auto')
                .setDisabled(true);

              if (!this.plugin.settings.authToken) {
                setting.setDesc(t('st.archive.placeSearch.signIn'));
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
                      ? t('st.archive.placeSearch.loadFailed', { message: error.message })
                      : t('st.archive.placeSearch.loadFailedGeneric')
                  );
                });

              return dropdown;
            });
          },
        },
        {
          name: t('st.archive.folder.name'),
          desc: t('st.archive.folder.desc'),
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
          name: t('st.archive.structure.name'),
          desc: t('st.archive.structure.desc'),
          render: (setting): void => {
            setting.addDropdown(dropdown => {
              dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
              return dropdown
                .addOption('platform-year-month', t('st.archive.structure.platformYearMonth'))
                .addOption('platform-only', t('st.archive.structure.platformOnly'))
                .addOption('flat', t('st.archive.structure.flat'))
                .setValue(this.plugin.settings.archiveOrganization)
                .onChange((value: string) => {
                  this.plugin.settings.archiveOrganization = value as ArchiveOrganizationMode;
                  this.markDirty();
                });
            });
          },
        },
        {
          name: t('st.archive.mediaFolder.name'),
          desc: t('st.archive.mediaFolder.desc'),
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
          name: t('st.archive.filename.name'),
          desc: t('st.archive.filename.desc'),
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
            const resetBtn = inputRowEl.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': t('st.common.resetToDefault') } });
            resetBtn.title = t('st.common.resetToDefault');
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
              { token: 'published_date', label: t('st.token.date') },
              { token: 'archived_date', label: t('st.token.archived') },
              { token: 'platform', label: t('st.token.platform') },
              { token: 'author', label: t('st.token.author') },
              { token: 'title', label: t('st.token.title') },
              { token: 'slug', label: t('st.token.slug') },
              { token: 'post_id', label: t('st.token.postId') },
              { token: 'short_id', label: t('st.token.shortId') },
            ];

            for (const { token, label } of tokenDefs) {
              const chip = chipsEl.createEl('button', { text: label });
              chip.addClass('st-fn-chip');
              chip.title = t('st.common.insertToken', { token: `{${token}}` });
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
              const label = previewEl.createSpan({ text: t('st.common.preview') });
              label.addClass('st-fn-preview-label');
              previewEl.createEl('code', { text: `${preview}.md` });
            };

            updateFilenamePreview(this.plugin.settings.fileNameFormat);
          },
        },
        {
          name: t('st.archive.downloadMedia.name'),
          desc: t('st.archive.downloadMedia.desc'),
          render: (setting): void => {
            setting.addDropdown(dropdown => {
              dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
              return dropdown
                .addOption('text-only', t('st.archive.downloadMedia.textOnly'))
                .addOption('images-only', t('st.archive.downloadMedia.imagesOnly'))
                .addOption('images-and-videos', t('st.archive.downloadMedia.imagesAndVideos'))
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
          name: t('st.archive.largeVideo.name'),
          desc: t('st.archive.largeVideo.desc'),
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
          name: t('st.archive.includeComments.name'),
          desc: t('st.archive.includeComments.desc'),
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
          name: t('st.archive.hashtags.name'),
          desc: t('st.archive.hashtags.desc'),
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
      name: t('st.signedOut.name'),
      desc: description,
      visible: () => !isAuthenticated(this.plugin),
      render: (setting): void => {
        setting.addButton(button => button
          .setButtonText(t('st.signedOut.button'))
          .setCta()
          .onClick(() => {
            focusAccountSection(this.containerEl);
          }));
      },
    };
  }

  /** Mobile sync section — account-bound (PRD S2.3), body is a Svelte island. */
  private mobileSyncSettingDefinitions(): SettingDefinitionItem[] {
    return [{
      type: 'group',
      heading: t('st.mobileSync.heading'),
      items: [
        this.signedOutRow(t('st.signedOut.desc.sync')),
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
      heading: t('st.crossPost.heading'),
      items: [
        this.signedOutRow(t('st.signedOut.desc.crosspost')),
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
      heading: t('st.updates.heading'),
      items: [
        {
          name: t('st.updates.releaseNotes.name'),
          desc: t('st.updates.releaseNotes.desc'),
          render: (setting): void => {
            setting.addButton(button => button
              .setButtonText(t('st.updates.releaseNotes.button'))
              .onClick(() => {
                window.open(RELEASE_NOTES_URL, '_blank');
              }));
          },
        },
        {
          name: t('st.updates.showAfterUpdate.name'),
          desc: t('st.updates.showAfterUpdate.desc'),
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
      heading: t('st.support.heading'),
      items: [
      this.blockRow('Support divider', (host) => {
        const supportDivider = host.createDiv({ cls: 'social-archiver-support-divider' });
        supportDivider.addClass('st-sup-divider');
      }),
      {
        name: t('st.support.about.name'),
        desc: t('st.support.about.desc'),
        render: (setting): void => {
          setting.addButton((button) => {
            button.buttonEl.addClass('sa-mobile-compact-btn');
            return button
              .setIcon('github')
              .setButtonText(t('st.support.about.button'))
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
        build(islandHost(setting));
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
      desc: t('st.naver.cookieRow.desc', { name }),
      render: (setting): void => {
        setting.addText((text) => {
          text
            .setPlaceholder(t('st.naver.cookieRow.placeholder', { name }))
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
            text: t('st.naver.desc')
          });
          naverDesc.addClass('sa-settings-info');
        }),
        {
          name: t('st.naver.cookie.name'),
          desc: createFragment((frag) => {
            frag.appendText(t('st.naver.cookie.line1'));
            frag.createEl('br');
            frag.appendText(t('st.naver.cookie.line2'));
            frag.createEl('br');
            frag.createEl('br');
            const link = frag.createEl('a', {
              text: t('st.naver.cookie.link'),
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
          small.createEl('strong', { text: t('st.naver.tip.label') });
          small.appendChild(activeDocument.createTextNode(t('st.naver.tip.text')));
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
      heading: t('st.webtoon.heading'),
      items: [
        this.blockRow('Streaming mode explainer', (host) => {
          const infoDiv = host.createDiv({ cls: 'setting-info' });
          infoDiv.addClass('sa-settings-info-box');
          infoDiv.createEl('strong', { text: t('st.webtoon.info.strong') });
          infoDiv.appendChild(activeDocument.createTextNode(t('st.webtoon.info.text')));
          const ul = infoDiv.createEl('ul');
          ul.addClass('sa-settings-info-list');
          ul.createEl('li', { text: t('st.webtoon.info.li1') });
          ul.createEl('li', { text: t('st.webtoon.info.li2') });
          ul.createEl('li', { text: t('st.webtoon.info.li3') });
        }),
        {
          name: t('st.webtoon.loadingMode.name'),
          desc: t('st.webtoon.loadingMode.desc'),
          render: (setting): void => {
            setting.addDropdown(dropdown => {
              dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
              return dropdown
                .addOption('stream-first', t('st.webtoon.streamFirst'))
                .addOption('download-first', t('st.webtoon.downloadFirst'))
                .setValue(this.plugin.settings.webtoonStreaming?.viewMode || 'stream-first')
                .onChange((value) => {
                  streaming().viewMode = value as 'stream-first' | 'download-first';
                  this.markDirty();
                });
            });
          },
        },
        toggleRow(
          t('st.webtoon.bgDownload.name'),
          t('st.webtoon.bgDownload.desc'),
          () => this.plugin.settings.webtoonStreaming?.backgroundDownload !== false,
          (value) => { streaming().backgroundDownload = value; },
        ),
        toggleRow(
          t('st.webtoon.prefetch.name'),
          t('st.webtoon.prefetch.desc'),
          () => this.plugin.settings.webtoonStreaming?.prefetchNextEpisode !== false,
          (value) => { streaming().prefetchNextEpisode = value; },
        ),
        {
          ...toggleRow(
            t('st.webtoon.dataSaver.name'),
            t('st.webtoon.dataSaver.desc'),
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
    const countLabel = (): string => (count() === 1 ? t('st.local.countOne') : t('st.local.countOther', { count: count() }));

    return [{
      type: 'group',
      heading: t('st.local.heading'),
      items: [
        {
          name: t('st.local.inVault.name'),
          visible: () => !isAuthenticated(this.plugin),
          render: (setting): void => {
            setting
              .setName(t('st.local.inVault', { countLabel: countLabel() }))
              .setDesc(count() > 0
                ? t('st.local.inVault.signIn')
                : t('st.local.inVault.clipsLocal'));
          },
        },
        {
          name: t('st.local.import.name'),
          visible: () => isAuthenticated(this.plugin) && count() > 0,
          render: (setting): void => {
            setting.setName(t('st.local.notImported', { countLabel: countLabel() }));
            setting.addButton(button => button
              .setButtonText(t('st.local.import.button'))
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
      name: t('st.local.autoUpload.name'),
      render: (setting): void => {
        const authenticated = isAuthenticated(this.plugin);
        const paid = isPaidPlan(this.plugin);

        setting.setDesc(
          !authenticated
            ? t('st.local.autoUpload.signIn')
            : paid
              ? t('st.local.autoUpload.paid')
              : t('st.local.autoUpload.free')
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
      heading: t('st.share.heading'),
      items: [
        this.signedOutRow(t('st.signedOut.desc.share')),
        {
          name: t('st.share.mode.name'),
          desc: t('st.share.mode.desc'),
          visible: signedIn,
          render: (setting): void => {
            setting.addDropdown(dropdown => {
              dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
              return dropdown
                .addOption('preview', t('st.share.mode.preview'))
                .addOption('full', t('st.share.mode.full'))
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
          name: t('st.share.readerLink.name'),
          desc: t('st.share.readerLink.desc'),
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
          name: t('st.share.previewLength.name'),
          desc: t('st.share.previewLength.desc'),
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
   * The island owns its own layout, so the row is emptied and restyled as a
   * block ({@link islandHost}) and the component mounts inside it — never next
   * to it, because Obsidian 1.13's renderer re-parents its tracked settingEls
   * after every pass and drops outside nodes. The returned cleanup thunk
   * unmounts on 1.13+; `cleanupComponents()` covers the pre-1.13 path, where
   * display() rebuilds the whole tab.
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
        this[key] = mountInto(islandHost(setting));
        return () => this.unmountComponent(key);
      },
    };
  }

  /** Account section — sign-in state and plan, rendered by AuthSettingsTab. */
  private accountSettingDefinitions(): SettingDefinitionItem[] {
    return [{
      type: 'group',
      heading: t('st.account.heading'),
      items: [
        this.svelteIslandRow('Account', 'authComponent', (host) => {
          const authContainer = host.createDiv({ cls: ACCOUNT_SECTION_CLS });
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
        name: t('st.shellNotice.name'),
        desc: t('st.shellNotice.desc'),
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
      note.textContent = t('st.tts.license');
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
      heading: t('st.tts.heading'),
      items: [
        {
          name: t('st.tts.provider.name'),
          desc: t('st.tts.provider.desc'),
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
                .addOption('azure', t('st.tts.provider.azure'))
                .addOption('supertonic', t('st.tts.provider.supertonic'))
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
          // Distinct from the installed-state 'Supertonic engine' row below:
          // sibling defs sharing a name collide in Obsidian 1.13's keyed
          // reconciler (console error + rows swapping identity on re-render).
          name: t('st.tts.install.name'),
          desc: t('st.tts.install.desc'),
          visible: needsInstall,
          render: (setting): void => {
            const installer = new SupertonicInstaller();
            const installedVersion = installer.getInstalledVersion();
            const targetVersion = installer.getTargetVersion();
            const hasPreviousInstall = Boolean(installedVersion);
            const actionLabel = hasPreviousInstall ? t('st.tts.updateTo', { version: targetVersion }) : t('st.tts.install.button');
            const runningLabel = hasPreviousInstall ? t('st.tts.updating') : t('st.tts.installing');
            const successLabel = hasPreviousInstall ? 'updated' : 'installed';

            setting.setDesc(
              hasPreviousInstall
                ? t('st.tts.install.foundDesc', { installed: installedVersion ?? '', target: targetVersion })
                : t('st.tts.install.notInstalledDesc'),
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
          name: t('st.tts.speed.name'),
          desc: t('st.tts.speed.desc'),
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
          t('st.tts.highlight.name'),
          t('st.tts.highlight.desc'),
          () => tts().highlightEnabled,
          (value) => { tts().highlightEnabled = value; },
        ),
        toggleRow(
          t('st.tts.scroll.name'),
          t('st.tts.scroll.desc'),
          () => tts().scrollSyncEnabled,
          (value) => { tts().scrollSyncEnabled = value; },
        ),
        {
          ...this.blockRow('Azure cloud note', (host) => {
            const azureNote = host.createDiv({ cls: 'setting-item-description' });
            azureNote.textContent = t('st.tts.azureNote');
            azureNote.addClass('sa-settings-info');
          }),
          visible: () => engineReady() && tts().provider === 'azure',
        },
        {
          name: t('st.tts.engine.name'),
          aliases: ['uninstall', 'update'],
          visible: installed,
          render: (setting): void => {
            const installer = new SupertonicInstaller();
            const installedVersion = installer.getInstalledVersion();
            const targetVersion = installer.getTargetVersion();
            const updateAvailable = installer.isUpdateAvailable();

            setting.setDesc(
              updateAvailable
                ? t('st.tts.engine.updateDesc', { installed: installedVersion ?? t('st.tts.versionUnknown'), target: targetVersion })
                : t('st.tts.engine.installedDesc', { installed: installedVersion ?? t('st.tts.versionUnknown') }),
            );

            if (updateAvailable) {
              setting.addButton((button) => {
                button
                  .setButtonText(t('st.tts.updateTo', { version: targetVersion }))
                  .setCta()
                  .onClick(async () => {
                    button.setDisabled(true);
                    button.setButtonText(t('st.tts.updating'));
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
                .setButtonText(t('st.tts.uninstall'))
                .setWarning()
                .onClick(async () => {
                  button.setDisabled(true);
                  button.setButtonText(t('st.tts.uninstalling'));
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
          name: t('st.tts.quality.name'),
          desc: t('st.tts.quality.desc'),
          visible: installed,
          render: (setting): void => {
            setting.addDropdown((dropdown) => {
              dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
              dropdown
                .addOption('fast', t('st.tts.quality.fast'))
                .addOption('balanced', t('st.tts.quality.balanced'))
                .addOption('high', t('st.tts.quality.high'))
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
            resourceNote.textContent = t('st.tts.installPath', { path: new SupertonicInstaller().getInstallPath() });
            resourceNote.addClass('sa-settings-info');
          }),
          visible: installed,
        },
        {
          name: t('st.tts.language.name'),
          desc: t('st.tts.language.desc'),
          visible: engineReady,
          render: (setting): void => {
            setting.addDropdown((dropdown) => {
              dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
              dropdown.addOption('', t('st.common.autoDetect'));
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
      heading: t('st.ai.heading'),
      items: [
        this.signedOutRow(t('st.signedOut.desc.aiComments')),
        {
          ...this.blockRow('AI comments mobile notice', (host) => {
            const mobileNote = host.createDiv({ cls: 'setting-item-description' });
            mobileNote.textContent = t('st.ai.mobileNote');
            mobileNote.addClass('sa-settings-info');
          }),
          visible: () => isAuthenticated(this.plugin) && Platform.isMobile,
        },
        {
          name: t('st.ai.enable.name'),
          desc: t('st.ai.enable.desc'),
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
          name: t('st.ai.defaultTool.name'),
          desc: t('st.ai.defaultTool.desc'),
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
                    : t('st.ai.notInstalled', { name: info.displayName });
                }
              });
            });
          },
        },
        {
          name: t('st.ai.commentType.name'),
          desc: t('st.ai.commentType.desc'),
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
          t('st.ai.outputLang.name'),
          t('st.ai.outputLang.desc'),
          () => settings().outputLanguage,
          (value) => { settings().outputLanguage = value; },
        ),
        languageRow(
          t('st.ai.tagLang.name'),
          t('st.ai.tagLang.desc'),
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
      heading: t('st.author.heading'),
      items: [
        avatarToggle(
          t('st.author.avatars.name'),
          t('st.author.avatars.desc'),
          () => this.plugin.settings.downloadAuthorAvatars,
          (value) => { this.plugin.settings.downloadAuthorAvatars = value; },
        ),
        avatarToggle(
          t('st.author.metadata.name'),
          t('st.author.metadata.desc'),
          () => this.plugin.settings.updateAuthorMetadata,
          (value) => { this.plugin.settings.updateAuthorMetadata = value; },
        ),
        avatarToggle(
          t('st.author.overwrite.name'),
          t('st.author.overwrite.desc'),
          () => this.plugin.settings.overwriteAuthorAvatar,
          (value) => { this.plugin.settings.overwriteAuthorAvatar = value; },
        ),
        {
          name: t('st.author.notes.name'),
          desc: t('st.author.notes.desc'),
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
          name: t('st.author.notesFolder.name'),
          desc: t('st.author.notesFolder.desc'),
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
          name: t('st.author.links.name'),
          desc: t('st.author.links.desc'),
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
          name: t('st.author.alias.name'),
          desc: t('st.author.alias.desc'),
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
              const label = previewEl.createSpan({ text: t('st.common.preview') });
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
              attr: { 'aria-label': t('st.common.resetToDefault') },
            });
            resetBtn.title = t('st.common.resetToDefault');
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
              { token: 'author', label: t('st.token.author') },
              { token: 'display_name', label: t('st.token.displayName') },
              { token: 'handle', label: t('st.token.handle') },
              { token: 'platform', label: t('st.token.platform') },
            ];
            for (const { token, label } of tokens) {
              const chip = chipsEl.createEl('button', { text: label });
              chip.addClass('st-fn-chip');
              chip.title = t('st.common.insertToken', { token: `{${token}}` });
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
          name: t('st.author.backfill.name'),
          desc: t('st.author.backfill.desc'),
          render: (setting): void => {
            setting.addButton((button) => button
              .setButtonText(t('st.common.previewApply'))
              .onClick(async () => {
                button.setDisabled(true).setButtonText(t('st.common.scanning'));
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
                    title: t('st.author.backfill.confirmTitle'),
                    message: t('st.author.backfill.confirmMessage', {
                      scanned: preview.scanned,
                      authors: preview.authors,
                      eligible: preview.eligibleFiles,
                      missing: preview.missingAuthorNotes,
                    }),
                    confirmText: t('st.author.backfill.confirmButton'),
                  });
                  if (!confirmed) return;
                  button.setButtonText(t('st.common.applying'));
                  const result = await backfill.applyAuthorLinks(
                    noteService,
                    this.plugin.settings.authorNoteLinkAliasFormat || DEFAULT_AUTHOR_NOTE_LINK_ALIAS_FORMAT,
                  );
                  new Notice(`Author links: ${result.updated} updated, ${result.unchanged} unchanged, ${result.authorNotesCreated} author notes created, ${result.failed} failed.`);
                } catch (error) {
                  console.error('[Social Archiver] Author link backfill failed:', error);
                  new Notice('Failed to apply author links. Check console for details.');
                } finally {
                  button.setDisabled(false).setButtonText(t('st.common.previewApply'));
                }
              }));
          },
        }),
        gate(notesEnabled, {
          name: t('st.author.generate.name'),
          desc: t('st.author.generate.desc'),
          render: (setting): void => {
            setting.addButton((button) => {
              button.buttonEl.addClass('sa-mobile-compact-btn');
              return button
                .setButtonText(t('st.author.generate.button'))
                .setCta()
                .onClick(async () => {
                  button.setDisabled(true);
                  button.setButtonText(t('st.common.scanning'));

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

                    button.setButtonText(t('st.author.generate.scanningVault'));
                    const scanResult = await scanner.scanVault();

                    button.setButtonText(t('st.author.generate.deduplicating'));
                    const deduplicator = new AuthorDeduplicator();
                    const dedupeResult = deduplicator.deduplicate(scanResult.authors, new Map());

                    const authors = dedupeResult.authors;
                    let created = 0;
                    let updated = 0;
                    const BATCH_SIZE = 50;

                    for (let i = 0; i < authors.length; i += BATCH_SIZE) {
                      button.setButtonText(t('st.author.generate.processing', { current: i, total: authors.length }));
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
                    setting.setDesc(t('st.author.generate.lastScan', { created, updated, total: authors.length }));
                  } catch (err) {
                    console.error('[Social Archiver] Author note generation failed:', err);
                    new Notice('Failed to generate author notes. Check console for details.');
                  } finally {
                    button.setButtonText(t('st.author.generate.button'));
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
      heading: t('st.stt.heading'),
      items: [
        {
          ...this.blockRow('Transcription mobile notice', (host) => {
            const mobileNote = host.createDiv({ cls: 'setting-item-description' });
            mobileNote.textContent = t('st.stt.mobileNote');
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
          name: t('st.stt.enable.name'),
          desc: t('st.stt.enable.desc'),
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
          name: t('st.stt.variant.name'),
          visible: desktop,
          render: (setting): void => {
            const appleSilicon = isAppleSilicon();
            setting.setDesc(appleSilicon
              ? t('st.stt.variant.descApple')
              : t('st.stt.variant.descOther'));
            setting.addDropdown(dropdown => {
              dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
              return dropdown
                .addOption('auto', t('st.common.autoDetect'))
                .addOption('faster-whisper', appleSilicon ? 'faster-whisper' : t('st.common.recommendedSuffix', { name: 'faster-whisper' }))
                .addOption('openai-whisper', 'openai-whisper')
                .addOption('whisper.cpp', appleSilicon ? t('st.common.recommendedSuffix', { name: 'whisper.cpp' }) : 'whisper.cpp')
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
          t('st.stt.model.name'),
          t('st.stt.model.desc'),
          {
            tiny: t('st.stt.model.tiny'),
            base: t('st.stt.model.base'),
            small: t('st.stt.model.small'),
            medium: t('st.stt.model.medium'),
            large: t('st.stt.model.large'),
          },
          () => transcription().preferredModel,
          (value) => {
            transcription().preferredModel = value as 'tiny' | 'base' | 'small' | 'medium' | 'large';
            this.markDirty();
          },
        ),
        dropdownRow(
          t('st.stt.lang.name'),
          t('st.stt.lang.desc'),
          {
            auto: t('st.common.autoDetect'), en: t('st.lang.en'), es: t('st.lang.es'), fr: t('st.lang.fr'), de: t('st.lang.de'),
            it: t('st.lang.it'), pt: t('st.lang.pt'), ja: t('st.lang.ja'), ko: t('st.lang.ko'), zh: t('st.lang.zh'),
            ru: t('st.lang.ru'), ar: t('st.lang.ar'),
          },
          () => transcription().language,
          (value) => {
            transcription().language = value;
            this.markDirty();
          },
        ),
        {
          name: t('st.stt.customPath.name'),
          desc: t('st.stt.customPath.desc'),
          visible: desktop,
          render: (setting): void => {
            setting.addText(text => text
              .setPlaceholder(t('st.stt.customPath.placeholder'))
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
          name: t('st.stt.forcePath.name'),
          desc: t('st.stt.forcePath.desc'),
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
          t('st.stt.batchMode.name'),
          t('st.stt.batchMode.desc'),
          {
            'transcribe-only': t('st.stt.batchMode.transcribeOnly'),
            'download-and-transcribe': t('st.stt.batchMode.downloadAndTranscribe'),
          },
          () => transcription().batchMode || 'transcribe-only',
          async (value) => {
            transcription().batchMode = value as 'transcribe-only' | 'download-and-transcribe';
            await this.plugin.saveSettings();
          },
        ),
        {
          name: t('st.stt.batch.name'),
          desc: t('st.stt.batch.desc'),
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
                  .setButtonText(t('st.common.start'))
                  .setCta()
                  .onClick(async () => {
                    const mode = transcription().batchMode || 'transcribe-only';
                    await this.plugin.startBatchTranscription(mode);
                    renderBatchButtons();
                  }));
              } else if (status === 'running' || status === 'scanning') {
                setting.addButton((button) => button
                  .setButtonText(t('st.common.pause'))
                  .onClick(() => {
                    this.plugin.batchTranscriptionManager?.pause();
                    renderBatchButtons();
                  }));
                setting.addButton((button) => button
                  .setButtonText(t('st.common.cancel'))
                  .setWarning()
                  .onClick(() => {
                    this.plugin.batchTranscriptionManager?.cancel();
                    renderBatchButtons();
                  }));
              } else if (status === 'paused') {
                setting.addButton((button) => button
                  .setButtonText(t('st.common.resume'))
                  .setCta()
                  .onClick(async () => {
                    await this.plugin.batchTranscriptionManager?.resume();
                    renderBatchButtons();
                  }));
                setting.addButton((button) => button
                  .setButtonText(t('st.common.cancel'))
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
      heading: t('st.fm.heading'),
      items: [
        this.blockRow('Frontmatter description', (host) => {
          const frontmatterDesc = host.createEl('p', {
            text: t('st.fm.desc')
          });
          frontmatterDesc.addClass('sa-settings-info');
          frontmatterDesc.setCssProps({ '--st-margin': '0 0 12px 0' });
          frontmatterDesc.addClass('st-margin-custom');
        }),
        {
          name: t('st.fm.enable.name'),
          desc: t('st.fm.enable.desc'),
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
      completed: t('st.local.summary.completed'),
      quota: t('st.local.summary.quota'),
      error: t('st.local.summary.error'),
    };
    return t('st.local.summary', {
      date: new Date(result.at).toLocaleString(),
      imported: result.imported,
      duplicates: result.duplicates,
      duplicateWord: result.duplicates === 1 ? t('st.local.summary.duplicateOne') : t('st.local.summary.duplicateOther'),
      partialMedia: result.partialMedia,
      remaining: result.remaining,
      reason: stopReasonCopy[result.stopReason],
    });
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

    const defaultPropertiesHeaderSetting = new Setting(bodyContainer).setName(t('st.fm.propertyOrder')).setHeading();
    defaultPropertiesHeaderSetting.settingEl.addClass('sa-text-md', 'sa-font-semibold', 'sa-text-normal', 'st-margin-custom');
    defaultPropertiesHeaderSetting.settingEl.setCssProps({ '--st-margin': '12px 0 8px 0' });
    const defaultPropertiesDesc = bodyContainer.createEl('p', {
      text: t('st.fm.reorderHint'),
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
        name: t('st.fm.cat.authorDetails'),
        desc: 'authorHandle, authorAvatar, followers, bio',
        fields: ['authorHandle', 'authorAvatar', 'authorFollowers', 'authorPostsCount', 'authorBio', 'authorVerified'],
      },
      {
        key: 'engagement',
        name: t('st.fm.cat.engagement'),
        desc: 'likes, comments, shares, views',
        fields: ['likes', 'comments', 'shares', 'views'],
      },
      {
        key: 'aiAnalysis',
        name: t('st.fm.cat.aiAnalysis'),
        desc: 'ai_summary, sentiment, topics',
        fields: ['ai_summary', 'sentiment', 'topics'],
      },
      {
        key: 'externalLinks',
        name: t('st.fm.cat.externalLinks'),
        desc: t('st.fm.cat.externalLinks.desc'),
        fields: ['externalLink', 'externalLinkTitle', 'externalLinkDescription', 'externalLinkImage', 'linkPreviews'],
      },
      {
        key: 'location',
        name: t('st.fm.cat.location'),
        desc: 'latitude, longitude, coordinates, location',
        fields: ['latitude', 'longitude', 'coordinates', 'location'],
      },
      {
        key: 'subscription',
        name: t('st.fm.cat.subscription'),
        desc: 'subscribed, subscriptionId',
        fields: ['subscribed', 'subscriptionId'],
      },
      {
        key: 'seriesInfo',
        name: t('st.fm.cat.seriesInfo'),
        desc: t('st.fm.cat.seriesInfo.desc'),
        fields: ['series', 'seriesUrl', 'seriesId', 'episode', 'totalEpisodes', 'starScore', 'genre', 'ageRating', 'finished', 'publishDay'],
      },
      {
        key: 'podcastInfo',
        name: t('st.fm.cat.podcastInfo'),
        desc: t('st.fm.cat.podcastInfo.desc'),
        fields: ['channelTitle', 'audioUrl', 'audioSize', 'audioType', 'season', 'subtitle', 'hosts', 'guests', 'explicit'],
      },
      {
        key: 'reblogInfo',
        name: t('st.fm.cat.reblogInfo'),
        desc: t('st.fm.cat.reblogInfo.desc'),
        fields: ['isReblog', 'originalAuthor', 'originalAuthorHandle', 'originalAuthorUrl', 'originalPostUrl', 'originalAuthorAvatar'],
      },
      {
        key: 'mediaMetadata',
        name: t('st.fm.cat.mediaMetadata'),
        desc: t('st.fm.cat.mediaMetadata.desc'),
        fields: ['media_expired', 'media_expired_urls', 'processedUrls'],
      },
      {
        key: 'workflow',
        name: t('st.fm.cat.workflow'),
        desc: t('st.fm.cat.workflow.desc'),
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
          .setName(t('st.fm.value.checkbox.name'))
          .setDesc(t('st.fm.value.checkbox.desc'))
          .addToggle((toggle) => toggle
            .setValue(property.checked === true)
            .onChange((value) => {
              property.checked = value;
              this.markDirty();
            }))
          .addText((text) => text
            .setPlaceholder(t('st.fm.value.templatePlatform'))
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
          .setName(t('st.fm.value.date.name'))
          .setDesc(t('st.fm.value.date.desc'))
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
            .setPlaceholder(t('st.fm.value.templateDates'))
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
          .setName(t('st.fm.value.dateTime.name'))
          .setDesc(t('st.fm.value.dateTime.desc'))
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
            .setPlaceholder(t('st.fm.value.templateDates'))
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
          .setName(t('st.fm.value.list.name'))
          .setDesc(t('st.fm.value.list.desc'))
          .addTextArea((text) => {
            text
              .setPlaceholder(t('st.fm.value.list.placeholder'))
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
        .setName(propertyType === 'number' ? t('st.fm.value.number.name') : t('st.fm.value.text.name'))
        .setDesc(t('st.fm.value.simple.desc'))
        .addText((text) => text
          .setPlaceholder(propertyType === 'number' ? t('st.fm.value.number.placeholder') : t('st.fm.value.text.placeholder'))
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
            .setDesc(aliasCount > 0 ? t('st.fm.aliasesSuffix', { desc: category.desc, count: aliasCount }) : category.desc)
            .addToggle((toggle) => toggle
              .setValue(frontmatterSettings.fieldVisibility[category.key])
              .onChange((value) => {
                frontmatterSettings.fieldVisibility[category.key] = value;
                this.markDirty();
              }));

          if (aliasableFields.length > 0) {
            defaultSetting.addButton((button) => button
              .setButtonText(expandedAliasCategory === category.key ? t('st.fm.aliasesButton', { count: aliasCount }) : t('st.fm.aliasButton', { count: aliasCount }))
              .setTooltip(t('st.fm.aliasTooltip'))
              .onClick(() => {
                expandedAliasCategory = expandedAliasCategory === category.key ? null : category.key;
                renderMixedPropertyRows();
              }));
          }

          defaultSetting
            .addButton((button) => button
              .setButtonText('↑')
              .setDisabled(index === 0)
              .setTooltip(t('st.fm.moveUp'))
              .onClick(() => moveMixedItem(index, index - 1)))
            .addButton((button) => button
              .setButtonText('↓')
              .setDisabled(index >= mixedOrderItems.length - 1)
              .setTooltip(t('st.fm.moveDown'))
              .onClick(() => moveMixedItem(index, index + 1)));

          styleOrderRow(defaultSetting, 'default');

          if (expandedAliasCategory === category.key && aliasableFields.length > 0) {
            const aliasEditor = orderListContainer.createDiv({ cls: 'social-archiver-frontmatter-alias-editor' });
            aliasEditor.addClass('sa-settings-alias-editor', 'st-alias-editor-expanded');

            const aliasGuide = aliasEditor.createEl('p', {
              text: t('st.fm.aliasGuide'),
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
              inputEl.placeholder = t('st.fm.aliasPlaceholder', { field });
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
        const labelKey = String(property.key || '').trim() || t('st.fm.untitled');

        const propertySetting = new Setting(orderListContainer)
          .setName(labelKey)
          .addDropdown((dropdown) => {
            dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
            dropdown.addOption('', t('st.fm.selectExistingKey'));
            dropdown.addOption(customKeyOptionValue, t('st.fm.newKey'));
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
                propertySetting.setName(String(value || '').trim() || t('st.fm.untitled'));
                this.markDirty();
                rebuildPropertyOrderFromMixedOrder();
              });
          });
        }

        propertySetting
          .addDropdown((dropdown) => {
            dropdown.selectEl.addClass('sa-mobile-compact-dropdown');
            dropdown
              .addOption('text', t('st.fm.type.text'))
              .addOption('number', t('st.fm.type.number'))
              .addOption('checkbox', t('st.fm.type.checkbox'))
              .addOption('date', t('st.fm.type.date'))
              .addOption('date-time', t('st.fm.type.dateTime'))
              .addOption('list', t('st.fm.type.list'))
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
            .setTooltip(t('st.fm.moveUp'))
            .onClick(() => moveMixedItem(index, index - 1)))
          .addButton((button) => button
            .setButtonText('↓')
            .setDisabled(index >= mixedOrderItems.length - 1)
            .setTooltip(t('st.fm.moveDown'))
            .onClick(() => moveMixedItem(index, index + 1)))
          .addExtraButton((button) => button
            .setIcon('trash')
            .setTooltip(t('st.fm.removeProperty'))
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
        .setName(t('st.fm.addRow.name'))
        .addButton((button) => button
          .setButtonText(t('st.fm.addRow.button'))
          .setTooltip(t('st.fm.addRow.name'))
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
      text: t('st.fm.variablesNote'),
    });
    variablesNote.addClass('sa-settings-desc-small', 'st-margin-custom');
    variablesNote.setCssProps({ '--st-margin': '8px 0 4px 0' });
    // Match the guide locale to Obsidian's UI language (docs exist for en/ko/ja only).
    const obsidianLang = getLanguage().toLowerCase();
    const docsLocale = obsidianLang.startsWith('ko') ? 'ko' : obsidianLang.startsWith('ja') ? 'ja' : 'en';
    const variablesGuideLink = variablesNote.createEl('a', {
      text: t('st.fm.viewGuide'),
      href: `https://docs.social-archive.org/${docsLocale}/guide/frontmatter-template-variables`,
    });
    variablesGuideLink.setAttr('target', '_blank');
    variablesGuideLink.setAttr('rel', 'noopener');

    const coreLockedNote = bodyContainer.createDiv({
      text: t('st.fm.coreLockedNote'),
    });
    coreLockedNote.addClass('sa-settings-desc-small');
    coreLockedNote.setCssProps({ '--st-margin': '4px 0 12px 0' });
    coreLockedNote.addClass('st-margin-custom');

    const tagSettingsHeaderSetting = new Setting(bodyContainer).setName(t('st.fm.archiveTags')).setHeading();
    tagSettingsHeaderSetting.settingEl.addClass('sa-text-md', 'sa-font-semibold', 'sa-text-normal', 'st-margin-custom');
    tagSettingsHeaderSetting.settingEl.setCssProps({ '--st-margin': '14px 0 8px 0' });

    new Setting(bodyContainer)
      .setName(t('st.fm.mainTag.name'))
      .setDesc(t('st.fm.mainTag.desc'))
      .addText((text) => text
        .setPlaceholder('Maintag')
        .setValue(frontmatterSettings.tagRoot || '')
        .onChange((value) => {
          rememberArchiveTagRuleAtOpen();
          frontmatterSettings.tagRoot = value.trim();
          this.markDirty();
        }));

    new Setting(bodyContainer)
      .setName(t('st.fm.tagStructure.name'))
      .setDesc(t('st.fm.tagStructure.desc'))
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
      .setName(t('st.fm.applyMainTag.name'))
      .setDesc(t('st.fm.applyMainTag.desc'))
      .addButton((button) => button
        .setButtonText(t('st.common.previewApply'))
        .onClick(async () => {
          button.setDisabled(true).setButtonText(t('st.common.scanning'));
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
              title: t('st.fm.applyMainTag.confirmTitle'),
              message: t('st.fm.applyMainTag.confirmMessage', {
                scanned: preview.scanned,
                updated: preview.updated,
                unchanged: preview.unchanged,
                skipped: preview.skipped,
              }),
              confirmText: t('st.fm.applyMainTag.confirmButton'),
            });
            if (!confirmed) return;
            button.setButtonText(t('st.common.applying'));
            const result = await service.applyMainTag(options);
            new Notice(`Main tag: ${result.updated} updated, ${result.unchanged} unchanged, ${result.skipped} skipped, ${result.failed} failed.`);
          } catch (error) {
            console.error('[Social Archiver] Main tag backfill failed:', error);
            new Notice('Failed to apply the main tag. Check console for details.');
          } finally {
            button.setDisabled(false).setButtonText(t('st.common.previewApply'));
          }
        }));

    new Setting(bodyContainer)
      .setName(t('st.fm.mirror.name'))
      .setDesc(t('st.fm.mirror.desc'))
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
      .setName(t('st.fm.reset.name'))
      .setDesc(t('st.fm.reset.desc'))
      .addButton((button) => button
        .setButtonText(t('st.fm.reset.button'))
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
      mobileNote.textContent = t('st.whisper.mobileOnly');
      mobileNote.addClass('sa-settings-info');
      return;
    }

    // Show loading state
    const loadingEl = container.createDiv({
      text: t('st.whisper.detecting'),
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
        statusEl.textContent = t('st.whisper.detected', { variant: detection.variant }) + (isUsingCustomPath ? t('st.whisper.customPathSuffix') : '');
        statusEl.addClass('sa-status-success');

        // Show path
        const pathEl = container.createDiv({
          cls: 'setting-item-description'
        });
        pathEl.textContent = t('st.whisper.path', { path: detection.path });
        pathEl.addClass('sa-status-path');

        // Show version if available
        if (detection.version && detection.version !== 'unknown') {
          const versionEl = container.createDiv({
            cls: 'setting-item-description'
          });
          versionEl.textContent = t('st.whisper.version', { version: detection.version });
          versionEl.addClass('sa-status-version');
        }

        // Show installed models
        if (detection.installedModels.length > 0) {
          const modelsEl = container.createDiv({
            cls: 'setting-item-description'
          });
          modelsEl.textContent = t('st.whisper.models', { models: detection.installedModels.join(', ') });
          modelsEl.addClass('sa-status-models');
        }
      } else {
        const statusEl = container.createDiv({
          cls: 'setting-item-description'
        });
        statusEl.textContent = t('st.whisper.notDetected');
        statusEl.addClass('sa-status-error');

        // Show specific hint if custom path was set but failed
        if (customPath) {
          const customPathHintEl = container.createDiv({
            cls: 'setting-item-description'
          });
          customPathHintEl.textContent = t('st.whisper.customPathInvalid', { path: customPath });
          customPathHintEl.addClass('sa-status-warning', 'sa-text-sm', 'sa-mt-4');

          const checkHintEl = container.createDiv({
            cls: 'setting-item-description'
          });
          checkHintEl.textContent = t('st.whisper.verifyHint');
          checkHintEl.addClass('sa-status-path');
        } else {
          const hintEl = container.createDiv({
            cls: 'setting-item-description'
          });
          hintEl.textContent = t('st.whisper.installHint');
          hintEl.addClass('sa-settings-hint');
        }
      }
    } catch {
      container.empty();
      const errorEl = container.createDiv({
        cls: 'setting-item-description'
      });
      errorEl.textContent = t('st.whisper.detectError');
      errorEl.addClass('sa-status-warning');
    }
  }

    /**
   * Render Reddit Sync Settings section
   */
  private renderRedditSettings(containerEl: HTMLElement): void {
    // Section Header with Reddit icon
    new Setting(containerEl).setName(t('st.reddit.heading')).setHeading()
      .settingEl.addClass('sa-settings-section-header');

    // Description
    const redditDesc = containerEl.createEl('p', {
      text: t('st.reddit.desc')
    });
    redditDesc.addClass('sa-settings-info');

    // Connection status display
    const statusContainer = containerEl.createDiv({ cls: 'reddit-status-container' });
    statusContainer.addClass('sa-settings-subsection');
    this.renderRedditConnectionStatus(statusContainer);

    // Connect/Disconnect button
    const connectSetting = new Setting(containerEl)
      .setName(t('st.reddit.account.name'))
      .setDesc(this.plugin.settings.redditConnected
        ? t('st.reddit.connectedAs', { username: this.plugin.settings.redditUsername })
        : t('st.reddit.connectDesc'));

    if (this.plugin.settings.redditConnected) {
      connectSetting.addButton(button => {
        button.buttonEl.addClass('sa-mobile-compact-btn');
        return button
          .setButtonText(t('st.reddit.disconnect'))
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
          .setButtonText(t('st.reddit.connect'))
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
        .setName(t('st.reddit.autoSync.name'))
        .setDesc(t('st.reddit.autoSync.desc'))
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.redditSyncEnabled)
          .onChange((value) => {
            this.plugin.settings.redditSyncEnabled = value;
            this.markDirty();
          }));

      // Sync folder
      new Setting(containerEl)
        .setName(t('st.reddit.folder.name'))
        .setDesc(t('st.reddit.folder.desc'))
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
        .setName(t('st.reddit.syncNow.name'))
        .setDesc(t('st.reddit.syncNow.desc'))
        .addButton(button => {
          button.buttonEl.addClass('sa-mobile-compact-btn');
          return button
            .setButtonText(t('st.reddit.syncNow.name'))
            .onClick(async () => {
              button.setDisabled(true);
              button.setButtonText(t('st.reddit.syncing'));
              try {
                // TODO: Implement actual sync trigger when Reddit API is approved
                // For now, show a notice
                new Notice('Reddit sync coming soon! Waiting for API approval.');
              } catch (error) {
                new Notice(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
              } finally {
                button.setDisabled(false);
                button.setButtonText(t('st.reddit.syncNow.name'));
              }
            });
        });
    }

    // Info callout
    const infoDiv = containerEl.createDiv({ cls: 'setting-info' });
    infoDiv.addClass('sa-settings-info-box', 'sa-mt-16');
    infoDiv.createEl('strong', { text: t('st.reddit.about') });
    const ul = infoDiv.createEl('ul');
    ul.addClass('sa-settings-info-list');
    ul.createEl('li', { text: t('st.reddit.about.li1') });
    ul.createEl('li', { text: t('st.reddit.about.li2') });
    ul.createEl('li', { text: t('st.reddit.about.li3') });
    ul.createEl('li', { text: t('st.reddit.about.li4') });
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
      textEl.textContent = t('st.reddit.status.connectedPrefix');
      const strong = textEl.createEl('strong', { text: `u/${this.plugin.settings.redditUsername}` });
      strong.addClass('st-reddit-username');
    } else {
      // Not connected status
      const iconEl = statusEl.createSpan({ text: '○' });
      iconEl.addClass('sa-text-muted');

      const textEl = statusEl.createSpan({ text: t('st.reddit.status.notConnected') });
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
      text: t('st.ai.detecting'),
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
          itemEl.title = t('st.ai.installTooltip', { name: info.displayName });
          itemEl.onclick = () => window.open(info.installUrl, '_blank');
        }
      }

      // Refresh button
      const refreshBtn = container.createEl('button', { text: t('st.ai.refresh') });
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
      errorEl.textContent = t('st.ai.detectError');
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
    const headerName = headerInfo.createDiv({ cls: 'setting-item-name', text: t('st.ai.pv.collapsed') });
    headerInfo.createDiv({
      cls: 'setting-item-description',
      text: t('st.ai.pv.desc')
    });

    const contentEl = containerEl.createDiv({ cls: 'platform-visibility-content' });
    contentEl.addClass('sa-settings-collapsible-content');

    let isExpanded = false;
    headerEl.onclick = () => {
      isExpanded = !isExpanded;
      headerName.textContent = isExpanded ? t('st.ai.pv.expanded') : t('st.ai.pv.collapsed');
      if (isExpanded) {
        contentEl.addClass('st-collapsible-visible');
        contentEl.removeClass('sa-hidden');
      } else {
        contentEl.addClass('sa-hidden');
      }
    };

    // Category toggles
    new Setting(contentEl)
      .setName(t('st.ai.pv.social'))
      .setDesc('Facebook, Instagram, X, Threads, LinkedIn, TikTok, Bluesky, Mastodon, Reddit, Pinterest, Tumblr')
      .addToggle(toggle => toggle
        .setValue(settings.platformVisibility.socialMedia)
        .onChange((value) => {
          this.plugin.settings.aiComment.platformVisibility.socialMedia = value;
          this.markDirty();
        }));

    new Setting(contentEl)
      .setName(t('st.ai.pv.blog'))
      .setDesc('Blog, Substack, Medium, Velog')
      .addToggle(toggle => toggle
        .setValue(settings.platformVisibility.blogNews)
        .onChange((value) => {
          this.plugin.settings.aiComment.platformVisibility.blogNews = value;
          this.markDirty();
        }));

    new Setting(contentEl)
      .setName(t('st.ai.pv.video'))
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
      text: t('st.ai.pv.excluded')
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
    const headerName = headerInfo.createDiv({ cls: 'setting-item-name', text: t('st.ai.vc.collapsed') });
    headerInfo.createDiv({
      cls: 'setting-item-description',
      text: t('st.ai.vc.desc')
    });

    const contentEl = containerEl.createDiv({ cls: 'vault-context-content' });
    contentEl.addClass('sa-settings-collapsible-content');

    let isExpanded = false;
    headerEl.onclick = () => {
      isExpanded = !isExpanded;
      headerName.textContent = isExpanded ? t('st.ai.vc.expanded') : t('st.ai.vc.collapsed');
      if (isExpanded) {
        contentEl.addClass('st-collapsible-visible');
        contentEl.removeClass('sa-hidden');
      } else {
        contentEl.addClass('sa-hidden');
      }
    };

    // Enable vault context
    new Setting(contentEl)
      .setName(t('st.ai.vc.enable.name'))
      .setDesc(t('st.ai.vc.enable.desc'))
      .addToggle(toggle => toggle
        .setValue(settings.vaultContext.enabled)
        .onChange((value) => {
          this.plugin.settings.aiComment.vaultContext.enabled = value;
          this.markDirty();
        }));

    // Smart filtering
    new Setting(contentEl)
      .setName(t('st.ai.vc.smart.name'))
      .setDesc(t('st.ai.vc.smart.desc'))
      .addToggle(toggle => toggle
        .setValue(settings.vaultContext.smartFiltering)
        .onChange((value) => {
          this.plugin.settings.aiComment.vaultContext.smartFiltering = value;
          this.markDirty();
        }));

    // Max context notes
    new Setting(contentEl)
      .setName(t('st.ai.vc.maxNotes.name'))
      .setDesc(t('st.ai.vc.maxNotes.desc'))
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
      .setName(t('st.ai.vc.exclude.name'))
      .setDesc(t('st.ai.vc.exclude.desc'));

    const inputEl = activeWindow.createEl('input');
    inputEl.type = 'text';
    inputEl.placeholder = t('st.ai.vc.selectFolder');
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
