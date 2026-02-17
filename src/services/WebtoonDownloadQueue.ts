/**
 * WebtoonDownloadQueue - Batch Episode Download Service
 *
 * Handles sequential episode downloads with:
 * - Rate limiting to prevent IP bans
 * - Progress tracking via EventTarget
 * - Retry logic with exponential backoff
 * - Cancellation support via AbortController
 */

import { TFile, type App } from 'obsidian';
import {
  NaverWebtoonLocalService,
  type WebtoonAPIInfo,
  type EpisodeDetail,
} from './NaverWebtoonLocalService';
import { NaverWebtoonCommentService } from './NaverWebtoonCommentService';
import type { WebtoonComment } from '../types/webtoon';
import { WorkersAPIClient } from './WorkersAPIClient';
import { DEFAULT_ARCHIVE_PATH } from '@/shared/constants';
import { getPlatformName } from '@/shared/platforms';

// ============================================================================
// Types
// ============================================================================

export interface DownloadQueueConfig {
  /** Delay between episode downloads (ms) - default: 3000 */
  episodeDelay: number;
  /** Delay between image chunks (ms) - default: 200 */
  imageDelay: number;
  /** Number of images to download concurrently - default: 3 */
  concurrentImages: number;
  /** Maximum retry attempts - default: 3 */
  maxRetries: number;
  /** Base retry delay (ms) - default: 1000 */
  retryDelay: number;
  /** Retry backoff multiplier - default: 2 */
  retryBackoff: number;
}

export interface EpisodeDownloadJob {
  episodeNo: number;
  subtitle: string;
  thumbnailUrl?: string;  // Episode list thumbnail (inst_thumbnail)
  starScore?: number;     // Episode rating (from episode list)
  serviceDateDescription?: string;  // Episode date string (e.g., "24.12.25")
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  imageCount?: number;
  currentImage?: number;
  error?: string;
  filePath?: string;
}

export interface DownloadProgress {
  totalEpisodes: number;
  completedEpisodes: number;
  failedEpisodes: number;
  currentEpisode: { no: number; subtitle: string } | null;
  currentImageIndex: number;
  totalImages: number;
  estimatedTimeRemaining?: number;
}

export type DownloadEventType =
  | 'queue-updated'
  | 'episode-started'
  | 'episode-progress'
  | 'episode-completed'
  | 'episode-failed'
  | 'queue-completed'
  | 'queue-cancelled'
  | 'markdown-created';

export interface DownloadEventDetail {
  'queue-updated': { queue: EpisodeDownloadJob[] };
  'episode-started': { job: EpisodeDownloadJob; index: number };
  'episode-progress': { job: EpisodeDownloadJob; imageIndex: number; totalImages: number };
  'episode-completed': { job: EpisodeDownloadJob; index: number; filePath: string };
  'episode-failed': { job: EpisodeDownloadJob; index: number; error: string };
  'queue-completed': { queue: EpisodeDownloadJob[]; completed: number; failed: number };
  'queue-cancelled': { queue: EpisodeDownloadJob[]; completedBeforeCancel: number };
  'markdown-created': {
    job: EpisodeDownloadJob;
    filePath: string;
    imageUrls: string[];
    webtoonInfo: WebtoonAPIInfo;
    episodeDetail: EpisodeDetail;
  };
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: DownloadQueueConfig = {
  episodeDelay: 3000,      // 3 seconds between episodes
  imageDelay: 200,         // 200ms between image chunks
  concurrentImages: 3,     // 3 concurrent image downloads
  maxRetries: 3,           // 3 retry attempts
  retryDelay: 1000,        // 1 second initial retry delay
  retryBackoff: 2,         // Double delay on each retry
};

// ============================================================================
// Download Queue Service
// ============================================================================

export class WebtoonDownloadQueue extends EventTarget {
  private queue: EpisodeDownloadJob[] = [];
  private config: DownloadQueueConfig;
  private isRunning = false;
  private abortController: AbortController | null = null;
  private webtoonService: NaverWebtoonLocalService;
  private commentService: NaverWebtoonCommentService;
  private app: App;
  private mediaBasePath: string;
  private startTime: number = 0;
  private workerClient?: WorkersAPIClient;
  private cookie?: string;
  private streamFirst: boolean = false;

  constructor(
    app: App,
    config: Partial<DownloadQueueConfig> = {},
    mediaBasePath: string = 'attachments/social-archives',
    workerClient?: WorkersAPIClient,
    cookie?: string
  ) {
    super();
    this.app = app;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.mediaBasePath = mediaBasePath;
    this.workerClient = workerClient;
    this.cookie = cookie;
    // Pass cookie for adult (18+) content access
    this.webtoonService = new NaverWebtoonLocalService(cookie);
    this.commentService = new NaverWebtoonCommentService();
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Add episodes to download queue
   */
  addEpisodes(episodes: Array<{
    no: number;
    subtitle: string;
    thumbnailUrl?: string;
    starScore?: number;
    serviceDateDescription?: string;
  }>): void {
    for (const episode of episodes) {
      // Skip if already in queue
      if (this.queue.some(j => j.episodeNo === episode.no)) {
        continue;
      }

      this.queue.push({
        episodeNo: episode.no,
        subtitle: episode.subtitle,
        thumbnailUrl: episode.thumbnailUrl,
        starScore: episode.starScore,
        serviceDateDescription: episode.serviceDateDescription,
        status: 'pending',
      });
    }

    // Sort by episode number (oldest first for chronological archiving)
    this.queue.sort((a, b) => a.episodeNo - b.episodeNo);

    this.emit('queue-updated', { queue: [...this.queue] });
  }

  /**
   * Clear all pending jobs from queue
   */
  clearPending(): void {
    this.queue = this.queue.filter(j => j.status !== 'pending');
    this.emit('queue-updated', { queue: [...this.queue] });
  }

  /**
   * Start downloading queued episodes
   */
  async start(webtoonInfo: WebtoonAPIInfo, options?: { streamFirst?: boolean }): Promise<void> {
    if (this.isRunning) {
      console.warn('[WebtoonDownloadQueue] Already running');
      return;
    }

    this.isRunning = true;
    this.streamFirst = options?.streamFirst ?? false;
    this.abortController = new AbortController();
    this.startTime = Date.now();
    const signal = this.abortController.signal;

    try {
      for (let i = 0; i < this.queue.length; i++) {
        if (signal.aborted) break;

        const job = this.queue[i];
        if (!job || job.status !== 'pending') continue;

        job.status = 'downloading';
        this.emit('episode-started', { job: { ...job } as EpisodeDownloadJob, index: i });

        try {
          const filePath = await this.downloadEpisode(webtoonInfo, job, signal);
          job.status = 'completed';
          job.filePath = filePath;
          this.emit('episode-completed', { job: { ...job } as EpisodeDownloadJob, index: i, filePath });
        } catch (error) {
          if (signal.aborted) {
            job.status = 'pending'; // Reset to pending on cancel
            break;
          }

          job.status = 'failed';
          job.error = error instanceof Error ? error.message : 'Unknown error';
          this.emit('episode-failed', { job: { ...job } as EpisodeDownloadJob, index: i, error: job.error });
        }

        // Delay between episodes (skip for last one)
        if (i < this.queue.length - 1 && !signal.aborted) {
          await this.delay(this.config.episodeDelay);
        }
      }

      if (signal.aborted) {
        const completedBeforeCancel = this.queue.filter(j => j.status === 'completed').length;
        this.emit('queue-cancelled', { queue: [...this.queue], completedBeforeCancel });
      } else {
        const completed = this.queue.filter(j => j.status === 'completed').length;
        const failed = this.queue.filter(j => j.status === 'failed').length;
        this.emit('queue-completed', { queue: [...this.queue], completed, failed });
      }
    } finally {
      this.isRunning = false;
      this.abortController = null;
    }
  }

  /**
   * Cancel ongoing downloads
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Check if queue is currently running
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Get current progress
   */
  getProgress(): DownloadProgress {
    const completed = this.queue.filter(j => j.status === 'completed').length;
    const failed = this.queue.filter(j => j.status === 'failed').length;
    const current = this.queue.find(j => j.status === 'downloading');

    // Estimate time remaining
    let estimatedTimeRemaining: number | undefined;
    if (completed > 0 && this.startTime > 0) {
      const elapsed = Date.now() - this.startTime;
      const avgTimePerEpisode = elapsed / completed;
      const remaining = this.queue.length - completed - failed;
      estimatedTimeRemaining = avgTimePerEpisode * remaining;
    }

    return {
      totalEpisodes: this.queue.length,
      completedEpisodes: completed,
      failedEpisodes: failed,
      currentEpisode: current ? { no: current.episodeNo, subtitle: current.subtitle } : null,
      currentImageIndex: current?.currentImage ?? 0,
      totalImages: current?.imageCount ?? 0,
      estimatedTimeRemaining,
    };
  }

  /**
   * Get queue copy
   */
  getQueue(): EpisodeDownloadJob[] {
    return [...this.queue];
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Fetch episode detail with fallback to Worker API for adult content
   * Local service is faster but fails for 18+ content without proper auth
   * Worker API handles authentication properly via server-side cookie
   */
  private async fetchEpisodeDetailWithFallback(
    titleId: string,
    episodeNo: number
  ): Promise<EpisodeDetail> {
    try {
      // Try local service first (faster, works for non-adult content)
      return await this.webtoonService.fetchEpisodeDetail(titleId, episodeNo);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if it's an adult verification error
      const isAdultError = errorMessage.includes('adult verification') ||
        errorMessage.includes('연령 확인') ||
        errorMessage.includes('18+');

      // If not an adult error or no worker client available, rethrow
      if (!isAdultError || !this.workerClient) {
        throw error;
      }

      console.debug(`[WebtoonDownloadQueue] Adult content detected, falling back to Worker API for episode ${episodeNo}`);

      // Fallback to Worker API for adult content
      const episodeUrl = `https://comic.naver.com/webtoon/detail?titleId=${titleId}&no=${episodeNo}`;
      const response = await this.workerClient.submitArchive({
        url: episodeUrl,
        options: { downloadMedia: false },
        naverCookie: this.cookie,
      });

      // Check if we got a synchronous result
      if (response.result?.postData) {
        const postData = response.result.postData as Record<string, unknown>;
        const postContent = postData.content as Record<string, unknown> | undefined;
        return {
          no: episodeNo,
          titleId: parseInt(titleId, 10),
          subtitle: (typeof postContent?.title === 'string' ? postContent.title : null) ?? (typeof postData.title === 'string' ? postData.title : null) ?? `Episode ${episodeNo}`,
          imageUrls: Array.isArray(postContent?.images) ? (postContent.images as string[]) : [],
          prevEpisodeNo: typeof postData.prevEpisodeNo === 'number' ? postData.prevEpisodeNo : undefined,
          nextEpisodeNo: typeof postData.nextEpisodeNo === 'number' ? postData.nextEpisodeNo : undefined,
          authorComment: typeof postData.authorComment === 'string' ? postData.authorComment : undefined,
        };
      }

      // If async job, wait for it
      if (response.jobId && response.status !== 'completed') {
        const postDataRaw = await this.workerClient.waitForJob(response.jobId) as Record<string, unknown>;
        const postContent2 = postDataRaw.content as Record<string, unknown> | undefined;
        return {
          no: episodeNo,
          titleId: parseInt(titleId, 10),
          subtitle: (typeof postContent2?.title === 'string' ? postContent2.title : null) ?? (typeof postDataRaw.title === 'string' ? postDataRaw.title : null) ?? `Episode ${episodeNo}`,
          imageUrls: Array.isArray(postContent2?.images) ? (postContent2.images as string[]) : [],
          prevEpisodeNo: typeof postDataRaw.prevEpisodeNo === 'number' ? postDataRaw.prevEpisodeNo : undefined,
          nextEpisodeNo: typeof postDataRaw.nextEpisodeNo === 'number' ? postDataRaw.nextEpisodeNo : undefined,
          authorComment: typeof postDataRaw.authorComment === 'string' ? postDataRaw.authorComment : undefined,
        };
      }

      throw new Error('Failed to fetch episode detail via Worker API');
    }
  }

  /**
   * Download a single episode
   * In stream-first mode: creates markdown first, then downloads images
   */
  private async downloadEpisode(
    webtoonInfo: WebtoonAPIInfo,
    job: EpisodeDownloadJob,
    signal: AbortSignal
  ): Promise<string> {
    const titleId = String(webtoonInfo.titleId);
    const episodeNo = job.episodeNo;

    // 1. Fetch episode detail (image URLs)
    // Try local service first, fallback to Worker API for adult content
    const detail = await this.fetchEpisodeDetailWithFallback(titleId, episodeNo);

    // Total includes thumbnail + content images
    const totalImages = detail.imageUrls.length + (job.thumbnailUrl ? 1 : 0);
    job.imageCount = totalImages;
    job.currentImage = 0;
    this.emit('episode-progress', {
      job: { ...job },
      imageIndex: 0,
      totalImages,
    });

    // 2. Create media folder
    const episodeFolder = `${this.mediaBasePath}/naver-webtoon/${titleId}/${episodeNo}`;
    await this.ensureFolderExists(episodeFolder);

    // Stream-first mode: create markdown first with placeholder image paths
    if (this.streamFirst) {
      // Generate expected image paths (files don't exist yet)
      const expectedImagePaths = detail.imageUrls.map((url, idx) => {
        let extension = 'jpg';
        const urlMatch = url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
        if (urlMatch?.[1]) {
          extension = urlMatch[1].toLowerCase();
        }
        return `${episodeFolder}/${String(idx + 1).padStart(3, '0')}.${extension}`;
      });

      // Expected thumbnail path
      let expectedThumbnailPath: string | undefined;
      if (job.thumbnailUrl) {
        let thumbExt = 'jpg';
        const thumbUrlMatch = job.thumbnailUrl.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
        if (thumbUrlMatch?.[1]) {
          thumbExt = thumbUrlMatch[1].toLowerCase();
        }
        expectedThumbnailPath = `${episodeFolder}/thumbnail.${thumbExt}`;
      }

      // Create markdown note first (with paths to not-yet-downloaded images)
      const filePath = await this.createEpisodeNote(
        webtoonInfo,
        detail,
        job,
        expectedImagePaths,
        expectedThumbnailPath,
        [], // No comments yet in stream-first mode
        undefined
      );

      // Emit markdown-created event so UI can open fullscreen viewer
      this.emit('markdown-created', {
        job: { ...job },
        filePath,
        imageUrls: detail.imageUrls,
        webtoonInfo,
        episodeDetail: detail,
      });

      // Now download images in background
      // 3. Download thumbnail
      if (job.thumbnailUrl) {
        try {
          await this.downloadThumbnail(job.thumbnailUrl, episodeFolder);
          job.currentImage = 1;
          this.emit('episode-progress', {
            job: { ...job },
            imageIndex: 1,
            totalImages,
          });
        } catch (error) {
          console.warn('[WebtoonDownloadQueue] Failed to download thumbnail:', error);
        }
      }

      // 4. Download content images
      const chunks = this.chunkArray(detail.imageUrls, this.config.concurrentImages);
      let downloadedCount = 0;
      for (const chunk of chunks) {
        if (signal.aborted) throw new Error('Download cancelled');

        await Promise.allSettled(
          chunk.map((url, idx) =>
            this.downloadImageWithRetry(url, episodeFolder, downloadedCount + idx)
          )
        );
        downloadedCount += chunk.length;

        job.currentImage = (job.currentImage ?? 0) + chunk.length;
        this.emit('episode-progress', {
          job: { ...job },
          imageIndex: job.currentImage,
          totalImages,
        });

        if (chunks.indexOf(chunk) < chunks.length - 1) {
          await this.delay(this.config.imageDelay);
        }
      }

      // 5. Fetch and update comments (async, non-blocking)
      this.fetchAndUpdateComments(titleId, episodeNo, filePath).catch(error => {
        console.warn(`[WebtoonDownloadQueue] Failed to update comments for ep ${episodeNo}:`, error);
      });

      return filePath;
    }

    // Normal mode: download images first, then create markdown
    // 3. Download episode list thumbnail first (if available)
    let thumbnailPath: string | undefined;
    if (job.thumbnailUrl) {
      try {
        thumbnailPath = await this.downloadThumbnail(job.thumbnailUrl, episodeFolder);
        job.currentImage = 1;
        this.emit('episode-progress', {
          job: { ...job },
          imageIndex: 1,
          totalImages,
        });
      } catch (error) {
        console.warn('[WebtoonDownloadQueue] Failed to download thumbnail:', error);
        // Continue without thumbnail
      }
    }

    // 4. Download content images in chunks
    const downloadedImages: string[] = [];
    const chunks = this.chunkArray(detail.imageUrls, this.config.concurrentImages);

    for (const chunk of chunks) {
      if (signal.aborted) throw new Error('Download cancelled');

      const results = await Promise.allSettled(
        chunk.map((url, idx) =>
          this.downloadImageWithRetry(url, episodeFolder, downloadedImages.length + idx)
        )
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          downloadedImages.push(result.value);
        }
        job.currentImage = (job.currentImage ?? 0) + 1;

        this.emit('episode-progress', {
          job: { ...job },
          imageIndex: job.currentImage,
          totalImages,
        });
      }

      // Delay between chunks
      if (chunks.indexOf(chunk) < chunks.length - 1) {
        await this.delay(this.config.imageDelay);
      }
    }

    // 5. Fetch best comments (non-blocking, graceful degradation)
    let topComments: WebtoonComment[] = [];
    let commentCount: number | undefined;
    try {
      const [comments, counts] = await Promise.all([
        this.commentService.fetchTopComments(titleId, episodeNo, 20),
        this.commentService.fetchCommentCounts(titleId, [episodeNo]),
      ]);
      topComments = comments;
      commentCount = counts.get(episodeNo);
    } catch (error) {
      console.warn(`[WebtoonDownloadQueue] Failed to fetch comments for ep ${episodeNo}:`, error);
      // Continue without comments
    }

    // 6. Create markdown note with thumbnail, content images, and comments
    const filePath = await this.createEpisodeNote(
      webtoonInfo,
      detail,
      job,
      downloadedImages,
      thumbnailPath,
      topComments,
      commentCount
    );

    return filePath;
  }

  /**
   * Download episode thumbnail (from episode list)
   */
  private async downloadThumbnail(url: string, folder: string): Promise<string> {
    const arrayBuffer = await this.webtoonService.downloadImage(url);

    // Extract extension from URL
    let extension = 'jpg';
    const urlMatch = url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
    if (urlMatch?.[1]) {
      extension = urlMatch[1].toLowerCase();
    }

    const filename = `thumbnail.${extension}`;
    const localPath = `${folder}/${filename}`;

    await this.app.vault.adapter.writeBinary(localPath, arrayBuffer);
    return localPath;
  }

  // Cache for series covers (titleId -> local path)
  private seriesCoverCache: Map<string, string> = new Map();

  /**
   * Download series cover (webtoon thumbnail) and cache locally
   * Returns the local path or null if download fails
   */
  private async downloadSeriesCover(
    titleId: string,
    thumbnailUrl: string
  ): Promise<string | null> {
    // Check memory cache first
    const cached = this.seriesCoverCache.get(titleId);
    if (cached) {
      return cached;
    }

    // Define path for series cover
    const coverFolder = `${this.mediaBasePath}/naver-webtoon/${titleId}`;
    const coverPath = `${coverFolder}/cover.jpg`;

    // Check if already exists on disk
    const exists = await this.app.vault.adapter.exists(coverPath);
    if (exists) {
      this.seriesCoverCache.set(titleId, coverPath);
      return coverPath;
    }

    try {
      // Download the cover
      await this.ensureFolderExists(coverFolder);
      const arrayBuffer = await this.webtoonService.downloadImage(thumbnailUrl);

      // Extract extension from URL (fallback to jpg)
      let extension = 'jpg';
      const urlMatch = thumbnailUrl.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
      if (urlMatch?.[1]) {
        extension = urlMatch[1].toLowerCase();
      }

      const actualPath = `${coverFolder}/cover.${extension}`;
      await this.app.vault.adapter.writeBinary(actualPath, arrayBuffer);

      this.seriesCoverCache.set(titleId, actualPath);
      return actualPath;
    } catch (error) {
      console.warn('[WebtoonDownloadQueue] Failed to download series cover:', error);
      return null;
    }
  }

  /**
   * Download image with retry logic
   */
  private async downloadImageWithRetry(
    url: string,
    folder: string,
    index: number
  ): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const arrayBuffer = await this.webtoonService.downloadImage(url);

        // Extract extension from URL
        let extension = 'jpg';
        const urlMatch = url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
        if (urlMatch?.[1]) {
          extension = urlMatch[1].toLowerCase();
        }

        const filename = `${String(index + 1).padStart(3, '0')}.${extension}`;
        const localPath = `${folder}/${filename}`;

        await this.app.vault.adapter.writeBinary(localPath, arrayBuffer);
        return localPath;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');

        if (attempt < this.config.maxRetries - 1) {
          // Exponential backoff
          const backoffDelay = this.config.retryDelay * Math.pow(this.config.retryBackoff, attempt);
          await this.delay(backoffDelay);
        }
      }
    }

    throw lastError ?? new Error('Max retries exceeded');
  }

  /**
   * Create markdown note for episode
   */
  private async createEpisodeNote(
    webtoonInfo: WebtoonAPIInfo,
    detail: EpisodeDetail,
    job: EpisodeDownloadJob,
    downloadedImages: string[],
    thumbnailPath?: string,
    topComments?: WebtoonComment[],
    commentCount?: number
  ): Promise<string> {
    const titleId = String(webtoonInfo.titleId);
    const seriesTitle = this.sanitizeFilename(webtoonInfo.titleName);

    // Clean the subtitle: remove series name prefix and episode number prefix if present
    const cleanedSubtitle = this.cleanEpisodeSubtitle(detail.subtitle, webtoonInfo.titleName, detail.no);
    const episodeTitle = this.sanitizeFilename(cleanedSubtitle);
    const episodeNo = String(detail.no).padStart(3, '0');

    // Create folder structure using shared constants for consistency
    const platformName = getPlatformName('naver-webtoon');
    const noteFolder = `${DEFAULT_ARCHIVE_PATH}/${platformName}/${seriesTitle}`;
    await this.ensureFolderExists(noteFolder);

    const filename = `${episodeNo} - ${episodeTitle}.md`;
    const filePath = `${noteFolder}/${filename}`;

    // Parse episode date from serviceDateDescription (e.g., "24.12.25")
    const publishedDate = this.parseServiceDate(job.serviceDateDescription);

    // Generate frontmatter
    const now = new Date();

    // Extract genre tags from curationTagList (e.g., #판타지, #명작)
    const genreTags = webtoonInfo.curationTagList?.map(tag => tag.tagName) || [];

    // Sanitize synopsis: replace newlines with spaces for valid YAML
    const sanitizedSynopsis = webtoonInfo.synopsis
      ?.replace(/\r\n/g, ' ')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Download series cover for local avatar (cached per series)
    let localAvatarPath: string | null = null;
    if (webtoonInfo.thumbnailUrl) {
      localAvatarPath = await this.downloadSeriesCover(titleId, webtoonInfo.thumbnailUrl);
    }

    const frontmatter: Record<string, unknown> = {
      platform: 'naver-webtoon',
      archived: now.toISOString(),
      published: publishedDate?.toISOString(),  // ISO format for consistency with other platforms
      url: `https://comic.naver.com/webtoon/detail?titleId=${titleId}&no=${detail.no}`,
      title: `${webtoonInfo.titleName} - ${detail.no}화 ${cleanedSubtitle}`,
      author: webtoonInfo.communityArtists.map(a => a.name).join(', '),
      author_url: `https://comic.naver.com/webtoon/list?titleId=${titleId}`,
      // Local avatar path (plain path - wikilinks cause YAML parsing issues)
      authorAvatar: localAvatarPath || undefined,
      // Fallback to external URL if local download failed
      author_avatar: !localAvatarPath ? webtoonInfo.thumbnailUrl : undefined,
      seriesId: titleId,
      series: webtoonInfo.titleName,
      seriesUrl: `https://comic.naver.com/webtoon/list?titleId=${titleId}`,
      episode: detail.no,
      starScore: job.starScore,  // Episode rating (0-10 scale)
      publishDay: this.parsePublishDay(webtoonInfo.publishDescription),  // e.g., "mon", "tue", "wed"
      finished: webtoonInfo.finished,
      synopsis: sanitizedSynopsis,  // Webtoon description for author bio (newlines removed)
      genre: genreTags,  // Genre tags for display
      imageCount: downloadedImages.length,
      commentCount: commentCount,  // Episode comment count
      tags: ['naver-webtoon', seriesTitle.replace(/\s+/g, '-')],
    };

    // Add thumbnail to frontmatter if available
    if (thumbnailPath) {
      frontmatter.thumbnail = thumbnailPath;
    }

    // Remove undefined values from frontmatter
    for (const key of Object.keys(frontmatter)) {
      if (frontmatter[key] === undefined) {
        Reflect.deleteProperty(frontmatter, key);
      }
    }

    // Generate content
    const imageEmbeds = downloadedImages.map(img => `![[${img}]]`).join('\n\n');

    // Build header with thumbnail
    const headerParts = [
      '---',
      this.toYaml(frontmatter),
      '---',
      '',
      `# ${webtoonInfo.titleName}`,
      `## ${detail.no}화 ${cleanedSubtitle}`,
      '',
    ];

    // Show thumbnail as episode preview if available
    if (thumbnailPath) {
      headerParts.push(`![[${thumbnailPath}|Episode thumbnail]]`);
      headerParts.push('');
    }

    headerParts.push(
      `> **Series:** [[${webtoonInfo.titleName}]]`,
      `> **Author:** ${webtoonInfo.communityArtists.map(a => a.name).join(', ')}`,
      '',
    );

    if (detail.authorComment) {
      headerParts.push(`> *${detail.authorComment}*`, '');
    }

    headerParts.push('---', '', imageEmbeds);

    // Add Best Comments section if available
    if (topComments && topComments.length > 0) {
      const commentsSection = this.formatCommentsSection(topComments, commentCount);
      headerParts.push('', commentsSection);
    }

    const content = headerParts.filter(line => line !== undefined).join('\n');

    // Check if file exists
    const existingFile = this.app.vault.getAbstractFileByPath(filePath);
    if (existingFile && existingFile instanceof TFile) {
      await this.app.vault.modify(existingFile, content);
    } else {
      await this.app.vault.create(filePath, content);
    }

    return filePath;
  }

  /**
   * Format best comments as markdown section
   * Following PRD format with badges and stats
   */
  private formatCommentsSection(
    comments: WebtoonComment[],
    totalCount?: number
  ): string {
    const lines: string[] = ['---', '', '## Best Comments', ''];

    for (const comment of comments) {
      // Badge: ✏️ for creator, 🏆 for regular best comment
      const badge = comment.author.isCreator ? '✏️' : '🏆';
      const likes = comment.likes.toLocaleString();
      const replies = comment.replyCount.toLocaleString();

      lines.push(`> ${badge} **${comment.author.name}** · ♥ ${likes} · 💬 ${replies}`);
      lines.push(`> ${comment.body}`);
      lines.push('');
    }

    if (totalCount !== undefined && totalCount > 0) {
      lines.push(`*${totalCount.toLocaleString()} comments total*`);
    }

    return lines.join('\n');
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  private async ensureFolderExists(folderPath: string): Promise<void> {
    const parts = folderPath.split('/');
    let currentPath = '';

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const folder = this.app.vault.getAbstractFileByPath(currentPath);
      if (!folder) {
        await this.app.vault.createFolder(currentPath);
      }
    }
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private sanitizeFilename(name: string): string {
    return name
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100); // Limit length
  }

  /**
   * Clean episode subtitle by removing series name prefix and episode number prefix
   * e.g., "호랑이형님 - 4화 추이와 황요" → "추이와 황요"
   * e.g., "4화 추이와 황요" → "추이와 황요"
   */
  private cleanEpisodeSubtitle(subtitle: string, seriesName: string, episodeNo: number): string {
    let cleaned = subtitle.trim();

    // Remove series name prefix (e.g., "호랑이형님 - " or "호랑이형님 ")
    if (cleaned.startsWith(seriesName)) {
      cleaned = cleaned.substring(seriesName.length).trim();
      // Remove separator if present
      if (cleaned.startsWith('-') || cleaned.startsWith(':')) {
        cleaned = cleaned.substring(1).trim();
      }
    }

    // Remove episode number prefix patterns:
    // "4화 ", "4화: ", "4화- ", "제4화 ", "ep.4 ", "Episode 4 ", etc.
    const episodePatterns = [
      new RegExp(`^${episodeNo}화\\s*[-:]?\\s*`, 'i'),
      new RegExp(`^제${episodeNo}화\\s*[-:]?\\s*`, 'i'),
      new RegExp(`^ep\\.?\\s*${episodeNo}\\s*[-:]?\\s*`, 'i'),
      new RegExp(`^episode\\s*${episodeNo}\\s*[-:]?\\s*`, 'i'),
      new RegExp(`^#${episodeNo}\\s*[-:]?\\s*`, 'i'),
    ];

    for (const pattern of episodePatterns) {
      if (pattern.test(cleaned)) {
        cleaned = cleaned.replace(pattern, '').trim();
        break;
      }
    }

    // If after cleaning we have nothing left, use original subtitle
    if (!cleaned) {
      return subtitle;
    }

    return cleaned;
  }

  private toYaml(obj: Record<string, unknown>): string {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined || value === null) continue;  // Skip undefined/null values
      if (Array.isArray(value)) {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${JSON.stringify(item)}`);
        }
      } else if (typeof value === 'string' && (value.includes(':') || value.includes('#'))) {
        lines.push(`${key}: "${value}"`);
      } else {
        lines.push(`${key}: ${String(value)}`);
      }
    }
    return lines.join('\n');
  }

  /**
   * Parse Korean publish day to English abbreviation for scheduling
   * e.g., "월요일" → "mon", "화요일" → "tue"
   */
  private parsePublishDay(publishDescription?: string): string | undefined {
    if (!publishDescription) return undefined;

    const dayMap: Record<string, string> = {
      '월': 'mon',
      '화': 'tue',
      '수': 'wed',
      '목': 'thu',
      '금': 'fri',
      '토': 'sat',
      '일': 'sun',
    };

    // Extract first character (월, 화, 수, etc.)
    for (const [korean, english] of Object.entries(dayMap)) {
      if (publishDescription.includes(korean)) {
        return english;
      }
    }

    return undefined;
  }

  /**
   * Parse serviceDateDescription to Date
   * Format: "YY.MM.DD" (e.g., "24.12.25")
   */
  private parseServiceDate(dateStr?: string): Date | undefined {
    if (!dateStr || dateStr.includes('일 후 무료')) {
      return undefined;
    }

    // Parse "YY.MM.DD" format
    const shortMatch = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
    if (shortMatch && shortMatch[1] && shortMatch[2] && shortMatch[3]) {
      const year = 2000 + parseInt(shortMatch[1], 10);
      const month = parseInt(shortMatch[2], 10) - 1;
      const day = parseInt(shortMatch[3], 10);
      return new Date(year, month, day, 12, 0, 0);
    }

    return undefined;
  }

  /**
   * Fetch comments and update the markdown file (for stream-first mode)
   * Called after initial markdown is created, updates the file with comments
   */
  private async fetchAndUpdateComments(
    titleId: string,
    episodeNo: number,
    filePath: string
  ): Promise<void> {
    try {
      const [comments, counts] = await Promise.all([
        this.commentService.fetchTopComments(titleId, episodeNo, 20),
        this.commentService.fetchCommentCounts(titleId, [episodeNo]),
      ]);

      if (comments.length === 0) return;

      const commentCount = counts.get(episodeNo);
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!file || !(file instanceof this.app.vault.adapter.constructor)) {
        // File might be TFile
        const tFile = this.app.vault.getAbstractFileByPath(filePath);
        if (!tFile || !(tFile instanceof TFile)) return;

        const content = await this.app.vault.read(tFile);

        // Generate comments section
        const commentsSection = this.generateCommentsMarkdown(comments, commentCount);

        // Insert before closing --- or at end
        let updatedContent = content;
        if (content.includes('## Best Comments')) {
          // Already has comments section, skip
          return;
        }

        // Add comments section before the images
        const contentIndex = content.indexOf('\n## Episode Content');
        if (contentIndex !== -1) {
          updatedContent = content.slice(0, contentIndex) + commentsSection + content.slice(contentIndex);
        } else {
          // Append at end
          updatedContent = content + '\n' + commentsSection;
        }

        await this.app.vault.modify(tFile, updatedContent);
      }
    } catch (error) {
      console.warn(`[WebtoonDownloadQueue] Failed to update comments:`, error);
    }
  }

  /**
   * Generate markdown for comments section
   */
  private generateCommentsMarkdown(comments: WebtoonComment[], commentCount?: number): string {
    if (comments.length === 0) return '';

    let markdown = '\n## Best Comments';
    if (commentCount !== undefined) {
      markdown += ` (${commentCount.toLocaleString()} total)`;
    }
    markdown += '\n\n';

    for (const comment of comments) {
      const date = new Date(comment.createdAt).toLocaleDateString();
      markdown += `> **${comment.author.name}** · ${date}\n`;
      markdown += `> ${comment.body.replace(/\n/g, '\n> ')}\n`;
      if (comment.likes > 0) {
        markdown += `> 👍 ${comment.likes.toLocaleString()}\n`;
      }
      markdown += '\n';
    }

    return markdown;
  }

  private emit<T extends DownloadEventType>(
    eventName: T,
    detail: DownloadEventDetail[T]
  ): void {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}
