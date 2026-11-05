/**
 * The one save path for an AI comment made on this device: appended to the
 * note's `## AI Comments` (a continued chat replaces the one it continues in
 * the same write), mirrored into frontmatter, then the note's whole list
 * PATCHed to the server archive and pushed to a live share (both best
 * effort). Banner runs, chat, research and resumed deep research all land
 * here, so the note stays the source the server copy is rebuilt from.
 */
import { Platform, type App, type TFile } from 'obsidian';
import { aiCommentBudget, clipAICommentContent, isAnyNoteReply, type AICommentBudget } from '../../vendor/byok-ai-core';
import type { AICommentMeta, AICommentType } from '../../types/ai-comment';
import type { PostData } from '../../types/post';
import type { SocialArchiverSettings } from '../../types/settings';
import type SocialArchiverPlugin from '../../main';
import type { AICommentPayload, WorkersAPIClient } from '../WorkersAPIClient';
import { ShareAPIClient } from '../ShareAPIClient';
import { serializePostForShare } from '../../utils/serializePostForShare';
import { appendAIComment, hasComment, parseAIComments, removeAIComment, updateFrontmatterAIComments } from './markdown-handler';

const DEFAULT_WORKER_URL = 'https://social-archiver-api.social-archive.org';

export interface AICommentSaverDeps {
  app: App;
  /** The server client; may throw while unconfigured (the plugin getter does). */
  api: () => Pick<WorkersAPIClient, 'updateArchiveActions' | 'getUserArchives'>;
  settings: () => Pick<SocialArchiverSettings, 'workerUrl' | 'authToken' | 'username'>;
}

/** A comment as the note keeps it. */
export interface StoredAIComment {
  id: string;
  content: string;
}

/** Where a modal or runner saves its comment: one post's note. */
export interface AICommentTarget {
  post: PostData;
  /**
   * Room for one more comment of `type` in the note, or null (20 comments, or
   * the byte budget spent). The comment `replaceId` names counts as room.
   */
  budget(type: AICommentType, replaceId?: string): Promise<AICommentBudget | null>;
  /** Appends to the note's AI comments (removing `replaceId` in the same write) and syncs them (server archive, live share). */
  save(meta: AICommentMeta, content: string, replaceId?: string): Promise<void>;
  /** The note's latest saved chat, which chat on this post continues. */
  savedChat?(): Promise<StoredAIComment | null>;
}

export class AICommentSaver {
  constructor(private readonly deps: AICommentSaverDeps) {}

  async budget(file: TFile, type: AICommentType, replaceId?: string): Promise<AICommentBudget | null> {
    const { comments, commentTexts } = parseAIComments(await this.deps.app.vault.read(file));
    const kept = comments.filter((comment) => comment.id !== replaceId);
    return aiCommentBudget(buildAICommentPayload(kept, commentTexts), type);
  }

  /**
   * The note's latest `chat` comment (comments are appended, so the last is
   * the newest) that is not a reply to a note: a reply continues from its note.
   */
  async savedChat(file: TFile): Promise<StoredAIComment | null> {
    const { comments, commentTexts } = parseAIComments(await this.deps.app.vault.read(file));
    const chat = [...comments].reverse().find((comment) => comment.type === 'chat' && !isAnyNoteReply(comment.id));
    return chat ? { id: chat.id, content: commentTexts.get(chat.id) ?? '' } : null;
  }

  async append(post: PostData, file: TFile, meta: AICommentMeta, content: string, replaceId?: string): Promise<void> {
    let newContent = '';
    await this.deps.app.vault.process(file, (existing) => {
      // Only a comment still there is removed: rebuilding the section for nothing would reformat the others.
      const kept = replaceId && hasComment(existing, replaceId) ? removeAIComment(existing, replaceId) : existing;
      newContent = appendAIComment(kept, meta, content);
      return newContent;
    });
    const { comments, commentTexts } = parseAIComments(newContent);
    await updateFrontmatterAIComments(this.deps.app, file, comments);
    await this.syncArchive(post, file, comments, commentTexts);
    const shareUrl = post.shareUrl || this.frontmatterString(file, 'shareUrl');
    if (shareUrl) void this.syncShare(post, shareUrl, comments, commentTexts);
  }

  /** A target over `file` for modals and runners; hooks let the opener mark its own writes. */
  target(post: PostData, file: TFile, hooks: { beforeWrite?(): void; afterSave?(): void } = {}): AICommentTarget {
    return {
      post,
      budget: (type, replaceId) => this.budget(file, type, replaceId),
      savedChat: () => this.savedChat(file),
      save: async (meta, content, replaceId): Promise<void> => {
        hooks.beforeWrite?.();
        await this.append(post, file, meta, content, replaceId);
        hooks.afterSave?.();
      },
    };
  }

  /** The note's full list replaces the server archive's (best effort). */
  async syncArchive(post: PostData, file: TFile, comments: AICommentMeta[], commentTexts: Map<string, string>): Promise<void> {
    try {
      const archiveId = post.sourceArchiveId || this.frontmatterString(file, 'sourceArchiveId')
        || await this.archiveIdByOriginalUrl(post, file);
      if (!archiveId) return;
      await this.deps.api().updateArchiveActions(archiveId, {
        aiComments: buildAICommentPayload(comments, commentTexts),
      });
    } catch (error) {
      console.error('[Social Archiver] Failed to sync AI comments to archive:', error);
    }
  }

  /** A shared post gets the new list too (best effort, never throws). */
  async syncShare(post: PostData, shareUrl: string, comments: AICommentMeta[], commentTexts: Map<string, string>): Promise<void> {
    try {
      // https://social-archive.org/{shareId} or https://social-archive.org/{username}/{shareId}
      const shareId = shareUrl.split('/').filter(Boolean).pop();
      if (!shareId) {
        console.warn('[Social Archiver] Could not extract shareId from shareUrl:', shareUrl);
        return;
      }
      const settings = this.deps.settings();
      const configured = settings.workerUrl || DEFAULT_WORKER_URL;
      const shareClient = new ShareAPIClient({
        // Mobile cannot reach a localhost worker: use production there.
        baseURL: Platform.isMobile && configured.includes('localhost') ? DEFAULT_WORKER_URL : configured,
        apiKey: settings.authToken,
        vault: this.deps.app.vault,
        debug: false,
      });
      const postData = serializePostForShare(post, { stripMedia: true });
      postData.aiComments = buildAICommentPayload(comments, commentTexts);
      await shareClient.updateShare(shareId, { postData, options: { shareId, username: settings.username } });
    } catch (error) {
      console.error('[Social Archiver] Failed to update shared post AI comments:', error);
    }
  }

  private async archiveIdByOriginalUrl(post: PostData, file: TFile): Promise<string | undefined> {
    const originalUrl = post.originalUrl || post.url || this.frontmatterString(file, 'originalUrl') || this.frontmatterString(file, 'url');
    if (!originalUrl) return undefined;
    try {
      const response = await this.deps.api().getUserArchives({ originalUrl, limit: 2 });
      const archive = response.archives.length === 1 ? response.archives[0] : undefined;
      if (!archive) return undefined;
      await this.deps.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        if (!fm.sourceArchiveId) fm.sourceArchiveId = archive.id;
      });
      return archive.id;
    } catch (error) {
      console.warn('[Social Archiver] Failed to resolve archive by original URL:', error);
      return undefined;
    }
  }

  private frontmatterString(file: TFile, key: string): string | undefined {
    const frontmatter: unknown = this.deps.app.metadataCache.getFileCache(file)?.frontmatter;
    const value = frontmatter && typeof frontmatter === 'object' ? (frontmatter as Record<string, unknown>)[key] : undefined;
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}

/** A saver over the plugin's vault, server client and settings (read on every save). */
export function pluginAICommentSaver(plugin: Pick<SocialArchiverPlugin, 'app' | 'settings' | 'workersApiClient'>): AICommentSaver {
  return new AICommentSaver({ app: plugin.app, api: () => plugin.workersApiClient, settings: () => plugin.settings });
}

/** The note's comments as the server and share expect them (content clipped to the server's per-type cap). */
export function buildAICommentPayload(comments: AICommentMeta[], commentTexts: Map<string, string>): AICommentPayload[] {
  return comments.map((meta) => ({
    meta: {
      id: meta.id,
      cli: meta.cli,
      ...(meta.model ? { model: meta.model } : {}),
      ...(meta.executedModel ? { executedModel: meta.executedModel } : {}),
      type: meta.type,
      generatedAt: meta.generatedAt,
      ...(typeof meta.processingTime === 'number' ? { processingTime: meta.processingTime } : {}),
      ...(meta.contentHash ? { contentHash: meta.contentHash } : {}),
      ...(meta.customPrompt ? { customPrompt: meta.customPrompt } : {}),
      ...(meta.sourceLanguage ? { sourceLanguage: meta.sourceLanguage } : {}),
      ...(meta.targetLanguage ? { targetLanguage: meta.targetLanguage } : {}),
    },
    // Same per-type cap as the server: an over-long comment would make every later full-array PATCH fail.
    content: clipAICommentContent(meta.type, commentTexts.get(meta.id) || ''),
  }));
}
