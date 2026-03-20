import { requestUrl, TFile, stringifyYaml } from 'obsidian';
import type { App } from 'obsidian';
import { VaultManager } from '../../services/VaultManager';
import { getVaultOrganizationStrategy, type MediaDownloadMode } from '../../types/settings';
import type { SocialArchiverSettings } from '../../types/settings';
import type { PostData, Platform } from '../../types/post';
import { encodePathForMarkdownLink } from '../../utils/url';
import type { BrunchComment } from '../../types/brunch';
import type { BrunchLocalService as BrunchLocalServiceType } from '../../services/BrunchLocalService';
import type { ArchiveJobTracker } from '../../services/ArchiveJobTracker';
import type { AuthorAvatarService } from '../../services/AuthorAvatarService';

/**
 * Dependencies required by LocalArchiveCoordinator.
 * Uses getter functions for mutable singleton references.
 */
export interface LocalArchiveCoordinatorDeps {
  app: App;
  settings: () => SocialArchiverSettings;
  authorAvatarService: () => AuthorAvatarService | undefined;
  archiveJobTracker: ArchiveJobTracker;
  refreshTimelineView: () => void;
  ensureFolderExists: (path: string) => Promise<void>;
}

/**
 * Coordinates local archive fetching for platforms that bypass the Worker
 * (Naver Cafe, Naver Blog, Brunch, Naver Webtoon).
 *
 * Each method handles:
 * 1. Fetching post data via a platform-specific local service
 * 2. Downloading media to the vault
 * 3. Building YAML frontmatter and Markdown content
 * 4. Generating a VaultManager-based file path
 * 5. Saving or updating the file in the vault
 */
export class LocalArchiveCoordinator {
  private readonly app: App;
  private readonly getSettings: () => SocialArchiverSettings;
  private readonly getAuthorAvatarService: () => AuthorAvatarService | undefined;
  private readonly archiveJobTracker: ArchiveJobTracker;
  private readonly refreshTimelineView: () => void;
  private readonly ensureFolderExists: (path: string) => Promise<void>;

  constructor(deps: LocalArchiveCoordinatorDeps) {
    this.app = deps.app;
    this.getSettings = deps.settings;
    this.getAuthorAvatarService = deps.authorAvatarService;
    this.archiveJobTracker = deps.archiveJobTracker;
    this.refreshTimelineView = deps.refreshTimelineView;
    this.ensureFolderExists = deps.ensureFolderExists;
  }

  // --------------------------------------------------------------------------
  // Naver Cafe
  // --------------------------------------------------------------------------

  /**
   * Fetch Naver cafe post locally using Obsidian's requestUrl.
   * This bypasses the Worker to properly support cookie authentication.
   */
  async fetchNaverCafeLocally(
    url: string,
    filePath: string | undefined,
    downloadMode: MediaDownloadMode,
    options?: {
      comment?: string;
      originalUrl?: string;
    }
  ): Promise<void> {
    const startTime = Date.now();
    const settings = this.getSettings();

    try {
      const { NaverCafeLocalService } = await import('../../services/NaverCafeLocalService');
      const service = new NaverCafeLocalService(settings.naverCookie);
      const postData = await service.fetchPost(url);

      // postData.text already contains properly formatted markdown from convertHtmlToMarkdown()
      // Build the document directly without going through markdownConverter

      // Format timestamp (use local timezone)
      const timestamp = postData.timestamp;
      const archivedDate = window.moment().format('YYYY-MM-DD HH:mm');

      // Download media if enabled
      const downloadedMedia: Array<{ originalUrl: string; localPath: string }> = [];
      const mediaBasePath = settings.mediaPath || 'attachments/social-archives';

      if (downloadMode !== 'text-only' && postData.media && postData.media.length > 0) {
        for (let i = 0; i < postData.media.length; i++) {
          const media = postData.media[i];
          if (!media) continue;

          if (downloadMode === 'images-only' && media.type !== 'photo') {
            continue;
          }

          const mediaUrl = media.url;
          if (!mediaUrl) continue;

          try {
            // Determine file extension
            let extension = 'png';
            const urlMatch = mediaUrl.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
            if (urlMatch && urlMatch[1]) {
              const ext = urlMatch[1].toLowerCase();
              if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4'].includes(ext)) {
                extension = ext;
              }
            }

            // Use subfolder structure: attachments/social-archives/naver/articleId/
            const postMediaFolder = `${mediaBasePath}/naver/${postData.id}`;
            const filename = `${i + 1}.${extension}`;
            const localPath = `${postMediaFolder}/${filename}`;

            // Download using Obsidian's requestUrl
            const response = await requestUrl({
              url: mediaUrl,
              method: 'GET',
            });

            if (response.arrayBuffer) {
              // Ensure media folder exists using the safe method
              await this.ensureFolderExists(postMediaFolder);

              // Save the file
              await this.app.vault.adapter.writeBinary(localPath, response.arrayBuffer);
              downloadedMedia.push({ originalUrl: mediaUrl, localPath });
            }
          } catch (error) {
            console.warn(`[Social Archiver] Failed to download media: ${mediaUrl}`, error);
          }
        }
      }

      // Replace image URLs in content with local paths
      let content = postData.text;
      for (const media of downloadedMedia) {
        // Replace the remote URL with local path
        content = content.replace(
          new RegExp(`!\\[([^\\]]*)\\]\\(${media.originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g'),
          `![$1](${encodePathForMarkdownLink(media.localPath)})`
        );
      }

      // Process video placeholders: download videos and replace placeholders
      if (downloadMode !== 'text-only') {
        const videos = service.extractVideoMetadata(content);
        if (videos.length > 0) {
          console.debug(`[Social Archiver] Found ${videos.length} video(s) to download`);
          let videoCount = 0;

          for (const video of videos) {
            try {
              const videoQuality = await service.fetchVideoUrl(video.vid, video.inkey);

              if (videoQuality && videoQuality.source) {
                // Download video
                const videoResponse = await requestUrl({
                  url: videoQuality.source,
                  method: 'GET',
                });

                if (videoResponse.arrayBuffer) {
                  const postMediaFolder = `${mediaBasePath}/naver/${postData.id}`;
                  const videoFilename = `video-${videoCount + 1}.mp4`;
                  const videoPath = `${postMediaFolder}/${videoFilename}`;

                  await this.ensureFolderExists(postMediaFolder);
                  await this.app.vault.adapter.writeBinary(videoPath, videoResponse.arrayBuffer);

                  // Replace placeholder with video embed
                  const placeholder = `<!--VIDEO:${video.vid}:${video.inkey}-->`;
                  content = content.replace(placeholder, `![[${videoPath}]]`);

                  videoCount++;
                  console.debug(`[Social Archiver] Downloaded video: ${videoQuality.name}`);
                }
              } else {
                // If video fetch failed, replace placeholder with fallback text
                const placeholder = `<!--VIDEO:${video.vid}:${video.inkey}-->`;
                content = content.replace(placeholder, '[비디오]');
              }
            } catch (error) {
              console.warn(`[Social Archiver] Failed to download video:`, error);
              const placeholder = `<!--VIDEO:${video.vid}:${video.inkey}-->`;
              content = content.replace(placeholder, '[비디오]');
            }
          }

          if (videoCount > 0) {
            console.debug(`[Social Archiver] Downloaded ${videoCount} video(s)`);
          }
        }
      }

      // Extract link previews from content
      const { LinkPreviewExtractor } = await import('../../services/LinkPreviewExtractor');
      const linkExtractor = new LinkPreviewExtractor({
        maxLinks: 5,
        excludeImages: true,
        excludePlatformUrls: false,
      });
      const extractedLinks = linkExtractor.extractUrls(content, 'naver');
      const linkPreviews = extractedLinks.map(link => link.url);

      // Download author avatar if enabled
      let localAvatarPath: string | null = null;
      const authorAvatarService = this.getAuthorAvatarService();
      if (settings.downloadAuthorAvatars && authorAvatarService && postData.author.avatar) {
        try {
          localAvatarPath = await authorAvatarService.downloadAndSaveAvatar(
            postData.author.avatar,
            'naver',
            postData.author.name,
            settings.overwriteAuthorAvatar
          );
          console.debug(`[Social Archiver] Downloaded author avatar: ${localAvatarPath}`);
        } catch (error) {
          console.warn('[Social Archiver] Failed to download author avatar:', error);
          // Continue without avatar
        }
      }

      // Build YAML frontmatter (timeline-compatible format)
      // Format published date with time
      const cafePublishedDate = timestamp.toLocaleString('sv-SE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).replace('T', ' ');

      const frontmatterObj: Record<string, unknown> = {
        share: false,
        platform: 'naver',
        title: postData.title,
        author: postData.author.name,
        authorUrl: postData.author.url,
        published: cafePublishedDate,
        archived: archivedDate,
        lastModified: archivedDate,
        archive: false,
        articleId: postData.id,
        cafeId: postData.cafeId,
        cafeName: postData.cafeName,
        cafeUrl: postData.cafeUrl,
        originalUrl: postData.url,
        source: 'naver-cafe',
      };
      if (localAvatarPath) frontmatterObj.authorAvatar = `[[${localAvatarPath}]]`;
      if (postData.author.avatar) frontmatterObj.avatarUrl = postData.author.avatar;
      if (postData.author.grade) frontmatterObj.authorBio = postData.author.grade;
      // Author stats (flat format for Obsidian compatibility)
      if (postData.author.stats?.visitCount) frontmatterObj.authorProfileVisits = postData.author.stats.visitCount;
      if (postData.author.stats?.articleCount) frontmatterObj.authorProfilePosts = postData.author.stats.articleCount;
      if (postData.author.stats?.commentCount) frontmatterObj.authorProfileComments = postData.author.stats.commentCount;
      if (postData.author.stats?.subscriberCount) frontmatterObj.authorFollowers = postData.author.stats.subscriberCount;
      // Author trade review (for marketplace cafes, flat format)
      if (postData.author.tradeReview?.bestCount) frontmatterObj.authorTradeReviewBest = postData.author.tradeReview.bestCount;
      if (postData.author.tradeReview?.goodCount) frontmatterObj.authorTradeReviewGood = postData.author.tradeReview.goodCount;
      if (postData.author.tradeReview?.sorryCount) frontmatterObj.authorTradeReviewSorry = postData.author.tradeReview.sorryCount;
      if (postData.menuName) frontmatterObj.menuName = postData.menuName;
      if (postData.viewCount > 0) frontmatterObj.views = postData.viewCount;
      if (postData.likes > 0) frontmatterObj.likes = postData.likes;
      if (postData.commentCount > 0) frontmatterObj.comments = postData.commentCount;
      if (linkPreviews.length > 0) frontmatterObj.linkPreviews = linkPreviews;
      if (options?.comment) frontmatterObj.comment = options.comment;
      const frontmatter = `---\n${stringifyYaml(frontmatterObj)}---`;

      // Build comments section if there are comments (matching other platforms format)
      let commentsSection = '';
      if (postData.comments && postData.comments.length > 0) {
        const formattedComments: string[] = [];

        for (const comment of postData.comments) {
          if (comment.isReply) continue; // Process replies with their parent

          const likes = comment.likeCount ? ` · ${comment.likeCount} likes` : '';
          let commentBlock = `**${comment.writerNickname}** · ${comment.writeDate}${likes}\n${comment.content}`;

          // Find replies to this comment
          const replies = postData.comments.filter(c =>
            c.isReply && c.parentCommentId === comment.commentId
          );

          if (replies.length > 0) {
            for (const reply of replies) {
              const replyLikes = reply.likeCount ? ` · ${reply.likeCount} likes` : '';
              commentBlock += `\n\n  ↳ **${reply.writerNickname}** · ${reply.writeDate}${replyLikes}\n  ${reply.content}`;
            }
          }

          formattedComments.push(commentBlock);
        }

        if (formattedComments.length > 0) {
          commentsSection = '\n\n## 💬 Comments\n\n' + formattedComments.join('\n\n---\n\n');
        }
      }

      // Build full document
      const fullDocument = [
        frontmatter,
        content,
        commentsSection,
      ].join('\n');

      // Generate correct file path using actual post data
      const vaultManager = new VaultManager({
        vault: this.app.vault,
        app: this.app,
        basePath: settings.archivePath || 'Social Archives',
        organizationStrategy: getVaultOrganizationStrategy(settings.archiveOrganization),
        fileNameFormat: settings.fileNameFormat,
      });
      vaultManager.initialize();

      // Create proper PostData for file path generation
      const properPostData: PostData = {
        platform: 'naver' as Platform,
        id: postData.id,
        url: postData.url,
        author: {
          name: postData.author.name,
          url: postData.author.url,
        },
        content: {
          text: postData.text,
        },
        media: postData.media.map(m => ({
          type: m.type === 'photo' ? 'image' as const : 'video' as const,
          url: m.url,
        })),
        metadata: {
          timestamp: postData.timestamp,
          likes: postData.likes,
        },
        title: postData.title,
      };

      // Delete the preliminary file if it exists (backward compat with older jobs)
      if (filePath) {
        const preliminaryFile = this.app.vault.getAbstractFileByPath(filePath);
        if (preliminaryFile && preliminaryFile instanceof TFile) {
          await this.app.fileManager.trashFile(preliminaryFile);
        } else if (preliminaryFile) {
          console.warn(`[Social Archiver] Unexpected: preliminary file path points to a folder, skipping delete: ${filePath}`);
        }
      }

      // Generate new file path with actual author name and title
      const newFilePath = vaultManager.generateFilePath(properPostData);

      // Ensure folder exists
      const folderPath = newFilePath.substring(0, newFilePath.lastIndexOf('/'));
      await this.ensureFolderExists(folderPath);

      // Create or update the file with correct filename
      const existingFile = this.app.vault.getAbstractFileByPath(newFilePath);
      if (existingFile && existingFile instanceof TFile) {
        // File already exists (re-archiving same post), update it instead
        await this.app.vault.process(existingFile, () => fullDocument);
        console.debug(`[Social Archiver] Updated existing Naver cafe archive: ${newFilePath}`);
      } else {
        // Create new file
        await this.app.vault.create(newFilePath, fullDocument);
      }

      const processingTime = Date.now() - startTime;
      console.debug(`[Social Archiver] Naver cafe archived locally in ${processingTime}ms`);

      // Refresh timeline view
      this.refreshTimelineView();

    } catch (error) {
      console.error('[Social Archiver] Naver cafe local fetch failed:', error);

      // Update preliminary document with error state if it exists (backward compat)
      if (filePath) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          await this.app.vault.process(file, (content) => content.replace(
            /archiveStatus: pending/,
            'archiveStatus: failed'
          ).replace(
            /^(---[\s\S]*?---)$/m,
            `$1\n\n> [!error] Archive Failed\n> ${errorMessage}`
          ));
        }
      }

      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Naver Blog
  // --------------------------------------------------------------------------

  /**
   * Fetch Naver blog post locally using Obsidian's requestUrl.
   * This bypasses the Worker to reduce latency and BrightData credit usage.
   */
  async fetchNaverBlogLocally(
    url: string,
    filePath: string | undefined,
    downloadMode: MediaDownloadMode,
    options?: {
      comment?: string;
      originalUrl?: string;
    }
  ): Promise<void> {
    const startTime = Date.now();
    const settings = this.getSettings();

    try {
      const { NaverBlogLocalService } = await import('../../services/NaverBlogLocalService');
      const service = new NaverBlogLocalService(settings.naverCookie);
      const postData = await service.fetchPost(url);

      // Format timestamp
      const timestamp = postData.timestamp;
      const archivedDate = window.moment().format('YYYY-MM-DD HH:mm');

      // Download media if enabled
      const downloadedMedia: Array<{ originalUrl: string; localPath: string }> = [];
      const mediaBasePath = settings.mediaPath || 'attachments/social-archives';

      if (downloadMode !== 'text-only' && postData.media && postData.media.length > 0) {
        for (let i = 0; i < postData.media.length; i++) {
          const media = postData.media[i];
          if (!media) continue;

          if (downloadMode === 'images-only' && media.type !== 'photo') {
            continue;
          }

          const mediaUrl = media.url;
          if (!mediaUrl) continue;

          try {
            // Determine file extension
            let extension = 'png';
            const urlMatch = mediaUrl.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
            if (urlMatch && urlMatch[1]) {
              const ext = urlMatch[1].toLowerCase();
              if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4'].includes(ext)) {
                extension = ext;
              }
            }

            // Use subfolder structure: attachments/social-archives/naver/logNo/
            const postMediaFolder = `${mediaBasePath}/naver/${postData.id}`;
            const filename = `${i + 1}.${extension}`;
            const localPath = `${postMediaFolder}/${filename}`;

            // Download using Obsidian's requestUrl
            const response = await requestUrl({
              url: mediaUrl,
              method: 'GET',
            });

            if (response.arrayBuffer) {
              await this.ensureFolderExists(postMediaFolder);
              await this.app.vault.adapter.writeBinary(localPath, response.arrayBuffer);
              downloadedMedia.push({ originalUrl: mediaUrl, localPath });
            }
          } catch (error) {
            console.warn(`[Social Archiver] Failed to download media: ${mediaUrl}`, error);
          }
        }
      }

      // Replace image URLs in content with local paths
      let content = postData.text;
      for (const media of downloadedMedia) {
        content = content.replace(
          new RegExp(`!\\[([^\\]]*)\\]\\(${media.originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g'),
          `![$1](${encodePathForMarkdownLink(media.localPath)})`
        );
      }

      // Process video placeholders: download videos and replace placeholders
      if (downloadMode !== 'text-only') {
        const videos = service.extractVideoMetadata(content);
        if (videos.length > 0) {
          console.debug(`[Social Archiver] Found ${videos.length} blog video(s) to download`);
          let videoCount = 0;

          for (const video of videos) {
            try {
              const videoQuality = await service.fetchVideoUrl(video.vid, video.inkey);

              if (videoQuality && videoQuality.source) {
                // Download video
                const videoResponse = await requestUrl({
                  url: videoQuality.source,
                  method: 'GET',
                });

                if (videoResponse.arrayBuffer) {
                  const postMediaFolder = `${mediaBasePath}/naver/${postData.id}`;
                  const videoFilename = `video-${videoCount + 1}.mp4`;
                  const videoPath = `${postMediaFolder}/${videoFilename}`;

                  await this.ensureFolderExists(postMediaFolder);
                  await this.app.vault.adapter.writeBinary(videoPath, videoResponse.arrayBuffer);

                  // Replace both placeholder patterns
                  const placeholder1 = `<!--VIDEO:${video.vid}-->`;
                  const placeholder2 = video.inkey ? `<!--VIDEO:${video.vid}:${video.inkey}-->` : null;
                  content = content.replace(placeholder1, `![[${videoPath}]]`);
                  if (placeholder2) {
                    content = content.replace(placeholder2, `![[${videoPath}]]`);
                  }

                  videoCount++;
                  console.debug(`[Social Archiver] Downloaded blog video: ${videoQuality.name}`);
                }
              } else {
                // If video fetch failed, replace placeholder with fallback text
                const placeholder1 = `<!--VIDEO:${video.vid}-->`;
                const placeholder2 = video.inkey ? `<!--VIDEO:${video.vid}:${video.inkey}-->` : null;
                content = content.replace(placeholder1, '[비디오]');
                if (placeholder2) {
                  content = content.replace(placeholder2, '[비디오]');
                }
              }
            } catch (error) {
              console.warn(`[Social Archiver] Failed to download blog video:`, error);
              const placeholder1 = `<!--VIDEO:${video.vid}-->`;
              content = content.replace(placeholder1, '[비디오]');
            }
          }

          if (videoCount > 0) {
            console.debug(`[Social Archiver] Downloaded ${videoCount} blog video(s)`);
          }
        }
      }

      // Extract link previews from content
      const { LinkPreviewExtractor } = await import('../../services/LinkPreviewExtractor');
      const linkExtractor = new LinkPreviewExtractor({
        maxLinks: 5,
        excludeImages: true,
        excludePlatformUrls: false,
      });
      const extractedLinks = linkExtractor.extractUrls(content, 'naver');
      const linkPreviews = extractedLinks.map(link => link.url);

      // Build YAML frontmatter (timeline-compatible format)
      // Format published date with time
      const blogPublishedDate = timestamp.toLocaleString('sv-SE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).replace('T', ' ');

      const frontmatterObj: Record<string, unknown> = {
        share: false,
        platform: 'naver',
        title: postData.title,
        author: postData.author.name,
        authorUrl: postData.author.url,
        published: blogPublishedDate,
        archived: archivedDate,
        lastModified: archivedDate,
        archive: false,
        logNo: postData.id,
        blogId: postData.blogId,
        originalUrl: postData.url,
        source: 'naver-blog',
      };
      if (postData.blogName) frontmatterObj.blogName = postData.blogName;
      if (postData.categoryName) frontmatterObj.categoryName = postData.categoryName;
      if (postData.viewCount > 0) frontmatterObj.views = postData.viewCount;
      if (postData.likes > 0) frontmatterObj.likes = postData.likes;
      if (postData.commentCount > 0) frontmatterObj.comments = postData.commentCount;
      if (postData.tags && postData.tags.length > 0) frontmatterObj.tags = postData.tags;
      if (linkPreviews.length > 0) frontmatterObj.linkPreviews = linkPreviews;
      if (options?.comment) frontmatterObj.comment = options.comment;
      const frontmatter = `---\n${stringifyYaml(frontmatterObj)}---`;

      // Build full document
      const fullDocument = [
        frontmatter,
        content,
      ].join('\n');

      // Generate correct file path using actual post data
      const vaultManager = new VaultManager({
        vault: this.app.vault,
        app: this.app,
        basePath: settings.archivePath || 'Social Archives',
        organizationStrategy: getVaultOrganizationStrategy(settings.archiveOrganization),
        fileNameFormat: settings.fileNameFormat,
      });
      vaultManager.initialize();

      // Create proper PostData for file path generation
      const properPostData: PostData = {
        platform: 'naver' as Platform,
        id: postData.id,
        url: postData.url,
        author: {
          name: postData.author.name,
          url: postData.author.url,
        },
        content: {
          text: postData.text,
        },
        media: postData.media.map(m => ({
          type: m.type === 'photo' ? 'image' as const : 'video' as const,
          url: m.url,
        })),
        metadata: {
          timestamp: postData.timestamp,
          likes: postData.likes,
        },
        title: postData.title,
      };

      // Delete the preliminary file if it exists (backward compat with older jobs)
      if (filePath) {
        const preliminaryFile = this.app.vault.getAbstractFileByPath(filePath);
        if (preliminaryFile && preliminaryFile instanceof TFile) {
          await this.app.fileManager.trashFile(preliminaryFile);
        } else if (preliminaryFile) {
          console.warn(`[Social Archiver] Unexpected: preliminary file path points to a folder, skipping delete: ${filePath}`);
        }
      }

      // Generate new file path with actual author name and title
      const newFilePath = vaultManager.generateFilePath(properPostData);

      // Ensure folder exists
      const folderPath = newFilePath.substring(0, newFilePath.lastIndexOf('/'));
      await this.ensureFolderExists(folderPath);

      // Create or update the file with correct filename
      const existingFile = this.app.vault.getAbstractFileByPath(newFilePath);
      if (existingFile && existingFile instanceof TFile) {
        await this.app.vault.process(existingFile, () => fullDocument);
        console.debug(`[Social Archiver] Updated existing Naver blog archive: ${newFilePath}`);
      } else {
        await this.app.vault.create(newFilePath, fullDocument);
      }

      const processingTime = Date.now() - startTime;
      console.debug(`[Social Archiver] Naver blog archived locally in ${processingTime}ms`);

      // Refresh timeline view
      this.refreshTimelineView();

    } catch (error) {
      console.error('[Social Archiver] Naver blog local fetch failed:', error);

      // Update preliminary document with error state if it exists (backward compat)
      if (filePath) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            fm['archiveStatus'] = 'failed';
            fm['archiveError'] = errorMessage;
          });
        }
      }

      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Brunch
  // --------------------------------------------------------------------------

  /**
   * Fetch and save a Brunch post using local service.
   * This bypasses the Worker to reduce latency and BrightData credit usage.
   */
  async fetchBrunchLocally(
    url: string,
    filePath: string | undefined,
    downloadMode: MediaDownloadMode,
    options?: {
      comment?: string;
      originalUrl?: string;
    }
  ): Promise<void> {
    const startTime = Date.now();
    const settings = this.getSettings();

    try {
      const { BrunchLocalService } = await import('../../services/BrunchLocalService');
      const service = new BrunchLocalService();
      const postData = await service.fetchPost(url);

      // Format timestamp
      const timestamp = postData.timestamp;
      const archivedDate = window.moment().format('YYYY-MM-DD HH:mm');

      // Download media if enabled
      const downloadedMedia: Array<{ originalUrl: string; localPath: string }> = [];
      const mediaBasePath = settings.mediaPath || 'attachments/social-archives';

      if (downloadMode !== 'text-only' && postData.media && postData.media.length > 0) {
        for (let i = 0; i < postData.media.length; i++) {
          const media = postData.media[i];
          if (!media) continue;

          if (downloadMode === 'images-only' && media.type !== 'photo') {
            continue;
          }

          const mediaUrl = media.url;
          if (!mediaUrl) continue;

          try {
            // Determine file extension
            let extension = 'png';
            const urlMatch = mediaUrl.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
            if (urlMatch && urlMatch[1]) {
              const ext = urlMatch[1].toLowerCase();
              if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4'].includes(ext)) {
                extension = ext;
              }
            }

            // Use subfolder structure: attachments/social-archives/brunch/postId/
            const postMediaFolder = `${mediaBasePath}/brunch/${postData.id}`;
            const filename = `${i + 1}.${extension}`;
            const localPath = `${postMediaFolder}/${filename}`;

            // Download using Obsidian's requestUrl
            const response = await requestUrl({
              url: mediaUrl,
              method: 'GET',
            });

            if (response.arrayBuffer) {
              await this.ensureFolderExists(postMediaFolder);
              await this.app.vault.adapter.writeBinary(localPath, response.arrayBuffer);
              downloadedMedia.push({ originalUrl: mediaUrl, localPath });
            }
          } catch (error) {
            console.warn(`[Social Archiver] Failed to download Brunch media: ${mediaUrl}`, error);
          }
        }
      }

      // Replace image URLs in content with local paths
      let content = postData.text;
      for (const media of downloadedMedia) {
        content = content.replace(
          new RegExp(`!\\[([^\\]]*)\\]\\(${media.originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g'),
          `![$1](${encodePathForMarkdownLink(media.localPath)})`
        );
      }

      // Process KakaoTV video placeholders if enabled
      if (downloadMode !== 'text-only' && postData.videos && postData.videos.length > 0) {
        console.debug(`[Social Archiver] Found ${postData.videos.length} Brunch video(s) to process`);
        let videoCount = 0;

        for (const video of postData.videos) {
          if (!video.videoId) continue;

          try {
            // Attempt to fetch KakaoTV video URL
            const videoInfo = await service.getKakaoVideoInfo(video.videoId, url);

            if (videoInfo && videoInfo.mp4Url) {
              // Download video
              const videoResponse = await requestUrl({
                url: videoInfo.mp4Url,
                method: 'GET',
              });

              if (videoResponse.arrayBuffer) {
                const postMediaFolder = `${mediaBasePath}/brunch/${postData.id}`;
                const videoFilename = `video-${videoCount + 1}.mp4`;
                const videoPath = `${postMediaFolder}/${videoFilename}`;

                await this.ensureFolderExists(postMediaFolder);
                await this.app.vault.adapter.writeBinary(videoPath, videoResponse.arrayBuffer);

                // Replace video placeholder with local embed
                const placeholder = `<!--KAKAOTV:${video.videoId}-->`;
                content = content.replace(placeholder, `![[${videoPath}]]`);

                videoCount++;
                console.debug(`[Social Archiver] Downloaded Brunch video: ${video.videoId}`);
              }
            } else {
              // If video fetch failed, keep the placeholder or replace with fallback
              const placeholder = `<!--KAKAOTV:${video.videoId}-->`;
              content = content.replace(placeholder, video.thumbnail
                ? `![Video thumbnail](${encodePathForMarkdownLink(video.thumbnail)})\n[Watch on KakaoTV](https://tv.kakao.com/v/${video.videoId})`
                : `[Watch on KakaoTV](https://tv.kakao.com/v/${video.videoId})`
              );
            }
          } catch (error) {
            console.warn(`[Social Archiver] Failed to download Brunch video: ${video.videoId}`, error);
            const placeholder = `<!--KAKAOTV:${video.videoId}-->`;
            content = content.replace(placeholder, `[비디오: KakaoTV ${video.videoId}]`);
          }
        }

        if (videoCount > 0) {
          console.debug(`[Social Archiver] Downloaded ${videoCount} Brunch video(s)`);
        }
      }

      // Extract link previews from content
      const { LinkPreviewExtractor } = await import('../../services/LinkPreviewExtractor');
      const linkExtractor = new LinkPreviewExtractor({
        maxLinks: 5,
        excludeImages: true,
        excludePlatformUrls: false,
      });
      const extractedLinks = linkExtractor.extractUrls(content, 'brunch');
      const linkPreviews = extractedLinks.map(link => link.url);

      // Fetch and append comments if userId is available and commentCount > 0
      console.debug(`[Social Archiver] Comment fetch check - userId: ${postData.author.userId}, commentCount: ${postData.commentCount}`);
      if (postData.author.userId && postData.commentCount && postData.commentCount > 0) {
        try {
          console.debug(`[Social Archiver] Fetching ${postData.commentCount} Brunch comments for userId=${postData.author.userId}, postId=${postData.id}...`);
          const comments = await service.fetchComments(postData.author.userId, postData.id);
          if (comments.length > 0) {
            // Extract all internal IDs from comments (both content mentions and author URLs)
            const allInternalIds: string[] = [];
            const collectInternalIds = (commentList: BrunchComment[]) => {
              for (const c of commentList) {
                // Extract from content mentions
                allInternalIds.push(...BrunchLocalService.extractInternalIds(c.content));
                // Extract from author URL (e.g., https://brunch.co.kr/@bfbK)
                if (c.authorUrl) {
                  const authorMatch = c.authorUrl.match(/brunch\.co\.kr\/@([^/]+)/);
                  if (authorMatch && authorMatch[1] && BrunchLocalService.isInternalId(authorMatch[1])) {
                    allInternalIds.push(authorMatch[1]);
                  }
                }
                if (c.replies) {
                  collectInternalIds(c.replies);
                }
              }
            };
            collectInternalIds(comments);

            // Resolve internal IDs to real author usernames
            let authorMap = new Map<string, string>();
            if (allInternalIds.length > 0) {
              console.debug(`[Social Archiver] Resolving ${allInternalIds.length} internal author IDs...`);
              authorMap = await service.resolveInternalIds(allInternalIds);
              console.debug(`[Social Archiver] Resolved ${authorMap.size} author IDs`);
            }

            const commentsMarkdown = this.formatBrunchCommentsToMarkdown(comments, authorMap, BrunchLocalService);
            content += commentsMarkdown;
            console.debug(`[Social Archiver] Appended ${comments.length} comments to content`);
          }
        } catch (error) {
          console.warn('[Social Archiver] Failed to fetch Brunch comments:', error);
          // Continue without comments
        }
      }

      // Download author avatar if enabled
      let localAvatarPath: string | null = null;
      const authorAvatarService = this.getAuthorAvatarService();
      if (settings.downloadAuthorAvatars && authorAvatarService && postData.author.avatar) {
        try {
          localAvatarPath = await authorAvatarService.downloadAndSaveAvatar(
            postData.author.avatar,
            'brunch',
            postData.author.name,
            settings.overwriteAuthorAvatar
          );
          console.debug(`[Social Archiver] Downloaded author avatar: ${localAvatarPath}`);
        } catch (error) {
          console.warn('[Social Archiver] Failed to download author avatar:', error);
        }
      }

      // Build YAML frontmatter (timeline-compatible format matching Instagram/other platforms)
      // Format published date with time
      const publishedDate = timestamp.toLocaleString('sv-SE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).replace('T', ' ');

      const frontmatterObj: Record<string, unknown> = {
        share: false,
        platform: 'brunch',
        title: postData.title,
        author: postData.author.name,
        authorId: postData.author.id,
        authorUrl: postData.author.url,
        published: publishedDate,
        archived: archivedDate,
        lastModified: archivedDate,
        archive: false,
        postId: postData.id,
        originalUrl: postData.url,
      };
      if (postData.subtitle) frontmatterObj.subtitle = postData.subtitle;
      if (localAvatarPath) frontmatterObj.authorAvatar = localAvatarPath;
      else if (postData.author.avatar) frontmatterObj.authorAvatar = postData.author.avatar;
      if (postData.author.bio) frontmatterObj.authorBio = postData.author.bio.replace(/\n/g, ' ');
      if (postData.author.job) frontmatterObj.authorJob = postData.author.job;
      if (postData.author.subscriberCount) frontmatterObj.subscriberCount = postData.author.subscriberCount;
      if (postData.series) frontmatterObj.seriesId = postData.series.id;
      if (postData.series) frontmatterObj.seriesTitle = postData.series.title;
      if (postData.series?.episode) frontmatterObj.seriesEpisode = postData.series.episode;
      if (postData.viewCount !== undefined) frontmatterObj.views = postData.viewCount;
      if (postData.likes !== undefined) frontmatterObj.likes = postData.likes;
      if (postData.commentCount !== undefined) frontmatterObj.comments = postData.commentCount;
      if (postData.tags && postData.tags.length > 0) frontmatterObj.tags = postData.tags;
      if (linkPreviews.length > 0) frontmatterObj.linkPreviews = linkPreviews;
      if (options?.comment) frontmatterObj.comment = options.comment;
      const frontmatter = `---\n${stringifyYaml(frontmatterObj)}---`;

      // Build full document
      const fullDocument = [
        frontmatter,
        content,
      ].join('\n');

      // Generate correct file path using actual post data
      const vaultManager = new VaultManager({
        vault: this.app.vault,
        app: this.app,
        basePath: settings.archivePath || 'Social Archives',
        organizationStrategy: getVaultOrganizationStrategy(settings.archiveOrganization),
        fileNameFormat: settings.fileNameFormat,
      });
      vaultManager.initialize();

      // Create proper PostData for file path generation
      const properPostData: PostData = {
        platform: 'brunch' as Platform,
        id: postData.id,
        url: postData.url,
        author: {
          name: postData.author.name,
          url: postData.author.url,
        },
        content: {
          text: postData.text,
        },
        media: postData.media.map(m => ({
          type: m.type === 'photo' ? 'image' as const : 'video' as const,
          url: m.url,
        })),
        metadata: {
          timestamp: postData.timestamp,
          likes: postData.likes,
        },
        title: postData.title,
      };

      // Delete the preliminary file if it exists (backward compat with older jobs)
      if (filePath) {
        const preliminaryFile = this.app.vault.getAbstractFileByPath(filePath);
        if (preliminaryFile && preliminaryFile instanceof TFile) {
          await this.app.fileManager.trashFile(preliminaryFile);
        } else if (preliminaryFile) {
          console.warn(`[Social Archiver] Unexpected: preliminary file path points to a folder, skipping delete: ${filePath}`);
        }
      }

      // Generate new file path with actual author name and title
      const newFilePath = vaultManager.generateFilePath(properPostData);

      // Ensure folder exists
      const folderPath = newFilePath.substring(0, newFilePath.lastIndexOf('/'));
      await this.ensureFolderExists(folderPath);

      // Create or update the file with correct filename
      const existingFile = this.app.vault.getAbstractFileByPath(newFilePath);
      if (existingFile && existingFile instanceof TFile) {
        await this.app.vault.process(existingFile, () => fullDocument);
        console.debug(`[Social Archiver] Updated existing Brunch archive: ${newFilePath}`);
      } else {
        await this.app.vault.create(newFilePath, fullDocument);
      }

      const processingTime = Date.now() - startTime;
      console.debug(`[Social Archiver] Brunch post archived locally in ${processingTime}ms`);

      // Refresh timeline view
      this.refreshTimelineView();

    } catch (error) {
      console.error('[Social Archiver] Brunch local fetch failed:', error);

      // Update preliminary document with error state if it exists (backward compat)
      if (filePath) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          await this.app.vault.process(file, (content) => content.replace(
            /archiveStatus: pending/,
            'archiveStatus: failed'
          ).replace(
            /^(---[\s\S]*?---)$/m,
            `$1\n\n> [!error] Archive Failed\n> ${errorMessage}`
          ));
        }
      }

      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Naver Webtoon
  // --------------------------------------------------------------------------

  /**
   * Fetch and save a Naver Webtoon episode using local service.
   * This bypasses the Worker for faster image downloads.
   */
  async fetchNaverWebtoonLocally(
    url: string,
    filePath: string | undefined,
    downloadMode: MediaDownloadMode,
    options?: {
      comment?: string;
      originalUrl?: string;
      jobId?: string;
    }
  ): Promise<void> {
    const startTime = Date.now();
    const settings = this.getSettings();

    try {
      // Show initial progress in banner
      if (options?.jobId) {
        this.archiveJobTracker.updateProgress(options.jobId, 'Fetching episode data...');
      }

      const { NaverWebtoonLocalService } = await import('../../services/NaverWebtoonLocalService');
      const service = new NaverWebtoonLocalService();
      const postData = await service.fetchEpisode(url);

      console.debug(`[Social Archiver] Fetched webtoon episode: ${postData.title} (${postData.media.length} images)`);

      // Format timestamps
      const timestamp = postData.timestamp;
      const publishedDate = window.moment(timestamp).format('YYYY-MM-DD HH:mm');
      const archivedDate = window.moment().format('YYYY-MM-DD HH:mm');

      // Download images if enabled
      const downloadedMedia: Array<{ originalUrl: string; localPath: string }> = [];
      const mediaBasePath = settings.mediaPath || 'attachments/social-archives';
      const totalMediaCount = postData.media.length;

      if (downloadMode !== 'text-only' && totalMediaCount > 0) {
        // Webtoons usually have many images (30-80+), show progress for any download
        if (options?.jobId) {
          this.archiveJobTracker.updateProgress(options.jobId, `Downloading images (0/${totalMediaCount})...`);
        }

        const postMediaFolder = `${mediaBasePath}/naver-webtoon/${postData.series.id}/${postData.series.episode}`;
        await this.ensureFolderExists(postMediaFolder);

        for (let i = 0; i < totalMediaCount; i++) {
          const media = postData.media[i];
          if (!media) continue;

          // Update progress every 5 items (webtoons often have many images)
          if (i > 0 && i % 5 === 0) {
            if (options?.jobId) {
              this.archiveJobTracker.updateProgress(options.jobId, `Downloading images (${i}/${totalMediaCount})...`);
            }
          }

          try {
            // Download image directly using local service
            const arrayBuffer = await service.downloadImage(media.url);

            // Determine extension from URL
            let extension = 'jpg';
            const urlMatch = media.url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
            if (urlMatch && urlMatch[1]) {
              const ext = urlMatch[1].toLowerCase();
              if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
                extension = ext;
              }
            }

            const filename = `${i + 1}.${extension}`;
            const localPath = `${postMediaFolder}/${filename}`;

            // Save to vault
            await this.app.vault.adapter.writeBinary(localPath, arrayBuffer);
            downloadedMedia.push({ originalUrl: media.url, localPath });

          } catch (error) {
            console.warn(`[Social Archiver] Failed to download webtoon image ${i + 1}:`, error);
          }
        }

        if (downloadedMedia.length < totalMediaCount) {
          console.warn(`[Social Archiver] Downloaded ${downloadedMedia.length}/${totalMediaCount} webtoon images`);
        }

        // Show final progress
        if (options?.jobId) {
          this.archiveJobTracker.updateProgress(options.jobId, 'Saving to vault...');
        }
      }

      // Build image gallery markdown
      const imageGallery = downloadedMedia.length > 0
        ? downloadedMedia.map((m) => `![[${m.localPath}]]`).join('\n\n')
        : postData.media.map((m, i) => `![Image ${i + 1}](${m.url})`).join('\n\n');

      // Build frontmatter
      const frontmatterData: Record<string, unknown> = {
        platform: 'naver-webtoon',
        url: postData.url,
        title: postData.title,
        author: postData.author.name,
        authorUrl: postData.author.url,
        published: publishedDate,
        archived: archivedDate,
        archiveStatus: 'completed',
        // Series metadata for SeriesGroupingService
        seriesId: postData.series.id,
        series: postData.series.title,
        seriesUrl: postData.series.url,
        episode: postData.series.episode,
        ...(postData.series.starScore !== undefined && { starScore: postData.series.starScore }),
        tags: [`naver-webtoon`, postData.series.title.replace(/\s+/g, '-')],
        ...(options?.comment && { comment: options.comment }),
        processedUrls: [url, options?.originalUrl].filter(Boolean),
      };

      const frontmatterYaml = stringifyYaml(frontmatterData);

      // Build content
      const contentParts: string[] = [];

      if (postData.authorComment) {
        contentParts.push(`> ${postData.authorComment}\n`);
      }

      contentParts.push(`**${postData.series.title}** - ${postData.subtitle}`);
      contentParts.push(`\n*${postData.series.publishDay}*${postData.series.finished ? ' | **완결**' : ''}`);
      contentParts.push(`\n\n---\n\n`);
      contentParts.push(imageGallery);

      const fullDocument = `---\n${frontmatterYaml}---\n\n${contentParts.join('')}\n`;

      // Generate correct file path using VaultManager
      const vaultManager = new VaultManager({
        vault: this.app.vault,
        app: this.app,
        basePath: settings.archivePath || 'Social Archives',
        organizationStrategy: getVaultOrganizationStrategy(settings.archiveOrganization),
        fileNameFormat: settings.fileNameFormat,
      });
      vaultManager.initialize();

      // Create proper PostData for file path generation
      const properPostData: PostData = {
        platform: 'naver-webtoon' as Platform,
        id: postData.id,
        url: postData.url,
        author: {
          name: postData.author.name,
          url: postData.author.url,
        },
        content: {
          text: '',
        },
        media: postData.media.map(m => ({
          type: 'image' as const,
          url: m.url,
        })),
        metadata: {
          timestamp: postData.timestamp,
        },
        title: postData.title,
      };

      // Delete the preliminary file if it exists (backward compat with older jobs)
      if (filePath) {
        const preliminaryFile = this.app.vault.getAbstractFileByPath(filePath);
        if (preliminaryFile && preliminaryFile instanceof TFile) {
          await this.app.fileManager.trashFile(preliminaryFile);
        }
      }

      // Generate new file path with actual author name and title
      const newFilePath = vaultManager.generateFilePath(properPostData);

      // Ensure folder exists
      const folderPath = newFilePath.substring(0, newFilePath.lastIndexOf('/'));
      await this.ensureFolderExists(folderPath);

      // Create the file
      const existingFile = this.app.vault.getAbstractFileByPath(newFilePath);
      if (existingFile && existingFile instanceof TFile) {
        await this.app.vault.process(existingFile, () => fullDocument);
      } else {
        await this.app.vault.create(newFilePath, fullDocument);
      }

      const processingTime = Date.now() - startTime;
      console.debug(`[Social Archiver] Naver Webtoon archived locally in ${processingTime}ms`);

      // Refresh timeline view
      this.refreshTimelineView();

    } catch (error) {
      console.error('[Social Archiver] Naver Webtoon local fetch failed:', error);

      // Update preliminary document with error state if it exists (backward compat)
      if (filePath) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          await this.app.vault.process(file, (content) => content.replace(
            /archiveStatus: pending/,
            'archiveStatus: failed'
          ).replace(
            /^(---[\s\S]*?---)$/m,
            `$1\n\n> [!error] Archive Failed\n> ${errorMessage}`
          ));
        }
      }

      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Brunch comment formatting helpers
  // --------------------------------------------------------------------------

  /**
   * Format an array of Brunch comments into Markdown with a section heading.
   *
   * @param comments - Array of top-level comments
   * @param authorMap - Resolved internal-ID-to-username map
   * @param BrunchLocalService - The BrunchLocalService class (passed from the dynamic import in fetchBrunchLocally)
   */
  private formatBrunchCommentsToMarkdown(
    comments: BrunchComment[],
    authorMap: Map<string, string> = new Map(),
    BrunchLocalService: typeof BrunchLocalServiceType,
  ): string {
    if (!comments || comments.length === 0) {
      return '';
    }

    const lines: string[] = [];
    lines.push('');
    lines.push('## 💬 Comments');
    lines.push('');

    for (let i = 0; i < comments.length; i++) {
      const comment = comments[i];
      if (!comment) continue;
      const formattedComment = this.formatSingleBrunchComment(comment, false, authorMap, BrunchLocalService);
      lines.push(formattedComment);

      // Add separator between top-level comments (not after the last one)
      if (i < comments.length - 1) {
        lines.push('---');
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Format a single Brunch comment with nested replies.
   * Timeline-compatible format: **[@author](url)** + timestamp + N likes
   *
   * For replies, content must be indented with 2 spaces for parser compatibility.
   *
   * @param comment - The comment to format
   * @param isReply - Whether this is a nested reply (adds indentation)
   * @param authorMap - Resolved internal-ID-to-username map
   * @param BrunchLocalService - The BrunchLocalService class for static helper methods
   */
  private formatSingleBrunchComment(
    comment: BrunchComment,
    isReply: boolean,
    authorMap: Map<string, string> = new Map(),
    BrunchLocalService: typeof BrunchLocalServiceType,
  ): string {
    const lines: string[] = [];

    // Format timestamp (short format for timeline compatibility)
    const date = new Date(comment.timestamp);
    const formattedDate = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    // Build author link: **[@author](url)**
    // Resolve internal ID in authorUrl if present
    let authorUrl = comment.authorUrl || `https://brunch.co.kr/@${comment.author}`;
    const authorIdMatch = authorUrl.match(/brunch\.co\.kr\/@([^/]+)/);
    if (authorIdMatch && authorIdMatch[1] && BrunchLocalService.isInternalId(authorIdMatch[1])) {
      const resolvedAuthor = authorMap.get(authorIdMatch[1]);
      if (resolvedAuthor) {
        authorUrl = `https://brunch.co.kr/@${resolvedAuthor}`;
      }
    }
    let header = isReply ? '↳ ' : '';
    header += `**[@${comment.author}](${authorUrl})**`;

    // Add timestamp
    header += ` · ${formattedDate}`;

    // Add likes count if available
    if (comment.likes && comment.likes > 0) {
      header += ` · ${comment.likes} likes`;
    }

    // Add badge for TopCreator
    if (comment.isTopCreator) {
      header += ' 🌟';
    }

    lines.push(header);

    // Clean up content: convert Brunch mention format @[userId:name] -> [@name](url)
    // Uses resolved authorMap to convert internal IDs to real usernames
    const cleanContent = BrunchLocalService.convertMentions(comment.content, authorMap);

    // Comment content - replies need 2-space indent for each line
    if (isReply) {
      const contentLines = cleanContent.split('\n');
      for (const line of contentLines) {
        lines.push(`  ${line}`);
      }
    } else {
      lines.push(cleanContent);
    }

    lines.push('');

    // Nested replies
    if (comment.replies && comment.replies.length > 0) {
      for (const reply of comment.replies) {
        lines.push(this.formatSingleBrunchComment(reply, true, authorMap, BrunchLocalService));
      }
    }

    return lines.join('\n');
  }
}
