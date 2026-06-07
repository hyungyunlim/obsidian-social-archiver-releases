/**
 * LinkedArchivesSectionManager — Unit Tests
 *
 * Mirrors AnnotationSectionManager test coverage for the separate
 * linked-archives marker pair. No Obsidian API, no network.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LinkedArchivesSectionManager } from '../../services/LinkedArchivesSectionManager';

const START = '<!-- social-archiver:linked-archives:start -->';
const END = '<!-- social-archiver:linked-archives:end -->';
const ANNOTATIONS_START = '<!-- social-archiver:annotations:start -->';
const ANNOTATIONS_END = '<!-- social-archiver:annotations:end -->';

const BLOCK = `${START}\n\n---\n\n## Linked archives\n\n**Links to**\n\n- [[Other|Title]]\n\n${END}`;
const BLOCK_V2 = `${START}\n\n---\n\n## Linked archives\n\n**Links to**\n\n- [[Other2|Title2]]\n\n${END}`;

describe('LinkedArchivesSectionManager', () => {
  let manager: LinkedArchivesSectionManager;

  beforeEach(() => {
    manager = new LinkedArchivesSectionManager();
  });

  describe('insert — no existing markers', () => {
    it('appends the block to an empty document', () => {
      expect(manager.upsert('', BLOCK)).toContain(BLOCK);
    });

    it('appends to a document with content, preserving the content', () => {
      const doc = '---\nplatform: x\n---\n\nSome post body.';
      const out = manager.upsert(doc, BLOCK);
      expect(out).toContain('Some post body.');
      expect(out).toContain(BLOCK);
      expect(out.indexOf('Some post body.')).toBeLessThan(out.indexOf(START));
    });

    it('does nothing when block is empty and no markers exist', () => {
      const doc = 'Just content.';
      expect(manager.upsert(doc, '')).toBe(doc);
    });
  });

  describe('replace — markers present', () => {
    it('replaces the block content between markers', () => {
      const doc = `Body.\n\n${BLOCK}`;
      const out = manager.upsert(doc, BLOCK_V2);
      expect(out).toContain('Title2');
      expect(out).not.toContain('- [[Other|Title]]');
      expect(out).toContain('Body.');
    });

    it('preserves content that follows the managed block', () => {
      const trailing = 'Trailing content after block.';
      const doc = `Body.\n\n${BLOCK}\n\n${trailing}`;
      const out = manager.upsert(doc, BLOCK_V2);
      expect(out).toContain(trailing);
      expect(out).toContain('Title2');
    });
  });

  describe('remove — empty block', () => {
    it('removes the managed block when block is empty', () => {
      const doc = `Body.\n\n${BLOCK}`;
      const out = manager.upsert(doc, '');
      expect(out).not.toContain(START);
      expect(out).not.toContain(END);
      expect(out).toContain('Body.');
    });

    it('keeps content after the block when removing', () => {
      const doc = `Body.\n\n${BLOCK}\n\nAfter.`;
      const out = manager.upsert(doc, '');
      expect(out).toContain('Body.');
      expect(out).toContain('After.');
      expect(out).not.toContain('## Linked archives');
    });
  });

  describe('malformed — start without end', () => {
    it('appends fresh when only a start marker exists', () => {
      const doc = `Body.\n\n${START}\n\nstray`;
      const out = manager.upsert(doc, BLOCK);
      expect(out).toContain(BLOCK);
    });
  });

  describe('coexistence with the annotations block', () => {
    it('leaves a preceding annotations block untouched when upserting linked-archives at EOF', () => {
      const annotations = `${ANNOTATIONS_START}\n\n## Mobile Annotations\n\n> note\n\n${ANNOTATIONS_END}`;
      const doc = `Body.\n\n${annotations}`;
      const out = manager.upsert(doc, BLOCK);
      expect(out).toContain(annotations);
      expect(out).toContain(BLOCK);
      // linked-archives is appended AFTER the annotations block
      expect(out.indexOf(ANNOTATIONS_START)).toBeLessThan(out.indexOf(START));
    });

    it('only touches its own markers when both blocks are present', () => {
      const annotations = `${ANNOTATIONS_START}\n\n## Mobile Annotations\n\n> note\n\n${ANNOTATIONS_END}`;
      const doc = `Body.\n\n${annotations}\n\n${BLOCK}`;
      const out = manager.upsert(doc, BLOCK_V2);
      expect(out).toContain(annotations); // annotations untouched
      expect(out).toContain('Title2'); // linked-archives replaced
      expect(out).not.toContain('- [[Other|Title]]');
    });
  });

  describe('idempotency', () => {
    it('is a no-op (byte-identical) when re-upserting the same block', () => {
      const doc = `Body.\n\n${BLOCK}`;
      const once = manager.upsert(doc, BLOCK);
      const twice = manager.upsert(once, BLOCK);
      expect(twice).toBe(once);
    });
  });
});
