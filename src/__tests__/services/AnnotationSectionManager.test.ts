/**
 * AnnotationSectionManager — Unit Tests
 *
 * Tests the insert / replace / remove logic for the managed annotation block
 * in a markdown document string. No Obsidian API, no network calls.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AnnotationSectionManager } from '../../services/AnnotationSectionManager';

// ─── Constants ───────────────────────────────────────────

const START = '<!-- social-archiver:annotations:start -->';
const END = '<!-- social-archiver:annotations:end -->';

const FAKE_BLOCK = `${START}\n\n---\n\n## Mobile Annotations\n\n### Notes (1)\n\n> [!note]+ 2026-03-19 14:35\n> A note\n\n${END}`;
const FAKE_BLOCK_V2 = `${START}\n\n---\n\n## Mobile Annotations\n\n### Notes (2)\n\n> [!note]+ 2026-03-19 14:40\n> Updated note\n\n${END}`;

// ─── Tests ───────────────────────────────────────────────

describe('AnnotationSectionManager', () => {
  let manager: AnnotationSectionManager;

  beforeEach(() => {
    manager = new AnnotationSectionManager();
  });

  // ── Insert (no existing markers) ──

  describe('insert — no existing markers', () => {
    it('appends the block to an empty document', () => {
      const result = manager.upsert('', FAKE_BLOCK);
      expect(result).toContain(FAKE_BLOCK);
    });

    it('appends the block to a document without markers', () => {
      const doc = '---\nplatform: facebook\n---\n\nSome post content.';
      const result = manager.upsert(doc, FAKE_BLOCK);

      expect(result).toContain('Some post content.');
      expect(result).toContain(FAKE_BLOCK);
      // The original content must come first
      expect(result.indexOf('Some post content.')).toBeLessThan(result.indexOf(START));
    });

    it('preserves existing content exactly when appending', () => {
      const doc = '# Title\n\nBody text.';
      const result = manager.upsert(doc, FAKE_BLOCK);

      expect(result.startsWith('# Title\n\nBody text.')).toBe(true);
    });

    it('does nothing when block is empty string and no markers exist', () => {
      const doc = 'Some content without markers.';
      const result = manager.upsert(doc, '');

      expect(result).toBe(doc);
    });
  });

  // ── Replace (existing markers) ──

  describe('replace — existing markers', () => {
    it('replaces the old block with the new block', () => {
      const doc = `Some content.\n\n${FAKE_BLOCK}`;
      const result = manager.upsert(doc, FAKE_BLOCK_V2);

      expect(result).toContain('Some content.');
      expect(result).toContain(FAKE_BLOCK_V2);
      // Old block should not remain
      expect(result).not.toContain('### Notes (1)');
      expect(result).toContain('### Notes (2)');
    });

    it('preserves content before the markers exactly', () => {
      const before = '---\nplatform: x\n---\n\nPost body text.\n\n---\n\n**Metadata**';
      const doc = `${before}\n\n${FAKE_BLOCK}`;
      const result = manager.upsert(doc, FAKE_BLOCK_V2);

      expect(result).toContain(before);
    });

    it('preserves content after the markers exactly', () => {
      const after = '\n\nSome trailing content';
      const doc = `Content before.\n\n${FAKE_BLOCK}${after}`;
      const result = manager.upsert(doc, FAKE_BLOCK_V2);

      expect(result).toContain(FAKE_BLOCK_V2);
      expect(result).toContain('Some trailing content');
    });

    it('is idempotent when same block is inserted twice', () => {
      const doc = `Content before.\n\n${FAKE_BLOCK}`;
      const firstResult = manager.upsert(doc, FAKE_BLOCK);
      const secondResult = manager.upsert(firstResult, FAKE_BLOCK);

      expect(firstResult).toBe(secondResult);
    });

    it('replaces block embedded in a full note with frontmatter and body', () => {
      const frontmatter = '---\nplatform: linkedin\nauthor: Jane\n---\n';
      const body = '\nPost body content.\n\n---\n\n**Original URL:** https://example.com\n';
      const doc = frontmatter + body + '\n' + FAKE_BLOCK;
      const result = manager.upsert(doc, FAKE_BLOCK_V2);

      expect(result).toContain(frontmatter);
      expect(result).toContain('Post body content.');
      expect(result).toContain(FAKE_BLOCK_V2);
      expect(result).not.toContain('### Notes (1)');
    });
  });

  // ── Remove (empty block, existing markers) ──

  describe('remove — empty annotationBlock', () => {
    it('removes the managed block when annotationBlock is empty string', () => {
      const doc = `Content before.\n\n${FAKE_BLOCK}`;
      const result = manager.upsert(doc, '');

      expect(result).toContain('Content before.');
      expect(result).not.toContain(START);
      expect(result).not.toContain(END);
      expect(result).not.toContain('## Mobile Annotations');
    });

    it('preserves content before the block after removal', () => {
      const before = '---\nplatform: instagram\n---\n\nPhoto caption.';
      const doc = `${before}\n\n${FAKE_BLOCK}`;
      const result = manager.upsert(doc, '');

      expect(result).toContain(before);
      expect(result).not.toContain(START);
    });

    it('preserves content after the block after removal', () => {
      const after = 'Trailing content after annotation block.';
      const doc = `Before.\n\n${FAKE_BLOCK}\n\n${after}`;
      const result = manager.upsert(doc, '');

      expect(result).toContain('Before.');
      expect(result).toContain(after);
      expect(result).not.toContain(START);
    });

    it('returns just the before content when no trailing content exists', () => {
      const doc = `Content only.\n\n${FAKE_BLOCK}`;
      const result = manager.upsert(doc, '');

      expect(result).toBe('Content only.');
    });
  });

  // ── Malformed markers ──

  describe('malformed markers — only start marker, no end marker', () => {
    it('treats document as no-markers and appends when only start marker exists', () => {
      const doc = `Some content.\n\n${START}\n\nOrphan content without end marker`;
      const result = manager.upsert(doc, FAKE_BLOCK);

      // New block should be appended
      expect(result).toContain(FAKE_BLOCK);
      // The append should add the new block after the existing document
      const newBlockIdx = result.lastIndexOf(START);
      const originalStartIdx = result.indexOf(START);
      // There should be the original orphan start and then the new complete block
      // Actually the new block's START is appended, so it appears later in the doc
      expect(result.indexOf(END)).toBeGreaterThan(-1);
    });

    it('returns document unchanged when block is empty and only start marker exists', () => {
      const doc = `Some content.\n\n${START}\n\nOrphan content`;
      const result = manager.upsert(doc, '');

      // No markers to remove (malformed), no block to insert → document unchanged
      expect(result).toBe(doc);
    });
  });

  // ── Surrounding content preservation ──

  describe('surrounding content preservation', () => {
    it('does not alter content between frontmatter and managed block', () => {
      const frontmatter = '---\nplatform: tiktok\ntags:\n  - dance\n---\n';
      const body = '\n> Caption text\n\n![[media/tiktok/video.mp4]]\n\n---\n\n**Author:** @creator\n';
      const doc = frontmatter + body + '\n' + FAKE_BLOCK;
      const result = manager.upsert(doc, FAKE_BLOCK_V2);

      // Verify that body content in between is completely preserved
      expect(result).toContain('> Caption text');
      expect(result).toContain('![[media/tiktok/video.mp4]]');
      expect(result).toContain('**Author:** @creator');
    });

    it('handles document with only the managed block (no surrounding content)', () => {
      const result = manager.upsert(FAKE_BLOCK, FAKE_BLOCK_V2);
      expect(result).toContain(FAKE_BLOCK_V2);
      expect(result).not.toContain('### Notes (1)');
    });
  });
});
