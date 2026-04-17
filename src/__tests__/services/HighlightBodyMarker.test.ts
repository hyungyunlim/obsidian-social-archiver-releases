/**
 * HighlightBodyMarker — Unit Tests
 *
 * Verifies that `==text==` inline highlight marks in a vault note body are
 * reconciled to match a TextHighlight[] source of truth. Pure string-in,
 * string-out — no Obsidian API, no network calls.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HighlightBodyMarker } from '../../services/HighlightBodyMarker';
import type { TextHighlight } from '@/types/annotations';

// ─── Helpers ─────────────────────────────────────────────

const START = '<!-- social-archiver:annotations:start -->';
const END = '<!-- social-archiver:annotations:end -->';

/**
 * Strip YAML frontmatter (leading `---\n...\n---`), the annotations block,
 * AND any existing `==xxx==` marks from a test document to yield the canonical
 * fullText surrogate that dual-read runs against after strip. Mirrors the
 * internal slicing logic in HighlightBodyMarker (frontmatter + annotations
 * + stripUnmatchedMarks).
 */
function bodyPortionOf(doc: string): string {
  let fmEnd = 0;
  if (doc.startsWith('---')) {
    const secondDash = doc.indexOf('\n---', 3);
    if (secondDash >= 0) {
      const afterDash = secondDash + 4;
      fmEnd = afterDash < doc.length ? afterDash : doc.length;
    }
  }
  const afterFm = doc.slice(fmEnd);
  const ann = afterFm.indexOf(START);
  const body = ann >= 0 ? afterFm.slice(0, ann) : afterFm;
  // Strip any `==xxx==` marks — callers that care about post-strip offsets
  // (the coordinate space dual-read operates on) see the unwrapped text.
  return body.replace(/==(?![-=])([\s\S]+?)==/g, '$1');
}

/**
 * Build a test highlight. When `doc` is provided we auto-derive canonical
 * Phase-2 offsets (schemaVersion=2, coordinateVersion='fulltext-v1') from
 * the first occurrence of `text` in the body portion of `doc` (frontmatter
 * + annotations block stripped). This matches real production behavior:
 * `ReaderHighlightManager.computeCanonicalOffsets` always writes canonical
 * fullText offsets under Phase 2.
 *
 * Without `doc`, we fall back to the pre-Phase-3 default (0..text.length)
 * which is fine for tests that either supply explicit offset overrides,
 * exercise the "not present in body" codepath, or write their doc so the
 * text appears at offset 0 in the body portion.
 */
function makeHighlight(
  text: string,
  overrides: Partial<TextHighlight> = {},
  doc?: string
): TextHighlight {
  let startOffset = overrides.startOffset;
  let endOffset = overrides.endOffset;
  let schemaVersion = overrides.schemaVersion;
  let coordinateVersion = overrides.coordinateVersion;

  if (doc && startOffset === undefined && endOffset === undefined) {
    const body = bodyPortionOf(doc);
    const idx = body.indexOf(text);
    if (idx >= 0) {
      startOffset = idx;
      endOffset = idx + text.length;
      // Mark as canonical Phase-2 shape so dual-read classifies as
      // `canonical-trusted` and renders via the fast path.
      schemaVersion = schemaVersion ?? 2;
      coordinateVersion = coordinateVersion ?? 'fulltext-v1';
    }
  }

  return {
    id: overrides.id ?? `hl_${text.slice(0, 8).replace(/\s+/g, '_')}`,
    text,
    startOffset: startOffset ?? 0,
    endOffset: endOffset ?? text.length,
    color: overrides.color ?? 'yellow',
    contextBefore: overrides.contextBefore,
    contextAfter: overrides.contextAfter,
    schemaVersion,
    coordinateVersion,
    createdAt: overrides.createdAt ?? '2026-04-17T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-04-17T00:00:00.000Z',
  };
}

// ─── Tests ───────────────────────────────────────────────

describe('HighlightBodyMarker', () => {
  let marker: HighlightBodyMarker;

  beforeEach(() => {
    marker = new HighlightBodyMarker();
  });

  describe('insert — wrap target text in ==...==', () => {
    it('wraps a single target text in an empty-frontmatter document', () => {
      const doc = 'hello world';
      const result = marker.reconcile(doc, [makeHighlight('hello', {}, doc)]);
      expect(result).toBe('==hello== world');
    });

    it('preserves frontmatter exactly', () => {
      const doc = '---\nplatform: facebook\n---\n\nbody hello body';
      const result = marker.reconcile(doc, [makeHighlight('hello', {}, doc)]);
      expect(result).toBe('---\nplatform: facebook\n---\n\nbody ==hello== body');
    });

    it('does not touch the managed annotations block', () => {
      const doc = `body hello body\n\n${START}\n\n> [!quote]+ Highlight 1 · yellow\n> hello\n\n${END}`;
      const result = marker.reconcile(doc, [makeHighlight('hello', {}, doc)]);
      expect(result).toBe(
        `body ==hello== body\n\n${START}\n\n> [!quote]+ Highlight 1 · yellow\n> hello\n\n${END}`
      );
    });

    it('wraps multi-line highlight text', () => {
      const doc = 'line one\nline two\ntrailer';
      const result = marker.reconcile(doc, [makeHighlight('line one\nline two', {}, doc)]);
      expect(result).toBe('==line one\nline two==\ntrailer');
    });

    it('leaves text untouched when highlight text is not found in body', () => {
      const doc = 'body content';
      const result = marker.reconcile(doc, [makeHighlight('nowhere', {}, doc)]);
      expect(result).toBe('body content');
    });
  });

  describe('idempotency', () => {
    it('returns the same reference when no changes are needed', () => {
      const doc = 'already ==highlighted== text';
      const result = marker.reconcile(doc, [makeHighlight('highlighted', {}, doc)]);
      expect(result).toBe(doc);
    });

    it('is safe to call repeatedly without double-wrapping', () => {
      const initial = 'alpha beta gamma';
      const target = [makeHighlight('beta', {}, initial)];
      const once = marker.reconcile(initial, target);
      const twice = marker.reconcile(once, target);
      const thrice = marker.reconcile(twice, target);
      expect(once).toBe('alpha ==beta== gamma');
      expect(twice).toBe(once);
      expect(thrice).toBe(once);
    });
  });

  describe('remove — strip marks whose text is not in targets', () => {
    it('unwraps a mark when the highlight is removed from targets', () => {
      const doc = 'alpha ==beta== gamma';
      const result = marker.reconcile(doc, []);
      expect(result).toBe('alpha beta gamma');
    });

    it('removes some marks while keeping others', () => {
      const doc = 'the ==quick== brown ==fox== jumps';
      const result = marker.reconcile(doc, [makeHighlight('fox', {}, doc)]);
      expect(result).toBe('the quick brown ==fox== jumps');
    });

    it('does not strip foreign marks when no highlights are provided', () => {
      // Empty targets should still unwrap everything — foreign marks are only
      // preserved when they don't match ANY target, which is trivially true
      // when there are no targets. Asserting the conservative behavior:
      const doc = 'value ==emphasised== trailing';
      const result = marker.reconcile(doc, []);
      expect(result).toBe('value emphasised trailing');
    });
  });

  describe('foreign marks preservation with non-empty targets', () => {
    it('keeps ==marks== that happen to collide with a target text', () => {
      // If the user wrote `==urgent==` manually AND "urgent" is also a
      // synced highlight text, we keep it wrapped. Acceptable overlap.
      const doc = '==urgent== matter';
      const result = marker.reconcile(doc, [makeHighlight('urgent')]);
      expect(result).toBe('==urgent== matter');
    });

    it('unwraps unrelated ==marks== when targets exist', () => {
      const doc = '==random== and hello world';
      const result = marker.reconcile(doc, [makeHighlight('hello', {}, doc)]);
      expect(result).toBe('random and ==hello== world');
    });
  });

  describe('context disambiguation', () => {
    it('uses contextBefore to pick the correct repeated occurrence', () => {
      const doc = 'first foo and later foo trailing';
      const highlight = makeHighlight('foo', { contextBefore: 'and later ' });
      const result = marker.reconcile(doc, [highlight]);
      expect(result).toBe('first foo and later ==foo== trailing');
    });

    it('uses contextAfter to pick the correct repeated occurrence', () => {
      const doc = 'foo alpha middle foo omega trailing';
      // Second `foo` starts at index 17. The stored offsets point to that
      // occurrence, so Tier 1 (exact) wins; the contextAfter string is here
      // purely as a redundancy signal (matches highlight-core's `fulltext-v1`
      // write-back convention).
      const highlight = makeHighlight('foo', {
        startOffset: 17,
        endOffset: 20,
        contextAfter: ' omega',
      });
      const result = marker.reconcile(doc, [highlight]);
      expect(result).toBe('foo alpha middle ==foo== omega trailing');
    });

    it('falls back to first occurrence when context does not match', () => {
      const doc = 'foo alpha foo omega';
      const highlight = makeHighlight('foo', { contextBefore: 'nonexistent' });
      const result = marker.reconcile(doc, [highlight]);
      expect(result).toBe('==foo== alpha foo omega');
    });
  });

  describe('document structure preservation', () => {
    it('preserves trailing whitespace and newlines', () => {
      const doc = '---\nplatform: facebook\n---\n\nhello body\n\n---\nfooter\n';
      const result = marker.reconcile(doc, [makeHighlight('hello', {}, doc)]);
      expect(result).toBe('---\nplatform: facebook\n---\n\n==hello== body\n\n---\nfooter\n');
    });

    it('handles frontmatter without trailing content', () => {
      const doc = '---\nplatform: x\n---';
      const result = marker.reconcile(doc, [makeHighlight('missing', {}, doc)]);
      expect(result).toBe(doc);
    });

    it('handles documents without frontmatter', () => {
      const doc = 'plain hello text';
      const result = marker.reconcile(doc, [makeHighlight('hello', {}, doc)]);
      expect(result).toBe('plain ==hello== text');
    });
  });

  describe('dual-read (Phase 3)', () => {
    // PRD §5.4 / §5.5 — read-path dual-read. Plugin is canonical write-path,
    // so these cases verify the READ behavior only: resolved rows paint marks,
    // unresolved rows are preserved-without-marking, and wrong-canonical-v2
    // rows are recovered via re-anchor (STRONG tier with unique context).

    it('recovers a wrong-canonical v2 row by re-anchoring via context', () => {
      // Body has "hello" at offset 10. Highlight claims coordinateVersion
      // 'fulltext-v1' with stored offsets 0..5 — but body.slice(0,5) !== "hello".
      // Dual-read detects `wrong-canonical-v2` and re-resolves; STRONG tier
      // with unique contextBefore + contextAfter yields an eligible match.
      const doc = 'prefix    hello world';
      const hl = makeHighlight('hello', {
        startOffset: 0,
        endOffset: 5,
        schemaVersion: 2,
        coordinateVersion: 'fulltext-v1',
        contextBefore: 'prefix    ',
        contextAfter: ' world',
      } as any);
      const result = marker.reconcile(doc, [hl]);
      expect(result).toBe('prefix    ==hello== world');
    });

    it('logs wrong-canonical-v2 detections to console.debug', () => {
      // Even when the re-resolve fails below the write-back bar, the
      // wrong-canonical-v2 detection itself MUST be surfaced via
      // console.debug for field diagnostics (PRD §5.12 telemetry proxy).
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const doc = 'nothing matches here in this body';
      const hl = makeHighlight('phantom', {
        startOffset: 0,
        endOffset: 7,
        schemaVersion: 2,
        coordinateVersion: 'fulltext-v1',
      } as any);
      marker.reconcile(doc, [hl]);
      expect(debugSpy).toHaveBeenCalledWith(
        '[HighlightBodyMarker] wrong-canonical-v2 detected',
        expect.stringContaining('"highlightId":"hl_phantom"')
      );
      debugSpy.mockRestore();
    });

    it('re-anchors legacy-v0 rows via STRONG tier context', () => {
      // Legacy highlight with visible-text offsets that don't match the vault
      // body (pre-Phase-2 shape). Dual-read classifies as legacy-visible-v0
      // and the resolver STRONG tier recovers via unique context.
      const doc = 'the quick brown fox jumps over the lazy dog';
      const hl = makeHighlight('fox', {
        startOffset: 99, // bogus legacy offset
        endOffset: 102,
        schemaVersion: 1,
        coordinateVersion: 'legacy-visible-v0',
        contextBefore: 'quick brown ',
        contextAfter: ' jumps over',
      } as any);
      const result = marker.reconcile(doc, [hl]);
      expect(result).toBe('the quick brown ==fox== jumps over the lazy dog');
    });

    it('skips unresolved-migration rows without wrapping', () => {
      // Highlight text does not exist in the body at all. Dual-read falls
      // through to `unresolved-migration`; reconcile must preserve the body
      // verbatim (record is kept, mark is not painted).
      const doc = 'only lorem ipsum content here';
      const hl = makeHighlight('nowhere-in-body', {
        startOffset: 0,
        endOffset: 15,
        coordinateVersion: 'fulltext-v1',
        schemaVersion: 2,
      } as any);
      const result = marker.reconcile(doc, [hl]);
      expect(result).toBe(doc);
    });

    it('accepts an archive envelope {id, userHighlights} and renders correctly', () => {
      // Verifies the Phase 3 signature variant — the caller passes an archive
      // envelope so dual-read can key telemetry/logging on `archive.id`.
      const doc = 'alpha foxtrot bravo';
      const result = marker.reconcile(doc, {
        id: 'archive-xyz',
        userHighlights: [makeHighlight('foxtrot', {}, doc)],
      });
      expect(result).toBe('alpha ==foxtrot== bravo');
    });
  });

  describe('edge cases', () => {
    it('ignores empty-text highlights', () => {
      const doc = 'body';
      const result = marker.reconcile(doc, [makeHighlight('')]);
      expect(result).toBe('body');
    });

    it('does not match === heading rules as highlights', () => {
      const doc = 'Heading\n=====\n\nfoo body';
      const result = marker.reconcile(doc, [makeHighlight('foo', {}, doc)]);
      expect(result).toBe('Heading\n=====\n\n==foo== body');
    });

    it('excludes the managed block even when target text also appears inside it', () => {
      const doc = [
        'body hello trailing',
        '',
        START,
        '',
        '> [!quote]+ Highlight 1 · yellow',
        '> hello',
        '',
        END,
      ].join('\n');
      const result = marker.reconcile(doc, [makeHighlight('hello', {}, doc)]);
      expect(result).toContain('body ==hello== trailing');
      // The text "hello" inside the quote callout must not be ==wrapped==.
      expect(result).toContain('> hello');
      expect(result).not.toContain('> ==hello==');
    });
  });
});
