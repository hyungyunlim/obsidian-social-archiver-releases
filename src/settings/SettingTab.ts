import { App, PluginSettingTab, Setting, Platform } from 'obsidian';
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
} from '../types/settings';
import {
  DEFAULT_FRONTMATTER_CUSTOMIZATION_SETTINGS,
  DEFAULT_FRONTMATTER_PROPERTY_ORDER,
  FRONTMATTER_CORE_LOCKED_FIELDS,
  isArchiveOrganizationMode,
  normalizeFrontmatterFieldAliases,
  normalizeFrontmatterPropertyOrder,
} from '../types/settings';
import { mount, unmount } from 'svelte';
import AuthSettingsTab from './AuthSettingsTab.svelte';
import DangerZone from './DangerZone.svelte';
import SyncSettingsTab from './SyncSettingsTab.svelte';
import type { AICli, AICliDetectionResult } from '../utils/ai-cli';
import { AICliDetector, AI_CLI_INFO } from '../utils/ai-cli';
import { COMMENT_TYPE_DISPLAY_NAMES, COMMENT_TYPE_DESCRIPTIONS, OUTPUT_LANGUAGE_NAMES } from '../types/ai-comment';
import type { AICommentType, AIOutputLanguage } from '../types/ai-comment';
import {
  SOCIAL_MEDIA_PLATFORMS,
  BLOG_NEWS_PLATFORMS,
  VIDEO_AUDIO_PLATFORMS,
} from '../shared/platforms/types';
import type { Platform as SocialPlatform } from '../shared/platforms/types';
import { getPlatformDefinition } from '../shared/platforms/definitions';

export class SocialArchiverSettingTab extends PluginSettingTab {
  plugin: SocialArchiverPlugin;
  private authComponent: ReturnType<typeof mount> | null = null;
  private dangerZoneComponent: ReturnType<typeof mount> | null = null;
  private syncSettingsComponent: ReturnType<typeof mount> | null = null;
  private isDisplaying = false;
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

  display(): void {
    // Clean up existing Svelte components synchronously before display
    this.cleanupComponents();
    // Call async display method
    this.displayAsync();
  }

  /**
   * Clean up Svelte components to prevent duplicates
   */
  private cleanupComponents(): void {
    if (this.authComponent) {
      try {
        unmount(this.authComponent);
      } catch {
        // Ignore unmount errors
      }
      this.authComponent = null;
    }
    if (this.dangerZoneComponent) {
      try {
        unmount(this.dangerZoneComponent);
      } catch {
        // Ignore unmount errors
      }
      this.dangerZoneComponent = null;
    }
    if (this.syncSettingsComponent) {
      try {
        unmount(this.syncSettingsComponent);
      } catch {
        // Ignore unmount errors
      }
      this.syncSettingsComponent = null;
    }
  }

  private async displayAsync(): Promise<void> {
    // Prevent concurrent display calls
    if (this.isDisplaying) return;
    this.isDisplaying = true;

    const { containerEl } = this;

    try {
      containerEl.empty();

    // Plugin Title - Largest size
    const titleEl = containerEl.createEl('h1', { text: 'Social Archiver' });
    titleEl.style.cssText = `
      font-size: 28px;
      font-weight: 600;
      margin: 0 0 8px 0;
      color: var(--text-normal);
    `;

    // Plugin Description
    const descEl = containerEl.createEl('p', {
      text: 'Archive and save social media posts to your Obsidian vault'
    });
    descEl.style.cssText = `
      font-size: 14px;
      color: var(--text-muted);
      margin: 0 0 24px 0;
    `;

    // Account Section Header
    const accountHeader = containerEl.createEl('h2', { text: 'Account' });
    accountHeader.style.cssText = `
      font-size: 18px;
      font-weight: 600;
      margin: 16px 0 12px 0;
      color: var(--text-normal);
    `;

    // Account Section (Auth Component)
    const authContainer = containerEl.createDiv({ cls: 'social-archiver-auth-section' });
    authContainer.style.cssText = `
      margin-bottom: 32px;
    `;
    this.authComponent = mount(AuthSettingsTab, {
      target: authContainer,
      props: { plugin: this.plugin }
    });

    // Archive Settings Section
    const archiveHeader = containerEl.createEl('h2', { text: 'Archive Settings' });
    archiveHeader.style.cssText = `
      font-size: 18px;
      font-weight: 600;
      margin: 24px 0 12px 0;
      color: var(--text-normal);
    `;

    new Setting(containerEl)
      .setName('Archive Folder')
      .setDesc('Folder where archived posts will be saved')
      .addText(text => {
        text
          .setPlaceholder('Social Archives')
          .setValue(this.plugin.settings.archivePath)
          .onChange(async (value) => {
            // Set to default if empty
            this.plugin.settings.archivePath = value || 'Social Archives';
            this.markDirty();
          });

        // Add folder suggestions
        new FolderSuggest(this.app, text.inputEl);
      });

    new Setting(containerEl)
      .setName('Archive folder structure')
      .setDesc('Choose how notes are organized under Archive Folder')
      .addDropdown(dropdown => dropdown
        .addOption('platform-year-month', 'ArchiveFolder/Platform/Year/Month')
        .addOption('platform-only', 'ArchiveFolder/Platform')
        .addOption('flat', 'ArchiveFolder only')
        .setValue(this.plugin.settings.archiveOrganization)
        .onChange(async (value: string) => {
          this.plugin.settings.archiveOrganization = value as ArchiveOrganizationMode;
          this.markDirty();
        }));

    new Setting(containerEl)
      .setName('Media Folder')
      .setDesc('Folder where downloaded media files will be saved')
      .addText(text => {
        text
          .setPlaceholder('attachments/social-archives')
          .setValue(this.plugin.settings.mediaPath)
          .onChange(async (value) => {
            // Set to default if empty
            this.plugin.settings.mediaPath = value || 'attachments/social-archives';
            this.markDirty();
          });

        // Add folder suggestions
        new FolderSuggest(this.app, text.inputEl);
      });

    new Setting(containerEl)
      .setName('Download media')
      .setDesc('Choose what media to download with posts. This setting serves as the default for the archive modal.')
      .addDropdown(dropdown => dropdown
        .addOption('text-only', 'Text only')
        .addOption('images-only', 'Images only')
        .addOption('images-and-videos', 'Images and videos')
        .setValue(this.plugin.settings.downloadMedia)
        .onChange(async (value: string) => {
          this.plugin.settings.downloadMedia = value as MediaDownloadMode;
          this.markDirty();
        }));

    new Setting(containerEl)
      .setName('Include comments')
      .setDesc('Include platform comments in archived notes. When disabled, only the post content and your personal notes are saved. This setting serves as the default for the archive modal.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.includeComments)
        .onChange(async (value) => {
          this.plugin.settings.includeComments = value;
          this.markDirty();
        }));

    this.renderFrontmatterSettings(containerEl);

    // Author Profile Management Section
    const authorProfileHeader = containerEl.createEl('h2', { text: 'Author Profile Management' });
    authorProfileHeader.style.cssText = `
      font-size: 18px;
      font-weight: 600;
      margin: 24px 0 12px 0;
      color: var(--text-normal);
    `;

    new Setting(containerEl)
      .setName('Download author avatars')
      .setDesc('Save author profile images locally for offline access. Avatars are stored in the media folder under "authors".')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.downloadAuthorAvatars)
        .onChange(async (value) => {
          this.plugin.settings.downloadAuthorAvatars = value;
          this.markDirty();
        }));

    new Setting(containerEl)
      .setName('Update author metadata')
      .setDesc('Track author statistics (followers, posts count, bio) on each archive. Useful for Author Catalog insights.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.updateAuthorMetadata)
        .onChange(async (value) => {
          this.plugin.settings.updateAuthorMetadata = value;
          this.markDirty();
        }));

    new Setting(containerEl)
      .setName('Overwrite existing avatars')
      .setDesc('Replace local avatar file when a new URL is provided. When disabled, existing avatars are preserved.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.overwriteAuthorAvatar)
        .onChange(async (value) => {
          this.plugin.settings.overwriteAuthorAvatar = value;
          this.markDirty();
        }));

    // Sharing Settings Section
    const sharingHeader = containerEl.createEl('h2', { text: 'Sharing Settings' });
    sharingHeader.style.cssText = `
      font-size: 18px;
      font-weight: 600;
      margin: 24px 0 12px 0;
      color: var(--text-normal);
    `;

    // Share Mode setting
    new Setting(containerEl)
      .setName('Share mode')
      .setDesc('Choose how shared posts appear on the web. "Preview" mode protects copyright by showing only excerpts without media.')
      .addDropdown(dropdown => dropdown
        .addOption('preview', 'Preview (Copyright-safe)')
        .addOption('full', 'Full content (Original)')
        .setValue(this.plugin.settings.shareMode)
        .onChange(async (value: string) => {
          this.plugin.settings.shareMode = value as ShareMode;
          this.markDirty();
          updatePreviewLengthVisibility(); // Update visibility when mode changes
        }));

    // Preview Length setting (conditionally shown based on share mode)
    const previewLengthSetting = new Setting(containerEl)
      .setName('Preview length')
      .setDesc('Maximum character count for text preview in "Preview" mode. Platform link is always included in preview mode.')
      .addText(text => text
        .setPlaceholder('280')
        .setValue(String(this.plugin.settings.sharePreviewLength))
        .onChange(async (value) => {
          const num = parseInt(value) || 280;
          this.plugin.settings.sharePreviewLength = Math.max(100, Math.min(1000, num));
          this.markDirty();
        }));

    // Function to toggle preview length visibility
    const updatePreviewLengthVisibility = () => {
      previewLengthSetting.settingEl.style.display =
        this.plugin.settings.shareMode === 'preview' ? '' : 'none';
    };

    // Set initial visibility
    updatePreviewLengthVisibility();

    // Transcription Settings Section (Desktop Only)
    const transcriptionHeader = containerEl.createEl('h2', { text: 'Transcription Settings' });
    transcriptionHeader.style.cssText = `
      font-size: 18px;
      font-weight: 600;
      margin: 24px 0 12px 0;
      color: var(--text-normal);
    `;

    // Mobile notice - transcription requires local Whisper CLI
    if (Platform.isMobile) {
      const mobileNote = containerEl.createEl('div', {
        cls: 'setting-item-description'
      });
      mobileNote.textContent = 'Transcription is only available on desktop (requires local Whisper CLI)';
      mobileNote.style.cssText = 'color: var(--text-muted); font-size: 13px; margin-bottom: 16px;';
    } else {
    // Whisper status display
    const statusContainer = containerEl.createDiv({ cls: 'whisper-status-container' });
    statusContainer.style.cssText = 'margin-bottom: 16px;';
    this.renderWhisperStatus(statusContainer);

    // Enable transcription toggle
    new Setting(containerEl)
      .setName('Enable Whisper transcription')
      .setDesc('Transcribe podcast audio using locally installed Whisper (Desktop only)')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.transcription.enabled)
        .onChange(async (value) => {
          this.plugin.settings.transcription.enabled = value;
          this.markDirty();
        }));

    // Whisper variant dropdown
    // Check if Apple Silicon for recommended variant
    const os = require('os');
    const isAppleSilicon = Platform.isDesktop && os.platform() === 'darwin' && os.arch() === 'arm64';

    new Setting(containerEl)
      .setName('Preferred Whisper variant')
      .setDesc(isAppleSilicon
        ? 'Choose which Whisper implementation to use. "Auto-detect" tries whisper.cpp first on Apple Silicon (Metal GPU).'
        : 'Choose which Whisper implementation to use. "Auto-detect" tries faster-whisper first.')
      .addDropdown(dropdown => dropdown
        .addOption('auto', 'Auto-detect')
        .addOption('faster-whisper', isAppleSilicon ? 'faster-whisper' : 'faster-whisper (recommended)')
        .addOption('openai-whisper', 'openai-whisper')
        .addOption('whisper.cpp', isAppleSilicon ? 'whisper.cpp (recommended)' : 'whisper.cpp')
        .setValue(this.plugin.settings.transcription.preferredVariant || 'auto')
        .onChange(async (value) => {
          this.plugin.settings.transcription.preferredVariant = value as WhisperVariantType;
          this.markDirty();
          // Re-detect with new preference and update status display
          await this.renderWhisperStatus(statusContainer);
        }));

    // Model dropdown
    new Setting(containerEl)
      .setName('Preferred model')
      .setDesc('Larger models are more accurate but slower. Requires more VRAM.')
      .addDropdown(dropdown => dropdown
        .addOption('tiny', 'Tiny (~1GB VRAM, fastest)')
        .addOption('base', 'Base (~1GB VRAM)')
        .addOption('small', 'Small (~2GB VRAM) - Recommended')
        .addOption('medium', 'Medium (~5GB VRAM)')
        .addOption('large', 'Large (~10GB VRAM, most accurate)')
        .setValue(this.plugin.settings.transcription.preferredModel)
        .onChange(async (value) => {
          this.plugin.settings.transcription.preferredModel = value as 'tiny' | 'base' | 'small' | 'medium' | 'large';
          this.markDirty();
        }));

    // Language dropdown
    new Setting(containerEl)
      .setName('Default language')
      .setDesc('Auto-detect or select specific language for transcription')
      .addDropdown(dropdown => dropdown
        .addOption('auto', 'Auto-detect')
        .addOption('en', 'English')
        .addOption('es', 'Spanish')
        .addOption('fr', 'French')
        .addOption('de', 'German')
        .addOption('it', 'Italian')
        .addOption('pt', 'Portuguese')
        .addOption('ja', 'Japanese')
        .addOption('ko', 'Korean')
        .addOption('zh', 'Chinese')
        .addOption('ru', 'Russian')
        .addOption('ar', 'Arabic')
        .setValue(this.plugin.settings.transcription.language)
        .onChange(async (value) => {
          this.plugin.settings.transcription.language = value;
          this.markDirty();
        }));

    // Custom Whisper path
    const customPathSetting = new Setting(containerEl)
      .setName('Custom Whisper path')
      .setDesc('Override automatic detection with a custom binary path (optional)')
      .addText(text => text
        .setPlaceholder('/path/to/whisper or C:\\path\\to\\whisper.exe')
        .setValue(this.plugin.settings.transcription.customWhisperPath || '')
        .onChange(async (value) => {
          this.plugin.settings.transcription.customWhisperPath = value || undefined;
          this.markDirty();

          // Reset whisper cache when custom path changes
          const { WhisperDetector } = await import('../utils/whisper');
          WhisperDetector.resetCache();

          // Re-render whisper status to reflect the change
          if (statusContainer) {
            statusContainer.empty();
            await this.renderWhisperStatus(statusContainer);
          }
        }));

    // Force Enable option (for ARM64/Windows edge cases)
    new Setting(containerEl)
      .setName('Force enable custom path')
      .setDesc('Skip binary validation when using custom path. Use if detection fails on ARM64, Windows, or other systems.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.transcription.forceEnableCustomPath ?? false)
        .onChange(async (value) => {
          this.plugin.settings.transcription.forceEnableCustomPath = value;
          this.markDirty();

          // Reset whisper cache and re-render status
          const { WhisperDetector } = await import('../utils/whisper');
          WhisperDetector.resetCache();

          if (statusContainer) {
            statusContainer.empty();
            await this.renderWhisperStatus(statusContainer);
          }
        }));

    // Batch mode dropdown
    new Setting(containerEl)
      .setName('Batch transcription mode')
      .setDesc('transcribe-only: transcribe existing local videos. download-and-transcribe: also download videos from URLs before transcribing.')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('transcribe-only', 'Transcribe only')
          .addOption('download-and-transcribe', 'Download & Transcribe')
          .setValue(this.plugin.settings.transcription.batchMode || 'transcribe-only')
          .onChange(async (value) => {
            this.plugin.settings.transcription.batchMode = value as 'transcribe-only' | 'download-and-transcribe';
            await this.plugin.saveSettings();
          });
      });

    // Batch transcription control buttons (state-driven)
    const batchSetting = new Setting(containerEl)
      .setName('Batch transcribe videos in notes')
      .setDesc('Scans notes in your archive folder and transcribes notes with local video attachments where videoTranscribed is not true.');

    const renderBatchButtons = () => {
      batchSetting.controlEl.empty();
      const status = this.plugin.batchTranscriptionManager?.getStatus() ?? 'idle';

      if (status === 'idle' || status === 'completed' || status === 'cancelled') {
        batchSetting.addButton((button) => button
          .setButtonText('Start')
          .setCta()
          .onClick(async () => {
            const mode = this.plugin.settings.transcription.batchMode || 'transcribe-only';
            await this.plugin.startBatchTranscription(mode);
            renderBatchButtons();
          }));
      } else if (status === 'running' || status === 'scanning') {
        batchSetting.addButton((button) => button
          .setButtonText('Pause')
          .onClick(() => {
            this.plugin.batchTranscriptionManager?.pause();
            renderBatchButtons();
          }));
        batchSetting.addButton((button) => button
          .setButtonText('Cancel')
          .setWarning()
          .onClick(() => {
            this.plugin.batchTranscriptionManager?.cancel();
            renderBatchButtons();
          }));
      } else if (status === 'paused') {
        batchSetting.addButton((button) => button
          .setButtonText('Resume')
          .setCta()
          .onClick(async () => {
            await this.plugin.batchTranscriptionManager?.resume();
            renderBatchButtons();
          }));
        batchSetting.addButton((button) => button
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
    } // End of else block for desktop-only transcription settings

    // AI Comment Settings Section (Desktop Only)
    await this.renderAICommentSettings(containerEl);

    // Naver Settings Section
    this.renderNaverSettings(containerEl);

    // Reddit Sync Settings Section (Coming Soon - Waiting for API approval)
    // this.renderRedditSettings(containerEl);

    // Webtoon Streaming Settings Section
    this.renderWebtoonStreamingSettings(containerEl);

    // Mobile Sync Settings Section
    this.renderMobileSyncSettings(containerEl);

    // Update Notifications Section
    this.renderUpdateNotificationsSettings(containerEl);

    // Danger Zone Section (at bottom)
    const dangerZoneContainer = containerEl.createDiv({ cls: 'social-archiver-danger-zone' });
    this.dangerZoneComponent = mount(DangerZone, {
      target: dangerZoneContainer,
      props: { plugin: this.plugin }
    });
    } finally {
      this.isDisplaying = false;
    }
  }

  /**
   * Render Frontmatter customization settings
   */
  private renderFrontmatterSettings(containerEl: HTMLElement): void {
    this.ensureFrontmatterSettings();
    const frontmatterSettings = this.plugin.settings.frontmatter;
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

    const frontmatterHeader = containerEl.createEl('h2', { text: 'Frontmatter' });
    frontmatterHeader.style.cssText = `
      font-size: 18px;
      font-weight: 600;
      margin: 24px 0 12px 0;
      color: var(--text-normal);
    `;

    const frontmatterDesc = containerEl.createEl('p', {
      text: 'Choose built-in properties and add custom properties for all archived notes.'
    });
    frontmatterDesc.style.cssText = `
      font-size: 13px;
      color: var(--text-muted);
      margin: 0 0 12px 0;
    `;

    new Setting(containerEl)
      .setName('Enable frontmatter customization')
      .setDesc('Apply visibility rules and custom properties to newly archived notes.')
      .addToggle((toggle) => toggle
        .setValue(frontmatterSettings.enabled)
        .onChange(async (value) => {
          frontmatterSettings.enabled = value;
          this.markDirty();
          updateVisibility();
        }));

    const bodyContainer = containerEl.createDiv({ cls: 'social-archiver-frontmatter-body' });

    const defaultPropertiesHeader = bodyContainer.createEl('h3', { text: 'Property Order' });
    defaultPropertiesHeader.style.cssText = `
      font-size: 15px;
      font-weight: 600;
      margin: 12px 0 8px 0;
      color: var(--text-normal);
    `;
    const defaultPropertiesDesc = bodyContainer.createEl('p', {
      text: 'Reorder rows. Add new rows at the bottom and move them with ↑/↓.',
    });
    defaultPropertiesDesc.style.cssText = 'font-size: 12px; color: var(--text-muted); margin: 0 0 8px 0;';

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
    const coreLockedKeySet = new Set(FRONTMATTER_CORE_LOCKED_FIELDS);
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
    orderListContainer.style.cssText = `
      margin: 6px 0 10px 0;
    `;

    const styleOrderRow = (setting: Setting, variant: 'default' | 'custom' | 'add'): void => {
      if (variant === 'default') {
        setting.settingEl.style.cssText = `
          border-top: none;
          margin: 0 0 6px 0;
          padding: 10px 12px;
          background: var(--background-secondary);
          border: none;
          border-radius: 10px;
        `;
        return;
      }
      if (variant === 'custom') {
        setting.settingEl.style.cssText = `
          border-top: none;
          margin: 0;
          padding: 10px 12px 8px 12px;
          background: var(--background-secondary);
          border: none;
          border-radius: 10px 10px 0 0;
        `;
        return;
      }
      setting.settingEl.style.cssText = `
        border-top: none;
        margin: 0 0 6px 0;
        padding: 10px 12px;
        background: var(--background-secondary);
        border: none;
        border-radius: 10px;
      `;
    };

    const styleCustomValueRow = (setting: Setting): void => {
      setting.settingEl.style.cssText = `
        border-top: none;
        margin: 0 0 6px 0;
        padding: 0 12px 10px 12px;
        background: var(--background-secondary);
        border: none;
        border-radius: 0 0 10px 10px;
      `;
    };

    const moveMixedItem = (fromIndex: number, toIndex: number): void => {
      if (toIndex < 0 || toIndex >= mixedOrderItems.length || fromIndex === toIndex) {
        return;
      }
      [mixedOrderItems[fromIndex], mixedOrderItems[toIndex]] = [mixedOrderItems[toIndex], mixedOrderItems[fromIndex]];
      rebuildPropertyOrderFromMixedOrder();
      renderMixedPropertyRows();
    };

    const renderCustomValueRow = (property: CustomFrontmatterProperty, propertyType: FrontmatterPropertyType): void => {
      if (propertyType === 'checkbox') {
        const valueSetting = new Setting(orderListContainer)
          .setName('Checkbox Value')
          .setDesc('Template override has priority. If empty, checkbox value is used.')
          .addToggle((toggle) => toggle
            .setValue(property.checked === true)
            .onChange(async (value) => {
              property.checked = value;
              this.markDirty();
            }))
          .addText((text) => text
            .setPlaceholder('Optional template override, e.g. {{platform}}')
            .setValue(property.template || '')
            .onChange(async (value) => {
              property.template = value;
              this.markDirty();
            }));
        styleCustomValueRow(valueSetting);
        return;
      }

      if (propertyType === 'date') {
        const valueSetting = new Setting(orderListContainer)
          .setName('Date Value')
          .setDesc('Template override has priority. If empty, date picker value is used.')
          .addText((text) => {
            text
              .setValue(property.dateValue || '')
              .onChange(async (value) => {
                property.dateValue = value;
                this.markDirty();
              });
            text.inputEl.type = 'date';
          })
          .addText((text) => text
            .setPlaceholder('Optional template override, e.g. {{dates.archived}}')
            .setValue(property.template || '')
            .onChange(async (value) => {
              property.template = value;
              this.markDirty();
            }));
        styleCustomValueRow(valueSetting);
        return;
      }

      if (propertyType === 'date-time') {
        const valueSetting = new Setting(orderListContainer)
          .setName('Date & Time Value')
          .setDesc('Template override has priority. If empty, date-time picker value is used.')
          .addText((text) => {
            text
              .setValue(property.dateTimeValue || '')
              .onChange(async (value) => {
                property.dateTimeValue = value;
                this.markDirty();
              });
            text.inputEl.type = 'datetime-local';
          })
          .addText((text) => text
            .setPlaceholder('Optional template override, e.g. {{dates.archived}}')
            .setValue(property.template || '')
            .onChange(async (value) => {
              property.template = value;
              this.markDirty();
            }));
        styleCustomValueRow(valueSetting);
        return;
      }

      if (propertyType === 'list') {
        const valueSetting = new Setting(orderListContainer)
          .setName('List Value')
          .setDesc('One item per line. Template variables are supported in each line.')
          .addTextArea((text) => {
            text
              .setPlaceholder('first item\nsecond item\n{{platform}}')
              .setValue(property.value || '')
              .onChange(async (value) => {
                property.value = value;
                this.markDirty();
              });
            text.inputEl.rows = 4;
            text.inputEl.style.width = '100%';
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
          .onChange(async (value) => {
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
              .onChange(async (value) => {
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
            aliasEditor.style.cssText = `
              margin: -4px 0 8px 0;
              padding: 8px 12px 10px 12px;
              background: var(--background-secondary);
              border: none;
              border-top: 1px dashed var(--background-modifier-border);
              border-radius: 0 0 10px 10px;
            `;

            const aliasGuide = aliasEditor.createEl('p', {
              text: 'Rename default keys used by this row. Leave empty to keep the original key.',
            });
            aliasGuide.style.cssText = 'font-size: 11px; color: var(--text-muted); margin: 0 0 6px 0;';

            for (const field of aliasableFields) {
              const row = aliasEditor.createDiv();
              row.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-top: 6px;';

              const sourceEl = row.createEl('code', { text: field });
              sourceEl.style.cssText = 'min-width: 130px; font-size: 11px; color: var(--text-normal);';

              const arrowEl = row.createSpan({ text: '→' });
              arrowEl.style.cssText = 'color: var(--text-faint);';

              const inputEl = row.createEl('input', { type: 'text' });
              inputEl.value = String(frontmatterSettings.fieldAliases?.[field] || '');
              inputEl.placeholder = `alias for ${field}`;
              inputEl.style.cssText = `
                flex: 1;
                min-width: 0;
                padding: 4px 8px;
                font-size: 12px;
                border: 1px solid var(--background-modifier-border);
                border-radius: var(--input-radius);
                background: var(--background-primary);
                color: var(--text-normal);
              `;

              inputEl.addEventListener('change', () => {
                const nextAliases = {
                  ...(frontmatterSettings.fieldAliases || {}),
                };
                const nextValue = inputEl.value.trim();

                if (!nextValue) {
                  delete nextAliases[field];
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
            dropdown.addOption('', 'Select existing key...');
            dropdown.addOption(customKeyOptionValue, 'New key...');
            for (const key of vaultFrontmatterKeys) {
              dropdown.addOption(key, key);
            }
            dropdown.setValue(isCustomKey ? customKeyOptionValue : property.key);
            dropdown.onChange(async (value) => {
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
              .setPlaceholder('status')
              .setValue(property.key)
              .onChange(async (value) => {
                property.key = value;
                propertySetting.setName(String(value || '').trim() || 'Untitled');
                this.markDirty();
                rebuildPropertyOrderFromMixedOrder();
              });
          });
        }

        propertySetting
          .addDropdown((dropdown) => {
            dropdown
              .addOption('text', 'Text')
              .addOption('number', 'Number')
              .addOption('checkbox', 'Checkbox')
              .addOption('date', 'Date')
              .addOption('date-time', 'Date & Time')
              .addOption('list', 'List')
              .setValue(propertyType)
              .onChange(async (value) => {
                property.type = this.normalizeFrontmatterPropertyType(value);
                this.markDirty();
                renderMixedPropertyRows();
              });
          })
          .addToggle((toggle) => toggle
            .setValue(property.enabled)
            .onChange(async (value) => {
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
          .setButtonText('+ Add row')
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

    const coreLockedNote = bodyContainer.createEl('div', {
      text: 'Core keys cannot be removed or overridden: platform, author, authorUrl, published, archived, lastModified, tags.',
    });
    coreLockedNote.style.cssText = 'font-size: 12px; color: var(--text-muted); margin: 4px 0 12px 0;';

    const tagSettingsHeader = bodyContainer.createEl('h3', { text: 'Archive Tags' });
    tagSettingsHeader.style.cssText = `
      font-size: 15px;
      font-weight: 600;
      margin: 14px 0 8px 0;
      color: var(--text-normal);
    `;

    new Setting(bodyContainer)
      .setName('Main archive tag')
      .setDesc('Base tag for archived notes. Example: maintag or #maintag. Leave empty to disable auto tags.')
      .addText((text) => text
        .setPlaceholder('maintag')
        .setValue(frontmatterSettings.tagRoot || '')
        .onChange(async (value) => {
          frontmatterSettings.tagRoot = value.trim();
          this.markDirty();
        }));

    new Setting(bodyContainer)
      .setName('Tag structure')
      .setDesc('Choose how the auto tag is generated from the main tag.')
      .addDropdown((dropdown) => dropdown
        .addOption('flat', '#maintag')
        .addOption('platform-only', '#maintag/socialnetwork')
        .addOption('platform-year-month', '#maintag/socialnetwork/year/month')
        .setValue(frontmatterSettings.tagOrganization || 'flat')
        .onChange(async (value: string) => {
          frontmatterSettings.tagOrganization = value as ArchiveOrganizationMode;
          this.markDirty();
        }));

    new Setting(bodyContainer)
      .setName('Reset frontmatter settings')
      .setDesc('Reset property order, custom rows, visibility toggles, and archive tag settings.')
      .addButton((button) => button
        .setButtonText('Reset all')
        .setWarning()
        .onClick(() => {
          this.plugin.settings.frontmatter = {
            ...DEFAULT_FRONTMATTER_CUSTOMIZATION_SETTINGS,
            fieldVisibility: { ...DEFAULT_FRONTMATTER_CUSTOMIZATION_SETTINGS.fieldVisibility },
            customProperties: [],
            fieldAliases: {},
            propertyOrder: [...DEFAULT_FRONTMATTER_PROPERTY_ORDER],
            tagRoot: '',
            tagOrganization: DEFAULT_FRONTMATTER_CUSTOMIZATION_SETTINGS.tagOrganization,
          };
          this.markDirty();
          this.display();
        }));

    const updateVisibility = () => {
      bodyContainer.style.display = frontmatterSettings.enabled ? '' : 'none';
    };
    updateVisibility();
  }

  /**
   * Render Whisper installation status
   */
  private async renderWhisperStatus(container: HTMLElement): Promise<void> {
    if (Platform.isMobile) {
      const mobileNote = container.createEl('div', {
        cls: 'setting-item-description'
      });
      mobileNote.textContent = 'ⓘ Transcription is only available on desktop';
      mobileNote.style.cssText = 'color: var(--text-muted); font-size: 13px;';
      return;
    }

    // Show loading state
    container.createEl('div', {
      text: 'Detecting Whisper installation...',
      cls: 'setting-item-description'
    }).style.color = 'var(--text-muted)';

    try {
      const { WhisperDetector } = await import('../utils/whisper');
      const preferredVariant = this.plugin.settings.transcription?.preferredVariant || 'auto';
      const customPath = this.plugin.settings.transcription?.customWhisperPath;
      const forceEnable = this.plugin.settings.transcription?.forceEnableCustomPath ?? false;
      const detection = await WhisperDetector.detect(
        preferredVariant as 'auto' | 'faster-whisper' | 'openai-whisper' | 'whisper.cpp',
        customPath,
        forceEnable
      );

      // Clear container and show result
      container.empty();

      if (detection.available && detection.variant && detection.path) {
        const statusEl = container.createEl('div', {
          cls: 'setting-item-description'
        });
        // Indicate if using custom path
        const isUsingCustomPath = customPath && detection.path.includes(customPath.replace(/\//g, '\\').split('\\').pop() || '');
        statusEl.textContent = `✓ Detected: ${detection.variant}${isUsingCustomPath ? ' (custom path)' : ''}`;
        statusEl.style.cssText = 'color: var(--text-success); font-size: 13px;';

        // Show path
        const pathEl = container.createEl('div', {
          cls: 'setting-item-description'
        });
        pathEl.textContent = `  Path: ${detection.path}`;
        pathEl.style.cssText = 'color: var(--text-muted); font-size: 12px;';

        // Show version if available
        if (detection.version && detection.version !== 'unknown') {
          const versionEl = container.createEl('div', {
            cls: 'setting-item-description'
          });
          versionEl.textContent = `  Version: ${detection.version}`;
          versionEl.style.cssText = 'color: var(--text-muted); font-size: 12px;';
        }

        // Show installed models
        if (detection.installedModels.length > 0) {
          const modelsEl = container.createEl('div', {
            cls: 'setting-item-description'
          });
          modelsEl.textContent = `  Models: ${detection.installedModels.join(', ')}`;
          modelsEl.style.cssText = 'color: var(--text-muted); font-size: 12px;';
        }
      } else {
        const statusEl = container.createEl('div', {
          cls: 'setting-item-description'
        });
        statusEl.textContent = '✗ Whisper not detected';
        statusEl.style.cssText = 'color: var(--text-error); font-size: 13px;';

        // Show specific hint if custom path was set but failed
        if (customPath) {
          const customPathHintEl = container.createEl('div', {
            cls: 'setting-item-description'
          });
          customPathHintEl.textContent = `⚠ Custom path could not be validated: ${customPath}`;
          customPathHintEl.style.cssText = 'color: var(--text-warning); font-size: 12px; margin-top: 4px;';

          const checkHintEl = container.createEl('div', {
            cls: 'setting-item-description'
          });
          checkHintEl.textContent = 'Please verify the file exists and is a valid Whisper binary.';
          checkHintEl.style.cssText = 'color: var(--text-muted); font-size: 12px;';
        } else {
          const hintEl = container.createEl('div', {
            cls: 'setting-item-description'
          });
          hintEl.textContent = 'Install faster-whisper: pip install faster-whisper';
          hintEl.style.cssText = 'color: var(--text-muted); font-size: 12px; margin-top: 4px;';
        }
      }
    } catch (error) {
      container.empty();
      const errorEl = container.createEl('div', {
        cls: 'setting-item-description'
      });
      errorEl.textContent = '⚠ Could not detect Whisper';
      errorEl.style.cssText = 'color: var(--text-warning); font-size: 13px;';
    }
  }

  /**
   * Render Naver Settings section
   */
  private renderNaverSettings(containerEl: HTMLElement): void {
    // Section Header
    const naverHeader = containerEl.createEl('h2', { text: '🇰🇷 Naver Settings' });
    naverHeader.style.cssText = `
      font-size: 18px;
      font-weight: 600;
      margin: 24px 0 12px 0;
      color: var(--text-normal);
    `;

    // Description
    const naverDesc = containerEl.createEl('p', {
      text: 'Configure settings for archiving content from Naver Blog, Cafe, and News.'
    });
    naverDesc.style.cssText = `
      font-size: 13px;
      color: var(--text-muted);
      margin: 0 0 16px 0;
    `;

    // Cookie description
    new Setting(containerEl)
      .setName('Cookie')
      .setDesc(
        createFragment((frag) => {
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
        })
      );

    // NID_AUT input
    new Setting(containerEl)
      .setName('NID_AUT')
      .setDesc('Copy the NID_AUT cookie value')
      .addText((text) => {
        text
          .setPlaceholder('Paste NID_AUT value')
          .setValue(this.plugin.settings.nidAut)
          .onChange(async (value) => {
            // Clean the value - remove "NID_AUT=" prefix if user pasted it
            const cleanValue = value.replace(/^NID_AUT\s*=\s*/i, '').trim();
            this.plugin.settings.nidAut = cleanValue;
            this.updateNaverCookieString();
            this.markDirty();
          });
        text.inputEl.style.cssText = 'width: 100%; font-family: var(--font-monospace); font-size: 12px;';
      });

    // NID_SES input
    new Setting(containerEl)
      .setName('NID_SES')
      .setDesc('Copy the NID_SES cookie value')
      .addText((text) => {
        text
          .setPlaceholder('Paste NID_SES value')
          .setValue(this.plugin.settings.nidSes)
          .onChange(async (value) => {
            // Clean the value - remove "NID_SES=" prefix if user pasted it
            const cleanValue = value.replace(/^NID_SES\s*=\s*/i, '').trim();
            this.plugin.settings.nidSes = cleanValue;
            this.updateNaverCookieString();
            this.markDirty();
          });
        text.inputEl.style.cssText = 'width: 100%; font-family: var(--font-monospace); font-size: 12px;';
      });

    // Helper text
    const helperText = containerEl.createEl('div', {
      cls: 'setting-item-description'
    });
    helperText.style.cssText = 'margin-top: 8px; margin-bottom: 16px; padding-left: 0;';
    helperText.innerHTML = `
      <small style="color: var(--text-muted);">
        💡 <strong>Tip:</strong> Leave empty for public blogs and cafes. Only needed for private cafes that require login.
      </small>
    `;
  }

  /**
   * Render Reddit Sync Settings section
   */
  private renderRedditSettings(containerEl: HTMLElement): void {
    // Section Header with Reddit icon
    const redditHeader = containerEl.createEl('h2', { text: 'Reddit Sync' });
    redditHeader.style.cssText = `
      font-size: 18px;
      font-weight: 600;
      margin: 24px 0 12px 0;
      color: var(--text-normal);
    `;

    // Description
    const redditDesc = containerEl.createEl('p', {
      text: 'Automatically sync your Reddit saved posts to your vault. Requires connecting your Reddit account.'
    });
    redditDesc.style.cssText = `
      font-size: 13px;
      color: var(--text-muted);
      margin: 0 0 16px 0;
    `;

    // Connection status display
    const statusContainer = containerEl.createDiv({ cls: 'reddit-status-container' });
    statusContainer.style.cssText = 'margin-bottom: 16px;';
    this.renderRedditConnectionStatus(statusContainer);

    // Connect/Disconnect button
    const connectSetting = new Setting(containerEl)
      .setName('Reddit Account')
      .setDesc(this.plugin.settings.redditConnected
        ? `Connected as u/${this.plugin.settings.redditUsername}`
        : 'Connect your Reddit account to enable sync');

    if (this.plugin.settings.redditConnected) {
      connectSetting.addButton(button => button
        .setButtonText('Disconnect')
        .setWarning()
        .onClick(async () => {
          await this.disconnectReddit();
          // Refresh the settings display
          this.display();
        }));
    } else {
      connectSetting.addButton(button => button
        .setButtonText('Connect Reddit')
        .setCta()
        .onClick(async () => {
          await this.connectReddit();
        }));
    }

    // Sync settings (only shown when connected)
    if (this.plugin.settings.redditConnected) {
      // Enable sync toggle
      new Setting(containerEl)
        .setName('Enable automatic sync')
        .setDesc('Automatically sync saved posts on a schedule')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.redditSyncEnabled)
          .onChange(async (value) => {
            this.plugin.settings.redditSyncEnabled = value;
            this.markDirty();
          }));

      // Sync folder
      new Setting(containerEl)
        .setName('Sync folder')
        .setDesc('Folder where synced Reddit posts will be saved')
        .addText(text => {
          text
            .setPlaceholder('Social Archives/Reddit Saved')
            .setValue(this.plugin.settings.redditSyncFolder)
            .onChange(async (value) => {
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
        .addButton(button => button
          .setButtonText('Sync Now')
          .onClick(async () => {
            button.setDisabled(true);
            button.setButtonText('Syncing...');
            try {
              // TODO: Implement actual sync trigger when Reddit API is approved
              // For now, show a notice
              const { Notice } = await import('obsidian');
              new Notice('Reddit sync coming soon! Waiting for API approval.');
            } catch (error) {
              const { Notice } = await import('obsidian');
              new Notice(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            } finally {
              button.setDisabled(false);
              button.setButtonText('Sync Now');
            }
          }));
    }

    // Info callout
    const infoDiv = containerEl.createDiv({ cls: 'setting-info' });
    infoDiv.style.cssText = `
      padding: 12px;
      background: var(--background-secondary);
      border-radius: 8px;
      margin-top: 16px;
      font-size: 13px;
      color: var(--text-muted);
    `;
    infoDiv.innerHTML = `
      <strong>About Reddit Sync</strong>
      <ul style="margin: 8px 0 0 16px; padding: 0;">
        <li>Syncs posts you've saved on Reddit</li>
        <li>Requires Reddit OAuth authentication</li>
        <li>Runs automatically once per day when enabled</li>
        <li>Only new saved posts are synced (deduplication)</li>
      </ul>
    `;
  }

  /**
   * Render Reddit connection status
   */
  private renderRedditConnectionStatus(container: HTMLElement): void {
    const statusEl = container.createDiv({ cls: 'reddit-connection-status' });
    statusEl.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--background-secondary);
      border-radius: 6px;
      font-size: 13px;
    `;

    if (this.plugin.settings.redditConnected) {
      // Connected status
      const iconEl = statusEl.createSpan({ text: '✓' });
      iconEl.style.cssText = 'color: var(--text-success); font-weight: 600;';

      const textEl = statusEl.createSpan();
      textEl.innerHTML = `Connected as <strong style="color: #ff4500;">u/${this.plugin.settings.redditUsername}</strong>`;
    } else {
      // Not connected status
      const iconEl = statusEl.createSpan({ text: '○' });
      iconEl.style.cssText = 'color: var(--text-muted);';

      const textEl = statusEl.createSpan({ text: 'Not connected' });
      textEl.style.cssText = 'color: var(--text-muted);';
    }
  }

  /**
   * Connect Reddit account via OAuth
   */
  private async connectReddit(): Promise<void> {
    try {
      const { Notice } = await import('obsidian');

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
      const { Notice } = await import('obsidian');
      new Notice(`Failed to connect Reddit: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Disconnect Reddit account
   */
  private async disconnectReddit(): Promise<void> {
    try {
      const { Notice } = await import('obsidian');

      // TODO: Call /api/reddit/oauth/disconnect when API is approved
      // For now, just clear local settings
      this.plugin.settings.redditConnected = false;
      this.plugin.settings.redditUsername = '';
      this.plugin.settings.redditSyncEnabled = false;
      await this.plugin.saveSettings();

      new Notice('Reddit account disconnected');
    } catch (error) {
      const { Notice } = await import('obsidian');
      new Notice(`Failed to disconnect: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Render Webtoon Streaming Settings section
   */
  private renderWebtoonStreamingSettings(containerEl: HTMLElement): void {
    // Section Header
    const streamingHeader = containerEl.createEl('h2', { text: 'Webtoon Streaming' });
    streamingHeader.style.cssText = `
      font-size: 18px;
      font-weight: 600;
      margin: 24px 0 12px 0;
      color: var(--text-normal);
    `;

    // Info callout explaining the feature
    const infoDiv = containerEl.createDiv({ cls: 'setting-info' });
    infoDiv.style.cssText = `
      padding: 12px;
      background: var(--background-secondary);
      border-radius: 8px;
      margin-bottom: 16px;
      font-size: 13px;
      color: var(--text-muted);
    `;
    infoDiv.innerHTML = `
      <strong>Streaming Mode</strong> loads webtoon episodes instantly without waiting for downloads.
      <ul style="margin: 8px 0 0 16px; padding: 0;">
        <li>Images are proxied through our server to bypass CORS restrictions</li>
        <li>Background Download saves episodes for offline reading</li>
        <li>Prefetch pre-loads the next episode for seamless transitions</li>
      </ul>
    `;

    // View Mode dropdown
    new Setting(containerEl)
      .setName('Episode loading mode')
      .setDesc('Stream-first: Load immediately via proxy (faster). Download-first: Wait for full download (offline ready).')
      .addDropdown(dropdown => dropdown
        .addOption('stream-first', 'Stream First (Recommended)')
        .addOption('download-first', 'Download First')
        .setValue(this.plugin.settings.webtoonStreaming?.viewMode || 'stream-first')
        .onChange(async (value) => {
          const viewMode = value as 'stream-first' | 'download-first';
          if (!this.plugin.settings.webtoonStreaming) {
            this.plugin.settings.webtoonStreaming = {
              viewMode,
              backgroundDownload: true,
              prefetchNextEpisode: true,
              mobileDataSaver: false
            };
          } else {
            this.plugin.settings.webtoonStreaming.viewMode = viewMode;
          }
          this.markDirty();
        }));

    // Background Download toggle - 44px touch target ensured on mobile
    const bgDownloadSetting = new Setting(containerEl)
      .setName('Background download')
      .setDesc('Automatically download streamed episodes to vault for offline access.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.webtoonStreaming?.backgroundDownload !== false)
        .onChange(async (value) => {
          if (!this.plugin.settings.webtoonStreaming) {
            this.plugin.settings.webtoonStreaming = {
              viewMode: 'stream-first',
              backgroundDownload: value,
              prefetchNextEpisode: true,
              mobileDataSaver: false
            };
          } else {
            this.plugin.settings.webtoonStreaming.backgroundDownload = value;
          }
          this.markDirty();
        }));
    // Ensure 44px touch target on mobile (iOS HIG compliance)
    if (Platform.isMobile) {
      bgDownloadSetting.settingEl.style.minHeight = '44px';
    }

    // Prefetch Next Episode toggle
    const prefetchSetting = new Setting(containerEl)
      .setName('Prefetch next episode')
      .setDesc('Pre-load next episode data when reaching end of current episode for faster transitions.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.webtoonStreaming?.prefetchNextEpisode !== false)
        .onChange(async (value) => {
          if (!this.plugin.settings.webtoonStreaming) {
            this.plugin.settings.webtoonStreaming = {
              viewMode: 'stream-first',
              backgroundDownload: true,
              prefetchNextEpisode: value,
              mobileDataSaver: false
            };
          } else {
            this.plugin.settings.webtoonStreaming.prefetchNextEpisode = value;
          }
          this.markDirty();
        }));
    if (Platform.isMobile) {
      prefetchSetting.settingEl.style.minHeight = '44px';
    }

    // Mobile Data Saver (only shown on mobile)
    if (Platform.isMobile) {
      const dataSaverSetting = new Setting(containerEl)
        .setName('Mobile data saver')
        .setDesc('Load lower quality images to reduce data usage on mobile networks.')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.webtoonStreaming?.mobileDataSaver ?? false)
          .onChange(async (value) => {
            if (!this.plugin.settings.webtoonStreaming) {
              this.plugin.settings.webtoonStreaming = {
                viewMode: 'stream-first',
                backgroundDownload: true,
                prefetchNextEpisode: true,
                mobileDataSaver: value
              };
            } else {
              this.plugin.settings.webtoonStreaming.mobileDataSaver = value;
            }
            this.markDirty();
          }));
      dataSaverSetting.settingEl.style.minHeight = '44px';
    }
  }

  /**
   * Render Mobile Sync settings section
   */
  private renderMobileSyncSettings(containerEl: HTMLElement): void {
    // Section Header
    const syncHeader = containerEl.createEl('h2', { text: 'Mobile Sync' });
    syncHeader.style.cssText = `
      font-size: 18px;
      font-weight: 600;
      margin: 24px 0 12px 0;
      color: var(--text-normal);
    `;

    // Sync Settings Component (Svelte)
    const syncContainer = containerEl.createDiv({ cls: 'social-archiver-sync-section' });
    syncContainer.style.cssText = 'margin-bottom: 16px;';
    this.syncSettingsComponent = mount(SyncSettingsTab, {
      target: syncContainer,
      props: { plugin: this.plugin }
    });
  }

  /**
   * Render Update Notifications settings section
   */
  private renderUpdateNotificationsSettings(containerEl: HTMLElement): void {
    // Section Header
    const updateHeader = containerEl.createEl('h2', { text: 'Update Notifications' });
    updateHeader.style.cssText = `
      font-size: 18px;
      font-weight: 600;
      margin: 24px 0 12px 0;
      color: var(--text-normal);
    `;

    // Show release notes toggle
    new Setting(containerEl)
      .setName('Show release notes after updates')
      .setDesc('Display a modal with new features and changes when the plugin updates')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showReleaseNotes)
        .onChange(async (value) => {
          this.plugin.settings.showReleaseNotes = value;
          await this.plugin.saveData(this.plugin.settings);
          this.markDirty();
        }));
  }

  /**
   * Render AI Comment Settings section
   */
  private async renderAICommentSettings(containerEl: HTMLElement): Promise<void> {
    // Section Header
    const aiHeader = containerEl.createEl('h2', { text: 'AI Comment Settings' });
    aiHeader.style.cssText = `
      font-size: 18px;
      font-weight: 600;
      margin: 24px 0 12px 0;
      color: var(--text-normal);
    `;

    // Mobile notice
    if (Platform.isMobile) {
      const mobileNote = containerEl.createEl('div', {
        cls: 'setting-item-description'
      });
      mobileNote.textContent = 'AI Comments are only available on desktop (requires local CLI tools)';
      mobileNote.style.cssText = 'color: var(--text-muted); font-size: 13px; margin-bottom: 16px;';
      return;
    }

    const settings = this.plugin.settings.aiComment;

    // Feature toggle
    new Setting(containerEl)
      .setName('Enable AI comments')
      .setDesc('Show AI comment suggestions on archived posts. Requires local AI CLI tools.')
      .addToggle(toggle => toggle
        .setValue(settings.enabled)
        .onChange(async (value) => {
          this.plugin.settings.aiComment.enabled = value;
          this.markDirty();
        }));

    // AI Tools Detection Display
    const aiToolsContainer = containerEl.createDiv({ cls: 'ai-tools-status-container' });
    aiToolsContainer.style.cssText = 'margin-bottom: 16px;';
    await this.renderAIToolsStatus(aiToolsContainer);

    // Default CLI selector
    const cliSetting = new Setting(containerEl)
      .setName('Default AI tool')
      .setDesc('Choose which AI CLI to use by default');

    // Build CLI options dynamically based on detection
    const detectedClis = await this.getDetectedClis();
    cliSetting.addDropdown(dropdown => {
      for (const cli of (['claude', 'gemini', 'codex'] as AICli[])) {
        const info = AI_CLI_INFO[cli];
        const isDetected = detectedClis.has(cli);
        const label = isDetected ? `${info.displayName} ✓` : `${info.displayName} (not installed)`;
        dropdown.addOption(cli, label);
      }
      dropdown.setValue(settings.defaultCli);
      dropdown.onChange(async (value: string) => {
        this.plugin.settings.aiComment.defaultCli = value as AICli;
        this.markDirty();
      });
    });

    // Default comment type
    new Setting(containerEl)
      .setName('Default comment type')
      .setDesc('Type of analysis to generate by default')
      .addDropdown(dropdown => {
        const types: AICommentType[] = ['summary', 'factcheck', 'critique', 'keypoints', 'sentiment', 'connections', 'glossary'];
        for (const type of types) {
          dropdown.addOption(type, COMMENT_TYPE_DISPLAY_NAMES[type]);
        }
        dropdown.setValue(settings.defaultType);
        dropdown.onChange(async (value: string) => {
          this.plugin.settings.aiComment.defaultType = value as AICommentType;
          this.markDirty();
        });
      });

    // Output language setting
    new Setting(containerEl)
      .setName('Output language')
      .setDesc('Language for AI responses. "Auto" matches the content language (e.g., Korean content → Korean summary)')
      .addDropdown(dropdown => {
        // Add all language options
        for (const [lang, displayName] of Object.entries(OUTPUT_LANGUAGE_NAMES)) {
          dropdown.addOption(lang, displayName);
        }
        dropdown.setValue(settings.outputLanguage || 'auto');
        dropdown.onChange(async (value: string) => {
          this.plugin.settings.aiComment.outputLanguage = value as AIOutputLanguage;
          this.markDirty();
        });
      });

    // Platform Visibility Section (collapsible)
    await this.renderPlatformVisibilitySettings(containerEl);

    // Vault Context Settings (collapsible)
    await this.renderVaultContextSettings(containerEl);
  }

  /**
   * Render AI Tools detection status
   */
  private async renderAIToolsStatus(container: HTMLElement): Promise<void> {
    container.createEl('div', {
      text: 'Detecting AI tools...',
      cls: 'setting-item-description'
    }).style.color = 'var(--text-muted)';

    try {
      const detectedClis = await this.getDetectedClis();
      container.empty();

      const statusGrid = container.createDiv({ cls: 'ai-tools-grid' });
      statusGrid.style.cssText = `
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
        margin-bottom: 8px;
      `;

      for (const cli of (['claude', 'gemini', 'codex'] as AICli[])) {
        const info = AI_CLI_INFO[cli];
        const result = detectedClis.get(cli);
        const isDetected = result?.available ?? false;

        const itemEl = statusGrid.createDiv({ cls: 'ai-tool-status-item' });
        itemEl.style.cssText = `
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          background: var(--background-secondary);
          border-radius: 6px;
          font-size: 13px;
        `;

        const icon = itemEl.createSpan();
        icon.textContent = isDetected ? '✓' : '✗';
        icon.style.cssText = isDetected
          ? 'color: var(--text-success); font-weight: 600;'
          : 'color: var(--text-muted);';

        const nameEl = itemEl.createSpan({ text: info.displayName });
        nameEl.style.cssText = isDetected
          ? 'color: var(--text-normal);'
          : 'color: var(--text-muted);';

        if (isDetected && result?.version) {
          const versionEl = itemEl.createSpan({ text: `v${result.version}` });
          versionEl.style.cssText = 'color: var(--text-faint); font-size: 11px; margin-left: auto;';
        }

        if (!isDetected) {
          itemEl.style.cursor = 'pointer';
          itemEl.title = `Click to learn how to install ${info.displayName}`;
          itemEl.onclick = () => window.open(info.installUrl, '_blank');
        }
      }

      // Refresh button
      const refreshBtn = container.createEl('button', { text: 'Refresh detection' });
      refreshBtn.style.cssText = `
        font-size: 12px;
        padding: 4px 10px;
        margin-top: 4px;
        cursor: pointer;
      `;
      refreshBtn.onclick = async () => {
        AICliDetector.resetCache();
        await this.renderAIToolsStatus(container);
      };
    } catch (error) {
      container.empty();
      const errorEl = container.createEl('div', {
        cls: 'setting-item-description'
      });
      errorEl.textContent = '⚠ Could not detect AI tools';
      errorEl.style.cssText = 'color: var(--text-warning); font-size: 13px;';
    }
  }

  /**
   * Get detected AI CLIs
   */
  private async getDetectedClis(): Promise<Map<AICli, AICliDetectionResult>> {
    const results = new Map<AICli, AICliDetectionResult>();
    const clis: AICli[] = ['claude', 'gemini', 'codex'];

    await Promise.all(clis.map(async (cli) => {
      try {
        const result = await AICliDetector.detect(cli);
        if (result.available) {
          results.set(cli, result);
        }
      } catch {
        // Ignore detection errors
      }
    }));

    return results;
  }

  /**
   * Render Platform Visibility settings (collapsible)
   */
  private async renderPlatformVisibilitySettings(containerEl: HTMLElement): Promise<void> {
    const settings = this.plugin.settings.aiComment;

    // Collapsible header
    const headerEl = containerEl.createDiv({ cls: 'setting-item' });
    headerEl.style.cssText = 'cursor: pointer; user-select: none;';

    const headerInfo = headerEl.createDiv({ cls: 'setting-item-info' });
    const headerName = headerInfo.createDiv({ cls: 'setting-item-name', text: '▶ Platform Visibility' });
    headerInfo.createDiv({
      cls: 'setting-item-description',
      text: 'Choose which platform types show AI comment banners'
    });

    const contentEl = containerEl.createDiv({ cls: 'platform-visibility-content' });
    contentEl.style.cssText = 'display: none; padding-left: 16px; margin-bottom: 16px;';

    let isExpanded = false;
    headerEl.onclick = () => {
      isExpanded = !isExpanded;
      headerName.textContent = isExpanded ? '▼ Platform Visibility' : '▶ Platform Visibility';
      contentEl.style.display = isExpanded ? 'block' : 'none';
    };

    // Category toggles
    new Setting(contentEl)
      .setName('Social Media')
      .setDesc('Facebook, Instagram, X, Threads, LinkedIn, TikTok, Bluesky, Mastodon, Reddit, Pinterest, Tumblr')
      .addToggle(toggle => toggle
        .setValue(settings.platformVisibility.socialMedia)
        .onChange(async (value) => {
          this.plugin.settings.aiComment.platformVisibility.socialMedia = value;
          this.markDirty();
        }));

    new Setting(contentEl)
      .setName('Blog & News')
      .setDesc('Blog, Substack, Medium, Velog')
      .addToggle(toggle => toggle
        .setValue(settings.platformVisibility.blogNews)
        .onChange(async (value) => {
          this.plugin.settings.aiComment.platformVisibility.blogNews = value;
          this.markDirty();
        }));

    new Setting(contentEl)
      .setName('Video & Audio')
      .setDesc('YouTube, Podcast')
      .addToggle(toggle => toggle
        .setValue(settings.platformVisibility.videoAudio)
        .onChange(async (value) => {
          this.plugin.settings.aiComment.platformVisibility.videoAudio = value;
          this.markDirty();
        }));

    // Excluded platforms
    const excludedPlatforms = settings.platformVisibility.excludedPlatforms || [];
    const excludeEl = contentEl.createDiv({ cls: 'excluded-platforms' });
    excludeEl.style.cssText = 'margin-top: 12px;';

    excludeEl.createEl('div', {
      cls: 'setting-item-name',
      text: 'Excluded Platforms'
    }).style.marginBottom = '8px';

    const allPlatforms = [
      ...SOCIAL_MEDIA_PLATFORMS,
      ...BLOG_NEWS_PLATFORMS,
      ...VIDEO_AUDIO_PLATFORMS,
    ] as SocialPlatform[];

    const platformGrid = excludeEl.createDiv();
    platformGrid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 4px;
    `;

    for (const platform of allPlatforms) {
      const isExcluded = excludedPlatforms.includes(platform);
      const label = platformGrid.createEl('label');
      label.style.cssText = 'display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer;';

      const checkbox = label.createEl('input', { type: 'checkbox' });
      checkbox.checked = isExcluded;
      checkbox.onchange = async () => {
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
  private async renderVaultContextSettings(containerEl: HTMLElement): Promise<void> {
    const settings = this.plugin.settings.aiComment;

    // Collapsible header
    const headerEl = containerEl.createDiv({ cls: 'setting-item' });
    headerEl.style.cssText = 'cursor: pointer; user-select: none;';

    const headerInfo = headerEl.createDiv({ cls: 'setting-item-info' });
    const headerName = headerInfo.createDiv({ cls: 'setting-item-name', text: '▶ Vault Context (Connections)' });
    headerInfo.createDiv({
      cls: 'setting-item-description',
      text: 'Configure how AI finds connections to your notes'
    });

    const contentEl = containerEl.createDiv({ cls: 'vault-context-content' });
    contentEl.style.cssText = 'display: none; padding-left: 16px; margin-bottom: 16px;';

    let isExpanded = false;
    headerEl.onclick = () => {
      isExpanded = !isExpanded;
      headerName.textContent = isExpanded ? '▼ Vault Context (Connections)' : '▶ Vault Context (Connections)';
      contentEl.style.display = isExpanded ? 'block' : 'none';
    };

    // Enable vault context
    new Setting(contentEl)
      .setName('Enable vault context')
      .setDesc('Allow AI to scan your vault for related notes when using "Connections" comment type')
      .addToggle(toggle => toggle
        .setValue(settings.vaultContext.enabled)
        .onChange(async (value) => {
          this.plugin.settings.aiComment.vaultContext.enabled = value;
          this.markDirty();
        }));

    // Smart filtering
    new Setting(contentEl)
      .setName('Smart filtering')
      .setDesc('Use keyword matching to select only relevant notes for context')
      .addToggle(toggle => toggle
        .setValue(settings.vaultContext.smartFiltering)
        .onChange(async (value) => {
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
        .onChange(async (value) => {
          const num = parseInt(value) || 10;
          this.plugin.settings.aiComment.vaultContext.maxContextNotes = Math.max(1, Math.min(50, num));
          this.markDirty();
        }));

    // Exclude paths - with folder suggester
    const excludeSetting = new Setting(contentEl)
      .setName('Exclude folders')
      .setDesc('Select folders to exclude from context scanning');

    const inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.placeholder = 'Select folder...';
    inputEl.style.cssText = 'width: 150px;';

    new FolderSuggest(this.app, inputEl);
    excludeSetting.controlEl.appendChild(inputEl);

    // Folder list below
    const folderListEl = contentEl.createDiv({ cls: 'exclude-folders-list' });
    folderListEl.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;';

    const createFolderItem = (folderPath: string): HTMLElement => {
      const itemEl = document.createElement('div');
      itemEl.className = 'exclude-folder-item';
      itemEl.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        background: var(--background-secondary);
        border-radius: 12px;
        font-size: 12px;
      `;

      const pathSpan = document.createElement('span');
      pathSpan.textContent = folderPath;
      itemEl.appendChild(pathSpan);

      const removeBtn = document.createElement('button');
      removeBtn.textContent = '×';
      removeBtn.style.cssText = 'padding: 0 2px; font-size: 12px; cursor: pointer; background: none; border: none; color: var(--text-muted); opacity: 0.7;';
      removeBtn.onmouseenter = () => { removeBtn.style.opacity = '1'; removeBtn.style.color = 'var(--text-error)'; };
      removeBtn.onmouseleave = () => { removeBtn.style.opacity = '0.7'; removeBtn.style.color = 'var(--text-muted)'; };
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

  hide(): void {
    // Save settings if changed
    if (this.settingsDirty) {
      this.plugin.saveSettings();
      this.settingsDirty = false;
    }
    // Clean up Svelte components when settings are closed
    this.cleanupComponents();
  }
}
