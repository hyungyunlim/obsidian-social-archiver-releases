import { describe, expect, it } from 'vitest';
import {
  extractTrailingReaderChatSection,
  stripTrailingReaderChatSection,
} from '@/utils/reader-chat-section';

const SECTION =
  '## AI Chat — Claude Code (2026-07-04)\n\n' +
  '> [!question] 핵심 주장은?\n\n' +
  '핵심 주장은 **A**입니다.';

describe('extractTrailingReaderChatSection', () => {
  it('extracts the trailing section appended after an article body', () => {
    const markdown = `Intro paragraph.\n\nBody text.\n\n${SECTION}\n`;
    const result = extractTrailingReaderChatSection(markdown);
    expect(result?.headingLine).toBe('## AI Chat — Claude Code (2026-07-04)');
    expect(result?.section).toBe(SECTION);
  });

  it('extracts a markdown body that IS only the section (text-only posts)', () => {
    const result = extractTrailingReaderChatSection(`${SECTION}\n`);
    expect(result?.section).toBe(SECTION);
  });

  it('supports model-labeled headings', () => {
    const markdown = `body\n\n## AI Chat — Claude Code · sonnet (2026-07-04)\n\n> [!question] q\n\na`;
    const result = extractTrailingReaderChatSection(markdown);
    expect(result?.headingLine).toBe('## AI Chat — Claude Code · sonnet (2026-07-04)');
  });

  it('matches the LAST heading when the article itself mentions one earlier', () => {
    const markdown =
      `The post shows a note ending in "## AI Chat — Fake (2026-01-01)" as an example.\n\n` +
      `## AI Chat — Fake (2026-01-01)\n\nquoted example\n\n${SECTION}`;
    const result = extractTrailingReaderChatSection(markdown);
    expect(result?.headingLine).toBe('## AI Chat — Claude Code (2026-07-04)');
    expect(result?.section).toBe(SECTION);
  });

  it('rejects look-alike headings without the date suffix', () => {
    expect(
      extractTrailingReaderChatSection('body\n\n## AI Chat — coming soon\n\ntext'),
    ).toBeNull();
  });

  it('returns null for absent / non-string / section-free markdown', () => {
    expect(extractTrailingReaderChatSection(undefined)).toBeNull();
    expect(extractTrailingReaderChatSection(42)).toBeNull();
    expect(extractTrailingReaderChatSection('plain body, no chat')).toBeNull();
  });
});

describe('stripTrailingReaderChatSection', () => {
  it('removes the trailing section and trims the remaining body', () => {
    const body = 'Intro paragraph.\n\nBody text.';
    expect(stripTrailingReaderChatSection(`${body}\n\n${SECTION}\n`)).toBe(body);
  });

  it('collapses to empty string when the body IS only the section', () => {
    expect(stripTrailingReaderChatSection(`${SECTION}\n`)).toBe('');
  });

  it('strips only the LAST section when an article quotes an earlier one', () => {
    const markdown =
      `Body mentioning "## AI Chat — Fake (2026-01-01)".\n\n` +
      `## AI Chat — Fake (2026-01-01)\n\nquoted example\n\n${SECTION}`;
    // The trailing real section is removed; the earlier look-alike stays in the body.
    expect(stripTrailingReaderChatSection(markdown)).toBe(
      `Body mentioning "## AI Chat — Fake (2026-01-01)".\n\n` +
        `## AI Chat — Fake (2026-01-01)\n\nquoted example`,
    );
  });

  it('leaves markup-bearing bodies (==highlights==) intact', () => {
    const body = 'A ==highlighted== claim and a code fence.\n\n```js\nconst a = 1;\n```';
    expect(stripTrailingReaderChatSection(`${body}\n\n${SECTION}`)).toBe(body);
  });

  it('returns the input unchanged when there is no section', () => {
    expect(stripTrailingReaderChatSection('plain body, no chat')).toBe('plain body, no chat');
  });

  it('leaves look-alike headings (no date suffix) in place', () => {
    const markdown = 'body\n\n## AI Chat — coming soon\n\ntext';
    expect(stripTrailingReaderChatSection(markdown)).toBe(markdown);
  });
});
