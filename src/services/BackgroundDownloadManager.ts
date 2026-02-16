/**
 * BackgroundDownloadManager - Global Background Download Manager
 *
 * Manages webtoon downloads that continue after modal is closed:
 * - Singleton pattern for global state
 * - Status bar integration
 * - Multiple concurrent download queues
 * - Event-based progress notifications
 * - Download persistence and recovery (future)
 */

import type { App } from 'obsidian';
import { Notice } from 'obsidian';
import {
  WebtoonDownloadQueue,
  type DownloadQueueConfig,
  type DownloadProgress,
  type EpisodeDownloadJob,
} from './WebtoonDownloadQueue';
import type { WebtoonAPIInfo, EpisodeDetail } from './NaverWebtoonLocalService';
import type { TimelineView } from '../views/TimelineView';

// ============================================================================
// Types
// ============================================================================

export interface DownloadSession {
  id: string;
  webtoonInfo: WebtoonAPIInfo;
  queue: WebtoonDownloadQueue;
  progress: DownloadProgress;
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
  startedAt: Date;
  completedAt?: Date;
}

export interface DownloadManagerProgress {
  activeSessions: number;
  totalEpisodes: number;
  completedEpisodes: number;
  failedEpisodes: number;
  currentSession: DownloadSession | null;
}

export type DownloadManagerEventType =
  | 'session-added'
  | 'session-started'
  | 'session-progress'
  | 'session-completed'
  | 'session-cancelled'
  | 'session-failed'
  | 'all-completed';

export interface DownloadManagerEventDetail {
  'session-added': { session: DownloadSession };
  'session-started': { session: DownloadSession };
  'session-progress': { session: DownloadSession; progress: DownloadProgress };
  'session-completed': { session: DownloadSession };
  'session-cancelled': { session: DownloadSession };
  'session-failed': { session: DownloadSession; error: string };
  'all-completed': { sessions: DownloadSession[] };
}

// ============================================================================
// BackgroundDownloadManager
// ============================================================================

export class BackgroundDownloadManager extends EventTarget {
  private static instance: BackgroundDownloadManager | null = null;

  private app: App;
  private mediaBasePath: string;
  private config: Partial<DownloadQueueConfig>;
  private sessions: Map<string, DownloadSession> = new Map();
  private isProcessing: boolean = false;
  private statusBarItem: HTMLElement | null = null;

  // Silent download queue for streaming mode
  private silentQueue: Array<{ webtoonInfo: WebtoonAPIInfo; detail: EpisodeDetail }> = [];
  private isSilentProcessing: boolean = false;
  private timelineView: TimelineView | null = null;
  private archivePath: string = 'Social Archives';

  private constructor(
    app: App,
    config: Partial<DownloadQueueConfig> = {},
    mediaBasePath: string = 'attachments/social-archives'
  ) {
    super();
    this.app = app;
    this.config = config;
    this.mediaBasePath = mediaBasePath;
  }

  // ==========================================================================
  // Singleton Pattern
  // ==========================================================================

  static getInstance(
    app?: App,
    config?: Partial<DownloadQueueConfig>,
    mediaBasePath?: string
  ): BackgroundDownloadManager {
    if (!BackgroundDownloadManager.instance) {
      if (!app) {
        throw new Error('BackgroundDownloadManager requires App instance for first initialization');
      }
      BackgroundDownloadManager.instance = new BackgroundDownloadManager(
        app,
        config,
        mediaBasePath
      );
    }
    return BackgroundDownloadManager.instance;
  }

  static hasInstance(): boolean {
    return BackgroundDownloadManager.instance !== null;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Add and start a new download session
   */
  async addSession(
    webtoonInfo: WebtoonAPIInfo,
    episodes: Array<{ no: number; subtitle: string }>
  ): Promise<string> {
    const sessionId = this.generateSessionId(webtoonInfo);

    // Check if session already exists
    const existingSession = this.sessions.get(sessionId);
    if (existingSession && existingSession.status === 'running') {
      new Notice('이미 다운로드 중입니다');
      return sessionId;
    }

    // Create new queue
    const queue = new WebtoonDownloadQueue(this.app, this.config, this.mediaBasePath);
    queue.addEpisodes(episodes);

    // Create session
    const session: DownloadSession = {
      id: sessionId,
      webtoonInfo,
      queue,
      progress: queue.getProgress(),
      status: 'pending',
      startedAt: new Date(),
    };

    // Setup event listeners
    this.setupSessionEvents(session);

    // Store session
    this.sessions.set(sessionId, session);
    this.emit('session-added', { session });

    // Start processing
    void this.processQueue();

    // Update status bar
    this.updateStatusBar();

    return sessionId;
  }

  /**
   * Cancel a specific download session
   */
  cancelSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.status === 'running') {
      session.queue.cancel();
      session.status = 'cancelled';
      session.completedAt = new Date();
      this.emit('session-cancelled', { session });
    }

    this.updateStatusBar();
    return true;
  }

  /**
   * Cancel all active sessions
   */
  cancelAll(): void {
    for (const session of this.sessions.values()) {
      if (session.status === 'running' || session.status === 'pending') {
        this.cancelSession(session.id);
      }
    }
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): DownloadSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions
   */
  getAllSessions(): DownloadSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get active sessions (running or pending)
   */
  getActiveSessions(): DownloadSession[] {
    return this.getAllSessions().filter(
      s => s.status === 'running' || s.status === 'pending'
    );
  }

  /**
   * Get overall progress
   */
  getProgress(): DownloadManagerProgress {
    const activeSessions = this.getActiveSessions();
    let totalEpisodes = 0;
    let completedEpisodes = 0;
    let failedEpisodes = 0;
    let currentSession: DownloadSession | null = null;

    for (const session of activeSessions) {
      const progress = session.queue.getProgress();
      totalEpisodes += progress.totalEpisodes;
      completedEpisodes += progress.completedEpisodes;
      failedEpisodes += progress.failedEpisodes;

      if (session.status === 'running' && !currentSession) {
        currentSession = session;
      }
    }

    return {
      activeSessions: activeSessions.length,
      totalEpisodes,
      completedEpisodes,
      failedEpisodes,
      currentSession,
    };
  }

  /**
   * Check if any downloads are in progress
   */
  isDownloading(): boolean {
    return this.getActiveSessions().length > 0;
  }

  /**
   * Clear completed/cancelled sessions
   */
  clearCompletedSessions(): void {
    for (const [id, session] of this.sessions) {
      if (session.status !== 'running' && session.status !== 'pending') {
        this.sessions.delete(id);
      }
    }
  }

  /**
   * Set status bar element for updates
   */
  setStatusBarItem(statusBarItem: HTMLElement): void {
    this.statusBarItem = statusBarItem;
    this.updateStatusBar();
  }

  // ==========================================================================
  // Silent Download API (for streaming mode)
  // ==========================================================================

  /**
   * Set TimelineView reference for refresh suppression
   */
  setTimelineView(view: TimelineView): void {
    this.timelineView = view;
  }

  /**
   * Set archive path for note creation
   */
  setArchivePath(path: string): void {
    this.archivePath = path;
  }

  /**
   * Add episode to silent download queue (for streaming mode)
   * Downloads in background without UI feedback
   */
  async addSilentDownload(
    webtoonInfo: WebtoonAPIInfo,
    detail: EpisodeDetail
  ): Promise<void> {
    const titleId = String(detail.titleId);
    const episodeNo = detail.no;

    // Skip if already in queue
    const exists = this.silentQueue.some(
      item => String(item.detail.titleId) === titleId && item.detail.no === episodeNo
    );
    if (exists) {
      return;
    }

    // Skip if already downloaded (check for images in folder)
    const episodeFolder = `${this.mediaBasePath}/naver-webtoon/${titleId}/${episodeNo}`;
    const folder = this.app.vault.getAbstractFileByPath(episodeFolder);
    if (folder) {
      const files = (folder as any).children || [];
      const hasImages = files.some((f: any) => f.name && /\.(jpg|jpeg|png|webp|gif)$/i.test(f.name));
      if (hasImages) {
        return;
      }
    }

    // Add to queue
    this.silentQueue.push({ webtoonInfo, detail });

    // Start processing if not already running
    if (!this.isSilentProcessing) {
      void this.processSilentQueue();
    }
  }

  /**
   * Get silent queue status
   */
  getSilentQueueStatus(): { pending: number; processing: boolean } {
    return {
      pending: this.silentQueue.length,
      processing: this.isSilentProcessing
    };
  }

  /**
   * Download episode and wait for markdown creation
   * Returns the file path when complete, or null on failure/timeout
   * Used by streaming mode to create markdown BEFORE streaming
   */
  async downloadEpisodeAndWait(
    webtoonInfo: WebtoonAPIInfo,
    detail: EpisodeDetail,
    options?: { streamFirst?: boolean; timeout?: number }
  ): Promise<{ filePath: string; imageUrls: string[] } | null> {
    const timeout = options?.timeout ?? 30000;
    const streamFirst = options?.streamFirst ?? true;

    // Create a temporary queue for single episode download
    const tempQueue = new WebtoonDownloadQueue(
      this.app,
      { ...this.config, episodeDelay: 0, imageDelay: 50 },
      this.mediaBasePath
    );

    // Add the episode with all metadata
    tempQueue.addEpisodes([{
      no: detail.no,
      subtitle: detail.subtitle,
      thumbnailUrl: detail.thumbnailUrl,
      starScore: detail.starScore,
      serviceDateDescription: detail.serviceDateDescription,
    }]);

    // Wait for markdown creation event
    const result = await new Promise<{ filePath: string; imageUrls: string[] } | null>((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve(null);
      }, timeout);

      tempQueue.addEventListener('markdown-created', ((e: CustomEvent) => {
        clearTimeout(timeoutId);
        resolve({
          filePath: e.detail.filePath,
          imageUrls: e.detail.imageUrls || [],
        });
      }) as EventListener);

      tempQueue.addEventListener('episode-failed', (() => {
        clearTimeout(timeoutId);
        resolve(null);
      }) as EventListener);

      // Start download (fire and forget - events will resolve the promise)
      void tempQueue.start(webtoonInfo, { streamFirst });
    });

    return result;
  }

  /**
   * Process silent download queue
   */
  private async processSilentQueue(): Promise<void> {
    if (this.isSilentProcessing) return;
    this.isSilentProcessing = true;

    // Suppress Timeline refresh during downloads
    this.timelineView?.suppressAutoRefresh();

    try {
      while (this.silentQueue.length > 0) {
        const item = this.silentQueue.shift();
        if (!item) break;

        try {
          await this.downloadEpisodeSilently(item.webtoonInfo, item.detail);
        } catch (error) {
          // Silent failure - continue with next episode
        }

        // Small delay between episodes
        await this.delay(300);
      }
    } finally {
      this.isSilentProcessing = false;
      // Resume refresh without triggering (files are already there)
      this.timelineView?.resumeAutoRefresh(false);
    }
  }

  /**
   * Download episode silently using WebtoonDownloadQueue
   */
  private async downloadEpisodeSilently(
    webtoonInfo: WebtoonAPIInfo,
    detail: EpisodeDetail
  ): Promise<void> {
    // Create a temporary queue for single episode download
    const tempQueue = new WebtoonDownloadQueue(
      this.app,
      { ...this.config, episodeDelay: 0, imageDelay: 50 },
      this.mediaBasePath
    );

    // Add the episode with all metadata
    tempQueue.addEpisodes([{
      no: detail.no,
      subtitle: detail.subtitle,
      thumbnailUrl: detail.thumbnailUrl,
      starScore: detail.starScore,
      serviceDateDescription: detail.serviceDateDescription,
    }]);

    // Run download (this handles all the logic including note creation)
    await tempQueue.start(webtoonInfo);
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Process the download queue (sequential processing)
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (true) {
        // Find next pending session
        const pendingSession = this.getAllSessions().find(s => s.status === 'pending');
        if (!pendingSession) break;

        // Start the session
        pendingSession.status = 'running';
        this.emit('session-started', { session: pendingSession });
        this.updateStatusBar();

        try {
          await pendingSession.queue.start(pendingSession.webtoonInfo);

          // Check final state
          const finalProgress = pendingSession.queue.getProgress();
          if (finalProgress.failedEpisodes === finalProgress.totalEpisodes) {
            pendingSession.status = 'failed';
            this.emit('session-failed', {
              session: pendingSession,
              error: '모든 에피소드 다운로드 실패',
            });
          } else {
            pendingSession.status = 'completed';
            pendingSession.completedAt = new Date();
            this.emit('session-completed', { session: pendingSession });

            // Show completion notice
            new Notice(`✓ ${pendingSession.webtoonInfo.titleName} 다운로드 완료!`);
          }
        } catch (error) {
          // Check if session was cancelled during await (status can change externally)
          const currentStatus = pendingSession.status as string;
          if (currentStatus !== 'cancelled') {
            pendingSession.status = 'failed';
            pendingSession.completedAt = new Date();
            this.emit('session-failed', {
              session: pendingSession,
              error: error instanceof Error ? error.message : 'Unknown error',
            });

            new Notice(`❌ ${pendingSession.webtoonInfo.titleName} 다운로드 실패`);
          }
        }

        this.updateStatusBar();
      }

      // All sessions completed
      const allSessions = this.getAllSessions();
      if (allSessions.length > 0 && !this.getActiveSessions().length) {
        this.emit('all-completed', { sessions: allSessions });
      }
    } finally {
      this.isProcessing = false;
      this.updateStatusBar();
    }
  }

  /**
   * Setup event listeners for a session's queue
   */
  private setupSessionEvents(session: DownloadSession): void {
    const queue = session.queue;

    queue.addEventListener('episode-progress', ((e: CustomEvent) => {
      session.progress = queue.getProgress();
      this.emit('session-progress', { session, progress: session.progress });
      this.updateStatusBar();
    }) as EventListener);

    queue.addEventListener('episode-completed', ((e: CustomEvent) => {
      session.progress = queue.getProgress();
      this.updateStatusBar();
    }) as EventListener);

    queue.addEventListener('episode-failed', ((e: CustomEvent) => {
      session.progress = queue.getProgress();
      console.warn(
        `[BackgroundDownloadManager] Episode failed: ${e.detail.job?.episodeNo} - ${e.detail.error}`
      );
    }) as EventListener);
  }

  /**
   * Update status bar display
   */
  private updateStatusBar(): void {
    if (!this.statusBarItem) return;

    const progress = this.getProgress();

    if (progress.activeSessions === 0) {
      this.statusBarItem.style.display = 'none';
      return;
    }

    this.statusBarItem.style.display = 'inline-block';

    const current = progress.currentSession;
    if (current) {
      const queueProgress = current.queue.getProgress();
      const percent = queueProgress.totalEpisodes > 0
        ? Math.round((queueProgress.completedEpisodes / queueProgress.totalEpisodes) * 100)
        : 0;

      this.statusBarItem.textContent = `📥 ${current.webtoonInfo.titleName} (${percent}%)`;
      this.statusBarItem.title = `다운로드 중: ${queueProgress.completedEpisodes}/${queueProgress.totalEpisodes}화`;
    } else {
      const pendingCount = progress.activeSessions;
      this.statusBarItem.textContent = `📥 대기 중 (${pendingCount}개)`;
      this.statusBarItem.title = `${pendingCount}개 웹툰 다운로드 대기 중`;
    }
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(webtoonInfo: WebtoonAPIInfo): string {
    return `webtoon-${webtoonInfo.titleId}-${Date.now()}`;
  }

  /**
   * Emit typed event
   */
  private emit<T extends DownloadManagerEventType>(
    eventName: T,
    detail: DownloadManagerEventDetail[T]
  ): void {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get or create the background download manager instance
 */
export function getBackgroundDownloadManager(
  app?: App,
  config?: Partial<DownloadQueueConfig>,
  mediaBasePath?: string
): BackgroundDownloadManager {
  return BackgroundDownloadManager.getInstance(app, config, mediaBasePath);
}

/**
 * Check if background download manager has been initialized
 */
export function hasBackgroundDownloadManager(): boolean {
  return BackgroundDownloadManager.hasInstance();
}
