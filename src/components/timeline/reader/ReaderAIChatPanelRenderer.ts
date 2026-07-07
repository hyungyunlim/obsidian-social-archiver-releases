import { MarkdownRenderer, type App, type Component } from 'obsidian';
import type { PostData } from '../../../types/post';
import {
  formatReaderChatTimelineMeta,
  parseReaderChatTimelineTurns,
  stripReaderChatTimelineHeading,
} from '@/utils/reader-chat-section';
import { createReaderCollapsibleSection } from './ReaderCollapsibleSection';

export interface ReaderAIChatRenderContext {
  readonly app: App;
  readonly component: Component;
}

export function hasReaderAIChat(post: PostData): boolean {
  return !!post.readerChat?.section.trim();
}

export function countReaderAIChatTurns(post: PostData): number {
  if (!post.readerChat) return 0;
  const bodyMarkdown = stripReaderChatTimelineHeading(post.readerChat.section);
  if (!bodyMarkdown) return 0;

  const turns = parseReaderChatTimelineTurns(bodyMarkdown);
  return turns.length > 0 ? turns.length : 1;
}

export async function renderReaderAIChatSection(
  parent: HTMLElement,
  post: PostData,
  context: ReaderAIChatRenderContext,
): Promise<void> {
  const readerChat = post.readerChat;
  if (!readerChat) return;

  const bodyMarkdown = stripReaderChatTimelineHeading(readerChat.section);
  if (!bodyMarkdown) return;

  const section = createReaderCollapsibleSection(parent, 'AI Chat');

  const meta = formatReaderChatTimelineMeta(readerChat.headingLine);
  if (meta) {
    section.createDiv({ cls: 'sa-reader-mode-ai-chat-meta', text: meta });
  }

  const transcript = section.createDiv({
    cls: 'sa-reader-mode-ai-chat-transcript',
    attr: { role: 'list' },
  });
  const turns = parseReaderChatTimelineTurns(bodyMarkdown);

  if (turns.length === 0) {
    const rawBody = transcript.createDiv({ cls: 'sa-reader-mode-ai-chat-raw' });
    await MarkdownRenderer.render(context.app, bodyMarkdown, rawBody, post.filePath || '', context.component);
    return;
  }

  for (const turn of turns) {
    const turnEl = transcript.createDiv({
      cls: 'sa-reader-mode-ai-chat-turn',
      attr: { role: 'listitem' },
    });

    const userMessage = turnEl.createDiv({
      cls: 'sa-reader-mode-ai-chat-message sa-reader-mode-ai-chat-message-user',
    });
    userMessage.createDiv({ cls: 'sa-reader-mode-ai-chat-message-label', text: 'You' });
    userMessage.createDiv({ cls: 'sa-reader-mode-ai-chat-message-text', text: turn.question });

    if (turn.answerMarkdown) {
      const assistantMessage = turnEl.createDiv({
        cls: 'sa-reader-mode-ai-chat-message sa-reader-mode-ai-chat-message-assistant',
      });
      assistantMessage.createDiv({ cls: 'sa-reader-mode-ai-chat-message-label', text: 'AI' });
      const answerBody = assistantMessage.createDiv({ cls: 'sa-reader-mode-ai-chat-answer' });
      await MarkdownRenderer.render(context.app, turn.answerMarkdown, answerBody, post.filePath || '', context.component);
    }
  }
}
