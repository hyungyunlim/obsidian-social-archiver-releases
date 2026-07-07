import { beforeEach, describe, expect, it, vi } from 'vitest';
import rendererSource from '@/components/timeline/renderers/ReaderChatSectionRenderer.ts?raw';
import {
  formatReaderChatTimelineMeta,
  parseReaderChatTimelineTurns,
  renderReaderChatTimelineSection,
  stripReaderChatTimelineHeading,
} from '@/components/timeline/renderers/ReaderChatSectionRenderer';
import type { ReaderChatSection } from '@/utils/reader-chat-section';

const markdownRenderSpy = vi.hoisted(() =>
  vi.fn(async (
    _app: unknown,
    markdown: string,
    el: HTMLElement,
  ): Promise<void> => {
    const rendered = document.createElement('div');
    rendered.className = 'mocked-reader-chat-markdown';
    rendered.textContent = markdown;
    el.appendChild(rendered);
  }),
);

vi.mock('obsidian', () => ({
  MarkdownRenderer: { render: markdownRenderSpy },
}));

describe('ReaderChatSectionRenderer', () => {
  beforeEach(() => {
    markdownRenderSpy.mockClear();
  });

  const readerChat: ReaderChatSection = {
    headingLine: '## AI Chat — Claude Code · sonnet (2026-07-04)',
    section:
      '## AI Chat — Claude Code · sonnet (2026-07-04)\n\n' +
      '> [!question] What should I remember?\n\n' +
      'The article argues for durable notes.',
  };

  it('formats the saved reader chat heading as compact timeline metadata', () => {
    expect(formatReaderChatTimelineMeta(readerChat.headingLine)).toBe(
      'Claude Code · sonnet · 2026-07-04',
    );
  });

  it('removes the markdown heading before rendering the timeline body', () => {
    expect(stripReaderChatTimelineHeading(readerChat.section)).toBe(
      '> [!question] What should I remember?\n\nThe article argues for durable notes.',
    );
  });

  it('parses repeated question callouts into ordered chat turns', () => {
    const transcript =
      '> [!question] First question?\n\n' +
      'First answer.\n\n' +
      '> [!question] Second question\n' +
      '> with more context\n\n' +
      'Second answer line 1.\n' +
      'Second answer line 2.';

    expect(parseReaderChatTimelineTurns(transcript)).toEqual([
      {
        question: 'First question?',
        answerMarkdown: 'First answer.',
      },
      {
        question: 'Second question\nwith more context',
        answerMarkdown: 'Second answer line 1.\nSecond answer line 2.',
      },
    ]);
  });

  it('renders AI chat as user and assistant message bubbles', async () => {
    const container = document.createElement('div');

    const section = await renderReaderChatTimelineSection(container, readerChat, {
      app: {},
      component: {},
      sourcePath: 'Social Archives/Web/2026/07/example.md',
    });

    expect(section).not.toBeNull();
    expect(section?.classList.contains('pcr-reader-chat')).toBe(true);
    expect(section?.querySelector('.pcr-reader-chat-title')?.textContent).toBe('AI Chat');
    expect(section?.querySelector('.pcr-reader-chat-meta')?.textContent).toBe(
      'Claude Code · sonnet · 2026-07-04',
    );
    expect(section?.querySelector('.pcr-reader-chat-message-user')?.textContent).toContain(
      'What should I remember?',
    );
    expect(section?.querySelector('.pcr-reader-chat-message-assistant')?.textContent).toContain(
      'The article argues for durable notes.',
    );
    expect(markdownRenderSpy).toHaveBeenCalledWith(
      {},
      'The article argues for durable notes.',
      section?.querySelector('.pcr-reader-chat-answer'),
      'Social Archives/Web/2026/07/example.md',
      {},
    );
    expect(section?.textContent).not.toContain('## AI Chat');
  });

  it('renders multiple archived questions as separate chat turns', async () => {
    const multiTurnChat: ReaderChatSection = {
      headingLine: readerChat.headingLine,
      section:
        '## AI Chat — Claude Code · sonnet (2026-07-04)\n\n' +
        '> [!question] First question?\n\n' +
        'First answer.\n\n' +
        '> [!question] Second question?\n\n' +
        'Second answer.',
    };
    const container = document.createElement('div');

    const section = await renderReaderChatTimelineSection(container, multiTurnChat, {
      app: {},
      component: {},
      sourcePath: 'Social Archives/Web/2026/07/example.md',
    });

    const userMessages = Array.from(
      section?.querySelectorAll('.pcr-reader-chat-message-user') ?? [],
    );
    const assistantMessages = Array.from(
      section?.querySelectorAll('.pcr-reader-chat-message-assistant') ?? [],
    );

    expect(userMessages).toHaveLength(2);
    expect(assistantMessages).toHaveLength(2);
    expect(userMessages[0]?.textContent).toContain('First question?');
    expect(userMessages[1]?.textContent).toContain('Second question?');
    expect(assistantMessages[0]?.textContent).toContain('First answer.');
    expect(assistantMessages[1]?.textContent).toContain('Second answer.');
    expect(markdownRenderSpy).toHaveBeenCalledTimes(2);
  });

  it('falls back to a single markdown body when no question callout exists', async () => {
    const plainChat: ReaderChatSection = {
      headingLine: readerChat.headingLine,
      section:
        '## AI Chat — Claude Code · sonnet (2026-07-04)\n\n' +
        'Legacy chat transcript without callouts.',
    };
    const container = document.createElement('div');

    const section = await renderReaderChatTimelineSection(container, plainChat, {
      app: {},
      component: {},
    });

    expect(section?.querySelector('.pcr-reader-chat-raw')).not.toBeNull();
    expect(section?.querySelector('.pcr-reader-chat-message')).toBeNull();
    expect(markdownRenderSpy).toHaveBeenCalledWith(
      {},
      'Legacy chat transcript without callouts.',
      section?.querySelector('.pcr-reader-chat-raw'),
      '',
      {},
    );
  });

  it('uses a bundle-safe static Obsidian import', () => {
    expect(rendererSource).not.toContain("import('obsidian')");
    expect(rendererSource).not.toContain('import("obsidian")');
  });
});
