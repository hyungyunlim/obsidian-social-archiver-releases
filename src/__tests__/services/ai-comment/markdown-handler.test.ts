/**
 * Tests for AI Comment Markdown Handler
 */

import { describe, it, expect } from 'vitest';
import {
  parseAIComments,
  appendAIComment,
  removeAIComment,
  formatCommentHeader,
  hasAICommentSection,
  countAIComments,
  hasComment,
} from '../../../services/ai-comment/markdown-handler';
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
