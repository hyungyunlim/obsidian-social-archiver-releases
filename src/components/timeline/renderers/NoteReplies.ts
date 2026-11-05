/**
 * Under the plugin's note ("My Note" on the card, "Note" in reader mode): the
 * AI answers to its mentions. Each is a saved chat replying to the note,
 * labelled like an AI comment, showing its turns after the first question
 * (the note itself), with "Continue chat"; then who is still replying. Reads
 * the note itself, and again as each answer on its way lands.
 */
import { MarkdownRenderer, TFile, type App, type Component } from 'obsidian';
import { noteReplyTranscript, splitNoteReplies } from '../../../vendor/byok-ai-core';
import type { AICommentMeta } from '../../../types/ai-comment';
import type { PostData } from '../../../types/post';
import type { StoredAIComment } from '../../../services/ai-comment/AICommentSaver';
import type { NoteMentionAsker } from '../../../services/byok/NoteMentionAsker';
import { parseAIComments } from '../../../services/ai-comment/markdown-handler';
import { getAICommentDisplay } from '../../../utils/ai-comment-display';
import { renderContinueChatLink } from './AICommentRenderer';
import { t } from '../../../i18n';

export interface NoteRepliesOptions {
  app: App;
  /** Owns the rendered answers (the card renderer, the reader's content renderer). */
  component: Component;
  post: PostData;
  /** The id the plugin's note syncs as (pluginNoteId). */
  noteId: string;
  asker?: NoteMentionAsker;
  /** "Continue chat" on a reply; omitted where chat cannot open on the post. */
  onContinue?: (reply: StoredAIComment) => void;
}

const REPLIES_CLASS = 'sa-note-replies';

/**
 * The replies to the plugin's note among a note's AI comments (oldest
 * first), and the rest. With the note gone its replies stay with the rest,
 * where any saved chat shows.
 */
export function splitPluginNoteReplies<C extends { readonly meta: Pick<AICommentMeta, 'id' | 'type'> }>(
  comments: readonly C[],
  post: Pick<PostData, 'comment'>,
  noteId: string,
): { replies: C[]; others: C[] } {
  const { replies, others } = splitNoteReplies(comments, post.comment?.trim() ? [{ id: noteId }] : []);
  return { replies: replies.get(noteId) ?? [], others };
}

/** The note's replies right after `noteEl`, replacing any drawn there before. */
export function renderNoteReplies(noteEl: HTMLElement, options: NoteRepliesOptions): void {
  const { asker, post } = options;
  const previous = noteEl.nextElementSibling;
  if (previous?.classList.contains(REPLIES_CLASS)) previous.remove();
  const parent = noteEl.parentElement;
  if (!parent) return;
  const el = parent.createDiv({ cls: REPLIES_CLASS });
  noteEl.insertAdjacentElement('afterend', el);

  let loads = 0;
  const load = async (): Promise<void> => {
    const run = ++loads;
    const replies = await readReplies(options);
    if (run !== loads) return;
    el.empty();
    for (const reply of replies) renderReply(el, reply, options);
    for (const pending of asker?.pendingFor(post) ?? []) {
      el.createDiv({ cls: 'sa-note-reply-pending sa-text-muted sa-text-sm', text: t('byok.mention.replying', { name: pending.handle }) });
    }
  };
  void load();

  // An answer on its way: drawn again as each lands, let go after the last (or once this view is gone).
  if (!asker || asker.pendingFor(post).length === 0) return;
  const unsubscribe = asker.subscribe(post, () => {
    if (asker.pendingFor(post).length === 0 || !el.isConnected) unsubscribe();
    void load();
  });
}

/** The note's replies to the plugin's note, oldest first; none without a note or when it cannot be read. */
async function readReplies({ app, post, noteId }: NoteRepliesOptions): Promise<{ meta: AICommentMeta; content: string }[]> {
  // ponytail: a card with a note reads its file twice (here and for its AI comments); share one parse if card renders get slow.
  if (!post.comment?.trim() || !post.filePath) return [];
  try {
    const file = app.vault.getAbstractFileByPath(post.filePath);
    if (!(file instanceof TFile)) return [];
    const { comments, commentTexts } = parseAIComments(await app.vault.read(file));
    return splitPluginNoteReplies(comments.map((meta) => ({ meta, content: commentTexts.get(meta.id) ?? '' })), post, noteId).replies;
  } catch {
    return [];
  }
}

function renderReply(parent: HTMLElement, reply: { meta: AICommentMeta; content: string }, options: NoteRepliesOptions): void {
  const { meta, content } = reply;
  const item = parent.createDiv({ cls: 'sa-note-reply', attr: { 'data-comment-id': meta.id } });
  const display = getAICommentDisplay(meta);
  const header = item.createDiv({ cls: 'sa-flex-row sa-gap-6 sa-mb-4' });
  header.createSpan({ cls: 'sa-font-semibold sa-text-normal', text: display.headerLabel });
  if (display.modelLabel && !display.headerLabel.includes(display.modelLabel)) {
    header.createSpan({ cls: 'sa-text-xs sa-text-muted', text: display.modelLabel });
  }
  const body = item.createDiv({ cls: 'sa-note-reply-body ai-comment-plain' });
  const transcript = noteReplyTranscript(content);
  void MarkdownRenderer.render(options.app, transcript, body, options.post.filePath ?? '', options.component).catch(() => {
    body.textContent = transcript;
  });
  const { onContinue } = options;
  if (onContinue) renderContinueChatLink(item, () => onContinue({ id: meta.id, content }));
}
