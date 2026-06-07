/**
 * AI Comment Markdown Handler — Linked Archives bounding fix
 *
 * Regression coverage for `findAICommentSectionEnd`: the AI Comments section is
 * bounded by the FIRST managed-block start marker (Mobile Annotations OR Linked
 * Archives), else EOF. Without the linked-archives marker in the cutoff set, a
 * file with a `## Linked archives` block but NO annotations block would have the
 * linked-archives block swallowed by remove/replace of the AI Comments section.
 */

import { describe, it, expect } from 'vitest';
import {
  removeAICommentSection,
  replaceAICommentSection,
} from '../../../services/ai-comment/markdown-handler';
import type { AICommentMeta } from '../../../types/ai-comment';

const ANNOTATIONS_START = '<!-- social-archiver:annotations:start -->';
const ANNOTATIONS_END = '<!-- social-archiver:annotations:end -->';
const LINKED_START = '<!-- social-archiver:linked-archives:start -->';
const LINKED_END = '<!-- social-archiver:linked-archives:end -->';

const LINKED_BLOCK = `${LINKED_START}\n\n---\n\n## Linked archives\n\n**Links to**\n\n- [[Other|Title]]\n\n${LINKED_END}`;
const ANNOTATIONS_BLOCK = `${ANNOTATIONS_START}\n\n## Mobile Annotations\n\n> note\n\n${ANNOTATIONS_END}`;

const AI_SECTION = `## AI Comments

### 🤖 Claude · Summary · Dec 14, 2024
<!-- id: claude-summary-20241214T103000Z -->

A summary.`;

function makeMeta(): AICommentMeta {
  return {
    id: 'claude-summary-20241214T103000Z',
    cli: 'claude',
    type: 'summary',
    generatedAt: '2024-12-14T10:30:00.000Z',
    processingTime: 1500,
    contentHash: 'abc12345',
  };
}

describe('markdown-handler — linked archives bounding', () => {
  describe('removeAICommentSection', () => {
    it('preserves a trailing linked-archives block when NO annotations block exists', () => {
      const doc = `# Post\n\nBody.\n\n${AI_SECTION}\n\n${LINKED_BLOCK}`;
      const out = removeAICommentSection(doc);

      expect(out).not.toContain('## AI Comments');
      expect(out).toContain(LINKED_START);
      expect(out).toContain('## Linked archives');
      expect(out).toContain('- [[Other|Title]]');
      expect(out).toContain(LINKED_END);
      expect(out).toContain('Body.');
    });

    it('bounds at whichever managed marker comes first (linked-archives before annotations)', () => {
      const doc = `# Post\n\nBody.\n\n${AI_SECTION}\n\n${LINKED_BLOCK}\n\n${ANNOTATIONS_BLOCK}`;
      const out = removeAICommentSection(doc);

      expect(out).not.toContain('## AI Comments');
      // both blocks survive intact
      expect(out).toContain('## Linked archives');
      expect(out).toContain('## Mobile Annotations');
    });

    it('bounds at the annotations marker when it precedes linked-archives', () => {
      const doc = `# Post\n\nBody.\n\n${AI_SECTION}\n\n${ANNOTATIONS_BLOCK}\n\n${LINKED_BLOCK}`;
      const out = removeAICommentSection(doc);

      expect(out).not.toContain('## AI Comments');
      expect(out).toContain('## Mobile Annotations');
      expect(out).toContain('## Linked archives');
    });
  });

  describe('replaceAICommentSection', () => {
    it('does not swallow a trailing linked-archives block (no annotations block)', () => {
      const doc = `# Post\n\nBody.\n\n${AI_SECTION}\n\n${LINKED_BLOCK}`;
      const out = replaceAICommentSection(doc, [{ meta: makeMeta(), content: 'Updated summary.' }]);

      expect(out).toContain('## AI Comments');
      expect(out).toContain('Updated summary.');
      // linked-archives block survives the replace
      expect(out).toContain('## Linked archives');
      expect(out).toContain('- [[Other|Title]]');
      expect(out).toContain(LINKED_END);
    });

    it('removes the AI section but keeps linked-archives when entries are empty', () => {
      const doc = `# Post\n\nBody.\n\n${AI_SECTION}\n\n${LINKED_BLOCK}`;
      const out = replaceAICommentSection(doc, []);

      expect(out).not.toContain('## AI Comments');
      expect(out).toContain('## Linked archives');
      expect(out).toContain(LINKED_END);
    });
  });
});
