/**
 * "@Claude what is this based on?" in the plugin's note on a post (the
 * frontmatter `comment`): saving the note asks each AI the edit newly mentions
 * one chat turn about the post (no history, no web search), and saves the
 * answer as a saved chat that replies to the note: its id carries the note
 * (noteReplyCommentId), so it shows under the note and continues as a chat.
 * An AI this vault cannot ask says why and asks nothing; the note itself is
 * never touched. While an AI answers, the post has a pending reply (memory
 * only) that views follow with subscribe(). No DOM.
 */
import {
  BYOK_PROVIDERS,
  newAIMentions,
  noteQuestionText,
  noteReplyCommentId,
  type AIMentionHandle,
  type ByokArticleInput,
} from '../../vendor/byok-ai-core';
import type { PostData } from '../../types/post';
import type { AICommentTarget } from '../ai-comment/AICommentSaver';
import type { WorkersAPIClient } from '../WorkersAPIClient';
import type { ByokService } from './ByokService';
import { PostChatSession, chatErrorMessage, type ChatEngine } from './PostChatSession';
import { buildPostArticleInput } from './postArticleInput';
import { t } from '../../i18n';

/** What chat on the post asks with (chatPanelOptionsFor gives it). */
export interface NoteMentionChat {
  byok: ByokService | null;
  cloud: () => Pick<WorkersAPIClient, 'askChatAI'> | null;
  /** Server archive id; Cloud AI needs one. */
  archiveId: string | null;
  signedIn: boolean;
  /** 'auto' | ISO code. */
  outputLanguage?: string;
}

export interface NoteMentionAskerDeps {
  chat: (target: AICommentTarget) => NoteMentionChat;
  /** The id the plugin's note syncs as (pluginNoteId). */
  noteId: () => string;
  notify: (message: string) => void;
}

/** An AI answering the note: shown under it until the reply is saved or fails. */
export interface PendingNoteReply {
  /** As mentioned ("Claude"). */
  readonly handle: string;
  readonly question: string;
}

/** The note the plugin's `comment` syncs as (AnnotationOutboundService builds the same id). */
export function pluginNoteId(syncClientId: string | undefined): string {
  return `obsidian:${syncClientId ?? ''}:primary`;
}

const keyOf = (post: Pick<PostData, 'filePath' | 'id'>): string => post.filePath || post.id;

export class NoteMentionAsker {
  private readonly pending = new Map<string, readonly PendingNoteReply[]>();
  private readonly listeners = new Map<string, Set<() => void>>();
  /** Per post: each save re-reads the note's comments, so two at once would drop one reply. */
  private readonly saves = new Map<string, Promise<void>>();
  /** Plugin unload: answers on their way stop and nothing more is saved. */
  private readonly unload = new AbortController();

  constructor(private readonly deps: NoteMentionAskerDeps) {}

  pendingFor(post: Pick<PostData, 'filePath' | 'id'>): readonly PendingNoteReply[] {
    return this.pending.get(keyOf(post)) ?? [];
  }

  /** `listener` runs after `post`'s pending replies change; returns the unsubscribe. */
  subscribe(post: Pick<PostData, 'filePath' | 'id'>, listener: () => void): () => void {
    const key = keyOf(post);
    const set = this.listeners.get(key) ?? new Set<() => void>();
    set.add(listener);
    this.listeners.set(key, set);
    return () => {
      set.delete(listener);
      if (set.size === 0 && this.listeners.get(key) === set) this.listeners.delete(key);
    };
  }

  /**
   * The note on `target.post` was saved as `after` (it was `before`; '' for a
   * new note): asks each AI the edit added, at once (pending is set when this
   * returns). Resolves when every answer is saved or has failed.
   */
  async askNoteMentions(target: AICommentTarget, before: string, after: string): Promise<void> {
    const handles = newAIMentions(before, after);
    if (handles.length === 0) return;
    const chat = this.deps.chat(target);
    const question = noteQuestionText(after);
    await Promise.all(
      handles.map((handle) => {
        // The same save twice (a double-clicked Save) asks once.
        if (this.pendingFor(target.post).some((item) => item.handle === handle.handle && item.question === question)) {
          return Promise.resolve();
        }
        const resolved = engineFor(chat, handle);
        if ('reason' in resolved) {
          this.deps.notify(resolved.reason);
          return Promise.resolve();
        }
        return this.answer(target, chat, handle, resolved.engine, question);
      }),
    );
  }

  dispose(): void {
    this.unload.abort();
    this.pending.clear();
    this.listeners.clear();
  }

  private async answer(target: AICommentTarget, chat: NoteMentionChat, handle: AIMentionHandle, engine: ChatEngine, question: string): Promise<void> {
    const { post } = target;
    const entry: PendingNoteReply = { handle: handle.handle, question };
    this.setPending(post, [...this.pendingFor(post), entry]);
    try {
      // The chat machinery as "Chat about this post" runs it, with nothing before the question.
      const session = new PostChatSession({
        byok: (): ByokService | null => chat.byok,
        cloud: chat.cloud,
        article: (): ByokArticleInput => buildPostArticleInput(post),
        archiveId: chat.archiveId,
        ...(chat.outputLanguage ? { outputLanguage: chat.outputLanguage } : {}),
      });
      session.setEngine(engine);
      try {
        await session.ask(question, { signal: this.unload.signal });
      } catch (error) {
        if (!this.unload.signal.aborted) this.deps.notify(chatErrorMessage(error, engine));
        return;
      }
      await this.serial(keyOf(post), () => this.save(target, session));
    } finally {
      this.setPending(post, this.pendingFor(post).filter((item) => item !== entry));
    }
  }

  private async save(target: AICommentTarget, session: PostChatSession): Promise<void> {
    if (this.unload.signal.aborted) return;
    try {
      const budget = await target.budget('chat');
      const comment = budget ? session.buildComment(budget) : null;
      if (!comment) {
        this.deps.notify(t('byok.noRoom'));
        return;
      }
      await target.save({ ...comment.meta, id: noteReplyCommentId(comment.meta.id, this.deps.noteId()) }, comment.content);
    } catch (error) {
      this.deps.notify(t('byok.saveFailed', { reason: error instanceof Error ? error.message : String(error) }));
    }
  }

  private serial(key: string, task: () => Promise<void>): Promise<void> {
    const run = (this.saves.get(key) ?? Promise.resolve()).then(task);
    this.saves.set(key, run);
    void run.finally(() => {
      if (this.saves.get(key) === run) this.saves.delete(key);
    });
    return run;
  }

  private setPending(post: Pick<PostData, 'filePath' | 'id'>, items: readonly PendingNoteReply[]): void {
    const key = keyOf(post);
    if (items.length > 0) this.pending.set(key, items);
    else this.pending.delete(key);
    for (const listener of [...(this.listeners.get(key) ?? [])]) listener();
  }
}

/** Who answers `handle` here, or why nobody can: the rule chatEngineOptions offers engines by. */
function engineFor(chat: NoteMentionChat, handle: AIMentionHandle): { engine: ChatEngine } | { reason: string } {
  const { target } = handle;
  if (target.kind === 'byok') {
    return chat.byok?.readyProviders().includes(target.provider)
      ? { engine: { kind: 'byok', provider: target.provider } }
      : { reason: t('byok.mention.noKey', { provider: BYOK_PROVIDERS[target.provider].label, handle: handle.handle }) };
  }
  if (!chat.signedIn) return { reason: t('byok.mention.signIn', { handle: handle.handle }) };
  return chat.archiveId ? { engine: { kind: 'cloud' } } : { reason: t('byok.cloud.notFound') };
}
