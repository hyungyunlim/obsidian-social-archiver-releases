/**
 * WebtoonsDownloadQueue - Batch Episode Download Service for WEBTOON Global
 *
 * Handles sequential episode downloads with:
 * - Rate limiting to prevent IP bans
 * - Progress tracking via EventTarget
 * - Retry logic with exponential backoff
 * - Cancellation support via AbortController
 *
 * Single Responsibility: Batch download management for WEBTOON Global (webtoons.com)
 */

import { type App, TFile, requestUrl } from 'obsidian';
import {
  WebtoonsLocalService,
  type WebtoonsUrlInfo,
  type WebtoonsSeriesInfo,
  type WebtoonsEpisodeDetail,
  type WebtoonsBestComment,
} from './WebtoonsLocalService';
import { DEFAULT_ARCHIVE_PATH } from '@/shared/constants';
import { getPlatformName } from '@/shared/platforms';

// ============================================================================
// Types
// ============================================================================

export interface WebtoonsDownloadQueueConfig {
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

export interface WebtoonsEpisodeJob {
  /** Episode number */
  episodeNo: number;
  /** Episode title */
  title: string;
  /** Episode thumbnail URL */
  thumbnailUrl?: string;
  /** Publication date */
  pubDate?: Date;
  /** Download status */
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  /** Total image count */
  imageCount?: number;
  /** Current image being downloaded */
  currentImage?: number;
  /** Error message if failed */
  error?: string;
  /** Local file path after download */
  filePath?: string;
}

export interface WebtoonsDownloadProgress {
  totalEpisodes: number;
  completedEpisodes: number;
  failedEpisodes: number;
  currentEpisode: { no: number; subtitle: string } | null;
  currentImageIndex: number;
  totalImages: number;
  estimatedTimeRemaining?: number;
}

export type WebtoonsDownloadEventType =
  | 'queue-updated'
  | 'episode-started'
  | 'episode-progress'
  | 'episode-completed'
  | 'episode-failed'
  | 'queue-completed'
  | 'queue-cancelled'
  | 'markdown-created';

export interface WebtoonsDownloadEventDetail {
  'queue-updated': { queue: WebtoonsEpisodeJob[] };
  'episode-started': { job: WebtoonsEpisodeJob; index: number };
  'episode-progress': { job: WebtoonsEpisodeJob; imageIndex: number; totalImages: number };
  'episode-completed': { job: WebtoonsEpisodeJob; index: number; filePath: string };
  'episode-failed': { job: WebtoonsEpisodeJob; index: number; error: string };
  'queue-completed': { queue: WebtoonsEpisodeJob[]; completed: number; failed: number };
  'queue-cancelled': { queue: WebtoonsEpisodeJob[]; completedBeforeCancel: number };
  'markdown-created': {
    job: WebtoonsEpisodeJob;
    filePath: string;
    imageUrls: string[];
    urlInfo: WebtoonsUrlInfo;
    seriesInfo: WebtoonsSeriesInfo;
    episodeDetail: WebtoonsEpisodeDetail;
  };
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: WebtoonsDownloadQueueConfig = {
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

export class WebtoonsDownloadQueue extends EventTarget {
  private queue: WebtoonsEpisodeJob[] = [];
  private config: WebtoonsDownloadQueueConfig;
  private isRunning = false;
  private abortController: AbortController | null = null;
  private webtoonsService: WebtoonsLocalService;
  private app: App;
  private mediaBasePath: string;
  private workerEndpoint: string;
  private startTime: number = 0;
  private streamFirst: boolean = false;

  constructor(
    app: App,
    config: Partial<WebtoonsDownloadQueueConfig> = {},
    mediaBasePath: string = 'attachments/social-archives',
    workerEndpoint: string = 'https://social-archiver-api.social-archive.org'
  ) {
    super();
    this.app = app;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.mediaBasePath = mediaBasePath;
    this.workerEndpoint = workerEndpoint;
    this.webtoonsService = new WebtoonsLocalService();
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Add episodes to download queue
   */
  addEpisodes(episodes: WebtoonsEpisodeJob[]): void {
    for (const episode of episodes) {
      // Skip if already in queue
      if (this.queue.some(j => j.episodeNo === episode.episodeNo)) {
        continue;
      }

      this.queue.push({
        ...episode,
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
   * @param urlInfo - WEBTOON URL info
   * @param seriesInfo - Series metadata
   * @param options - Optional settings including streamFirst mode
   */
  async start(
    urlInfo: WebtoonsUrlInfo,
    seriesInfo: WebtoonsSeriesInfo,
    options?: { streamFirst?: boolean }
  ): Promise<void> {
    if (this.isRunning) {
      console.warn('[WebtoonsDownloadQueue] Already running');
      return;
    }

    this.isRunning = true;
    this.abortController = new AbortController();
    this.startTime = Date.now();
    this.streamFirst = options?.streamFirst ?? false;
    const signal = this.abortController.signal;

    try {
      for (let i = 0; i < this.queue.length; i++) {
        if (signal.aborted) break;

        const job = this.queue[i];
        if (!job || job.status !== 'pending') continue;

        job.status = 'downloading';
        this.emit('episode-started', { job: { ...job }, index: i });

        try {
          const filePath = await this.downloadEpisode(urlInfo, seriesInfo, job, signal);
          job.status = 'completed';
          job.filePath = filePath;
          this.emit('episode-completed', { job: { ...job }, index: i, filePath });
        } catch (error) {
          if (signal.aborted) {
            job.status = 'pending'; // Reset to pending on cancel
            break;
          }

          job.status = 'failed';
          job.error = error instanceof Error ? error.message : 'Unknown error';
          this.emit('episode-failed', { job: { ...job }, index: i, error: job.error });
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
  getProgress(): WebtoonsDownloadProgress {
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
      currentEpisode: current ? { no: current.episodeNo, subtitle: current.title } : null,
      currentImageIndex: current?.currentImage ?? 0,
      totalImages: current?.imageCount ?? 0,
      estimatedTimeRemaining,
    };
  }

  /**
   * Get queue copy
   */
  getQueue(): WebtoonsEpisodeJob[] {
    return [...this.queue];
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Download a single episode
   * In stream-first mode: creates markdown first, emits event, then downloads images
   */
  private async downloadEpisode(
    urlInfo: WebtoonsUrlInfo,
    seriesInfo: WebtoonsSeriesInfo,
    job: WebtoonsEpisodeJob,
    signal: AbortSignal
  ): Promise<string> {
    const episodeNo = job.episodeNo;

    // 1. Fetch episode detail (image URLs)
    const detail = await this.webtoonsService.fetchEpisodeDetail(urlInfo, episodeNo);

    // Check if paid episode (no images found)
    if (detail.imageUrls.length === 0) {
      throw new Error('No images found. This may be a paid or locked episode.');
    }

    // Total includes content images
    const totalImages = detail.imageUrls.length;
    job.imageCount = totalImages;
    job.currentImage = 0;
    this.emit('episode-progress', {
      job: { ...job },
      imageIndex: 0,
      totalImages,
    });

    // 2. Create media folder
    const seriesSlug = this.sanitizeFilename(seriesInfo.title);
    const episodeFolder = `${this.mediaBasePath}/webtoons/${seriesSlug}/ep-${episodeNo}`;
    await this.ensureFolderExists(episodeFolder);

    // ========================================================================
    // Stream-First Mode: Create markdown first, emit event, then download
    // ========================================================================
    if (this.streamFirst) {
      // Generate expected image paths (files don't exist yet)
      const expectedImagePaths: string[] = detail.imageUrls.map((url, idx) => {
        let extension = 'jpg';
        const urlMatch = url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
        if (urlMatch?.[1]) {
          extension = urlMatch[1].toLowerCase();
        }
        const filename = `${String(idx + 1).padStart(3, '0')}.${extension}`;
        return `${episodeFolder}/${filename}`;
      });

      // Create markdown note first with expected paths
      const filePath = await this.createEpisodeNote(
        urlInfo,
        seriesInfo,
        detail,
        job,
        expectedImagePaths
      );

      // Emit markdown-created event for modal to open fullscreen
      this.emit('markdown-created', {
        job: { ...job },
        filePath,
        imageUrls: detail.imageUrls,
        urlInfo,
        seriesInfo,
        episodeDetail: detail,
      });

      // Now download images in background
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

      // Fetch and update comments asynchronously (don't block)
      this.fetchAndUpdateComments(urlInfo, job.episodeNo, filePath);

      return filePath;
    }

    // ========================================================================
    // Normal Mode: Download images first, then create markdown
    // ========================================================================

    // 3. Download content images in chunks via worker proxy
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

    // 4. Create markdown note
    const filePath = await this.createEpisodeNote(
      urlInfo,
      seriesInfo,
      detail,
      job,
      downloadedImages
    );

    return filePath;
  }

  /**
   * Fetch and update comments asynchronously (for stream-first mode)
   * Doesn't block the main flow - updates markdown file when ready
   */
  private async fetchAndUpdateComments(
    urlInfo: WebtoonsUrlInfo,
    episodeNo: number,
    filePath: string
  ): Promise<void> {
    try {
      const { comments: bestComments, totalCount } = await this.webtoonsService.fetchBestComments(
        urlInfo.titleNo,
        episodeNo,
        urlInfo.language,
        20,
        urlInfo.isCanvas // Pass isCanvas to use correct API prefix (c_ vs w_)
      );

      if (bestComments.length === 0) return;

      // Read existing file
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!file || !(file instanceof TFile)) return;

      const content = await this.app.vault.read(file as TFile);

      // Check if comments section already exists
      if (content.includes('## Best Comments')) return;

      // Generate comments section
      const commentsSection = this.formatBestComments(bestComments, totalCount);

      // Append comments to the file
      const updatedContent = content + commentsSection;
      await this.app.vault.modify(file as TFile, updatedContent);

      // Update frontmatter with comment count
      if (totalCount > 0) {
        const updatedWithMeta = this.updateFrontmatterCommentCount(updatedContent, totalCount);
        if (updatedWithMeta !== updatedContent) {
          await this.app.vault.modify(file as TFile, updatedWithMeta);
        }
      }
    } catch (error) {
      console.warn('[WebtoonsDownloadQueue] Failed to update comments:', error);
    }
  }

  /**
   * Update commentCount in frontmatter
   */
  private updateFrontmatterCommentCount(content: string, count: number): string {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch || !frontmatterMatch[1]) return content;

    const frontmatter = frontmatterMatch[1];
    if (frontmatter.includes('commentCount:')) return content; // Already has it

    // Add commentCount before tags or at the end of frontmatter
    const insertPoint = frontmatter.includes('tags:')
      ? frontmatter.indexOf('tags:')
      : frontmatter.length;

    const before = frontmatter.slice(0, insertPoint);
    const after = frontmatter.slice(insertPoint);
    const newFrontmatter = `${before}commentCount: ${count}\n${after}`;

    return content.replace(frontmatterMatch[0], `---\n${newFrontmatter}\n---`);
  }

  /**
   * Download image with retry logic via worker proxy
   */
  private async downloadImageWithRetry(
    url: string,
    folder: string,
    index: number
  ): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        // Use worker proxy to bypass CORS and hotlinking protection
        const proxyUrl = `${this.workerEndpoint}/api/proxy-media?url=${encodeURIComponent(url)}`;

        const response = await requestUrl({
          url: proxyUrl,
          method: 'GET',
        });

        if (response.status !== 200) {
          throw new Error(`Failed to download image: ${response.status}`);
        }

        // Extract extension from URL
        let extension = 'jpg';
        const urlMatch = url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
        if (urlMatch?.[1]) {
          extension = urlMatch[1].toLowerCase();
        }

        const filename = `${String(index + 1).padStart(3, '0')}.${extension}`;
        const localPath = `${folder}/${filename}`;

        await this.app.vault.adapter.writeBinary(localPath, response.arrayBuffer);
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
    urlInfo: WebtoonsUrlInfo,
    seriesInfo: WebtoonsSeriesInfo,
    detail: WebtoonsEpisodeDetail,
    job: WebtoonsEpisodeJob,
    downloadedImages: string[]
  ): Promise<string> {
    const seriesSlug = this.sanitizeFilename(seriesInfo.title);
    const episodeNo = String(job.episodeNo).padStart(3, '0');
    const episodeTitle = this.sanitizeFilename(detail.title || `Episode ${job.episodeNo}`);

    // Create folder structure using shared constants for consistency
    const platformName = getPlatformName('webtoons');
    const noteFolder = `${DEFAULT_ARCHIVE_PATH}/${platformName}/${seriesSlug}`;
    await this.ensureFolderExists(noteFolder);

    const filename = `${episodeNo} - ${episodeTitle}.md`;
    const filePath = `${noteFolder}/${filename}`;

    // Build episode URL
    const episodeUrl = this.webtoonsService.buildEpisodeUrl(urlInfo, job.episodeNo);
    const seriesUrl = this.webtoonsService.buildSeriesUrl(urlInfo);

    // Fetch best comments first (to get totalCount for frontmatter)
    let bestCommentsSection = '';
    let totalCommentCount = 0;
    try {
      const { comments: bestComments, totalCount } = await this.webtoonsService.fetchBestComments(
        urlInfo.titleNo,
        job.episodeNo,
        urlInfo.language,
        20, // Match Naver Webtoon: top 20 best comments
        urlInfo.isCanvas // Pass isCanvas to use correct API prefix (c_ vs w_)
      );

      totalCommentCount = totalCount;

      if (bestComments.length > 0) {
        bestCommentsSection = this.formatBestComments(bestComments, totalCount);
      }
    } catch (error) {
      console.warn('[WebtoonsDownloadQueue] Failed to fetch best comments:', error);
    }

    // Generate frontmatter
    const now = new Date();

    const frontmatter: Record<string, unknown> = {
      platform: 'webtoons',
      archived: now.toISOString(),
      published: job.pubDate?.toISOString() || detail.publishDate?.toISOString(),
      url: episodeUrl,
      title: `${seriesInfo.title} - Episode ${job.episodeNo}`,
      author: seriesInfo.authorNames || 'Unknown',
      author_url: seriesUrl,
      seriesId: urlInfo.titleNo,
      series: seriesInfo.title,
      seriesUrl: seriesUrl,
      episode: job.episodeNo,
      language: urlInfo.language,
      genre: seriesInfo.genre,
      isCanvas: seriesInfo.isCanvas,
      finished: seriesInfo.isCompleted,
      imageCount: downloadedImages.length,
      tags: ['webtoons', 'webtoons-global', seriesSlug.replace(/\s+/g, '-')],
    };

    // Add thumbnail if available
    if (detail.thumbnailUrl) {
      frontmatter.thumbnail = detail.thumbnailUrl;
    }

    // Add like count if available
    if (detail.likeCount) {
      frontmatter.likes = detail.likeCount;
    }

    // Add comment count for Series Renderer
    if (totalCommentCount > 0) {
      frontmatter.commentCount = totalCommentCount;
    }

    // Remove undefined values from frontmatter
    for (const key of Object.keys(frontmatter)) {
      if (frontmatter[key] === undefined) {
        delete frontmatter[key];
      }
    }

    // Generate content
    const imageEmbeds = downloadedImages.map(img => `![[${img}]]`).join('\n\n');

    // Get language label
    const languageLabel = this.getLanguageLabel(urlInfo.language);

    const content = [
      '---',
      this.toYaml(frontmatter),
      '---',
      '',
      `# ${seriesInfo.title}`,
      `## Episode ${job.episodeNo}${detail.subtitle ? ` - ${detail.subtitle}` : ''}`,
      '',
      `> **Series:** [[${seriesInfo.title}]]`,
      `> **Author:** ${seriesInfo.authorNames || 'Unknown'}`,
      `> **Language:** ${languageLabel}`,
      '',
      detail.authorNote ? `> *${detail.authorNote}*\n` : '',
      '---',
      '',
      imageEmbeds,
      bestCommentsSection,
    ].filter(Boolean).join('\n');

    // Check if file exists
    const existingFile = this.app.vault.getAbstractFileByPath(filePath);
    if (existingFile) {
      await this.app.vault.modify(existingFile as TFile, content);
    } else {
      await this.app.vault.create(filePath, content);
    }

    return filePath;
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

  private toYaml(obj: Record<string, unknown>): string {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${JSON.stringify(item)}`);
        }
      } else if (typeof value === 'string' && (value.includes(':') || value.includes('#'))) {
        lines.push(`${key}: "${value}"`);
      } else {
        lines.push(`${key}: ${value}`);
      }
    }
    return lines.join('\n');
  }

  private getLanguageLabel(code: string): string {
    const labels: Record<string, string> = {
      'en': 'English',
      'es': 'Español',
      'fr': 'Français',
      'de': 'Deutsch',
      'th': 'ไทย',
      'id': 'Indonesia',
      'zh-hant': '中文 (繁體)',
    };
    return labels[code] || code.toUpperCase();
  }

  /**
   * Format best comments as markdown section
   */
  private formatBestComments(comments: WebtoonsBestComment[], totalCount?: number): string {
    if (comments.length === 0) return '';

    const countDisplay = totalCount ? ` (${totalCount.toLocaleString()} total)` : '';

    const lines: string[] = [
      '',
      '---',
      '',
      `## Best Comments${countDisplay}`,
      '',
    ];

    for (const comment of comments) {
      const date = comment.createdAt.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });

      // Format comment body (escape any markdown characters)
      const body = comment.body
        .replace(/\n/g, ' ')
        .trim();

      lines.push(`> **${comment.authorName}** · ${date}`);
      lines.push(`> ${body}`);
      lines.push(`> 👍 ${comment.likeCount.toLocaleString()}${comment.dislikeCount > 0 ? ` · 👎 ${comment.dislikeCount.toLocaleString()}` : ''}${comment.replyCount > 0 ? ` · 💬 ${comment.replyCount}` : ''}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  private emit<T extends WebtoonsDownloadEventType>(
    eventName: T,
    detail: WebtoonsDownloadEventDetail[T]
  ): void {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}
