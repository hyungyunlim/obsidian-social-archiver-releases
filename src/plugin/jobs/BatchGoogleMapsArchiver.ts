/**
 * BatchGoogleMapsArchiver - Extracts and batch-archives Google Maps links from note content
 *
 * Responsibilities:
 * - Extracting Google Maps URLs from text content (multiple URL patterns)
 * - Showing a confirmation modal with extracted links
 * - Orchestrating batch archive via WorkersAPIClient
 * - Creating vault documents from batch archive results
 *
 * Extracted from main.ts to follow SRP.
 */

import { Modal, Setting, ButtonComponent, Notice } from 'obsidian';
import type { App } from 'obsidian';
import { VaultManager } from '../../services/VaultManager';
import { MarkdownConverter } from '../../services/MarkdownConverter';
import type { PostData, Platform } from '../../types/post';
import type { SocialArchiverSettings } from '../../types/settings';
import { getVaultOrganizationStrategy } from '../../types/settings';
import type { WorkersAPIClient, BatchArchiveJobStatusResponse } from '../../services/WorkersAPIClient';
import type { PendingJobsManager } from '../../services/PendingJobsManager';

// ============================================================================
// Types
// ============================================================================

export interface BatchGoogleMapsArchiverDeps {
  app: App;
  settings: () => SocialArchiverSettings;
  apiClient: () => WorkersAPIClient | undefined;
  pendingJobsManager: PendingJobsManager;
  archiveCompletionService: {
    enrichAuthorMetadata: (postData: PostData, platform: Platform) => Promise<void>;
  } | undefined;
  refreshTimelineView: () => void;
  ensureFolderExists: (path: string) => Promise<void>;
  notify: (message: string, timeout?: number) => void;
}

// ============================================================================
// BatchGoogleMapsArchiver
// ============================================================================

export class BatchGoogleMapsArchiver {
  private readonly deps: BatchGoogleMapsArchiverDeps;

  constructor(deps: BatchGoogleMapsArchiverDeps) {
    this.deps = deps;
  }

  // ─── Public API ──────────────────────────────────────────────────────

  /**
   * Batch archive Google Maps links from content.
   * Extracts links, shows confirmation modal, triggers batch archive,
   * and creates vault documents from results.
   */
  async batchArchiveGoogleMapsLinks(content: string, sourceNotePath?: string): Promise<void> {
    const apiClient = this.deps.apiClient();
    if (!apiClient) {
      new Notice('\u26A0\uFE0F please configure API endpoint in settings first');
      return;
    }

    const links = this.extractGoogleMapsLinks(content);

    if (links.length === 0) {
      new Notice('No Google Maps links found in current note');
      return;
    }

    if (links.length > 20) {
      new Notice(`\u26A0\uFE0F Too many links (${links.length}). Maximum is 20 per batch.`);
      return;
    }

    const confirmed = await this.showBatchArchiveConfirmation(links);
    if (!confirmed) {
      return;
    }

    new Notice(`\uD83D\uDE80 Starting batch archive of ${links.length} Google Maps locations...`);

    const pendingJobId = `batch-googlemaps-${Date.now()}`;
    const settings = this.deps.settings();

    try {
      const response = await apiClient.triggerBatchArchive({
        urls: links,
        platform: 'googlemaps',
        options: {
          downloadMedia: settings.downloadMedia !== 'text-only',
        },
      });

      await this.deps.pendingJobsManager.addJob({
        id: pendingJobId,
        url: links[0] ?? '',
        platform: 'googlemaps',
        status: 'processing',
        timestamp: Date.now(),
        retryCount: 0,
        metadata: {
          type: 'batch-archive',
          batchUrls: links,
          batchJobId: response.batchJobId,
          workerJobId: response.batchJobId,
          startedAt: Date.now(),
          downloadMedia: settings.downloadMedia,
          sourceNotePath,
        },
      });

      new Notice(`\u23F3 Batch job started (${response.urlCount} locations). Please wait...`);

      const result = await apiClient.waitForBatchJob(
        response.batchJobId,
        (_completed, _total) => {
          // Progress updates (optional)
        }
      );

      await this.processBatchArchiveResult(result, pendingJobId, sourceNotePath);

    } catch (error) {
      try {
        const job = await this.deps.pendingJobsManager.getJob(pendingJobId);
        if (job) {
          await this.deps.pendingJobsManager.updateJob(pendingJobId, {
            status: 'failed',
            metadata: {
              ...job.metadata,
              lastError: error instanceof Error ? error.message : 'Unknown error',
              failedAt: Date.now(),
            },
          });
        }
      } catch (updateError) {
        console.error('[Social Archiver] Failed to update pending job:', updateError);
      }

      new Notice(
        `\u274C Batch archive failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        8000
      );
    }
  }

  /**
   * Process batch archive result and create documents.
   */
  async processBatchArchiveResult(
    result: BatchArchiveJobStatusResponse,
    pendingJobId?: string,
    sourceNotePath?: string
  ): Promise<void> {
    const failCount = result.batchMetadata?.failedCount || 0;

    if (result.results && result.results.length > 0) {
      let created = 0;
      for (const item of result.results) {
        if (item.status === 'completed' && item.postData) {
          try {
            await this.createDocumentFromPostData(item.postData as PostData, item.url, sourceNotePath);
            created++;
          } catch (err) {
            console.error(`Failed to create document for ${item.url}:`, err);
          }
        }
      }

      this.deps.refreshTimelineView();

      if (pendingJobId) {
        try {
          await this.deps.pendingJobsManager.updateJob(pendingJobId, {
            status: 'completed',
            metadata: {
              batchCompletedCount: created,
              batchFailedCount: failCount,
              completedAt: Date.now(),
            },
          });
        } catch (updateError) {
          console.error('[Social Archiver] Failed to update pending job:', updateError);
        }
      }

      new Notice(
        `\u2705 Batch archive complete!\n` +
        `\uD83D\uDCCD Created: ${created} documents\n` +
        `\u274C Failed: ${failCount} locations`,
        8000
      );
    } else {
      new Notice(`\u26A0\uFE0F batch completed but no results received`);
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────

  /**
   * Extract Google Maps links from text content.
   */
  private extractGoogleMapsLinks(content: string): string[] {
    const patterns = [
      /https?:\/\/maps\.app\.goo\.gl\/[A-Za-z0-9_-]+(\?[^\s)"\]<>]*)?/gi,
      /https?:\/\/goo\.gl\/maps\/[A-Za-z0-9]+/gi,
      /https?:\/\/(www\.)?google\.[a-z.]+\/maps\/place\/[^\s)"\]<>]+/gi,
      /https?:\/\/maps\.google\.[a-z.]+\/[^\s)"\]<>]+/gi,
    ];

    const links: string[] = [];
    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches) {
        links.push(...matches);
      }
    }

    const uniqueLinks = Array.from(new Set(links)).map(url => {
      return url.replace(/[)"\]<>]+$/, '');
    });

    return uniqueLinks;
  }

  /**
   * Show confirmation modal for batch archive.
   */
  private async showBatchArchiveConfirmation(links: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      const app = this.deps.app;

      class BatchConfirmModal extends Modal {
        result: boolean = false;
        private modalLinks: string[];

        constructor(modalLinks: string[]) {
          super(app);
          this.modalLinks = modalLinks;
        }

        onOpen() {
          const { contentEl } = this;
          contentEl.empty();

          contentEl.createEl('h2', { text: 'Batch archive Google Maps' });

          contentEl.createEl('p', {
            text: `Found ${this.modalLinks.length} Google Maps location${this.modalLinks.length > 1 ? 's' : ''} in this note.`
          });

          const previewContainer = contentEl.createDiv({ cls: 'batch-archive-preview sa-preview-container' });

          const list = previewContainer.createEl('ol');
          for (const link of this.modalLinks.slice(0, 10)) {
            const li = list.createEl('li');
            li.createEl('a', {
              text: link.length > 50 ? link.substring(0, 50) + '...' : link,
              href: link,
            });
          }
          if (this.modalLinks.length > 10) {
            list.createEl('li', {
              text: `... and ${this.modalLinks.length - 10} more`,
              cls: 'mod-muted',
            });
          }

          new Setting(contentEl)
            .addButton((btn: ButtonComponent) => btn
              .setButtonText('Cancel')
              .onClick(() => {
                this.result = false;
                this.close();
              }))
            .addButton((btn: ButtonComponent) => btn
              .setButtonText(`Archive ${this.modalLinks.length} locations`)
              .setCta()
              .onClick(() => {
                this.result = true;
                this.close();
              }));

          this.scope.register([], 'Enter', (evt: KeyboardEvent) => {
            evt.preventDefault();
            this.result = true;
            this.close();
            return false;
          });
        }

        onClose() {
          resolve(this.result);
        }
      }

      const modal = new BatchConfirmModal(links);
      modal.open();
    });
  }

  /**
   * Create a document from PostData (used by batch archive).
   * Dynamically imports MediaHandler to avoid circular dependencies.
   */
  private async createDocumentFromPostData(
    postData: PostData,
    originalUrl: string,
    sourceNotePath?: string
  ): Promise<void> {
    const { MediaHandler } = await import('../../services/MediaHandler');

    const settings = this.deps.settings();
    const apiClient = this.deps.apiClient();

    const vaultManager = new VaultManager({
      vault: this.deps.app.vault,
      app: this.deps.app,
      basePath: settings.archivePath || 'Social Archives',
      organizationStrategy: getVaultOrganizationStrategy(settings.archiveOrganization),
      fileNameFormat: settings.fileNameFormat,
    });
    vaultManager.initialize();

    const markdownConverter = new MarkdownConverter({
      frontmatterSettings: settings.frontmatter,
    });

    if (sourceNotePath) {
      const noteName = sourceNotePath.replace(/\.md$/, '');
      postData.comment = `[[${noteName}]]`;
    }

    await this.deps.archiveCompletionService?.enrichAuthorMetadata(postData, postData.platform);

    let mediaResults: import('../../services/MediaHandler').MediaResult[] | undefined;
    if (settings.downloadMedia !== 'text-only' && apiClient && postData.media && postData.media.length > 0) {
      const mediaHandler = new MediaHandler({
        vault: this.deps.app.vault,
        app: this.deps.app,
        workersClient: apiClient,
        basePath: settings.mediaPath || 'attachments/social-archives',
        optimizeImages: true,
        imageQuality: 0.8,
        maxImageDimension: 2048
      });

      try {
        mediaResults = await mediaHandler.downloadMedia(
          postData.media,
          postData.platform,
          postData.id || 'unknown',
          postData.author?.username || postData.author?.name || 'unknown'
        );
      } catch (err) {
        console.error('[Social Archiver] Media download failed:', err);
      }
    }

    const timestamp = postData.metadata?.timestamp
      ? new Date(postData.metadata.timestamp)
      : new Date();
    const filePath = vaultManager.generateFilePath(postData, timestamp);

    const result = markdownConverter.convert(
      postData,
      undefined,
      mediaResults,
      { outputFilePath: filePath }
    );

    const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));
    await this.deps.ensureFolderExists(folderPath);

    await this.deps.app.vault.create(filePath, result.fullDocument);
  }
}
