/**
 * BatchTranscriptionManager - Orchestrates batch video transcription with pause/resume/cancel
 *
 * Single Responsibility: Manage batch transcription lifecycle (scan, download, transcribe)
 * with cooperative pause/cancel, persistence, and progress observer pattern.
 */

import { Notice, type App, type TFile, type TFolder } from 'obsidian';
import type { SocialArchiverSettings } from '../types/settings';
import type {
  BatchMode,
  BatchOperationStatus,
  BatchItem,
  BatchProgress,
  PersistedBatchState,
  BatchProgressObserver,
} from '../types/batch-transcription';
import type { TranscriptionResult } from '../types/transcription';
import type { Media } from '../types/post';
import type { MediaResult } from './MediaHandler';

const STORAGE_KEY = 'social-archiver:batch-transcription:v1';

/** Dependencies injected from main plugin to avoid circular imports */
export interface BatchTranscriptionManagerDeps {
  app: App;
  settings: SocialArchiverSettings;
  resolveLocalVideoPathsInNote: (filePath: string) => Promise<string[]>;
  collectMarkdownFiles: (folder: TFolder) => TFile[];
  toAbsoluteVaultPath: (relativePath: string) => string;
  appendTranscriptSection: (content: string, result: TranscriptionResult) => string;
  extractDownloadableVideoUrls: (fm: Record<string, unknown>) => string[];
  downloadMedia: (media: Media[], platform: string, postId: string, authorUsername: string) => Promise<MediaResult[]>;
  /** Check if a URL can be downloaded with yt-dlp */
  isYtDlpUrl: (url: string) => boolean;
  /** Download video via yt-dlp. Returns vault-relative path or null on failure. */
  downloadWithYtDlp: (url: string, platform: string, postId: string, signal?: AbortSignal) => Promise<string | null>;
  refreshTimelineView: () => void;
}

export class BatchTranscriptionManager {
  private deps: BatchTranscriptionManagerDeps;
  private status: BatchOperationStatus = 'idle';
  private mode: BatchMode = 'transcribe-only';
  private items: BatchItem[] = [];
  private currentIndex = 0;
  private startedAt = 0;
  private pausedAt?: number;

  private pauseRequested = false;
  private cancelRequested = false;
  private abortController: AbortController | null = null;

  private observers = new Set<BatchProgressObserver>();

  constructor(deps: BatchTranscriptionManagerDeps) {
    this.deps = deps;
  }

  // ─── Public API ──────────────────────────────────────────────────────

  getStatus(): BatchOperationStatus {
    return this.status;
  }

  getProgress(): BatchProgress {
    const completed = this.items.filter((i) => i.status === 'completed').length;
    const failed = this.items.filter((i) => i.status === 'failed').length;
    const skipped = this.items.filter((i) => i.status === 'skipped').length;
    const current = this.items[this.currentIndex];

    return {
      status: this.status,
      mode: this.mode,
      totalItems: this.items.length,
      completedItems: completed,
      failedItems: failed,
      skippedItems: skipped,
      currentIndex: this.currentIndex,
      currentFile: current?.filePath,
      currentStage: current?.status === 'downloading'
        ? 'downloading'
        : current?.status === 'transcribing'
          ? 'transcribing'
          : undefined,
      elapsedMs: this.startedAt > 0 ? Date.now() - this.startedAt : 0,
    };
  }

  onProgress(observer: BatchProgressObserver): () => void {
    this.observers.add(observer);
    return () => {
      this.observers.delete(observer);
    };
  }

  async start(mode: BatchMode): Promise<void> {
    if (this.status === 'running' || this.status === 'scanning') {
      console.warn('[BatchTranscriptionManager] Already running, ignoring start()');
      return;
    }

    this.mode = mode;
    this.items = [];
    this.currentIndex = 0;
    this.startedAt = Date.now();
    this.pausedAt = undefined;
    this.pauseRequested = false;
    this.cancelRequested = false;

    this.setStatus('scanning');

    // 1. Scan
    console.log(`[BatchTranscription] Starting batch (mode: ${mode}), scanning archive folder...`);
    const scanResult = await this.scan();
    if (scanResult.length === 0) {
      console.log('[BatchTranscription] Scan complete: no eligible items found.');
      this.setStatus('completed');
      this.deletePersisted();
      return;
    }

    this.items = scanResult;
    this.persist();

    console.log(`[BatchTranscription] Scan complete: ${scanResult.length} item(s) to process.`);
    for (const item of scanResult) {
      const name = item.filePath.split('/').pop() || item.filePath;
      const type = item.videoUrl ? `download+transcribe (${item.videoUrl})` : `transcribe (${item.videoPath})`;
      console.log(`[BatchTranscription]   - ${name}: ${type}`);
    }

    // 2. Check for cancel during scan
    if (this.cancelRequested) {
      this.setStatus('cancelled');
      this.deletePersisted();
      return;
    }

    this.setStatus('running');

    // 3. Process loop
    await this.processLoop();
  }

  pause(): void {
    if (this.status !== 'running' && this.status !== 'scanning') return;
    console.log('[BatchTranscription] Pause requested — will pause after current item completes.');
    this.pauseRequested = true;
    this.notifyObservers();
  }

  async resume(): Promise<void> {
    if (this.status !== 'paused') return;

    this.pauseRequested = false;
    this.cancelRequested = false;
    this.pausedAt = undefined;

    this.revalidatePendingItems();

    const remaining = this.items.filter(i => i.status === 'pending').length;
    console.log(`[BatchTranscription] Resuming batch (${remaining} item(s) remaining).`);
    this.setStatus('running');

    await this.processLoop();
  }

  cancel(): void {
    if (this.status === 'idle' || this.status === 'completed' || this.status === 'cancelled') return;

    console.log('[BatchTranscription] Cancel requested.');
    this.cancelRequested = true;
    this.abortController?.abort();

    // If paused, immediately transition to cancelled
    if (this.status === 'paused') {
      this.setStatus('cancelled');
      this.deletePersisted();
    }
    // If running, processLoop will handle the transition
  }

  tryRestore(): void {
    const raw = this.deps.app.loadLocalStorage(STORAGE_KEY);
    if (!raw || typeof raw !== 'string') return;

    try {
      const state: PersistedBatchState = JSON.parse(raw);
      if (state.version !== 1 || !Array.isArray(state.items)) return;

      this.mode = state.mode;
      this.items = state.items;
      this.currentIndex = state.currentIndex;
      this.startedAt = state.startedAt;

      // Demote running → paused so user must explicitly resume
      if (state.status === 'running' || state.status === 'scanning') {
        this.pausedAt = Date.now();
        this.setStatus('paused');
      } else if (state.status === 'paused') {
        this.pausedAt = state.pausedAt ?? Date.now();
        this.setStatus('paused');
      } else {
        // Terminal state — just delete
        this.deletePersisted();
        return;
      }

      console.log(`[BatchTranscriptionManager] Restored interrupted batch (${this.items.length} items, index ${this.currentIndex})`);
    } catch {
      this.deletePersisted();
    }
  }

  dispose(): void {
    this.abortController?.abort();
    this.observers.clear();
    if (this.status === 'running' || this.status === 'scanning') {
      this.persist();
    }
  }

  // ─── Revalidation ─────────────────────────────────────────────────────

  /** Pre-check pending items on resume — skip files that no longer exist (e.g. archivePath changed). */
  private revalidatePendingItems(): void {
    let skippedCount = 0;

    for (let i = this.currentIndex; i < this.items.length; i++) {
      const item = this.items[i]!;
      if (item.status !== 'pending') continue;

      const file = this.deps.app.vault.getAbstractFileByPath(item.filePath);
      if (!file || !('extension' in file) || 'children' in file) {
        item.status = 'skipped';
        item.error = 'File moved or deleted';
        skippedCount++;
      }
    }

    if (skippedCount > 0) {
      console.log(`[BatchTranscriptionManager] Revalidation: ${skippedCount} file(s) skipped (moved or deleted)`);
      this.persist();
      this.notifyObservers();
    }
  }

  // ─── Scan ────────────────────────────────────────────────────────────

  private async scan(): Promise<BatchItem[]> {
    const { app, settings } = this.deps;
    const archivePath = settings.archivePath || 'Social Archives';
    const archiveFolder = app.vault.getAbstractFileByPath(archivePath);

    // Duck-type check: TFolder has a `children` property
    if (!archiveFolder || !('children' in archiveFolder)) return [];

    const files = this.deps.collectMarkdownFiles(archiveFolder as TFolder);
    const items: BatchItem[] = [];

    for (const file of files) {
      if (this.cancelRequested) break;

      const cache = app.metadataCache.getFileCache(file);
      const frontmatter = (cache?.frontmatter as Record<string, unknown> | undefined) || {};

      // Skip already-transcribed
      if (frontmatter.videoTranscribed === true) {
        console.debug(`[BatchTranscription] Skip (already transcribed): ${file.path}`);
        continue;
      }

      // Check local videos
      const localVideoPaths = await this.deps.resolveLocalVideoPathsInNote(file.path);

      if (localVideoPaths.length > 0) {
        items.push({
          filePath: file.path,
          status: 'pending',
          videoPath: localVideoPaths[0],
        });
        continue;
      }

      // In download-and-transcribe mode, check for downloadable video URLs
      if (this.mode === 'download-and-transcribe') {
        const videoUrls = this.deps.extractDownloadableVideoUrls(frontmatter);
        if (videoUrls.length > 0) {
          items.push({
            filePath: file.path,
            status: 'pending',
            videoUrl: videoUrls[0],
          });
        }
      }
    }

    return items;
  }

  // ─── Process Loop ────────────────────────────────────────────────────

  private async processLoop(): Promise<void> {
    const { TranscriptionService } = await import('./TranscriptionService');
    const transcriptionService = new TranscriptionService();
    const { WhisperDetector } = await import('../utils/whisper');
    const { settings } = this.deps;

    const whisperAvailable = await WhisperDetector.isAvailable();
    if (!whisperAvailable) {
      console.warn('[BatchTranscription] Whisper not available — aborting batch.');
      new Notice('Whisper is not installed. Install faster-whisper, whisper.cpp, or openai-whisper to use batch transcription.', 8000);
      this.setStatus('cancelled');
      this.deletePersisted();
      return;
    }

    while (this.currentIndex < this.items.length) {
      // ── Cancel checkpoint ──
      if (this.cancelRequested) {
        console.log('[BatchTranscription] Batch cancelled.');
        this.setStatus('cancelled');
        this.deletePersisted();
        return;
      }

      // ── Pause checkpoint ──
      if (this.pauseRequested) {
        console.log(`[BatchTranscription] Batch paused at item ${this.currentIndex + 1}/${this.items.length}.`);
        this.pausedAt = Date.now();
        this.pauseRequested = false;
        this.setStatus('paused');
        this.persist();
        return;
      }

      const item = this.items[this.currentIndex]!;

      // Skip already-terminal items (from a restored batch)
      if (item.status === 'completed' || item.status === 'failed' || item.status === 'skipped') {
        this.currentIndex++;
        continue;
      }

      this.abortController = new AbortController();
      const itemName = item.filePath.split('/').pop() || item.filePath;
      const itemNum = `[${this.currentIndex + 1}/${this.items.length}]`;

      try {
        // ── Download phase (if needed) ──
        if (!item.videoPath && item.videoUrl) {
          console.log(`[BatchTranscription] ${itemNum} Downloading: ${itemName}`);
          item.status = 'downloading';
          this.notifyObservers();

          const downloaded = await this.downloadVideo(item);
          if (!downloaded) {
            console.warn(`[BatchTranscription] ${itemNum} Download FAILED: ${itemName}`);
            item.status = 'failed';
            item.error = 'Download failed';
            this.currentIndex++;
            this.persist();
            this.notifyObservers();
            continue;
          }
          console.log(`[BatchTranscription] ${itemNum} Downloaded: ${downloaded}`);
          item.videoPath = downloaded;

          // Embed video link in note body
          await this.embedVideoInNote(item.filePath, downloaded);
        }

        if (!item.videoPath) {
          console.warn(`[BatchTranscription] ${itemNum} Skipped (no video path): ${itemName}`);
          item.status = 'skipped';
          item.error = 'No video path';
          this.currentIndex++;
          this.notifyObservers();
          continue;
        }

        // ── Transcribe phase ──
        console.log(`[BatchTranscription] ${itemNum} Transcribing: ${itemName}`);
        item.status = 'transcribing';
        this.notifyObservers();

        const rawFile = this.deps.app.vault.getAbstractFileByPath(item.filePath);
        // Duck-type check: TFile has `extension` and `basename` but no `children`
        if (!rawFile || !('extension' in rawFile) || 'children' in rawFile) {
          item.status = 'skipped';
          item.error = 'File not found';
          this.currentIndex++;
          this.notifyObservers();
          continue;
        }
        const file = rawFile as TFile;

        const requestedAt = new Date().toISOString();
        await this.deps.app.fileManager.processFrontMatter(file, (fm) => {
          fm.videoTranscribed = false;
          fm.videoTranscriptionRequestedAt = requestedAt;
          delete fm.videoTranscriptionError;
        });

        const fullVideoPath = this.deps.toAbsoluteVaultPath(item.videoPath);
        const cache = this.deps.app.metadataCache.getFileCache(file);
        const frontmatter = (cache?.frontmatter as Record<string, unknown> | undefined) || {};
        const durationValue = frontmatter.duration;
        const mediaDuration = typeof durationValue === 'number'
          ? durationValue
          : typeof durationValue === 'string'
            ? Number(durationValue)
            : undefined;

        const result = await transcriptionService.transcribe(fullVideoPath, {
          model: settings.transcription.preferredModel,
          language: settings.transcription.language || 'auto',
          preferredVariant: settings.transcription.preferredVariant || 'auto',
          customWhisperPath: settings.transcription.customWhisperPath,
          forceEnableCustomPath: settings.transcription.forceEnableCustomPath,
          audioDuration: Number.isFinite(mediaDuration as number) ? mediaDuration : undefined,
          signal: this.abortController.signal,
        });

        const completedAt = new Date().toISOString();

        await this.deps.app.fileManager.processFrontMatter(file, (fm) => {
          fm.videoTranscribed = true;
          fm.videoTranscribedAt = completedAt;
          delete fm.videoTranscriptionError;
          fm.transcriptionModel = result.model;
          fm.transcriptionLanguage = result.language;
          fm.transcriptionDuration = result.duration;
          fm.transcriptionTime = completedAt;
          fm.transcriptionProcessingTime = result.processingTime;
        });

        const currentContent = await this.deps.app.vault.read(file);
        const updatedContent = this.deps.appendTranscriptSection(currentContent, result);
        if (updatedContent !== currentContent) {
          await this.deps.app.vault.modify(file, updatedContent);
        }

        item.status = 'completed';
        console.log(`[BatchTranscription] ${itemNum} DONE: ${itemName} (model: ${result.model}, lang: ${result.language})`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // Check for cancellation
        if (errorMessage.includes('cancelled') || errorMessage.includes('abort') || this.cancelRequested) {
          if (this.cancelRequested) {
            console.log('[BatchTranscription] Batch cancelled.');
            this.setStatus('cancelled');
            this.deletePersisted();
            return;
          }
        }

        item.status = 'failed';
        item.error = errorMessage;
        console.error(`[BatchTranscription] ${itemNum} FAILED: ${itemName} — ${errorMessage}`);

        // Update frontmatter with error
        try {
          const errFile = this.deps.app.vault.getAbstractFileByPath(item.filePath);
          if (errFile && 'extension' in errFile) {
            await this.deps.app.fileManager.processFrontMatter(errFile as TFile, (fm) => {
              fm.videoTranscribed = false;
              fm.videoTranscriptionError = errorMessage;
            });
          }
        } catch {
          // Best effort — don't fail the batch for a frontmatter update error
        }
      }

      this.currentIndex++;
      this.persist();
      this.notifyObservers();

      // Refresh timeline after each item so the user sees progress immediately
      if (item.status === 'completed') {
        this.deps.refreshTimelineView();
      }
    }

    // All items processed
    const completed = this.items.filter(i => i.status === 'completed').length;
    const failed = this.items.filter(i => i.status === 'failed').length;
    const skipped = this.items.filter(i => i.status === 'skipped').length;
    const elapsed = ((Date.now() - this.startedAt) / 1000).toFixed(1);
    console.log(`[BatchTranscription] Batch complete: ${completed} done, ${failed} failed, ${skipped} skipped (${elapsed}s total).`);
    this.setStatus('completed');
    this.deletePersisted();
    this.deps.refreshTimelineView();
  }

  // ─── Download Helper ─────────────────────────────────────────────────

  private async downloadVideo(item: BatchItem): Promise<string | null> {
    if (!item.videoUrl) return null;

    try {
      // Extract platform and postId from the note's frontmatter
      const rawFile = this.deps.app.vault.getAbstractFileByPath(item.filePath);
      if (!rawFile || !('extension' in rawFile)) return null;
      const file = rawFile as TFile;

      const cache = this.deps.app.metadataCache.getFileCache(file);
      const fm = (cache?.frontmatter as Record<string, unknown> | undefined) || {};
      const platform = (typeof fm.platform === 'string' ? fm.platform : 'unknown');
      const author = (typeof fm.author === 'string' ? fm.author : 'unknown');
      const postId = file.basename;

      // Try yt-dlp first for supported URLs (YouTube, TikTok, etc.)
      if (this.deps.isYtDlpUrl(item.videoUrl)) {
        const vaultRelativePath = await this.deps.downloadWithYtDlp(
          item.videoUrl,
          platform,
          postId,
          this.abortController?.signal,
        );

        if (vaultRelativePath) {
          await this.deps.app.fileManager.processFrontMatter(file, (frontmatter) => {
            frontmatter.videoDownloaded = true;
            if (!Array.isArray(frontmatter.downloadedUrls)) frontmatter.downloadedUrls = [];
            if (!frontmatter.downloadedUrls.includes(item.videoUrl)) {
              frontmatter.downloadedUrls.push(item.videoUrl);
            }
            delete frontmatter.videoDownloadFailed;
            delete frontmatter.videoDownloadFailedUrls;
          });
          return vaultRelativePath;
        }

        // yt-dlp failed — update frontmatter and return null
        await this.deps.app.fileManager.processFrontMatter(file, (frontmatter) => {
          frontmatter.videoDownloadFailed = true;
          frontmatter.videoDownloadFailedUrls = [item.videoUrl];
        });
        return null;
      }

      // Fallback: direct download via MediaHandler (for direct video URLs)
      const media: Media[] = [{ type: 'video', url: item.videoUrl }];
      const results = await this.deps.downloadMedia(media, platform, postId, author);
      if (results.length > 0 && results[0]?.localPath) {
        await this.deps.app.fileManager.processFrontMatter(file, (frontmatter) => {
          frontmatter.videoDownloaded = true;
          delete frontmatter.videoDownloadFailed;
          delete frontmatter.videoDownloadFailedUrls;
        });
        return results[0].localPath;
      }

      await this.deps.app.fileManager.processFrontMatter(file, (frontmatter) => {
        frontmatter.videoDownloadFailed = true;
        frontmatter.videoDownloadFailedUrls = [item.videoUrl];
      });

      return null;
    } catch (error) {
      console.error('[BatchTranscriptionManager] Download failed:', error);
      return null;
    }
  }

  // ─── Video Embed Helper ──────────────────────────────────────────────

  /**
   * Insert `![[video.mp4]]` embed into the note body after a successful download.
   * Replaces the video thumbnail placeholder if present, otherwise appends at the end.
   */
  private async embedVideoInNote(filePath: string, videoVaultPath: string): Promise<void> {
    try {
      const rawFile = this.deps.app.vault.getAbstractFileByPath(filePath);
      if (!rawFile || !('extension' in rawFile)) return;
      const file = rawFile as TFile;

      const content = await this.deps.app.vault.read(file);
      const videoLink = `![[${videoVaultPath}]]`;

      // Already embedded — skip
      if (content.includes(videoLink)) return;

      let updatedContent = content;

      // Replace existing video thumbnail: ![🎥 Video (duration)](path/to/thumbnail.jpg)
      const videoThumbnailRegex = /!\[🎥 Video[^\]]*\]\([^)]+\)/;
      if (videoThumbnailRegex.test(updatedContent)) {
        updatedContent = updatedContent.replace(videoThumbnailRegex, videoLink);
      } else {
        // No thumbnail found — append before the footer separator or at end
        const footerSeparator = updatedContent.lastIndexOf('\n---\n');
        if (footerSeparator > 0) {
          updatedContent = updatedContent.slice(0, footerSeparator) + `\n\n${videoLink}\n` + updatedContent.slice(footerSeparator);
        } else {
          updatedContent = updatedContent + `\n\n${videoLink}`;
        }
      }

      if (updatedContent !== content) {
        await this.deps.app.vault.modify(file, updatedContent);
        console.log(`[BatchTranscription] Embedded video in note: ${videoLink}`);
      }
    } catch (error) {
      console.warn('[BatchTranscription] Failed to embed video in note:', error);
      // Non-critical — download succeeded, embed is cosmetic
    }
  }

  // ─── State + Notification ────────────────────────────────────────────

  private setStatus(newStatus: BatchOperationStatus): void {
    this.status = newStatus;
    this.notifyObservers();
  }

  private notifyObservers(): void {
    const progress = this.getProgress();
    for (const observer of this.observers) {
      try {
        observer(progress);
      } catch {
        // Observer error should not break the batch
      }
    }
  }

  // ─── Persistence ─────────────────────────────────────────────────────

  private persist(): void {
    const state: PersistedBatchState = {
      version: 1,
      mode: this.mode,
      status: this.status,
      items: this.items,
      currentIndex: this.currentIndex,
      startedAt: this.startedAt,
      pausedAt: this.pausedAt,
    };
    this.deps.app.saveLocalStorage(STORAGE_KEY, JSON.stringify(state));
  }

  private deletePersisted(): void {
    this.deps.app.saveLocalStorage(STORAGE_KEY, null as unknown as string);
  }
}
