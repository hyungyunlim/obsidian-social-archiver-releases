import { Plugin, Notice, Platform as ObsidianPlatform, Events, TFile, TFolder } from 'obsidian';
import { SocialArchiverSettingTab } from './settings/SettingTab';
import { SocialArchiverSettings, DEFAULT_SETTINGS, API_ENDPOINT, migrateSettings, getVaultOrganizationStrategy } from './types/settings';
import { WorkersAPIClient } from './services/WorkersAPIClient';
import { ArchiveOrchestrator } from './services/ArchiveOrchestrator';
import { VaultManager } from './services/VaultManager';
import { MarkdownConverter } from './services/MarkdownConverter';
import { LinkPreviewExtractor } from './services/LinkPreviewExtractor';
import { PendingJobsManager, type PendingJob } from './services/PendingJobsManager';
import { CrawlJobTracker } from './services/CrawlJobTracker';
import { ArchiveJobTracker } from './services/ArchiveJobTracker';
import { RealtimeClient } from './services/RealtimeClient';
import { SubscriptionManager, type PendingPost } from './services/SubscriptionManager';
import { NaverSubscriptionPoller } from './services/NaverSubscriptionPoller';
import { BrunchSubscriptionPoller } from './services/BrunchSubscriptionPoller';
import { WebtoonSyncService } from './services/WebtoonSyncService';
import { AuthorAvatarService } from './services/AuthorAvatarService';
import { TagStore } from './services/TagStore';
import type { PostData, Platform } from './types/post';
import type { UserArchive } from './services/WorkersAPIClient';
import { TimelineView, VIEW_TYPE_TIMELINE } from './views/TimelineView';
import { MediaGalleryView, VIEW_TYPE_MEDIA_GALLERY } from './views/MediaGalleryView';
import { MediaGalleryView2, VIEW_TYPE_MEDIA_GALLERY_2 } from './views/MediaGalleryView2';
import { ArchiveModal } from './modals/ArchiveModal';
import { WebtoonArchiveModal } from './modals/WebtoonArchiveModal';
import { ReleaseNotesModal } from './modals/ReleaseNotesModal';
import { NaverWebtoonLocalService } from './services/NaverWebtoonLocalService';
import { RELEASE_NOTES } from './release-notes';
import { completeAuthentication, showAuthError, showAuthSuccess, refreshUserCredits } from './utils/auth';
import { normalizeUrlForDedup } from './utils/url';

import { ProcessManager } from './services/ProcessManager';
import { YtDlpDetector } from './utils/yt-dlp';
import { detectPlatform } from '@/shared/platforms';
import type { TranscriptionResult } from './types/transcription';
import { TranscriptFormatter } from './services/markdown/formatters/TranscriptFormatter';
import { parseTranscriptSections } from './services/markdown/TranscriptSectionManager';
import { BatchTranscriptionManager, type BatchTranscriptionManagerDeps } from './services/BatchTranscriptionManager';
import { BatchTranscriptionNotice } from './ui/BatchTranscriptionNotice';
import type { BatchMode } from './types/batch-transcription';
import { EditorTTSController } from './services/tts/EditorTTSController';
import { FEATURE_EDITOR_TTS_ENABLED } from './shared/constants';
import { ArchiveLookupService } from './services/ArchiveLookupService';
import { AnnotationSyncService } from './services/AnnotationSyncService';
import { AnnotationRenderer } from './services/AnnotationRenderer';
import { AnnotationSectionManager } from './services/AnnotationSectionManager';

// Extracted modules
import { registerCommands, registerEditorTTSMenu } from './plugin/commands/CommandRegistry';
import { RealtimeEventBridge, type WsProfileMetadataMessage } from './plugin/realtime/RealtimeEventBridge';
import { MobileSyncService } from './plugin/mobile/MobileSyncService';
import { LocalArchiveCoordinator } from './plugin/local-archive/LocalArchiveCoordinator';
import { MediaPathResolver } from './plugin/media/MediaPathResolver';
import { PendingJobOrchestrator } from './plugin/jobs/PendingJobOrchestrator';
import { ArchiveCompletionService } from './plugin/jobs/ArchiveCompletionService';
import { ensureFolderExists as ensureFolderExistsUtil } from './plugin/utils/ensureFolderExists';
import { SubscriptionSyncService } from './plugin/subscriptions/SubscriptionSyncService';
import { convertUserArchiveToPostData } from './plugin/mobile/UserArchiveConverter';
import { BatchGoogleMapsArchiver } from './plugin/jobs/BatchGoogleMapsArchiver';
import { PostShareService } from './plugin/session/PostShareService';
import { ArchiveLibrarySyncService } from './plugin/sync/ArchiveLibrarySyncService';
import { ArchiveDeleteSyncService } from './plugin/sync/ArchiveDeleteSyncService';
import { AnnotationOutboundService } from './plugin/sync/AnnotationOutboundService';
import { ArchiveTagOutboundService } from './plugin/sync/ArchiveTagOutboundService';
import { ArchiveStateSyncService } from './plugin/sync/ArchiveStateSyncService';
import { ArchiveStateOutboundService } from './plugin/sync/ArchiveStateOutboundService';

// Import styles for Vite to process
import './styles/index.css';

export default class SocialArchiverPlugin extends Plugin {
  settings: SocialArchiverSettings = DEFAULT_SETTINGS;
  private apiClient?: WorkersAPIClient;
  private orchestrator?: ArchiveOrchestrator;
  public linkPreviewExtractor!: LinkPreviewExtractor; // Link preview URL extractor
  private settingTab?: SocialArchiverSettingTab; // Settings tab reference for refresh
  public events: Events = new Events();
  public pendingJobsManager!: PendingJobsManager; // Pending jobs manager for async archiving
  private jobCheckInterval?: number; // Background job checker interval ID
  private realtimeClient?: RealtimeClient; // WebSocket client for real-time job updates
  public processingJobs: Set<string> = new Set(); // Track jobs being processed to prevent concurrent processing
  public subscriptionManager?: SubscriptionManager; // Subscription management service
  public naverPoller?: NaverSubscriptionPoller; // Naver Blog/Cafe local subscription poller
  public brunchPoller?: BrunchSubscriptionPoller; // Brunch local subscription poller
  public webtoonSyncService?: WebtoonSyncService; // Webtoon offline sync service
  private syncDebounceTimer?: number; // Debounce timer for subscription sync
  private isSyncingSubscriptions = false; // Track if sync is in progress
  private authorAvatarService?: AuthorAvatarService; // Author avatar download service
  private wsPostBatchTimer?: number; // Timer for batching WebSocket posts
  private recentlyArchivedUrls = new Set<string>(); // Dedup guard for ws:client_sync (tracks URLs archived locally)
  private pendingTimeouts = new Set<number>(); // Track setTimeout IDs for cleanup on unload
  private archiveQueueLocks = new Set<string>(); // Dedup guard for archive submission race conditions
  private wsPostBatchCount = 0; // Count of posts in current batch
  private currentCrawlWorkerJobId?: string; // Track workerJobId for current profile crawl batch
  public crawlJobTracker!: CrawlJobTracker; // Profile crawl progress tracker
  public archiveJobTracker!: ArchiveJobTracker; // Archive progress tracker for banner UI
  public tagStore!: TagStore; // User-defined tag management
  public batchTranscriptionManager: BatchTranscriptionManager | null = null;
  private batchTranscriptionNotice: BatchTranscriptionNotice | null = null;
  private readonly transcriptFormatter = new TranscriptFormatter();
  private editorTTSController?: EditorTTSController;
  private archiveLookupService?: ArchiveLookupService; // File lookup by sourceArchiveId / originalUrl
  private annotationSyncService?: AnnotationSyncService; // Mobile annotation sync orchestrator
  public annotationOutboundService?: AnnotationOutboundService; // Outbound comment → server sync
  private archiveTagOutboundService?: ArchiveTagOutboundService; // Outbound archiveTags → server sync
  private archiveStateSyncService?: ArchiveStateSyncService; // Inbound isBookmarked → fm.archive sync
  private archiveStateOutboundService?: ArchiveStateOutboundService; // Outbound fm.archive → server isBookmarked sync

  // Extracted module instances
  private realtimeEventBridge?: RealtimeEventBridge;
  private mobileSyncService?: MobileSyncService;
  private localArchiveCoordinator?: LocalArchiveCoordinator;
  public archiveLibrarySyncService?: ArchiveLibrarySyncService;
  private mediaPathResolver!: MediaPathResolver;
  private pendingJobOrchestrator?: PendingJobOrchestrator;
  private archiveCompletionService?: ArchiveCompletionService;
  private subscriptionSyncService?: SubscriptionSyncService;
  private batchGoogleMapsArchiver?: BatchGoogleMapsArchiver;
  private postShareService?: PostShareService;
  public archiveDeleteSyncService: ArchiveDeleteSyncService | null = null;

  /**
   * Schedule a tracked setTimeout that will be auto-cleared on plugin unload.
   * Prevents memory leaks from orphaned timeout callbacks.
   */
  scheduleTrackedTimeout(callback: () => void, delay: number): number {
    const id = window.setTimeout(() => {
      this.pendingTimeouts.delete(id);
      callback();
    }, delay);
    this.pendingTimeouts.add(id);
    return id;
  }

  private buildArchiveQueueLockKey(url: string, platform?: Platform): string {
    const normalizedUrl = normalizeUrlForDedup(url || '');
    if (normalizedUrl) {
      return normalizedUrl;
    }
    const platformKey = platform || 'unknown';
    return `${platformKey}:${url.trim()}`;
  }

  public tryAcquireArchiveQueueLock(url: string, platform?: Platform): string | null {
    const lockKey = this.buildArchiveQueueLockKey(url, platform);
    if (this.archiveQueueLocks.has(lockKey)) {
      return null;
    }
    this.archiveQueueLocks.add(lockKey);
    return lockKey;
  }

  public releaseArchiveQueueLock(lockKey: string | null | undefined): void {
    if (!lockKey) return;
    this.archiveQueueLocks.delete(lockKey);
  }

  private getNormalizedArchiveUrlKey(url: string | null | undefined): string {
    if (!url) return '';
    const trimmed = url.trim();
    if (!trimmed) return '';
    return normalizeUrlForDedup(trimmed) || trimmed;
  }

  markRecentlyArchivedUrl(url: string | null | undefined): void {
    const normalizedKey = this.getNormalizedArchiveUrlKey(url);
    if (!normalizedKey) return;
    this.recentlyArchivedUrls.add(normalizedKey);
    this.scheduleTrackedTimeout(() => this.recentlyArchivedUrls.delete(normalizedKey), 5 * 60 * 1000);
  }

  hasRecentlyArchivedUrl(url: string | null | undefined): boolean {
    const normalizedKey = this.getNormalizedArchiveUrlKey(url);
    if (!normalizedKey) return false;
    return this.recentlyArchivedUrls.has(normalizedKey);
  }

  buildPendingJobDedupKey(job: Pick<PendingJob, 'url' | 'platform'>): string {
    const normalizedUrl = normalizeUrlForDedup(job.url || '') || job.url.trim();
    return `${job.platform}:${normalizedUrl}`;
  }

  async removeDuplicatePendingJob(job: PendingJob, reason: string): Promise<void> {
    console.warn('[Social Archiver] Removing duplicate pending job before submission', {
      jobId: job.id,
      url: job.url,
      platform: job.platform,
      reason,
    });

    await this.pendingJobsManager.removeJob(job.id);
  }

  /**
   * Public getter for ArchiveOrchestrator
   * Used by PostComposer for inline archiving
   */
  get archiveOrchestrator(): ArchiveOrchestrator {
    if (!this.orchestrator) {
      throw new Error('ArchiveOrchestrator not initialized. Please configure API settings.');
    }
    return this.orchestrator;
  }

  /**
   * Optional getter for ArchiveOrchestrator (returns undefined if not initialized)
   * Used when orchestrator is optional (e.g., edit mode without inline archiving)
   */
  get archiveOrchestratorOptional(): ArchiveOrchestrator | undefined {
    return this.orchestrator;
  }

  /**
   * Public getter for WorkersAPIClient
   * Used by ArchiveModal for profile crawl requests
   */
  get workersApiClient(): WorkersAPIClient {
    if (!this.apiClient) {
      throw new Error('WorkersAPIClient not initialized. Please configure API settings.');
    }
    return this.apiClient;
  }

  async onload(): Promise<void> {
    await this.loadSettings();

    // Initialize services if API endpoint is configured
    await this.initializeServices();

    // Sync user credits and tier from server (if authenticated)
    await this.syncUserCreditsOnLoad();

    // Check for version update and show release notes if applicable
    await this.checkAndShowReleaseNotes();

    // Register Timeline View
    this.registerView(
      VIEW_TYPE_TIMELINE,
      (leaf) => new TimelineView(leaf, this)
    );

    // Register Media Gallery View 2 (Simple ItemView)
    this.registerView(
      VIEW_TYPE_MEDIA_GALLERY_2,
      (leaf) => new MediaGalleryView2(leaf, this)
    );

    // Register Media Gallery Bases View
    this.registerBasesView(VIEW_TYPE_MEDIA_GALLERY, {
      name: 'Media Gallery',
      icon: 'lucide-images',
      factory: (controller, containerEl) => {
        return new MediaGalleryView(controller, containerEl);
      },
      options: () => ([
        {
          type: 'dropdown' as const,
          displayName: 'Media type',
          key: 'mediaType',
          default: 'all',
          options: {
            'all': 'All media',
            'images': 'Images only',
            'videos': 'Videos only'
          } as Record<string, string>
        },
        {
          type: 'dropdown' as const,
          displayName: 'Layout',
          key: 'layout',
          default: 'grid',
          options: {
            'grid': 'Grid',
            'masonry': 'Masonry'
          } as Record<string, string>
        },
        {
          type: 'slider' as const,
          displayName: 'Columns',
          key: 'columns',
          min: 2,
          max: 10,
          default: 3,
          step: 1
        }
      ])
    });

    // Add ribbon icon for archive (using Lucide bookmark-plus)
    this.addRibbonIcon('bookmark-plus', 'Archive social media post', () => {
      this.openArchiveModal();
    });

    // Add ribbon icon for timeline
    // On mobile: opens in main area (full screen)
    // On desktop: opens in sidebar (side-by-side with notes)
    this.addRibbonIcon('calendar-clock', 'Open timeline view', () => {
      const location = ObsidianPlatform.isMobile ? 'main' : 'sidebar';
      void this.activateTimelineView(location);
    });

    // Delegate command registration to extracted module
    registerCommands({
      app: this.app,
      plugin: this,
      openArchiveModal: (url) => this.openArchiveModal(url),
      activateTimelineView: (loc) => this.activateTimelineView(loc),
      refreshAllTimelines: () => this.refreshAllTimelines(),
      batchArchiveGoogleMapsLinks: (content, path) => this.batchArchiveGoogleMapsLinks(content, path),
      startBatchTranscription: (mode) => this.startBatchTranscription(mode),
      getBatchTranscriptionManager: () => this.batchTranscriptionManager,
      postCurrentNote: () => this.postCurrentNote(),
      postAndShareCurrentNote: () => this.postAndShareCurrentNote(),
      getEditorTTSController: () => this.editorTTSController,
    });

    // Add settings tab
    this.settingTab = new SocialArchiverSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    // Initialize BatchTranscriptionManager (Desktop only)
    if (!ObsidianPlatform.isMobile) {
      this.initBatchTranscriptionManager();
    }

    // Initialize Editor TTS Controller (gated by feature flag)
    if (FEATURE_EDITOR_TTS_ENABLED) {
      this.editorTTSController = new EditorTTSController(this.app, this);
      this.registerEditorExtension(this.editorTTSController.getEditorExtension());

      registerEditorTTSMenu({ plugin: this, getEditorTTSController: () => this.editorTTSController });
    }

    // Register protocol handler for mobile share
    this.registerProtocolHandler();

    // Startup job recovery - check for incomplete jobs from previous session
    this.pendingJobOrchestrator?.checkPendingJobs().catch(error => {
      console.error('[Social Archiver] Startup job recovery failed:', error);
    });

    // Sync completed pending jobs from server (for cross-device recovery)
    if (this.settings.enableServerPendingJobs) {
      this.pendingJobOrchestrator?.syncPendingJobsFromServer().catch(error => {
        console.error('[Social Archiver] Server pending jobs sync failed:', error);
      });
    }

    // Start periodic job checker (interval from settings)
    this.jobCheckInterval = window.setInterval(() => {
      this.pendingJobOrchestrator?.checkPendingJobs().catch(error => {
        console.error('[Social Archiver] Periodic job check failed:', error);
      });
    }, this.settings.jobCheckInterval);
  }

  onunload(): void {
    // Kill all spawned child processes (yt-dlp, whisper, etc.)
    const killedCount = ProcessManager.killAll();
    if (killedCount > 0) {
      console.debug(`[SocialArchiver] Killed ${killedCount} active processes on unload`);
    }

    // Clear WebSocket listeners
    this.realtimeEventBridge?.clear();

    // Disconnect WebSocket
    this.realtimeClient?.disconnect();

    // Stop periodic job checker
    if (this.jobCheckInterval) {
      window.clearInterval(this.jobCheckInterval);
      this.jobCheckInterval = undefined;
    }

    // Clear sync debounce timer
    if (this.syncDebounceTimer) {
      window.clearTimeout(this.syncDebounceTimer);
      this.syncDebounceTimer = undefined;
    }

    // Clear WebSocket post batch timer
    if (this.wsPostBatchTimer) {
      window.clearTimeout(this.wsPostBatchTimer);
      this.wsPostBatchTimer = undefined;
    }

    // Dispose CrawlJobTracker (clears completion timers and listeners)
    this.crawlJobTracker?.dispose();

    // Dispose ArchiveJobTracker
    this.archiveJobTracker?.destroy();

    // Stop Naver local subscription poller (blog + cafe)
    void this.naverPoller?.stop();

    // Stop Brunch local subscription poller
    void this.brunchPoller?.stop();

    // Stop Webtoon sync service
    void this.webtoonSyncService?.stop();

    // Clear all tracked pending timeouts
    for (const id of this.pendingTimeouts) {
      window.clearTimeout(id);
    }
    this.pendingTimeouts.clear();

    // Dispose batch transcription
    this.batchTranscriptionNotice?.dismiss();
    this.batchTranscriptionNotice = null;
    this.batchTranscriptionManager?.dispose();
    this.batchTranscriptionManager = null;

    // Dispose Editor TTS
    if (this.editorTTSController) {
      void this.editorTTSController.destroy();
      this.editorTTSController = undefined;
    }

    // Clear dedup URL set
    this.recentlyArchivedUrls.clear();

    // Clear mobile sync state
    this.mobileSyncService?.clearState();

    // Cancel archive library sync (preserve checkpoint for next startup)
    this.archiveLibrarySyncService?.cancel();

    // Dispose archive delete sync service
    this.archiveDeleteSyncService?.dispose();
    this.archiveDeleteSyncService = null;

    // Cleanup annotation sync services
    this.annotationOutboundService?.stop();
    this.annotationOutboundService = undefined;
    this.archiveTagOutboundService?.stop();
    this.archiveTagOutboundService = undefined;
    this.archiveStateOutboundService?.stop();
    this.archiveStateOutboundService = undefined;
    this.archiveStateSyncService = undefined;
    this.archiveLookupService?.destroy();
    this.archiveLookupService = undefined;
    this.annotationSyncService = undefined;

    // Cleanup services (fire-and-forget; onunload must be synchronous per Obsidian Plugin API)
    void this.subscriptionManager?.dispose();
    this.pendingJobsManager?.dispose();
    void this.orchestrator?.dispose();
    void this.apiClient?.dispose();
  }

  async loadSettings(): Promise<void> {
    const rawData: unknown = await this.loadData();
    const savedData: Partial<SocialArchiverSettings> = (rawData ?? {}) as Partial<SocialArchiverSettings>;
    this.settings = migrateSettings(savedData);

    // Rebuild naverCookie from individual fields (in case migration populated them)
    this.rebuildNaverCookie();
  }

  /**
   * Rebuild the naverCookie string from nidAut and nidSes fields
   */
  private rebuildNaverCookie(): void {
    const parts: string[] = [];
    if (this.settings.nidAut) {
      parts.push(`NID_AUT=${this.settings.nidAut}`);
    }
    if (this.settings.nidSes) {
      parts.push(`NID_SES=${this.settings.nidSes}`);
    }
    this.settings.naverCookie = parts.join('; ');
  }

  async saveSettings(): Promise<void> {
    await this.saveSettingsPartial({}, { reinitialize: true, notify: true });
  }

  async saveSettingsPartial(
    partial: Partial<SocialArchiverSettings>,
    options: { reinitialize?: boolean; notify?: boolean } = {}
  ): Promise<void> {
    this.settings = { ...this.settings, ...partial };
    await this.saveData(this.settings);

    if (options.reinitialize) {
      await this.initializeServices();
    }

    if (options.notify) {
      this.events.trigger('settings-changed', this.settings);
    }
  }

  /**
   * Check for version updates and show release notes modal if applicable
   */
  private async checkAndShowReleaseNotes(): Promise<void> {
    const currentVersion = this.manifest.version;
    const lastSeenVersion = this.settings.lastSeenVersion;
    const isDebugMode = this.settings.debugAlwaysShowReleaseNotes;

    // Check if release notes exist for this version
    const releaseNote = RELEASE_NOTES[currentVersion];

    // DEV: Always show if debug mode is enabled and release notes exist
    if (isDebugMode && releaseNote) {
      const modal = new ReleaseNotesModal(this.app, currentVersion, releaseNote);
      modal.open();
      return;
    }

    // Same version - no update needed
    if (currentVersion === lastSeenVersion) {
      return;
    }

    // User disabled release notes - just update the version silently
    if (!this.settings.showReleaseNotes) {
      await this.saveSettingsPartial({ lastSeenVersion: currentVersion });
      return;
    }

    if (!releaseNote) {
      // No release notes for this version (minor patch) - update silently
      await this.saveSettingsPartial({ lastSeenVersion: currentVersion });
      return;
    }

    // Show release notes modal
    const modal = new ReleaseNotesModal(
      this.app,
      currentVersion,
      releaseNote,
      () => {
        // Update lastSeenVersion after modal closes
        void this.saveSettingsPartial({ lastSeenVersion: currentVersion });
      }
    );
    modal.open();
  }

  /**
   * Sync user credits and tier from server on plugin load
   */
  private async syncUserCreditsOnLoad(): Promise<void> {
    if (!this.settings.authToken || !this.settings.isVerified) {
      return;
    }

    try {
      await refreshUserCredits(this);
    } catch (error) {
      // Silently fail - don't block plugin initialization
      console.warn('[Social Archiver] Failed to sync user credits:', error);
    }
  }

  /**
   * Initialize API client and orchestrator
   */
  private async initializeServices(): Promise<void> {
    // Clean up existing services
    this.apiClient?.dispose();
    await this.orchestrator?.dispose();
    this.pendingJobsManager?.dispose();

    try {
      // Initialize API client with hardcoded production endpoint
      this.apiClient = new WorkersAPIClient({
        endpoint: API_ENDPOINT,
        authToken: this.settings.authToken,
        pluginVersion: this.manifest.version,
        clientId: this.settings.syncClientId || undefined,
      });
      this.apiClient.initialize();

      // Initialize PendingJobsManager (for async archiving)
      this.pendingJobsManager = new PendingJobsManager(this.app);
      await this.pendingJobsManager.initialize();

      // Initialize CrawlJobTracker for profile crawl progress tracking
      this.crawlJobTracker = new CrawlJobTracker();

      // Initialize ArchiveJobTracker for archive progress banner
      this.archiveJobTracker = new ArchiveJobTracker();

      // Initialize TagStore for user-defined tag management
      this.tagStore = new TagStore(this.app, this);

      // Initialize ArchiveLookupService for mobile annotation sync file resolution
      this.archiveLookupService?.destroy();
      this.archiveLookupService = new ArchiveLookupService(this.app);
      this.archiveLookupService.initialize();

      // Initialize AnnotationSyncService (syncs mobile notes -> comment frontmatter + annotation block)
      const annotationRenderer = new AnnotationRenderer();
      const annotationSectionManager = new AnnotationSectionManager();
      this.annotationSyncService = new AnnotationSyncService(
        this.app,
        this.apiClient,
        this.archiveLookupService,
        annotationRenderer,
        annotationSectionManager,
        () => this.settings
      );

      // Initialize AnnotationOutboundService (syncs comment edits -> server primary note)
      this.annotationOutboundService?.stop();
      this.annotationOutboundService = new AnnotationOutboundService(
        this.app,
        this.apiClient,
        this.archiveLookupService,
        () => this.settings
      );

      // Wire suppression: inbound sync notifies outbound service before writing
      this.annotationSyncService.onBeforeInboundWrite = (archiveId: string) => {
        this.annotationOutboundService?.addSuppression(archiveId);
      };

      // Start listening for comment changes to sync outbound
      this.annotationOutboundService.start();

      // Initialize ArchiveTagOutboundService (syncs archiveTags frontmatter edits → server)
      this.archiveTagOutboundService?.stop();
      this.archiveTagOutboundService = new ArchiveTagOutboundService(
        this.app,
        this.apiClient,
        this.archiveLookupService,
        () => this.settings
      );
      this.archiveTagOutboundService.start();

      // Initialize ArchiveStateSyncService (syncs inbound isBookmarked → fm.archive)
      this.archiveStateSyncService = new ArchiveStateSyncService(
        this.app,
        this.apiClient,
        this.archiveLookupService,
        () => this.settings,
      );

      // Initialize ArchiveStateOutboundService (syncs fm.archive edits → server isBookmarked)
      this.archiveStateOutboundService?.stop();
      this.archiveStateOutboundService = new ArchiveStateOutboundService(
        this.app,
        this.apiClient,
        this.archiveLookupService,
        () => this.settings,
      );
      this.archiveStateOutboundService.start();

      // Wire suppression: inbound sync notifies outbound service before writing
      // so the MetadataCache.changed echo is ignored by ArchiveStateOutboundService.
      this.archiveStateSyncService.onBeforeInboundWrite = (archiveId: string) => {
        this.archiveStateOutboundService?.addSuppression(archiveId);
      };
      this.archiveStateSyncService.onAfterInboundWrite = () => {
        this.refreshTimelineView();
      };

      // Restore active jobs from previous session
      const allPendingJobs = await this.pendingJobsManager.getJobs();
      const activeProfileCrawls = allPendingJobs.filter(
        job => job.metadata?.type === 'profile-crawl' && job.status === 'processing'
      );
      if (activeProfileCrawls.length > 0) {
        this.crawlJobTracker.restoreFromPendingJobs(activeProfileCrawls);
      }
      this.archiveJobTracker.restoreFromPendingJobs(allPendingJobs);

      // Initialize LinkPreviewExtractor (always available, no API dependency)
      this.linkPreviewExtractor = new LinkPreviewExtractor({
        maxLinks: 2,
        excludeImages: true,
        excludePlatformUrls: false
      });
      this.linkPreviewExtractor.initialize();

      // Initialize ArchiveOrchestrator with all required services
      const { ArchiveService } = await import('./services/ArchiveService');
      const { MediaHandler } = await import('./services/MediaHandler');

      const archiveService = new ArchiveService({
        apiClient: this.apiClient as unknown as import('./services/ApiClient').ApiClient,
      });

      const markdownConverter = new MarkdownConverter({
        frontmatterSettings: this.settings.frontmatter,
      });

      const vaultManager = new VaultManager({
        vault: this.app.vault,
        app: this.app,
        basePath: this.settings.archivePath || 'Social Archives',
        organizationStrategy: getVaultOrganizationStrategy(this.settings.archiveOrganization),
        fileNameFormat: this.settings.fileNameFormat,
      });

      const mediaHandler = new MediaHandler({
        vault: this.app.vault,
        app: this.app,
        workersClient: this.apiClient,
        basePath: this.settings.mediaPath || 'attachments/social-archives',
        optimizeImages: true,
        imageQuality: 0.8,
        maxImageDimension: 2048
      });

      // Create AuthorAvatarService for author profile image management
      this.authorAvatarService = new AuthorAvatarService({
        vault: this.app.vault,
        app: this.app,
        settings: this.settings,
        workerApiUrl: API_ENDPOINT,
      });

      this.orchestrator = new ArchiveOrchestrator({
        archiveService,
        markdownConverter,
        vaultManager,
        mediaHandler,
        linkPreviewExtractor: this.linkPreviewExtractor,
        authorAvatarService: this.authorAvatarService,
        settings: this.settings,
      });

      await this.orchestrator.initialize();

      // ── Create extracted module instances ──────────────────────────────

      // Create MediaPathResolver
      this.mediaPathResolver = new MediaPathResolver({ app: this.app });

      // Create LocalArchiveCoordinator
      this.localArchiveCoordinator = new LocalArchiveCoordinator({
        app: this.app,
        settings: () => this.settings,
        authorAvatarService: () => this.authorAvatarService,
        archiveJobTracker: this.archiveJobTracker,
        refreshTimelineView: () => this.refreshTimelineView(),
        ensureFolderExists: (path) => this.ensureFolderExists(path),
      });

      // Create ArchiveCompletionService
      this.archiveCompletionService = new ArchiveCompletionService({
        app: this.app,
        settings: () => this.settings,
        pendingJobsManager: this.pendingJobsManager,
        archiveJobTracker: this.archiveJobTracker,
        apiClient: () => this.apiClient,
        authorAvatarService: () => this.authorAvatarService,
        tagStore: this.tagStore,
        refreshTimelineView: () => this.refreshTimelineView(),
        refreshCredits: async () => { await refreshUserCredits(this); },
      });

      // Create MobileSyncService
      this.mobileSyncService = new MobileSyncService({
        apiClient: () => this.apiClient,
        settings: () => ({ syncClientId: this.settings.syncClientId, archivePath: this.settings.archivePath }),
        saveSubscriptionPost: (post) => this.saveSubscriptionPost(post),
        convertUserArchiveToPostData: (archive) => this.convertUserArchiveToPostData(archive),
        hasRecentlyArchivedUrl: (url) => this.hasRecentlyArchivedUrl(url),
        refreshTimelineView: () => this.refreshTimelineView(),
        suppressTimelineRefresh: () => {
          for (const leaf of this.app.workspace.getLeavesOfType('social-archiver-timeline')) {
            const view = leaf.view;
            if (view && 'suppressAutoRefresh' in view && typeof view.suppressAutoRefresh === 'function') {
              (view as { suppressAutoRefresh: () => void }).suppressAutoRefresh();
            }
          }
        },
        resumeTimelineRefresh: (triggerRefresh = true) => {
          for (const leaf of this.app.workspace.getLeavesOfType('social-archiver-timeline')) {
            const view = leaf.view;
            if (view && 'resumeAutoRefresh' in view && typeof view.resumeAutoRefresh === 'function') {
              (view as { resumeAutoRefresh: (trigger?: boolean) => void }).resumeAutoRefresh(triggerRefresh);
            }
          }
        },
        schedule: (cb, delay) => this.scheduleTrackedTimeout(cb, delay),
        notify: (msg, timeout) => new Notice(msg, timeout),
      });

      // Create SubscriptionSyncService
      this.subscriptionSyncService = new SubscriptionSyncService({
        app: this.app,
        settings: () => this.settings,
        subscriptionManager: this.subscriptionManager,
        apiClient: () => this.apiClient,
        authorAvatarService: () => this.authorAvatarService,
        archiveCompletionService: this.archiveCompletionService,
        refreshTimelineView: () => this.refreshTimelineView(),
        ensureFolderExists: (path) => this.ensureFolderExists(path),
        notify: (msg, timeout) => new Notice(msg, timeout),
      });

      // Create BatchGoogleMapsArchiver
      this.batchGoogleMapsArchiver = new BatchGoogleMapsArchiver({
        app: this.app,
        settings: () => this.settings,
        apiClient: () => this.apiClient,
        pendingJobsManager: this.pendingJobsManager,
        archiveCompletionService: this.archiveCompletionService,
        refreshTimelineView: () => this.refreshTimelineView(),
        ensureFolderExists: (path) => this.ensureFolderExists(path),
        notify: (msg, timeout) => new Notice(msg, timeout),
      });

      // Create PostShareService
      this.postShareService = new PostShareService({
        app: this.app,
        settings: () => this.settings,
        manifest: this.manifest,
        refreshTimelineView: () => this.refreshTimelineView(),
      });

      // Create ArchiveLibrarySyncService
      this.archiveLibrarySyncService = new ArchiveLibrarySyncService({
        apiClient: () => this.apiClient,
        settings: () => this.settings,
        saveSettings: () => this.saveSettingsPartial({}, { reinitialize: false, notify: false }),
        findBySourceArchiveId: (id) => this.archiveLookupService?.findBySourceArchiveId(id) ?? null,
        findByOriginalUrl: (url) => this.archiveLookupService?.findByOriginalUrl(url) ?? [],
        findByClientPostId: (clientPostId) => this.archiveLookupService?.findByClientPostId(clientPostId) ?? null,
        indexSavedFile: (file, data) => this.archiveLookupService?.indexSavedFile(file, data),
        backfillFileIdentity: (file, archiveId) =>
          this.archiveLookupService?.backfillFileIdentity(file, archiveId) ?? Promise.resolve(),
        saveSubscriptionPostDetailed: (post) =>
          this.subscriptionSyncService?.saveSubscriptionPostDetailed(post) ??
          Promise.resolve({ status: 'failed' as const, reason: 'service-not-ready' }),
        convertUserArchiveToPostData: (archive) => convertUserArchiveToPostData(archive),
        notify: (msg, timeout) => new Notice(msg, timeout),
        isArchiveQueuedForDeletion: (id) => this.archiveDeleteSyncService?.isArchiveQueuedForDeletion(id) ?? false,
        applyInboundDeletedIds: async (deletedIds, source) => {
          for (const id of deletedIds) {
            await this.archiveDeleteSyncService?.handleInboundDelete(id, undefined, source);
          }
        },
        reconcileArchiveState: (file, archiveId, isBookmarked) =>
          this.archiveStateSyncService?.reconcileFromLibrarySync(file, archiveId, isBookmarked) ??
          Promise.resolve(),
      });

      // Create ArchiveDeleteSyncService
      this.archiveDeleteSyncService = new ArchiveDeleteSyncService({
        apiClient: () => this.apiClient,
        settings: () => this.settings,
        saveSettings: () => this.saveSettingsPartial({}, { reinitialize: false }),
        app: this.app,
        findBySourceArchiveId: (id) => this.archiveLookupService?.findBySourceArchiveId(id) ?? null,
        findByOriginalUrl: (url) => this.archiveLookupService?.findByOriginalUrl(url) ?? [],
        isLibrarySyncRunning: () => this.archiveLibrarySyncService?.isRunning ?? false,
        notify: (msg, timeout) => new Notice(msg, timeout),
      });

      // Initialize ArchiveDeleteSyncService (must happen after archiveLookupService is initialized)
      if (this.archiveLookupService) {
        this.archiveDeleteSyncService.initialize(
          this.archiveLookupService.onArchivedFileDeleted.bind(this.archiveLookupService)
        );
      }

      // Create PendingJobOrchestrator
      // Services below are guaranteed initialized above in this method.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- initialized above
      const completionService = this.archiveCompletionService!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- initialized above
      const localCoordinator = this.localArchiveCoordinator!;

      this.pendingJobOrchestrator = new PendingJobOrchestrator({
        pendingJobsManager: this.pendingJobsManager,
        apiClient: () => this.apiClient,
        settings: () => this.settings,
        archiveJobTracker: this.archiveJobTracker,
        processingJobs: this.processingJobs,
        processCompletedJob: (job, payload) => completionService.processCompletedJob(job, payload),
        processFailedJob: (job, msg) => completionService.processFailedJob(job, msg),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- batch result shape is loosely typed
        processBatchArchiveResult: (result, id, path) => this.processBatchArchiveResult(result, id, path),
        fetchNaverCafeLocally: (...args) => localCoordinator.fetchNaverCafeLocally(...args),
        fetchNaverBlogLocally: (...args) => localCoordinator.fetchNaverBlogLocally(...args),
        fetchBrunchLocally: (...args) => localCoordinator.fetchBrunchLocally(...args),
        fetchNaverWebtoonLocally: (...args) => localCoordinator.fetchNaverWebtoonLocally(...args),
        markRecentlyArchivedUrl: (url) => this.markRecentlyArchivedUrl(url),
        buildPendingJobDedupKey: (job) => this.buildPendingJobDedupKey(job),
        removeDuplicatePendingJob: (job, reason) => this.removeDuplicatePendingJob(job, reason),
        schedule: (cb, delay) => this.scheduleTrackedTimeout(cb, delay),
        notify: (msg, timeout) => new Notice(msg, timeout),
      });

      // ── Initialize RealtimeClient & EventBridge ───────────────────────

      if (this.realtimeClient) {
        this.realtimeEventBridge?.clear();
        this.realtimeClient.disconnect();
        this.realtimeClient = undefined;
      }

      if (this.settings.username) {
        // Create ticket fetcher for private WS channel (requires auth)
        const ticketFetcher = this.settings.authToken
          ? async () => {
              try {
                if (!this.apiClient) return null;
                const result = await this.apiClient.getWsTicket();
                return result.ticket;
              } catch {
                return null;
              }
            }
          : undefined;

        this.realtimeClient = new RealtimeClient(
          API_ENDPOINT,
          this.settings.username,
          this.events,
          ticketFetcher
        );

        // Set up RealtimeEventBridge
        // Need a reference to `this` for the reactive accessors below
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;

        if (this.realtimeEventBridge) {
          this.realtimeEventBridge.clear();
        }
        this.realtimeEventBridge = new RealtimeEventBridge({
          events: this.events,
          pendingJobsManager: this.pendingJobsManager,
          archiveJobTracker: this.archiveJobTracker,
          crawlJobTracker: this.crawlJobTracker,
          subscriptionManager: this.subscriptionManager,
          archiveLookupService: this.archiveLookupService,
          annotationSyncService: this.annotationSyncService,
          archiveStateSyncService: this.archiveStateSyncService,
          archiveDeleteSyncService: this.archiveDeleteSyncService ?? undefined,
          archiveTagOutboundService: this.archiveTagOutboundService,
          app: this.app,
          settings: () => this.settings,
          apiClient: () => this.apiClient,
          processCompletedJob: (job, payload) => completionService.processCompletedJob(job, payload),
          processFailedJob: (job, msg) => completionService.processFailedJob(job, msg),
          saveSubscriptionPost: (post) => this.saveSubscriptionPost(post),
          syncSubscriptionPosts: () => this.syncSubscriptionPosts(),
          createProfileNote: (msg) => this.createProfileNote(msg),
          refreshTimelineView: () => this.refreshTimelineView(),
          processPendingSyncQueue: () => this.mobileSyncService?.processPendingSyncQueue() ?? Promise.resolve(),
          processSyncQueueItem: (queueId, archiveId, clientId) =>
            this.mobileSyncService?.processSyncQueueItem(queueId, archiveId, clientId) ?? Promise.resolve(false),
          getReadableErrorMessage: (code, msg) => this.getReadableErrorMessage(code, msg),
          processingJobs: this.processingJobs,
          notify: (msg, timeout) => new Notice(msg, timeout),
          schedule: (cb, delay) => this.scheduleTrackedTimeout(cb, delay),
          currentCrawlWorkerJobId: {
            get value() { return self.currentCrawlWorkerJobId; },
            set value(v) { self.currentCrawlWorkerJobId = v; },
          },
          wsPostBatchCount: {
            get value() { return self.wsPostBatchCount; },
            set value(v) { self.wsPostBatchCount = v; },
          },
          wsPostBatchTimer: {
            get value() { return self.wsPostBatchTimer; },
            set value(v) { self.wsPostBatchTimer = v; },
          },
        });
        this.realtimeEventBridge.setup();

        // Connect to WebSocket (async - private channel needs ticket fetch)
        void this.realtimeClient.connect();
      }

      // Initialize SubscriptionManager for pending posts sync
      if (this.settings.authToken && this.settings.username) {
        this.subscriptionManager = new SubscriptionManager({
          apiBaseUrl: API_ENDPOINT,
          authToken: this.settings.authToken,
          enablePolling: false
        });
        await this.subscriptionManager.initialize();

        // Sync pending subscription posts on startup (delayed to not block UI)
        this.scheduleTrackedTimeout(() => { void this.syncSubscriptionPosts(); }, 3000);

        // Catch up on pending mobile sync queue items missed while offline
        if (this.settings.syncClientId) {
          this.scheduleTrackedTimeout(() => { void this.mobileSyncService?.processPendingSyncQueue(); }, 5000);
        }

        // Auto-start Archive Library Sync on startup if applicable
        if (this.settings.syncClientId) {
          const libSync = this.settings.archiveLibrarySync;
          const shouldAutoStart =
            // Never completed — covers fresh bootstrap AND interrupted runs
            // (lastStatus may be 'idle', 'running', or 'error' — all need sync)
            !libSync || !libSync.completedAt;

          if (shouldAutoStart) {
            // Delay to let services fully initialise before starting sync
            this.scheduleTrackedTimeout(() => {
              void (async () => {
                await this.archiveDeleteSyncService?.flushPendingDeletes();
                await this.archiveLibrarySyncService?.startSync();
              })();
            }, 8000);
          }
        }

        // Start Naver local subscription poller (blog + cafe)
        if (this.settings.naverCookie) {
          if (this.naverPoller) {
            console.debug('[Social Archiver] Stopping existing NaverPoller before restart');
            void this.naverPoller.stop();
          }
          this.naverPoller = new NaverSubscriptionPoller(this);
          void this.naverPoller.start();
        }

        // Start Brunch local subscription poller
        {
          if (this.brunchPoller) {
            console.debug('[Social Archiver] Stopping existing BrunchPoller before restart');
            void this.brunchPoller.stop();
          }
          this.brunchPoller = new BrunchSubscriptionPoller(this);
          void this.brunchPoller.start();
        }

        // Start Webtoon sync service
        {
          if (this.webtoonSyncService) {
            console.debug('[Social Archiver] Stopping existing WebtoonSyncService before restart');
            void this.webtoonSyncService.stop();
          }
          this.webtoonSyncService = new WebtoonSyncService(this);
          void this.webtoonSyncService.start();
        }
      }

    } catch {
      new Notice('Failed to initialize Social Archiver. Check console for details.');
    }
  }

  // ============================================================================
  // Subscription Sync
  // ============================================================================

  /**
   * Sync pending subscription posts from server to vault
   */
  /**
   * Check pending jobs and process completions.
   * Public API used by ArchiveModal, TimelineContainer, PostCardRenderer.
   */
  async checkPendingJobs(): Promise<void> {
    return this.pendingJobOrchestrator?.checkPendingJobs();
  }

  async syncSubscriptionPosts(): Promise<void> {
    await this.subscriptionSyncService?.syncSubscriptionPosts();
  }

  // ============================================================================
  // Profile Note
  // ============================================================================

  /**
   * Create a profile-only note when posts fail to load
   */
  private async createProfileNote(message: WsProfileMetadataMessage): Promise<void> {
    await this.subscriptionSyncService?.createProfileNote(message);
  }

  // ============================================================================
  // Save Subscription Post
  // ============================================================================

  /**
   * Save a single subscription post to vault
   */
  private async saveSubscriptionPost(pendingPost: PendingPost): Promise<boolean> {
    if (!this.subscriptionSyncService) return false;
    return this.subscriptionSyncService.saveSubscriptionPost(pendingPost);
  }

  // ============================================================================
  // User Archive Conversion
  // ============================================================================

  convertUserArchiveToPostData(archive: UserArchive): PostData {
    return convertUserArchiveToPostData(archive);
  }

  // ============================================================================
  // View Management
  // ============================================================================

  /**
   * Refresh Timeline View if it exists
   */
  public refreshTimelineView(): void {
    const leaves = this.app.workspace.getLeavesOfType('social-archiver-timeline');
    if (leaves.length > 0) {
      if (ObsidianPlatform.isMobile) {
        leaves.forEach(leaf => {
          const view = leaf.view;
          if (view && 'refresh' in view && typeof view.refresh === 'function') {
            (view.refresh as () => void)();
          }
        });
      } else {
        void this.activateTimelineView();
      }
    }
  }

  /**
   * Open the archive modal
   */
  public openArchiveModal(initialUrl?: string): void {
    if (initialUrl) {
      const webtoonService = new NaverWebtoonLocalService();
      const urlInfo = webtoonService.parseUrl(initialUrl);
      if (urlInfo) {
        const modal = new WebtoonArchiveModal(this.app, this, initialUrl);
        modal.open();
        return;
      }
    }

    const modal = new ArchiveModal(this.app, this, initialUrl);
    modal.open();
  }

  /**
   * Open the Webtoon Archive Modal directly
   */
  public openWebtoonArchiveModal(initialUrl?: string): void {
    const modal = new WebtoonArchiveModal(this.app, this, initialUrl);
    modal.open();
  }

  /**
   * Refresh all open timeline views
   */
  public async refreshAllTimelines(): Promise<void> {
    const timelineLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
    for (const leaf of timelineLeaves) {
      const view = leaf.view;
      if (view instanceof TimelineView) {
        await view.refresh();
      }
    }
  }

  /**
   * Resolve local video file paths referenced by a note.
   * Delegates to MediaPathResolver.
   */
  public async resolveLocalVideoPathsInNote(filePath: string): Promise<string[]> {
    return this.mediaPathResolver.resolveLocalVideoPathsInNote(filePath);
  }

  // ============================================================================
  // Batch Transcription
  // ============================================================================

  private initBatchTranscriptionManager(): void {
    const deps: BatchTranscriptionManagerDeps = {
      app: this.app,
      settings: this.settings,
      resolveLocalVideoPathsInNote: (filePath) => this.mediaPathResolver.resolveLocalVideoPathsInNote(filePath),
      collectMarkdownFiles: (folder) => this.collectMarkdownFiles(folder),
      toAbsoluteVaultPath: (path) => this.toAbsoluteVaultPath(path),
      appendTranscriptSection: (content, result) => this.appendTranscriptSection(content, result),
      extractDownloadableVideoUrls: (fm) => this.mediaPathResolver.extractDownloadableVideoUrls(fm),
      downloadMedia: async (media, platform, postId, authorUsername) => {
        const { MediaHandler } = await import('./services/MediaHandler');
        const handler = new MediaHandler({
          vault: this.app.vault,
          app: this.app,
          workersClient: this.apiClient,
          basePath: this.settings.mediaPath,
        });
        return handler.downloadMedia(media, platform as Platform, postId, authorUsername);
      },
      isYtDlpUrl: (url) => {
        return YtDlpDetector.isSupportedUrl(url);
      },
      downloadWithYtDlp: async (url, platform, postId, signal) => {
        if (!await YtDlpDetector.isAvailable()) return null;

        const vaultBasePath = (this.app.vault.adapter as unknown as { basePath: string }).basePath;
        const basePath = this.settings.mediaPath || 'attachments/social-archives';
        const platformFolder = `${basePath}/${platform}`;
        const outputPath = `${vaultBasePath}/${platformFolder}`;

        const folderExists = await this.app.vault.adapter.exists(platformFolder);
        if (!folderExists) {
          await this.app.vault.createFolder(platformFolder);
        }

        const sanitizedPostId = postId.replace(/[^a-z0-9_-]/gi, '_');
        const filename = `${platform}_${sanitizedPostId}_${Date.now()}`;
        const absolutePath = await YtDlpDetector.downloadVideo(url, outputPath, filename, undefined, signal);

        const videoFilename = absolutePath.split(/[/\\]/).pop() || '';
        return `${platformFolder}/${videoFilename}`;
      },
      refreshTimelineView: () => this.refreshTimelineView(),
    };
    this.batchTranscriptionManager = new BatchTranscriptionManager(deps);
    this.batchTranscriptionManager.tryRestore();

    if (this.batchTranscriptionManager.getStatus() === 'paused') {
      new Notice('Interrupted batch transcription restored. Use command palette to resume.', 8000);
    }
  }

  public async startBatchTranscription(mode: BatchMode): Promise<void> {
    if (ObsidianPlatform.isMobile) {
      new Notice('Video transcription batch is only available on desktop.');
      return;
    }

    if (!this.settings.transcription?.enabled) {
      new Notice('Enable Whisper transcription in settings first.');
      return;
    }

    if (!this.batchTranscriptionManager) {
      this.initBatchTranscriptionManager();
    }

    const manager = this.batchTranscriptionManager;
    if (!manager) {
      console.error('[Social Archiver] BatchTranscriptionManager could not be initialized');
      return;
    }

    this.batchTranscriptionNotice?.dismiss();
    this.batchTranscriptionNotice = new BatchTranscriptionNotice(manager);
    this.batchTranscriptionNotice.show();

    await manager.start(mode);
  }

  /**
   * Extract downloadable video URLs from frontmatter media and videoDownloadFailedUrls.
   * Delegates to MediaPathResolver.
   */
  public extractDownloadableVideoUrls(fm: Record<string, unknown>): string[] {
    return this.mediaPathResolver.extractDownloadableVideoUrls(fm);
  }

  /**
   * Legacy batch transcribe (delegates to new manager)
   */
  public async batchTranscribeVideosInNotes(): Promise<void> {
    await this.startBatchTranscription('transcribe-only');
  }

  private collectMarkdownFiles(folder: TFolder): TFile[] {
    const files: TFile[] = [];
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === 'md') {
        files.push(child);
      } else if (child instanceof TFolder) {
        files.push(...this.collectMarkdownFiles(child));
      }
    }
    return files;
  }

  private toAbsoluteVaultPath(vaultPath: string): string {
    const adapter = this.app.vault.adapter as unknown as { basePath?: string };
    const basePath = adapter.basePath || '';
    return basePath ? `${basePath}/${vaultPath}` : vaultPath;
  }

  private appendTranscriptSection(content: string, result: TranscriptionResult): string {
    if (parseTranscriptSections(content).length > 0) {
      return content;
    }

    const body = this.transcriptFormatter.formatWhisperTranscript(result.segments);
    if (!body) {
      return content;
    }

    const normalizedContent = content.replace(/\s+$/, '');
    return `${normalizedContent}\n\n---\n\n## Transcript\n\n${body}\n`;
  }

  // ============================================================================
  // Google Maps Batch Archive
  // ============================================================================

  /**
   * Batch archive Google Maps links from current note
   */
  public async batchArchiveGoogleMapsLinks(content: string, sourceNotePath?: string): Promise<void> {
    await this.batchGoogleMapsArchiver?.batchArchiveGoogleMapsLinks(content, sourceNotePath);
  }

  /**
   * Process batch archive result and create documents
   */
  private async processBatchArchiveResult(
    result: import('./services/WorkersAPIClient').BatchArchiveJobStatusResponse,
    pendingJobId?: string,
    sourceNotePath?: string
  ): Promise<void> {
    await this.batchGoogleMapsArchiver?.processBatchArchiveResult(result, pendingJobId, sourceNotePath);
  }

  // ============================================================================
  // URL & Error Helpers
  // ============================================================================

  private isValidUrl(text: string): boolean {
    const normalized = text.trim();
    if (!normalized) return false;
    try {
      const url = new URL(normalized);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      return detectPlatform(normalized) !== 'post';
    } catch {
      return false;
    }
  }

  getReadableErrorMessage(errorCode: string | undefined, errorMessage: string | undefined): string {
    const fallbackMessages: Record<string, string> = {
      'dead_page': 'This page is unavailable or has been removed',
      'private_account': 'This account is private',
      'blocked': 'Access to this profile is blocked',
      'rate_limited': 'Too many requests. Please try again later',
      'timeout': 'The request timed out. Please try again',
      'not_found': 'Profile not found',
      'login_required': 'This content requires login to view',
      'geo_blocked': 'This content is not available in your region',
      'CRAWL_ERROR': 'Failed to crawl the profile',
    };

    if (errorMessage) {
      return errorMessage;
    }

    if (errorCode && fallbackMessages[errorCode]) {
      return fallbackMessages[errorCode];
    }

    return 'Unknown error occurred';
  }

  // ============================================================================
  // Protocol Handler
  // ============================================================================

  private registerProtocolHandler(): void {
    this.registerObsidianProtocolHandler('social-archive', async (params) => {
      if (params.token) {
        await this.handleAuthCompletion(params);
        return;
      }

      if (params.threads === 'connected') {
        new Notice('Threads account connected successfully!');
        return;
      }

      const url = params.url?.trim();

      if (!url) {
        new Notice('No URL provided');
        return;
      }

      if (!this.isValidUrl(url)) {
        new Notice('Invalid or unsupported URL');
        return;
      }

      this.openArchiveModal(url);
    });
  }

  private async handleAuthCompletion(params: Record<string, string>): Promise<void> {
    const token = params.token;

    if (!token) {
      showAuthError('No authentication token provided');
      return;
    }

    const loadingNotice = new Notice('\uD83D\uDD10 completing authentication...', 0);

    try {
      const result = await completeAuthentication(this, token);

      loadingNotice.hide();

      if (!result.success) {
        showAuthError(result.error || 'Authentication failed');
        return;
      }

      showAuthSuccess(result.username || 'User');

      if (this.settingTab) {
        this.settingTab.display();
      }

      await this.refreshAllTimelines();

      const settingsMessage = ObsidianPlatform.isMobile
        ? '\uD83D\uDCA1 Tap \u2630 menu \u2192 Settings (\u2699\uFE0F) \u2192 Social Archiver to view your account'
        : '\uD83D\uDCA1 Settings updated! Check Social Archiver settings to view your account';

      const noticeDuration = ObsidianPlatform.isMobile ? 10000 : 8000;

      window.setTimeout(() => {
        new Notice(settingsMessage, noticeDuration);
      }, 2000);

    } catch (error) {
      loadingNotice.hide();
      showAuthError(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  // ============================================================================
  // Vault Utilities
  // ============================================================================

  /**
   * Ensure folder exists in vault (thin wrapper around extracted utility)
   */
  async ensureFolderExists(path: string): Promise<void> {
    await ensureFolderExistsUtil(this.app, path);
  }

  /**
   * Activate the Timeline View
   */
  async activateTimelineView(location: 'sidebar' | 'main' = 'sidebar'): Promise<void> {
    const { workspace } = this.app;
    let leaf;

    if (location === 'main') {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({
        type: VIEW_TYPE_TIMELINE,
        active: true,
      });
    } else {
      const existingLeaves = workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
      const sidebarLeaf = existingLeaves.find(l => {
        const parent = l.getRoot();
        return parent === workspace.rightSplit;
      });

      if (sidebarLeaf) {
        leaf = sidebarLeaf;
      } else {
        const rightLeaf = workspace.getRightLeaf(false);
        if (rightLeaf) {
          leaf = rightLeaf;
          await leaf.setViewState({
            type: VIEW_TYPE_TIMELINE,
            active: true,
          });
        }
      }
    }

    if (leaf) {
      void workspace.revealLeaf(leaf);

      const view = leaf.view;
      if (view && 'refresh' in view && typeof view.refresh === 'function') {
        await (view.refresh as () => Promise<void>)();
      }
    }
  }

  // ============================================================================
  // Post to Timeline
  // ============================================================================

  /**
   * Post current note to the timeline (local only)
   */
  private async postCurrentNote(): Promise<void> {
    await this.postShareService?.postCurrentNote();
  }

  /**
   * Post and share current note
   */
  private async postAndShareCurrentNote(): Promise<void> {
    await this.postShareService?.postAndShareCurrentNote();
  }

  // ============================================================================
  // Sign Out & Sync Client
  // ============================================================================

  /**
   * Sign out user and clear all auth state
   */
  async signOut(): Promise<void> {
    // 1. Best-effort unregister sync client (needs authToken - must happen before clearing auth)
    if (this.apiClient && this.settings.syncClientId) {
      try {
        await this.apiClient.deleteSyncClient(this.settings.syncClientId);
        console.debug('[Social Archiver] signOut: unregistered sync client', this.settings.syncClientId);
      } catch (error) {
        console.warn('[Social Archiver] signOut: sync client unregistration failed (best-effort)', error);
      }
    }

    // 2. Disconnect WebSocket gracefully
    this.realtimeEventBridge?.clear();
    this.realtimeClient?.disconnect();
    this.realtimeClient = undefined;

    // 3. Clear auth settings
    this.settings.authToken = '';
    this.settings.username = '';
    this.settings.email = '';
    this.settings.isVerified = false;

    // 4. Clear sync settings
    this.settings.syncClientId = '';

    // 5. Clear usage stats
    this.settings.tier = 'free';
    this.settings.creditsUsed = 0;
    this.settings.byPlatform = {};
    this.settings.byCountry = {};
    this.settings.timingByPlatform = {};

    // 6. Clear Reddit state
    this.settings.redditConnected = false;
    this.settings.redditUsername = '';
    this.settings.redditSyncEnabled = false;

    // 7. Clear runtime sync state
    this.mobileSyncService?.clearState();

    // Cancel and clear archive library sync state (auth cleared, can't resume)
    await this.archiveLibrarySyncService?.cancelAndClear();

    // Clear pending delete queue (stale after sign-out)
    this.archiveDeleteSyncService?.cancelAndClear();

    // 8. Save settings
    await this.saveSettings();

    // 9. Refresh all open timeline views to reflect signed-out state
    await this.refreshAllTimelines();
  }

  /**
   * Register this Obsidian vault as a sync client
   */
  async registerSyncClient(): Promise<{ success: boolean; clientId?: string; error?: string }> {
    if (!this.apiClient) {
      return { success: false, error: 'API client not initialized' };
    }

    if (!this.settings.authToken) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      const vaultName = this.app.vault.getName();
      const clientName = `Obsidian - ${vaultName}`;

      const response = await this.apiClient.registerSyncClient({
        clientType: 'obsidian',
        clientName,
        settings: {
          vaultName,
          platform: ObsidianPlatform.isMobile ? 'mobile' : 'desktop',
          deviceId: this.settings.deviceId,
        },
      });

      if (response.clientId) {
        this.settings.syncClientId = response.clientId;
        await this.saveSettings();
        console.debug('[Social Archiver] Registered sync client:', response.clientId);

        // Auto-start library sync on first registration if not yet completed
        const libSync = this.settings.archiveLibrarySync;
        if (!libSync?.completedAt) {
          this.scheduleTrackedTimeout(() => {
            void (async () => {
              await this.archiveDeleteSyncService?.flushPendingDeletes();
              await this.archiveLibrarySyncService?.startSync('bootstrap');
            })();
          }, 2000);
        }

        return { success: true, clientId: response.clientId };
      }

      return { success: false, error: 'Registration failed' };
    } catch (error) {
      console.error('[Social Archiver] Sync client registration failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Registration failed',
      };
    }
  }

  /**
   * Unregister this vault as a sync client
   */
  async unregisterSyncClient(): Promise<{ success: boolean; error?: string }> {
    if (!this.apiClient) {
      return { success: false, error: 'API client not initialized' };
    }

    const clientId = this.settings.syncClientId;
    if (!clientId) {
      return { success: true };
    }

    try {
      await this.apiClient.deleteSyncClient(clientId);
      this.settings.syncClientId = '';
      // Cancel library sync and clear checkpoint (sync client removed)
      await this.archiveLibrarySyncService?.cancelAndClear();
      await this.saveSettings();
      console.debug('[Social Archiver] Unregistered sync client:', clientId);
      return { success: true };
    } catch (error) {
      console.error('[Social Archiver] Sync client unregistration failed:', error);
      this.settings.syncClientId = '';
      void this.archiveLibrarySyncService?.cancelAndClear();
      await this.saveSettings();
      return { success: true };
    }
  }
}
