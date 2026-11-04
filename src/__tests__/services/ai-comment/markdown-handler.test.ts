/**
 * Tests for AI Comment Markdown Handler
 */

import { describe, it, expect } from 'vitest';
import {
  parseAIComments,
  appendAIComment,
  removeAIComment,
  removeAICommentSection,
  replaceAICommentSection,
  formatCommentHeader,
  hasAICommentSection,
  countAIComments,
  hasComment,
  readFrontmatterAIComments,
} from '../../../services/ai-comment/markdown-handler';
import { formatChatTranscript } from '../../../vendor/byok-ai-core';
import type { AICommentMeta } from '../../../types/ai-comment';

// ============================================================================
// Test Data
// ============================================================================

const createMockMeta = (overrides: Partial<AICommentMeta> = {}): AICommentMeta => ({
  id: 'claude-summary-20241214T103000Z',
  cli: 'claude',
  type: 'summary',
  generatedAt: '2024-12-14T10:30:00.000Z',
  processingTime: 1500,
  contentHash: 'abc12345',
  ...overrides,
});

const SAMPLE_MARKDOWN_WITH_COMMENTS = `# Test Post

Some content here.

## AI Comments

### 🤖 Claude · Summary · Dec 14, 2024
<!-- id: claude-summary-20241214T103000Z -->

This is a summary of the post content.

### ✨ Gemini · Fact Check · Dec 13, 2024
<!-- id: gemini-factcheck-20241213T150000Z -->

The facts appear to be accurate.
`;

const SAMPLE_MARKDOWN_NO_COMMENTS = `# Test Post

Some content here.

Footer content.
`;

const SAMPLE_MARKDOWN_SINGLE_COMMENT = `# Test Post

Content here.

## AI Comments

### 🤖 Claude · Summary · Dec 14, 2024
<!-- id: claude-summary-20241214T103000Z -->

This is the only comment.
`;

// ============================================================================
// parseAIComments Tests
// ============================================================================

describe('parseAIComments', () => {
  it('should parse multiple comments from markdown', () => {
    const result = parseAIComments(SAMPLE_MARKDOWN_WITH_COMMENTS);

    expect(result.comments).toHaveLength(2);
    expect(result.commentTexts.size).toBe(2);
  });

  it('should extract correct metadata from first comment', () => {
    const result = parseAIComments(SAMPLE_MARKDOWN_WITH_COMMENTS);
    const firstComment = result.comments[0];

    expect(firstComment).toBeDefined();
    expect(firstComment?.cli).toBe('claude');
    expect(firstComment?.type).toBe('summary');
    expect(firstComment?.id).toBe('claude-summary-20241214T103000Z');
  });

  it('should extract correct metadata from second comment', () => {
    const result = parseAIComments(SAMPLE_MARKDOWN_WITH_COMMENTS);
    const secondComment = result.comments[1];

    expect(secondComment).toBeDefined();
    expect(secondComment?.cli).toBe('gemini');
    expect(secondComment?.type).toBe('factcheck');
  });

  it('should extract comment text content', () => {
    const result = parseAIComments(SAMPLE_MARKDOWN_WITH_COMMENTS);

    const firstText = result.commentTexts.get('claude-summary-20241214T103000Z');
    expect(firstText).toBe('This is a summary of the post content.');

    const secondText = result.commentTexts.get('gemini-factcheck-20241213T150000Z');
    expect(secondText).toBe('The facts appear to be accurate.');
  });

  it('should preserve hidden model metadata', () => {
    const meta = createMockMeta({ model: 'gpt-5.4-mini' });
    const markdown = appendAIComment(SAMPLE_MARKDOWN_NO_COMMENTS, meta, 'Model-specific output');
    const result = parseAIComments(markdown);

    expect(result.comments[0]?.model).toBe('gpt-5.4-mini');
    expect(result.comments[0]?.processingTime).toBe(1500);
    expect(result.comments[0]?.contentHash).toBe('abc12345');
    expect(result.commentTexts.get(meta.id)).toBe('Model-specific output');
  });

  it('round-trips an Apple on-device comment synced from the desktop app', () => {
    const meta = createMockMeta({ id: 'apple-summary-20260915T120000Z', cli: 'apple', model: 'system' });
    const markdown = appendAIComment(SAMPLE_MARKDOWN_NO_COMMENTS, meta, 'On-device summary');
    expect(markdown).toContain('### 🍎 Apple Intelligence · ');

    const result = parseAIComments(markdown);
    // Before the provider was known here, this parsed as 'claude'.
    expect(result.comments[0]?.cli).toBe('apple');
    expect(result.comments[0]?.model).toBe('system');
    expect(result.commentTexts.get(meta.id)).toBe('On-device summary');
  });

  it('should parse cloud AI comments rendered with model provider labels', () => {
    const meta = createMockMeta({
      id: 'ai-action-comment-job-1',
      cli: 'workers-ai',
      model: '@cf/zai-org/glm-4.7-flash',
    });
    const markdown = appendAIComment(SAMPLE_MARKDOWN_NO_COMMENTS, meta, 'Cloud summary output');
    const result = parseAIComments(markdown);

    expect(markdown).toContain('GLM 4.7 Flash');
    expect(result.comments[0]?.cli).toBe('workers-ai');
    expect(result.comments[0]?.model).toBe('@cf/zai-org/glm-4.7-flash');
    expect(result.commentTexts.get(meta.id)).toBe('Cloud summary output');
  });

  it('should display old cloud AI comments by model even when the stored provider is Claude', () => {
    const meta = createMockMeta({
      id: 'ai-action-comment-job-legacy',
      cli: 'claude',
      model: '@cf/zai-org/glm-4.7-flash',
    });
    const header = formatCommentHeader(meta);

    expect(header).toContain('GLM 4.7 Flash');
    expect(header).not.toContain('Claude');
  });

  it('should return empty results when no section exists', () => {
    const result = parseAIComments(SAMPLE_MARKDOWN_NO_COMMENTS);

    expect(result.comments).toHaveLength(0);
    expect(result.commentTexts.size).toBe(0);
  });

  it('should handle single comment', () => {
    const result = parseAIComments(SAMPLE_MARKDOWN_SINGLE_COMMENT);

    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]?.cli).toBe('claude');
    expect(result.commentTexts.get('claude-summary-20241214T103000Z')).toBe(
      'This is the only comment.'
    );
  });

  it('should handle empty section', () => {
    const markdown = `# Test

## AI Comments
`;
    const result = parseAIComments(markdown);

    expect(result.comments).toHaveLength(0);
  });

  it('should handle section with no valid comments', () => {
    // Section exists but no valid AI comment headers
    const markdown = `# Test

## AI Comments

Just some regular text without AI comment headers.
`;
    const result = parseAIComments(markdown);

    expect(result.comments).toHaveLength(0);
  });

  it('should parse all supported CLI types', () => {
    const markdown = `
## AI Comments

### 🤖 Claude · Summary · Dec 14, 2024
<!-- id: claude-summary-20241214T100000Z -->

Claude comment

### ✨ Gemini · Summary · Dec 14, 2024
<!-- id: gemini-summary-20241214T100000Z -->

Gemini comment

### 💡 Codex · Summary · Dec 14, 2024
<!-- id: codex-summary-20241214T100000Z -->

Codex comment
`;
    const result = parseAIComments(markdown);

    expect(result.comments).toHaveLength(3);
    expect(result.comments[0]?.cli).toBe('claude');
    expect(result.comments[1]?.cli).toBe('gemini');
    expect(result.comments[2]?.cli).toBe('codex');
  });

  it('should parse all supported comment types', () => {
    const types = [
      { type: 'summary', display: 'Summary' },
      { type: 'factcheck', display: 'Fact Check' },
      { type: 'critique', display: 'Critical Analysis' },
      { type: 'keypoints', display: 'Key Points' },
      { type: 'sentiment', display: 'Sentiment Analysis' },
      { type: 'connections', display: 'Note Connections' },
      { type: 'translation', display: 'Translation' },
      { type: 'custom', display: 'Custom Prompt' },
    ];

    for (const { type, display } of types) {
      const markdown = `
## AI Comments

### 🤖 Claude · ${display} · Dec 14, 2024
<!-- id: claude-${type}-20241214T100000Z -->

Test content
`;
      const result = parseAIComments(markdown);
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0]?.type).toBe(type);
    }
  });
});

// ============================================================================
// formatCommentHeader Tests
// ============================================================================

describe('formatCommentHeader', () => {
  it('should format Claude header correctly', () => {
    const meta = createMockMeta({ cli: 'claude', type: 'summary' });
    const header = formatCommentHeader(meta);

    expect(header).toContain('🤖');
    expect(header).toContain('Claude');
    expect(header).toContain('Summary');
    expect(header).toContain('·');
  });

  it('should format Gemini header correctly', () => {
    const meta = createMockMeta({ cli: 'gemini', type: 'factcheck' });
    const header = formatCommentHeader(meta);

    expect(header).toContain('✨');
    expect(header).toContain('Gemini');
    expect(header).toContain('Fact Check');
  });

  it('should format Codex header correctly', () => {
    const meta = createMockMeta({ cli: 'codex', type: 'critique' });
    const header = formatCommentHeader(meta);

    expect(header).toContain('💡');
    expect(header).toContain('Codex');
    expect(header).toContain('Critical Analysis');
  });

  it('should format Workers AI headers by concrete model', () => {
    const meta = createMockMeta({
      cli: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      type: 'glossary',
    });
    const header = formatCommentHeader(meta);

    expect(header).toContain('☁️');
    expect(header).toContain('Kimi K2.6');
    expect(header).toContain('Glossary');
  });

  it('should format date correctly', () => {
    const meta = createMockMeta({ generatedAt: '2024-12-14T10:30:00.000Z' });
    const header = formatCommentHeader(meta);

    // Should contain month, day, and year
    expect(header).toMatch(/Dec.*14.*2024/);
  });

  it('should include all required parts', () => {
    const meta = createMockMeta();
    const header = formatCommentHeader(meta);

    // Should have format: {icon} {CLI} · {Type} · {date}
    const parts = header.split(' · ');
    expect(parts.length).toBe(3);
  });
});

// ============================================================================
// appendAIComment Tests
// ============================================================================

describe('appendAIComment', () => {
  it('should create section when none exists', () => {
    const meta = createMockMeta();
    const result = appendAIComment(SAMPLE_MARKDOWN_NO_COMMENTS, meta, 'New comment text');

    expect(result).toContain('## AI Comments');
    expect(result).toContain('New comment text');
    expect(result).toContain(`<!-- id: ${meta.id} -->`);
  });

  it('should append to existing section', () => {
    const meta = createMockMeta({
      id: 'codex-keypoints-20241215T120000Z',
      cli: 'codex',
      type: 'keypoints',
      generatedAt: '2024-12-15T12:00:00.000Z',
    });
    const result = appendAIComment(SAMPLE_MARKDOWN_WITH_COMMENTS, meta, 'Key points here');

    // Original comments should still exist
    expect(result).toContain('claude-summary-20241214T103000Z');
    expect(result).toContain('gemini-factcheck-20241213T150000Z');

    // New comment should be added
    expect(result).toContain('codex-keypoints-20241215T120000Z');
    expect(result).toContain('Key points here');
    expect(result).toContain('💡');
  });

  it('should append new comment at the end', () => {
    const meta = createMockMeta({ id: 'new-comment-id' });
    const result = appendAIComment(SAMPLE_MARKDOWN_WITH_COMMENTS, meta, 'New content');

    // New comment should appear after existing comments
    const newCommentIndex = result.indexOf('new-comment-id');
    const lastExistingCommentIndex = result.indexOf('gemini-factcheck-20241213T150000Z');

    expect(newCommentIndex).toBeGreaterThan(lastExistingCommentIndex);
  });

  it('should preserve content before section', () => {
    const meta = createMockMeta();
    const result = appendAIComment(SAMPLE_MARKDOWN_WITH_COMMENTS, meta, 'New comment');

    expect(result).toContain('# Test Post');
    expect(result).toContain('Some content here.');
  });

  it('should handle empty markdown', () => {
    const meta = createMockMeta();
    const result = appendAIComment('', meta, 'First comment');

    expect(result).toContain('## AI Comments');
    expect(result).toContain('First comment');
    expect(result).toContain(`<!-- id: ${meta.id} -->`);
  });

  it('should properly format the comment with header and ID', () => {
    const meta = createMockMeta();
    const result = appendAIComment(SAMPLE_MARKDOWN_NO_COMMENTS, meta, 'Test content');

    // Should contain proper header format
    expect(result).toContain('### 🤖 Claude · Summary');
    // Should contain ID comment
    expect(result).toContain(`<!-- id: ${meta.id} -->`);
    // Should contain content
    expect(result).toContain('Test content');
  });
});

// ============================================================================
// removeAIComment Tests
// ============================================================================

describe('removeAIComment', () => {
  it('should remove specific comment by id', () => {
    const result = removeAIComment(
      SAMPLE_MARKDOWN_WITH_COMMENTS,
      'claude-summary-20241214T103000Z'
    );

    expect(result).not.toContain('claude-summary-20241214T103000Z');
    expect(result).toContain('gemini-factcheck-20241213T150000Z');
  });

  it('should keep section when other comments remain', () => {
    const result = removeAIComment(
      SAMPLE_MARKDOWN_WITH_COMMENTS,
      'claude-summary-20241214T103000Z'
    );

    expect(result).toContain('## AI Comments');
    expect(result).toContain('gemini-factcheck-20241213T150000Z');
  });

  it('should remove entire section when last comment is removed', () => {
    const result = removeAIComment(
      SAMPLE_MARKDOWN_SINGLE_COMMENT,
      'claude-summary-20241214T103000Z'
    );

    expect(result).not.toContain('## AI Comments');
    expect(result).not.toContain('claude-summary-20241214T103000Z');
  });

  it('should preserve content before section', () => {
    const result = removeAIComment(
      SAMPLE_MARKDOWN_SINGLE_COMMENT,
      'claude-summary-20241214T103000Z'
    );

    expect(result).toContain('# Test Post');
    expect(result).toContain('Content here.');
  });

  it('should preserve section structure if comment not found', () => {
    const result = removeAIComment(SAMPLE_MARKDOWN_WITH_COMMENTS, 'non-existent-id');

    // Section should still exist with all comments
    expect(result).toContain('## AI Comments');
    expect(result).toContain('claude-summary-20241214T103000Z');
    expect(result).toContain('gemini-factcheck-20241213T150000Z');
  });

  it('should return unchanged markdown if no section exists', () => {
    const result = removeAIComment(SAMPLE_MARKDOWN_NO_COMMENTS, 'any-id');

    expect(result).toBe(SAMPLE_MARKDOWN_NO_COMMENTS);
  });

  it('should handle removing second comment', () => {
    const result = removeAIComment(
      SAMPLE_MARKDOWN_WITH_COMMENTS,
      'gemini-factcheck-20241213T150000Z'
    );

    expect(result).toContain('claude-summary-20241214T103000Z');
    expect(result).not.toContain('gemini-factcheck-20241213T150000Z');
    expect(result).not.toContain('Gemini');
  });
});

describe('removeAICommentSection', () => {
  it('should remove the entire AI comment section', () => {
    const result = removeAICommentSection(SAMPLE_MARKDOWN_WITH_COMMENTS);

    expect(result).toContain('# Test Post');
    expect(result).toContain('Some content here.');
    expect(result).not.toContain('## AI Comments');
    expect(result).not.toContain('claude-summary-20241214T103000Z');
    expect(result).not.toContain('gemini-factcheck-20241213T150000Z');
  });

  it('should return unchanged markdown when no AI comment section exists', () => {
    expect(removeAICommentSection(SAMPLE_MARKDOWN_NO_COMMENTS)).toBe(SAMPLE_MARKDOWN_NO_COMMENTS);
  });
});

describe('replaceAICommentSection', () => {
  it('should replace the section with the provided snapshot', () => {
    const meta = createMockMeta({
      id: 'codex-factcheck-20241215T120000Z',
      cli: 'codex',
      model: 'gpt-5.4-mini',
      type: 'factcheck',
      generatedAt: '2024-12-15T12:00:00.000Z',
    });

    const result = replaceAICommentSection(SAMPLE_MARKDOWN_WITH_COMMENTS, [
      { meta, content: 'Only the server snapshot remains.' },
    ]);
    const parsed = parseAIComments(result);

    expect(result).toContain('# Test Post');
    expect(result).not.toContain('claude-summary-20241214T103000Z');
    expect(parsed.comments).toHaveLength(1);
    expect(parsed.comments[0]?.id).toBe(meta.id);
    expect(parsed.comments[0]?.model).toBe('gpt-5.4-mini');
    expect(parsed.commentTexts.get(meta.id)).toBe('Only the server snapshot remains.');
  });

  it('should remove the section for an empty snapshot', () => {
    const result = replaceAICommentSection(SAMPLE_MARKDOWN_WITH_COMMENTS, []);

    expect(result).toContain('# Test Post');
    expect(result).not.toContain('## AI Comments');
  });

  it('should preserve the managed mobile annotations block after AI comments', () => {
    const markdown = `${SAMPLE_MARKDOWN_WITH_COMMENTS}
<!-- social-archiver:annotations:start -->
## Mobile Annotations

- Note
<!-- social-archiver:annotations:end -->`;
    const meta = createMockMeta({ id: 'claude-summary-new' });
    const result = replaceAICommentSection(markdown, [{ meta, content: 'Updated summary.' }]);

    expect(result).toContain('claude-summary-new');
    expect(result).not.toContain('gemini-factcheck-20241213T150000Z');
    expect(result).toContain('<!-- social-archiver:annotations:start -->');
    expect(result).toContain('## Mobile Annotations');
  });
});

// ============================================================================
// Utility Functions Tests
// ============================================================================

describe('hasAICommentSection', () => {
  it('should return true when section exists', () => {
    expect(hasAICommentSection(SAMPLE_MARKDOWN_WITH_COMMENTS)).toBe(true);
    expect(hasAICommentSection(SAMPLE_MARKDOWN_SINGLE_COMMENT)).toBe(true);
  });

  it('should return false when section does not exist', () => {
    expect(hasAICommentSection(SAMPLE_MARKDOWN_NO_COMMENTS)).toBe(false);
    expect(hasAICommentSection('')).toBe(false);
  });

  it('should return true when section title exists', () => {
    expect(hasAICommentSection(`Content\n\n## AI Comments\n\nSome comment`)).toBe(true);
  });
});

describe('countAIComments', () => {
  it('should count comments correctly', () => {
    expect(countAIComments(SAMPLE_MARKDOWN_WITH_COMMENTS)).toBe(2);
    expect(countAIComments(SAMPLE_MARKDOWN_SINGLE_COMMENT)).toBe(1);
    expect(countAIComments(SAMPLE_MARKDOWN_NO_COMMENTS)).toBe(0);
  });
});

describe('hasComment', () => {
  it('should return true for existing comment', () => {
    expect(hasComment(SAMPLE_MARKDOWN_WITH_COMMENTS, 'claude-summary-20241214T103000Z')).toBe(
      true
    );
    expect(hasComment(SAMPLE_MARKDOWN_WITH_COMMENTS, 'gemini-factcheck-20241213T150000Z')).toBe(
      true
    );
  });

  it('should return false for non-existing comment', () => {
    expect(hasComment(SAMPLE_MARKDOWN_WITH_COMMENTS, 'non-existent-id')).toBe(false);
    expect(hasComment(SAMPLE_MARKDOWN_NO_COMMENTS, 'claude-summary-20241214T103000Z')).toBe(
      false
    );
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('should handle markdown with special characters in comment text', () => {
    const markdown = `
## AI Comments

### 🤖 Claude · Summary · Dec 14, 2024
<!-- id: test-id -->

Content with **bold**, _italic_, and \`code\`.
Also includes:
- List item 1
- List item 2
`;
    const result = parseAIComments(markdown);

    expect(result.comments).toHaveLength(1);
    const text = result.commentTexts.get('test-id');
    expect(text).toContain('**bold**');
    expect(text).toContain('_italic_');
    expect(text).toContain('`code`');
  });

  it('should handle multiline comment text', () => {
    const markdown = `
## AI Comments

### 🤖 Claude · Summary · Dec 14, 2024
<!-- id: multiline-test -->

Line 1
Line 2
Line 3

Paragraph 2
`;
    const result = parseAIComments(markdown);
    const text = result.commentTexts.get('multiline-test');

    expect(text).toContain('Line 1');
    expect(text).toContain('Line 2');
    expect(text).toContain('Paragraph 2');
  });

  it('should roundtrip: parse and regenerate should be consistent', () => {
    const meta1 = createMockMeta({
      id: 'claude-summary-20241214T100000Z',
      cli: 'claude',
      type: 'summary',
      generatedAt: '2024-12-14T10:00:00.000Z',
    });
    const text1 = 'This is the first comment.';

    // Add first comment
    let markdown = appendAIComment('# Test', meta1, text1);

    // Parse to verify
    let parsed = parseAIComments(markdown);
    expect(parsed.comments).toHaveLength(1);
    expect(parsed.commentTexts.get(meta1.id)).toBe(text1);

    // Add second comment
    const meta2 = createMockMeta({
      id: 'gemini-factcheck-20241214T110000Z',
      cli: 'gemini',
      type: 'factcheck',
      generatedAt: '2024-12-14T11:00:00.000Z',
    });
    const text2 = 'This is the second comment.';
    markdown = appendAIComment(markdown, meta2, text2);

    // Parse to verify both
    parsed = parseAIComments(markdown);
    expect(parsed.comments).toHaveLength(2);
    expect(parsed.commentTexts.get(meta1.id)).toBe(text1);
    expect(parsed.commentTexts.get(meta2.id)).toBe(text2);

    // Remove first comment
    markdown = removeAIComment(markdown, meta1.id);

    // Verify only second remains
    parsed = parseAIComments(markdown);
    expect(parsed.comments).toHaveLength(1);
    expect(parsed.comments[0]?.id).toBe(meta2.id);
    expect(parsed.commentTexts.get(meta2.id)).toBe(text2);
  });

  it('should handle unicode in comment text', () => {
    const meta = createMockMeta({ id: 'unicode-test' });
    const unicodeText = '한글 테스트 🎉 日本語 العربية';

    const markdown = appendAIComment('# Test', meta, unicodeText);
    const parsed = parseAIComments(markdown);

    expect(parsed.commentTexts.get('unicode-test')).toBe(unicodeText);
  });

  it('should handle very long comment text', () => {
    const meta = createMockMeta({ id: 'long-text' });
    const longText = 'A'.repeat(10000);

    const markdown = appendAIComment('# Test', meta, longText);
    const parsed = parseAIComments(markdown);

    expect(parsed.commentTexts.get('long-text')).toBe(longText);
  });
});

describe('BYOK providers and chat/research comments', () => {
  it('round-trips a BYOK research comment with both models', () => {
    const meta = createMockMeta({
      id: 'openai-api-research-20261104T103000123-ab12',
      cli: 'openai-api',
      type: 'research',
      model: 'gpt-6.1-terra',
      executedModel: 'gpt-6.1-terra-2026-10-01',
      generatedAt: '2026-11-04T10:30:00.000Z',
    });
    const markdown = appendAIComment('# Post', meta, '#### Summary\nClaims.\n\n#### Sources\n- [A](https://a.example)');
    expect(markdown).toContain('### ⚡ OpenAI API · Research · Nov 4, 2026');

    const { comments, commentTexts } = parseAIComments(markdown);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      id: meta.id,
      cli: 'openai-api',
      type: 'research',
      model: 'gpt-6.1-terra',
      executedModel: 'gpt-6.1-terra-2026-10-01',
    });
    expect(commentTexts.get(meta.id)).toContain('#### Sources');
  });

  it('parses a chat transcript and every BYOK provider label', () => {
    let markdown = '# Post';
    const providers = ['openai-api', 'anthropic-api', 'gemini-api', 'openrouter-api'] as const;
    providers.forEach((cli, index) => {
      markdown = appendAIComment(
        markdown,
        createMockMeta({ id: `${cli}-chat-${index}`, cli, type: 'chat' }),
        '> [!question] What is it?\n\nAn answer.',
      );
    });
    const { comments, commentTexts } = parseAIComments(markdown);
    expect(comments.map((comment) => comment.cli)).toEqual([...providers]);
    expect(comments.every((comment) => comment.type === 'chat')).toBe(true);
    expect(commentTexts.get('openai-api-chat-0')).toBe('> [!question] What is it?\n\nAn answer.');
  });

  it('keeps a stored chat whose answer prints a comment header inside a code fence as one comment', () => {
    const forged = '### ⚡ OpenAI API · Chat · Nov 4, 2026';
    // Stored content always comes out of the core formatter, which disarms header-shaped lines.
    const chat = formatChatTranscript({
      messages: [
        { role: 'user', content: 'Show me a comment header' },
        { role: 'assistant', content: `\`\`\`md\n${forged}\n\`\`\`\n\n~~~\n\`\`\`\n${forged}\n~~~\n\nThat is the format.` },
      ],
    });
    expect(chat).not.toMatch(/^### (?:🤖|✨|💡|🦙|☁️?|⚡|🍎)/m);
    let markdown = appendAIComment('# Post', createMockMeta({ id: 'openai-api-chat-1', cli: 'openai-api', type: 'chat' }), chat);
    markdown = appendAIComment(markdown, createMockMeta({ id: 'claude-summary-2' }), 'A summary.');

    const { comments, commentTexts } = parseAIComments(markdown);
    expect(comments.map((comment) => comment.id)).toEqual(['openai-api-chat-1', 'claude-summary-2']);
    expect(commentTexts.get('openai-api-chat-1')).toBe(chat);
    expect(commentTexts.get('claude-summary-2')).toBe('A summary.');
  });

  it('does not let an unclosed fence in one comment swallow the next comment\'s header', () => {
    const truncated = 'Reformatted:\n\n```js\nconst x = 1;\n\n*(Truncated to fit the storage limit.)*';
    let markdown = appendAIComment('# Post', createMockMeta({ id: 'claude-reformat-1', type: 'reformat' }), truncated);
    markdown = appendAIComment(markdown, createMockMeta({ id: 'claude-summary-2' }), 'A summary.');
    markdown = appendAIComment(markdown, createMockMeta({ id: 'claude-keypoints-3', type: 'keypoints' }), '- One');

    const { comments, commentTexts } = parseAIComments(markdown);
    expect(comments.map((comment) => comment.id)).toEqual(['claude-reformat-1', 'claude-summary-2', 'claude-keypoints-3']);
    expect(commentTexts.get('claude-reformat-1')).toBe(truncated);
    expect(commentTexts.get('claude-summary-2')).toBe('A summary.');
  });

  it('parses notes with CRLF line endings', () => {
    let markdown = appendAIComment('# Post', createMockMeta({ id: 'claude-summary-1' }), 'First.');
    markdown = appendAIComment(markdown, createMockMeta({ id: 'openai-api-research-2', cli: 'openai-api', type: 'research' }), 'Second.');
    const { comments, commentTexts } = parseAIComments(markdown.replace(/\n/g, '\r\n'));
    expect(comments.map((comment) => [comment.id, comment.cli, comment.type])).toEqual([
      ['claude-summary-1', 'claude', 'summary'],
      ['openai-api-research-2', 'openai-api', 'research'],
    ]);
    expect(commentTexts.get('claude-summary-1')).toBe('First.');
  });

  it('keeps a header of a type this version does not know as a boundary', () => {
    const markdown = [
      '## AI Comments',
      '',
      '### 🤖 Claude · Summary · Dec 14, 2024',
      '<!-- id: claude-summary-1 -->',
      '',
      'The summary.',
      '',
      '---',
      '',
      '### ⚡ OpenAI API · Debate · Nov 4, 2026',
      '<!-- id: openai-api-debate-1 -->',
      '',
      'A future comment type.',
    ].join('\n');
    const { comments, commentTexts } = parseAIComments(markdown);
    expect(comments.map((comment) => comment.id)).toEqual(['claude-summary-1']);
    expect(commentTexts.get('claude-summary-1')).toBe('The summary.');
  });

  it('reads BYOK provider ids (which contain a dash) from frontmatter', () => {
    const app = {
      metadataCache: {
        getFileCache: () => ({
          frontmatter: { aiComments: ['openai-api-research-20261104T103000Z', 'claude-summary-20241214T103000Z'] },
        }),
      },
    };
    const comments = readFrontmatterAIComments(app as never, {} as never);
    expect(comments[0]).toMatchObject({ cli: 'openai-api', type: 'research', generatedAt: '2026-11-04T10:30:00.000Z' });
    expect(comments[1]).toMatchObject({ cli: 'claude', type: 'summary' });
  });
});
