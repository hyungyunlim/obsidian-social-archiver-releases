import { MarkdownRenderer, type App, type Component } from 'obsidian';
import {
  formatReaderChatTimelineMeta,
  parseReaderChatTimelineTurns,
  stripReaderChatTimelineHeading,
  type ReaderChatSection,
} from '@/utils/reader-chat-section';

export {
  formatReaderChatTimelineMeta,
  parseReaderChatTimelineTurns,
  stripReaderChatTimelineHeading,
} from '@/utils/reader-chat-section';

export interface ReaderChatTimelineRenderContext {
  readonly app: App;
  readonly component: Component;
  readonly sourcePath?: string;
}

function appendDiv(parent: HTMLElement, className: string, text?: string): HTMLDivElement {
  const el = parent.ownerDocument.createElement('div');
  el.className = className;
  if (text !== undefined) el.textContent = text;
  parent.appendChild(el);
  return el;
}

function appendSpan(parent: HTMLElement, className: string, text?: string): HTMLSpanElement {
  const el = parent.ownerDocument.createElement('span');
  el.className = className;
  if (text !== undefined) el.textContent = text;
  parent.appendChild(el);
  return el;
}

async function renderMarkdown(
  target: HTMLElement,
  markdown: string,
  context: ReaderChatTimelineRenderContext,
): Promise<void> {
  await MarkdownRenderer.render(
    context.app,
    markdown,
    target,
    context.sourcePath ?? '',
    context.component,
  );
}

export async function renderReaderChatTimelineSection(
  container: HTMLElement,
  readerChat: ReaderChatSection | undefined,
  context: ReaderChatTimelineRenderContext,
): Promise<HTMLElement | null> {
  if (!readerChat) return null;

  const bodyMarkdown = stripReaderChatTimelineHeading(readerChat.section);
  if (!bodyMarkdown) return null;

  const section = appendDiv(container, 'pcr-reader-chat');
  section.setAttribute('aria-label', 'AI chat transcript');

  const header = appendDiv(section, 'pcr-reader-chat-header');
  appendSpan(header, 'pcr-reader-chat-icon', 'AI');

  const textWrap = appendDiv(header, 'pcr-reader-chat-header-text');
  appendDiv(textWrap, 'pcr-reader-chat-title', 'AI Chat');

  const meta = formatReaderChatTimelineMeta(readerChat.headingLine);
  if (meta) {
    appendDiv(textWrap, 'pcr-reader-chat-meta', meta);
  }

  const body = appendDiv(section, 'pcr-reader-chat-body');
  const turns = parseReaderChatTimelineTurns(bodyMarkdown);

  if (turns.length === 0) {
    const rawBody = appendDiv(body, 'pcr-reader-chat-raw post-body-text');
    await renderMarkdown(rawBody, bodyMarkdown, context);
    return section;
  }

  for (const turn of turns) {
    const turnEl = appendDiv(body, 'pcr-reader-chat-turn');
    const userMessage = appendDiv(
      turnEl,
      'pcr-reader-chat-message pcr-reader-chat-message-user',
    );
    appendDiv(userMessage, 'pcr-reader-chat-message-label', 'You');
    appendDiv(userMessage, 'pcr-reader-chat-message-text', turn.question);

    if (turn.answerMarkdown) {
      const assistantMessage = appendDiv(
        turnEl,
        'pcr-reader-chat-message pcr-reader-chat-message-assistant',
      );
      appendDiv(assistantMessage, 'pcr-reader-chat-message-label', 'AI');
      const answerBody = appendDiv(assistantMessage, 'pcr-reader-chat-answer post-body-text');
      await renderMarkdown(answerBody, turn.answerMarkdown, context);
    }
  }

  return section;
}
