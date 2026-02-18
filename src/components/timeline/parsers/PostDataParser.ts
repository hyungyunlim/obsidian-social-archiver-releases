import { TFile, type TAbstractFile, type Vault, type App } from 'obsidian';
import type { PostData, Comment, Media, MultiLangTranscript } from '../../../types/post';
import type { YamlFrontmatter } from '../../../types/archive';
import { isRssBasedPlatform } from '../../../constants/rssPlatforms';
import { detectMediaType, isImageUrl, isVideoUrl, isAudioUrl } from '../../../utils/mediaType';
import { PostIndexService, type PostIndexEntry } from '../../../services/PostIndexService';
import type { Platform } from '@shared/platforms/types';
import { parseTranscriptSections } from '../../../services/markdown/TranscriptSectionManager';

/**
 * Vault folder node with children (Obsidian internal structure)
 */
interface VaultFolder extends TAbstractFile {
  children: TAbstractFile[];
}

/**
 * Extended frontmatter with all possible custom fields not in base YamlFrontmatter type.
 * YamlFrontmatter has [key: string]: unknown index signature, so all custom fields
 * are accessible via string indexing. This type alias documents them explicitly.
 */
type ExtendedFrontmatter = YamlFrontmatter;

/**
 * Media item used during internal parsing before dedup/resolve
 */
interface ParsedMediaItem {
  type: 'image' | 'video' | 'audio' | 'document';
  url: string;
  altText?: string;
}

/**
 * PostDataParser - Handles parsing of archived posts from vault files
 * Single Responsibility: Parse markdown files into PostData objects
 *
 * Performance optimization: Uses MetadataCache and cachedRead() for better performance
 */
export class PostDataParser {
  constructor(
    private vault: Vault,
    private app?: App // Optional for backward compatibility, but recommended for performance
  ) {}

  /**
   * Load all posts from the specified archive path
   * Uses direct folder traversal to ensure all files are found,
   * including preliminary documents that might not be in MetadataCache yet
   *
   * Performance optimization: Uses batch processing with Promise.all() for parallel file parsing
   */
  async loadFromVault(archivePath: string): Promise<PostData[]> {
    // Get the archive folder
    const archiveFolder = this.vault.getFolderByPath(archivePath);
    if (!archiveFolder) {
      return [];
    }

    // Collect all markdown files first
    const allFiles: TFile[] = [];
    const collectFiles = (folder: VaultFolder): void => {
      for (const child of folder.children) {
        const childAsFolder = child as VaultFolder;
        if (childAsFolder.children) {
          // It's a folder, recurse
          collectFiles(childAsFolder);
        } else {
          if (child instanceof TFile && child.extension === 'md') {
            allFiles.push(child);
          }
        }
      }
    };
    collectFiles(archiveFolder as VaultFolder);

    // Batch process files in parallel using Promise.all() for better performance
    // This leverages MetadataCache and cachedRead() optimizations
    const BATCH_SIZE = 50; // Process 50 files at a time to avoid overwhelming the system
    const loadedPosts: PostData[] = [];

    for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
      const batch = allFiles.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (file) => {
          try {
            return await this.parseFile(file);
          } catch {
            return null; // Silent fail
          }
        })
      );

      // Filter out null results and add to loaded posts
      loadedPosts.push(...batchResults.filter((post): post is PostData => post !== null));
    }

    return loadedPosts;
  }

  /**
   * Parse a single file into PostData
   * Public to allow re-loading posts after save
   */
  public async parseFile(file: TFile): Promise<PostData | null> {
    try {
      // Use cachedRead for better performance (display-only purpose)
      // Falls back to vault.read if cache is stale
      const content = await this.vault.cachedRead(file);

      // Try to use MetadataCache for frontmatter if available
      let frontmatter: ExtendedFrontmatter | null = null;
      if (this.app?.metadataCache) {
        const cache = this.app.metadataCache.getFileCache(file);
        if (cache?.frontmatter) {
          frontmatter = cache.frontmatter as ExtendedFrontmatter;
        }
      }

      // Check if MetadataCache might be stale (missing fields that exist in content)
      // Only do manual parsing when needed for performance
      const needsManualParsing = frontmatter && (
        (!frontmatter['linkPreviews'] && content.includes('linkPreviews:')) ||
        (!frontmatter['processedUrls'] && content.includes('processedUrls:')) ||
        (!frontmatter['downloadedUrls'] && content.includes('downloadedUrls:')) ||
        (!frontmatter['transcribedUrls'] && content.includes('transcribedUrls:'))
      );

      if (needsManualParsing || !frontmatter) {
        const parsedFrontmatter = this.parseFrontmatter(content);

        if (frontmatter && parsedFrontmatter) {
          // Merge missing fields from parsed frontmatter
          if (!frontmatter['linkPreviews'] && parsedFrontmatter['linkPreviews']) {
            frontmatter['linkPreviews'] = parsedFrontmatter['linkPreviews'];
          }
          if (!frontmatter['processedUrls'] && parsedFrontmatter['processedUrls']) {
            frontmatter['processedUrls'] = parsedFrontmatter['processedUrls'];
          }
          if (!frontmatter['downloadedUrls'] && parsedFrontmatter['downloadedUrls']) {
            frontmatter['downloadedUrls'] = parsedFrontmatter['downloadedUrls'];
          }
          if (!frontmatter['transcribedUrls'] && parsedFrontmatter['transcribedUrls']) {
            frontmatter['transcribedUrls'] = parsedFrontmatter['transcribedUrls'];
          }
        } else if (!frontmatter) {
          frontmatter = parsedFrontmatter;
        }
      }

      if (!frontmatter || !frontmatter.platform) {
        return null;
      }

      // Check if this is a profile-only document (type: profile)
      const isProfileDocument = frontmatter['type'] === 'profile';

      // For profile documents, parse and return profile-specific data
      if (isProfileDocument) {
        return this.parseProfileDocument(file, frontmatter, content);
      }

      // Validate platform: 'post' data
      if (frontmatter.platform === 'post') {
        if (!this.validateUserPost(frontmatter)) {
          return null;
        }
      }
      const contentText = this.extractContentText(content);
      const metadata = this.extractMetadata(content);

      // Try to extract media from MetadataCache first for better performance
      let mediaUrls: string[] = [];
      if (this.app?.metadataCache) {
        const app = this.app;
        const cache = app.metadataCache.getFileCache(file);
        if (cache?.embeds && cache.embeds.length > 0) {
          // Find section boundaries to exclude media from quoted posts and embedded archives
          // MetadataCache returns ALL embeds in the file without section awareness
          const sharedPostIdx = content.indexOf('## 🔗 Shared Post');
          const rebloggedPostIdx = content.indexOf('## 🔄 Reblogged Post');
          const embeddedArchivesIdx = content.indexOf('## Referenced Social Media Posts');
          const excludeAfter = Math.min(
            sharedPostIdx >= 0 ? sharedPostIdx : Infinity,
            rebloggedPostIdx >= 0 ? rebloggedPostIdx : Infinity,
            embeddedArchivesIdx >= 0 ? embeddedArchivesIdx : Infinity
          );

          // Extract media paths from cache.embeds (images and videos only)
          // Use getFirstLinkpathDest to resolve filename to full vault path
          mediaUrls = cache.embeds
            .filter(embed => {
              // Exclude embeds that appear inside quoted post or embedded archives sections
              if (excludeAfter !== Infinity && embed.position.start.offset >= excludeAfter) {
                return false;
              }
              return true;
            })
            .map(embed => {
              // Resolve the link to actual file path using Obsidian's link resolution
              const linkedFile = app.metadataCache.getFirstLinkpathDest(embed.link, file.path);
              if (linkedFile?.path) {
                return linkedFile.path;
              }
              // Fallback: search vault for file by name (MetadataCache may not be indexed yet)
              const allFiles = app.vault.getFiles();
              const foundFile = allFiles.find(f => f.name === embed.link || f.path.endsWith('/' + embed.link));
              return foundFile?.path || embed.link;
            })
            .filter(link => {
              // Filter for media files only (not markdown embeds)
              // Use centralized media type detection utilities
              return isImageUrl(link) || isVideoUrl(link) || isAudioUrl(link);
            });
        }
      }

      // Fallback to regex parsing if MetadataCache unavailable or no embeds
      if (mediaUrls.length === 0) {
        mediaUrls = this.extractMedia(content);
      }

      const comments = this.extractComments(content);

      const publishedDate = frontmatter.published ? new Date(frontmatter.published) : undefined;
      const archivedDate = frontmatter.archived ? new Date(frontmatter.archived) : undefined;

      // Determine if this is a user-created post
      const isUserPost = frontmatter.platform === 'post';

      // Parse quotedPost if exists (Facebook shared posts, X quoted tweets, etc.)
      // When parsing user-created posts with embedded archives, limit search to the primary content
      // so we don't accidentally parse quoted posts that belong to embedded archives.
      const [mainContentBeforeArchives] = content.split(/(?:\n|^)## (?:📦 )?Referenced Social Media Posts/);
      const quotedPostSource = mainContentBeforeArchives || content;
      let quotedPost = this.extractQuotedPost(quotedPostSource, file.path);

      // If no quotedPost found in content but isReblog is true with originalAuthor fields,
      // reconstruct quotedPost from frontmatter (for X retweets via xcancel RSS)
      const isReblog = frontmatter['isReblog'] === true;
      const originalAuthor = frontmatter['originalAuthor'] as string | undefined;
      if (!quotedPost && isReblog && originalAuthor) {
        // Extract the actual content text for the quotedPost
        // For retweets, the content shown in the main card is from the original author
        const originalContent = this.extractContentText(content);
        quotedPost = {
          platform: frontmatter.platform as Platform,
          id: (frontmatter['originalPostUrl'] as string | undefined) || frontmatter.originalUrl || '',
          url: (frontmatter['originalPostUrl'] as string | undefined) || frontmatter.originalUrl || '',
          author: {
            name: originalAuthor,
            handle: (frontmatter['originalAuthorHandle'] as string | undefined) || originalAuthor,
            url: (frontmatter['originalAuthorUrl'] as string | undefined) || '',
            avatar: frontmatter['originalAuthorAvatar'] as string | undefined,
          },
          content: {
            text: originalContent,
          },
          media: [], // Media is already shown in the main card
          metadata: {
            timestamp: frontmatter.published ? new Date(frontmatter.published).toISOString() : new Date().toISOString(),
          },
        };
      }

      // Parse embeddedArchives if exists
      const downloadedUrls: string[] = Array.isArray(frontmatter.downloadedUrls) ? frontmatter.downloadedUrls : [];
      const processedUrls: string[] = Array.isArray(frontmatter['processedUrls']) ? (frontmatter['processedUrls'] as string[]) : [];
      const transcribedUrls: string[] = Array.isArray(frontmatter.transcribedUrls) ? frontmatter.transcribedUrls : [];
      const embeddedArchives = this.extractEmbeddedArchives(content, downloadedUrls, processedUrls, file.path);

      // Embedded archives extracted successfully

      // Prefer YAML frontmatter media, fallback to markdown parsing
      let mediaArray: ParsedMediaItem[] = [];
      const frontmatterMedia = frontmatter['media'];
      if (frontmatterMedia && Array.isArray(frontmatterMedia)) {
        // Parse media from YAML frontmatter
        // Format: ["video:path/to/file.mp4", "image:path/to/image.jpg"]
        mediaArray = (frontmatterMedia as unknown[]).map((item: unknown) => {
          if (typeof item === 'string' && item.includes(':')) {
            const colonIdx = item.indexOf(':');
            const type = item.substring(0, colonIdx);
            const url = item.substring(colonIdx + 1);
            return { type: type as ParsedMediaItem['type'], url };
          }
          // Fallback for old format or invalid format
          return { type: 'image' as const, url: typeof item === 'string' ? item : '' };
        });
      } else if (mediaUrls.length > 0) {
        // Fallback to markdown parsing (detect video/image/audio by extension)
        mediaArray = mediaUrls.map(url => {
          const type = detectMediaType(url);
          return { type: (type === 'document' ? 'image' : type) as ParsedMediaItem['type'], url };
        });
      }

      mediaArray = mediaArray.map(media => ({
        ...media,
        url: this.resolveMediaPath(media.url, file.path)
      }));

      mediaArray = this.dedupeMedia(mediaArray);

      // For podcasts: add audio to media array if audioUrl exists
      // This enables MediaGalleryRenderer to render the custom audio player
      // Works for both local paths (downloaded) and external URLs (streaming)
      if (frontmatter.platform === 'podcast') {
        const audioUrl = frontmatter.audioUrl;
        if (audioUrl) {
          // Check if audio not already in media array
          const hasAudio = mediaArray.some(m => m.type === 'audio');
          if (!hasAudio) {
            mediaArray.push({
              type: 'audio',
              // Resolve path for local files (normalizes Windows backslashes)
              url: this.resolveMediaPath(audioUrl, file.path),
            });
          }
        }
      }

      // For reblogs: copy media to quotedPost (media belongs to the original author's post)
      if (quotedPost && isReblog && mediaArray.length > 0) {
        quotedPost.media = mediaArray;
      }

      // Extract URL from frontmatter or markdown content
      let originalUrl = frontmatter.originalUrl || '';

      // If originalUrl not in frontmatter, try to extract from markdown content
      if (!originalUrl && !isUserPost) {
        const urlMatch = content.match(/\*\*Original URL:\*\* (.+)/);
        if (urlMatch && urlMatch[1]) {
          originalUrl = urlMatch[1].trim();
        }
      }

      // For YouTube: extract video title from markdown header (# 📺 Title)
      // For Blog: extract article title from markdown header (# Title)
      // Priority: 1) frontmatter.title, 2) markdown header
      let title: string | undefined = frontmatter['title'] as string | undefined;

      // Fallback to markdown header if no frontmatter title
      if (!title) {
        // Remove frontmatter for title extraction (avoid matching '---')
        const contentWithoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n?/, '');

        if (frontmatter.platform === 'youtube') {
          const titleMatch = contentWithoutFrontmatter.match(/^#\s*📺\s*(.+)$/m);
          if (titleMatch?.[1]) {
            title = titleMatch[1].trim();
          }
        } else if (frontmatter.platform === 'reddit') {
          // For Reddit: extract title from first markdown header (## Title or # Title)
          // or first line of content if no header
          const headerMatch = contentWithoutFrontmatter.match(/^#{1,2}\s+(.+)$/m);
          if (headerMatch?.[1]) {
            title = headerMatch[1].trim();
          } else {
            // Fallback: first non-empty line of actual content
            const lines = contentWithoutFrontmatter.split('\n');
            for (const line of lines) {
              const trimmed = line.trim();
              // Skip empty lines and metadata-looking lines
              if (trimmed && trimmed.length <= 200 &&
                  !trimmed.startsWith('>') &&
                  !trimmed.startsWith('-') &&
                  !trimmed.startsWith('*') &&
                  !trimmed.startsWith('!') &&
                  !trimmed.startsWith('[')) {
                title = trimmed;
                break;
              }
            }
          }
        } else if (isRssBasedPlatform(frontmatter.platform)) {
          // Match first H1 header (# Title) for RSS-based platforms
          const titleMatch = contentWithoutFrontmatter.match(/^#\s+(.+)$/m);
          if (titleMatch?.[1]) {
            title = titleMatch[1].trim();
          }
        } else if (frontmatter.platform === 'x' && this.isXArticlePost(frontmatter, content)) {
          // For X articles: extract title from first H1 heading (may be escaped as \#)
          const titleMatch = contentWithoutFrontmatter.match(/^\\?#\s+(.+)$/m);
          if (titleMatch?.[1]) {
            title = titleMatch[1].trim();
          }
        }
      }

      const authorAvatarRaw = frontmatter['authorAvatar'] as string | undefined;
      const authorAvatarIsExternal = typeof authorAvatarRaw === 'string' && authorAvatarRaw.startsWith('http');

      const postData: PostData = {
        platform: frontmatter.platform as Platform,
        id: file.basename,
        // For user posts, url is the vault file path; for archived posts, use originalUrl
        url: isUserPost ? file.path : originalUrl,
        videoId: frontmatter.videoId, // YouTube video ID
        title, // YouTube video title (extracted from markdown header)
        filePath: file.path, // Store file path for opening
        tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
        comment: frontmatter.comment, // User's personal note
        like: frontmatter.like, // User's personal like
        archive: frontmatter.archive, // Archive status
        shareUrl: frontmatter.shareUrl, // Public share URL
        linkPreviews: frontmatter['linkPreviews'] as string[] | undefined, // Link preview URLs (custom field)
        processedUrls: processedUrls.length > 0 ? processedUrls : undefined,
        downloadedUrls: downloadedUrls.length > 0 ? downloadedUrls : undefined,
        transcribedUrls: transcribedUrls.length > 0 ? transcribedUrls : undefined,
        videoTranscribed: frontmatter['videoTranscribed'] as boolean | undefined,
        videoTranscriptionRequestedAt: frontmatter['videoTranscriptionRequestedAt'] as string | undefined,
        videoTranscriptionError: frontmatter['videoTranscriptionError'] as string | undefined,
        videoTranscribedAt: frontmatter['videoTranscribedAt'] as string | undefined,
        publishedDate: publishedDate,
        archivedDate: archivedDate,
        archiveStatus: frontmatter['archiveStatus'] as 'archiving' | 'completed' | 'failed' | undefined, // Archive status for loading states
        originalUrl: frontmatter.originalUrl, // Original URL (for preliminary documents)
        subscribed: frontmatter.subscribed, // Subscription-related flag
        subscriptionId: frontmatter.subscriptionId, // Subscription ID
        // Podcast channel title (show name)
        channelTitle: frontmatter['channelTitle'] as string | undefined,
        // Podcast audio fields
        audioUrl: frontmatter.audioUrl,
        audioSize: frontmatter.audioSize,
        audioType: frontmatter.audioType,
        audioLocalPath: frontmatter['audioLocalPath'] as string | undefined,
        // Whisper transcription data (parsed from markdown content)
        // Support both flat (new) and nested (legacy) frontmatter structure
        whisperTranscript: this.parseWhisperTranscript(
          content,
          frontmatter.transcriptionLanguage || frontmatter.transcription?.language
        ),
        // Multi-language transcript data (parsed from markdown content)
        multilangTranscript: this.parseMultiLangTranscripts(
          content,
          frontmatter.transcriptionLanguage || frontmatter.transcription?.language
        ),
        author: {
          // For YouTube, just use frontmatter.author (channel name) without adding handle
          // YouTube handles are channel IDs (UC...) which aren't user-friendly to display
          name: frontmatter.author || 'Unknown',
          // Support both authorUrl (camelCase) and author_url (snake_case) for compatibility
          url: frontmatter.authorUrl || (frontmatter['author_url'] as string | undefined) || '',
          // authorAvatar: if starts with http, it's external URL (avatar), otherwise local path (localAvatar)
          avatar: authorAvatarIsExternal ? authorAvatarRaw : undefined,
          localAvatar: (authorAvatarRaw && !authorAvatarIsExternal)
            ? this.stripWikilink(authorAvatarRaw)
            : undefined,
          handle: frontmatter['authorHandle'] as string | undefined,
        },
        content: {
          text: contentText,
          // For RSS-based platforms: preserve raw markdown with inline images for proper rendering
          // For X articles: extract article body and unescape markdown artifacts
          rawMarkdown: isRssBasedPlatform(frontmatter.platform)
            ? this.extractBlogContentWithImages(content)
            : (frontmatter.platform === 'x' && this.isXArticlePost(frontmatter, content))
              ? this.extractXArticleContent(content)
              : undefined,
          // Community info from YAML frontmatter (Reddit subreddit or Naver cafe)
          community: (frontmatter['community'] && frontmatter['communityUrl'])
            ? {
                name: frontmatter['community'] as string,
                url: frontmatter['communityUrl'] as string,
              }
            : (frontmatter['cafeName'] && frontmatter['cafeUrl'])
            ? {
                name: frontmatter['cafeName'] as string,
                url: frontmatter['cafeUrl'] as string,
              }
            : undefined,
        },
        media: mediaArray,
        metadata: {
          timestamp: new Date(frontmatter.published || frontmatter.archived || file.stat.ctime),
          // Prefer YAML frontmatter values, fallback to markdown footer parsing
          likes: frontmatter.likes ?? metadata.likes,
          comments: frontmatter.comments ?? metadata.comments,
          shares: frontmatter.shares ?? metadata.shares,
          views: frontmatter.views ?? metadata.views,
          // External link metadata (Facebook, X, etc.)
          externalLink: frontmatter['externalLink'] as string | undefined,
          externalLinkTitle: frontmatter['externalLinkTitle'] as string | undefined,
          externalLinkDescription: frontmatter['externalLinkDescription'] as string | undefined,
          externalLinkImage: frontmatter['externalLinkImage'] as string | undefined,
          // Google Maps location coordinates
          latitude: frontmatter['latitude'] as number | undefined,
          longitude: frontmatter['longitude'] as number | undefined,
          location: frontmatter['location'] as string | undefined,
          // Podcast-specific metadata
          duration: frontmatter.duration,
          episode: frontmatter.episode,
          season: frontmatter.season,
          subtitle: frontmatter.subtitle,
          hosts: frontmatter.hosts,
          guests: frontmatter.guests,
          explicit: frontmatter.explicit,
          // Webtoon-specific metadata
          commentCount: frontmatter.commentCount,
        },
        comments: comments.length > 0 ? comments : undefined,
        quotedPost: quotedPost || undefined,
        isReblog: isReblog || undefined,
        embeddedArchives: embeddedArchives.length > 0 ? embeddedArchives : undefined,
        // Series info for Brunch brunchbook, Naver Webtoon, etc.
        series: this.extractSeriesInfo(frontmatter),
        // Thumbnail URL from frontmatter (for webtoon episode covers, YouTube, etc.)
        thumbnail: frontmatter['thumbnail'] as string | undefined,
      };

      return postData;
    } catch {
      return null;
    }
  }

  /**
   * Validate user-created post data
   * Returns true if the post data is valid for platform: 'post'
   */
  private validateUserPost(frontmatter: YamlFrontmatter): boolean {
    // User posts must have author name
    if (!frontmatter.author || typeof frontmatter.author !== 'string') {
      return false;
    }

    // User posts must have a timestamp (published or archived)
    if (!frontmatter.published && !frontmatter.archived) {
      return false;
    }

    // Validation passed
    return true;
  }

  /**
   * Extract content text from markdown, removing frontmatter and metadata
   */
  extractContentText(markdown: string): string {
    // Remove frontmatter
    let withoutFrontmatter = markdown.replace(/^---\n[\s\S]*?\n---\n/, '');

    // Remove quotedPost section to avoid including it in content
    withoutFrontmatter = withoutFrontmatter.replace(/## 🔗 Shared Post[\s\S]*?(?=\n---\n|$)/, '');

    // Remove embedded archives section
    withoutFrontmatter = withoutFrontmatter.replace(/## (?:📦 )?Referenced Social Media Posts[\s\S]*?(?=\n---\n\n\*\*Author:|$)/, '');

    // Remove comments section to avoid duplicate rendering
    withoutFrontmatter = withoutFrontmatter.replace(/\n*## 💬 Comments[\s\S]*$/, '');

    // Split into sections by horizontal rules
    const sections = withoutFrontmatter.split(/\n---+\n/);

    // Find the metadata footer section and join all content sections before it.
    // The metadata footer starts with "**Platform:**" or similar patterns.
    // This preserves horizontal rules (---) used within the post body itself.
    let contentSection = '';
    const contentSections: string[] = [];
    for (const section of sections) {
      const trimmedSection = section.trim();
      // Stop if this section starts with metadata footer
      if (trimmedSection.startsWith('**Platform:**') ||
          trimmedSection.startsWith('**Original URL:**') ||
          trimmedSection.startsWith('**Author:**')) {
        break;
      }
      // Also stop if this section contains only images (media gallery section)
      // e.g., "![image 1](path)\n\n![image 2](path)\n..." or single "![image](path)"
      // Handles both markdown images ![alt](url) and wikilink images ![[file]]
      const nonEmptyLines = trimmedSection.split('\n').filter(l => l.trim());
      if (nonEmptyLines.length > 0 && nonEmptyLines.every(l => /^!\[/.test(l.trim()))) {
        break;
      }
      contentSections.push(section);
    }
    contentSection = contentSections.join('\n---\n');

    // Remove common markdown headers and metadata
    const lines = contentSection.split('\n');
    const contentLines: string[] = [];
    let contentStarted = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip headers and metadata at the beginning
      if (!contentStarted) {
        // Check if it's a markdown header (# followed by space) vs hashtag (# followed by letter)
        const isMarkdownHeader = /^#+\s/.test(trimmed);

        if (!trimmed ||
            isMarkdownHeader ||
            trimmed.startsWith('**Platform:**') ||
            trimmed.startsWith('![')) {
          continue;
        }
        contentStarted = true;
      }

      // Stop at metadata footer
      if (trimmed.startsWith('**Platform:**') ||
          trimmed.startsWith('**Original URL:**') ||
          trimmed.startsWith('**Published:**')) {
        break;
      }

      contentLines.push(line);
    }

    return contentLines.join('\n').trim();
  }

  /**
   * Extract blog content with inline images preserved
   * Used for blog posts to render images inline with text instead of in a gallery
   *
   * Removes:
   * - YAML frontmatter
   * - H1 title (first # heading) - title is rendered separately
   * - Metadata footer (Platform, Author, Published, Original URL)
   *
   * Preserves:
   * - All inline images (![[image]] and ![alt](url) formats)
   * - All other markdown content
   */
  private extractBlogContentWithImages(markdown: string): string {
    // Remove frontmatter
    let content = markdown.replace(/^---\n[\s\S]*?\n---\n+/, '');

    // Remove metadata footer section (starts with --- followed by **Platform:**)
    // Match from "---\n\n**Platform:**" to end of file
    content = content.replace(/\n---\n\n\*\*Platform:\*\*[\s\S]*$/, '');

    // Remove comments section to avoid duplicate rendering
    content = content.replace(/\n*## 💬 Comments[\s\S]*$/, '');

    // Remove H1 title at the start (# Title) - we render title separately in the card
    // Match # followed by space, then any text, then newlines
    content = content.replace(/^#\s+[^\n]+\n+/, '');

    // Remove audio embeds (podcast audio is rendered separately via MediaGalleryRenderer)
    // Match ![[path.mp3]], ![[path.m4a]], etc. with surrounding whitespace/separators
    content = content.replace(/\n*---\n*\n*!\[\[[^\]]+\.(?:mp3|m4a|wav|ogg|flac|aac)\]\]\n*/gi, '');
    // Also remove standalone audio embeds without surrounding ---
    content = content.replace(/!\[\[[^\]]+\.(?:mp3|m4a|wav|ogg|flac|aac)\]\]\n*/gi, '');

    // Clean up excessive leading/trailing whitespace
    content = content.trim();

    return content;
  }

  /**
   * Detect whether an archived X post is a long-form article.
   * Checks frontmatter `isArticle` flag first (new archives), then
   * falls back to content heuristics for older archives.
   */
  private isXArticlePost(frontmatter: YamlFrontmatter, content: string): boolean {
    if (frontmatter['isArticle'] === true) return true;
    // Heuristic: article URL pattern in content
    if (/x\.com\/i\/article\//.test(content)) return true;
    // Heuristic: content has escaped headings typical of article markdown
    if (/\\#\s/.test(content) && content.length > 800) return true;
    return false;
  }

  /**
   * Extract X article body for blog-style rendering.
   * Similar to extractBlogContentWithImages but also:
   * - Un-escapes headings (\# → #, \## → ##)
   * - Un-escapes ordered lists (1\. → 1.)
   * - Removes [Image: mediaId=...] placeholders from older archives
   * - Removes trailing media gallery section
   */
  private extractXArticleContent(markdown: string): string {
    // Remove frontmatter
    let content = markdown.replace(/^---\n[\s\S]*?\n---\n+/, '');

    // Remove metadata footer section
    content = content.replace(/\n---\n\n\*\*Platform:\*\*[\s\S]*$/, '');

    // Remove comments section
    content = content.replace(/\n*## 💬 Comments[\s\S]*$/, '');

    // Remove trailing media gallery (standalone image blocks at the end)
    // These are the media array images that are redundant with inline article images
    content = content.replace(/\n+(?:!\[.*?\]\(.*?\)\s*\n*)+$/, '');

    // Remove H1 title at the start (rendered separately in the card)
    // Handle both escaped (\# Title) and normal (# Title)
    content = content.replace(/^\\?#\s+[^\n]+\n+/, '');

    // Un-escape headings: \# → #, \## → ##, \### → ###
    content = content.replace(/^\\(#{1,6})\s/gm, '$1 ');

    // Un-escape ordered lists: 1\. → 1.
    content = content.replace(/^(\d+)\\\./gm, '$1.');

    // Remove [Image: mediaId=...] placeholders from older archives
    content = content.replace(/\[Image: mediaId=[^\]]*\]\n*/g, '');

    // Clean up excessive whitespace
    content = content.trim();

    return content;
  }

  /**
   * Extract metadata from markdown footer (Likes, Comments, Shares, Views)
   */
  extractMetadata(markdown: string): { likes?: number; comments?: number; shares?: number; views?: number } {
    const metadata: { likes?: number; comments?: number; shares?: number; views?: number } = {};

    // Find metadata footer: **Likes:** 6 | **Comments:** 3 | **Shares:** 1
    // Also support LinkedIn format: **Reactions:** 163
    // Support comma-formatted numbers: **Likes:** 2,018
    const metadataRegex = /\*\*(?:Likes|Reactions):\*\*\s*([\d,]+)|\*\*Comments:\*\*\s*([\d,]+)|\*\*Shares:\*\*\s*([\d,]+)|\*\*Views:\*\*\s*([\d,]+)/g;

    let match;
    while ((match = metadataRegex.exec(markdown)) !== null) {
      if (match[1]) metadata.likes = parseInt(match[1].replace(/,/g, ''));
      if (match[2]) metadata.comments = parseInt(match[2].replace(/,/g, ''));
      if (match[3]) metadata.shares = parseInt(match[3].replace(/,/g, ''));
      if (match[4]) metadata.views = parseInt(match[4].replace(/,/g, ''));
    }

    return metadata;
  }

  /**
   * Extract media URLs from markdown
   * Excludes media from embedded archives section to prevent duplicates
   */
  extractMedia(markdown: string): string[] {
    const mediaUrls: string[] = [];

    // Remove quotedPost section to avoid counting their media
    let cleanedMarkdown = markdown.replace(/## 🔗 Shared Post[\s\S]*?(?=\n---\n|$)/, '');

    // Remove embedded archives section to avoid counting their media
    // Embedded archives section starts with "## Referenced Social Media Posts" and ends with "---\n\n**Author:"
    const embeddedArchivesSectionRegex = /## (?:📦 )?Referenced Social Media Posts[\s\S]*?(?=\n---\n\n\*\*Author:|$)/;
    cleanedMarkdown = cleanedMarkdown.replace(embeddedArchivesSectionRegex, '');

    // Match ![image N](path) format - support multiline alt text (e.g., quote tweet screenshots)
    const imageRegex = /!\[[\s\S]*?\]\(([^)]+)\)/g;

    let match;
    while ((match = imageRegex.exec(cleanedMarkdown)) !== null) {
      const url = match[1];
      // Include all relative paths (not starting with http:// or https://)
      if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
        mediaUrls.push(url);
      }
    }

    // Also match Obsidian [[path|alias]] format for local media
    // Strip alias part (after |) if present
    const obsidianLinkRegex = /!\[\[(.*?)\]\]/g;
    while ((match = obsidianLinkRegex.exec(cleanedMarkdown)) !== null) {
      let url = match[1];
      // Include all paths - strip alias if present (e.g., "path|alias" -> "path")
      if (url) {
        // Remove alias part after pipe
        const pipeIndex = url.indexOf('|');
        if (pipeIndex !== -1) {
          url = url.substring(0, pipeIndex);
        }
        mediaUrls.push(url);
      }
    }

    return mediaUrls;
  }

  /**
   * Extract comments from markdown
   */
  extractComments(markdown: string): Comment[] {
    const comments: Comment[] = [];

    // Find comments section
    // Allow multiple newlines before the footer separator (---) since content may have trailing blank lines
    const commentsMatch = markdown.match(/## 💬 Comments\n\n([\s\S]*?)(?=\n+---\n+\*\*Platform:|$)/);
    if (!commentsMatch || !commentsMatch[1]) {
      return comments;
    }

    const commentsSection = commentsMatch[1];

    // Split by comment separator (--- between comments)
    // Allow for multiple newlines around the separator
    const commentBlocks = commentsSection.split(/\n+---\n+/).filter(block => block.trim());

    for (const block of commentBlocks) {
      const lines = block.split('\n');
      if (lines.length === 0 || !lines[0]) continue;

      // Parse main comment header: **[@username](url)** [· timestamp] [· likes]
      // Timestamp is optional since Instagram comments don't have timestamp from API
      // Support various Unicode separator dots: · (U+00B7), • (U+2022), ∙ (U+2219), and regular hyphen
      const headerMatch = lines[0].match(/\*\*\[?@?([^\]]*)\]?\(?([^)]*)\)?\*\*(?:(?: [-·•∙] ([^-·•∙\n]+))?)(?: [-·•∙] (\d+) likes)?/);
      if (!headerMatch) continue;

      const [, username, url, timestamp, likesStr] = headerMatch;

      // Extract comment content (lines after header, before any replies)
      const contentLines: string[] = [];
      let i = 1;
      while (i < lines.length) {
        const line = lines[i];
        if (!line || line.trim().startsWith('↳')) break;
        contentLines.push(line);
        i++;
      }
      const content = contentLines.join('\n').trim();

      // Parse replies (lines starting with ↳)
      const replies: Comment[] = [];
      while (i < lines.length) {
        const currentLine = lines[i];
        if (currentLine && currentLine.trim().startsWith('↳')) {
          // Reply header: ↳ **[@username](url)** [· timestamp] [· likes]
          // Support various Unicode separator dots: · (U+00B7), • (U+2022), ∙ (U+2219), and regular hyphen
          const replyHeaderMatch = currentLine.match(/↳ \*\*\[?@?([^\]]*)\]?\(?([^)]*)\)?\*\*(?:(?: [-·•∙] ([^-·•∙\n]+))?)(?: [-·•∙] (\d+) likes)?/);
          if (replyHeaderMatch) {
            const [, replyUsername, replyUrl, replyTimestamp, replyLikesStr] = replyHeaderMatch;
            i++;

            // Get reply content (lines starting with "  " but not "  ↳")
            const replyContentLines: string[] = [];
            while (i < lines.length) {
              const line = lines[i];
              if (!line || !line.startsWith('  ') || line.trim().startsWith('↳')) break;
              replyContentLines.push(line.substring(2)); // Remove the 2-space indent
              i++;
            }
            const replyContent = replyContentLines.join('\n').trim();

            replies.push({
              id: `reply-${Date.now()}-${Math.random()}`,
              author: {
                name: replyUsername || 'Unknown',
                url: replyUrl || '',
                username: replyUsername,
              },
              content: replyContent,
              timestamp: replyTimestamp?.trim() || undefined,
              likes: replyLikesStr ? parseInt(replyLikesStr) : undefined,
            });
          } else {
            i++;
          }
        } else {
          i++;
        }
      }

      comments.push({
        id: `comment-${Date.now()}-${Math.random()}`,
        author: {
          name: username || 'Unknown',
          url: url || '',
          username: username,
        },
        content,
        timestamp: timestamp?.trim() || undefined,
        likes: likesStr ? parseInt(likesStr) : undefined,
        replies: replies.length > 0 ? replies : undefined,
      });
    }

    return comments;
  }

  /**
   * Parse Whisper transcript from markdown content
   * Looks for ## Transcript section with [MM:SS] timestamp lines
   */
  private parseWhisperTranscript(
    content: string,
    language?: string
  ): PostData['whisperTranscript'] | undefined {
    // Match ## Transcript section
    const sectionMatch = content.match(/## Transcript\n\n([\s\S]*?)(?=\n## |\n---|$)/i);

    // Legacy: also support old HTML wrapper format for existing files
    const legacyMatch = !sectionMatch
      ? content.match(/<div class="podcast-transcript"[^>]*>([\s\S]*?)<\/div>/)
      : null;

    const transcriptContent = sectionMatch?.[1] || legacyMatch?.[1];
    if (!transcriptContent) return undefined;

    // Strip callout prefixes (> ) from each line for YouTube formatted transcripts
    const cleanedContent = transcriptContent
      .split('\n')
      .map((line) => line.replace(/^>\s?/, ''))
      .join('\n');

    const segments: Array<{ id: number; start: number; end: number; text: string }> = [];

    // Parse timestamp lines:
    // - [MM:SS] text
    // - [H:MM:SS] text
    // - [MM:SS](url) text (YouTube formatted links)
    const lineRegex = /\[(\d+:)?\d{1,2}:\d{2}\](?:\([^)]*\))?\s*(.+)/g;
    let match;
    let id = 0;

    while ((match = lineRegex.exec(cleanedContent)) !== null) {
      const timestampStr = match[0].match(/\[([^\]]+)\]/)?.[1] || '0:00';
      const text = match[2]?.trim();
      if (!text) continue; // Skip if no text content

      const seconds = this.parseTimestampToSeconds(timestampStr);

      segments.push({
        id: id++,
        start: seconds,
        end: seconds + 8, // Approximate, will be refined by next segment
        text
      });
    }

    // Refine end times based on next segment's start time
    for (let i = 0; i < segments.length - 1; i++) {
      const currentSegment = segments[i];
      const nextSegment = segments[i + 1];
      if (currentSegment && nextSegment) {
        currentSegment.end = nextSegment.start;
      }
    }

    if (segments.length === 0) return undefined;

    return {
      segments,
      language: language || 'en'
    };
  }

  /**
   * Parse timestamp string to seconds
   * Supports MM:SS and H:MM:SS formats
   */
  private parseTimestampToSeconds(str: string): number {
    const parts = str.split(':').map(Number);
    if (parts.length === 3) {
      const hours = parts[0] ?? 0;
      const minutes = parts[1] ?? 0;
      const seconds = parts[2] ?? 0;
      return hours * 3600 + minutes * 60 + seconds;
    }
    const minutes = parts[0] ?? 0;
    const seconds = parts[1] ?? 0;
    return minutes * 60 + seconds;
  }

  /**
   * Parse multi-language transcript sections from markdown content.
   * Returns MultiLangTranscript if 2+ languages found, otherwise undefined.
   */
  private parseMultiLangTranscripts(
    content: string,
    defaultLanguageCode?: string
  ): MultiLangTranscript | undefined {
    const sections = parseTranscriptSections(content, defaultLanguageCode);

    // Only build multilang data if we have 2+ languages
    if (sections.length < 2) {
      return undefined;
    }

    const byLanguage: Record<string, Array<{ id: number; start: number; end: number; text: string }>> = {};
    let defaultLanguage = defaultLanguageCode || 'en';

    // Parse timestamp lines for each section
    const lineRegex = /\[(\d+:)?\d{1,2}:\d{2}\](?:\([^)]*\))?\s*(.+)/g;

    for (const section of sections) {
      const cleanedContent = section.body
        .split('\n')
        .map((line) => line.replace(/^>\s?/, '')) // Strip callout prefixes
        .join('\n');

      const segments: Array<{ id: number; start: number; end: number; text: string }> = [];
      let match;
      let id = 0;

      // Reset regex state
      lineRegex.lastIndex = 0;

      while ((match = lineRegex.exec(cleanedContent)) !== null) {
        const timestampStr = match[0].match(/\[([^\]]+)\]/)?.[1] || '0:00';
        const text = match[2]?.trim();
        if (!text) continue;

        const seconds = this.parseTimestampToSeconds(timestampStr);

        segments.push({
          id: id++,
          start: seconds,
          end: seconds + 8, // Approximate, will be refined
          text
        });
      }

      // Refine end times based on next segment's start time
      for (let i = 0; i < segments.length - 1; i++) {
        const currentSegment = segments[i];
        const nextSegment = segments[i + 1];
        if (currentSegment && nextSegment) {
          currentSegment.end = nextSegment.start;
        }
      }

      if (segments.length > 0) {
        byLanguage[section.languageCode] = segments;

        // First section is the default language
        if (section.languageName === '') {
          defaultLanguage = section.languageCode;
        }
      }
    }

    // Only return if we successfully parsed 2+ languages
    const languageCount = Object.keys(byLanguage).length;
    if (languageCount < 2) {
      return undefined;
    }

    return {
      defaultLanguage,
      byLanguage
    };
  }

  /**
   * Strip wikilink brackets from avatar path
   * e.g., "[[attachments/foo.jpg]]" -> "attachments/foo.jpg"
   */
  private stripWikilink(value: string): string {
    if (value.startsWith('[[') && value.endsWith(']]')) {
      return value.slice(2, -2);
    }
    return value;
  }

  /**
   * Parse YAML frontmatter from markdown content
   */
  private parseFrontmatter(markdown: string): YamlFrontmatter | null {
    const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch || !frontmatterMatch[1]) {
      return null;
    }

    const frontmatterText = frontmatterMatch[1];
    const lines = frontmatterText.split('\n');
    const frontmatter: Record<string, unknown> = {};

    let currentKey: string | null = null;
    let currentArray: string[] = [];

    for (const line of lines) {
      // Array item: "  - value"
      if (line.startsWith('  - ')) {
        let value = line.substring(4).trim();

        // Remove quotes if present (same logic as key-value pairs)
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          try {
            // Try to parse as JSON to handle escaped characters
            value = JSON.parse(value) as string;
          } catch {
            // If JSON parsing fails, just remove the quotes
            value = value.slice(1, -1);
          }
        }

        currentArray.push(value);
        continue;
      }

      // If we were building an array, save it
      if (currentKey && currentArray.length > 0) {
        frontmatter[currentKey] = currentArray;
        currentArray = [];
        currentKey = null;
      }

      // Key-value pair: "key: value"
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match && match[1] && match[2] !== undefined) {
        const key = match[1];
        const value = match[2];
        currentKey = key;

        // Remove quotes if present (handle both regular and JSON-escaped quotes)
        let cleanValue = value.trim();

        // If value is JSON-stringified (starts and ends with quotes)
        if ((cleanValue.startsWith('"') && cleanValue.endsWith('"')) ||
            (cleanValue.startsWith("'") && cleanValue.endsWith("'"))) {
          try {
            // Try to parse as JSON to handle escaped characters
            cleanValue = JSON.parse(cleanValue) as string;
          } catch {
            // If JSON parsing fails, just remove the quotes
            cleanValue = cleanValue.slice(1, -1);
          }
        }

        // Check if this starts an array (value is empty, next line will have array items)
        if (cleanValue === '') {
          currentArray = [];
        } else if (cleanValue.startsWith('[') && cleanValue.endsWith(']')) {
          // Inline array format: key: ["value1", "value2"]
          try {
            frontmatter[key] = JSON.parse(cleanValue) as unknown[];
          } catch {
            // If JSON parsing fails, treat as string
            frontmatter[key] = cleanValue;
          }
          currentKey = null;
        } else {
          // Parse value
          if (cleanValue === 'true') {
            frontmatter[key] = true;
          } else if (cleanValue === 'false') {
            frontmatter[key] = false;
          } else if (!isNaN(Number(cleanValue)) && cleanValue !== '') {
            frontmatter[key] = Number(cleanValue);
          } else {
            frontmatter[key] = cleanValue;
          }

          currentKey = null;
        }
      }
    }

    // Save last array if any
    if (currentKey && currentArray.length > 0) {
      frontmatter[currentKey] = currentArray;
    }

    return frontmatter as YamlFrontmatter;
  }

  /**
   * Extract embedded archives from markdown
   * Parses the "## 📦 Referenced Social Media Posts" section
   */
  private extractEmbeddedArchives(
    markdown: string,
    parentDownloadedUrls: string[] = [],
    parentProcessedUrls: string[] = [],
    parentFilePath?: string
  ): PostData[] {
    const archives: PostData[] = [];

    // Find embedded archives section (with optional emoji for backwards compatibility)
    const archivesMatch = markdown.match(/## (?:📦 )?Referenced Social Media Posts\n\n([\s\S]*?)(?=\n---\n\n\*\*Author:|$)/);
    if (!archivesMatch || !archivesMatch[1]) {
      return archives;
    }

    const archivesSection = archivesMatch[1];

    // Each archive block is separated by "\n---\n\n" when written by MarkdownConverter
    // Split on that boundary (when followed by another archive header or embedded comment header) to avoid
    // treating quoted post headers ("### ...") as standalone archives.
    const archiveBlocks = archivesSection.split(/\n---\n\n(?=(?:### |<!--\s*Embedded:))/);

    for (let i = 0; i < archiveBlocks.length; i++) {
      const block = archiveBlocks[i];
      if (!block || !block.trim()) continue;

      try {
        // First block still has header/comment, others don't (because of split)
        // Match header: visible "### PlatformName - AuthorHandle" or hidden HTML comment "<!-- Embedded: PlatformName - AuthorHandle -->"
        const headerMatch = block.match(
          /^\s*(?:### |<!--\s*Embedded:\s*)(Facebook|Instagram|X|Linkedin|Tiktok|Threads|Youtube|Reddit|Post|Pinterest|Substack|Tumblr|Mastodon|Bluesky)\s*-\s*(.+?)(?:-->)?(?:\n|$)/i
        );

        // Extract platform name and author, trim to first line only
        const platformName = headerMatch?.[1];
        const rawAuthor = headerMatch?.[2];

        // Fallback: derive platform from metadata line if header is missing
        const metadataPlatformMatch = !platformName
          ? block.match(/\*\*Platform:\*\*\s*([A-Za-z]+)/i)
          : null;
        const platform = (platformName || metadataPlatformMatch?.[1] || 'post').toLowerCase();

        // Prefer header author, otherwise try metadata author link text
        const metadataAuthorMatch = !rawAuthor
          ? block.match(/\*\*Author:\*\*\s*\[([^\]]+)\]/i)
          : null;
        const authorHandle = (rawAuthor || metadataAuthorMatch?.[1] || 'Unknown').split('\n')[0]?.trim() || 'Unknown';

        // Extract content: everything between header and "---" line
        // Remove header line first
        const withoutHeader = block.replace(
          /^\s*(?:(?:### )|(?:<!--\s*Embedded:\s*))(?:Facebook|Instagram|X|Linkedin|Tiktok|Threads|Youtube|Reddit|Post|Pinterest|Substack|Tumblr|Mastodon|Bluesky)\s*-\s*.+?(?:-->)?\n+/i,
          ''
        );

        // Determine metadata boundary (last occurrence of "\n---\n\n**Platform:**")
        const metadataMarker = '\n---\n\n**Platform:**';
        const metadataStart = withoutHeader.lastIndexOf(metadataMarker);
        const contentSection = metadataStart >= 0
          ? withoutHeader.substring(0, metadataStart).trim()
          : withoutHeader.trim();
        const metadataSection = metadataStart >= 0
          ? withoutHeader.substring(metadataStart + '\n---\n\n'.length).trim()
          : block;

        // Ensure quoted-post section (if present) is not counted as part of the parent content/media.
        const quotedIndex = contentSection.indexOf('## 🔗 Shared Post');
        const contentBeforeQuote = quotedIndex >= 0
          ? contentSection.substring(0, quotedIndex).trim()
          : contentSection;

        const mediaMatch = contentBeforeQuote.match(/\n\n\*\*Media:\*\*\n([\s\S]+)$/);
        const content = mediaMatch
          ? contentBeforeQuote.substring(0, contentBeforeQuote.indexOf('\n\n**Media:**')).trim()
          : contentBeforeQuote;

        // Extract URL from new format: **Original URL:** https://...
        const urlMatch = metadataSection.match(/\*\*Original URL:\*\* (.+)/);
        const url = urlMatch?.[1]?.trim() || '';

        // Extract author/channel name and URL from metadata line
        // Format for YouTube: **Channel:** [Name](URL)
        // Format for others: **Author:** [Name](URL)
        const authorMetadataMatch = metadataSection.match(/\*\*(?:Channel|Author):\*\* \[(.+?)\]\((.+?)\)/);
        const authorName = authorMetadataMatch?.[1]?.trim();
        const authorUrl = authorMetadataMatch?.[2]?.trim() || url;

        // Extract metadata from single-line format
        // Format: **Platform:** Name | **Author:** [Name](URL) | **Published:** Date | **Likes:** N | **Comments:** N | **Shares:** N
        const metadataLineMatch = metadataSection.match(/\*\*Platform:\*\*.+?\*\*Published:\*\* (.+?)(?:\s*\||$)/);
        const timestamp = metadataLineMatch?.[1] ? new Date(metadataLineMatch[1].trim()) : new Date();

        // Extract likes, comments, shares from metadata line
        const likesMatch = metadataSection.match(/\*\*Likes:\*\* ([\d,]+)/);
        const commentsMatch = metadataSection.match(/\*\*Comments:\*\* ([\d,]+)/);
        const sharesMatch = metadataSection.match(/\*\*Shares:\*\* ([\d,]+)/);

        const likes = likesMatch?.[1] ? parseInt(likesMatch[1].replace(/,/g, '')) : undefined;
        const comments = commentsMatch?.[1] ? parseInt(commentsMatch[1].replace(/,/g, '')) : undefined;
        const shares = sharesMatch?.[1] ? parseInt(sharesMatch[1].replace(/,/g, '')) : undefined;

        // Extract media URLs from Media section
        let media: { type: 'image' | 'video' | 'audio'; url: string; altText?: string }[] = [];
        if (mediaMatch && mediaMatch[1]) {
          const mediaSection = mediaMatch[1];
          // Match ![alt](url) or ![](url) - support multiline alt text
          const mediaRegex = /!\[([\s\S]*?)\]\(([^)]+)\)/g;
          let match;
          while ((match = mediaRegex.exec(mediaSection)) !== null) {
            const altText = match[1] || undefined;
            const mediaUrl = match[2];
            if (!mediaUrl) continue;
            const detectedType = detectMediaType(mediaUrl);
            const type = detectedType === 'document' ? 'image' : detectedType;
            media.push({ type, url: this.resolveMediaPath(mediaUrl, parentFilePath), altText });
          }
        }

        media = this.dedupeMedia(media);

        // Parse comments section (if exists)
        // Comments appear after "## 💬 Comments" header
        const parsedComments = this.extractComments(block);

        // Parse quoted post (if exists)
        // Extract from the full block (before content extraction removed it)
        const quotedPost = this.extractQuotedPost(block, parentFilePath);

        // Prefer metadata author name when available (handles provide usernames)
        let displayName: string;
        if (platform === 'youtube' && authorName) {
          displayName = authorHandle ? `${authorName} (${authorHandle})` : authorName;
        } else {
          displayName = authorName || authorHandle;
        }

        // Create PostData
        const archiveData: PostData = {
          platform: platform as Platform,
          id: url,
          url,
          author: {
            name: displayName,
            url: authorUrl,
            handle: authorHandle,
          },
          content: {
            text: content,
          },
          media,
          metadata: {
            timestamp,
            likes,
            comments,
            shares,
          },
          comments: parsedComments.length > 0 ? parsedComments : undefined,
          quotedPost: quotedPost || undefined,
          downloadedUrls: parentDownloadedUrls,
          processedUrls: parentProcessedUrls,
        };

        archives.push(archiveData);
      } catch {
        // Silent fail
      }
    }

    return archives;
  }

  /**
   * Extract quoted/shared post from markdown
   * Parses the "## 🔗 Shared Post" section
   * Returns single PostData or undefined
   */
  private extractQuotedPost(markdown: string, parentFilePath?: string): Omit<PostData, 'quotedPost' | 'embeddedArchives'> | undefined {
    // Find quoted post section including its metadata
    // Match from "## 🔗 Shared Post" or "## 🔄 Reblogged Post" through "**Original URL:**" and stop at the next separator
    // Pattern: captures content + "---" + metadata up to (but not including) the next "---"
    const quotedMatch = markdown.match(/## (?:🔗 Shared Post|🔄 Reblogged Post)\n\n([\s\S]*?\*\*Original URL:\*\*[^\n]*(?:\n(?!\n---)[^\n]*)*)/);
    if (!quotedMatch || !quotedMatch[1]) {
      return undefined;
    }

    const quotedSection = quotedMatch[1];

    try {
      // Match header: "### PlatformName - AuthorHandle"
      const headerMatch = quotedSection.match(/^### (Facebook|Instagram|X|Linkedin|Tiktok|Threads|Youtube|Reddit|Bluesky|Mastodon|Post)\s*-\s*(.+)/i);
      if (!headerMatch) {
        return undefined;
      }

      const [, platformName, rawAuthor] = headerMatch;
      if (!rawAuthor || !platformName) {
        return undefined;
      }

      const authorHandle = rawAuthor.split('\n')[0]?.trim() || 'Unknown';
      const platform = platformName.toLowerCase();

      // Extract content: everything between header and "---" line
      const withoutHeader = quotedSection.replace(/^### (?:Facebook|Instagram|X|Linkedin|Tiktok|Threads|Youtube|Reddit|Bluesky|Mastodon|Post)\s*-\s*.+?\n+/i, '');
      const contentParts = withoutHeader.split(/\n---\n/);
      const fullContent = contentParts[0]?.trim() || '';

      // Separate text content and media section
      const mediaMatch = fullContent.match(/\n\n\*\*Media:\*\*\n([\s\S]+)$/);
      let content = mediaMatch ? fullContent.substring(0, fullContent.indexOf('\n\n**Media:**')).trim() : fullContent;

      // Remove any nested quotedPost section from the content to prevent infinite nesting
      content = content.replace(/## (?:🔗 Shared Post|🔄 Reblogged Post)[\s\S]*?(?=\n---\n|$)/, '').trim();

      // Extract URL from metadata
      const urlMatch = quotedSection.match(/\*\*Original URL:\*\* (.+)/);
      const url = urlMatch?.[1]?.trim() || '';

      // Extract author name and URL from metadata line
      const authorMetadataMatch = quotedSection.match(/\*\*(?:Channel|Author):\*\* \[(.+?)\]\((.+?)\)/);
      const authorName = authorMetadataMatch?.[1]?.trim();
      const authorUrl = authorMetadataMatch?.[2]?.trim() || url;

      // Extract timestamp
      const metadataLineMatch = quotedSection.match(/\*\*Published:\*\* (.+?)(?:\s*\||$)/);
      const timestamp = metadataLineMatch?.[1] ? new Date(metadataLineMatch[1].trim()) : new Date();

      // Extract likes, comments, shares
      const likesMatch = quotedSection.match(/\*\*Likes:\*\* ([\d,]+)/);
      const commentsMatch = quotedSection.match(/\*\*Comments:\*\* ([\d,]+)/);
      const sharesMatch = quotedSection.match(/\*\*Shares:\*\* ([\d,]+)/);

      const likes = likesMatch?.[1] ? parseInt(likesMatch[1].replace(/,/g, '')) : undefined;
      const comments = commentsMatch?.[1] ? parseInt(commentsMatch[1].replace(/,/g, '')) : undefined;
      const shares = sharesMatch?.[1] ? parseInt(sharesMatch[1].replace(/,/g, '')) : undefined;

      // Extract external link from "🔗 **Link:** [title](url)" format
      const externalLinkMatch = quotedSection.match(/🔗 \*\*Link:\*\* \[(.+?)\]\((.+?)\)/);
      const externalLinkTitle = externalLinkMatch?.[1]?.trim();
      const externalLink = externalLinkMatch?.[2]?.trim();

      // Extract media URLs
      let media: { type: 'image' | 'video' | 'audio'; url: string; altText?: string }[] = [];
      if (mediaMatch && mediaMatch[1]) {
        const mediaSection = mediaMatch[1];
        // Support multiline alt text for quote tweet screenshots
        const mediaRegex = /!\[([\s\S]*?)\]\(([^)]+)\)/g;
        let match;
        while ((match = mediaRegex.exec(mediaSection)) !== null) {
          const altText = match[1] || undefined;
          const mediaUrl = match[2];
          if (!mediaUrl) continue;
          const detectedType = detectMediaType(mediaUrl);
          const type = detectedType === 'document' ? 'image' : detectedType;
          media.push({ type, url: this.resolveMediaPath(mediaUrl, parentFilePath), altText });
        }
      }

      media = this.dedupeMedia(media);

      // Format author name
      // Prefer authorName from metadata, fallback to authorHandle from header
      let displayName: string;
      if (platform === 'youtube' && authorName) {
        displayName = `${authorName} (${authorHandle})`;
      } else {
        displayName = authorName || authorHandle;
      }

      // Create quoted PostData
      const quotedPost: Omit<PostData, 'quotedPost' | 'embeddedArchives'> = {
        platform: platform as Platform,
        id: url,
        url,
        author: {
          name: displayName,
          url: authorUrl,
          handle: authorHandle,
        },
        content: {
          text: content,
        },
        media,
        metadata: {
          timestamp,
          likes,
          comments,
          shares,
          externalLink,
          externalLinkTitle,
        },
      };

      return quotedPost;
    } catch (err) {
      console.error('[PostDataParser] Error parsing quoted post:', err);
      return undefined;
    }
  }

  /**
   * Remove duplicated media entries using type + URL as the identity key
   */
  private dedupeMedia<T extends Pick<Media, 'type' | 'url'> & Partial<Media>>(mediaItems: T[]): T[] {
    const unique: T[] = [];
    const seen = new Set<string>();

    for (const item of mediaItems) {
      if (!item || !item.url) {
        continue;
      }

      const key = `${item.type || 'image'}::${item.url}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      unique.push(item);
    }

    return unique;
  }

  /**
   * Resolve relative media paths (../../attachments/...) to vault-relative paths
   */
  private resolveMediaPath(mediaPath: string, parentFilePath?: string): string {
    if (!mediaPath) {
      return mediaPath;
    }

    const trimmed = mediaPath.trim();

    // Leave external URLs untouched
    if (/^(?:https?:|data:|obsidian:|vault:)/i.test(trimmed)) {
      return trimmed;
    }

    // Normalize slashes
    let normalized = trimmed.replace(/\\/g, '/');

    // Remove leading "./"
    if (normalized.startsWith('./')) {
      normalized = normalized.substring(2);
    }

    const isExplicitRelative = normalized.startsWith('../');

    if (!isExplicitRelative) {
      // Ensure no duplicate slashes for vault-relative paths
      return normalized.replace(/\/{2,}/g, '/').replace(/^\/+/, '');
    }

    const baseSegments = parentFilePath
      ? parentFilePath.replace(/\\/g, '/').split('/').slice(0, -1)
      : [];

    const relativeSegments = normalized.split('/');
    const stack = [...baseSegments];

    for (const segment of relativeSegments) {
      if (!segment || segment === '.') {
        continue;
      }
      if (segment === '..') {
        if (stack.length > 0) {
          stack.pop();
        }
      } else {
        stack.push(segment);
      }
    }

    return stack.join('/');
  }

  /**
   * Parse a profile-only document into PostData
   * Profile documents have frontmatter with type: profile and contain user metadata
   */
  private parseProfileDocument(
    file: TFile,
    frontmatter: YamlFrontmatter,
    _content: string
  ): PostData {
    const crawledAt = frontmatter['crawledAt'] as string | undefined;
    const archivedDate = crawledAt ? new Date(crawledAt) : new Date(file.stat.ctime);
    const handle = (frontmatter['handle'] as string | undefined) || 'Unknown';
    const displayName = (frontmatter['displayName'] as string | undefined) || handle;

    // Extract avatar path - prioritize local avatar
    const avatarPath = frontmatter['avatar'] as string | undefined;
    const avatarUrl = frontmatter['avatarUrl'] as string | undefined;
    const avatarIsLocal = avatarPath && !avatarPath.startsWith('http');

    return {
      type: 'profile',
      platform: frontmatter.platform as Platform,
      id: `profile-${handle}`,
      url: (frontmatter['profileUrl'] as string | undefined) || '',
      filePath: file.path,
      archivedDate,
      author: {
        name: displayName,
        url: (frontmatter['profileUrl'] as string | undefined) || '',
        handle: handle,
        avatar: avatarIsLocal ? undefined : (avatarUrl || avatarPath),
        localAvatar: avatarIsLocal ? avatarPath : undefined,
        bio: frontmatter['bio'] as string | undefined,
        followers: frontmatter['followers'] as number | undefined,
        verified: frontmatter['verified'] as boolean | undefined,
      },
      content: {
        text: (frontmatter['bio'] as string | undefined) || '',
      },
      media: [], // Profile documents don't have media
      metadata: {
        timestamp: archivedDate,
      },
      profileMetadata: {
        displayName,
        handle,
        bio: frontmatter['bio'] as string | undefined,
        followers: frontmatter['followers'] as number | undefined,
        following: frontmatter['following'] as number | undefined,
        postsCount: frontmatter['postsCount'] as number | undefined,
        verified: frontmatter['verified'] as boolean | undefined,
        location: frontmatter['location'] as string | undefined,
        profileUrl: frontmatter['profileUrl'] as string | undefined,
        crawledAt: archivedDate,
      },
    };

  }

  /**
   * Extract series information from frontmatter
   * Used for Brunch brunchbook, Naver Webtoon, etc.
   * Returns undefined if no series info is found
   */
  private extractSeriesInfo(frontmatter: YamlFrontmatter): import('../../../types/post').SeriesInfo | undefined {
    // Check for series ID - required field
    const seriesId = frontmatter.seriesId;
    if (!seriesId) {
      return undefined;
    }

    // Get series title (support both naming conventions)
    // - Instagram/others: series
    // - Brunch: seriesTitle
    const seriesTitle = frontmatter.series || (frontmatter['seriesTitle'] as string | undefined);

    // Get episode number (support both naming conventions)
    const episode = frontmatter.episode ?? (frontmatter['seriesEpisode'] as number | undefined);

    return {
      id: seriesId,
      title: seriesTitle || 'Unknown Series',
      url: frontmatter.seriesUrl,
      episode,
    };
  }

  // ---------------------------------------------------------------------------
  // PostIndexService integration
  // ---------------------------------------------------------------------------

  /**
   * Load a full PostData from a single file (on-demand).
   * Called by renderRealCard() when a skeleton enters the viewport.
   */
  async loadFullPost(filePath: string): Promise<PostData | null> {
    const file = this.vault.getFileByPath(filePath);
    if (!file) return null;
    return this.parseFile(file);
  }

  /**
   * Build a lightweight PostIndexEntry from a vault file.
   * Reads only the YAML frontmatter + minimal content to extract
   * filtering/sorting/search metadata without building a full PostData.
   */
  async buildIndexEntry(file: TFile): Promise<PostIndexEntry | null> {
    try {
      const content = await this.vault.cachedRead(file);

      // Try MetadataCache first
      let frontmatter: Record<string, unknown> | null = null;
      if (this.app?.metadataCache) {
        const cache = this.app.metadataCache.getFileCache(file);
        if (cache?.frontmatter) {
          frontmatter = cache.frontmatter as Record<string, unknown>;
        }
      }

      if (!frontmatter) {
        const parsed = this.parseFrontmatter(content);
        if (!parsed) return null;
        frontmatter = parsed as Record<string, unknown>;
      }

      if (!frontmatter['platform']) return null;

      // Profile documents
      const isProfile = frontmatter['type'] === 'profile';

      // User-post validation
      if (frontmatter['platform'] === 'post' && !isProfile) {
        if (!frontmatter['author'] || !frontmatter['published'] && !frontmatter['archived']) {
          return null;
        }
      }

      const platform = frontmatter['platform'] as Platform;
      const isUserPost = platform === 'post';
      const publishedDate = frontmatter['published'] ? new Date(frontmatter['published'] as string) : undefined;
      const archivedDate = frontmatter['archived'] ? new Date(frontmatter['archived'] as string) : undefined;
      const metadataTimestamp = new Date(
        (frontmatter['published'] as string | undefined) ||
        (frontmatter['archived'] as string | undefined) ||
        file.stat.ctime
      );

      // Lightweight content extraction for search (just first section)
      const contentText = this.extractContentText(content);

      // Series info
      const seriesId = frontmatter['seriesId'] as string | undefined;
      const episodeNumber = (frontmatter['episode'] as number | undefined) ?? (frontmatter['seriesEpisode'] as number | undefined);

      // Count media: quick regex count instead of full parse
      let mediaCount = 0;
      if (frontmatter['media'] && Array.isArray(frontmatter['media'])) {
        mediaCount = (frontmatter['media'] as unknown[]).length;
      } else {
        // Quick count of embedded images/videos (approximate)
        const embedMatches = content.match(/!\[/g);
        mediaCount = embedMatches ? embedMatches.length : 0;
      }

      // Count comments from section header
      const commentsSection = content.match(/## 💬 Comments/);
      const commentCount = commentsSection ? (frontmatter['comments'] ?? 0) : 0;

      return PostIndexService.buildEntry(file, frontmatter, contentText, platform, {
        authorName: (isProfile ? frontmatter['displayName'] : frontmatter['author']) as string || 'Unknown',
        authorHandle: (frontmatter['authorHandle'] as string | undefined) || (frontmatter['handle'] as string | undefined),
        title: frontmatter['title'] as string | undefined,
        url: isUserPost ? file.path : ((frontmatter['originalUrl'] as string | undefined) || ''),
        tags: Array.isArray(frontmatter['tags']) ? frontmatter['tags'] as string[] : [],
        hashtags: (frontmatter['hashtags'] as string[] | undefined) || [],
        like: frontmatter['like'] === true,
        archive: frontmatter['archive'] === true,
        subscribed: frontmatter['subscribed'] === true,
        subscriptionId: frontmatter['subscriptionId'] as string | undefined,
        publishedDate,
        archivedDate,
        mediaCount,
        commentCount: typeof commentCount === 'number' ? commentCount : 0,
        likesCount: frontmatter['likes'] as number | undefined,
        commentsCount: frontmatter['comments'] as number | undefined,
        type: isProfile ? 'profile' : undefined,
        comment: frontmatter['comment'] as string | undefined,
        shareUrl: frontmatter['shareUrl'] as string | undefined,
        seriesId,
        episodeNumber,
        metadataTimestamp,
      });
    } catch {
      return null;
    }
  }

  /**
   * Chunked async generator: parse files in batches, yielding to the main thread
   * between batches so the UI stays responsive.
   *
   * @param files       Files to parse
   * @param batchSize   How many files to process per micro-batch
   * @param yieldMs     How long to yield to the main thread between batches (ms)
   */
  async *parseFilesChunked(
    files: TFile[],
    batchSize: number = 20,
    yieldMs: number = 8
  ): AsyncGenerator<PostIndexEntry[]> {
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(f => this.buildIndexEntry(f))
      );
      const valid = results.filter((e): e is PostIndexEntry => e !== null);
      if (valid.length > 0) {
        yield valid;
      }
      // Yield to main thread for UI responsiveness
      await new Promise<void>(resolve => setTimeout(resolve, yieldMs));
    }
  }

  /**
   * Collect all markdown files under a folder recursively.
   * Exposed as a public utility for PostIndexService integration.
   */
  collectMarkdownFiles(archivePath: string): TFile[] {
    const archiveFolder = this.vault.getFolderByPath(archivePath);
    if (!archiveFolder) return [];

    const files: TFile[] = [];
    const collect = (folder: VaultFolder): void => {
      for (const child of folder.children) {
        const childAsFolder = child as VaultFolder;
        if (childAsFolder.children) {
          collect(childAsFolder);
        } else {
          if (child instanceof TFile && child.extension === 'md') {
            files.push(child);
          }
        }
      }
    };
    collect(archiveFolder as VaultFolder);
    return files;
  }
}
